import * as Schema from "./schema.js";

export async function renderDaily(ctx, root, opts = {}) {
  const uid = ctx.user.uid;
  const rawDay = (opts.day || new URLSearchParams(location.hash.split("?")[1] || "").get("day") || new Date().toLocaleDateString("fr-FR", { weekday: "short" }).slice(0, 3)).toLowerCase();
  const frDays = ["lun","mar","mer","jeu","ven","sam","dim"];
  const fromIso = { mon: "lun", tue: "mar", wed: "mer", thu: "jeu", fri: "ven", sat: "sam", sun: "dim" };
  const day = frDays.includes(rawDay) ? rawDay : (fromIso[rawDay] || "lun");

  let consignes = await Schema.fetchConsignes(ctx.db, uid, "daily");
  const mapDay = { lun: "mon", mar: "tue", mer: "wed", jeu: "thu", ven: "fri", sam: "sat", dim: "sun" };
  const iso = mapDay[day] || day;
  consignes = consignes.filter(c => !c.days || c.days.length === 0 || c.days.includes(iso));

  root.innerHTML = `
    <div class="grid gap-3">
      <div class="flex gap-2 flex-wrap">
        ${["lun","mar","mer","jeu","ven","sam","dim"].map(d => {
          const active = d === day ? "bg-sky-600 text-white" : "bg-gray-800 text-gray-200";
          const h = (location.hash.match(/^#\/u\/([^/]+)/)) ? `#/u/${ctx.user.uid}/daily?day=${d}` : `#/daily?day=${d}`;
          return `<a href="${h}" class="px-3 py-1 rounded-lg border border-gray-600 text-sm ${active}">${d.toUpperCase()}</a>`;
        }).join("")}
      </div>

      <form id="daily-form" class="grid gap-3">
        ${consignes.map(c => consigneField(c)).join("")}
        <div class="flex gap-2">
          <button class="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white" type="submit">Enregistrer</button>
          <button type="button" id="btn-add-consigne" class="px-4 py-2 rounded-lg bg-gray-800 border border-gray-600 hover:bg-gray-700">+ Nouvelle consigne</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById("btn-add-consigne").onclick = () => openConsigneForm(ctx, "daily");

  document.getElementById("daily-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const answers = readFormAnswers(consignes, e.target);
    if (!answers.length) return;
    await Schema.saveResponses(ctx.db, uid, "daily", answers);
    toast("Réponses enregistrées");
    e.target.querySelectorAll(".js-hist[data-loaded='1']").forEach(el => el.dataset.loaded = "0");
  });

  root.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-history]");
    if (!btn) return;
    const id = btn.dataset.history;
    const c = consignes.find(x => x.id === id);
    const panel = root.querySelector(`#hist-${id}`);
    if (!c || !panel) return;
    const loaded = panel.dataset.loaded === "1";
    panel.classList.toggle("hidden");
    if (loaded) return;
    panel.dataset.loaded = "1";
    await renderHistoryForConsigne(ctx, c, panel);
  });
}

export async function renderPractice(ctx, root, opts = {}) {
  const uid = ctx.user.uid;
  const consignes = await Schema.fetchConsignes(ctx.db, uid, "practice");

  root.innerHTML = `
    <div class="grid gap-3">
      <form id="practice-form" class="grid gap-3">
        ${consignes.map(c => consigneField(c)).join("")}
        <div class="flex gap-2">
          <button class="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white" type="submit">Enregistrer</button>
          <button type="button" id="btn-add-consigne" class="px-4 py-2 rounded-lg bg-gray-800 border border-gray-600 hover:bg-gray-700">+ Nouvelle consigne</button>
        </div>
      </form>
      <div id="session-actions" class="hidden">
        <button id="btn-new-iter" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white">Nouvelle itération</button>
      </div>
    </div>
  `;

  document.getElementById("btn-add-consigne").onclick = () => openConsigneForm(ctx, "practice");

  document.getElementById("practice-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const answers = readFormAnswers(consignes, e.target);
    if (!answers.length) return;
    await Schema.saveResponses(ctx.db, uid, "practice", answers);
    toast("Session enregistrée");
    document.getElementById("session-actions").classList.remove("hidden");
  });

  document.getElementById("session-actions").addEventListener("click", e => {
    if (e.target.id !== "btn-new-iter") return;
    const form = document.getElementById("practice-form");
    form.reset();
    document.getElementById("session-actions").classList.add("hidden");
  });

  root.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-history]");
    if (!btn) return;
    const id = btn.dataset.history;
    const c = consignes.find(x => x.id === id);
    const panel = root.querySelector(`#hist-${id}`);
    if (!c || !panel) return;
    const loaded = panel.dataset.loaded === "1";
    panel.classList.toggle("hidden");
    if (loaded) return;
    panel.dataset.loaded = "1";
    await renderHistoryForConsigne(ctx, c, panel);
  });
}

export async function renderHistory(ctx, root) {
  const rows = await Schema.fetchHistory(ctx.db, ctx.user.uid, 100);
  const items = rows.map(r => {
    const d = new Date(r.createdAt);
    let badge = "";
    if (r.type === "likert6") {
      const color = { no: "bg-red-600", rather_no: "bg-orange-600", medium: "bg-gray-600", rather_yes: "bg-emerald-600", yes: "bg-emerald-700", no_answer: "bg-slate-600" }[r.value] || "bg-slate-600";
      badge = `<span class=\"px-2 py-0.5 rounded text-xs text-white ${color}\">${r.value}</span>`;
    } else if (r.type === "num") {
      badge = `<span class=\"px-2 py-0.5 rounded text-xs bg-sky-700 text-white\">${r.value}</span>`;
    } else if (r.value) {
      badge = `<span class=\"text-xs text-gray-300\">${escapeHtml(String(r.value)).slice(0, 60)}</span>`;
    }
    return `<div class=\"p-3 rounded-xl border border-gray-700 bg-gray-900 flex justify-between items-center\">
      <div>
        <div class=\"font-medium\">${escapeHtml(r.consigneId || "(consigne)")}</div>
        <div class=\"text-xs text-gray-400\">${r.mode || "daily"} · ${d.toLocaleString()}</div>
      </div>
      <div>${badge}</div>
    </div>`;
  }).join("");

  root.innerHTML = `
    <div class="grid gap-3">
      <h2 class="text-lg font-semibold">Historique</h2>
      <div class="grid gap-2">
        ${items || `<div class='text-gray-400 text-sm'>Aucune réponse enregistrée.</div>`}
      </div>
    </div>
  `;
}

export function openConsigneForm(ctx, modeOrDefaults = {}) {
  let defaults = {};
  let initialMode = "daily";
  if (typeof modeOrDefaults === "string") {
    initialMode = modeOrDefaults;
  } else if (modeOrDefaults && typeof modeOrDefaults === "object") {
    defaults = { ...modeOrDefaults };
    if (defaults.mode) initialMode = defaults.mode;
  }

  const dlg = document.createElement("dialog");
  dlg.className = "rounded-2xl bg-gray-900 border border-gray-700 p-0 text-gray-100";
  dlg.innerHTML = `
    <form method="dialog" class="grid gap-3 p-4 w-[min(92vw,520px)]">
      <h3 class="text-lg font-semibold">${defaults.id ? "Modifier" : "Nouvelle"} consigne</h3>

      <label class="grid gap-1">
        <span class="text-sm text-gray-400">Texte</span>
        <textarea name="text" rows="3" placeholder="Décris ta consigne" required></textarea>
      </label>

      <label class="grid gap-1">
        <span class="text-sm text-gray-400">Catégorie</span>
        <input name="category" placeholder="Ex. Energie" />
      </label>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="grid gap-1">
          <span class="text-sm text-gray-400">Mode</span>
          <select name="mode">
            <option value="daily">Journalier</option>
            <option value="practice">Pratique</option>
          </select>
        </label>
        <label class="grid gap-1">
          <span class="text-sm text-gray-400">Type de réponse</span>
          <select name="type">
            <option value="likert6">Likert (6)</option>
            <option value="num">Nombre (1-10)</option>
            <option value="short">Texte court</option>
            <option value="long">Texte long</option>
          </select>
        </label>
        <label class="grid gap-1">
          <span class="text-sm text-gray-400">Priorité</span>
          <select name="priority">
            <option value="high">Haute</option>
            <option value="medium">Moyenne</option>
            <option value="low">Basse</option>
          </select>
        </label>
        <label class="grid gap-1">
          <span class="text-sm text-gray-400">Répétition espacée</span>
          <select name="sr">
            <option value="1">Activée</option>
            <option value="0">Désactivée</option>
          </select>
        </label>
      </div>

      <div id="freq-block" class="grid gap-2">
        <label class="grid gap-1">
          <span class="text-sm text-gray-400">Fréquence</span>
          <select name="frequency">
            <option value="daily">Quotidienne</option>
            <option value="weekly">Hebdomadaire</option>
            <option value="custom">Personnalisée</option>
          </select>
        </label>
        <div class="grid gap-2">
          <span class="text-sm text-gray-400">Jours concernés</span>
          <div class="flex flex-wrap gap-2">
            ${[
              ["mon", "Lun"],
              ["tue", "Mar"],
              ["wed", "Mer"],
              ["thu", "Jeu"],
              ["fri", "Ven"],
              ["sat", "Sam"],
              ["sun", "Dim"],
            ].map(([value, label]) => `
              <label class="flex items-center gap-1 text-sm">
                <input type="checkbox" data-day="${value}">
                <span>${label}</span>
              </label>
            `).join("")}
          </div>
        </div>
      </div>

      <div class="flex gap-2 justify-end mt-2">
        <button value="close" class="px-3 py-1 rounded-lg bg-gray-800 border border-gray-600 hover:bg-gray-700">Annuler</button>
        <button id="consigne-save" class="px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white">Enregistrer</button>
      </div>
    </form>
  `;
  document.body.appendChild(dlg);
  dlg.showModal();

  const form = dlg.querySelector("form");
  const modeSel = form.querySelector('[name="mode"]');
  const freqBlock = form.querySelector('#freq-block');
  const freqSel = form.querySelector('[name="frequency"]');
  modeSel.value = initialMode;

  form.querySelector('[name="text"]').value = defaults.text || "";
  form.querySelector('[name="category"]').value = defaults.category || "";
  form.querySelector('[name="type"]').value = defaults.type || "likert6";
  form.querySelector('[name="priority"]').value = defaults.priority || "medium";
  form.querySelector('[name="sr"]').value = defaults.spacedRepetitionEnabled ? "1" : "0";
  if (defaults.frequency && freqSel) freqSel.value = defaults.frequency;
  if (defaults.days?.length) {
    defaults.days.forEach(d => {
      const cb = form.querySelector(`input[data-day="${d}"]`);
      if (cb) cb.checked = true;
    });
  }

  function toggleFreq() {
    freqBlock.style.display = (modeSel.value === "practice") ? "none" : "";
  }
  modeSel.addEventListener("change", toggleFreq);
  toggleFreq();

  form.querySelector('#consigne-save').addEventListener('click', async (e) => {
    e.preventDefault();
    const payload = {
      ownerUid: ctx.user.uid,
      text: form.querySelector('[name="text"]').value.trim(),
      category: form.querySelector('[name="category"]').value.trim() || "Général",
      mode: modeSel.value,
      type: form.querySelector('[name="type"]').value,
      priority: form.querySelector('[name="priority"]').value,
      spacedRepetitionEnabled: form.querySelector('[name="sr"]').value === "1",
      active: defaults.active ?? true,
    };
    if (!payload.text) return;

    if (payload.mode !== "practice") {
      const days = Array.from(form.querySelectorAll('input[data-day]:checked')).map(i => i.getAttribute('data-day'));
      payload.days = days;
      if (freqSel) payload.frequency = freqSel.value;
    }

    if (defaults.id) {
      await Schema.updateConsigne(ctx.db, ctx.user.uid, defaults.id, payload);
    } else {
      await Schema.addConsigne(ctx.db, ctx.user.uid, payload);
    }

    toast("Consigne enregistrée");
    dlg.close();
    window.dispatchEvent(new Event("hashchange"));
  });

  dlg.addEventListener("close", () => dlg.remove());
}

function consigneField(c) {
  return `
    <div class="p-3 rounded-xl border border-gray-700 bg-gray-900">
      <div class="flex justify-between items-center mb-2">
        <div class="font-medium">${escapeHtml(c.text || c.title || "(sans libellé)")}</div>
        <button type="button" data-history="${c.id}" class="text-sm text-sky-400 hover:underline">Historique</button>
      </div>
      ${inputForConsigne(c)}
      <div id="hist-${c.id}" class="js-hist hidden mt-3" data-loaded="0"></div>
    </div>
  `;
}

function inputForConsigne(c) {
  const name = `c_${c.id}`;
  if (c.type === "short")
    return `<input name="${name}" class="w-full" placeholder="Réponse (200 caractères max)" maxlength="200">`;
  if (c.type === "long")
    return `<textarea name="${name}" class="w-full" placeholder="Réponse"></textarea>`;
  if (c.type === "num")
    return `
      <div class="grid gap-1">
        <input type="range" min="1" max="10" value="${c.default || 5}" name="${name}" oninput="this.nextElementSibling.value=this.value">
        <output class="text-sm">${c.default || 5}</output>
      </div>`;
  const choices = [
    ["no_answer", "—"], ["no", "Non"], ["rather_no", "Plutôt non"],
    ["medium", "Moyen"], ["rather_yes", "Plutôt oui"], ["yes", "Oui"]
  ];
  return `
    <div class="flex flex-wrap gap-2">
      ${choices.map(([v,l]) => `
        <label class="flex items-center gap-1 text-sm">
          <input type="radio" name="${name}" value="${v}">
          <span>${l}</span>
        </label>`).join("")}
    </div>`;
}

function readFormAnswers(consignes, formEl) {
  const data = new FormData(formEl);
  const answers = [];
  for (const c of consignes) {
    const v = data.get(`c_${c.id}`);
    if (v === null || v === "") continue;
    answers.push({ consigne: c, value: v });
  }
  return answers;
}

function escapeHtml(s = '') {
  return s.replace(/[&<>\"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}

function toast(msg) {
  const t = document.createElement("div");
  t.textContent = msg;
  t.className = "fixed left-1/2 -translate-x-1/2 bottom-6 px-3 py-2 rounded-lg bg-gray-800 border border-gray-600 text-gray-100 shadow";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1600);
}

async function renderHistoryForConsigne(ctx, consigne, panel) {
  const rows = await Schema.fetchResponsesForConsigne(ctx.db, ctx.user.uid, consigne.id, 50);
  const list = rows.map(r => {
    const d = new Date(r.createdAt);
    let badge = "";
    if (r.type === "likert6") {
      const color = { no: "bg-red-600", rather_no: "bg-orange-600", medium: "bg-gray-600", rather_yes: "bg-emerald-600", yes: "bg-emerald-700", no_answer: "bg-slate-600" }[r.value] || "bg-slate-600";
      badge = `<span class=\"px-2 py-0.5 rounded text-xs text-white ${color}\">${r.value}</span>`;
    } else if (r.type === "num") {
      badge = `<span class=\"px-2 py-0.5 rounded text-xs bg-sky-700 text-white\">${r.value}</span>`;
    }
    return `<div class=\"flex justify-between text-sm border-b border-gray-700 py-1\">
      <span>${d.toLocaleString()}</span>
      <span>${badge}</span>
    </div>`;
  }).join("");

  panel.innerHTML = `<div class="grid gap-2">
    <div class="p-2 rounded-lg bg-gray-800 border border-gray-700 max-h-52 overflow-auto">${list || "<span class='text-sm text-gray-400'>Aucun historique.</span>"}</div>
    <canvas id="chart-${consigne.id}" height="120"></canvas>
  </div>`;

  const points = rows
    .map(r => Schema.valueToNumericPoint(r.type, r.value))
    .filter(v => v !== null)
    .reverse();
  if (!points.length) return;

  const labels = rows.map(r => new Date(r.createdAt).toLocaleDateString()).reverse();
  const ctx2d = panel.querySelector(`#chart-${consigne.id}`).getContext("2d");
  new Chart(ctx2d, {
    type: "line",
    data: { labels, datasets: [{ data: points }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, suggestedMax: (consigne.type === "num" ? 10 : 1) } }
    }
  });
}
