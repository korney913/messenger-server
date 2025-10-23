// index.js — уведомления всем участникам чата, кроме отправителя
const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// === Инициализация Firebase ===
const norm = (v) => (typeof v === "string" ? v.trim().replace(/^"|"$/g, "") : "");
const projectId = norm(process.env.FIREBASE_PROJECT_ID);
const clientEmail = norm(process.env.FIREBASE_CLIENT_EMAIL);
let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey) privateKey = norm(privateKey).replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  console.error("❌ Missing Firebase ENV vars");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
});
const db = admin.firestore();
const fcm = admin.messaging();

console.log("✅ Firebase Admin initialized");

// === Константы ===
const CHATS_COLLECTION = "Chats";
const MESSAGES_SUBCOLLECTION = "Messages";
const MAX_BATCH = 500;

// === Получение токенов участников чата, кроме отправителя ===
async function getTokensForChat(chatId, senderUid) {
  try {
    const chatRef = db.collection(CHATS_COLLECTION).doc(chatId);
    const chatSnap = await chatRef.get();

    if (!chatSnap.exists) {
      console.log("⚠️ Чат не найден:", chatId);
      return [];
    }

    const chatData = chatSnap.data();
    const participants = chatData.participants || [];
    const recipients = participants.filter((uid) => uid !== senderUid);

    if (recipients.length === 0) {
      console.log("⚠️ Нет получателей уведомления (все — отправитель)");
      return [];
    }

    // Получаем токены пользователей
    const tokens = [];
    for (const uid of recipients) {
      const userSnap = await db.collection("Users").doc(uid).get();
      if (userSnap.exists) {
        const userData = userSnap.data();
        if (userData.token) {
          tokens.push(userData.token);
        }
      }
    }

    console.log(`🎯 Получено ${tokens.length} токенов для чата ${chatId}`);
    return tokens;
  } catch (err) {
    console.error("❌ Ошибка при получении токенов:", err);
    return [];
  }
}
