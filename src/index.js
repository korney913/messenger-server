// index.js — Render: Firestore listener -> FCM sender (prod-ready)
const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// Нормализация ENV
const norm = (v) => (typeof v === "string" ? v.trim().replace(/^"|"$/g, "") : "");
const projectId = norm(process.env.FIREBASE_PROJECT_ID);
const clientEmail = norm(process.env.FIREBASE_CLIENT_EMAIL);
let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey) privateKey = norm(privateKey).replace(/\\n/g, "\n");

// Простая валидация ENV (в проде лучше логировать и alert'ы)
if (!projectId || !clientEmail || !privateKey) {
  console.error("Missing Firebase ENV vars. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY");
  process.exit(1);
}

// Инициализация Admin SDK
admin.initializeApp({
  credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
});
const db = admin.firestore();
const fcm = admin.messaging();

console.log("Firebase Admin initialized, Firestore listener will start.");

// Конфиг
const WATCH_COLLECTION = "Chats"; // <- поменяй на свою коллекцию
const CLAIM_FIELD = "notificationClaim"; // поле для claim / lock
const NOTIFIED_FIELD = "notified"; // флаг, что уведомление отправлено
const MAX_BATCH = 500; // sendMulticast максимум 500 токенов

// Функция чтоб попытаться "захватить" документ: atomically set claim to this instance id
const instanceId = `${Date.now()}_${Math.random().toString(36).slice(2,10)}`;

// Попытка пометить документ транзакционно: если NOTIFIED_FIELD уже true => пропустить.
// иначе установить CLAIM_FIELD = instanceId.
// Возвращает true если claim поставлен успешно и NOTIFIED_FIELD был false.
async function tryClaimDoc(docRef) {
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) return false;
      const data = snap.data();
      if (data && data[NOTIFIED_FIELD]) return false;
      // если уже кто-то пометил claim — пропускаем (можно проверять CLAIM_FIELD тоже)
      if (data && data[CLAIM_FIELD] && data[CLAIM_FIELD] !== instanceId) return false;
      tx.update(docRef, { [CLAIM_FIELD]: instanceId });
      return true;
    });
  } catch (err) {
    console.error("tryClaimDoc tx error:", err);
    return false;
  }
}

// После успешной отправки — пометим документ notified:true и удалим claim
async function markNotified(docRef) {
  try {
    await docRef.update({ [NOTIFIED_FIELD]: true, [CLAIM_FIELD]: admin.firestore.FieldValue.delete() });
  } catch (err) {
    console.error("markNotified error:", err);
  }
}

// Пример: как получить список токенов для уведомления
// В реальности у тебя может быть поле tokens: [] в документе, или нужно найти подписчиков в users collection
async function getTokensForDoc(docData) {
  // Пример 1: если docData.tokens массив — используем его
  if (Array.isArray(docData.tokens) && docData.tokens.length) return docData.tokens;
  // Пример 2: док содержит ownerId, и мы ищем токен в users/{ownerId}
  if (docData.ownerId) {
    const userSnap = await db.collection("users").doc(docData.ownerId).get();
    if (userSnap.exists) {
      const user = userSnap.data();
      if (user && Array.isArray(user.tokens)) return user.tokens;
      if (user && typeof user.fcmToken === "string") return [user.fcmToken];
    }
  }
  return [];
}

// Отправка батчами
async function sendNotificationsToTokens(tokens, messagePayload) {
  if (!tokens || tokens.length === 0) return { successCount: 0 };

  let success = 0;
  for (let i = 0; i < tokens.length; i += MAX_BATCH) {
    const batch = tokens.slice(i, i + MAX_BATCH);
    const multicast = {
      tokens: batch,
      notification: messagePayload.notification,
      android: messagePayload.android,
      apns: messagePayload.apns,
      data: messagePayload.data,
    };
    try {
      const resp = await fcm.sendMulticast(multicast);
      success += resp.successCount;
      // обработка невалидных токенов
      resp.responses.forEach((r, idx) => {
        if (!r.success) {
          const err = r.error;
          if (err && (err.code === 'messaging/registration-token-not-registered' || err.code === 'messaging/invalid-registration-token')) {
            // TODO: удалить этот токен из БД (user.tokens)
            console.log("Invalid token, should delete:", batch[idx]);
            // Здесь можно пометить в users collection, или отправить job на удаление
          }
        }
      });
    } catch (err) {
      console.error("sendMulticast error:", err);
      // продолжим следующие батчи
    }
  }
  return { successCount: success };
}

// Обработчик нового документа (добавления)
async function handleNewDoc(doc) {
  const docRef = doc.ref;
  const data = doc.data();
  if (!data) return;

  // Если уже отмечен как notified — игнорируем
  if (data[NOTIFIED_FIELD]) return;

  // Попытка claim'а: только тот инстанс, который успешно взял claim, отправляет уведомление
  const claimed = await tryClaimDoc(docRef);
  if (!claimed) return;

  // Собираем токены
  const tokens = await getTokensForDoc(data);
  if (!tokens || tokens.length === 0) {
    console.log("No tokens for doc:", docRef.id);
    // можно снять claim / пометить, если требуется
    await docRef.update({ [CLAIM_FIELD]: admin.firestore.FieldValue.delete() });
    return;
  }

  // Сформируем сообщение (настраивай под себя)
  const messagePayload = {
    notification: {
      title: "📁 Новый файл",
      body: data.name ? `${data.name} был загружен` : "Новый файл",
    },
    android: { priority: "high" },
    data: { fileId: docRef.id },
  };

  const result = await sendNotificationsToTokens(tokens, messagePayload);
  console.log(`Sent ${result.successCount} notifications for doc ${docRef.id}`);

  // Пометка как отправлено
  await markNotified(docRef);
}

// Прослушивание изменений коллекции — добро для небольших нагрузок
function startListener() {
  console.log(`Starting listener on collection "${WATCH_COLLECTION}"`);
  db.collection(WATCH_COLLECTION)
    .where(NOTIFIED_FIELD, "==", false) // слушаем только те, которые ещё не уведомлены (если поле есть)
    .onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          handleNewDoc(change.doc).catch(err => console.error("handleNewDoc error:", err));
        }
      });
    }, (err) => {
      console.error("onSnapshot listener error:", err);
      // при желании имплементировать реконнект / alert
    });
}

// Запуск listener'а после инициализации
startListener();

// HTTP endpoint для ручного теста/фронтенда (опционально)
app.post("/send-notification-test", async (req, res) => {
  const { tokens, title, body } = req.body;
  if (!tokens || !tokens.length) return res.status(400).json({ error: "No tokens" });

  const payload = {
    notification: { title: title || "Тест", body: body || "Тестовое уведомление" },
    android: { priority: "high" },
  };
  const r = await sendNotificationsToTokens(tokens, payload);
  res.json({ sent: r.successCount });
});

// Держим процесс живым
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
