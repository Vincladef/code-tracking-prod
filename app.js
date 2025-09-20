// app.js — bootstrapping, routing, context, nav
import {
  getFirestore, doc, setDoc, getDoc, collection, query, where, orderBy, limit, getDocs, collectionGroup
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
  route: "#/dashboard",
};

function $(sel) {
  return document.querySelector(sel);
}

function $$(sel) {
  return Array.from(document.querySelectorAll(sel));
}

function routeTo(hash) {
  if (!hash) hash = "#/dashboard";
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
    <div class="muted">Lien direct : <a class="link" href="${link}">${link}</a></div>
  `;
  const catBox = $("#category-box");
  if (!catBox) return;
  if (!ctx.categories.length) {
    catBox.innerHTML = '<span class="muted">Aucune catégorie. Elles seront créées automatiquement lors de l’ajout d’une consigne.</span>';
  } else {
    catBox.innerHTML = ctx.categories.map(c => `<div class="flex"><span>${c.name}</span><span class="pill">${c.mode}</span></div>`).join("");
  }
}

function bindNav() {
  $$("button[data-route]").forEach(btn => {
    btn.onclick = () => routeTo(btn.getAttribute("data-route"));
  });
  $("#btn-new-session").onclick = () => routeTo("#/practice?new=1");
  $("#btn-add-consigne").onclick = () => Modes.openConsigneForm(ctx);
  $("#btn-add-goal").onclick = () => Goals.openGoalForm(ctx);
}

// Fonction ensureProfile implémentée localement
async function ensureProfile(db, uid) {
  const ref = doc(db, "u", uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  const newProfile = {
    displayName: "Nouvel utilisateur",
    createdAt: new Date().toISOString()
  };
  await setDoc(ref, newProfile);
  return newProfile;
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

  const profile = await ensureProfile(db, user.uid);
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

function newUid() {
  // Simple, readable, unique UID
  return "u-" + Math.random().toString(36).slice(2, 10);
}

export function renderAdmin(db) {
  // Optionnel: cacher la nav/aside si ton HTML en contient
  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.style.display = "none";

  const root = document.getElementById("view-root");
  root.innerHTML = `
    <div class="grid" style="gap:12px">
      <h2>Admin — Utilisateurs</h2>
      <form id="new-user-form" class="card" style="display:grid;gap:8px;max-width:420px">
        <input class="input" type="text" id="new-user-name" placeholder="Nom de l’utilisateur" required />
        <button class="btn primary" type="submit">Créer l’utilisateur</button>
      </form>
      <div class="card"><b>Utilisateurs existants</b><div id="user-list" class="list" style="margin-top:8px"></div></div>
    </div>
  `;

  document.getElementById("new-user-form").addEventListener("submit", async(e) => {
    e.preventDefault();
    const name = document.getElementById("new-user-name").value.trim();
    if (!name) return;
    const uid = newUid();
    await setDoc(doc(db, "u", uid), {
      displayName: name,
      createdAt: new Date().toISOString()
    });
    console.info("Nouvel utilisateur créé:", uid);
    loadUsers(db);
  });

  loadUsers(db);
}

async function loadUsers(db) {
  const list = document.getElementById("user-list");
  list.innerHTML = "<div class='muted'>Chargement…</div>";
  const ss = await getDocs(collection(db, "u"));
  const items = [];
  ss.forEach(d => {
    const data = d.data();
    const uid = d.id;
    const link = `${location.origin}${location.pathname}#/u/${uid}`;
    items.push(`
      <div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <div><b>${data.displayName || "(sans nom)"}</b><br><span class="muted">UID: ${uid}</span></div>
        <a class="btn small" href="${link}">Ouvrir</a>
      </div>
    `);
  });
  list.innerHTML = items.join("") || "<div class='muted'>Aucun utilisateur</div>";
}

function renderUser(db, uid) {
  initApp({
    app,
    db,
    user: {
      uid
    }
  });
}

function boot() {
  const hash = location.hash;
  if (hash.startsWith("#/admin")) {
    renderAdmin(ctx.db); // page admin
  } else if (hash.startsWith("#/u/")) {
    const uid = hash.split("/")[2];
    if (uid) {
      renderUser(ctx.db, uid); // page utilisateur
    } else {
      document.getElementById("view-root").innerHTML =
        "<div class='card'>Utilisateur introuvable.</div>";
    }
  } else {
    location.hash = "#/admin"; // redirection par défaut
  }
}

function render() {
  const root = document.getElementById("view-root");
  if (!root) return;
  const [path, arg1] = ctx.route.replace(/^#\//, "").split("/");
  const searchParams = new URLSearchParams(ctx.route.split("?")[1] || "");
  switch (path) {
    case "dashboard":
      return Modes.renderDashboard(ctx, root);
    case "daily":
      return Modes.renderDaily(ctx, root);
    case "practice":
      return Modes.renderPractice(ctx, root, {
        newSession: searchParams.get("new") === "1"
      });
    case "history":
      return Modes.renderHistory(ctx, root);
    case "goals":
      return Goals.renderGoals(ctx, root);
    case "admin":
      return renderAdmin(ctx.db);
    case "u":
      window.location.hash = "#/dashboard";
      return;
    default:
      root.innerHTML = "<div class='card'>Page inconnue.</div>";
  }
}