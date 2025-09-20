// modes.js — Daily & Practice UI, history, consigne management
import {
  collection, doc, setDoc, getDoc, addDoc, updateDoc,
  query, where, orderBy, getDocs, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as Schema from "./schema.js";

function $(sel){ return document.querySelector(sel); }
function el(tag, attrs={}, children=[]){
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v]) => (k==="class") ? n.className=v : n.setAttribute(k,v));
  (Array.isArray(children)?children:[children]).forEach(c => n.append(c.nodeType?c:document.createTextNode(c)));
  return n;
}

export async function openConsigneForm(ctx, consigne=null){
  const root = $("#view-root");
  const isEdit = !!consigne;
  root.innerHTML = `
    <div class="grid">
      <div class="section-title">
        <h2>${isEdit ? "Modifier" : "Ajouter"} une consigne</h2>
      </div>
      <div class="grid cols-2">
        <div class="field">
          <label>Texte</label>
          <textarea id="c-text" placeholder="Ex. : Est-ce que je me suis étiré ce matin ?"></textarea>
        </div>
        <div class="grid">
          <div class="field">
            <label>Catégorie</label>
            <input id="c-cat" placeholder="Ex. Santé, Musique…" />
            </div>
          <div class="field">
            <label>Mode</label>
            <select id="c-mode">
              <option value="daily">Journalier</option>
              <option value="practice">Pratique délibérée</option>
            </select>
          </div>
          <div class="field">
            <label>Type de réponse</label>
            <select id="c-type">
              <option value="likert6">Échelle de Likert (6)</option>
              <option value="num">Échelle numérique (1-10)</option>
              <option value="short">Texte court</option>
              <option value="long">Texte long</option>
            </select>
          </div>
          <div class="field">
            <label>Priorité</label>
            <select id="c-priority">
              <option value="high">Haute</option>
              <option value="medium" selected>Moyenne</option>
              <option value="low">Basse</option>
            </select>
          </div>
          <div class="field" id="freq-box">
            <label>Fréquence (Journalier)</label>
            <select id="c-frequency">
              <option value="daily" selected>Quotidienne</option>
              <option value="dow">Jours spécifiques</option>
            </select>
            <div id="dow-picker" class="muted" style="margin-top:6px;">
              <label><input type="checkbox" value="1" checked> Lun</label>
              <label><input type="checkbox" value="2" checked> Mar</label>
              <label><input type="checkbox" value="3" checked> Mer</label>
              <label><input type="checkbox" value="4" checked> Jeu</label>
              <label><input type="checkbox" value="5" checked> Ven</label>
              <label><input type="checkbox" value="6"> Sam</label>
              <label><input type="checkbox" value="0"> Dim</label>
            </div>
          </div>
          <div class="field">
            <label>Répétition espacée</label>
            <select id="c-sr"><option value="1" selected>Activée</option><option value="0">Désactivée</option></select>
          </div>
        </div>
      </div>
      <div class="flex">
        <button class="btn primary" id="c-save">Enregistrer</button>
        <button class="btn" id="c-cancel">Annuler</button>
      </div>
    </div>
  `;
  // Defaults if editing
  if (isEdit){
    $("#c-text").value = consigne.text || "";
    $("#c-cat").value = consigne.category || "";
    $("#c-mode").value = consigne.mode || "daily";
    $("#c-type").value = consigne.type || "likert6";
    $("#c-priority").value = consigne.priority || "medium";
    const freq = consigne.frequency?.type || "daily";
    $("#c-frequency").value = (freq === "daysOfWeek") ? "dow" : "daily";
    if (freq === "daysOfWeek"){
      const days = consigne.frequency.days || [];
      document.querySelectorAll("#dow-picker input[type=checkbox]").forEach(cb => {
        cb.checked = days.includes(Number(cb.value));
      });
    }
    $("#c-sr").value = consigne.spacedRepetitionEnabled ? "1" : "0";
  }
  const updateFreqVis = ()=>{
    const show = $("#c-frequency").value === "dow";
    $("#dow-picker").style.display = show ? "grid" : "none";
  };
  updateFreqVis();
  $("#c-frequency").onchange = updateFreqVis;

  $("#c-cancel").onclick = () => renderDaily(ctx, $("#view-root"));
  $("#c-save").onclick = async () => {
    const text = $("#c-text").value.trim();
    const category = $("#c-cat").value.trim() || "Général";
    const mode = $("#c-mode").value;
    const type = $("#c-type").value;
    const priority = $("#c-priority").value;
    const freqType = $("#c-frequency").value;
    const spaced = $("#c-sr").value === "1";
    if (!text) { alert("Le texte est obligatoire."); return; }
    // Ensure category
    const cat = await Schema.ensureCategory(ctx.db, ctx.user.uid, category, mode);
    const payload = {
      ownerUid: ctx.user.uid, text, category: cat.name, categoryId: cat.id,
      type, priority, mode, spacedRepetitionEnabled: spaced, active: true,
      createdAt: Schema.now()
    };
    if (mode === "daily"){
      payload.frequency = (freqType === "daily")
        ? { type:"daily" } : { type:"daysOfWeek", days: Array.from(document.querySelectorAll("#dow-picker input:checked")).map(cb => Number(cb.value)) };
    }
    if (consigne?.id){
      await updateDoc(doc(ctx.db, "consignes", consigne.id), payload);
    } else {
      await addDoc(collection(ctx.db, "consignes"), payload);
    }
    location.hash = (mode === "practice") ? "#/practice" : "#/daily";
  };
}

function controlsForConsigne(consigne){
  const c = el("div", {class:"flex"});
  if (consigne.type === "likert6"){
    const opts = [
      ["no_answer","NR"],["no","Non"],["rather_no","Plutôt non"],["medium","Moyen"],["rather_yes","Plutôt oui"],["yes","Oui"]
    ];
    opts.forEach(([val,label])=>{
      const b = el("button",{class:"btn small", "data-answer":val}, label);
      c.append(b);
    });
  } else if (consigne.type === "num"){
    const inp = el("input",{type:"range", min:"1", max:"10", value:"5", style:"width:220px;"});
    const out = el("span",{class:"pill"}, "5");
    inp.oninput = ()=> out.textContent = inp.value;
    const ok = el("button",{class:"btn small"}, "Valider");
    ok.onclick = ()=> c.dispatchEvent(new CustomEvent("answer-num",{detail: Number(inp.value)}));
    c.append(inp,out,ok);
  } else if (consigne.type === "short"){
    const inp = el("input",{placeholder:"Votre réponse (≤200c)", maxlength:"200"});
    const ok = el("button",{class:"btn small"},"Valider");
    ok.onclick = ()=> c.dispatchEvent(new CustomEvent("answer-text",{detail: inp.value.trim()}));
    c.append(inp, ok);
  } else {
    const inp = el("textarea",{placeholder:"Votre réponse"});
    const ok = el("button",{class:"btn small"},"Valider");
    ok.onclick = ()=> c.dispatchEvent(new CustomEvent("answer-text",{detail: inp.value.trim()}));
    c.append(inp, ok);
  }
  return c;
}

async function listConsignes(ctx, mode){
  const qy = query(collection(ctx.db, "consignes"),
    where("ownerUid","==",ctx.user.uid),
    where("mode","==",mode),
    where("active","==",true),
    orderBy("priority")
  );
  const ss = await getDocs(qy);
  return ss.docs.map(d => ({ id: d.id, ...d.data() }));
}

function groupByCategory(items){
  const map = {};
  for (const it of items){
    const key = it.category || "Général";
    map[key] = map[key] || [];
    map[key].push(it);
  }
  return map;
}

async function saveResponse(ctx, consigne, mode, value){
  const payload = {
    ownerUid: ctx.user.uid,
    consigneId: consigne.id,
    mode, value,
    createdAt: Schema.now(),
  };
  // compute SR
  const srPrev = await Schema.readSRState(ctx.db, ctx.user.uid, consigne.id, mode);
  let answerKind = null;
  if (consigne.type === "likert6") answerKind = value; // string key
  else if (consigne.type === "num") answerKind = value; // number
  else answerKind = "yes"; // treat text as positive
  const upd = Schema.nextCooldownAfterAnswer(consigne, srPrev, answerKind);
  await Schema.upsertSRState(ctx.db, ctx.user.uid, consigne.id, mode, upd);
  await addDoc(collection(ctx.db,"responses"), payload);
}

function consigneCard(consigne, extraMeta=""){
  const d = el("div", {class:"consigne"});
  const line = el("div", {class:"flex"});
  line.append(el("div", {class:"title"}, consigne.text));
  line.append(el("span", {class:`badge ${consigne.priority}`}, consigne.priority));
  if (extraMeta) line.append(el("span", {class:"pill"}, extraMeta));
  d.append(line);
  const meta = el("div", {class:"meta"});
  meta.append(`Catégorie: ${consigne.category}`);
  if (consigne.mode==="daily"){
    meta.append(`Fréquence: ${consigne.frequency?.type==="daysOfWeek"?"Jours spécifiques":"Quotidienne"}`);
  }
  d.append(meta);
  const controls = controlsForConsigne(consigne);
  // event handlers
  controls.addEventListener("click", async (e)=>{
    const btn = e.target.closest("button[data-answer]");
    if (!btn) return;
    const val = btn.getAttribute("data-answer");
    await saveResponse(window.__ctx, consigne, consigne.mode, val);
    btn.textContent = "✓";
    btn.disabled = true;
  });
  controls.addEventListener("answer-num", async (e)=>{
    await saveResponse(window.__ctx, consigne, consigne.mode, e.detail);
  });
  controls.addEventListener("answer-text", async (e)=>{
    await saveResponse(window.__ctx, consigne, consigne.mode, e.detail);
  });
  d.append(controls);
  return d;
}

export async function renderDashboard(ctx, root){
  window.__ctx = ctx;
  const consignesDaily = await listConsignes(ctx, "daily");
  const consignesPractice = await listConsignes(ctx, "practice");
  root.innerHTML = "";
  const top = el("div",{class:"kpi"});
  top.append(el("div",{class:"card"}, `Consignes (journalier): ${consignesDaily.length}`));
  top.append(el("div",{class:"card"}, `Consignes (pratique): ${consignesPractice.length}`));
  top.append(el("div",{class:"card"}, "Sessions aujourd’hui : (bientôt)"));
  root.append(top);
  const g1 = groupByCategory(consignesDaily);
  const g2 = groupByCategory(consignesPractice);
  const section = el("div",{class:"grid"});
  section.append(el("h3",{}, "Raccourcis"));
  const bar = el("div",{class:"flex"});
  bar.append(el("button",{class:"btn", onclick:()=>openConsigneForm(ctx)},"+ Ajouter une consigne"));
  bar.append(el("button",{class:"btn", onclick:()=>location.hash="#/practice?new=1"},"+ Nouvelle session"));
  section.append(bar);
  root.append(section);
  const lists = el("div",{class:"grid cols-2"});
  lists.append(el("div",{class:"card"}, el("div",{}, "Par catégorie (journalier)"), el("div",{}, Object.keys(g1).join(", ") || "—")));
  lists.append(el("div",{class:"card"}, el("div",{}, "Par catégorie (pratique)"), el("div",{}, Object.keys(g2).join(", ") || "—")));
  root.append(lists);
}

export async function renderDaily(ctx, root){
  window.__ctx = ctx;
  const all = await listConsignes(ctx, "daily");
  const visible = [];
  const hidden = [];
  for (const c of all){
    const sr = await Schema.readSRState(ctx.db, ctx.user.uid, c.id, "daily");
    (Schema.isDueToday(c, sr) ? visible : hidden).push({ c, sr });
  }
  // sort by priority high > medium > low
  const order = { high: 0, medium: 1, low: 2 };
  visible.sort((a,b) => (order[a.c.priority]-order[b.c.priority]));
  hidden.sort((a,b) => (order[a.c.priority]-order[b.c.priority]));

  root.innerHTML = "";
  const title = el("div",{class:"section-title"});
  title.append(el("h2",{}, "Consignes du jour"));
  title.append(el("span",{class:"muted"}, `${visible.length} visibles • ${hidden.length} masquées`));
  root.append(title);

  const list = el("div",{class:"list"});
  // sections by priority
  for (const pri of ["high","medium","low"]){
    const items = visible.filter(x=>x.c.priority===pri);
    if (!items.length) continue;
    list.append(el("h3",{}, pri === "high" ? "Priorité haute" : pri==="medium" ? "Standard" : "Priorité basse"));
    for (const it of items){
      list.append(consigneCard(it.c));
    }
  }
  root.append(list);

  if (hidden.length){
    const det = el("details",{});
    det.append(el("summary",{}, `Consignes masquées (${hidden.length}) — répétition espacée`));
    const inner = el("div",{class:"grid", style:"margin-top:8px;"});
    for (const it of hidden){
      const meta = (it.c.mode==="daily" && it.sr?.cooldownUntil) ? `Réapparaît après ${it.sr.cooldownUntil}` : "";
      inner.append(consigneCard(it.c, meta));
    }
    det.append(inner);
    root.append(det);
  }
}

export async function renderPractice(ctx, root, { newSession=false }={}){
  window.__ctx = ctx;
  if (newSession){
    await startNewPracticeSession(ctx);
  }
  const consignes = await listConsignes(ctx, "practice");
  // group by category
  const groups = groupByCategory(consignes);
  root.innerHTML = "";
  root.append(el("h2",{}, "Pratique délibérée"));
  const sel = el("select",{id:"practice-cat"});
  const cats = Object.keys(groups);
  if (!cats.length) {
    root.append(el("div",{class:"card"}, "Aucune consigne de pratique. Ajoutez-en d’abord."));
    return;
  }
  cats.forEach(c=> sel.append(el("option",{value:c}, c)));
  const box = el("div",{class:"grid"});
  box.append(el("div",{class:"field"}, el("label",{},"Catégorie"), sel));
  const cont = el("div",{class:"list"});
  box.append(cont);
  root.append(box);

  async function draw(){
    cont.innerHTML = "";
    const cat = sel.value;
    const items = groups[cat] || [];
    const toShow = [];
    const masked = [];
    for (const it of items){
      const sr = await Schema.readSRState(ctx.db, ctx.user.uid, it.id, "practice");
      (Schema.isDueToday(it, sr) ? toShow : masked).push({ it, sr });
    }
    cont.append(el("div",{class:"muted"}, `${toShow.length} visibles • ${masked.length} masquées`));
    for (const {it} of toShow){
      cont.append(consigneCard(it));
    }
    if (masked.length){
      const det = el("details",{});
      det.append(el("summary",{},"Masquées (répétition espacée)"));
      const inner = el("div",{class:"grid", style:"margin-top:8px;"});
      for (const {it,sr} of masked){
        const meta = sr?.cooldownSessions ? `Masquée pour ${sr.cooldownSessions} session(s)` : "";
        inner.append(consigneCard(it, meta));
      }
      det.append(inner);
      cont.append(det);
    }
  }
  sel.onchange = draw;
  draw();
}

async function startNewPracticeSession(ctx){
  // Decrement cooldownSessions for all practice SR states > 0
  const qy = query(collection(ctx.db, "srStates"),
    where("ownerUid","==",ctx.user.uid), where("mode","==","practice"), where("cooldownSessions",">",0));
  const ss = await getDocs(qy);
  for (const d of ss.docs){
    const v = d.data().cooldownSessions || 0;
    await updateDoc(doc(ctx.db, "srStates", d.id), { cooldownSessions: Math.max(0, v-1), updatedAt: Schema.now() });
  }
  // Create a session doc (lightweight; responses will link to it later if needed)
  await addDoc(collection(ctx.db,"sessions"), {
    ownerUid: ctx.user.uid, startedAt: Schema.now()
  });
}

export async function renderHistory(ctx, root){
  window.__ctx = ctx;
  root.innerHTML = "";
  root.append(el("h2",{},"Historique"));
  const box = el("div",{class:"grid"});
  const filt = el("div",{class:"flex"});
  const modeSel = el("select",{}); ["all","daily","practice"].forEach(m=> modeSel.append(el("option",{value:m}, m)));
  const limitSel = el("select",{}); ["50","200","1000"].forEach(n=> limitSel.append(el("option",{value:n}, `${n} dernières entrées`)));
  limitSel.value = "200";
  filt.append(el("div",{},"Mode :"), modeSel, el("div",{style:"width:12px"}), el("div",{},"Plage :"), limitSel);
  box.append(filt);
  const table = el("table",{class:"table"});
  table.innerHTML = "<thead><tr><th>Date</th><th>Mode</th><th>Catégorie</th><th>Consigne</th><th>Valeur</th></tr></thead><tbody></tbody>";
  const tbody = table.querySelector("tbody");
  box.append(table);
  root.append(box);

  async function load(){
    tbody.innerHTML = "<tr><td colspan='5' class='muted'>Chargement…</td></tr>";
    const lim = Number(limitSel.value);
    const qy = query(collection(ctx.db,"responses"),
      where("ownerUid","==",ctx.user.uid),
      orderBy("createdAt","desc"),
      limit(lim));
    const ss = await getDocs(qy);
    const rows = [];
    for (const d of ss.docs){
      const r = d.data();
      const cRef = doc(ctx.db,"consignes", r.consigneId);
      const cSnap = await getDoc(cRef);
      const cons = cSnap.exists() ? cSnap.data() : { text:"(supprimée)", category:"—" };
      if (modeSel.value!=="all" && r.mode !== modeSel.value) continue;
      rows.push({
        date: r.createdAt, mode: r.mode, category: cons.category || "—", text: cons.text, value: formatVal(cons, r.value)
      });
    }
    tbody.innerHTML = rows.map(r =>
      `<tr><td>${r.date}</td><td>${r.mode}</td><td>${r.category}</td><td>${r.text}</td><td>${r.value}</td></tr>`
    ).join("") || "<tr><td colspan='5'>—</td></tr>";
  }
  function formatVal(cons, v){
    if (cons.type==="likert6") return v;
    if (cons.type==="num") return v;
    if (typeof v === "string") return v.slice(0,120);
    return JSON.stringify(v);
  }
  limitSel.onchange = load;
  modeSel.onchange = load;
  load();
}

export async function renderAdmin(ctx, root) {
  root.innerHTML = `
    <h2>Admin – Créer un utilisateur</h2>
    <button class="btn primary" id="btn-create-user">+ Nouvel utilisateur</button>
    <div id="user-links" class="list"></div>
  `;

  document.getElementById("btn-create-user").onclick = async () => {
    const newRef = doc(collection(ctx.db, "users"));
    await setDoc(newRef, { ownerUid: newRef.id, createdAt: Date.now() });

    const link = `${location.origin}${location.pathname}#/login/${newRef.id}`;
    const div = document.createElement("div");
    div.innerHTML = `<code>${link}</code>`;
    document.getElementById("user-links").appendChild(div);
  };
}

export async function renderLogin(ctx, root, uid) {
  const snap = await getDoc(doc(ctx.db, "users", uid));
  if (!snap.exists()) {
    root.innerHTML = "<p>Utilisateur inconnu</p>";
    return;
  }

  // Stocker l'utilisateur courant globalement
  ctx.user = { uid };
  root.innerHTML = `<p>Connecté en tant qu’utilisateur <strong>${uid}</strong></p>`;
  location.hash = "#/dashboard"; // redirige vers le tableau de bord
}