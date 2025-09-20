// schema.js — data types, helpers, spaced repetition logic (version sous-collections /users/{uid}/...)
import {
  collection, doc, setDoc, getDoc, getDocs, addDoc, query, where, orderBy, serverTimestamp, updateDoc, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

// --- Helpers chemins sous-collections ---
export const colRef = (db, uid, name) => collection(db, `users/${uid}/${name}`);
export const docRef = (db, uid, name, id) => doc(db, `users/${uid}/${name}/${id}`);

// --- Catégories & Users ---
export async function fetchCategories(db, uid){
  const qy = query(colRef(db, uid, "categories"), orderBy("name"));
  const ss = await getDocs(qy);
  return ss.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function ensureCategory(db, uid, name, mode){
  // upsert par name+mode
  const qy = query(colRef(db, uid, "categories"),
    where("name","==",name), where("mode","==",mode), limit(1));
  const snap = await getDocs(qy);
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  const ref = await addDoc(colRef(db, uid, "categories"), {
    ownerUid: uid, name, mode, createdAt: now()
  });
  return { id: ref.id, ownerUid: uid, name, mode };
}

export async function createUser(db, name) {
  // Si tu crées des users côté admin, c’est via /users/{uid} directement (voir app.js)
  // Cette fonction est conservée si besoin d’un helper distinct.
  const id = "u-" + Math.random().toString(36).slice(2,10);
  return { id, name };
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
  const ref = docRef(db, uid, "srStates", id);
  const prev = await getDoc(ref);
  const base = prev.exists() ? prev.data() : { ownerUid: uid, consigneId, mode, score: 0 };
  await setDoc(ref, { ...base, ...patch, updatedAt: now(), ownerUid: uid }, { merge: true });
  return (await getDoc(ref)).data();
}

export async function readSRState(db, uid, consigneId, mode){
  const id = `${consigneId}_${mode}`;
  const ref = docRef(db, uid, "srStates", id);
  const s = await getDoc(ref);
  return s.exists() ? s.data() : null;
}
