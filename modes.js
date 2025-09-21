// modes.js — Journalier / Pratique / Historique
import {
  collection, addDoc, getDocs, doc, getDoc, setDoc, updateDoc,
  query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as Schema from "./schema.js";

const { col, docIn, now, readSRState, upsertSRState, nextCooldownAfterAnswer } = Schema;

function $(s){ return document.querySelector(s); }
function el(tag, attrs={}, children=[]){
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v]) => (k==="class")? n.className=v : (k==="onclick")? n.onclick=v : n.setAttribute(k,v));
  (Array.isArray(children)?children:[children]).forEach(c => n.append(c?.nodeType?c:document.createTextNode(c)));
  return n;
}

/* ---------- helpers UI ---------- */
function modal(content){
  const wrap = el("div",{class:"modal-backdrop"});
  const panel = el("div",{class:"modal"});
  const close = el("button",{class:"btn small",style:"float:right", onclick:()=>wrap.remove()},"Fermer");
  panel.append(close, content);
  wrap.append(panel);
  document.body.append(wrap);
  return { close:()=>wrap.remove() };
}

function dayChips(active){
  const days = [
    ["mon","LUN"],["tue","MAR"],["wed","MER"],["thu","JEU"],["fri","VEN"],["sat","SAM"],["sun","DIM"]
  ];
  const row = el("div",{class:"row", style:"grid-auto-flow:column;overflow:auto;gap:8px"});
  days.forEach(([v,l])=>{
    const b = el("button",{class:"chip"+(v===active?" active":""), "data-day":v}, l);
    row.append(b);
  });
  return row;
}

function inputForConsigne(c){
  const wrap = el("div",{class:"card", "data-id":c.id});
  const head = el("div",{class:"section-title"},
    [el("h3",{style:"margin:0"}, c.text||"(Sans titre)"),
     el("button",{class:"btn small ghost", onclick:(e)=>openHistory(c)}, "Historique")]
  );
  wrap.append(head);

  let field;
  switch (c.type){
    case "short":
      field = el("input",{class:"input", placeholder:"Réponse", maxlength:"200", name:`v-${c.id}`}); break;
    case "long":
      field = el("textarea",{placeholder:"Réponse", name:`v-${c.id}`}); break;
    case "likert6":{
      const g = el("div",{class:"row", style:"grid-auto-flow:column;gap:18px;align-items:center"});
      const opts = [
        ["na","Pas de rép."],["no","Non"],["rn","Plutôt non"],["med","Moyen"],["ry","Plutôt oui"],["yes","Oui"]
      ];
      opts.forEach(([v,l])=>{
        const id = `v-${c.id}-${v}`;
        g.append(
          el("label",{}, [
            el("input",{type:"radio", name:`v-${c.id}`, value:v, id}),
            " ", l
          ])
        );
      });
      field = g; break;
    }
    default: // "num" (1..10)
      const range = el("input",{type:"range", min:"1", max:"10", value:"5", name:`v-${c.id}`, style:"width:100%"});
      const out = el("div",{class:"pill"}, "5");
      range.oninput = ()=> out.textContent = range.value;
      field = el("div",{}, [range,out]);
  }
  wrap.append(field);
  return wrap;
}

function likertToNum(v){
  return ({yes:10, ry:7, med:5, rn:3, no:0, na:0})[v] ?? (Number(v)||0);
}

/* ---------- Data ---------- */
async function fetchConsignes(ctx, mode, dayCode=null){
  const qy = query(col(ctx.db, ctx.user.uid, "consignes"), where("mode","==",mode), where("active","==",true), orderBy("createdAt","asc"));
  const ss = await getDocs(qy);
  const items = [];
  ss.forEach(d=>{
    const c = { id:d.id, ...d.data() };
    if (mode==="daily"){
      // Filtrage par jour si la consigne a des jours spécifiques
      if (Array.isArray(c.days) && c.days.length && !c.days.includes(dayCode)) return;
    }
    items.push(c);
  });
  return items;
}

async function saveAnswers(ctx, mode, answers){
  // answers: [{id, value}]
  for (const a of answers){
    // 1) réponse
    await addDoc(col(ctx.db, ctx.user.uid, "responses"), {
      ownerUid: ctx.user.uid, consigneId: a.id, mode, value: a.value, createdAt: now()
    });

    // 2) SR (cooldown) — simple mise à jour
    const prev = await readSRState(ctx.db, ctx.user.uid, a.id, mode);
    const upd = nextCooldownAfterAnswer({ mode, type: a.type }, prev, a.value);
    await upsertSRState(ctx.db, ctx.user.uid, a.id, mode, upd);
  }
}

/* ---------- Modales ---------- */
async function openHistory(consigne){
  return (await import(""))
    .catch(()=>{}), // no-op to keep module syntax happy on GH pages
  // UI
  (function(){
    const box = el("div");
    box.append(el("h3",{},"Historique — "+(consigne.text||consigne.id)));
    const lst = el("div",{class:"row"});
    box.append(lst);

    const canvas = el("canvas",{id:"h-chart",style:"margin-top:6px"});
    box.append(canvas);

    const m = modal(box);

    (async ()=>{
      const ctx = window.__ctx;
      const qy = query(col(ctx.db, ctx.user.uid, "responses"),
        where("consigneId","==",consigne.id), orderBy("createdAt","desc"));
      const ss = await getDocs(qy);

      // Liste (récent -> ancien)
      const xs=[], ys=[];
      ss.forEach(d=>{
        const r = d.data();
        const line = el("div",{class:"row",style:"grid-template-columns:120px 1fr"},
          [el("div",{class:"muted"}, r.createdAt.replace("T"," ").slice(0,16)),
           el("div",{}, [
              el("span",{class:"dot "+dotClass(consigne.type,r.value)},""),
              document.createTextNode(formatVal(consigne.type,r.value))
            ])
          ]);
        lst.append(line);
        // chart only for likert/num
        if (consigne.type==="likert6" || consigne.type==="num"){
          xs.push(r.createdAt.slice(0,16));
          ys.push(likertToNum(r.value));
        }
      });

      if (window.Chart && (consigne.type==="likert6" || consigne.type==="num")){
        new window.Chart(canvas.getContext("2d"), {
          type: "line",
          data: { labels: xs.reverse(), datasets: [{ label:"Évolution", data: ys.reverse() }] },
          options: { scales:{ y:{ beginAtZero:true, suggestedMax:10 } } }
        });
      }
    })();

    function dotClass(t,v){
      if (t==="num") return "v-ry";
      return ({yes:"v-yes",ry:"v-ry",med:"v-med",rn:"v-rn",no:"v-no",na:"v-na"})[v] || "v-na";
    }
    function formatVal(t,v){
      if (t==="num") return String(v);
      return ({yes:"Oui",ry:"Plutôt oui",med:"Moyen",rn:"Plutôt non",no:"Non",na:"—"})[v] || v;
    }
  })();
}

export function openConsigneForm(ctx, modeForced=null){
  const box = el("div");
  box.append(el("h3",{},"Nouvelle consigne"));
  const row = el("div",{class:"row cols-2"});
  const f = {
    text: el("input",{class:"input", placeholder:"Texte / question (obligatoire)"}),
    category: el("input",{class:"input", placeholder:"Catégorie (ex. Santé, Technique…)"}),
    type: el("select",{class:"input"},
      [el("option",{value:"short"},"Texte court"),
       el("option",{value:"long"},"Texte long"),
       el("option",{value:"likert6"},"Likert (6)"),
       el("option",{value:"num"},"Échelle (1–10)")]),
    priority: el("select",{class:"input"},
      [el("option",{value:"high"},"Haute"),
       el("option",{value:"medium",selected:true},"Moyenne"),
       el("option",{value:"low"},"Basse")]),
    mode: el("select",{class:"input"},
      [el("option",{value:"daily"},"Journalier"),
       el("option",{value:"practice"},"Pratique délibérée")]),
    sr: el("select",{class:"input"},
      [el("option",{value:"1"},"Répétition espacée activée"),
       el("option",{value:"0"},"Répétition espacée désactivée")]),
  };
  if (modeForced) f.mode.value = modeForced;

  const daysWrap = el("div");
  const days = [["mon","Lun"],["tue","Mar"],["wed","Mer"],["thu","Jeu"],["fri","Ven"],["sat","Sam"],["sun","Dim"]];
  const daysBox = el("div",{class:"row", style:"grid-auto-flow:column;gap:8px;overflow:auto"});
  const dayInputs = days.map(([v,l])=>{
    const i = el("input",{type:"checkbox","data-day":v});
    const label = el("label",{}, [i," ",l]);
    const holder = el("div",{class:"chip"});
    holder.append(label);
    return i;
  });
  daysBox.append(...days.map((d,i)=>{ const w=el("div",{class:""}); w.append(dayInputs[i].parentNode); return w; }));

  function refreshDaysVisibility(){
    daysWrap.innerHTML="";
    if ((f.mode.value||"daily")==="daily"){
      daysWrap.append(el("label",{class:"muted"},"Jours actifs"), daysBox);
    }
  }
  f.mode.onchange = refreshDaysVisibility;
  refreshDaysVisibility();

  row.append(
    field("Texte de la consigne", f.text),
    field("Catégorie", f.category),
    field("Type de réponse", f.type),
    field("Priorité", f.priority),
    field("Mode", f.mode),
    field("Répétition espacée", f.sr),
    el("div",{}, [daysWrap])
  );
  box.append(row);

  const actions = el("div",{class:"section-title"},
    [el("div",{},""), el("div",{},[
      el("button",{class:"btn", onclick:()=>m.close()},"Annuler"),
      el("button",{class:"btn primary", onclick:save},"Enregistrer")
    ])]);
  box.append(actions);

  const m = modal(box);

  async function save(){
    const payload = {
      ownerUid: ctx.user.uid,
      text: f.text.value.trim(),
      category: f.category.value.trim() || "Général",
      type: f.type.value,
      priority: f.priority.value,
      mode: f.mode.value,
      spacedRepetitionEnabled: f.sr.value==="1",
      days: (f.mode.value==="daily") ? dayInputs.filter(i=>i.checked).map(i=>i.getAttribute("data-day")) : [],
      active: true,
      createdAt: now()
    };
    if (!payload.text) { alert("Texte obligatoire"); return; }
    await addDoc(col(ctx.db, ctx.user.uid, "consignes"), payload);
    m.close();
    // re-render current screen
    const root = $("#view-root");
    if (payload.mode==="practice") renderPractice(ctx, root);
    else renderDaily(ctx, root, {});
  }

  function field(label, node){
    const wrap = el("div",{class:"row"});
    wrap.append(el("label",{class:"muted"},label), node);
    return wrap;
  }
}

/* ---------- Screens ---------- */
export async function renderDaily(ctx, root, opts={}){
  window.__ctx = ctx;
  const dayParam = (opts.day || new Intl.DateTimeFormat('en-GB',{weekday:'short'}).format(new Date()).slice(0,3).toLowerCase());
  const map = {mon:"mon", tue:"tue", wed:"wed", thu:"thu", fri:"fri", sat:"sat", sun:"sun"};
  const activeDay = map[dayParam] || "mon";

  root.innerHTML = "";
  const container = el("div",{class:"row"});
  const chips = dayChips(activeDay);
  chips.addEventListener("click",(e)=>{
    const b = e.target.closest(".chip"); if(!b) return;
    const d = b.getAttribute("data-day");
    location.hash = `#/u/${ctx.user.uid}/daily?day=${d}`;
  });
  container.append(el("div",{class:"card"}, chips));

  // Liste des consignes
  const consignes = await fetchConsignes(ctx, "daily", activeDay);

  const form = el("form",{class:"row"});
  consignes.forEach(c => form.append(inputForConsigne(c)));

  if (!consignes.length){
    form.append(el("div",{class:"card muted"},"Aucune consigne ce jour."));
  }

  // actions
  const actions = el("div",{class:"card section-title"},
    [el("div",{},""),
     el("div",{},[
       el("button",{type:"button", class:"btn", onclick:()=>openConsigneForm(ctx,"daily")},"+ Nouvelle consigne"),
       el("button",{type:"submit", class:"btn primary"},"Enregistrer")
     ])]);
  form.append(actions);

  form.onsubmit = async (e)=>{
    e.preventDefault();
    const answers = consignes.map(c=>{
      const name = `v-${c.id}`;
      let val = null;
      if (c.type==="short"||c.type==="long") val = form.querySelector(`[name="${name}"]`)?.value.trim() || "";
      else if (c.type==="likert6") val = form.querySelector(`input[name="${name}"]:checked`)?.value || "na";
      else val = form.querySelector(`[name="${name}"]`)?.value || 5;
      return { id:c.id, type:c.type, value:val };
    });
    await saveAnswers(ctx, "daily", answers);
    alert("Enregistré !");
  };

  container.append(form);
  root.append(container);
}

export async function renderPractice(ctx, root){
  window.__ctx = ctx;
  root.innerHTML = "";
  const container = el("div",{class:"row"});

  const consignes = await fetchConsignes(ctx, "practice");
  const form = el("form",{class:"row"});

  consignes.forEach(c => form.append(inputForConsigne(c)));
  if (!consignes.length){
    form.append(el("div",{class:"card muted"},"Aucune consigne. Ajoute-en une pour commencer."));
  }

  const actions = el("div",{class:"card section-title"},
    [el("div",{},""),
     el("div",{},[
       el("button",{type:"button", class:"btn", onclick:()=>openConsigneForm(ctx,"practice")},"+ Nouvelle consigne"),
       el("button",{type:"submit", class:"btn success"},"Enregistrer")
     ])]);
  form.append(actions);

  form.onsubmit = async (e)=>{
    e.preventDefault();
    const answers = consignes.map(c=>{
      const name = `v-${c.id}`;
      let val = null;
      if (c.type==="short"||c.type==="long") val = form.querySelector(`[name="${name}"]`)?.value.trim() || "";
      else if (c.type==="likert6") val = form.querySelector(`input[name="${name}"]:checked`)?.value || "na";
      else val = form.querySelector(`[name="${name}"]`)?.value || 5;
      return { id:c.id, type:c.type, value:val };
    });
    await saveAnswers(ctx, "practice", answers);
    alert("Session enregistrée !");
  };

  container.append(form);
  root.append(container);
}

export function renderHistory(){ /* non utilisé ici — on ouvre via openHistory() par consigne */ }
