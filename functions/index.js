const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const DOW = ["DIM", "LUN", "MAR", "MER", "JEU", "VEN", "SAM"];

function todayLabel() {
  return DOW[new Date().getDay()];
}

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

exports.sendDailyReminders = functions.region("europe-west1").https.onRequest(async (req, res) => {
  const db = admin.firestore();
  const label = todayLabel();
  const todayISO = startOfTodayISO();
  const todayTime = new Date(todayISO).getTime();

  const snap = await db.collectionGroup("pushTokens").get();
  const uidTokens = {};
  snap.forEach((doc) => {
    const data = doc.data();
    if (data.enabled === false || !data.token) return;
    const [, uid] = doc.ref.path.split("/");
    (uidTokens[uid] ||= []).push(data.token);
  });

  const messages = [];
  for (const [uid, tokens] of Object.entries(uidTokens)) {
    const consSnap = await db
      .collection("u")
      .doc(uid)
      .collection("consignes")
      .where("mode", "==", "daily")
      .where("active", "==", true)
      .get();

    let count = 0;
    for (const d of consSnap.docs) {
      const c = d.data();
      const days = Array.isArray(c.days) ? c.days : [];
      const everyDay = days.length === 0;
      const scheduledToday = everyDay || days.includes(label);
      if (!scheduledToday) continue;

      let visible = true;
      if (c.srEnabled !== false) {
        const srDoc = await db
          .collection("u")
          .doc(uid)
          .collection("sr")
          .doc(`consigne:${d.id}`)
          .get();
        const st = srDoc.exists ? srDoc.data() : null;
        const nextISO = st?.nextVisibleOn || st?.hideUntil;
        if (nextISO && new Date(nextISO).getTime() > todayTime) {
          visible = false;
        }
      }

      if (visible) count++;
    }

    if (count > 0) {
      messages.push({
        tokens,
        notification: {
          title: "Rappel du jour 👋",
          body: `Tu as ${count} consigne${count > 1 ? "s" : ""} à remplir aujourd’hui.`,
        },
        webpush: {
          fcmOptions: { link: "https://vincladef.github.io/code-tracking-prod/#/daily" },
        },
      });
    }
  }

  if (!messages.length) {
    return res.status(200).send("Aucune notif à envoyer.");
  }

  let sent = 0;
  for (const m of messages) {
    const r = await admin.messaging().sendMulticast(m);
    sent += r.successCount || 0;
  }

  return res.status(200).send(`Notifications envoyées: ${sent}`);
});
