// goals.js — Objectives (hebdo/mensuel/annuel), linking with consignes
import {
  collection, addDoc, doc, getDoc, getDocs, setDoc, updateDoc,
  query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as Schema from "./schema.js";

function $(sel){ return document.querySelector(sel); }
function el(tag, attrs={}, children=[]){
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v]) => (k==="class") ? n.className=v : n.setAttribute(k,v));
  (Array.isArray(children)?children:[children]).forEach(c => n.append(c.nodeType?c:document.createTextNode(c)));
  return n;
}

export function openGoalForm(ctx, goal=null){
  const root = $("#view-root");
  const isEdit = !!goal;
  root.innerHTML = \`
    <div class="grid">
      <div class="section-title"><h2>\${isEdit?"Modifier":"Créer"} un objectif</h2></div>
      <div class="grid cols-2">
        <div class="field"><label>Titre de l’objectif</label><input id="g-title" placeholder="Ex. Améliorer ma posture"></div>
        <div class="field"><label>Catégorie</label><input id="g-cat" placeholder="Santé, Apprentissage…"></div>
        <div class="field">
          <label>Temporalité</label>
          <select id="g-temp">
            <option value="weekly">Hebdomadaire</option>
            <option value="monthly">Mensuelle</option>
            <option value="yearly">Annuelle</option>
          </select>
        </div>
        <div class="field">
          <label>Type de réponse</label>
          <select id="g-type">
            <option value="likert6">Likert (6)</option>
            <option value="num">Échelle (1-10)</option>
            <option value="short">Texte court</option>
            <option value="long">Texte long</option>
          </select>
        </div>
        <div class="field">
          <label>Priorité</label>
          <select id="g-priority">
            <option value="high">Haute</option>
            <option value="medium" selected>Moyenne</option>
            <option value="low">Basse</option>
          </select>
        </div>
        <div class="field">
          <label>Associer des consignes (IDs séparés par des virgules)</label>
          <input id="g-links" placeholder="(optionnel) IDs de consignes"/>
        </div>
        <div class="field">
          <label>Répétition espacée</label>
          <select id="g-sr"><option value="1" selected>Activée</option><option value="0">Désactivée</option></select>
        </div>
      </div>
      <div class="flex">
        <button class="btn primary" id="g-save">Enregistrer</button>
        <button class="btn" id="g-cancel">Annuler</button>
      </div>
    </div>
  \`;
  if (isEdit){
    $("#g-title").value = goal.title || "";
    $("#g-cat").value = goal.category || "";
    $("#g-temp").value = goal.temporalUnit || "weekly";
    $("#g-type").value = goal.type || "likert6";
    $("#g-priority").value = goal.priority || "medium";
    $("#g-links").value = (goal.linkedConsigneIds||[]).join(",");
    $("#g-sr").value = goal.spacedRepetitionEnabled ? "1":"0";
  }
  $("#g-cancel").onclick = ()=> renderGoals(ctx, $("#view-root"));
  $("#g-save").onclick = async ()=>{
    const payload = {
      ownerUid: ctx.user.uid,
      title: $("#g-title").value.trim(),
      category: $("#g-cat").value.trim() || "Général",
      temporalUnit: $("#g-temp").value,
      type: $("#g-type").value,
      priority: $("#g-priority").value,
      linkedConsigneIds: ($("#g-links").value||"").split(",").map(x=>x.trim()).filter(Boolean),
      spacedRepetitionEnabled: $("#g-sr").value==="1",
      createdAt: Schema.now(),
      active: true
    };
    if (!payload.title){ alert("Titre obligatoire"); return; }
    if (goal?.id) await updateDoc(doc(ctx.db,"goals",goal.id), payload);
    else await addDoc(collection(ctx.db,"goals"), payload);
    location.hash = "#/goals";
  };
}

export async function renderGoals(ctx, root){
  root.innerHTML = "";
  root.append(el("h2",{},"Objectifs"));
  const qy = query(collection(ctx.db,"goals"), where("ownerUid","==",ctx.user.uid), orderBy("createdAt","desc"));
  const ss = await getDocs(qy);
  const byT = { weekly:[], monthly:[], yearly:[] };
  for (const d of ss.docs){ const g = { id:d.id, ...d.data() }; (byT[g.temporalUnit]||byT.weekly).push(g); }
  const wrap = el("div",{class:"grid"});
  wrap.append(section("Hebdomadaires", byT.weekly));
  wrap.append(section("Mensuels", byT.monthly));
  wrap.append(section("Annuels", byT.yearly));
  root.append(wrap);
}

function section(title, items){
  const s = el("div",{class:"grid"});
  s.append(el("h3",{}, title));
  const grid = el("div",{class:"grid cols-3"});
  if (!items.length){ grid.append(el("div",{class:"muted"},"—")); s.append(grid); return s; }
  for (const g of items){
    const card = el("div",{class:"card"});
    card.append(el("div",{class:"flex"}, el("div",{style:"font-weight:600"}, g.title), el("span",{class:"badge "+g.priority}, g.priority)));
    card.append(el("div",{class:"muted"}, \`\${g.category} • \${g.temporalUnit}\`));
    const btns = el("div",{class:"flex"});
    btns.append(el("button",{class:"btn small", onclick:()=>openGoalForm(window.__ctx, g)},"Modifier"));
    btns.append(el("button",{class:"btn small", onclick:()=>openGoalTracker(window.__ctx, g)},"Suivi"));
    card.append(btns);
    grid.append(card);
  }
  s.append(grid);
  return s;
}

function answerControls(goal){
  const c = el("div",{class:"flex"});
  if (goal.type === "likert6"){
    [["no_answer","NR"],["no","Non"],["rather_no","Plutôt non"],["medium","Moyen"],["rather_yes","Plutôt oui"],["yes","Oui"]]
      .forEach(([v,l])=> c.append(el("button",{class:"btn small","data-val":v},l)));
  } else if (goal.type === "num"){
    const inp = el("input",{type:"range",min:"1",max:"10",value:"5",style:"width:220px"});
    const out = el("span",{class:"pill"},"5");
    inp.oninput = ()=> out.textContent = inp.value;
    const ok = el("button",{class:"btn small"},"Valider");
    ok.onclick = ()=> c.dispatchEvent(new CustomEvent("answer-num",{detail:Number(inp.value)}));
    c.append(inp,out,ok);
  } else if (goal.type === "short"){
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

async function saveGoalResponse(ctx, goal, value){
  const payload = {
    ownerUid: ctx.user.uid, goalId: goal.id, value, temporalUnit: goal.temporalUnit, createdAt: Schema.now()
  };
  const srPrev = await Schema.readSRState(ctx.db, ctx.user.uid, goal.id, "goal_"+goal.temporalUnit);
  const upd = Schema.nextCooldownAfterAnswer({ ...goal, mode:"daily" }, srPrev, (goal.type==="likert6"?value: (goal.type==="num"?value:"yes")));
  await Schema.upsertSRState(ctx.db, ctx.user.uid, goal.id, "goal_"+goal.temporalUnit, upd);
  await addDoc(collection(ctx.db,"goalResponses"), payload);
}

export async function openGoalTracker(ctx, goal){
  const root = $("#view-root");
  root.innerHTML = "";
  root.append(el("h2",{}, goal.title));
  root.append(el("div",{class:"muted"}, \`\${goal.category} • \${goal.temporalUnit}\`));

  const ctrl = answerControls(goal);
  ctrl.addEventListener("click", async (e)=>{
    const b = e.target.closest("button[data-val]"); if (!b) return;
    await saveGoalResponse(ctx, goal, b.getAttribute("data-val"));
  });
  ctrl.addEventListener("answer-num", async (e)=> await saveGoalResponse(ctx, goal, e.detail));
  ctrl.addEventListener("answer-text", async (e)=> await saveGoalResponse(ctx, goal, e.detail));
  root.append(ctrl);

  // Linked consignes quick view (progress overlay)
  if (goal.linkedConsigneIds?.length){
    root.append(el("h3",{},"Consignes liées (aperçu)"));
    const list = el("div",{class:"grid"});
    for (const cid of goal.linkedConsigneIds){
      const csnap = await getDoc(doc(ctx.db,"consignes", cid));
      if (!csnap.exists()) continue;
      list.append(el("div",{class:"card"}, csnap.data().text || cid));
    }
    root.append(list);
  }

  // TODO: Simple chart (history) — minimal in V1
  const canvas = el("canvas",{id:"goal-chart"});
  root.append(canvas);
  const qy = query(collection(ctx.db,"goalResponses"),
    where("ownerUid","==",ctx.user.uid), where("goalId","==",goal.id), orderBy("createdAt","asc"));
  const ss = await getDocs(qy);
  const xs = [], ys = [];
  ss.forEach(d=>{ xs.push(d.data().createdAt.slice(0,10)); ys.push( toNum(goal,d.data().value) ); });
  // Chart.js
  if (window.Chart){
    new window.Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels: xs, datasets: [{ label: "Progression", data: ys }] },
      options: { scales: { y: { beginAtZero: true, suggestedMax: 10 } } }
    });
  }
}

function toNum(goal, v){
  if (goal.type==="likert6"){
    return ({no_answer:0,no:0,rather_no:3,medium:5,rather_yes:7,yes:10})[v] ?? 0;
  }
  if (goal.type==="num") return Number(v)||0;
  return 10; // consider text as completion
}
