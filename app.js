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
  // hash like "#/dashboard", "#/practice?new=1", etc.
  if (!hash) hash = "#/dashboard";

  // If we are currently on a user URL, prefix all routes with /u/{uid}/...
  const m = (location.hash || "").match(/^#\/u\/([^/]+)/);
  const base = m ? `#/u/${m[1]}/` : "#/";
  const target = m ? base + hash.replace(/^#\//, "") : hash;

  ctx.route = target;
  window.location.hash = target;
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
  if (catBox) {
    if (!ctx.categories.length) {
      catBox.innerHTML = '<span class="muted">Aucune catégorie. Elles seront créées automatiquement lors de l’ajout d’une consigne.</span>';
    } else {
      catBox.innerHTML = ctx.categories.map(c => `<div class="flex"><span>${c.name}</span><span class="pill">${c.mode}</span></div>`).join("");
    }
  }
}

function bindNav() {
  // Navigation haut (Dashboard, Daily, Practice, etc.)
  $$("button[data-route]").forEach(btn => {
    btn.onclick = () => routeTo(btn.getAttribute("data-route"));
  });

  // Boutons spécifiques (seulement si présents dans le DOM)
  const btnSession = $("#btn-new-session");
  if (btnSession) btnSession.onclick = () => routeTo("#/practice?new=1");

  const btnConsigne = $("#btn-add-consigne");
  if (btnConsigne) btnConsigne.onclick = () => Modes.openConsigneForm(ctx);

  const btnGoal = $("#btn-add-goal");
  if (btnGoal) btnGoal.onclick = () => Goals.openGoalForm(ctx);
}

// --- Router global (admin <-> user) ---
function handleRoute() {
  const h = location.hash || "#/admin";
  if (h.startsWith("#/u/")) {
    const tokens = h.split("/"); // ["#/u", "{uid}", "{section?}"]
    const uid = tokens[2];
    const section = tokens[3]; // "dashboard", "goals", etc.

    if (!uid) {
      location.hash = "#/admin";
      return;
    }

    // if we just have #/u/{uid}, normalize to #/u/{uid}/dashboard
    if (!section) {
      location.replace(`#/u/${uid}/dashboard`);
      return;
    }

    initApp({
      app: ctx.app,
      db: ctx.db,
      user: {
        uid
      }
    });
  } else {
    renderAdmin(ctx.db);
  }
}

export function startRouter(app, db) {
  // We keep app/db in the context for the screens
  ctx.app = app;
  ctx.db = db;
  handleRoute(); // initial render
  window.addEventListener("hashchange", handleRoute); // navigation
}

// Local ensureProfile function
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
  // Show the sidebar in user mode
  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.style.display = "";

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
  // Hide the sidebar in admin mode
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
    // Correction ici : le lien pointe directement vers le tableau de bord de l'utilisateur
    const link = `${location.origin}${location.pathname}#/u/${uid}/dashboard`;
    items.push(`
      <div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <div><b>${data.displayName || "(sans nom)"}</b><br><span class="muted">UID: ${uid}</span></div>
        <a class="btn small"
           href="${link}"
           target="_blank"
           rel="noopener noreferrer"
           data-uid="${uid}">Ouvrir</a>
      </div>
    `);
  });
  list.innerHTML = items.join("") || "<div class='muted'>Aucun utilisateur</div>";

  // Add a delegate for the click
  list.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-uid]");
    if (!a) return;
    // If it's not opening in a new tab, we route locally
    if (!a.target || a.target === "_self") {
      e.preventDefault();
      location.hash = `#/u/${a.dataset.uid}`;
      // force the route without waiting for the event (useful on some browsers)
      handleRoute();
    }
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

function render() {
  const root = document.getElementById("view-root");
  if (!root) return;

  // tokens: ["u", "{uid}", "dashboard?new=1"] OR ["dashboard?..."]
  const tokens = (ctx.route || location.hash || "#/dashboard")
    .replace(/^#\//, "")
    .split("/");

  let section = tokens[0];
  let sub = null;
  if (section === "u") {
    // Nested user routes
    sub = tokens[2] || "dashboard"; // default screen for a user
    ctx.user = { uid: tokens[1] }; // new: preserve the user UID
  }

  const qp = new URLSearchParams((ctx.route || "").split("?")[1] || "");

  switch (section === "u" ? sub : section) {
    case "dashboard":
      return Modes.renderDashboard(ctx, root);
    case "daily":
      return Modes.renderDaily(ctx, root);
    case "practice":
      return Modes.renderPractice(ctx, root, {
        newSession: qp.get("new") === "1"
      });
    case "history":
      return Modes.renderHistory(ctx, root);
    case "goals":
      return Goals.renderGoals(ctx, root);
    case "admin":
      return renderAdmin(ctx.db);
    default:
      root.innerHTML = "<div class='card'>Page inconnue.</div>";
  }
}