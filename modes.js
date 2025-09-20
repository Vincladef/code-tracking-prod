// modes.js — Consignes + Vues Journalier / Pratique / Dashboard / Historique
import {
  addDoc, setDoc, updateDoc, deleteDoc, doc, getDoc, getDocs,
  collection, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as Schema from "./schema.js";
import { col, docIn, now } from "./schema.js";

// ---------- petites aides DOM ----------
function $(sel){ return document.querySelector(sel); }
function el(tag, attrs={}, children=[]){
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n[k] = v;
    else n.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children])
    .forEach(c => n.append(c?.nodeType ? c : document.createTextNode(c ?? "")));
  return n;
}

// ---------- constantes ----------
const LIKERT6 = [
  ["no_answer", "NR"], ["no","Non"], ["rather_no","Plutôt non"],
  ["medium","Moyen"], ["rather_yes","Plutôt oui"], ["yes","Oui"]
];

const PRIORITIES = ["high","medium","low"];
const TYPE_LABEL = { short:"Texte court", long:"Texte long", likert6:"Likert (6)", num:"Échelle 1-10" };
const MODE_LABEL = { daily:"Journalier", practice:"Pratique délibérée" };

// ---------- outils / logique ----------
function todayDow(){ return new Date().getDay(); } // 0=dimanche ... 6=samedi
function isDueByFrequency(c){
  // c.frequency = { kind:"everyday" } ou { kind:"days", days:[0..6] }
  if (!c.frequency || c.frequency.kind === "everyday") return true;
  if (c.frequency.kind === "days" && Array.isArray(c.frequency.days)){
    return c.frequency.days.includes(todayDow());
  }
  return true;
}

function isHiddenBySR(srState){
  if (!srState) return false;
  const u = srState.hideUntil;
  if (!u) return false;
  return new Date(u) > new Date();
}

function canUseSR(){
  return typeof Schema.nextCooldownAfterAnswer === "function" &&
         typeof Schema.readSRState === "function" &&
         typeof Schema.upsertSRState === "function";
}

function toLikertDefaultValueByType(type, value){
  if (type === "likert6") return value || "medium";
  if (type === "num")     return Number(value ?? 5);
  if (type === "short")   return String(value ?? "");
  if (type === "long")    return String(value ?? "");
  return value;
}

// ---------- CRUD Consignes ----------
async function fetchConsignes(ctx, mode){
  const qy = query(col(ctx.db, ctx.user.uid, "consignes"),
    where("active","==", true),
    where("mode","==", mode),
    orderBy("priority","asc"),
    orderBy("createdAt","desc")
  );
  const ss = await getDocs(qy);
  return ss.docs.map(d => ({ id:d.id, ...d.data() }));
}

async function saveConsigne(ctx, existingId, payload){
  if (existingId){
    await updateDoc(docIn(ctx.db, ctx.user.uid, "consignes", existingId), payload);
    return existingId;
  }
  const ref = await addDoc(col(ctx.db, ctx.user.uid, "consignes"), payload);
  return ref.id;
}

async function softDeleteConsigne(ctx, id){
  await updateDoc(docIn(ctx.db, ctx.user.uid, "consignes", id), { active:false, deletedAt: now() });
}

// ---------- Enregistrement réponses ----------
async function saveResponse(ctx, consigne, value){
  // 1) crée la réponse
  const payload = {
    ownerUid: ctx.user.uid,
    consigneId: consigne.id,
    value,
    type: consigne.type,
    mode: consigne.mode,
    createdAt: now(),
  };
  await addDoc(col(ctx.db, ctx.user.uid, "responses"), payload);

  // 2) met à jour l'état SR si dispo
  if (canUseSR() && consigne.srEnabled){
    const prev = await Schema.readSRState(ctx.db, ctx.user.uid, consigne.id, consigne.mode);
    // valeur "positive" pour l'algorithme SR: on interprète
    const pos = consigne.type === "likert6" ? value
              : consigne.type === "num"     ? (Number(value) >= 6 ? "yes" : "medium")
              : "yes";
    const next = Schema.nextCooldownAfterAnswer({ ...consigne }, prev, pos);
    await Schema.upsertSRState(ctx.db, ctx.user.uid, consigne.id, consigne.mode, next);
  }
}

// ---------- UI : Formulaire Consigne ----------
export function openConsigneForm(ctx, consigne=null){
  const root = $("#view-root");
  const isEdit = !!consigne;
  const initial = consigne || {
    text:"", category:"Général", type:"likert6", priority:"medium", mode:"daily",
    frequency:{ kind:"everyday" }, srEnabled:true, active:true
  };

  root.innerHTML = "";
  root.append(el("h2",{}, `${isEdit?"Modifier":"Créer"} une consigne`));

  const form = el("div",{class:"grid cols-2", style:"gap:12px"});
  form.append(
    field("Texte de la consigne", el("input",{id:"c-text", value:initial.text, placeholder:"Ex. Boire 2 verres d’eau"})),
    field("Catégorie", el("input",{id:"c-cat", value:initial.category, placeholder:"Santé, Musique, ..."})),
    field("Type de réponse", select("c-type", initial.type, [
      ["likert6", TYPE_LABEL.likert6], ["num", TYPE_LABEL.num],
      ["short", TYPE_LABEL.short], ["long", TYPE_LABEL.long]
    ])),
    field("Priorité", select("c-pri", initial.priority, [
      ["high","Haute"], ["medium","Moyenne"], ["low","Basse"]
    ])),
    field("Mode d’utilisation", select("c-mode", initial.mode, [
      ["daily", MODE_LABEL.daily], ["practice", MODE_LABEL.practice]
    ])),
    // fréquence (journalier)
    el("div",{class:"field"},[
      el("label",{},"Fréquence (mode journalier)"),
      el("div",{}, [
        el("label", {style:"display:flex;gap:8px;align-items:center"}, [
          el("input",{type:"radio",name:"c-freq", value:"everyday", checked: initial.frequency?.kind!=="days"}),
          "Quotidienne"
        ]),
        el("label", {style:"display:flex;gap:8px;align-items:center;margin-top:6px"}, [
          el("input",{type:"radio",name:"c-freq", value:"days", checked: initial.frequency?.kind==="days"}),
          "Jours spécifiques",
        ]),
        el("div",{id:"c-days", style:`margin-top:6px; display:${initial.frequency?.kind==="days"?"block":"none"}`},
          dayCheckboxes(initial.frequency?.days || []))
      ])
    ]),
    field("Répétition espacée", select("c-sr", initial.srEnabled?"1":"0", [["1","Activée"],["0","Désactivée"]])),
  );
  root.append(form);

  const bar = el("div",{class:"flex", style:"gap:8px;margin-top:10px"});
  const saveBtn = el("button",{class:"btn primary"},"Enregistrer");
  const cancelBtn = el("button",{class:"btn"},"Annuler");
  if (isEdit){
    const delBtn = el("button",{class:"btn", style:"margin-left:auto;color:#fca5a5;border-color:#f87171"},"Supprimer");
    delBtn.onclick = async ()=>{
      if (confirm("Supprimer la consigne ? (désactivation)")){
        await softDeleteConsigne(ctx, consigne.id);
        location.hash = "#/dashboard";
      }
    };
    bar.append(delBtn);
  }
  bar.append(saveBtn, cancelBtn);
  root.append(bar);

  // dynamique affichage jours
  root.addEventListener("change",(e)=>{
    if (e.target?.name === "c-freq"){
      $("#c-days").style.display = (e.target.value === "days") ? "block" : "none";
    }
  });

  cancelBtn.onclick = ()=> location.hash = "#/dashboard";
  saveBtn.onclick = async ()=>{
    const freqRadio = [...root.querySelectorAll("input[name='c-freq']")].find(r=>r.checked)?.value || "everyday";
    const days = [...root.querySelectorAll("input[name='dow']:checked")].map(i=>Number(i.value));
    const payload = {
      ownerUid: ctx.user.uid,
      active: true,
      text: $("#c-text").value.trim(),
      category: $("#c-cat").value.trim() || "Général",
      type: $("#c-type").value,
      priority: $("#c-pri").value,
      mode: $("#c-mode").value,
      frequency: (freqRadio === "days") ? { kind:"days", days } : { kind:"everyday" },
      srEnabled: $("#c-sr").value === "1",
      createdAt: consigne?.createdAt || now()
    };
    if (!payload.text){ alert("Le texte de la consigne est obligatoire."); return; }
    await saveConsigne(ctx, consigne?.id, payload);
    location.hash = "#/dashboard";
  };
}

function field(labelNode, control){
  return el("div",{class:"field"}, [ el("label",{},labelNode), control ]);
}
function select(id, value, options){
  const s = el("select",{id});
  options.forEach(([v,l])=> s.append(el("option",{value:v, selected:String(v)===String(value)}, l)));
  return s;
}
function dayCheckboxes(selected){
  const labels = ["D","L","M","M","J","V","S"];
  const wrap = el("div",{class:"flex", style:"gap:6px;flex-wrap:wrap"});
  for (let i=0;i<7;i++){
    const chk = el("label",{class:"pill", style:"display:flex;gap:6px;align-items:center;cursor:pointer"},[
      el("input",{type:"checkbox", name:"dow", value:String(i), checked:selected.includes(i)}),
      labels[i]
    ]);
    wrap.append(chk);
  }
  return wrap;
}

// ---------- rendu des cartes de consignes + contrôles de réponse ----------
function consigneCard(ctx, c, onAnswered){
  const card = el("div",{class:"card"});
  const head = el("div",{class:"flex"},[
    el("div",{style:"font-weight:600"}, c.text),
    el("span",{class:`badge ${c.priority}`}, c.priority),
    el("span",{class:"pill", style:"margin-left:auto"}, MODE_LABEL[c.mode] || c.mode)
  ]);
  card.append(head);
  card.append(el("div",{class:"muted"}, `${c.category}`));

  // contrôles par type
  const controls = el("div",{class:"flex", style:"gap:6px;margin-top:6px"});
  if (c.type === "likert6"){
    LIKERT6.forEach(([v,l])=>{
      const b = el("button",{class:"btn small"}, l);
      b.onclick = async ()=>{ await saveResponse(ctx, c, v); onAnswered?.(); };
      controls.append(b);
    });
  } else if (c.type === "num"){
    const inp = el("input",{type:"range", min:"1", max:"10", value:"5", style:"width:200px"});
    const out = el("span",{class:"pill"},"5");
    const ok = el("button",{class:"btn small"},"Valider");
    inp.oninput = ()=> out.textContent = inp.value;
    ok.onclick = async ()=>{ await saveResponse(ctx, c, Number(inp.value)); onAnswered?.(); };
    controls.append(inp,out,ok);
  } else if (c.type === "short"){
    const inp = el("input",{placeholder:"Réponse ≤ 200 c.", maxLength:"200"});
    const ok = el("button",{class:"btn small"},"Valider");
    ok.onclick = async ()=>{ await saveResponse(ctx, c, inp.value.trim()); onAnswered?.(); };
    controls.append(inp, ok);
  } else {
    const inp = el("textarea",{placeholder:"Votre réponse"});
    const ok = el("button",{class:"btn small"},"Valider");
    ok.onclick = async ()=>{ await saveResponse(ctx, c, inp.value.trim()); onAnswered?.(); };
    controls.append(inp, ok);
  }
  card.append(controls);

  // actions secondaires
  const actions = el("div",{class:"flex", style:"gap:6px;margin-top:6px"});
  actions.append(
    el("button",{class:"btn small", onclick:()=>openConsigneForm(ctx, c)},"Modifier"),
    el("button",{class:"btn small", onclick:async()=>{ if(confirm("Supprimer ?")){ await softDeleteConsigne(ctx, c.id); location.reload(); } }},"Supprimer")
  );
  card.append(actions);

  return card;
}

// ---------- Vues ----------
export async function renderDashboard(ctx, root){
  root.innerHTML = "";
  root.append(el("h2",{},"Tableau de bord"));

  // Comptages rapides
  const [daily, practice] = await Promise.all([
    fetchConsignes(ctx, "daily"), fetchConsignes(ctx, "practice")
  ]);
  const counts = el("div",{class:"card"},[
    el("div",{}, `Consignes (journalier): ${daily.length}`),
    el("div",{}, `Consignes (pratique): ${practice.length}`),
    el("div",{style:"margin-top:8px;font-weight:600"}, "Raccourcis"),
    el("div",{}, [
      el("button",{class:"btn small", onclick:()=>openConsigneForm(ctx)}, "+ Ajouter une consigne"),
      el("button",{class:"btn small", style:"margin-left:6px", onclick:()=>location.hash = "#/daily"}, "Par catégorie (journalier)"),
      el("button",{class:"btn small", style:"margin-left:6px", onclick:()=>location.hash = "#/practice"}, "Par catégorie (pratique)"),
      el("button",{class:"btn small", style:"margin-left:6px", onclick:()=>location.hash = "#/history"}, "Historique")
    ])
  ]);
  root.append(counts);
}

export async function renderDaily(ctx, root){
  root.innerHTML = "";
  root.append(el("h2",{},"Mode Journalier"));
  const list = el("div",{class:"grid"});
  root.append(el("div",{class:"flex", style:"gap:8px;margin-bottom:8px"},[
    el("button",{class:"btn small", onclick:()=>openConsigneForm(ctx)}, "+ Ajouter une consigne")
  ]));
  root.append(list);

  const all = await fetchConsignes(ctx, "daily");

  // filtre: fréquence + SR
  const ready = [];
  for (const c of all){
    if (!isDueByFrequency(c)) continue;
    if (c.srEnabled && canUseSR()){
      const st = await Schema.readSRState(ctx.db, ctx.user.uid, c.id, "daily");
      if (isHiddenBySR(st)) continue;
    }
    ready.push(c);
  }

  if (!ready.length){
    list.append(el("div",{class:"muted"},"Rien à faire pour aujourd’hui 🎉"));
    return;
  }

  // tri par priorité + rendu
  for (const p of PRIORITIES){
    const inP = ready.filter(c=>c.priority===p);
    if (!inP.length) continue;
    list.append(el("h3",{}, p==="high"?"Priorité haute": p==="medium"?"Priorité moyenne":"Priorité basse"));
    inP.forEach(c => list.append(consigneCard(ctx, c, ()=>renderDaily(ctx, root))));
  }
}

export async function renderPractice(ctx, root){
  root.innerHTML = "";
  root.append(el("h2",{},"Pratique délibérée"));
  root.append(el("div",{class:"flex", style:"gap:8px;margin-bottom:8px"},[
    el("button",{class:"btn small", onclick:()=>openConsigneForm(ctx)}, "+ Ajouter une consigne")
  ]));

  const all = await fetchConsignes(ctx, "practice");
  const ready = [];
  for (const c of all){
    if (c.srEnabled && canUseSR()){
      const st = await Schema.readSRState(ctx.db, ctx.user.uid, c.id, "practice");
      if (isHiddenBySR(st)) continue;
    }
    ready.push(c);
  }

  if (!ready.length){
    root.append(el("div",{class:"muted"},"Aucune consigne pour cette session."));
    return;
  }

  const wrap = el("div",{class:"grid"});
  for (const p of PRIORITIES){
    const inP = ready.filter(c=>c.priority===p);
    if (!inP.length) continue;
    wrap.append(el("h3",{}, p==="high"?"Priorité haute": p==="medium"?"Priorité moyenne":"Priorité basse"));
    inP.forEach(c => wrap.append(consigneCard(ctx, c, ()=>renderPractice(ctx, root))));
  }
  root.append(wrap);
}

export async function renderHistory(ctx, root){
  root.innerHTML = "";
  root.append(el("h2",{},"Historique"));
  const list = el("div",{class:"grid"});
  root.append(list);

  const qy = query(col(ctx.db, ctx.user.uid, "responses"), orderBy("createdAt","desc"), limit(50));
  const ss = await getDocs(qy);
  if (ss.empty){ list.append(el("div",{class:"muted"},"Aucune réponse.")); return; }

  for (const d of ss.docs){
    const r = d.data();
    const cSnap = await getDoc(docIn(ctx.db, ctx.user.uid, "consignes", r.consigneId));
    const c = cSnap.exists() ? cSnap.data() : { text:`(consigne ${r.consigneId})` };
    const row = el("div",{class:"card"});
    row.append(el("div",{style:"font-weight:600"}, c.text));
    row.append(el("div",{class:"muted"}, `${MODE_LABEL[r.mode]||r.mode} • ${r.createdAt}`));
    row.append(el("div",{}, `Réponse: ${formatValue(r.type, r.value)}`));
    list.append(row);
  }
}

function formatValue(type, v){
  if (type==="likert6"){ const found = LIKERT6.find(([k])=>k===v); return found?found[1]:v; }
  return String(v);
}
