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

  const FAMILY_ORDER = ["daily", "practice", "objective"];
  const FAMILY_LABELS = {
    daily: "Journalier",
    practice: "Pratique",
    objective: "Objectifs",
  };

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
      if (!group) return;
      if (group.consigne) {
        flattened.push({ consigne: group.consigne, isChild: false });
      }
      if (Array.isArray(group.children) && group.children.length) {
        group.children.forEach((child) => {
          flattened.push({ consigne: child, isChild: true });
        });
      }
    });
    return flattened;
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

  function createRow(consigne, options = {}) {
    const previous = options.previous || null;
    const isChild = options.isChild === true;
    const tone = Modes.priorityTone ? Modes.priorityTone(consigne.priority) : "medium";
    const row = document.createElement("div");
    row.className = `consigne-row priority-surface priority-surface-${tone}`;
    row.dataset.id = String(consigne.id || "");
    row.dataset.family = consigne.family || "";
    if (isChild) {
      row.classList.add("consigne-row--child");
      if (consigne.parentId) {
        row.dataset.parentId = String(consigne.parentId);
      }
    } else {
      row.classList.add("consigne-row--parent");
    }
    const metaParts = [];
    if (consigne.summaryMeta?.subtitle) {
      metaParts.push(consigne.summaryMeta.subtitle);
    } else if (consigne.summaryCategory) {
      metaParts.push(consigne.summaryCategory);
    }
    const metaHtml = metaParts.length
      ? `<span class="consigne-row__meta-text text-xs text-[var(--muted)]">${escapeHtml(metaParts.join(" • "))}</span>`
      : "";
    const descriptionHtml = consigne.summaryMeta?.description
      ? `<p class="consigne-row__description text-sm text-[var(--muted)]">${escapeHtml(consigne.summaryMeta.description)}</p>`
      : "";
    row.innerHTML = `
      <div class="consigne-row__header">
        <div class="consigne-row__main">
          <span class="consigne-row__title">${escapeHtml(consigne.text)}</span>
        </div>
        <div class="consigne-row__meta">${metaHtml}</div>
      </div>
      ${descriptionHtml}
      <div class="consigne-row__body" data-consigne-input-holder></div>
    `;
    const holder = row.querySelector("[data-consigne-input-holder]");
    if (holder) {
      const initialValue = previous && Object.prototype.hasOwnProperty.call(previous, "value")
        ? previous.value
        : previous?.v ?? null;
      holder.innerHTML = typeof Modes.inputForType === "function"
        ? Modes.inputForType(consigne, initialValue)
        : "";
      if (typeof Modes.enhanceRangeMeters === "function") {
        Modes.enhanceRangeMeters(holder);
      }
    }
    return row;
  }

  function renderItemsInChunks(container, items, answersMap) {
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
        const row = createRow(entry.consigne, { previous, isChild: entry.isChild });
        container.appendChild(row);
      });
      index += slice.length;
      if (index < items.length) {
        window.requestAnimationFrame(renderBatch);
      }
    };
    renderBatch();
  }

  function buildFamilySection(form, family, data, answersMap, registry) {
    const items = Array.isArray(data) ? data : [];
    const sorted = sortConsignes(items);
    const groups = typeof Modes.groupConsignes === "function"
      ? Modes.groupConsignes(sorted)
      : sorted.map((consigne) => ({ consigne, children: [] }));
    const flattened = flattenConsigneGroups(groups);
    flattened.forEach((entry) => {
      registry.push(entry.consigne);
    });
    const section = document.createElement("section");
    section.className = "daily-category daily-grid__item";
    const label = FAMILY_LABELS[family] || family;
    const count = flattened.length;
    section.innerHTML = `
      <div class="daily-category__header">
        <div class="daily-category__name">${escapeHtml(label)}</div>
        <span class="daily-category__count">${count} consigne${count > 1 ? "s" : ""}</span>
      </div>
    `;
    const stack = document.createElement("div");
    stack.className = "daily-category__items";
    section.appendChild(stack);
    form.appendChild(section);
    renderItemsInChunks(stack, flattened, answersMap);
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
      sectionsData = await loadConsignesForPeriod(ctx.db, ctx.user.uid, period);
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
    const form = document.createElement("form");
    form.className = "daily-grid";
    mount.appendChild(form);
    const registry = [];
    FAMILY_ORDER.forEach((family) => {
      buildFamilySection(form, family, sectionsData?.[family] || [], answersMap, registry);
    });
    const actions = document.createElement("div");
    actions.className = "flex justify-end daily-grid__item daily-grid__actions";
    actions.innerHTML = `<button type="submit" class="btn btn-primary">Enregistrer</button>`;
    form.appendChild(actions);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitBtn = form.querySelector("button[type=submit]");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Enregistrement…";
      }
      try {
        const answers = typeof Modes.collectAnswers === "function"
          ? Modes.collectAnswers(form, registry)
          : [];
        const payload = answers.map((answer) => ({
          key: summaryKey(answer.consigne),
          consigneId: answer.consigne?.id || null,
          family: answer.consigne?.family || null,
          type: answer.consigne?.type || null,
          value: answer.value,
          label: answer.consigne?.text || null,
          category: answer.consigne?.summaryCategory || answer.consigne?.category || null,
        }));
        const extras = { weekEndsOn: period.weekEndsOn };
        if (period.scope === "week" && period.key) {
          extras.weekKey = period.key;
        }
        if (period.scope === "month" && period.key) {
          extras.monthKey = period.key;
        }
        await Schema.saveSummaryAnswers(ctx.db, ctx.user.uid, period.scope, period.key, payload, {
          start: period.start,
          end: period.end,
          label: period.label,
          extras,
        });
        payload.forEach((item) => {
          answersMap.set(item.key, { id: item.key, value: item.value, type: item.type, family: item.family });
        });
        if (typeof Modes.showToast === "function") {
          Modes.showToast(payload.length ? "Bilan enregistré" : "Bilan enregistré (aucune réponse)");
        }
      } catch (error) {
        bilanLogger?.error?.("bilan.save.error", error);
        if (typeof alert === "function") {
          alert("Impossible d'enregistrer le bilan.");
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Enregistrer";
        }
      }
    });
  }

  BilanNS.renderSummary = renderSummary;
})();
