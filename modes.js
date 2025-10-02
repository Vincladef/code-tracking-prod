// modes.js — Journalier / Pratique / Historique
/* global Schema, Modes */
window.Modes = window.Modes || {};
const modesFirestore = Schema.firestore || window.firestoreAPI || {};

const modesLogger = Schema.D || { info: () => {}, group: () => {}, groupEnd: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// --- Normalisation du jour (LUN..DIM ou mon..sun) ---
const DAY_ALIAS = Schema.DAY_ALIAS || { mon: "LUN", tue: "MAR", wed: "MER", thu: "JEU", fri: "VEN", sat: "SAM", sun: "DIM" };
const DAY_VALUES = Schema.DAY_VALUES || new Set(["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"]);

function normalizeDay(value) {
  if (!value) return null;
  const lower = String(value).toLowerCase();
  if (DAY_ALIAS[lower]) return DAY_ALIAS[lower];
  const upper = lower.toUpperCase();
  return DAY_VALUES.has(upper) ? upper : null;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function modal(html) {
  const wrap = document.createElement("div");
  wrap.className = "fixed inset-0 z-50 grid place-items-center bg-black/40 p-4";
  wrap.innerHTML = `
    <div class="w-[min(680px,92vw)] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-white border border-gray-200 p-6 shadow-2xl">
      ${html}
    </div>`;
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) wrap.remove();
  });
  document.body.appendChild(wrap);
  return wrap;
}

function drawer(html) {
  const wrap = document.createElement("div");
  wrap.className = "fixed inset-0 z-50";
  wrap.innerHTML = `
    <div class="absolute inset-0 bg-black/30"></div>
    <aside class="absolute right-0 top-0 h-full w-[min(480px,92vw)] bg-white border-l border-gray-200 shadow-xl p-4 translate-x-full transition-transform duration-200 will-change-transform overflow-y-auto">
      ${html}
    </aside>`;
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap.firstElementChild) wrap.remove();
  });
  document.body.appendChild(wrap);
  requestAnimationFrame(() => {
    wrap.querySelector("aside").classList.remove("translate-x-full");
  });
  return wrap;
}

function pill(text) {
  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full border text-sm" style="border-color:var(--accent-200); background:var(--accent-50); color:#334155;">${escapeHtml(text)}</span>`;
}

const INFO_RESPONSE_LABEL = "Pas de réponse requise";
const INFO_STATIC_BLOCK = `<p class="text-sm text-[var(--muted)]" data-static-info></p>`;

function srBadge(c){
  const enabled = c?.srEnabled !== false;
  const labelOn = "Désactiver la répétition espacée";
  const labelOff = "Activer la répétition espacée";
  const shortOn = "⏳ on";
  const shortOff = "⏳ off";
  const action = enabled ? labelOn : labelOff;
  const visual = enabled ? shortOn : shortOff;
  return `<button type="button"
            class="consigne-menu__item consigne-menu__item--sr js-sr-toggle"
            role="menuitem"
            data-id="${c.id}" data-enabled="${enabled ? 1 : 0}"
            data-label-on="${shortOn}"
            data-label-off="${shortOff}"
            data-a11y-on="${labelOn}"
            data-a11y-off="${labelOff}"
            aria-pressed="${enabled}" aria-label="${action}" title="${action}">
              <span aria-hidden="true" data-sr-visual>${visual}</span>
              <span class="sr-only" data-sr-label>${action}</span>
            </button>`;
}

function priorityTone(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return "medium";
  if (n <= 1) return "high";
  if (n >= 3) return "low";
  return "medium";
}

function priorityLabelFromTone(tone) {
  if (tone === "high") return "haute";
  if (tone === "low") return "basse";
  return "moyenne";
}

function prioChip(p) {
  const tone = priorityTone(p);
  const lbl = priorityLabelFromTone(tone);
  const accessible = `<span class="sr-only" data-priority="${tone}">Priorité ${lbl}</span>`;
  const symbol = "";
  return { tone, symbol, accessible };
}

function normalizeTitleNodes(title) {
  if (!title) return { container: null, label: null };

  let container = title.querySelector(".consigne-card__title-text");
  if (!container) {
    container = document.createElement("span");
    container.className = "consigne-card__title-text";
    while (title.firstChild) {
      container.appendChild(title.firstChild);
    }
    title.appendChild(container);
  }

  let label = container.querySelector(".consigne-card__title-label");
  if (!label) {
    label = document.createElement("span");
    label.className = "consigne-card__title-label";
    while (container.firstChild) {
      label.appendChild(container.firstChild);
    }
    container.appendChild(label);
  } else if (label.parentNode !== container) {
    container.appendChild(label);
  }

  return { container, label };
}

const LIKERT_STATUS_CLASSES = [
  "consigne-card--likert-positive",
  "consigne-card--likert-negative",
  "consigne-card--likert-positive-strong",
  "consigne-card--likert-positive-soft",
  "consigne-card--likert-neutral",
  "consigne-card--likert-negative-soft",
  "consigne-card--likert-negative-strong",
];
const LIKERT_STATUS_TYPES = ["likert5", "likert6", "yesno"];
const LIKERT_STATUS_FIELD_SELECTOR = LIKERT_STATUS_TYPES.map(
  (type) => `select[name^='${type}:']`
).join(", ");

const consigneFieldStates = new WeakMap();
let activeConsignePicker = null;

function resolveLikertFieldType(field) {
  if (!field) return null;
  const datasetType = field.dataset?.likertType || field.dataset?.fieldType;
  if (datasetType && LIKERT_STATUS_TYPES.includes(datasetType)) {
    return datasetType;
  }
  const name = String(field.name || "");
  if (!name) return null;
  const [prefix] = name.split(":", 1);
  return LIKERT_STATUS_TYPES.includes(prefix) ? prefix : null;
}

function likertStatusKind(type, rawValue) {
  if (!type) return null;
  const value = String(rawValue ?? "").trim();
  if (!value) return null;
  const normalizedType = String(type).toLowerCase();
  if (normalizedType === "likert5") {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    if (num >= 4) return "positive-strong";
    if (num === 3) return "positive-soft";
    if (num === 2) return "neutral";
    if (num === 1) return "negative-soft";
    if (num <= 0) return "negative-strong";
    return null;
  }
  if (normalizedType === "likert6") {
    if (value === "yes") return "positive-strong";
    if (value === "rather_yes") return "positive-soft";
    if (value === "medium" || value === "no_answer") return "neutral";
    if (value === "rather_no") return "negative-soft";
    if (value === "no") return "negative-strong";
    return null;
  }
  if (normalizedType === "yesno") {
    if (value === "yes") return "positive-strong";
    if (value === "no") return "negative-strong";
    return null;
  }
  return null;
}

function applyLikertStatusClass(card, status) {
  if (!card) return;
  LIKERT_STATUS_CLASSES.forEach((cls) => card.classList.remove(cls));
  if (!status) return;
  card.classList.add(`consigne-card--likert-${status}`);
}

function syncLikertStatusForCard(card) {
  if (!card) return;
  const field = card.querySelector(LIKERT_STATUS_FIELD_SELECTOR);
  if (!field) {
    applyLikertStatusClass(card, null);
    return;
  }
  const type = resolveLikertFieldType(field) || String(field.name || "");
  const status = likertStatusKind(type, field.value);
  applyLikertStatusClass(card, status);
}

function enhanceLikertStatus(card) {
  if (!card) return;
  const fields = card.querySelectorAll(LIKERT_STATUS_FIELD_SELECTOR);
  if (!fields.length) return;
  fields.forEach((field) => {
    field.addEventListener("change", () => {
      syncLikertStatusForCard(card);
    });
  });
  syncLikertStatusForCard(card);
}

function smallBtn(label, cls = "") {
  return `<button type="button" class="btn btn-ghost text-sm ${cls}">${label}</button>`;
}

function navigate(hash) {
  const fn = window.routeTo;
  if (typeof fn === "function") fn(hash);
  else window.location.hash = hash;
}

function showToast(msg){
  const el = document.createElement("div");
  el.className = "fixed top-4 right-4 z-50 card px-3 py-2 text-sm shadow-lg";
  el.style.transition = "opacity .25s ease, transform .25s ease";
  el.style.opacity = "0";
  el.style.transform = "translateY(6px)";
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateY(0)"; });
  setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateY(-6px)"; setTimeout(()=>el.remove(), 250); }, 1200);
}

function toAppPath(h) {
  return h.replace(/^#\/u\/[^/]+\//, "#/");
}

// --------- CAT DASHBOARD (modal) ---------
window.openCategoryDashboard = async function openCategoryDashboard(ctx, category, options = {}) {
  const providedConsignes = Array.isArray(options.consignes)
    ? options.consignes.filter((item) => item && item.id)
    : null;
  let mode = options.mode === "daily" ? "daily" : "practice";
  let allowMixedMode = options.allowMixedMode === true;
  if (providedConsignes && !options.mode) {
    const modeSet = new Set(
      providedConsignes
        .map((item) => (item.mode === "daily" ? "daily" : item.mode === "practice" ? "practice" : ""))
        .filter(Boolean)
    );
    if (modeSet.size === 1) {
      const [onlyMode] = Array.from(modeSet);
      mode = onlyMode === "daily" ? "daily" : "practice";
    } else if (modeSet.size > 1) {
      allowMixedMode = true;
      mode = "daily";
    }
  }
  const customTitle = typeof options.title === "string" ? options.title : "";
  const customTrendTitle = typeof options.trendTitle === "string" ? options.trendTitle : "";
  const customDetailsTitle = typeof options.detailsTitle === "string" ? options.detailsTitle : "";
  let isPractice = mode === "practice";
  let isDaily = mode === "daily";
  const palette = [
    "#1B9E77",
    "#D95F02",
    "#7570B3",
    "#E7298A",
    "#66A61E",
    "#E6AB02",
    "#A6761D",
    "#1F78B4",
  ];
  const priorityLabels = { 1: "Haute", 2: "Moyenne", 3: "Basse" };

  const percentFormatter = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });
  const numberFormatter = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  const fullDateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const fullDayFormatter = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const shortDateFormatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  function toDate(dateIso) {
    if (!dateIso) return null;
    if (dateIso instanceof Date) {
      const copy = new Date(dateIso.getTime());
      return Number.isNaN(copy.getTime()) ? null : copy;
    }
    let value = String(dateIso);
    if (value.startsWith("ts-")) {
      value = value.slice(3);
    }
    if (!value.includes("T")) {
      const simple = `${value}T12:00:00`;
      const simpleDate = new Date(simple);
      return Number.isNaN(simpleDate.getTime()) ? null : simpleDate;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function withAlpha(hex, alpha) {
    const safe = String(hex || "").replace("#", "");
    if (safe.length !== 6) {
      return `rgba(99, 102, 241, ${alpha})`;
    }
    const value = parseInt(safe, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function normalizePriorityValue(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 1 && num <= 3) return num;
    return 2;
  }

  function typeLabel(type) {
    if (type === "likert6") return "Échelle ×6";
    if (type === "likert5") return "Échelle ×5";
    if (type === "yesno") return "Oui / Non";
    if (type === "num") return "Numérique";
    if (type === "long") return "Texte long";
    if (type === "short") return "Texte court";
    if (type === "info") return "";
    return "Libre";
  }

  const LIKERT6_ORDER = ["no", "rather_no", "medium", "rather_yes", "yes"];
  const LIKERT6_LABELS = {
    no: "Non",
    rather_no: "Plutôt non",
    medium: "Neutre",
    rather_yes: "Plutôt oui",
    yes: "Oui",
  };

  function formatValue(type, value) {
    if (type === "info") return "";
    if (value === null || value === undefined || value === "") return "—";
    if (type === "yesno") return value === "yes" ? "Oui" : value === "no" ? "Non" : String(value);
    if (type === "likert5") return String(value);
    if (type === "likert6") {
      if (value === "no_answer") return "Pas de réponse";
      return LIKERT6_LABELS[value] || String(value);
    }
    return String(value);
  }

  function likert6NumericPoint(value) {
    if (!value) return null;
    const index = LIKERT6_ORDER.indexOf(String(value));
    if (index === -1) return null;
    return index;
  }

  function numericPoint(type, value) {
    if (value === null || value === undefined || value === "") return null;
    if (type === "likert6") {
      return likert6NumericPoint(value);
    }
    const point = Schema.valueToNumericPoint(type, value);
    return Number.isFinite(point) ? point : null;
  }

  function normalizeScore(type, value) {
    if (value == null) return null;
    if (type === "likert5") return Math.max(0, Math.min(1, value / 4));
    if (type === "likert6") return Math.max(0, Math.min(1, value / (LIKERT6_ORDER.length - 1 || 1)));
    if (type === "yesno") return Math.max(0, Math.min(1, value));
    return null;
  }

  function formatRelativeDate(dateIso) {
    const d = dateIso instanceof Date ? dateIso : toDate(dateIso);
    if (!d) return "";
    const diffDays = Math.round((today.getTime() - d.getTime()) / 86400000);
    if (diffDays <= 0) return "Aujourd’hui";
    if (diffDays === 1) return "Hier";
    if (diffDays < 7) return `Il y a ${diffDays} j`;
    return "";
  }

  function truncateText(str, max = 160) {
    if (!str) return "—";
    const text = String(str).trim();
    if (!text) return "—";
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
  }

  try {
    const normalizedCategory = typeof category === "string" ? category.trim() : "";
    let effectiveCategory = normalizedCategory;
    let consignes = [];
    let dailyCategories = [];

    if (providedConsignes) {
      const unique = new Map();
      providedConsignes.forEach((item) => {
        if (!item || !item.id) return;
        if (!unique.has(item.id)) {
          unique.set(item.id, item);
        }
      });
      consignes = Array.from(unique.values());
      effectiveCategory = customTitle || normalizedCategory || "Consignes liées";
      dailyCategories = [];
      isPractice = mode === "practice";
      isDaily = mode === "daily";
    } else if (isPractice) {
      consignes = await Schema.listConsignesByCategory(ctx.db, ctx.user.uid, normalizedCategory);
    } else {
      const allDaily = await Schema.fetchConsignes(ctx.db, ctx.user.uid, "daily");
      const activeDaily = (allDaily || []).filter((item) => item?.active !== false);
      dailyCategories = Array.from(new Set(activeDaily.map((item) => item.category || "Général")));
      dailyCategories.sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
      const requestedCategory = normalizedCategory && normalizedCategory !== "__all__" ? normalizedCategory : "";
      effectiveCategory = requestedCategory;
      consignes = requestedCategory
        ? activeDaily.filter((item) => (item.category || "Général") === requestedCategory)
        : activeDaily;
    }

    consignes = providedConsignes
      ? (consignes || []).filter((item) => item && item.id)
      : (consignes || []).filter((item) => item?.active !== false);
    consignes.sort((a, b) => {
      const aLabel = (a.text || a.titre || a.name || "").toString();
      const bLabel = (b.text || b.titre || b.name || "").toString();
      return aLabel.localeCompare(bLabel, "fr", { sensitivity: "base" });
    });
    const iterationMetaMap = new Map();

    const seenFallback = { value: 0 };

    function ensureIterationMeta(key) {
      if (!key) return null;
      let meta = iterationMetaMap.get(key);
      if (!meta) {
        meta = {
          key,
          createdAt: null,
          sessionIndex: null,
          sessionNumber: null,
          sessionId: null,
          sources: new Set(),
        };
        iterationMetaMap.set(key, meta);
      }
      return meta;
    }

    function parseResponseDate(value) {
      if (!value) return null;
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
      }
      if (typeof value.toDate === "function") {
        try {
          const parsed = value.toDate();
          return Number.isNaN(parsed?.getTime?.()) ? null : parsed;
        } catch (err) {
          modesLogger.warn("practice-dashboard:parseDate", err);
        }
      }
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function computeIterationKey(row, createdAt) {
      const sessionId = row.sessionId || row.session_id;
      if (sessionId) return String(sessionId);
      const rawIndex = row.sessionIndex ?? row.session_index;
      if (rawIndex !== undefined && rawIndex !== null && rawIndex !== "") {
        const num = Number(rawIndex);
        if (Number.isFinite(num)) {
          return `session-${String(num + 1).padStart(4, "0")}`;
        }
      }
      const rawNumber = row.sessionNumber ?? row.session_number;
      if (rawNumber !== undefined && rawNumber !== null && rawNumber !== "") {
        const num = Number(rawNumber);
        if (Number.isFinite(num)) {
          return `session-${String(num).padStart(4, "0")}`;
        }
      }
      if (createdAt) {
        const approx = new Date(createdAt.getTime());
        approx.setMilliseconds(0);
        return `ts-${approx.toISOString()}`;
      }
      const fallback = `resp-${seenFallback.value}`;
      seenFallback.value += 1;
      return fallback;
    }

    function computeDayKey(row, createdAt) {
      const rawDay =
        row.dayKey ||
        row.day_key ||
        row.date ||
        row.day ||
        (typeof row.getDayKey === "function" ? row.getDayKey() : null);
      if (rawDay) return String(rawDay);
      const sourceDate = createdAt || parseResponseDate(row.createdAt || row.updatedAt || null);
      if (sourceDate) {
        return Schema.dayKeyFromDate(sourceDate);
      }
      const fallback = `day-${seenFallback.value}`;
      seenFallback.value += 1;
      return fallback;
    }

    const computeTemporalKey = isPractice ? computeIterationKey : computeDayKey;

    if (isPractice) {
      let practiceSessions = [];
      try {
        practiceSessions = await Schema.fetchPracticeSessions(ctx.db, ctx.user.uid, 500);
      } catch (sessionError) {
        modesLogger.warn("practice-dashboard:sessions:error", sessionError);
      }

      (practiceSessions || []).forEach((session) => {
        const createdAt = parseResponseDate(session.startedAt || session.createdAt || session.date || null);
        const key = computeTemporalKey(session, createdAt);
        const meta = ensureIterationMeta(key);
        if (!meta) return;
        meta.sources.add("session");
        if (session.sessionId && !meta.sessionId) {
          meta.sessionId = String(session.sessionId);
        }
        const rawSessionIndex = session.sessionIndex ?? session.session_index;
        if (rawSessionIndex !== undefined && rawSessionIndex !== null && rawSessionIndex !== "") {
          const parsedIndex = Number(rawSessionIndex);
          if (Number.isFinite(parsedIndex)) {
            if (meta.sessionIndex == null || parsedIndex < meta.sessionIndex) {
              meta.sessionIndex = parsedIndex;
            }
            if (meta.sessionNumber == null) {
              meta.sessionNumber = parsedIndex + 1;
            }
          }
        }
        const rawSessionNumber =
          session.sessionNumber ?? session.session_number ?? session.index ?? session.order;
        if (rawSessionNumber !== undefined && rawSessionNumber !== null && rawSessionNumber !== "") {
          const parsedNumber = Number(rawSessionNumber);
          if (Number.isFinite(parsedNumber)) {
            if (meta.sessionNumber == null || parsedNumber < meta.sessionNumber) {
              meta.sessionNumber = parsedNumber;
            }
            if (meta.sessionIndex == null) {
              meta.sessionIndex = parsedNumber - 1;
            }
          }
        }
        if (createdAt && (!meta.createdAt || createdAt < meta.createdAt)) {
          meta.createdAt = createdAt;
        }
      });
    }

    function mergeEntry(entryMap, key, payload) {
      const current = entryMap.get(key) || { date: key, value: "", note: "", createdAt: null };
      if (payload.value !== undefined) current.value = payload.value;
      if (payload.note !== undefined) current.note = payload.note;
      if (payload.createdAt instanceof Date) {
        if (!current.createdAt || payload.createdAt > current.createdAt) {
          current.createdAt = payload.createdAt;
        }
      }
      entryMap.set(key, current);
    }

    function parseHistoryEntry(entry) {
      return {
        value:
          entry.v ??
          entry.value ??
          entry.answer ??
          entry.val ??
          entry.score ??
          "",
        note:
          entry.comment ??
          entry.note ??
          entry.remark ??
          entry.memo ??
          entry.obs ??
          entry.observation ??
          "",
        createdAt: parseResponseDate(entry.createdAt || entry.updatedAt || null),
      };
    }

    const consigneData = await Promise.all(
      consignes.map(async (consigne, index) => {
        const entryMap = new Map();

        let responseRows = [];
        try {
          responseRows = await Schema.fetchResponsesForConsigne(ctx.db, ctx.user.uid, consigne.id, 200);
        } catch (responseError) {
          modesLogger.warn("practice-dashboard:responses:error", responseError);
        }

        (responseRows || [])
          .filter((row) => {
            if (allowMixedMode) return true;
            return (row.mode || consigne.mode || mode) === mode;
          })
          .forEach((row) => {
            const createdAt = parseResponseDate(row.createdAt);
            let sessionIndex = null;
            let sessionId = null;
            let rawNumber = null;
            if (isPractice) {
              const rawIndex = row.sessionIndex ?? row.session_index;
              rawNumber = row.sessionNumber ?? row.session_number;
              sessionIndex =
                rawIndex !== undefined && rawIndex !== null && rawIndex !== ""
                  ? Number(rawIndex)
                  : rawNumber !== undefined && rawNumber !== null && rawNumber !== ""
                  ? Number(rawNumber) - 1
                  : null;
              sessionId =
                row.sessionId ||
                row.session_id ||
                (Number.isFinite(sessionIndex) ? `session-${String(sessionIndex + 1).padStart(4, "0")}` : null);
            }
            const key = computeTemporalKey(row, createdAt);
            const meta = ensureIterationMeta(key);
            if (!meta) return;
            meta.sources.add("response");
            if (isPractice) {
              if (sessionId && !meta.sessionId) meta.sessionId = String(sessionId);
              if (Number.isFinite(sessionIndex)) {
                if (meta.sessionIndex == null || sessionIndex < meta.sessionIndex) {
                  meta.sessionIndex = sessionIndex;
                }
                if (meta.sessionNumber == null) {
                  meta.sessionNumber = sessionIndex + 1;
                }
              }
              if (rawNumber !== undefined && rawNumber !== null && rawNumber !== "") {
                const parsedNumber = Number(rawNumber);
                if (Number.isFinite(parsedNumber)) {
                  if (meta.sessionNumber == null || parsedNumber < meta.sessionNumber) {
                    meta.sessionNumber = parsedNumber;
                  }
                }
              }
            }
            if (createdAt && (!meta.createdAt || createdAt < meta.createdAt)) {
              meta.createdAt = createdAt;
            }
            const value =
              row.value ?? row.v ?? row.answer ?? row.score ?? row.val ?? "";
            const note = row.note ?? row.comment ?? row.remark ?? "";
            mergeEntry(entryMap, key, { value, note, createdAt });
          });

        let historyEntries = [];
        try {
          historyEntries = await Schema.loadConsigneHistory(ctx.db, ctx.user.uid, consigne.id);
        } catch (historyError) {
          modesLogger.warn("practice-dashboard:history:error", historyError);
        }

        (historyEntries || [])
          .filter((entry) => entry?.date)
          .forEach((entry) => {
            const normalized = parseHistoryEntry(entry);
            const key = isDaily
              ? computeTemporalKey({ dayKey: entry.date }, normalized.createdAt)
              : entry.date;
            const meta = ensureIterationMeta(key);
            if (!meta) return;
            meta.sources.add("history");
            if (normalized.createdAt && (!meta.createdAt || normalized.createdAt < meta.createdAt)) {
              meta.createdAt = normalized.createdAt;
            }
            const alreadyExists = entryMap.has(key);
            mergeEntry(entryMap, key, {
              value: normalized.value,
              note: normalized.note,
              createdAt: alreadyExists ? undefined : normalized.createdAt,
            });
          });

        entryMap.forEach((entry, key) => {
          const meta = iterationMetaMap.get(key);
          if (meta && !meta.createdAt && entry.createdAt) {
            meta.createdAt = entry.createdAt;
          }
        });

        return { consigne, entries: entryMap, index };
      }),
    );

    const iterationMeta = Array.from(iterationMetaMap.values())
      .sort((a, b) => {
        const aIndex = Number.isFinite(a.sessionIndex) ? a.sessionIndex : Number.isFinite(a.sessionNumber) ? a.sessionNumber - 1 : null;
        const bIndex = Number.isFinite(b.sessionIndex) ? b.sessionIndex : Number.isFinite(b.sessionNumber) ? b.sessionNumber - 1 : null;
        if (aIndex != null && bIndex != null && aIndex !== bIndex) {
          return aIndex - bIndex;
        }
        const aDate = a.createdAt || toDate(a.key);
        const bDate = b.createdAt || toDate(b.key);
        if (aDate && bDate && aDate.getTime() !== bDate.getTime()) {
          return aDate.getTime() - bDate.getTime();
        }
        if (aIndex != null) return -1;
        if (bIndex != null) return 1;
        return String(a.key).localeCompare(String(b.key));
      })
      .map((meta, idx) => {
        const key = meta.key;
        let dateObj = meta.createdAt || null;
        if (!dateObj) {
          if (typeof key === "string" && key.startsWith("ts-")) {
            const parsed = new Date(key.slice(3));
            if (!Number.isNaN(parsed.getTime())) {
              dateObj = parsed;
            }
          } else {
            dateObj = toDate(key);
          }
        }

        const displayIndex = idx + 1;
        let sessionNumber = null;
        let label = "";
        let fullLabel = "";
        let headerTitle = "";

        if (isPractice) {
          sessionNumber =
            Number.isFinite(meta.sessionNumber)
              ? Number(meta.sessionNumber)
              : Number.isFinite(meta.sessionIndex)
              ? Number(meta.sessionIndex) + 1
              : null;
          label = `Itération ${displayIndex}`;
          if (dateObj) {
            fullLabel = fullDateTimeFormatter.format(dateObj);
          } else if (sessionNumber != null && sessionNumber !== displayIndex) {
            fullLabel = `Session ${sessionNumber}`;
          } else if (sessionNumber != null) {
            fullLabel = label;
          } else {
            fullLabel = String(key);
          }
          const headerParts = [label];
          if (Number.isFinite(sessionNumber) && sessionNumber !== displayIndex) {
            headerParts.push(`Session ${sessionNumber}`);
          }
          if (fullLabel && fullLabel !== label) {
            headerParts.push(fullLabel);
          }
          headerTitle = headerParts.join(" — ");
        } else {
          if (dateObj) {
            label = shortDateFormatter.format(dateObj);
            fullLabel = fullDayFormatter.format(dateObj);
          } else {
            label = `Jour ${displayIndex}`;
            fullLabel = label;
          }
          headerTitle = fullLabel && fullLabel !== label ? `${label} — ${fullLabel}` : fullLabel || label;
        }

        return {
          key,
          iso: key,
          index: idx,
          displayIndex,
          label,
          fullLabel,
          headerTitle,
          sessionNumber,
          sessionIndex: isPractice ? meta.sessionIndex ?? null : null,
          dateObj: dateObj || null,
          dayKey: isDaily ? key : null,
        };
      });

    const iterationMetaByKey = new Map(iterationMeta.map((meta) => [meta.iso, meta]));

    const stats = consigneData.map(({ consigne, entries, index }) => {
      const timeline = iterationMeta.map((meta) => {
        const record = entries.get(meta.iso);
        const rawValue = record ? record.value : "";
        const numeric = numericPoint(consigne.type, rawValue);
        return {
          dateIso: meta.iso,
          rawValue,
          numeric,
          note: record?.note ?? "",
        };
      });
      const timelineByKey = new Map(timeline.map((point) => [point.dateIso, point]));
      const numericValues = timeline.map((point) => point.numeric).filter((point) => point != null);
      const averageNumeric = numericValues.length
        ? numericValues.reduce((acc, value) => acc + value, 0) / numericValues.length
        : null;
      const averageNormalized = normalizeScore(consigne.type, averageNumeric);
      const orderedEntries = iterationMeta
        .map((meta) => {
          const record = entries.get(meta.iso);
          if (!record) return null;
          const hasValue = record.value !== "" && record.value != null;
          const hasNote = record.note && record.note.trim();
          if (!hasValue && !hasNote) return null;
          return {
            date: meta.iso,
            value: record.value,
            note: record.note,
            createdAt: record.createdAt || meta.dateObj || null,
          };
        })
        .filter(Boolean);
      const lastEntry = orderedEntries[orderedEntries.length - 1] || null;
      const lastDateIso = lastEntry?.date || "";
      const lastMeta = lastDateIso ? iterationMetaByKey.get(lastDateIso) : null;
      const lastDateObj = lastEntry?.createdAt || lastMeta?.dateObj || null;
      const lastValue = lastEntry?.value ?? "";
      const lastNote = lastEntry?.note ?? "";
      const priority = normalizePriorityValue(consigne.priority);
      const baseColor = palette[index % palette.length];
      const accentStrong = withAlpha(baseColor, priority === 1 ? 0.9 : priority === 2 ? 0.75 : 0.55);
      const accentSoft = withAlpha(baseColor, priority === 1 ? 0.18 : priority === 2 ? 0.12 : 0.08);
      const accentBorder = withAlpha(baseColor, priority === 1 ? 0.55 : priority === 2 ? 0.4 : 0.28);
      const accentProgress = withAlpha(baseColor, priority === 1 ? 0.88 : priority === 2 ? 0.66 : 0.45);
      const rowAccent = withAlpha(baseColor, priority === 1 ? 0.65 : priority === 2 ? 0.45 : 0.35);

      const rawScoreDisplay =
        averageNormalized != null
          ? percentFormatter.format(averageNormalized)
          : averageNumeric != null
          ? numberFormatter.format(averageNumeric)
          : "—";
      const scoreDisplay = consigne.type === "info" ? "" : rawScoreDisplay;
      const scoreTitle =
        averageNormalized != null
          ? consigne.type === "likert5"
            ? "Score converti en pourcentage sur une échelle de 0 à 4."
            : "Taux moyen de réussite sur la période affichée."
          : averageNumeric != null
          ? "Moyenne des valeurs numériques enregistrées."
          : "Aucune donnée disponible pour le moment.";

      const name = consigne.text || consigne.titre || consigne.name || consigne.id;
      const stat = {
        id: consigne.id,
        name,
        priority,
        priorityLabel: priorityLabels[priority] || priorityLabels[2],
        type: consigne.type || "short",
        typeLabel: typeLabel(consigne.type),
        timeline,
        entries: orderedEntries,
        timelineByKey,
        hasNumeric: numericValues.length > 0,
        averageNumeric,
        averageNormalized,
        averageDisplay: scoreDisplay,
        averageTitle: scoreTitle,
        lastDateIso,
        lastDateShort: lastDateObj ? shortDateFormatter.format(lastDateObj) : "Jamais",
        lastDateFull: lastDateObj ? fullDateTimeFormatter.format(lastDateObj) : "Jamais",
        lastRelative: formatRelativeDate(lastDateObj || lastDateIso),
        lastValue,
        lastFormatted: formatValue(consigne.type, lastValue),
        lastCommentRaw: lastNote,
        commentDisplay: truncateText(lastNote, 180),
        statusKind: dotColor(consigne.type, lastValue),
        totalEntries: orderedEntries.length,
        color: baseColor,
        accentStrong,
        accentSoft,
        accentBorder,
        accentProgress,
        rowAccent,
        consigne,
      };
      return stat;
    });

    const titleText = customTitle
      ? customTitle
      : providedConsignes
      ? "Consignes liées"
      : isPractice
      ? effectiveCategory || "Pratique"
      : effectiveCategory
      ? `Journalier — ${effectiveCategory}`
      : "Journalier — toutes les catégories";
    const headerMainTitle = providedConsignes
      ? "Progression"
      : isPractice
      ? "Tableau de bord"
      : "Progression quotidienne";
    const headerSubtitle = providedConsignes
      ? "Suivi des consignes sélectionnées et de leur progression."
      : isPractice
      ? "Suivi de vos consignes et progression."
      : "Suivi de vos journées et progression.";

    const headerContextText = (() => {
      if (providedConsignes) {
        if (customTitle) return customTitle;
        return "Consignes sélectionnées";
      }
      if (isPractice) {
        return effectiveCategory || "Toutes les consignes";
      }
      if (effectiveCategory) {
        return `Catégorie : ${effectiveCategory}`;
      }
      return "Toutes les catégories";
    })();
    const safeHeaderContext = escapeHtml(headerContextText);

    const historySubtitleText = providedConsignes
      ? "Historique des consignes sélectionnées."
      : isPractice
      ? "Historique des sessions de pratique, du plus récent au plus ancien."
      : "Historique quotidien classé par entrée, du plus récent au plus ancien.";

    const html = `
      <div class="goal-modal modal practice-dashboard practice-dashboard--minimal">
        <div class="goal-modal-card modal-card practice-dashboard__card">
          <div class="practice-dashboard__header">
            <div class="practice-dashboard__title-group">
              <span class="practice-dashboard__context">${safeHeaderContext}</span>
              <h2 class="practice-dashboard__title">${escapeHtml(headerMainTitle)}</h2>
              <p class="practice-dashboard__subtitle">${escapeHtml(historySubtitleText)}</p>
            </div>
            <button type="button" class="practice-dashboard__close btn btn-ghost" data-close aria-label="Fermer">✕</button>
          </div>
          <div class="practice-dashboard__body">
            <div class="practice-dashboard__history" data-history></div>
          </div>
          <footer class="practice-dashboard__footer">
            <div class="practice-dashboard__footer-actions">
              <button type="button" class="btn btn-ghost" data-dismiss-dashboard>Fermer</button>
            </div>
          </footer>
        </div>
      </div>
    `;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const overlay = wrapper.firstElementChild;
    if (!overlay) return;
    const dashboardMode = allowMixedMode ? "mixed" : isPractice ? "practice" : "daily";
    overlay.setAttribute("data-section", isPractice ? "practice" : "daily");
    overlay.setAttribute("data-dashboard-mode", dashboardMode);
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", `${titleText} — tableau de bord`);
    document.body.appendChild(overlay);
    wrapper.innerHTML = "";
    const dashboardCard = overlay.querySelector(".practice-dashboard__card");
    if (dashboardCard) {
      dashboardCard.setAttribute("data-dashboard-mode", dashboardMode);
    }

    const close = () => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelectorAll("[data-close]").forEach((button) => {
      button.addEventListener("click", close);
    });
    overlay.querySelectorAll("[data-dismiss-dashboard]").forEach((button) => {
      button.addEventListener("click", close);
    });
    overlay.querySelector("[data-primary-action]")?.addEventListener("click", close);

    const historyContainer = overlay.querySelector("[data-history]");

    function renderHistory() {
      if (!historyContainer) return;
      if (!stats.length) {
        historyContainer.innerHTML = '<p class="practice-dashboard__empty">Aucune consigne à afficher pour le moment.</p>';
        return;
      }
      const statusLabels = {
        ok: "Positive",
        mid: "Intermédiaire",
        ko: "À surveiller",
        na: "Sans donnée",
      };
      const cards = stats
        .map((stat) => {
          const accentStyle = stat.accentStrong
            ? ` style="--history-accent:${stat.accentStrong}; --history-soft:${stat.accentSoft}; --history-border:${stat.accentBorder};"`
            : "";
          const entries = (stat.entries || [])
            .slice()
            .reverse()
            .map((entry) => {
              const meta = iterationMetaByKey.get(entry.date) || null;
              let pointIndex = Number.isInteger(meta?.index) ? meta.index : -1;
              if (pointIndex === -1) {
                pointIndex = stat.timeline.findIndex((point) => point.dateIso === entry.date);
              }
              if (pointIndex < 0) return "";
              const statusKind = dotColor(stat.type, entry.value);
              const statusLabel = statusLabels[statusKind] || "Valeur";
              const dateLabel = meta?.fullLabel || meta?.label || entry.date;
              const relativeLabel = formatRelativeDate(meta?.dateObj || entry.date);
              const valueText = formatValue(stat.type, entry.value);
              const normalizedValue = valueText == null ? "" : String(valueText).trim();
              const fallbackValue = stat.type === "info" ? "" : "—";
              const safeValue = normalizedValue && normalizedValue !== "—" ? escapeHtml(normalizedValue) : fallbackValue;
              const noteMarkup = entry.note && entry.note.trim()
                ? `<span class="practice-dashboard__history-note">${escapeHtml(entry.note)}</span>`
                : "";
              const relativeMarkup = relativeLabel
                ? `<span class="practice-dashboard__history-date-sub">${escapeHtml(relativeLabel)}</span>`
                : "";
              return `
                <li class="practice-dashboard__history-item">
                  <button type="button" class="practice-dashboard__history-entry" data-entry data-consigne="${stat.id}" data-index="${pointIndex}">
                    <span class="practice-dashboard__history-entry-main">
                      <span class="practice-dashboard__history-dot practice-dashboard__history-dot--${statusKind}" aria-hidden="true"></span>
                      <span class="practice-dashboard__history-entry-text">
                        <span class="practice-dashboard__history-value">${safeValue}</span>
                        ${noteMarkup}
                      </span>
                    </span>
                    <span class="practice-dashboard__history-date">
                      <span class="practice-dashboard__history-date-main">${escapeHtml(dateLabel)}</span>
                      ${relativeMarkup}
                    </span>
                    <span class="sr-only">${escapeHtml(statusLabel)}</span>
                  </button>
                </li>
              `;
            })
            .filter(Boolean);
          const entriesMarkup = entries.length
            ? `<ol class="practice-dashboard__history-list">${entries.join("")}</ol>`
            : '<p class="practice-dashboard__empty">Aucune entrée enregistrée pour le moment.</p>';
          const metaParts = [];
          if (stat.lastRelative) {
            metaParts.push(`<span>${escapeHtml(stat.lastRelative)}</span>`);
          }
          if (stat.lastDateFull) {
            metaParts.push(`<span>${escapeHtml(stat.lastDateFull)}</span>`);
          }
          const metaMarkup = metaParts.length
            ? metaParts.join('<span class="practice-dashboard__history-meta-sep" aria-hidden="true">•</span>')
            : '<span>Aucune donnée récente</span>';
          const commentMarkup = stat.lastCommentRaw && stat.lastCommentRaw.trim()
            ? `<p class="practice-dashboard__history-last-note"><span class="practice-dashboard__history-last-note-label">Dernier commentaire :</span> ${escapeHtml(stat.commentDisplay)}</p>`
            : "";
          const totalEntries = stat.totalEntries || 0;
          const entriesLabel = totalEntries > 1 ? `${totalEntries} entrées` : `${totalEntries} entrée`;
          const typeChip = stat.typeLabel ? `<span class="practice-dashboard__chip">${escapeHtml(stat.typeLabel)}</span>` : "";
          return `
            <section class="practice-dashboard__history-section" data-id="${stat.id}"${accentStyle}>
              <header class="practice-dashboard__history-header">
                <div class="practice-dashboard__history-heading-group">
                  <h3 class="practice-dashboard__history-heading">${escapeHtml(stat.name)}</h3>
                  <p class="practice-dashboard__history-meta">${metaMarkup}</p>
                </div>
                <div class="practice-dashboard__history-tags">
                  <span class="practice-dashboard__chip">Priorité ${escapeHtml(stat.priorityLabel)}</span>
                  ${typeChip}
                  <span class="practice-dashboard__chip">${escapeHtml(entriesLabel)}</span>
                </div>
              </header>
              <div class="practice-dashboard__history-summary" role="list">
                <div class="practice-dashboard__history-summary-item" role="listitem">
                  <span class="practice-dashboard__history-summary-label">Dernière valeur</span>
                  <span class="practice-dashboard__history-summary-value">${escapeHtml(stat.lastFormatted || (stat.type === "info" ? "" : "—"))}</span>
                </div>
                <div class="practice-dashboard__history-summary-item" role="listitem">
                  <span class="practice-dashboard__history-summary-label">Moyenne</span>
                  <span class="practice-dashboard__history-summary-value" title="${escapeHtml(stat.averageTitle)}">${escapeHtml(stat.averageDisplay || (stat.type === "info" ? "" : "—"))}</span>
                </div>
                <div class="practice-dashboard__history-summary-item" role="listitem">
                  <span class="practice-dashboard__history-summary-label">Dernière mise à jour</span>
                  <span class="practice-dashboard__history-summary-value">${escapeHtml(stat.lastDateShort || "Jamais")}</span>
                </div>
              </div>
              ${commentMarkup}
              ${entriesMarkup}
            </section>
          `;
        })
        .join("");
      historyContainer.innerHTML = `<div class="practice-dashboard__history-grid">${cards}</div>`;
    }

    renderHistory();

    historyContainer?.addEventListener("click", (event) => {
      const target = event.target.closest("[data-entry]");
      if (!target) return;
      const consigneId = target.getAttribute("data-consigne");
      const pointIndex = Number(target.getAttribute("data-index"));
      if (!Number.isFinite(pointIndex)) return;
      const stat = stats.find((item) => item.id === consigneId);
      if (!stat) return;
      if (stat.type === "info") return;
      openCellEditor(stat, pointIndex);
    });

    function buildValueField(consigne, value, fieldId) {
      const type = consigne?.type || "short";
      if (type === "info") {
        return INFO_STATIC_BLOCK;
      }
      if (type === "num") {
        const current = value === "" || value == null ? "" : Number(value);
        return `<input id="${fieldId}" name="value" type="number" step="0.1" class="practice-editor__input" placeholder="Réponse" value="${Number.isFinite(current) ? escapeHtml(String(current)) : ""}">`;
      }
      if (type === "likert5") {
        const current = value === "" || value == null ? "" : Number(value);
        const options = [0, 1, 2, 3, 4]
          .map((n) => `<option value="${n}" ${current === n ? "selected" : ""}>${n}</option>`)
          .join("");
        return `<select id="${fieldId}" name="value" class="practice-editor__select"><option value=""></option>${options}</select>`;
      }
      if (type === "likert6") {
        const current = value === "" || value == null ? "" : String(value);
        return `<select id="${fieldId}" name="value" class="practice-editor__select">
          <option value="" ${current === "" ? "selected" : ""}>—</option>
          <option value="yes" ${current === "yes" ? "selected" : ""}>Oui</option>
          <option value="rather_yes" ${current === "rather_yes" ? "selected" : ""}>Plutôt oui</option>
          <option value="medium" ${current === "medium" ? "selected" : ""}>Neutre</option>
          <option value="rather_no" ${current === "rather_no" ? "selected" : ""}>Plutôt non</option>
          <option value="no" ${current === "no" ? "selected" : ""}>Non</option>
          <option value="no_answer" ${current === "no_answer" ? "selected" : ""}>Pas de réponse</option>
        </select>`;
      }
      if (type === "yesno") {
        const current = value === "" || value == null ? "" : String(value);
        return `<select id="${fieldId}" name="value" class="practice-editor__select">
          <option value="" ${current === "" ? "selected" : ""}>—</option>
          <option value="yes" ${current === "yes" ? "selected" : ""}>Oui</option>
          <option value="no" ${current === "no" ? "selected" : ""}>Non</option>
        </select>`;
      }
      if (type === "long") {
        return `<textarea id="${fieldId}" name="value" rows="4" class="practice-editor__textarea" placeholder="Réponse">${escapeHtml(String(value ?? ""))}</textarea>`;
      }
      return `<input id="${fieldId}" name="value" type="text" class="practice-editor__input" placeholder="Réponse" value="${escapeHtml(String(value ?? ""))}">`;
    }

    function readValueFromForm(consigne, form) {
      const type = consigne?.type || "short";
      if (type === "info") {
        return "";
      }
      const field = form.elements.value;
      if (!field) return "";
      if (type === "long" || type === "short") {
        return (field.value || "").trim();
      }
      if (type === "num") {
        if (field.value === "" || field.value == null) return "";
        const num = Number(field.value);
        return Number.isFinite(num) ? num : "";
      }
      if (type === "likert5") {
        if (field.value === "" || field.value == null) return "";
        const num = Number(field.value);
        return Number.isFinite(num) ? num : "";
      }
      if (type === "yesno" || type === "likert6") {
        return field.value || "";
      }
      return (field.value || "").trim();
    }

    function updateStatAfterEdit(stat, pointIndex, newRawValue, newNote) {
      const point = stat.timeline[pointIndex];
      if (!point) return;
      const rawValue = newRawValue === null || newRawValue === undefined ? "" : newRawValue;
      const note = newNote ? newNote : "";
      point.rawValue = rawValue;
      point.note = note;
      point.numeric = numericPoint(stat.type, rawValue);
      if (stat.timelineByKey) {
        stat.timelineByKey.set(point.dateIso, point);
      }
      const meta = iterationMeta[pointIndex];
      const existingIndex = stat.entries.findIndex((entry) => entry.date === point.dateIso);
      const existingEntry = existingIndex !== -1 ? stat.entries[existingIndex] : null;
      const createdAt = existingEntry?.createdAt || meta?.dateObj || null;
      const hasValue = !(rawValue === "" || (typeof rawValue === "string" && !rawValue.trim()));
      const hasNote = !!note && note.trim();
      if (!hasValue && !hasNote) {
        if (existingIndex !== -1) stat.entries.splice(existingIndex, 1);
      } else if (existingIndex !== -1) {
        stat.entries[existingIndex] = { date: point.dateIso, value: rawValue, note, createdAt };
      } else {
        stat.entries.push({ date: point.dateIso, value: rawValue, note, createdAt });
        stat.entries.sort((a, b) => a.date.localeCompare(b.date));
      }

      const numericValues = stat.timeline.map((item) => item.numeric).filter((item) => item != null);
      stat.hasNumeric = numericValues.length > 0;
      stat.averageNumeric = numericValues.length
        ? numericValues.reduce((acc, value) => acc + value, 0) / numericValues.length
        : null;
      stat.averageNormalized = normalizeScore(stat.type, stat.averageNumeric);
      const updatedAverageDisplay = stat.averageNormalized != null
        ? percentFormatter.format(stat.averageNormalized)
        : stat.averageNumeric != null
        ? numberFormatter.format(stat.averageNumeric)
        : "—";
      stat.averageDisplay = stat.type === "info" ? "" : updatedAverageDisplay;
      stat.averageTitle = stat.averageNormalized != null
        ? stat.type === "likert5"
          ? "Score converti en pourcentage sur une échelle de 0 à 4."
          : "Taux moyen de réussite sur la période affichée."
        : stat.averageNumeric != null
        ? "Moyenne des valeurs numériques enregistrées."
        : "Aucune donnée disponible pour le moment.";

      stat.totalEntries = stat.entries.length;
      const lastEntry = stat.entries[stat.entries.length - 1] || null;
      const lastDateIso = lastEntry?.date || "";
      const lastMeta = lastDateIso ? iterationMetaByKey.get(lastDateIso) : null;
      const lastDateObj = lastEntry?.createdAt || lastMeta?.dateObj || null;
      const lastValue = lastEntry?.value ?? "";
      stat.lastDateIso = lastDateIso;
      stat.lastDateShort = lastDateObj ? shortDateFormatter.format(lastDateObj) : "Jamais";
      stat.lastDateFull = lastDateObj ? fullDateTimeFormatter.format(lastDateObj) : "Jamais";
      stat.lastRelative = formatRelativeDate(lastDateObj || lastDateIso);
      stat.lastValue = lastValue;
      stat.lastFormatted = formatValue(stat.type, lastValue);
      stat.lastCommentRaw = lastEntry?.note ?? "";
      stat.commentDisplay = truncateText(stat.lastCommentRaw, 180);
      stat.statusKind = dotColor(stat.type, lastValue);
    }

    function openCellEditor(stat, pointIndex) {
      if (stat?.type === "info") {
        return;
      }
      const point = stat.timeline[pointIndex];
      if (!point) return;
      const consigne = stat.consigne;
      const valueId = `practice-editor-value-${stat.id}-${pointIndex}-${Date.now()}`;
      const valueField = buildValueField(consigne, point.rawValue, valueId);
      const noteValue = point.note || "";
      const iterationInfo = iterationMeta[pointIndex];
      const iterationLabel = iterationInfo?.label || `Itération ${pointIndex + 1}`;
      const dateObj = iterationInfo?.dateObj || toDate(point.dateIso);
      const fullDateLabel = iterationInfo?.fullLabel || (dateObj ? fullDateTimeFormatter.format(dateObj) : point.dateIso);
      const dateLabel = fullDateLabel && fullDateLabel !== iterationLabel ? `${iterationLabel} — ${fullDateLabel}` : fullDateLabel || iterationLabel;
      const autosaveKeyParts = [
        "practice-entry",
        ctx.user?.uid || "anon",
        stat.id || "stat",
        point.dateIso || pointIndex,
      ];
      const autosaveKey = autosaveKeyParts.map((part) => String(part)).join(":");
      const editorHtml = `
        <form class="practice-editor" data-autosave-key="${escapeHtml(autosaveKey)}">
          <header class="practice-editor__header">
            <h3 class="practice-editor__title">Modifier la note</h3>
            <p class="practice-editor__subtitle">${escapeHtml(stat.name)}</p>
          </header>
          <div class="practice-editor__section">
            <label class="practice-editor__label">Date</label>
            <p class="practice-editor__value">${escapeHtml(dateLabel)}</p>
          </div>
          <div class="practice-editor__section">
            <label class="practice-editor__label" for="${valueId}">Valeur</label>
            ${valueField}
          </div>
          <div class="practice-editor__section">
            <label class="practice-editor__label" for="${valueId}-note">Commentaire</label>
            <textarea id="${valueId}-note" name="note" rows="3" class="practice-editor__textarea" placeholder="Ajouter un commentaire">${escapeHtml(noteValue)}</textarea>
          </div>
          <div class="practice-editor__actions">
            <button type="button" class="btn btn-ghost" data-cancel>Annuler</button>
            <button type="button" class="btn btn-danger" data-clear>Effacer</button>
            <button type="submit" class="btn btn-primary">Enregistrer</button>
          </div>
        </form>
      `;
      const panel = modal(editorHtml);
      const form = panel.querySelector("form");
      const cancelBtn = form.querySelector("[data-cancel]");
      const clearBtn = form.querySelector("[data-clear]");
      const submitBtn = form.querySelector('button[type="submit"]');
      cancelBtn?.addEventListener("click", () => panel.remove());
      if (clearBtn) {
        const hasInitialData =
          (point.rawValue !== "" && point.rawValue != null) || (point.note && point.note.trim());
        if (!hasInitialData) {
          clearBtn.disabled = true;
        }
        clearBtn.addEventListener("click", async (event) => {
          event.preventDefault();
          if (!confirm("Effacer la note pour cette date ?")) return;
          clearBtn.disabled = true;
          submitBtn.disabled = true;
          try {
            await Schema.deleteHistoryEntry(ctx.db, ctx.user.uid, stat.id, point.dateIso);
            updateStatAfterEdit(stat, pointIndex, "", "");
            renderHistory();
            panel.remove();
          } catch (err) {
            console.error("practice-dashboard:clear-cell", err);
            clearBtn.disabled = false;
            submitBtn.disabled = false;
          }
        });
      }
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (submitBtn.disabled) return;
        submitBtn.disabled = true;
        if (clearBtn) clearBtn.disabled = true;
        try {
          const rawValue = readValueFromForm(consigne, form);
          const note = (form.elements.note?.value || "").trim();
          const isRawEmpty = rawValue === "" || rawValue == null;
          if (isRawEmpty && !note) {
            await Schema.deleteHistoryEntry(ctx.db, ctx.user.uid, stat.id, point.dateIso);
            updateStatAfterEdit(stat, pointIndex, "", "");
          } else {
            await Schema.saveHistoryEntry(ctx.db, ctx.user.uid, stat.id, point.dateIso, {
              value: rawValue,
              note,
            });
            updateStatAfterEdit(stat, pointIndex, rawValue, note);
          }
          renderHistory();
          panel.remove();
        } catch (err) {
          console.error("practice-dashboard:save-cell", err);
          submitBtn.disabled = false;
          if (clearBtn) clearBtn.disabled = false;
        }
      });
    }

    // Tableau de bord réduit à la liste : aucune logique de graphique nécessaire.
  } catch (err) {
    console.warn("openCategoryDashboard:error", err);
  }
};
// --------- DRAG & DROP (ordre consignes) ---------
window.attachConsignesDragDrop = function attachConsignesDragDrop(container, ctx) {
  let dragId = null;
  let dragWrapper = null;

  container.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.consigne-card');
    if (!el || el.dataset.parentId) return;
    dragId = el.dataset.id;
    dragWrapper = el.closest('.consigne-group') || el;
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragover', (e) => {
    if (!dragId || !dragWrapper) return;
    e.preventDefault();
    let over = e.target.closest('.consigne-card');
    if (!over || over.dataset.parentId) {
      over = e.target.closest('.consigne-group')?.querySelector('.consigne-card');
    }
    if (!over || over.dataset.id === dragId || over.dataset.parentId) return;
    const overWrapper = over.closest('.consigne-group') || over;
    const rect = overWrapper.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    overWrapper.parentNode.insertBefore(
      dragWrapper,
      before ? overWrapper : overWrapper.nextSibling
    );
  });

  container.addEventListener('drop', async (e) => {
    if (!dragId) return;
    e.preventDefault();
    const cards = [...container.querySelectorAll('.consigne-card:not([data-parent-id])')];
    try {
      await Promise.all(cards.map((el, idx) =>
        Schema.updateConsigneOrder(ctx.db, ctx.user.uid, el.dataset.id, (idx+1)*10)
      ));
    } catch (err) {
      console.warn('drag-drop:save-order:error', err);
    }
    dragId = null;
    dragWrapper = null;
  });

  container.addEventListener('dragend', () => {
    dragId = null;
    dragWrapper = null;
  });
};

async function categorySelect(ctx, mode, currentName = "") {
  const cats = await Schema.fetchCategories(ctx.db, ctx.user.uid);
  const uniqueNames = Array.from(new Set(cats.map((c) => c.name).filter(Boolean)));
  uniqueNames.sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
  const listId = `category-list-${mode}-${Date.now()}`;

  return `
    <label class="block text-sm text-[var(--muted)] mb-1">Catégorie</label>
    <input name="categoryInput"
           list="${listId}"
           class="w-full"
           placeholder="Choisir ou taper un nom…"
           value="${escapeHtml(currentName || "")}">
    <datalist id="${listId}">
      ${uniqueNames.map(n => `<option value="${escapeHtml(n)}"></option>`).join("")}
    </datalist>
    <div class="text-xs text-[var(--muted)] mt-1">
      Tu peux taper un nouveau nom ou choisir dans la liste.
    </div>
  `;
}

function consigneActions({ includeSR = false, consigne = null } = {}) {
  const srToggle = includeSR && consigne ? srBadge(consigne) : "";
  return `
    <div class="consigne-menu" data-menu-root>
      <button type="button"
              class="consigne-menu__trigger"
              aria-haspopup="true"
              aria-expanded="false"
              title="Options"
              data-menu-trigger>
        ⋮<span class="sr-only">Ouvrir le menu des actions</span>
      </button>
      <div class="consigne-menu__panel" role="menu" hidden data-menu-panel>
        ${srToggle}
        <button type="button" class="consigne-menu__item js-histo" role="menuitem" data-menu-action="history">Historique</button>
        <button type="button" class="consigne-menu__item js-edit" role="menuitem" data-menu-action="edit">Modifier</button>
        <button type="button" class="consigne-menu__item js-delay" role="menuitem" data-menu-action="delay">Décaler</button>
        <button type="button" class="consigne-menu__item js-del" role="menuitem" data-menu-action="delete">Supprimer</button>
      </div>
    </div>
  `;
}

function preventDragConflicts(target) {
  if (!target) return;
  const stop = (event) => {
    event.stopPropagation();
  };
  target.addEventListener("pointerdown", stop);
  target.addEventListener("mousedown", stop);
  target.addEventListener("touchstart", stop, { passive: true });
}

function fieldDefinitionForConsigne(consigne, initialValue = null) {
  const id = consigne?.id;
  const type = consigne?.type;
  if (!id || !type) {
    return { kind: "unknown", name: null, value: initialValue ?? "" };
  }
  if (type === "info") {
    return { kind: "info", name: null, value: null };
  }
  if (type === "short") {
    return {
      kind: "text",
      name: `short:${id}`,
      value: initialValue != null ? String(initialValue) : "",
      placeholder: "Réponse",
    };
  }
  if (type === "long") {
    return {
      kind: "textarea",
      name: `long:${id}`,
      value: initialValue != null ? String(initialValue) : "",
      placeholder: "Réponse",
    };
  }
  if (type === "num") {
    const numericValue = Number(initialValue);
    const value = Number.isFinite(numericValue) ? numericValue : 5;
    return {
      kind: "range",
      name: `num:${id}`,
      value,
      min: 1,
      max: 10,
      step: 1,
    };
  }
  if (type === "likert6") {
    const current = initialValue != null ? String(initialValue) : "";
    return {
      kind: "select",
      name: `likert6:${id}`,
      value: current,
      likertType: "likert6",
      options: [
        { value: "", label: "— choisir —" },
        { value: "yes", label: "Oui" },
        { value: "rather_yes", label: "Plutôt oui" },
        { value: "medium", label: "Neutre" },
        { value: "rather_no", label: "Plutôt non" },
        { value: "no", label: "Non" },
        { value: "no_answer", label: "Pas de réponse" },
      ],
    };
  }
  if (type === "likert5") {
    const current = initialValue != null ? String(initialValue) : "";
    return {
      kind: "select",
      name: `likert5:${id}`,
      value: current,
      likertType: "likert5",
      options: [
        { value: "", label: "— choisir —" },
        { value: "0", label: "0" },
        { value: "1", label: "1" },
        { value: "2", label: "2" },
        { value: "3", label: "3" },
        { value: "4", label: "4" },
      ],
    };
  }
  if (type === "yesno") {
    const current = initialValue != null ? String(initialValue) : "";
    return {
      kind: "select",
      name: `yesno:${id}`,
      value: current,
      likertType: "yesno",
      options: [
        { value: "", label: "— choisir —" },
        { value: "yes", label: "Oui" },
        { value: "no", label: "Non" },
      ],
    };
  }
  return {
    kind: "unknown",
    name: `${type}:${id}`,
    value: initialValue != null ? String(initialValue) : "",
  };
}

function createConsigneFieldStore(consigne, initialValue = null) {
  const definition = fieldDefinitionForConsigne(consigne, initialValue);
  const container = document.createElement("div");
  container.className = "consigne-card__field-store";
  container.hidden = true;
  let field = null;

  if (definition.kind === "select") {
    field = document.createElement("select");
    field.name = definition.name;
    field.hidden = true;
    field.tabIndex = -1;
    field.setAttribute("aria-hidden", "true");
    if (definition.likertType) {
      field.dataset.likertType = definition.likertType;
    }
    (definition.options || []).forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      if (option.value === definition.value) {
        opt.selected = true;
      }
      field.appendChild(opt);
    });
  } else if (definition.kind === "range") {
    field = document.createElement("input");
    field.type = "range";
    field.name = definition.name;
    field.min = definition.min;
    field.max = definition.max;
    field.step = definition.step;
    field.value = definition.value;
    field.hidden = true;
    field.tabIndex = -1;
    field.setAttribute("aria-hidden", "true");
  } else if (definition.kind === "text") {
    field = document.createElement("input");
    field.type = "text";
    field.name = definition.name;
    field.value = definition.value;
    field.hidden = true;
    field.tabIndex = -1;
    field.setAttribute("aria-hidden", "true");
  } else if (definition.kind === "textarea") {
    field = document.createElement("textarea");
    field.name = definition.name;
    field.value = definition.value;
    field.hidden = true;
    field.tabIndex = -1;
    field.setAttribute("aria-hidden", "true");
  } else if (definition.kind !== "info") {
    field = document.createElement("input");
    field.type = "text";
    field.name = definition.name;
    field.value = definition.value;
    field.hidden = true;
    field.tabIndex = -1;
    field.setAttribute("aria-hidden", "true");
  }

  if (field) {
    container.appendChild(field);
  }

  return { definition, container, field };
}

function formatConsigneValue(definition, rawValue) {
  if (!definition) return "";
  if (definition.kind === "info") {
    return INFO_RESPONSE_LABEL;
  }
  if (definition.kind === "select") {
    const value = rawValue != null ? String(rawValue) : "";
    const match = (definition.options || []).find((opt) => opt.value === value);
    return match ? match.label : "— choisir —";
  }
  if (definition.kind === "range") {
    if (rawValue == null || rawValue === "") return "—";
    return String(rawValue);
  }
  if (definition.kind === "text" || definition.kind === "textarea") {
    const value = rawValue != null ? String(rawValue).trim() : "";
    return value || "—";
  }
  if (rawValue == null || rawValue === "") {
    return "—";
  }
  return String(rawValue).trim();
}

function updateConsigneValueDisplay(card) {
  const state = consigneFieldStates.get(card);
  if (!state) return;
  const { definition, field } = state;
  const value = field ? field.value : definition.value;
  const label = formatConsigneValue(definition, value);
  const isPlaceholder =
    (value == null || value === "") && definition.kind !== "info";
  const toggle = card.querySelector("[data-consigne-toggle]");
  if (!toggle) return;
  if (!isPlaceholder) {
    toggle.setAttribute("data-value-label", label);
    toggle.setAttribute("title", label);
  } else {
    toggle.removeAttribute("data-value-label");
    toggle.removeAttribute("title");
  }
}

function applyConsigneValue(card, value, { emit = true } = {}) {
  const state = consigneFieldStates.get(card);
  if (!state) return;
  const nextValue = value != null ? value : "";
  state.definition.value = nextValue;
  if (state.field) {
    state.field.value = nextValue;
    if (emit) {
      state.field.dispatchEvent(new Event("input", { bubbles: true }));
      state.field.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  updateConsigneValueDisplay(card);
  syncLikertStatusForCard(card);
}

function closeActiveConsignePicker({ restoreFocus = false } = {}) {
  if (!activeConsignePicker) return;
  const { element, card, toggle, cleanup } = activeConsignePicker;
  if (cleanup) {
    cleanup();
  }
  element.remove();
  card.classList.remove("consigne-card--picker-open");
  toggle.setAttribute("aria-expanded", "false");
  if (restoreFocus) {
    try {
      toggle.focus({ preventScroll: true });
    } catch (err) {
      toggle.focus();
    }
  }
  activeConsignePicker = null;
}

function openConsignePicker(card) {
  const state = consigneFieldStates.get(card);
  if (!state) return;
  if (state.definition.kind === "info") {
    return;
  }
  const toggle = card.querySelector("[data-consigne-toggle]");
  if (!toggle) return;

  if (activeConsignePicker && activeConsignePicker.card === card) {
    closeActiveConsignePicker();
  }

  closeActiveConsignePicker();

  const picker = document.createElement("div");
  picker.className = "consigne-picker";
  picker.role = "dialog";
  picker.tabIndex = -1;
  const titleText = card.querySelector(".consigne-card__title")?.textContent?.trim();
  if (titleText) {
    picker.setAttribute("aria-label", `Réponses possibles pour ${titleText}`);
  }

  const currentValue = state.field ? state.field.value : state.definition.value;
  let pendingValue = currentValue ?? "";

  const commit = (val) => {
    applyConsigneValue(card, val);
  };

  if (state.definition.kind === "select") {
    const list = document.createElement("div");
    list.className = "consigne-picker__options";
    (state.definition.options || []).forEach((option) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "consigne-picker__option";
      btn.textContent = option.label;
      if (String(option.value) === String(currentValue ?? "")) {
        btn.classList.add("is-active");
      }
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        commit(option.value);
        closeActiveConsignePicker({ restoreFocus: true });
      });
      list.appendChild(btn);
    });
    picker.appendChild(list);
  } else if (state.definition.kind === "range") {
    const wrapper = document.createElement("div");
    wrapper.className = "consigne-picker__range";
    const label = document.createElement("div");
    label.className = "consigne-picker__range-value";
    label.textContent = String(pendingValue || state.definition.min || 0);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = state.definition.min;
    slider.max = state.definition.max;
    slider.step = state.definition.step || 1;
    slider.value = pendingValue || state.definition.value || state.definition.min;
    slider.addEventListener("input", () => {
      pendingValue = slider.value;
      label.textContent = String(pendingValue);
    });
    wrapper.appendChild(label);
    wrapper.appendChild(slider);
    picker.appendChild(wrapper);

    const actions = document.createElement("div");
    actions.className = "consigne-picker__actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "consigne-picker__action consigne-picker__action--primary";
    saveBtn.textContent = "Enregistrer";
    saveBtn.addEventListener("click", (event) => {
      event.preventDefault();
      commit(pendingValue);
      closeActiveConsignePicker({ restoreFocus: true });
    });
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "consigne-picker__action";
    cancelBtn.textContent = "Annuler";
    cancelBtn.addEventListener("click", (event) => {
      event.preventDefault();
      closeActiveConsignePicker({ restoreFocus: true });
    });
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    picker.appendChild(actions);
  } else {
    const wrapper = document.createElement("form");
    wrapper.className = "consigne-picker__form";
    const isTextarea = state.definition.kind === "textarea";
    const fieldWrapper = document.createElement("div");
    fieldWrapper.className = "consigne-picker__field";
    let field;
    if (isTextarea) {
      field = document.createElement("textarea");
      field.rows = state.definition.rows || 3;
    } else {
      field = document.createElement("input");
      field.type = "text";
    }
    field.className = "consigne-picker__input";
    field.value = pendingValue;
    if (state.definition.placeholder) {
      field.placeholder = state.definition.placeholder;
    }
    const maxLengthCandidate = state.definition.maxLength ?? state.field?.maxLength;
    const maxLength = Number.isFinite(Number(maxLengthCandidate)) && Number(maxLengthCandidate) > 0
      ? Number(maxLengthCandidate)
      : null;
    if (maxLength) {
      field.maxLength = maxLength;
    }
    const counter = document.createElement("div");
    counter.className = "consigne-picker__counter";
    counter.setAttribute("aria-live", "polite");
    const updateCounter = () => {
      const length = field.value.length;
      const lengthLabel = length > 1 ? "caractères" : "caractère";
      if (maxLength) {
        const maxLabel = maxLength > 1 ? "caractères" : "caractère";
        counter.textContent = `${length} ${lengthLabel} / ${maxLength} ${maxLabel}`;
      } else {
        counter.textContent = `${length} ${lengthLabel}`;
      }
    };
    const autoResize = () => {
      if (!isTextarea) return;
      field.style.height = "auto";
      let minHeight = 0;
      try {
        const styles = window.getComputedStyle(field);
        minHeight = parseFloat(styles.minHeight) || 0;
      } catch (err) {
        minHeight = 0;
      }
      const nextHeight = Math.max(field.scrollHeight, minHeight);
      field.style.height = `${nextHeight}px`;
    };
    field.addEventListener("input", () => {
      pendingValue = field.value;
      if (isTextarea) {
        autoResize();
      }
      updateCounter();
    });
    fieldWrapper.appendChild(field);
    wrapper.appendChild(fieldWrapper);
    const footer = document.createElement("div");
    footer.className = "consigne-picker__footer";
    footer.appendChild(counter);
    updateCounter();
    const actions = document.createElement("div");
    actions.className = "consigne-picker__actions consigne-picker__actions--inline";
    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.className = "consigne-picker__action consigne-picker__action--primary";
    saveBtn.textContent = "Enregistrer";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "consigne-picker__action";
    cancelBtn.textContent = "Annuler";
    cancelBtn.addEventListener("click", (event) => {
      event.preventDefault();
      closeActiveConsignePicker({ restoreFocus: true });
    });
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    footer.appendChild(actions);
    wrapper.appendChild(footer);
    wrapper.addEventListener("submit", (event) => {
      event.preventDefault();
      commit(field.value);
      closeActiveConsignePicker({ restoreFocus: true });
    });
    picker.appendChild(wrapper);
    const initializeField = () => {
      if (isTextarea) {
        autoResize();
      }
      updateCounter();
      try {
        field.focus({ preventScroll: true });
      } catch (err) {
        field.focus();
      }
    };
    requestAnimationFrame(initializeField);
  }

  document.body.appendChild(picker);

  const rect = toggle.getBoundingClientRect();
  const pickerRect = picker.getBoundingClientRect();
  const offsetX = rect.left + window.scrollX;
  let left = offsetX;
  if (left + pickerRect.width > window.innerWidth + window.scrollX - 16) {
    left = window.innerWidth + window.scrollX - pickerRect.width - 16;
  }
  if (left < 16) left = 16;
  picker.style.left = `${left}px`;
  picker.style.top = `${rect.bottom + window.scrollY + 8}px`;

  card.classList.add("consigne-card--picker-open");
  toggle.setAttribute("aria-expanded", "true");

  const onDocClick = (event) => {
    if (picker.contains(event.target) || toggle.contains(event.target)) {
      return;
    }
    closeActiveConsignePicker({ restoreFocus: false });
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeActiveConsignePicker({ restoreFocus: true });
    }
  };

  document.addEventListener("mousedown", onDocClick);
  const touchOptions = { passive: true };
  document.addEventListener("touchstart", onDocClick, touchOptions);
  document.addEventListener("keydown", onKeyDown);

  activeConsignePicker = {
    card,
    element: picker,
    toggle,
    cleanup() {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("touchstart", onDocClick, touchOptions);
      document.removeEventListener("keydown", onKeyDown);
    },
  };
}

function initializeCollapsibleCard(card, { defaultOpen = false } = {}) {
  const toggle = card.querySelector("[data-consigne-toggle]");
  if (!toggle) return { isExpanded: () => false, setExpanded: () => {} };

  const open = () => {
    openConsignePicker(card);
  };

  toggle.setAttribute("aria-expanded", "false");

  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    open();
  });

  toggle.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeActiveConsignePicker({ restoreFocus: true });
    }
  });

  toggle.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  toggle.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });
  toggle.addEventListener("touchstart", (event) => {
    event.stopPropagation();
  }, { passive: true });

  if (defaultOpen) {
    requestAnimationFrame(() => {
      open();
    });
  }

  return {
    isExpanded: () => card.classList.contains("consigne-card--picker-open"),
    setExpanded: (next) => {
      if (next) {
        open();
      } else {
        closeActiveConsignePicker({ restoreFocus: false });
      }
    },
  };
}

function setupContextMenu(root) {
  if (!root) return { close: () => {}, isOpen: () => false };
  const trigger = root.querySelector("[data-menu-trigger]");
  const panel = root.querySelector("[data-menu-panel]");
  if (!trigger || !panel) return { close: () => {}, isOpen: () => false };
  preventDragConflicts(trigger);
  preventDragConflicts(panel);
  let open = false;
  let docPointerHandler = null;
  let docKeyHandler = null;
  const items = () => Array.from(panel.querySelectorAll("[data-menu-action]"));

  const closeMenu = () => {
    if (!open) return;
    open = false;
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    root.classList.remove("consigne-menu--open");
    if (docPointerHandler) {
      document.removeEventListener("pointerdown", docPointerHandler, true);
      document.removeEventListener("mousedown", docPointerHandler, true);
      document.removeEventListener("touchstart", docPointerHandler, true);
      docPointerHandler = null;
    }
    if (docKeyHandler) {
      document.removeEventListener("keydown", docKeyHandler, true);
      docKeyHandler = null;
    }
  };

  const focusFirstItem = () => {
    const [first] = items();
    if (first) {
      first.focus();
    }
  };

  const openMenu = () => {
    if (open) return;
    open = true;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    root.classList.add("consigne-menu--open");
    focusFirstItem();
    docPointerHandler = (event) => {
      if (!root.contains(event.target)) {
        closeMenu();
      }
    };
    document.addEventListener("pointerdown", docPointerHandler, true);
    document.addEventListener("mousedown", docPointerHandler, true);
    document.addEventListener("touchstart", docPointerHandler, true);
    docKeyHandler = (event) => {
      if (event.key === "Escape") {
        closeMenu();
        trigger.focus();
      }
    };
    document.addEventListener("keydown", docKeyHandler, true);
  };

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (open) closeMenu();
    else openMenu();
  });

  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) openMenu();
      focusFirstItem();
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      closeMenu();
    }
  });

  panel.addEventListener("keydown", (event) => {
    const list = items();
    if (!list.length) return;
    const currentIndex = list.indexOf(document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = list[(currentIndex + 1) % list.length] || list[0];
      next.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const prev = list[(currentIndex - 1 + list.length) % list.length] || list[list.length - 1];
      prev.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      list[0].focus();
    } else if (event.key === "End") {
      event.preventDefault();
      list[list.length - 1].focus();
    }
  });

  return {
    close: closeMenu,
    isOpen: () => open,
  };
}

function inputForType(consigne, initialValue = null) {
  if (consigne.type === "info") {
    return INFO_STATIC_BLOCK;
  }
  if (consigne.type === "short") {
    const value = escapeHtml(initialValue ?? "");
    return `<input name="short:${consigne.id}" class="w-full" placeholder="Réponse" value="${value}">`;
  }
  if (consigne.type === "long") {
    const value = escapeHtml(initialValue ?? "");
    return `<textarea name="long:${consigne.id}" rows="3" class="w-full" placeholder="Réponse">${value}</textarea>`;
  }
  if (consigne.type === "num") {
    const sliderValue = initialValue != null && initialValue !== ""
      ? Number(initialValue)
      : 5;
    const safeValue = Number.isFinite(sliderValue) ? sliderValue : 5;
    return `
      <input type="range" min="1" max="10" value="${safeValue}" name="num:${consigne.id}" class="w-full">
      <div class="text-sm opacity-70 mt-1" data-meter="num:${consigne.id}">${safeValue}</div>
      <script>(()=>{const slider=document.currentScript.previousElementSibling.previousElementSibling;const label=document.currentScript.previousElementSibling;const sync=()=>{if(label&&slider){label.textContent=slider.value;}};if(slider){sync();slider.addEventListener('input',sync);}})();</script>
    `;
  }
  if (consigne.type === "likert6") {
    const current = (initialValue ?? "").toString();
    // Ordre désiré : Oui → Plutôt oui → Neutre → Plutôt non → Non → Pas de réponse
    return `
      <select name="likert6:${consigne.id}" class="w-full">
        <option value="" ${current === "" ? "selected" : ""}>— choisir —</option>
        <option value="yes" ${current === "yes" ? "selected" : ""}>Oui</option>
        <option value="rather_yes" ${current === "rather_yes" ? "selected" : ""}>Plutôt oui</option>
        <option value="medium" ${current === "medium" ? "selected" : ""}>Neutre</option>
        <option value="rather_no" ${current === "rather_no" ? "selected" : ""}>Plutôt non</option>
        <option value="no" ${current === "no" ? "selected" : ""}>Non</option>
        <option value="no_answer" ${current === "no_answer" ? "selected" : ""}>Pas de réponse</option>
      </select>
    `;
  }
  if (consigne.type === "likert5") {
    const current = initialValue != null ? String(initialValue) : "";
    return `
      <select name="likert5:${consigne.id}" class="w-full">
        <option value="" ${current === "" ? "selected" : ""}>— choisir —</option>
        <option value="0" ${current === "0" ? "selected" : ""}>0</option>
        <option value="1" ${current === "1" ? "selected" : ""}>1</option>
        <option value="2" ${current === "2" ? "selected" : ""}>2</option>
        <option value="3" ${current === "3" ? "selected" : ""}>3</option>
        <option value="4" ${current === "4" ? "selected" : ""}>4</option>
      </select>
    `;
  }
  if (consigne.type === "yesno") {
    const current = (initialValue ?? "").toString();
    return `
      <select name="yesno:${consigne.id}" class="w-full">
        <option value="" ${current === "" ? "selected" : ""}>— choisir —</option>
        <option value="yes" ${current === "yes" ? "selected" : ""}>Oui</option>
        <option value="no" ${current === "no" ? "selected" : ""}>Non</option>
      </select>
    `;
  }
  return "";
}

function groupConsignes(consignes) {
  const ordered = consignes.slice();
  const orderIndex = new Map(ordered.map((c, idx) => [c.id, idx]));
  const byId = new Map(ordered.map((c) => [c.id, c]));
  const childrenByParent = new Map();
  ordered.forEach((consigne) => {
    if (!consigne.parentId || !byId.has(consigne.parentId)) {
      return;
    }
    const list = childrenByParent.get(consigne.parentId) || [];
    list.push(consigne);
    childrenByParent.set(consigne.parentId, list);
  });
  childrenByParent.forEach((list) => {
    list.sort((a, b) => {
      const idxA = orderIndex.get(a.id) ?? 0;
      const idxB = orderIndex.get(b.id) ?? 0;
      if (idxA !== idxB) return idxA - idxB;
      const prioDiff = (a.priority || 0) - (b.priority || 0);
      if (prioDiff !== 0) return prioDiff;
      return (a.text || "").localeCompare(b.text || "");
    });
  });
  const seen = new Set();
  const groups = [];
  ordered.forEach((consigne) => {
    if (consigne.parentId && byId.has(consigne.parentId)) {
      return;
    }
    const children = childrenByParent.get(consigne.id) || [];
    groups.push({ consigne, children });
    seen.add(consigne.id);
    children.forEach((child) => seen.add(child.id));
  });
  ordered.forEach((consigne) => {
    if (!seen.has(consigne.id)) {
      groups.push({ consigne, children: [] });
      seen.add(consigne.id);
    }
  });
  return groups;
}

function collectAnswers(form, consignes, options = {}) {
  const dayKey = options.dayKey || null;
  const answers = [];
  for (const consigne of consignes) {
    if (consigne.type === "info") {
      continue;
    }
    if (consigne.type === "short") {
      const val = form.querySelector(`[name="short:${consigne.id}"]`)?.value?.trim();
      if (val) answers.push({ consigne, value: val, dayKey });
    } else if (consigne.type === "long") {
      const val = form.querySelector(`[name="long:${consigne.id}"]`)?.value?.trim();
      if (val) answers.push({ consigne, value: val, dayKey });
    } else if (consigne.type === "num") {
      const val = form.querySelector(`[name="num:${consigne.id}"]`)?.value;
      if (val) answers.push({ consigne, value: Number(val), dayKey });
    } else if (consigne.type === "likert5") {
      const val = form.querySelector(`[name="likert5:${consigne.id}"]`)?.value;
      if (val !== "" && val != null) answers.push({ consigne, value: Number(val), dayKey });
    } else if (consigne.type === "yesno") {
      const val = form.querySelector(`[name="yesno:${consigne.id}"]`)?.value;
      if (val) answers.push({ consigne, value: val, dayKey });
    } else if (consigne.type === "likert6") {
      const val = form.querySelector(`[name="likert6:${consigne.id}"]`)?.value;
      if (val) answers.push({ consigne, value: val, dayKey });
    }
  }
  return answers;
}

async function openConsigneForm(ctx, consigne = null) {
  const mode = consigne?.mode || (ctx.route.includes("/practice") ? "practice" : "daily");
  modesLogger.group("ui.consigneForm.open", { mode, consigneId: consigne?.id || null });
  const catUI = await categorySelect(ctx, mode, consigne?.category || null);
  const priority = Number(consigne?.priority ?? 2);
  const monthKey = Schema.monthKeyFromDate(new Date());
  let objectifs = [];
  try {
    objectifs = await Schema.listObjectivesByMonth(ctx.db, ctx.user.uid, monthKey);
  } catch (err) {
    modesLogger.warn("ui.consigneForm.objectifs.error", err);
  }
  const currentObjId = consigne?.objectiveId || "";
  const monthLabelFormatter = new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
  });
  const normalizeMonthLabel = (key) => {
    if (!key) return "";
    const [yearStr, monthStr] = String(key).split("-");
    const year = Number(yearStr);
    const monthIndex = Number(monthStr);
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
      return key;
    }
    const date = new Date(year, (monthIndex || 1) - 1, 1);
    if (Number.isNaN(date.getTime())) {
      return key;
    }
    const raw = monthLabelFormatter.format(date);
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : key;
  };
  const objectiveInfo = objectifs
    .map((o) => {
      const info = {
        id: o.id,
        title: o.titre || "Objectif",
        badge: "",
        period: normalizeMonthLabel(o.monthKey || monthKey),
      };
      if (o.type === "hebdo") {
        const weekNumber = Number(o.weekOfMonth || 0) || 1;
        info.badge = `Semaine ${weekNumber}`;
      } else if (o.type === "mensuel") {
        info.badge = "Mensuel";
      } else if (o.type) {
        info.badge = o.type.charAt(0).toUpperCase() + o.type.slice(1);
      }
      return info;
    })
    .sort((a, b) => a.title.localeCompare(b.title, "fr", { sensitivity: "base" }));
  const objectiveInfoById = new Map(objectiveInfo.map((item) => [item.id, item]));
  const renderObjectiveMeta = (id) => {
    if (!id) {
      return '<span class="objective-select__placeholder">Aucune association pour le moment.</span>';
    }
    const info = objectiveInfoById.get(id);
    if (!info) {
      return '<span class="objective-select__placeholder">Objectif introuvable.</span>';
    }
    const parts = [];
    if (info.badge) {
      parts.push(`<span class="objective-select__badge">${escapeHtml(info.badge)}</span>`);
    }
    if (info.period) {
      parts.push(`<span class="objective-select__period">${escapeHtml(info.period)}</span>`);
    }
    if (!parts.length) {
      parts.push('<span class="objective-select__placeholder">Aucune période renseignée</span>');
    }
    return `<div class="objective-select__summary">${parts.join("")}</div>`;
  };
  const objectifsOptions = objectiveInfo
    .map(
      (info) =>
        `<option value="${escapeHtml(info.id)}" ${info.id === currentObjId ? "selected" : ""}>
          ${escapeHtml(info.title)}
        </option>`
    )
    .join("");
  const objectiveMetaInitial = renderObjectiveMeta(currentObjId);
  const canManageChildren = !consigne?.parentId;
  let childConsignes = [];
  if (canManageChildren && consigne?.id) {
    try {
      childConsignes = await Schema.listChildConsignes(ctx.db, ctx.user.uid, consigne.id);
      childConsignes.sort((a, b) => {
        const orderDiff = (Number(a.order) || 0) - (Number(b.order) || 0);
        if (orderDiff !== 0) return orderDiff;
        const prioDiff = (Number(a.priority) || 0) - (Number(b.priority) || 0);
        if (prioDiff !== 0) return prioDiff;
        return (a.text || "").localeCompare(b.text || "");
      });
    } catch (err) {
      modesLogger.warn("ui.consigneForm.children.load", err);
    }
  }
  const html = `
    <h3 class="text-lg font-semibold mb-2">${consigne ? "Modifier" : "Nouvelle"} consigne</h3>
    <form class="grid gap-4" id="consigne-form" data-autosave-key="${escapeHtml(
      [
        "consigne",
        ctx.user?.uid || "anon",
        consigne?.id ? `edit-${consigne.id}` : `new-${mode}`,
      ].map((part) => String(part)).join(":")
    )}">
      <label class="grid gap-1">
        <span class="text-sm text-[var(--muted)]">Texte de la consigne</span>
        <input name="text" required class="w-full"
               value="${escapeHtml(consigne?.text || "")}" />
      </label>

      <label class="grid gap-1">
        <span class="text-sm text-[var(--muted)]">Type de réponse</span>
        <select name="type" class="w-full">
          <option value="likert6" ${!consigne || consigne?.type === "likert6" ? "selected" : ""}>Échelle de Likert (0–4)</option>
          <option value="yesno"   ${consigne?.type === "yesno"   ? "selected" : ""}>Oui / Non</option>
          <option value="short"   ${consigne?.type === "short"   ? "selected" : ""}>Texte court</option>
          <option value="long"    ${consigne?.type === "long"    ? "selected" : ""}>Texte long</option>
          <option value="num"     ${consigne?.type === "num"     ? "selected" : ""}>Échelle numérique (1–10)</option>
          <option value="info"    ${consigne?.type === "info"    ? "selected" : ""}>${INFO_RESPONSE_LABEL}</option>
        </select>
      </label>

      ${catUI}

      <div class="grid gap-1 objective-select">
        <span class="text-sm text-[var(--muted)]">📌 Associer à un objectif</span>
        <select id="objective-select" class="w-full objective-select__input">
          <option value="">Aucun</option>
          ${objectifsOptions}
        </select>
        <div class="objective-select__meta" data-objective-meta>${objectiveMetaInitial}</div>
      </div>

      <label class="grid gap-1">
        <span class="text-sm text-[var(--muted)]">Priorité</span>
        <select name="priority" class="w-full">
          <option value="1" ${priority === 1 ? "selected" : ""}>Haute</option>
          <option value="2" ${priority === 2 ? "selected" : ""}>Moyenne</option>
          <option value="3" ${priority === 3 ? "selected" : ""}>Basse</option>
        </select>
      </label>

      <label class="inline-flex items-center gap-2">
        <input type="checkbox" name="srEnabled" ${consigne?.srEnabled !== false ? "checked" : ""}>
        <span>⏳ Activer la répétition espacée</span>
      </label>

      ${canManageChildren ? `
      <fieldset class="grid gap-2" data-subconsignes>
        <legend class="text-sm text-[var(--muted)]">Sous-consignes</legend>
        <div class="grid gap-2" id="subconsignes-list"></div>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn btn-ghost text-sm" id="add-subconsigne">+ Ajouter une sous-consigne</button>
          <span class="text-xs text-[var(--muted)]">Les sous-consignes partagent la même catégorie, la même priorité et les mêmes réglages que la consigne principale.</span>
        </div>
      </fieldset>
      ` : ""}

      ${mode === "daily" ? `
      <fieldset class="grid gap-2">
        <legend class="text-sm text-[var(--muted)]">Fréquence (jours)</legend>

        <label class="inline-flex items-center gap-2 mb-1">
          <input type="checkbox" id="daily-all" ${(!consigne || !consigne.days || !consigne.days.length) ? "checked" : ""}>
          <span>Quotidien</span>
        </label>

        <div class="flex flex-wrap gap-2" id="daily-days">
          ${["LUN","MAR","MER","JEU","VEN","SAM","DIM"].map((day) => {
            const selected = Array.isArray(consigne?.days) && consigne.days.includes(day);
            return `<label class="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-sm">
        <input type="checkbox" name="days" value="${day}" ${selected ? "checked" : ""}>
        <span>${day}</span>
      </label>`;
          }).join("")}
        </div>
      </fieldset>
      ` : ""}

      <div class="flex justify-end gap-2 pt-2">
        <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `;
  const m = modal(html);
  const objectiveSelectEl = m.querySelector("#objective-select");
  const objectiveMetaBox = m.querySelector("[data-objective-meta]");
  const syncObjectiveMeta = () => {
    if (!objectiveMetaBox) return;
    const selectedId = objectiveSelectEl?.value || "";
    objectiveMetaBox.innerHTML = renderObjectiveMeta(selectedId);
  };
  if (objectiveSelectEl) {
    objectiveSelectEl.addEventListener("change", syncObjectiveMeta);
  }
  syncObjectiveMeta();
  const removedChildIds = new Set();
  if (canManageChildren) {
    const list = m.querySelector("#subconsignes-list");
    const addBtn = m.querySelector("#add-subconsigne");
    const renderEmpty = () => {
      if (!list) return;
      if (list.children.length) {
        list.setAttribute("data-has-items", "true");
        return;
      }
      list.removeAttribute("data-has-items");
      const empty = document.createElement("div");
      empty.className = "subconsigne-empty";
      empty.textContent = "Aucune sous-consigne pour le moment.";
      list.appendChild(empty);
    };
    const makeRow = (item = {}) => {
      const row = document.createElement("div");
      row.className = "subconsigne-row";
      row.dataset.subconsigne = "";
      if (item.id) row.dataset.id = item.id;
      row.innerHTML = `
        <div class="subconsigne-row__main">
          <input type="text" name="sub-text" class="w-full" placeholder="Texte de la sous-consigne" value="${escapeHtml(item.text || "")}">
          <select name="sub-type" class="w-full">
            <option value="likert6" ${!item.type || item.type === "likert6" ? "selected" : ""}>Échelle de Likert (0–4)</option>
            <option value="yesno" ${item.type === "yesno" ? "selected" : ""}>Oui / Non</option>
            <option value="short" ${item.type === "short" ? "selected" : ""}>Texte court</option>
            <option value="long" ${item.type === "long" ? "selected" : ""}>Texte long</option>
            <option value="num" ${item.type === "num" ? "selected" : ""}>Échelle numérique (1–10)</option>
            <option value="info" ${item.type === "info" ? "selected" : ""}>${INFO_RESPONSE_LABEL}</option>
          </select>
        </div>
        <div class="subconsigne-row__actions">
          <button type="button" class="btn btn-ghost text-xs" data-remove>Supprimer</button>
        </div>
      `;
      row.querySelector('[data-remove]')?.addEventListener('click', () => {
        if (item.id) {
          removedChildIds.add(item.id);
        }
        row.remove();
        if (list && !list.children.length) {
          renderEmpty();
        } else if (list) {
          list.setAttribute("data-has-items", "true");
        }
      });
      return row;
    };
    if (list) {
      list.innerHTML = "";
      childConsignes.forEach((item) => {
        const row = makeRow(item);
        list.appendChild(row);
      });
      renderEmpty();
    }
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        if (!list) return;
        if (!list.querySelector('[data-subconsigne]')) {
          list.innerHTML = "";
        }
        const row = makeRow({});
        list.appendChild(row);
        list.setAttribute("data-has-items", "true");
        row.querySelector('input[name="sub-text"]')?.focus();
      });
    }
  }
  const dailyAll = m.querySelector("#daily-all");
  const daysBox  = m.querySelector("#daily-days");
  if (dailyAll && daysBox) {
    const dayInputs = Array.from(daysBox.querySelectorAll('input[name="days"]'));
    const syncDaysState = (isDaily) => {
      dayInputs.forEach((cb) => {
        if (isDaily) cb.checked = true;
        cb.disabled = isDaily;
        const label = cb.closest("label");
        if (label) {
          label.classList.toggle("opacity-60", isDaily);
        }
      });
    };
    syncDaysState(dailyAll.checked);
    dailyAll.addEventListener("change", () => {
      syncDaysState(dailyAll.checked);
    });
  }
  modesLogger.groupEnd();
  $("#cancel", m).onclick = () => m.remove();

  $("#consigne-form", m).onsubmit = async (e) => {
    e.preventDefault();
    modesLogger.group("ui.consigneForm.submit");
    try {
      const fd = new FormData(e.currentTarget);
      const cat = (fd.get("categoryInput") || "").trim();
      if (!cat) {
        alert("Choisis (ou saisis) une catégorie.");
        return;
      }

      await Schema.ensureCategory(ctx.db, ctx.user.uid, cat, mode);

      const payload = {
        ownerUid: ctx.user.uid,
        mode,
        text: fd.get("text").trim(),
        type: fd.get("type"),
        category: cat,
        priority: Number(fd.get("priority") || 2),
        srEnabled: fd.get("srEnabled") !== null,
        active: true,
        parentId: consigne?.parentId || null,
      };
      if (mode === "daily") {
        const isAll = m.querySelector("#daily-all")?.checked;
        payload.days = isAll ? [] : $$("input[name=days]:checked", m).map((input) => input.value);
      }
      modesLogger.info("payload", payload);

      const selectedObjective = m.querySelector("#objective-select")?.value || "";
      const subRows = canManageChildren
        ? Array.from(m.querySelectorAll('[data-subconsigne]'))
        : [];
      if (canManageChildren && subRows.some((row) => !(row.querySelector('input[name="sub-text"]')?.value || "").trim())) {
        alert("Renseigne le texte de chaque sous-consigne ou supprime celles qui sont vides.");
        return;
      }
      let consigneId = consigne?.id || null;
      if (consigne) {
        await Schema.updateConsigne(ctx.db, ctx.user.uid, consigne.id, payload);
        consigneId = consigne.id;
      } else {
        const ref = await Schema.addConsigne(ctx.db, ctx.user.uid, payload);
        consigneId = ref?.id || consigneId;
      }
      if (consigneId) {
        await Schema.linkConsigneToObjective(ctx.db, ctx.user.uid, consigneId, selectedObjective || null);
        if (canManageChildren) {
          const childPayloadBase = {
            ownerUid: ctx.user.uid,
            mode,
            category: payload.category,
            priority: payload.priority,
            srEnabled: payload.srEnabled,
            active: true,
            parentId: consigneId,
          };
          const childDays = mode === "daily" ? payload.days || [] : undefined;
          const updates = [];
          if (subRows.length) {
            subRows.forEach((row) => {
              const textInput = row.querySelector('input[name="sub-text"]');
              const typeSelect = row.querySelector('select[name="sub-type"]');
              if (!textInput || !typeSelect) return;
              const textValue = textInput.value.trim();
              const typeValue = typeSelect.value;
              const childId = row.dataset.id || null;
              const childPayload = {
                ...childPayloadBase,
                text: textValue,
                type: typeValue,
              };
              if (mode === "daily") {
                childPayload.days = Array.isArray(childDays) ? [...childDays] : [];
              }
              if (childId) {
                updates.push(
                  Schema.updateConsigne(ctx.db, ctx.user.uid, childId, childPayload).then(() =>
                    Schema.linkConsigneToObjective(ctx.db, ctx.user.uid, childId, selectedObjective || null)
                  )
                );
              } else {
                updates.push(
                  Schema.addConsigne(ctx.db, ctx.user.uid, childPayload).then((ref) => {
                    const newId = ref?.id;
                    if (newId) {
                      return Schema.linkConsigneToObjective(ctx.db, ctx.user.uid, newId, selectedObjective || null);
                    }
                    return null;
                  })
                );
              }
            });
          }
          removedChildIds.forEach((childId) => {
            updates.push(Schema.softDeleteConsigne(ctx.db, ctx.user.uid, childId));
          });
          if (updates.length) {
            await Promise.all(updates);
          }
        }
      }
      m.remove();
      const root = document.getElementById("view-root");
      if (mode === "practice") renderPractice(ctx, root);
      else renderDaily(ctx, root);
    } finally {
      modesLogger.groupEnd();
    }
  };
}

function dotColor(type, v){
  if (type === "info") {
    return "na";
  }
  if (type === "likert6") {
    const map = { yes:"ok", rather_yes:"ok", medium:"mid", rather_no:"ko", no:"ko", no_answer:"na" };
    return map[v] || "na";
  }
  if (type === "likert5") {
    const n = Number(v);
    return n >= 3 ? "ok" : n === 2 ? "mid" : "ko";
  }
  if (type === "yesno") {
    return v === "yes" ? "ok" : "ko";
  }
  if (type === "num") {
    const n = Number(v) || 0;
    return n >= 7 ? "ok" : n >= 4 ? "mid" : "ko";
  }
  return "na";
}

async function openHistory(ctx, consigne) {
  modesLogger.group("ui.history.open", { consigneId: consigne.id, type: consigne.type });
  const qy = modesFirestore.query(
    modesFirestore.collection(ctx.db, `u/${ctx.user.uid}/responses`),
    modesFirestore.where("consigneId", "==", consigne.id),
    modesFirestore.orderBy("createdAt", "desc"),
    modesFirestore.limit(60)
  );
  const ss = await modesFirestore.getDocs(qy);
  modesLogger.info("ui.history.rows", ss.size);
  const rows = ss.docs.map((d) => ({ id: d.id, ...d.data() }));

  const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const statusLabels = {
    ok: "Positive",
    mid: "Intermédiaire",
    ko: "À surveiller",
    na: "Sans donnée",
  };

  function relativeLabel(date) {
    if (!date || Number.isNaN(date.getTime())) return "";
    const today = new Date();
    const diffDays = Math.round((today.getTime() - date.getTime()) / 86400000);
    if (diffDays <= 0) return "Aujourd’hui";
    if (diffDays === 1) return "Hier";
    if (diffDays < 7) return `Il y a ${diffDays} j`;
    return "";
  }

  const list = rows
    .map((r) => {
      const createdAtRaw = r.createdAt?.toDate?.() ?? r.createdAt;
      const createdAt = createdAtRaw ? new Date(createdAtRaw) : null;
      const iso = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString() : "";
      const dateText = createdAt && !Number.isNaN(createdAt.getTime()) ? dateFormatter.format(createdAt) : "Date inconnue";
      const relative = createdAt ? relativeLabel(createdAt) : "";
      const formatted = formatValue(consigne.type, r.value);
      const status = dotColor(consigne.type, r.value);
      const note = r.note && String(r.note).trim();
      const noteMarkup = note ? `<p class="history-panel__note">${escapeHtml(note)}</p>` : "";
      const relativeMarkup = relative ? `<span class="history-panel__meta">${escapeHtml(relative)}</span>` : "";
      const statusLabel = statusLabels[status] || "Valeur";
      return `
        <li class="history-panel__item">
          <div class="history-panel__item-row">
            <span class="history-panel__value">
              <span class="history-panel__dot history-panel__dot--${status}" aria-hidden="true"></span>
              <span>${escapeHtml(formatted)}</span>
              <span class="sr-only">${escapeHtml(statusLabel)}</span>
            </span>
            <time class="history-panel__date" datetime="${escapeHtml(iso)}">${escapeHtml(dateText)}</time>
          </div>
          ${relativeMarkup ? `<div class="history-panel__meta-row">${relativeMarkup}</div>` : ""}
          ${noteMarkup}
        </li>
      `;
    })
    .join("");

  const totalLabel = rows.length === 0 ? "Aucune entrée" : rows.length === 1 ? "1 entrée" : `${rows.length} entrées`;

  const html = `
    <div class="history-panel">
      <header class="history-panel__header">
        <div class="history-panel__title">
          <h3 class="history-panel__heading">Historique — ${escapeHtml(consigne.text)}</h3>
          <p class="history-panel__subtitle">Dernières réponses enregistrées</p>
        </div>
        <div class="history-panel__actions">
          <span class="history-panel__badge">${escapeHtml(totalLabel)}</span>
          <button class="btn btn-ghost text-sm" data-close>Fermer</button>
        </div>
      </header>
      <div class="history-panel__body">
        <ul class="history-panel__list">${list || '<li class="history-panel__empty">Aucune réponse pour l’instant.</li>'}</ul>
      </div>
    </div>
  `;
  const panel = drawer(html);
  panel.querySelector('[data-close]')?.addEventListener('click', () => panel.remove());

  modesLogger.groupEnd();

  function formatValue(type, v) {
    if (type === 'info') return '';
    if (type === 'yesno') return v === 'yes' ? 'Oui' : 'Non';
    if (type === 'likert5') return String(v ?? '—');
    if (type === 'likert6') {
      return (
        {
          no: 'Non',
          rather_no: 'Plutôt non',
          medium: 'Neutre',
          rather_yes: 'Plutôt oui',
          yes: 'Oui',
          no_answer: 'Pas de réponse'
        }[v] || v || '—'
      );
    }
    return String(v ?? '—');
  }
}

async function renderPractice(ctx, root, _opts = {}) {
  modesLogger.group("screen.practice.render", { hash: ctx.route });
  root.innerHTML = "";
  const container = document.createElement("div");
  container.className = "space-y-4";
  container.classList.add("w-full", "max-w-4xl", "mx-auto");
  root.appendChild(container);

  const currentHash = ctx.route || window.location.hash || "#/practice";
  const cats = (await Schema.fetchCategories(ctx.db, ctx.user.uid)).filter((c) => c.mode === "practice");
  const qp  = new URLSearchParams(currentHash.split("?")[1] || "");
  let currentCat = qp.get("cat") || (cats[0]?.name || "");

  if (!currentCat && cats.length) {
    const base = (ctx.route || "#/practice").split("?")[0];
    navigate(`${toAppPath(base)}?cat=${encodeURIComponent(cats[0].name)}`);
    return;
  }

  if (currentCat && cats.length && !cats.some((c) => c.name === currentCat)) {
    const base = (ctx.route || "#/practice").split("?")[0];
    navigate(`${toAppPath(base)}?cat=${encodeURIComponent(cats[0].name)}`);
    return;
  }

  const catOptions = cats
    .map(
      (c) =>
        `<option value="${escapeHtml(c.name)}" ${c.name === currentCat ? "selected" : ""}>${escapeHtml(c.name)}</option>`
    )
    .join("");

  const autosaveDayKey = typeof Schema.todayKey === "function"
    ? Schema.todayKey()
    : new Date().toISOString().slice(0, 10);
  const practiceFormAutosaveKey = [
    "practice-session",
    ctx.user?.uid || "anon",
    currentCat || "all",
    autosaveDayKey || "today",
  ].map((part) => String(part)).join(":");

  const card = document.createElement("section");
  card.className = "card space-y-4 p-3 sm:p-4";
  card.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <label class="text-sm text-[var(--muted)]" for="practice-cat">Catégorie</label>
        <select id="practice-cat" class="min-w-[160px]">${catOptions}</select>
      </div>
      <div class="flex items-center gap-2">
        ${smallBtn("📊 Tableau de bord", "js-dashboard")}
        ${smallBtn("+ Nouvelle consigne", "js-new")}
      </div>
    </div>
    <form id="practice-form" class="grid gap-3" data-autosave-key="${escapeHtml(practiceFormAutosaveKey)}"></form>
    <div class="flex justify-end">
      <button class="btn btn-primary" type="button" id="save">Enregistrer</button>
    </div>
  `;
  container.appendChild(card);

  const selector = card.querySelector("#practice-cat");
  if (selector) {
    selector.disabled = !cats.length;
    selector.onchange = (e) => {
      const value = e.target.value;
      const base = currentHash.split("?")[0];
      navigate(`${toAppPath(base)}?cat=${encodeURIComponent(value)}`);
    };
  }
  card.querySelector(".js-new").onclick = () => openConsigneForm(ctx, null);
  const dashBtn = card.querySelector(".js-dashboard");
  if (dashBtn) {
    const hasCategory = Boolean(currentCat);
    dashBtn.disabled = !hasCategory;
    dashBtn.classList.toggle("opacity-50", !hasCategory);
    dashBtn.onclick = () => {
      if (!currentCat) return;
      window.openCategoryDashboard(ctx, currentCat);
    };
  }

  const all = await Schema.fetchConsignes(ctx.db, ctx.user.uid, "practice");
  const consignes = all.filter((c) => (c.category || "") === currentCat);
  modesLogger.info("screen.practice.consignes", consignes.length);

  const orderSorted = consignes.slice().sort((a, b) => {
    const orderA = Number(a.order || 0);
    const orderB = Number(b.order || 0);
    if (orderA !== orderB) return orderA - orderB;
    const prioA = Number(a.priority || 0);
    const prioB = Number(b.priority || 0);
    if (prioA !== prioB) return prioA - prioB;
    return (a.text || a.titre || "").localeCompare(b.text || b.titre || "");
  });

  const sessionIndex = await Schema.countPracticeSessions(ctx.db, ctx.user.uid);
  const visible = [];
  const hidden = [];
  for (const c of orderSorted) {
    if (c.srEnabled === false) {
      visible.push(c);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const st = await Schema.readSRState(ctx.db, ctx.user.uid, c.id, "consigne");
    if (!st || st.nextAllowedIndex === undefined || st.nextAllowedIndex <= sessionIndex) {
      visible.push(c);
    } else {
      hidden.push({ c, remaining: st.nextAllowedIndex - sessionIndex });
    }
  }

  const form = card.querySelector("#practice-form");
  if (!visible.length) {
    form.innerHTML = `<div class="rounded-xl border border-dashed border-gray-200 bg-white p-3 text-sm text-[var(--muted)]">Aucune consigne visible pour cette itération.</div>`;
  } else {
    form.innerHTML = "";

    const makeItem = (c, { isChild = false } = {}) => {
      const priority = prioChip(Number(c.priority) || 2);
      const tone = priority.tone;
      const el = document.createElement("div");
      el.className = `consigne-card consigne-card--stacked priority-surface priority-surface-${tone}`;
      el.dataset.id = c.id;
      if (isChild) {
        el.classList.add("consigne-card--child");
        if (c.parentId) {
          el.dataset.parentId = c.parentId;
        } else {
          delete el.dataset.parentId;
        }
        el.draggable = false;
      } else {
        el.classList.add("consigne-card--parent", "consigne-card--compact");
        delete el.dataset.parentId;
        el.draggable = true;
      }
      el.innerHTML = `
        <div class="consigne-card__header">
          <div class="consigne-card__header-row">
            <button type="button" class="consigne-card__toggle" data-consigne-toggle aria-expanded="false">
              <span class="consigne-card__title">
                <span class="consigne-card__title-text">
                  <span class="consigne-card__title-label">${escapeHtml(c.text)}</span>
                </span>
              </span>
              ${priority.accessible}
            </button>
            ${consigneActions({ includeSR: true, consigne: c })}
          </div>
        </div>
      `;

      const fieldState = createConsigneFieldStore(c);
      if (fieldState.container.childNodes.length) {
        el.appendChild(fieldState.container);
      }
      consigneFieldStates.set(el, fieldState);
      if (fieldState.field) {
        fieldState.field.addEventListener("input", () => updateConsigneValueDisplay(el));
        fieldState.field.addEventListener("change", () => updateConsigneValueDisplay(el));
      }
      updateConsigneValueDisplay(el);

      initializeCollapsibleCard(el);
      const menu = setupContextMenu(el.querySelector("[data-menu-root]"));
      const attachAction = (selector, handler) => {
        const btn = el.querySelector(selector);
        if (!btn) return;
        preventDragConflicts(btn);
        btn.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          menu.close();
          await handler();
        });
      };

      attachAction("[data-menu-action='history']", () => {
        Schema.D.info("ui.history.click", c.id);
        openHistory(ctx, c);
      });
      attachAction("[data-menu-action='edit']", () => {
        Schema.D.info("ui.editConsigne.click", c.id);
        openConsigneForm(ctx, c);
      });
      attachAction("[data-menu-action='delete']", async () => {
        if (confirm("Supprimer cette consigne ? (historique conservé)")) {
          Schema.D.info("ui.deleteConsigne.confirm", c.id);
          await Schema.softDeleteConsigne(ctx.db, ctx.user.uid, c.id);
          renderPractice(ctx, root);
        }
      });

      const delayBtn = el.querySelector("[data-menu-action='delay']");
      const updateDelayState = (enabled) => {
        if (!delayBtn) return;
        delayBtn.disabled = !enabled;
        delayBtn.classList.toggle("is-disabled", !enabled);
        delayBtn.title = enabled
          ? "Décaler la prochaine itération"
          : "Active la répétition espacée pour décaler";
      };
      if (delayBtn) {
        preventDragConflicts(delayBtn);
        updateDelayState(c?.srEnabled !== false);
        delayBtn.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (delayBtn.disabled) {
            menu.close();
            showToast("Active la répétition espacée pour utiliser le décalage.");
            return;
          }
          menu.close();
          const raw = prompt("Décaler de combien d'itérations ?", "1");
          if (raw === null) {
            return;
          }
          const value = Number(String(raw).replace(",", "."));
          const rounded = Math.round(value);
          if (!Number.isFinite(value) || !Number.isFinite(rounded) || rounded < 1) {
            showToast("Entre un entier positif.");
            return;
          }
          const amount = rounded;
          delayBtn.disabled = true;
          try {
            await Schema.delayConsigne({
              db: ctx.db,
              uid: ctx.user.uid,
              consigne: c,
              mode: "practice",
              amount,
              sessionIndex,
            });
            showToast(`Consigne décalée de ${amount} itération${amount > 1 ? "s" : ""}.`);
            renderPractice(ctx, root);
          } catch (err) {
            console.error(err);
            showToast("Impossible de décaler la consigne.");
            updateDelayState(c?.srEnabled !== false);
          } finally {
            updateDelayState(c?.srEnabled !== false);
          }
        });
      }

      const srT = el.querySelector(".js-sr-toggle");
      if (srT) srT.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const on = srT.getAttribute("data-enabled") === "1";
        await Schema.updateConsigne(ctx.db, ctx.user.uid, c.id, { srEnabled: !on });
        c.srEnabled = !on;
        srT.setAttribute("data-enabled", on ? "0" : "1");
        srT.setAttribute("aria-pressed", (!on).toString());
        const visualLabel = (!on) ? srT.dataset.labelOn : srT.dataset.labelOff;
        const a11yLabel = (!on) ? srT.dataset.a11yOn : srT.dataset.a11yOff;
        const visualSlot = srT.querySelector("[data-sr-visual]");
        if (visualSlot) visualSlot.textContent = visualLabel;
        const labelSlot = srT.querySelector("[data-sr-label]");
        if (labelSlot) labelSlot.textContent = a11yLabel;
        srT.title = a11yLabel;
        srT.setAttribute("aria-label", a11yLabel);
        menu.close();
        updateDelayState(c?.srEnabled !== false);
      };

      enhanceLikertStatus(el);

      return el;
    };

    const grouped = groupConsignes(visible);
    const renderGroup = (group, target) => {
      const wrapper = document.createElement("div");
      wrapper.className = "consigne-group";
      const parentCard = makeItem(group.consigne, { isChild: false });
      if (group.children.length) {
        parentCard.classList.add("consigne-card--has-children");
        const existingContainer = parentCard.querySelector(".consigne-card__children");
        const isDetailsElement =
          typeof HTMLDetailsElement !== "undefined" && existingContainer instanceof HTMLDetailsElement;
        const childrenContainer = isDetailsElement
          ? existingContainer
          : document.createElement("details");
        childrenContainer.className = "consigne-card__children";
        childrenContainer.removeAttribute("open");
        if (!existingContainer) {
          parentCard.appendChild(childrenContainer);
        } else {
          childrenContainer.innerHTML = "";
        }
        const label = document.createElement("summary");
        label.className = "consigne-card__children-label";
        label.textContent = group.children.length > 1
          ? `Sous-consignes (${group.children.length})`
          : "Sous-consigne (1)";
        const list = document.createElement("div");
        list.className = "consigne-card__children-list";
        group.children.forEach((child) => {
          const childCard = makeItem(child, { isChild: true });
          list.appendChild(childCard);
        });
        childrenContainer.appendChild(label);
        childrenContainer.appendChild(list);
      }
      wrapper.appendChild(parentCard);
      target.appendChild(wrapper);
    };

    const highs = grouped.filter((group) => (group.consigne.priority || 2) <= 2);
    const lows = grouped.filter((group) => (group.consigne.priority || 2) >= 3);

    highs.forEach((group) => renderGroup(group, form));

    if (lows.length) {
      const lowDetails = document.createElement("details");
      lowDetails.className = "daily-category__low";
      const lowCount = lows.reduce((acc, group) => acc + 1 + group.children.length, 0);
      lowDetails.innerHTML = `<summary class="daily-category__low-summary">Priorité basse (${lowCount})</summary>`;
      const lowStack = document.createElement("div");
      lowStack.className = "daily-category__items daily-category__items--nested";
      lows.forEach((group) => renderGroup(group, lowStack));
      lowDetails.appendChild(lowStack);
      form.appendChild(lowDetails);
    }

    if (typeof window.attachConsignesDragDrop === "function") {
      window.attachConsignesDragDrop(form, ctx);
    }
  }

  if (hidden.length) {
    const box = document.createElement("div");
    box.className = "card p-3 space-y-2";
    box.innerHTML = `<div class="font-medium">Masquées par répétition espacée (${hidden.length})</div>
  <ul class="text-sm text-[var(--muted)] space-y-1">
    ${hidden.map(h => `
      <li class="flex items-center justify-between gap-2">
        <span><span class="font-medium text-slate-600">${escapeHtml(h.c.text)}</span> — revient dans ${h.remaining} itération(s)</span>
        <span class="flex items-center gap-1">
          <button type="button" class="btn btn-ghost text-xs js-histo-hidden" data-id="${h.c.id}">Historique</button>
          <button type="button" class="btn btn-ghost text-xs js-reset-sr" data-id="${h.c.id}">Réinitialiser</button>
        </span>
      </li>`).join("")}
  </ul>`;
    container.appendChild(box);

    box.addEventListener("click", async (e) => {
      const id = e.target?.dataset?.id;
      if (!id) return;
      if (e.target.classList.contains("js-histo-hidden")) {
        const c = hidden.find((x) => x.c.id === id)?.c;
        if (c) openHistory(ctx, c);
      } else if (e.target.classList.contains("js-reset-sr")) {
        await Schema.resetSRForConsigne(ctx.db, ctx.user.uid, id);
        renderPractice(ctx, root);
      }
    });
  }

  const saveBtn = card.querySelector("#save");
  saveBtn.onclick = async (e) => {
    e.preventDefault();
    const answers = collectAnswers(form, visible);
    const sessionNumber = sessionIndex + 1;
    const sessionId = `session-${String(sessionNumber).padStart(4, "0")}`;
    answers.forEach((ans) => {
      ans.sessionIndex = sessionIndex;
      ans.sessionNumber = sessionNumber;
      ans.sessionId = sessionId;
    });

    saveBtn.disabled = true;
    saveBtn.textContent = "Enregistrement…";

    try {
      if (answers.length) {
        await Schema.saveResponses(ctx.db, ctx.user.uid, "practice", answers);
      }
      await Schema.startNewPracticeSession(ctx.db, ctx.user.uid, {
        sessionId,
        index: sessionNumber,
        sessionIndex,
      });

      if (form && window.formAutosave?.clear) {
        window.formAutosave.clear(form);
      }

      $$("input[type=text],textarea", form).forEach((input) => (input.value = ""));
      $$("input[type=range]", form).forEach((input) => {
        input.value = 5;
        input.dispatchEvent(new Event("input"));
      });
      $$("select", form).forEach((input) => {
        input.selectedIndex = 0;
      });
      $$("input[type=radio]", form).forEach((input) => (input.checked = false));

      showToast(answers.length ? "Itération enregistrée" : "Itération passée");
      saveBtn.classList.add("btn-saved");
      saveBtn.textContent = "✓ Enregistré";
      setTimeout(() => {
        saveBtn.classList.remove("btn-saved");
        saveBtn.textContent = "Enregistrer";
        saveBtn.disabled = false;
      }, 900);

      renderPractice(ctx, root);
    } catch (err) {
      console.error(err);
      saveBtn.disabled = false;
      saveBtn.textContent = "Enregistrer";
    }
  };
  modesLogger.groupEnd();
}

const DOW = ["DIM","LUN","MAR","MER","JEU","VEN","SAM"];
const DAILY_WEEKDAY_FORMATTER = new Intl.DateTimeFormat("fr-FR", { weekday: "long" });
const DAILY_DATE_FORMATTER = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" });
function formatDailyNavLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const weekday = DAILY_WEEKDAY_FORMATTER.format(date) || "";
  const digits = DAILY_DATE_FORMATTER.format(date) || "";
  const capitalized = weekday ? `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}` : "";
  return [capitalized, digits].filter(Boolean).join(" ");
}
function dateForDayFromToday(label){
  const target = DOW.indexOf(label);
  const today = new Date(); today.setHours(0,0,0,0);
  if (target < 0) return today;
  const cur = today.getDay(); // 0..6 (DIM=0)
  const delta = (target - cur + 7) % 7;
  const d = new Date(today);
  d.setDate(d.getDate() + delta);
  return d;
}
function daysBetween(a,b){
  const ms = (b.setHours(0,0,0,0), a.setHours(0,0,0,0), (b-a));
  return Math.max(0, Math.round(ms/86400000));
}

async function renderDaily(ctx, root, opts = {}) {
  root.innerHTML = "";
  const container = document.createElement("div");
  container.className = "space-y-4";
  container.classList.add("w-full", "max-w-4xl", "mx-auto");
  root.appendChild(container);

  const currentHash = ctx.route || window.location.hash || "#/daily";
  const qp = new URLSearchParams(currentHash.split("?")[1] || "");
  const jours = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"];
  const todayIdx = (new Date().getDay() + 6) % 7;
  const dateIso = opts.dateIso || qp.get("d");
  let explicitDate = null;
  if (dateIso) {
    const parsed = new Date(dateIso);
    if (!Number.isNaN(parsed.getTime())) {
      parsed.setHours(0, 0, 0, 0);
      explicitDate = parsed;
    }
  }
  const isoDay = explicitDate ? DOW[explicitDate.getDay()] : null;
  const requested = normalizeDay(opts.day) || normalizeDay(qp.get("day")) || isoDay;
  const currentDay = requested || jours[todayIdx];
  modesLogger.group("screen.daily.render", { hash: ctx.route, day: currentDay, date: explicitDate?.toISOString?.() });

  const selectedDate = explicitDate ? new Date(explicitDate) : dateForDayFromToday(currentDay);
  selectedDate.setHours(0, 0, 0, 0);
  const selectedKey = Schema.dayKeyFromDate(selectedDate);
  const navLabel = formatDailyNavLabel(selectedDate) || selectedKey;
  const isTodaySelected = Schema.todayKey() === selectedKey;

  const card = document.createElement("section");
  card.className = "card space-y-4 p-3 sm:p-4";
  card.innerHTML = `
    <div class="flex flex-wrap items-center gap-2">
      <div class="day-nav" data-day-nav>
        <button type="button" class="day-nav-btn" data-dir="prev" aria-label="Jour précédent">
          <span aria-hidden="true">←</span>
        </button>
        <div class="day-nav-label">
          <span>${escapeHtml(navLabel)}</span>
          ${isTodaySelected ? '<span class="day-nav-today">Aujourd\u2019hui</span>' : ""}
        </div>
        <button type="button" class="day-nav-btn" data-dir="next" aria-label="Jour suivant">
          <span aria-hidden="true">→</span>
        </button>
      </div>
      <div class="daily-header-actions flex items-center gap-2">${smallBtn("📊 Tableau de bord", "js-dashboard")}${smallBtn("+ Nouvelle consigne", "js-new")}</div>
    </div>
  `;
  container.appendChild(card);

  const navContainer = card.querySelector("[data-day-nav]");
  if (navContainer) {
    const basePath = toAppPath((currentHash.split("?")[0]) || "#/daily");
    const goTo = (delta) => {
      const target = new Date(selectedDate);
      target.setDate(target.getDate() + delta);
      const params = new URLSearchParams(qp);
      params.set("d", Schema.dayKeyFromDate(target));
      params.delete("day");
      const search = params.toString();
      navigate(`${basePath}${search ? `?${search}` : ""}`);
    };
    const prevBtn = navContainer.querySelector('[data-dir="prev"]');
    const nextBtn = navContainer.querySelector('[data-dir="next"]');
    if (prevBtn) prevBtn.onclick = () => goTo(-1);
    if (nextBtn) nextBtn.onclick = () => goTo(1);
  }
  card.querySelector(".js-new").onclick = () => openConsigneForm(ctx, null);
  const dashBtn = card.querySelector(".js-dashboard");
  if (dashBtn) {
    dashBtn.onclick = () => {
      window.openCategoryDashboard(ctx, "", { mode: "daily" });
    };
  }

  const all = await Schema.fetchConsignes(ctx.db, ctx.user.uid, "daily");
  const consignes = all.filter((c) => !c.days?.length || c.days.includes(currentDay));
  modesLogger.info("screen.daily.consignes", consignes.length);

  const dayKey = selectedKey;
  const visible = [];
  const hidden = [];
  await Promise.all(consignes.map(async (c) => {
    if (c.srEnabled === false) { visible.push(c); return; }
    // eslint-disable-next-line no-await-in-loop
    const st = await Schema.readSRState(ctx.db, ctx.user.uid, c.id, "consigne");
    const nextISO = st?.nextVisibleOn || st?.hideUntil;
    if (!nextISO) { visible.push(c); return; }
    const next = new Date(nextISO);
    if (next <= selectedDate) visible.push(c);
    else hidden.push({ c, daysLeft: daysBetween(new Date(), next), when: next });
  }));

  const orderIndex = new Map(visible.map((c, idx) => [c.id, idx]));
  const catGroups = new Map();
  visible.forEach((consigne) => {
    const cat = consigne.category || "Général";
    const list = catGroups.get(cat) || [];
    list.push(consigne);
    catGroups.set(cat, list);
  });
  const categoryGroups = Array.from(catGroups.entries()).map(([cat, list]) => {
    const sorted = list.slice().sort((a, b) => {
      const idxA = orderIndex.get(a.id) ?? 0;
      const idxB = orderIndex.get(b.id) ?? 0;
      if (idxA !== idxB) return idxA - idxB;
      const prioDiff = (a.priority || 2) - (b.priority || 2);
      if (prioDiff !== 0) return prioDiff;
      return (a.text || "").localeCompare(b.text || "");
    });
    const groups = groupConsignes(sorted);
    const total = groups.reduce((acc, group) => acc + 1 + group.children.length, 0);
    return [cat, { groups, total }];
  });

  const previousAnswers = await Schema.fetchDailyResponses(ctx.db, ctx.user.uid, dayKey);

  const renderItemCard = (item, { isChild = false } = {}) => {
    const previous = previousAnswers?.get(item.id);
    const priority = prioChip(Number(item.priority) || 2);
    const itemCard = document.createElement("div");
    const tone = priority.tone;
    itemCard.className = `consigne-card consigne-card--stacked priority-surface priority-surface-${tone}`;
    if (isChild) {
      itemCard.classList.add("consigne-card--child");
      if (item.parentId) {
        itemCard.dataset.parentId = item.parentId;
      } else {
        delete itemCard.dataset.parentId;
      }
    } else {
      itemCard.classList.add("consigne-card--parent", "consigne-card--compact");
      delete itemCard.dataset.parentId;
    }
    itemCard.innerHTML = `
      <div class="consigne-card__header">
        <div class="consigne-card__header-row">
          <button type="button" class="consigne-card__toggle" data-consigne-toggle aria-expanded="false">
            <span class="consigne-card__title">
              <span class="consigne-card__title-text">
                <span class="consigne-card__title-label">${escapeHtml(item.text)}</span>
              </span>
            </span>
            ${priority.accessible}
          </button>
          ${consigneActions({ includeSR: true, consigne: item })}
        </div>
      </div>
    `;

    const fieldState = createConsigneFieldStore(item, previous?.value ?? null);
    if (fieldState.container.childNodes.length) {
      itemCard.appendChild(fieldState.container);
    }
    consigneFieldStates.set(itemCard, fieldState);
    if (fieldState.field) {
      fieldState.field.addEventListener("input", () => updateConsigneValueDisplay(itemCard));
      fieldState.field.addEventListener("change", () => updateConsigneValueDisplay(itemCard));
    }
    updateConsigneValueDisplay(itemCard);

    initializeCollapsibleCard(itemCard);
    const menu = setupContextMenu(itemCard.querySelector("[data-menu-root]"));
    const attachAction = (selector, handler) => {
      const btn = itemCard.querySelector(selector);
      if (!btn) return;
      preventDragConflicts(btn);
      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        menu.close();
        await handler();
      });
    };

    attachAction("[data-menu-action='history']", () => {
      Schema.D.info("ui.history.click", item.id);
      openHistory(ctx, item);
    });
    attachAction("[data-menu-action='edit']", () => {
      Schema.D.info("ui.editConsigne.click", item.id);
      openConsigneForm(ctx, item);
    });
    attachAction("[data-menu-action='delete']", async () => {
      if (confirm("Supprimer cette consigne ? (historique conservé)")) {
        Schema.D.info("ui.deleteConsigne.confirm", item.id);
        await Schema.softDeleteConsigne(ctx.db, ctx.user.uid, item.id);
        renderDaily(ctx, root, { ...opts, day: currentDay, dateIso });
      }
    });

    const delayBtn = itemCard.querySelector("[data-menu-action='delay']");
    const updateDelayState = (enabled) => {
      if (!delayBtn) return;
      delayBtn.disabled = !enabled;
      delayBtn.classList.toggle("is-disabled", !enabled);
      delayBtn.title = enabled
        ? "Décaler la prochaine apparition"
        : "Active la répétition espacée pour décaler";
    };
    if (delayBtn) {
      preventDragConflicts(delayBtn);
      updateDelayState(item?.srEnabled !== false);
      delayBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (delayBtn.disabled) {
          menu.close();
          showToast("Active la répétition espacée pour utiliser le décalage.");
          return;
        }
        menu.close();
        const raw = prompt("Décaler de combien de jours ?", "1");
        if (raw === null) {
          return;
        }
        const value = Number(String(raw).replace(",", "."));
        const rounded = Math.round(value);
        if (!Number.isFinite(value) || !Number.isFinite(rounded) || rounded < 1) {
          showToast("Entre un entier positif.");
          return;
        }
        const amount = rounded;
        delayBtn.disabled = true;
        try {
          await Schema.delayConsigne({
            db: ctx.db,
            uid: ctx.user.uid,
            consigne: item,
            mode: "daily",
            amount,
          });
          showToast(`Consigne décalée de ${amount} jour${amount > 1 ? "s" : ""}.`);
          renderDaily(ctx, root, { ...opts, day: currentDay, dateIso });
        } catch (err) {
          console.error(err);
          showToast("Impossible de décaler la consigne.");
        } finally {
          updateDelayState(item?.srEnabled !== false);
        }
      });
    }
    const srT = itemCard.querySelector(".js-sr-toggle");
    if (srT) srT.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const on = srT.getAttribute("data-enabled") === "1";
      await Schema.updateConsigne(ctx.db, ctx.user.uid, item.id, { srEnabled: !on });
      item.srEnabled = !on;
      srT.setAttribute("data-enabled", on ? "0" : "1");
      srT.setAttribute("aria-pressed", (!on).toString());
      const visualLabel = (!on) ? srT.dataset.labelOn : srT.dataset.labelOff;
      const a11yLabel = (!on) ? srT.dataset.a11yOn : srT.dataset.a11yOff;
      const visualSlot = srT.querySelector("[data-sr-visual]");
      if (visualSlot) visualSlot.textContent = visualLabel;
      const labelSlot = srT.querySelector("[data-sr-label]");
      if (labelSlot) labelSlot.textContent = a11yLabel;
      srT.title = a11yLabel;
      srT.setAttribute("aria-label", a11yLabel);
      menu.close();
      updateDelayState(item.srEnabled !== false);
    };

    enhanceLikertStatus(itemCard);

    return itemCard;
  };

  const renderGroup = (group, target) => {
    const wrapper = document.createElement("div");
    wrapper.className = "consigne-group";
    const parentCard = renderItemCard(group.consigne, { isChild: false });
    if (group.children.length) {
      parentCard.classList.add("consigne-card--has-children");
      const existingChildren = parentCard.querySelector(".consigne-card__children");
      const hasDetailsElement =
        typeof HTMLDetailsElement !== "undefined" && existingChildren instanceof HTMLDetailsElement;
      const childrenContainer = hasDetailsElement
        ? existingChildren
        : document.createElement("details");
      childrenContainer.className = "consigne-card__children";
      childrenContainer.removeAttribute("open");
      if (!existingChildren) {
        parentCard.appendChild(childrenContainer);
      } else {
        childrenContainer.innerHTML = "";
      }
      const label = document.createElement("summary");
      label.className = "consigne-card__children-label";
      label.textContent = group.children.length > 1
        ? `Sous-consignes (${group.children.length})`
        : "Sous-consigne (1)";
      const list = document.createElement("div");
      list.className = "consigne-card__children-list";
      group.children.forEach((child) => {
        const childCard = renderItemCard(child, { isChild: true });
        list.appendChild(childCard);
      });
      childrenContainer.appendChild(label);
      childrenContainer.appendChild(list);
    }
    wrapper.appendChild(parentCard);
    target.appendChild(wrapper);
  };

  const form = document.createElement("form");
  form.className = "daily-grid";
  card.appendChild(form);

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "rounded-xl border border-dashed border-gray-200 bg-white p-3 text-sm text-[var(--muted)] daily-grid__item";
    empty.innerText = "Aucune consigne visible pour ce jour.";
    form.appendChild(empty);
  } else {
    categoryGroups.forEach(([cat, info]) => {
      const { groups, total } = info;
      const section = document.createElement("section");
      section.className = "daily-category daily-grid__item";
      section.innerHTML = `
        <div class="daily-category__header">
          <div class="daily-category__name">${escapeHtml(cat)}</div>
          <span class="daily-category__count">${total} consigne${total > 1 ? "s" : ""}</span>
        </div>`;
      const stack = document.createElement("div");
      stack.className = "daily-category__items";
      section.appendChild(stack);

      const highs = groups.filter((g) => (g.consigne.priority || 2) <= 2);
      const lows = groups.filter((g) => (g.consigne.priority || 2) >= 3);

      highs.forEach((group) => renderGroup(group, stack));

      if (lows.length) {
        const det = document.createElement("details");
        det.className = "daily-category__low";
        const lowCount = lows.reduce((acc, group) => acc + 1 + group.children.length, 0);
        det.innerHTML = `<summary class="daily-category__low-summary">Priorité basse (${lowCount})</summary>`;
        const box = document.createElement("div");
        box.className = "daily-category__items daily-category__items--nested";
        lows.forEach((group) => renderGroup(group, box));
        det.appendChild(box);
        stack.appendChild(det);
      }

      form.appendChild(section);
    });
  }

  if (hidden.length) {
    const box = document.createElement("div");
    box.className = "card p-3 space-y-2";
    box.innerHTML = `<div class="font-medium">Masquées par répétition espacée (${hidden.length})</div>
  <ul class="text-sm text-[var(--muted)] space-y-1">
    ${hidden.map(h => `
      <li class="flex items-center justify-between gap-2">
        <span><span class="font-medium text-slate-600">${escapeHtml(h.c.text)}</span> — revient dans ${h.daysLeft} jour(s) (le ${h.when.toLocaleDateString()})</span>
        <span class="flex items-center gap-1">
          <button type="button" class="btn btn-ghost text-xs js-histo-hidden" data-id="${h.c.id}">Historique</button>
          <button type="button" class="btn btn-ghost text-xs js-reset-sr" data-id="${h.c.id}">Réinitialiser</button>
        </span>
      </li>`).join("")}
  </ul>`;
    container.appendChild(box);

    box.addEventListener("click", async (e) => {
      const id = e.target?.dataset?.id;
      if (!id) return;
      if (e.target.classList.contains("js-histo-hidden")) {
        const c = hidden.find((x) => x.c.id === id)?.c;
        if (c) openHistory(ctx, c);
      } else if (e.target.classList.contains("js-reset-sr")) {
        await Schema.resetSRForConsigne(ctx.db, ctx.user.uid, id);
        renderDaily(ctx, root, { day: currentDay });
      }
    });
  }

  const actions = document.createElement("div");
  actions.className = "flex justify-end daily-grid__item daily-grid__actions";
  actions.innerHTML = `<button type="submit" class="btn btn-primary">Enregistrer</button>`;
  form.appendChild(actions);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const answers = collectAnswers(form, visible, { dayKey });
    if (!answers.length) {
      alert("Aucune réponse");
      return;
    }
    await Schema.saveResponses(ctx.db, ctx.user.uid, "daily", answers);
    if (window.__appBadge && typeof window.__appBadge.refresh === "function") {
      window.__appBadge.refresh(ctx.user?.uid).catch(() => {});
    }
    showToast("Journal enregistré");
    renderDaily(ctx, root, { day: currentDay, dateIso: dayKey });
  };

  modesLogger.groupEnd();
  if (window.__appBadge && typeof window.__appBadge.refresh === "function") {
    window.__appBadge.refresh(ctx.user?.uid).catch(() => {});
  }
}

function renderHistory() {}

Modes.openCategoryDashboard = window.openCategoryDashboard;
Modes.openConsigneForm = openConsigneForm;
Modes.openHistory = openHistory;
Modes.renderPractice = renderPractice;
Modes.renderDaily = renderDaily;
Modes.renderHistory = renderHistory;
Modes.attachConsignesDragDrop = window.attachConsignesDragDrop;
