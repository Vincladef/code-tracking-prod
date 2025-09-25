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
  const BASE_SHORT_APP_NAME = "Habitudes";
  const INSTALL_NAME_SEPARATOR = " — ";
  const ADMIN_ACCESS_KEY = "hp::admin::authorized";
  const ADMIN_LOGIN_PAGE = "admin.html";
  const DEFAULT_NOTIFICATION_ICON =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAB6ElEQVR42u3d0U0gQAxDwVRGudccRUANJwTrxLNSGvCb/52Pf59frvfGCAAYAgAHgAPAAeAAuHv/8wAoC94KYkTvxjDCd0MY8bsRjPDdEEb8bgQjfDeEEb8bwYjfjWDE70Yw4ncjGPG7EYz43QhG/G4EAAAgfjOCEb8bAQAAiN+MYMTvRgAAAOI3IwAAAPGbEQAAgPjNCAAAQPxmBAAAAAAA4tciAAAA8ZsRAAAAAAAAAID4nQgAAAAAAAAAQPxOBAAAAAAAAAAAAAAAACB+GwIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAiWxwcAAAAAAAAAAAAAAAAI2uIDAAAAAAAAAASd8QEAAAAAAAAAgs74AADg17Dm+AAAAAAA/g6ujQ8AAO8AQPA+PgAAvAUAwdv4AADwHkA7gtfbAwDAewCtCBJ2jwHQhiBlcwAAyAHQgiBp7zgA1xGkbQ0AAHkAriJI3DkWwDUEqRtHA7iCIHnfeADbEaRvuwLAVgQbdl0DYBuCLZuuArAFwaY91wFIhrBxx7UA0hBs3XA1gAQI27c7AeAVggu7nQHwlxAu7XUOwG9huLrRaQA/xdCwCwAAAAAAAAAAAAAAAADQBuAb8crY5qD79QEAAAAASUVORK5CYII=";

  const PRIMARY_SERVICE_WORKER_FILE = "firebase-messaging-sw.js";
  const LEGACY_SERVICE_WORKER_FILE = "sw.js";

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

  const badgeManager = (() => {
    const DOW = ["DIM", "LUN", "MAR", "MER", "JEU", "VEN", "SAM"];
    let refreshPromise = null;

    function isBadgeSupported() {
      if (typeof navigator === "undefined") return false;
      return typeof navigator.setAppBadge === "function" || typeof navigator.setClientBadge === "function";
    }

    function resolveBadgeApi() {
      if (typeof navigator === "undefined") return { set: null, clear: null };
      const set = navigator.setAppBadge || navigator.setClientBadge;
      const clear = navigator.clearAppBadge || navigator.clearClientBadge;
      return { set, clear };
    }

    function isStandaloneDisplay() {
      try {
        const media = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)");
        return (media && media.matches) || window.navigator?.standalone === true;
      } catch (error) {
        return window.navigator?.standalone === true;
      }
    }

    async function applyBadgeValue(value) {
      const { set, clear } = resolveBadgeApi();
      if (!set) return;
      try {
        if (Number.isFinite(value) && value > 0) {
          await set.call(navigator, Math.round(value));
        } else if (clear) {
          await clear.call(navigator);
        } else {
          await set.call(navigator, 0);
        }
      } catch (error) {
        console.warn("[badge] apply", error);
      }
    }

    function normalizeDateLike(value) {
      const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
      if (Number.isNaN(date.getTime())) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        return now;
      }
      date.setHours(0, 0, 0, 0);
      return date;
    }

    function toDate(value) {
      if (!value) return null;
      if (value instanceof Date) return new Date(value.getTime());
      if (typeof value.toDate === "function") {
        try {
          const fromFirestore = value.toDate();
          if (fromFirestore instanceof Date && !Number.isNaN(fromFirestore.getTime())) {
            return fromFirestore;
          }
        } catch (error) {
          console.warn("[badge] toDate", error);
        }
      }
      if (typeof value === "number") {
        const asDate = new Date(value);
        if (!Number.isNaN(asDate.getTime())) return asDate;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const asDate = new Date(trimmed);
        if (!Number.isNaN(asDate.getTime())) return asDate;
      }
      return null;
    }

    function parseMonthKey(monthKey) {
      const [yearStr, monthStr] = String(monthKey || "").split("-");
      const year = Number(yearStr);
      const month = Number(monthStr);
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return null;
      }
      return { year, month };
    }

    function shiftMonthKey(baseKey, offset) {
      if (!Number.isFinite(offset)) return baseKey;
      const parsed = parseMonthKey(baseKey);
      if (!parsed) return baseKey;
      const base = new Date(parsed.year, parsed.month - 1 + offset, 1);
      return Schema.monthKeyFromDate(base);
    }

    function computeTheoreticalObjectiveDate(goal) {
      if (!goal) return null;
      const explicitEnd = toDate(goal.endDate);
      if (explicitEnd) {
        explicitEnd.setHours(0, 0, 0, 0);
        return explicitEnd;
      }
      if (goal.type === "hebdo") {
        const range = Schema.weekDateRange(goal.monthKey, goal.weekOfMonth || goal.weekIndex || 1);
        if (range?.end instanceof Date) {
          const end = new Date(range.end.getTime());
          end.setHours(0, 0, 0, 0);
          return end;
        }
      }
      if (goal.type === "mensuel") {
        const parsed = parseMonthKey(goal.monthKey);
        if (parsed) {
          const end = new Date(parsed.year, parsed.month, 0);
          end.setHours(0, 0, 0, 0);
          return end;
        }
      }
      const start = toDate(goal.startDate);
      if (start) {
        start.setHours(0, 0, 0, 0);
        return start;
      }
      return null;
    }

    function customObjectiveReminderDate(goal) {
      if (!goal) return null;
      const raw = goal.notifyAt ?? goal.notifyDate ?? goal.notificationDate ?? null;
      const custom = toDate(raw);
      if (!custom) return null;
      custom.setHours(0, 0, 0, 0);
      return custom;
    }

    async function countDailyPending(db, uid, targetDate) {
      if (!db || !uid) return 0;
      const date = normalizeDateLike(targetDate);
      const dayLabel = DOW[date.getDay()];
      const dayKey = Schema.dayKeyFromDate(date);
      let consignes = [];
      try {
        consignes = await Schema.fetchConsignes(db, uid, "daily");
      } catch (error) {
        console.warn("[badge] daily:consignes", error);
        return 0;
      }
      if (!Array.isArray(consignes) || !consignes.length) {
        return 0;
      }
      const todaysConsignes = consignes.filter((item) => {
        const days = Array.isArray(item.days) ? item.days : [];
        if (!days.length) return true;
        return days.includes(dayLabel);
      });
      if (!todaysConsignes.length) {
        return 0;
      }

      let responses = new Map();
      try {
        responses = await Schema.fetchDailyResponses(db, uid, dayKey);
      } catch (error) {
        console.warn("[badge] daily:responses", error);
        responses = new Map();
      }

      let count = 0;
      for (const consigne of todaysConsignes) {
        const hasResponse = responses instanceof Map && responses.has(consigne.id);
        if (hasResponse) {
          continue;
        }
        if (consigne.srEnabled === false) {
          count += 1;
          continue;
        }
        try {
          const state = await Schema.readSRState(db, uid, consigne.id, "consigne");
          const nextISO = state?.nextVisibleOn || state?.hideUntil;
          if (!nextISO) {
            count += 1;
            continue;
          }
          const next = new Date(nextISO);
          if (Number.isNaN(next.getTime()) || next <= date) {
            count += 1;
          }
        } catch (error) {
          console.warn("[badge] daily:sr", error);
          count += 1;
        }
      }
      return count;
    }

    async function countObjectivePending(db, uid, targetDate) {
      if (!db || !uid) return 0;
      const date = normalizeDateLike(targetDate);
      const targetIso = Schema.dayKeyFromDate(date);
      const currentMonthKey = Schema.monthKeyFromDate(date);
      const previousMonthKey = shiftMonthKey(currentMonthKey, -1);
      const monthKeys = new Set([currentMonthKey]);
      if (previousMonthKey && previousMonthKey !== currentMonthKey) {
        monthKeys.add(previousMonthKey);
      }

      const objectivesById = new Map();
      await Promise.all(
        Array.from(monthKeys).map(async (monthKey) => {
          if (!monthKey) return;
          try {
            const rows = await Schema.listObjectivesByMonth(db, uid, monthKey);
            if (!Array.isArray(rows)) return;
            rows.forEach((row) => {
              if (row && row.id) {
                objectivesById.set(row.id, row);
              }
            });
          } catch (error) {
            console.warn("[badge] goals:list", error);
          }
        })
      );

      if (!objectivesById.size) {
        return 0;
      }

      let count = 0;
      for (const objective of objectivesById.values()) {
        if (!objective || objective.notifyOnTarget === false) {
          continue;
        }
        const dueDate = customObjectiveReminderDate(objective) || computeTheoreticalObjectiveDate(objective);
        if (!dueDate) continue;
        const dueIso = Schema.dayKeyFromDate(dueDate);
        if (dueIso !== targetIso) continue;

        let entry = null;
        if (typeof Schema.getObjectiveEntry === "function") {
          try {
            entry = await Schema.getObjectiveEntry(db, uid, objective.id, targetIso);
          } catch (error) {
            console.warn("[badge] goals:entry", error);
          }
        }
        if (entry && entry.v !== undefined && entry.v !== null) {
          continue;
        }
        count += 1;
      }
      return count;
    }

    async function refresh(explicitUid, options = {}) {
      if (!isBadgeSupported()) {
        return 0;
      }
      if (!isStandaloneDisplay()) {
        await applyBadgeValue(0);
        return 0;
      }
      const db = ctx.db;
      const uid = explicitUid || ctx.user?.uid || null;
      if (!db || !uid) {
        await applyBadgeValue(0);
        return 0;
      }
      const date = normalizeDateLike(options.date || new Date());
      if (!refreshPromise) {
        refreshPromise = (async () => {
          const [daily, goals] = await Promise.all([
            countDailyPending(db, uid, date),
            countObjectivePending(db, uid, date),
          ]);
          const total = Number(daily || 0) + Number(goals || 0);
          await applyBadgeValue(total);
          return total;
        })().catch((error) => {
          console.warn("[badge] refresh", error);
          return 0;
        });
      }
      try {
        return await refreshPromise;
      } finally {
        refreshPromise = null;
      }
    }

    async function clear() {
      if (!isBadgeSupported()) return;
      await applyBadgeValue(0);
    }

    return {
      refresh,
      clear,
      isBadgeSupported,
      countDailyPending,
      countObjectivePending,
    };
  })();

  window.__appBadge = {
    refresh: (uid, options) => badgeManager.refresh(uid, options),
    clear: () => badgeManager.clear(),
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        badgeManager.refresh().catch(() => {});
      }
    });
  }

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
    if (!trimmed) return null;

    if (/^#\/admin(?:\/|\?|$)/.test(trimmed)) {
      const [rawPath = "", searchPart = ""] = trimmed.split("?");
      const pathSegments = rawPath.replace(/^#\/+/g, "").split("/");
      if (!pathSegments[0]) {
        return "#/admin";
      }
      const normalizedPath = `#/${pathSegments.filter(Boolean).join("/") || "admin"}`;
      return searchPart ? `${normalizedPath}?${searchPart}` : normalizedPath;
    }

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

  const installShortcutManager = (() => {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    const originalHref = manifestLink ? manifestLink.getAttribute("href") : null;
    const baseAppleTitle = appleTitleMeta?.getAttribute("content") || BASE_TITLE;
    const manifestFallback = {
      name: BASE_TITLE,
      short_name: BASE_SHORT_APP_NAME,
      description: "Suivi quotidien des habitudes et de la pratique.",
      start_url: "./",
      scope: "./",
      display: "standalone",
      background_color: "#f6f7fb",
      theme_color: "#3ea6eb",
      lang: "fr",
      dir: "ltr",
      icons: [
        {
          src: "data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%20512%20512%27%20role%3D%27img%27%20aria-label%3D%27Habitudes%20et%20Pratique%27%3E%0A%20%20%3Crect%20width%3D%27512%27%20height%3D%27512%27%20rx%3D%27116%27%20fill%3D%27%233EA6EB%27%2F%3E%0A%20%20%3Ctext%20x%3D%2750%25%27%20y%3D%2758%25%27%20text-anchor%3D%27middle%27%20font-family%3D%27%22Segoe%20UI%20Emoji%22%2C%20%22Apple%20Color%20Emoji%22%2C%20%22Noto%20Color%20Emoji%22%2C%20sans-serif%27%20font-size%3D%27260%27%3E%F0%9F%8C%B1%3C%2Ftext%3E%0A%3C%2Fsvg%3E",
          sizes: "any",
          type: "image/svg+xml"
        },
        {
          src: "data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%20512%20512%27%20role%3D%27img%27%20aria-label%3D%27Habitudes%20et%20Pratique%27%3E%0A%20%20%3Crect%20width%3D%27512%27%20height%3D%27512%27%20fill%3D%27%233EA6EB%27%20rx%3D%27116%27%2F%3E%0A%20%20%3Ctext%20x%3D%2750%25%27%20y%3D%2758%25%27%20text-anchor%3D%27middle%27%20font-family%3D%27%22Segoe%20UI%20Emoji%22%2C%20%22Apple%20Color%20Emoji%22%2C%20%22Noto%20Color%20Emoji%22%2C%20sans-serif%27%20font-size%3D%27260%27%3E%F0%9F%8C%B1%3C%2Ftext%3E%0A%3C%2Fsvg%3E",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any maskable"
        }
      ]
    };
    let baseManifest = null;
    let baseManifestPromise = null;
    let currentBlobUrl = null;
    let lastSuffix = null;

    function cleanupBlobUrl() {
      if (!currentBlobUrl) return;
      try {
        URL.revokeObjectURL(currentBlobUrl);
      } catch (error) {
        console.warn("[install] manifest:revoke", error);
      }
      currentBlobUrl = null;
    }

    async function ensureBaseManifest() {
      if (baseManifest) return baseManifest;
      if (baseManifestPromise) return baseManifestPromise;
      if (!manifestLink || !originalHref) {
        baseManifestPromise = Promise.resolve(null);
        return baseManifestPromise;
      }
      const manifestUrl = new URL(originalHref, window.location.href);
      baseManifestPromise = fetch(manifestUrl.toString())
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then((data) => {
          baseManifest = data || null;
          return baseManifest;
        })
        .catch((error) => {
          console.warn("[install] manifest:load", error);
          return null;
        });
      return baseManifestPromise;
    }

    function computeLabel(base, suffix, maxLength) {
      const baseLabel = (base || "").trim();
      const trimmedSuffix = (suffix || "").trim();
      if (!trimmedSuffix) {
        return baseLabel || trimmedSuffix;
      }
      const separator = INSTALL_NAME_SEPARATOR;
      const candidate = `${trimmedSuffix}${separator}${baseLabel}`.trim();
      if (!maxLength || candidate.length <= maxLength) {
        return candidate;
      }
      const availableForSuffix = maxLength - baseLabel.length - separator.length;
      if (availableForSuffix <= 0) {
        return (baseLabel || candidate).slice(0, maxLength);
      }
      const ellipsis = "…";
      let suffixPart = trimmedSuffix;
      if (suffixPart.length > availableForSuffix) {
        if (availableForSuffix > ellipsis.length) {
          const room = Math.max(1, availableForSuffix - ellipsis.length);
          suffixPart = suffixPart.slice(0, room).trimEnd();
          if (!suffixPart) {
            suffixPart = trimmedSuffix.slice(0, room);
          }
          suffixPart = `${suffixPart}${ellipsis}`;
        } else {
          suffixPart = suffixPart.slice(0, availableForSuffix).trimEnd();
          if (!suffixPart) {
            suffixPart = trimmedSuffix.slice(0, availableForSuffix);
          }
        }
      }
      let result = `${suffixPart}${separator}${baseLabel}`.trim();
      if (result.length > maxLength) {
        result = result.slice(0, maxLength);
      }
      if (!result) {
        return candidate.slice(0, maxLength);
      }
      return result;
    }

    async function applySuffix(nextSuffix) {
      const targetSuffix = (nextSuffix || "").trim();
      if (lastSuffix === targetSuffix) {
        return;
      }
      lastSuffix = targetSuffix;
      const baseData = await ensureBaseManifest();
      const manifestSource = baseData || manifestFallback;
      const baseName = manifestSource?.name || BASE_TITLE;
      const baseShortName = manifestSource?.short_name || BASE_SHORT_APP_NAME;
      if (!targetSuffix) {
        cleanupBlobUrl();
        if (manifestLink && originalHref) {
          manifestLink.setAttribute("href", originalHref);
        }
        if (appleTitleMeta) {
          appleTitleMeta.setAttribute("content", baseAppleTitle);
        }
        return;
      }
      const manifestCopy = JSON.parse(JSON.stringify(manifestSource || {}));
      manifestCopy.name = computeLabel(baseName, targetSuffix, 60);
      manifestCopy.short_name = computeLabel(baseShortName, targetSuffix, 30);
      if (appleTitleMeta) {
        appleTitleMeta.setAttribute("content", computeLabel(baseAppleTitle, targetSuffix, 48));
      }
      if (!manifestLink) {
        return;
      }
      try {
        const blob = new Blob([JSON.stringify(manifestCopy)], { type: "application/manifest+json" });
        cleanupBlobUrl();
        const blobUrl = URL.createObjectURL(blob);
        manifestLink.setAttribute("href", blobUrl);
        currentBlobUrl = blobUrl;
      } catch (error) {
        console.warn("[install] manifest:update", error);
      }
    }

    return { applySuffix };
  })();

  function normalizeInstallSuffix(rawValue) {
    if (typeof rawValue !== "string") {
      return "";
    }
    const trimmed = rawValue.trim();
    if (!trimmed) return "";
    const normalized = typeof trimmed.normalize === "function" ? trimmed.normalize("NFKC") : trimmed;
    const lower = normalized.toLowerCase();
    if (lower === "utilisateur") {
      return "";
    }
    return trimmed;
  }

  async function updateInstallShortcutLabel(rawValue) {
    const suffix = normalizeInstallSuffix(rawValue);
    await installShortcutManager.applySuffix(suffix);
  }

  function safeUpdateInstallShortcutLabel(rawValue, context) {
    const { segments } = parseHash(ctx.route || window.location.hash || "#/admin");
    const routeKey = segments[0] || "admin";
    let targetValue = rawValue;
    if (routeKey === "admin") {
      const normalized = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
      if (normalized !== "admin") {
        targetValue = "Admin";
      }
    }
    updateInstallShortcutLabel(targetValue).catch((error) => {
      if (context) {
        console.warn(`[install] label:${context}`, error);
      } else {
        console.warn("[install] label", error);
      }
    });
  }

  function resolveInstallLabelFromProfile(profile) {
    if (!profile) return "";
    return profile.displayName || profile.name || profile.slug || "";
  }

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
    const primarySwUrl = new URL(PRIMARY_SERVICE_WORKER_FILE, basePath);
    const legacySwUrl = new URL(LEGACY_SERVICE_WORKER_FILE, basePath);
    serviceWorkerRegistrationPromise = (async () => {
      try {
        const existing = await navigator.serviceWorker.getRegistration();
        if (existing) {
          const scriptUrl =
            existing.active?.scriptURL ||
            existing.installing?.scriptURL ||
            existing.waiting?.scriptURL ||
            "";
          const knownSuffixes = [
            `/${PRIMARY_SERVICE_WORKER_FILE}`,
            `/${LEGACY_SERVICE_WORKER_FILE}`,
          ];
          if (!knownSuffixes.some((suffix) => scriptUrl.endsWith(suffix))) {
            existing.update().catch((error) => {
              console.warn("[push] sw:update", error);
            });
          }
          return existing;
        }
      } catch (error) {
        console.warn("[push] sw:getRegistration", error);
      }
      try {
        const registration = await navigator.serviceWorker.register(primarySwUrl.href, {
          scope: "./",
        });
        window.__appSWRegistrationPromise = Promise.resolve(registration);
        return registration;
      } catch (error) {
        console.warn("[push] sw:register", error);
        if (primarySwUrl.href !== legacySwUrl.href) {
          try {
            const fallbackRegistration = await navigator.serviceWorker.register(
              legacySwUrl.href,
              { scope: "./" }
            );
            window.__appSWRegistrationPromise = Promise.resolve(fallbackRegistration);
            return fallbackRegistration;
          } catch (fallbackError) {
            console.warn("[push] sw:register:fallback", fallbackError);
          }
        }
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
            data.body || "Tu as des éléments à remplir aujourd’hui.";
          const link = data.link || "/";

          const notificationInstance = new Notification(title, {
            body,
            icon: data.icon || DEFAULT_NOTIFICATION_ICON,
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

  async function preparePushToken({ interactive = false } = {}) {
    if (!isPushSupported()) {
      if (interactive) alert("Les notifications ne sont pas disponibles sur ce navigateur.");
      return null;
    }

    let permission = "denied";
    try {
      permission = Notification.permission;
      if (interactive || permission === "default") {
        permission = await Notification.requestPermission();
      }
    } catch (error) {
      console.warn("[push] permission:error", error);
      if (interactive) alert("Impossible de demander l’autorisation de notifications.");
      return null;
    }

    if (permission !== "granted") {
      if (interactive) alert("Permission de notifications refusée.");
      return null;
    }

    const messaging = await ensureMessagingInstance();
    if (!messaging) {
      if (interactive) alert("Impossible d’initialiser le service de notifications Firebase.");
      return null;
    }

    const registration = await ensureServiceWorkerRegistration();
    if (!registration) {
      if (interactive) alert("Impossible d’initialiser le service worker des notifications.");
      return null;
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
      return null;
    }

    if (!token) {
      if (interactive) alert("Impossible de récupérer le jeton de notifications.");
      return null;
    }

    return { token, messaging };
  }

  async function enablePushForUid(uid, { interactive = false } = {}) {
    if (!uid || !ctx.db) return false;

    const setup = await preparePushToken({ interactive });
    if (!setup) return false;

    try {
      await Schema.savePushToken(ctx.db, uid, setup.token);
      setPushPreference(uid, { token: setup.token, enabled: true, updatedAt: Date.now() });
      bindForegroundNotifications(setup.messaging);
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

  const ADMIN_PUSH_PREF_KEY = "hp::push::admin";
  let adminPushPrefsCache = null;

  function loadAdminPushPref() {
    if (adminPushPrefsCache) return adminPushPrefsCache;
    const storage = getSafeStorage();
    if (!storage) return {};
    try {
      const raw = storage.getItem(ADMIN_PUSH_PREF_KEY);
      if (!raw) {
        adminPushPrefsCache = {};
        return adminPushPrefsCache;
      }
      const parsed = JSON.parse(raw);
      adminPushPrefsCache = typeof parsed === "object" && parsed ? parsed : {};
    } catch (error) {
      console.warn("[push] admin:prefs:parse", error);
      adminPushPrefsCache = {};
    }
    return adminPushPrefsCache;
  }

  function saveAdminPushPref(next) {
    adminPushPrefsCache = next || {};
    const storage = getSafeStorage();
    if (!storage) return;
    try {
      storage.setItem(ADMIN_PUSH_PREF_KEY, JSON.stringify(adminPushPrefsCache));
    } catch (error) {
      console.warn("[push] admin:prefs:save", error);
    }
  }

  function getAdminPushPreference() {
    const prefs = loadAdminPushPref();
    return prefs || {};
  }

  function setAdminPushPreference(value) {
    const current = { ...loadAdminPushPref() };
    adminPushPrefsCache = { ...current, ...value };
    saveAdminPushPref(adminPushPrefsCache);
  }

  async function enableAdminPush({ interactive = false } = {}) {
    if (!ctx.db) return false;

    const setup = await preparePushToken({ interactive });
    if (!setup) return false;

    try {
      await Schema.saveAdminPushToken(ctx.db, setup.token, { ownerUid: ctx.user?.uid || null });
      setAdminPushPreference({ token: setup.token, enabled: true, updatedAt: Date.now() });
      bindForegroundNotifications(setup.messaging);
      return true;
    } catch (error) {
      console.warn("[push] admin:saveToken", error);
      if (interactive) alert("Impossible d’enregistrer le jeton de notifications admin.");
      return false;
    }
  }

  async function disableAdminPush({ interactive = false } = {}) {
    if (!ctx.db) return false;
    const pref = getAdminPushPreference();
    const token = pref?.token;

    setAdminPushPreference({ enabled: false });
    if (!token) return true;

    try {
      await Schema.disableAdminPushToken(ctx.db, token);
      setAdminPushPreference({ token: null, updatedAt: Date.now() });
      return true;
    } catch (error) {
      console.warn("[push] admin:disableToken", error);
      if (interactive) alert("Impossible de désactiver les notifications admin.");
      return false;
    }
  }

  function syncAdminNotificationsButton() {
    const buttons = queryAll("[data-admin-notif-toggle]");
    const status = document.getElementById("admin-notification-status");
    if (!buttons.length && !status) return;

    const pref = getAdminPushPreference();
    const enabled = !!(pref && pref.enabled && pref.token);

    buttons.forEach((btn) => {
      btn.dataset.enabled = enabled ? "1" : "0";
      const label = enabled ? "🔕 Désactiver les notifications admin" : "🔔 Activer les notifications admin";
      btn.textContent = label;
      if (!isPushSupported()) {
        btn.disabled = true;
        btn.title = "Notifications non disponibles sur cet appareil";
      } else if (!btn.dataset.loading || btn.dataset.loading === "0") {
        btn.disabled = false;
        btn.title = enabled ? "Désactiver les notifications admin" : "Activer les notifications admin";
      }
    });

    if (status) {
      if (!isPushSupported()) {
        status.textContent = "Les notifications ne sont pas disponibles sur ce navigateur.";
      } else if (enabled) {
        status.textContent = "Notifications admin actives sur cet appareil.";
      } else {
        status.textContent = "Notifications admin désactivées sur cet appareil.";
      }
    }
  }

  async function handleAdminNotificationToggle(trigger, { interactive = false } = {}) {
    setButtonLoading(trigger, true);
    const pref = getAdminPushPreference();
    const enabled = !!(pref && pref.enabled && pref.token);
    try {
      if (enabled) {
        await disableAdminPush({ interactive });
      } else {
        await enableAdminPush({ interactive });
      }
    } catch (error) {
      console.warn("[push] admin:toggle:error", error);
      if (interactive) alert("Impossible de mettre à jour les notifications admin.");
    } finally {
      setButtonLoading(trigger, false);
      if (trigger && !isPushSupported()) {
        trigger.disabled = true;
      }
      syncAdminNotificationsButton();
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
      safeUpdateInstallShortcutLabel("Admin", "admin-route");
      return;
    }

    if (explicitName != null) {
      const safeName = explicitName || "Utilisateur";
      applyBadge(safeName);
      safeUpdateInstallShortcutLabel(safeName, "explicit");
      return;
    }

    if (!uid) {
      applyBadge("Utilisateur");
      safeUpdateInstallShortcutLabel(null, "missing-uid");
      return;
    }
    applyBadge("…", false);
    try {
      const resolved = await Schema.getUserName(uid);
      const label = resolved || "Utilisateur";
      applyBadge(label);
      safeUpdateInstallShortcutLabel(resolved, "resolved");
    } catch (err) {
      console.warn("refreshUserBadge", err);
      applyBadge("Utilisateur");
      safeUpdateInstallShortcutLabel(null, "resolve-error");
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
          safeUpdateInstallShortcutLabel(resolveInstallLabelFromProfile(ctx.profile), "profile-watch");
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

  async function ensureAdminPushSubscription({ interactive = false } = {}) {
    const pref = getAdminPushPreference();
    if (!pref?.enabled) return;
    const success = await enableAdminPush({ interactive });
    if (success) syncAdminNotificationsButton();
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
    safeUpdateInstallShortcutLabel(resolveInstallLabelFromProfile(ctx.profile), "profile-init");

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
    badgeManager.refresh(user.uid).catch(() => {});
    const pref = getPushPreference(user.uid);
    if (pref?.enabled && isPushSupported()) {
      ensurePushSubscriptionForUid(user.uid, { interactive: false }).catch(console.error);
    }
    const adminPref = getAdminPushPreference();
    if (adminPref?.enabled && isPushSupported()) {
      ensureAdminPushSubscription({ interactive: false }).catch(console.error);
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
      <div class="space-y-5">
        <section class="card p-5 space-y-4">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div class="space-y-1">
              <h2 class="text-xl font-semibold">Admin — Utilisateurs</h2>
              <p class="text-sm text-[var(--muted)]">Gérez vos profils et vos rappels même sur petit écran.</p>
            </div>
            <div class="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
              <button type="button"
                      class="btn btn-ghost text-sm inline-flex justify-center w-full sm:w-auto"
                      data-admin-notif-toggle="1"
                      data-enabled="0"
                      title="Activer les notifications admin">🔔 Activer les notifications admin</button>
              <p class="text-xs text-[var(--muted)] sm:text-right" id="admin-notification-status"></p>
            </div>
          </div>
        </section>
        <div class="grid gap-4 md:grid-cols-2">
          <form id="new-user-form" class="card p-4 space-y-3" data-autosave-key="admin:new-user">
            <div class="space-y-1">
              <div class="font-semibold">Créer un utilisateur</div>
              <p class="text-sm text-[var(--muted)]">Ajoutez rapidement une nouvelle fiche depuis votre téléphone.</p>
            </div>
            <input type="text" id="new-user-name" placeholder="Nom de l’utilisateur" required class="w-full" />
            <button class="btn btn-primary w-full sm:w-auto" type="submit">Créer l’utilisateur</button>
          </form>
          <section class="card p-4 space-y-3">
            <div class="font-semibold">Astuces rapides</div>
            <ul class="space-y-2 text-sm text-[var(--muted)]">
              <li class="flex items-start gap-2">
                <span class="mt-0.5">📲</span>
                <span>Activez les notifications admin pour recevoir un rappel quand un membre doit être suivi.</span>
              </li>
              <li class="flex items-start gap-2">
                <span class="mt-0.5">✏️</span>
                <span>Renommez les profils pour refléter les surnoms courants et éviter les confusions.</span>
              </li>
              <li class="flex items-start gap-2">
                <span class="mt-0.5">🗑️</span>
                <span>Supprimez les comptes inactifs afin de garder une vue claire et légère.</span>
              </li>
            </ul>
          </section>
        </div>
        <section class="card p-4 space-y-4">
          <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div class="font-semibold">Utilisateurs existants</div>
            <p class="text-xs text-[var(--muted)] sm:text-right">Utilisez les actions ci-dessous pour gérer chaque profil.</p>
          </div>
          <div id="user-list" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"></div>
        </section>
      </div>
    `;

    queryAll("[data-admin-notif-toggle]")
      .filter((btn) => !btn.closest("#user-list"))
      .forEach((adminNotifBtn) => {
        adminNotifBtn.addEventListener("click", (event) => {
          event.preventDefault();
          const pref = getAdminPushPreference();
          const enabled = !!(pref && pref.enabled && pref.token);
          appLog("admin:notifications:toggle", { action: enabled ? "disable" : "enable", source: "header" });
          handleAdminNotificationToggle(adminNotifBtn, { interactive: true });
        });
      });
    syncAdminNotificationsButton();

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
      const uids = [];
      ss.forEach(d => {
        const data = d.data();
        const uid = d.id;
        const displayName = data.displayName || data.name || "(sans nom)";
        appLog("admin:users:load:item", { uid, displayName });
        const safeName = escapeHtml(displayName);
        const safeUid = escapeHtml(uid);
        const encodedUid = encodeURIComponent(uid);
        const link = `${location.origin}${location.pathname}#/u/${encodedUid}/daily`;
        uids.push(uid);
        items.push(`
          <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
            <div class="flex flex-col gap-1">
              <div class="font-semibold text-base">${safeName}</div>
              <div class="text-xs text-[var(--muted)] break-all">UID&nbsp;: ${safeUid}</div>
            </div>
            <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <a class="btn btn-ghost text-sm inline-flex justify-center w-full sm:w-auto"
                 href="${link}"
                 target="_blank"
                 rel="noopener noreferrer"
                 data-uid="${safeUid}"
                 data-action="open">Ouvrir</a>
              <button type="button"
                      class="btn btn-ghost text-sm inline-flex justify-center w-full sm:w-auto"
                      data-uid="${safeUid}"
                      data-admin-notif-toggle="1"
                      title="Gérer les notifications admin pour ${safeName}">🔔 Activer les notifications admin</button>
              <button type="button"
                      class="btn btn-ghost text-sm inline-flex justify-center w-full sm:w-auto"
                      data-uid="${safeUid}"
                      data-notif-toggle="1"
                      title="Gérer les notifications de ${safeName}">🔔 Activer les notifications</button>
              <button type="button"
                      class="btn btn-ghost text-sm inline-flex justify-center w-full sm:w-auto"
                      data-uid="${safeUid}"
                      data-name="${safeName}"
                      data-action="rename"
                      title="Renommer ${safeName}">✏️ Renommer</button>
              <button type="button"
                      class="btn btn-ghost text-sm inline-flex justify-center w-full sm:w-auto text-red-600"
                      data-uid="${safeUid}"
                      data-name="${safeName}"
                      data-action="delete"
                      title="Supprimer ${safeName}">🗑️ Supprimer</button>
            </div>
          </div>
        `);
      });
      list.innerHTML = items.join("") || "<div class='text-sm text-[var(--muted)]'>Aucun utilisateur</div>";
      syncAdminNotificationsButton();
      uids.forEach((itemUid) => {
        syncNotificationButtonsForUid(itemUid);
      });
      appLog("admin:users:load:done", { count: items.length });

      if (!list.dataset.bound) {
        list.addEventListener("click", async (e) => {
          const actionTarget = e.target.closest("[data-uid]");
          if (!actionTarget) return;
          const { uid, action, name } = actionTarget.dataset;
          if (!uid) return;
          if (actionTarget.hasAttribute("data-admin-notif-toggle")) {
            e.preventDefault();
            const pref = getAdminPushPreference();
            const enabled = !!(pref && pref.enabled && pref.token);
            appLog("admin:users:notificationsAdmin:toggle", { uid, action: enabled ? "disable" : "enable" });
            handleAdminNotificationToggle(actionTarget, { interactive: true });
            return;
          }
          if (actionTarget.hasAttribute("data-notif-toggle")) {
            e.preventDefault();
            appLog("admin:users:notifications:toggle", { uid });
            handleNotificationToggle(uid, actionTarget, { interactive: true });
            return;
          }
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
    if (ctx.user?.uid) {
      badgeManager.refresh(ctx.user.uid).catch(() => {});
    }

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
