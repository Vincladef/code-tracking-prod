const functions = require("firebase-functions");
const admin = require("firebase-admin");
const tls = require("tls");
const { buildReminderBody } = require("./reminder");

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
const SUMMARY_FALLBACK_RECIPIENTS = ["como.denizot@gmail.com"];

const INVALID_TOKEN_ERRORS = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

const DOCUMENT_ID_FIELD = admin.firestore.FieldPath.documentId();

function toStringOrNull(value, { trim = true } = {}) {
  if (value === undefined || value === null) return null;
  const str = String(value);
  if (!trim) return str;
  const trimmed = str.trim();
  return trimmed.length ? trimmed : null;
}

function uniqueTokens(input = []) {
  const list = Array.isArray(input) ? input : [input];
  const seen = new Set();
  const result = [];
  list.forEach((value) => {
    const token = toStringOrNull(value);
    if (!token || seen.has(token)) return;
    seen.add(token);
    result.push(token);
  });
  return result;
}

function sanitizeDataForFcm(data = {}) {
  const output = {};
  if (!data || typeof data !== "object") {
    return output;
  }
  Object.entries(data).forEach(([key, value]) => {
    const normalizedKey = toStringOrNull(key);
    if (!normalizedKey || value === undefined || value === null) {
      return;
    }
    if (typeof value === "string") {
      output[normalizedKey] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      output[normalizedKey] = String(value);
    } else if (value instanceof Date) {
      output[normalizedKey] = value.toISOString();
    } else if (typeof value === "object") {
      try {
        output[normalizedKey] = JSON.stringify(value);
      } catch (error) {
        functions.logger.warn("sanitizeDataForFcm:json", { key: normalizedKey, error: error?.message });
      }
    } else {
      output[normalizedKey] = String(value);
    }
  });
  return output;
}

function sanitizeFcmNotification(notification = {}) {
  const sanitized = {};
  if (!notification || typeof notification !== "object") {
    return sanitized;
  }
  const title = toStringOrNull(notification.title);
  if (title) sanitized.title = title;
  const body = toStringOrNull(notification.body);
  if (body) sanitized.body = body;
  const image = toStringOrNull(notification.image);
  if (image) sanitized.image = image;
  return sanitized;
}

function sanitizeNotificationActions(actions = []) {
  if (!Array.isArray(actions)) return undefined;
  const list = actions
    .map((action) => {
      if (!action || typeof action !== "object") return null;
      const id = toStringOrNull(action.action);
      const title = toStringOrNull(action.title);
      if (!id || !title) return null;
      const icon = toStringOrNull(action.icon);
      const sanitizedAction = { action: id, title };
      if (icon) sanitizedAction.icon = icon;
      return sanitizedAction;
    })
    .filter(Boolean);
  return list.length ? list : undefined;
}

function sanitizeWebpushNotification(notification = {}, defaults = {}) {
  const sanitized = sanitizeFcmNotification(notification);
  const icon = toStringOrNull(notification.icon ?? defaults.icon);
  if (icon) sanitized.icon = icon;
  const badge = toStringOrNull(notification.badge ?? defaults.badge);
  if (badge) sanitized.badge = badge;
  const lang = toStringOrNull(notification.lang);
  if (lang) sanitized.lang = lang;
  const dir = toStringOrNull(notification.dir);
  if (dir) sanitized.dir = dir;
  const tag = toStringOrNull(notification.tag);
  if (tag) sanitized.tag = tag;
  if (notification.renotify != null) sanitized.renotify = Boolean(notification.renotify);
  if (notification.requireInteraction != null) sanitized.requireInteraction = Boolean(notification.requireInteraction);
  if (notification.silent != null) sanitized.silent = Boolean(notification.silent);
  if (Array.isArray(notification.vibrate)) sanitized.vibrate = notification.vibrate.filter((value) => Number.isFinite(Number(value))).map(Number);
  const timestamp = Number(notification.timestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) sanitized.timestamp = timestamp;
  const data = sanitizeDataForFcm(notification.data || {});
  if (Object.keys(data).length > 0) sanitized.data = data;
  const actions = sanitizeNotificationActions(notification.actions);
  if (actions) sanitized.actions = actions;
  return sanitized;
}

function buildWebpushPayload(webpush = {}, defaults = {}) {
  const payload = {};
  const headers = webpush.headers;
  if (headers && typeof headers === "object") {
    const sanitizedHeaders = {};
    Object.entries(headers).forEach(([key, value]) => {
      const headerName = toStringOrNull(key);
      const headerValue = toStringOrNull(value, { trim: false });
      if (headerName && headerValue != null) {
        sanitizedHeaders[headerName] = headerValue;
      }
    });
    if (Object.keys(sanitizedHeaders).length > 0) {
      payload.headers = sanitizedHeaders;
    }
  }

  const link = toStringOrNull(webpush?.fcmOptions?.link ?? defaults.defaultLink);
  if (link) {
    payload.fcmOptions = { link };
  }

  const notificationPayload = sanitizeWebpushNotification(webpush.notification || {}, {
    icon: defaults.defaultIcon,
    badge: defaults.defaultBadge,
  });
  if (Object.keys(notificationPayload).length > 0) {
    payload.notification = notificationPayload;
  } else if (defaults.defaultIcon || defaults.defaultBadge) {
    const fallbackNotification = sanitizeWebpushNotification({}, {
      icon: defaults.defaultIcon,
      badge: defaults.defaultBadge,
    });
    if (Object.keys(fallbackNotification).length > 0) {
      payload.notification = fallbackNotification;
    }
  }

  if (webpush.data && typeof webpush.data === "object") {
    const sanitizedData = sanitizeDataForFcm(webpush.data);
    if (Object.keys(sanitizedData).length > 0) {
      payload.data = sanitizedData;
    }
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

function sanitizeTopic(topic) {
  const normalized = toStringOrNull(topic, { trim: true });
  if (!normalized) return null;
  const cleaned = normalized.replace(/[^a-zA-Z0-9-_.~%]/g, "");
  return cleaned.length ? cleaned : null;
}

function buildConditionFromTopics(topics = []) {
  const sanitized = topics
    .map((topic) => sanitizeTopic(topic))
    .filter(Boolean);
  const unique = uniqueTokens(sanitized);
  if (!unique.length) return null;
  return unique.map((topic) => `'${topic}' in topics`).join(" || ");
}

async function sendFcmMulticast(tokens, message, options = {}) {
  const { dryRun = false, failureEvent = "fcm:multicast:failure", metadata = {}, onInvalidToken } = options;
  const sanitizedTokens = uniqueTokens(tokens);
  if (!sanitizedTokens.length) {
    return { successCount: 0, failureCount: 0, responses: [], invalidTokens: [], tokens: [] };
  }

  const payload = { ...message, tokens: sanitizedTokens };
  const response = await admin.messaging().sendEachForMulticast(payload, dryRun);
  const invalidTokens = [];

  response.responses.forEach((result, index) => {
    if (result.success) return;
    const token = sanitizedTokens[index];
    const code = result.error?.code;
    functions.logger.warn(failureEvent, {
      ...metadata,
      token,
      code,
      message: result.error?.message,
    });
    if (code && INVALID_TOKEN_ERRORS.has(code)) {
      invalidTokens.push(token);
    }
  });

  if (invalidTokens.length && typeof onInvalidToken === "function") {
    await Promise.allSettled(invalidTokens.map((token) => onInvalidToken(token)));
  }

  return { ...response, invalidTokens, tokens: sanitizedTokens };
}

async function sendFcmToTopic(topic, message, options = {}) {
  const { dryRun = false, failureEvent = "fcm:topic:failure", metadata = {} } = options;
  const normalizedTopic = sanitizeTopic(topic);
  if (!normalizedTopic) {
    throw new functions.https.HttpsError("invalid-argument", "Topic invalide");
  }
  try {
    const messageId = await admin.messaging().send({ topic: normalizedTopic, ...message }, dryRun);
    return { messageId, topic: normalizedTopic };
  } catch (error) {
    functions.logger.error(failureEvent, {
      ...metadata,
      topic: normalizedTopic,
      code: error?.code,
      message: error?.message,
    });
    throw error;
  }
}

async function sendFcmToCondition(condition, message, options = {}) {
  const { dryRun = false, failureEvent = "fcm:condition:failure", metadata = {} } = options;
  const normalizedCondition = toStringOrNull(condition);
  if (!normalizedCondition) {
    throw new functions.https.HttpsError("invalid-argument", "Condition invalide");
  }
  try {
    const messageId = await admin.messaging().send({ condition: normalizedCondition, ...message }, dryRun);
    return { messageId, condition: normalizedCondition };
  } catch (error) {
    functions.logger.error(failureEvent, {
      ...metadata,
      condition: normalizedCondition,
      code: error?.code,
      message: error?.message,
    });
    throw error;
  }
}

async function fetchTokensForUid(uid) {
  if (!uid) return [];
  const snap = await db.collection("u").doc(uid).collection("pushTokens").get();
  const tokens = [];
  snap.forEach((doc) => {
    const data = doc.data() || {};
    if (data.enabled === false) return;
    const token = data.token || doc.id;
    if (!token || tokens.includes(token)) return;
    tokens.push(token);
  });
  return tokens;
}

async function disableTokenByLookup(token) {
  if (!token) return;
  const tasks = [];
  try {
    const snap = await db.collectionGroup("pushTokens").where(DOCUMENT_ID_FIELD, "==", token).get();
    snap.forEach((doc) => {
      const parent = doc.ref.parent?.parent;
      const uid = parent?.id;
      if (uid) {
        tasks.push(disableToken(uid, token));
      }
    });
  } catch (error) {
    functions.logger.error("disableTokenByLookup:user", { token, error: error?.message });
  }

  if (tasks.length) {
    await Promise.allSettled(tasks);
  }
}

function resolveTargetDescriptor(target = {}) {
  const input = target || {};
  switch (input.type) {
    case "token": {
      const tokens = uniqueTokens([input.token]);
      return tokens.length
        ? { type: "tokens", tokens, ownerUid: toStringOrNull(input.ownerUid) }
        : { type: null };
    }
    case "tokens": {
      const tokens = uniqueTokens(input.tokens);
      return tokens.length
        ? { type: "tokens", tokens, ownerUid: toStringOrNull(input.ownerUid) }
        : { type: null };
    }
    case "uid": {
      const uid = toStringOrNull(input.uid);
      return uid ? { type: "uid", uid } : { type: null };
    }
    case "topic": {
      const topic = sanitizeTopic(input.topic);
      return topic ? { type: "topic", topic } : { type: null };
    }
    case "condition": {
      const condition = toStringOrNull(input.condition);
      return condition ? { type: "condition", condition } : { type: null };
    }
    default:
      break;
  }

  if (Array.isArray(input.topics)) {
    const condition = buildConditionFromTopics(input.topics);
    if (condition) {
      return { type: "condition", condition };
    }
  }

  if (input.condition) {
    const condition = toStringOrNull(input.condition);
    if (condition) {
      return { type: "condition", condition };
    }
  }

  if (input.topic) {
    const topic = sanitizeTopic(input.topic);
    if (topic) {
      return { type: "topic", topic };
    }
  }

  if (input.tokens) {
    const tokens = uniqueTokens(input.tokens);
    if (tokens.length) {
      return { type: "tokens", tokens, ownerUid: toStringOrNull(input.ownerUid) };
    }
  }

  if (input.token) {
    const tokens = uniqueTokens([input.token]);
    if (tokens.length) {
      return { type: "tokens", tokens, ownerUid: toStringOrNull(input.ownerUid) };
    }
  }

  if (input.uid) {
    const uid = toStringOrNull(input.uid);
    if (uid) {
      return { type: "uid", uid };
    }
  }

  return { type: null };
}

function parseRequestBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }
  try {
    const raw = req.rawBody ? req.rawBody.toString("utf8") : "";
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    functions.logger.warn("parseRequestBody:json", { error: error?.message });
    return null;
  }
}

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

function customObjectiveReminderDate(objective) {
  if (!objective) return null;
  const raw =
    objective.notifyAt ??
    objective.notifyDate ??
    objective.notificationDate ??
    null;
  const customDate = toDate(raw);
  if (!customDate) return null;
  customDate.setHours(0, 0, 0, 0);
  return customDate;
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
    const dueDate = customObjectiveReminderDate(objective) || theoreticalObjectiveDate(objective);
    if (!dueDate) continue;
    const iso = dueDate.toISOString().slice(0, 10);
    if (iso === dueIso) {
      count += 1;
    }
  }
  return count;
}

function extractFirstName(profile = {}) {
  const raw = String(profile.name || profile.displayName || "").trim();
  if (!raw) return "";
  const parts = raw.split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return parts[0];
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

async function sendReminder(uid, tokens, visibleCount, objectiveCount, context, firstName = "") {
  const title = firstName ? `${firstName}, rappel du jour 👋` : "Rappel du jour 👋";
  const body = buildReminderBody(firstName, visibleCount, objectiveCount);
  const link = buildUserDailyLink(uid, context.dateIso);

  const message = {
    data: {
      link,
      count: String(visibleCount),
      day: context.dayLabel,
      consignes: String(visibleCount),
      objectifs: String(objectiveCount),
      body,
      title,
      firstName: firstName || "",
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

  return sendFcmMulticast(tokens, message, {
    failureEvent: "sendReminder:failure",
    metadata: { uid },
    onInvalidToken: (token) => disableToken(uid, token),
  });
}

exports.dispatchPushNotification = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type,Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Méthode non autorisée" });
      return;
    }

    const body = parseRequestBody(req);
    if (!body || typeof body !== "object") {
      res.status(400).json({ ok: false, error: "Corps JSON invalide" });
      return;
    }

    const { target = {}, notification = {}, data = {}, webpush = {}, dryRun } = body;

    const resolvedTarget = resolveTargetDescriptor(target);
    if (!resolvedTarget.type) {
      res.status(400).json({ ok: false, error: "Cible de notification invalide" });
      return;
    }

    const sanitizedData = sanitizeDataForFcm(data);
    let messageData = Object.keys(sanitizedData).length ? { ...sanitizedData } : null;
    const sanitizedNotification = sanitizeFcmNotification(notification);

    const requestedLink =
      toStringOrNull(webpush?.fcmOptions?.link) ||
      messageData?.link ||
      messageData?.url ||
      null;
    if (requestedLink && (!messageData || !messageData.link)) {
      messageData = { ...(messageData || {}), link: requestedLink };
    }

    const message = {};
    if (messageData) {
      message.data = messageData;
    }
    if (Object.keys(sanitizedNotification).length > 0) {
      message.notification = sanitizedNotification;
    }

    const webpushPayload = buildWebpushPayload(webpush || {}, {
      defaultIcon: ICON_DATA_URL,
      defaultBadge: BADGE_URL,
      defaultLink: requestedLink,
    });
    if (webpushPayload) {
      message.webpush = webpushPayload;
    }

    if (!message.data && !message.notification && !message.webpush) {
      res.status(400).json({ ok: false, error: "Payload de notification vide" });
      return;
    }

    const dryRunFlag =
      dryRun === true || dryRun === "true" || dryRun === 1 || dryRun === "1";

    try {
      switch (resolvedTarget.type) {
        case "tokens": {
          if (!resolvedTarget.tokens.length) {
            res.status(400).json({ ok: false, error: "Aucun token fourni" });
            return;
          }
          const result = await sendFcmMulticast(resolvedTarget.tokens, message, {
            dryRun: dryRunFlag,
            failureEvent: "dispatchNotification:failure",
            metadata: {
              source: "api",
              targetType: "tokens",
              ownerUid: resolvedTarget.ownerUid || null,
            },
            onInvalidToken: (token) =>
              resolvedTarget.ownerUid
                ? disableToken(resolvedTarget.ownerUid, token)
                : disableTokenByLookup(token),
          });
          res.json({
            ok: true,
            dryRun: dryRunFlag,
            target: {
              type: "tokens",
              tokens: result.tokens,
              ownerUid: resolvedTarget.ownerUid || null,
            },
            result: {
              successCount: result.successCount,
              failureCount: result.failureCount,
              invalidTokens: result.invalidTokens,
              responses: result.responses,
            },
          });
          return;
        }
        case "uid": {
          const tokens = await fetchTokensForUid(resolvedTarget.uid);
          if (!tokens.length) {
            res.status(404).json({ ok: false, error: "Aucun token actif pour cet utilisateur" });
            return;
          }
          const result = await sendFcmMulticast(tokens, message, {
            dryRun: dryRunFlag,
            failureEvent: "dispatchNotification:failure",
            metadata: {
              source: "api",
              targetType: "uid",
              uid: resolvedTarget.uid,
            },
            onInvalidToken: (token) => disableToken(resolvedTarget.uid, token),
          });
          res.json({
            ok: true,
            dryRun: dryRunFlag,
            target: {
              type: "uid",
              uid: resolvedTarget.uid,
              tokens: result.tokens,
            },
            result: {
              successCount: result.successCount,
              failureCount: result.failureCount,
              invalidTokens: result.invalidTokens,
              responses: result.responses,
            },
          });
          return;
        }
        case "topic": {
          const result = await sendFcmToTopic(resolvedTarget.topic, message, {
            dryRun: dryRunFlag,
            failureEvent: "dispatchNotification:topicFailure",
            metadata: { source: "api" },
          });
          res.json({
            ok: true,
            dryRun: dryRunFlag,
            target: { type: "topic", topic: result.topic },
            result,
          });
          return;
        }
        case "condition": {
          const result = await sendFcmToCondition(resolvedTarget.condition, message, {
            dryRun: dryRunFlag,
            failureEvent: "dispatchNotification:conditionFailure",
            metadata: { source: "api" },
          });
          res.json({
            ok: true,
            dryRun: dryRunFlag,
            target: { type: "condition", condition: result.condition },
            result,
          });
          return;
        }
        default:
          res.status(400).json({ ok: false, error: "Type de cible non supporté" });
          return;
      }
    } catch (error) {
      const code = error?.code || error?.errorInfo?.code;
      const status = code === "invalid-argument" ? 400 : 500;
      functions.logger.error("dispatchNotification:error", {
        code,
        message: error?.message,
        target: resolvedTarget,
      });
      res.status(status).json({
        ok: false,
        error: error?.message || "Envoi impossible",
        code,
      });
    }
  });

exports.manageTopicSubscriptions = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type,Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Méthode non autorisée" });
      return;
    }

    const body = parseRequestBody(req);
    if (!body || typeof body !== "object") {
      res.status(400).json({ ok: false, error: "Corps JSON invalide" });
      return;
    }

    const action = body.action === "unsubscribe" ? "unsubscribe" : "subscribe";
    const topic = sanitizeTopic(body.topic);
    const tokens = uniqueTokens(body.tokens);

    if (!topic) {
      res.status(400).json({ ok: false, error: "Topic invalide" });
      return;
    }
    if (!tokens.length) {
      res.status(400).json({ ok: false, error: "Aucun token fourni" });
      return;
    }

    try {
      const result =
        action === "unsubscribe"
          ? await admin.messaging().unsubscribeFromTopic(tokens, topic)
          : await admin.messaging().subscribeToTopic(tokens, topic);

      const invalidTokens = [];
      (result.errors || []).forEach((entry) => {
        const token = tokens[entry.index];
        const code = entry.error?.code;
        functions.logger.warn(`manageTopicSubscriptions:${action}:failure`, {
          topic,
          token,
          code,
          message: entry.error?.message,
        });
        if (code && INVALID_TOKEN_ERRORS.has(code)) {
          invalidTokens.push(token);
        }
      });

      if (invalidTokens.length) {
        await Promise.allSettled(invalidTokens.map((token) => disableTokenByLookup(token)));
      }

      res.json({
        ok: true,
        action,
        topic,
        result: {
          successCount: result.successCount,
          failureCount: result.failureCount,
          invalidTokens,
        },
      });
    } catch (error) {
      functions.logger.error("manageTopicSubscriptions:error", {
        action,
        topic,
        message: error?.message,
        code: error?.code || error?.errorInfo?.code,
      });
      res.status(500).json({ ok: false, error: error?.message || "Action impossible" });
    }
  });

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
        const entry = {
          uid,
          tokens: tokens.length,
          visibleCount: 0,
          objectiveCount: 0,
          sent: 0,
          failed: 0,
          invalidTokens: [],
          status: "pending",
          reason: null,
          error: null,
          firstName: "",
          displayName: "",
          link: buildUserDailyLink(uid, context.dateIso),
        };

        try {
          let firstName = "";
          let displayName = "";
          try {
            const profileSnap = await db.collection("u").doc(uid).get();
            if (profileSnap.exists) {
              const profileData = profileSnap.data() || {};
              firstName = extractFirstName(profileData);
              displayName = profileData.displayName || profileData.name || firstName || "";
            }
          } catch (profileError) {
            functions.logger.warn("sendDailyReminders:profile:error", { uid, error: profileError });
          }

          entry.firstName = firstName;
          entry.displayName = displayName;

          entry.visibleCount = await countVisibleConsignes(uid, context);
          entry.objectiveCount = await countObjectivesDueToday(uid, context);

          if (entry.visibleCount < 1 && entry.objectiveCount < 1) {
            entry.status = "skipped";
            entry.reason = "no_visible_items";
            functions.logger.debug("sendDailyReminders:skip", { uid, reason: "no_visible_items" });
            results.push(entry);
            continue;
          }

          if (!tokens.length) {
            entry.status = "skipped";
            entry.reason = "no_tokens";
            functions.logger.debug("sendDailyReminders:skip", { uid, reason: "no_tokens" });
            results.push(entry);
            continue;
          }

          const response = await sendReminder(
            uid,
            tokens,
            entry.visibleCount,
            entry.objectiveCount,
            context,
            firstName
          );

          entry.sent = response.successCount;
          entry.failed = response.failureCount;
          entry.invalidTokens = response.invalidTokens || [];

          if (entry.sent > 0 && entry.failed > 0) {
            entry.status = "partial";
          } else if (entry.sent > 0) {
            entry.status = "sent";
          } else if (entry.failed > 0) {
            entry.status = "failed";
          } else {
            entry.status = "skipped";
            entry.reason = entry.reason || "no_messages";
          }

          results.push(entry);
        } catch (err) {
          entry.status = "error";
          entry.error = err?.message || String(err);
          results.push(entry);
          functions.logger.error("sendDailyReminders:userError", { uid, err });
        }
      }

      const breakdown = results.reduce((acc, item) => {
        const key = item.status || "unknown";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

      functions.logger.info("sendDailyReminders:done", {
        recipients: results.length,
        breakdown,
      });

      try {
        await sendDailySummaryEmail(context, results);
      } catch (mailError) {
        functions.logger.error("sendDailyReminders:mail:error", {
          message: mailError?.message,
        });
      }

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

function resolveMailSettings() {
  const config = functions.config();
  const mail = config?.mail || {};
  const host = toStringOrNull(mail.host);
  const from = toStringOrNull(mail.from);
  if (!host || !from) {
    return null;
  }

  const rawPort = Number(mail.port);
  const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 465;
  const secure =
    mail.secure === true ||
    mail.secure === "true" ||
    mail.secure === 1 ||
    mail.secure === "1" ||
    port === 465;
  const user = toStringOrNull(mail.user);
  const pass = toStringOrNull(mail.pass);
  const rejectUnauthorized = !(
    mail.reject_unauthorized === false ||
    mail.reject_unauthorized === "false" ||
    mail.rejectUnauthorized === false ||
    mail.rejectUnauthorized === "false"
  );

  return {
    host,
    port,
    secure,
    user,
    pass,
    from,
    rejectUnauthorized,
  };
}

function resolveSummaryRecipients() {
  const config = functions.config();
  const summaryRaw = toStringOrNull(config?.summary?.recipients);
  const mailRaw = toStringOrNull(config?.mail?.recipients);
  const combined = summaryRaw || mailRaw;
  if (!combined) {
    return [...SUMMARY_FALLBACK_RECIPIENTS];
  }
  return combined
    .split(/[,;]/)
    .map((item) => toStringOrNull(item))
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusLabel(status) {
  switch (status) {
    case "sent":
      return "Envoyé";
    case "partial":
      return "Partiel";
    case "failed":
      return "Échec";
    case "skipped":
      return "Aucun envoi";
    case "error":
      return "Erreur";
    default:
      return "Inconnu";
  }
}

function describeEntryNotes(entry) {
  const notes = [];
  if (entry.reason === "no_visible_items") {
    notes.push("Aucune consigne ni objectif à envoyer");
  }
  if (entry.reason === "no_tokens") {
    notes.push("Aucun token actif");
  }
  if (entry.reason === "no_messages") {
    notes.push("Aucun message généré");
  }
  if (Array.isArray(entry.invalidTokens) && entry.invalidTokens.length) {
    notes.push(`Tokens invalides: ${entry.invalidTokens.join(", ")}`);
  }
  if (entry.error) {
    notes.push(entry.error);
  }
  return notes.join(" · ");
}

function buildDailySummaryEmail(context, results) {
  const totals = {
    total: results.length,
    statuses: { sent: 0, partial: 0, failed: 0, skipped: 0, error: 0 },
    successMessages: 0,
    failedMessages: 0,
  };

  results.forEach((entry) => {
    totals.successMessages += entry.sent || 0;
    totals.failedMessages += entry.failed || 0;
    const status = entry.status || "skipped";
    if (totals.statuses[status] == null) {
      totals.statuses[status] = 0;
    }
    totals.statuses[status] += 1;
  });

  const sorted = [...results].sort((a, b) => {
    const labelA = (a.displayName || a.firstName || a.uid || "").toLowerCase();
    const labelB = (b.displayName || b.firstName || b.uid || "").toLowerCase();
    if (labelA < labelB) return -1;
    if (labelA > labelB) return 1;
    return 0;
  });

  const dateLine = `${context.dateIso} (${context.dayLabel})`;
  const subject = `Résumé notifications ${context.dateIso}`;

  const lines = [
    `Résumé notifications du ${dateLine}.`,
    "",
    `Utilisateurs traités : ${totals.total}`,
    `Envoyés : ${totals.statuses.sent || 0} | Partiels : ${totals.statuses.partial || 0} | Échecs : ${totals.statuses.failed || 0} | Sans envoi : ${totals.statuses.skipped || 0} | Erreurs : ${totals.statuses.error || 0}`,
    `Notifications réussies : ${totals.successMessages}`,
    `Notifications en échec : ${totals.failedMessages}`,
    "",
  ];

  if (sorted.length) {
    lines.push("Détails :");
    sorted.forEach((entry) => {
      const name = entry.displayName || entry.firstName || entry.uid;
      const notes = describeEntryNotes(entry);
      lines.push(
        `- ${name} (${entry.uid}) — ${statusLabel(entry.status)}. Consignes : ${entry.visibleCount}. Objectifs : ${entry.objectiveCount}. Succès : ${entry.sent}. Échecs : ${entry.failed}. Tokens : ${entry.tokens}. Lien : ${entry.link}${notes ? `. ${notes}` : ""}`
      );
    });
  } else {
    lines.push("Aucun utilisateur n’avait de notification à envoyer.");
  }

  const text = lines.join("\n");

  let html = `<div>`;
  html += `<p>Résumé notifications du <strong>${escapeHtml(context.dateIso)}</strong> (${escapeHtml(context.dayLabel)}).</p>`;
  html += `<ul>`;
  html += `<li>Utilisateurs traités : <strong>${totals.total}</strong></li>`;
  html += `<li>Statuts — Envoyé : ${totals.statuses.sent || 0}, Partiel : ${totals.statuses.partial || 0}, Échec : ${totals.statuses.failed || 0}, Sans envoi : ${totals.statuses.skipped || 0}, Erreur : ${totals.statuses.error || 0}</li>`;
  html += `<li>Notifications réussies : ${totals.successMessages}</li>`;
  html += `<li>Notifications en échec : ${totals.failedMessages}</li>`;
  html += `</ul>`;

  if (sorted.length) {
    html += `<table style="border-collapse:collapse;width:100%;font-family:'Inter',system-ui,-apple-system,sans-serif;font-size:14px;margin-top:16px;">`;
    html += `<thead><tr style="background-color:#f1f5f9;text-align:left;">`;
    html += `<th style="padding:8px;border:1px solid #e2e8f0;">Utilisateur</th>`;
    html += `<th style="padding:8px;border:1px solid #e2e8f0;">UID</th>`;
    html += `<th style="padding:8px;border:1px solid #e2e8f0;">Statut</th>`;
    html += `<th style="padding:8px;border:1px solid #e2e8f0;text-align:right;">Succès</th>`;
    html += `<th style="padding:8px;border:1px solid #e2e8f0;text-align:right;">Échecs</th>`;
    html += `<th style="padding:8px;border:1px solid #e2e8f0;text-align:right;">Consignes</th>`;
    html += `<th style="padding:8px;border:1px solid #e2e8f0;text-align:right;">Objectifs</th>`;
    html += `<th style="padding:8px;border:1px solid #e2e8f0;text-align:right;">Tokens</th>`;
    html += `<th style="padding:8px;border:1px solid #e2e8f0;">Notes</th>`;
    html += `<th style="padding:8px;border:1px solid #e2e8f0;">Lien</th>`;
    html += `</tr></thead><tbody>`;
    sorted.forEach((entry) => {
      const name = entry.displayName || entry.firstName || entry.uid;
      const notes = describeEntryNotes(entry);
      const link = escapeHtml(entry.link);
      html += `<tr>`;
      html += `<td style="padding:8px;border:1px solid #e2e8f0;">${escapeHtml(name)}</td>`;
      html += `<td style="padding:8px;border:1px solid #e2e8f0;font-family:monospace;">${escapeHtml(entry.uid)}</td>`;
      html += `<td style="padding:8px;border:1px solid #e2e8f0;">${escapeHtml(statusLabel(entry.status))}</td>`;
      html += `<td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${entry.sent}</td>`;
      html += `<td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${entry.failed}</td>`;
      html += `<td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${entry.visibleCount}</td>`;
      html += `<td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${entry.objectiveCount}</td>`;
      html += `<td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${entry.tokens}</td>`;
      html += `<td style="padding:8px;border:1px solid #e2e8f0;">${escapeHtml(notes)}</td>`;
      html += `<td style="padding:8px;border:1px solid #e2e8f0;"><a href="${link}">Ouvrir</a></td>`;
      html += `</tr>`;
    });
    html += `</tbody></table>`;
  } else {
    html += `<p>Aucun utilisateur n’avait de notification à envoyer.</p>`;
  }

  html += `<p style="margin-top:16px;font-size:12px;color:#64748b;">Email automatique généré par sendDailyReminders.</p>`;
  html += `</div>`;

  return { subject, text, html };
}

function dotStuff(content) {
  let output = content.replace(/\r?\n/g, "\r\n");
  if (output.startsWith(".")) {
    output = `.${output}`;
  }
  return output.replace(/\r\n\./g, "\r\n..");
}

function buildMimeMessage({ from, to, subject, text, html }) {
  const recipients = Array.isArray(to) ? to : [to];
  const boundary = `=_daily_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const headers = [
    `From: ${from}`,
    `To: ${recipients.join(", ")}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    `Date: ${new Date().toUTCString()}`,
  ];

  const parts = [];
  parts.push(
    `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${text || ""}\r\n`
  );
  parts.push(
    `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${html || ""}\r\n`
  );
  parts.push(`--${boundary}--\r\n`);

  return `${headers.join("\r\n")}\r\n\r\n${parts.join("")}`;
}

function waitForSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";

    const cleanup = () => {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onData = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (!lines.length) return;
      const last = lines[lines.length - 1];
      const match = last.match(/^(\d{3})([ -])/);
      if (!match) return;
      if (match[2] === "-") return;
      const code = Number(match[1]);
      cleanup();
      resolve({ code, lines });
    };

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function sendSmtpCommand(socket, command, { allow = [] } = {}) {
  socket.write(`${command}\r\n`);
  const response = await waitForSmtpResponse(socket);
  const isOk = response.code < 400 && (allow.length === 0 || allow.includes(response.code));
  if (!isOk) {
    throw new Error(`SMTP command failed (${command} => ${response.code})`);
  }
  return response;
}

async function sendSmtpEmail({ host, port, secure, user, pass, from, to, subject, text, html, rejectUnauthorized }) {
  const recipients = Array.isArray(to) ? to : [to];
  if (!recipients.length) {
    throw new Error("No recipients provided for summary email");
  }

  if ((user && !pass) || (!user && pass)) {
    functions.logger.warn("smtp:auth:incomplete", { hasUser: !!user, hasPass: !!pass });
  }

  const socket = await new Promise((resolve, reject) => {
    const connection = tls.connect({ host, port, rejectUnauthorized }, () => {
      connection.setEncoding("utf8");
      connection.removeListener("error", onError);
      resolve(connection);
    });
    const onError = (error) => {
      connection.removeListener("error", onError);
      reject(error);
    };
    connection.once("error", onError);
  });

  if (!secure) {
    functions.logger.warn("smtp:insecure", { host, port });
  }

  try {
    await waitForSmtpResponse(socket);
    await sendSmtpCommand(socket, `EHLO ${host}`);

    if (user && pass) {
      await sendSmtpCommand(socket, "AUTH LOGIN", { allow: [334] });
      await sendSmtpCommand(socket, Buffer.from(user).toString("base64"), { allow: [334] });
      await sendSmtpCommand(socket, Buffer.from(pass).toString("base64"), { allow: [235] });
    }

    await sendSmtpCommand(socket, `MAIL FROM:<${from}>`);
    for (const recipient of recipients) {
      await sendSmtpCommand(socket, `RCPT TO:<${recipient}>`, { allow: [250, 251] });
    }

    await sendSmtpCommand(socket, "DATA", { allow: [354] });
    const message = buildMimeMessage({ from, to: recipients, subject, text, html });
    socket.write(`${dotStuff(message)}\r\n.\r\n`);
    const finalResponse = await waitForSmtpResponse(socket);
    if (finalResponse.code >= 400) {
      throw new Error(`SMTP delivery failed (${finalResponse.code})`);
    }
    await sendSmtpCommand(socket, "QUIT", { allow: [221] });
  } finally {
    try {
      socket.end();
    } catch (error) {
      functions.logger.debug("smtp:socket:end:error", { message: error?.message });
    }
  }
}

async function sendDailySummaryEmail(context, results) {
  const settings = resolveMailSettings();
  if (!settings) {
    functions.logger.warn("mail:config:missing");
    return;
  }

  const recipients = resolveSummaryRecipients();
  if (!recipients.length) {
    functions.logger.warn("mail:recipients:missing");
    return;
  }

  const { subject, text, html } = buildDailySummaryEmail(context, results);
  await sendSmtpEmail({
    ...settings,
    to: recipients,
    subject,
    text,
    html,
  });
  functions.logger.info("mail:summary:sent", { recipients, subject });
}

function buildUserDailyLink(uid, dateIso) {
  return `${DAILY_BASE}#/daily?u=${encodeURIComponent(uid)}&d=${dateIso}`;
}

