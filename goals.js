// goals.js — Objectifs timeline
/* global Schema, Goals */
(() => {
  const GoalsNS = (window.Goals = window.Goals || {});
  if (GoalsNS.__initialized) {
    return;
  }
  GoalsNS.__initialized = true;
  const goalsLogger = Schema.D || { info: () => {}, group: () => {}, groupEnd: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

  let lastMount = null;
  let lastCtx = null;
  let activeReminderPopover = null;
  let detachReminderOutsideHandlers = null;
  const goalDragState = {
    activeId: null,
    sourceList: null,
    startOrder: [],
  };

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return new Date(value.getTime());
    if (typeof value.toDate === "function") {
      try {
        const asDate = value.toDate();
        if (asDate instanceof Date && !Number.isNaN(asDate.getTime())) {
          return asDate;
        }
      } catch (err) {
        goalsLogger.warn("goals.toDate", err);
      }
    }
    if (typeof value === "number") {
      const asDate = new Date(value);
      if (!Number.isNaN(asDate.getTime())) return asDate;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        const [year, month, day] = trimmed.split("-").map(Number);
        const asDate = new Date(year, (month || 1) - 1, day || 1);
        if (!Number.isNaN(asDate.getTime())) return asDate;
      }
      const asDate = new Date(trimmed);
      if (!Number.isNaN(asDate.getTime())) return asDate;
    }
    return null;
  }

  function formatDateInputValue(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function isoValueFromAny(value) {
    if (!value) return "";
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
      const parsed = toDate(trimmed);
      return formatDateInputValue(parsed);
    }
    const parsed = toDate(value);
    return formatDateInputValue(parsed);
  }

  function shortDowLabelFromIso(iso) {
    if (!iso || typeof iso !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(iso)) {
      return "";
    }
    const [y, m, d] = iso.split("-").map(Number);
    const date = new Date(y, (m || 1) - 1, d || 1);
    if (Number.isNaN(date.getTime())) return "";
    const dow = date.toLocaleDateString("fr-FR", { weekday: "short" });
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    return `${dow} ${dd}/${mm}`; // ex: lun. 28/10
  }

  function isEmailEnabled(goal) {
    if (!goal || goal.notifyOnTarget === false) return false;
    const raw = String(goal.notifyChannel || "").toLowerCase();
    return raw === "email" || raw === "both" || raw === "email+push" || raw === "push+email";
  }

  const REMINDER_ICON_MAIL = '<svg class="goal-reminder-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 7l9 6 9-6"></path></svg>';
  const REMINDER_ICON_MAIL_CHECK = '<svg class="goal-reminder-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 7l9 6 9-6"></path><path d="M9.5 13.5l2.2 2.2 3.8-3.8"></path></svg>';

  function reminderIconHtml(goal) {
    return isEmailEnabled(goal) ? REMINDER_ICON_MAIL_CHECK : REMINDER_ICON_MAIL;
  }

  function goalCssEscape(value) {
    if (typeof value !== "string") return "";
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return value.replace(/["\\]/g, "\\$&");
  }

  function selectGoalRowById(list, id) {
    if (!list || !id) return null;
    const escaped = goalCssEscape(id);
    if (!escaped) return null;
    try {
      return list.querySelector(`[data-goal-id="${escaped}"]`);
    } catch (_error) {
      return list.querySelector(`[data-goal-id="${id}"]`);
    }
  }

  function captureGoalOrder(list) {
    if (!list) return [];
    return Array.from(list.querySelectorAll("[data-goal-id]"))
      .map((node) => node.dataset.goalId)
      .filter(Boolean);
  }

  function applyOrderToList(list, orderedIds) {
    if (!list || !Array.isArray(orderedIds)) return;
    const nodes = orderedIds
      .map((id) => selectGoalRowById(list, id))
      .filter(Boolean);
    nodes.forEach((node) => list.appendChild(node));
  }

  function ensureGoalDragSource(button) {
    if (!button || button.dataset.goalDragBound === "1") return;
    button.dataset.goalDragBound = "1";
    button.setAttribute("draggable", "true");
  }

  function clearGoalDragVisuals() {
    const list = goalDragState.sourceList;
    if (list) {
      list.classList.remove("goal-list--dragging");
    }
    if (list && goalDragState.activeId) {
      const row = selectGoalRowById(list, goalDragState.activeId);
      if (row) {
        row.classList.remove("is-dragging");
      }
    }
  }

  async function persistGoalOrder(list, orderedIds, previousOrder = []) {
    if (!lastCtx || !Array.isArray(orderedIds) || !orderedIds.length) return;
    if (typeof Schema.updateObjectiveOrders !== "function") {
      goalsLogger.warn("goals.reorder.unsupported");
      return;
    }
    const updates = orderedIds
      .map((id, index) => (id ? { id, order: (index + 1) * 1000 } : null))
      .filter(Boolean);
    if (!updates.length) return;
    try {
      await Schema.updateObjectiveOrders(lastCtx.db, lastCtx.user.uid, updates);
    } catch (error) {
      goalsLogger.warn("goals.reorder.save", error);
      if (previousOrder && previousOrder.length) {
        applyOrderToList(list, previousOrder);
      }
      alert("Impossible d'enregistrer l'ordre des objectifs.");
    }
  }

  function enableGoalDragAndDrop(list) {
    if (!list || list.dataset.goalDnd === "1") return;
    list.dataset.goalDnd = "1";

    const handleDragStart = (event) => {
      const source = event.target.closest("[data-goal-drag-source]");
      if (!source) return;
      const row = source.closest("[data-goal-id]");
      if (!row || !row.dataset.goalId) return;
      if (!list.contains(row)) return;
      goalDragState.activeId = row.dataset.goalId;
      goalDragState.sourceList = list;
      goalDragState.startOrder = captureGoalOrder(list);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        try {
          event.dataTransfer.setData("text/plain", goalDragState.activeId);
        } catch (_error) {}
      }
      row.classList.add("is-dragging");
      list.classList.add("goal-list--dragging");
    };

    const handleDragOver = (event) => {
      if (!goalDragState.activeId || goalDragState.sourceList !== list) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      const overRow = event.target.closest("[data-goal-id]");
      const draggingRow = selectGoalRowById(list, goalDragState.activeId);
      if (!draggingRow) return;
      if (!overRow || overRow === draggingRow) return;
      const rect = overRow.getBoundingClientRect();
      const before = event.clientY - rect.top < rect.height / 2;
      if (before) {
        list.insertBefore(draggingRow, overRow);
      } else if (overRow.nextSibling) {
        list.insertBefore(draggingRow, overRow.nextSibling);
      } else {
        list.appendChild(draggingRow);
      }
    };

    const handleDrop = (event) => {
      if (!goalDragState.activeId || goalDragState.sourceList !== list) return;
      event.preventDefault();
      const previousOrder = goalDragState.startOrder.slice();
      clearGoalDragVisuals();
      const nextOrder = captureGoalOrder(list);
      const changed = JSON.stringify(nextOrder) !== JSON.stringify(previousOrder);
      goalDragState.activeId = null;
      goalDragState.sourceList = null;
      goalDragState.startOrder = [];
      if (changed) {
        persistGoalOrder(list, nextOrder, previousOrder);
      }
    };

    const handleDragEnd = () => {
      if (!goalDragState.activeId || goalDragState.sourceList !== list) return;
      const previousOrder = goalDragState.startOrder.slice();
      clearGoalDragVisuals();
      if (previousOrder.length) {
        applyOrderToList(list, previousOrder);
      }
      goalDragState.activeId = null;
      goalDragState.sourceList = null;
      goalDragState.startOrder = [];
    };

    list.addEventListener("dragstart", handleDragStart);
    list.addEventListener("dragover", handleDragOver);
    list.addEventListener("drop", handleDrop);
    list.addEventListener("dragend", handleDragEnd);
  }

  function compareGoals(a = {}, b = {}) {
    const parseOrder = (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };
    const orderA = parseOrder(a?.order);
    const orderB = parseOrder(b?.order);
    if (orderA !== null && orderB !== null && orderA !== orderB) {
      return orderA - orderB;
    }
    if (orderA !== null && orderB === null) return -1;
    if (orderA === null && orderB !== null) return 1;
    const titleA = String(a?.titre || "");
    const titleB = String(b?.titre || "");
    return titleA.localeCompare(titleB, "fr", { sensitivity: "base" });
  }

  function sortGoals(goals = []) {
    return (goals || []).slice().sort(compareGoals);
  }

  function detachReminderHandlers() {
    if (typeof detachReminderOutsideHandlers === "function") {
      detachReminderOutsideHandlers();
      detachReminderOutsideHandlers = null;
    }
  }

  function closeReminderPopover(pop) {
    if (!pop) return;
    pop.setAttribute("hidden", "");
    if (activeReminderPopover === pop) {
      detachReminderHandlers();
      activeReminderPopover = null;
    }
  }

  function openReminderPopover(pop, anchor) {
    if (!pop) return;
    if (activeReminderPopover && activeReminderPopover !== pop) {
      closeReminderPopover(activeReminderPopover);
    }
    detachReminderHandlers();
    pop.removeAttribute("hidden");
    const handlePointerDown = (event) => {
      if (pop.contains(event.target)) return;
      if (anchor && anchor.contains(event.target)) return;
      closeReminderPopover(pop);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeReminderPopover(pop);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    detachReminderOutsideHandlers = () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
    activeReminderPopover = pop;
  }

  function applyGoalRowMeta(row, goal) {
    if (!row || !goal) return;
    // Date pill + tooltip on calendar
    const notifyIso = isoValueFromAny(goal?.notifyAt || "");
    const theoretical = computeTheoreticalGoalDate(goal);
    const theoreticalIso = formatDateInputValue(theoretical);
    const effectiveIso = notifyIso || theoreticalIso || "";
    const dateBtn = row.querySelector("[data-open-date],[data-open-reminder]");
    const datePill = row.querySelector("[data-date-pill]");
    const prettyFull = (() => {
      if (!effectiveIso) return "Configurer le rappel";
      const [y, m, d] = effectiveIso.split("-").map(Number);
      const dt = new Date(y, (m || 1) - 1, d || 1);
      return dt.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    })();
    const shortLabel = shortDowLabelFromIso(effectiveIso) || "—";
    if (dateBtn) {
      const emailEnabled = isEmailEnabled(goal);
      dateBtn.title = `Jour du rappel: ${prettyFull}`;
      dateBtn.setAttribute("aria-pressed", emailEnabled ? "true" : "false");
      dateBtn.dataset.emailState = emailEnabled ? "on" : "off";
    }
    if (datePill) {
      datePill.textContent = shortLabel;
      datePill.setAttribute("aria-label", prettyFull);
      datePill.title = prettyFull;
    }
    const iconWrap = row.querySelector("[data-reminder-icon]");
    if (iconWrap) {
      iconWrap.innerHTML = reminderIconHtml(goal);
    }
    const dragSource = row.querySelector("[data-goal-drag-source]");
    if (dragSource) {
      ensureGoalDragSource(dragSource);
    }
    // No separate mail pill anymore (merged into reminder button)
    // Subtitle in case type/week changed
    const subtitleEl = row.querySelector(".goal-title__subtitle");
    if (subtitleEl) {
      const subtitleText = goal.type === "hebdo" ? "" : typeLabel(goal, goal.monthKey);
      subtitleEl.textContent = subtitleText;
      if (subtitleText) {
        subtitleEl.removeAttribute("hidden");
      } else {
        subtitleEl.setAttribute("hidden", "");
      }
    }
    // Title text
    const titleText = row.querySelector(".goal-title__text");
    if (titleText && goal.titre) {
      titleText.textContent = goal.titre;
    }
  }

  function parseMonthKey(monthKey) {
    const [yearStr, monthStr] = String(monthKey || "").split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    return { year, month };
  }

  function computeTheoreticalGoalDate(goal) {
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

  function computeGoalDateRange(goal) {
    if (!goal) {
      return { start: null, end: null };
    }

    const normalize = (value) => {
      const parsed = toDate(value);
      if (!parsed) return null;
      parsed.setHours(0, 0, 0, 0);
      return parsed;
    };

    const explicitStart = normalize(goal.startDate);
    const explicitEnd = normalize(goal.endDate);
    if (explicitStart || explicitEnd) {
      return {
        start: explicitStart || (explicitEnd ? new Date(explicitEnd.getTime()) : null),
        end: explicitEnd || (explicitStart ? new Date(explicitStart.getTime()) : null),
      };
    }

    if (goal.type === "hebdo") {
      const range = Schema.weekDateRange(goal.monthKey, goal.weekOfMonth || goal.weekIndex || 1);
      if (range?.start instanceof Date && range?.end instanceof Date) {
        const start = new Date(range.start.getTime());
        start.setHours(0, 0, 0, 0);
        const end = new Date(range.end.getTime());
        end.setHours(0, 0, 0, 0);
        return { start, end };
      }
    }

    if (goal.type === "mensuel") {
      const parsed = parseMonthKey(goal.monthKey);
      if (parsed) {
        const year = parsed.year;
        const month = parsed.month;
        if (Number.isFinite(year) && Number.isFinite(month)) {
          const start = new Date(year, month - 1, 1);
          start.setHours(0, 0, 0, 0);
          const end = new Date(year, month, 0);
          end.setHours(0, 0, 0, 0);
          return { start, end };
        }
      }
    }

    const theoretical = computeTheoreticalGoalDate(goal);
    if (theoretical instanceof Date && !Number.isNaN(theoretical.getTime())) {
      const start = new Date(theoretical.getTime());
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime());
      return { start, end };
    }

    return { start: null, end: null };
  }

  function formatGoalDateLabel(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    const raw = date.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "";
  }

  function monthShift(monthKey, offset) {
    const [year, month] = monthKey.split("-").map(Number);
    const base = new Date(year || 1970, (month || 1) - 1 + offset, 1);
    return Schema.monthKeyFromDate(base);
  }

  function typeLabel(goal, monthKey) {
    if (goal.type === "hebdo") {
      const range = Schema.weekDateRange(monthKey || goal.monthKey, Number(goal.weekOfMonth || 1));
      return range?.label || `Semaine ${goal.weekOfMonth || "?"}`;
    }
    if (goal.type === "mensuel") {
      return "Mensuel";
    }
    return goal.type || "Objectif";
  }

  async function renderGoals(ctx, root) {
    lastMount = root;
    lastCtx = ctx;
    root.innerHTML = "";

    const section = document.createElement("section");
    section.className = "card";
    section.style.display = "flex";
    section.style.flexDirection = "column";
    section.style.gap = "12px";
    section.style.padding = "16px";
    root.appendChild(section);

    const navUpWrap = document.createElement("div");
    navUpWrap.className = "goal-nav goal-nav--up";
    navUpWrap.innerHTML = `
      <button type="button" class="goal-nav-button" data-nav-up aria-label="Mois précédent">▲</button>
    `;
    section.appendChild(navUpWrap);

    const timeline = document.createElement("div");
    timeline.className = "goal-timeline";
    timeline.setAttribute("role", "region");
    timeline.setAttribute("aria-live", "polite");
    section.appendChild(timeline);

    const navDownWrap = document.createElement("div");
    navDownWrap.className = "goal-nav goal-nav--down";
    navDownWrap.innerHTML = `
      <button type="button" class="goal-nav-button" data-nav-down aria-label="Mois suivant">▼</button>
    `;
    section.appendChild(navDownWrap);
    let activeMonthKey = null;

    const toneClasses = ["goal-row--positive", "goal-row--neutral", "goal-row--negative", "goal-row--none"];

    const startInlineTitleEdit = (row, goal) => {
      if (!row || !goal) return;
      if (row.classList.contains("is-editing")) return;
      row.classList.add("is-editing");
      const titleWrap = row.querySelector(".goal-title");
      const textEl = row.querySelector(".goal-title__text");
      const subtitleEl = row.querySelector(".goal-title__subtitle");
      if (!titleWrap || !textEl) return;

      const original = textEl.textContent || "";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "goal-input goal-input--inline";
      input.value = original;
      input.placeholder = "Titre de l’objectif";

      const actions = document.createElement("div");
      actions.className = "goal-inline-actions";
      const btnSave = document.createElement("button");
      btnSave.type = "button";
      btnSave.className = "btn btn-primary btn-compact";
      btnSave.textContent = "Enregistrer";
      const btnCancel = document.createElement("button");
      btnCancel.type = "button";
      btnCancel.className = "btn btn-ghost btn-compact";
      btnCancel.textContent = "Annuler";
      actions.appendChild(btnSave);
      actions.appendChild(btnCancel);

      // Replace content with editor
      const editContainer = document.createElement("div");
      editContainer.className = "goal-inline-editor";
      editContainer.appendChild(input);
      editContainer.appendChild(actions);
      titleWrap.innerHTML = "";
      titleWrap.appendChild(editContainer);

      const finish = () => {
        row.classList.remove("is-editing");
        // restore compact title line with actions on the right
        const notifyIso = isoValueFromAny(goal?.notifyAt || "");
        const theoretical = computeTheoreticalGoalDate(goal);
        const theoreticalIso = formatDateInputValue(theoretical);
        const effectiveIso = notifyIso || theoreticalIso || "";
        const effectiveLabel = (() => {
          if (!effectiveIso) return "Configurer le rappel";
          const parts = effectiveIso.split("-").map(Number);
          const d = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
          return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
        })();
        const emailEnabled = isEmailEnabled(goal);
        const subtitleText = goal.type === "hebdo" ? "" : typeLabel(goal, goal.monthKey);
        titleWrap.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px; width:100%">
            <button type="button" class="goal-title__button" data-edit-goal data-goal-drag-source style="flex:1; text-align:left;" draggable="true">
              <span class="goal-title__text">${escapeHtml(goal.titre || "Objectif")}</span>
              <span class="goal-title__subtitle text-xs text-[var(--muted)]"${subtitleText ? "" : " hidden"}>${escapeHtml(subtitleText)}</span>
            </button>
            <div class="goal-actions" style="display:flex; align-items:center; gap:6px;">
              <button type="button" class="btn btn-ghost goal-reminder-btn" data-open-reminder data-email-state="${emailEnabled ? "on" : "off"}" aria-pressed="${emailEnabled ? "true" : "false"}" title="Rappel par email et jour" style="display:flex; align-items:center; gap:6px;" draggable="false">
                <span class="goal-reminder-icon-wrap" data-reminder-icon>${reminderIconHtml(goal)}</span>
                <span class="goal-date-pill text-xs muted" data-date-pill>${escapeHtml(effectiveLabel)}</span>
              </button>
              <button type="button" class="btn btn-ghost goal-advanced" title="Options avancées" data-open-advanced draggable="false">⚙️</button>
            </div>
          </div>
        `;
        const editButton = titleWrap.querySelector("[data-edit-goal]");
        if (editButton) {
          editButton.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            startInlineTitleEdit(row, goal);
          });
        }
        const advBtn = titleWrap.querySelector("[data-open-advanced]");
        if (advBtn) {
          advBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            openGoalForm(ctx, goal);
          });
        }
        // archive action déplacée dans le formulaire avancé
        const reminderBtn = titleWrap.querySelector("[data-open-reminder]");
        if (reminderBtn) {
          reminderBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleReminderPopover(row, goal, reminderBtn);
          });
        }
        const dragSource = titleWrap.querySelector("[data-goal-drag-source]");
        if (dragSource) {
          ensureGoalDragSource(dragSource);
        }
      };

      const doSave = async () => {
        const titre = input.value.trim();
        if (!titre) {
          input.focus();
          return;
        }
        try {
          await Schema.upsertObjective(
            ctx.db,
            ctx.user.uid,
            {
              titre,
              type: goal.type,
              monthKey: goal.monthKey,
              ...(goal.type === "hebdo" ? { weekOfMonth: goal.weekOfMonth || 1 } : {}),
            },
            goal.id
          );
          goal.titre = titre; // update local
          finish();
          if (window.__appBadge && typeof window.__appBadge.refresh === "function") {
            window.__appBadge.refresh(ctx.user?.uid).catch(() => {});
          }
        } catch (err) {
          goalsLogger.error("goals.inlineEdit.save", err);
          alert("Impossible d'enregistrer le titre de l’objectif.");
        }
      };

      btnSave.addEventListener("click", doSave);
      btnCancel.addEventListener("click", () => finish());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          doSave();
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish();
        }
      });
      setTimeout(() => {
        input.focus();
        try { input.select(); } catch (_e) {}
      }, 0);
    };

    const createGoalRow = (goal, subtitleOverride = null) => {
      const row = document.createElement("div");
      row.className = "goal-row goal-row--editable";
      row.classList.add("goal-row--draggable");
      row.style.position = "relative";
      if (goal?.id) {
        row.dataset.goalId = String(goal.id);
      }
      const maybeSubtitle = subtitleOverride || typeLabel(goal, goal.monthKey);
      const subtitle = goal.type === "hebdo" ? "" : maybeSubtitle;
      // Effective reminder date label
      const notifyIso = isoValueFromAny(goal?.notifyAt || "");
      const theoretical = computeTheoreticalGoalDate(goal);
      const theoreticalIso = formatDateInputValue(theoretical);
      const effectiveIso = notifyIso || theoreticalIso || "";
      const effectiveLabel = shortDowLabelFromIso(effectiveIso) || "—";
      const emailEnabled = isEmailEnabled(goal);

      row.innerHTML = `
        <div class="goal-title" style="display:flex; align-items:center; gap:8px;">
          <button type="button" class="goal-title__button" data-edit-goal data-goal-drag-source style="flex:1; text-align:left;" draggable="true">
            <span class="goal-title__text">${escapeHtml(goal.titre || "Objectif")}</span>
            <span class="goal-title__subtitle text-xs text-[var(--muted)]"${subtitle ? "" : " hidden"}>${escapeHtml(subtitle)}</span>
          </button>
          <div class="goal-actions" style="display:flex; align-items:center; gap:6px;">
            <button type="button" class="btn btn-ghost goal-reminder-btn" data-open-reminder data-email-state="${emailEnabled ? "on" : "off"}" aria-pressed="${emailEnabled ? "true" : "false"}" title="Rappel par email et jour" style="display:flex; align-items:center; gap:6px;" draggable="false">
              <span class="goal-reminder-icon-wrap" data-reminder-icon>${reminderIconHtml(goal)}</span>
              <span class="goal-date-pill text-xs muted" data-date-pill>${escapeHtml(effectiveLabel)}</span>
            </button>
            <button type="button" class="btn btn-ghost goal-advanced" title="Options avancées" data-open-advanced draggable="false">⚙️</button>
          </div>
        </div>
        <div class="goal-quick">
          <select class="select-compact">
            <option value="">— choisir —</option>
            <option value="5">Oui</option>
            <option value="4">Plutôt oui</option>
            <option value="3">Neutre</option>
            <option value="2">Plutôt non</option>
            <option value="1">Non</option>
            <option value="0">Pas de réponse</option>
          </select>
        </div>
      `;
      const dragSource = row.querySelector("[data-goal-drag-source]");
      if (dragSource) {
        ensureGoalDragSource(dragSource);
      }
      const subtitleEl = row.querySelector(".goal-title__subtitle");
      if (subtitleEl && !subtitle) {
        subtitleEl.setAttribute("hidden", "");
      }
      const select = row.querySelector("select");
      const applyTone = (raw) => {
        row.classList.remove(...toneClasses);
        if (raw === "") return;
        const value = Number(raw);
        if (Number.isNaN(value)) return;
        if (value >= 4) {
          row.classList.add("goal-row--positive");
        } else if (value === 3) {
          row.classList.add("goal-row--neutral");
        } else if (value === 0) {
          row.classList.add("goal-row--none");
        } else {
          row.classList.add("goal-row--negative");
        }
      };

      select.addEventListener("change", async () => {
        select.dataset.userModified = "1";
        if (select.value === "") {
          row.classList.remove(...toneClasses);
          return;
        }
        const todayIso = new Date().toISOString().slice(0, 10);
        try {
          await Schema.saveObjectiveEntry(
            ctx.db,
            ctx.user.uid,
            goal.id,
            todayIso,
            Number(select.value || 0)
          );
          if (window.__appBadge && typeof window.__appBadge.refresh === "function") {
            window.__appBadge.refresh(ctx.user?.uid).catch(() => {});
          }
          applyTone(select.value);
        } catch (err) {
          goalsLogger.error("goals.quickEntry.error", err);
          row.classList.add("goal-row--negative");
          setTimeout(() => applyTone(select.value), 600);
        }
      });
      applyTone(select.value || "");

      const hydrateSavedValue = async () => {
        if (!ctx?.db || !ctx?.user?.uid) return;
        try {
          const entries = await Schema.loadObjectiveEntriesRange(ctx.db, ctx.user.uid, goal.id);
          if (!Array.isArray(entries) || !entries.length) return;
          const sorted = entries
            .slice()
            .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
          const latest = sorted[sorted.length - 1];
          if (!latest || latest.v === undefined || latest.v === null) return;
          if (select.dataset.userModified === "1") return;
          const raw = String(latest.v);
          if (select.value === raw) {
            applyTone(raw);
            return;
          }
          select.value = raw;
          applyTone(raw);
        } catch (error) {
          goalsLogger.warn("goals.quickEntry.prefill", error);
        }
      };
      hydrateSavedValue();

      const editButton = row.querySelector("[data-edit-goal]");
      if (editButton) {
        editButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          startInlineTitleEdit(row, goal);
        });
      }
      const advBtn = row.querySelector("[data-open-advanced]");
      if (advBtn) {
        advBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openGoalForm(ctx, goal);
        });
      }

      // Archive button removed from inline actions (moved into advanced modal)

      // Quick date popover
      const reminderBtn = row.querySelector("[data-open-reminder]");
      if (reminderBtn) {
        reminderBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleReminderPopover(row, goal, reminderBtn);
        });
      }

      // Apply meta to ensure latest labels/titles
      applyGoalRowMeta(row, goal);

      return row;
    };

    // Expose row factory to outer helpers (inline creator)
    GoalsNS.__createGoalRow = createGoalRow;

    const renderMonth = async (monthKey) => {
      const box = document.createElement("section");
      box.className = "goal-month";
      box.dataset.month = monthKey;
      const monthDate = (() => {
        const [y, m] = monthKey.split("-").map(Number);
        return Number.isFinite(y) && Number.isFinite(m) ? new Date(y, (m || 1) - 1, 1) : new Date();
      })();
      const localeLabel = monthDate.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
      const label = localeLabel.charAt(0).toUpperCase() + localeLabel.slice(1);
      const currentMonthKey = Schema.monthKeyFromDate(new Date());
      if (monthKey === currentMonthKey) {
        box.classList.add("goal-month--current");
      }

      const headerRow = document.createElement("div");
      headerRow.className = "goal-month__header";
      headerRow.innerHTML = `
        <h3 class="goal-month__title">${escapeHtml(label)}</h3>
        <button type="button" class="goal-month__add btn btn-ghost" data-add-month>＋ Ajouter un objectif</button>
      `;
      box.appendChild(headerRow);

      // Inline creator for monthly objectives
      headerRow.querySelector("[data-add-month]").addEventListener("click", () => {
        ensureMonthlyInlineCreator(box, monthKey);
      });

      const weeks = Schema.weeksOf(monthKey);
      const containers = new Map();
      const weekBlocks = [];
      weeks.forEach((week) => {
        const weekBox = document.createElement("div");
        weekBox.className = "goal-week";
        weekBox.dataset.week = String(week);
        const range = Schema.weekDateRange(monthKey, week);
        const header = document.createElement("div");
        header.className = "goal-week__header";
        header.innerHTML = `
          <div class="goal-week__label muted">${escapeHtml(range?.label || `Semaine ${week}`)}</div>
          <button type="button" class="goal-week__add btn btn-ghost" data-week="${week}">＋ Ajouter</button>
        `;
        const list = document.createElement("div");
        list.className = "goal-list";
        weekBox.appendChild(header);
        weekBox.appendChild(list);
        containers.set(week, list);
        weekBlocks.push(weekBox);
        enableGoalDragAndDrop(list);

        header.querySelector("[data-week]").addEventListener("click", () => {
          ensureWeeklyInlineCreator(list, monthKey, week);
        });
      });

      let goals = [];
      try {
        goals = await Schema.listObjectivesByMonth(ctx.db, ctx.user.uid, monthKey);
      } catch (err) {
        goalsLogger.error("goals.month.load", err);
      }

      // Exclure les objectifs archivés
      goals = sortGoals((goals || []).filter((g) => g && g.archived !== true));

      let hasContent = false;
      const monthlyGoals = goals.filter((goal) => goal.type !== "hebdo");
      if (monthlyGoals.length) {
        const monthlyBlock = document.createElement("div");
        monthlyBlock.className = "goal-monthly";
        monthlyBlock.innerHTML = `<div class="goal-monthly__title">Objectifs du mois</div>`;
        const monthlyList = document.createElement("div");
        monthlyList.className = "goal-list";
        monthlyList.dataset.monthList = monthKey;
        monthlyGoals.forEach((goal) => {
          hasContent = true;
          monthlyList.appendChild(createGoalRow(goal, typeLabel(goal, monthKey)));
        });
        enableGoalDragAndDrop(monthlyList);
        monthlyBlock.appendChild(monthlyList);
        box.appendChild(monthlyBlock);
      }

      weekBlocks.forEach((weekBox) => box.appendChild(weekBox));

      const weeklyGoals = goals.filter((goal) => goal.type === "hebdo");
      weeklyGoals.forEach((goal) => {
        const weekNumber = Number(goal.weekOfMonth || 1);
        const list = containers.get(weekNumber);
        if (!list) return;
        list.dataset.weekList = `${monthKey}:${weekNumber}`;
        hasContent = true;
        const range = Schema.weekDateRange(monthKey, weekNumber);
        list.appendChild(createGoalRow(goal, range?.label || typeLabel(goal, monthKey)));
      });

      if (!hasContent) {
        const empty = document.createElement("div");
        empty.className = "goal-empty muted";
        empty.textContent = "Aucun objectif pour ce mois.";
        box.appendChild(empty);
      }
      return box;
    };

    const showMonth = async (monthKey, behavior = "auto") => {
      if (!monthKey) return;
      const element = await renderMonth(monthKey);
      if (!element) return;
      activeMonthKey = monthKey;
      timeline.innerHTML = "";
      timeline.appendChild(element);
      if (typeof timeline.scrollTo === "function") {
        const behaviorMode = behavior === "smooth" ? "smooth" : "auto";
        timeline.scrollTo({ top: 0, behavior: behaviorMode });
      } else {
        timeline.scrollTop = 0;
      }
    };

    let navigateQueue = Promise.resolve();
    const navigateMonth = (offset) => {
      if (!offset) return;
      navigateQueue = navigateQueue
        .then(() => {
          const startFrom = activeMonthKey || Schema.monthKeyFromDate(new Date());
          const target = monthShift(startFrom, offset);
          return showMonth(target, "smooth");
        })
        .catch((error) => {
          goalsLogger.warn("goals.navigate.error", error);
        });
    };

    const navUp = navUpWrap.querySelector("[data-nav-up]");
    const navDown = navDownWrap.querySelector("[data-nav-down]");
    if (navUp) {
      navUp.addEventListener("click", () => navigateMonth(-1));
    }
    if (navDown) {
      navDown.addEventListener("click", () => navigateMonth(1));
    }

    const currentMonth = Schema.monthKeyFromDate(new Date());
    await showMonth(currentMonth, "auto");
    if (window.__appBadge && typeof window.__appBadge.refresh === "function") {
      window.__appBadge.refresh(ctx.user?.uid).catch(() => {});
    }
  }

  // Inline creators
  function ensureMonthlyInlineCreator(monthBox, monthKey) {
    if (!monthBox) return;
    const monthlyList = monthBox.querySelector('.goal-monthly .goal-list');
    if (!monthlyList) {
      // Create monthly block if missing (no content yet)
      const monthlyBlock = document.createElement('div');
      monthlyBlock.className = 'goal-monthly';
      monthlyBlock.innerHTML = `<div class="goal-monthly__title">Objectifs du mois</div>`;
      const list = document.createElement('div');
      list.className = 'goal-list';
      list.dataset.monthList = monthKey;
      monthlyBlock.appendChild(list);
      enableGoalDragAndDrop(list);
      monthBox.insertBefore(monthlyBlock, monthBox.firstChild.nextSibling);
    }
    const list = monthBox.querySelector('.goal-monthly .goal-list');
    if (!list) return;
    enableGoalDragAndDrop(list);
    if (list.querySelector('[data-inline-new]')) {
      const input = list.querySelector('[data-inline-new] input');
      if (input) input.focus();
      return;
    }
    const row = buildInlineCreatorRow({ type: 'mensuel', monthKey });
    list.prepend(row);
  }

  function ensureWeeklyInlineCreator(weekList, monthKey, weekOfMonth) {
    if (!weekList) return;
    enableGoalDragAndDrop(weekList);
    if (weekList.querySelector('[data-inline-new]')) {
      const input = weekList.querySelector('[data-inline-new] input');
      if (input) input.focus();
      return;
    }
    const row = buildInlineCreatorRow({ type: 'hebdo', monthKey, weekOfMonth });
    weekList.prepend(row);
  }

  function buildInlineCreatorRow(config) {
    const { type, monthKey, weekOfMonth } = config || {};
    const row = document.createElement('div');
    row.className = 'goal-row goal-row--editable goal-row--new';
    row.draggable = false;
    row.dataset.inlineNew = '1';
    const dateRange = computeGoalDateRange({ type, monthKey, weekOfMonth });
    const theoreticalDate = computeTheoreticalGoalDate({ type, monthKey, weekOfMonth });
    const theoreticalIso = formatDateInputValue(theoreticalDate);
    const theoreticalPretty = theoreticalDate
      ? theoreticalDate.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
      : '';
    const theoreticalShort = shortDowLabelFromIso(theoreticalIso) || '—';
    const reminderBtnTitle = theoreticalPretty ? `Jour du rappel : ${theoreticalPretty}` : "Configurer le rappel";
    const subtitle = type === 'hebdo' ? '' : 'Mensuel';
    row.innerHTML = `
      <div class="goal-title" style="display:flex; align-items:center; gap:8px;">
        <div class="goal-inline-editor" style="flex:1;">
          <input type="text" class="goal-input goal-input--inline" placeholder="Nouvel objectif…" aria-label="Titre de l’objectif">
          <span class="goal-title__subtitle text-xs text-[var(--muted)]"${subtitle ? ' style="display:block; margin-top:2px;"' : ' hidden style="display:block; margin-top:2px;"'}>${escapeHtml(subtitle)}</span>
        </div>
        <div class="goal-actions" style="display:flex; align-items:center; gap:6px;">
          <button type="button" class="btn btn-ghost goal-reminder-btn btn-compact" data-calendar data-email-state="off" aria-pressed="false" title="${escapeHtml(reminderBtnTitle)}" style="display:flex; align-items:center; gap:6px;">
            <span class="goal-reminder-icon-wrap" data-reminder-icon>${REMINDER_ICON_MAIL}</span>
            <span class="goal-date-pill text-xs muted" data-inline-date-pill>${escapeHtml(theoreticalShort)}</span>
          </button>
          <button type="button" class="btn btn-ghost btn-compact" data-advanced title="Options avancées">⚙️</button>
          <button type="button" class="btn btn-primary btn-compact" data-save>Enregistrer</button>
          <button type="button" class="btn btn-ghost btn-compact" data-cancel>Annuler</button>
        </div>
      </div>
      <div class="goal-quick muted text-xs" data-inline-meta>
        <span data-when-label></span>
      </div>
      <div class="goal-inline-date" data-date-wrap hidden style="position:absolute; right:8px; top:36px; background:var(--card, #fff); border:1px solid var(--muted,#ccc); border-radius:8px; padding:8px; box-shadow:0 6px 24px rgba(0,0,0,0.08); z-index:30;">
        <label class="goal-label text-xs" for="inline-notify-date">Jour du rappel</label>
        <input id="inline-notify-date" type="date" class="goal-input goal-input--inline-date">
      </div>
    `;
    const input = row.querySelector('input');
    const btnSave = row.querySelector('[data-save]');
    const btnCancel = row.querySelector('[data-cancel]');
    const btnCal = row.querySelector('[data-calendar]');
    const btnAdv = row.querySelector('[data-advanced]');
    const whenLabel = row.querySelector('[data-when-label]');
    const dateWrap = row.querySelector('[data-date-wrap]');
    const dateInput = row.querySelector('#inline-notify-date');
    const datePill = row.querySelector('[data-inline-date-pill]');

    const doCancel = () => row.remove();
    const doSave = async () => {
      const titre = (input.value || '').trim();
      if (!titre) {
        input.focus();
        return;
      }
      const theoreticalDate = (() => {
        const d = computeTheoreticalGoalDate({ type, monthKey, weekOfMonth });
        return formatDateInputValue(d) || null;
      })();
      const payload = {
        titre,
        type,
        monthKey,
        ...(type === 'hebdo' ? { weekOfMonth: weekOfMonth || 1 } : {}),
        notifyOnTarget: true,
        notifyChannel: 'push',
        // Only set notifyAt if user opened/modified the picker; otherwise default theoretical will be used by reminder logic
        ...(dateInput && dateInput.value ? { notifyAt: dateInput.value } : (theoreticalDate ? { notifyAt: theoreticalDate } : {})),
      };
      const c = lastCtx;
      try {
        const id = await Schema.upsertObjective(c?.db, c?.user?.uid, payload, null);
        const created = { id, ...payload };
        // Replace inline creator with a proper row (no page reload)
        const subtitle = typeLabel(created, monthKey);
        const factory = (window.Goals && window.Goals.__createGoalRow) || (GoalsNS && GoalsNS.__createGoalRow);
        if (typeof factory === 'function') {
          const realRow = factory(created, subtitle);
          if (realRow) {
            row.replaceWith(realRow);
          } else {
            row.remove();
          }
        } else {
          // Fallback: remove inline and try to re-render
          row.remove();
          try {
            if (lastCtx && lastMount && typeof GoalsNS.renderGoals === 'function') {
              GoalsNS.renderGoals(lastCtx, lastMount);
            }
          } catch (_e) {}
        }
      } catch (err) {
        goalsLogger.error('goals.inlineCreate.save', err);
        alert("Impossible de créer l’objectif.");
      }
    };

    // Initialize date meta label and input bounds
    const prettyFromIso = (iso) => {
      if (!iso || typeof iso !== 'string') return '';
      const parts = iso.split('-').map(Number);
      if (parts.length !== 3) return '';
      const [y, m, d] = parts;
      const dt = new Date(y, (m || 1) - 1, d || 1);
      if (Number.isNaN(dt.getTime())) return '';
      return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    };
    const updateInlineDatePreview = () => {
      const iso = dateInput?.value || theoreticalIso || '';
      const pretty = prettyFromIso(iso);
      const shortLabel = shortDowLabelFromIso(iso) || '—';
      if (whenLabel) {
        whenLabel.textContent = pretty ? `Rappel prévu : ${pretty}` : '';
      }
      if (datePill) {
        datePill.textContent = shortLabel || '—';
        if (pretty) {
          datePill.title = pretty;
          datePill.setAttribute('aria-label', pretty);
        } else {
          datePill.title = '';
          datePill.removeAttribute('aria-label');
        }
      }
      if (btnCal) {
        btnCal.title = pretty ? `Jour du rappel : ${pretty}` : "Configurer le rappel";
      }
    };
    if (dateInput) {
      if (dateRange?.start) dateInput.min = formatDateInputValue(dateRange.start);
      if (dateRange?.end) dateInput.max = formatDateInputValue(dateRange.end);
      if (theoreticalIso) dateInput.value = theoreticalIso;
      dateInput.addEventListener('input', updateInlineDatePreview);
      dateInput.addEventListener('change', updateInlineDatePreview);
    }
    updateInlineDatePreview();

    btnSave.addEventListener('click', doSave);
    btnCancel.addEventListener('click', doCancel);
    if (btnCal) {
      btnCal.addEventListener('click', (e) => {
        e.preventDefault();
        if (!dateWrap) return;
        const willOpen = dateWrap.hidden !== false;
        dateWrap.hidden = !willOpen;
        if (willOpen && dateInput) {
          try { dateInput.focus(); } catch (_) {}
        }
      });
    }
    if (btnAdv) {
      btnAdv.addEventListener('click', (e) => {
        e.preventDefault();
        // Open advanced modal with initial config
        try {
          if (lastCtx) openGoalForm(lastCtx, null, { type, monthKey, weekOfMonth });
        } catch (_err) {}
      });
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        doCancel();
      }
    });
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 0);
    return row;
  }

  async function openGoalForm(ctx, goal = null, initial = {}) {
    const monthKey = goal?.monthKey || initial.monthKey || Schema.monthKeyFromDate(new Date());
    let weekOfMonth = Number(goal?.weekOfMonth || initial.weekOfMonth || 1);
    const typeInitial = goal?.type || initial.type || "hebdo";
    const notificationsInitial = true; // push toujours actif
    const notifyChannelInitial = (() => {
      const raw = (goal?.notifyChannel || initial.notifyChannel || "").toLowerCase();
      if (raw === "email" || raw === "mail" || raw === "both" || raw === "push+email" || raw === "email+push") return "both";
      return "push";
    })();
    const profileEmails = (() => {
      const source = ctx?.profile || {};
      const seen = new Set();
      const result = [];
      const pushEmail = (value) => {
        if (typeof value !== "string") return;
        const trimmed = value.trim();
        if (!trimmed) return;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        result.push(trimmed);
      };
      if (Array.isArray(source.emails)) {
        source.emails.forEach(pushEmail);
      }
      if (typeof source.email === "string") {
        pushEmail(source.email);
      }
      return result;
    })();
    const profileEmail = profileEmails[0] || "";
    const hasProfileEmail = profileEmails.length > 0;
    const monthLabel = (() => {
      const [y, m] = monthKey.split("-").map(Number);
      if (!Number.isFinite(y) || !Number.isFinite(m)) return monthKey;
      const date = new Date(y, (m || 1) - 1, 1);
      const raw = date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    })();
    const weekChoices = Schema.weeksOf(monthKey);
    if (!weekChoices.includes(weekOfMonth)) {
      weekOfMonth = weekChoices[0] || 1;
    }
    const weekButtonsMarkup = weekChoices
      .map((w) => `<button type="button" class="btn-ghost" data-w="${w}">S${w}</button>`)
      .join("");

    const theoreticalInitialDate = computeTheoreticalGoalDate({
      type: typeInitial,
      monthKey,
      weekOfMonth,
      startDate: goal?.startDate ?? initial.startDate,
      endDate: goal?.endDate ?? initial.endDate,
    });
    const theoreticalInitialIso = formatDateInputValue(theoreticalInitialDate);
    const storedNotifyIso = isoValueFromAny(goal?.notifyAt ?? initial.notifyAt ?? "");
    let notifyDateDirty = Boolean(storedNotifyIso && storedNotifyIso !== theoreticalInitialIso);
    const notifyDateInitialValue = storedNotifyIso || theoreticalInitialIso || "";

    let linkedConsignes = [];
    if (goal?.id) {
      try {
        linkedConsignes = await Schema.listConsignesByObjective(ctx.db, ctx.user.uid, goal.id);
      } catch (err) {
        goalsLogger.warn("goals.linkedConsignes.load", err);
      }
    }

    let availableConsignes = [];
    try {
      const [practiceConsignes, dailyConsignes] = await Promise.all([
        Schema.fetchConsignes(ctx.db, ctx.user.uid, "practice").catch((err) => {
          goalsLogger.warn("goals.consigneList.practice", err);
          return [];
        }),
        Schema.fetchConsignes(ctx.db, ctx.user.uid, "daily").catch((err) => {
          goalsLogger.warn("goals.consigneList.daily", err);
          return [];
        }),
      ]);
      availableConsignes = [...(practiceConsignes || []), ...(dailyConsignes || [])];
    } catch (err) {
      goalsLogger.warn("goals.consigneList.load", err);
    }

    const consignePool = new Map();
    (linkedConsignes || []).forEach((item) => {
      if (item && item.id) {
        consignePool.set(item.id, item);
      }
    });
    (availableConsignes || []).forEach((item) => {
      if (item && item.id && !consignePool.has(item.id)) {
        consignePool.set(item.id, item);
      }
    });

    const consigneChoices = Array.from(consignePool.values()).map((consigne) => {
      const label = consigne.text || consigne.titre || consigne.name || consigne.id || "Consigne";
      const metaParts = [];
      if (consigne.mode === "daily") {
        metaParts.push("Journalier");
      } else if (consigne.mode === "practice") {
        metaParts.push("Pratique");
      }
      if (consigne.category) {
        metaParts.push(consigne.category);
      }
      return {
        id: consigne.id,
        label,
        meta: metaParts.join(" • "),
        raw: consigne,
      };
    });
    consigneChoices.sort((a, b) => a.label.localeCompare(b.label, "fr", { sensitivity: "base" }));
    const consigneRawById = new Map(consigneChoices.map((choice) => [choice.id, choice.raw]));
    const initialLinkedIds = new Set((linkedConsignes || []).map((item) => item?.id).filter(Boolean));
    const formatLinkerSummary = (count) => {
      if (!count) return "Pas encore de consigne associée";
      return `${count} consigne${count > 1 ? "s" : ""} associée${count > 1 ? "s" : ""}`;
    };
    const linkerSummaryInitial = formatLinkerSummary(initialLinkedIds.size);
    const consigneOptionsMarkup = consigneChoices.length
      ? consigneChoices
          .map((choice) => {
            const checked = initialLinkedIds.has(choice.id) ? "checked" : "";
            const meta = choice.meta ? `<span class="goal-linker__option-meta">${escapeHtml(choice.meta)}</span>` : "";
            return `
              <label class="goal-linker__option">
                <input type="checkbox" value="${escapeHtml(choice.id)}" ${checked}>
                <span class="goal-linker__option-main">${escapeHtml(choice.label)}</span>
                ${meta}
              </label>
            `;
          })
          .join("")
      : '<p class="goal-linker__empty muted">Aucune consigne disponible pour le moment.</p>';
    const hasInitialLinkedConsignes = initialLinkedIds.size > 0;

    const wrap = document.createElement("div");
    wrap.className = "goal-modal";
    const autosaveKey = [
      "goal",
      ctx.user?.uid || "anon",
      goal?.id ? `edit-${goal.id}` : `new-${monthKey}-${typeInitial}`,
    ]
      .map((part) => String(part))
      .join(":");
    wrap.innerHTML = `
      <div class="goal-modal-card">
        <div class="goal-modal-header">
          <div class="goal-modal-title">${goal ? "Modifier" : "Nouvel"} objectif</div>
          <button class="btn-ghost" type="button" data-close>✕</button>
        </div>
        <form class="goal-form" id="goal-form" data-autosave-key="${escapeHtml(autosaveKey)}">
          <div class="goal-field">
            <span class="goal-label">Mois concerné</span>
            <div class="goal-month-pill">${escapeHtml(monthLabel)}</div>
          </div>
          <label class="goal-field">
            <span class="goal-label">Titre</span>
            <input name="titre" required class="goal-input" value="${escapeHtml(goal?.titre || "")}" placeholder="Nom de l’objectif">
          </label>
          <label class="goal-field">
            <span class="goal-label">Type</span>
            <select id="obj-type" class="goal-input">
              <option value="hebdo" ${typeInitial === "hebdo" ? "selected" : ""}>Hebdomadaire</option>
              <option value="mensuel" ${typeInitial === "mensuel" ? "selected" : ""}>Mensuel</option>
            </select>
          </label>
          <div class="goal-field" id="week-picker">
            <span class="goal-label">Semaine</span>
            <div class="week-picker">
              ${weekButtonsMarkup || "<span class=\"text-xs text-[var(--muted)]\">Aucune semaine</span>"}
            </div>
          </div>
          <label class="goal-field">
            <span class="goal-label">Description</span>
            <textarea name="description" rows="3" class="goal-input" placeholder="Notes facultatives">${escapeHtml(goal?.description || "")}</textarea>
          </label>
          <div class="goal-field">
            <span class="goal-label">Rappel</span>
            <div class="goal-reminder">
              <label class="goal-label goal-reminder__label" for="goal-notify-date">Jour du rappel</label>
              <input type="date" id="goal-notify-date" name="notifyAt" class="goal-input goal-reminder__input" value="${escapeHtml(
                notifyDateInitialValue
              )}">
              <p class="goal-reminder__hint goal-hint" data-notify-default></p>
            </div>
            <div class="goal-reminder" data-reminder-channel>
              <label class="goal-checkbox" style="display:flex; gap:8px; align-items:center;">
                <input type="checkbox" name="notifyEmail" ${notifyChannelInitial === "both" ? "checked" : ""}>
                <span>Recevoir le rappel par email (en plus de la notification)</span>
              </label>
              <p class="goal-reminder__hint goal-hint" data-email-warning hidden></p>
            </div>
          </div>
          <div class="goal-field goal-linker" data-goal-linker>
            <span class="goal-label">Consignes associées</span>
            <div class="goal-linker__controls">
              <button type="button" class="btn btn-ghost goal-linker__toggle" data-linker-toggle aria-expanded="false">Gérer les consignes associées</button>
              <span class="goal-linker__summary" data-linker-summary>${escapeHtml(linkerSummaryInitial)}</span>
            </div>
            <p class="goal-linker__hint">Sélectionne les consignes qui soutiennent au mieux cet objectif.</p>
            <div class="goal-linker__panel" data-linker-panel hidden>
              ${consigneOptionsMarkup}
            </div>
            <div class="goal-linker__footer">
              <button type="button" class="btn btn-ghost goal-linker__history" data-linker-history ${hasInitialLinkedConsignes ? "" : "hidden"}>Consulter l’historique des consignes</button>
            </div>
          </div>
          <div class="goal-actions">
            ${goal ? '<button type="button" class="btn btn-danger" data-delete>Supprimer</button> <button type="button" class="btn btn-ghost" data-archive>Archiver</button>' : ""}
            <button type="button" class="btn btn-ghost" data-close>Annuler</button>
            <button type="submit" class="btn btn-primary">Enregistrer</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(wrap);

    wrap.querySelectorAll("textarea").forEach((textarea) => {
      if (typeof window.autoGrowTextarea === "function") {
        window.autoGrowTextarea(textarea);
      }
    });

    const close = () => wrap.remove();
    wrap.addEventListener("click", (event) => {
      if (event.target === wrap) close();
    });
    wrap.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", close);
    });

    const form = wrap.querySelector("#goal-form");
    const typeSelect = form.querySelector("#obj-type");
    const weekPicker = form.querySelector("#week-picker");
    const weekButtons = form.querySelectorAll("#week-picker [data-w]");
  const notifyCheckbox = form.querySelector("[name=notifyEmail]");
    const notifyDateInput = form.querySelector("[name=notifyAt]");
    const notifyChannelWrap = form.querySelector("[data-reminder-channel]");
    const notifyDefaultHint = form.querySelector("[data-notify-default]");
    const notifyEmailWarning = form.querySelector("[data-email-warning]");
    const linkerPanel = form.querySelector("[data-linker-panel]");
    const linkerToggle = form.querySelector("[data-linker-toggle]");
    const linkerSummaryEl = form.querySelector("[data-linker-summary]");
    const historyButton = form.querySelector("[data-linker-history]");
    const selectedConsigneIds = new Set(initialLinkedIds);
    const originalConsigneIds = new Set(initialLinkedIds);

    const syncHistoryButton = () => {
      if (!historyButton) return;
      const hasSelection = selectedConsigneIds.size > 0;
      historyButton.hidden = !hasSelection;
      historyButton.disabled = !hasSelection;
      historyButton.setAttribute("aria-disabled", hasSelection ? "false" : "true");
    };
    const syncLinkerSummary = () => {
      if (linkerSummaryEl) {
        linkerSummaryEl.textContent = formatLinkerSummary(selectedConsigneIds.size);
      }
      syncHistoryButton();
    };

    if (linkerPanel) {
      const inputs = Array.from(linkerPanel.querySelectorAll('input[type="checkbox"]'));
      inputs.forEach((input) => {
        const value = input.value || "";
        if (input.checked && value) {
          selectedConsigneIds.add(value);
        }
        input.addEventListener("change", () => {
          const nextValue = input.value || "";
          if (!nextValue) {
            syncLinkerSummary();
            return;
          }
          if (input.checked) {
            selectedConsigneIds.add(nextValue);
          } else {
            selectedConsigneIds.delete(nextValue);
          }
          syncLinkerSummary();
        });
      });
      linkerPanel.hidden = true;
    }

    if (linkerToggle) {
      const hasOptions = consigneChoices.length > 0;
      linkerToggle.disabled = !hasOptions;
      linkerToggle.setAttribute("aria-disabled", hasOptions ? "false" : "true");
      linkerToggle.addEventListener("click", () => {
        if (!linkerPanel || !hasOptions) return;
        const isOpen = linkerPanel.hasAttribute("data-open");
        if (isOpen) {
          linkerPanel.hidden = true;
          linkerPanel.removeAttribute("data-open");
          linkerToggle.setAttribute("aria-expanded", "false");
        } else {
          linkerPanel.hidden = false;
          linkerPanel.setAttribute("data-open", "");
          linkerToggle.setAttribute("aria-expanded", "true");
        }
      });
    }

    if (historyButton) {
      historyButton.addEventListener("click", () => {
        const selected = Array.from(selectedConsigneIds)
          .map((id) => consigneRawById.get(id))
          .filter(Boolean);
        if (!selected.length) {
          return;
        }
        if (typeof window.openCategoryDashboard !== "function") {
          goalsLogger.warn("goals.linker.history.missing");
          return;
        }
        const modeSet = new Set(
          selected.map((item) =>
            item.mode === "daily" ? "daily" : item.mode === "practice" ? "practice" : ""
          )
        );
        let historyMode = "practice";
        let allowMixed = false;
        if (modeSet.size === 1) {
          const [onlyMode] = Array.from(modeSet);
          historyMode = onlyMode === "daily" ? "daily" : "practice";
        } else if (modeSet.size > 1) {
          historyMode = "daily";
          allowMixed = true;
        }
        const historyTitle = goal?.titre
          ? `Consignes liées — ${goal.titre}`
          : "Consignes liées";
        try {
          window.openCategoryDashboard(ctx, "", {
            consignes: selected,
            mode: historyMode,
            allowMixedMode: allowMixed,
            title: historyTitle,
            trendTitle: "Progression des consignes liées",
            detailsTitle: "Historique par consigne",
          });
        } catch (err) {
          goalsLogger.warn("goals.linker.history", err);
        }
      });
    }

    syncLinkerSummary();

    const syncWeekPicker = () => {
      weekPicker.style.display = typeSelect.value === "hebdo" ? "" : "none";
    };
    syncWeekPicker();

    const currentGoalConfig = () => ({
      type: typeSelect.value,
      monthKey,
      weekOfMonth,
      startDate: goal?.startDate ?? initial.startDate,
      endDate: goal?.endDate ?? initial.endDate,
    });

    const updateNotifyDefault = () => {
      const config = currentGoalConfig();
      const theoreticalDate = computeTheoreticalGoalDate(config);
      const theoreticalIso = formatDateInputValue(theoreticalDate);
      const range = computeGoalDateRange(config);
      const minIso = range?.start ? formatDateInputValue(range.start) : "";
      const maxIso = range?.end ? formatDateInputValue(range.end) : "";
      if (notifyDefaultHint) {
        if (theoreticalDate) {
          notifyDefaultHint.textContent = `Échéance théorique : ${formatGoalDateLabel(theoreticalDate)}`;
        } else {
          notifyDefaultHint.textContent = "Choisis le jour de rappel souhaité.";
        }
      }
      if (!notifyDateInput) return;
      if (minIso) {
        notifyDateInput.min = minIso;
      } else {
        notifyDateInput.removeAttribute("min");
      }
      if (maxIso) {
        notifyDateInput.max = maxIso;
      } else {
        notifyDateInput.removeAttribute("max");
      }
      if (!notifyDateDirty) {
        notifyDateInput.value = theoreticalIso || "";
      }
      if (notifyDateInput.value) {
        if (minIso && notifyDateInput.value < minIso) {
          notifyDateInput.value = minIso;
        }
        if (maxIso && notifyDateInput.value > maxIso) {
          notifyDateInput.value = maxIso;
        }
      }
      notifyDateDirty = (notifyDateInput.value || "") !== (theoreticalIso || "");
    };

    const updateEmailWarning = () => {
      if (!notifyEmailWarning) return;
  const needsEmail = notifyCheckbox?.checked === true;
      if (!needsEmail) {
        notifyEmailWarning.hidden = true;
        notifyEmailWarning.textContent = "";
        return;
      }
      if (hasProfileEmail) {
        notifyEmailWarning.textContent = `Envoi à ${profileEmails.join(", ")}.`;
      } else {
        notifyEmailWarning.textContent = "Ajoute une adresse email dans l’admin pour recevoir ce rappel.";
      }
      notifyEmailWarning.hidden = false;
    };

    const updateNotificationEnabledState = () => {
      // Toujours actif; seule l’option email change le canal
      if (notifyDateInput) notifyDateInput.disabled = false;
      if (notifyDefaultHint) notifyDefaultHint.classList.remove("is-disabled");
      if (notifyChannelWrap) notifyChannelWrap.classList.remove("is-disabled");
      if (notifyEmailWarning) notifyEmailWarning.classList.remove("is-disabled");
      updateEmailWarning();
    };

    const markNotifyDirty = () => {
      if (!notifyDateInput) {
        notifyDateDirty = false;
        return;
      }
      if (!notifyDateInput.value) {
        notifyDateDirty = false;
        updateNotifyDefault();
        return;
      }
      const config = currentGoalConfig();
      const theoreticalIso = formatDateInputValue(computeTheoreticalGoalDate(config)) || "";
      const range = computeGoalDateRange(config);
      const minIso = range?.start ? formatDateInputValue(range.start) : "";
      const maxIso = range?.end ? formatDateInputValue(range.end) : "";
      let nextValue = notifyDateInput.value;
      if (minIso && nextValue && nextValue < minIso) {
        nextValue = minIso;
      }
      if (maxIso && nextValue && nextValue > maxIso) {
        nextValue = maxIso;
      }
      if (nextValue !== notifyDateInput.value) {
        notifyDateInput.value = nextValue;
      }
      notifyDateDirty = (notifyDateInput.value || "") !== theoreticalIso;
    };

    if (notifyDateInput) {
      notifyDateInput.addEventListener("input", markNotifyDirty);
      notifyDateInput.addEventListener("change", markNotifyDirty);
    }

    if (notifyCheckbox) {
      notifyCheckbox.addEventListener("change", () => {
        updateNotificationEnabledState();
        if (notifyCheckbox.checked && notifyDateInput && !notifyDateInput.value) {
          notifyDateDirty = false;
          updateNotifyDefault();
        }
      });
    }

    // no channel select anymore

    weekButtons.forEach((btn) => {
      const value = Number(btn.dataset.w || "1");
      if (value === weekOfMonth) {
        btn.classList.add("is-active");
      }
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        weekOfMonth = value;
        weekButtons.forEach((other) => other.classList.toggle("is-active", other === btn));
        updateNotifyDefault();
      });
    });

    typeSelect.addEventListener("change", () => {
      syncWeekPicker();
      updateNotifyDefault();
    });

    updateNotifyDefault();
    updateNotificationEnabledState();
    updateEmailWarning();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const titre = form.querySelector("[name=titre]").value.trim();
      if (!titre) {
        alert("Le titre est obligatoire.");
        return;
      }
      const description = form.querySelector("[name=description]").value.trim();
      const type = typeSelect.value;
  const notifyOnTarget = true; // push toujours actif
  const notifyChannel = notifyCheckbox?.checked ? "both" : "push";
      const notifyAtRaw = (notifyDateInput?.value || "").trim();
      let notifyAt = null;
      const goalConfig = currentGoalConfig();
      if (notifyOnTarget) {
        const range = computeGoalDateRange(goalConfig);
        const minIso = range?.start ? formatDateInputValue(range.start) : "";
        const maxIso = range?.end ? formatDateInputValue(range.end) : "";
        if (notifyAtRaw) {
          let normalized = notifyAtRaw;
          if (minIso && normalized < minIso) {
            normalized = minIso;
          }
          if (maxIso && normalized > maxIso) {
            normalized = maxIso;
          }
          notifyAt = normalized;
        } else {
          notifyAt = formatDateInputValue(computeTheoreticalGoalDate(goalConfig)) || null;
        }
      }

      const data = {
        titre,
        description,
        type,
        monthKey,
  notifyOnTarget,
  notifyChannel,
        notifyAt: notifyAt || null,
      };
      if (type === "hebdo") {
        data.weekOfMonth = weekOfMonth;
      }

      try {
        const savedId = await Schema.upsertObjective(ctx.db, ctx.user.uid, data, goal?.id || null);
        const objectiveId = goal?.id || savedId;
        if (objectiveId) {
          const toLink = [];
          selectedConsigneIds.forEach((id) => {
            if (!originalConsigneIds.has(id)) {
              toLink.push(id);
            }
          });
          const toUnlink = [];
          originalConsigneIds.forEach((id) => {
            if (!selectedConsigneIds.has(id)) {
              toUnlink.push(id);
            }
          });
          if (toLink.length || toUnlink.length) {
            try {
              await Promise.all([
                ...toLink.map((id) => Schema.linkConsigneToObjective(ctx.db, ctx.user.uid, id, objectiveId)),
                ...toUnlink.map((id) => Schema.linkConsigneToObjective(ctx.db, ctx.user.uid, id, null)),
              ]);
            } catch (linkErr) {
              goalsLogger.warn("goals.linker.save", linkErr);
              alert("Impossible de mettre à jour les consignes liées.");
            }
          }
        }
        // Local DOM update instead of full page reload
        close();
        const monthBox = document.querySelector('.goal-month');
        const existingRow = document.querySelector(`[data-goal-id="${objectiveId}"]`);
        const updatedGoal = { id: objectiveId, ...data };
        if (existingRow) {
          // If week/type grouping changed within same month, move row
          const currentMonthKey = monthBox?.dataset?.month || updatedGoal.monthKey;
          const targetIsWeekly = updatedGoal.type === 'hebdo';
          if (targetIsWeekly) {
            const weekList = document.querySelector(`.goal-week[data-week="${updatedGoal.weekOfMonth || 1}"] .goal-list`)
              || document.querySelector(`.goal-week [data-week="${updatedGoal.weekOfMonth || 1}"]`)?.parentElement?.nextElementSibling;
            if (weekList && existingRow.parentElement !== weekList) {
              weekList.appendChild(existingRow);
            }
          } else {
            const monthlyList = document.querySelector('.goal-monthly .goal-list');
            if (monthlyList && existingRow.parentElement !== monthlyList) {
              monthlyList.appendChild(existingRow);
            }
          }
          applyGoalRowMeta(existingRow, updatedGoal);
        } else {
          // New objective created via modal; try to insert in the right list
          const subtitle = typeLabel(updatedGoal, updatedGoal.monthKey);
          const node = createGoalRow(updatedGoal, subtitle);
          if (updatedGoal.type === 'hebdo') {
            const weekList = document.querySelector(`.goal-week[data-week="${updatedGoal.weekOfMonth || 1}"] .goal-list`);
            if (weekList) weekList.prepend(node);
            else monthBox?.appendChild(node);
          } else {
            const monthlyList = document.querySelector('.goal-monthly .goal-list');
            if (monthlyList) monthlyList.prepend(node);
            else monthBox?.appendChild(node);
          }
        }
      } catch (err) {
        goalsLogger.error("goals.save.error", err);
        alert("Impossible d'enregistrer l’objectif.");
      }
    });

    if (goal?.id) {
      const deleteButton = form.querySelector("[data-delete]");
      if (deleteButton) {
        deleteButton.addEventListener("click", async (event) => {
          event.preventDefault();
          const confirmed = window.confirm("Supprimer cet objectif ?");
          if (!confirmed) {
            return;
          }
          try {
            await Schema.deleteObjective(ctx.db, ctx.user.uid, goal.id);
            // Mise à jour locale sans rechargement
            const row = document.querySelector(`[data-goal-id="${goal.id}"]`);
            if (row) row.remove();
            close();
            if (window.__appBadge && typeof window.__appBadge.refresh === 'function') {
              window.__appBadge.refresh(ctx.user?.uid).catch(() => {});
            }
          } catch (err) {
            goalsLogger.error("goals.delete.error", err);
            alert("Impossible de supprimer l’objectif.");
          }
        });
      }
      const archiveButton = form.querySelector("[data-archive]");
      if (archiveButton) {
        archiveButton.addEventListener("click", async (event) => {
          event.preventDefault();
          const confirmed = window.confirm("Archiver cet objectif ?");
          if (!confirmed) {
            return;
          }
          try {
            await Schema.upsertObjective(ctx.db, ctx.user.uid, { archived: true }, goal.id);
            const row = document.querySelector(`[data-goal-id="${goal.id}"]`);
            if (row) row.remove();
            close();
            if (window.__appBadge && typeof window.__appBadge.refresh === 'function') {
              window.__appBadge.refresh(ctx.user?.uid).catch(() => {});
            }
          } catch (err) {
            goalsLogger.error("goals.archive.error", err);
            alert("Impossible d'archiver l’objectif.");
          }
        });
      }
    }
  }

  // Popover combiné: activer/désactiver email + choisir le jour du rappel
  function toggleReminderPopover(row, goal, anchorBtn) {
    if (!row || !goal) return;
    let pop = row.querySelector('[data-popover-reminder]');
    if (pop) {
      const isHidden = pop.hasAttribute('hidden');
      if (isHidden) {
        openReminderPopover(pop, anchorBtn);
        const inputEl = pop.querySelector('input[type=date]');
        if (inputEl) {
          setTimeout(() => {
            try { inputEl.focus(); } catch (_err) {}
          }, 0);
        }
      } else {
        closeReminderPopover(pop);
      }
      return;
    }
    // Build it
    pop = document.createElement('div');
    pop.dataset.popoverReminder = '1';
    pop.setAttribute('role', 'dialog');
    pop.style.position = 'absolute';
    pop.style.right = '8px';
    pop.style.top = '36px';
    pop.style.background = 'var(--card, #fff)';
    pop.style.border = '1px solid var(--muted, #ccc)';
    pop.style.borderRadius = '8px';
    pop.style.padding = '8px';
    pop.style.boxShadow = '0 6px 24px rgba(0,0,0,0.08)';
    pop.style.zIndex = '30';
    const range = computeGoalDateRange(goal);
    const initial = isoValueFromAny(goal?.notifyAt || '') || formatDateInputValue(computeTheoreticalGoalDate(goal)) || '';
    const emailChecked = isEmailEnabled(goal);
    pop.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:8px; min-width: 260px;">
        <label class="goal-checkbox" style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" data-email ${emailChecked ? 'checked' : ''}>
          <span>Recevoir le rappel par email</span>
        </label>
        <div>
          <div class="text-xs muted" style="margin-bottom:4px;">Jour du rappel</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="date" class="goal-input" ${range?.start ? `min="${escapeHtml(formatDateInputValue(range.start))}"` : ''} ${range?.end ? `max="${escapeHtml(formatDateInputValue(range.end))}"` : ''} value="${escapeHtml(initial)}">
            <button type="button" class="btn btn-primary btn-compact" data-apply>OK</button>
          </div>
        </div>
      </div>
    `;
    row.appendChild(pop);
    openReminderPopover(pop, anchorBtn);
    const input = pop.querySelector('input[type=date]');
    const emailToggle = pop.querySelector('[data-email]');
    const apply = pop.querySelector('[data-apply]');
    const saveReminder = async () => {
      const c = lastCtx;
      if (!c) return;
      const picked = (input?.value || '').trim();
      const useEmail = emailToggle?.checked === true;
      const payload = {
        notifyOnTarget: true,
        notifyChannel: useEmail ? 'both' : 'push',
        ...(picked ? { notifyAt: picked } : {}),
      };
      try {
        await Schema.upsertObjective(c.db, c.user.uid, payload, goal.id);
        closeReminderPopover(pop);
        // Update current row locally
        goal.notifyAt = picked || goal.notifyAt || null;
        goal.notifyOnTarget = true;
        goal.notifyChannel = useEmail ? 'both' : 'push';
        applyGoalRowMeta(row, goal);
      } catch (err) {
        goalsLogger.error('goals.reminder.save', err);
        alert("Impossible de mettre à jour le rappel.");
      }
    };
    apply.addEventListener('click', saveReminder);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveReminder(); }
      if (e.key === 'Escape') { e.preventDefault(); closeReminderPopover(pop); }
    });
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 0);
  }

  GoalsNS.renderGoals = renderGoals;
  GoalsNS.openGoalForm = openGoalForm;
  GoalsNS.toggleReminderPopover = toggleReminderPopover;
})();
