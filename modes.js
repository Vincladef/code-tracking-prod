// modes.js — Journalier / Pratique / Historique
import { collection, query, where, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as Schema from "./schema.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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
  wrap.className = "fixed inset-0 z-50 grid place-items-center bg-black/60";
  wrap.innerHTML = `<div class="w-[min(680px,92vw)] rounded-2xl bg-[#0f172a] border border-[#1f2a44] p-4 shadow-xl">${html}</div>`;
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) wrap.remove();
  });
  document.body.appendChild(wrap);
  return wrap;
}

function pill(text) {
  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-sm">${escapeHtml(text)}</span>`;
}

function smallBtn(label, cls = "") {
  return `<button class="text-sm px-2 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 ${cls}">${label}</button>`;
}

function navigate(hash) {
  const fn = window.routeTo;
  if (typeof fn === "function") fn(hash);
  else window.location.hash = hash;
}

async function categorySelect(ctx, mode, currentName = null) {
  const cats = await Schema.fetchCategories(ctx.db, ctx.user.uid);
  const options = cats
    .filter((c) => c.mode === mode)
    .map(
      (c) =>
        `<option value="${escapeHtml(c.name)}" ${c.name === currentName ? "selected" : ""}>${escapeHtml(c.name)}</option>`
    )
    .join("");
  return `
    <label class="block text-sm mb-1">Catégorie</label>
    <div class="flex gap-2">
      <select name="categorySelect" class="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2">
        <option value="">— choisir —</option>
        ${options}
        <option value="__new__">+ Nouvelle catégorie…</option>
      </select>
      <input name="categoryNew" placeholder="Nom de la catégorie"
             class="hidden flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2" />
    </div>
    <script>
      (function(){
        const block = document.currentScript.previousElementSibling;
        const sel = block.querySelector('[name=categorySelect]');
        const input = block.querySelector('[name=categoryNew]');
        sel.addEventListener('change', () => {
          if (sel.value === '__new__') {
            input.classList.remove('hidden');
            input.focus();
          } else {
            input.classList.add('hidden');
          }
        });
      })();
    </script>
  `;
}

function consigneActions() {
  return `
    <div class="flex items-center gap-2">
      ${smallBtn("Historique", "js-histo")}
      ${smallBtn("Modifier", "js-edit")}
      ${smallBtn("Supprimer", "js-del text-red-300")}
    </div>
  `;
}

function inputForType(consigne) {
  if (consigne.type === "short")
    return `<input name="short:${consigne.id}" class="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2" placeholder="Réponse">`;
  if (consigne.type === "long")
    return `<textarea name="long:${consigne.id}" rows="3" class="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2" placeholder="Réponse"></textarea>`;
  if (consigne.type === "num")
    return `
      <input type="range" min="1" max="10" value="5" name="num:${consigne.id}" class="w-full">
      <div class="text-sm opacity-70 mt-1" data-meter="num:${consigne.id}">5</div>
      <script>(()=>{const r=document.currentScript.previousElementSibling.previousElementSibling;const o=document.currentScript.previousElementSibling; if(r){r.addEventListener('input',()=>{o.textContent=r.value;});}})();</script>`;
  return `
      <div class="flex flex-wrap gap-4">
        ${[
          ["no", "Non"],
          ["rather_no", "Plutôt non"],
          ["medium", "Moyen"],
          ["rather_yes", "Plutôt oui"],
          ["yes", "Oui"],
        ]
          .map(
            ([value, label]) => `
          <label class="inline-flex items-center gap-2">
            <input type="radio" name="likert6:${consigne.id}" value="${value}"><span>${label}</span>
          </label>`
          )
          .join("")}
      </div>`;
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
  const catUI = await categorySelect(ctx, mode, consigne?.category || null);
  const priority = Number(consigne?.priority ?? 2);
  const html = `
    <h3 class="text-lg font-semibold mb-2">${consigne ? "Modifier" : "Nouvelle"} consigne</h3>
    <form class="grid gap-3" id="consigne-form">
      <label class="grid gap-1">
        <span class="text-sm">Texte de la consigne</span>
        <input name="text" required class="rounded-lg bg-white/5 border border-white/10 px-3 py-2"
               value="${escapeHtml(consigne?.text || "")}" />
      </label>

      <label class="grid gap-1">
        <span class="text-sm">Type de réponse</span>
        <select name="type" class="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
          <option value="short" ${consigne?.type === "short" ? "selected" : ""}>Texte court</option>
          <option value="long" ${consigne?.type === "long" ? "selected" : ""}>Texte long</option>
          <option value="likert6" ${consigne?.type === "likert6" ? "selected" : ""}>Échelle (Oui → Non)</option>
          <option value="num" ${consigne?.type === "num" ? "selected" : ""}>Échelle numérique (1–10)</option>
        </select>
      </label>

      ${catUI}

      <label class="grid gap-1">
        <span class="text-sm">Priorité</span>
        <select name="priority" class="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
          <option value="1" ${priority === 1 ? "selected" : ""}>Haute</option>
          <option value="2" ${priority === 2 ? "selected" : ""}>Moyenne</option>
          <option value="3" ${priority === 3 ? "selected" : ""}>Basse</option>
        </select>
      </label>

      ${mode === "daily"
        ? `
      <fieldset class="grid gap-2">
        <legend class="text-sm">Fréquence (jours)</legend>
        <div class="flex flex-wrap gap-2">
          ${["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"]
            .map((day) => {
              const selected = consigne?.days?.includes(day);
              return `<label class="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-white/5 border border-white/10">
              <input type="checkbox" name="days" value="${day}" ${selected ? "checked" : ""}>
              <span>${day}</span>
            </label>`;
            })
            .join("")}
        </div>
      </fieldset>`
        : ""}

      <div class="flex justify-end gap-2 mt-2">
        <button type="button" class="px-3 py-2 rounded-lg bg-white/5 border border-white/10" id="cancel">Annuler</button>
        <button type="submit" class="px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500">Enregistrer</button>
      </div>
    </form>
  `;
  const m = modal(html);
  $("#cancel", m).onclick = () => m.remove();

  $("#consigne-form", m).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const sel = fd.get("categorySelect");
    const cat = sel === "__new__" ? (fd.get("categoryNew") || "").trim() : (sel || "").trim();
    if (!cat) return alert("Choisis (ou saisis) une catégorie.");

    await Schema.ensureCategory(ctx.db, ctx.user.uid, cat, mode);

    const payload = {
      ownerUid: ctx.user.uid,
      mode,
      text: fd.get("text").trim(),
      type: fd.get("type"),
      category: cat,
      priority: Number(fd.get("priority") || 2),
      active: true
    };
    if (mode === "daily") {
      payload.days = $$("input[name=days]:checked", m).map((input) => input.value);
    }

    if (consigne) {
      await Schema.updateConsigne(ctx.db, ctx.user.uid, consigne.id, payload);
    } else {
      await Schema.addConsigne(ctx.db, ctx.user.uid, payload);
    }
    m.remove();
    const root = document.getElementById("view-root");
    if (mode === "practice") renderPractice(ctx, root);
    else renderDaily(ctx, root);
  };
}

export async function openHistory(ctx, consigne) {
  const qy = query(
    collection(ctx.db, `u/${ctx.user.uid}/responses`),
    where("consigneId", "==", consigne.id),
    orderBy("createdAt", "desc"),
    limit(60)
  );
  const ss = await getDocs(qy);
  const rows = ss.docs.map((d) => ({ id: d.id, ...d.data() }));

  const list = rows
    .map(
      (r) => `
    <li class="flex justify-between items-center border-b border-white/5 py-1">
      <span class="text-sm opacity-80">${new Date(r.createdAt?.toDate?.() ?? r.createdAt).toLocaleString()}</span>
      <span class="text-sm font-medium">${formatValue(consigne.type, r.value)}</span>
    </li>
  `
    )
    .join("");

  const canGraph = consigne.type === "likert6" || consigne.type === "num";
  const html = `
    <h3 class="text-lg font-semibold mb-2">Historique — ${escapeHtml(consigne.text)}</h3>
    ${canGraph ? `<canvas id="histoChart" height="140" class="mb-3"></canvas>` : ""}
    <ul class="max-h-[50vh] overflow-auto pr-2">${list || '<li class="py-2 text-sm opacity-70">Aucune réponse pour l’instant.</li>'}</ul>
  `;
  const m = modal(html);

  if (canGraph && window.Chart) {
    const canvas = $("#histoChart", m);
    if (canvas) {
      const ctx2 = canvas.getContext("2d");
      const data = rows.slice().reverse();
      new Chart(ctx2, {
        type: "line",
        data: {
          labels: data.map((r) => new Date(r.createdAt?.toDate?.() ?? r.createdAt).toLocaleDateString()),
          datasets: [
            {
              label: "Valeur",
              data: data.map((r) =>
                consigne.type === "likert6" ? likertToNum(r.value) : Number(r.value || 0)
              ),
              tension: 0.25,
              fill: false
            }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              beginAtZero: true,
              max: consigne.type === "likert6" ? 5 : 10
            }
          }
        }
      });
    }
  }

  function formatValue(type, v) {
    if (type === "likert6") {
      return (
        {
          no: "Non",
          rather_no: "Plutôt non",
          medium: "Moyen",
          rather_yes: "Plutôt oui",
          yes: "Oui",
          no_answer: "—"
        }[v] || v || "—"
      );
    }
    return String(v ?? "—");
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
  root.innerHTML = `<div class="card p-4"></div>`;
  const box = root.firstElementChild;
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

  box.insertAdjacentHTML(
    "beforeend",
    `
    <div class="flex flex-wrap gap-2 items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <label class="text-sm opacity-80">Catégorie</label>
        <select id="practice-cat" class="rounded-lg bg-white/5 border border-white/10 px-3 py-2">${catOptions}</select>
      </div>
      <div class="flex items-center gap-2">
        ${smallBtn("+ Nouvelle consigne", "js-new")}
      </div>
    </div>
    <form id="practice-form" class="grid gap-3"></form>
    <div class="flex justify-end mt-3">
      <button class="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500" id="save">Enregistrer</button>
    </div>
  `
  );

  $("#practice-cat", box).onchange = (e) => {
    const value = e.target.value;
    const base = currentHash.split("?")[0];
    navigate(`${base}?cat=${encodeURIComponent(value)}`);
  };
  $(".js-new", box).onclick = () => openConsigneForm(ctx, null);

  const all = await Schema.fetchConsignes(ctx.db, ctx.user.uid, "practice");
  const consignes = all.filter((c) => !currentCat || c.category === currentCat);

  const form = $("#practice-form", box);
  if (!consignes.length) {
    form.innerHTML = `<div class="rounded-xl border border-white/10 bg-white/5 p-3 text-sm opacity-70">Aucune consigne pour cette catégorie.</div>`;
  } else {
    for (const consigne of consignes) {
      const card = document.createElement("div");
      card.className = "rounded-xl border border-white/10 bg-white/5 p-3";
      card.innerHTML = `
        <div class="flex items-center justify-between mb-2">
          <h4 class="font-semibold">${escapeHtml(consigne.text)} ${pill(consigne.category || "Général")}</h4>
          ${consigneActions()}
        </div>
        ${inputForType(consigne)}
      `;
      form.appendChild(card);

      card.querySelector(".js-histo").onclick = () => openHistory(ctx, consigne);
      card.querySelector(".js-edit").onclick = () => openConsigneForm(ctx, consigne);
      card.querySelector(".js-del").onclick = async () => {
        if (confirm("Supprimer cette consigne ? (historique conservé)")) {
          await Schema.softDeleteConsigne(ctx.db, ctx.user.uid, consigne.id);
          renderPractice(ctx, root);
        }
      };
    }
  }

  $("#save", box).onclick = async (e) => {
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
    $$('input[type=text],textarea', form).forEach((input) => (input.value = ""));
    $$('input[type=range]', form).forEach((input) => {
      input.value = 5;
      input.dispatchEvent(new Event("input"));
    });
    $$('input[type=radio]', form).forEach((input) => (input.checked = false));
  };
}

function normalizeDay(value) {
  if (!value) return null;
  const lower = value.toString().toLowerCase();
  const map = { mon: "LUN", tue: "MAR", wed: "MER", thu: "JEU", fri: "VEN", sat: "SAM", sun: "DIM" };
  if (map[lower]) return map[lower];
  const upper = lower.toUpperCase();
  return ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"].includes(upper) ? upper : null;
}

export async function renderDaily(ctx, root, opts = {}) {
  root.innerHTML = `<div class="card p-4"></div>`;
  const box = root.firstElementChild;
  const currentHash = ctx.route || window.location.hash || "#/daily";
  const qp = new URLSearchParams(currentHash.split("?")[1] || "");
  const jours = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"];
  const todayIdx = (new Date().getDay() + 6) % 7;
  const requested = normalizeDay(opts.day) || normalizeDay(qp.get("day"));
  const currentDay = requested || jours[todayIdx];

  const buttons = jours
    .map(
      (day) =>
        `<button class="px-3 py-1 rounded-lg border ${day === currentDay ? "bg-sky-600 border-sky-500" : "bg-white/5 border-white/10"}" data-day="${day}">${day}</button>`
    )
    .join(" ");

  box.insertAdjacentHTML(
    "afterbegin",
    `<div class="flex flex-wrap gap-2 mb-3">${buttons}<div class="ml-auto">${smallBtn("+ Nouvelle consigne", "js-new")}</div></div>`
  );

  $$("[data-day]", box).forEach((btn) => {
    btn.onclick = () => {
      const base = currentHash.split("?")[0];
      navigate(`${base}?day=${btn.dataset.day}`);
    };
  });
  $(".js-new", box).onclick = () => openConsigneForm(ctx, null);

  const all = await Schema.fetchConsignes(ctx.db, ctx.user.uid, "daily");
  const consignes = all.filter((c) => !c.days?.length || c.days.includes(currentDay));

  const byPriority = { 1: [], 2: [], 3: [] };
  for (const consigne of consignes) {
    const key = Number(consigne.priority) || 2;
    (byPriority[key] ?? byPriority[2]).push(consigne);
  }

  const form = document.createElement("form");
  form.className = "grid gap-4";
  box.appendChild(form);

  const renderGroup = (list, collapsed, title) => {
    if (!list.length) return;
    const catGroups = {};
    list.forEach((item) => {
      const cat = item.category || "Général";
      (catGroups[cat] ??= []).push(item);
    });

    const section = document.createElement("section");
    section.className = "rounded-xl border border-white/10 bg-white/5 p-3";
    section.innerHTML = `<div class="flex items-center justify-between mb-2"><h4 class="font-semibold">${title}</h4></div>`;

    Object.entries(catGroups).forEach(([cat, items]) => {
      const wrap = document.createElement("div");
      wrap.className = "mb-3";
      wrap.innerHTML = `<div class="mb-2 font-medium opacity-80">${escapeHtml(cat)}</div>`;
      items.forEach((item) => {
        const card = document.createElement("div");
        card.className = "rounded-lg border border-white/10 bg-[#0e1621] p-3 mb-2";
        card.innerHTML = `
          <div class="flex items-center justify-between mb-2">
            <div class="font-semibold">${escapeHtml(item.text)}</div>
            ${consigneActions()}
          </div>
          ${inputForType(item)}
        `;
        wrap.appendChild(card);
        card.querySelector(".js-histo").onclick = () => openHistory(ctx, item);
        card.querySelector(".js-edit").onclick = () => openConsigneForm(ctx, item);
        card.querySelector(".js-del").onclick = async () => {
          if (confirm("Supprimer cette consigne ? (historique conservé)")) {
            await Schema.softDeleteConsigne(ctx.db, ctx.user.uid, item.id);
            renderDaily(ctx, root, { day: currentDay });
          }
        };
      });
      section.appendChild(wrap);
    });

    if (collapsed) {
      const details = document.createElement("details");
      details.className = "rounded-xl border border-white/10 bg-white/5";
      details.innerHTML = `<summary class="cursor-pointer list-none px-3 py-2">Priorité basse (${list.length})</summary>`;
      details.appendChild(section);
      form.appendChild(details);
    } else {
      form.appendChild(section);
    }
  };

  renderGroup(byPriority[1], false, "Priorité haute");
  renderGroup(byPriority[2], false, "Priorité moyenne");
  renderGroup(byPriority[3], true, "Priorité basse");

  if (!consignes.length) {
    form.appendChild(
      Object.assign(document.createElement("div"), {
        className: "rounded-xl border border-white/10 bg-white/5 p-3 text-sm opacity-70",
        innerText: "Aucune consigne pour ce jour."
      })
    );
  }

  const actions = document.createElement("div");
  actions.className = "flex justify-end mt-3";
  actions.innerHTML = `<button class="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500">Enregistrer</button>`;
  form.appendChild(actions);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const answers = collectAnswers(form, consignes);
    if (!answers.length) {
      alert("Aucune réponse");
      return;
    }
    await Schema.saveResponses(ctx.db, ctx.user.uid, "daily", answers);
    $$('input[type=text],textarea', form).forEach((input) => (input.value = ""));
    $$('input[type=range]', form).forEach((input) => {
      input.value = 5;
      input.dispatchEvent(new Event("input"));
    });
    $$('input[type=radio]', form).forEach((input) => (input.checked = false));
  };
}

export function renderHistory() {}
