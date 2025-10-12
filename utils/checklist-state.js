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
  const HINT_DATE_FORMATTER =
    typeof Intl !== "undefined"
      ? new Intl.DateTimeFormat("fr-FR", {
          timeZone: DEFAULT_TIMEZONE,
          weekday: "short",
          day: "numeric",
          month: "long",
        })
      : null;

  const STORAGE_PREFIX = "lastChecklist";
  const HINT_CLASS = "preselect-hint";
  const HINT_WARNING_CLASS = "preselect-hint--warning";

  const context = {
    db: null,
    uid: null,
  };
  const ENABLE_DEBUG_LOGS = true;
  const stateLogger =
    typeof GLOBAL.Schema === "object" && GLOBAL.Schema && typeof GLOBAL.Schema.D === "object"
      ? GLOBAL.Schema.D
      : null;
  function debugLog(event, payload, level = "info") {
    const globalFlag =
      typeof GLOBAL.__CHECKLIST_STATE_DEBUG__ === "boolean"
        ? GLOBAL.__CHECKLIST_STATE_DEBUG__
        : null;
    const shouldLog = globalFlag === null ? ENABLE_DEBUG_LOGS : globalFlag;
    if (!shouldLog) {
      return;
    }
    const label = `checklist.state.${event}`;
    const loggerMethod =
      stateLogger && typeof stateLogger[level] === "function"
        ? stateLogger[level].bind(stateLogger)
        : null;
    const fallback =
      level === "warn"
        ? console.warn
        : level === "error"
        ? console.error
        : console.info;
    if (loggerMethod) {
      if (payload === undefined) {
        loggerMethod(label);
      } else {
        loggerMethod(label, payload);
      }
      return;
    }
    if (payload === undefined) {
      fallback.call(console, `[checklist-state] ${event}`);
      return;
    }
    fallback.call(console, `[checklist-state] ${event}`, payload);
  }
  let observer = null;
  const processedRoots = new WeakSet();
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

  function normalizeAnswerValue(value) {
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return "no";
      if (["yes", "true", "1", "ok", "done"].includes(normalized)) {
        return "yes";
      }
      if (["maybe", "partial", "pending", "partial_yes"].includes(normalized)) {
        return "maybe";
      }
      if (["no", "false", "0", "ko"].includes(normalized)) {
        return "no";
      }
      return "no";
    }
    if (value === true) return "yes";
    if (value === false) return "no";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return "no";
      return value > 0 ? "yes" : "no";
    }
    return value ? "yes" : "no";
  }

  function normalizeSkippedFlag(value) {
    if (value === true) return true;
    if (value === false || value == null) return false;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return false;
      return value !== 0;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return false;
      return ["1", "true", "yes", "y", "on", "skip", "passed"].includes(normalized);
    }
    return false;
  }

  function normalizeAnswers(answers) {
    if (!answers || typeof answers !== "object") {
      return {};
    }
    const entries = answers instanceof Map ? Array.from(answers.entries()) : Object.entries(answers);
    if (!entries.length) {
      return {};
    }
    const normalized = {};
    entries.forEach(([rawKey, rawValue]) => {
      const key = String(rawKey ?? "").trim();
      if (!key) {
        return;
      }
      let entry = rawValue;
      if (entry == null) {
        entry = { value: "no", skipped: false };
      }
      if (typeof entry !== "object" || Array.isArray(entry)) {
        entry = { value: entry };
      }
      const skipValue = Object.prototype.hasOwnProperty.call(entry, "skipped")
        ? entry.skipped
        : entry.skiped;
      const isSkipped = normalizeSkippedFlag(skipValue);
      // Si skipped, la valeur est toujours 'no' (jamais cochée)
      const normalizedEntry = {
        value: isSkipped ? "no" : normalizeAnswerValue(entry.value),
        skipped: isSkipped,
      };
      normalized[key] = normalizedEntry;
    });
    return normalized;
  }

  function hasAnswerEntries(map) {
    return map && typeof map === "object" && Object.keys(map).length > 0;
  }

  function parseChecklistValue(raw) {
    if (!raw) {
      return null;
    }
    if (raw instanceof Map) {
      return Object.fromEntries(raw.entries());
    }
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
          return null;
        }
        return parsed;
      } catch (error) {
        console.warn("[checklist-state] checklistValue:parse", error);
        return null;
      }
    }
    if (typeof raw !== "object") {
      return null;
    }
    return raw;
  }

  function selectedIdsFromAnswers(answers) {
    if (!answers || typeof answers !== "object") {
      return [];
    }
    // Toujours normaliser les réponses avant de compter
    const normalized = normalizeAnswers(answers);
    return Object.entries(normalized)
      .filter(([key, entry]) => {
        if (!entry || typeof entry !== "object") return false;
        if (normalizeSkippedFlag(entry.skipped)) {
          // Alerte si jamais un item skipped a value 'yes' (devrait être impossible)
          const value = String(entry.value ?? "").toLowerCase();
          if (value === "yes" || value === "maybe") {
            if (typeof window !== "undefined" && window.console) {
              window.console.warn("[checklist-state] ALERTE: item skipped mais value 'yes'!", { key, entry });
            }
          }
          return false;
        }
        const value = String(entry.value ?? "").toLowerCase();
        const isPositive = value === "yes" || value === "maybe";
        return isPositive;
      })
      .map(([key]) => key);
  }

  function answersToMap(answers) {
    const map = new Map();
    if (!answers || typeof answers !== "object") {
      return map;
    }
    Object.entries(answers).forEach(([key, entry]) => {
      const id = String(key ?? "").trim();
      if (!id) return;
      if (!entry || typeof entry !== "object") {
        map.set(id, { value: normalizeAnswerValue(entry), skipped: false });
        return;
      }
      map.set(id, {
        value: normalizeAnswerValue(entry.value),
        skipped: normalizeSkippedFlag(entry.skipped),
      });
    });
    return map;
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
    const normalizedConsigneId = normalizeConsigneId(payload.consigneId);
    const rawChecklistValue =
      parseChecklistValue(payload.checklistValue) ||
      parseChecklistValue(payload.value) ||
      parseChecklistValue(payload.normalizedValue);
    const normalizedFromChecklist = normalizeAnswers(
      rawChecklistValue && typeof rawChecklistValue === "object"
        ? rawChecklistValue.answers || rawChecklistValue.answerMap
        : null
    );
    let normalizedAnswers = normalizeAnswers(payload.answers || payload.answerMap);
    if (hasAnswerEntries(normalizedFromChecklist)) {
      if (hasAnswerEntries(normalizedAnswers)) {
        normalizedAnswers = { ...normalizedFromChecklist, ...normalizedAnswers };
      } else {
        normalizedAnswers = normalizedFromChecklist;
      }
    }
    let selectedIds = normalizeSelectedIds(payload.selectedIds || payload.checked);
    if (rawChecklistValue && Array.isArray(rawChecklistValue.selectedIds) && rawChecklistValue.selectedIds.length) {
      selectedIds = normalizeSelectedIds([...selectedIds, ...rawChecklistValue.selectedIds]);
    }
    if (!selectedIds.length && rawChecklistValue) {
      const inferred = fallbackSelectedIds(normalizedConsigneId, { value: rawChecklistValue });
      if (inferred.length) {
        selectedIds = normalizeSelectedIds([...selectedIds, ...inferred]);
      }
    }
    if (hasAnswerEntries(normalizedAnswers)) {
      const derived = selectedIdsFromAnswers(normalizedAnswers);
      // On privilégie toujours les réponses: elles définissent la vérité
      selectedIds = normalizeSelectedIds(derived);
    }
    const rawSkippedIds = Array.isArray(payload.skippedIds)
      ? payload.skippedIds
      : Array.isArray(payload.skipped_ids)
      ? payload.skipped_ids
      : null;
    let skippedIds = normalizeSelectedIds(rawSkippedIds || []);
    if (rawChecklistValue && Array.isArray(rawChecklistValue.skippedIds) && rawChecklistValue.skippedIds.length) {
      skippedIds = normalizeSelectedIds([...skippedIds, ...rawChecklistValue.skippedIds]);
    }
    if (hasAnswerEntries(normalizedAnswers) && skippedIds.length) {
      skippedIds.forEach((id) => {
        const key = String(id || "");
        if (!key) return;
        const existing = normalizedAnswers[key];
        if (existing && typeof existing === "object") {
          normalizedAnswers[key] = { ...existing, skipped: true };
        } else {
          normalizedAnswers[key] = { value: "yes", skipped: true };
        }
      });
    }
    // Sécurité finale: si on a des réponses, recalculer selectedIds uniquement à partir d'elles
    if (hasAnswerEntries(normalizedAnswers)) {
      selectedIds = selectedIdsFromAnswers(normalizedAnswers);
    }
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
      consigneId: normalizedConsigneId,
      selectedIds,
      optionsHash,
      ts: tsValue,
      dateKey,
      answers: normalizedAnswers,
      skippedIds,
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
        const docRef = doc(db, "u", uid, "answers", finalPayload.dateKey, "consignes", finalPayload.consigneId);
        await setDoc(
          docRef,
          {
            selectedIds: finalPayload.selectedIds,
            checked: finalPayload.selectedIds,
            optionsHash: finalPayload.optionsHash || null,
            answers: finalPayload.answers || {},
            skippedIds: finalPayload.skippedIds || [],
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
        const colRef = collection(db, "u", uid, "history");
        await addDoc(colRef, {
          type: "checklist",
          consigneId: finalPayload.consigneId,
          selectedIds: finalPayload.selectedIds,
          optionsHash: finalPayload.optionsHash || null,
          dateKey: finalPayload.dateKey,
          skippedIds: finalPayload.skippedIds || [],
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
      debugLog("loadSelection:cache-hit", {
        consigneId,
        dateKey: cached.dateKey,
        selected: Array.isArray(cached.selectedIds) ? cached.selectedIds.length : 0,
        hasAnswers: Boolean(cached.answers && Object.keys(cached.answers).length),
      });
      return cached;
    }
    debugLog("loadSelection:cache-miss", { consigneId, dateKey: todayKey });
    if (db && typeof doc === "function" && typeof getDoc === "function") {
      try {
        const ref = doc(db, "u", uid, "answers", todayKey, "consignes", consigneId);
        const snap = await getDoc(ref);
        if (snapshotHasData(snap)) {
          const data = typeof snap.data === "function" ? snap.data() || {} : snap?.data || {};
          const normalized = normalizePayload({
            consigneId,
            selectedIds: data.checked || data.selectedIds,
            optionsHash: data.optionsHash,
            ts: data.updatedAt ?? data.ts,
            dateKey: data.dateKey || data.dayKey || todayKey,
            answers: data.answers,
            skippedIds: data.skippedIds,
          });
          cacheSelection(uid, consigneId, normalized);
          debugLog("loadSelection:firestore-answer", {
            consigneId,
            dateKey: normalized.dateKey,
            selected: normalized.selectedIds.length,
            hasAnswers: Boolean(normalized.answers && Object.keys(normalized.answers).length),
          });
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
            answers: data.answers,
            skippedIds: data.skippedIds,
          });
          cacheSelection(uid, consigneId, normalized);
          debugLog("loadSelection:responses", {
            consigneId,
            dateKey: normalized.dateKey,
            selected: normalized.selectedIds.length,
            hasAnswers: Boolean(normalized.answers && Object.keys(normalized.answers).length),
          });
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
        collection(db, "u", uid, "history"),
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
        answers: data.answers,
        skippedIds: data.skippedIds,
      });
      cacheSelection(uid, consigneId, normalized);
      debugLog("loadSelection:history", {
        consigneId,
        dateKey: normalized.dateKey,
        selected: normalized.selectedIds.length,
        hasAnswers: Boolean(normalized.answers && Object.keys(normalized.answers).length),
      });
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

  function formatHintDate(dayKey) {
    if (typeof dayKey !== "string") {
      return "";
    }
    const trimmed = dayKey.trim();
    if (!trimmed) {
      return "";
    }
    const match = DAY_KEY_REGEX.exec(trimmed);
    if (!match) {
      return trimmed;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return trimmed;
    }
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (Number.isNaN(date.getTime())) {
      return trimmed;
    }
    if (HINT_DATE_FORMATTER) {
      try {
        return HINT_DATE_FORMATTER.format(date);
      } catch (error) {
        console.warn("[checklist-state] hint:format", error);
      }
    }
    return trimmed;
  }

  function renderHint(root, consigneId, { optionsChanged = false, previousDateKey = null } = {}) {
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
    if (previousDateKey) {
      const formatted = formatHintDate(previousDateKey);
      if (formatted) {
        const note = document.createElement("span");
        note.className = `${HINT_CLASS}__note`;
        note.textContent = `Dernière réponse du ${formatted}`;
        hint.appendChild(document.createTextNode(" "));
        hint.appendChild(note);
      }
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
        .filter((entry) => {
          if (!entry || !entry.input || !entry.input.checked) {
            return false;
          }
          const skipFlag =
            (entry.input.dataset && entry.input.dataset.checklistSkip === "1") ||
            (entry.host && entry.host.dataset && entry.host.dataset.checklistSkipped === "1");
          return !skipFlag;
        })
        .map((entry) => entry.itemId)
    );
  }

  const CHECKLIST_SKIP_DATA_KEY = "checklistSkip";
  const CHECKLIST_PREV_CHECKED_KEY = "checklistPrevChecked";

  function storePreviousCheckedState(input) {
    if (!input) {
      return "0";
    }
    let previous = null;
    if (input.dataset && Object.prototype.hasOwnProperty.call(input.dataset, CHECKLIST_PREV_CHECKED_KEY)) {
      previous = input.dataset[CHECKLIST_PREV_CHECKED_KEY];
    }
    if (previous == null && input.hasAttribute("data-checklist-prev-checked")) {
      previous = input.getAttribute("data-checklist-prev-checked");
    }
    if (previous == null) {
      previous = input.checked ? "1" : "0";
    }
    if (input.dataset) {
      input.dataset[CHECKLIST_PREV_CHECKED_KEY] = previous;
    }
    input.setAttribute("data-checklist-prev-checked", previous);
    return previous;
  }

  function readPreviousCheckedState(input) {
    if (!input) {
      return null;
    }
    let previous = null;
    if (input.dataset && Object.prototype.hasOwnProperty.call(input.dataset, CHECKLIST_PREV_CHECKED_KEY)) {
      previous = input.dataset[CHECKLIST_PREV_CHECKED_KEY];
      delete input.dataset[CHECKLIST_PREV_CHECKED_KEY];
    }
    if (previous == null && input.hasAttribute("data-checklist-prev-checked")) {
      previous = input.getAttribute("data-checklist-prev-checked");
    }
    input.removeAttribute("data-checklist-prev-checked");
    return previous;
  }

  function updateSkipButtonState(host, skip) {
    if (!host || typeof host.querySelector !== "function") {
      return;
    }
    const button = host.querySelector("[data-checklist-skip-btn]");
    if (!button) {
      return;
    }
    if (skip) {
      button.classList.add("is-active");
      button.setAttribute("aria-pressed", "true");
    } else {
      button.classList.remove("is-active");
      button.setAttribute("aria-pressed", "false");
    }
  }

  function applySkipState(input, host, skip, options = {}) {
    if (!input) {
      return { checkedChanged: false, skipChanged: false };
    }
    const beforeChecked = Boolean(input.checked);
    const beforeSkip =
      (input.dataset && input.dataset[CHECKLIST_SKIP_DATA_KEY] === "1") ||
      (host && host.dataset && host.dataset.checklistSkipped === "1");

    if (skip) {
      storePreviousCheckedState(input);
      if ("indeterminate" in input) {
        input.indeterminate = true;
      }
      input.checked = false;
      input.disabled = true;
      if (input.dataset) {
        input.dataset[CHECKLIST_SKIP_DATA_KEY] = "1";
      }
      input.setAttribute("data-checklist-skip", "1");
      if (host) {
        if (host.dataset) {
          host.dataset.checklistSkipped = "1";
        }
        host.setAttribute("data-checklist-skipped", "1");
        if (host.classList && typeof host.classList.add === "function") {
          host.classList.add("checklist-item--skipped");
        }
        host.setAttribute("data-validated", "skip");
      }
      updateSkipButtonState(host, true);
    } else {
      if ("indeterminate" in input) {
        input.indeterminate = false;
      }
      input.disabled = false;
      if (input.dataset) {
        delete input.dataset[CHECKLIST_SKIP_DATA_KEY];
      }
      input.removeAttribute("data-checklist-skip");
      let previous = readPreviousCheckedState(input);
      if (previous == null && Object.prototype.hasOwnProperty.call(options, "fallbackChecked")) {
        const fallback = options.fallbackChecked ? "1" : "0";
        if (input.dataset) {
          input.dataset[CHECKLIST_PREV_CHECKED_KEY] = fallback;
        }
        input.setAttribute("data-checklist-prev-checked", fallback);
        previous = fallback;
      }
      if (previous != null) {
        input.checked = previous === "1" || previous === "true";
      }
      if (host) {
        if (host.dataset) {
          delete host.dataset.checklistSkipped;
        }
        host.removeAttribute("data-checklist-skipped");
        if (host.classList && typeof host.classList.remove === "function") {
          host.classList.remove("checklist-item--skipped");
        }
        host.setAttribute("data-validated", input.checked ? "true" : "false");
      }
      updateSkipButtonState(host, false);
    }

    const afterChecked = Boolean(input.checked);
    const afterSkip =
      (input.dataset && input.dataset[CHECKLIST_SKIP_DATA_KEY] === "1") ||
      (host && host.dataset && host.dataset.checklistSkipped === "1");
    return {
      checkedChanged: beforeChecked !== afterChecked,
      skipChanged: beforeSkip !== afterSkip,
    };
  }

  function buildAnswersFromEntries(entries) {
    if (!Array.isArray(entries) || !entries.length) {
      return {};
    }
    const answers = {};
    entries.forEach((entry) => {
      if (!entry || !entry.input) {
        return;
      }
      const id = String(entry.itemId ?? "").trim();
      if (!id) {
        return;
      }
      const skipFlag =
        (entry.input.dataset && entry.input.dataset.checklistSkip === "1") ||
        (entry.host && entry.host.dataset && entry.host.dataset.checklistSkipped === "1");
      let value;
      if (skipFlag) {
        value = "skipped";
      } else {
        value = Boolean(entry.input.checked) ? "yes" : "no";
      }
      answers[id] = { value: normalizeAnswerValue(value), skipped: skipFlag };
    });
    return answers;
  }

  function applySelection(root, payload, options = {}) {
    const consigneId = normalizeConsigneId(options.consigneId || root.getAttribute("data-consigne-id") || root.dataset?.consigneId);
    debugLog("applySelection:payload", {
      consigneId,
      answers: payload.answers,
      skippedIds: payload.skippedIds,
      selectedIds: payload.selectedIds,
    });
    if (!root || !payload) return false;
  const selectedIds = normalizeSelectedIds(payload.selectedIds);
  // consigneId déjà déclaré ci-dessus
  const selectedSet = new Set(selectedIds.map((value) => String(value)));
    const answersMap = answersToMap(payload.answers);
    const skippedSet = new Set(
      normalizeSelectedIds(payload.skippedIds).map((value) => String(value))
    );
    const entries = collectChecklistEntries(root, consigneId);
    if (!entries.length) {
      return false;
    }
    let anyChange = false;
    entries.forEach(({ input, host, itemId, legacyId }) => {
      if (!input) return;
      const primaryId = String(itemId ?? "");
      const legacyKey = legacyId ? String(legacyId) : "";
      const answer =
        (primaryId && answersMap.get(primaryId)) || (legacyKey && answersMap.get(legacyKey)) || null;
      // On restaure l'état skipped même si la case n'est pas cochée
      let shouldSkip = false;
      if (answer) {
        shouldSkip = Boolean(answer.skipped);
      }
      if (!shouldSkip && (skippedSet.has(primaryId) || (legacyKey && skippedSet.has(legacyKey)))) {
        shouldSkip = true;
      }
      // Si skipped, la case doit TOUJOURS être décochée
      let shouldCheck = false;
      if (!shouldSkip) {
        if (answer) {
          if (answer.value === "yes" || answer.value === "maybe") {
            shouldCheck = true;
          } else if (answer.value === "no" || answer.value === "skipped") {
            shouldCheck = false;
          }
        } else {
          shouldCheck = selectedSet.has(primaryId) || (legacyKey ? selectedSet.has(legacyKey) : false);
        }
      }
      const { checkedChanged, skipChanged } = applySkipState(input, host, shouldSkip, {
        fallbackChecked: shouldCheck,
      });
      // Force décochage si skipped
      if (shouldSkip && input.checked) {
        input.checked = false;
      } else if (!shouldSkip && input.checked !== shouldCheck) {
        input.checked = shouldCheck;
      }
      if (host && !shouldSkip) {
        host.setAttribute("data-validated", input.checked ? "true" : "false");
      }
      if (checkedChanged || skipChanged) {
        anyChange = true;
      }
    });
    const hidden = root.querySelector("[data-checklist-state]");
    if (hidden) {
      const payloadState = {
        items: entries.map(({ input }) => Boolean(input && input.checked)),
        skipped: entries.map(({ input, host }) => {
          const skipDataset = input?.dataset?.checklistSkip === "1";
          const skipHost = host && host.dataset && host.dataset.checklistSkipped === "1";
          return skipDataset || skipHost;
        }),
        answers: buildAnswersFromEntries(entries),
      };
      if (Array.isArray(payloadState.skipped) && payloadState.skipped.every((value) => value === false)) {
        delete payloadState.skipped;
      }
      if (!payloadState.answers || !Object.keys(payloadState.answers).length) {
        delete payloadState.answers;
      }
      try {
        hidden.value = JSON.stringify(payloadState);
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
      const todayKey = currentParisDayKey();
      const previousDateKey = payload.dateKey && payload.dateKey !== todayKey ? payload.dateKey : null;
      if (selectedSet.size > 0 || changed || previousDateKey) {
        renderHint(root, consigneId, { optionsChanged: changed, previousDateKey });
      } else {
        clearHint(root, consigneId);
      }
    }
    root.dataset.checklistHydrated = "1";
    const selectedCount = entries.reduce((count, { input }) => (input && input.checked ? count + 1 : count), 0);
    const skippedCount = entries.reduce(
      (count, { input, host }) =>
        (input?.dataset?.checklistSkip === "1" || host?.dataset?.checklistSkipped === "1") ? count + 1 : count,
      0
    );
    debugLog("applySelection:done", {
      consigneId,
      selected: selectedCount,
      skipped: skippedCount,
      entries: entries.length,
    });
    return anyChange;
  }

  async function persistRoot(root, options = {}) {
    if (!(root instanceof Element)) return null;
    const consigneId = normalizeConsigneId(
      options.consigneId || root.getAttribute("data-consigne-id") || root.dataset?.consigneId
    );
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
      answers: buildAnswersFromEntries(entries),
    };
    const skippedIds = entries
      .map(({ input, host, itemId, legacyId }) => {
        const skipActive =
          (input?.dataset?.checklistSkip === "1") || (host?.dataset?.checklistSkipped === "1");
        if (!skipActive) {
          return null;
        }
        const id = String(itemId ?? "").trim();
        if (id) {
          return id;
        }
        const legacy = String(legacyId ?? "").trim();
        return legacy || null;
      })
      .filter(Boolean);
    if (skippedIds.length) {
      payload.skippedIds = normalizeSelectedIds(skippedIds);
    }
    const optionUid = normalizeConsigneId(options.uid);
    const uid = optionUid || context.uid;
    const db = options.db || context.db;
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
      debugLog("hydrateRoot:start", {
        consigneId,
        hasHidden: Boolean(root.querySelector('[data-checklist-state]')),
      });
      let saved = await loadSelection(db, uid, consigneId);
      if (saved) {
        debugLog("hydrateRoot:loaded", {
          consigneId,
          dateKey: saved.dateKey,
          selected: Array.isArray(saved.selectedIds) ? saved.selectedIds.length : 0,
          hasAnswers: Boolean(saved.answers && Object.keys(saved.answers).length),
        });
      }
      // Si aucune réponse pour la date courante, chercher la dernière réponse connue (hors date)
      if (!saved) {
        debugLog("hydrateRoot:no-current-day", { consigneId });
        // Cherche dans l'historique localStorage toutes les dates pour ce consigneId
        const storage = safeLocalStorage();
        let lastPayload = null;
        if (storage) {
          const prefix = `${STORAGE_PREFIX}:${uid}:${consigneId}:`;
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key && key.startsWith(prefix)) {
              try {
                const parsed = JSON.parse(storage.getItem(key));
                if (parsed && (!lastPayload || (parsed.ts > lastPayload.ts))) {
                  lastPayload = parsed;
                }
              } catch (e) {}
            }
          }
        }
        if (lastPayload) {
          debugLog("hydrateRoot:local-fallback", {
            consigneId,
            dateKey: lastPayload.dateKey,
            selected: Array.isArray(lastPayload.selectedIds) ? lastPayload.selectedIds.length : 0,
            hasAnswers: Boolean(lastPayload.answers && Object.keys(lastPayload.answers).length),
          });
          saved = lastPayload;
        } else {
          debugLog("hydrateRoot:no-history", { consigneId });
          return;
        }
      }
      const optionsHash = root.getAttribute("data-checklist-options-hash") || root.dataset?.checklistOptionsHash || null;
      // On restaure l'état complet si disponible
      let checklistValue = saved.checklistValue || saved.value || null;
      if (checklistValue && typeof checklistValue === "string") {
        try {
          checklistValue = JSON.parse(checklistValue);
        } catch (e) {}
      }
      if (checklistValue && typeof checklistValue === "object") {
        // On injecte dans le champ caché pour que le DOM se synchronise
        const hidden = root.querySelector('input[type="hidden"][data-checklist-state]');
        if (hidden) {
          hidden.value = JSON.stringify(checklistValue);
        }
        debugLog("hydrateRoot:checklist-value", {
          consigneId,
          dateKey: checklistValue.dateKey || saved.dateKey,
          answers: checklistValue.answers ? Object.keys(checklistValue.answers).length : 0,
          selected: Array.isArray(checklistValue.items) ? checklistValue.items.filter(Boolean).length : null,
        });
        // On force la restauration de l'état answers pour chaque item
        if (checklistValue.answers && typeof checklistValue.answers === "object") {
          const items = root.querySelectorAll('[data-checklist-item]');
          items.forEach((item) => {
            const input = item.querySelector('[data-checklist-input], input[type="checkbox"]');
            const key = input?.getAttribute('data-key') || item.getAttribute('data-checklist-key');
            const answer = checklistValue.answers[key];
            if (answer) {
              input.checked = answer.value === 'yes' || answer.value === 'maybe';
              if (answer.skipped) {
                input.setAttribute('data-checklist-skip', '1');
                item.setAttribute('data-checklist-skipped', '1');
                item.classList.add('checklist-item--skipped');
              } else {
                input.removeAttribute('data-checklist-skip');
                item.removeAttribute('data-checklist-skipped');
                item.classList.remove('checklist-item--skipped');
              }
            } else {
              // Si pas de réponse, décocher et retirer le skip
              if (input) input.checked = false;
              item.removeAttribute('data-checklist-skipped');
              item.classList.remove('checklist-item--skipped');
              if (input) input.removeAttribute('data-checklist-skip');
            }
          });
        }
        applySelection(root, checklistValue, { consigneId, optionsHash });
      } else {
        debugLog("hydrateRoot:apply-selection", {
          consigneId,
          dateKey: saved.dateKey,
          selected: Array.isArray(saved.selectedIds) ? saved.selectedIds.length : 0,
          hasAnswers: Boolean(saved.answers && Object.keys(saved.answers).length),
        });
        applySelection(root, saved, { consigneId, optionsHash });
      }
      debugLog("hydrateRoot:done", { consigneId });
    } catch (error) {
      console.warn("[checklist-state] hydrate", error);
    }
  }

  function hydrateExistingRoots(scope = GLOBAL.document) {
    if (!scope || !scope.querySelectorAll) return;
    const roots = scope.querySelectorAll("[data-checklist-root]");
    debugLog("hydrateExistingRoots", { count: roots.length });
    roots.forEach((root) => {
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
      // Génère entries à partir de la structure de la réponse (entry)
      let entriesArr = [];
      // Prépare un Set d'IDs skipped à partir de différentes sources possibles
      const skippedIdsSet = new Set(
        normalizeSelectedIds(
          (Array.isArray(entry.skippedIds) && entry.skippedIds) ||
            (Array.isArray(entry.skipped_ids) && entry.skipped_ids) ||
            []
        ).map((id) => String(id))
      );
      const normalizedAnswers = entry.answers && typeof entry.answers === "object" ? normalizeAnswers(entry.answers) : {};
      // Ajoute les IDs marqués skipped dans answers
      if (normalizedAnswers && typeof normalizedAnswers === "object") {
        Object.entries(normalizedAnswers).forEach(([id, ans]) => {
          if (ans && normalizeSkippedFlag(ans.skipped)) {
            const key = String(id || "");
            if (key) skippedIdsSet.add(key);
          }
        });
      }
      if (Array.isArray(entry.entries)) {
        entriesArr = entry.entries;
      } else if (entry.value && typeof entry.value === "object" && Array.isArray(entry.value.items)) {
        // Structure type { value: { items: [...] } }
        entriesArr = entry.value.items.map((checked, idx) => {
          const id = entry.value.ids && entry.value.ids[idx] ? String(entry.value.ids[idx]) : `${consigneId}:${idx}`;
          const skipActive = skippedIdsSet.has(id) || (Array.isArray(entry.skipped) && entry.skipped[idx] === true);
          return {
            input: { checked: !!checked, dataset: skipActive ? { checklistSkip: "1" } : {} },
            host: { dataset: skipActive ? { checklistSkipped: "1" } : {} },
            itemId: id,
            legacyId: id,
          };
        });
      } else if (Array.isArray(entry.selectedIds)) {
        entriesArr = entry.selectedIds.map((rawId) => {
          const id = String(rawId);
          const ans = normalizedAnswers && normalizedAnswers[id];
          const skipActive = skippedIdsSet.has(id) || (ans && normalizeSkippedFlag(ans.skipped));
          return {
            input: { checked: true, dataset: skipActive ? { checklistSkip: "1" } : {} },
            host: { dataset: skipActive ? { checklistSkipped: "1" } : {} },
            itemId: id,
            legacyId: id,
          };
        });
      }
      // On recalcule selectedIds à partir des entrées pour exclure les skipped
      let selectedIds = readSelectedIdsFromEntries(entriesArr);
      if (!selectedIds.length) {
        const fallbackIds = fallbackSelectedIds(consigneId, entry);
        if (fallbackIds.length) {
          selectedIds = fallbackIds;
        }
      }
      const optionsHash = entry.optionsHash || entry.options_hash || null;
      const answers = buildAnswersFromEntries(entriesArr);
      const skippedIds = entriesArr
        .map(({ input, host, itemId, legacyId }) => {
          const skipActive =
            (input?.dataset?.checklistSkip === "1") || (host?.dataset?.checklistSkipped === "1");
          if (!skipActive) {
            return null;
          }
          const id = String(itemId ?? "").trim();
          if (id) {
            return id;
          }
          const legacy = String(legacyId ?? "").trim();
          return legacy || null;
        })
        .filter(Boolean);
      const payload = {
        selectedIds,
        optionsHash,
        dateKey: entry.dateKey || entry.dayKey || currentParisDayKey(),
        ts: entry.updatedAt || entry.ts || Date.now(),
        answers,
        skippedIds,
      };
      tasks.push(saveSelection(db, uid, consigneId, payload));
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
