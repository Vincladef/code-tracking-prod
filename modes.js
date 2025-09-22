// modes.js — Journalier / Pratique / Historique
import { collection, query, where, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as Schema from "./schema.js";

const L = Schema.D;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// --- Normalisation du jour (LUN..DIM ou mon..sun) ---
const DAY_ALIAS = { mon: "LUN", tue: "MAR", wed: "MER", thu: "JEU", fri: "VEN", sat: "SAM", sun: "DIM" };
const DAY_VALUES = new Set(["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"]);

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
    <div class="w-[min(680px,92vw)] rounded-2xl bg-white border border-gray-200 p-6 shadow-2xl">
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

function smallBtn(label, cls = "") {
  return `<button type="button" class="btn btn-ghost text-sm ${cls}">${label}</button>`;
}

function navigate(hash) {
  const fn = window.routeTo;
  if (typeof fn === "function") fn(hash);
  else window.location.hash = hash;
}

function toAppPath(h) {
  return h.replace(/^#\/u\/[^/]+\//, "#/");
}

async function categorySelect(ctx, mode, currentName = "") {
  const cats = await Schema.fetchCategories(ctx.db, ctx.user.uid);
  const names = cats.filter(c => c.mode === mode).map(c => c.name);
  const listId = `category-list-${mode}-${Date.now()}`;

  return `
    <label class="block text-sm text-[var(--muted)] mb-1">Catégorie</label>
    <input name="categoryInput"
           list="${listId}"
           class="w-full"
           placeholder="Choisir ou taper un nom…"
           value="${escapeHtml(currentName || "")}">
    <datalist id="${listId}">
      ${names.map(n => `<option value="${escapeHtml(n)}"></option>`).join("")}
    </datalist>
    <div class="text-xs text-[var(--muted)] mt-1">
      Tu peux taper un nouveau nom ou choisir dans la liste.
    </div>
  `;
}

function consigneActions() {
  return `
    <div class="flex items-center gap-2">
      ${smallBtn("Historique", "js-histo")}
      ${smallBtn("Modifier", "js-edit")}
      ${smallBtn("Supprimer", "js-del text-red-600")}
    </div>
  `;
}

function inputForType(consigne) {
  if (consigne.type === "short") {
    return `<input name="short:${consigne.id}" class="w-full" placeholder="Réponse">`;
  }
  if (consigne.type === "long") {
    return `<textarea name="long:${consigne.id}" rows="3" class="w-full" placeholder="Réponse"></textarea>`;
  }
  if (consigne.type === "num") {
    return `
      <input type="range" min="1" max="10" value="5" name="num:${consigne.id}" class="w-full">
      <div class="text-sm opacity-70 mt-1" data-meter="num:${consigne.id}">5</div>
      <script>(()=>{const r=document.currentScript.previousElementSibling.previousElementSibling;const o=document.currentScript.previousElementSibling;if(r){r.addEventListener('input',()=>{o.textContent=r.value;});}})();</script>
    `;
  }
  if (consigne.type === "likert6") {
    // Échelle d’incertitude
    const items = [
      ["no_answer", "Pas de réponse"],
      ["no", "Non"],
      ["rather_no", "Plutôt non"],
      ["medium", "Neutre"],
      ["rather_yes", "Plutôt oui"],
      ["yes", "Oui"],
    ];
    return `
      <div class="flex flex-wrap gap-4">
        ${items.map(([value, label]) => `
          <label class="inline-flex items-center gap-2">
            <input type="radio" name="likert6:${consigne.id}" value="${value}">
            <span>${label}</span>
          </label>`).join("")}
      </div>
    `;
  }
  return "";
}

function collectAnswers(form, consignes) {
  const answers = [];
  for (const consigne of consignes) {
    if (consigne.type === "short") {
      const val = form.querySelector(`[name="short:${consigne.id}"]`)?.value?.trim();
      if (val) answers.push({ consigne, value: val });
    } else if (consigne.type === "long") {
      const val = form.querySelector(`[name="long:${consigne.id}"]`)?.value?.trim();
      if (val) answers.push({ consigne, value: val });
    } else if (consigne.type === "num") {
      const val = form.querySelector(`[name="num:${consigne.id}"]`)?.value;
      if (val) answers.push({ consigne, value: Number(val) });
    } else {
      const val = form.querySelector(`[name="likert6:${consigne.id}"]:checked`)?.value;
      if (val) answers.push({ consigne, value: val });
    }
  }
  return answers;
}

export async function openConsigneForm(ctx, consigne = null) {
  const mode = consigne?.mode || (ctx.route.includes("/practice") ? "practice" : "daily");
  L.group("ui.consigneForm.open", { mode, consigneId: consigne?.id || null });
  const catUI = await categorySelect(ctx, mode, consigne?.category || null);
  const priority = Number(consigne?.priority ?? 2);
  const html = `
    <h3 class="text-lg font-semibold mb-2">${consigne ? "Modifier" : "Nouvelle"} consigne</h3>
    <form class="grid gap-4" id="consigne-form">
      <label class="grid gap-1">
        <span class="text-sm text-[var(--muted)]">Texte de la consigne</span>
        <input name="text" required class="w-full"
               value="${escapeHtml(consigne?.text || "")}" />
      </label>

      <label class="grid gap-1">
        <span class="text-sm text-[var(--muted)]">Type de réponse</span>
        <select name="type" class="w-full">
          <option value="short" ${consigne?.type === "short" ? "selected" : ""}>Texte court</option>
          <option value="long" ${consigne?.type === "long" ? "selected" : ""}>Texte long</option>
          <option value="likert6" ${consigne?.type === "likert6" ? "selected" : ""}>
            Échelle d’incertitude (Pas de réponse → Oui)
          </option>
          <option value="num" ${consigne?.type === "num" ? "selected" : ""}>Échelle numérique (1–10)</option>
        </select>
      </label>

      ${catUI}

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
        <span>Activer la répétition espacée</span>
      </label>

      ${mode === "daily"
        ? `
      <fieldset class="grid gap-2">
        <legend class="text-sm text-[var(--muted)]">Fréquence (jours)</legend>
        <div class="flex flex-wrap gap-2">
          ${["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"]
            .map((day) => {
              const selected = consigne?.days?.includes(day);
              return `<label class="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-sm">
              <input type="checkbox" name="days" value="${day}" ${selected ? "checked" : ""}>
              <span>${day}</span>
            </label>`;
            })
            .join("")}
        </div>
      </fieldset>`
        : ""}

      <div class="flex justify-end gap-2 pt-2">
        <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `;
  const m = modal(html);
  L.groupEnd();
  $("#cancel", m).onclick = () => m.remove();

  $("#consigne-form", m).onsubmit = async (e) => {
    e.preventDefault();
    L.group("ui.consigneForm.submit");
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
        active: true
      };
      if (mode === "daily") {
        payload.days = $$("input[name=days]:checked", m).map((input) => input.value);
      }
      L.info("payload", payload);

      if (consigne) {
        await Schema.updateConsigne(ctx.db, ctx.user.uid, consigne.id, payload);
      } else {
        await Schema.addConsigne(ctx.db, ctx.user.uid, payload);
      }
      m.remove();
      const root = document.getElementById("view-root");
      if (mode === "practice") renderPractice(ctx, root);
      else renderDaily(ctx, root);
    } finally {
      L.groupEnd();
    }
  };
}

function dotColor(type, v){
  if (type === "likert6") {
    const map = { yes:"ok", rather_yes:"ok", medium:"mid", rather_no:"ko", no:"ko", no_answer:"na" };
    return map[v] || "na";
  }
  if (type === "num") {
    const n = Number(v) || 0;
    return n >= 7 ? "ok" : n >= 4 ? "mid" : "ko";
  }
  return "na";
}

function dotHTML(kind){
  const style = kind === "ok" ? "background:#16A34A"
    : kind === "mid" ? "background:#EAB308"
    : kind === "ko" ? "background:#DC2626"
    : "background:#94A3B8";
  return `<span style="display:inline-block;width:.6rem;height:.6rem;border-radius:999px;${style}"></span>`;
}

export async function openHistory(ctx, consigne) {
  L.group("ui.history.open", { consigneId: consigne.id, type: consigne.type });
  const qy = query(
    collection(ctx.db, `u/${ctx.user.uid}/responses`),
    where("consigneId", "==", consigne.id),
    orderBy("createdAt", "desc"),
    limit(60)
  );
  const ss = await getDocs(qy);
  L.info("ui.history.rows", ss.size);
  const rows = ss.docs.map((d) => ({ id: d.id, ...d.data() }));

  const list = rows
    .map((r) => {
      const createdAt = r.createdAt?.toDate?.() ?? r.createdAt;
      const date = createdAt ? new Date(createdAt).toLocaleString() : "";
      const formatted = formatValue(consigne.type, r.value);
      const status = dotColor(consigne.type, r.value);
      return `
    <li class="py-2">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3">
        <span class="text-xs sm:text-sm text-[var(--muted)]">${escapeHtml(date)}</span>
        <span class="flex items-center gap-2 text-sm font-medium break-words">
          ${dotHTML(status)} <span>${escapeHtml(formatted)}</span>
        </span>
      </div>
    </li>
  `;
    })
    .join("");

  const canGraph = consigne.type === "likert6" || consigne.type === "num";
  const html = `
    <div class="flex items-start justify-between gap-4 mb-4">
      <div>
        <h3 class="text-lg font-semibold mb-1">Historique — ${escapeHtml(consigne.text)}</h3>
        <p class="text-sm text-[var(--muted)]">Dernières réponses</p>
      </div>
      <button class="btn btn-ghost text-sm" data-close>Fermer</button>
    </div>
    ${canGraph ? `<canvas id="histoChart" height="160" class="mb-4"></canvas>` : ""}
    <ul class="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto pr-1">${list || '<li class="py-3 text-sm text-[var(--muted)]">Aucune réponse pour l’instant.</li>'}</ul>
  `;
  const panel = drawer(html);
  panel.querySelector('[data-close]')?.addEventListener('click', () => panel.remove());

  if (canGraph && window.Chart) {
    L.info("ui.history.chart", { points: rows.length });
    const canvas = panel.querySelector('#histoChart');
    if (canvas) {
      const ctx2 = canvas.getContext('2d');
      const data = rows.slice().reverse();
      const accent = (getComputedStyle(document.body).getPropertyValue('--accent-600') || '#60BFFD').trim();
      new Chart(ctx2, {
        type: 'line',
        data: {
          labels: data.map((r) => {
            const createdAt = r.createdAt?.toDate?.() ?? r.createdAt;
            return createdAt ? new Date(createdAt).toLocaleDateString() : '';
          }),
          datasets: [
            {
              label: 'Valeur',
              data: data.map((r) => (consigne.type === 'likert6' ? likertToNum(r.value) : Number(r.value || 0))),
              tension: 0.25,
              fill: false,
              borderColor: accent,
              backgroundColor: accent,
              pointRadius: 3,
              pointHoverRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              ticks: { color: '#64748B' },
              grid: { color: '#E2E8F0' }
            },
            y: {
              beginAtZero: true,
              max: consigne.type === 'likert6' ? 5 : 10,
              ticks: { color: '#64748B' },
              grid: { color: '#E2E8F0' }
            }
          }
        }
      });
    }
  } else {
    L.info("ui.history.chart.skip", { canGraph, hasChart: !!window.Chart });
  }

  L.groupEnd();

  function formatValue(type, v) {
    if (type === 'likert6') {
      return (
        {
          no: 'Non',
          rather_no: 'Plutôt non',
          medium: 'Neutre',
          rather_yes: 'Plutôt oui',
          yes: 'Oui',
          no_answer: '—'
        }[v] || v || '—'
      );
    }
    return String(v ?? '—');
  }
  function likertToNum(v) {
    return (
      {
        no: 0,
        rather_no: 1,
        medium: 2,
        rather_yes: 3,
        yes: 4,
        no_answer: 2
      }[v] ?? 2
    );
  }
}

export async function renderPractice(ctx, root, _opts = {}) {
  L.group("screen.practice.render", { hash: ctx.route });
  root.innerHTML = "";
  const container = document.createElement("div");
  container.className = "space-y-4";
  root.appendChild(container);

  const currentHash = ctx.route || window.location.hash || "#/practice";
  const qp = new URLSearchParams(currentHash.split("?")[1] || "");
  const currentCat = qp.get("cat") || "";

  const cats = (await Schema.fetchCategories(ctx.db, ctx.user.uid)).filter((c) => c.mode === "practice");
  const catOptions = [
    `<option value="">Toutes les catégories</option>`,
    ...cats.map(
      (c) =>
        `<option value="${escapeHtml(c.name)}" ${c.name === currentCat ? "selected" : ""}>${escapeHtml(c.name)}</option>`
    )
  ].join("");

  const card = document.createElement("section");
  card.className = "card p-4 space-y-4";
  card.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <label class="text-sm text-[var(--muted)]" for="practice-cat">Catégorie</label>
        <select id="practice-cat" class="min-w-[160px]">${catOptions}</select>
      </div>
      <div>${smallBtn("+ Nouvelle consigne", "js-new")}</div>
    </div>
    <form id="practice-form" class="grid gap-4"></form>
    <div class="flex justify-end">
      <button class="btn btn-primary" type="button" id="save">Enregistrer</button>
    </div>
  `;
  container.appendChild(card);

  const selector = card.querySelector("#practice-cat");
  selector.onchange = (e) => {
    const value = e.target.value;
    const base = currentHash.split("?")[0];
    navigate(`${toAppPath(base)}?cat=${encodeURIComponent(value)}`);
  };
  card.querySelector(".js-new").onclick = () => openConsigneForm(ctx, null);

  const all = await Schema.fetchConsignes(ctx.db, ctx.user.uid, "practice");
  const consignes = all.filter((c) => !currentCat || c.category === currentCat);
  L.info("screen.practice.consignes", consignes.length);

  const form = card.querySelector("#practice-form");
  if (!consignes.length) {
    form.innerHTML = `<div class="rounded-xl border border-dashed border-gray-200 bg-white p-3 text-sm text-[var(--muted)]">Aucune consigne pour cette catégorie.</div>`;
  } else {
    for (const consigne of consignes) {
      const consigneCard = document.createElement("div");
      consigneCard.className = "card p-3 space-y-3";
      consigneCard.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <h4 class="font-semibold">${escapeHtml(consigne.text)}</h4>
            ${pill(consigne.category || "Général")}
          </div>
          ${consigneActions()}
        </div>
        ${inputForType(consigne)}
      `;
      form.appendChild(consigneCard);

      const bH = consigneCard.querySelector(".js-histo");
      const bE = consigneCard.querySelector(".js-edit");
      const bD = consigneCard.querySelector(".js-del");
      bH.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        Schema.D.info("ui.history.click", consigne.id);
        openHistory(ctx, consigne);
      };
      bE.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        Schema.D.info("ui.editConsigne.click", consigne.id);
        openConsigneForm(ctx, consigne);
      };
      bD.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (confirm("Supprimer cette consigne ? (historique conservé)")) {
          Schema.D.info("ui.deleteConsigne.confirm", consigne.id);
          await Schema.softDeleteConsigne(ctx.db, ctx.user.uid, consigne.id);
          renderPractice(ctx, root);
        }
      };
    }
  }

  card.querySelector("#save").onclick = async (e) => {
    e.preventDefault();
    const answers = collectAnswers(form, consignes);
    if (!answers.length) {
      alert("Aucune réponse");
      return;
    }
    await Schema.saveResponses(ctx.db, ctx.user.uid, "practice", answers);
    if (typeof Schema.startNewPracticeSession === "function") {
      try {
        await Schema.startNewPracticeSession(ctx.db, ctx.user.uid);
      } catch (_) {}
    }
    $$("input[type=text],textarea", form).forEach((input) => (input.value = ""));
    $$("input[type=range]", form).forEach((input) => {
      input.value = 5;
      input.dispatchEvent(new Event("input"));
    });
    $$("input[type=radio]", form).forEach((input) => (input.checked = false));
  };
  L.groupEnd();
}

export async function renderDaily(ctx, root, opts = {}) {
  root.innerHTML = "";
  const container = document.createElement("div");
  container.className = "space-y-4";
  root.appendChild(container);

  const currentHash = ctx.route || window.location.hash || "#/daily";
  const qp = new URLSearchParams(currentHash.split("?")[1] || "");
  const jours = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"];
  const todayIdx = (new Date().getDay() + 6) % 7;
  const requested = normalizeDay(opts.day) || normalizeDay(qp.get("day"));
  const currentDay = requested || jours[todayIdx];
  L.group("screen.daily.render", { hash: ctx.route, day: currentDay });

  const card = document.createElement("section");
  card.className = "card p-4 space-y-4";
  const buttons = jours
    .map(
      (day) => `
        <button class="px-3 py-1 text-sm rounded-lg border ${day === currentDay ? "bg-[var(--accent-50)] border-[var(--accent-400)] font-medium" : "bg-white border-gray-200"}" data-day="${day}">${day}</button>
      `
    )
    .join("");
  card.innerHTML = `
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex flex-wrap gap-2" data-day-buttons>${buttons}</div>
      <div class="ml-auto">${smallBtn("+ Nouvelle consigne", "js-new")}</div>
    </div>
  `;
  container.appendChild(card);

  card.querySelectorAll("[data-day]").forEach((btn) => {
    btn.onclick = () => {
      const base = currentHash.split("?")[0];
      navigate(`${toAppPath(base)}?day=${btn.dataset.day}`);
    };
  });
  card.querySelector(".js-new").onclick = () => openConsigneForm(ctx, null);

  const all = await Schema.fetchConsignes(ctx.db, ctx.user.uid, "daily");
  const consignes = all.filter((c) => !c.days?.length || c.days.includes(currentDay));
  L.info("screen.daily.consignes", consignes.length);

  const byPriority = { 1: [], 2: [], 3: [] };
  for (const consigne of consignes) {
    const key = Number(consigne.priority) || 2;
    (byPriority[key] ?? byPriority[2]).push(consigne);
  }

  const form = document.createElement("form");
  form.className = "grid gap-4";
  card.appendChild(form);

  const renderGroup = (list, collapsed, title) => {
    if (!list.length) return;
    const catGroups = {};
    list.forEach((item) => {
      const cat = item.category || "Général";
      (catGroups[cat] ??= []).push(item);
    });

    const content = document.createElement("div");
    content.className = "space-y-4";

    Object.entries(catGroups).forEach(([cat, items]) => {
      const wrap = document.createElement("div");
      wrap.className = "space-y-3";
      wrap.innerHTML = `<div class="text-sm font-medium text-[var(--muted)] uppercase tracking-wide">${escapeHtml(cat)}</div>`;
      const stack = document.createElement("div");
      stack.className = "space-y-3";
      wrap.appendChild(stack);

      items.forEach((item) => {
        const itemCard = document.createElement("div");
        itemCard.className = "card p-3 space-y-3";
        itemCard.innerHTML = `
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="font-semibold">${escapeHtml(item.text)}</div>
            ${consigneActions()}
          </div>
          ${inputForType(item)}
        `;
        stack.appendChild(itemCard);

        const bH = itemCard.querySelector(".js-histo");
        const bE = itemCard.querySelector(".js-edit");
        const bD = itemCard.querySelector(".js-del");
        bH.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          Schema.D.info("ui.history.click", item.id);
          openHistory(ctx, item);
        };
        bE.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          Schema.D.info("ui.editConsigne.click", item.id);
          openConsigneForm(ctx, item);
        };
        bD.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (confirm("Supprimer cette consigne ? (historique conservé)")) {
            Schema.D.info("ui.deleteConsigne.confirm", item.id);
            await Schema.softDeleteConsigne(ctx.db, ctx.user.uid, item.id);
            renderDaily(ctx, root, { day: currentDay });
          }
        };
      });

      content.appendChild(wrap);
    });

    if (collapsed) {
      const details = document.createElement("details");
      details.className = "card overflow-hidden";
      details.innerHTML = `<summary class="cursor-pointer list-none px-4 py-3 font-semibold flex items-center justify-between gap-2">${title} (${list.length})<span class="text-sm text-[var(--muted)]">Afficher</span></summary>`;
      const inner = document.createElement("div");
      inner.className = "border-t border-gray-200 p-4 space-y-4";
      inner.appendChild(content);
      details.appendChild(inner);
      form.appendChild(details);
    } else {
      const section = document.createElement("section");
      section.className = "space-y-4";
      section.innerHTML = `<div class="flex items-center justify-between"><h4 class="text-lg font-semibold">${title}</h4></div>`;
      section.appendChild(content);
      form.appendChild(section);
    }
  };

  renderGroup(byPriority[1], false, "Priorité haute");
  renderGroup(byPriority[2], false, "Priorité moyenne");
  renderGroup(byPriority[3], true, "Priorité basse");

  if (!consignes.length) {
    const empty = document.createElement("div");
    empty.className = "rounded-xl border border-dashed border-gray-200 bg-white p-3 text-sm text-[var(--muted)]";
    empty.innerText = "Aucune consigne pour ce jour.";
    form.appendChild(empty);
  }

  const actions = document.createElement("div");
  actions.className = "flex justify-end";
  actions.innerHTML = `<button type="submit" class="btn btn-primary">Enregistrer</button>`;
  form.appendChild(actions);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const answers = collectAnswers(form, consignes);
    if (!answers.length) {
      alert("Aucune réponse");
      return;
    }
    await Schema.saveResponses(ctx.db, ctx.user.uid, "daily", answers);
    $$("input[type=text],textarea", form).forEach((input) => (input.value = ""));
    $$("input[type=range]", form).forEach((input) => {
      input.value = 5;
      input.dispatchEvent(new Event("input"));
    });
    $$("input[type=radio]", form).forEach((input) => (input.checked = false));
  };

  L.groupEnd();
}

export function renderHistory() {}
