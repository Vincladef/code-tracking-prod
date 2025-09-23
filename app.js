// app.js — bootstrapping, routing, context, nav
/* global Schema, Modes, Goals */
(() => {
  if (window.__APP_ROUTER_INITIALIZED__) {
    return;
  }
  window.__APP_ROUTER_INITIALIZED__ = true;
  const appFirestore = Schema.firestore || window.firestoreAPI || {};
  const snapshotExists =
    Schema.snapshotExists ||
    ((snap) => (typeof snap?.exists === "function" ? snap.exists() : !!snap?.exists));

  const firebaseCompatApp = window.firebase || {};
  const BASE_TITLE = "Habitudes & Pratique";

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
  const appLog = (...args) => { if (LOG) console.debug("[app]", ...args); };
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

  let profileUnsubscribe = null;

  async function refreshUserBadge(uid, explicitName = null) {
    const el = document.querySelector("[data-username]");
    if (!el) return;
    const { segments } = parseHash(ctx.route || location.hash || "#/admin");
    const routeKey = segments[0] || "admin";
    const isAdminRoute = routeKey === "admin";

    const applyBadge = (label, updateTitle = true) => {
      el.textContent = label;
      if (!updateTitle) return;
      if (!label || label === "…") {
        document.title = BASE_TITLE;
        return;
      }
      document.title = `${BASE_TITLE} — ${label}`;
    };

    if (isAdminRoute) {
      applyBadge("Admin");
      return;
    }

    if (explicitName != null) {
      const safeName = explicitName || "Utilisateur";
      applyBadge(safeName);
      return;
    }

    if (!uid) {
      applyBadge("Utilisateur");
      return;
    }
    applyBadge("…", false);
    try {
      const resolved = await Schema.getUserName(uid);
      applyBadge(resolved || "Utilisateur");
    } catch (err) {
      console.warn("refreshUserBadge", err);
      applyBadge("Utilisateur");
    }
  }

  function setupProfileWatcher(db, uid) {
    if (typeof profileUnsubscribe === "function") {
      try { profileUnsubscribe(); } catch (error) { console.warn("profile:watch:cleanup", error); }
      profileUnsubscribe = null;
    }
    if (!db || !uid || typeof db.collection !== "function") return;
    try {
      const ref = db.collection("u").doc(uid);
      if (!ref || typeof ref.onSnapshot !== "function") return;
      profileUnsubscribe = ref.onSnapshot(
        (snap) => {
          if (!snapshotExists(snap)) return;
          const data = snap.data() || {};
          ctx.profile = { ...(ctx.profile || {}), ...data, uid };
          renderSidebar();
          refreshUserBadge(uid, data.displayName || data.name || data.slug || "Utilisateur");
        },
        (error) => {
          console.warn("profile:watch:error", error);
        }
      );
    } catch (error) {
      console.warn("profile:watch:error", error);
    }
  }

  const queryOne = (sel) => document.querySelector(sel);

  const queryAll = (sel) => Array.from(document.querySelectorAll(sel));

  function getAuthInstance() {
    if (!firebaseCompatApp || typeof firebaseCompatApp.auth !== "function") return null;
    try {
      return ctx.app ? firebaseCompatApp.auth(ctx.app) : firebaseCompatApp.auth();
    } catch (err) {
      console.warn("firebase.auth() fallback", err);
      return firebaseCompatApp.auth();
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
      appLog("routeTo", { from: location.hash || null, requested: hash, target: hash });
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

    appLog("routeTo", { from: location.hash || null, requested: hash, target });
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

    queryAll("button[data-route]").forEach((btn) => {
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
    appLog("categories:load:start", { uid: ctx.user?.uid });
    const uid = ctx.user.uid;
    const cats = await Schema.fetchCategories(ctx.db, uid);
    ctx.categories = cats;
    appLog("categories:load:done", { count: cats.length });
    renderSidebar();
  }

  function renderSidebar() {
    const box = queryOne("#profile-box");
    if (!box) return;
    appLog("sidebar:render", { profile: ctx.profile, categories: ctx.categories?.length });
    if (!ctx.user?.uid) {
      box.innerHTML = '<span class="muted">Aucun utilisateur sélectionné.</span>';
      return;
    }
    const link = `${location.origin}${location.pathname}#/u/${ctx.user.uid}`;
    box.innerHTML = `
      <div><strong>${ctx.profile.displayName || ctx.profile.name || "Utilisateur"}</strong></div>
      <div class="muted">UID : <code>${ctx.user.uid}</code></div>
      <div class="muted">Lien direct : <a class="link" href="${link}">${link}</a></div>
    `;
    const catBox = queryOne("#category-box");
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
    appLog("nav:bind:start");
    queryAll("button[data-route]").forEach(btn => {
      const target = btn.getAttribute("data-route");
      appLog("nav:bind:button", { target });
      btn.onclick = () => routeTo(target);
    });

    // Boutons spécifiques (seulement si présents dans le DOM)
    const btnSession = queryOne("#btn-new-session");
    if (btnSession) {
      appLog("nav:bind:newSessionButton");
      btnSession.onclick = () => routeTo("#/practice?new=1");
    }

    const btnConsigne = queryOne("#btn-add-consigne");
    if (btnConsigne) {
      appLog("nav:bind:addConsigne");
      btnConsigne.onclick = () => Modes.openConsigneForm(ctx);
    }

    const btnGoal = queryOne("#btn-add-goal");
    if (btnGoal) {
      appLog("nav:bind:addGoal");
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
    appLog("handleRoute", parsed);

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
    appLog("router:start", { hash: location.hash });
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
      appLog("router:hashchange", { hash: location.hash });
      handleRoute();
    }); // navigation
  }

  // Local ensureProfile function
  async function ensureProfile(db, uid) {
    appLog("profile:ensure:start", { uid });
    const ref = appFirestore.doc(db, "u", uid);
    const snap = await appFirestore.getDoc(ref);
    if (snapshotExists(snap)) {
      const data = snap.data();
      appLog("profile:ensure:existing", { uid });
      return data;
    }
    const newProfile = {
      name: "Nouvel utilisateur",
      displayName: "Nouvel utilisateur",
      createdAt: new Date().toISOString()
    };
    await appFirestore.setDoc(ref, newProfile);
    appLog("profile:ensure:created", { uid });
    return newProfile;
  }

  async function ensurePushSubscription(ctx) {
    const messagingSupported = typeof firebaseCompatApp?.messaging?.isSupported === "function"
      ? firebaseCompatApp.messaging.isSupported()
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
      messaging = ctx.app ? firebaseCompatApp.messaging(ctx.app) : firebaseCompatApp.messaging();
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
    appLog("app:init:start", { uid: user?.uid });
    if (!user || !user.uid) {
      L.error("No UID in context");
      appLog("app:init:error", { reason: "missing uid" });
      L.groupEnd();
      return;
    }
    ctx.app = app;
    ctx.db = db;
    ctx.user = user;

    await refreshUserBadge(user.uid);

    const profile = await ensureProfile(db, user.uid);
    ctx.profile = { uid: user.uid, ...profile };
    appLog("app:init:profile", { profile });

    renderSidebar();
    setupProfileWatcher(ctx.db, user.uid);

    await loadCategories();
    bindNav();

    ctx.route = location.hash || "#/admin";
    appLog("app:init:route", { route: ctx.route });
    window.addEventListener("hashchange", () => {
      ctx.route = location.hash || "#/admin";
      appLog("app:init:hashchange", { route: ctx.route });
      render();
    });
    await render();
    // 👉 Inscription (silencieuse si refus/unsupported)
    ensurePushSubscription(ctx).catch(console.error);
    appLog("app:init:rendered");
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

    if (typeof profileUnsubscribe === "function") {
      try { profileUnsubscribe(); } catch (error) { console.warn("profile:watch:cleanup", error); }
      profileUnsubscribe = null;
    }
    refreshUserBadge(null);

    const root = document.getElementById("view-root");
    appLog("admin:render");
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
        appLog("admin:newUser:submit", { name });
        const uid = newUid();
        try {
          await appFirestore.setDoc(appFirestore.doc(db, "u", uid), {
            name: name,
            displayName: name,
            createdAt: new Date().toISOString()
          });
          if (input) input.value = "";
          appLog("admin:newUser:created", { uid });
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
    appLog("admin:users:load:start");
    const escapeHtml = (value) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    try {
      const ss = await appFirestore.getDocs(appFirestore.collection(db, "u"));
      const items = [];
      ss.forEach(d => {
        const data = d.data();
        const uid = d.id;
        const displayName = data.displayName || data.name || "(sans nom)";
        const safeName = escapeHtml(displayName);
        const safeUid = escapeHtml(uid);
        const encodedUid = encodeURIComponent(uid);
        const link = `${location.origin}${location.pathname}#/u/${encodedUid}/daily`;
        items.push(`
          <div class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
            <div>
              <div class="font-medium">${safeName}</div>
              <div class="text-sm text-[var(--muted)]">UID: ${safeUid}</div>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <a class="btn btn-ghost text-sm"
                 href="${link}"
                 target="_blank"
                 rel="noopener noreferrer"
                 data-uid="${safeUid}"
                 data-action="open">Ouvrir</a>
              <button type="button"
                      class="btn btn-ghost text-sm"
                      data-uid="${safeUid}"
                      data-name="${safeName}"
                      data-action="rename"
                      title="Renommer ${safeName}">✏️ Renommer</button>
              <button type="button"
                      class="btn btn-ghost text-sm text-red-600"
                      data-uid="${safeUid}"
                      data-name="${safeName}"
                      data-action="delete"
                      title="Supprimer ${safeName}">🗑️ Supprimer</button>
            </div>
          </div>
        `);
      });
      list.innerHTML = items.join("") || "<div class='text-sm text-[var(--muted)]'>Aucun utilisateur</div>";
      appLog("admin:users:load:done", { count: items.length });

      if (!list.dataset.bound) {
        list.addEventListener("click", async (e) => {
          const actionTarget = e.target.closest("[data-uid]");
          if (!actionTarget) return;
          const { uid, action, name } = actionTarget.dataset;
          if (!uid) return;
          if ((action || actionTarget.tagName === "A") && (action || "open") === "open") {
            if (!actionTarget.target || actionTarget.target === "_self") {
              e.preventDefault();
              location.hash = `#/u/${uid}`;
              appLog("admin:users:navigate", { uid });
              handleRoute();
            }
            return;
          }

          e.preventDefault();
          if (action === "rename") {
            const currentName = name || "";
            const nextName = prompt("Nouveau nom de l’utilisateur :", currentName);
            if (nextName === null) {
              return;
            }
            const trimmed = nextName.trim();
            if (!trimmed) {
              alert("Le nom ne peut pas être vide.");
              return;
            }
            if (trimmed === currentName.trim()) {
              return;
            }
            try {
              await appFirestore.setDoc(
                appFirestore.doc(db, "u", uid),
                {
                  name: trimmed,
                  displayName: trimmed,
                },
                { merge: true }
              );
              await loadUsers(db);
            } catch (error) {
              console.error("admin:users:rename:error", error);
              alert("Impossible de renommer l’utilisateur.");
            }
            return;
          }

          if (action === "delete") {
            const label = name || uid;
            if (!confirm(`Supprimer l’utilisateur « ${label} » ? Cette action est irréversible.`)) {
              return;
            }
            try {
              await appFirestore.deleteDoc(appFirestore.doc(db, "u", uid));
              await loadUsers(db);
            } catch (error) {
              console.error("admin:users:delete:error", error);
              alert("Impossible de supprimer l’utilisateur.");
            }
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
})();
