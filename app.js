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
  user: null, // { uid } passed by index.html
  profile: null, // profile doc
  categories: [],
  route: "#/admin", // default route changed to admin
};

function $(sel) {
  return document.querySelector(sel);
}

function $$(sel) {
  return Array.from(document.querySelectorAll(sel));
}

function routeTo(hash) {
  if (!hash) hash = "#/admin"; // default route changed
  ctx.route = hash;
  window.location.hash = hash;
  render();
}

async function loadCategories() {
  // Categories are per user, default fallback if empty
  const uid = ctx.user.uid;
  const cats = await Schema.fetchCategories(ctx.db, uid);
  ctx.categories = cats;
  renderSidebar();
}

function renderSidebar() {
  const box = $("#profile-box");
  if (!box) return;
  const link = `${location.origin}${location.pathname}#/u/${ctx.user.uid}`;
  box.innerHTML = `
    <div><strong>${ctx.profile.displayName || "Utilisateur"}</strong></div>
    <div class="muted">UID : <code>${ctx.user.uid}</code></div>
    <div class="muted"><a class="link" href="${link}">Ouvrir profil</a></div>
  `;
}

function bindNav() {
  $$("button[data-route]").forEach(btn => {
    btn.onclick = () => routeTo(btn.getAttribute("data-route"));
  });
  // Commented or deleted unused buttons
  // $("#btn-new-session").onclick = () => routeTo("#/practice?new=1");
  // $("#btn-add-consigne").onclick = () => Modes.openConsigneForm(ctx);
  // $("#btn-add-goal").onclick = () => Goals.openGoalForm(ctx);
}

export async function initApp({ app, db, user }) {
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

  // Commented out unused functions
  // await loadCategories();
  // bindNav();

  ctx.route = location.hash || "#/admin"; // default route changed to admin
  window.addEventListener("hashchange", () => {
    ctx.route = location.hash || "#/admin"; // default route changed to admin
    render();
  });
  render();
  L.groupEnd();
}

function newUid() {
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
  document.getElementById("new-user-form").addEventListener("submit", async(e) => {
    e.preventDefault();
    const name = document.getElementById("new-user-name").value.trim();
    if (!name) return;

    const uid = newUid(); // générer un identifiant unique
    await setDoc(doc(db, "users", uid), {
      name,
      createdAt: Date.now()
    });

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

function renderUser(db, uid) {
  initApp({
    app: ctx.app,
    db,
    user: {
      uid
    }
  });
}

function boot() {
  render(); // delegate to render()
}

function render() {
  const root = document.getElementById("view-root");
  if (!root) return;

  const hash = location.hash;

  if (hash.startsWith("#/admin")) {
    renderAdmin(ctx.db);
  } else if (hash.startsWith("#/u/")) {
    const uid = hash.split("/")[2];
    if (uid) {
      renderUser(ctx.db, uid);
    } else {
      root.innerHTML = "<div class='card'>Utilisateur introuvable.</div>";
    }
  } else {
    location.hash = "#/admin"; // default to admin
  }
}