// goals.js — Objectifs (hebdo/mensuel/annuel)
import {
  collection, addDoc, doc, getDoc, getDocs, setDoc, updateDoc,
  query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as Schema from "./schema.js";
const { col, docIn, now, readSRState, upsertSRState, nextCooldownAfterAnswer } = Schema;

function $(s){ return document.querySelector(s); }
function el(tag, attrs={}, children=[]){
  const n=document.createElement(tag);
  Object.entries(attrs).forEach(([k,v]) => (k==="class")?n.className=v:(k==="onclick")?n.onclick=v:n.setAttribute(k,v));
  (Array.isArray(children)?children:[children]).forEach(c=>n.append(c?.nodeType?c:document.createTextNode(c)));
  return n;
}
function modal(content){ const w=el("div",{class:"modal-backdrop"}), p=el("div",{class:"modal"}); const x=el("button",{class:"btn small",style:"float:right",onclick:()=>w.remove()},"Fermer"); p.append(x,content); w.append(p); document.body.append(w); return {close:()=>w.remove()}; }

/* ---------- CRUD ---------- */
export async function renderGoals(ctx, root){
  window.__ctx = ctx;
  root.innerHTML = "";
  root.append(el("div",{class:"section-title"},
    [el("h2",{style:"margin:0"},"Objectifs"),
     el("div",{}, el("button",{class:"btn primary", onclick:()=>openGoalForm(ctx)},"+ Nouvel objectif"))]));

  const qy = query(col(ctx.db, ctx.user.uid, "goals"), orderBy("createdAt","desc"));
  const ss = await getDocs(qy);
  if (ss.empty){ root.append(el("div",{class:"card muted"},"Aucun objectif")); return; }

  const grid = el("div",{class:"row cols-3"});
  ss.forEach(d=>{
    const g = { id:d.id, ...d.data() };
    const card = el("div",{class:"card"});
    card.append(el("div",{class:"section-title"},
      [el("div",{style:"font-weight:700"}, g.title),
       el("span",{class:"pill"}, g.temporalUnit)]));
    card.append(el("div",{class:"muted"}, g.category || "Général"));
    const btns = el("div",{class:"section-title"},
      [el("div",{},""),
       el("div",{},[
         el("button",{class:"btn small", onclick:()=>openGoalForm(ctx,g)},"Modifier"),
         el("button",{class:"btn small", onclick:()=>openGoalTracker(ctx,g)},"Suivi")
       ])]);
    card.append(btns);
    grid.append(card);
  });
  root.append(grid);
}

export function openGoalForm(ctx, goal=null){
  const box = el("div");
  box.append(el("h3",{}, goal?"Modifier l’objectif":"Nouvel objectif"));
  const f = {
    title: el("input",{class:"input", placeholder:"Titre (obligatoire)"}),
    cat: el("input",{class:"input", placeholder:"Catégorie"}),
    tempo: el("select",{class:"input"},[
      el("option",{value:"weekly"},"Hebdomadaire"),
      el("option",{value:"monthly"},"Mensuel"),
      el("option",{value:"yearly"},"Annuel"),
    ]),
    type: el("select",{class:"input"},[
      el("option",{value:"likert6"},"Likert (6)"),
      el("option",{value:"num"},"Échelle (1–10)"),
      el("option",{value:"short"},"Texte court"),
      el("option",{value:"long"},"Texte long"),
    ]),
    prio: el("select",{class:"input"},[
      el("option",{value:"high"},"Haute"),
      el("option",{value:"medium",selected:true},"Moyenne"),
      el("option",{value:"low"},"Basse"),
    ]),
    links: el("input",{class:"input", placeholder:"IDs de consignes liés (optionnel, séparés par des virgules)"}),
    sr: el("select",{class:"input"},[
      el("option",{value:"1"},"Répétition espacée activée"),
      el("option",{value:"0"},"Répétition espacée désactivée"),
    ])
  };
  if (goal){
    f.title.value=goal.title||"";
    f.cat.value=goal.category||"";
    f.tempo.value=goal.temporalUnit||"weekly";
    f.type.value=goal.type||"likert6";
    f.prio.value=goal.priority||"medium";
    f.links.value=(goal.linkedConsigneIds||[]).join(",");
    f.sr.value = goal.spacedRepetitionEnabled? "1":"0";
  }
  const form = el("div",{class:"row cols-2"},
    [field("Titre",f.title),field("Catégorie",f.cat),
     field("Temporalité",f.tempo),field("Type de réponse",f.type),
     field("Priorité",f.prio),field("Répétition espacée",f.sr),
     field("Consignes liées",f.links)]);
  box.append(form);
  const actions = el("div",{class:"section-title"},
    [el("div",{},""),
     el("div",{},[
       el("button",{class:"btn", onclick:()=>m.close()},"Annuler"),
       el("button",{class:"btn primary", onclick:save},"Enregistrer")
     ])]);
  box.append(actions);
  const m = modal(box);

  async function save(){
    const payload = {
      ownerUid: ctx.user.uid,
      title: f.title.value.trim(),
      category: f.cat.value.trim() || "Général",
      temporalUnit: f.tempo.value, type: f.type.value, priority: f.prio.value,
      linkedConsigneIds: (f.links.value||"").split(",").map(x=>x.trim()).filter(Boolean),
      spacedRepetitionEnabled: f.sr.value==="1",
      createdAt: now(), active: true
    };
    if (!payload.title){ alert("Titre obligatoire"); return; }
    if (goal?.id) await updateDoc(docIn(ctx.db, ctx.user.uid,"goals", goal.id), payload);
    else await addDoc(col(ctx.db, ctx.user.uid,"goals"), payload);
    m.close(); location.hash = "#/goals";
  }
  function field(label,node){ const w=el("div",{class:"row"}); w.append(el("label",{class:"muted"},label), node); return w; }
}

export async function openGoalTracker(ctx, goal){
  const box = el("div"); box.append(el("h3",{},goal.title));
  const ctrl = answerControls(goal); box.append(ctrl);
  const canvas = el("canvas",{id:"g-chart",style:"margin-top:6px"}); box.append(canvas);

  const m = modal(box);

  ctrl.addEventListener("answer", async (e)=>{
    const value = e.detail;
    const payload = { ownerUid: ctx.user.uid, goalId: goal.id, value, temporalUnit: goal.temporalUnit, createdAt: now() };
    const prev = await readSRState(ctx.db, ctx.user.uid, goal.id, "goal_"+goal.temporalUnit);
    const upd = nextCooldownAfterAnswer({ mode:"daily", type: goal.type }, prev, value);
    await upsertSRState(ctx.db, ctx.user.uid, goal.id, "goal_"+goal.temporalUnit, upd);
    await addDoc(col(ctx.db, ctx.user.uid,"goalResponses"), payload);
    alert("Réponse enregistrée");
  });

  // Mini chart historique
  const qy = query(col(ctx.db, ctx.user.uid,"goalResponses"), where("goalId","==",goal.id), orderBy("createdAt","asc"));
  const ss = await getDocs(qy);
  const xs=[],ys=[];
  ss.forEach(d=>{ xs.push(d.data().createdAt.slice(0,16)); ys.push(likertToNum(goal.type,d.data().value)); });
  if (window.Chart){
    new window.Chart(canvas.getContext("2d"),{
      type:"line", data:{ labels:xs, datasets:[{label:"Progression", data:ys}] },
      options:{ scales:{ y:{ beginAtZero:true, suggestedMax:10 } } }
    });
  }
}

function answerControls(goal){
  const wrap = el("div",{class:"card"});
  if (goal.type==="likert6"){
    const opts=[["na","NR"],["no","Non"],["rn","Plutôt non"],["med","Moyen"],["ry","Plutôt oui"],["yes","Oui"]];
    const row=el("div",{class:"row",style:"grid-auto-flow:column;gap:10px;overflow:auto"});
    opts.forEach(([v,l])=>{
      row.append(el("button",{class:"btn small", onclick:()=>wrap.dispatchEvent(new CustomEvent("answer",{detail:v}))}, l));
    });
    wrap.append(row);
  }else if(goal.type==="num"){
    const r=el("input",{type:"range",min:"1",max:"10",value:"5",style:"width:100%"}), out=el("div",{class:"pill"},"5");
    r.oninput=()=>out.textContent=r.value;
    const ok=el("button",{class:"btn small success", onclick:()=>wrap.dispatchEvent(new CustomEvent("answer",{detail:Number(r.value)}))},"Valider");
    wrap.append(r,out,ok);
  }else{
    const inp = goal.type==="short" ? el("input",{class:"input",maxlength:"200"}) : el("textarea",{class:"input"});
    const ok = el("button",{class:"btn small success", onclick:()=>wrap.dispatchEvent(new CustomEvent("answer",{detail: inp.value.trim()}))},"Valider");
    wrap.append(inp, ok);
  }
  return wrap;
}
function likertToNum(type,v){ if(type!=="likert6") return Number(v)||0; return ({na:0,no:0,rn:3,med:5,ry:7,yes:10})[v]??0; }


