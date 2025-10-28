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
      <button type="button" class="btn btn-ghost goal-nav-button" data-nav-up title="Mois précédent" aria-label="Mois précédent">▲</button>
    `;
    section.appendChild(navUpWrap);

    const timeline = document.createElement("div");
    timeline.className = "goal-timeline";
    section.appendChild(timeline);

    const navDownWrap = document.createElement("div");
    navDownWrap.className = "goal-nav goal-nav--down";
    navDownWrap.innerHTML = `
      <button type="button" class="btn btn-ghost goal-nav-button" data-nav-down title="Mois suivant" aria-label="Mois suivant">▼</button>
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
        // restore original UI without reflowing the whole month
        titleWrap.innerHTML = `
          <button type="button" class="goal-title__button" data-edit-goal>
            <span class="goal-title__text">${escapeHtml(goal.titre || "Objectif")}</span>
            <span class="goal-title__subtitle text-xs text-[var(--muted)]">${escapeHtml(typeLabel(goal, goal.monthKey))}</span>
          </button>
          <button type="button" class="btn btn-ghost goal-advanced" title="Options avancées" data-open-advanced>⚙️</button>
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
      row.style.position = "relative";
      const subtitle = subtitleOverride || typeLabel(goal, goal.monthKey);
      // Effective reminder date label
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

      row.innerHTML = `
        <div class="goal-title">
          <button type="button" class="goal-title__button" data-edit-goal>
            <span class="goal-title__text">${escapeHtml(goal.titre || "Objectif")}</span>
            <span class="goal-title__subtitle text-xs text-[var(--muted)]">${escapeHtml(subtitle)}</span>
          </button>
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
        <div class="goal-actions" style="margin-left:auto; display:flex; align-items:center; gap:8px;">
          <button type="button" class="btn btn-ghost" data-open-date title="Jour du rappel: ${escapeHtml(effectiveLabel)}">📅</button>
          <button type="button" class="btn btn-ghost goal-advanced" title="Options avancées" data-open-advanced>⚙️</button>
        </div>
      `;
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

      // Quick date popover
      const dateBtn = row.querySelector("[data-open-date]");
      if (dateBtn) {
        dateBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleDatePopover(row, goal, dateBtn);
        });
      }

      return row;
    };

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

      goals.sort((a, b) => (a.titre || "").localeCompare(b.titre || ""));

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
      monthBox.insertBefore(monthlyBlock, monthBox.firstChild.nextSibling);
    }
    const list = monthBox.querySelector('.goal-monthly .goal-list');
    if (!list) return;
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
    row.dataset.inlineNew = '1';
    const subtitle = type === 'hebdo'
      ? (Schema.weekDateRange(monthKey, weekOfMonth || 1)?.label || `Semaine ${weekOfMonth || 1}`)
      : 'Mensuel';
    row.innerHTML = `
      <div class="goal-title">
        <div class="goal-inline-editor">
          <input type="text" class="goal-input goal-input--inline" placeholder="Nouvel objectif…" aria-label="Titre de l’objectif">
        </div>
        <span class="goal-title__subtitle text-xs text-[var(--muted)]">${escapeHtml(subtitle)}</span>
      </div>
      <div class="goal-quick muted text-xs" data-inline-meta>
        <span data-when-label></span>
      </div>
      <div class="goal-actions" style="margin-left:auto; display:flex; align-items:center; gap:8px;">
        <button type="button" class="btn btn-ghost btn-compact" data-calendar title="Jour du rappel">📅</button>
        <button type="button" class="btn btn-ghost btn-compact" data-advanced title="Options avancées">⚙️</button>
        <button type="button" class="btn btn-primary btn-compact" data-save>Enregistrer</button>
        <button type="button" class="btn btn-ghost btn-compact" data-cancel>Annuler</button>
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
        await Schema.upsertObjective(c?.db, c?.user?.uid, payload, null);
        // Refresh month
        if (lastMount && c) {
          renderGoals(c, lastMount);
        }
      } catch (err) {
        goalsLogger.error('goals.inlineCreate.save', err);
        alert("Impossible de créer l’objectif.");
      }
    };

    // Initialize date meta label and input bounds
    const range = computeGoalDateRange({ type, monthKey, weekOfMonth });
    const theoretical = computeTheoreticalGoalDate({ type, monthKey, weekOfMonth });
    const theoreticalIso = formatDateInputValue(theoretical);
    if (whenLabel) {
      const pretty = theoretical ? theoretical.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
      whenLabel.textContent = theoretical ? `Rappel prévu : ${pretty}` : '';
    }
    if (dateInput) {
      if (range?.start) dateInput.min = formatDateInputValue(range.start);
      if (range?.end) dateInput.max = formatDateInputValue(range.end);
      if (theoreticalIso) dateInput.value = theoreticalIso;
    }

    btnSave.addEventListener('click', doSave);
    btnCancel.addEventListener('click', doCancel);
    if (btnCal) {
      btnCal.addEventListener('click', (e) => {
        e.preventDefault();
        const open = !dateWrap || dateWrap.hidden;
        if (dateWrap) dateWrap.hidden = !open;
        if (open && dateInput) {
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
    const notificationsInitial = goal?.notifyOnTarget !== false;
    const notifyChannelInitial = (() => {
      const raw = (goal?.notifyChannel || initial.notifyChannel || "").toLowerCase();
      if (raw === "email" || raw === "mail") return "email";
      if (raw === "both" || raw === "push+email" || raw === "email+push") return "both";
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
            <span class="goal-label">Notifications</span>
            <label class="goal-checkbox">
              <input type="checkbox" name="notifyOnTarget" ${notificationsInitial ? "checked" : ""}>
              <span>Recevoir un rappel</span>
            </label>
            <div class="goal-reminder">
              <label class="goal-label goal-reminder__label" for="goal-notify-date">Jour du rappel</label>
              <input type="date" id="goal-notify-date" name="notifyAt" class="goal-input goal-reminder__input" value="${escapeHtml(
                notifyDateInitialValue
              )}">
              <p class="goal-reminder__hint goal-hint" data-notify-default></p>
            </div>
            <div class="goal-reminder" data-reminder-channel>
              <label class="goal-label goal-reminder__label" for="goal-notify-channel">Canal d’envoi</label>
              <select id="goal-notify-channel" name="notifyChannel" class="goal-input goal-reminder__input">
                <option value="push" ${notifyChannelInitial === "push" ? "selected" : ""}>Notification dans l’app</option>
                <option value="email" ${notifyChannelInitial === "email" ? "selected" : ""}>Email</option>
                <option value="both" ${notifyChannelInitial === "both" ? "selected" : ""}>Notification + email</option>
              </select>
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
            ${goal ? '<button type="button" class="btn btn-danger" data-delete>Supprimer</button>' : ""}
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
    const notifyCheckbox = form.querySelector("[name=notifyOnTarget]");
    const notifyDateInput = form.querySelector("[name=notifyAt]");
    const notifyChannelSelect = form.querySelector("[name=notifyChannel]");
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
      const channel = notifyChannelSelect?.value || "push";
      const needsEmail = channel === "email" || channel === "both";
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
      const enabled = notifyCheckbox?.checked !== false;
      if (notifyDateInput) {
        notifyDateInput.disabled = !enabled;
      }
      if (notifyDefaultHint) {
        notifyDefaultHint.classList.toggle("is-disabled", !enabled);
      }
      if (notifyChannelSelect) {
        notifyChannelSelect.disabled = !enabled;
      }
      if (notifyChannelWrap) {
        notifyChannelWrap.classList.toggle("is-disabled", !enabled);
      }
      if (notifyEmailWarning) {
        notifyEmailWarning.classList.toggle("is-disabled", !enabled);
      }
      if (enabled) {
        updateEmailWarning();
      }
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

    if (notifyChannelSelect) {
      notifyChannelSelect.addEventListener("change", () => {
        updateEmailWarning();
      });
    }

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
      const notifyOnTarget = notifyCheckbox?.checked !== false;
      const notifyChannel = notifyChannelSelect?.value || "push";
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
        notifyChannel: notifyOnTarget ? notifyChannel : null,
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
        close();
        if (lastMount) {
          renderGoals(ctx, lastMount);
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
            close();
            if (lastMount) {
              renderGoals(ctx, lastMount);
            }
          } catch (err) {
            goalsLogger.error("goals.delete.error", err);
            alert("Impossible de supprimer l’objectif.");
          }
        });
      }
    }
  }

  // Small helper: quick date popover for existing rows
  function toggleDatePopover(row, goal, anchorBtn) {
    if (!row || !goal) return;
    let pop = row.querySelector('[data-popover-date]');
    if (pop) {
      const isHidden = pop.hasAttribute('hidden');
      if (isHidden) pop.removeAttribute('hidden');
      else pop.setAttribute('hidden', '');
      const inputEl = pop.querySelector('input[type=date]');
      if (!isHidden && inputEl) {
        try { inputEl.focus(); } catch (_) {}
      }
      return;
    }
    // Build it
    pop = document.createElement('div');
    pop.dataset.popoverDate = '1';
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
    pop.innerHTML = `
      <div class="text-xs muted" style="margin-bottom:4px;">Jour du rappel</div>
      <div style="display:flex; gap:8px; align-items:center;">
        <input type="date" class="goal-input" ${range?.start ? `min="${escapeHtml(formatDateInputValue(range.start))}"` : ''} ${range?.end ? `max="${escapeHtml(formatDateInputValue(range.end))}"` : ''} value="${escapeHtml(initial)}">
        <button type="button" class="btn btn-primary btn-compact" data-apply>OK</button>
      </div>
    `;
    row.appendChild(pop);
    const input = pop.querySelector('input[type=date]');
    const apply = pop.querySelector('[data-apply]');
    const saveDate = async () => {
      const c = lastCtx;
      if (!c) return;
      const picked = (input?.value || '').trim();
      const payload = picked ? { notifyAt: picked, notifyOnTarget: true } : {};
      try {
        await Schema.upsertObjective(c.db, c.user.uid, payload, goal.id);
        pop.setAttribute('hidden', '');
        // Refresh this month to update labels/tooltips
        if (lastMount) {
          renderGoals(c, lastMount);
        }
      } catch (err) {
        goalsLogger.error('goals.quickDate.save', err);
        alert("Impossible de mettre à jour le jour du rappel.");
      }
    };
    apply.addEventListener('click', saveDate);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveDate(); }
      if (e.key === 'Escape') { e.preventDefault(); pop.setAttribute('hidden',''); }
    });
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 0);
  }

  GoalsNS.renderGoals = renderGoals;
  GoalsNS.openGoalForm = openGoalForm;
  GoalsNS.toggleDatePopover = toggleDatePopover;
})();
