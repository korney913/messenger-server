// index.js — Render: Firestore listener -> FCM sender (prod-ready)
const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// ====== Нормализация ENV ======
const norm = (v) => (typeof v === "string" ? v.trim().replace(/^"|"$/g, "") : "");
const projectId = norm(process.env.FIREBASE_PROJECT_ID);
const clientEmail = norm(process.env.FIREBASE_CLIENT_EMAIL);
let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey) privateKey = norm(privateKey).replace(/\\n/g, "\n");

// Простая валидация ENV
if (!projectId || !clientEmail || !privateKey) {
  console.error("Missing Firebase ENV vars. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY");
  process.exit(1);
}

// ====== Инициализация Admin SDK ======
admin.initializeApp({
  credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
});
const db = admin.firestore();
const fcm = admin.messaging();

console.log("Firebase Admin initialized, Firestore listener will start.");

// ====== Конфиг ======
const WATCH_COLLECTION = "Chats"; // коллекция для слежения
const CLAIM_FIELD = "notificationClaim"; // поле для claim / lock
const NOTIFIED_FIELD = "notified"; // флаг, что уведомление отправлено

// уникальный id инстанса, чтобы не гонять один и тот же doc несколько раз
const instanceId = `${Date.now()}_${Math.random().toString(36).slice(2,10)}`;

// ====== Попытка "захватить" документ ======
async function tryClaimDoc(docRef) {
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) return false;
      const data = snap.data();
      if (data && data[NOTIFIED_FIELD]) return false;
      if (data && data[CLAIM_FIELD] && data[CLAIM_FIELD] !== instanceId) return false;
      tx.update(docRef, { [CLAIM_FIELD]: instanceId });
      return true;
    });
  } catch (err) {
    console.error("tryClaimDoc tx error:", err);
    return false;
  }
}

// ====== Пометить документ как уведомленный ======
async function markNotified(docRef) {
  try {
    await docRef.update({ [NOTIFIED_FIELD]: true, [CLAIM_FIELD]: admin.firestore.FieldValue.delete() });
  } catch (err) {
    console.error("markNotified error:", err);
  }
}

// ====== Получение токенов для уведомления ======
async function getTokensForDoc(docData) {
  // Тестовый токен FCM — для проверки
  const TEST_TOKEN = "cF2Izli0RtGDjnmjQEhNEm:APA91bHB_kvdGSjfmra5MeMrSZZbwpiU0vI21mqJ5j43cQmRk9bkZfzO0C6wMKcSBVRzlToI-cUmHSc0DByMTYVGgTosUp7LJVxmPdqOAxh46KyzBKFW0Xw";
  return [TEST_TOKEN];
}

// ====== Отправка уведомлений по одному токену ======
async function sendNotificationsToTokens(tokens, messagePayload) {
  if (!tokens || tokens.length === 0) return { successCount: 0 };

  let success = 0;
  for (const token of tokens) {
    const msg = { ...messagePayload, token };
    try {
      await fcm.send(msg);
      success++;
    } catch (err) {
      console.error("send error for token:", token, err);
    }
  }
  return { successCount: success };
}

// ====== Обработка нового документа ======
async function handleNewDoc(doc) {
  console.log("handleNewDoc triggered for doc:", doc.id);
  const docRef = doc.ref;
  const data = doc.data();
  if (!data) return;

  if (data[NOTIFIED_FIELD]) {
    console.log("Doc already notified:", docRef.id);
    return;
  }

  const claimed = await tryClaimDoc(docRef);
  if (!claimed) {
    console.log("Doc not claimed, skipping:", docRef.id);
    return;
  }

  const tokens = await getTokensForDoc(data);
  console.log("Tokens to notify:", tokens);

  if (!tokens || tokens.length === 0) {
    console.log("No tokens for doc:", docRef.id);
    await docRef.update({ [CLAIM_FIELD]: admin.firestore.FieldValue.delete() });
    return;
  }

  const messagePayload = {
    notification: {
      title: "📁 Новый чат",
      body: data.participants ? `Новый чат с ${data.participants.join(", ")}` : "Новый чат",
    },
    android: { priority: "high" },
    data: { chatId: docRef.id },
  };

  try {
    const result = await sendNotificationsToTokens(tokens, messagePayload);
    console.log(`Sent ${result.successCount} notifications for doc ${docRef.id}`);
  } catch (err) {
    console.error("handleNewDoc sendNotifications error:", err);
  }

  await markNotified(docRef);
}

// ====== Слушатель коллекции ======
function startListener() {
  console.log(`Starting listener on collection "${WATCH_COLLECTION}"`);
  db.collection(WATCH_COLLECTION)
    .where(NOTIFIED_FIELD, "==", false)
    .onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          handleNewDoc(change.doc).catch(err => console.error("handleNewDoc error:", err));
        }
      });
    }, (err) => {
      console.error("onSnapshot listener error:", err);
    });
}

// ====== Запуск listener'а ======
startListener();

// ====== HTTP endpoint для теста ======
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

// ====== Держим процесс живым ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
