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

  try {
    const adminDoc = await db.collection("adminPushTokens").doc(token).get();
    if (adminDoc.exists) {
      tasks.push(disableAdminToken(token));
    }
  } catch (error) {
    functions.logger.error("disableTokenByLookup:admin", { token, error: error?.message });
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

function pluralize(count, singular, plural = null) {
  if (count === 1) return singular;
  return plural || `${singular}s`;
}

function extractFirstName(profile = {}) {
  const raw = String(profile.displayName || profile.name || "").trim();
  if (!raw) return "";
  const parts = raw.split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return parts[0];
}

function buildReminderBody(firstName, consigneCount, objectiveCount) {
  const prefix = firstName ? `${firstName}, ` : "";
  const items = [];
  if (consigneCount > 0) {
    items.push(`${consigneCount} ${pluralize(consigneCount, "consigne")} à tracker`);
  }
  if (objectiveCount > 0) {
    items.push(`${objectiveCount} ${pluralize(objectiveCount, "objectif")} à compléter`);
  }
  if (!items.length) {
    return `${prefix}tu n’as rien à tracker aujourd’hui.`;
  }
  if (items.length === 1) {
    return `${prefix}tu as ${items[0]} aujourd’hui.`;
  }
  if (items.length === 2) {
    return `${prefix}tu as ${items[0]} et ${items[1]} aujourd’hui.`;
  }
  const last = items.pop();
  return `${prefix}tu as ${items.join(", ")} et ${last} aujourd’hui.`;
}

function buildAdminReminderBody(name, consigneCount, objectiveCount) {
  const label = name || "Cet utilisateur";
  const items = [];
  if (consigneCount > 0) {
    items.push(`${consigneCount} ${pluralize(consigneCount, "consigne")} à tracker`);
  }
  if (objectiveCount > 0) {
    items.push(`${objectiveCount} ${pluralize(objectiveCount, "objectif")} à compléter`);
  }
  if (!items.length) {
    return `${label} n’a rien à tracker aujourd’hui.`;
  }
  if (items.length === 1) {
    return `${label} a ${items[0]} aujourd’hui.`;
  }
  if (items.length === 2) {
    return `${label} a ${items[0]} et ${items[1]} aujourd’hui.`;
  }
  const last = items.pop();
  return `${label} a ${items.join(", ")} et ${last} aujourd’hui.`;
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

async function collectAdminPushTokens() {
  const snap = await db.collection("adminPushTokens").get();
  const tokens = [];

  snap.forEach((doc) => {
    const data = doc.data() || {};
    if (data.enabled === false) return;
    const token = data.token || doc.id;
    if (!token) return;
    if (!tokens.includes(token)) tokens.push(token);
  });

  return tokens;
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

async function disableAdminToken(token) {
  try {
    await db
      .collection("adminPushTokens")
      .doc(token)
      .set(
        {
          enabled: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  } catch (error) {
    functions.logger.error("disableAdminToken:error", { token, error });
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

async function sendAdminReminder(targetUid, tokens, visibleCount, objectiveCount, context, displayName = "", firstName = "") {
  const nameLabel = displayName || firstName || `Utilisateur ${targetUid}`;
  const title = `Admin — ${nameLabel}`;
  const body = buildAdminReminderBody(nameLabel, visibleCount, objectiveCount);
  const link = buildUserDailyLink(targetUid, context.dateIso);

  const message = {
    data: {
      link,
      targetUid,
      role: "admin",
      consignes: String(visibleCount),
      objectifs: String(objectiveCount),
      body,
      title,
      displayName: displayName || "",
      firstName: firstName || "",
      day: context.dayLabel,
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
    failureEvent: "sendAdminReminder:failure",
    metadata: { targetUid },
    onInvalidToken: (token) => disableAdminToken(token),
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
      const adminTokens = await collectAdminPushTokens();
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

          const response = await sendReminder(
            uid,
            tokens,
            visibleCount,
            objectiveCount,
            context,
            firstName
          );
          let adminResponse = null;
          if (adminTokens.length) {
            adminResponse = await sendAdminReminder(
              uid,
              adminTokens,
              visibleCount,
              objectiveCount,
              context,
              displayName,
              firstName
            );
          }
          results.push({
            uid,
            tokens: tokens.length,
            visibleCount,
            objectiveCount,
            sent: response.successCount,
            failed: response.failureCount,
            firstName,
            adminSent: adminResponse ? adminResponse.successCount : 0,
            adminFailed: adminResponse ? adminResponse.failureCount : 0,
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

