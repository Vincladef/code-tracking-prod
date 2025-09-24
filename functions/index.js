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

const DAILY_BASE = "https://vincladef.github.io/code-tracking-prod/";
const ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAB6ElEQVR42u3d0U0gQAxDwVRGudccRUANJwTrxLNSGvCb/52Pf59frvfGCAAYAgAHgAPAAeAAuHv/8wAoC94KYkTvxjDCd0MY8bsRjPDdEEb8bgQjfDeEEb8bwYjfjWDE70Yw4ncjGPG7EYz43QhG/G4EAAAgfjOCEb8bAQAAiN+MYMTvRgAAAOI3IwAAAPGbEQAAgPjNCAAAQPxmBAAAAAAA4tciAAAA8ZsRAAAAAAAAAID4nQgAAAAAAAAAQPxOBAAAAAAAAAAAAAAAACB+GwIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAiWxwcAAAAAAAAAAAAAAAAI2uIDAAAAAAAAAASd8QEAAAAAAAAAgs74AADg17Dm+AAAAAAA/g6ujQ8AAO8AQPA+PgAAvAUAwdv4AADwHkA7gtfbAwDAewCtCBJ2jwHQhiBlcwAAyAHQgiBp7zgA1xGkbQ0AAHkAriJI3DkWwDUEqRtHA7iCIHnfeADbEaRvuwLAVgQbdl0DYBuCLZuuArAFwaY91wFIhrBxx7UA0hBs3XA1gAQI27c7AeAVggu7nQHwlxAu7XUOwG9huLrRaQA/xdCwCwAAAAAAAAAAAAAAAADQBuAb8crY5qD79QEAAAAASUVORK5CYII=";
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

function monthKeyFromDate(date) {
  const dt = date instanceof Date ? new Date(date.getTime()) : new Date(date);
  if (Number.isNaN(dt.getTime())) return "";
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

function parseMonthKey(monthKey) {
  const [yearStr, monthStr] = String(monthKey || "").split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month };
}

function shiftMonthKey(baseKey, offset) {
  if (!Number.isFinite(offset)) return baseKey;
  const parsed = parseMonthKey(baseKey);
  if (!parsed) return baseKey;
  const base = new Date(parsed.year, parsed.month - 1 + offset, 1);
  return monthKeyFromDate(base);
}

function normalizedWeekday(value) {
  return ((value % 7) + 7) % 7;
}

function mondayIndexFromSundayIndex(value) {
  return normalizedWeekday(value + 6);
}

function weekSegmentDaysInMonth(segment, targetYear, targetMonthIndex) {
  if (!segment?.start || !segment?.end) {
    return 0;
  }
  let count = 0;
  const cursor = new Date(segment.start.getTime());
  for (let step = 0; step < 7; step += 1) {
    if (cursor.getFullYear() === targetYear && cursor.getMonth() === targetMonthIndex) {
      count += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function monthWeekSegments(monthKey) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return [];
  const { year, month } = parsed;
  const totalDays = new Date(year, month, 0).getDate();
  if (!totalDays) return [];
  const firstDay = new Date(year, month - 1, 1);
  const firstWeekday = mondayIndexFromSundayIndex(firstDay.getDay());
  const baseStartDay = 1 - firstWeekday;
  const rawSegments = [];
  for (let index = 1, startDay = baseStartDay; startDay <= totalDays; index += 1, startDay += 7) {
    const endDay = startDay + 6;
    const start = new Date(year, month - 1, startDay);
    const end = new Date(year, month - 1, endDay);
    rawSegments.push({ index, start, end, startDay, endDay });
  }
  const monthIndex = month - 1;
  const filtered = rawSegments.filter((segment) =>
    weekSegmentDaysInMonth(segment, year, monthIndex) >= 4
  );
  if (!filtered.length) {
    return rawSegments;
  }
  return filtered.map((segment, idx) => ({ ...segment, index: idx + 1 }));
}

function weekDateRange(monthKey, weekIndex) {
  if (!weekIndex) return null;
  const segments = monthWeekSegments(monthKey);
  if (!segments.length) return null;
  const target = segments.find((segment) => segment.index === Number(weekIndex));
  if (!target) return null;
  return { start: target.start, end: target.end };
}

function theoreticalObjectiveDate(objective) {
  const explicitEnd = toDate(objective?.endDate);
  if (explicitEnd) {
    explicitEnd.setHours(0, 0, 0, 0);
    return explicitEnd;
  }
  if (objective?.type === "hebdo") {
    const range = weekDateRange(objective.monthKey, objective.weekOfMonth || 1);
    if (range?.end) {
      const end = new Date(range.end.getTime());
      end.setHours(0, 0, 0, 0);
      return end;
    }
  }
  if (objective?.type === "mensuel") {
    const parsed = parseMonthKey(objective.monthKey);
    if (parsed) {
      const end = new Date(parsed.year, parsed.month, 0);
      end.setHours(0, 0, 0, 0);
      return end;
    }
  }
  const fallback = toDate(objective?.startDate);
  if (fallback) {
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }
  return null;
}

async function fetchObjectivesByMonth(uid, monthKey) {
  if (!uid || !monthKey) return [];
  try {
    const snap = await db
      .collection("u")
      .doc(uid)
      .collection("objectifs")
      .where("monthKey", "==", monthKey)
      .get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    functions.logger.warn("fetchObjectivesByMonth:error", { uid, monthKey, error });
    return [];
  }
}

async function countObjectivesDueToday(uid, context) {
  const monthKey = monthKeyFromDate(context.selectedDate);
  const previousMonth = shiftMonthKey(monthKey, -1);
  const targetMonths = new Set([monthKey]);
  if (previousMonth && previousMonth !== monthKey) {
    targetMonths.add(previousMonth);
  }

  const objectives = [];
  for (const key of targetMonths) {
    const rows = await fetchObjectivesByMonth(uid, key);
    objectives.push(...rows);
  }

  const dueIso = context.dateIso;
  let count = 0;
  for (const objective of objectives) {
    if (objective.notifyOnTarget === false) continue;
    const dueDate = theoreticalObjectiveDate(objective);
    if (!dueDate) continue;
    const iso = dueDate.toISOString().slice(0, 10);
    if (iso === dueIso) {
      count += 1;
    }
  }
  return count;
}

function pluralize(count, singular, plural = null) {
  if (count === 1) return singular;
  return plural || `${singular}s`;
}

function buildReminderBody(consigneCount, objectiveCount) {
  const items = [];
  if (consigneCount > 0) {
    items.push(`${consigneCount} ${pluralize(consigneCount, "consigne")}`);
  }
  if (objectiveCount > 0) {
    items.push(`${objectiveCount} ${pluralize(objectiveCount, "objectif")}`);
  }
  if (!items.length) {
    return "Tu n’as rien à remplir aujourd’hui.";
  }
  if (items.length === 1) {
    return `Tu as ${items[0]} à remplir aujourd’hui.`;
  }
  if (items.length === 2) {
    return `Tu as ${items[0]} et ${items[1]} à remplir aujourd’hui.`;
  }
  const last = items.pop();
  return `Tu as ${items.join(", ")} et ${last} à remplir aujourd’hui.`;
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

async function sendReminder(uid, tokens, visibleCount, objectiveCount, context) {
  if (!tokens.length) return { successCount: 0, failureCount: 0, responses: [] };

  const title = "Rappel du jour 👋";
  const body = buildReminderBody(visibleCount, objectiveCount);

  const link = buildUserDailyLink(uid, context.dateIso);

  const message = {
    tokens,
    data: {
      link,
      count: String(visibleCount),
      day: context.dayLabel,
      consignes: String(visibleCount),
      objectifs: String(objectiveCount),
      body,
      title,
    },
    notification: { title, body },
    webpush: {
      fcmOptions: { link },
      notification: {
        title,
        body,
        icon: ICON_DATA_URL,
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
          const objectiveCount = await countObjectivesDueToday(uid, context);
          if (visibleCount < 1 && objectiveCount < 1) {
            functions.logger.debug("sendDailyReminders:skip", {
              uid,
              reason: "no_visible_items",
            });
            continue;
          }

          const response = await sendReminder(uid, tokens, visibleCount, objectiveCount, context);
          results.push({
            uid,
            tokens: tokens.length,
            visibleCount,
            objectiveCount,
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
function buildUserDailyLink(uid, dateIso) {
  return `${DAILY_BASE}#/daily?u=${encodeURIComponent(uid)}&d=${dateIso}`;
}

