// index.js — Firebase Admin SDK через ENV с исправленным privateKey
const express = require("express");
const admin = require("firebase-admin");

const AUTH_SECRET = process.env.AUTH_SECRET;

const app = express();
app.use(express.json());

// Чистим и нормализуем privateKey
let projectId = process.env.FIREBASE_PROJECT_ID;
if (projectId) {
  projectId = projectId.trim().replace(/^"|"$/g, "");
}

let clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
if (clientEmail) {
  clientEmail = clientEmail.trim().replace(/^"|"$/g, "");
}

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey) {
  privateKey = privateKey.trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n");
}

console.log("projectId:", process.env.FIREBASE_PROJECT_ID);
console.log("clientEmail:", process.env.FIREBASE_CLIENT_EMAIL);
console.log("privateKey length:", process.env.FIREBASE_PRIVATE_KEY?.length || 0);

admin.initializeApp({
  credential: admin.credential.cert({
    projectId,
    clientEmail,
    privateKey,
  }),
});

console.log("Firebase Admin успешно инициализирован!");

// POST /send-notification
app.post("/send-notification", async (req, res) => {
  const { token, title, body } = req.body;

  if (!token) return res.status(400).json({ error: "Не указан token" });

  const message = {
    token,
    notification: {
      title: title || "Новое сообщение",
      body: body || "Привет! У тебя новое сообщение 👋",
    },
    android: { priority: "high" },
  };

  try {
    const response = await admin.messaging().send(message);
    res.json({ success: true, messageId: response });
  } catch (error) {
    console.error("Ошибка отправки FCM:", error);
    res.status(500).json({ error: "Ошибка FCM", details: error });
  }
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server запущен на порту ${PORT}`));
