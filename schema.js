// --- DEBUG LOGGER (utilisé par index.html et app.js)
export const D = {
  on: false, // passe à true pour voir le tiroir de logs
  info:  (...a) => D.on && console.info(...a),
  warn:  (...a) => D.on && console.warn(...a),
  error: (...a) => D.on && console.error(...a),
  group: (...a) => D.on && console.group(...a),
  groupEnd:     () => D.on && console.groupEnd(),
};
const log = (...args) => console.debug("[schema]", ...args);
// --- Helpers de chemin /u/{uid}/...
import {
  collection, doc, setDoc, getDoc, getDocs, addDoc, query, where, orderBy, updateDoc, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const col   = (db, uid, name)       => collection(db, "u", uid, name);
export const docIn = (db, uid, name, id)   => doc(db, "u", uid, name, id);

// Timestamp lisible (les graphs lisent une chaîne)
export const now = () => new Date().toISOString();
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

// --- Algo : due & spaced repetition ---
export function isDueToday(consigne, srState, date = new Date()){
  const day = date.getDay(); // 0 Sun .. 6 Sat
  if (consigne.frequency?.type === "daysOfWeek"){
    const arr = consigne.frequency.days || [];
    if (!arr.includes(day)) return false;
  }
  if (!consigne.spacedRepetitionEnabled) return true;
  if (consigne.mode === "daily"){
    if (!srState || !srState.cooldownUntil) return true;
    const today = todayKey(date);
    return srState.cooldownUntil < today;
  } else if (consigne.mode === "practice"){
    if (!srState) return true;
    return (srState.cooldownSessions || 0) <= 0;
  }
  return true;
}

export function nextCooldownAfterAnswer(consigne, srState, answerKind){
  const pts = (consigne.type === "likert6") ? LIKERT_POINTS[answerKind] ?? 0
              : (consigne.type === "num") ? (Number(answerKind) >= 8 ? 1 : Number(answerKind) >= 6 ? 0.5 : 0)
              : (consigne.type === "short" || consigne.type === "long") ? 1 : 0;
  const positive = pts > 0;
  let score = (srState?.score || 0);
  if (!positive){
    score = 0;
    return consigne.mode === "daily"
      ? { score, cooldownUntil: null }
      : { score, cooldownSessions: 0 };
  }
  score = Number((score + pts).toFixed(2));
  const hideUnits = Math.floor(score);
  if (consigne.mode === "daily"){
    if (hideUnits <= 0){
      return { score, cooldownUntil: null };
    } else {
      const base = new Date();
      base.setDate(base.getDate() + hideUnits);
      return { score, cooldownUntil: todayKey(base) };
    }
  } else {
    return { score, cooldownSessions: hideUnits };
  }
}

// --- SR state dans /users/{uid}/srStates ---
export async function upsertSRState(db, uid, consigneId, mode, patch){
  log("upsertSRState:start", { uid, consigneId, mode, patch });
  const id = `${consigneId}_${mode}`;
  const ref = docIn(db, uid, "srStates", id);
  const prev = await getDoc(ref);
  const base = prev.exists() ? prev.data() : { ownerUid: uid, consigneId, mode, score: 0 };
  await setDoc(ref, { ...base, ...patch, updatedAt: now(), ownerUid: uid }, { merge: true });
  const stored = (await getDoc(ref)).data();
  log("upsertSRState:done", { uid, consigneId, mode, stored });
  return stored;
}

export async function readSRState(db, uid, consigneId, mode){
  log("readSRState:start", { uid, consigneId, mode });
  const id = `${consigneId}_${mode}`;
  const ref = docIn(db, uid, "srStates", id);
  const s = await getDoc(ref);
  const data = s.exists() ? s.data() : null;
  log("readSRState:done", { uid, consigneId, mode, found: !!data });
  return data;
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

export async function startNewPracticeSession(db, uid) {
  log("startNewPracticeSession:start", { uid });
  // Decrement cooldownSessions for all practice SR states > 0
  const qy = query(
    col(db, uid, "srStates"),
    where("mode", "==", "practice"),
    where("cooldownSessions", ">", 0)
  );
  const ss = await getDocs(qy);
  for (const d of ss.docs) {
    const ref = doc(db, d.ref.path);
    const v = d.data().cooldownSessions || 0;
    await updateDoc(ref, { cooldownSessions: Math.max(0, v - 1), updatedAt: now() });
    log("startNewPracticeSession:decrement", { uid, consigneId: d.data().consigneId, previous: v });
  }

  // Create a session doc
  const sessionRef = await addDoc(col(db, uid, "sessions"), {
    ownerUid: uid,
    startedAt: now()
  });
  log("startNewPracticeSession:sessionCreated", { uid, sessionId: sessionRef.id });
}
