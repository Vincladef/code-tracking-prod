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
    doc,
    getDoc,
    setDoc,
  } = api;

  const DEFAULT_TIMEZONE = "Europe/Paris";
  const DAY_KEY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
  const FALLBACK_DAY_FORMATTER =
    typeof Intl !== "undefined"
      ? new Intl.DateTimeFormat("fr-CA", { timeZone: DEFAULT_TIMEZONE })
      : null;

  const STORAGE_PREFIX = "lastChecklist";
  const HINT_CLASS = "preselect-hint";
  const HINT_WARNING_CLASS = "preselect-hint--warning";

  const context = {
    db: null,
    uid: null,
  };

  const processedRoots = new WeakSet();
  let observer = null;

  function toMillis(value, fallback = Date.now()) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (value instanceof Date) {
      const time = value.getTime();
      return Number.isNaN(time) ? fallback : time;
    }
    if (value && typeof value.toMillis === "function") {
      try {
        const millis = value.toMillis();
        if (typeof millis === "number" && Number.isFinite(millis)) {
          return millis;
        }
      } catch (error) {
        console.warn("[checklist-state] toMillis:toMillis", error);
      }
    }
    if (value && typeof value.toDate === "function") {
      try {
        const date = value.toDate();
        if (date instanceof Date && !Number.isNaN(date.getTime())) {
          return date.getTime();
        }
      } catch (error) {
        console.warn("[checklist-state] toMillis:toDate", error);
      }
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value.trim());
      const parsedTime = parsed.getTime();
      if (!Number.isNaN(parsedTime)) {
        return parsedTime;
      }
    }
    return fallback;
  }

  function parisDayKey(value) {
    const date = value instanceof Date ? value : new Date(value ?? Date.now());
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return parisDayKey(Date.now());
    }
    const dayKeyParisFn = GLOBAL.DateUtils?.dayKeyParis;
    if (typeof dayKeyParisFn === "function") {
      try {
        const key = dayKeyParisFn(date);
        if (typeof key === "string" && DAY_KEY_REGEX.test(key)) {
          return key;
        }
      } catch (error) {
        console.warn("[checklist-state] dayKeyParis", error);
      }
    }
    if (FALLBACK_DAY_FORMATTER) {
      try {
        const formatted = FALLBACK_DAY_FORMATTER.format(date);
        if (typeof formatted === "string" && DAY_KEY_REGEX.test(formatted)) {
          return formatted;
        }
      } catch (error) {
        console.warn("[checklist-state] dayKey:fallback", error);
      }
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function normalizeDateKey(value) {
    if (typeof value === "string" && value.trim()) {
      const trimmed = value.trim();
      if (DAY_KEY_REGEX.test(trimmed)) {
        return trimmed;
      }
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return parisDayKey(parsed);
      }
    }
    if (value instanceof Date) {
      return parisDayKey(value);
    }
    if (value && typeof value.toDate === "function") {
      try {
        return normalizeDateKey(value.toDate());
      } catch (error) {
        console.warn("[checklist-state] normalizeDateKey:toDate", error);
      }
    }
    if (value && typeof value.toMillis === "function") {
      try {
        return normalizeDateKey(value.toMillis());
      } catch (error) {
        console.warn("[checklist-state] normalizeDateKey:toMillis", error);
      }
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return parisDayKey(value);
    }
    return parisDayKey(Date.now());
  }

  function currentParisDayKey() {
    return normalizeDateKey(Date.now());
  }

  function snapshotHasData(snap) {
    const schemaSnapshotExists = GLOBAL.Schema?.snapshotExists;
    if (typeof schemaSnapshotExists === "function") {
      try {
        return schemaSnapshotExists(snap);
      } catch (error) {
        console.warn("[checklist-state] snapshotExists", error);
      }
    }
    if (!snap) return false;
    if (typeof snap.exists === "function") {
      try {
        return !!snap.exists();
      } catch (error) {
        console.warn("[checklist-state] snapshot:existsFn", error);
      }
    }
    if (typeof snap.exists === "boolean") {
      return snap.exists;
    }
    if ("exists" in snap) {
      return Boolean(snap.exists);
    }
    return false;
  }

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

  function storageKey(uid, consigneId, dateKey) {
    const safeUid = normalizeConsigneId(uid) || "anon";
    const safeConsigne = normalizeConsigneId(consigneId) || "consigne";
    const safeDate = normalizeDateKey(dateKey);
    return `${STORAGE_PREFIX}:${safeUid}:${safeConsigne}:${safeDate}`;
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

  function fallbackSelectedIds(consigneId, data = {}, { useLegacyIds = true } = {}) {
    const normalizedConsigneId = normalizeConsigneId(consigneId);
    if (!normalizedConsigneId) {
      return [];
    }
    const fromSelected = Array.isArray(data.selectedIds) ? data.selectedIds : data.selected_ids;
    if (Array.isArray(fromSelected) && fromSelected.length) {
      return normalizeSelectedIds(fromSelected);
    }
    const legacyChecked = Array.isArray(data.checkedIds)
      ? data.checkedIds
      : Array.isArray(data.checked_ids)
      ? data.checked_ids
      : null;
    if (Array.isArray(legacyChecked) && legacyChecked.length) {
      const legacyIds = legacyChecked
        .map((value, index) => {
          if (!useLegacyIds) {
            return null;
          }
          if (typeof value === "string" && value.trim()) {
            return value.trim();
          }
          const numeric = Number(value);
          if (Number.isFinite(numeric)) {
            return `${normalizedConsigneId}:${numeric}`;
          }
          return `${normalizedConsigneId}:${index}`;
        })
        .filter(Boolean);
      if (legacyIds.length) {
        return normalizeSelectedIds(legacyIds);
      }
    }
    const rawItems = data?.value && typeof data.value === "object" ? data.value.items : null;
    if (Array.isArray(rawItems) && rawItems.length) {
      const inferred = rawItems
        .map((checked, index) => (checked ? `${normalizedConsigneId}:${index}` : null))
        .filter(Boolean);
      if (inferred.length) {
        return normalizeSelectedIds(inferred);
      }
    }
    return [];
  }

  function normalizePayload(payload = {}) {
    const selectedIds = normalizeSelectedIds(payload.selectedIds || payload.checked);
    const optionsHash = isNonEmptyString(payload.optionsHash)
      ? payload.optionsHash
      : payload.optionsHash == null
      ? null
      : String(payload.optionsHash || "");
    const tsValue = toMillis(payload.updatedAt ?? payload.ts, Date.now());
    const rawDateKey =
      payload.dateKey ||
      payload.dayKey ||
      payload.date_key ||
      payload.day_key ||
      payload.date ||
      null;
    const dateKey = normalizeDateKey(rawDateKey || tsValue);
    return {
      type: "checklist",
      consigneId: normalizeConsigneId(payload.consigneId),
      selectedIds,
      optionsHash,
      ts: tsValue,
      dateKey,
    };
  }

  function cacheSelection(uid, consigneId, payload) {
    const storage = safeLocalStorage();
    if (!storage) return;
    const key = storageKey(uid, consigneId, payload?.dateKey);
    try {
      storage.setItem(key, JSON.stringify(payload));
    } catch (error) {
      console.warn("[checklist-state] cache:set", error);
    }
  }

  function readCachedSelection(uid, consigneId, dateKey = currentParisDayKey()) {
    const storage = safeLocalStorage();
    if (!storage) return null;
    const key = storageKey(uid, consigneId, dateKey);
    const raw = storage.getItem(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const normalized = normalizePayload({ ...parsed, consigneId });
      const expectedKey = normalizeDateKey(dateKey);
      if (normalized.dateKey !== expectedKey) {
        return null;
      }
      return normalized;
    } catch (error) {
      console.warn("[checklist-state] cache:parse", error);
      return null;
    }
  }

  async function saveSelection(db, uid, consigneId, payload = {}) {
    const normalized = normalizePayload({ ...payload, consigneId });
    const finalPayload = {
      ...normalized,
      dateKey: normalizeDateKey(normalized.dateKey),
    };
    if (!uid || !consigneId) return finalPayload;
    cacheSelection(uid, consigneId, finalPayload);
    const timestamp = Date.now();
    if (db && typeof doc === "function" && typeof setDoc === "function") {
      try {
        const docRef = doc(db, "users", uid, "answers", finalPayload.dateKey, "consignes", finalPayload.consigneId);
        await setDoc(
          docRef,
          {
            selectedIds: finalPayload.selectedIds,
            checked: finalPayload.selectedIds,
            optionsHash: finalPayload.optionsHash || null,
            updatedAt: timestamp,
            ts: finalPayload.ts,
            dateKey: finalPayload.dateKey,
          },
          { merge: true }
        );
      } catch (error) {
        console.warn("[checklist-state] firestore:answers", error);
      }
    }
    if (db && typeof collection === "function" && typeof addDoc === "function") {
      try {
        const colRef = collection(db, "users", uid, "history");
        await addDoc(colRef, {
          type: "checklist",
          consigneId: finalPayload.consigneId,
          selectedIds: finalPayload.selectedIds,
          optionsHash: finalPayload.optionsHash || null,
          dateKey: finalPayload.dateKey,
          ts: typeof serverTimestamp === "function" ? serverTimestamp() : new Date(),
        });
      } catch (error) {
        console.warn("[checklist-state] firestore:save", error);
      }
    }
    return finalPayload;
  }

  async function loadSelection(db, uid, consigneId) {
    if (!uid || !consigneId) return null;
    const todayKey = currentParisDayKey();
    const cached = readCachedSelection(uid, consigneId, todayKey);
    if (cached) {
      return cached;
    }
    if (db && typeof doc === "function" && typeof getDoc === "function") {
      try {
        const ref = doc(db, "users", uid, "answers", todayKey, "consignes", consigneId);
        const snap = await getDoc(ref);
        if (snapshotHasData(snap)) {
          const data = typeof snap.data === "function" ? snap.data() || {} : snap?.data || {};
          const normalized = normalizePayload({
            consigneId,
            selectedIds: data.checked || data.selectedIds,
            optionsHash: data.optionsHash,
            ts: data.updatedAt ?? data.ts,
            dateKey: data.dateKey || data.dayKey || todayKey,
          });
          cacheSelection(uid, consigneId, normalized);
          return normalized;
        }
      } catch (error) {
        console.warn("[checklist-state] firestore:answers:load", error);
      }
    }
    if (db &&
      typeof collection === "function" &&
      typeof query === "function" &&
      typeof where === "function" &&
      typeof limit === "function" &&
      typeof getDocs === "function") {
      try {
        const responsesSnap = await getDocs(
          query(
            collection(db, "u", uid, "responses"),
            where("consigneId", "==", consigneId),
            where("dayKey", "==", todayKey),
            limit(1)
          )
        );
        const docSnap = responsesSnap?.docs?.[0];
        if (docSnap) {
          const data = docSnap.data() || {};
          const selectedIds = fallbackSelectedIds(consigneId, data);
          const normalized = normalizePayload({
            consigneId,
            selectedIds,
            optionsHash: data.optionsHash,
            ts: data.updatedAt || data.ts || data.createdAt,
            dateKey: data.dayKey || data.dateKey || todayKey,
          });
          cacheSelection(uid, consigneId, normalized);
          return normalized;
        }
      } catch (error) {
        console.warn("[checklist-state] firestore:responses:load", error);
      }
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
      const docSnap = snap?.docs?.[0];
      if (!docSnap) return null;
      const data = docSnap.data() || {};
      const normalized = normalizePayload({
        consigneId,
        selectedIds: data.selectedIds,
        optionsHash: data.optionsHash,
        ts:
          data.ts instanceof Date
            ? data.ts.getTime()
            : data.ts && typeof data.ts.toDate === "function"
            ? data.ts.toDate().getTime()
            : data.ts,
        dateKey: data.dateKey || data.dayKey,
      });
      if (normalized.dateKey !== todayKey) {
        return null;
      }
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

  function collectChecklistEntries(root, consigneId) {
    if (!root) return [];
    const checkboxes = Array.from(
      root.querySelectorAll(
        'input[type="checkbox"][data-checklist-input], input[type="checkbox"][data-rich-checkbox="1"]'
      )
    );
    return checkboxes.map((input, index) => {
      const host =
        input.closest("[data-checklist-item]") || input.closest('[data-rich-checkbox-wrapper="1"]') || null;
      const explicitId =
        input.getAttribute("data-key") ||
        input.dataset?.key ||
        input.getAttribute("data-item-id") ||
        input.dataset?.itemId ||
        input.dataset?.id ||
        host?.getAttribute?.("data-checklist-key") ||
        null;
      const hostId = host?.getAttribute?.("data-item-id") || null;
      const legacySource =
        input.getAttribute("data-legacy-key") ||
        input.dataset?.legacyKey ||
        host?.getAttribute?.("data-checklist-legacy-key") ||
        null;
      const fallbackId = consigneId ? `${consigneId}:${index}` : String(index);
      const legacyId = legacySource || fallbackId;
      const itemId = explicitId || hostId || fallbackId;
      if (host && (!hostId || hostId !== itemId)) {
        host.setAttribute("data-item-id", itemId);
        host.setAttribute("data-checklist-key", itemId);
        if (legacyId) {
          host.setAttribute("data-checklist-legacy-key", legacyId);
        }
      }
      if (!explicitId && typeof input.setAttribute === "function") {
        input.setAttribute("data-item-id", itemId);
        input.setAttribute("data-key", itemId);
        if (input.dataset) {
          input.dataset.key = itemId;
        }
      }
      if (typeof input.setAttribute === "function") {
        input.setAttribute("data-legacy-key", legacyId);
        if (input.dataset) {
          input.dataset.legacyKey = legacyId;
        }
      }
      return { input, host, itemId, legacyId };
    });
  }

  function readSelectedIdsFromEntries(entries) {
    if (!Array.isArray(entries) || !entries.length) {
      return [];
    }
    return normalizeSelectedIds(
      entries
        .filter((entry) => entry && entry.input && entry.input.checked)
        .map((entry) => entry.itemId)
    );
  }

  function applySelection(root, payload, options = {}) {
    if (!root || !payload) return false;
    const selectedIds = normalizeSelectedIds(payload.selectedIds);
    const consigneId = normalizeConsigneId(options.consigneId || root.getAttribute("data-consigne-id") || root.dataset?.consigneId);
    const selectedSet = new Set(selectedIds.map((value) => String(value)));
    const entries = collectChecklistEntries(root, consigneId);
    if (!entries.length) {
      return false;
    }
    let anyChange = false;
    entries.forEach(({ input, host, itemId, legacyId }) => {
      const shouldCheck =
        selectedSet.has(String(itemId)) || (legacyId ? selectedSet.has(String(legacyId)) : false);
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
      const values = entries.map(({ input }) => Boolean(input.checked));
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

  async function persistRoot(root, options = {}) {
    if (!(root instanceof Element)) return null;
    const consigneId = normalizeConsigneId(options.consigneId || root.getAttribute("data-consigne-id") || root.dataset?.consigneId);
    if (!consigneId) {
      return null;
    }
    const entries = collectChecklistEntries(root, consigneId);
    if (!entries.length) {
      return null;
    }
    const selectedIds = readSelectedIdsFromEntries(entries);
    const optionsHash =
      options.optionsHash || root.getAttribute("data-checklist-options-hash") || root.dataset?.checklistOptionsHash || null;
    const payload = {
      selectedIds,
      optionsHash,
      dateKey: options.dateKey || currentParisDayKey(),
      ts: Date.now(),
    };
    const { db, uid } = context;
    if (!uid) {
      return normalizePayload({ consigneId, ...payload });
    }
    try {
      return await saveSelection(db, uid, consigneId, payload);
    } catch (error) {
      console.warn("[checklist-state] persistRoot", error);
      return null;
    }
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
      const dateKey =
        entry.dateKey || entry.dayKey || entry.date_key || entry.day_key || entry.date || null;
      const ts = entry.updatedAt || entry.ts;
      tasks.push(
        saveSelection(db, uid, consigneId, {
          selectedIds,
          optionsHash,
          dateKey,
          ts,
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
    persistRoot,
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
