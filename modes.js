// modes.js — UI propre : Journalier / Pratique / Historique / Form consignes
import {
  addDoc, setDoc, updateDoc, getDoc, getDocs,
  doc, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as Schema from "./schema.js";
import { col, docIn, now } from "./schema.js";

// ---------- helpers DOM ----------
const $ = s => document.querySelector(s);
const el = (t, a={}, c=[])=>{
  const n = document.createElement(t);
  Object.entries(a).forEach(([k,v])=>{
    if (k==="class") n.className=v;
    else if (k.startsWith("on") && typeof v==="function") n[k]=v;
    else n.setAttribute(k,v);
  });
  (Array.isArray(c)?c:[c]).forEach(x=>n.append(x?.nodeType?x:document.createTextNode(x??"")));
  return n;
};
const withinUser = (frag)=> {
  const m=(location.hash||"").match(/^#\/u\/([^/]+)/);
  return m ? `#/u/${m[1]}/${frag.replace(/^#\//,"")}` : frag;
};

// ---------- constantes ----------
const LIKERT6 = [
  ["no_answer","NR"],["no","Non"],["rather_no","Plutôt non"],
  ["medium","Moyen"],["rather_yes","Plutôt oui"],["yes","Oui"]
];
const PRIORITIES = ["high","medium","low"];
const MODE_LABEL = { daily:"Journalier", practice:"Pratique délibérée" };
const TYPE_LABEL = { short:"Texte court", long:"Texte long", likert6:"Likert (6)", num:"Échelle 1–10" };

// ---------- SR & fréquence ----------
const DOW = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const todayDow = ()=> new Date().getDay(); // 0..6 (Dim..Sam)

function canUseSR(){
  return typeof Schema.readSRState==="function" &&
         typeof Schema.upsertSRState==="function" &&
         typeof Schema.nextCooldownAfterAnswer==="function";
}
function hiddenBySR(st){
  if (!st || !st.hideUntil) return false;
  return new Date(st.hideUntil) > new Date();
}
function dueOnDay(consigne, dowIdx){
  if (consigne.mode!=="daily") return true;
  const f=consigne.frequency||{kind:"everyday"};
  if (f.kind==="everyday") return true;
  if (f.kind==="days" && Array.isArray(f.days)) return f.days.includes(dowIdx);
  return true;
}

// ---------- data ----------
async function fetchConsignes(ctx, mode){
  const qy = query(
    col(ctx.db, ctx.user.uid, "consignes"),
    where("active","==", true),
    where("mode","==", mode),
    orderBy("priority","asc"),
    orderBy("createdAt","desc")
  );
  const ss = await getDocs(qy);
  return ss.docs.map(d=>({id:d.id, ...d.data()}));
}
async function saveConsigne(ctx, id, payload){
  if (id){ await updateDoc(docIn(ctx.db, ctx.user.uid, "consignes", id), payload); return id; }
  const ref = await addDoc(col(ctx.db, ctx.user.uid, "consignes"), payload);
  return ref.id;
}
async function softDeleteConsigne(ctx, id){
  await updateDoc(docIn(ctx.db, ctx.user.uid, "consignes", id), { active:false, deletedAt: now() });
}
async function saveResponse(ctx, c, value){
  await addDoc(col(ctx.db, ctx.user.uid, "responses"), {
    ownerUid: ctx.user.uid, consigneId: c.id, value,
    type: c.type, mode: c.mode, createdAt: now()
  });
  if (c.srEnabled && canUseSR()){
    const prev = await Schema.readSRState(ctx.db, ctx.user.uid, c.id, c.mode);
    const positive = c.type==="likert6" ? value
                   : c.type==="num"     ? (Number(value)>=6?"yes":"medium")
                   : "yes";
    const next = Schema.nextCooldownAfterAnswer(c, prev, positive);
    await Schema.upsertSRState(ctx.db, ctx.user.uid, c.id, c.mode, next);
  }
}

// ---------- UI de base ----------
function Card(children){ return el("div",{class:"bg-gray-900/70 border border-gray-700 rounded-2xl p-5 shadow"},children); }
function Btn(label, extra="", onClick=null){
  const b=el("button",{type:"button", class:`px-3 py-1 rounded-xl border border-gray-600 bg-gray-800/70 hover:bg-gray-700 text-sm ${extra}`},label);
  if (onClick) b.onclick=onClick; return b;
}
function SectionTitle(txt){ return el("h3",{class:"text-lg font-semibold mb-2"},txt); }

// ---------- Formulaire consigne ----------
export function openConsigneForm(ctx, consigne=null){
  const root=$("#view-root"); root.innerHTML="";
  const initial = consigne || {
    text:"", category:"Général", type:"likert6", priority:"medium",
    mode:"daily", frequency:{kind:"everyday"}, srEnabled:true, active:true
  };
  root.append(el("h2",{class:"text-xl font-semibold mb-3"}, consigne?"Modifier la consigne":"Nouvelle consigne"));

  const form = el("div",{class:"grid grid-cols-1 md:grid-cols-2 gap-4"});
  form.append(
    Card([
      SectionTitle("Contenu"),
      field("Texte", el("input",{id:"c-text",class:"w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2",placeholder:"Ex. Boire 2 verres d’eau", value:initial.text})),
      field("Catégorie", el("input",{id:"c-cat",class:"w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2",value:initial.category})),
      field("Type de réponse", select("c-type", initial.type, [
        ["likert6", TYPE_LABEL.likert6],["num",TYPE_LABEL.num],["short",TYPE_LABEL.short],["long",TYPE_LABEL.long]
      ])),
      field("Priorité", select("c-pri", initial.priority, [
        ["high","Haute"],["medium","Moyenne"],["low","Basse"]
      ])),
    ]),
    Card([
      SectionTitle("Utilisation"),
      field("Mode", select("c-mode", initial.mode, [
        ["daily","Journalier"],["practice","Pratique délibérée"]
      ])),
      field("Répétition espacée", select("c-sr", initial.srEnabled?"1":"0", [["1","Activée"],["0","Désactivée"]])),
      el("div",{class:"mt-2"},[
        el("label",{class:"block text-sm text-gray-400 mb-1"},"Fréquence (journalier)"),
        el("div",{class:"space-y-2"},[
          radio("c-freq","everyday", initial.frequency?.kind!=="days", "Quotidienne"),
          radio("c-freq","days", initial.frequency?.kind==="days", "Jours spécifiques"),
          el("div",{id:"c-days", class: initial.frequency?.kind==="days"?"block":"hidden"}, dayPickCheckboxes(initial.frequency?.days||[]))
        ])
      ])
    ])
  );
  root.append(form);

  const bar = el("div",{class:"flex gap-2 mt-4"});
  const save = Btn("Enregistrer","border-sky-600 bg-sky-600/80 hover:bg-sky-600 text-white", async ()=>{
    const freq = [...root.querySelectorAll("input[name='c-freq']")].find(r=>r.checked)?.value || "everyday";
    const days = [...root.querySelectorAll("input[name='dow']:checked")].map(i=>Number(i.value));
    const payload = {
      ownerUid: ctx.user.uid, active:true,
      text: $("#c-text").value.trim(),
      category: $("#c-cat").value.trim()||"Général",
      type: $("#c-type").value, priority: $("#c-pri").value,
      mode: $("#c-mode").value,
      frequency: (freq==="days")?{kind:"days",days}:{kind:"everyday"},
      srEnabled: $("#c-sr").value==="1",
      createdAt: consigne?.createdAt || now()
    };
    if (!payload.text){ alert("Le texte est obligatoire"); return; }
    await saveConsigne(ctx, consigne?.id, payload);
    location.hash = withinUser("#/daily");
  });
  const cancel = Btn("Annuler","", ()=> history.back());
  bar.append(save, cancel);

  if (consigne){
    const del = Btn("Supprimer","ml-auto border-red-500/60 hover:bg-red-500/20", async()=>{
      if(confirm("Supprimer (désactiver) cette consigne ?")){
        await softDeleteConsigne(ctx, consigne.id);
        location.hash = withinUser("#/daily");
      }
    });
    bar.append(del);
  }
  root.append(bar);

  // show/hide jours spécifiques
  root.addEventListener("change",(e)=>{
    if (e.target?.name==="c-freq"){
      $("#c-days").classList.toggle("hidden", e.target.value!=="days");
    }
  });
}
function field(label, control){
  return el("div",{},[ el("label",{class:"block text-sm text-gray-400 mb-1"},label), control ]);
}
function select(id, value, opts){
  const s=el("select",{id, class:"w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2"});
  opts.forEach(([v,l])=>s.append(el("option",{value:v, selected:String(value)===String(v)},l)));
  return s;
}
function radio(name, value, checked, label){
  const id = `${name}-${value}`;
  return el("label",{class:"flex items-center gap-2"},[
    el("input",{type:"radio",name,value,id,checked}),
    el("span",{},label)
  ]);
}
function dayPickCheckboxes(selected){
  const wrap=el("div",{class:"flex flex-wrap gap-2 mt-1"});
  for(let i=1;i<=6;i++){ // L(1) à S(6)
    const lab=el("label",{class:"px-2 py-1 rounded-xl border border-gray-600 bg-gray-800/50 cursor-pointer flex items-center gap-2"},[
      el("input",{type:"checkbox",name:"dow",value:String(i),checked:selected.includes(i)}),
      DOW[i]
    ]);
    wrap.append(lab);
  }
  // Dimanche (0)
  const sun=el("label",{class:"px-2 py-1 rounded-xl border border-gray-600 bg-gray-800/50 cursor-pointer flex items-center gap-2"},[
    el("input",{type:"checkbox",name:"dow",value:"0",checked:selected.includes(0)}),
    DOW[0]
  ]);
  wrap.prepend(sun);
  return wrap;
}

// ---------- cartes consignes ----------
function ConsigneCard(ctx, c){
  const card = Card([]);
  card.classList.add("space-y-3");

  const top = el("div",{class:"flex items-start gap-2"},[
    el("div",{class:"font-semibold"}, c.text),
    el("span",{class:"ml-auto text-xs px-2 py-0.5 rounded-full border border-gray-600 text-gray-300"}, MODE_LABEL[c.mode]||c.mode)
  ]);
  card.append(top);
  card.append(el("div",{class:"text-sm text-gray-400"}, c.category || "Général"));

  let getter = () => null;
  const controls = el("div",{class:"space-y-2"});

  if (c.type === "likert6"){
    let selected = null;
    const wrap = el("div",{class:"flex flex-wrap gap-2"});
    const activate = (btn)=>{
      wrap.querySelectorAll("button[data-val]").forEach(b=>{
        b.classList.remove("border-sky-600","bg-sky-600/80","text-white");
      });
      if (btn){
        btn.classList.add("border-sky-600","bg-sky-600/80","text-white");
      }
    };
    LIKERT6.forEach(([v,l])=>{
      const btn = Btn(l);
      btn.dataset.val = v;
      btn.onclick = ()=>{
        if (selected === v){
          selected = null;
          activate(null);
        } else {
          selected = v;
          activate(btn);
        }
      };
      wrap.append(btn);
    });
    getter = ()=> selected;
    controls.append(wrap);
  } else if (c.type === "num"){
    let chosen = null;
    const wrap = el("div",{class:"flex items-center gap-2"});
    const range = el("input",{type:"range", min:"1", max:"10", value:"5", class:"w-52"});
    const out = el("span",{class:"px-2 py-0.5 rounded-xl border border-gray-600"}, "–");
    const update = ()=>{ chosen = Number(range.value); out.textContent = range.value; };
    range.addEventListener("input", update);
    range.addEventListener("change", update);
    const clear = Btn("Effacer");
    clear.onclick = ()=>{
      chosen = null;
      out.textContent = "–";
      range.value = "5";
    };
    wrap.append(range, out, clear);
    controls.append(wrap);
    getter = ()=> chosen;
  } else if (c.type === "short"){
    const inp = el("input",{class:"bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 w-full", placeholder:"Réponse ≤ 200 c.", maxLength:"200"});
    controls.append(inp);
    getter = ()=>{
      const v = inp.value.trim();
      return v.length ? v : null;
    };
  } else {
    const inp = el("textarea",{class:"bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 w-full", placeholder:"Votre réponse"});
    controls.append(inp);
    getter = ()=>{
      const v = inp.value.trim();
      return v.length ? v : null;
    };
  }

  card.append(controls);

  const actions = el("div",{class:"flex gap-2 pt-1"},[
    Btn("Modifier","", ()=>openConsigneForm(ctx,c)),
    Btn("Supprimer","border-red-500/60 hover:bg-red-500/20", async()=>{
      if (confirm("Supprimer ?")){
        await softDeleteConsigne(ctx,c.id);
        location.reload();
      }
    })
  ]);
  card.append(actions);

  return { card, getValue: getter };
}

// ---------- pickers ----------
function DayPicker(selectedDow){
  const w=el("div",{class:"flex flex-wrap gap-2 mb-4"});
  const go=(i)=>{ location.hash = withinUser(`#/daily?dow=${i}`); };
  for (let i=1;i<=6;i++){
    w.append(dayBtn(i, selectedDow===i, DOW[i], ()=>go(i)));
  }
  w.prepend(dayBtn(0, selectedDow===0, DOW[0], ()=>go(0))); // Dim
  return w;
}
function dayBtn(i, active, label, onClick){
  return Btn(label, `${active?"border-sky-600 bg-sky-600/80 text-white":"opacity-90"}`, onClick);
}

// ---------- vues ----------
export async function renderDaily(ctx, root, opts = {}){
  root.innerHTML="";
  root.append(el("h2",{class:"text-xl font-semibold mb-3"}, "Journalier"));

  const params = new URLSearchParams((location.hash.split("?")[1])||"");
  const dow = params.has("dow") ? Number(params.get("dow")) : todayDow();

  root.append(DayPicker(dow));

  const infoRow = el("div",{class:"flex flex-wrap items-center gap-3 mb-4"});
  infoRow.append(el("p",{class:"text-sm text-gray-400 flex-1"},
    "Sélectionne tes réponses du jour puis envoie-les en bas du formulaire."));
  infoRow.append(Btn("+ Ajouter une consigne","border-sky-600 bg-sky-600/80 hover:bg-sky-600 text-white",()=>openConsigneForm(ctx)));
  root.append(infoRow);

  if (opts.flash){
    const color = opts.flash.type === "success" ? "text-emerald-400" : "text-red-400";
    root.append(el("div",{class:`mb-3 text-sm ${color}`}, opts.flash.text));
  }

  const all = await fetchConsignes(ctx,"daily");
  const ready = [];
  for (const c of all){
    if (!dueOnDay(c, dow)) continue;
    if (c.srEnabled && canUseSR()){
      const st = await Schema.readSRState(ctx.db, ctx.user.uid, c.id, "daily");
      if (hiddenBySR(st)) continue;
    }
    ready.push(c);
  }

  if (!ready.length){
    root.append(Card(el("div",{},"Rien à faire pour ce jour 🎉")));
    return;
  }

  const form = el("form",{class:"space-y-5"});
  const entries = [];
  let first = true;
  for (const p of PRIORITIES){
    const inP = ready.filter(c=>c.priority===p);
    if (!inP.length) continue;
    const section = el("div",{class:"space-y-3"});
    section.append(el("h3",{class:`text-lg font-semibold ${first?"":"mt-4"}`},
      p==="high"?"Priorité haute":p==="medium"?"Priorité moyenne":"Priorité basse"));
    const grid = el("div",{class:"grid gap-3 md:grid-cols-2"});
    inP.forEach(c=>{
      const entry = ConsigneCard(ctx,c);
      grid.append(entry.card);
      entries.push({ consigne:c, getValue: entry.getValue });
    });
    section.append(grid);
    form.append(section);
    first = false;
  }

  const footer = el("div",{class:"space-y-2"});
  const submitRow = el("div",{class:"flex justify-end"});
  const submitBtn = el("button",{type:"submit", class:"px-4 py-2 rounded-xl border border-sky-600 bg-sky-600/80 hover:bg-sky-600 text-white text-sm"}, "Envoyer les réponses");
  submitRow.append(submitBtn);
  const message = el("div",{class:"text-sm text-red-400", style:"display:none"});
  footer.append(submitRow, message);
  form.append(footer);

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    message.style.display = "none";
    const original = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Envoi…";
    let sent = 0;
    try {
      for (const entry of entries){
        const value = entry.getValue();
        if (value === null || value === undefined || value === "") continue;
        await saveResponse(ctx, entry.consigne, value);
        sent++;
      }
    } catch (err) {
      console.error(err);
      message.textContent = "Une erreur est survenue lors de l’envoi.";
      message.className = "text-sm text-red-400";
      message.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = original;
      return;
    }

    if (!sent){
      message.textContent = "Sélectionne au moins une consigne avant d’envoyer.";
      message.className = "text-sm text-red-400";
      message.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = original;
      return;
    }

    await renderDaily(ctx, root, {
      flash: {
        type: "success",
        text: sent === 1 ? "1 réponse envoyée" : `${sent} réponses envoyées`
      }
    });
  });

  root.append(form);
}

export async function renderPractice(ctx, root, opts = {}){
  root.innerHTML="";
  root.append(el("h2",{class:"text-xl font-semibold mb-3"}, "Pratique délibérée"));

  const infoRow = el("div",{class:"flex flex-wrap items-center gap-3 mb-4"});
  infoRow.append(el("p",{class:"text-sm text-gray-400 flex-1"},
    "Prépare ta session puis envoie toutes tes réponses en une fois."));
  infoRow.append(Btn("+ Ajouter une consigne","border-sky-600 bg-sky-600/80 hover:bg-sky-600 text-white",()=>openConsigneForm(ctx)));
  root.append(infoRow);

  if (opts.flash){
    const color = opts.flash.type === "success" ? "text-emerald-400" : "text-red-400";
    root.append(el("div",{class:`mb-3 text-sm ${color}`}, opts.flash.text));
  }

  const all = await fetchConsignes(ctx,"practice");
  const ready=[];
  for (const c of all){
    if (c.srEnabled && canUseSR()){
      const st = await Schema.readSRState(ctx.db, ctx.user.uid, c.id, "practice");
      if (hiddenBySR(st)) continue;
    }
    ready.push(c);
  }
  if (!ready.length){
    root.append(Card("Aucune consigne pour cette session."));
    return;
  }

  const form = el("form",{class:"space-y-5"});
  const entries = [];
  let first = true;
  for (const p of PRIORITIES){
    const inP = ready.filter(c=>c.priority===p);
    if (!inP.length) continue;
    const section = el("div",{class:"space-y-3"});
    section.append(el("h3",{class:`text-lg font-semibold ${first?"":"mt-4"}`},
      p==="high"?"Priorité haute":p==="medium"?"Priorité moyenne":"Priorité basse"));
    const grid = el("div",{class:"grid gap-3 md:grid-cols-2"});
    inP.forEach(c=>{
      const entry = ConsigneCard(ctx,c);
      grid.append(entry.card);
      entries.push({ consigne:c, getValue: entry.getValue });
    });
    section.append(grid);
    form.append(section);
    first = false;
  }

  const footer = el("div",{class:"space-y-2"});
  const submitRow = el("div",{class:"flex justify-end"});
  const submitBtn = el("button",{type:"submit", class:"px-4 py-2 rounded-xl border border-sky-600 bg-sky-600/80 hover:bg-sky-600 text-white text-sm"}, "Envoyer les réponses");
  submitRow.append(submitBtn);
  const message = el("div",{class:"text-sm text-red-400", style:"display:none"});
  footer.append(submitRow, message);
  form.append(footer);

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    message.style.display = "none";
    const original = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Envoi…";
    let sent = 0;
    try {
      for (const entry of entries){
        const value = entry.getValue();
        if (value === null || value === undefined || value === "") continue;
        await saveResponse(ctx, entry.consigne, value);
        sent++;
      }
    } catch (err) {
      console.error(err);
      message.textContent = "Une erreur est survenue lors de l’envoi.";
      message.className = "text-sm text-red-400";
      message.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = original;
      return;
    }

    if (!sent){
      message.textContent = "Sélectionne au moins une consigne avant d’envoyer.";
      message.className = "text-sm text-red-400";
      message.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = original;
      return;
    }

    await renderPractice(ctx, root, {
      flash: {
        type: "success",
        text: sent === 1 ? "1 réponse envoyée" : `${sent} réponses envoyées`
      }
    });
  });

  root.append(form);
}

export async function renderHistory(ctx, root){
  root.innerHTML="";
  root.append(el("h2",{class:"text-xl font-semibold mb-3"}, "Historique"));
  const list = el("div",{class:"grid gap-3"});
  root.append(list);

  const qy = query(col(ctx.db, ctx.user.uid, "responses"), orderBy("createdAt","desc"), limit(50));
  const ss = await getDocs(qy);
  if (ss.empty){ list.append(Card("Aucune réponse.")); return; }

  for (const d of ss.docs){
    const r = d.data();
    const cSnap = await getDoc(docIn(ctx.db, ctx.user.uid, "consignes", r.consigneId));
    const c = cSnap.exists()? cSnap.data() : { text:`(consigne ${r.consigneId})` };
    const row = Card([
      el("div",{class:"font-semibold mb-1"}, c.text),
      el("div",{class:"text-sm text-gray-400 mb-1"}, `${MODE_LABEL[r.mode]||r.mode} • ${r.createdAt}`),
      el("div",{}, `Réponse : ${formatValue(r.type, r.value)}`)
    ]);
    list.append(row);
  }
}
function formatValue(type,v){
  if (type==="likert6"){ const f=LIKERT6.find(([k])=>k===v); return f?f[1]:v; }
  return String(v);
}
