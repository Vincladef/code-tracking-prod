// --- DEBUG LOGGER (utilisé par index.html et app.js)
export const D = {
  on: false,
  group: (...a)=>{ if (false) console.group(...a); },
  groupEnd: ()=>{ if (false) console.groupEnd(); },
  info: (...a)=>{ if (false) console.info(...a); },
  warn: (...a)=>{ if (false) console.warn(...a); },
  error: (...a)=> console.error(...a),
};
const log = (...args) => console.debug("[schema]", ...args);
// --- Helpers de chemin /u/{uid}/...
import {
  collection, doc, setDoc, getDoc, getDocs, addDoc, query, where, orderBy, updateDoc, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const now = () => new Date().toISOString();
export const col = (db, uid, sub) => collection(db, "u", uid, sub);
export const docIn = (db, uid, sub, id) => doc(db, "u", uid, sub, id);

// Timestamp lisible (les graphs lisent une chaîne)
export const todayKey = (d = new Date()) => d.toISOString().slice(0,10); // YYYY-MM-DD

export const PRIORITIES = ["high","medium","low"];
export const MODES = ["daily","practice"];
export const TYPES = ["short","long","likert6","num"];

export const LIKERT = ["no_answer","no","rather_no","medium","rather_yes","yes"];
export const LIKERT_POINTS = {
  no_answer: 0,
  no: 0,
  rather_no: 0,
  medium: 0,
  rather_yes: 0.5,
  yes: 1
};

// --- Catégories & Users ---
export async function fetchCategories(db, uid){
  log("fetchCategories:start", { uid });
  const qy = query(col(db, uid, "categories"), orderBy("name"));
  const ss = await getDocs(qy);
  const data = ss.docs.map(d => ({ id: d.id, ...d.data() }));
  log("fetchCategories:done", { uid, count: data.length });
  return data;
}

export async function ensureCategory(db, uid, name, mode){
  log("ensureCategory:start", { uid, name, mode });
  const qy = query(col(db, uid, "categories"),
    where("name","==",name), where("mode","==",mode), limit(1));
  const snap = await getDocs(qy);
  if (!snap.empty) {
    const existing = { id: snap.docs[0].id, ...snap.docs[0].data() };
    log("ensureCategory:hit", { uid, id: existing.id });
    return existing;
  }
  const ref = await addDoc(col(db, uid, "categories"), {
    ownerUid: uid, name, mode, createdAt: now()
  });
  const created = { id: ref.id, ownerUid: uid, name, mode };
  log("ensureCategory:created", { uid, id: created.id });
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

// score pour likert -> 0 / 0.5 / 1
export function likertScore(v) {
  return ({ yes: 1, rather_yes: 0.5, medium: 0, rather_no: 0, no: 0, no_answer: 0 })[v] ?? 0;
}

// calcule la prochaine “masque” (journalier=jours, pratique=sessions)
export function nextCooldownAfterAnswer(meta, prevState, value) {
  // meta.mode === "daily" | "practice", meta.type (likert6/num/short/long)
  let inc = 0;
  if (meta.type === "likert6") inc = likertScore(value);
  else if (meta.type === "num") inc = Number(value) >= 7 ? 1 : (Number(value) >= 5 ? 0.5 : 0); // simple
  else inc = 1; // texte => on considère “ok”

  let streak = (prevState?.streak || 0);
  streak = inc > 0 ? (streak + inc) : 0;

  if (meta.mode === "daily") {
    const days = Math.floor(streak); // masque N jours
    const until = new Date();
    until.setDate(until.getDate() + days);
    return { streak, hideUntil: until.toISOString() };
  } else {
    const steps = Math.floor(streak); // masque N sessions
    const nextAllowedIndex = (prevState?.nextAllowedIndex || 0) + steps;
    return { streak, nextAllowedIndex };
  }
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
    // SR
    const prev = await readSRState(db, uid, a.consigne.id, "consigne");
    const upd = nextCooldownAfterAnswer({ mode, type: a.consigne.type }, prev, a.value);
    await upsertSRState(db, uid, a.consigne.id, "consigne", upd);

    // write
    batch.push(addDoc(col(db, uid, "responses"), payload));
  }
  await Promise.all(batch);
}

// list consignes par mode
export async function listConsignesByMode(db, uid, mode) {
  const qy = query(col(db, uid, "consignes"), where("mode", "==", mode), where("active", "==", true));
  const ss = await getDocs(qy);
  return ss.docs.map(d => ({ id: d.id, ...d.data() }));
}

// --- Nouvelles collections /u/{uid}/... ---
export async function fetchConsignes(db, uid, mode) {
  log("fetchConsignes:start", { uid, mode });
  const qy = query(
    col(db, uid, "consignes"),
    where("mode", "==", mode),
    where("active", "==", true),
    orderBy("priority")
  );
  const ss = await getDocs(qy);
  const data = ss.docs.map(d => ({ id: d.id, ...d.data() }));
  log("fetchConsignes:done", { uid, mode, count: data.length });
  return data;
}

export async function addConsigne(db, uid, payload) {
  log("addConsigne:start", { uid, payload });
  const ref = await addDoc(col(db, uid, "consignes"), { ...payload, createdAt: now() });
  log("addConsigne:done", { uid, id: ref.id });
  return ref;
}

export async function updateConsigne(db, uid, id, payload) {
  log("updateConsigne:start", { uid, id, payload });
  const ref = docIn(db, uid, "consignes", id);
  await updateDoc(ref, { ...payload, updatedAt: now() });
  log("updateConsigne:done", { uid, id });
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
  if (type === "num") return Number(value) || 0;
  return null; // pour short/long -> pas de graph
}

