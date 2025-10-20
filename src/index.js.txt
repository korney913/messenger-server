// index.js — Node.js сервер для отправки FCM пушей
const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

// URL FCM (Legacy API)
const FCM_URL = "https://fcm.googleapis.com/fcm/send";

// Берём ключ из переменной окружения
const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY;
const AUTH_SECRET = process.env.AUTH_SECRET || "dev-secret";

if (!FCM_SERVER_KEY) {
  console.error("ERROR: FCM_SERVER_KEY не установлен в переменных окружения.");
  process.exit(1);
}

// Простой health-check
app.get("/", (req, res) => res.send("messenger-server работает"));

// Endpoint для отправки пушей
app.post("/send-notification", async (req, res) => {
  const auth = req.header("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return res.status(401).json({ error: "Отсутствует Authorization" });
  const token = auth.split(" ")[1];
  if (token !== AUTH_SECRET) return res.status(403).json({ error: "Доступ запрещён" });

  const { tokens, token: singleToken, title, body, data } = req.body;

  const recipients = Array.isArray(tokens) ? tokens : (singleToken ? [singleToken] : []);
  if (recipients.length === 0) return res.status(400).json({ error: "Не указан токен устройства" });

  const payload = {
    registration_ids: recipients,
    notification: {
      title: title || "Новое сообщение",
      body: body || ""
    },
    data: data || {}
  };

  try {
    const response = await fetch(FCM_URL, {
      method: "POST",
      headers: {
        "Authorization": `key=${FCM_SERVER_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const json = await response.json();
    return res.json({ success: true, fcmResponse: json });
  } catch (err) {
    console.error("Ошибка FCM:", err);
    return res.status(500).json({ error: "Ошибка отправки FCM", details: err.toString() });
  }
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server запущен на порту ${PORT}`));