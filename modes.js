import {
  addDoc, getDoc, getDocs, doc, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as Schema from "./schema.js";
import { col, docIn } from "./schema.js";

function $(s){ return document.querySelector(s); }
function el(tag, attrs={}, children=[]){
  const n = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)){
    if (k==="class") n.className = v;
    else if (k==="onclick") n.onclick = v;
    else n.setAttribute(k,v);
  }
  (Array.isArray(children)?children:[children]).forEach(c => n.append(c?.nodeType?c:document.createTextNode(c)));
  return n;
}

// ---------- Formulaires d’édition de consigne ----------
export function openConsigneForm(ctx, defaults={}){
  const root = $("#view-root");
  const isEdit = !!defaults.id;
  root.innerHTML = "";

  const modes = [["daily","Journalier"], ["practice","Pratique"]];
  const types = [["likert6","Likert (6)"],["num","Échelle 1-10"],["short","Texte court"],["long","Texte long"]];
  const priorities = [["high","Haute"],["medium","Moyenne"],["low","Basse"]];

  root.append(
    el("div",{class:"grid"},
      [
        el("h2",{} , (isEdit?"Modifier":"Ajouter")+" une consigne"),
        el("div",{class:"grid cols-2"}, [
          el("div",{class:"field"},[ el("label",{},"Texte"), el("textarea",{id:"c-text",placeholder:"Votre consigne (obligatoire)"},[]) ]),
          el("div",{class:"field"},[ el("label",{},"Catégorie"), el("input",{id:"c-cat",placeholder:"Ex. Santé, Concentration…"}) ]),
          el("div",{class:"field"},[
            el("label",{},"Mode"),
            (()=>{ const s=el("select",{id:"c-mode"}); modes.forEach(([v,l])=>s.append(el("option",{value:v},l))); return s; })()
          ]),
          el("div",{class:"field"},[
            el("label",{},"Type de réponse"),
            (()=>{ const s=el("select",{id:"c-type"}); types.forEach(([v,l])=>s.append(el("option",{value:v},l))); return s; })()
          ]),
          el("div",{class:"field"},[
            el("label",{},"Priorité"),
            (()=>{ const s=el("select",{id:"c-prio"}); priorities.forEach(([v,l])=>s.append(el("option",{value:v},l))); return s; })()
          ]),
          el("div",{class:"field"},[
            el("label",{},"Répétition espacée"),
            (()=>{ const s=el("select",{id:"c-sr"}); s.append(el("option",{value:"1"},"Activée")); s.append(el("option",{value:"0"},"Désactivée")); return s; })()
          ]),
          el("div",{class:"field"},[
            el("label",{},"Fréquence (journalier)"),
            (()=>{ const w=el("div",{class:"flex"});
              ["lun","mar","mer","jeu","ven","sam","dim"].forEach(d=> w.append(el("label",{class:"pill"},
                [el("input",{type:"checkbox","data-day":d,style:"margin-right:6px"}), d.toUpperCase()])));
              return w;
            })()
          ])
        ]),
        el("div",{class:"flex"},[
          el("button",{class:"btn primary", onclick: save}, "Enregistrer"),
          el("button",{class:"btn", onclick: ()=>location.hash="#/daily"},"Annuler")
        ])
      ])
  );

  // set defaults if any
  $("#c-text").value = defaults.text || "";
  $("#c-cat").value = defaults.category || "";
  $("#c-mode").value = defaults.mode || "daily";
  $("#c-type").value = defaults.type || "likert6";
  $("#c-prio").value = defaults.priority || "medium";
  $("#c-sr").value = defaults.spacedRepetitionEnabled ? "1":"0";
  if (defaults.days?.length){
    defaults.days.forEach(d => {
      const cb = document.querySelector(`input[data-day="${d}"]`);
      if (cb) cb.checked = true;
    });
  }

  async function save(){
    const days = Array.from(document.querySelectorAll('input[data-day]:checked')).map(i=>i.getAttribute("data-day"));
    const payload = {
      ownerUid: ctx.user.uid,
      text: $("#c-text").value.trim(),
      category: $("#c-cat").value.trim() || "Général",
      mode: $("#c-mode").value,
      type: $("#c-type").value,
      priority: $("#c-prio").value,
      spacedRepetitionEnabled: $("#c-sr").value==="1",
      days,
      active: true,
      createdAt: Schema.now(),
    };
    if (!payload.text) { alert("Le texte est obligatoire"); return; }
    await addDoc(col(ctx.db, ctx.user.uid, "consignes"), payload);
    location.hash = `#/u/${ctx.user.uid}/${payload.mode}`;
  }
}

// ---------- Widgets de réponse ----------
function inputFor(consigne){
  // retourne { node, getValue() }
  if (consigne.type === "likert6"){
    const wrap = el("div",{class:"flex"});
    const options = [["no_answer","NR"],["no","Non"],["rather_no","Plutôt non"],["medium","Moyen"],["rather_yes","Plutôt oui"],["yes","Oui"]];
    let current = "no_answer";
    options.forEach(([v,l])=>{
      const b = el("button",{class:"btn small",onclick: ()=>{ current=v; Array.from(wrap.children).forEach(ch=>ch.classList.remove("primary")); b.classList.add("primary"); }}, l);
      wrap.append(b);
    });
    return { node: wrap, getValue:()=>current };
  }
  if (consigne.type === "num"){
    const r = el("input",{type:"range",min:"1",max:"10",value:"5",style:"width:220px"});
    const out = el("span",{class:"pill"},"5");
    r.oninput = ()=> out.textContent = r.value;
    return { node: el("div",{class:"flex"},[r,out]), getValue:()=>Number(r.value) };
  }
  if (consigne.type === "short"){
    const i = el("input",{maxlength:"200",placeholder:"Votre réponse (≤200c)"});
    return { node: i, getValue:()=>i.value.trim() };
  }
  const t = el("textarea",{placeholder:"Votre réponse"});
  return { node: t, getValue:()=>t.value.trim() };
}

// ---------- JOURNALIER ----------
export async function renderDaily(ctx, root, opts={}){
  const dayParam = (opts.day || currentDayKey()); // 'lun'...'dim'
  root.innerHTML = "";

  // header
  const days = ["lun","mar","mer","jeu","ven","sam","dim"];
  const dayNav = el("div",{class:"flex"});
  days.forEach(d=>{
    const b = el("button",{class:`btn small ${d===dayParam?"primary":""}`, onclick:()=> {
      location.hash = `#/u/${ctx.user.uid}/daily?day=${d}`;
    }}, d.toUpperCase());
    dayNav.append(b);
  });

  // CTA ajouter une consigne
  const addBtn = el("button",{class:"btn small right", onclick:()=>openConsigneForm(ctx,{mode:"daily"})},"+ Ajouter une consigne");

  root.append(el("div",{class:"section-title"},[ el("h2",{},"Journalier"), el("div",{class:"right"},[addBtn]) ]));
  root.append(dayNav);

  // fetch consignes visibles pour ce jour
  let consignes = await Schema.listConsignesByMode(ctx.db, ctx.user.uid, "daily");
  consignes = await filterByDayAndSR(ctx, consignes, dayParam, "daily");

  if (!consignes.length){
    root.append(el("div",{class:"card muted"},"Aucune consigne pour ce jour."));
    return;
  }

  // form unique
  const form = el("form",{id:"daily-form", onsubmit: onSubmit});
  const controls = [];
  consignes.forEach(c=>{
    const ctrl = inputFor(c);
    controls.push({ consigne:c, getValue: ctrl.getValue });
    form.append(el("div",{class:"card"},[
      el("div",{class:"flex"}, el("div",{style:"font-weight:600"}, c.text), el("span",{class:`badge ${c.priority}`}, c.priority)),
      el("div",{class:"muted"}, c.category || "—"),
      ctrl.node
    ]));
  });
  form.append(el("div",{class:"flex"}, el("button",{class:"btn primary", type:"submit"},"Valider toutes les réponses")));
  root.append(form);

  async function onSubmit(e){
    e.preventDefault();
    const answers = controls.map(x => ({ consigne:x.consigne, value:x.getValue() }));
    await Schema.saveResponses(ctx.db, ctx.user.uid, "daily", answers);
    // recharger (SR peut masquer)
    location.hash = `#/u/${ctx.user.uid}/daily?day=${dayParam}`;
  }
}

// ---------- PRATIQUE ----------
export async function renderPractice(ctx, root){
  root.innerHTML = "";
  root.append(el("div",{class:"section-title"},[
    el("h2",{},"Pratique délibérée"),
    el("button",{class:"btn small right", onclick:()=>openConsigneForm(ctx,{mode:"practice"})},"+ Ajouter une consigne")
  ]));

  let consignes = await Schema.listConsignesByMode(ctx.db, ctx.user.uid, "practice");
  consignes = await filterBySRForPractice(ctx, consignes);

  if (!consignes.length){
    root.append(el("div",{class:"card muted"},"Aucune consigne de pratique disponible pour cette itération."));
    return;
  }

  // form unique pour une itération
  const sessionId = `s-${Date.now()}`;
  const form = el("form",{id:"practice-form", onsubmit: onSubmit});
  const controls = [];
  consignes.forEach(c=>{
    const ctrl = inputFor(c);
    controls.push({ consigne:c, getValue: ctrl.getValue, node: ctrl.node });
    form.append(el("div",{class:"card"},[
      el("div",{class:"flex"}, el("div",{style:"font-weight:600"}, c.text), el("span",{class:`badge ${c.priority}`}, c.priority)),
      el("div",{class:"muted"}, c.category || "—"),
      ctrl.node,
      // mini-historique (dernieres 3)
      el("div",{class:"muted",style:"font-size:12px;margin-top:6px"}, "Historique (3 derniers) — "),
      el("div",{id:`hist-${c.id}`,class:"muted",style:"font-size:12px"},"Chargement…")
    ]));
    loadMiniHistory(ctx, c.id);
  });
  form.append(el("div",{class:"flex"}, el("button",{class:"btn primary", type:"submit"},"Valider cette itération")));
  root.append(form);

  async function onSubmit(e){
    e.preventDefault();
    const answers = controls.map(x => ({ consigne:x.consigne, value:x.getValue(), sessionId }));
    await Schema.saveResponses(ctx.db, ctx.user.uid, "practice", answers);
    // nouvelle itération: on vide les contrôles & recharge SR
    renderPractice(ctx, root);
  }
}

// ---------- HISTORIQUE (simple) ----------
export async function renderHistory(ctx, root){
  root.innerHTML = "";
  root.append(el("h2",{},"Historique"));
  const qy = query(col(ctx.db, ctx.user.uid, "responses"), orderBy("createdAt","desc"));
  const ss = await getDocs(qy);
  const list = el("div",{class:"list"});
  ss.forEach(d=>{
    const r = d.data();
    list.append(el("div",{class:"card"},[
      el("div",{style:"font-weight:600"}, `${r.category} • ${r.mode}`),
      el("div",{}, `${r.createdAt} — ${r.consigneId} → ${typeof r.value==="object"?JSON.stringify(r.value):r.value}`)
    ]));
  });
  root.append(list);
}

// ---------- helpers ----------
async function filterByDayAndSR(ctx, consignes, dayKey, mode){
  // dayKey dans c.days OU c.days vide => visible
  const today = new Date();
  const nowIso = today.toISOString();

  const out = [];
  for (const c of consignes){
    if (c.days?.length && !c.days.includes(dayKey)) continue;
    const sr = await Schema.readSRState(ctx.db, ctx.user.uid, c.id, "consigne");
    if (mode==="daily" && sr?.hideUntil && sr.hideUntil > nowIso) continue;
    out.push(c);
  }
  return out;
}
async function filterBySRForPractice(ctx, consignes){
  const out = [];
  for (const c of consignes){
    const sr = await Schema.readSRState(ctx.db, ctx.user.uid, c.id, "consigne");
    if (sr?.nextAllowedIndex && sr.nextAllowedIndex > 0){
      // on décrémente à l’affichage: quand l’utilisateur voit la session, on considère l’étape franchie
      await Schema.upsertSRState(ctx.db, ctx.user.uid, c.id, "consigne", { nextAllowedIndex: sr.nextAllowedIndex - 1, streak: sr.streak||0 });
      continue;
    }
    out.push(c);
  }
  return out;
}
async function loadMiniHistory(ctx, consigneId){
  const qy = query(col(ctx.db, ctx.user.uid, "responses"),
    where("consigneId","==",consigneId), orderBy("createdAt","desc"));
  const ss = await getDocs(qy);
  const top3 = ss.docs.slice(0,3).map(d => d.data());
  const div = document.getElementById(`hist-${consigneId}`);
  if (!div) return;
  if (!top3.length){ div.textContent = "—"; return; }
  div.textContent = top3.map(r => `${r.createdAt.slice(0,16).replace("T"," ")}: ${typeof r.value==="object"?JSON.stringify(r.value):r.value}`).join(" · ");
}
function currentDayKey(){
  // 1(lun)..7(dim) -> ['dim','lun','mar','mer','jeu','ven','sam'] si localisation FR
  const map = ["dim","lun","mar","mer","jeu","ven","sam"];
  const d = (new Date()).getDay(); // 0=dim
  return map[d];
}
