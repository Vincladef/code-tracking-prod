/* global Schema */
window.Schema = window.Schema || {};

const firebaseCompat = window.firebase || {};
const firestoreCompat = firebaseCompat.firestore;

function missingFirestoreWarning() {
  console.warn("Firebase Firestore non disponible. Assure-toi de charger firebase-firestore-compat.js avant schema.js.");
}

function collectionFromCompat(db, ...segments) {
  if (!db || typeof db.collection !== "function") {
    throw new Error("Firestore n'est pas initialisé.");
  }
  if (!segments.length) {
    throw new Error("Chemin de collection manquant.");
  }
  const path = segments.join("/");
  return db.collection(path);
}

function docFromCompat(base, ...segments) {
  if (base && typeof base.doc === "function" && !segments.length) {
    return base.doc();
  }
  if (base && typeof base.doc === "function" && segments.length === 1) {
    return base.doc(segments[0]);
  }
  if (!base || typeof base.doc !== "function") {
    throw new Error("Firestore n'est pas initialisé.");
  }
  if (!segments.length) {
    throw new Error("Chemin de document manquant.");
  }
  const path = segments.join("/");
  return base.doc(path);
}

window.firestoreAPI = window.firestoreAPI || (firestoreCompat
  ? {
      getFirestore: (app) => firebaseCompat.firestore(app),
      collection: collectionFromCompat,
      doc: docFromCompat,
      setDoc: (ref, data, options) => ref.set(data, options),
      getDoc: (ref) => ref.get(),
      getDocs: (qry) => qry.get(),
      addDoc: (ref, data) => ref.add(data),
      deleteDoc: (ref) => ref.delete(),
      query: (base, ...constraints) =>
        constraints.reduce((ref, fn) => (typeof fn === "function" ? fn(ref) : ref), base),
      where: (field, op, value) => (ref) => ref.where(field, op, value),
      orderBy: (field, direction) => (ref) => ref.orderBy(field, direction),
      updateDoc: (ref, data) => ref.update(data),
      limit: (count) => (ref) => ref.limit(count),
      serverTimestamp: () => firebaseCompat.firestore.FieldValue.serverTimestamp(),
    }
  : {
      getFirestore: () => missingFirestoreWarning(),
      collection: () => missingFirestoreWarning(),
      doc: () => missingFirestoreWarning(),
      setDoc: () => missingFirestoreWarning(),
      getDoc: () => missingFirestoreWarning(),
      getDocs: () => missingFirestoreWarning(),
      addDoc: () => missingFirestoreWarning(),
      deleteDoc: () => missingFirestoreWarning(),
      query: () => missingFirestoreWarning(),
      where: () => missingFirestoreWarning(),
      orderBy: () => missingFirestoreWarning(),
      updateDoc: () => missingFirestoreWarning(),
      limit: () => missingFirestoreWarning(),
      serverTimestamp: () => missingFirestoreWarning(),
    });

Schema.firestore = Schema.firestore || window.firestoreAPI;

const {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  updateDoc,
  limit,
  serverTimestamp,
} = Schema.firestore;

const snapshotExists =
  Schema.snapshotExists ||
  ((snap) => {
    if (!snap) return false;
    const { exists } = snap;
    if (typeof exists === "function") {
      try {
        return !!exists.call(snap);
      } catch (error) {
        console.warn("snapshotExists:call:error", error);
      }
    }
    if (exists !== undefined) {
      return !!exists;
    }
    if ("exists" in snap) {
      return !!snap.exists;
    }
    return false;
  });
Schema.snapshotExists = Schema.snapshotExists || snapshotExists;

// --- DEBUG LOGGER ---
const D = {
  on: true, // << mets false pour couper
  info: (...a) => D.on && console.info("[HP]", ...a),
  debug: (...a) => D.on && console.debug("[HP]", ...a),
  warn: (...a) => D.on && console.warn("[HP]", ...a),
  error: (...a) => D.on && console.error("[HP]", ...a),
  group: (label, ...a) => D.on && console.groupCollapsed(`📘 ${label}`, ...a),
  groupEnd: () => D.on && console.groupEnd(),
};
Schema.D = Schema.D || D;
const schemaLog = () => {};
// --- Helpers de chemin /u/{uid}/...

let boundDb = null;

function bindDb(db) {
  boundDb = db;
  D.info("bindDb", { hasDb: !!db });
}
Schema.bindDb = Schema.bindDb || bindDb;

let _adminCache = null;

async function isAdmin(db, uid) {
  if (!uid) return false;
  const targetDb = db || boundDb;
  if (!targetDb) return false;
  if (_adminCache?.uid === uid) return _adminCache.value;
  try {
    const snap = await getDoc(doc(targetDb, "admins", uid));
    const val = snapshotExists(snap);
    _adminCache = { uid, value: val };
    return val;
  } catch (e) {
    console.warn("isAdmin() failed", e);
    return false;
  }
}

const now = () => new Date().toISOString();
const col = (db, uid, sub) => collection(db, "u", uid, sub);
const docIn = (db, uid, sub, id) => doc(db, "u", uid, sub, id);

function buildUserDailyLink(uid, dateIso) {
  const base = "https://vincladef.github.io/code-tracking-prod/";
  return `${base}#/daily?u=${encodeURIComponent(uid)}&d=${dateIso}`;
}

// Timestamp lisible (les graphs lisent une chaîne)
function dayKeyFromDate(dateInput = new Date()) {
  const d = dateInput instanceof Date ? new Date(dateInput.getTime()) : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const todayKey = (d = new Date()) => dayKeyFromDate(d); // YYYY-MM-DD

const PRIORITIES = ["high","medium","low"];
const MODES = ["daily","practice"];
const TYPES = ["short","long","likert6","likert5","yesno","num"];

const LIKERT = ["no_answer","no","rather_no","medium","rather_yes","yes"];
const LIKERT_POINTS = {
  no_answer: 0,
  no: 0,
  rather_no: 0,
  medium: 0,
  rather_yes: 0.5,
  yes: 1
};

const PRIORITY_ALIAS = { high: 1, medium: 2, low: 3 };

Schema.DAY_ALIAS = Schema.DAY_ALIAS || {
  mon: "LUN",
  tue: "MAR",
  wed: "MER",
  thu: "JEU",
  fri: "VEN",
  sat: "SAM",
  sun: "DIM",
};
Schema.DAY_VALUES = Schema.DAY_VALUES || new Set(["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"]);

const SCHEMA_DAY_ALIAS = Schema.DAY_ALIAS;
const SCHEMA_DAY_VALUES = Schema.DAY_VALUES;

function normalizePriority(value) {
  if (typeof value === "number" && value >= 1 && value <= 3) return value;
  if (typeof value === "string") {
    const key = value.toLowerCase();
    const alias = PRIORITY_ALIAS[key];
    if (alias) return alias;
    const num = Number(value);
    if (num >= 1 && num <= 3) return num;
  }
  return 2;
}

function normalizeDays(days) {
  if (!Array.isArray(days)) return [];
  return days
    .map((d) => {
      if (!d) return null;
      const lower = String(d).toLowerCase();
      if (SCHEMA_DAY_ALIAS[lower]) return SCHEMA_DAY_ALIAS[lower];
      const upper = lower.toUpperCase();
      if (SCHEMA_DAY_VALUES.has(upper)) return upper;
      return null;
    })
    .filter(Boolean);
}

const DOW_LABELS = ["DIM","LUN","MAR","MER","JEU","VEN","SAM"];

function nextVisibleDateFrom(start, days, skips){
  const normalized = normalizeDays(days);
  const everyDay = !normalized.length;
  const from = new Date(start); from.setHours(0,0,0,0);
  let d = new Date(from);

  let passed = 0;
  while (true){
    d.setDate(d.getDate() + 1);
    const label = DOW_LABELS[d.getDay()];
    const eligible = everyDay || normalized.includes(label);
    if (eligible){
      if (passed >= skips) break;
      passed++;
    }
  }
  return d.toISOString();
}

function hydrateConsigne(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    priority: normalizePriority(data.priority),
    days: normalizeDays(data.days),
    srEnabled: data.srEnabled !== false,
  };
}

// --- Catégories & Users ---
async function getUserName(uid) {
  D.info("getUserName:start", { uid });
  if (!uid) return "Utilisateur";
  if (!boundDb) {
    console.warn("getUserName error:", new Error("Firestore not initialized"));
    D.warn("getUserName:missingDb", { uid });
    return "Utilisateur";
  }
  try {
    const snap = await getDoc(doc(boundDb, "u", uid));
    const d = snapshotExists(snap) ? (snap.data() || {}) : {};
    const resolved = d.name || d.displayName || d.slug || "Utilisateur";
    D.info("getUserName:result", { uid, resolved });
    return resolved;
  } catch (e) {
    console.warn("getUserName error:", e);
    D.warn("getUserName:error", { uid, message: e?.message || String(e) });
    return "Utilisateur";
  }
}

async function fetchCategories(db, uid){
  const qy = query(col(db, uid, "categories"), orderBy("name"));
  const ss = await getDocs(qy);
  return ss.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function ensureCategory(db, uid, name, mode){
  D.info("data.ensureCategory", { uid, name, mode });
  const qy = query(col(db, uid, "categories"),
    where("name","==",name), where("mode","==",mode), limit(1));
  const snap = await getDocs(qy);
  if (!snap.empty) {
    const existing = { id: snap.docs[0].id, ...snap.docs[0].data() };
    D.info("data.ensureCategory.ok", existing);
    return existing;
  }
  const ref = await addDoc(col(db, uid, "categories"), {
    ownerUid: uid,
    name,
    mode,
    createdAt: serverTimestamp()
  });
  const created = { id: ref.id, ownerUid: uid, name, mode };
  D.info("data.ensureCategory.ok", created);
  return created;
}

// Fonction pour l'admin, utilise la collection racine "users"
function newUid() {
  return Math.random().toString(36).substring(2, 10);
}

// Etat SR stocké dans /u/{uid}/sr/{consigneId}  (ou goalId)
async function readSRState(db, uid, itemId, key = "default") {
  const snap = await getDoc(docIn(db, uid, "sr", `${key}:${itemId}`));
  return snapshotExists(snap) ? snap.data() : null;
}
async function upsertSRState(db, uid, itemId, key, state) {
  await setDoc(docIn(db, uid, "sr", `${key}:${itemId}`), state, { merge: true });
}

// --- Push tokens (stockés sous /u/{uid}/pushTokens/{token}) ---
async function savePushToken(db, uid, token, extra = {}) {
  await setDoc(docIn(db, uid, "pushTokens", token), {
    token,
    enabled: true,
    ua: navigator.userAgent || "",
    platform: navigator.platform || "",
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    ...extra
  }, { merge: true });
}

async function disablePushToken(db, uid, token) {
  await setDoc(docIn(db, uid, "pushTokens", token), {
    enabled: false,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// score pour likert -> 0 / 0.5 / 1
function likertScore(v) {
  return ({ yes: 1, rather_yes: 0.5, medium: 0, rather_no: 0, no: 0, no_answer: 0 })[v] ?? 0;
}

// calcule la prochaine “masque” (journalier=jours, pratique=sessions)
function nextCooldownAfterAnswer(meta, prevState, value) {
  // strict : yes=1 ; rather_yes=0.5 ; neutre/plutôt_non/non/no_answer = 0 (reset)
  let inc = 0;
  if (meta.type === "likert6") inc = likertScore(value);
  else if (meta.type === "likert5") inc = Number(value) >= 3 ? 1 : (Number(value) === 2 ? 0.5 : 0);
  else if (meta.type === "yesno") inc = (value === "yes") ? 1 : 0;
  else if (meta.type === "num") inc = Number(value) >= 7 ? 1 : (Number(value) >= 5 ? 0.5 : 0);
  else inc = 1;

  // streak strict
  let streak = (prevState?.streak || 0);
  streak = inc > 0 ? (streak + inc) : 0;

  if (meta.mode === "daily") {
    const steps = Math.floor(streak); // nb d'occurrences à SAUTER
    const nextVisibleOn = nextVisibleDateFrom(new Date(), meta.days || [], steps);
    return { streak, nextVisibleOn };
  } else {
    const steps = Math.floor(streak); // nb d'itérations à SAUTER
    const base  = (meta.sessionIndex ?? 0) + 1; // prochaine itération immédiate
    const nextAllowedIndex = base + steps;      // base + nb à sauter
    return { streak, nextAllowedIndex };
  }
}

async function resetSRForConsigne(db, uid, consigneId) {
  const today = new Date().toISOString();
  await upsertSRState(db, uid, consigneId, "consigne", {
    streak: 0,
    nextAllowedIndex: 0,
    nextVisibleOn: today
  });
}

// answers: [{ consigne, value, sessionId?, sessionIndex?, sessionNumber? }]
async function saveResponses(db, uid, mode, answers) {
  const batch = [];
  for (const a of answers) {
    const payload = {
      ownerUid: uid,
      mode,
      consigneId: a.consigne.id,
      value: a.value,
      type: a.consigne.type,
      createdAt: now(),
      sessionId: a.sessionId || null,
      category: a.consigne.category || "Général",
    };
    if (mode === "practice") {
      if (a.sessionIndex !== undefined && a.sessionIndex !== null && a.sessionIndex !== "") {
        const parsedIndex = Number(a.sessionIndex);
        if (Number.isFinite(parsedIndex)) {
          payload.sessionIndex = parsedIndex;
        }
      }
      if (a.sessionNumber !== undefined && a.sessionNumber !== null && a.sessionNumber !== "") {
        const parsedNumber = Number(a.sessionNumber);
        if (Number.isFinite(parsedNumber)) {
          payload.sessionNumber = parsedNumber;
        }
      }
      if (!payload.sessionId && a.sessionIndex !== undefined && a.sessionIndex !== null) {
        const fallbackIndex = Number(a.sessionIndex);
        if (Number.isFinite(fallbackIndex)) {
          payload.sessionId = `session-${String(fallbackIndex + 1).padStart(4, "0")}`;
        }
      }
    }
    if (a.dayKey || mode === "daily") {
      payload.dayKey = a.dayKey || todayKey();
    }
    // SR (seulement si activée sur la consigne)
    if (a.consigne?.srEnabled !== false) {
      const prev = await readSRState(db, uid, a.consigne.id, "consigne");
      const upd = nextCooldownAfterAnswer(
        { mode, type: a.consigne.type, days: a.consigne.days || [], sessionIndex: a.sessionIndex },
        prev,
        a.value
      );
      await upsertSRState(db, uid, a.consigne.id, "consigne", upd);
    }

    // write
    batch.push(addDoc(col(db, uid, "responses"), payload));
  }
  await Promise.all(batch);
}

async function countPracticeSessions(db, uid){
  const ss = await getDocs(col(db, uid, "sessions"));
  return ss.size;
}

async function fetchPracticeSessions(db, uid, limitCount = 500) {
  if (!db || !uid) return [];
  try {
    const constraints = [col(db, uid, "sessions"), orderBy("startedAt", "asc")];
    if (Number.isFinite(limitCount) && limitCount > 0) {
      constraints.push(limit(limitCount));
    }
    const qy = query(...constraints);
    const snap = await getDocs(qy);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.warn("fetchPracticeSessions:fallback", error);
    const snap = await getDocs(col(db, uid, "sessions"));
    const sessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    sessions.sort((a, b) => {
      const aDate = a.startedAt?.toDate?.() ?? a.startedAt ?? a.createdAt ?? null;
      const bDate = b.startedAt?.toDate?.() ?? b.startedAt ?? b.createdAt ?? null;
      const aTime = aDate instanceof Date ? aDate.getTime() : new Date(aDate || 0).getTime();
      const bTime = bDate instanceof Date ? bDate.getTime() : new Date(bDate || 0).getTime();
      return aTime - bTime;
    });
    if (Number.isFinite(limitCount) && limitCount > 0) {
      return sessions.slice(0, limitCount);
    }
    return sessions;
  }
}

async function startNewPracticeSession(db, uid, extra = {}) {
  const payload = {
    ownerUid: uid,
    startedAt: serverTimestamp(),
    ...extra,
  };
  if (!payload.startedAt) {
    payload.startedAt = serverTimestamp();
  }
  await addDoc(col(db, uid, "sessions"), payload);
}

// list consignes par mode
async function listConsignesByMode(db, uid, mode) {
  const qy = query(col(db, uid, "consignes"), where("mode", "==", mode), where("active", "==", true));
  const ss = await getDocs(qy);
  return ss.docs.map((d) => hydrateConsigne(d));
}

// --- Nouvelles collections /u/{uid}/... ---
async function fetchConsignes(db, uid, mode) {
  const qy = query(
    col(db, uid, "consignes"),
    where("mode", "==", mode),
    where("active", "==", true),
    orderBy("priority")
  );
  const ss = await getDocs(qy);
  return ss.docs.map((d) => hydrateConsigne(d));
}

async function addConsigne(db, uid, payload) {
  const ref = await addDoc(col(db, uid, "consignes"), {
    ...payload,
    srEnabled: payload.srEnabled !== false,
    priority: normalizePriority(payload.priority),
    days: normalizeDays(payload.days),
    createdAt: serverTimestamp()
  });
  return ref;
}

async function updateConsigne(db, uid, id, payload) {
  const ref = docIn(db, uid, "consignes", id);
  await updateDoc(ref, {
    ...payload,
    srEnabled: payload.srEnabled !== false,
    priority: normalizePriority(payload.priority),
    days: normalizeDays(payload.days),
    updatedAt: serverTimestamp()
  });
}

async function updateConsigneOrder(db, uid, consigneId, order) {
  await setDoc(doc(db, "u", uid, "consignes", consigneId), { order }, { merge: true });
}

async function softDeleteConsigne(db, uid, id) {
  const ref = docIn(db, uid, "consignes", id);
  await updateDoc(ref, {
    active: false,
    updatedAt: serverTimestamp()
  });
}

async function saveResponse(db, uid, consigne, value) {
  schemaLog("saveResponse:start", { uid, consigneId: consigne.id, mode: consigne.mode, value });
  const payload = {
    ownerUid: uid,
    consigneId: consigne.id,
    mode: consigne.mode,
    value,
    createdAt: now(),
  };
  if (consigne.mode === "daily") {
    payload.dayKey = todayKey();
  }
  const ref = await addDoc(col(db, uid, "responses"), payload);
  schemaLog("saveResponse:done", { uid, responseId: ref.id, consigneId: consigne.id });
}

async function fetchDailyResponses(db, uid, dayKey) {
  if (!dayKey) return new Map();
  const responses = new Map();
  const qy = query(
    col(db, uid, "responses"),
    where("mode", "==", "daily"),
    where("dayKey", "==", dayKey)
  );
  const snap = await getDocs(qy);
  snap.docs.forEach((docSnap) => {
    const data = docSnap.data();
    if (!data?.consigneId) return;
    const prev = responses.get(data.consigneId);
    const prevAt = prev?.createdAt || "";
    const currentAt = data?.createdAt || "";
    if (!prev || prevAt < currentAt) {
      responses.set(data.consigneId, { id: docSnap.id, ...data });
    }
  });
  return responses;
}

async function fetchHistory(db, uid, count = 200) {
  schemaLog("fetchHistory:start", { uid, count });
  const qy = query(
    col(db, uid, "responses"),
    orderBy("createdAt", "desc"),
    limit(count)
  );
  const ss = await getDocs(qy);
  const data = ss.docs.map(d => d.data());
  schemaLog("fetchHistory:done", { uid, count: data.length });
  return data;
}

async function fetchResponsesForConsigne(db, uid, consigneId, limitCount = 200) {
  const qy = query(
    col(db, uid, "responses"),
    where("consigneId","==", consigneId),
    orderBy("createdAt","desc"),
    limit(limitCount)
  );
  const ss = await getDocs(qy);
  return ss.docs.map(d => ({ id:d.id, ...d.data() }));
}

function valueToNumericPoint(type, value) {
  if (type === "likert6") return LIKERT_POINTS[value] ?? 0;
  if (type === "likert5") return Number(value) || 0;  // 0..4
  if (type === "yesno")   return value === "yes" ? 1 : 0;
  if (type === "num") return Number(value) || 0;
  return null; // pour short/long -> pas de graph
}

async function listConsignesByCategory(db, uid, category) {
  const qy = query(
    collection(db, "u", uid, "consignes"),
    where("category", "==", category)
  );
  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadConsigneHistory(db, uid, consigneId) {
  const colRef = collection(db, "u", uid, "history", consigneId, "entries");
  const snap = await getDocs(colRef);
  return snap.docs.map((d) => ({ date: d.id, ...d.data() }));
}

async function saveHistoryEntry(db, uid, consigneId, dateIso, data = {}) {
  if (!db || !uid || !consigneId || !dateIso) {
    throw new Error("Paramètres manquants pour saveHistoryEntry");
  }
  const payload = { ...data, updatedAt: now() };
  await setDoc(doc(db, "u", uid, "history", consigneId, "entries", dateIso), payload, {
    merge: true,
  });
}

async function deleteHistoryEntry(db, uid, consigneId, dateIso) {
  if (!db || !uid || !consigneId || !dateIso) {
    throw new Error("Paramètres manquants pour deleteHistoryEntry");
  }
  await deleteDoc(doc(db, "u", uid, "history", consigneId, "entries", dateIso));
}

// --- utilitaires temps ---
function monthKeyFromDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
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
  const [yearStr, monthStr] = String(monthKey || "").split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return [];
  }
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
    rawSegments.push({
      index,
      start,
      end,
      startDay,
      endDay,
    });
  }
  const monthIndex = month - 1;
  const filtered = rawSegments.filter((segment) => weekSegmentDaysInMonth(segment, year, monthIndex) >= 4);
  if (!filtered.length) {
    return rawSegments;
  }
  return filtered.map((segment, idx) => ({
    ...segment,
    index: idx + 1,
  }));
}

function weeksOf(monthKey) {
  const segments = monthWeekSegments(monthKey);
  if (!segments.length) {
    return [1, 2, 3, 4];
  }
  return segments.map((segment) => segment.index);
}

function weekPlacementFromDate(dateInput) {
  const dt = dateInput instanceof Date ? new Date(dateInput.getTime()) : new Date(dateInput);
  if (Number.isNaN(dt.getTime())) {
    const fallbackKey = monthKeyFromDate(new Date());
    return { monthKey: fallbackKey, weekIndex: 1 };
  }
  dt.setHours(0, 0, 0, 0);
  const currentMonthKey = monthKeyFromDate(dt);
  const weekStart = new Date(dt.getTime());
  const offset = mondayIndexFromSundayIndex(dt.getDay());
  weekStart.setDate(weekStart.getDate() - offset);
  weekStart.setHours(0, 0, 0, 0);

  const counts = new Map();
  const cursor = new Date(weekStart.getTime());
  for (let step = 0; step < 7; step += 1) {
    const key = monthKeyFromDate(cursor);
    counts.set(key, (counts.get(key) || 0) + 1);
    cursor.setDate(cursor.getDate() + 1);
  }

  let targetMonthKey = currentMonthKey;
  let maxCount = -1;
  counts.forEach((value, key) => {
    if (value > maxCount || (value === maxCount && key === currentMonthKey)) {
      maxCount = value;
      targetMonthKey = key;
    }
  });

  const segments = monthWeekSegments(targetMonthKey);
  const weekStartTime = weekStart.getTime();
  const match = segments.find((segment) => {
    const startTime = segment.start.getTime();
    const endTime = segment.end.getTime();
    return weekStartTime >= startTime && weekStartTime <= endTime;
  });
  if (match) {
    return { monthKey: targetMonthKey, weekIndex: match.index };
  }
  const fallback = segments.find((segment) => {
    const startTime = segment.start.getTime();
    const endTime = segment.end.getTime();
    const point = dt.getTime();
    return point >= startTime && point <= endTime;
  });
  if (fallback) {
    return { monthKey: targetMonthKey, weekIndex: fallback.index };
  }
  if (segments.length) {
    return { monthKey: targetMonthKey, weekIndex: segments[segments.length - 1].index };
  }
  return { monthKey: targetMonthKey, weekIndex: 1 };
}

function weekIndexForDateInMonth(dateInput, monthKey) {
  const dt = dateInput instanceof Date ? new Date(dateInput.getTime()) : new Date(dateInput);
  if (Number.isNaN(dt.getTime())) {
    return 1;
  }
  const segments = monthWeekSegments(monthKey);
  if (!segments.length) {
    return 1;
  }
  const point = dt.getTime();
  const match = segments.find((segment) => {
    const startTime = segment.start.getTime();
    const endTime = segment.end.getTime();
    return point >= startTime && point <= endTime;
  });
  if (match) {
    return match.index;
  }
  if (point < segments[0].start.getTime()) {
    return segments[0].index;
  }
  return segments[segments.length - 1].index;
}

function weekOfMonthFromDate(d) {
  const placement = weekPlacementFromDate(d);
  return placement?.weekIndex || 1;
}

function weekDateRange(monthKey, weekIndex) {
  if (!weekIndex) return null;
  const segments = monthWeekSegments(monthKey);
  if (!segments.length) return null;
  const target = segments.find((segment) => segment.index === Number(weekIndex));
  if (!target) return null;
  const { start, end } = target;
  const startDayLabel = String(start.getDate()).padStart(2, "0");
  const endDayLabel = String(end.getDate()).padStart(2, "0");
  const startMonthName = start.toLocaleDateString("fr-FR", { month: "long" });
  const endMonthName = end.toLocaleDateString("fr-FR", { month: "long" });
  let label;
  if (startMonthName === endMonthName) {
    label = `Semaine du ${startDayLabel} au ${endDayLabel} ${endMonthName}`;
  } else {
    label = `Semaine du ${startDayLabel} ${startMonthName} au ${endDayLabel} ${endMonthName}`;
  }
  return { start, end, label };
}

// --- Objectifs CRUD ---
async function listObjectivesByMonth(db, uid, monthKey) {
  const q = query(collection(db, "u", uid, "objectifs"), where("monthKey", "==", monthKey));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getObjective(db, uid, objectifId) {
  const ref = doc(db, "u", uid, "objectifs", objectifId);
  const snap = await getDoc(ref);
  return snapshotExists(snap) ? { id: snap.id, ...snap.data() } : null;
}

async function upsertObjective(db, uid, data, objectifId = null) {
  const rawStart = data?.startDate ? new Date(data.startDate) : new Date();
  const placement = weekPlacementFromDate(rawStart);
  const derivedMonthKey = placement?.monthKey || monthKeyFromDate(rawStart);
  const monthKey = data?.monthKey || derivedMonthKey;
  const type = data?.type || "hebdo";
  const week = type === "hebdo"
    ? Number(
        data?.weekOfMonth
          || (placement?.monthKey === monthKey
            ? placement.weekIndex
            : weekIndexForDateInMonth(rawStart, monthKey))
          || 1,
      )
    : null;

  const ref = objectifId
    ? doc(db, "u", uid, "objectifs", objectifId)
    : doc(collection(db, "u", uid, "objectifs"));

  const payload = {
    titre: data?.titre || "Objectif",
    type,
    monthKey,
    weekOfMonth: type === "hebdo" ? week : null,
  };

  if (!objectifId) {
    payload.createdAt = serverTimestamp();
  }

  if (data?.description !== undefined) payload.description = data.description;
  if (data?.status !== undefined) payload.status = data.status;
  if (data?.startDate !== undefined) payload.startDate = data.startDate;
  if (data?.endDate !== undefined) payload.endDate = data.endDate;
  if (data?.notifyOnTarget !== undefined) {
    payload.notifyOnTarget = data.notifyOnTarget !== false;
  }
  if (data?.notifyAt !== undefined) {
    payload.notifyAt = data.notifyAt || null;
  }

  await setDoc(ref, payload, { merge: true });
  return ref.id;
}

async function deleteObjective(db, uid, objectifId) {
  if (!objectifId) return;
  const objectiveRef = doc(db, "u", uid, "objectifs", objectifId);
  const entriesRef = collection(db, "u", uid, "objectiveEntries", objectifId, "entries");
  const entriesSnap = await getDocs(entriesRef);
  await Promise.all(entriesSnap.docs.map((entryDoc) => deleteDoc(entryDoc.ref)));
  const entryContainerRef = doc(db, "u", uid, "objectiveEntries", objectifId);
  await deleteDoc(entryContainerRef);
  await deleteDoc(objectiveRef);
}

// --- Lier / délier une consigne ---
async function linkConsigneToObjective(db, uid, consigneId, objectifId) {
  if (!consigneId) return;
  await setDoc(
    doc(db, "u", uid, "consignes", consigneId),
    { objectiveId: objectifId || null },
    { merge: true },
  );
}

async function saveObjectiveEntry(db, uid, objectifId, dateIso, value) {
  const ref = doc(db, "u", uid, "objectiveEntries", objectifId, "entries", dateIso);
  await setDoc(ref, { v: value, at: serverTimestamp() }, { merge: true });
}

async function loadObjectiveEntriesRange(db, uid, objectifId, _fromIso, _toIso) {
  const colRef = collection(db, "u", uid, "objectiveEntries", objectifId, "entries");
  const snap = await getDocs(colRef);
  return snap.docs.map((d) => ({ date: d.id, v: d.data().v }));
}

Object.assign(Schema, {
  isAdmin,
  now,
  col,
  docIn,
  buildUserDailyLink,
  todayKey,
  dayKeyFromDate,
  PRIORITIES,
  MODES,
  TYPES,
  LIKERT,
  LIKERT_POINTS,
  getUserName,
  fetchCategories,
  ensureCategory,
  newUid,
  readSRState,
  upsertSRState,
  savePushToken,
  disablePushToken,
  likertScore,
  nextCooldownAfterAnswer,
  resetSRForConsigne,
  saveResponses,
  countPracticeSessions,
  fetchPracticeSessions,
  startNewPracticeSession,
  listConsignesByMode,
  fetchConsignes,
  addConsigne,
  updateConsigne,
  updateConsigneOrder,
  softDeleteConsigne,
  saveResponse,
  fetchHistory,
  fetchResponsesForConsigne,
  fetchDailyResponses,
  valueToNumericPoint,
  listConsignesByCategory,
  loadConsigneHistory,
  saveHistoryEntry,
  deleteHistoryEntry,
  monthKeyFromDate,
  weeksOf,
  weekOfMonthFromDate,
  weekDateRange,
  listObjectivesByMonth,
  getObjective,
  upsertObjective,
  deleteObjective,
  linkConsigneToObjective,
  saveObjectiveEntry,
  loadObjectiveEntriesRange,
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    monthKeyFromDate,
    weeksOf,
    weekOfMonthFromDate,
    weekDateRange,
  };
}

