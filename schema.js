// --- DEBUG LOGGER ---
export const D = {
  on: true, // << mets false pour couper
  info: (...a) => D.on && console.info("[HP]", ...a),
  debug: (...a) => D.on && console.debug("[HP]", ...a),
  warn: (...a) => D.on && console.warn("[HP]", ...a),
  error: (...a) => D.on && console.error("[HP]", ...a),
  group: (label, ...a) => D.on && console.groupCollapsed(`📘 ${label}`, ...a),
  groupEnd: () => D.on && console.groupEnd(),
};
const log = () => {};
// --- Helpers de chemin /u/{uid}/...
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  query,
  where,
  orderBy,
  updateDoc,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let boundDb = null;

export function bindDb(db) {
  boundDb = db;
}

export const now = () => new Date().toISOString();
export const col = (db, uid, sub) => collection(db, "u", uid, sub);
export const docIn = (db, uid, sub, id) => doc(db, "u", uid, sub, id);

// Timestamp lisible (les graphs lisent une chaîne)
export const todayKey = (d = new Date()) => d.toISOString().slice(0,10); // YYYY-MM-DD

export const PRIORITIES = ["high","medium","low"];
export const MODES = ["daily","practice"];
export const TYPES = ["short","long","likert6","likert5","yesno","num"];

export const LIKERT = ["no_answer","no","rather_no","medium","rather_yes","yes"];
export const LIKERT_POINTS = {
  no_answer: 0,
  no: 0,
  rather_no: 0,
  medium: 0,
  rather_yes: 0.5,
  yes: 1
};

const PRIORITY_ALIAS = { high: 1, medium: 2, low: 3 };
const DAY_ALIAS = {
  mon: "LUN",
  tue: "MAR",
  wed: "MER",
  thu: "JEU",
  fri: "VEN",
  sat: "SAM",
  sun: "DIM"
};
const DAY_VALUES = new Set(["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"]);

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
      if (DAY_ALIAS[lower]) return DAY_ALIAS[lower];
      const upper = lower.toUpperCase();
      if (DAY_VALUES.has(upper)) return upper;
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
export async function getUserName(uid) {
  if (!uid) return "Utilisateur";
  if (!boundDb) {
    console.warn("getUserName error:", new Error("Firestore not initialized"));
    return "Utilisateur";
  }
  try {
    const snap = await getDoc(doc(boundDb, "u", uid));
    const d = snap.exists() ? (snap.data() || {}) : {};
    return d.name || d.displayName || d.slug || "Utilisateur";
  } catch (e) {
    console.warn("getUserName error:", e);
    return "Utilisateur";
  }
}

export async function fetchCategories(db, uid){
  const qy = query(col(db, uid, "categories"), orderBy("name"));
  const ss = await getDocs(qy);
  return ss.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function ensureCategory(db, uid, name, mode){
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
export function newUid() {
  return Math.random().toString(36).substring(2, 10);
}

// Etat SR stocké dans /u/{uid}/sr/{consigneId}  (ou goalId)
export async function readSRState(db, uid, itemId, key = "default") {
  const snap = await getDoc(docIn(db, uid, "sr", `${key}:${itemId}`));
  return snap.exists() ? snap.data() : null;
}
export async function upsertSRState(db, uid, itemId, key, state) {
  await setDoc(docIn(db, uid, "sr", `${key}:${itemId}`), state, { merge: true });
}

// --- Push tokens (stockés sous /u/{uid}/pushTokens/{token}) ---
export async function savePushToken(db, uid, token, extra = {}) {
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

export async function disablePushToken(db, uid, token) {
  await setDoc(docIn(db, uid, "pushTokens", token), {
    enabled: false,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// score pour likert -> 0 / 0.5 / 1
export function likertScore(v) {
  return ({ yes: 1, rather_yes: 0.5, medium: 0, rather_no: 0, no: 0, no_answer: 0 })[v] ?? 0;
}

// calcule la prochaine “masque” (journalier=jours, pratique=sessions)
export function nextCooldownAfterAnswer(meta, prevState, value) {
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

export async function resetSRForConsigne(db, uid, consigneId) {
  const today = new Date().toISOString();
  await upsertSRState(db, uid, consigneId, "consigne", {
    streak: 0,
    nextAllowedIndex: 0,
    nextVisibleOn: today
  });
}

// answers: [{ consigne, value, sessionId? }]
export async function saveResponses(db, uid, mode, answers) {
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

export async function countPracticeSessions(db, uid){
  const ss = await getDocs(col(db, uid, "sessions"));
  return ss.size;
}

export async function startNewPracticeSession(db, uid) {
  await addDoc(col(db, uid, "sessions"), {
    ownerUid: uid,
    startedAt: serverTimestamp()
  });
}

// list consignes par mode
export async function listConsignesByMode(db, uid, mode) {
  const qy = query(col(db, uid, "consignes"), where("mode", "==", mode), where("active", "==", true));
  const ss = await getDocs(qy);
  return ss.docs.map((d) => hydrateConsigne(d));
}

// --- Nouvelles collections /u/{uid}/... ---
export async function fetchConsignes(db, uid, mode) {
  const qy = query(
    col(db, uid, "consignes"),
    where("mode", "==", mode),
    where("active", "==", true),
    orderBy("priority")
  );
  const ss = await getDocs(qy);
  return ss.docs.map((d) => hydrateConsigne(d));
}

export async function addConsigne(db, uid, payload) {
  const ref = await addDoc(col(db, uid, "consignes"), {
    ...payload,
    srEnabled: payload.srEnabled !== false,
    priority: normalizePriority(payload.priority),
    days: normalizeDays(payload.days),
    createdAt: serverTimestamp()
  });
  return ref;
}

export async function updateConsigne(db, uid, id, payload) {
  const ref = docIn(db, uid, "consignes", id);
  await updateDoc(ref, {
    ...payload,
    srEnabled: payload.srEnabled !== false,
    priority: normalizePriority(payload.priority),
    days: normalizeDays(payload.days),
    updatedAt: serverTimestamp()
  });
}

export async function softDeleteConsigne(db, uid, id) {
  const ref = docIn(db, uid, "consignes", id);
  await updateDoc(ref, {
    active: false,
    updatedAt: serverTimestamp()
  });
}

export async function saveResponse(db, uid, consigne, value) {
  log("saveResponse:start", { uid, consigneId: consigne.id, mode: consigne.mode, value });
  const payload = {
    ownerUid: uid,
    consigneId: consigne.id,
    mode: consigne.mode,
    value,
    createdAt: now(),
  };
  const ref = await addDoc(col(db, uid, "responses"), payload);
  log("saveResponse:done", { uid, responseId: ref.id, consigneId: consigne.id });
}

export async function fetchHistory(db, uid, count = 200) {
  log("fetchHistory:start", { uid, count });
  const qy = query(
    col(db, uid, "responses"),
    orderBy("createdAt", "desc"),
    limit(count)
  );
  const ss = await getDocs(qy);
  const data = ss.docs.map(d => d.data());
  log("fetchHistory:done", { uid, count: data.length });
  return data;
}

export async function fetchResponsesForConsigne(db, uid, consigneId, limitCount = 200) {
  const qy = query(
    col(db, uid, "responses"),
    where("consigneId","==", consigneId),
    orderBy("createdAt","desc"),
    limit(limitCount)
  );
  const ss = await getDocs(qy);
  return ss.docs.map(d => ({ id:d.id, ...d.data() }));
}

export function valueToNumericPoint(type, value) {
  if (type === "likert6") return LIKERT_POINTS[value] ?? 0;
  if (type === "likert5") return Number(value) || 0;  // 0..4
  if (type === "yesno")   return value === "yes" ? 1 : 0;
  if (type === "num") return Number(value) || 0;
  return null; // pour short/long -> pas de graph
}

// --- utilitaires temps ---
export function monthKeyFromDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

export function weekOfMonthFromDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return 1;
  const first = new Date(dt.getFullYear(), dt.getMonth(), 1);
  const offset = dt.getDate() + first.getDay();
  return Math.max(1, Math.ceil(offset / 7));
}

// --- Objectifs CRUD ---
export async function listObjectivesByMonth(db, uid, monthKey) {
  const q = query(collection(db, "u", uid, "objectifs"), where("monthKey", "==", monthKey));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getObjective(db, uid, objectifId) {
  const ref = doc(db, "u", uid, "objectifs", objectifId);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function upsertObjective(db, uid, data, objectifId = null) {
  const start = data?.startDate ? new Date(data.startDate) : new Date();
  const monthKey = data?.monthKey || monthKeyFromDate(start);
  const week = data?.type === "hebdo"
    ? (data?.weekOfMonth || weekOfMonthFromDate(start))
    : null;

  const payload = {
    titre: data?.titre || "Objectif",
    description: data?.description || "",
    type: data?.type || "mensuel",
    startDate: data?.startDate || `${monthKey}-01`,
    endDate: data?.endDate || `${monthKey}-28`,
    monthKey,
    status: data?.status || "en_cours",
    ...(week ? { weekOfMonth: week } : {}),
  };

  if (objectifId) {
    await setDoc(doc(db, "u", uid, "objectifs", objectifId), payload, { merge: true });
    return objectifId;
  }
  const ref = await addDoc(collection(db, "u", uid, "objectifs"), payload);
  return ref.id;
}

// --- Lier / délier une consigne ---
export async function linkConsigneToObjective(db, uid, consigneId, objectifId) {
  if (!consigneId) return;
  await setDoc(
    doc(db, "u", uid, "consignes", consigneId),
    { objectiveId: objectifId || null },
    { merge: true },
  );
}

