// index.js — Firestore listener -> FCM sender (уведомления всем участникам чата)
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

console.log("✅ Firebase Admin initialized");

// === Константы ===
const CHATS_COLLECTION = "Chats";
const MESSAGES_SUBCOLLECTION = "Messages";
const MAX_BATCH = 500;

// === Получаем токены участников (кроме отправителя) ===
async function getTokensForChatParticipants(chatId, senderUid) {
  try {
    const chatSnap = await db.collection(CHATS_COLLECTION).doc(chatId).get();
    if (!chatSnap.exists) {
      console.log("⚠️ Чат не найден:", chatId);
      return [];
    }

    const chatData = chatSnap.data();
    const participants = chatData.participants || [];

    const receivers = participants.filter((uid) => uid !== senderUid);
    if (receivers.length === 0) {
      console.log("⚠️ В чате нет получателей (кроме отправителя)");
      return [];
    }

    console.log(`👥 Получатели (${receivers.length}):`, receivers);

    const tokens = [];
    for (const uid of receivers) {
      const userSnap = await db.collection("Users").doc(uid).get();
      if (userSnap.exists && userSnap.data().token) {
        tokens.push(userSnap.data().token);
      } else {
        console.log(`⚠️ Нет токена у пользователя ${uid}`);
      }
    }

    console.log(`✅ Получено ${tokens.length} токенов`);
    return tokens;
  } catch (err) {
    console.error("❌ Ошибка при получении токенов:", err);
    return [];
  }
}

// === Отправка уведомлений ===
async function sendNotificationsToTokens(tokens, messagePayload) {
  if (!tokens || tokens.length === 0) return { successCount: 0 };

  let success = 0;
  for (let i = 0; i < tokens.length; i += MAX_BATCH) {
    const batch = tokens.slice(i, i + MAX_BATCH);
    const multicast = {
      tokens: batch,
      notification: messagePayload.notification,
      android: messagePayload.android,
      data: messagePayload.data,
    };
    try {
      const resp = await admin.messaging().sendEachForMulticast(multicast);
      success += resp.successCount;
      console.log(`📤 Отправлено ${resp.successCount} уведомлений`);
    } catch (err) {
      console.error("❌ Ошибка при отправке:", err);
    }
  }
  return { successCount: success };
}

// === Обработка нового сообщения ===
async function handleNewMessage(chatId, messageDoc) {
  const data = messageDoc.data();
  if (!data) return;

  const { senderUid, message } = data;
  console.log(`💬 Новое сообщение в чате ${chatId} от ${senderUid}:`, message);

  // Получаем токены всех участников чата, кроме отправителя
  const tokens = await getTokensForChatParticipants(chatId, senderUid);
  if (!tokens.length) {
    console.log("⚠️ Нет токенов для отправки уведомлений");
    return;
  }

  const messagePayload = {
    notification: {
      title: "💬 Новое сообщение",
      body: message || "У вас новое сообщение",
    },
    android: { priority: "high" },
    data: { chatId, senderUid },
  };

  const result = await sendNotificationsToTokens(tokens, messagePayload);
  console.log(`✅ Уведомление отправлено (${result.successCount}) для чата ${chatId}`);
}

// === Слушатель подколлекций Messages ===
function startListener() {
  console.log(`👂 Слушаем новые сообщения в "${CHATS_COLLECTION}/{chatId}/${MESSAGES_SUBCOLLECTION}"`);

  db.collection(CHATS_COLLECTION).onSnapshot((chatSnap) => {
    chatSnap.docChanges().forEach((chatChange) => {
      const chatId = chatChange.doc.id;

      db.collection(CHATS_COLLECTION)
        .doc(chatId)
        .collection(MESSAGES_SUBCOLLECTION)
        .onSnapshot((msgSnap) => {
          msgSnap.docChanges().forEach((change) => {
            if (change.type === "added") {
              handleNewMessage(chatId, change.doc).catch((err) =>
                console.error("handleNewMessage error:", err)
              );
            }
          });
        });
    });
  });
}

// === Запуск ===
startListener();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
