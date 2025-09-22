const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

// Exemple basique pour tester le déploiement
exports.sendDailyReminders = functions.https.onRequest(async (req, res) => {
  res.send("Hello depuis Firebase Functions ! 🚀");
});
