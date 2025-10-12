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
    return null;
  }

  function normalizeConsignes(consignes, family) {
    if (!Array.isArray(consignes) || !consignes.length) return [];
    return consignes
      .map((consigne) => {
        if (!consigne || !consigne.id) return null;
        const text = consigne.text || consigne.titre || consigne.name || consigne.id;
        return {
          ...consigne,
          family,
          text,
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
      daily: normalizeConsignes(sections.daily || [], "daily"),
      practice: normalizeConsignes(sections.practice || [], "practice"),
      objective: [],
    };
    if (Array.isArray(sections.objective) && sections.objective.length) {
      const alreadyNormalized = sections.objective.every((item) => item && item.family === "objective");
      normalized.objective = alreadyNormalized
        ? sections.objective.slice()
        : normalizeObjectives(sections.objective, period);
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

  function renderConsigneActionsMenu() {
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
          <button type="button" class="btn btn-ghost text-sm text-left js-history-action" role="menuitem">Historique</button>
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

  function normalizeObjectives(goals, period) {
    if (!Array.isArray(goals) || !goals.length) return [];
    return goals
      .filter((goal) => goal && goal.id && objectiveMatchesScope(goal, period))
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
    const normalizedDaily = normalizeConsignes(daily, "daily");
    const normalizedPractice = normalizeConsignes(practice, "practice");
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
    const actionsHtml = !isChild ? renderConsigneActionsMenu() : "";
    const descriptionHtml = consigne.summaryMeta?.description
      ? `<p class="consigne-row__description text-sm text-[var(--muted)]">${escapeHtml(consigne.summaryMeta.description)}</p>`
      : "";
    row.innerHTML = `
      <div class="consigne-row__header">
        <div class="consigne-row__main">
          <button type="button" class="consigne-row__toggle" data-consigne-open aria-haspopup="dialog">
            <span class="consigne-row__title">${escapeHtml(consigne.text)}</span>
            ${typeof Modes.prioChip === "function" ? Modes.prioChip(Number(consigne.priority) || 2) : ""}
          </button>
        </div>
        <div class="consigne-row__meta">
          <span class="consigne-row__status" data-status="na">
            <span class="consigne-row__dot consigne-row__dot--na" data-status-dot aria-hidden="true"></span>
            <span class="consigne-row__mark" data-status-mark aria-hidden="true"></span>
            <span class="sr-only" data-status-live aria-live="polite"></span>
          </span>
          ${metaHtml}
          ${actionsHtml}
        </div>
      </div>
      ${descriptionHtml}
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
        const initial = hasExplicitValue && previous.value !== undefined ? previous.value : previous;
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
    if (!isChild) {
      const actionsRoot = row.querySelector(".js-consigne-actions");
      const historyButton = actionsRoot?.querySelector(".js-history-action");
      if (historyButton && ctx && typeof Modes.openHistory === "function") {
        historyButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (typeof Modes.closeConsigneActionMenuFromNode === "function") {
            Modes.closeConsigneActionMenuFromNode(historyButton);
          }
          Modes.openHistory(ctx, consigne);
        });
      }
      if (actionsRoot && typeof Modes.setupConsigneActionMenus === "function") {
        Modes.setupConsigneActionMenus(row);
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
    const metadata = {
      start: period.start,
      end: period.end,
      label: period.label,
      extras,
      moduleId: "bilan",
    };

    const summaryLabel = normalizedSummaryScope === "monthly"
      ? "Bilan mensuel"
      : normalizedSummaryScope === "weekly"
      ? "Bilan hebdomadaire"
      : "Bilan";

    const persist = async (consigne, value, row, key) => {
      if (!ctx?.db || !ctx?.user?.uid || !key) return;
      const hasValue = typeof Modes.hasValueForConsigne === "function"
        ? Modes.hasValueForConsigne(consigne, value)
        : !(value === null || value === undefined || value === "");

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

      if (hasValue) {
        answersMap.set(key, { ...baseAnswer, value });
      } else {
        answersMap.delete(key);
      }

      const metadataForPersist = { ...metadata, summaryLabel };

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
      } catch (error) {
        bilanLogger?.error?.("bilan.summary.persist", { error, key });
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
    const loading = document.createElement("p");
    loading.className = "text-sm text-[var(--muted)]";
    loading.textContent = "Chargement des consignes…";
    mount.appendChild(loading);
    let sectionsData = null;
    let answersMap = new Map();
    try {
      if (options.sections) {
        sectionsData = normalizeSectionsData(options.sections, period);
      }
      if (!sectionsData) {
        sectionsData = await loadConsignesForPeriod(ctx.db, ctx.user.uid, period);
      }
      answersMap = await Schema.loadSummaryAnswers(ctx.db, ctx.user.uid, period.scope, period.key);
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
      buildFamilySection(grid, family, sectionsData?.[family] || [], answersMap, {
        onValueChange,
        ctx,
      });
    });
  }

  BilanNS.renderSummary = renderSummary;
})();
