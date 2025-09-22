const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const DOW = ["DIM","LUN","MAR","MER","JEU","VEN","SAM"]; // 0..6
const TODAY_LABEL = () => {
  const i = new Date().getDay(); // 0=dim
  return DOW[i];
};
const ISO_DAY = () => {
  const d = new Date(); d.setHours(0,0,0,0);
  return d.toISOString();
};

exports.sendDailyReminders = functions.https.onRequest(async (req, res) => {
  const db = admin.firestore();
  const todayLabel = TODAY_LABEL();
  const todayIso = ISO_DAY();

  // Récupérer tous les tokens (et le uid parent)
  const snap = await db.collectionGroup("pushTokens").get();
  if (snap.empty) return res.status(200).send("Aucun token.");

  // Grouper par uid
  const uidTokens = {};
  snap.forEach(doc => {
    const data = doc.data();
    if (data.enabled === false || !data.token) return;
    const [, uid] = doc.ref.path.split("/"); // /u/{uid}/pushTokens/{token}
    uidTokens[uid] = uidTokens[uid] || [];
    uidTokens[uid].push(data.token);
  });

  // Pour chaque uid: compter consignes visibles aujourd'hui (daily) + pratique si tu veux
  const messages = [];
  for (const [uid, tokens] of Object.entries(uidTokens)) {
    // Consignes daily actives
    const dailyQs = await db.collection("u").doc(uid).collection("consignes")
      .where("mode","==","daily").where("active","==",true).get();

    let dailyCount = 0;
    for (const d of dailyQs.docs) {
      const c = d.data();
      const days = Array.isArray(c.days) ? c.days : [];
      const everyday = days.length === 0;
      const scheduledToday = everyday || days.includes(todayLabel);

      if (!scheduledToday) continue;

      // SR : lire l'état
      let visible = true;
      if (c.srEnabled !== false) {
        const srDoc = await db.collection("u").doc(uid).collection("sr")
          .doc(`consigne:${d.id}`).get();
        const st = srDoc.exists ? srDoc.data() : null;
        if (st?.nextVisibleOn) {
          // visible si nextVisibleOn <= aujourd'hui (à minuit)
          visible = (new Date(st.nextVisibleOn).getTime() <= new Date(todayIso).getTime());
        }
      }
      if (visible) dailyCount++;
    }

    // Ne rien envoyer si rien à remplir aujourd’hui
    if (dailyCount <= 0) continue;

    const body = `Tu as ${dailyCount} consigne${dailyCount>1?"s":""} à remplir aujourd’hui.`;
    messages.push({
      tokens,
      notification: { title: "Rappel du jour 👋", body },
      webpush: { fcmOptions: { link: "https://tracking-d-habitudes.firebaseapp.com/#/daily" } }
    });
  }

  if (!messages.length) return res.status(200).send("Aucune notif à envoyer.");

  // Envoi par batches
  let sent = 0;
  for (const m of messages) {
    const resp = await admin.messaging().sendMulticast(m);
    sent += resp.successCount || 0;
  }
  return res.status(200).send(`Notifications envoyées: ${sent}`);
});
