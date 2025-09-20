// app.js — bootstrapping, routing, context, nav
import {
  getFirestore, doc, setDoc, getDoc, collection, query, where, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as Schema from "./schema.js";
import * as Modes from "./modes.js";
import * as Goals from "./goals.js";

// --- logger ---
const L = Schema.D;
function logStep(step, data) {
  L.group(step);
  if (data) L.info(data);
  L.groupEnd();
}

export const ctx = {
  app: null,
  db: null,
  user: null,         // { uid } passed by index.html
  profile: null,     // profile doc
  categories: [],
  route: "#/dashboard",
};

function $(sel){ return document.querySelector(sel); }
function $$ (sel){ return Array.from(document.querySelectorAll(sel)); }

function routeTo(hash){
  if (!hash) hash = "#/dashboard";
  ctx.route = hash;
  window.location.hash = hash;
  render();
}

// NOTE: This function is replaced by the call to Schema.ensureProfile(db, uid)
// so it is no longer needed. The profile logic is now centralized in schema.js.
/*
async function ensureProfile(){
  const uid = ctx.user.uid;
  const ref = doc(ctx.db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    const slug = await Schema.generateSlug(ctx.db);
    const profile = {
      ownerUid: uid,
      displayName: "Invité",
      slug, createdAt: Schema.now(),
      email: "",
    };
    await setDoc(ref, profile, { merge: true });
    return profile;
  } else {
    return snap.data();
  }
}
*/

async function loadCategories(){
  // Categories are per user, default fallback if empty
  const uid = ctx.user.uid;
  const cats = await Schema.fetchCategories(ctx.db, uid);
  ctx.categories = cats;
  renderSidebar();
}

function renderSidebar(){
  const box = $("#profile-box");
  if (!box) return;
  const link = `${location.origin}${location.pathname}#/u/${ctx.user.uid}`;
  box.innerHTML = `
    <div><strong>${ctx.profile.displayName || "Utilisateur"}</strong></div>
    <div class="muted">UID : <code>${ctx.user.uid}</code></div>
    <div class="muted">Lien direct : <a class="link" href="${link}">${link}</a></div>
  `;
  const catBox = $("#category-box");
  if (!catBox) return;
  if (!ctx.categories.length){
    catBox.innerHTML = '<span class="muted">Aucune catégorie. Elles seront créées automatiquement lors de l’ajout d’une consigne.</span>';
  } else {
    catBox.innerHTML = ctx.categories.map(c => `<div class="flex"><span>${c.name}</span><span class="pill">${c.mode}</span></div>`).join("");
  }
}

function bindNav(){
  $$("button[data-route]").forEach(btn => {
    btn.onclick = () => routeTo(btn.getAttribute("data-route"));
  });
  $("#btn-new-session").onclick = () => routeTo("#/practice?new=1");
  $("#btn-add-consigne").onclick = () => Modes.openConsigneForm(ctx);
  $("#btn-add-goal").onclick = () => Goals.openGoalForm(ctx);
}

export async function initApp({ app, db, user }){
  L.group("app.init", user?.uid);
  if (!user || !user.uid) {
    L.error("No UID in context");
    L.groupEnd();
    return;
  }
  ctx.app = app;
  ctx.db = db;
  ctx.user = user;

  const profile = await Schema.ensureProfile(db, user.uid);
  ctx.profile = profile;
  L.info("Profile loaded:", profile);
  
  // Display profile in the sidebar
  const box = document.getElementById("profile-box");
  if (box) box.innerHTML = `<div><b>UID:</b> ${user.uid}<br><span class="muted">Profil chargé.</span></div>`;

  await loadCategories();
  bindNav();

  ctx.route = location.hash || "#/dashboard";
  window.addEventListener("hashchange", () => {
    ctx.route = location.hash || "#/dashboard";
    render();
  });
  render();
  L.groupEnd();
}

function newUid(){
  // Simple, readable, unique UID
  return "u-" + Math.random().toString(36).slice(2, 10);
}

function renderAdmin(db) {
  const root = document.getElementById("view-root");
  root.innerHTML = `
    <h2>Admin – Gestion des utilisateurs</h2>
    <form id="new-user-form" class="card">
      <input type="text" id="new-user-name" placeholder="Nom" required />
      <button class="btn primary" type="submit">Ajouter un utilisateur</button>
    </form>
    <div id="user-list" class="list"></div>
  `;

  // écouter le submit
  document.getElementById("new-user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("new-user-name").value.trim();
    if (!name) return;

    const uid = newUid(); // générer un identifiant unique
    await setDoc(doc(db, "users", uid), { name, createdAt: Date.now() });

    console.info("Nouvel utilisateur créé:", uid);
    renderAdmin(db); // recharger la liste
  });

  // afficher la liste existante
  loadUsers(db);
}

async function loadUsers(db) {
  const list = document.getElementById("user-list");
  const q = await getDocs(collection(db, "users"));
  list.innerHTML = "";
  q.forEach(docSnap => {
    const data = docSnap.data();
    const uid = docSnap.id;
    const link = `${location.origin}${location.pathname}#/u/${uid}`;
    const item = document.createElement("div");
    item.className = "card";
    item.innerHTML = `<strong>${data.name}</strong><br><a href="${link}">${link}</a>`;
    list.appendChild(item);
  });
}

function boot() {
  const hash = location.hash;
  if (hash.startsWith("#/admin")) {
    renderAdmin(db);
  } else if (hash.startsWith("#/u/")) {
    const uid = hash.split("/")[2];
    if (uid) {
      initApp({ app, db, user: { uid } });
    } else {
      document.getElementById("view-root").innerHTML = "<div class='card'>Utilisateur introuvable.</div>";
    }
  } else {
    // par défaut -> redirection vers admin
    location.hash = "#/admin";
  }
}

function render(){
  const root = document.getElementById("view-root");
  if (!root) return;
  const [path, arg1] = ctx.route.replace(/^#\//,"").split("/");
  const searchParams = new URLSearchParams(ctx.route.split("?")[1] || "");
  switch(path){
    case "dashboard":
      return Modes.renderDashboard(ctx, root);
    case "daily":
      return Modes.renderDaily(ctx, root);
    case "practice":
      return Modes.renderPractice(ctx, root, { newSession: searchParams.get("new")==="1" });
    case "history":
      return Modes.renderHistory(ctx, root);
    case "goals":
      return Goals.renderGoals(ctx, root);
    case "admin":
      return renderAdmin(ctx, root);
    case "u":
      window.location.hash = "#/dashboard";
      return;
    default:
      root.innerHTML = "<div class='card'>Page inconnue.</div>";
  }
}