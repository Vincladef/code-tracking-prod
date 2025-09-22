const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

const DAY_LABELS = ["DIM", "LUN", "MAR", "MER", "JEU", "VEN", "SAM"];
const DAY_NORMALIZE = {
  dim: "DIM",
  lun: "LUN",
  mar: "MAR",
  mer: "MER",
  jeu: "JEU",
  ven: "VEN",
  sam: "SAM",
};

const DAILY_LINK = "https://vincladef.github.io/code-tracking-prod/#/daily";
const ICON_URL = "https://vincladef.github.io/code-tracking-prod/icon.png";
const BADGE_URL = "https://vincladef.github.io/code-tracking-prod/badge.png";

const INVALID_TOKEN_ERRORS = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

function normalizeDay(value) {
  if (!value) return null;
  const key = String(value).trim().toLowerCase().replace(/\.$/, "");
  const short = key.slice(0, 3);
  return DAY_NORMALIZE[short] || null;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") {
    try {
      return value.toDate();
    } catch (err) {
      functions.logger.warn("toDate:failed", err);
    }
  }
  if (typeof value === "number") {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) return asDate;
  }
  if (typeof value === "string") {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) return asDate;
  }
  return null;
}

function parisContext(now = new Date()) {
  const parisNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Paris", hour12: false })
  );
  const offsetMs = parisNow.getTime() - now.getTime();
  const dayLabel = DAY_LABELS[parisNow.getDay()];
  const midnightLocal = new Date(parisNow);
  midnightLocal.setHours(0, 0, 0, 0);
  const selectedDate = new Date(midnightLocal.getTime() - offsetMs);

  return {
    dayLabel,
    selectedDate,
    dateIso: selectedDate.toISOString().slice(0, 10),
  };
}

async function collectPushTokens() {
  const snap = await db.collectionGroup("pushTokens").get();
  const tokensByUid = new Map();

  snap.forEach((doc) => {
    const data = doc.data() || {};
    if (data.enabled === false) return;
    const token = data.token || doc.id;
    if (!token) return;
    const parent = doc.ref.parent?.parent;
    const uid = parent?.id;
    if (!uid) return;

    const list = tokensByUid.get(uid) || [];
    if (!list.includes(token)) list.push(token);
    tokensByUid.set(uid, list);
  });

  return tokensByUid;
}

async function disableToken(uid, token) {
  try {
    await db
      .doc(`u/${uid}/pushTokens/${token}`)
      .set(
        {
          enabled: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  } catch (error) {
    functions.logger.error("disableToken:error", { uid, token, error });
  }
}

async function countVisibleConsignes(uid, context) {
  const consSnap = await db
    .collection("u")
    .doc(uid)
    .collection("consignes")
    .where("mode", "==", "daily")
    .get();

  if (consSnap.empty) return 0;

  const consignes = consSnap.docs
    .map((doc) => ({ id: doc.id, data: doc.data() || {} }))
    .filter((item) => item.data.active !== false);

  if (!consignes.length) return 0;

  const needsSr = consignes.some((item) => item.data.srEnabled !== false);
  const srMap = new Map();

  if (needsSr) {
    const srSnap = await db.collection("u").doc(uid).collection("sr").get();
    srSnap.forEach((doc) => {
      if (!doc.id.startsWith("consigne:")) return;
      srMap.set(doc.id.slice("consigne:".length), doc.data() || {});
    });
  }

  let visible = 0;

  for (const item of consignes) {
    const { id, data } = item;
    const days = Array.isArray(data.days)
      ? data.days.map((d) => normalizeDay(d)).filter(Boolean)
      : [];
    if (days.length && !days.includes(context.dayLabel)) continue;

    if (data.srEnabled === false) {
      visible += 1;
      continue;
    }

    const srData = srMap.get(id);
    if (!srData) {
      visible += 1;
      continue;
    }

    const nextDate = toDate(srData.nextVisibleOn ?? srData.hideUntil);
    if (!nextDate || nextDate <= context.selectedDate) {
      visible += 1;
    }
  }

  return visible;
}

async function sendReminder(uid, tokens, visibleCount, context) {
  if (!tokens.length) return { successCount: 0, failureCount: 0, responses: [] };

  const title = "Rappel du jour 👋";
  const body = `Tu as ${visibleCount} consigne(s) à remplir aujourd’hui.`;

  const message = {
    tokens,
    data: {
      link: DAILY_LINK,
      count: String(visibleCount),
      day: context.dayLabel,
    },
    notification: { title, body },
    webpush: {
      fcmOptions: { link: DAILY_LINK },
      notification: {
        title,
        body,
        icon: ICON_URL,
        badge: BADGE_URL,
      },
    },
  };

  const response = await admin.messaging().sendEachForMulticast(message);

  const invalid = [];
  response.responses.forEach((r, idx) => {
    if (r.success) return;
    const token = tokens[idx];
    const code = r.error?.code;
    functions.logger.warn("sendReminder:failure", {
      uid,
      token,
      code,
      message: r.error?.message,
    });
    if (code && INVALID_TOKEN_ERRORS.has(code)) invalid.push(token);
  });

  await Promise.all(invalid.map((token) => disableToken(uid, token)));

  return response;
}

exports.sendDailyReminders = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.status(204).send("");
      return;
    }

    res.set("Access-Control-Allow-Origin", "*");

    try {
      const context = parisContext();
      functions.logger.info("sendDailyReminders:start", context);

      const tokensByUid = await collectPushTokens();
      const results = [];

      for (const [uid, tokens] of tokensByUid.entries()) {
        try {
          const visibleCount = await countVisibleConsignes(uid, context);
          if (visibleCount < 1) {
            functions.logger.debug("sendDailyReminders:skip", {
              uid,
              reason: "no_visible_consignes",
            });
            continue;
          }

          const response = await sendReminder(uid, tokens, visibleCount, context);
          results.push({
            uid,
            tokens: tokens.length,
            visibleCount,
            sent: response.successCount,
            failed: response.failureCount,
          });
        } catch (err) {
          functions.logger.error("sendDailyReminders:userError", { uid, err });
        }
      }

      functions.logger.info("sendDailyReminders:done", { recipients: results.length });

      res.json({
        ok: true,
        day: context.dayLabel,
        date: context.dateIso,
        recipients: results.length,
        results,
      });
    } catch (error) {
      functions.logger.error("sendDailyReminders:error", error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });
