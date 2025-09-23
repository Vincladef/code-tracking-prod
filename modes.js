// modes.js — Journalier / Pratique / Historique
/* global Schema, Modes */
window.Modes = window.Modes || {};
const modesFirestore = Schema.firestore || window.firestoreAPI || {};

const modesLogger = Schema.D || { info: () => {}, group: () => {}, groupEnd: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// --- Normalisation du jour (LUN..DIM ou mon..sun) ---
const DAY_ALIAS = Schema.DAY_ALIAS || { mon: "LUN", tue: "MAR", wed: "MER", thu: "JEU", fri: "VEN", sat: "SAM", sun: "DIM" };
const DAY_VALUES = Schema.DAY_VALUES || new Set(["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"]);

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

function srBadge(c){
  const enabled = c?.srEnabled !== false;
  const title = enabled ? "Désactiver la répétition espacée" : "Activer la répétition espacée";
  const cls = enabled ? "" : "opacity-50";
  return `<button type="button"
            class="inline-flex items-center px-2 py-0.5 rounded-full border text-xs text-[var(--muted)] js-sr-toggle ${cls}"
            data-id="${c.id}" data-enabled="${enabled ? 1 : 0}"
            aria-pressed="${enabled}" title="${title}">⏳</button>`;
}

function prioChip(p) {
  const n = Number(p)||2;
  const cls = n===1 ? "prio-chip prio-high" : n===2 ? "prio-chip prio-medium" : "prio-chip prio-low";
  const lbl = n===1 ? "Haute" : n===2 ? "Moyenne" : "Basse";
  return `<span class="${cls}" title="Priorité ${lbl}">${lbl}</span>`;
}

function smallBtn(label, cls = "") {
  return `<button type="button" class="btn btn-ghost text-sm ${cls}">${label}</button>`;
}

function navigate(hash) {
  const fn = window.routeTo;
  if (typeof fn === "function") fn(hash);
  else window.location.hash = hash;
}

function showToast(msg){
  const el = document.createElement("div");
  el.className = "fixed top-4 right-4 z-50 card px-3 py-2 text-sm shadow-lg";
  el.style.transition = "opacity .25s ease, transform .25s ease";
  el.style.opacity = "0";
  el.style.transform = "translateY(6px)";
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateY(0)"; });
  setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateY(-6px)"; setTimeout(()=>el.remove(), 250); }, 1200);
}

function toAppPath(h) {
  return h.replace(/^#\/u\/[^/]+\//, "#/");
}

// --------- CAT DASHBOARD (modal) ---------
window.openCategoryDashboard = async function openCategoryDashboard(ctx, category) {
  try {
    const consignes = await Schema.listConsignesByCategory(ctx.db, ctx.user.uid, category);

    const today = new Date();
    const days = Array.from({length: 30}, (_,i) => {
      const d = new Date(today); d.setDate(d.getDate()- (29-i));
      return d.toISOString().slice(0,10);
    });

    const rows = [];
    for (const c of consignes) {
      const hist = await Schema.loadConsigneHistory(ctx.db, ctx.user.uid, c.id);
      const map = new Map(hist.map(h => [h.date, h.v ?? h.value ?? '']));
      rows.push({ name: c.titre || c.name || c.id, values: days.map(d => map.get(d) ?? '') });
    }

    const safeCategory = escapeHtml(category ?? "");
    const html = `
      <div class="goal-modal modal"><div class="goal-modal-card modal-card">
        <div class="goal-modal-header modal-header">
          <div class="goal-modal-title title">📊 ${safeCategory}</div>
          <button id="x" class="btn-ghost">✕</button>
        </div>
        <div class="history-scroll">
          <table class="history-table">
            <thead>
              <tr><th>Consigne</th>${days.map(d=>`<th>${escapeHtml(d.slice(5))}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rows.map(r=>`<tr><td>${escapeHtml(r.name)}</td>${r.values.map(v=>`<td>${v===''? '' : escapeHtml(String(v))}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
        </div>
        <canvas id="catChart" height="180" style="margin-top:12px;"></canvas>
      </div></div>
    `;
    const wrap = document.createElement('div'); wrap.innerHTML = html; document.body.appendChild(wrap);
    wrap.querySelector('#x').onclick = () => wrap.remove();

    if (window.Chart) {
      const datasets = rows.map(r => ({
        label: r.name,
        data: r.values.map(v => (v===''? null : Number(v))),
        spanGaps: true
      }));
      const ctx2 = wrap.querySelector('#catChart').getContext('2d');
      new Chart(ctx2, {
        type: 'line',
        data: { labels: days, datasets },
        options: { responsive: true, interaction: { mode:'nearest', intersect:false } }
      });
    }
  } catch (e) {
    console.warn('openCategoryDashboard:error', e);
  }
};

// --------- DRAG & DROP (ordre consignes) ---------
window.attachConsignesDragDrop = function attachConsignesDragDrop(container, ctx) {
  let dragId = null;

  container.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.consigne-card');
    if (!el) return;
    dragId = el.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const over = e.target.closest('.consigne-card');
    if (!over || over.dataset.id === dragId) return;
    const rect = over.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    over.parentNode.insertBefore(
      container.querySelector(`.consigne-card[data-id="${dragId}"]`),
      before ? over : over.nextSibling
    );
  });

  container.addEventListener('drop', async (e) => {
    if (!dragId) return;
    e.preventDefault();
    const cards = [...container.querySelectorAll('.consigne-card')];
    try {
      await Promise.all(cards.map((el, idx) =>
        Schema.updateConsigneOrder(ctx.db, ctx.user.uid, el.dataset.id, (idx+1)*10)
      ));
    } catch (err) {
      console.warn('drag-drop:save-order:error', err);
    }
    dragId = null;
  });

  container.addEventListener('dragend', () => {
    dragId = null;
  });
};

async function categorySelect(ctx, mode, currentName = "") {
  const cats = await Schema.fetchCategories(ctx.db, ctx.user.uid);
  const uniqueNames = Array.from(new Set(cats.map((c) => c.name).filter(Boolean)));
  uniqueNames.sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
  const listId = `category-list-${mode}-${Date.now()}`;

  return `
    <label class="block text-sm text-[var(--muted)] mb-1">Catégorie</label>
    <input name="categoryInput"
           list="${listId}"
           class="w-full"
           placeholder="Choisir ou taper un nom…"
           value="${escapeHtml(currentName || "")}">
    <datalist id="${listId}">
      ${uniqueNames.map(n => `<option value="${escapeHtml(n)}"></option>`).join("")}
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

function inputForType(consigne, initialValue = null) {
  if (consigne.type === "short") {
    const value = escapeHtml(initialValue ?? "");
    return `<input name="short:${consigne.id}" class="w-full" placeholder="Réponse" value="${value}">`;
  }
  if (consigne.type === "long") {
    const value = escapeHtml(initialValue ?? "");
    return `<textarea name="long:${consigne.id}" rows="3" class="w-full" placeholder="Réponse">${value}</textarea>`;
  }
  if (consigne.type === "num") {
    const sliderValue = initialValue != null && initialValue !== ""
      ? Number(initialValue)
      : 5;
    const safeValue = Number.isFinite(sliderValue) ? sliderValue : 5;
    return `
      <input type="range" min="1" max="10" value="${safeValue}" name="num:${consigne.id}" class="w-full">
      <div class="text-sm opacity-70 mt-1" data-meter="num:${consigne.id}">${safeValue}</div>
      <script>(()=>{const slider=document.currentScript.previousElementSibling.previousElementSibling;const label=document.currentScript.previousElementSibling;const sync=()=>{if(label&&slider){label.textContent=slider.value;}};if(slider){sync();slider.addEventListener('input',sync);}})();</script>
    `;
  }
  if (consigne.type === "likert6") {
    const current = (initialValue ?? "").toString();
    // Ordre désiré : Oui → Plutôt oui → Neutre → Plutôt non → Non → Pas de réponse
    return `
      <select name="likert6:${consigne.id}" class="w-full">
        <option value="" ${current === "" ? "selected" : ""}>— choisir —</option>
        <option value="yes" ${current === "yes" ? "selected" : ""}>Oui</option>
        <option value="rather_yes" ${current === "rather_yes" ? "selected" : ""}>Plutôt oui</option>
        <option value="medium" ${current === "medium" ? "selected" : ""}>Neutre</option>
        <option value="rather_no" ${current === "rather_no" ? "selected" : ""}>Plutôt non</option>
        <option value="no" ${current === "no" ? "selected" : ""}>Non</option>
        <option value="no_answer" ${current === "no_answer" ? "selected" : ""}>Pas de réponse</option>
      </select>
    `;
  }
  if (consigne.type === "likert5") {
    const current = initialValue != null ? String(initialValue) : "";
    return `
      <select name="likert5:${consigne.id}" class="w-full">
        <option value="" ${current === "" ? "selected" : ""}>— choisir —</option>
        <option value="0" ${current === "0" ? "selected" : ""}>0</option>
        <option value="1" ${current === "1" ? "selected" : ""}>1</option>
        <option value="2" ${current === "2" ? "selected" : ""}>2</option>
        <option value="3" ${current === "3" ? "selected" : ""}>3</option>
        <option value="4" ${current === "4" ? "selected" : ""}>4</option>
      </select>
    `;
  }
  if (consigne.type === "yesno") {
    const current = (initialValue ?? "").toString();
    return `
      <select name="yesno:${consigne.id}" class="w-full">
        <option value="" ${current === "" ? "selected" : ""}>— choisir —</option>
        <option value="yes" ${current === "yes" ? "selected" : ""}>Oui</option>
        <option value="no" ${current === "no" ? "selected" : ""}>Non</option>
      </select>
    `;
  }
  return "";
}

function collectAnswers(form, consignes, options = {}) {
  const dayKey = options.dayKey || null;
  const answers = [];
  for (const consigne of consignes) {
    if (consigne.type === "short") {
      const val = form.querySelector(`[name="short:${consigne.id}"]`)?.value?.trim();
      if (val) answers.push({ consigne, value: val, dayKey });
    } else if (consigne.type === "long") {
      const val = form.querySelector(`[name="long:${consigne.id}"]`)?.value?.trim();
      if (val) answers.push({ consigne, value: val, dayKey });
    } else if (consigne.type === "num") {
      const val = form.querySelector(`[name="num:${consigne.id}"]`)?.value;
      if (val) answers.push({ consigne, value: Number(val), dayKey });
    } else if (consigne.type === "likert5") {
      const val = form.querySelector(`[name="likert5:${consigne.id}"]`)?.value;
      if (val !== "" && val != null) answers.push({ consigne, value: Number(val), dayKey });
    } else if (consigne.type === "yesno") {
      const val = form.querySelector(`[name="yesno:${consigne.id}"]`)?.value;
      if (val) answers.push({ consigne, value: val, dayKey });
    } else if (consigne.type === "likert6") {
      const val = form.querySelector(`[name="likert6:${consigne.id}"]`)?.value;
      if (val) answers.push({ consigne, value: val, dayKey });
    }
  }
  return answers;
}

async function openConsigneForm(ctx, consigne = null) {
  const mode = consigne?.mode || (ctx.route.includes("/practice") ? "practice" : "daily");
  modesLogger.group("ui.consigneForm.open", { mode, consigneId: consigne?.id || null });
  const catUI = await categorySelect(ctx, mode, consigne?.category || null);
  const priority = Number(consigne?.priority ?? 2);
  const monthKey = Schema.monthKeyFromDate(new Date());
  let objectifs = [];
  try {
    objectifs = await Schema.listObjectivesByMonth(ctx.db, ctx.user.uid, monthKey);
  } catch (err) {
    modesLogger.warn("ui.consigneForm.objectifs.error", err);
  }
  const currentObjId = consigne?.objectiveId || "";
  const objectifsOptions = objectifs
    .map((o) => {
      const badge = o.type === "hebdo" ? `S${o.weekOfMonth || "?"}` : (o.type === "annuel" ? "Annuel" : "Mois");
      const subtitle = o.monthKey || monthKey;
      const label = `${badge} — ${subtitle}`;
      return `<option value="${escapeHtml(o.id)}" ${o.id === currentObjId ? "selected" : ""}>${escapeHtml(o.titre || "Objectif")} — ${escapeHtml(label)}</option>`;
    })
    .join("");
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
          <option value="likert6" ${!consigne || consigne?.type === "likert6" ? "selected" : ""}>Échelle de Likert (0–4)</option>
          <option value="yesno"   ${consigne?.type === "yesno"   ? "selected" : ""}>Oui / Non</option>
          <option value="short"   ${consigne?.type === "short"   ? "selected" : ""}>Texte court</option>
          <option value="long"    ${consigne?.type === "long"    ? "selected" : ""}>Texte long</option>
          <option value="num"     ${consigne?.type === "num"     ? "selected" : ""}>Échelle numérique (1–10)</option>
        </select>
      </label>

      ${catUI}

      <div class="grid gap-1">
        <span class="text-sm text-[var(--muted)]">📌 Associer à un objectif</span>
        <select id="objective-select" class="w-full">
          <option value="">Aucun</option>
          ${objectifsOptions}
        </select>
      </div>

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
        <span>⏳ Activer la répétition espacée</span>
      </label>

      ${mode === "daily" ? `
      <fieldset class="grid gap-2">
        <legend class="text-sm text-[var(--muted)]">Fréquence (jours)</legend>

        <label class="inline-flex items-center gap-2 mb-1">
          <input type="checkbox" id="daily-all" ${(!consigne || !consigne.days || !consigne.days.length) ? "checked" : ""}>
          <span>Quotidien</span>
        </label>

        <div class="flex flex-wrap gap-2" id="daily-days">
          ${["LUN","MAR","MER","JEU","VEN","SAM","DIM"].map((day) => {
            const selected = Array.isArray(consigne?.days) && consigne.days.includes(day);
            return `<label class="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-sm">
        <input type="checkbox" name="days" value="${day}" ${selected ? "checked" : ""}>
        <span>${day}</span>
      </label>`;
          }).join("")}
        </div>
      </fieldset>
      ` : ""}

      <div class="flex justify-end gap-2 pt-2">
        <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `;
  const m = modal(html);
  const dailyAll = m.querySelector("#daily-all");
  const daysBox  = m.querySelector("#daily-days");
  if (dailyAll && daysBox) {
    const dayInputs = Array.from(daysBox.querySelectorAll('input[name="days"]'));
    const syncDaysState = (isDaily) => {
      dayInputs.forEach((cb) => {
        if (isDaily) cb.checked = true;
        cb.disabled = isDaily;
        const label = cb.closest("label");
        if (label) {
          label.classList.toggle("opacity-60", isDaily);
        }
      });
    };
    syncDaysState(dailyAll.checked);
    dailyAll.addEventListener("change", () => {
      syncDaysState(dailyAll.checked);
    });
  }
  modesLogger.groupEnd();
  $("#cancel", m).onclick = () => m.remove();

  $("#consigne-form", m).onsubmit = async (e) => {
    e.preventDefault();
    modesLogger.group("ui.consigneForm.submit");
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
        const isAll = m.querySelector("#daily-all")?.checked;
        payload.days = isAll ? [] : $$("input[name=days]:checked", m).map((input) => input.value);
      }
      modesLogger.info("payload", payload);

      const selectedObjective = m.querySelector("#objective-select")?.value || "";
      let consigneId = consigne?.id || null;
      if (consigne) {
        await Schema.updateConsigne(ctx.db, ctx.user.uid, consigne.id, payload);
        consigneId = consigne.id;
      } else {
        const ref = await Schema.addConsigne(ctx.db, ctx.user.uid, payload);
        consigneId = ref?.id || consigneId;
      }
      if (consigneId) {
        await Schema.linkConsigneToObjective(ctx.db, ctx.user.uid, consigneId, selectedObjective || null);
      }
      m.remove();
      const root = document.getElementById("view-root");
      if (mode === "practice") renderPractice(ctx, root);
      else renderDaily(ctx, root);
    } finally {
      modesLogger.groupEnd();
    }
  };
}

function dotColor(type, v){
  if (type === "likert6") {
    const map = { yes:"ok", rather_yes:"ok", medium:"mid", rather_no:"ko", no:"ko", no_answer:"na" };
    return map[v] || "na";
  }
  if (type === "likert5") {
    const n = Number(v);
    return n >= 3 ? "ok" : n === 2 ? "mid" : "ko";
  }
  if (type === "yesno") {
    return v === "yes" ? "ok" : "ko";
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

async function openHistory(ctx, consigne) {
  modesLogger.group("ui.history.open", { consigneId: consigne.id, type: consigne.type });
  const qy = modesFirestore.query(
    modesFirestore.collection(ctx.db, `u/${ctx.user.uid}/responses`),
    modesFirestore.where("consigneId", "==", consigne.id),
    modesFirestore.orderBy("createdAt", "desc"),
    modesFirestore.limit(60)
  );
  const ss = await modesFirestore.getDocs(qy);
  modesLogger.info("ui.history.rows", ss.size);
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

  const canGraph = ["likert6", "likert5", "num", "yesno"].includes(consigne.type);
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
    modesLogger.info("ui.history.chart", { points: rows.length });
    const canvas = panel.querySelector('#histoChart');
    if (canvas) {
      const ctx2 = canvas.getContext('2d');
      const data = rows.slice().reverse();
      const values = data.map((r) => {
        if (consigne.type === 'likert6') return likertToNum(r.value);
        if (consigne.type === 'likert5') return Number(r.value || 0);
        if (consigne.type === 'yesno')   return r.value === 'yes' ? 1 : 0;
        return Number(r.value || 0);
      });
      const mean = values.length ? values.reduce((a,b)=>a+b,0) / values.length : 0;

      let color = '#60BFFD';
      if (consigne.type === 'likert6' || consigne.type === 'likert5'){
        color = mean < 1.5 ? '#DC2626' : (mean < 2.5 ? '#EAB308' : '#16A34A');
      } else if (consigne.type === 'yesno'){
        color = mean < 0.33 ? '#DC2626' : (mean < 0.66 ? '#EAB308' : '#16A34A');
      } else {
        color = mean < 4 ? '#DC2626' : (mean < 7 ? '#EAB308' : '#16A34A');
      }

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
              data: values,
              tension: 0.25,
              fill: false,
              borderColor: color,
              backgroundColor: color,
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
              max: consigne.type === 'likert6' ? 4 : consigne.type === 'likert5' ? 4 : consigne.type === 'yesno' ? 1 : 10,
              ticks: { color: '#64748B' },
              grid: { color: '#E2E8F0' }
            }
          }
        }
      });
    }
  } else {
    modesLogger.info("ui.history.chart.skip", { canGraph, hasChart: !!window.Chart });
  }

  modesLogger.groupEnd();

  function formatValue(type, v) {
    if (type === 'yesno') return v === 'yes' ? 'Oui' : 'Non';
    if (type === 'likert5') return String(v ?? '—');
    if (type === 'likert6') {
      return (
        {
          no: 'Non',
          rather_no: 'Plutôt non',
          medium: 'Neutre',
          rather_yes: 'Plutôt oui',
          yes: 'Oui',
          no_answer: 'Pas de réponse'
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

async function renderPractice(ctx, root, _opts = {}) {
  modesLogger.group("screen.practice.render", { hash: ctx.route });
  root.innerHTML = "";
  const container = document.createElement("div");
  container.className = "space-y-4";
  root.appendChild(container);

  const currentHash = ctx.route || window.location.hash || "#/practice";
  const cats = (await Schema.fetchCategories(ctx.db, ctx.user.uid)).filter((c) => c.mode === "practice");
  const qp  = new URLSearchParams(currentHash.split("?")[1] || "");
  let currentCat = qp.get("cat") || (cats[0]?.name || "");

  if (!currentCat && cats.length) {
    const base = (ctx.route || "#/practice").split("?")[0];
    navigate(`${toAppPath(base)}?cat=${encodeURIComponent(cats[0].name)}`);
    return;
  }

  if (currentCat && cats.length && !cats.some((c) => c.name === currentCat)) {
    const base = (ctx.route || "#/practice").split("?")[0];
    navigate(`${toAppPath(base)}?cat=${encodeURIComponent(cats[0].name)}`);
    return;
  }

  const catOptions = cats
    .map(
      (c) =>
        `<option value="${escapeHtml(c.name)}" ${c.name === currentCat ? "selected" : ""}>${escapeHtml(c.name)}</option>`
    )
    .join("");

  const card = document.createElement("section");
  card.className = "card p-4 space-y-4";
  card.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <label class="text-sm text-[var(--muted)]" for="practice-cat">Catégorie</label>
        <select id="practice-cat" class="min-w-[160px]">${catOptions}</select>
      </div>
      <div class="flex items-center gap-2">
        ${smallBtn("📊 Tableau de bord", "js-dashboard")}
        ${smallBtn("+ Nouvelle consigne", "js-new")}
      </div>
    </div>
    <form id="practice-form" class="grid gap-3"></form>
    <div class="flex justify-end">
      <button class="btn btn-primary" type="button" id="save">Enregistrer</button>
    </div>
  `;
  container.appendChild(card);

  const selector = card.querySelector("#practice-cat");
  if (selector) {
    selector.disabled = !cats.length;
    selector.onchange = (e) => {
      const value = e.target.value;
      const base = currentHash.split("?")[0];
      navigate(`${toAppPath(base)}?cat=${encodeURIComponent(value)}`);
    };
  }
  card.querySelector(".js-new").onclick = () => openConsigneForm(ctx, null);
  const dashBtn = card.querySelector(".js-dashboard");
  if (dashBtn) {
    const hasCategory = Boolean(currentCat);
    dashBtn.disabled = !hasCategory;
    dashBtn.classList.toggle("opacity-50", !hasCategory);
    dashBtn.onclick = () => {
      if (!currentCat) return;
      window.openCategoryDashboard(ctx, currentCat);
    };
  }

  const all = await Schema.fetchConsignes(ctx.db, ctx.user.uid, "practice");
  const consignes = all.filter((c) => (c.category || "") === currentCat);
  modesLogger.info("screen.practice.consignes", consignes.length);

  const orderSorted = consignes.slice().sort((a, b) => {
    const orderA = Number(a.order || 0);
    const orderB = Number(b.order || 0);
    if (orderA !== orderB) return orderA - orderB;
    const prioA = Number(a.priority || 0);
    const prioB = Number(b.priority || 0);
    if (prioA !== prioB) return prioA - prioB;
    return (a.text || a.titre || "").localeCompare(b.text || b.titre || "");
  });

  const sessionIndex = await Schema.countPracticeSessions(ctx.db, ctx.user.uid);
  const visible = [];
  const hidden = [];
  for (const c of orderSorted) {
    if (c.srEnabled === false) {
      visible.push(c);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const st = await Schema.readSRState(ctx.db, ctx.user.uid, c.id, "consigne");
    if (!st || st.nextAllowedIndex === undefined || st.nextAllowedIndex <= sessionIndex) {
      visible.push(c);
    } else {
      hidden.push({ c, remaining: st.nextAllowedIndex - sessionIndex });
    }
  }

  const form = card.querySelector("#practice-form");
  if (!visible.length) {
    form.innerHTML = `<div class="rounded-xl border border-dashed border-gray-200 bg-white p-3 text-sm text-[var(--muted)]">Aucune consigne visible pour cette itération.</div>`;
  } else {
    form.innerHTML = "";

    const makeItem = (c) => {
      const el = document.createElement("div");
      el.className = "consigne-card card p-3 space-y-3";
      el.dataset.id = c.id;
      el.setAttribute("draggable", "true");
      el.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <h4 class="font-semibold">${escapeHtml(c.text)}</h4>
            ${pill(c.category || "Général")}
            ${prioChip(Number(c.priority)||2)}
            ${srBadge(c)}
          </div>
          ${consigneActions()}
        </div>
        ${inputForType(c)}
      `;
      const bH = el.querySelector(".js-histo");
      const bE = el.querySelector(".js-edit");
      const bD = el.querySelector(".js-del");
      bH.onclick = (e) => { e.preventDefault(); e.stopPropagation(); Schema.D.info("ui.history.click", c.id); openHistory(ctx, c); };
      bE.onclick = (e) => { e.preventDefault(); e.stopPropagation(); Schema.D.info("ui.editConsigne.click", c.id); openConsigneForm(ctx, c); };
      bD.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (confirm("Supprimer cette consigne ? (historique conservé)")) {
          Schema.D.info("ui.deleteConsigne.confirm", c.id);
          await Schema.softDeleteConsigne(ctx.db, ctx.user.uid, c.id);
          renderPractice(ctx, root);
        }
      };
      const srT = el.querySelector(".js-sr-toggle");
      if (srT) srT.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        const on = srT.getAttribute("data-enabled") === "1";
        await Schema.updateConsigne(ctx.db, ctx.user.uid, c.id, { srEnabled: !on });
        srT.setAttribute("data-enabled", on ? "0" : "1");
        srT.setAttribute("aria-pressed", (!on).toString());
        srT.title = (!on) ? "Désactiver la répétition espacée" : "Activer la répétition espacée";
        srT.classList.toggle("opacity-50", on);
      };
      return el;
    };

    visible.forEach((c) => form.appendChild(makeItem(c)));

    if (typeof window.attachConsignesDragDrop === "function") {
      window.attachConsignesDragDrop(form, ctx);
    }
  }

  if (hidden.length) {
    const box = document.createElement("div");
    box.className = "card p-3 space-y-2";
    box.innerHTML = `<div class="font-medium">Masquées par répétition espacée (${hidden.length})</div>
  <ul class="text-sm text-[var(--muted)] space-y-1">
    ${hidden.map(h => `
      <li class="flex items-center justify-between gap-2">
        <span><span class="font-medium text-slate-600">${escapeHtml(h.c.text)}</span> — revient dans ${h.remaining} itération(s)</span>
        <span class="flex items-center gap-1">
          <button type="button" class="btn btn-ghost text-xs js-histo-hidden" data-id="${h.c.id}">Historique</button>
          <button type="button" class="btn btn-ghost text-xs js-reset-sr" data-id="${h.c.id}">Réinitialiser</button>
        </span>
      </li>`).join("")}
  </ul>`;
    container.appendChild(box);

    box.addEventListener("click", async (e) => {
      const id = e.target?.dataset?.id;
      if (!id) return;
      if (e.target.classList.contains("js-histo-hidden")) {
        const c = hidden.find((x) => x.c.id === id)?.c;
        if (c) openHistory(ctx, c);
      } else if (e.target.classList.contains("js-reset-sr")) {
        await Schema.resetSRForConsigne(ctx.db, ctx.user.uid, id);
        renderPractice(ctx, root);
      }
    });
  }

  const saveBtn = card.querySelector("#save");
  saveBtn.onclick = async (e) => {
    e.preventDefault();
    const answers = collectAnswers(form, visible);
    answers.forEach((ans) => { ans.sessionIndex = sessionIndex; });

    saveBtn.disabled = true;
    saveBtn.textContent = "Enregistrement…";

    try {
      if (answers.length) {
        await Schema.saveResponses(ctx.db, ctx.user.uid, "practice", answers);
      }
      await Schema.startNewPracticeSession(ctx.db, ctx.user.uid);

      $$("input[type=text],textarea", form).forEach((input) => (input.value = ""));
      $$("input[type=range]", form).forEach((input) => {
        input.value = 5;
        input.dispatchEvent(new Event("input"));
      });
      $$("select", form).forEach((input) => {
        input.selectedIndex = 0;
      });
      $$("input[type=radio]", form).forEach((input) => (input.checked = false));

      showToast(answers.length ? "Itération enregistrée" : "Itération passée");
      saveBtn.classList.add("btn-saved");
      saveBtn.textContent = "✓ Enregistré";
      setTimeout(() => {
        saveBtn.classList.remove("btn-saved");
        saveBtn.textContent = "Enregistrer";
        saveBtn.disabled = false;
      }, 900);

      renderPractice(ctx, root);
    } catch (err) {
      console.error(err);
      saveBtn.disabled = false;
      saveBtn.textContent = "Enregistrer";
    }
  };
  modesLogger.groupEnd();
}

const DOW = ["DIM","LUN","MAR","MER","JEU","VEN","SAM"];
function dateForDayFromToday(label){
  const target = DOW.indexOf(label);
  const today = new Date(); today.setHours(0,0,0,0);
  if (target < 0) return today;
  const cur = today.getDay(); // 0..6 (DIM=0)
  const delta = (target - cur + 7) % 7;
  const d = new Date(today);
  d.setDate(d.getDate() + delta);
  return d;
}
function daysBetween(a,b){
  const ms = (b.setHours(0,0,0,0), a.setHours(0,0,0,0), (b-a));
  return Math.max(0, Math.round(ms/86400000));
}

async function renderDaily(ctx, root, opts = {}) {
  root.innerHTML = "";
  const container = document.createElement("div");
  container.className = "space-y-4";
  root.appendChild(container);

  const currentHash = ctx.route || window.location.hash || "#/daily";
  const qp = new URLSearchParams(currentHash.split("?")[1] || "");
  const jours = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"];
  const todayIdx = (new Date().getDay() + 6) % 7;
  const dateIso = opts.dateIso || qp.get("d");
  let explicitDate = null;
  if (dateIso) {
    const parsed = new Date(dateIso);
    if (!Number.isNaN(parsed.getTime())) {
      parsed.setHours(0, 0, 0, 0);
      explicitDate = parsed;
    }
  }
  const isoDay = explicitDate ? DOW[explicitDate.getDay()] : null;
  const requested = normalizeDay(opts.day) || normalizeDay(qp.get("day")) || isoDay;
  const currentDay = requested || jours[todayIdx];
  modesLogger.group("screen.daily.render", { hash: ctx.route, day: currentDay, date: explicitDate?.toISOString?.() });

  const card = document.createElement("section");
  card.className = "card p-4 space-y-4";
  const today = jours[todayIdx];
  const buttons = jours.map((day) => `
    <button class="day-btn px-3 py-1 text-sm rounded-lg border ${day === currentDay
      ? "bg-[var(--accent-50)] border-[var(--accent-400)] font-medium"
      : "bg-white border-gray-200"}"
      data-day="${day}"
      data-today="${day === today ? "1" : "0"}">${day}</button>
  `).join("");
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
  const dashBtn = card.querySelector(".js-dashboard");
  if (dashBtn) {
    const hasCategory = Boolean(currentCat);
    dashBtn.disabled = !hasCategory;
    dashBtn.classList.toggle("opacity-50", !hasCategory);
    dashBtn.onclick = () => {
      if (!currentCat) return;
      window.openCategoryDashboard(ctx, currentCat);
    };
  }

  const all = await Schema.fetchConsignes(ctx.db, ctx.user.uid, "daily");
  const consignes = all.filter((c) => !c.days?.length || c.days.includes(currentDay));
  modesLogger.info("screen.daily.consignes", consignes.length);

  const selectedDate = explicitDate ? new Date(explicitDate) : dateForDayFromToday(currentDay);
  selectedDate.setHours(0, 0, 0, 0);
  const dayKey = Schema.todayKey(selectedDate);
  const visible = [];
  const hidden = [];
  await Promise.all(consignes.map(async (c) => {
    if (c.srEnabled === false) { visible.push(c); return; }
    // eslint-disable-next-line no-await-in-loop
    const st = await Schema.readSRState(ctx.db, ctx.user.uid, c.id, "consigne");
    const nextISO = st?.nextVisibleOn || st?.hideUntil;
    if (!nextISO) { visible.push(c); return; }
    const next = new Date(nextISO);
    if (next <= selectedDate) visible.push(c);
    else hidden.push({ c, daysLeft: daysBetween(new Date(), next), when: next });
  }));

  // Regrouper par catégorie, puis trier par priorité
  const catGroups = {};
  for (const c of visible) {
    const cat = c.category || "Général";
    (catGroups[cat] ??= []).push(c);
  }
  Object.values(catGroups).forEach((list) => list.sort((a, b) => (a.priority || 2) - (b.priority || 2)));

  const previousAnswers = await Schema.fetchDailyResponses(ctx.db, ctx.user.uid, dayKey);

  const renderItemCard = (item) => {
    const previous = previousAnswers?.get(item.id);
    const itemCard = document.createElement("div");
    itemCard.className = "daily-consigne";
    itemCard.innerHTML = `
      <div class="daily-consigne__top">
        <div class="daily-consigne__title">
          <div class="font-semibold">${escapeHtml(item.text)}</div>
          ${prioChip(Number(item.priority) || 2)}
          ${srBadge(item)}
        </div>
        ${consigneActions()}
      </div>
      <div class="daily-consigne__field">${inputForType(item, previous?.value ?? null)}</div>
    `;

    const bH = itemCard.querySelector(".js-histo");
    const bE = itemCard.querySelector(".js-edit");
    const bD = itemCard.querySelector(".js-del");
    bH.onclick = (e) => { e.preventDefault(); e.stopPropagation(); Schema.D.info("ui.history.click", item.id); openHistory(ctx, item); };
    bE.onclick = (e) => { e.preventDefault(); e.stopPropagation(); Schema.D.info("ui.editConsigne.click", item.id); openConsigneForm(ctx, item); };
    bD.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (confirm("Supprimer cette consigne ? (historique conservé)")) {
        Schema.D.info("ui.deleteConsigne.confirm", item.id);
        await Schema.softDeleteConsigne(ctx.db, ctx.user.uid, item.id);
        renderDaily(ctx, root, { day: currentDay });
      }
    };
    const srT = itemCard.querySelector(".js-sr-toggle");
    if (srT) srT.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const on = srT.getAttribute("data-enabled") === "1";
      await Schema.updateConsigne(ctx.db, ctx.user.uid, item.id, { srEnabled: !on });
      srT.setAttribute("data-enabled", on ? "0" : "1");
      srT.setAttribute("aria-pressed", (!on).toString());
      srT.title = (!on) ? "Désactiver la répétition espacée" : "Activer la répétition espacée";
      srT.classList.toggle("opacity-50", on);
    };

    return itemCard;
  };

  const form = document.createElement("form");
  form.className = "grid gap-6";
  card.appendChild(form);

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "rounded-xl border border-dashed border-gray-200 bg-white p-3 text-sm text-[var(--muted)]";
    empty.innerText = "Aucune consigne visible pour ce jour.";
    form.appendChild(empty);
  } else {
    Object.entries(catGroups).forEach(([cat, items]) => {
      const section = document.createElement("section");
      section.className = "daily-category";
      section.innerHTML = `
        <div class="daily-category__header">
          <div class="daily-category__name">${escapeHtml(cat)}</div>
          <span class="daily-category__count">${items.length} consigne${items.length > 1 ? "s" : ""}</span>
        </div>`;
      const stack = document.createElement("div");
      stack.className = "daily-category__items";
      section.appendChild(stack);

      const highs = items.filter((i) => (i.priority || 2) <= 2);
      const lows = items.filter((i) => (i.priority || 2) >= 3);

      highs.forEach((item) => stack.appendChild(renderItemCard(item)));

      if (lows.length) {
        const det = document.createElement("details");
        det.className = "daily-category__low";
        det.innerHTML = `<summary class="daily-category__low-summary">Priorité basse (${lows.length})</summary>`;
        const box = document.createElement("div");
        box.className = "daily-category__items daily-category__items--nested";
        lows.forEach((item) => box.appendChild(renderItemCard(item)));
        det.appendChild(box);
        stack.appendChild(det);
      }

      form.appendChild(section);
    });
  }

  if (hidden.length) {
    const box = document.createElement("div");
    box.className = "card p-3 space-y-2";
    box.innerHTML = `<div class="font-medium">Masquées par répétition espacée (${hidden.length})</div>
  <ul class="text-sm text-[var(--muted)] space-y-1">
    ${hidden.map(h => `
      <li class="flex items-center justify-between gap-2">
        <span><span class="font-medium text-slate-600">${escapeHtml(h.c.text)}</span> — revient dans ${h.daysLeft} jour(s) (le ${h.when.toLocaleDateString()})</span>
        <span class="flex items-center gap-1">
          <button type="button" class="btn btn-ghost text-xs js-histo-hidden" data-id="${h.c.id}">Historique</button>
          <button type="button" class="btn btn-ghost text-xs js-reset-sr" data-id="${h.c.id}">Réinitialiser</button>
        </span>
      </li>`).join("")}
  </ul>`;
    container.appendChild(box);

    box.addEventListener("click", async (e) => {
      const id = e.target?.dataset?.id;
      if (!id) return;
      if (e.target.classList.contains("js-histo-hidden")) {
        const c = hidden.find((x) => x.c.id === id)?.c;
        if (c) openHistory(ctx, c);
      } else if (e.target.classList.contains("js-reset-sr")) {
        await Schema.resetSRForConsigne(ctx.db, ctx.user.uid, id);
        renderDaily(ctx, root, { day: currentDay });
      }
    });
  }

  const actions = document.createElement("div");
  actions.className = "flex justify-end";
  actions.innerHTML = `<button type="submit" class="btn btn-primary">Enregistrer</button>`;
  form.appendChild(actions);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const answers = collectAnswers(form, visible, { dayKey });
    if (!answers.length) {
      alert("Aucune réponse");
      return;
    }
    await Schema.saveResponses(ctx.db, ctx.user.uid, "daily", answers);
    showToast("Journal enregistré");
    renderDaily(ctx, root, { day: currentDay, dateIso: dayKey });
  };

  modesLogger.groupEnd();
}

function renderHistory() {}

Modes.openCategoryDashboard = window.openCategoryDashboard;
Modes.openConsigneForm = openConsigneForm;
Modes.openHistory = openHistory;
Modes.renderPractice = renderPractice;
Modes.renderDaily = renderDaily;
Modes.renderHistory = renderHistory;
Modes.attachConsignesDragDrop = window.attachConsignesDragDrop;
