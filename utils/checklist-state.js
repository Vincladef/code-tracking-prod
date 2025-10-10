(function () {
  const GLOBAL = typeof window !== "undefined" ? window : globalThis;
  const api = GLOBAL.Schema?.firestore || GLOBAL.firestoreAPI || {};
  const {
    collection,
    addDoc,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    serverTimestamp,
  } = api;

  const STORAGE_PREFIX = "lastChecklist";
  const HINT_CLASS = "preselect-hint";
  const HINT_WARNING_CLASS = "preselect-hint--warning";

  const context = {
    db: null,
    uid: null,
  };

  const processedRoots = new WeakSet();
  let observer = null;

  function safeLocalStorage() {
    try {
      return GLOBAL.localStorage || null;
    } catch (error) {
      console.warn("[checklist-state] localStorage inaccessible", error);
      return null;
    }
  }

  function isNonEmptyString(value) {
    return typeof value === "string" && value.length > 0;
  }

  function normalizeConsigneId(consigneId) {
    if (isNonEmptyString(consigneId)) return consigneId;
    if (consigneId == null) return "";
    return String(consigneId || "");
  }

  function storageKey(uid, consigneId) {
    const safeUid = normalizeConsigneId(uid) || "anon";
    const safeConsigne = normalizeConsigneId(consigneId) || "consigne";
    return `${STORAGE_PREFIX}:${safeUid}:${safeConsigne}`;
  }

  function quickHash(input) {
    const str = typeof input === "string" ? input : JSON.stringify(input || "");
    let hash = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash.toString(16);
  }

  function hashOptions(options) {
    if (!Array.isArray(options)) {
      return quickHash("");
    }
    const normalized = options
      .map((item) => (typeof item === "string" ? item.trim() : item == null ? "" : String(item)))
      .filter((item) => item.length > 0);
    return quickHash(JSON.stringify(normalized));
  }

  function normalizeSelectedIds(ids) {
    if (!Array.isArray(ids)) return [];
    const seen = new Set();
    const result = [];
    ids.forEach((value) => {
      const str = String(value ?? "").trim();
      if (!str) return;
      if (seen.has(str)) return;
      seen.add(str);
      result.push(str);
    });
    return result;
  }

  function normalizePayload(payload = {}) {
    const selectedIds = normalizeSelectedIds(payload.selectedIds);
    const optionsHash = isNonEmptyString(payload.optionsHash)
      ? payload.optionsHash
      : payload.optionsHash == null
      ? null
      : String(payload.optionsHash || "");
    const tsValue = typeof payload.ts === "number" ? payload.ts : Date.now();
    return {
      type: "checklist",
      consigneId: normalizeConsigneId(payload.consigneId),
      selectedIds,
      optionsHash,
      ts: tsValue,
    };
  }

  function cacheSelection(uid, consigneId, payload) {
    const storage = safeLocalStorage();
    if (!storage) return;
    const key = storageKey(uid, consigneId);
    try {
      storage.setItem(key, JSON.stringify(payload));
    } catch (error) {
      console.warn("[checklist-state] cache:set", error);
    }
  }

  function readCachedSelection(uid, consigneId) {
    const storage = safeLocalStorage();
    if (!storage) return null;
    const key = storageKey(uid, consigneId);
    const raw = storage.getItem(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return normalizePayload({ ...parsed, consigneId });
    } catch (error) {
      console.warn("[checklist-state] cache:parse", error);
      return null;
    }
  }

  async function saveSelection(db, uid, consigneId, payload = {}) {
    const normalized = normalizePayload({ ...payload, consigneId });
    const { selectedIds } = normalized;
    if (!uid || !consigneId) return normalized;
    cacheSelection(uid, consigneId, normalized);
    if (!db || typeof collection !== "function" || typeof addDoc !== "function") {
      return normalized;
    }
    try {
      const colRef = collection(db, "users", uid, "history");
      await addDoc(colRef, {
        type: "checklist",
        consigneId: normalized.consigneId,
        selectedIds,
        optionsHash: normalized.optionsHash || null,
        ts: typeof serverTimestamp === "function" ? serverTimestamp() : new Date(),
      });
    } catch (error) {
      console.warn("[checklist-state] firestore:save", error);
    }
    return normalized;
  }

  async function loadSelection(db, uid, consigneId) {
    if (!uid || !consigneId) return null;
    const cached = readCachedSelection(uid, consigneId);
    if (cached) {
      return cached;
    }
    if (!db ||
      typeof collection !== "function" ||
      typeof query !== "function" ||
      typeof where !== "function" ||
      typeof orderBy !== "function" ||
      typeof limit !== "function" ||
      typeof getDocs !== "function") {
      return null;
    }
    try {
      const constraints = [
        collection(db, "users", uid, "history"),
        where("type", "==", "checklist"),
        where("consigneId", "==", consigneId),
        orderBy("ts", "desc"),
        limit(1),
      ];
      const snap = await getDocs(query(...constraints));
      const doc = snap?.docs?.[0];
      if (!doc) return null;
      const data = doc.data() || {};
      const normalized = normalizePayload({
        consigneId,
        selectedIds: data.selectedIds,
        optionsHash: data.optionsHash,
        ts: data.ts instanceof Date ? data.ts.getTime() : data.ts,
      });
      cacheSelection(uid, consigneId, normalized);
      return normalized;
    } catch (error) {
      console.warn("[checklist-state] firestore:load", error);
      return null;
    }
  }

  function clearHint(root, consigneId) {
    if (!root) return;
    const parent = root.parentElement || root;
    if (!parent) return;
    const targetId = consigneId ? String(consigneId) : null;
    parent.querySelectorAll(`.${HINT_CLASS}`).forEach((node) => {
      if (!node || node.parentElement !== parent) {
        return;
      }
      if (targetId && node.dataset?.checklistFor && node.dataset.checklistFor !== targetId) {
        return;
      }
      node.remove();
    });
  }

  function renderHint(root, consigneId, { optionsChanged = false } = {}) {
    if (!root) return;
    const parent = root.parentElement || root;
    if (!parent) return;
    clearHint(root, consigneId);
    const hint = document.createElement("div");
    hint.className = HINT_CLASS;
    hint.textContent = "Réponses précédentes pré-appliquées";
    if (consigneId) {
      hint.dataset.checklistFor = String(consigneId);
    }
    if (optionsChanged) {
      hint.classList.add(HINT_WARNING_CLASS);
      const note = document.createElement("span");
      note.className = `${HINT_CLASS}__note`;
      note.textContent = "La consigne a changé depuis votre dernière réponse.";
      hint.appendChild(document.createTextNode(" "));
      hint.appendChild(note);
    }
    parent.insertBefore(hint, root);
  }

  function applySelection(root, payload, options = {}) {
    if (!root || !payload) return false;
    const selectedIds = normalizeSelectedIds(payload.selectedIds);
    const consigneId = normalizeConsigneId(options.consigneId || root.getAttribute("data-consigne-id") || root.dataset?.consigneId);
    const selectedSet = new Set(selectedIds);
    const checkboxes = Array.from(
      root.querySelectorAll('input[type="checkbox"][data-checklist-input], input[type="checkbox"][data-rich-checkbox="1"]')
    );
    if (!checkboxes.length) {
      return false;
    }
    let anyChange = false;
    checkboxes.forEach((input, index) => {
      const host = input.closest("[data-checklist-item]") || input.closest('[data-rich-checkbox-wrapper="1"]');
      const fallbackId = consigneId ? `${consigneId}:${index}` : String(index);
      const itemId = host?.getAttribute("data-item-id") || fallbackId;
      const shouldCheck = selectedSet.has(String(itemId));
      if (input.checked !== shouldCheck) {
        input.checked = shouldCheck;
        anyChange = true;
      }
      if (host) {
        host.setAttribute("data-validated", shouldCheck ? "true" : "false");
      }
    });
    const hidden = root.querySelector("[data-checklist-state]");
    if (hidden) {
      const values = checkboxes.map((input) => Boolean(input.checked));
      try {
        hidden.value = JSON.stringify(values);
      } catch (error) {
        console.warn("[checklist-state] hidden:update", error);
      }
      if (options.markDirty !== false) {
        hidden.dataset.dirty = "1";
      }
    }
    if (options.markDirty !== false) {
      root.dataset.checklistDirty = "1";
    }
    if (options.showHint !== false) {
      const optionsHash = options.optionsHash || root.getAttribute("data-checklist-options-hash") || root.dataset?.checklistOptionsHash;
      const changed = payload.optionsHash && optionsHash && payload.optionsHash !== optionsHash;
      if (selectedSet.size > 0 || changed) {
        renderHint(root, consigneId, { optionsChanged: changed });
      } else {
        clearHint(root, consigneId);
      }
    }
    root.dataset.checklistHydrated = "1";
    return anyChange;
  }

  async function hydrateRoot(root) {
    if (!(root instanceof Element)) return;
    if (processedRoots.has(root)) return;
    processedRoots.add(root);
    const consigneId = normalizeConsigneId(root.getAttribute("data-consigne-id") || root.dataset?.consigneId);
    if (!consigneId) return;
    const { db, uid } = context;
    if (!uid) return;
    try {
      const saved = await loadSelection(db, uid, consigneId);
      if (!saved) return;
      const optionsHash = root.getAttribute("data-checklist-options-hash") || root.dataset?.checklistOptionsHash || null;
      applySelection(root, saved, { consigneId, optionsHash });
    } catch (error) {
      console.warn("[checklist-state] hydrate", error);
    }
  }

  function hydrateExistingRoots(scope = GLOBAL.document) {
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll("[data-checklist-root]").forEach((root) => {
      processedRoots.delete(root);
      hydrateRoot(root);
    });
  }

  function setupObserver() {
    if (observer || !GLOBAL.document || typeof MutationObserver !== "function") {
      return;
    }
    observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) {
            return;
          }
          if (node.matches && node.matches("[data-checklist-root]")) {
            processedRoots.delete(node);
            hydrateRoot(node);
          }
          node.querySelectorAll?.("[data-checklist-root]").forEach((root) => {
            processedRoots.delete(root);
            hydrateRoot(root);
          });
        });
      });
    });
    observer.observe(GLOBAL.document.documentElement || GLOBAL.document.body, {
      childList: true,
      subtree: true,
    });
  }

  function teardownObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  async function persistResponses(db, uid, responses) {
    if (!Array.isArray(responses) || !responses.length) return;
    const tasks = [];
    responses.forEach((entry) => {
      if (!entry || entry.type !== "checklist") return;
      const consigneId = normalizeConsigneId(entry.consigneId || entry.consigne_id || entry.consigneID);
      if (!consigneId) return;
      const selectedIds = normalizeSelectedIds(entry.selectedIds || entry.selected_ids);
      const optionsHash = entry.optionsHash || entry.options_hash || null;
      tasks.push(
        saveSelection(db, uid, consigneId, {
          selectedIds,
          optionsHash,
        })
      );
    });
    if (tasks.length) {
      await Promise.all(tasks);
    }
  }

  function setContext(nextContext = {}) {
    const uid = normalizeConsigneId(nextContext.uid);
    const db = nextContext.db || null;
    context.uid = uid || null;
    context.db = db;
    if (!uid) {
      teardownObserver();
      return;
    }
    setupObserver();
    hydrateExistingRoots();
  }

  function clearContext() {
    context.uid = null;
    context.db = null;
    teardownObserver();
  }

  const ChecklistState = {
    hashOptions,
    saveSelection,
    loadSelection,
    applySelection,
    persistResponses,
    setContext,
    clearContext,
    storageKey,
    cacheSelection,
    readCachedSelection,
    hydrateExistingRoots,
  };

  GLOBAL.ChecklistState = Object.assign(GLOBAL.ChecklistState || {}, ChecklistState);
})();
