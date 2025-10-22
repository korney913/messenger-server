const admin = require("firebase-admin");

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
let privateKey = process.env.FIREBASE_PRIVATE_KEY;

// Убираем возможные лишние кавычки и нормализуем переносы строк
if (privateKey) {
  privateKey = privateKey
    .trim()                    // удаляем пробелы в начале и конце
    .replace(/^"|"$/g, "")     // убираем возможные кавычки по краям
    .replace(/\\n/g, "\n");   // реальные переносы строк
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId,
    clientEmail,
    privateKey,
  }),
});

console.log("Firebase Admin успешно инициализирован!");
