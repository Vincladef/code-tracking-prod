// schema.js — data types, helpers, spaced repetition logic (version sous-collections /users/{uid}/...)
import {
  collection, doc, setDoc, getDoc, getDocs, addDoc, query, where, orderBy, serverTimestamp, updateDoc, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- helpers chemin + logger global ---
export const col = (db, uid, name) => collection(db, "users", uid, name);
export const docIn = (db, uid, name, id) => doc(db, "users", uid, name, id);

// petit logger global activable par URL: #/u/UID?debug=1
const _DEBUG = new URLSearchParams(location.hash.split("?")[1] || "").get("debug") === "1"
  || localStorage.getItem("debug") === "1";
export const D = {
  on: _DEBUG,
  set(v){ localStorage.setItem("debug", v ? "1" : "0"); this.on = !!v; console.info("[debug]=", this.on); },
  group(label){ if(this.on) console.group(label); },
  groupEnd(){ if(this.on) console.groupEnd(); },
  info(...a){ if(this.on) console.info(...a); },
  warn(...a){ if(this.on) console.warn(...a); },
  error(...a){ console.error(...a); } // toujours visible
};
// --- Fin des helpers + logger ---

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
  D.group("schema.fetchCategories");
  const qy = query(col(db, uid, "categories"), orderBy("name"));
  const ss = await getDocs(qy);
  D.info("Found", ss.docs.length, "categories");
  D.groupEnd();
  return ss.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function ensureCategory(db, uid, name, mode){
  D.group("schema.ensureCategory", name, mode);
  const qy = query(col(db, uid, "categories"),
    where("name","==",name), where("mode","==",mode), limit(1));
  const snap = await getDocs(qy);
  if (!snap.empty) {
    D.info("category found", snap.docs[0].id);
    D.groupEnd();
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  const ref = await addDoc(col(db, uid, "categories"), {
    ownerUid: uid, name, mode, createdAt: now()
  });
  D.info("category created", ref.id);
  D.groupEnd();
  return { id: ref.id, ownerUid: uid, name, mode };
}

// Fonction pour l'admin, utilise la collection racine "users"
export async function createUser(db, name) {
  // This function is for admin-side user creation.
  const id = "u-" + Math.random().toString(36).slice(2,10);
  D.info(`Creating user ${id}`);
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
  D.group("schema.upsertSRState", consigneId);
  const id = `${consigneId}_${mode}`;
  const ref = docIn(db, uid, "srStates", id);
  const prev = await getDoc(ref);
  const base = prev.exists() ? prev.data() : { ownerUid: uid, consigneId, mode, score: 0 };
  D.info("patching with", patch);
  await setDoc(ref, { ...base, ...patch, updatedAt: now(), ownerUid: uid }, { merge: true });
  D.groupEnd();
  return (await getDoc(ref)).data();
}

export async function readSRState(db, uid, consigneId, mode){
  D.group("schema.readSRState", consigneId);
  const id = `${consigneId}_${mode}`;
  const ref = docIn(db, uid, "srStates", id);
  const s = await getDoc(ref);
  D.info("found:", s.exists());
  D.groupEnd();
  return s.exists() ? s.data() : null;
}

// --- Nouvelles collections /u/{uid}/... ---
// NOTE: These functions need to be added to the schema.js
//       as they are not present in the user's initial code block.

export async function fetchConsignes(db, uid, mode) {
  D.group("schema.fetchConsignes", mode);
  const qy = query(
    col(db, uid, "consignes"),
    where("mode", "==", mode),
    where("active", "==", true),
    orderBy("priority")
  );
  const ss = await getDocs(qy);
  D.info("Found", ss.docs.length, "consignes");
  D.groupEnd();
  return ss.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addConsigne(db, uid, payload) {
  D.group("schema.addConsigne");
  const ref = await addDoc(col(db, uid, "consignes"), { ...payload, createdAt: now() });
  D.info("Consigne created with ID:", ref.id);
  D.groupEnd();
  return ref;
}

export async function updateConsigne(db, uid, id, payload) {
  D.group("schema.updateConsigne", id);
  const ref = docIn(db, uid, "consignes", id);
  await updateDoc(ref, { ...payload, updatedAt: now() });
  D.info("Consigne updated");
  D.groupEnd();
}

export async function saveResponse(db, uid, consigne, value) {
  D.group("schema.saveResponse", consigne.id);
  const payload = {
    ownerUid: uid,
    consigneId: consigne.id,
    mode: consigne.mode,
    value,
    createdAt: now(),
  };
  const ref = await addDoc(col(db, uid, "responses"), payload);
  D.info("Response saved with ID:", ref.id);
  D.groupEnd();
}

export async function fetchHistory(db, uid, count = 200) {
  D.group("schema.fetchHistory", count);
  const qy = query(
    col(db, uid, "responses"),
    orderBy("createdAt", "desc"),
    limit(count)
  );
  const ss = await getDocs(qy);
  D.info("Found", ss.docs.length, "history entries");
  D.groupEnd();
  return ss.docs.map(d => d.data());
}

export async function startNewPracticeSession(db, uid) {
  D.group("schema.startNewPracticeSession");
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
    D.info(`Decrementing cooldown for ${d.id} from ${v} to ${Math.max(0, v - 1)}`);
    await updateDoc(ref, { cooldownSessions: Math.max(0, v - 1), updatedAt: now() });
  }

  // Create a session doc
  const sessionRef = await addDoc(col(db, uid, "sessions"), {
    ownerUid: uid,
    startedAt: now()
  });
  D.info("New practice session created:", sessionRef.id);
  D.groupEnd();
}