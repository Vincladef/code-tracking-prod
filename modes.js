// modes.js — Journalier / Pratique / Historique
/* global Schema, Modes */
window.Modes = window.Modes || {};
const modesFirestore = Schema.firestore || window.firestoreAPI || {};

const modesLogger = Schema.D || { info: () => {}, group: () => {}, groupEnd: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function autoGrowTextarea(el) {
  if (!(el instanceof HTMLTextAreaElement)) return;
  if (el.dataset.autoGrowBound === "true") return;
  const resize = () => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  el.addEventListener("input", resize);
  el.addEventListener("change", resize);
  el.dataset.autoGrowBound = "true";
  resize();
}

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

const LIKERT6_ORDER = ["no", "rather_no", "medium", "rather_yes", "yes"];
const LIKERT6_LABELS = {
  no: "Non",
  rather_no: "Plutôt non",
  medium: "Neutre",
  rather_yes: "Plutôt oui",
  yes: "Oui",
  no_answer: "Pas de réponse",
};

const NOTE_IGNORED_VALUES = new Set(["no_answer"]);

function formatConsigneValue(type, value, _options = {}) {
  if (type === "info") return "";
  if (value === null || value === undefined || value === "") return "—";
  if (type === "yesno") {
    if (value === "yes") return "Oui";
    if (value === "no") return "Non";
    return String(value);
  }
  if (type === "likert5") return String(value);
  if (type === "likert6") {
    const mapped = LIKERT6_LABELS[String(value)];
    return mapped || String(value);
  }
  return String(value);
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
  return `<span class="sr-only" data-priority="${tone}">Priorité ${lbl}</span>`;
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
        lastFormatted: formatConsigneValue(consigne.type, lastValue),
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
        "ok-strong": "Très positif",
        "ok-soft": "Plutôt positif",
        mid: "Intermédiaire",
        "ko-soft": "Plutôt négatif",
        "ko-strong": "Très négatif",
        note: "Réponse notée",
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
              const valueText = formatConsigneValue(stat.type, entry.value);
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
        return `<textarea id="${fieldId}" name="value" class="consigne-editor__textarea" placeholder="Réponse">${escapeHtml(String(value ?? ""))}</textarea>`;
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
      stat.lastFormatted = formatConsigneValue(stat.type, lastValue);
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
            <textarea id="${valueId}-note" name="note" class="consigne-editor__textarea" placeholder="Ajouter un commentaire">${escapeHtml(noteValue)}</textarea>
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
    const el = e.target.closest('.consigne-row');
    if (!el || el.dataset.parentId) return;
    dragId = el.dataset.id;
    dragWrapper = el.closest('.consigne-group') || el;
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragover', (e) => {
    if (!dragId || !dragWrapper) return;
    e.preventDefault();
    let over = e.target.closest('.consigne-row');
    if (!over || over.dataset.parentId) {
      over = e.target.closest('.consigne-group')?.querySelector('.consigne-row');
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
    const cards = [...container.querySelectorAll('.consigne-row:not([data-parent-id])')];
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

function consigneActions() {
  const actionBtn = (label, cls = "") => `
    <button type="button" class="btn btn-ghost text-sm text-left ${cls}" role="menuitem">${label}</button>
  `;
  return `
    <div class="daily-consigne__actions js-consigne-actions" role="group" aria-label="Actions" style="position:relative;">
      <button type="button"
              class="btn btn-ghost text-sm consigne-actions__trigger js-actions-trigger"
              aria-haspopup="true"
              aria-expanded="false"
              title="Actions">
        <span aria-hidden="true">⋮</span>
        <span class="sr-only">Actions</span>
      </button>
      <div class="consigne-actions__panel js-actions-panel card"
           role="menu"
           aria-hidden="true"
           hidden>
        ${actionBtn("Historique", "js-histo")}
        ${actionBtn("Modifier", "js-edit")}
        ${actionBtn("Décaler", "js-delay")}
        ${actionBtn("Activer la répétition espacée", "js-sr-toggle")}
        ${actionBtn("Supprimer", "js-del text-red-600")}
      </div>
    </div>
  `;
}

const CONSIGNE_ACTION_SELECTOR = ".js-consigne-actions";
let openConsigneActionsRoot = null;
let consigneActionsDocListenersBound = false;

function getConsigneActionElements(root) {
  if (!root) return { trigger: null, panel: null };
  return {
    trigger: root.querySelector(".js-actions-trigger"),
    panel: root.querySelector(".js-actions-panel"),
  };
}

function removeConsigneActionListeners() {
  if (!consigneActionsDocListenersBound) return;
  document.removeEventListener("click", onDocumentClickConsigneActions, true);
  document.removeEventListener("keydown", onDocumentKeydownConsigneActions, true);
  consigneActionsDocListenersBound = false;
}

function ensureConsigneActionListeners() {
  if (consigneActionsDocListenersBound) return;
  document.addEventListener("click", onDocumentClickConsigneActions, true);
  document.addEventListener("keydown", onDocumentKeydownConsigneActions, true);
  consigneActionsDocListenersBound = true;
}

function closeConsigneActionMenu(root, { focusTrigger = false } = {}) {
  if (!root) return;
  const { trigger, panel } = getConsigneActionElements(root);
  if (panel && !panel.hidden) {
    panel.hidden = true;
    panel.setAttribute("aria-hidden", "true");
  }
  if (trigger) {
    trigger.setAttribute("aria-expanded", "false");
    if (focusTrigger) {
      trigger.focus();
    }
  }
  if (openConsigneActionsRoot === root) {
    openConsigneActionsRoot = null;
    removeConsigneActionListeners();
  }
}

function openConsigneActionMenu(root) {
  if (!root) return;
  if (openConsigneActionsRoot && openConsigneActionsRoot !== root) {
    closeConsigneActionMenu(openConsigneActionsRoot);
  }
  const { trigger, panel } = getConsigneActionElements(root);
  if (panel) {
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    if (!panel.hasAttribute("tabindex")) {
      panel.setAttribute("tabindex", "-1");
    }
  }
  if (trigger) {
    trigger.setAttribute("aria-expanded", "true");
  }
  openConsigneActionsRoot = root;
  ensureConsigneActionListeners();
}

function toggleConsigneActionMenu(root) {
  if (!root) return;
  const { panel } = getConsigneActionElements(root);
  const isOpen = openConsigneActionsRoot === root && panel && !panel.hidden;
  if (isOpen) {
    closeConsigneActionMenu(root);
  } else {
    openConsigneActionMenu(root);
    if (panel && typeof panel.focus === "function") {
      try {
        panel.focus({ preventScroll: true });
      } catch (err) {
        panel.focus();
      }
    }
  }
}

function onDocumentClickConsigneActions(event) {
  if (!openConsigneActionsRoot) return;
  if (openConsigneActionsRoot.contains(event.target)) return;
  closeConsigneActionMenu(openConsigneActionsRoot);
}

function onDocumentKeydownConsigneActions(event) {
  if (!openConsigneActionsRoot) return;
  if (event.key === "Escape" || event.key === "Esc") {
    closeConsigneActionMenu(openConsigneActionsRoot, { focusTrigger: true });
    event.stopPropagation();
  }
}

function setupConsigneActionMenus(scope = document, configure) {
  $$(CONSIGNE_ACTION_SELECTOR, scope).forEach((actionsRoot) => {
    if (actionsRoot.dataset.actionsMenuReady === "1") return;
    const config = typeof configure === "function" ? configure(actionsRoot) : configure || {};
    const { trigger, panel } = getConsigneActionElements(actionsRoot);
    if (!trigger || !panel) return;
    actionsRoot.dataset.actionsMenuReady = "1";
    panel.hidden = true;
    panel.setAttribute("aria-hidden", "true");
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleConsigneActionMenu(actionsRoot);
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Escape" || event.key === "Esc") {
        closeConsigneActionMenu(actionsRoot, { focusTrigger: true });
        event.stopPropagation();
      }
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape" || event.key === "Esc") {
        closeConsigneActionMenu(actionsRoot, { focusTrigger: true });
        event.stopPropagation();
      }
    });

    const srToggleBtn = actionsRoot.querySelector(".js-sr-toggle");
    const srToggleConfig = config?.srToggle;
    if (srToggleBtn && srToggleConfig) {
      const resolveEnabled = () => {
        if (typeof srToggleConfig.getEnabled === "function") {
          try {
            return Boolean(srToggleConfig.getEnabled());
          } catch (err) {
            console.error(err);
            return true;
          }
        }
        return true;
      };
      const updateButton = (enabled) => {
        const nextEnabled = Boolean(enabled);
        srToggleBtn.dataset.enabled = nextEnabled ? "1" : "0";
        srToggleBtn.setAttribute("aria-pressed", nextEnabled ? "true" : "false");
        const title = nextEnabled
          ? "Désactiver la répétition espacée"
          : "Activer la répétition espacée";
        srToggleBtn.textContent = title;
        srToggleBtn.title = title;
      };
      updateButton(resolveEnabled());
      srToggleBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const current = resolveEnabled();
        const next = !current;
        srToggleBtn.disabled = true;
        try {
          const result = await srToggleConfig.onToggle?.(next, {
            event,
            current,
            next,
            update: updateButton,
            close: () => closeConsigneActionMenu(actionsRoot),
            actionsRoot,
          });
          const finalState = typeof result === "boolean" ? result : next;
          updateButton(finalState);
        } catch (err) {
          updateButton(current);
        } finally {
          srToggleBtn.disabled = false;
          closeConsigneActionMenu(actionsRoot);
        }
      });
    }
  });
}

function closeConsigneActionMenuFromNode(node, options) {
  if (!node) return;
  const root = node.closest(CONSIGNE_ACTION_SELECTOR);
  if (root) {
    closeConsigneActionMenu(root, options);
  }
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
    return `<textarea name="long:${consigne.id}" class="consigne-editor__textarea" placeholder="Réponse">${value}</textarea>`;
  }
  if (consigne.type === "num") {
    const sliderValue = initialValue != null && initialValue !== ""
      ? Number(initialValue)
      : 5;
    const safeValue = Number.isFinite(sliderValue) ? sliderValue : 5;
    return `
      <input type="range" min="1" max="10" value="${safeValue}" data-default-value="${safeValue}" name="num:${consigne.id}" class="w-full">
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

function extractTextualNote(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return "";
    if (NOTE_IGNORED_VALUES.has(trimmed)) return "";
    return trimmed;
  }
  if (typeof value === "object") {
    const candidates = ["note", "comment", "remark", "text", "message"];
    for (const key of candidates) {
      const candidate = value[key];
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (trimmed.length === 0) continue;
        if (NOTE_IGNORED_VALUES.has(trimmed)) continue;
        return trimmed;
      }
    }
  }
  return "";
}

function hasTextualNote(value) {
  return extractTextualNote(value).length > 0;
}

function dotColor(type, v){
  if (type === "info") {
    return hasTextualNote(v) ? "note" : "na";
  }
  if (type === "likert6") {
    const map = {
      yes: "ok-strong",
      rather_yes: "ok-soft",
      medium: "mid",
      rather_no: "ko-soft",
      no: "ko-strong",
      no_answer: "note",
    };
    return map[v] || "na";
  }
  if (type === "likert5") {
    const n = Number(v);
    if (!Number.isFinite(n)) return "na";
    if (n >= 5) return "ok-strong";
    if (n === 4) return "ok-soft";
    if (n === 3) return "mid";
    if (n === 2) return "ko-soft";
    if (n <= 1) return "ko-strong";
    return "na";
  }
  if (type === "yesno") {
    if (v === "yes") return "ok-strong";
    if (v === "no") return "ko-strong";
    return "na";
  }
  if (type === "num") {
    const n = Number(v);
    if (!Number.isFinite(n)) return "na";
    if (n >= 7) return "ok-strong";
    if (n >= 4) return "mid";
    return "ko-strong";
  }
  if (type === "short" || type === "long") {
    return hasTextualNote(v) ? "note" : "na";
  }
  if (hasTextualNote(v)) {
    return "note";
  }
  return "na";
}

const STATUS_LABELS = {
  "ok-strong": "Très positif",
  "ok-soft": "Plutôt positif",
  mid: "Intermédiaire",
  "ko-soft": "Plutôt négatif",
  "ko-strong": "Très négatif",
  note: "Réponse notée",
  na: "Sans donnée",
};

const consigneRowUpdateTimers = new WeakMap();
const CONSIGNE_ROW_UPDATE_DURATION = 900;

function clearConsigneRowUpdateHighlight(row) {
  if (!row) return;
  const timer = consigneRowUpdateTimers.get(row);
  if (timer) {
    clearTimeout(timer);
    consigneRowUpdateTimers.delete(row);
  }
  row.classList.remove("consigne-row--updated");
}

function triggerConsigneRowUpdateHighlight(row) {
  if (!row) return;
  clearConsigneRowUpdateHighlight(row);
  // Force a reflow to ensure the animation restarts if triggered rapidly.
  void row.offsetWidth;
  row.classList.add("consigne-row--updated");
  const timeoutId = setTimeout(() => {
    row.classList.remove("consigne-row--updated");
    consigneRowUpdateTimers.delete(row);
  }, CONSIGNE_ROW_UPDATE_DURATION);
  consigneRowUpdateTimers.set(row, timeoutId);
}

function updateConsigneStatusUI(row, consigne, rawValue) {
  if (!row || !consigne) return;
  const status = dotColor(consigne.type, rawValue);
  const statusHolder = row.querySelector("[data-status]");
  const dot = row.querySelector("[data-status-dot]");
  const mark = row.querySelector("[data-status-mark]");
  const live = row.querySelector("[data-status-live]");
  row.dataset.status = status;
  if (statusHolder) {
    statusHolder.dataset.status = status;
    statusHolder.setAttribute("data-status", status);
  }
  if (dot) {
    dot.className = `consigne-row__dot consigne-row__dot--${status}`;
  }
  if (mark) {
    const isAnswered = status !== "na";
    mark.classList.toggle("consigne-row__mark--checked", isAnswered);
  }
  if (live) {
    const textualNote = extractTextualNote(rawValue);
    const isNoteStatus = status === "note";
    const baseHasValue = !(rawValue === null || rawValue === undefined || rawValue === "");
    const hasValue = isNoteStatus ? textualNote.length > 0 || baseHasValue : baseHasValue;
    const formattedValue = (() => {
      if (isNoteStatus) {
        if (textualNote) return textualNote;
        const fallback = formatConsigneValue(consigne.type, rawValue);
        if (fallback === null || fallback === undefined || fallback === "" || fallback === "—") {
          return "Réponse enregistrée";
        }
        return fallback;
      }
      if (consigne.type === "info") return INFO_RESPONSE_LABEL;
      if (!hasValue) return "Sans donnée";
      const result = formatConsigneValue(consigne.type, rawValue);
      if (result === null || result === undefined || result === "" || result === "—") {
        return "Réponse enregistrée";
      }
      return result;
    })();
    const label = STATUS_LABELS[status] || "Valeur";
    live.textContent = `${label}: ${formattedValue}`;
  }
  if (status === "na") {
    clearConsigneRowUpdateHighlight(row);
  } else {
    triggerConsigneRowUpdateHighlight(row);
  }
}

function readConsigneCurrentValue(consigne, scope) {
  if (!consigne || !scope) return "";
  const id = consigne.id;
  const type = consigne.type;
  if (type === "info") return "";
  if (type === "short") {
    const input = scope.querySelector(`[name="short:${id}"]`);
    return input ? input.value.trim() : "";
  }
  if (type === "long") {
    const textarea = scope.querySelector(`[name="long:${id}"]`);
    return textarea ? textarea.value.trim() : "";
  }
  if (type === "num") {
    const range = scope.querySelector(`[name="num:${id}"]`);
    if (!range || range.value === "" || range.value == null) return "";
    const num = Number(range.value);
    return Number.isFinite(num) ? num : "";
  }
  if (type === "likert5") {
    const select = scope.querySelector(`[name="likert5:${id}"]`);
    if (!select || select.value === "" || select.value == null) return "";
    const num = Number(select.value);
    return Number.isFinite(num) ? num : "";
  }
  if (type === "yesno") {
    const select = scope.querySelector(`[name="yesno:${id}"]`);
    return select ? select.value : "";
  }
  if (type === "likert6") {
    const select = scope.querySelector(`[name="likert6:${id}"]`);
    return select ? select.value : "";
  }
  const input = scope.querySelector(`[name$=":${id}"]`);
  return input ? input.value : "";
}

function enhanceRangeMeters(scope) {
  if (!scope) return;
  const sliders = scope.querySelectorAll('input[type="range"][name^="num:"]');
  sliders.forEach((slider) => {
    const meter = scope.querySelector(`[data-meter="${slider.name}"]`);
    if (!meter) return;
    const sync = () => {
      meter.textContent = slider.value;
    };
    slider.addEventListener("input", sync);
    slider.addEventListener("change", sync);
    sync();
  });
}

function findConsigneInputFields(row, consigne) {
  if (!row || !consigne) return [];
  const holder = row.querySelector("[data-consigne-input-holder]");
  if (!holder) return [];
  return Array.from(holder.querySelectorAll(`[name$=":${consigne.id}"]`));
}

function setConsigneRowValue(row, consigne, value) {
  const fields = findConsigneInputFields(row, consigne);
  if (!fields.length) {
    updateConsigneStatusUI(row, consigne, value);
    return;
  }
  const normalizedValue = value === null || value === undefined ? "" : value;
  fields.forEach((field) => {
    let stringValue = normalizedValue;
    if (field.type === "range") {
      const defaultValue = field.getAttribute("data-default-value") || field.defaultValue || field.min || "";
      stringValue = normalizedValue === "" ? defaultValue : normalizedValue;
    }
    if (field.tagName === "SELECT" || field.tagName === "TEXTAREA" || field.tagName === "INPUT") {
      field.value = stringValue === "" ? "" : String(stringValue);
    } else {
      field.value = stringValue === "" ? "" : String(stringValue);
    }
    if (field.type === "range") {
      const meter = row.querySelector(`[data-meter="${field.name}"]`);
      if (meter) meter.textContent = field.value;
    }
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function attachConsigneEditor(row, consigne, options = {}) {
  if (!row || !consigne) return;
  const trigger = options.trigger || row.querySelector("[data-consigne-open]");
  if (!trigger) return;
  const variant = options.variant === "drawer" ? "drawer" : "modal";
  enhanceRangeMeters(row.querySelector("[data-consigne-input-holder]"));
  const openEditor = () => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (trigger && typeof trigger.setAttribute === "function") {
      trigger.setAttribute("aria-expanded", "true");
    }
    const currentValue = readConsigneCurrentValue(consigne, row);
    const title = consigne.text || consigne.titre || consigne.name || consigne.id;
    const description = consigne.description || consigne.details || consigne.helper || "";
    const actionsMarkup = consigne.type === "info"
      ? `<div class="flex justify-end"><button type="button" class="btn" data-consigne-editor-cancel>Fermer</button></div>`
      : `<div class="flex justify-end gap-2">
          <button type="button" class="btn btn-ghost" data-consigne-editor-cancel>Annuler</button>
          <button type="button" class="btn btn-primary" data-consigne-editor-validate>Valider</button>
        </div>`;
    const markup = `
      <div class="space-y-4">
        <header class="space-y-1">
          <h2 class="text-lg font-semibold">${escapeHtml(title)}</h2>
          ${description ? `<p class="text-sm text-slate-600 whitespace-pre-line" data-consigne-editor-description>${escapeHtml(description)}</p>` : ""}
        </header>
        <div class="space-y-3" data-consigne-editor-body>
          ${inputForType(consigne, currentValue)}
        </div>
        ${actionsMarkup}
      </div>
    `;
    const overlay = (variant === "drawer" ? drawer : modal)(markup);
    overlay.querySelectorAll("textarea").forEach((textarea) => {
      autoGrowTextarea(textarea);
    });
    const uniqueIdBase = `${Date.now()}-${Math.round(Math.random() * 10000)}`;
    const dialogNode = variant === "drawer" ? overlay.querySelector("aside") : overlay.firstElementChild;
    if (dialogNode) {
      dialogNode.setAttribute("role", "dialog");
      dialogNode.setAttribute("aria-modal", "true");
      const heading = dialogNode.querySelector("h2");
      if (heading && !heading.id) {
        heading.id = `consigne-editor-title-${uniqueIdBase}`;
      }
      if (heading && heading.id) {
        dialogNode.setAttribute("aria-labelledby", heading.id);
        dialogNode.removeAttribute("aria-label");
      } else {
        dialogNode.setAttribute("aria-label", String(title || ""));
      }
      const descriptionEl = dialogNode.querySelector("[data-consigne-editor-description]");
      if (descriptionEl && !descriptionEl.id) {
        descriptionEl.id = `consigne-editor-desc-${uniqueIdBase}`;
      }
      if (descriptionEl && descriptionEl.id) {
        dialogNode.setAttribute("aria-describedby", descriptionEl.id);
      } else {
        dialogNode.removeAttribute("aria-describedby");
      }
    }
    const body = overlay.querySelector("[data-consigne-editor-body]");
    enhanceRangeMeters(body);
    const focusTarget = body?.querySelector("input, select, textarea");
    if (focusTarget) {
      try {
        focusTarget.focus({ preventScroll: true });
      } catch (err) {
        focusTarget.focus();
      }
    }
    let isClosed = false;
    const closeOverlay = () => {
      if (isClosed) return;
      isClosed = true;
      document.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
      if (trigger && typeof trigger.setAttribute === "function") {
        trigger.setAttribute("aria-expanded", "false");
      }
      if (trigger && typeof trigger.focus === "function" && document.contains(trigger)) {
        try {
          trigger.focus({ preventScroll: true });
        } catch (err) {
          trigger.focus();
        }
      } else if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
      if (typeof options.onClose === "function") {
        options.onClose();
      }
    };
    const background = variant === "drawer" ? overlay.firstElementChild : overlay;
    if (background) {
      background.addEventListener("click", (event) => {
        const isDrawerBg = variant === "drawer" && event.target === background;
        const isModalBg = variant !== "drawer" && event.target === overlay;
        if (isDrawerBg || isModalBg) {
          event.preventDefault();
          closeOverlay();
        }
      });
    }
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    const cancelBtn = overlay.querySelector("[data-consigne-editor-cancel]");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", (event) => {
        event.preventDefault();
        closeOverlay();
      });
    }
    const validateBtn = overlay.querySelector("[data-consigne-editor-validate]");
    if (validateBtn) {
      validateBtn.addEventListener("click", (event) => {
        event.preventDefault();
        const newValue = readConsigneCurrentValue(consigne, overlay);
        setConsigneRowValue(row, consigne, newValue);
        if (typeof options.onSubmit === "function") {
          options.onSubmit(newValue);
        }
        closeOverlay();
      });
    }
  };
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openEditor();
  });
  if (trigger && typeof trigger.setAttribute === "function") {
    trigger.setAttribute("aria-expanded", "false");
  }
}

function bindConsigneRowValue(row, consigne, { onChange, initialValue } = {}) {
  if (!row || !consigne) return;
  const emit = (value) => {
    if (onChange) onChange(value);
    updateConsigneStatusUI(row, consigne, value);
  };
  const read = () => readConsigneCurrentValue(consigne, row);
  if (initialValue !== undefined) {
    emit(initialValue);
  } else {
    emit(read());
  }
  const raf = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : (cb) => setTimeout(cb, 16);
  const fields = Array.from(row.querySelectorAll(`[name$=":${consigne.id}"]`));
  if (fields.length) {
    const handler = () => emit(read());
    fields.forEach((field) => {
      field.addEventListener("input", handler);
      field.addEventListener("change", handler);
    });
    raf(() => emit(read()));
  } else {
    raf(() => emit(read()));
  }
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
    note: "Réponse notée",
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
      const formatted = formatConsigneValue(consigne.type, r.value);
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
      const tone = priorityTone(c.priority);
      const row = document.createElement("div");
      row.className = `consigne-row priority-surface priority-surface-${tone}`;
      row.dataset.id = c.id;
      if (isChild) {
        row.classList.add("consigne-row--child");
        if (c.parentId) {
          row.dataset.parentId = c.parentId;
        } else {
          delete row.dataset.parentId;
        }
        row.draggable = false;
      } else {
        row.classList.add("consigne-row--parent");
        delete row.dataset.parentId;
        row.draggable = true;
      }
      row.innerHTML = `
        <div class="consigne-row__header">
          <div class="consigne-row__main">
            <button type="button" class="consigne-row__toggle" data-consigne-open aria-haspopup="dialog">
              <span class="consigne-row__title">${escapeHtml(c.text)}</span>
              ${prioChip(Number(c.priority) || 2)}
            </button>
          </div>
          <div class="consigne-row__meta">
            <span class="consigne-row__status" data-status="na">
              <span class="consigne-row__dot consigne-row__dot--na" data-status-dot aria-hidden="true"></span>
              <span class="consigne-row__mark" data-status-mark aria-hidden="true"></span>
              <span class="sr-only" data-status-live aria-live="polite"></span>
            </span>
            ${consigneActions()}
          </div>
        </div>
        <div data-consigne-input-holder hidden></div>
      `;
      const holder = row.querySelector("[data-consigne-input-holder]");
      if (holder) {
        holder.innerHTML = inputForType(c);
        enhanceRangeMeters(holder);
      }
      const bH = row.querySelector(".js-histo");
      const bE = row.querySelector(".js-edit");
      const bD = row.querySelector(".js-del");
      bH.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closeConsigneActionMenuFromNode(bH); Schema.D.info("ui.history.click", c.id); openHistory(ctx, c); };
      bE.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closeConsigneActionMenuFromNode(bE); Schema.D.info("ui.editConsigne.click", c.id); openConsigneForm(ctx, c); };
      bD.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        closeConsigneActionMenuFromNode(bD);
        if (confirm("Supprimer cette consigne ? (historique conservé)")) {
          Schema.D.info("ui.deleteConsigne.confirm", c.id);
          await Schema.softDeleteConsigne(ctx.db, ctx.user.uid, c.id);
          renderPractice(ctx, root);
        }
      };
      let srEnabled = c?.srEnabled !== false;
      const delayBtn = row.querySelector(".js-delay");
      const updateDelayState = (enabled) => {
        if (!delayBtn) return;
        delayBtn.disabled = !enabled;
        delayBtn.classList.toggle("opacity-50", !enabled);
        delayBtn.title = enabled
          ? "Décaler la prochaine itération"
          : "Active la répétition espacée pour décaler";
      };
      if (delayBtn) {
        updateDelayState(srEnabled);
        delayBtn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeConsigneActionMenuFromNode(delayBtn);
          if (delayBtn.disabled) {
            showToast("Active la répétition espacée pour utiliser le décalage.");
            return;
          }
          const raw = prompt("Décaler de combien d'itérations ?", "1");
          if (raw === null) return;
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
          } finally {
            updateDelayState(srEnabled);
          }
        };
      }
      setupConsigneActionMenus(row, () => ({
        srToggle: {
          getEnabled: () => srEnabled,
          onToggle: async (next) => {
            try {
              await Schema.updateConsigne(ctx.db, ctx.user.uid, c.id, { srEnabled: next });
              srEnabled = next;
              c.srEnabled = next;
              updateDelayState(srEnabled);
              return srEnabled;
            } catch (err) {
              console.error(err);
              showToast("Impossible de mettre à jour la répétition espacée.");
              return srEnabled;
            }
          },
        },
      }));
      attachConsigneEditor(row, c, { variant: "modal" });
      bindConsigneRowValue(row, c, {
        onChange: (value) => {
          if (value === null || value === undefined) {
            delete row.dataset.currentValue;
          } else {
            row.dataset.currentValue = String(value);
          }
        },
      });
      return row;
    };

    const grouped = groupConsignes(visible);
    const renderGroup = (group, target) => {
      const wrapper = document.createElement("div");
      wrapper.className = "consigne-group";
      const parentCard = makeItem(group.consigne, { isChild: false });
      wrapper.appendChild(parentCard);
      if (group.children.length) {
        const details = document.createElement("details");
        details.className = "consigne-group__children";
        details.innerHTML = `<summary class="consigne-group__summary">${group.children.length} sous-consigne${group.children.length > 1 ? "s" : ""}</summary>`;
        const list = document.createElement("div");
        list.className = "consigne-group__list";
        group.children.forEach((child) => {
          const childCard = makeItem(child, { isChild: true });
          list.appendChild(childCard);
        });
        details.appendChild(list);
        wrapper.appendChild(details);
      }
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

  const previousAnswersRaw = await Schema.fetchDailyResponses(ctx.db, ctx.user.uid, dayKey);
  const previousAnswers = previousAnswersRaw instanceof Map
    ? previousAnswersRaw
    : new Map(previousAnswersRaw || []);

  const renderItemCard = (item, { isChild = false } = {}) => {
    const previous = previousAnswers.get(item.id);
    const hasPrevValue = previous && Object.prototype.hasOwnProperty.call(previous, "value");
    const initialValue = hasPrevValue ? previous.value : null;
    const row = document.createElement("div");
    const tone = priorityTone(item.priority);
    row.className = `consigne-row priority-surface priority-surface-${tone}`;
    row.dataset.id = item.id;
    if (isChild) {
      row.classList.add("consigne-row--child");
      if (item.parentId) {
        row.dataset.parentId = item.parentId;
      } else {
        delete row.dataset.parentId;
      }
    } else {
      row.classList.add("consigne-row--parent");
      delete row.dataset.parentId;
    }
    row.innerHTML = `
      <div class="consigne-row__header">
        <div class="consigne-row__main">
          <button type="button" class="consigne-row__toggle" data-consigne-open aria-haspopup="dialog">
            <span class="consigne-row__title">${escapeHtml(item.text)}</span>
            ${prioChip(Number(item.priority) || 2)}
          </button>
        </div>
        <div class="consigne-row__meta">
          <span class="consigne-row__status" data-status="na">
            <span class="consigne-row__dot consigne-row__dot--na" data-status-dot aria-hidden="true"></span>
            <span class="consigne-row__mark" data-status-mark aria-hidden="true"></span>
            <span class="sr-only" data-status-live aria-live="polite"></span>
          </span>
          ${consigneActions()}
        </div>
      </div>
      <div data-consigne-input-holder hidden></div>
    `;
    const holder = row.querySelector("[data-consigne-input-holder]");
    if (holder) {
      holder.innerHTML = inputForType(item, previous?.value ?? null);
      enhanceRangeMeters(holder);
    }
    const bH = row.querySelector(".js-histo");
    const bE = row.querySelector(".js-edit");
    const bD = row.querySelector(".js-del");
    bH.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closeConsigneActionMenuFromNode(bH); Schema.D.info("ui.history.click", item.id); openHistory(ctx, item); };
    bE.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closeConsigneActionMenuFromNode(bE); Schema.D.info("ui.editConsigne.click", item.id); openConsigneForm(ctx, item); };
    bD.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      closeConsigneActionMenuFromNode(bD);
      if (confirm("Supprimer cette consigne ? (historique conservé)")) {
        Schema.D.info("ui.deleteConsigne.confirm", item.id);
        await Schema.softDeleteConsigne(ctx.db, ctx.user.uid, item.id);
        renderDaily(ctx, root, { day: currentDay });
      }
    };
    let srEnabled = item?.srEnabled !== false;
    const delayBtn = row.querySelector(".js-delay");
    const updateDelayState = (enabled) => {
      if (!delayBtn) return;
      delayBtn.disabled = !enabled;
      delayBtn.classList.toggle("opacity-50", !enabled);
      delayBtn.title = enabled
        ? "Décaler la prochaine apparition"
        : "Active la répétition espacée pour décaler";
    };
    if (delayBtn) {
      updateDelayState(srEnabled);
      delayBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeConsigneActionMenuFromNode(delayBtn);
        if (delayBtn.disabled) {
          showToast("Active la répétition espacée pour utiliser le décalage.");
          return;
        }
        const raw = prompt("Décaler de combien de jours ?", "1");
        if (raw === null) return;
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
          updateDelayState(srEnabled);
        }
      };
    }
    setupConsigneActionMenus(row, () => ({
      srToggle: {
        getEnabled: () => srEnabled,
        onToggle: async (next) => {
          try {
            await Schema.updateConsigne(ctx.db, ctx.user.uid, item.id, { srEnabled: next });
            srEnabled = next;
            item.srEnabled = next;
            updateDelayState(srEnabled);
            return srEnabled;
          } catch (err) {
            console.error(err);
            showToast("Impossible de mettre à jour la répétition espacée.");
            return srEnabled;
          }
        },
      },
    }));

    attachConsigneEditor(row, item, { variant: "modal" });
    bindConsigneRowValue(row, item, {
      initialValue,
      onChange: (value) => {
        const base = previousAnswers.get(item.id) || { consigneId: item.id };
        previousAnswers.set(item.id, { ...base, value });
        if (value === null || value === undefined || value === "") {
          delete row.dataset.currentValue;
        } else {
          row.dataset.currentValue = String(value);
        }
      },
    });

    return row;
  };

  const renderGroup = (group, target) => {
    const wrapper = document.createElement("div");
    wrapper.className = "consigne-group";
    const parentCard = renderItemCard(group.consigne, { isChild: false });
    wrapper.appendChild(parentCard);
    if (group.children.length) {
      const details = document.createElement("details");
      details.className = "consigne-group__children";
      details.innerHTML = `<summary class="consigne-group__summary">${group.children.length} sous-consigne${group.children.length > 1 ? "s" : ""}</summary>`;
      const list = document.createElement("div");
      list.className = "consigne-group__list";
      group.children.forEach((child) => {
        const childCard = renderItemCard(child, { isChild: true });
        list.appendChild(childCard);
      });
      details.appendChild(list);
      wrapper.appendChild(details);
    }
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
