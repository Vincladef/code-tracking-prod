(function () {
  const GLOBAL = typeof window !== "undefined" ? window : globalThis;

  const DEFAULT_STATE = () => ({
    entries: [],
    byKey: new Map(),
    loading: null,
    loadedAt: 0,
  });

  const DAY_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

  const context = {
    db: null,
    uid: null,
    loadFn: null,
  };

  const store = new Map();

  const getNow = () => (typeof Date === "function" ? Date.now() : new Date().getTime());

  const isFunction = (value) => typeof value === "function";

  const cloneDate = (value) => {
    if (!(value instanceof Date)) {
      return null;
    }
    const cloned = new Date(value.getTime());
    if (Number.isNaN(cloned.getTime())) {
      return null;
    }
    cloned.setHours(0, 0, 0, 0);
    return cloned;
  };

  const normalizeDayKey = (value) => {
    if (value == null) {
      return "";
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return "";
      }
      if (DAY_KEY_REGEX.test(trimmed.slice(0, 10))) {
        return trimmed.slice(0, 10);
      }
      return trimmed.toLowerCase();
    }
    if (value instanceof Date) {
      const copy = cloneDate(value);
      if (!copy) {
        return "";
      }
      if (isFunction(context.dayKeyFromDate)) {
        try {
          const derived = context.dayKeyFromDate(copy);
          if (typeof derived === "string" && derived.trim()) {
            return derived.trim();
          }
        } catch (_) {}
      }
      const year = copy.getFullYear();
      const month = String(copy.getMonth() + 1).padStart(2, "0");
      const day = String(copy.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    if (typeof value?.toDate === "function") {
      try {
        const converted = value.toDate();
        return normalizeDayKey(converted);
      } catch (_) {
        return "";
      }
    }
    if (typeof value === "number") {
      const fromNumber = new Date(value);
      return normalizeDayKey(fromNumber);
    }
    return "";
  };

  const resolveHistoryId = (entry) => {
    const candidates = [
      entry?.historyId,
      entry?.history_id,
      entry?.documentId,
      entry?.document_id,
      entry?.docId,
      entry?.doc_id,
      entry?.id,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }
    return null;
  };

  const coerceRecord = (consigneId, raw = {}) => {
    const historyId = resolveHistoryId(raw);
    const primaryKey =
      raw.dateKey ||
      raw.dayKey ||
      raw.date ||
      raw.day ||
      historyId ||
      "";
    const normalizedDayKey = normalizeDayKey(primaryKey);
    const base = {
      consigneId,
      historyId: historyId || (normalizedDayKey || ""),
      dayKey: typeof raw.dayKey === "string" && raw.dayKey.trim() ? raw.dayKey.trim() : primaryKey,
      normalizedDayKey,
    };
    const merged = { ...raw, ...base };
    if (!merged.date && merged.dayKey) {
      merged.date = merged.dayKey;
    }
    return merged;
  };

  const sortRecords = (records) => {
    const copy = Array.isArray(records) ? records.slice() : [];
    copy.sort((a, b) => {
      const keyA = a?.normalizedDayKey || "";
      const keyB = b?.normalizedDayKey || "";
      if (keyA === keyB) {
        const idA = a?.historyId || "";
        const idB = b?.historyId || "";
        return idA < idB ? 1 : idA > idB ? -1 : 0;
      }
      return keyA < keyB ? 1 : -1;
    });
    return copy;
  };

  const rebuildState = (consigneId) => {
    const current = store.get(consigneId) || DEFAULT_STATE();
    const merged = DEFAULT_STATE();
    merged.entries = sortRecords(Array.from(current.byKey.values()));
    merged.byKey = new Map();
    merged.entries.forEach((record) => {
      const key = record.normalizedDayKey || record.historyId || record.dayKey || "";
      merged.byKey.set(key, record);
    });
    merged.loadedAt = current.loadedAt;
    store.set(consigneId, merged);
    return merged;
  };

  const setRecords = (consigneId, records, loadedAt = getNow()) => {
    const base = DEFAULT_STATE();
    const normalized = Array.isArray(records)
      ? records.map((entry) => coerceRecord(consigneId, entry))
      : [];
    const byKey = new Map();
    normalized.forEach((record) => {
      const key = record.normalizedDayKey || record.historyId || record.dayKey || "";
      if (key) {
        byKey.set(key, record);
      }
    });
    base.byKey = byKey;
    base.entries = sortRecords(Array.from(byKey.values()));
    base.loadedAt = loadedAt;
    store.set(consigneId, base);
    return base.entries;
  };

  const upsertRecord = (consigneId, entry) => {
    const record = coerceRecord(consigneId, entry);
    const key = record.normalizedDayKey || record.historyId || record.dayKey || "";
    if (!key) {
      return record;
    }
    const current = store.get(consigneId) || DEFAULT_STATE();
    const byKey = new Map(current.byKey);
    byKey.set(key, record);
    current.byKey = byKey;
    current.entries = sortRecords(Array.from(byKey.values()));
    current.loadedAt = getNow();
    store.set(consigneId, current);
    return record;
  };

  const removeRecord = (consigneId, dayKey) => {
    const normalized = normalizeDayKey(dayKey);
    const current = store.get(consigneId);
    if (!current) {
      return false;
    }
    const key = normalized || dayKey;
    const byKey = new Map(current.byKey);
    const existed = byKey.delete(key);
    if (!existed && normalized && key !== normalized) {
      byKey.delete(normalized);
    }
    current.byKey = byKey;
    current.entries = sortRecords(Array.from(byKey.values()));
    current.loadedAt = getNow();
    store.set(consigneId, current);
    return existed;
  };

  const ensureLoadFn = () => {
    if (isFunction(context.loadFn)) {
      return context.loadFn;
    }
    const schemaLoad = GLOBAL.Schema?.loadConsigneHistory;
    if (isFunction(schemaLoad)) {
      context.loadFn = schemaLoad;
      return schemaLoad;
    }
    return null;
  };

  const loadEntries = async (consigneId, { force = false } = {}) => {
    if (!consigneId) {
      return [];
    }
    const loadFn = ensureLoadFn();
    if (!isFunction(loadFn) || !context.db || !context.uid) {
      return [];
    }
    const state = store.get(consigneId) || DEFAULT_STATE();
    if (!force && state.entries.length && !state.loading) {
      return state.entries;
    }
    if (state.loading) {
      return state.loading;
    }
    const promise = Promise.resolve()
      .then(() => loadFn(context.db, context.uid, consigneId))
      .then((rawEntries = []) => setRecords(consigneId, rawEntries, getNow()))
      .finally(() => {
        const current = store.get(consigneId);
        if (current) {
          current.loading = null;
          store.set(consigneId, current);
        }
      });
    state.loading = promise;
    store.set(consigneId, state);
    return promise;
  };

  const getEntries = (consigneId) => {
    const state = store.get(consigneId);
    return state ? state.entries.slice() : [];
  };

  const getEntry = (consigneId, dayKey) => {
    if (!consigneId) {
      return null;
    }
    const normalized = normalizeDayKey(dayKey);
    const state = store.get(consigneId);
    if (!state) {
      return null;
    }
    const key = normalized || dayKey;
    if (state.byKey.has(key)) {
      return state.byKey.get(key);
    }
    if (normalized && state.byKey.has(normalized)) {
      return state.byKey.get(normalized);
    }
    return null;
  };

  const getTimeline = (consigneId) => getEntries(consigneId);

  const invalidate = (consigneId) => {
    if (!consigneId) {
      return;
    }
    store.delete(consigneId);
  };

  const clearAll = () => {
    store.clear();
  };

  const configure = ({ db = null, uid = null, load = null, dayKeyFromDate = null, reset = false } = {}) => {
    const shouldClear =
      reset ||
      context.db !== db ||
      context.uid !== uid ||
      (load && load !== context.loadFn);
    context.db = db || null;
    context.uid = uid || null;
    if (isFunction(load)) {
      context.loadFn = load;
    } else if (!context.loadFn) {
      context.loadFn = GLOBAL.Schema?.loadConsigneHistory || null;
    }
    if (isFunction(dayKeyFromDate)) {
      context.dayKeyFromDate = dayKeyFromDate;
    } else if (!context.dayKeyFromDate) {
      context.dayKeyFromDate = GLOBAL.Schema?.dayKeyFromDate || null;
    }
    if (shouldClear) {
      clearAll();
    }
  };

  const HistoryStore = {
    configure,
    ensure: loadEntries,
    load: loadEntries,
    getEntries,
    getEntry,
    getTimeline,
    upsert: upsertRecord,
    remove: removeRecord,
    invalidate,
    clearAll,
    normalizeDayKey,
  };

  try {
    GLOBAL.HistoryStore = GLOBAL.HistoryStore || HistoryStore;
  } catch (_) {}

  if (typeof module !== "undefined" && module.exports) {
    module.exports = HistoryStore;
  }
})();

