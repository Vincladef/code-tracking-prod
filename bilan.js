// bilan.js — agrégation hebdo / mensuelle
/* global Schema, Modes */
(() => {
  const BilanNS = (window.Bilan = window.Bilan || {});
  if (BilanNS.__initialized) {
    return;
  }
  BilanNS.__initialized = true;

  const bilanLogger = Schema.D || {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
    group: () => {},
    groupEnd: () => {},
  };

  const FAMILY_ORDER = ["objective", "daily", "practice"];
  const FAMILY_LABELS = {
    daily: "Journalier",
    practice: "Pratique",
    objective: "Objectifs",
  };
  const FAMILY_DECOR = {
    daily: {
      icon: "🗓️",
    },
    practice: {
      icon: "🛠️",
      intro: "Classées par catégorie pour un suivi plus précis.",
    },
    objective: {
      icon: "🎯",
      intro: "Ce qui compte le plus pour cette période.",
    },
  };

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function stableSerializeValue(input) {
    if (input === undefined) return "__undefined__";
    try {
      return JSON.stringify(input);
    } catch (error) {
      return String(input);
    }
  }

  function resolveAnswerValue(answer) {
    if (!answer) return null;
    if (Object.prototype.hasOwnProperty.call(answer, "value")) {
      return answer.value;
    }
    if (Object.prototype.hasOwnProperty.call(answer, "numericValue")) {
      const numeric = answer.numericValue;
      if (numeric !== undefined && numeric !== null) {
        return numeric;
      }
    }
    if (Object.prototype.hasOwnProperty.call(answer || {}, "v")) {
      return answer.v;
    }
    return null;
  }

  function summaryKey(consigne) {
    const family = consigne?.family ? String(consigne.family) : "autre";
    const id = consigne?.id ? String(consigne.id) : "__";
    return `${family}__${id}`;
  }

  function normalizeWeekEndsOn(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    const rounded = Math.round(num);
    return ((rounded % 7) + 7) % 7;
  }

  function consigneVisibleInSummary(consigne, period) {
    const scope = String(period?.scope || "").toLowerCase();
    const weeklyEnabled = consigne?.weeklySummaryEnabled !== false;
    const monthlyEnabled = consigne?.monthlySummaryEnabled !== false;
    const yearlyEnabled = consigne?.yearlySummaryEnabled !== false;
    const summaryOnlyScope = String(consigne?.summaryOnlyScope || "").toLowerCase();
    if (summaryOnlyScope === "weekly") {
      return scope === "week" || scope === "weekly";
    }
    if (summaryOnlyScope === "monthly") {
      return scope === "month" || scope === "monthly";
    }
    if (summaryOnlyScope === "yearly") {
      return scope === "year" || scope === "yearly";
    }
    if (scope === "week" || scope === "weekly") {
      return weeklyEnabled;
    }
    if (scope === "month" || scope === "monthly") {
      return monthlyEnabled;
    }
    if (scope === "year" || scope === "yearly") {
      return yearlyEnabled;
    }
    return true;
  }

  function computePeriodFromEntry(entry) {
    if (!entry) return null;
    const type = entry.type;
    const weekEndsOn = normalizeWeekEndsOn(entry?.weekEndsOn);
    if (type === "week" || type === "weekly") {
      const fallbackRange = entry.weekStart && entry.weekEnd
        ? { start: Schema.startOfDay(entry.weekStart), end: Schema.endOfDay(entry.weekEnd) }
        : Schema.weekRangeFromDate(entry.sunday || entry.weekEnd || new Date(), weekEndsOn);
      if (!fallbackRange) return null;
      const weekKey = entry.weekKey
        || Schema.weekKeyFromDate(entry.weekEnd || entry.sunday || fallbackRange.end, weekEndsOn);
      return {
        scope: "week",
        start: fallbackRange.start,
        end: fallbackRange.end,
        key: weekKey,
        label: entry.navSubtitle || entry.navLabel || "",
        entry,
        weekEndsOn,
      };
    }
    if (type === "month" || type === "monthly") {
      const monthKey = entry.monthKey || (entry.monthEnd ? Schema.monthKeyFromDate(entry.monthEnd) : "");
      const monthRange = monthKey ? Schema.monthRangeFromKey(monthKey) : null;
      const fallbackRange = monthRange ||
        (entry.weekStart && entry.weekEnd
          ? { start: Schema.startOfDay(entry.weekStart), end: Schema.endOfDay(entry.weekEnd) }
          : Schema.weekRangeFromDate(entry.sunday || entry.weekEnd || new Date(), weekEndsOn));
      if (!fallbackRange) return null;
      return {
        scope: "month",
        start: fallbackRange.start,
        end: fallbackRange.end,
        key: monthKey || Schema.monthKeyFromDate(fallbackRange.start),
        label: entry.navSubtitle || entry.navLabel || "",
        entry,
        weekEndsOn,
      };
    }
    if (type === "year" || type === "yearly") {
      const baseDate = entry.yearEnd || entry.yearStart || entry.sunday || new Date();
      const yearKey = entry.yearKey || (baseDate ? Schema.yearKeyFromDate(baseDate) : "");
      const start = entry.yearStart
        ? Schema.startOfDay(entry.yearStart)
        : (() => {
            const year = baseDate instanceof Date ? baseDate.getFullYear() : new Date().getFullYear();
            const d = new Date(year, 0, 1);
            d.setHours(0, 0, 0, 0);
            return d;
          })();
      const end = entry.yearEnd
        ? Schema.endOfDay(entry.yearEnd)
        : (() => {
            const year = start instanceof Date ? start.getFullYear() : new Date().getFullYear();
            const d = new Date(year, 11, 31);
            d.setHours(23, 59, 59, 999);
            return d;
          })();
      return {
        scope: "year",
        start,
        end,
        key: yearKey || String(start?.getFullYear?.() || new Date().getFullYear()),
        label: entry.navSubtitle || entry.navLabel || "",
        entry,
        weekEndsOn,
      };
    }
    if (
      type === "adhoc" ||
      type === "adhoc_summary" ||
      type === "ponctuel" ||
      type === "ponctuelle"
    ) {
      const rawDate = entry.date instanceof Date && !Number.isNaN(entry.date.getTime())
        ? new Date(entry.date.getTime())
        : typeof entry.dayKey === "string" && entry.dayKey
        ? new Date(entry.dayKey)
        : entry.start instanceof Date && !Number.isNaN(entry.start.getTime())
        ? new Date(entry.start.getTime())
        : new Date();
      const base = rawDate instanceof Date && !Number.isNaN(rawDate.getTime()) ? rawDate : new Date();
      const start = typeof Schema?.startOfDay === "function" ? Schema.startOfDay(base) : new Date(base.getTime());
      const end = typeof Schema?.endOfDay === "function"
        ? Schema.endOfDay(base)
        : (() => {
            const d = new Date(base.getTime());
            d.setHours(23, 59, 59, 999);
            return d;
          })();
      const dayKey = entry.dayKey
        || (typeof Schema?.dayKeyFromDate === "function" ? Schema.dayKeyFromDate(base) : base.toISOString().slice(0, 10));
      return {
        scope: "adhoc",
        start,
        end,
        key: dayKey,
        label: entry.navSubtitle || entry.navLabel || "",
        entry,
        weekEndsOn,
      };
    }
    return null;
  }

  function normalizeConsignes(consignes, family, period) {
    if (!Array.isArray(consignes) || !consignes.length) return [];
    return consignes
      .map((consigne) => {
        if (!consigne || !consigne.id) return null;
        if (consigne.archived === true) return null;
        if (!consigneVisibleInSummary(consigne, period)) return null;
        const journalText = consigne.text || consigne.titre || consigne.name || consigne.id;
        const summaryText = consigne.summaryCustomText
          ? String(consigne.summaryCustomText)
          : consigne.summaryText
          ? String(consigne.summaryText)
          : journalText;
        return {
          ...consigne,
          family,
          text: summaryText,
          summaryText,
          journalText,
          summaryCategory: consigne.category || "Général",
          summaryLabel: FAMILY_LABELS[family] || family,
        };
      })
      .filter(Boolean);
  }

  function normalizeSectionsData(sections, period) {
    if (!sections || typeof sections !== "object") {
      return null;
    }
    const normalized = {
      daily: normalizeConsignes(sections.daily || [], "daily", period),
      practice: normalizeConsignes(sections.practice || [], "practice", period),
      objective: [],
    };
    if (Array.isArray(sections.objective) && sections.objective.length) {
      const alreadyNormalized = sections.objective.every((item) => item && item.family === "objective");
      normalized.objective = alreadyNormalized
        ? sections.objective.slice()
        : normalizeObjectives(sections.objective, period);
      if (normalized.objective.length) {
        normalized.objective = normalized.objective.filter((item) => {
          if (!item) {
            return false;
          }
          if (item.archived === true) {
            return false;
          }
          if (item.originalGoal) {
            return isObjectiveActive(item.originalGoal);
          }
          return true;
        });
      }
    }
    return normalized;
  }

  function sortConsignes(list) {
    return list.slice().sort((a, b) => {
      const catA = (a.summaryCategory || "").toLocaleLowerCase("fr-FR");
      const catB = (b.summaryCategory || "").toLocaleLowerCase("fr-FR");
      if (catA !== catB) {
        return catA < catB ? -1 : 1;
      }
      const prioA = Number(a.priority || 2);
      const prioB = Number(b.priority || 2);
      if (prioA !== prioB) {
        return prioA - prioB;
      }
      const textA = (a.text || "").toLocaleLowerCase("fr-FR");
      const textB = (b.text || "").toLocaleLowerCase("fr-FR");
      if (textA !== textB) {
        return textA < textB ? -1 : 1;
      }
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  }

  function flattenConsigneGroups(groups) {
    const flattened = [];
    groups.forEach((group) => {
      if (!group?.consigne) return;
      const children = Array.isArray(group.children)
        ? group.children.filter(Boolean)
        : [];
      flattened.push({ consigne: group.consigne, children });
    });
    return flattened;
  }

  function createVirtualChildRow(consigne, initialValue, parentId) {
    if (typeof Modes.createHiddenConsigneRow === "function") {
      try {
        const row = Modes.createHiddenConsigneRow(consigne, { initialValue });
        if (row) {
          if (parentId) {
            row.dataset.parentId = String(parentId);
          }
          if (consigne?.family) {
            row.dataset.family = consigne.family;
          }
        }
        return row;
      } catch (error) {
        bilanLogger?.warn?.("bilan.childRow.hidden.create", error);
      }
    }
    const row = document.createElement("div");
    row.className = "consigne-row consigne-row--child consigne-row--virtual";
    row.dataset.id = consigne?.id || "";
    row.dataset.family = consigne?.family || "";
    if (parentId) {
      row.dataset.parentId = String(parentId);
    }
    const tone = typeof Modes.priorityTone === "function"
      ? Modes.priorityTone(consigne?.priority)
      : null;
    if (tone) {
      row.dataset.priorityTone = tone;
    }
    row.hidden = true;
    row.style.display = "none";
    row.setAttribute("aria-hidden", "true");
    const holder = document.createElement("div");
    holder.hidden = true;
    holder.setAttribute("data-consigne-input-holder", "");
    holder.innerHTML = typeof Modes.inputForType === "function"
      ? Modes.inputForType(consigne, initialValue)
      : "";
    row.appendChild(holder);
    if (typeof Modes.enhanceRangeMeters === "function") {
      Modes.enhanceRangeMeters(row);
    }
    return row;
  }

  function renderConsigneActionsMenu({ disableAdvanced = false } = {}) {
    const actionBtn = (label, cls = "", { disabled = false } = {}) => {
      const disabledAttr = disabled ? " disabled" : "";
      const disabledClass = disabled ? " opacity-50" : "";
      return `
        <button type="button" class="btn btn-ghost text-sm text-left ${cls}${disabledClass}" role="menuitem"${disabledAttr}>${label}</button>
      `;
    };
    const disableExtras = disableAdvanced === true;
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
          ${actionBtn("Historique", "js-history-action")}
          ${actionBtn("Modifier", "js-edit", { disabled: disableExtras })}
          ${actionBtn("Décaler", "js-delay", { disabled: disableExtras })}
          ${actionBtn("Activer la répétition espacée", "js-sr-toggle", { disabled: disableExtras })}
          ${actionBtn("Retirer des bilans", "js-remove-summary", { disabled: disableExtras })}
          ${actionBtn("Modifier le texte du bilan", "js-edit-summary-text", { disabled: disableExtras })}
          ${actionBtn("Supprimer", "js-del text-red-600", { disabled: disableExtras })}
        </div>
      </div>
    `;
  }

  function monthKeysForPeriod(period) {
    const keys = new Set();
    if (period?.start) {
      const key = Schema.monthKeyFromDate(period.start);
      if (key) keys.add(key);
    }
    if (period?.end) {
      const key = Schema.monthKeyFromDate(period.end);
      if (key) keys.add(key);
    }
    if (period?.key && period.scope === "month") {
      keys.add(period.key);
    }
    return Array.from(keys).filter(Boolean);
  }

  function parseGoalDate(value) {
    const parsed = Schema.toDate ? Schema.toDate(value) : null;
    if (!parsed) return null;
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }

  function computeGoalRange(goal) {
    if (!goal) return null;
    let start = parseGoalDate(goal.startDate);
    let end = parseGoalDate(goal.endDate);
    if (!start && !end && goal.type === "hebdo") {
      const weekIndex = Number(goal.weekOfMonth || goal.weekIndex || 1);
      const range = Schema.weekDateRange(goal.monthKey, weekIndex);
      if (range?.start && range?.end) {
        start = Schema.startOfDay(range.start);
        end = Schema.endOfDay(range.end);
      }
    }
    if (!start && !end && goal.type === "mensuel") {
      const range = Schema.monthRangeFromKey(goal.monthKey);
      if (range) {
        start = range.start;
        end = range.end;
      }
    }
    if (!start && !end && goal.monthKey) {
      const range = Schema.monthRangeFromKey(goal.monthKey);
      if (range) {
        start = range.start;
        end = range.end;
      }
    }
    if (start && !end) {
      end = Schema.endOfDay(start);
    }
    if (!start && end) {
      start = Schema.startOfDay(end);
    }
    if (!start && !end) {
      return null;
    }
    return {
      start: Schema.startOfDay(start),
      end: Schema.endOfDay(end),
    };
  }

  function objectiveSummaryKeyFromPeriod(period) {
    if (!period) {
      return {
        key: "",
        label: "",
        start: null,
        end: null,
      };
    }
    const scope = typeof period.scope === "string" ? period.scope.toLowerCase() : "";

    const normalizeDate = (date) => {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return null;
      }
      return new Date(date.getTime());
    };

    const start = normalizeDate(period.start);
    const end = normalizeDate(period.end);
    let key = typeof period.key === "string" && period.key.trim() ? period.key.trim() : "";
    let label = "";

    const formatRangeLabel = (rangeStart, rangeEnd) => {
      if (!rangeStart || !rangeEnd) return "";
      const startLabel = rangeStart.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
      const endLabel = rangeEnd.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
      if (startLabel && endLabel) {
        if (startLabel === endLabel) return startLabel;
        return `${startLabel} → ${endLabel}`;
      }
      return "";
    };

    if (scope === "week" || scope === "weekly") {
      if (!key && typeof Schema?.weekKeyFromDate === "function") {
        const base = end || start || new Date();
        const weekEndsOn = Number.isFinite(period.weekEndsOn) ? period.weekEndsOn : 0;
        key = Schema.weekKeyFromDate(base, weekEndsOn);
      }
      const range = start && end
        ? { start, end }
        : Schema.weekRangeFromDate
        ? Schema.weekRangeFromDate(start || end || new Date(), Number.isFinite(period.weekEndsOn) ? period.weekEndsOn : 0)
        : null;
      label = formatRangeLabel(range?.start || start, range?.end || end);
      return {
        key,
        label,
        start: range?.start || start || null,
        end: range?.end || end || null,
      };
    }

    if (scope === "month" || scope === "monthly") {
      if (!key && typeof Schema?.monthKeyFromDate === "function") {
        const base = end || start || new Date();
        key = Schema.monthKeyFromDate(base);
      }
      const range = key && typeof Schema?.monthRangeFromKey === "function"
        ? Schema.monthRangeFromKey(key)
        : start && end
        ? { start, end }
        : null;
      const monthDate = (range?.start || start || end || new Date());
      const monthLabel = monthDate.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
      label = monthLabel ? monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1) : "";
      return {
        key,
        label,
        start: range?.start || start || null,
        end: range?.end || end || null,
      };
    }

    if (scope === "year" || scope === "yearly") {
      if (!key) {
        const base = end || start || new Date();
        key = String(base.getFullYear());
      }
      const yearNum = Number(key);
      const yearStart = new Date(yearNum, 0, 1);
      yearStart.setHours(0, 0, 0, 0);
      const yearEnd = new Date(yearNum, 11, 31);
      yearEnd.setHours(23, 59, 59, 999);
      label = String(yearNum);
      return {
        key,
        label,
        start: yearStart,
        end: yearEnd,
      };
    }

    if (!key && typeof Schema?.dayKeyFromDate === "function") {
      const base = end || start || new Date();
      key = Schema.dayKeyFromDate(base);
    }
    label = formatRangeLabel(start, end);
    return {
      key,
      label,
      start: start || null,
      end: end || null,
    };
  }

  function objectiveEntryDayKeyFromPeriod(period) {
    if (!period) return "";
    const fallback = new Date();
    const end = period.end instanceof Date && !Number.isNaN(period.end.getTime()) ? period.end : null;
    const start = period.start instanceof Date && !Number.isNaN(period.start.getTime()) ? period.start : null;
    let baseDate = end || start || fallback;

    const scope = typeof period?.scope === "string" ? period.scope.toLowerCase() : "";
    if (!end && scope === "week" && typeof Schema?.weekEndsOn === "number") {
      const candidate = Schema.weekRangeFromDate ? Schema.weekRangeFromDate(start || fallback, Schema.weekEndsOn) : null;
      if (candidate?.end instanceof Date && !Number.isNaN(candidate.end.getTime())) {
        baseDate = candidate.end;
      }
    }
    if (!end && (scope === "month" || scope === "monthly")) {
      const monthKey = typeof Schema?.monthKeyFromDate === "function"
        ? Schema.monthKeyFromDate(start || fallback)
        : null;
      const monthRange = monthKey && typeof Schema?.monthRangeFromKey === "function"
        ? Schema.monthRangeFromKey(monthKey)
        : null;
      if (monthRange?.end instanceof Date && !Number.isNaN(monthRange.end.getTime())) {
        baseDate = monthRange.end;
      }
    }
    if (!end && (scope === "year" || scope === "yearly")) {
      const year = (start || fallback).getFullYear();
      const lastDay = new Date(year, 11, 31);
      lastDay.setHours(23, 59, 59, 999);
      baseDate = lastDay;
    }

    if (typeof Schema?.dayKeyFromDate === "function") {
      try {
        return Schema.dayKeyFromDate(baseDate);
      } catch (error) {
        bilanLogger?.warn?.("bilan.objectives.dayKey", error);
      }
    }
    if (baseDate instanceof Date && !Number.isNaN(baseDate.getTime())) {
      const iso = new Date(baseDate.getTime());
      if (scope === "year" || scope === "yearly") {
        iso.setHours(0, 0, 0, 0);
      }
      return iso.toISOString().slice(0, 10);
    }
    return "";
  }

  function scopeFromPeriod(period) {
    const raw = typeof period?.scope === "string" ? period.scope.trim().toLowerCase() : "";
    if (raw === "week" || raw === "weekly") return "weekly";
    if (raw === "month" || raw === "monthly") return "monthly";
    if (raw === "year" || raw === "yearly" || raw === "annual") return "yearly";
    if (raw === "adhoc" || raw === "ponctuel" || raw === "ponctuelle") return "adhoc";
    return raw;
  }

  function normalizeObjectiveSummaryValue(consigne, value) {
    if (!consigne || consigne.family !== "objective") return null;
    if (value === null || value === undefined) return null;
    if (typeof value === "object") return null;
    const type = consigne.type;
    if (type === "likert6") {
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        const labelToNumeric = {
          yes: 5,
          rather_yes: 4,
          medium: 3,
          rather_no: 2,
          no: 1,
          no_answer: 0,
        };
        if (Object.prototype.hasOwnProperty.call(labelToNumeric, normalized)) {
          return labelToNumeric[normalized];
        }
      }
      const num = Number(value);
      if (Number.isFinite(num)) {
        return num;
      }
      return null;
    }
    if (type === "likert5" || type === "num") {
      const num = Number(value);
      if (Number.isFinite(num)) {
        return num;
      }
      return null;
    }
    if (type === "montant") {
      if (value && typeof value === "object") {
        const amount = value.amount ?? value.value ?? null;
        const num = Number(amount);
        if (Number.isFinite(num)) {
          return num;
        }
      }
      const num = Number(value);
      if (Number.isFinite(num)) {
        return num;
      }
      return null;
    }
    if (type === "yesno") {
      const normalized = String(value).trim().toLowerCase();
      if (!normalized) return null;
      if (["oui", "yes", "true"].includes(normalized)) return 5;
      if (["non", "no", "false"].includes(normalized)) return 1;
      return null;
    }
    if (typeof value === "string" && value.trim()) {
      const num = Number(value);
      if (Number.isFinite(num)) {
        return num;
      }
    }
    return null;
  }

  async function syncObjectiveEntryFromSummary(ctx, consigne, value, hasValue, period) {
    if (!consigne || consigne.family !== "objective") return;
    const db = ctx?.db;
    const uid = ctx?.user?.uid;
    if (!db || !uid) return;
    const goal = consigne.originalGoal || null;
    const objectiveId = goal?.id || consigne.id;
    if (!objectiveId) return;
    const periodInfo = objectiveSummaryKeyFromPeriod(period);
    const scopeKey = scopeFromPeriod(period);
    const storageKey = periodInfo?.key
      ? `${scopeKey || "period"}:${periodInfo.key}`
      : objectiveEntryDayKeyFromPeriod(period);
    if (!storageKey) return;
    try {
      if (!hasValue) {
        if (typeof Schema?.deleteObjectiveEntry === "function") {
          await Schema.deleteObjectiveEntry(db, uid, objectiveId, storageKey);
        } else if (typeof Schema?.saveObjectiveEntry === "function") {
          await Schema.saveObjectiveEntry(db, uid, objectiveId, storageKey, null);
        }
        return;
      }
      const normalizedValue = normalizeObjectiveSummaryValue(consigne, value);
      if (normalizedValue === null || normalizedValue === undefined) {
        return;
      }
      await Schema.saveObjectiveEntry(db, uid, objectiveId, storageKey, normalizedValue);
    } catch (error) {
      bilanLogger?.warn?.("bilan.objectives.sync", { error, objectiveId, key: storageKey });
    }
  }

  function objectiveMatchesScope(goal, period) {
    if (!period) return false;
    if (!goal) return false;
    if (period.scope === "week" && goal.type && goal.type !== "hebdo") {
      return false;
    }
    if (period.scope === "month" && goal.type === "hebdo") {
      return false;
    }
    const range = computeGoalRange(goal);
    if (!range) {
      return true;
    }
    if (period.start && range.end && range.end < period.start) {
      return false;
    }
    if (period.end && range.start && range.start > period.end) {
      return false;
    }
    return true;
  }

  function goalTypeLabel(goal) {
    if (!goal) return "Objectif";
    if (goal.type === "hebdo") return "Objectif hebdomadaire";
    if (goal.type === "mensuel") return "Objectif mensuel";
    if (goal.type === "annuel") return "Objectif annuel";
    return "Objectif";
  }

  function goalRangeLabel(goal, period) {
    const range = computeGoalRange(goal);
    if (!range) return "";
    if (goal.type === "hebdo") {
      const weekIndex = Number(goal.weekOfMonth || goal.weekIndex || 1);
      const weekRange = Schema.weekDateRange(goal.monthKey, weekIndex);
      if (weekRange?.label) return weekRange.label;
    }
    if (goal.type === "mensuel" && goal.monthKey) {
      const [yearStr, monthStr] = goal.monthKey.split("-");
      const year = Number(yearStr);
      const month = Number(monthStr) - 1;
      if (Number.isFinite(year) && Number.isFinite(month)) {
        const date = new Date(year, month, 1);
        const label = date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
        if (label) return label.charAt(0).toUpperCase() + label.slice(1);
      }
    }
    const startLabel = range.start?.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
    const endLabel = range.end?.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
    if (startLabel && endLabel) {
      if (startLabel === endLabel) return startLabel;
      return `${startLabel} → ${endLabel}`;
    }
    return "";
  }

  function isObjectiveActive(goal) {
    if (!goal) return false;
    if (goal.archived === true) return false;
    if (goal.active === false) return false;
    if (goal.deleted === true || goal.isDeleted === true) return false;
    if (goal.removed === true) return false;
    if (goal.disabled === true) return false;
    if (goal.deletedAt) return false;
    if (typeof goal.status === "string") {
      const normalizedStatus = goal.status.trim().toLowerCase();
      if (normalizedStatus === "archived" || normalizedStatus === "inactive" || normalizedStatus === "deleted") {
        return false;
      }
    }
    return true;
  }

  function normalizeObjectives(goals, period) {
    if (!Array.isArray(goals) || !goals.length) return [];
    return goals
      .filter((goal) => goal && goal.id && isObjectiveActive(goal) && objectiveMatchesScope(goal, period))
      .map((goal) => {
        const text = goal.titre || goal.title || goal.name || "Objectif";
        const subtitle = goalRangeLabel(goal, period) || goalTypeLabel(goal);
        const description = goal.description ? String(goal.description) : "";
        return {
          id: goal.id,
          text,
          type: "likert6",
          family: "objective",
          summaryCategory: goalTypeLabel(goal),
          summaryLabel: FAMILY_LABELS.objective,
          summaryMeta: { subtitle, description },
          priority: 2,
          checklistItems: [],
          checklistItemIds: [],
          originalGoal: goal,
        };
      });
  }

  async function loadObjectivesForPeriod(db, uid, period) {
    const monthKeys = monthKeysForPeriod(period);
    if (!monthKeys.length) return [];
    const results = await Promise.all(
      monthKeys.map((key) =>
        Schema.listObjectivesByMonth(db, uid, key).catch((error) => {
          bilanLogger?.warn?.("bilan.objectives.load", { key, error });
          return [];
        })
      )
    );
    const map = new Map();
    results.forEach((list) => {
      list.forEach((goal) => {
        if (goal?.id && !map.has(goal.id)) {
          map.set(goal.id, goal);
        }
      });
    });
    return normalizeObjectives(Array.from(map.values()), period);
  }

  async function loadConsignesForPeriod(db, uid, period) {
    const [daily, practice] = await Promise.all([
      Schema.fetchConsignes(db, uid, "daily").catch((error) => {
        bilanLogger?.warn?.("bilan.daily.load", error);
        return [];
      }),
      Schema.fetchConsignes(db, uid, "practice").catch((error) => {
        bilanLogger?.warn?.("bilan.practice.load", error);
        return [];
      }),
    ]);
    const objectives = await loadObjectivesForPeriod(db, uid, period).catch((error) => {
      bilanLogger?.warn?.("bilan.objectives.normalize", error);
      return [];
    });
    const normalizedDaily = normalizeConsignes(daily, "daily", period);
    const normalizedPractice = normalizeConsignes(practice, "practice", period);
    return {
      daily: normalizedDaily,
      practice: normalizedPractice,
      objective: objectives,
    };
  }

  function createConsigneRow(consigne, options = {}) {
    const previous = options.previous || null;
    const isChild = options.isChild === true;
    const ctx = options.ctx || null;
    const tone = Modes.priorityTone ? Modes.priorityTone(consigne.priority) : "medium";
    const row = document.createElement("div");
    row.className = `consigne-row priority-surface priority-surface-${tone}`;
    row.dataset.id = String(consigne.id || "");
    row.dataset.family = consigne.family || "";
    row.dataset.priorityTone = tone;
    if (isChild) {
      row.classList.add("consigne-row--child");
      if (consigne.parentId) {
        row.dataset.parentId = String(consigne.parentId);
      }
    } else {
      row.classList.add("consigne-row--parent");
    }
    const metaHtml = "";
    const isManageableFamily = ["daily", "practice", "objective"].includes(consigne.family);
    const actionsHtml = !isChild ? renderConsigneActionsMenu({ disableAdvanced: !isManageableFamily }) : "";
    const descriptionHtml = consigne.summaryMeta?.description
      ? `<p class="consigne-row__description text-sm text-[var(--muted)]">${escapeHtml(consigne.summaryMeta.description)}</p>`
      : "";
    const shouldRenderHistory = !isChild && consigne.family !== "objective";
    row.innerHTML = `
      <div class="consigne-row__header">
        <div class="consigne-row__main">
          <button type="button" class="consigne-row__toggle" data-consigne-open aria-haspopup="dialog">
            <span class="consigne-row__title">${escapeHtml(consigne.text)}</span>
            ${consigne?.summaryPeriodLabel ? `<span class="consigne-row__subtitle text-sm text-[var(--muted)]">${escapeHtml(consigne.summaryPeriodLabel)}</span>` : ""}
            ${typeof Modes.prioChip === "function" ? Modes.prioChip(Number(consigne.priority) || 2) : ""}
          </button>
        </div>
        <div class="consigne-row__meta">
          <span class="consigne-row__status" data-status="na">
            <button
              type="button"
              class="consigne-row__dot-button"
              data-priority-trigger
              aria-haspopup="true"
              aria-expanded="false"
              title="Changer la priorité"
            >
              <span class="consigne-row__dot consigne-row__dot--na" data-status-dot aria-hidden="true"></span>
            </button>
            <div class="consigne-row__priority-menu" data-priority-menu hidden></div>
            <span class="consigne-row__mark" data-status-mark aria-hidden="true"></span>
            <span class="sr-only" data-status-live aria-live="polite"></span>
          </span>
          ${metaHtml}
          ${actionsHtml}
        </div>
      </div>
      ${descriptionHtml}
      ${shouldRenderHistory ? `
      <div class="consigne-history" data-consigne-history hidden>
        <button type="button" class="consigne-history__nav" data-consigne-history-prev aria-label="Faire défiler l’historique vers la gauche" hidden><span aria-hidden="true">&lsaquo;</span></button>
        <button type="button" class="consigne-history__nav" data-consigne-history-more aria-label="Afficher des réponses plus anciennes" hidden><span aria-hidden="true">&hellip;</span></button>
        <div class="consigne-history__viewport" data-consigne-history-viewport>
          <div class="consigne-history__track" data-consigne-history-track role="list"></div>
        </div>
        <button type="button" class="consigne-history__nav" data-consigne-history-next aria-label="Faire défiler l’historique vers la droite" hidden><span aria-hidden="true">&rsaquo;</span></button>
      </div>
      ` : ""}
      <div class="consigne-row__body" data-consigne-input-holder></div>
    `;
    const holder = row.querySelector("[data-consigne-input-holder]");
    const initialValue = resolveAnswerValue(previous);
    if (holder) {
      holder.innerHTML = typeof Modes.inputForType === "function"
        ? Modes.inputForType(consigne, initialValue)
        : "";
      if (typeof Modes.enhanceRangeMeters === "function") {
        Modes.enhanceRangeMeters(holder);
      }
    }
    if (previous && typeof Modes.setConsigneRowValue === "function") {
      const hasExplicitValue = Object.prototype.hasOwnProperty.call(previous, "value");
      const looksLikeChecklistState = Array.isArray(previous.items);
      if (hasExplicitValue || looksLikeChecklistState) {
        let initial = previous;
        if (hasExplicitValue) {
          const numericValue = Number(previous.numericValue);
          if (consigne?.family === "objective" && Number.isFinite(numericValue)) {
            initial = numericValue;
          } else if (previous.value !== undefined) {
            initial = previous.value;
          }
        }
        Modes.setConsigneRowValue(row, consigne, initial);
      }
    }
    if (typeof Modes.bindConsigneRowValue === "function") {
      let lastSerialized = stableSerializeValue(initialValue);
      Modes.bindConsigneRowValue(row, consigne, {
        initialValue,
        onChange: (value) => {
          const serialized = stableSerializeValue(value);
          if (serialized === lastSerialized) {
            return;
          }
          lastSerialized = serialized;
          if (typeof options.onChange === "function") {
            options.onChange(value, { consigne, row });
          }
        },
      });
    }
    if (typeof Modes.attachConsigneEditor === "function") {
      try {
        Modes.attachConsigneEditor(row, consigne, options.editorConfig || {});
      } catch (error) {
        bilanLogger?.warn?.("bilan.attachConsigneEditor", error);
      }
    }
    if (typeof Modes.setupConsignePriorityMenu === "function") {
      try {
        Modes.setupConsignePriorityMenu(row, consigne, ctx);
      } catch (error) {
        bilanLogger?.warn?.("bilan.priorityMenu.setup", error);
      }
    }
    if (!isChild) {
      const actionsRoot = row.querySelector(".js-consigne-actions");
      const historyButton = actionsRoot?.querySelector(".js-history-action");
      const editButton = actionsRoot?.querySelector(".js-edit");
      const deleteButton = actionsRoot?.querySelector(".js-del");
      const delayButton = actionsRoot?.querySelector(".js-delay");
      const srToggleButton = actionsRoot?.querySelector(".js-sr-toggle");
      const removeSummaryButton = actionsRoot?.querySelector(".js-remove-summary");
      const editSummaryTextButton = actionsRoot?.querySelector(".js-edit-summary-text");
      if (typeof Modes.setupConsigneHistoryTimeline === "function") {
        try {
          Modes.setupConsigneHistoryTimeline(row, consigne, ctx, { mode: "bilan" });
        } catch (error) {
          bilanLogger?.warn?.("bilan.consigne.history", error);
        }
      }
      const closeMenuFromNode = typeof Modes.closeConsigneActionMenuFromNode === "function"
        ? Modes.closeConsigneActionMenuFromNode
        : () => {};
      const showToast = typeof Modes.showToast === "function" ? Modes.showToast : () => {};
      if (historyButton && ctx && typeof Modes.openHistory === "function") {
        historyButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          closeMenuFromNode(historyButton);
          Modes.openHistory(ctx, consigne);
        });
      }
      if (editButton) {
        if (!isManageableFamily || !ctx || typeof Modes.openConsigneForm !== "function") {
          editButton.disabled = true;
        } else {
          editButton.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeMenuFromNode(editButton);
            Modes.openConsigneForm(ctx, consigne);
          });
        }
      }
      if (deleteButton) {
        if (!isManageableFamily || !ctx) {
          deleteButton.disabled = true;
        } else {
          deleteButton.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeMenuFromNode(deleteButton);
            if (!window.confirm("Supprimer cette consigne ? (historique conservé)")) {
              return;
            }
            try {
              await Schema.softDeleteConsigne(ctx.db, ctx.user.uid, consigne.id);
              showToast("Consigne supprimée.");
              row.remove();
            } catch (error) {
              bilanLogger?.warn?.("bilan.consigne.delete", error);
              showToast("Impossible de supprimer la consigne.");
            }
          });
        }
      }
      let srEnabled = consigne?.srEnabled !== false;
      const updateDelayState = (enabled) => {
        if (!delayButton) return;
        const canDelay = isManageableFamily && consigne.family === "daily";
        delayButton.disabled = !canDelay || !enabled;
        delayButton.classList.toggle("opacity-50", !canDelay || !enabled);
        if (!canDelay) {
          delayButton.title = consigne.family === "practice"
            ? "Décalage disponible depuis l’onglet Pratique."
            : "Décalage indisponible pour cette consigne.";
        } else {
          delayButton.title = enabled
            ? "Décaler la prochaine apparition"
            : "Active la répétition espacée pour décaler";
        }
      };
      updateDelayState(srEnabled);
      if (delayButton && isManageableFamily && consigne.family === "daily" && ctx) {
        delayButton.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          closeMenuFromNode(delayButton);
          if (delayButton.disabled) {
            showToast("Active la répétition espacée pour utiliser le décalage.");
            return;
          }
          const raw = window.prompt("Décaler de combien de jours ?", "1");
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
          delayButton.disabled = true;
          try {
            await Schema.delayConsigne({
              db: ctx.db,
              uid: ctx.user.uid,
              consigne,
              mode: "daily",
              amount,
            });
            showToast(`Consigne décalée de ${amount} jour${amount > 1 ? "s" : ""}.`);
          } catch (error) {
            bilanLogger?.warn?.("bilan.consigne.delay", error);
            showToast("Impossible de décaler la consigne.");
          } finally {
            updateDelayState(srEnabled);
          }
        });
      }
      const canEditSummaryVisibility = isManageableFamily && consigne.family !== "objective" && ctx && ctx.db && ctx.user?.uid;
      if (removeSummaryButton) {
        removeSummaryButton.disabled = !canEditSummaryVisibility;
        removeSummaryButton.classList.toggle("opacity-50", !canEditSummaryVisibility);
        if (canEditSummaryVisibility) {
          removeSummaryButton.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeMenuFromNode(removeSummaryButton);
            try {
              await Schema.updateConsigne(ctx.db, ctx.user.uid, consigne.id, {
                weeklySummaryEnabled: false,
                monthlySummaryEnabled: false,
                yearlySummaryEnabled: false,
                summaryOnlyScope: null,
              });
              row.remove();
              showToast("Consigne retirée des bilans.");
            } catch (error) {
              bilanLogger?.warn?.("bilan.consigne.summary.remove", error);
              showToast("Impossible de retirer la consigne des bilans.");
            }
          });
        }
      }
      if (editSummaryTextButton) {
        const canEditSummaryText = canEditSummaryVisibility;
        editSummaryTextButton.disabled = !canEditSummaryText;
        editSummaryTextButton.classList.toggle("opacity-50", !canEditSummaryText);
        if (canEditSummaryText) {
          editSummaryTextButton.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeMenuFromNode(editSummaryTextButton);
            const currentSummaryText = consigne.summaryText || consigne.summaryCustomText || consigne.text || consigne.journalText || "";
            const next = window.prompt("Texte à afficher dans le bilan :", currentSummaryText);
            if (next === null) {
              return;
            }
            const trimmed = next.replace(/\s+/g, " ").trim();
            const payloadValue = trimmed ? trimmed : null;
            try {
              await Schema.updateConsigne(ctx.db, ctx.user.uid, consigne.id, {
                summaryCustomText: payloadValue,
              });
              consigne.summaryCustomText = payloadValue || "";
              consigne.summaryText = payloadValue || consigne.journalText || consigne.text || "";
              const titleEl = row.querySelector(".consigne-row__title");
              if (titleEl) {
                titleEl.textContent = consigne.summaryText;
              }
              showToast(payloadValue ? "Texte du bilan mis à jour." : "Texte du bilan réinitialisé.");
            } catch (error) {
              bilanLogger?.warn?.("bilan.consigne.summaryText.update", error);
              showToast("Impossible de mettre à jour le texte du bilan.");
            }
          });
        }
      }
      if (actionsRoot && typeof Modes.setupConsigneActionMenus === "function") {
        const config = isManageableFamily && ctx && ctx.db && ctx.user?.uid && srToggleButton && !srToggleButton.disabled
          ? () => ({
            srToggle: {
              getEnabled: () => srEnabled,
              onToggle: async (next) => {
                try {
                  await Schema.updateConsigne(ctx.db, ctx.user.uid, consigne.id, { srEnabled: next });
                  srEnabled = next;
                  updateDelayState(srEnabled);
                  return srEnabled;
                } catch (error) {
                  bilanLogger?.warn?.("bilan.consigne.sr", error);
                  showToast("Impossible de mettre à jour la répétition espacée.");
                  return srEnabled;
                }
              },
            },
          })
          : undefined;
        Modes.setupConsigneActionMenus(row, config);
      }
    }
    return row;
  }

  function renderItemsInChunks(container, items, answersMap, options = {}) {
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "text-sm text-[var(--muted)]";
      empty.textContent = "Aucune consigne active.";
      container.appendChild(empty);
      return;
    }
    const batchSize = 8;
    let index = 0;
    const renderBatch = () => {
      const slice = items.slice(index, index + batchSize);
      slice.forEach((entry) => {
        const key = summaryKey(entry.consigne);
        const previous = answersMap.get(key) || null;
        const childConsignes = Array.isArray(entry.children)
          ? entry.children.filter(Boolean)
          : [];
        const childConfigs = childConsignes.map((child) => {
          const childKey = summaryKey(child);
          const childPrevious = answersMap.get(childKey) || null;
          const childInitialValue = resolveAnswerValue(childPrevious);
          const parentId = entry.consigne?.id || null;
          const childRow = createVirtualChildRow(child, childInitialValue, parentId);
          if (childRow && typeof Modes.bindConsigneRowValue === "function") {
            let lastChildSerialized = stableSerializeValue(childInitialValue);
            Modes.bindConsigneRowValue(childRow, child, {
              initialValue: childInitialValue,
              onChange: (value) => {
                const serialized = stableSerializeValue(value);
                if (serialized === lastChildSerialized) {
                  return;
                }
                lastChildSerialized = serialized;
                if (typeof options.onChange === "function") {
                  options.onChange(value, {
                    consigne: child,
                    row: childRow,
                    key: childKey,
                    parentConsigne: entry.consigne,
                  });
                }
              },
            });
          }
          return { consigne: child, row: childRow };
        });
        const baseEditorConfig = typeof options.editorConfig === "function"
          ? options.editorConfig(entry.consigne, childConfigs)
          : options.editorConfig || {};
        const baseValidateLabel =
          typeof baseEditorConfig.validateButtonLabel === "string" && baseEditorConfig.validateButtonLabel.trim()
            ? baseEditorConfig.validateButtonLabel.trim()
            : null;
        const editorConfig = {
          ...baseEditorConfig,
          childConsignes: [
            ...((Array.isArray(baseEditorConfig.childConsignes) && baseEditorConfig.childConsignes) || []),
            ...childConfigs,
          ],
          summaryControlsEnabled: false,
          validateButtonLabel: baseValidateLabel || "Valider le bilan",
        };
        const row = createConsigneRow(entry.consigne, {
          previous,
          editorConfig,
          ctx: options.ctx || null,
          onChange: (value, ctx) => {
            if (typeof options.onChange === "function") {
              options.onChange(value, { ...ctx, key });
            }
          },
        });
        container.appendChild(row);
      });
      index += slice.length;
      if (index < items.length) {
        window.requestAnimationFrame(renderBatch);
      } else if (typeof window.ensureRichTextModalCheckboxBehavior === "function") {
        window.ensureRichTextModalCheckboxBehavior();
      }
    };
    renderBatch();
  }

  function buildFamilySection(container, family, data, answersMap, options = {}) {
    const items = Array.isArray(data) ? data : [];
    const sorted = sortConsignes(items);
    const grouped = typeof Modes.groupConsignes === "function"
      ? Modes.groupConsignes(sorted)
      : sorted.map((consigne) => ({ consigne, children: [] }));
    const categoriesOrder = [];
    const categoriesMap = new Map();
    grouped.forEach((entry) => {
      const rawLabel = (entry?.consigne?.summaryCategory || entry?.consigne?.category || "Général").trim();
      const categoryLabel = rawLabel || "Général";
      let bucket = categoriesMap.get(categoryLabel);
      if (!bucket) {
        bucket = { label: categoryLabel, groups: [] };
        categoriesMap.set(categoryLabel, bucket);
        categoriesOrder.push(bucket);
      }
      bucket.groups.push(entry);
    });
    const processedCategories = categoriesOrder.map((category) => {
      const flattened = flattenConsigneGroups(category.groups);
      const count = category.groups.reduce((acc, group) => {
        const childrenCount = Array.isArray(group?.children) ? group.children.length : 0;
        return acc + 1 + childrenCount;
      }, 0);
      return { ...category, flattened, count };
    });
    const totalCount = processedCategories.reduce((acc, category) => acc + category.count, 0);
    if (!totalCount) {
      return;
    }
    const section = document.createElement("section");
    section.className = "daily-category daily-grid__item";
    if (family) {
      section.classList.add(`daily-category--${family}`);
    }
    section.dataset.family = family || "";
    const label = FAMILY_LABELS[family] || family;
    const decor = FAMILY_DECOR[family] || {};
    const iconHtml = decor.icon
      ? `<span class="daily-category__icon" aria-hidden="true">${escapeHtml(decor.icon)}</span>`
      : "";
    section.innerHTML = `
      <div class="daily-category__header">
        <div class="daily-category__name">
          ${iconHtml}
          <span class="daily-category__title-text">${escapeHtml(label)}</span>
        </div>
        <span class="daily-category__count">${totalCount} consigne${totalCount > 1 ? "s" : ""}</span>
      </div>
    `;
    if (decor.intro) {
      const intro = document.createElement("p");
      intro.className = "daily-category__intro";
      intro.textContent = decor.intro;
      section.appendChild(intro);
    }
    const stack = document.createElement("div");
    stack.className = "daily-category__items";
    section.appendChild(stack);
    container.appendChild(section);
    const handleValueChange = (value, ctx) => {
      if (typeof options.onValueChange === "function") {
        options.onValueChange(ctx.consigne, value, ctx.row, ctx.key);
      }
    };
    processedCategories.forEach((category) => {
      if (!category.flattened.length) {
        return;
      }
      const group = document.createElement("details");
      group.className = "daily-category__group";
      group.dataset.category = category.label;
      if (family !== "practice") {
        group.setAttribute("open", "");
      }
      if (family === "objective") {
        group.classList.add("daily-category__group--objective");
      }
      const header = document.createElement("summary");
      header.className = "daily-category__group-header";
      header.innerHTML = `
        <h3 class="daily-category__group-title">${escapeHtml(category.label)}</h3>
        <span class="daily-category__group-count">${category.count} élément${category.count > 1 ? "s" : ""}</span>
        <span class="daily-category__toggle" aria-hidden="true"></span>
      `;
      const groupItems = document.createElement("div");
      groupItems.className = "daily-category__group-items";
      group.appendChild(header);
      group.appendChild(groupItems);
      stack.appendChild(group);
      renderItemsInChunks(groupItems, category.flattened, answersMap, {
        onChange: handleValueChange,
        ctx: options.ctx || null,
      });
    });
  }

  function buildSummarySaver(ctx, period, answersMap) {
    const pending = new Map();
    const normalizedSummaryScope = period.scope === "week"
      ? "weekly"
      : period.scope === "month"
      ? "monthly"
      : period.scope || "";
    const extras = { weekEndsOn: period.weekEndsOn, summaryScope: normalizedSummaryScope };
    if (period.scope === "week" && period.key) {
      extras.weekKey = period.key;
    }
    if (period.scope === "month" && period.key) {
      extras.monthKey = period.key;
    }
    const summaryDayKey = typeof Schema?.dayKeyFromDate === "function"
      ? Schema.dayKeyFromDate(period?.end || period?.start || new Date())
      : "";
    const metadata = {
      start: period.start,
      end: period.end,
      label: period.label,
      extras,
      moduleId: "bilan",
      summaryDayKey: summaryDayKey || undefined,
    };

    const summaryLabel = normalizedSummaryScope === "monthly"
      ? "Bilan mensuel"
      : normalizedSummaryScope === "weekly"
      ? "Bilan hebdomadaire"
      : normalizedSummaryScope === "yearly"
      ? "Bilan annuel"
      : normalizedSummaryScope === "adhoc"
      ? "Bilan ponctuel"
      : "Bilan";

    const persist = async (consigne, value, row, key) => {
      if (!ctx?.db || !ctx?.user?.uid || !key) return;
      const hasValue = typeof Modes.hasValueForConsigne === "function"
        ? Modes.hasValueForConsigne(consigne, value)
        : !(value === null || value === undefined || value === "");
      const isObjective = consigne?.family === "objective";
      const periodInfo = isObjective ? objectiveSummaryKeyFromPeriod(period) : null;
      const objectiveStorageKey = isObjective && periodInfo?.key
        ? `${normalizedSummaryScope || scopeFromPeriod(period) || "period"}:${periodInfo.key}`
        : null;

      const baseAnswer = {
        id: key,
        key,
        consigneId: consigne?.id || null,
        family: consigne?.family || null,
        type: consigne?.type || null,
        summaryScope: normalizedSummaryScope || null,
        summaryLabel,
        label: consigne?.summaryLabel || consigne?.text || null,
        category: consigne?.summaryCategory || consigne?.category || null,
      };
      if (isObjective && periodInfo) {
        baseAnswer.summaryPeriodKey = objectiveStorageKey || null;
        baseAnswer.summaryPeriodLabel = periodInfo.label || null;
      }

      if (hasValue) {
        answersMap.set(key, { ...baseAnswer, value });
      } else {
        answersMap.delete(key);
      }

      const metadataExtras = { ...(metadata.extras || {}) };
      if (isObjective && periodInfo) {
        if (periodInfo.key) {
          metadataExtras.summaryPeriodKey = objectiveStorageKey || periodInfo.key;
        }
        if (periodInfo.label) {
          metadataExtras.summaryPeriodLabel = periodInfo.label;
        }
        if (periodInfo.start instanceof Date && !Number.isNaN(periodInfo.start.getTime())) {
          metadataExtras.summaryPeriodStart = periodInfo.start.toISOString();
        }
        if (periodInfo.end instanceof Date && !Number.isNaN(periodInfo.end.getTime())) {
          metadataExtras.summaryPeriodEnd = periodInfo.end.toISOString();
        }
      }
      const metadataForPersist = {
        ...metadata,
        summaryLabel,
        extras: metadataExtras,
      };
      if (isObjective) {
        if (metadataForPersist.summaryDayKey !== undefined) {
          delete metadataForPersist.summaryDayKey;
        }
        if (objectiveStorageKey) {
          metadataForPersist.summaryPeriodKey = objectiveStorageKey;
        }
        if (periodInfo?.label) {
          metadataForPersist.summaryPeriodLabel = periodInfo.label;
        }
      }

      try {
        if (!hasValue) {
          await Schema.deleteSummaryAnswer(
            ctx.db,
            ctx.user.uid,
            period.scope,
            period.key,
            key,
            metadataForPersist,
          );
          try {
            const responseId = typeof Schema?.buildSummaryResponseId === "function"
              ? Schema.buildSummaryResponseId(period.scope, period.key, key, baseAnswer.consigneId)
              : null;
            const status = typeof Modes?.dotColor === "function"
              ? Modes.dotColor(consigne.type, "", consigne) || "na"
              : "na";
            if (typeof Modes?.updateConsigneHistoryTimeline === "function" && row) {
              Modes.updateConsigneHistoryTimeline(row, status, {
                consigne,
                value: "",
                dayKey: isObjective ? (objectiveStorageKey || periodInfo?.key || "") : (summaryDayKey || ""),
                summaryScope: normalizedSummaryScope,
                summaryLabel,
                summaryPeriod: period?.key || undefined,
                periodKey: period?.key || undefined,
                historyId: responseId || undefined,
                responseId: responseId || undefined,
                isBilan: true,
                remove: true,
              });
            try {
              if (typeof Modes?.triggerConsigneRowUpdateHighlight === "function") {
                Modes.triggerConsigneRowUpdateHighlight(row);
              }
            } catch (_) {}
            }
        } catch (error) {
          bilanLogger?.warn?.("bilan.summary.history.remove", error);
          try {
            if (typeof Modes?.showToast === "function") {
              Modes.showToast("Historique du bilan non mis à jour.");
            }
          } catch (_) {}
          }
          await syncObjectiveEntryFromSummary(ctx, consigne, value, false, period);
          return;
        }

        await Schema.saveSummaryAnswers(
          ctx.db,
          ctx.user.uid,
          period.scope,
          period.key,
          [
            {
              key,
              consigneId: baseAnswer.consigneId,
              family: baseAnswer.family,
              type: baseAnswer.type,
              value,
              summaryScope: baseAnswer.summaryScope,
              summaryLabel: baseAnswer.summaryLabel,
              label: baseAnswer.label,
              category: baseAnswer.category,
            },
          ],
          metadataForPersist,
        );
        try {
          const responseId = typeof Schema?.buildSummaryResponseId === "function"
            ? Schema.buildSummaryResponseId(period.scope, period.key, key, baseAnswer.consigneId)
            : null;
          const status = typeof Modes?.dotColor === "function"
            ? Modes.dotColor(consigne.type, value, consigne) || "na"
            : "na";
          if (typeof Modes?.updateConsigneHistoryTimeline === "function" && row) {
            Modes.updateConsigneHistoryTimeline(row, status, {
              consigne,
              value,
              dayKey: isObjective ? (objectiveStorageKey || periodInfo?.key || "") : (summaryDayKey || ""),
              summaryScope: normalizedSummaryScope,
              summaryLabel,
              summaryPeriod: period?.key || undefined,
              periodKey: period?.key || undefined,
              historyId: responseId || undefined,
              responseId: responseId || undefined,
              isBilan: true,
            });
            try {
              if (typeof Modes?.triggerConsigneRowUpdateHighlight === "function") {
                Modes.triggerConsigneRowUpdateHighlight(row);
              }
            } catch (_) {}
          }
        } catch (error) {
          bilanLogger?.warn?.("bilan.summary.history.update", error);
        }
        await syncObjectiveEntryFromSummary(ctx, consigne, value, true, period);
      } catch (error) {
        bilanLogger?.error?.("bilan.summary.persist", { error, key });
        try {
          if (typeof Modes?.showToast === "function") {
            Modes.showToast("Impossible de rafraîchir l’historique du bilan.");
          }
        } catch (_) {}
      }
    };

    return (consigne, value, row, key) => {
      if (!consigne || !key) return;
      const existing = pending.get(key);
      if (existing?.timer) {
        window.clearTimeout(existing.timer);
      }
      const timer = window.setTimeout(() => {
        pending.delete(key);
        persist(consigne, value, row, key);
      }, 240);
      pending.set(key, { timer, value });
    };
  }

  async function renderSummary(options) {
    const ctx = options?.ctx;
    const entry = options?.entry;
    const mount = options?.mount;
    if (!mount) return;
    mount.innerHTML = "";
    const period = computePeriodFromEntry(entry);
    if (!period?.key) {
      const err = document.createElement("p");
      err.className = "text-sm text-[var(--muted)]";
      err.textContent = "Période de bilan introuvable.";
      mount.appendChild(err);
      return;
    }
    if (!ctx?.db || !ctx?.user?.uid) {
      const warn = document.createElement("p");
      warn.className = "text-sm text-[var(--muted)]";
      warn.textContent = "Connecte-toi pour voir le bilan.";
      mount.appendChild(warn);
      return;
    }
    if (ctx?.db && ctx?.user?.uid) {
      try {
        const objectivesForPeriod = await loadObjectivesForPeriod(ctx.db, ctx.user.uid, period);
        await Promise.all(
          objectivesForPeriod.map((consigne) =>
            Schema.migrateObjectiveEntriesForObjective(ctx.db, ctx.user.uid, consigne.originalGoal || { id: consigne.id, type: consigne.type }),
          ),
        );
      } catch (migrationError) {
        bilanLogger?.warn?.("bilan.objectives.migrate", migrationError);
      }
    }
    const loading = document.createElement("p");
    loading.className = "text-sm text-[var(--muted)]";
    loading.textContent = "Chargement des consignes…";
    mount.appendChild(loading);
    let sectionsData = null;
    let answersMap = new Map();
    const normalizedSummaryScope = period.scope === "week"
      ? "weekly"
      : period.scope === "month"
      ? "monthly"
      : period.scope === "year"
      ? "yearly"
      : period.scope || "";
    const summaryLabel = normalizedSummaryScope === "monthly"
      ? "Bilan mensuel"
      : normalizedSummaryScope === "weekly"
      ? "Bilan hebdomadaire"
      : normalizedSummaryScope === "yearly"
      ? "Bilan annuel"
      : normalizedSummaryScope === "adhoc"
      ? "Bilan ponctuel"
      : "Bilan";

    try {
      if (options.sections) {
        sectionsData = normalizeSectionsData(options.sections, period);
      }
      if (!sectionsData) {
        sectionsData = await loadConsignesForPeriod(ctx.db, ctx.user.uid, period);
      }
      answersMap = await Schema.loadSummaryAnswers(ctx.db, ctx.user.uid, period.scope, period.key);
      if (!(answersMap instanceof Map)) {
        if (answersMap && typeof answersMap === "object") {
          const entries = Array.isArray(answersMap)
            ? answersMap
            : Object.entries(answersMap);
          answersMap = new Map(entries);
        } else {
          answersMap = new Map();
        }
      }
      if (
        Array.isArray(sectionsData?.objective) &&
        sectionsData.objective.length &&
        typeof Schema?.getObjectiveEntry === "function"
      ) {
        const periodInfo = objectiveSummaryKeyFromPeriod(period);
        const scopeKey = scopeFromPeriod(period);
        const storageKey = periodInfo?.key
          ? `${scopeKey || "period"}:${periodInfo.key}`
          : objectiveEntryDayKeyFromPeriod(period);
        if (ctx?.db && ctx?.user?.uid) {
          await Promise.all(
            sectionsData.objective.map(async (consigne) => {
              if (!consigne) return;
              const key = summaryKey(consigne);
              const objectiveId = consigne?.originalGoal?.id || consigne?.id;
              if (!objectiveId) return;
              try {
                let entry = null;
                const candidateKeys = [];
                if (storageKey) {
                  candidateKeys.push(storageKey);
                }
                const fallbackKey = objectiveEntryDayKeyFromPeriod(period);
                if (fallbackKey && (!storageKey || fallbackKey !== storageKey)) {
                  candidateKeys.push(fallbackKey);
                }
                const rangeStart = periodInfo?.start instanceof Date && !Number.isNaN(periodInfo.start.getTime())
                  ? periodInfo.start
                  : period.start instanceof Date && !Number.isNaN(period.start.getTime())
                  ? period.start
                  : null;
                const rangeEnd = periodInfo?.end instanceof Date && !Number.isNaN(periodInfo.end.getTime())
                  ? periodInfo.end
                  : period.end instanceof Date && !Number.isNaN(period.end.getTime())
                  ? period.end
                  : null;
                if (rangeStart && rangeEnd && rangeEnd >= rangeStart) {
                  const cursor = new Date(rangeStart.getTime());
                  while (cursor <= rangeEnd) {
                    const dayKey = typeof Schema?.dayKeyFromDate === "function"
                      ? Schema.dayKeyFromDate(cursor)
                      : cursor.toISOString().slice(0, 10);
                    if (!candidateKeys.includes(dayKey)) {
                      candidateKeys.push(dayKey);
                    }
                    cursor.setDate(cursor.getDate() + 1);
                    cursor.setHours(0, 0, 0, 0);
                  }
                }

                for (const candidateKey of candidateKeys) {
                  try {
                    entry = await Schema.getObjectiveEntry(
                      ctx.db,
                      ctx.user.uid,
                      objectiveId,
                      candidateKey,
                    );
                    if (entry && entry.v !== undefined && entry.v !== null) {
                      break;
                    }
                  } catch (candidateError) {
                    bilanLogger?.warn?.("bilan.objectives.prefill.candidate", {
                      error: candidateError,
                      objectiveId,
                      key: candidateKey,
                    });
                  }
                }

                const rawValue = entry && Object.prototype.hasOwnProperty.call(entry, "v")
                  ? entry.v
                  : entry?.value ?? entry?.val ?? null;
                const normalizedValue = normalizeObjectiveSummaryValue(consigne, rawValue);
                const normalizedNumeric = Number.isFinite(Number(normalizedValue))
                  ? Number(normalizedValue)
                  : null;
                let labelValue = typeof Schema?.objectiveLikertLabelFromValue === "function"
                  ? Schema.objectiveLikertLabelFromValue(normalizedNumeric)
                  : null;
                if (labelValue === null || labelValue === undefined || labelValue === "") {
                  labelValue = normalizedNumeric;
                }
                bilanLogger?.info?.("bilan.objectives.entry", {
                  objectiveId,
                  consigneId: consigne?.id || null,
                  rawValue,
                  normalizedValue,
                  labelValue,
                  candidateKeys,
                });
                if (normalizedNumeric === null || normalizedNumeric === undefined) {
                  return;
                }

                const previousAnswer = answersMap.get(key);
                const previousNumericValue = typeof previousAnswer?.numericValue === "number"
                  ? previousAnswer.numericValue
                  : Number.isFinite(Number(previousAnswer?.value))
                  ? Number(previousAnswer.value)
                  : null;
                const previousLabelValue = previousAnswer?.value ?? null;
                const needsUpdate = Number.isFinite(normalizedNumeric)
                  ? !Number.isFinite(previousNumericValue) || normalizedNumeric !== previousNumericValue
                  : labelValue !== previousLabelValue;

                if (needsUpdate && periodInfo?.key) {
                  const summaryKeyEntry = key;
                  const baseLabel = consigne?.summaryLabel || consigne?.text || consigne?.journalText || consigne?.id || "Objectif";
                  const metadata = {
                    start: periodInfo.start,
                    end: periodInfo.end,
                    label: periodInfo.label,
                    moduleId: "bilan",
                    summaryPeriodKey: periodInfo.key,
                    summaryPeriodLabel: periodInfo.label,
                    summaryScope: normalizedSummaryScope,
                    extras: {
                      summaryScope: normalizedSummaryScope,
                      summaryPeriodKey: periodInfo.key,
                      summaryPeriodLabel: periodInfo.label,
                    },
                  };
                  let overrideSucceeded = false;
                  try {
                    await Schema.saveSummaryAnswers(
                      ctx.db,
                      ctx.user.uid,
                      period.scope,
                      period.key,
                      [
                        {
                          key: summaryKeyEntry,
                          consigneId: consigne?.id || null,
                          family: consigne?.family || null,
                          type: consigne?.type || null,
                          value: labelValue,
                          summaryScope: normalizedSummaryScope || null,
                          summaryLabel,
                          label: baseLabel,
                          category: consigne?.summaryCategory || consigne?.category || null,
                          summaryPeriodKey: periodInfo.key,
                          summaryPeriodLabel: periodInfo.label,
                        },
                      ],
                      metadata,
                    );
                    overrideSucceeded = true;
                  } catch (summarySyncError) {
                    bilanLogger?.warn?.("bilan.objectives.summaryOverride", {
                      error: summarySyncError,
                      objectiveId,
                      period: periodInfo.key,
                    });
                  }
                  if (overrideSucceeded) {
                    bilanLogger?.info?.("bilan.objectives.summaryOverride", {
                      objectiveId,
                      consigneId: consigne?.id || null,
                      periodKey: periodInfo.key,
                      before: {
                        numeric: previousNumericValue ?? null,
                        label: previousLabelValue ?? null,
                      },
                      after: {
                        numeric: normalizedNumeric,
                        label: labelValue,
                      },
                    });
                  }
                }

                answersMap.set(key, {
                  id: key,
                  key,
                  consigneId: consigne?.id || null,
                  family: consigne?.family || null,
                  type: consigne?.type || null,
                  value: labelValue,
                  numericValue: normalizedNumeric,
                  summaryScope: normalizedSummaryScope || null,
                  summaryLabel,
                  label: consigne?.summaryLabel || consigne?.text || null,
                  category: consigne?.summaryCategory || consigne?.category || null,
                });
                bilanLogger?.info?.("bilan.objectives.answersMap", {
                  key,
                  entry: answersMap.get(key),
                });
              } catch (error) {
                bilanLogger?.warn?.("bilan.objectives.prefill", {
                  error,
                  objectiveId,
                  key: storageKey,
                });
              }
            }),
          );
        }
      }
    } catch (error) {
      bilanLogger?.error?.("bilan.render.load", error);
    }
    mount.innerHTML = "";
    const totalItems = FAMILY_ORDER.reduce((acc, family) => acc + (sectionsData?.[family]?.length || 0), 0);
    if (!totalItems) {
      const empty = document.createElement("p");
      empty.className = "text-sm text-[var(--muted)]";
      empty.textContent = "Aucune consigne active pour cette période.";
      mount.appendChild(empty);
      return;
    }
    const grid = document.createElement("div");
    grid.className = "daily-grid";
    mount.appendChild(grid);

    const onValueChange = buildSummarySaver(ctx, period, answersMap);
    FAMILY_ORDER.forEach((family) => {
      const familyData = Array.isArray(sectionsData?.[family]) ? sectionsData[family] : [];
      if (family === "objective" && familyData.length) {
        const periodInfo = objectiveSummaryKeyFromPeriod(period);
        familyData.forEach((consigne) => {
          if (!consigne || typeof consigne !== "object") return;
          if (periodInfo?.label) {
            consigne.summaryPeriodLabel = periodInfo.label;
          }
          if (periodInfo?.key) {
            consigne.summaryPeriodKey = periodInfo.key;
          }
          if (periodInfo?.start instanceof Date && !Number.isNaN(periodInfo.start.getTime())) {
            consigne.summaryPeriodStart = periodInfo.start;
          }
          if (periodInfo?.end instanceof Date && !Number.isNaN(periodInfo.end.getTime())) {
            consigne.summaryPeriodEnd = periodInfo.end;
          }
        });
      }
      buildFamilySection(grid, family, familyData, answersMap, {
        onValueChange,
        ctx,
      });
    });
  }

  BilanNS.renderSummary = renderSummary;
})();
