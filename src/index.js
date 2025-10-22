// index.js — Firebase Admin SDK через ENV с исправленным privateKey
const express = require("express");
const admin = require("firebase-admin");

const AUTH_SECRET = process.env.AUTH_SECRET;

const app = express();
app.use(express.json());

// Чистим и нормализуем privateKey
let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey) {
  privateKey = privateKey
    .trim()                  // удаляем пробелы по краям
    .replace(/^"|"$/g, "")   // убираем кавычки по краям, если есть
    .replace(/\\n/g, "\n"); // настоящие переносы строк
}

// Инициализация Firebase Admin через ENV
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
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
