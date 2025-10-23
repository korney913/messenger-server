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

// Простая валидация ENV
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
const WATCH_COLLECTION = "Chats"; // коллекция для наблюдения
const NOTIFIED_FIELD = "notified"; // флаг, что уведомление отправлено

// =====================
// Функция для теста: возвращает токен вручную
async function getTokensForDoc(docData) {
  const TEST_TOKEN = "cF2Izli0RtGDjnmjQEhNEm:APA91bHB_kvdGSjfmra5MeMrSZZbwpiU0vI21mqJ5j43cQmRk9bkZfzO0C6wMKcSBVRzlToI-cUmHSc0DByMTYVGgTosUp7LJVxmPdqOAxh46KyzBKFW0Xw";
  return [TEST_TOKEN];
}

// Отправка уведомления
async function sendNotificationsToTokens(tokens, messagePayload) {
  if (!tokens || tokens.length === 0) return { successCount: 0 };
  try {
    const resp = await fcm.sendMulticast({
      tokens,
      notification: messagePayload.notification,
      android: messagePayload.android,
      data: messagePayload.data,
    });
    resp.responses.forEach((r, idx) => {
      if (!r.success) {
        console.log("Invalid token:", tokens[idx], r.error?.message);
      }
    });
    return { successCount: resp.successCount };
  } catch (err) {
    console.error("sendMulticast error:", err);
    return { successCount: 0 };
  }
}

// Обработчик нового документа
async function handleNewDoc(doc) {
  const docRef = doc.ref;
  const data = doc.data();
  if (!data) return;

  // Если уже уведомлено — игнорируем
  if (data[NOTIFIED_FIELD]) {
    console.log(`Doc already notified: ${docRef.id}`);
    return;
  }

  console.log(`handleNewDoc triggered for doc: ${docRef.id}`);

  // Получаем токены
  const tokens = await getTokensForDoc(data);
  if (!tokens || tokens.length === 0) {
    console.log("No tokens for doc:", docRef.id);
    return;
  }

  // Формируем сообщение
  const messagePayload = {
    notification: {
      title: "📁 Новый чат",
      body: `Создан новый чат с ID: ${docRef.id}`,
    },
    android: { priority: "high" },
    data: { chatId: docRef.id },
  };

  const result = await sendNotificationsToTokens(tokens, messagePayload);
  console.log(`Sent ${result.successCount} notifications for doc ${docRef.id}`);

  // Помечаем документ как уведомленный
  await docRef.update({ [NOTIFIED_FIELD]: true });
}

// Прослушивание коллекции
function startListener() {
  console.log(`Starting listener on collection "${WATCH_COLLECTION}"`);
  db.collection(WATCH_COLLECTION)
    .where(NOTIFIED_FIELD, "==", false)
    .onSnapshot((snapshot, err) => {
      if (err) {
        console.error("onSnapshot listener error:", err);
        return;
      }
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          handleNewDoc(change.doc).catch((e) => console.error("handleNewDoc error:", e));
        }
      });
    });
}

// Запуск listener
startListener();

// HTTP endpoint для теста
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
app.listen(3000, () => console.log(`Server running on port 3000`));
