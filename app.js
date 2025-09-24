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
  const ADMIN_ACCESS_KEY = "hp::admin::authorized";
  const ADMIN_LOGIN_PAGE = "admin.html";

  function getAdminStorage() {
    try {
      return window.sessionStorage;
    } catch (error) {
      console.warn("[admin] sessionStorage inaccessible", error);
      return null;
    }
  }

  function hasAdminAccess() {
    const storage = getAdminStorage();
    return storage?.getItem(ADMIN_ACCESS_KEY) === "true";
  }

  function redirectToAdminLogin() {
    const loginUrl = new URL(ADMIN_LOGIN_PAGE, window.location.href);
    if (loginUrl.pathname === window.location.pathname && loginUrl.hash === window.location.hash) {
      return;
    }
    window.location.href = loginUrl.toString();
  }

  // --- feature flags & logger ---
  const DEBUG = true;
  const LOG = true;
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
  const appLog = (event, payload) => {
    if (!LOG) return;
    if (payload === undefined) {
      console.info("[app]", event);
      return;
    }
    console.info("[app]", event, payload);
  };
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

  const PUSH_PREFS_KEY = "hp::push::prefs";
  let pushPrefsCache = null;
  let messagingInstancePromise = null;
  let serviceWorkerRegistrationPromise = null;
  let foregroundListenerBound = false;

  const INSTALL_TARGET_STORAGE_KEY = "hp::install::target";

  function normalizeInstallTargetHash(hash) {
    if (!hash || typeof hash !== "string") return null;
    const trimmed = hash.trim();
    if (!/^#\/u\//.test(trimmed)) return null;
    const [rawPath = "", searchPart = ""] = trimmed.split("?");
    const pathSegments = rawPath.replace(/^#\/+/g, "").split("/");
    if (!pathSegments[1]) return null;
    if (pathSegments.length < 3 || !pathSegments[2]) {
      pathSegments[2] = "daily";
    }
    const normalizedPath = `#/${pathSegments.filter(Boolean).join("/")}`;
    return searchPart ? `${normalizedPath}?${searchPart}` : normalizedPath;
  }

  function loadInstallTargetHash() {
    const storage = getSafeStorage();
    if (!storage) return null;
    try {
      const raw = storage.getItem(INSTALL_TARGET_STORAGE_KEY);
      return normalizeInstallTargetHash(raw);
    } catch (error) {
      console.warn("[install] target:load", error);
      return null;
    }
  }

  function saveInstallTargetHash(hash) {
    const normalized = normalizeInstallTargetHash(hash);
    if (!normalized) return false;
    const storage = getSafeStorage();
    if (!storage) return false;
    try {
      storage.setItem(INSTALL_TARGET_STORAGE_KEY, normalized);
      return true;
    } catch (error) {
      console.warn("[install] target:save", error);
      return false;
    }
  }

  function clearInstallTargetHash() {
    const storage = getSafeStorage();
    if (!storage) return;
    try {
      storage.removeItem(INSTALL_TARGET_STORAGE_KEY);
    } catch (error) {
      console.warn("[install] target:clear", error);
    }
  }

  window.__appInstallTarget = {
    save: saveInstallTargetHash,
    load: loadInstallTargetHash,
    clear: clearInstallTargetHash,
  };

  function getSafeStorage() {
    try {
      return window.localStorage;
    } catch (error) {
      console.warn("[push] storage inaccessible", error);
      return null;
    }
  }

  function loadPushPrefs() {
    if (pushPrefsCache) return pushPrefsCache;
    const storage = getSafeStorage();
    if (!storage) {
      pushPrefsCache = {};
      return pushPrefsCache;
    }
    try {
      const raw = storage.getItem(PUSH_PREFS_KEY);
      if (!raw) {
        pushPrefsCache = {};
        return pushPrefsCache;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        pushPrefsCache = {};
        return pushPrefsCache;
      }
      pushPrefsCache = parsed;
    } catch (error) {
      console.warn("[push] prefs:parse", error);
      pushPrefsCache = {};
    }
    return pushPrefsCache;
  }

  function savePushPrefs(nextPrefs) {
    pushPrefsCache = nextPrefs || {};
    const storage = getSafeStorage();
    if (!storage) return;
    try {
      storage.setItem(PUSH_PREFS_KEY, JSON.stringify(pushPrefsCache));
    } catch (error) {
      console.warn("[push] prefs:save", error);
    }
  }

  function getPushPreference(uid) {
    if (!uid) return null;
    const prefs = loadPushPrefs();
    return prefs[uid] || null;
  }

  function setPushPreference(uid, value) {
    if (!uid) return;
    const prefs = { ...loadPushPrefs() };
    prefs[uid] = { ...(prefs[uid] || {}), ...value };
    savePushPrefs(prefs);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  }

  function isPushSupported() {
    return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
  }

  async function ensureMessagingInstance() {
    if (messagingInstancePromise) return messagingInstancePromise;
    messagingInstancePromise = (async () => {
      const supported = typeof firebaseCompatApp?.messaging?.isSupported === "function"
        ? await firebaseCompatApp.messaging.isSupported()
        : false;
      if (!supported) {
        console.info("[push] messaging non supporté");
        return null;
      }
      try {
        return ctx.app ? firebaseCompatApp.messaging(ctx.app) : firebaseCompatApp.messaging();
      } catch (error) {
        console.warn("[push] messaging indisponible", error);
        return null;
      }
    })();
    return messagingInstancePromise;
  }

  async function ensureServiceWorkerRegistration() {
    if (serviceWorkerRegistrationPromise) return serviceWorkerRegistrationPromise;
    if (window.__appSWRegistrationPromise) {
      serviceWorkerRegistrationPromise = window.__appSWRegistrationPromise;
      return serviceWorkerRegistrationPromise;
    }
    if (!("serviceWorker" in navigator)) return null;
    const basePath = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}`;
    const swUrl = new URL("sw.js", basePath);
    serviceWorkerRegistrationPromise = (async () => {
      try {
        const existing = await navigator.serviceWorker.getRegistration(swUrl.href);
        if (existing) return existing;
      } catch (error) {
        console.warn("[push] sw:getRegistration", error);
      }
      try {
        const registration = await navigator.serviceWorker.register(swUrl.href, { scope: "./" });
        window.__appSWRegistrationPromise = Promise.resolve(registration);
        return registration;
      } catch (error) {
        console.warn("[push] sw:register", error);
        return null;
      }
    })();
    window.__appSWRegistrationPromise = serviceWorkerRegistrationPromise;
    return serviceWorkerRegistrationPromise;
  }

  function bindForegroundNotifications(messaging) {
    if (foregroundListenerBound) return;
    if (!messaging || typeof messaging.onMessage !== "function") return;
    try {
      messaging.onMessage((payload = {}) => {
        const notification = payload.notification || {};
        const data = payload.data || {};

        const hasNotificationPayload = Boolean(
          (notification && notification.title) || notification.body
        );

        if (hasNotificationPayload) {
          // Le payload "notification" est affiché automatiquement par Firebase.
          return;
        }

        try {
          const title = data.title || "Rappel";
          const body =
            data.body || "Tu as des consignes à remplir aujourd’hui.";
          const link = data.link || "/";

          const notificationInstance = new Notification(title, {
            body,
            icon: data.icon || "/icon.png",
            badge: data.badge || "/badge.png",
            data: { link },
          });

          if (notificationInstance && typeof notificationInstance.addEventListener === "function") {
            notificationInstance.addEventListener("click", () => {
              if (link) window.open(link, "_blank");
            });
          }
        } catch (error) {
          console.warn("[push] foreground:notify", error);
        }
      });
      foregroundListenerBound = true;
    } catch (error) {
      console.warn("[push] foreground:onMessage", error);
    }
  }

  async function enablePushForUid(uid, { interactive = false } = {}) {
    if (!uid || !ctx.db) return false;
    if (!isPushSupported()) {
      if (interactive) alert("Les notifications ne sont pas disponibles sur ce navigateur.");
      return false;
    }
    let permission = "denied";
    try {
      permission = Notification.permission;
      if (permission === "default") {
        permission = await Notification.requestPermission();
      }
    } catch (error) {
      console.warn("[push] permission:error", error);
      if (interactive) alert("Impossible de demander l’autorisation de notifications.");
      return false;
    }
    if (permission !== "granted") {
      if (interactive) alert("Permission de notifications refusée.");
      return false;
    }

    const messaging = await ensureMessagingInstance();
    if (!messaging) {
      if (interactive) alert("Impossible d’initialiser le service de notifications Firebase.");
      return false;
    }

    const registration = await ensureServiceWorkerRegistration();
    if (!registration) {
      if (interactive) alert("Impossible d’initialiser le service worker des notifications.");
      return false;
    }

    let token = null;
    try {
      token = await messaging.getToken({
        vapidKey: "BMKhViKlpYs9dtqHYQYIU9rmTJQA3rPUP2h5Mg1YlA6lUs4uHk74F8rT9y8hT1U2N4M-UUE7-YvbAjYfTpjA1nM",
        serviceWorkerRegistration: registration
      });
    } catch (error) {
      console.warn("[push] getToken", error);
      if (interactive) alert("Impossible de récupérer le jeton de notifications.");
      return false;
    }

    if (!token) {
      if (interactive) alert("Impossible de récupérer le jeton de notifications.");
      return false;
    }

    try {
      await Schema.savePushToken(ctx.db, uid, token);
      setPushPreference(uid, { token, enabled: true, updatedAt: Date.now() });
      bindForegroundNotifications(messaging);
      return true;
    } catch (error) {
      console.warn("[push] saveToken", error);
      if (interactive) alert("Impossible d’enregistrer le jeton de notifications.");
      return false;
    }
  }

  async function disablePushForUid(uid, { interactive = false } = {}) {
    if (!uid || !ctx.db) return false;
    const pref = getPushPreference(uid);
    const token = pref?.token;
    if (!token) {
      setPushPreference(uid, { enabled: false });
      return true;
    }
    try {
      await Schema.disablePushToken(ctx.db, uid, token);
      setPushPreference(uid, { enabled: false, token, updatedAt: Date.now() });
      return true;
    } catch (error) {
      console.warn("[push] disableToken", error);
      if (interactive) alert("Impossible de désactiver les notifications pour cet utilisateur.");
      return false;
    }
  }

  function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
      btn.dataset.loading = "1";
      btn.disabled = true;
      btn.classList.add("opacity-60");
    } else {
      btn.classList.remove("opacity-60");
      btn.dataset.loading = "0";
      if (isPushSupported()) {
        btn.disabled = false;
      }
    }
  }

  function syncNotificationButtonsForUid(uid) {
    if (!uid) return;
    const pref = getPushPreference(uid);
    const enabled = !!(pref && pref.enabled && pref.token);
    const selector = `[data-notif-toggle][data-uid="${cssEscape(uid)}"]`;
    queryAll(selector).forEach((btn) => {
      btn.dataset.enabled = enabled ? "1" : "0";
      const label = enabled ? "🔕 Désactiver les notifications" : "🔔 Activer les notifications";
      btn.textContent = label;
      if (!isPushSupported()) {
        btn.disabled = true;
        btn.title = "Notifications non disponibles sur cet appareil";
      } else if (!btn.dataset.loading || btn.dataset.loading === "0") {
        btn.disabled = false;
        btn.title = enabled ? "Désactiver les notifications" : "Activer les notifications";
      }
    });

    if (ctx.user?.uid === uid) {
      const status = queryOne("#notification-status");
      if (status) {
        if (!isPushSupported()) {
          status.textContent = "Les notifications ne sont pas disponibles sur ce navigateur.";
        } else if (enabled) {
          status.textContent = "Notifications actives sur cet appareil. Utilise le menu ⋮ pour les gérer.";
        } else {
          status.textContent = "Notifications désactivées sur cet appareil. Active-les depuis le menu ⋮.";
        }
      }
    }
  }

  async function handleNotificationToggle(uid, trigger, { interactive = false } = {}) {
    if (!uid) return;
    const pref = getPushPreference(uid);
    const enabled = !!(pref && pref.enabled && pref.token);
    setButtonLoading(trigger, true);
    try {
      if (enabled) {
        await disablePushForUid(uid, { interactive });
      } else {
        await enablePushForUid(uid, { interactive });
      }
    } catch (error) {
      console.warn("[push] toggle:error", error);
      if (interactive) alert("Impossible de mettre à jour les notifications.");
    } finally {
      setButtonLoading(trigger, false);
      if (trigger && !isPushSupported()) {
        trigger.disabled = true;
      }
      syncNotificationButtonsForUid(uid);
    }
  }

  async function refreshUserBadge(uid, explicitName = null) {
    const el = document.querySelector("[data-username]");
    if (!el) return;
    const { segments } = parseHash(ctx.route || location.hash || "#/admin");
    const routeKey = segments[0] || "admin";
    const isAdminRoute = routeKey === "admin";

    const applyBadge = (label, updateTitle = true) => {
      appLog("badge:update", { label, updateTitle });
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
    appLog("profile:watch:setup", { uid });
    if (typeof profileUnsubscribe === "function") {
      try {
        profileUnsubscribe();
        appLog("profile:watch:cleanup", { uid });
      } catch (error) {
        console.warn("profile:watch:cleanup", error);
      }
      profileUnsubscribe = null;
    }
    if (!db || !uid || typeof db.collection !== "function") {
      appLog("profile:watch:skip", { uid, reason: "missing-db-or-uid" });
      return;
    }
    try {
      const ref = db.collection("u").doc(uid);
      if (!ref || typeof ref.onSnapshot !== "function") {
        appLog("profile:watch:skip", { uid, reason: "missing-onSnapshot" });
        return;
      }
      profileUnsubscribe = ref.onSnapshot(
        (snap) => {
          if (!snapshotExists(snap)) return;
          const data = snap.data() || {};
          ctx.profile = { ...(ctx.profile || {}), ...data, uid };
          renderSidebar();
          refreshUserBadge(uid, data.displayName || data.name || data.slug || "Utilisateur");
          appLog("profile:watch:update", { uid, hasData: !!Object.keys(data || {}).length });
        },
        (error) => {
          console.warn("profile:watch:error", error);
        }
      );
      appLog("profile:watch:bound", { uid });
    } catch (error) {
      console.warn("profile:watch:error", error);
    }
  }

  const queryOne = (sel) => document.querySelector(sel);

  const queryAll = (sel) => Array.from(document.querySelectorAll(sel));

  const userActions = {
    container: document.getElementById("user-actions"),
    trigger: document.getElementById("user-actions-trigger"),
    panel: document.getElementById("user-actions-panel"),
    notif: document.getElementById("user-actions-notifications"),
    install: document.getElementById("install-app-button"),
  };

  let userActionsOpen = false;

  function closeUserActionsMenu() {
    if (userActions.panel) {
      userActions.panel.classList.add("hidden");
    }
    if (userActions.trigger) {
      userActions.trigger.setAttribute("aria-expanded", "false");
    }
    userActionsOpen = false;
  }

  function openUserActionsMenu() {
    if (userActions.panel) {
      userActions.panel.classList.remove("hidden");
    }
    if (userActions.trigger) {
      userActions.trigger.setAttribute("aria-expanded", "true");
    }
    userActionsOpen = true;
  }

  function toggleUserActionsMenu() {
    if (userActionsOpen) closeUserActionsMenu();
    else openUserActionsMenu();
  }

  function setUserActionsVisibility(visible) {
    if (!userActions.container) return;
    if (visible) {
      userActions.container.classList.remove("hidden");
      userActions.container.setAttribute("aria-hidden", "false");
    } else {
      userActions.container.classList.add("hidden");
      userActions.container.setAttribute("aria-hidden", "true");
      closeUserActionsMenu();
      if (userActions.notif) {
        userActions.notif.dataset.uid = "";
        userActions.notif.disabled = true;
      }
    }
  }

  function updateUserActionsTarget(uid) {
    if (!userActions.notif) return;
    if (!uid) {
      userActions.notif.dataset.uid = "";
      userActions.notif.disabled = true;
      return;
    }
    userActions.notif.dataset.uid = uid;
    if (!isPushSupported()) {
      userActions.notif.disabled = true;
      userActions.notif.title = "Notifications non disponibles sur cet appareil";
    } else {
      userActions.notif.disabled = false;
      userActions.notif.removeAttribute("title");
    }
  }

  function handleUserActionsOutsideClick(event) {
    if (!userActionsOpen || !userActions.container) return;
    if (!userActions.container.contains(event.target)) {
      closeUserActionsMenu();
    }
  }

  function handleUserActionsEscape(event) {
    if (event.key === "Escape" && userActionsOpen) {
      closeUserActionsMenu();
    }
  }

  userActions.trigger?.addEventListener("click", (event) => {
    event.preventDefault();
    toggleUserActionsMenu();
  });

  userActions.notif?.addEventListener("click", () => {
    const targetUid = userActions.notif?.dataset?.uid;
    if (!targetUid) return;
    handleNotificationToggle(targetUid, userActions.notif, { interactive: true });
    closeUserActionsMenu();
  });

  if (userActions.install) {
    userActions.install.addEventListener("click", () => {
      closeUserActionsMenu();
    });
  }

  document.addEventListener("click", handleUserActionsOutsideClick);
  document.addEventListener("keydown", handleUserActionsEscape);

  window.__closeUserActionsMenu = closeUserActionsMenu;

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

    if (hash.startsWith("#/admin") && !hasAdminAccess()) {
      redirectToAdminLogin();
      return;
    }

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

    if (target.startsWith("#/admin") && !hasAdminAccess()) {
      redirectToAdminLogin();
      return;
    }

    appLog("routeTo", { from: location.hash || null, requested: hash, target });
    ctx.route = target;
    window.location.hash = target;
    render();
  }
  window.routeTo = routeTo;

  function routeToDefault() {
    const storedTarget = loadInstallTargetHash();
    if (storedTarget) {
      if (location.hash !== storedTarget) {
        location.hash = storedTarget;
      } else {
        handleRoute();
      }
      return;
    }

    const defaultHash = hasAdminAccess() ? "#/admin" : "#/daily";
    if (location.hash !== defaultHash) {
      location.hash = defaultHash;
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

  function syncUserActionsContext() {
    const { segments } = parseHash(ctx.route || location.hash || "#/admin");
    const routeKey = segments[0] || "admin";
    const isAdminRoute = routeKey === "admin";
    const activeUid = ctx.user?.uid || null;
    const visible = !isAdminRoute && !!activeUid;
    setUserActionsVisibility(visible);
    if (visible) {
      updateUserActionsTarget(activeUid);
      syncNotificationButtonsForUid(activeUid);
    } else {
      updateUserActionsTarget(null);
    }
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

  function ensureSidebarStructure() {
    const sidebar = queryOne("#sidebar");
    if (!sidebar) return null;
    if (!sidebar.dataset.ready) {
      sidebar.innerHTML = `
        <div class="grid gap-4">
          <section class="card space-y-3 p-4">
            <div class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Profil</div>
            <div id="profile-box" class="space-y-2 text-sm"></div>
            <div id="notification-box" class="space-y-2 border-t border-gray-200 pt-3">
              <div class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Notifications</div>
              <p id="notification-status" class="text-sm text-[var(--muted)]"></p>
              <p class="text-xs text-[var(--muted)]">Gère les notifications depuis le menu ⋮ en haut de page.</p>
            </div>
          </section>
          <section class="card space-y-3 p-4">
            <div class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Catégories</div>
            <div id="category-box" class="space-y-2 text-sm"></div>
          </section>
        </div>
      `;
      sidebar.dataset.ready = "1";
    }
    return sidebar;
  }

  function renderSidebar() {
    const sidebar = ensureSidebarStructure();
    const box = queryOne("#profile-box");
    const status = queryOne("#notification-status");
    if (!sidebar || !box) return;

    appLog("sidebar:render", { profile: ctx.profile, categories: ctx.categories?.length });

    if (!ctx.user?.uid) {
      box.innerHTML = '<span class="muted">Aucun utilisateur sélectionné.</span>';
      if (status) status.textContent = "Sélectionnez un utilisateur pour accéder aux paramètres.";
      const catBoxEmpty = queryOne("#category-box");
      if (catBoxEmpty) {
        catBoxEmpty.innerHTML = '<span class="muted">Sélectionnez un utilisateur pour voir ses catégories.</span>';
      }
      return;
    }

    const link = `${location.origin}${location.pathname}#/u/${ctx.user.uid}`;
    box.innerHTML = `
      <div><strong>${ctx.profile.displayName || ctx.profile.name || "Utilisateur"}</strong></div>
      <div class="muted">UID : <code>${ctx.user.uid}</code></div>
      <div class="muted">Lien direct : <a class="link" href="${link}">${link}</a></div>
    `;

    syncNotificationButtonsForUid(ctx.user.uid);

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
      if (!hasAdminAccess()) {
        redirectToAdminLogin();
        return;
      }
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

  async function ensurePushSubscriptionForUid(uid, { interactive = false } = {}) {
    const targetUid = uid || ctx.user?.uid;
    if (!targetUid) return;
    const success = await enablePushForUid(targetUid, { interactive });
    if (success) syncNotificationButtonsForUid(targetUid);
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
    syncUserActionsContext();
    window.addEventListener("hashchange", () => {
      ctx.route = location.hash || "#/admin";
      appLog("app:init:hashchange", { route: ctx.route });
      render();
    });
    await render();
    const pref = getPushPreference(user.uid);
    if (pref?.enabled && isPushSupported()) {
      ensurePushSubscriptionForUid(user.uid, { interactive: false }).catch(console.error);
    }
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
          appLog("admin:newUser:created", { uid, name });
          loadUsers(db);
        } catch (error) {
          console.error("admin:newUser:error", error);
          appLog("admin:newUser:error", { message: error?.message || String(error) });
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
        appLog("admin:users:load:item", { uid, displayName });
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
            appLog("admin:users:rename:prompt", { uid, currentName });
            const nextName = prompt("Nouveau nom de l’utilisateur :", currentName);
            if (nextName === null) {
              appLog("admin:users:rename:cancelled", { uid });
              return;
            }
            const trimmed = nextName.trim();
            if (!trimmed) {
              appLog("admin:users:rename:invalid", { uid, value: nextName });
              alert("Le nom ne peut pas être vide.");
              return;
            }
            if (trimmed === currentName.trim()) {
              appLog("admin:users:rename:unchanged", { uid });
              return;
            }
            try {
              const userRef = appFirestore.doc(db, "u", uid);
              await appFirestore.setDoc(
                userRef,
                {
                  name: trimmed,
                  displayName: trimmed,
                },
                { merge: true }
              );
              appLog("admin:users:rename:write", { uid, nextName: trimmed });
              try {
                const snap = await appFirestore.getDoc(userRef);
                if (snapshotExists(snap)) {
                  const storedData = snap.data() || {};
                  const storedName = storedData.displayName || storedData.name || null;
                  appLog("admin:users:rename:confirm", { uid, storedName });
                } else {
                  appLog("admin:users:rename:confirm", { uid, storedName: null, exists: false });
                }
              } catch (verifyError) {
                console.warn("admin:users:rename:verify:error", verifyError);
              }
              await loadUsers(db);
            } catch (error) {
              console.error("admin:users:rename:error", error);
              appLog("admin:users:rename:error", { uid, message: error?.message || String(error) });
              alert("Impossible de renommer l’utilisateur.");
            }
            return;
          }

          if (action === "delete") {
            const label = name || uid;
            if (!confirm(`Supprimer l’utilisateur « ${label} » ? Cette action est irréversible.`)) {
              appLog("admin:users:delete:cancelled", { uid });
              return;
            }
            try {
              appLog("admin:users:delete:start", { uid });
              await appFirestore.deleteDoc(appFirestore.doc(db, "u", uid));
              appLog("admin:users:delete:done", { uid });
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
      appLog("admin:users:load:error", { message: error?.message || String(error) });
      list.innerHTML = "<div class='text-sm text-red-600'>Impossible de charger les utilisateurs.</div>";
    }
  }

  function renderUser(db, uid) {
    appLog("render:user", { uid });
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
    appLog("render:start", { hash: h });
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

    syncUserActionsContext();

    // Query params (toujours depuis l'URL complète)
    const qp = new URLSearchParams((h.split("?")[1] || ""));

    const currentSection = section === "u" ? sub : section;
    setActiveNav(currentSection);
    appLog("render:section", { section: currentSection, uid: ctx.user?.uid || null });

    switch (currentSection) {
      case "admin":
        if (!hasAdminAccess()) {
          redirectToAdminLogin();
          return;
        }
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
