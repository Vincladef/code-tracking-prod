// goals.js — Objectifs
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as Schema from "./schema.js";

const $ = (sel, root = document) => root.querySelector(sel);
const L = Schema.D;

let lastMount = null;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateInput(dateValue) {
  if (!dateValue) return "";
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateDisplay(value) {
  const iso = formatDateInput(value);
  if (iso) return iso;
  return value ? String(value) : "";
}

function getCurrentMonthFromHash() {
  const hash = window.location.hash || "";
  const match = hash.match(/#\/(?:u\/[^/]+\/)?goals\/(\d{4}-\d{2})/);
  if (match) return match[1];
  return Schema.monthKeyFromDate(new Date());
}

function routeToMonth(monthKey) {
  if (typeof window.routeTo === "function") {
    window.routeTo(`#/goals/${monthKey}`);
  } else {
    window.location.hash = `#/goals/${monthKey}`;
  }
}

function prevMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, (m || 1) - 2, 1);
  return Schema.monthKeyFromDate(d);
}

function nextMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, (m || 1), 1);
  return Schema.monthKeyFromDate(d);
}

function cardOfGoal(o) {
  const badge = o.type === "hebdo" ? `S${o.weekOfMonth || "?"}` : (o.type === "mensuel" ? "Mois" : "Annuel");
  const status = o.status === "termine" ? "Terminé" : "En cours";
  const month = o.monthKey || "";
  const start = formatDateDisplay(o.startDate);
  const end = formatDateDisplay(o.endDate);
  const subtitle = o.type === "hebdo" ? month : (o.type === "annuel" ? `${start} → ${end}` : month);
  return `
    <div class="goal-card card" data-goal="${escapeHtml(o.id)}">
      <div class="goal-card-title">${escapeHtml(o.titre || "Objectif")}</div>
      <div class="goal-card-sub">${escapeHtml(badge)} ${subtitle ? `— ${escapeHtml(subtitle)}` : ""}</div>
      <div class="goal-card-status">${escapeHtml(status)}</div>
    </div>
  `;
}

async function openGoalDetail(ctx, objectifId) {
  try {
    const goal = await Schema.getObjective(ctx.db, ctx.user.uid, objectifId);
    if (!goal) return;

    const consSnap = await getDocs(collection(ctx.db, "u", ctx.user.uid, "consignes"));
    const linked = consSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => c.objectiveId === objectifId);

    const listHtml = linked.length
      ? `<ul class="goal-list">${linked
          .map((c) => `<li>${escapeHtml(c.text || c.titre || c.name || c.id)}</li>`)
          .join("")}</ul>`
      : '<div class="muted">Aucune consigne liée.</div>';

    const html = `
      <div class="goal-modal-card">
        <div class="goal-modal-header">
          <div>
            <div class="goal-modal-title">${escapeHtml(goal.titre || "Objectif")}</div>
            <div class="goal-card-sub">${goal.type === "hebdo" ? `Semaine ${escapeHtml(goal.weekOfMonth || "?")}` : "Période"} — ${escapeHtml(formatDateDisplay(goal.startDate))} → ${escapeHtml(formatDateDisplay(goal.endDate))}</div>
          </div>
          <button class="btn-ghost" data-close aria-label="Fermer">✖</button>
        </div>
        <p class="mt">${escapeHtml(goal.description || "")}</p>
        <div class="goal-section mt">
          <div class="goal-section-title">Consignes liées</div>
          ${listHtml}
        </div>
      </div>
    `;

    const wrap = document.createElement("div");
    wrap.className = "goal-modal";
    wrap.innerHTML = html;
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) wrap.remove();
    });
    wrap.querySelector('[data-close]')?.addEventListener('click', () => wrap.remove());
    document.body.appendChild(wrap);
  } catch (err) {
    L.error("goals.detail.error", err);
  }
}

export async function renderGoals(ctx, root) {
  lastMount = root;
  const monthKey = getCurrentMonthFromHash();
  let items = [];
  try {
    items = await Schema.listObjectivesByMonth(ctx.db, ctx.user.uid, monthKey);
  } catch (err) {
    L.error("goals.list.error", err);
  }

  const weekly = new Map();
  const monthly = [];
  const yearly = [];

  for (const o of items) {
    if (o.type === "hebdo") {
      const w = o.weekOfMonth || 1;
      if (!weekly.has(w)) weekly.set(w, []);
      weekly.get(w).push(o);
    } else if (o.type === "annuel") {
      yearly.push(o);
    } else {
      monthly.push(o);
    }
  }

  const sortByTitle = (a, b) => (a.titre || "").localeCompare(b.titre || "");
  weekly.forEach((list) => list.sort(sortByTitle));
  monthly.sort(sortByTitle);
  yearly.sort(sortByTitle);

  const weeksHtml = Array.from(weekly.keys())
    .sort((a, b) => a - b)
    .map((week) => {
      const list = weekly.get(week) || [];
      return `
        <div class="goal-section">
          <div class="goal-section-title">Semaine ${week}</div>
          <div class="goal-grid">${list.map(cardOfGoal).join("")}</div>
        </div>
      `;
    })
    .join("");

  const monthlyHtml = monthly.length
    ? `
      <div class="goal-section">
        <div class="goal-section-title">Objectifs mensuels</div>
        <div class="goal-grid">${monthly.map(cardOfGoal).join("")}</div>
      </div>
    `
    : "";

  const yearlyHtml = yearly.length
    ? `
      <div class="goal-section">
        <div class="goal-section-title">Objectifs annuels</div>
        <div class="goal-grid">${yearly.map(cardOfGoal).join("")}</div>
      </div>
    `
    : "";

  const emptyHtml = !items.length
    ? '<div class="goal-empty muted">Aucun objectif enregistré pour ce mois.</div>'
    : "";

  root.innerHTML = `
    <section class="card goal-shell">
      <div class="goal-top">
        <div class="goal-nav">
          <button class="btn-ghost" id="go-prev" aria-label="Mois précédent">⬅️</button>
          <div class="goal-month">${escapeHtml(monthKey)}</div>
          <button class="btn-ghost" id="go-next" aria-label="Mois suivant">➡️</button>
        </div>
        <button class="btn btn-primary" id="goal-create" aria-label="Nouvel objectif">＋</button>
      </div>
      ${weeksHtml}
      ${monthlyHtml}
      ${yearlyHtml}
      ${emptyHtml}
    </section>
  `;

  $("#go-prev", root).onclick = () => routeToMonth(prevMonth(monthKey));
  $("#go-next", root).onclick = () => routeToMonth(nextMonth(monthKey));
  $("#goal-create", root).onclick = () => openGoalForm(ctx);

  root.querySelectorAll("[data-goal]").forEach((el) => {
    el.addEventListener("click", () => openGoalDetail(ctx, el.getAttribute("data-goal")));
  });
}

export function openGoalForm(ctx, goal = null) {
  const monthKey = goal?.monthKey || getCurrentMonthFromHash();
  const defaultStart = goal?.startDate || `${monthKey}-01`;
  const defaultEnd = goal?.endDate || `${monthKey}-28`;
  const defaultWeek = goal?.weekOfMonth || Schema.weekOfMonthFromDate(defaultStart);
  const html = `
    <div class="goal-modal-card">
      <div class="goal-modal-header">
        <div class="goal-modal-title">${goal ? "Modifier" : "Nouvel"} objectif</div>
        <button class="btn-ghost" data-close aria-label="Fermer">✖</button>
      </div>
      <form class="goal-form" id="goal-form">
        <label class="goal-field">
          <span class="goal-label">Titre</span>
          <input name="titre" required class="goal-input" value="${escapeHtml(goal?.titre || "")}">
        </label>
        <label class="goal-field">
          <span class="goal-label">Type</span>
          <select name="type" id="goal-type" class="goal-input">
            <option value="hebdo" ${goal?.type === "hebdo" ? "selected" : ""}>Hebdomadaire</option>
            <option value="mensuel" ${!goal || goal?.type === "mensuel" ? "selected" : ""}>Mensuel</option>
            <option value="annuel" ${goal?.type === "annuel" ? "selected" : ""}>Annuel</option>
          </select>
        </label>
        <div class="goal-field" data-week-row>
          <span class="goal-label">Semaine du mois</span>
          <select name="weekOfMonth" class="goal-input">
            ${[1, 2, 3, 4, 5, 6]
              .map((w) => `<option value="${w}" ${Number(defaultWeek) === w ? "selected" : ""}>Semaine ${w}</option>`)
              .join("")}
          </select>
        </div>
        <label class="goal-field">
          <span class="goal-label">Date de début</span>
          <input type="date" name="startDate" class="goal-input" value="${escapeHtml(formatDateInput(defaultStart))}">
        </label>
        <label class="goal-field">
          <span class="goal-label">Date de fin</span>
          <input type="date" name="endDate" class="goal-input" value="${escapeHtml(formatDateInput(defaultEnd))}">
        </label>
        <label class="goal-field">
          <span class="goal-label">Description</span>
          <textarea name="description" rows="3" class="goal-input">${escapeHtml(goal?.description || "")}</textarea>
        </label>
        <label class="goal-field">
          <span class="goal-label">Statut</span>
          <select name="status" class="goal-input">
            <option value="en_cours" ${goal?.status !== "termine" ? "selected" : ""}>En cours</option>
            <option value="termine" ${goal?.status === "termine" ? "selected" : ""}>Terminé</option>
          </select>
        </label>
        <div class="goal-actions">
          <button type="button" class="btn btn-ghost" data-close>Annuler</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  `;

  const wrap = document.createElement("div");
  wrap.className = "goal-modal";
  wrap.innerHTML = html;
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  wrap.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', close));

  const typeSelect = wrap.querySelector("#goal-type");
  const weekRow = wrap.querySelector('[data-week-row]');
  const syncWeekRow = () => {
    if (!weekRow) return;
    weekRow.style.display = typeSelect.value === "hebdo" ? "" : "none";
  };
  syncWeekRow();
  typeSelect.addEventListener("change", syncWeekRow);

  wrap.querySelector("#goal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const titre = (fd.get("titre") || "").toString().trim();
    if (!titre) {
      alert("Le titre est obligatoire.");
      return;
    }

    const data = {
      titre,
      type: fd.get("type") || "mensuel",
      description: (fd.get("description") || "").toString().trim(),
      startDate: fd.get("startDate") || defaultStart,
      endDate: fd.get("endDate") || defaultEnd,
      status: fd.get("status") || "en_cours",
    };
    if (data.type === "hebdo") {
      data.weekOfMonth = Number(fd.get("weekOfMonth") || defaultWeek || 1);
    }
    data.monthKey = Schema.monthKeyFromDate(data.startDate);

    try {
      await Schema.upsertObjective(ctx.db, ctx.user.uid, data, goal?.id || null);
    } catch (err) {
      L.error("goals.save.error", err);
      alert("Impossible d'enregistrer l'objectif.");
      return;
    }

    close();
    if (lastMount) {
      renderGoals(ctx, lastMount);
    } else {
      const mount = document.getElementById("view-root");
      if (mount) renderGoals(ctx, mount);
    }
  });
}
