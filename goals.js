// goals.js — Objectifs timeline
/* global Schema */
const Goals = window.Goals = window.Goals || {};
const L = Schema.D || { info: () => {}, group: () => {}, groupEnd: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

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

function typeLabel(goal) {
  if (goal.type === "hebdo") {
    return `Semaine ${goal.weekOfMonth || "?"}`;
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
      <p class="text-sm text-[var(--muted)]">Quatre semaines par mois, saisie rapide incluse.</p>
    </div>
    <div class="flex gap-2">
      <button type="button" class="btn btn-primary" data-new-goal>＋ Nouvel objectif</button>
    </div>
  `;
  section.appendChild(header);

  header.querySelector("[data-new-goal]").onclick = () => openGoalForm(ctx);

  const timeline = document.createElement("div");
  timeline.className = "goal-timeline";
  section.appendChild(timeline);

  const topSentinel = document.createElement("div");
  const bottomSentinel = document.createElement("div");
  topSentinel.style.height = bottomSentinel.style.height = "1px";
  timeline.appendChild(topSentinel);
  timeline.appendChild(bottomSentinel);

  const rendered = new Set();
  const months = [];

  const createGoalRow = (goal) => {
    const row = document.createElement("div");
    row.className = "goal-row";
    const subtitle = typeLabel(goal);
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
    select.addEventListener("change", async () => {
      if (select.value === "") return;
      const todayIso = new Date().toISOString().slice(0, 10);
      try {
        await Schema.saveObjectiveEntry(
          ctx.db,
          ctx.user.uid,
          goal.id,
          todayIso,
          Number(select.value || 0)
        );
        row.style.outline = "2px solid #86efac";
        setTimeout(() => { row.style.outline = "none"; }, 600);
      } catch (err) {
        L.error("goals.quickEntry.error", err);
        row.style.outline = "2px solid #fca5a5";
        setTimeout(() => { row.style.outline = "none"; }, 800);
      }
    });
    return row;
  };

  const renderMonth = async (monthKey, where = "end") => {
    if (rendered.has(monthKey)) return;
    rendered.add(monthKey);
    months.push(monthKey);
    months.sort();

    const box = document.createElement("section");
    box.className = "goal-month";
    box.dataset.month = monthKey;
    const title = document.createElement("h3");
    title.textContent = monthKey;
    box.appendChild(title);

    const weeks = Schema.weeksOf(monthKey);
    const containers = new Map();
    weeks.forEach((week, idx) => {
      const weekBox = document.createElement("div");
      weekBox.className = "goal-week";
      weekBox.dataset.week = String(week);
      const label = document.createElement("div");
      label.className = "muted";
      label.style.marginBottom = "6px";
      label.textContent = `Semaine ${week}`;
      const list = document.createElement("div");
      list.className = "goal-list";
      weekBox.appendChild(label);
      weekBox.appendChild(list);
      containers.set(week, list);
      box.appendChild(weekBox);
      if (idx === 0) {
        weekBox.classList.add("first-week");
      }
    });

    let goals = [];
    try {
      goals = await Schema.listObjectivesByMonth(ctx.db, ctx.user.uid, monthKey);
    } catch (err) {
      L.error("goals.month.load", err);
    }

    goals.sort((a, b) => (a.titre || "").localeCompare(b.titre || ""));

    let hasContent = false;
    const firstWeek = weeks[0];

    weeks.forEach((week) => {
      const list = containers.get(week);
      if (!list) return;
      const items = goals.filter((goal) => {
        if (goal.type === "hebdo") {
          return Number(goal.weekOfMonth || 1) === week;
        }
        return week === firstWeek;
      });
      items.forEach((goal) => {
        hasContent = true;
        list.appendChild(createGoalRow(goal));
      });
    });

    if (!hasContent) {
      const empty = document.createElement("div");
      empty.className = "goal-empty muted";
      empty.textContent = "Aucun objectif pour ce mois.";
      box.appendChild(empty);
    }

    if (where === "start") {
      const nextSibling = timeline.children[1] || bottomSentinel;
      timeline.insertBefore(box, nextSibling);
    } else {
      timeline.insertBefore(box, bottomSentinel);
    }
  };

  const observer = new IntersectionObserver(async (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      if (entry.target === topSentinel) {
        const base = months[0] || Schema.monthKeyFromDate(new Date());
        await renderMonth(monthShift(base, -1), "start");
      } else if (entry.target === bottomSentinel) {
        const base = months[months.length - 1] || Schema.monthKeyFromDate(new Date());
        await renderMonth(monthShift(base, 1), "end");
      }
    }
  }, { root: null, rootMargin: "300px" });

  const currentMonth = Schema.monthKeyFromDate(new Date());
  await renderMonth(currentMonth, "end");
  observer.observe(topSentinel);
  observer.observe(bottomSentinel);
}

function openGoalForm(ctx, goal = null) {
  const monthKey = goal?.monthKey || Schema.monthKeyFromDate(new Date());
  let weekOfMonth = Number(goal?.weekOfMonth || 1);
  const typeInitial = goal?.type || "hebdo";

  const wrap = document.createElement("div");
  wrap.className = "goal-modal";
  wrap.innerHTML = `
    <div class="goal-modal-card">
      <div class="goal-modal-header">
        <div class="goal-modal-title">${goal ? "Modifier" : "Nouvel"} objectif</div>
        <button class="btn-ghost" type="button" data-close>✕</button>
      </div>
      <form class="goal-form" id="goal-form">
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
            <button type="button" class="btn-ghost" data-w="1">S1</button>
            <button type="button" class="btn-ghost" data-w="2">S2</button>
            <button type="button" class="btn-ghost" data-w="3">S3</button>
            <button type="button" class="btn-ghost" data-w="4">S4</button>
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
      L.error("goals.save.error", err);
      alert("Impossible d'enregistrer l’objectif.");
    }
  });
}

Goals.renderGoals = renderGoals;
Goals.openGoalForm = openGoalForm;
