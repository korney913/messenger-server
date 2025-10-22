// index.js — с Firebase Admin SDK
const express = require("express");
const admin = require("firebase-admin");

const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY;
const AUTH_SECRET = process.env.AUTH_SECRET;

const app = express();
app.use(express.json());

const serviceAccount = JSON.parse(process.env.FCM_SERVER_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// POST /send-notification
app.post("/send-notification", async (req, res) => {
  const { token, title, body } = req.body;

  const message = {
    token: token,
    notification: {
      title: title || "Новое сообщение",
      body: body || "Привет! У тебя новое сообщение 👋"
    },
    android: { priority: "high" }
  };

  try {
    const response = await admin.messaging().send(message);
    res.json({ success: true, messageId: response });
  } catch (error) {
    console.error("Ошибка отправки FCM:", error);
    res.status(500).json({ error: "Ошибка FCM", details: error });
  }
});

app.listen(3000, () => console.log("Server запущен на порту 3000"));
