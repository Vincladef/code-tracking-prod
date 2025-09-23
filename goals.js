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

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
    root.innerHTML = "";

    const section = document.createElement("section");
    section.className = "card";
    section.style.display = "flex";
    section.style.flexDirection = "column";
    section.style.gap = "12px";
    section.style.padding = "16px";
    root.appendChild(section);

    const header = document.createElement("div");
    header.className = "goal-header";
    header.innerHTML = `
      <div>
        <h2 class="text-lg font-semibold">Objectifs</h2>
      </div>
      <button type="button" class="btn btn-primary" data-new-goal>＋ Nouvel objectif</button>
    `;
    section.appendChild(header);

    header.querySelector("[data-new-goal]").onclick = () => openGoalForm(ctx);

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

    const createGoalRow = (goal, subtitleOverride = null) => {
      const row = document.createElement("div");
      row.className = "goal-row";
      const subtitle = subtitleOverride || typeLabel(goal, goal.monthKey);
      row.innerHTML = `
        <div class="goal-title">
          <div>${escapeHtml(goal.titre || "Objectif")}</div>
          <div class="text-xs text-[var(--muted)]">${escapeHtml(subtitle)}</div>
        </div>
        <div class="goal-quick">
          <select class="select-compact">
            <option value="">— choisir —</option>
            <option value="0">Pas de réponse</option>
            <option value="1">Non</option>
            <option value="2">Plutôt non</option>
            <option value="3">Neutre</option>
            <option value="4">Plutôt oui</option>
            <option value="5">Oui</option>
          </select>
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

      headerRow.querySelector("[data-add-month]").addEventListener("click", () => {
        openGoalForm(ctx, null, { type: "mensuel", monthKey });
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
          openGoalForm(ctx, null, { type: "hebdo", monthKey, weekOfMonth: week });
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
  }

  function openGoalForm(ctx, goal = null, initial = {}) {
    const monthKey = goal?.monthKey || initial.monthKey || Schema.monthKeyFromDate(new Date());
    let weekOfMonth = Number(goal?.weekOfMonth || initial.weekOfMonth || 1);
    const typeInitial = goal?.type || initial.type || "hebdo";
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

    const wrap = document.createElement("div");
    wrap.className = "goal-modal";
    wrap.innerHTML = `
      <div class="goal-modal-card">
        <div class="goal-modal-header">
          <div class="goal-modal-title">${goal ? "Modifier" : "Nouvel"} objectif</div>
          <button class="btn-ghost" type="button" data-close>✕</button>
        </div>
        <form class="goal-form" id="goal-form">
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
          <div class="goal-actions">
            <button type="button" class="btn btn-ghost" data-close>Annuler</button>
            <button type="submit" class="btn btn-primary">Enregistrer</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(wrap);

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

    const syncWeekPicker = () => {
      weekPicker.style.display = typeSelect.value === "hebdo" ? "" : "none";
    };
    syncWeekPicker();

    weekButtons.forEach((btn) => {
      const value = Number(btn.dataset.w || "1");
      if (value === weekOfMonth) {
        btn.classList.add("is-active");
      }
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        weekOfMonth = value;
        weekButtons.forEach((other) => other.classList.toggle("is-active", other === btn));
      });
    });

    typeSelect.addEventListener("change", syncWeekPicker);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const titre = form.querySelector("[name=titre]").value.trim();
      if (!titre) {
        alert("Le titre est obligatoire.");
        return;
      }
      const description = form.querySelector("[name=description]").value.trim();
      const type = typeSelect.value;

      const data = {
        titre,
        description,
        type,
        monthKey,
      };
      if (type === "hebdo") {
        data.weekOfMonth = weekOfMonth;
      }

      try {
        await Schema.upsertObjective(ctx.db, ctx.user.uid, data, goal?.id || null);
        close();
        if (lastMount) {
          renderGoals(ctx, lastMount);
        }
      } catch (err) {
        goalsLogger.error("goals.save.error", err);
        alert("Impossible d'enregistrer l’objectif.");
      }
    });
  }

  GoalsNS.renderGoals = renderGoals;
  GoalsNS.openGoalForm = openGoalForm;
})();
