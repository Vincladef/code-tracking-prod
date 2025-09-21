// app.js — bootstrapping, routing, context, nav
import {
  getFirestore, doc, setDoc, getDoc, collection, query, where, orderBy, limit, getDocs, collectionGroup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as Schema from "./schema.js";
import * as Modes from "./modes.js";
import * as Goals from "./goals.js";

// --- logger ---
const LOG = false;
const L = Schema.D;
const log = (...args) => { if (LOG) console.debug("[app]", ...args); };
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
  route: "#/daily",
};

function $(sel) {
  return document.querySelector(sel);
}

function $$(sel) {
  return Array.from(document.querySelectorAll(sel));
}

function routeTo(hash) {
  // hash like "#/daily", "#/practice?new=1", etc.
  if (!hash) hash = "#/daily";

  // If we are currently on a user URL, prefix all routes with /u/{uid}/...
  const m = (location.hash || "").match(/^#\/u\/([^/]+)/);
  const base = m ? `#/u/${m[1]}/` : "#/";
  const target = m ? base + hash.replace(/^#\//, "") : hash;

  log("routeTo", { from: location.hash || null, requested: hash, target });
  ctx.route = target;
  window.location.hash = target;
  render();
}
window.routeTo = routeTo;

function setActiveNav(sectionKey) {
  const map = {
    daily: "#/daily",
    practice: "#/practice",
    goals: "#/goals",
    admin: "#/admin"
  };
  const activeTarget = map[sectionKey] || "#/daily";
  $$("button[data-route]").forEach((btn) => {
    const target = btn.getAttribute("data-route");
    const isActive = target === activeTarget;
    btn.classList.toggle("bg-sky-600", isActive);
    btn.classList.toggle("border-sky-500", isActive);
    btn.classList.toggle("text-white", isActive);
    btn.classList.toggle("bg-white/5", !isActive);
    btn.classList.toggle("border-white/10", !isActive);
  });
}

function parseHash(hashValue) {
  const hash = hashValue || "#/daily";
  const normalized = hash.replace(/^#/, "");
  const [pathPartRaw, searchPart = ""] = normalized.split("?");
  const pathPart = pathPartRaw.replace(/^\/+/, "");
  const segments = pathPart ? pathPart.split("/") : [];
  const qp = new URLSearchParams(searchPart);
  return { hash, segments, search: searchPart, qp };
}

async function loadCategories() {
  // Categories are per user, default fallback if empty
  log("categories:load:start", { uid: ctx.user?.uid });
  const uid = ctx.user.uid;
  const cats = await Schema.fetchCategories(ctx.db, uid);
  ctx.categories = cats;
  log("categories:load:done", { count: cats.length });
  renderSidebar();
}

function renderSidebar() {
  const box = $("#profile-box");
  if (!box) return;
  log("sidebar:render", { profile: ctx.profile, categories: ctx.categories?.length });
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
  // Navigation haut (Daily, Practice, etc.)
  log("nav:bind:start");
  $$("button[data-route]").forEach(btn => {
    const target = btn.getAttribute("data-route");
    log("nav:bind:button", { target });
    btn.onclick = () => routeTo(target);
  });

  // Boutons spécifiques (seulement si présents dans le DOM)
  const btnSession = $("#btn-new-session");
  if (btnSession) {
    log("nav:bind:newSessionButton");
    btnSession.onclick = () => routeTo("#/practice?new=1");
  }

  const btnConsigne = $("#btn-add-consigne");
  if (btnConsigne) {
    log("nav:bind:addConsigne");
    btnConsigne.onclick = () => Modes.openConsigneForm(ctx);
  }

  const btnGoal = $("#btn-add-goal");
  if (btnGoal) {
    log("nav:bind:addGoal");
    btnGoal.onclick = () => Goals.openGoalForm(ctx);
  }
}

// --- Router global (admin <-> user) ---
function handleRoute() {
  const parsed = parseHash(location.hash || "#/admin");
  log("handleRoute", parsed);
  if (parsed.segments[0] === "u") {
    const uid = parsed.segments[1];
    const section = parsed.segments[2];

    if (!uid) {
      log("handleRoute:missingUid");
      location.hash = "#/admin";
      return;
    }

    if (!section) {
      const target = `#/u/${uid}/daily`;
      log("handleRoute:normalize", { target });
      location.replace(target);
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
  log("router:start", { hash: location.hash });
  ctx.app = app;
  ctx.db = db;
  handleRoute(); // initial render
  window.addEventListener("hashchange", () => {
    log("router:hashchange", { hash: location.hash });
    handleRoute();
  }); // navigation
}

// Local ensureProfile function
async function ensureProfile(db, uid) {
  log("profile:ensure:start", { uid });
  const ref = doc(db, "u", uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    log("profile:ensure:existing", { uid });
    return data;
  }
  const newProfile = {
    displayName: "Nouvel utilisateur",
    createdAt: new Date().toISOString()
  };
  await setDoc(ref, newProfile);
  log("profile:ensure:created", { uid });
  return newProfile;
}

export async function initApp({ app, db, user }) {
  // Show the sidebar in user mode
  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.style.display = "";

  L.group("app.init", user?.uid);
  log("app:init:start", { uid: user?.uid });
  if (!user || !user.uid) {
    L.error("No UID in context");
    log("app:init:error", { reason: "missing uid" });
    L.groupEnd();
    return;
  }
  ctx.app = app;
  ctx.db = db;
  ctx.user = user;

  const profile = await ensureProfile(db, user.uid);
  ctx.profile = profile;
  log("app:init:profile", { profile });

  // Display profile in the sidebar
  const box = document.getElementById("profile-box");
  if (box) box.innerHTML = `<div><b>UID:</b> ${user.uid}<br><span class="muted">Profil chargé.</span></div>`;

  await loadCategories();
  bindNav();

  ctx.route = location.hash || "#/daily";
  log("app:init:route", { route: ctx.route });
  window.addEventListener("hashchange", () => {
    ctx.route = location.hash || "#/daily";
    log("app:init:hashchange", { route: ctx.route });
    render();
  });
  render();
  log("app:init:rendered");
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
  log("admin:render");
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
    log("admin:newUser:submit", { name });
    const uid = newUid();
    await setDoc(doc(db, "u", uid), {
      displayName: name,
      createdAt: new Date().toISOString()
    });
    log("admin:newUser:created", { uid });
    loadUsers(db);
  });

  loadUsers(db);
}

async function loadUsers(db) {
  const list = document.getElementById("user-list");
  list.innerHTML = "<div class='muted'>Chargement…</div>";
  log("admin:users:load:start");
  const ss = await getDocs(collection(db, "u"));
  const items = [];
  ss.forEach(d => {
    const data = d.data();
    const uid = d.id;
    // Correction ici : le lien pointe directement vers le tableau de bord de l'utilisateur
    const link = `${location.origin}${location.pathname}#/u/${uid}/daily`;
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
  log("admin:users:load:done", { count: items.length });

  // Add a delegate for the click
  list.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-uid]");
    if (!a) return;
    // If it's not opening in a new tab, we route locally
    if (!a.target || a.target === "_self") {
      e.preventDefault();
      location.hash = `#/u/${a.dataset.uid}`;
      // force the route without waiting for the event (useful on some browsers)
      log("admin:users:navigate", { uid: a.dataset.uid });
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

  const h = ctx.route || location.hash || "#/daily";
  const tokens = h.replace(/^#\//, "").split("/"); // ["u","{uid}","daily?day=mon"] ou ["daily?..."]

  let section = tokens[0];
  let sub = null;
  if (section === "u") {
    // /u/{uid}/{sub}
    const uid = tokens[1];
    sub = (tokens[2] || "daily");
    // IMPORTANT: enlever la query de 'sub'
    sub = sub.split("?")[0];
    ctx.user = { uid };
  }

  // Query params (toujours depuis l'URL complète)
  const qp = new URLSearchParams((h.split("?")[1] || ""));

  const currentSection = section === "u" ? sub : section;
  setActiveNav(currentSection);

  switch (currentSection) {
    case "dashboard":
    case "daily":
      return Modes.renderDaily(ctx, root, { day: qp.get("day") });
    case "practice":
      return Modes.renderPractice(ctx, root, { newSession: qp.get("new") === "1" });
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