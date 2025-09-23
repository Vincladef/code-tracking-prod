// app.js — bootstrapping, routing, context, nav
const Schema = window.Schema || {};
const Modes = window.Modes || {};
const Goals = window.Goals || {};

const firestoreAPI = Schema.firestore || {};
const { collection, query, where, orderBy, limit, getDocs, doc, setDoc, getDoc } = firestoreAPI;

const firebaseCompat = window.firebase || {};

// --- feature flags & logger ---
const DEBUG = false;
const LOG = DEBUG;
const L = Schema.D || {
  on: false,
  info: () => {},
  debug: () => {},
  warn: () => {},
  error: () => {},
  group: () => {},
  groupEnd: () => {},
};
if (L) L.on = DEBUG;
const log = (...args) => { if (LOG) console.debug("[app]", ...args); };
function logStep(step, data) {
  L.group(step);
  if (data) L.info(data);
  L.groupEnd();
}

const ctx = {
  app: null,
  db: null,
  user: null, // { uid } passed by index.html
  profile: null, // profile doc
  categories: [],
  route: "#/admin",
};

async function refreshUserBadge(uid) {
  const el = document.querySelector("[data-username]");
  if (!el) return;
  const { segments } = parseHash(ctx.route || location.hash || "#/admin");
  const routeKey = segments[0] || "admin";
  const isAdminRoute = routeKey === "admin";

  if (isAdminRoute) {
    el.textContent = "Admin";
    return;
  }

  if (!uid) {
    el.textContent = "Utilisateur";
    return;
  }
  el.textContent = "…";
  try {
    el.textContent = await Schema.getUserName(uid);
  } catch (err) {
    console.warn("refreshUserBadge", err);
    el.textContent = "Utilisateur";
  }
}

function $(sel) {
  return document.querySelector(sel);
}

function $$(sel) {
  return Array.from(document.querySelectorAll(sel));
}

function getAuthInstance() {
  if (!firebaseCompat || typeof firebaseCompat.auth !== "function") return null;
  try {
    return ctx.app ? firebaseCompat.auth(ctx.app) : firebaseCompat.auth();
  } catch (err) {
    console.warn("firebase.auth() fallback", err);
    return firebaseCompat.auth();
  }
}

let authInitPromise = null;
let signInPromise = null;

async function ensureSignedIn() {
  const auth = getAuthInstance();
  if (!auth) return null;
  if (auth.currentUser) return auth.currentUser;

  if (!authInitPromise) {
    authInitPromise = new Promise((resolve) => {
      const unsubscribe = auth.onAuthStateChanged((user) => {
        unsubscribe();
        resolve(user);
      });
    }).finally(() => {
      authInitPromise = null;
    });
  }

  const existing = await authInitPromise;
  if (existing) return existing;

  if (!signInPromise) {
    signInPromise = auth
      .signInAnonymously()
      .then((cred) => cred.user)
      .finally(() => {
        signInPromise = null;
      });
  }

  return signInPromise;
}

function routeTo(hash) {
  // hash like "#/daily", "#/practice?new=1", etc.
  if (!hash) hash = "#/admin";

  // Si l'argument est déjà une URL utilisateur complète, on la prend telle quelle
  if (/^#\/u\/[^/]+\//.test(hash)) {
    log("routeTo", { from: location.hash || null, requested: hash, target: hash });
    ctx.route = hash;
    window.location.hash = hash;
    render();
    return;
  }

  // If we are currently on a user URL, prefix all routes with /u/{uid}/...
  const m = (location.hash || "").match(/^#\/u\/([^/]+)/);
  const base = m ? `#/u/${m[1]}/` : "#/";
  const stayInUserSpace = m && !hash.startsWith("#/admin") && !hash.startsWith("#/u/");
  const target = stayInUserSpace ? base + hash.replace(/^#\//, "") : hash;

  log("routeTo", { from: location.hash || null, requested: hash, target });
  ctx.route = target;
  window.location.hash = target;
  render();
}
window.routeTo = routeTo;

function routeToDefault() {
  if (location.hash !== "#/admin") {
    location.hash = "#/admin";
  } else {
    handleRoute();
  }
}

function setActiveNav(sectionKey) {
  const alias = sectionKey === "dashboard" ? "daily" : sectionKey;
  const map = {
    admin: "#/admin",
    daily: "#/daily",
    practice: "#/practice",
    goals: "#/goals",
  };
  const activeTarget = map[alias] || "#/admin";
  const accentSection = map[alias] ? alias : "daily";

  document.body.setAttribute("data-section", accentSection);

  $$('button[data-route]').forEach((btn) => {
    const target = btn.getAttribute("data-route");
    const isActive = target === activeTarget;
    btn.setAttribute("aria-current", isActive ? "page" : "false");
  });
}

function parseHash(hashValue) {
  const hash = hashValue || "#/admin";
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

function redirectToDefaultSection() {
  routeToDefault();
}

async function ensureOwnRoute(parsed) {
  let desired = parsed.segments[0] || "daily";
  if (!desired) desired = "daily";

  const qp = parsed.qp || new URLSearchParams(parsed.search || "");
  const requestedUid = qp.get("u");

  let authUser;
  try {
    authUser = await ensureSignedIn();
  } catch (error) {
    if (DEBUG) console.warn("[Auth] anonymous sign-in failed", error);
  }

  const fallbackUid = authUser?.uid;
  const targetUid = requestedUid || fallbackUid;

  if (!targetUid) {
    redirectToDefaultSection();
    return;
  }

  if (requestedUid) {
    qp.delete("u");
  }
  const searchPart = qp.toString();
  const target = `#/u/${targetUid}/${desired}${searchPart ? `?${searchPart}` : ""}`;

  if (location.hash !== target) {
    location.replace(target);
  } else if (!ctx.user || ctx.user.uid !== targetUid) {
    await initApp({
      app: ctx.app,
      db: ctx.db,
      user: { uid: targetUid }
    });
  }
}

// --- Router global (admin <-> user) ---
async function handleRoute() {
  const currentHash = location.hash || "#/admin";
  const parsed = parseHash(currentHash);
  ctx.route = currentHash;
  log("handleRoute", parsed);

  const routeName = parsed.segments[0] || "admin";

  if (routeName === "admin") {
    try {
      await ensureSignedIn();
    } catch (error) {
      if (DEBUG) console.warn("[Auth] anonymous sign-in failed", error);
    }
    render();
    return;
  }

  if (routeName === "u") {
    const qp = parsed.qp || new URLSearchParams(parsed.search || "");
    const uid = parsed.segments[1];
    let section = parsed.segments[2];
    const requestedUid = qp.get("u");
    const targetUid = requestedUid || uid;

    if (!targetUid) {
      redirectToDefaultSection();
      return;
    }

    if (!section) {
      if (requestedUid) qp.delete("u");
      const searchPart = qp.toString();
      const target = `#/u/${targetUid}/daily${searchPart ? `?${searchPart}` : ""}`;
      location.replace(target);
      return;
    }

    if (requestedUid && requestedUid !== uid) {
      qp.delete("u");
      const searchPart = qp.toString();
      const target = `#/u/${targetUid}/${section}${searchPart ? `?${searchPart}` : ""}`;
      location.replace(target);
      return;
    }

    if (ctx.user?.uid === targetUid) {
      return;
    }

    await initApp({
      app: ctx.app,
      db: ctx.db,
      user: {
        uid: targetUid
      }
    });
    return;
  }

  await ensureOwnRoute(parsed);
}

function startRouter(app, db) {
  // We keep app/db in the context for the screens
  log("router:start", { hash: location.hash });
  ctx.app = app;
  ctx.db = db;
  if (typeof Schema.bindDb === "function") Schema.bindDb(db);
  bindNav();
  if (!location.hash || location.hash === "#") {
    routeToDefault();
  } else {
    handleRoute(); // initial render
  }
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

async function ensurePushSubscription(ctx) {
  const messagingSupported = typeof firebaseCompat?.messaging?.isSupported === "function"
    ? firebaseCompat.messaging.isSupported()
    : Promise.resolve(false);
  if (!(await messagingSupported)) { console.info("[push] non supporté"); return; }
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return;

  // 1) Permission
  let perm = Notification.permission;
  if (perm === "default") perm = await Notification.requestPermission();
  if (perm !== "granted") { console.info("[push] permission refusée"); return; }

  // 2) Enregistrer le SW *avec un chemin relatif fiable sur GitHub Pages*
  const basePath = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}`;
  const swUrl = new URL("sw.js", basePath);
  const reg = await navigator.serviceWorker.register(swUrl.href, { scope: "./" });
  console.info("[push] SW OK", reg.scope);

  // 3) Token FCM avec TA clé VAPID publique
  let messaging;
  try {
    messaging = ctx.app ? firebaseCompat.messaging(ctx.app) : firebaseCompat.messaging();
  } catch (err) {
    console.info("[push] messaging non disponible", err);
    return;
  }
  const token = await messaging.getToken({
    vapidKey: "BMKhViKlpYs9dtqHYQYIU9rmTJQA3rPUP2h5Mg1YlA6lUs4uHk74F8rT9y8hT1U2N4M-UUE7-YvbAjYfTpjA1nM",
    serviceWorkerRegistration: reg
  });
  if (!token) { console.warn("[push] pas de token"); return; }
  console.info("[push] token", token);

  // 4) Enregistrer le token côté Firestore
  await Schema.savePushToken(ctx.db, ctx.user.uid, token);

  // 5) Réception en foreground
  messaging.onMessage((payload) => {
    try {
      new Notification(payload?.notification?.title || "Rappel", {
        body: payload?.notification?.body || "Tu as des consignes à remplir aujourd’hui.",
        icon: "/icon.png"
      });
    } catch {}
  });
}

async function initApp({ app, db, user }) {
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

  await refreshUserBadge(user.uid);

  const profile = await ensureProfile(db, user.uid);
  ctx.profile = profile;
  log("app:init:profile", { profile });

  // Display profile in the sidebar
  const box = document.getElementById("profile-box");
  if (box) box.innerHTML = `<div><b>UID:</b> ${user.uid}<br><span class="muted">Profil chargé.</span></div>`;

  await loadCategories();
  bindNav();

  ctx.route = location.hash || "#/admin";
  log("app:init:route", { route: ctx.route });
  window.addEventListener("hashchange", () => {
    ctx.route = location.hash || "#/admin";
    log("app:init:hashchange", { route: ctx.route });
    render();
  });
  await render();
  // 👉 Inscription (silencieuse si refus/unsupported)
  ensurePushSubscription(ctx).catch(console.error);
  log("app:init:rendered");
  L.groupEnd();
}

function newUid() {
  // Simple, readable, unique UID
  return "u-" + Math.random().toString(36).slice(2, 10);
}

function renderAdmin(db) {
  // Hide the sidebar in admin mode
  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.style.display = "none";

  refreshUserBadge(null);

  const root = document.getElementById("view-root");
  log("admin:render");
  root.innerHTML = `
    <div class="space-y-4">
      <h2 class="text-xl font-semibold">Admin — Utilisateurs</h2>
      <form id="new-user-form" class="card p-4 space-y-3 max-w-md">
        <input type="text" id="new-user-name" placeholder="Nom de l’utilisateur" required class="w-full" />
        <button class="btn btn-primary" type="submit">Créer l’utilisateur</button>
      </form>
      <div class="card p-4 space-y-3">
        <div class="font-semibold">Utilisateurs existants</div>
        <div id="user-list" class="grid gap-3"></div>
      </div>
    </div>
  `;

  const form = document.getElementById("new-user-form");
  if (form) {
    form.addEventListener("submit", async(e) => {
      e.preventDefault();
      const input = document.getElementById("new-user-name");
      const name = input?.value?.trim();
      if (!name) return;
      log("admin:newUser:submit", { name });
      const uid = newUid();
      try {
        await setDoc(doc(db, "u", uid), {
          displayName: name,
          createdAt: new Date().toISOString()
        });
        if (input) input.value = "";
        log("admin:newUser:created", { uid });
        loadUsers(db);
      } catch (error) {
        console.error("admin:newUser:error", error);
        alert("Création impossible. Réessaie plus tard.");
      }
    });
  }

  loadUsers(db);
}

async function loadUsers(db) {
  const list = document.getElementById("user-list");
  if (!list) return;
  list.innerHTML = "<div class='text-sm text-[var(--muted)]'>Chargement…</div>";
  log("admin:users:load:start");
  try {
    const ss = await getDocs(collection(db, "u"));
    const items = [];
    ss.forEach(d => {
      const data = d.data();
      const uid = d.id;
      const link = `${location.origin}${location.pathname}#/u/${uid}/daily`;
      items.push(`
        <div class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
          <div>
            <div class="font-medium">${data.displayName || "(sans nom)"}</div>
            <div class="text-sm text-[var(--muted)]">UID: ${uid}</div>
          </div>
          <a class="btn btn-ghost text-sm"
             href="${link}"
             target="_blank"
             rel="noopener noreferrer"
             data-uid="${uid}">Ouvrir</a>
        </div>
      `);
    });
    list.innerHTML = items.join("") || "<div class='text-sm text-[var(--muted)]'>Aucun utilisateur</div>";
    log("admin:users:load:done", { count: items.length });

    if (!list.dataset.bound) {
      list.addEventListener("click", (e) => {
        const a = e.target.closest("a[data-uid]");
        if (!a) return;
        if (!a.target || a.target === "_self") {
          e.preventDefault();
          location.hash = `#/u/${a.dataset.uid}`;
          log("admin:users:navigate", { uid: a.dataset.uid });
          handleRoute();
        }
      });
      list.dataset.bound = "1";
    }
  } catch (error) {
    console.warn("admin:users:load:error", error);
    list.innerHTML = "<div class='text-sm text-red-600'>Impossible de charger les utilisateurs.</div>";
  }
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

  root.classList.remove("route-enter");
  // eslint-disable-next-line no-unused-expressions
  root.offsetHeight;
  root.classList.add("route-enter");

  const h = ctx.route || location.hash || "#/admin";
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
  } else {
    ctx.user = null;
  }

  // Query params (toujours depuis l'URL complète)
  const qp = new URLSearchParams((h.split("?")[1] || ""));

  const currentSection = section === "u" ? sub : section;
  setActiveNav(currentSection);

  switch (currentSection) {
    case "admin":
      return renderAdmin(ctx.db);
    case "dashboard":
    case "daily":
      return Modes.renderDaily(ctx, root, { day: qp.get("day"), dateIso: qp.get("d") });
    case "practice":
      return Modes.renderPractice(ctx, root, { newSession: qp.get("new") === "1" });
    case "history":
      return Modes.renderHistory(ctx, root);
    case "goals":
      return Goals.renderGoals(ctx, root);
    default:
      root.innerHTML = "<div class='card'>Page inconnue.</div>";
  }
}

window.AppCtx = ctx;
window.startRouter = startRouter;
window.initApp = initApp;
window.renderAdmin = renderAdmin;
