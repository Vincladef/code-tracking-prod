// schema.js — data types, helpers, spaced repetition logic
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, query, where, orderBy, serverTimestamp, updateDoc
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

export async function generateSlug(db){
  // naive human-ish slug
  const id = Math.random().toString(36).slice(2,8);
  const slug = "user-" + id;
  return slug;
}

export async function fetchCategories(db, uid){
  const q = query(collection(db,"categories"), where("ownerUid","==",uid), orderBy("name"));
  const ss = await getDocs(q);
  return ss.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function ensureCategory(db, uid, name, mode){
  // upsert by name+mode
  const q = query(collection(db,"categories"),
    where("ownerUid","==",uid), where("name","==",name), where("mode","==",mode), limit(1));
  const snap = await getDocs(q);
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  const ref = await addDoc(collection(db,"categories"), {
    ownerUid: uid, name, mode, createdAt: now()
  });
  return { id: ref.id, ownerUid: uid, name, mode };
}

export function isDueToday(consigne, srState, date = new Date()){
  // Frequency: daily or specific days of week; and spaced repetition cooldown
  const day = date.getDay(); // 0 Sun .. 6 Sat
  if (consigne.frequency?.type === "daysOfWeek"){
    const arr = consigne.frequency.days || [];
    if (!arr.includes(day)) return false;
  }
  // else daily: always due
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
  // returns updated {score, cooldownUntil | cooldownSessions}
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

export async function upsertSRState(db, uid, consigneId, mode, patch){
  const id = `${uid}_${consigneId}_${mode}`;
  const ref = doc(db, "srStates", id);
  const prev = await getDoc(ref);
  const base = prev.exists() ? prev.data() : { ownerUid: uid, consigneId, mode, score: 0 };
  await setDoc(ref, { ...base, ...patch, updatedAt: now() }, { merge: true });
  return (await getDoc(ref)).data();
}

export async function readSRState(db, uid, consigneId, mode){
  const id = `${uid}_${consigneId}_${mode}`;
  const ref = doc(db, "srStates", id);
  const s = await getDoc(ref);
  return s.exists() ? s.data() : null;
}
