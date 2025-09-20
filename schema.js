// --- DEBUG LOGGER (utilisé par index.html et app.js)
export const D = {
  on: true, // passe à false pour couper le tiroir de logs
  info:  (...a) => console.info(...a),
  warn:  (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
  group: (...a) => console.group(...a),
  groupEnd:     () => console.groupEnd(),
};
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
  const qy = query(col(db, uid, "categories"), orderBy("name"));
  const ss = await getDocs(qy);
  return ss.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function ensureCategory(db, uid, name, mode){
  const qy = query(col(db, uid, "categories"),
    where("name","==",name), where("mode","==",mode), limit(1));
  const snap = await getDocs(qy);
  if (!snap.empty) {
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  const ref = await addDoc(col(db, uid, "categories"), {
    ownerUid: uid, name, mode, createdAt: now()
  });
  return { id: ref.id, ownerUid: uid, name, mode };
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
  const id = `${consigneId}_${mode}`;
  const ref = docIn(db, uid, "srStates", id);
  const prev = await getDoc(ref);
  const base = prev.exists() ? prev.data() : { ownerUid: uid, consigneId, mode, score: 0 };
  await setDoc(ref, { ...base, ...patch, updatedAt: now(), ownerUid: uid }, { merge: true });
  return (await getDoc(ref)).data();
}

export async function readSRState(db, uid, consigneId, mode){
  const id = `${consigneId}_${mode}`;
  const ref = docIn(db, uid, "srStates", id);
  const s = await getDoc(ref);
  return s.exists() ? s.data() : null;
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
  return ss.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addConsigne(db, uid, payload) {
  const ref = await addDoc(col(db, uid, "consignes"), { ...payload, createdAt: now() });
  return ref;
}

export async function updateConsigne(db, uid, id, payload) {
  const ref = docIn(db, uid, "consignes", id);
  await updateDoc(ref, { ...payload, updatedAt: now() });
}

export async function saveResponse(db, uid, consigne, value) {
  const payload = {
    ownerUid: uid,
    consigneId: consigne.id,
    mode: consigne.mode,
    value,
    createdAt: now(),
  };
  const ref = await addDoc(col(db, uid, "responses"), payload);
}

export async function fetchHistory(db, uid, count = 200) {
  const qy = query(
    col(db, uid, "responses"),
    orderBy("createdAt", "desc"),
    limit(count)
  );
  const ss = await getDocs(qy);
  return ss.docs.map(d => d.data());
}

export async function startNewPracticeSession(db, uid) {
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
  }

  // Create a session doc
  const sessionRef = await addDoc(col(db, uid, "sessions"), {
    ownerUid: uid,
    startedAt: now()
  });
}
