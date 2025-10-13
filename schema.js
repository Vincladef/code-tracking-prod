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
      deleteField: () => firebaseCompat.firestore.FieldValue.delete(),
      runTransaction: (db, updateFunction) => db.runTransaction(updateFunction),
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
      deleteField: () => missingFirestoreWarning(),
      runTransaction: () => missingFirestoreWarning(),
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
  deleteField,
  runTransaction,
} = Schema.firestore;

const firestoreTimestampCtor =
  Schema.firestore?.Timestamp ||
  (typeof window !== "undefined" && window.firebase?.firestore?.Timestamp) ||
  (typeof window !== "undefined" && window.firebase?.Timestamp) ||
  null;

function toFirestoreTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  if (firestoreTimestampCtor && typeof firestoreTimestampCtor.fromDate === "function") {
    try {
      return firestoreTimestampCtor.fromDate(date);
    } catch (error) {
      schemaLog("timestamp.fromDate", error);
    }
  }
  return null;
}

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
  _enabled: true,
  _indent: 0,
  get on() {
    return this._enabled;
  },
  set on(value) {
    this._enabled = Boolean(value);
  },
  _emit(method, icon, args) {
    if (!this._enabled) {
      return;
    }
    const indent = this._indent > 0 ? "  ".repeat(this._indent) : "";
    const prefix = `${icon} [HP] ${indent}`;
    if (!args.length) {
      console[method](prefix);
      return;
    }
    if (typeof args[0] === "string") {
      const [first, ...rest] = args;
      console[method](`${prefix}${first ? ` ${first}` : ""}`, ...rest);
      return;
    }
    console[method](prefix, ...args);
  },
  info(...args) {
    this._emit("info", "ℹ️", args);
  },
  debug(...args) {
    const method = typeof console.debug === "function" ? "debug" : "log";
    this._emit(method, "🐞", args);
  },
  warn(...args) {
    this._emit("warn", "⚠️", args);
  },
  error(...args) {
    this._emit("error", "⛔", args);
  },
  group(label, ...rest) {
    this._emit("info", "📂", [label, ...rest]);
    this._indent += 1;
  },
  groupEnd() {
    if (this._indent > 0) {
      this._indent -= 1;
    }
  },
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

async function loadModuleSettings(db, uid, moduleId) {
  if (!db || !uid || !moduleId) return {};
  try {
    const snap = await getDoc(docIn(db, uid, "modules", moduleId));
    if (!snapshotExists(snap)) {
      return {};
    }
    const data = snap.data() || {};
    return { ...data };
  } catch (error) {
    schemaLog("moduleSettings:load:error", { uid, moduleId, error });
    return {};
  }
}

async function saveModuleSettings(db, uid, moduleId, payload = {}) {
  if (!db || !uid || !moduleId) return;
  try {
    await setDoc(
      docIn(db, uid, "modules", moduleId),
      { ...payload, updatedAt: now() },
      { merge: true },
    );
  } catch (error) {
    schemaLog("moduleSettings:save:error", { uid, moduleId, error });
  }
}

function buildUserDailyLink(uid, dateIso) {
  const base = "https://vincladef.github.io/code-tracking-prod/";
  return `${base}#/daily?u=${encodeURIComponent(uid)}&d=${dateIso}`;
}

// Timestamp lisible (les graphs lisent une chaîne)
function dayKeyFromDate(dateInput = new Date()) {
  if (typeof window !== "undefined" && window.DateUtils?.dayKeyParis) {
    try {
      const computed = window.DateUtils.dayKeyParis(dateInput);
      if (computed) {
        return computed;
      }
    } catch (error) {
      schemaLog("dayKeyFromDate:paris:error", error);
    }
  }
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
const TYPES = ["short","long","likert6","likert5","yesno","num","checklist","info"];

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

function normalizePositiveInteger(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const rounded = Math.round(num);
  return rounded > 0 ? rounded : null;
}

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

function normalizeParentId(value) {
  const trimmed = typeof value === "string" ? value.trim() : value;
  return trimmed ? String(trimmed) : null;
}

function normalizeSummaryOnlyScope(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "weekly" || normalized === "week" || normalized === "hebdo" || normalized === "hebdomadaire") {
    return "weekly";
  }
  if (normalized === "monthly" || normalized === "month" || normalized === "mensuel" || normalized === "mensuelle") {
    return "monthly";
  }
  if (normalized === "yearly" || normalized === "year" || normalized === "annuel" || normalized === "annuelle") {
    return "yearly";
  }
  if (
    normalized === "summary" ||
    normalized === "bilan" ||
    normalized === "bilans" ||
    normalized === "summary-only" ||
    normalized === "bilan-only"
  ) {
    return "summary";
  }
  return null;
}

let checklistIdCounter = 0;

function generateChecklistItemId() {
  if (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch (error) {
      // ignore and fall back to manual generation
    }
  }
  checklistIdCounter += 1;
  const nowPart = Date.now().toString(36);
  const counterPart = checklistIdCounter.toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `chk_${nowPart}_${counterPart}_${randomPart}`;
}

function normalizeChecklistItemPayload(items, ids) {
  const normalizedItems = [];
  const normalizedIds = [];
  const seenLabels = new Set();
  const seenIds = new Set();
  const sourceItems = Array.isArray(items) ? items : [];
  const sourceIds = Array.isArray(ids) ? ids : [];
  sourceItems.forEach((raw, index) => {
    if (typeof raw !== "string") {
      return;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      return;
    }
    const labelKey = trimmed.toLowerCase();
    if (seenLabels.has(labelKey)) {
      return;
    }
    seenLabels.add(labelKey);
    normalizedItems.push(trimmed);
    const explicitId = typeof sourceIds[index] === "string" ? sourceIds[index].trim() : "";
    let resolvedId = explicitId && !seenIds.has(explicitId) ? explicitId : "";
    if (!resolvedId) {
      do {
        resolvedId = generateChecklistItemId();
      } while (seenIds.has(resolvedId));
    }
    seenIds.add(resolvedId);
    normalizedIds.push(resolvedId);
  });
  return { items: normalizedItems, ids: normalizedIds };
}

function normalizeChecklistItems(items) {
  return normalizeChecklistItemPayload(items).items;
}

function normalizeChecklistItemIds(ids, items) {
  return normalizeChecklistItemPayload(items, ids).ids;
}

function hydrateConsigne(doc) {
  const data = doc.data();
  const normalizedChecklist = normalizeChecklistItemPayload(
    data.checklistItems,
    data.checklistItemIds
  );
  return {
    id: doc.id,
    ...data,
    priority: normalizePriority(data.priority),
    days: normalizeDays(data.days),
    srEnabled: data.srEnabled !== false,
    weeklySummaryEnabled: data.weeklySummaryEnabled !== false,
    monthlySummaryEnabled: data.monthlySummaryEnabled !== false,
    yearlySummaryEnabled: data.yearlySummaryEnabled !== false,
    summaryOnlyScope: normalizeSummaryOnlyScope(data.summaryOnlyScope),
    parentId: normalizeParentId(data.parentId),
    checklistItems: normalizedChecklist.items,
    checklistItemIds: normalizedChecklist.ids,
    ephemeral: data.ephemeral === true,
    ephemeralDurationDays: normalizePositiveInteger(data.ephemeralDurationDays),
    ephemeralDurationIterations: normalizePositiveInteger(data.ephemeralDurationIterations),
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
    order: Date.now(),
    createdAt: serverTimestamp()
  });
  const created = { id: ref.id, ownerUid: uid, name, mode };
  D.info("data.ensureCategory.ok", created);
  return created;
}

async function reorderCategories(db, uid, orderedIds = []) {
  if (!db || !uid || !Array.isArray(orderedIds) || !orderedIds.length) {
    return;
  }
  const writes = [];
  orderedIds.forEach((id, index) => {
    if (!id) return;
    const orderValue = (index + 1) * 10;
    const ref = docIn(db, uid, "categories", id);
    writes.push(
      updateDoc(ref, { order: orderValue, updatedAt: now() }).catch((error) => {
        schemaLog("categories.reorder:update:error", { uid, categoryId: id, error });
      })
    );
  });
  if (writes.length) {
    await Promise.all(writes);
  }
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
  if (meta?.type === "info") {
    if (prevState) return prevState;
    if (meta?.mode === "daily") {
      return { streak: 0, nextVisibleOn: null };
    }
    return { streak: 0, nextAllowedIndex: meta?.sessionIndex ?? 0 };
  }
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
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const immediate = new Date(midnight.getTime() - 1).toISOString();
  const canDeleteField = typeof deleteField === "function";
  const state = {
    streak: 0,
    nextAllowedIndex: 0,
    nextVisibleOn: immediate,
  };
  if (canDeleteField) {
    state.hideUntil = deleteField();
  } else {
    state.hideUntil = null;
  }
  await upsertSRState(db, uid, consigneId, "consigne", state);
}

async function delayConsigne({ db, uid, consigne, mode, amount, sessionIndex }) {
  if (!db) throw new Error("Firestore manquant");
  if (!uid) throw new Error("Utilisateur manquant");
  if (!consigne?.id) throw new Error("Consigne invalide");
  if (consigne?.srEnabled === false) {
    throw new Error("SR_DISABLED");
  }

  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) {
    throw new Error("INVALID_AMOUNT");
  }
  const rounded = Math.round(parsed);
  if (rounded < 1) {
    throw new Error("INVALID_AMOUNT");
  }

  const canDeleteField = typeof deleteField === "function";
  const state = { streak: 0 };
  state.hideUntil = canDeleteField ? deleteField() : null;

  if (mode === "daily") {
    const skips = Math.max(0, rounded - 1);
    state.nextVisibleOn = nextVisibleDateFrom(new Date(), consigne?.days || [], skips);
    state.nextAllowedIndex = canDeleteField ? deleteField() : null;
  } else if (mode === "practice") {
    const currentIndex = Number(sessionIndex ?? 0);
    if (!Number.isFinite(currentIndex)) {
      throw new Error("INVALID_SESSION_INDEX");
    }
    state.nextAllowedIndex = (currentIndex + 1) + rounded;
    state.nextVisibleOn = canDeleteField ? deleteField() : null;
  } else {
    throw new Error("INVALID_MODE");
  }

  await upsertSRState(db, uid, consigne.id, "consigne", state);
  return state;
}

function ensureRecentResponseStore() {
  if (typeof window === "undefined") {
    return null;
  }
  const existing = window.__hpRecentResponses;
  if (existing instanceof Map) {
    return existing;
  }
  if (existing && typeof existing === "object") {
    const map = new Map();
    try {
      Object.entries(existing).forEach(([key, value]) => {
        if (!key) return;
        if (Array.isArray(value)) {
          map.set(key, value.slice());
        }
      });
    } catch (error) {
      console.warn("ensureRecentResponseStore:normalize", error);
    }
    window.__hpRecentResponses = map;
    return map;
  }
  const map = new Map();
  window.__hpRecentResponses = map;
  return map;
}

function responseIdentity(entry) {
  if (!entry || typeof entry !== "object") {
    return "";
  }
  if (entry.id) {
    return `id:${entry.id}`;
  }
  const rawDate = entry.createdAt?.toDate?.() ?? entry.createdAt ?? entry.updatedAt ?? null;
  let iso = "";
  if (rawDate instanceof Date) {
    if (!Number.isNaN(rawDate.getTime())) {
      iso = rawDate.toISOString();
    }
  } else if (typeof rawDate === "string" || typeof rawDate === "number") {
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) {
      iso = parsed.toISOString();
    }
  }
  let valueKey = "";
  try {
    valueKey = JSON.stringify(entry.value ?? null);
  } catch (error) {
    valueKey = String(entry.value ?? "");
  }
  return `created:${iso}::value:${valueKey}`;
}

function registerRecentResponses(mode, entries) {
  if (typeof window === "undefined") {
    return;
  }
  if (!Array.isArray(entries) || !entries.length) {
    return;
  }
  const store = ensureRecentResponseStore();
  if (!store) {
    return;
  }
  const sanitized = entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const consigneId = entry.consigneId || entry.consigne?.id || null;
      if (!consigneId) {
        return null;
      }
      const createdAtRaw = entry.createdAt?.toDate?.() ?? entry.createdAt ?? entry.updatedAt ?? null;
      let createdAtIso = null;
      if (createdAtRaw instanceof Date) {
        if (!Number.isNaN(createdAtRaw.getTime())) {
          createdAtIso = createdAtRaw.toISOString();
        }
      } else if (typeof createdAtRaw === "string" || typeof createdAtRaw === "number") {
        const parsed = new Date(createdAtRaw);
        if (!Number.isNaN(parsed.getTime())) {
          createdAtIso = parsed.toISOString();
        }
      }
      const normalized = {
        id: entry.id || null,
        consigneId,
        mode: entry.mode || mode || null,
        value: entry.value,
        type: entry.type || entry.consigne?.type || null,
        note: entry.note ?? null,
        summaryScope: entry.summaryScope || entry.summary_scope || null,
        summaryMode: entry.summaryMode || entry.summary_mode || null,
        summaryLabel: entry.summaryLabel || entry.summary_label || null,
        summaryPeriod: entry.summaryPeriod || entry.summary_period || null,
        source: entry.source || null,
        origin: entry.origin || null,
        context: entry.context || null,
        category: entry.category || entry.consigne?.category || null,
        sessionId: entry.sessionId || null,
        sessionIndex: entry.sessionIndex ?? null,
        sessionNumber: entry.sessionNumber ?? null,
        dayKey: entry.dayKey || null,
        createdAt: createdAtIso || new Date().toISOString(),
      };
      return normalized;
    })
    .filter(Boolean);
  if (!sanitized.length) {
    return;
  }
  sanitized.forEach((entry) => {
    const list = store.get(entry.consigneId) || [];
    const withoutDuplicates = list.filter((item) => responseIdentity(item) !== responseIdentity(entry));
    withoutDuplicates.unshift(entry);
    withoutDuplicates.sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      return bTime - aTime;
    });
    store.set(entry.consigneId, withoutDuplicates.slice(0, 10));
    if (Schema?.D?.info) {
      Schema.D.info("history.register.entry", {
        consigneId: entry.consigneId,
        mode: entry.mode || mode || null,
        dayKey: entry.dayKey || null,
        createdAt: entry.createdAt,
      });
    }
  });
  if (Schema?.D?.info) {
    Schema.D.info("history.register.batch", {
      mode: mode || null,
      count: sanitized.length,
    });
  }
  if (typeof window.dispatchEvent === "function" && typeof window.CustomEvent === "function") {
    try {
      const detail = { mode: mode || null, responses: sanitized.map((entry) => ({ ...entry })) };
      window.dispatchEvent(new CustomEvent("hp:responses:saved", { detail }));
    } catch (error) {
      console.warn("registerRecentResponses:dispatch", error);
    }
  }
}

function parseHistoryDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value?.toDate === "function") {
    try {
      const parsed = value.toDate();
      return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
    } catch (error) {
      console.warn("responses.history:parse", error);
      return null;
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function parseDayKeyToDate(dayKey) {
  if (typeof dayKey !== "string") {
    return null;
  }
  const trimmed = dayKey.trim();
  if (!trimmed) {
    return null;
  }
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(trimmed);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      const candidate = new Date(year, (month || 1) - 1, day || 1);
      if (!Number.isNaN(candidate.getTime())) {
        candidate.setHours(0, 0, 0, 0);
        return candidate;
      }
    }
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function toFiniteNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveHistoryKeyForResponse(entry) {
  if (!entry || typeof entry !== "object") {
    return "";
  }
  const explicitHistoryKey = entry.historyKey || entry.history_key;
  if (explicitHistoryKey) {
    return String(explicitHistoryKey);
  }
  const mode = typeof entry.mode === "string" ? entry.mode : "";
  const sessionId = entry.sessionId || entry.session_id;
  if (mode === "practice") {
    if (sessionId) {
      return String(sessionId);
    }
    const index = toFiniteNumber(entry.sessionIndex ?? entry.session_index);
    if (index !== null) {
      return `session-${String(index + 1).padStart(4, "0")}`;
    }
    const number = toFiniteNumber(entry.sessionNumber ?? entry.session_number);
    if (number !== null) {
      return `session-${String(number).padStart(4, "0")}`;
    }
  }
  const explicitDayKey =
    entry.dayKey ||
    entry.day_key ||
    (typeof entry.getDayKey === "function" ? entry.getDayKey() : "");
  if (explicitDayKey) {
    return String(explicitDayKey);
  }
  const createdAt = parseHistoryDate(entry.createdAt || entry.updatedAt || null);
  if (mode === "daily" && createdAt) {
    return dayKeyFromDate(createdAt);
  }
  if (createdAt) {
    return createdAt.toISOString();
  }
  if (sessionId) {
    return String(sessionId);
  }
  if (entry.id) {
    return `response-${String(entry.id)}`;
  }
  return now();
}

async function persistResponsesToHistory(db, uid, responses) {
  if (!db || !uid || !Array.isArray(responses) || !responses.length) {
    return;
  }
  const tasks = [];
  responses.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const consigneId = entry.consigneId;
    if (!consigneId) {
      return;
    }
    const historyKey = resolveHistoryKeyForResponse(entry);
    if (!historyKey) {
      return;
    }
    const data = {};
    if (Object.prototype.hasOwnProperty.call(entry, "value")) {
      data.value = entry.value;
    }
    if (Object.prototype.hasOwnProperty.call(entry, "note")) {
      data.note = entry.note;
    }
    const metadataKeys = [
      "summaryScope",
      "summaryMode",
      "summaryLabel",
      "summaryPeriod",
      "summaryKey",
      "period",
      "periodLabel",
      "periodScope",
      "periodKey",
      "periodStart",
      "periodEnd",
      "source",
      "origin",
      "context",
      "moduleId",
      "category",
      "mode",
      "type",
      "dayKey",
      "weekEndsOn",
      "weekKey",
      "monthKey",
      "checkedIds",
      "checkedCount",
      "total",
      "percentage",
      "isEmpty",
      "pageDate",
      "pageDateIso",
      "pageDayIndex",
      "weekStart",
      "selectedIds",
      "optionsHash",
    ];
    metadataKeys.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(entry, key)) {
        return;
      }
      const value = entry[key];
      if (value === undefined || value === null) {
        return;
      }
      if (typeof value === "string" && value.trim() === "") {
        return;
      }
      data[key] = value;
    });
    if (!Object.keys(data).length) {
      return;
    }
    const options = {
      responseId: entry.id || null,
      responseMode: entry.mode || null,
      responseType: entry.type || null,
      responseCreatedAt: entry.createdAt || null,
      mode: entry.mode || null,
      type: entry.type || null,
    };
    const dayKey = entry.dayKey || entry.day_key || null;
    if (dayKey) {
      options.responseDayKey = dayKey;
    } else if ((entry.mode === "daily" || entry.mode === "practice") && entry.createdAt) {
      const parsed = parseHistoryDate(entry.createdAt);
      if (parsed) {
        options.responseDayKey = dayKeyFromDate(parsed);
      }
    }
    tasks.push(
      (async () => {
        try {
          await saveHistoryEntry(db, uid, consigneId, historyKey, data, options);
        } catch (error) {
          console.warn("responses.history:save", { consigneId, historyKey, error });
        }
      })()
    );
  });
  if (tasks.length) {
    await Promise.all(tasks);
  }
}

// answers: [{ consigne, value, sessionId?, sessionIndex?, sessionNumber? }]
async function saveResponses(db, uid, mode, answers) {
  if (!Array.isArray(answers) || !answers.length) {
    return [];
  }
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
    if (a.note !== undefined) {
      payload.note = a.note;
    }
    if (a.summaryScope !== undefined) {
      payload.summaryScope = a.summaryScope;
    }
    if (a.summaryMode !== undefined) {
      payload.summaryMode = a.summaryMode;
    }
    if (a.summaryLabel !== undefined) {
      payload.summaryLabel = a.summaryLabel;
    }
    if (a.summaryPeriod !== undefined) {
      payload.summaryPeriod = a.summaryPeriod;
    }
    if (a.source !== undefined) {
      payload.source = a.source;
    }
    if (a.origin !== undefined) {
      payload.origin = a.origin;
    }
    if (a.context !== undefined) {
      payload.context = a.context;
    }
    if (Array.isArray(a.selectedIds)) {
      payload.selectedIds = a.selectedIds
        .map((value) => String(value ?? ""))
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    }
    if (a.optionsHash !== undefined && a.optionsHash !== null) {
      const hashValue = String(a.optionsHash);
      if (hashValue) {
        payload.optionsHash = hashValue;
      }
    }
    if (Array.isArray(a.checkedIds)) {
      payload.checkedIds = a.checkedIds.slice();
    }
    if (a.checkedCount !== undefined && a.checkedCount !== null) {
      const countValue = Number(a.checkedCount);
      if (Number.isFinite(countValue)) {
        payload.checkedCount = countValue;
      }
    }
    if (a.total !== undefined && a.total !== null) {
      const totalValue = Number(a.total);
      if (Number.isFinite(totalValue)) {
        payload.total = totalValue;
      }
    }
    if (a.percentage !== undefined && a.percentage !== null) {
      const pctValue = Number(a.percentage);
      if (Number.isFinite(pctValue)) {
        const clamped = Math.max(0, Math.min(100, Math.round(pctValue)));
        payload.percentage = clamped;
      }
    }
    if (typeof a.isEmpty === "boolean") {
      payload.isEmpty = a.isEmpty;
    }
    if (a.pageDate !== undefined && a.pageDate !== null) {
      payload.pageDate = a.pageDate;
    }
    if (a.pageDateIso !== undefined) {
      payload.pageDateIso = a.pageDateIso;
    }
    if (a.weekStart !== undefined) {
      payload.weekStart = a.weekStart;
    }
    if (a.pageDayIndex !== undefined && a.pageDayIndex !== null) {
      const dayIndexValue = Number(a.pageDayIndex);
      if (Number.isFinite(dayIndexValue)) {
        payload.pageDayIndex = dayIndexValue;
      }
    }
    if (!payload.pageDate && payload.dayKey) {
      const parsedDay = parseDayKeyToDate(payload.dayKey) || parseHistoryDate(payload.dayKey);
      const ts = toFirestoreTimestamp(parsedDay);
      if (ts) {
        payload.pageDate = ts;
      }
    }
    if (!payload.pageDateIso && payload.dayKey) {
      payload.pageDateIso = payload.dayKey;
    }
    if (!payload.weekStart && payload.dayKey) {
      const parsedDay = parseDayKeyToDate(payload.dayKey) || parseHistoryDate(payload.dayKey);
      if (parsedDay) {
        const range = weekRangeFromDate(parsedDay, 0);
        if (range?.start) {
          payload.weekStart = dayKeyFromDate(range.start);
        }
      }
    }
    if (payload.pageDayIndex === undefined && payload.dayKey) {
      const parsedDay = parseDayKeyToDate(payload.dayKey) || parseHistoryDate(payload.dayKey);
      if (parsedDay) {
        payload.pageDayIndex = ((parsedDay.getDay() + 6) % 7 + 7) % 7;
      }
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
    const write = addDoc(col(db, uid, "responses"), payload).then((ref) => ({
      id: ref?.id || null,
      ...payload,
      mode,
      type: a.consigne?.type || payload.type || null,
    }));
    batch.push(write);
  }
  const results = await Promise.all(batch);
  if (Schema?.D?.group) {
    Schema.D.group("responses.save", { mode, count: results.length });
    results.forEach((entry) => {
      Schema?.D?.info?.("responses.save.entry", {
        consigneId: entry.consigneId,
        mode: entry.mode || mode || null,
        createdAt: entry.createdAt,
        dayKey: entry.dayKey || null,
      });
    });
    Schema?.D?.groupEnd?.();
  } else if (Schema?.D?.info) {
    Schema.D.info("responses.save", { mode, count: results.length });
  }
  registerRecentResponses(mode, results);
  try {
    await persistResponsesToHistory(db, uid, results);
  } catch (error) {
    console.warn("responses.history:error", error);
  }
  if (window.ChecklistState?.persistResponses) {
    try {
      await window.ChecklistState.persistResponses(db, uid, results);
    } catch (error) {
      console.warn("responses.checklistHistory:error", error);
    }
  }
  return results;
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

async function listChildConsignes(db, uid, parentId) {
  if (!parentId) return [];
  const qy = query(
    col(db, uid, "consignes"),
    where("parentId", "==", parentId),
    where("active", "==", true)
  );
  const snap = await getDocs(qy);
  return snap.docs.map((d) => hydrateConsigne(d));
}

async function addConsigne(db, uid, payload) {
  const normalizedChecklist = normalizeChecklistItemPayload(
    payload.checklistItems,
    payload.checklistItemIds
  );
  const ref = await addDoc(col(db, uid, "consignes"), {
    ...payload,
    srEnabled: payload.srEnabled !== false,
    weeklySummaryEnabled: payload.weeklySummaryEnabled !== false,
    monthlySummaryEnabled: payload.monthlySummaryEnabled !== false,
    yearlySummaryEnabled: payload.yearlySummaryEnabled !== false,
    summaryOnlyScope: normalizeSummaryOnlyScope(payload.summaryOnlyScope),
    priority: normalizePriority(payload.priority),
    days: normalizeDays(payload.days),
    parentId: normalizeParentId(payload.parentId),
    checklistItems: normalizedChecklist.items,
    checklistItemIds: normalizedChecklist.ids,
    ephemeral: payload.ephemeral === true,
    ephemeralDurationDays: normalizePositiveInteger(payload.ephemeralDurationDays),
    ephemeralDurationIterations: normalizePositiveInteger(payload.ephemeralDurationIterations),
    createdAt: serverTimestamp()
  });
  return ref;
}

const CONSIGNE_HISTORY_MAX_DEPTH = 8;

function sanitizeConsigneHistoryPayload(value, depth = 0) {
  if (depth > CONSIGNE_HISTORY_MAX_DEPTH) {
    return null;
  }
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value?.toDate === "function") {
    try {
      const converted = value.toDate();
      return converted instanceof Date ? converted.toISOString() : converted;
    } catch (error) {
      schemaLog("history.consigne:sanitize:toDate", error);
      return null;
    }
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeConsigneHistoryPayload(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    const output = {};
    entries.forEach(([key, val]) => {
      if (typeof key !== "string") return;
      const sanitized = sanitizeConsigneHistoryPayload(val, depth + 1);
      if (sanitized !== undefined) {
        output[key] = sanitized;
      }
    });
    return output;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "function") {
    return undefined;
  }
  return String(value);
}

function ensureConsigneHistoryDateKey(input) {
  if (typeof input === "string" && input.trim()) {
    return input.trim();
  }
  if (input instanceof Date) {
    return dayKeyFromDate(input);
  }
  if (typeof input?.toDate === "function") {
    try {
      const converted = input.toDate();
      if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
        return dayKeyFromDate(converted);
      }
    } catch (error) {
      schemaLog("history.consigne:dateKey:toDate", error);
    }
  }
  if (typeof input === "number") {
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) {
      return dayKeyFromDate(parsed);
    }
  }
  return dayKeyFromDate(new Date());
}

function stableConsigneHistoryEntryId({ uid, consigneId, kind, dateKey, payload }) {
  const raw = JSON.stringify({ uid, consigneId, kind, dateKey, payload });
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  const safeDate = typeof dateKey === "string" && dateKey.trim() ? dateKey.trim() : "no-date";
  const safeKind = kind || "event";
  return `${safeDate}-${safeKind}-${hash.toString(16)}`;
}

function buildConsigneHistoryEntry(db, uid, consigneId, entryOptions = {}) {
  if (!db || !uid || !consigneId) {
    return null;
  }
  const kind = entryOptions.kind || "update";
  const dateKey = ensureConsigneHistoryDateKey(entryOptions.dateKey);
  const sanitizedPayload = sanitizeConsigneHistoryPayload(
    entryOptions.payload !== undefined ? entryOptions.payload : {},
  );
  const metadata = entryOptions.metadata
    ? sanitizeConsigneHistoryPayload(entryOptions.metadata)
    : undefined;
  const source = entryOptions.source || (kind === "autosave" ? "autosave" : "ui");
  const entryId = entryOptions.id
    || stableConsigneHistoryEntryId({
      uid,
      consigneId,
      kind,
      dateKey,
      payload: sanitizedPayload,
    });
  const historyCollection = collection(db, "u", uid, "consignes", consigneId, "history");
  const ref = doc(historyCollection, entryId);
  const nowFieldValue = serverTimestamp();
  const data = {
    consigneId,
    kind,
    type: entryOptions.type || null,
    dateKey,
    payload: sanitizedPayload || {},
    source,
    createdAt: entryOptions.createdAt || nowFieldValue,
    createdBy: entryOptions.createdBy || uid,
    updatedAt: entryOptions.updatedAt || nowFieldValue,
    updatedBy: entryOptions.updatedBy || uid,
  };
  if (metadata && Object.keys(metadata).length) {
    data.metadata = metadata;
  }
  if (entryOptions.comment !== undefined) {
    data.comment = entryOptions.comment;
  }
  return { ref, data };
}

async function logConsigneHistoryEntry(db, uid, consigneId, entryOptions = {}) {
  const entry = buildConsigneHistoryEntry(db, uid, consigneId, entryOptions);
  if (!entry) {
    return;
  }
  await setDoc(entry.ref, entry.data, { merge: false });
}

async function updateConsigne(db, uid, id, payload, options = {}) {
  const ref = docIn(db, uid, "consignes", id);
  const normalizedChecklist = normalizeChecklistItemPayload(
    payload.checklistItems,
    payload.checklistItemIds
  );
  const normalizedPayload = {
    ...payload,
    srEnabled: payload.srEnabled !== false,
    weeklySummaryEnabled: payload.weeklySummaryEnabled !== false,
    monthlySummaryEnabled: payload.monthlySummaryEnabled !== false,
    yearlySummaryEnabled: payload.yearlySummaryEnabled !== false,
    summaryOnlyScope: normalizeSummaryOnlyScope(payload.summaryOnlyScope),
    priority: normalizePriority(payload.priority),
    days: normalizeDays(payload.days),
    parentId: normalizeParentId(payload.parentId),
    checklistItems: normalizedChecklist.items,
    checklistItemIds: normalizedChecklist.ids,
    ephemeral: payload.ephemeral === true,
    ephemeralDurationDays: normalizePositiveInteger(payload.ephemeralDurationDays),
    ephemeralDurationIterations: normalizePositiveInteger(payload.ephemeralDurationIterations),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  };

  const historyOptions = options?.history || null;
  if (historyOptions) {
    const entry = buildConsigneHistoryEntry(db, uid, id, {
      ...historyOptions,
      payload: historyOptions.payload !== undefined ? historyOptions.payload : payload,
      type: historyOptions.type || payload.type || null,
    });
    if (entry) {
      if (typeof runTransaction === "function") {
        try {
          await runTransaction(db, async (transaction) => {
            transaction.set(ref, normalizedPayload, { merge: true });
            transaction.set(entry.ref, entry.data, { merge: false });
          });
          return;
        } catch (error) {
          schemaLog("updateConsigne:history:transaction", error);
        }
      }
      await updateDoc(ref, normalizedPayload);
      try {
        await setDoc(entry.ref, entry.data, { merge: false });
      } catch (error) {
        schemaLog("updateConsigne:history:set", error);
      }
      return;
    }
  }
  await updateDoc(ref, normalizedPayload);
}

async function updateConsigneOrder(db, uid, consigneId, order) {
  await setDoc(doc(db, "u", uid, "consignes", consigneId), { order }, { merge: true });
}

async function cascadeSoftDeleteConsignes(db, uid, parentId, visited = new Set()) {
  if (!db || !uid || !parentId) {
    return;
  }
  const alreadyVisited = visited.has(parentId);
  if (!alreadyVisited) {
    visited.add(parentId);
  }
  let childrenSnap;
  try {
    childrenSnap = await getDocs(
      query(col(db, uid, "consignes"), where("parentId", "==", parentId))
    );
  } catch (error) {
    console.warn("softDeleteConsigne:children", error);
    return;
  }
  const tasks = childrenSnap.docs.map(async (docSnap) => {
    if (!docSnap) return;
    const childId = docSnap.id;
    if (!childId || visited.has(childId)) {
      return;
    }
    visited.add(childId);
    try {
      await updateDoc(docSnap.ref, { active: false, updatedAt: serverTimestamp() });
    } catch (error) {
      console.warn("softDeleteConsigne:updateChild", { parentId, childId, error });
    }
    await cascadeSoftDeleteConsignes(db, uid, childId, visited);
  });
  await Promise.all(tasks);
}

async function softDeleteConsigne(db, uid, id) {
  const ref = docIn(db, uid, "consignes", id);
  await updateDoc(ref, {
    active: false,
    updatedAt: serverTimestamp()
  });
  await cascadeSoftDeleteConsignes(db, uid, id, new Set([id]));
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
    orderBy("pageDate", "desc"),
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
    orderBy("pageDate","desc"),
    orderBy("createdAt","desc"),
    limit(limitCount)
  );
  const ss = await getDocs(qy);
  return ss.docs.map(d => ({ id:d.id, ...d.data() }));
}

function valueToNumericPoint(type, value) {
  if (type === "info") return null;
  if (type === "likert6") return LIKERT_POINTS[value] ?? 0;
  if (type === "likert5") return Number(value) || 0;  // 0..4
  if (type === "yesno")   return value === "yes" ? 1 : 0;
  if (type === "num") return Number(value) || 0;
  if (type === "checklist") {
    const normalizeSkipValue = (raw) => {
      if (raw === true) return true;
      if (raw === false || raw == null) return false;
      if (typeof raw === "number") {
        if (!Number.isFinite(raw)) return false;
        return raw !== 0;
      }
      if (typeof raw === "string") {
        const normalized = raw.trim().toLowerCase();
        if (!normalized) return false;
        return ["1", "true", "yes", "y", "on", "skip", "passed"].includes(normalized);
      }
      return false;
    };
    const items = Array.isArray(value)
      ? value.map((item) => item === true)
      : value && typeof value === "object" && Array.isArray(value.items)
        ? value.items.map((item) => item === true)
        : [];
    // Les réponses par élément peuvent également être stockées dans un objet "answers"
    // de la forme { [itemId]: { value: "yes" | "maybe" | "no", skipped: boolean } }.
    // Pour la rétro-compatibilité, une valeur sans champ "skipped" est considérée comme false.
    const skippedRaw = value && typeof value === "object" && Array.isArray(value.skipped)
      ? value.skipped.map((item) => item === true)
      : [];
    let skipped = items.map((_, index) => Boolean(skippedRaw[index]));
    if (value && typeof value === "object" && value.answers && typeof value.answers === "object") {
      const answersObject = value.answers;
      const orderedAnswers = Array.isArray(value.checklistItemIds)
        ? value.checklistItemIds.map((id) => answersObject?.[id] || null)
        : Object.values(answersObject);
      skipped = skipped.map((current, index) => {
        const entry = orderedAnswers[index];
        if (!entry || typeof entry !== "object") {
          return current;
        }
        const rawSkip = Object.prototype.hasOwnProperty.call(entry, "skipped")
          ? entry.skipped
          : entry.skiped;
        const normalized = normalizeSkipValue(rawSkip);
        return current || normalized;
      });
    }
    let consideredTotal = 0;
    let completed = 0;
    items.forEach((checked, index) => {
      if (skipped[index]) {
        return;
      }
      consideredTotal += 1;
      if (checked) {
        completed += 1;
      }
    });
    if (consideredTotal === 0) {
      const hinted = Number(value?.percentage);
      if (Number.isFinite(hinted)) {
        return hinted / 100;
      }
      return 0;
    }
    return completed / consideredTotal;
  }
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
  return snap.docs.map((d) => {
    const data = d.data() || {};
    const dateKey = typeof data.dateKey === "string" && data.dateKey.trim() ? data.dateKey.trim() : d.id;
    return { id: d.id, date: dateKey, ...data };
  });
}

async function resolveHistoryResponseRef(db, uid, consigneId, dayKey, options = {}) {
  if (!db || !uid || !consigneId) {
    return null;
  }
  const explicitId = typeof options.responseId === "string" && options.responseId.trim()
    ? options.responseId.trim()
    : "";
  if (explicitId) {
    try {
      return doc(db, "u", uid, "responses", explicitId);
    } catch (error) {
      console.warn("history.resolveResponseRef:doc", error);
    }
  }
  const lookupDayKey = typeof options.responseDayKey === "string" && options.responseDayKey.trim()
    ? options.responseDayKey.trim()
    : typeof dayKey === "string"
    ? dayKey
    : "";
  if (!lookupDayKey) {
    return null;
  }
  try {
    const qy = query(
      collection(db, "u", uid, "responses"),
      where("consigneId", "==", consigneId),
      where("dayKey", "==", lookupDayKey),
      limit(1)
    );
    const snap = await getDocs(qy);
    const docSnap = Array.isArray(snap?.docs) && snap.docs.length ? snap.docs[0] : null;
    return docSnap ? docSnap.ref : null;
  } catch (error) {
    console.warn("history.resolveResponseRef:query", error);
    return null;
  }
}

async function syncHistoryResponse(db, uid, consigneId, dayKey, data = {}, options = {}) {
  if (!db || !uid || !consigneId || !dayKey) {
    return;
  }
  const hasSyncMetadata = Boolean(
    (typeof options.responseId === "string" && options.responseId.trim())
      || (typeof options.responseDayKey === "string" && options.responseDayKey.trim())
  );
  if (!hasSyncMetadata) {
    return;
  }
  const hasValue = Object.prototype.hasOwnProperty.call(data, "value");
  const hasNote = Object.prototype.hasOwnProperty.call(data, "note");
  if (!hasValue && !hasNote) {
    return;
  }
  const ref = await resolveHistoryResponseRef(db, uid, consigneId, dayKey, options);
  const payload = { updatedAt: now() };
  if (hasValue) {
    payload.value = data.value;
  }
  if (hasNote) {
    const noteValue = data.note;
    if (noteValue && String(noteValue).trim()) {
      payload.note = noteValue;
    } else {
      payload.note = deleteField();
    }
  }
  if (ref) {
    try {
      await setDoc(ref, payload, { merge: true });
      return;
    } catch (error) {
      console.warn("history.syncResponse:update", error);
    }
  }
  const shouldCreate = (hasValue && data.value !== "" && data.value != null)
    || (hasNote && data.note && String(data.note).trim());
  if (!shouldCreate) {
    return;
  }
  const responsePayload = {
    ownerUid: uid,
    consigneId,
    value: hasValue ? data.value : "",
    createdAt: options.responseCreatedAt || now(),
  };
  const responseMode = options.responseMode || options.mode || "";
  if (responseMode) {
    responsePayload.mode = responseMode;
  }
  const responseType = options.responseType || options.type || "";
  if (responseType) {
    responsePayload.type = responseType;
  }
  const effectiveDayKey = options.responseDayKey || dayKey;
  if (effectiveDayKey) {
    responsePayload.dayKey = effectiveDayKey;
    const parsedDay = parseDayKeyToDate(effectiveDayKey) || parseHistoryDate(effectiveDayKey);
    if (parsedDay) {
      const ts = toFirestoreTimestamp(parsedDay);
      if (ts) {
        responsePayload.pageDate = ts;
      }
      responsePayload.pageDateIso = dayKeyFromDate(parsedDay);
      const range = weekRangeFromDate(parsedDay, 0);
      if (range?.start) {
        responsePayload.weekStart = dayKeyFromDate(range.start);
      }
      responsePayload.pageDayIndex = ((parsedDay.getDay() + 6) % 7 + 7) % 7;
    }
  }
  if (hasNote && data.note && String(data.note).trim()) {
    responsePayload.note = data.note;
  }
  try {
    await addDoc(collection(db, "u", uid, "responses"), responsePayload);
  } catch (error) {
    console.warn("history.syncResponse:create", error);
  }
}

async function deleteHistoryResponse(db, uid, consigneId, dayKey, options = {}) {
  if (!db || !uid || !consigneId) {
    return;
  }
  const hasSyncMetadata = Boolean(
    (typeof options.responseId === "string" && options.responseId.trim())
      || (typeof options.responseDayKey === "string" && options.responseDayKey.trim())
  );
  if (!hasSyncMetadata) {
    return;
  }
  try {
    const ref = await resolveHistoryResponseRef(db, uid, consigneId, dayKey, options);
    if (ref) {
      await deleteDoc(ref);
    }
  } catch (error) {
    console.warn("history.syncResponse:delete", error);
  }
}

async function saveHistoryEntry(db, uid, consigneId, dateIso, data = {}, options = {}) {
  if (!db || !uid || !consigneId || !dateIso) {
    throw new Error("Paramètres manquants pour saveHistoryEntry");
  }
  const payload = { ...data, updatedAt: now() };
  await setDoc(doc(db, "u", uid, "history", consigneId, "entries", dateIso), payload, {
    merge: true,
  });
  await syncHistoryResponse(db, uid, consigneId, dateIso, data, options);
}

async function deleteHistoryEntry(db, uid, consigneId, dateIso, options = {}) {
  if (!db || !uid || !consigneId || !dateIso) {
    throw new Error("Paramètres manquants pour deleteHistoryEntry");
  }
  await deleteDoc(doc(db, "u", uid, "history", consigneId, "entries", dateIso));
  await deleteHistoryResponse(db, uid, consigneId, dateIso, options);
}

// --- utilitaires temps ---
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const copy = new Date(value.getTime());
    if (!Number.isNaN(copy.getTime())) {
      return copy;
    }
    return null;
  }
  if (typeof value?.toDate === "function") {
    try {
      const converted = value.toDate();
      if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
        return converted;
      }
    } catch (error) {
      schemaLog("toDate:convert:error", error);
    }
  }
  if (typeof value === "number") {
    const fromNumber = new Date(value);
    if (!Number.isNaN(fromNumber.getTime())) {
      return fromNumber;
    }
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [yearStr, monthStr, dayStr] = trimmed.split("-");
      const year = Number(yearStr);
      const month = Number(monthStr);
      const day = Number(dayStr);
      if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
        const parsed = new Date(year, (month || 1) - 1, day || 1);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function startOfDay(value) {
  const date = toDate(value);
  if (!date) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value) {
  const date = startOfDay(value);
  if (!date) return null;
  date.setHours(23, 59, 59, 999);
  return date;
}

function monthKeyFromDate(d) {
  const dt = d instanceof Date ? new Date(d.getTime()) : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  dt.setHours(0, 0, 0, 0);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

function yearKeyFromDate(d) {
  const dt = d instanceof Date ? new Date(d.getTime()) : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  dt.setHours(0, 0, 0, 0);
  return String(dt.getFullYear());
}

function monthRangeFromKey(monthKey) {
  const [yearStr, monthStr] = String(monthKey || "").split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  const start = new Date(year, month - 1, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(year, month, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function weekRangeFromDate(value, weekEndsOn = 0) {
  const target = startOfDay(value);
  if (!target) return null;
  const normalizedEnd = ((weekEndsOn % 7) + 7) % 7;
  const end = new Date(target.getTime());
  const toEnd = (7 + normalizedEnd - end.getDay()) % 7;
  end.setDate(end.getDate() + toEnd);
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getTime());
  start.setDate(end.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function weekKeyFromDate(value, weekEndsOn = 0) {
  const range = weekRangeFromDate(value, weekEndsOn);
  if (!range?.start) return "";
  return dayKeyFromDate(range.start);
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

async function listConsignesByObjective(db, uid, objectifId) {
  if (!objectifId) return [];
  const qy = query(
    col(db, uid, "consignes"),
    where("objectiveId", "==", objectifId)
  );
  const snap = await getDocs(qy);
  return snap.docs.map((docSnap) => hydrateConsigne(docSnap));
}

async function saveObjectiveEntry(db, uid, objectifId, dateIso, value) {
  const ref = doc(db, "u", uid, "objectiveEntries", objectifId, "entries", dateIso);
  await setDoc(ref, { v: value, at: serverTimestamp() }, { merge: true });
}

async function getObjectiveEntry(db, uid, objectifId, dateIso) {
  if (!db || !uid || !objectifId || !dateIso) return null;
  try {
    const ref = doc(db, "u", uid, "objectiveEntries", objectifId, "entries", dateIso);
    const snap = await getDoc(ref);
    if (!snapshotExists(snap)) {
      return null;
    }
    const data = snap.data() || {};
    return { id: snap.id, ...data };
  } catch (error) {
    console.warn("getObjectiveEntry", error);
    return null;
  }
}

async function loadObjectiveEntriesRange(db, uid, objectifId, _fromIso, _toIso) {
  const colRef = collection(db, "u", uid, "objectiveEntries", objectifId, "entries");
  const snap = await getDocs(colRef);
  return snap.docs.map((d) => ({ date: d.id, v: d.data().v }));
}

function summaryCollectionName(scope) {
  if (scope === "week" || scope === "weekly") return "weekly_summaries";
  if (scope === "month" || scope === "monthly") return "monthly_summaries";
  if (scope === "year" || scope === "yearly" || scope === "annual") return "yearly_summaries";
  return null;
}

function normalizeSummaryScopeValue(scope) {
  if (!scope) return "";
  const raw = String(scope).trim().toLowerCase();
  if (raw === "week" || raw === "weekly") return "weekly";
  if (raw === "month" || raw === "monthly") return "monthly";
  if (
    raw === "year" ||
    raw === "yearly" ||
    raw === "annual" ||
    raw === "annuel" ||
    raw === "annuelle" ||
    raw === "annee" ||
    raw === "année"
  ) {
    return "yearly";
  }
  return raw;
}

function summaryKeyToConsigneId(key) {
  if (typeof key !== "string") {
    return "";
  }
  const trimmed = key.trim();
  if (!trimmed) {
    return "";
  }
  const parts = trimmed.split("__");
  if (parts.length <= 1) {
    return trimmed;
  }
  return parts[parts.length - 1];
}

function sanitizeSummaryDocId(value) {
  if (!value) {
    return "";
  }
  return String(value)
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildSummaryResponseId(scope, periodKey, key, consigneId) {
  const normalizedScope = normalizeSummaryScopeValue(scope) || "summary";
  const parts = [normalizedScope];
  if (typeof periodKey === "string" && periodKey.trim()) {
    parts.push(periodKey.trim());
  }
  if (consigneId) {
    parts.push(consigneId);
  }
  if (key) {
    parts.push(key);
  }
  const raw = parts.filter(Boolean).join("_");
  const sanitized = sanitizeSummaryDocId(raw);
  return sanitized || `summary-${normalizedScope}-${newUid()}`;
}

function resolveSummaryBaseDate(metadata) {
  if (metadata?.end instanceof Date && !Number.isNaN(metadata.end.getTime())) {
    return metadata.end;
  }
  if (metadata?.start instanceof Date && !Number.isNaN(metadata.start.getTime())) {
    return metadata.start;
  }
  return null;
}

async function loadSummaryAnswers(db, uid, scope, periodKey) {
  if (!db || !uid || !scope || !periodKey) return new Map();
  const collectionName = summaryCollectionName(scope);
  if (!collectionName) return new Map();
  try {
    const answersRef = collection(db, "u", uid, collectionName, periodKey, "answers");
    const snap = await getDocs(answersRef);
    const entries = new Map();
    snap.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      entries.set(docSnap.id, { id: docSnap.id, ...data });
    });
    return entries;
  } catch (error) {
    schemaLog("loadSummaryAnswers:error", { scope, periodKey, error });
    return new Map();
  }
}

async function saveSummaryAnswers(db, uid, scope, periodKey, answers, metadata = {}) {
  if (!db || !uid || !scope || !periodKey) return;
  const collectionName = summaryCollectionName(scope);
  if (!collectionName) return;
  const baseRef = doc(db, "u", uid, collectionName, periodKey);
  const periodPayload = {
    scope,
    updatedAt: now(),
  };
  if (metadata?.start instanceof Date) {
    periodPayload.periodStart = metadata.start.toISOString();
  }
  if (metadata?.end instanceof Date) {
    periodPayload.periodEnd = metadata.end.toISOString();
  }
  if (metadata?.label) {
    periodPayload.label = metadata.label;
  }
  if (metadata?.extras && typeof metadata.extras === "object") {
    Object.assign(periodPayload, metadata.extras);
  }
  await setDoc(baseRef, periodPayload, { merge: true });
  if (!Array.isArray(answers) || !answers.length) {
    return;
  }
  const normalizedSummaryScope = metadata?.summaryScope || normalizeSummaryScopeValue(scope);
  const moduleId = metadata?.moduleId || "bilan";
  const defaultSummaryLabel = metadata?.summaryLabel
    || metadata?.label
    || (normalizedSummaryScope === "monthly"
      ? "Bilan mensuel"
      : normalizedSummaryScope === "weekly"
      ? "Bilan hebdomadaire"
      : normalizedSummaryScope === "yearly"
      ? "Bilan annuel"
      : "Bilan");
  const baseDate = resolveSummaryBaseDate(metadata);
  const createdAtIso = baseDate instanceof Date && !Number.isNaN(baseDate.getTime())
    ? baseDate.toISOString()
    : now();
  const summaryDayKeyInput = metadata?.summaryDayKey;
  let summaryDayKey = "";
  if (typeof summaryDayKeyInput === "string" && summaryDayKeyInput.trim()) {
    summaryDayKey = summaryDayKeyInput.trim();
  } else if (summaryDayKeyInput === false) {
    summaryDayKey = "";
  } else if (baseDate instanceof Date && typeof dayKeyFromDate === "function") {
    summaryDayKey = dayKeyFromDate(baseDate);
  }
  const periodStartIso = metadata?.start instanceof Date ? metadata.start.toISOString() : null;
  const periodEndIso = metadata?.end instanceof Date ? metadata.end.toISOString() : null;
  const writes = [];
  const responseWrites = [];
  answers.forEach((answer) => {
    if (!answer || !answer.key) return;
    const answerRef = doc(db, "u", uid, collectionName, periodKey, "answers", answer.key);
    const payload = {
      consigneId: answer.consigneId || null,
      family: answer.family || null,
      type: answer.type || null,
      value: answer.value,
      updatedAt: now(),
    };
    if (answer.label !== undefined) {
      payload.label = answer.label;
    }
    if (answer.category !== undefined) {
      payload.category = answer.category;
    }
    if (answer.summaryScope !== undefined) {
      payload.summaryScope = answer.summaryScope;
    } else if (normalizedSummaryScope) {
      payload.summaryScope = normalizedSummaryScope;
    }
    if (answer.summaryMode !== undefined) {
      payload.summaryMode = answer.summaryMode;
    } else if (moduleId) {
      payload.summaryMode = moduleId;
    }
    if (answer.summaryLabel !== undefined) {
      payload.summaryLabel = answer.summaryLabel;
    } else if (defaultSummaryLabel) {
      payload.summaryLabel = defaultSummaryLabel;
    }
    if (answer.summaryPeriod !== undefined) {
      payload.summaryPeriod = answer.summaryPeriod;
    } else if (periodKey) {
      payload.summaryPeriod = periodKey;
    }
    if (answer.summaryKey !== undefined) {
      payload.summaryKey = answer.summaryKey;
    } else if (answer.key) {
      payload.summaryKey = answer.key;
    }
    if (answer.source !== undefined) {
      payload.source = answer.source;
    } else if (moduleId) {
      payload.source = moduleId;
    }
    if (answer.origin !== undefined) {
      payload.origin = answer.origin;
    }
    if (answer.context !== undefined) {
      payload.context = answer.context;
    }
    if (moduleId) {
      payload.moduleId = moduleId;
    }
    if (metadata?.label) {
      payload.periodLabel = metadata.label;
    }
    writes.push(setDoc(answerRef, payload, { merge: true }));

    const consigneId = answer.consigneId || summaryKeyToConsigneId(answer.key);
    if (!consigneId) {
      return;
    }
    const responseWrite = (async () => {
      const responseId = buildSummaryResponseId(scope, periodKey, answer.key, consigneId);
      const responseRef = doc(db, "u", uid, "responses", responseId);
      let existingSnap = null;
      try {
        existingSnap = await getDoc(responseRef);
      } catch (error) {
        schemaLog("summaryResponse:load:error", { scope, periodKey, consigneId, error });
      }
      const hasExisting = snapshotExists(existingSnap);
      const existingData = hasExisting ? existingSnap.data() || {} : null;
      const responsePayload = {
        ownerUid: uid,
        consigneId,
        mode: "summary",
        value: answer.value,
        updatedAt: now(),
      };
      if (answer.type !== undefined) {
        responsePayload.type = answer.type;
      }
      if (answer.category !== undefined) {
        responsePayload.category = answer.category;
      }
      const summaryScopeValue = answer.summaryScope
        || payload.summaryScope
        || normalizedSummaryScope;
      if (summaryScopeValue) {
        responsePayload.summaryScope = summaryScopeValue;
        responsePayload.periodScope = summaryScopeValue;
      }
      const summaryModeValue = answer.summaryMode
        || payload.summaryMode
        || moduleId;
      if (summaryModeValue) {
        responsePayload.summaryMode = summaryModeValue;
      }
      const summaryLabelValue = answer.summaryLabel
        || payload.summaryLabel
        || defaultSummaryLabel;
      if (summaryLabelValue) {
        responsePayload.summaryLabel = summaryLabelValue;
      }
      const summaryPeriodValue = answer.summaryPeriod
        || payload.summaryPeriod
        || periodKey;
      if (summaryPeriodValue) {
        responsePayload.summaryPeriod = summaryPeriodValue;
        responsePayload.periodKey = summaryPeriodValue;
      }
      const summaryKeyValue = answer.summaryKey
        || payload.summaryKey
        || answer.key;
      if (summaryKeyValue) {
        responsePayload.summaryKey = summaryKeyValue;
      }
      const sourceValue = answer.source
        || payload.source
        || moduleId;
      if (sourceValue) {
        responsePayload.source = sourceValue;
      }
      const originValue = answer.origin
        || payload.origin
        || (summaryScopeValue ? `${moduleId}:${summaryScopeValue}` : moduleId);
      if (originValue) {
        responsePayload.origin = originValue;
      }
      const contextValue = answer.context
        || payload.context
        || [moduleId, summaryScopeValue || null, periodKey || null].filter(Boolean).join(":");
      if (contextValue) {
        responsePayload.context = contextValue;
      }
      if (moduleId) {
        responsePayload.moduleId = moduleId;
      }
      if (metadata?.label) {
        responsePayload.period = metadata.label;
        responsePayload.periodLabel = metadata.label;
      }
      if (summaryDayKey) {
        responsePayload.dayKey = summaryDayKey;
      }
      if (periodStartIso) {
        responsePayload.periodStart = periodStartIso;
      }
      if (periodEndIso) {
        responsePayload.periodEnd = periodEndIso;
      }
      if (metadata?.extras?.weekEndsOn !== undefined) {
        responsePayload.weekEndsOn = metadata.extras.weekEndsOn;
      }
      if (metadata?.extras?.weekKey) {
        responsePayload.weekKey = metadata.extras.weekKey;
      }
      if (metadata?.extras?.monthKey) {
        responsePayload.monthKey = metadata.extras.monthKey;
      }
      if (metadata?.extras?.summaryScope && !responsePayload.summaryScope) {
        responsePayload.summaryScope = metadata.extras.summaryScope;
      }
      if (answer.note !== undefined) {
        responsePayload.note = answer.note;
      }
      if (!hasExisting) {
        responsePayload.createdAt = createdAtIso;
      }
      try {
        await setDoc(responseRef, responsePayload, { merge: true });
      } catch (error) {
        schemaLog("summaryResponse:save:error", { scope, periodKey, consigneId, error });
        return null;
      }
      const createdAtValue = hasExisting
        ? existingData?.createdAt ?? createdAtIso
        : responsePayload.createdAt ?? createdAtIso;
      return {
        id: responseId,
        consigneId,
        value: answer.value,
        type: answer.type || null,
        mode: "summary",
        note: responsePayload.note ?? null,
        summaryScope: responsePayload.summaryScope || null,
        summaryMode: responsePayload.summaryMode || null,
        summaryLabel: responsePayload.summaryLabel || null,
        summaryPeriod: responsePayload.summaryPeriod || null,
        summaryKey: responsePayload.summaryKey || null,
        source: responsePayload.source || null,
        origin: responsePayload.origin || null,
        context: responsePayload.context || null,
        moduleId: responsePayload.moduleId || null,
        category: responsePayload.category || null,
        period: responsePayload.period || null,
        periodLabel: responsePayload.periodLabel || null,
        periodScope: responsePayload.periodScope || null,
        periodKey: responsePayload.periodKey || null,
        periodStart: responsePayload.periodStart || null,
        periodEnd: responsePayload.periodEnd || null,
        weekEndsOn: responsePayload.weekEndsOn ?? null,
        weekKey: responsePayload.weekKey || null,
        monthKey: responsePayload.monthKey || null,
        dayKey: responsePayload.dayKey || null,
        historyKey: responseId,
        createdAt: createdAtValue,
      };
    })();
    responseWrites.push(responseWrite);
  });
  if (writes.length) {
    await Promise.all(writes);
  }
  if (responseWrites.length) {
    const entries = (await Promise.all(responseWrites)).filter(Boolean);
    if (entries.length) {
      registerRecentResponses("summary", entries);
      try {
        await persistResponsesToHistory(db, uid, entries);
      } catch (error) {
        schemaLog("summaryResponse:history:error", { scope, periodKey, error });
      }
    }
  }
}

async function deleteSummaryAnswer(db, uid, scope, periodKey, answerKey, metadata = {}) {
  if (!db || !uid || !scope || !periodKey || !answerKey) return;
  const collectionName = summaryCollectionName(scope);
  if (!collectionName) return;
  const baseRef = doc(db, "u", uid, collectionName, periodKey);
  const periodPayload = {
    scope,
    updatedAt: now(),
  };
  if (metadata?.start instanceof Date) {
    periodPayload.periodStart = metadata.start.toISOString();
  }
  if (metadata?.end instanceof Date) {
    periodPayload.periodEnd = metadata.end.toISOString();
  }
  if (metadata?.label) {
    periodPayload.label = metadata.label;
  }
  if (metadata?.extras && typeof metadata.extras === "object") {
    Object.assign(periodPayload, metadata.extras);
  }
  await setDoc(baseRef, periodPayload, { merge: true });
  const answerRef = doc(db, "u", uid, collectionName, periodKey, "answers", answerKey);
  await deleteDoc(answerRef);
  const consigneId = summaryKeyToConsigneId(answerKey);
  if (consigneId) {
    const responseId = buildSummaryResponseId(scope, periodKey, answerKey, consigneId);
    try {
      await deleteDoc(doc(db, "u", uid, "responses", responseId));
    } catch (error) {
      schemaLog("summaryResponse:delete:error", { scope, periodKey, consigneId, error });
    }
    const store = ensureRecentResponseStore?.();
    if (store instanceof Map) {
      store.delete(consigneId);
    }
  }
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
  reorderCategories,
  newUid,
  readSRState,
  upsertSRState,
  savePushToken,
  disablePushToken,
  likertScore,
  nextCooldownAfterAnswer,
  resetSRForConsigne,
  delayConsigne,
  saveResponses,
  countPracticeSessions,
  fetchPracticeSessions,
  startNewPracticeSession,
  listConsignesByMode,
  fetchConsignes,
  listChildConsignes,
  addConsigne,
  logConsigneHistoryEntry,
  updateConsigne,
  updateConsigneOrder,
  softDeleteConsigne,
  saveResponse,
  fetchHistory,
  fetchResponsesForConsigne,
  fetchDailyResponses,
  generateChecklistItemId,
  normalizeChecklistItems,
  normalizeChecklistItemIds,
  valueToNumericPoint,
  listConsignesByCategory,
  loadConsigneHistory,
  saveHistoryEntry,
  deleteHistoryEntry,
  toDate,
  startOfDay,
  endOfDay,
  monthKeyFromDate,
  yearKeyFromDate,
  monthRangeFromKey,
  weekRangeFromDate,
  weekKeyFromDate,
  weeksOf,
  weekOfMonthFromDate,
  weekDateRange,
  listObjectivesByMonth,
  getObjective,
  upsertObjective,
  deleteObjective,
  linkConsigneToObjective,
  listConsignesByObjective,
  saveObjectiveEntry,
  getObjectiveEntry,
  loadObjectiveEntriesRange,
  loadSummaryAnswers,
  saveSummaryAnswers,
  deleteSummaryAnswer,
  summaryCollectionName,
  loadModuleSettings,
  saveModuleSettings,
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    monthKeyFromDate,
    weeksOf,
    weekOfMonthFromDate,
    weekDateRange,
    loadModuleSettings,
    saveModuleSettings,
  };
}

