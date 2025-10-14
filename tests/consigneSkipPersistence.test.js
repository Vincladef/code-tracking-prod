const assert = require("assert");

// Minimal DOM stubs for this test
class MockEvent { constructor(type, opts={}) { this.type=type; this.bubbles=!!opts.bubbles; } }
class MockClassList { constructor(){ this._s=new Set(); } add(c){ if(c) this._s.add(c);} remove(c){ this._s.delete(c);} contains(c){ return this._s.has(c);} }
class MockEl {
  constructor(tag="div"){ this.tagName=String(tag).toUpperCase(); this.children=[]; this.parentElement=null; this.dataset={}; this.attributes=new Map(); this.classList=new MockClassList(); this._listeners=new Map(); this.hidden=false; this._name=""; this._value=""; this._type=""; }
  appendChild(ch){ ch.parentElement=this; this.children.push(ch); return ch; }
  setAttribute(n,v){ const val= v===undefined?"":String(v); this.attributes.set(n,val); if(n.startsWith("data-")){ const key=n.slice(5).replace(/-([a-z])/g,(_,l)=>l.toUpperCase()); this.dataset[key]=val; } if(n==="name") { this._name = val; } if(n==="type") { this._type = val; } if(n==="value") { this._value = val; } }
  getAttribute(n){ return this.attributes.has(n) ? this.attributes.get(n) : null; }
  removeAttribute(n){ this.attributes.delete(n); if(n.startsWith("data-")){ const key=n.slice(5).replace(/-([a-z])/g,(_,l)=>l.toUpperCase()); delete this.dataset[key]; } }
  get name(){ return this._name; }
  set name(v){ const val = v==null?"":String(v); this._name = val; this.setAttribute("name", val); }
  get value(){ return this._value; }
  set value(v){ const val = v==null?"":String(v); this._value = val; this.setAttribute("value", val); }
  get type(){ return this._type; }
  set type(v){ const val = v==null?"":String(v); this._type = val; this.setAttribute("type", val); }
  querySelector(sel){ return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel){
    const res=[]; const isMatch=(node)=>{
      if (sel === "[data-consigne-input-holder]") return node.attributes.has("data-consigne-input-holder");
      if (sel === `[name="skip:${node?.dataset?.consigneId}"]`) return false; // not used
      if (/^\[name="checklist:/.test(sel)) { return node.attributes.get("name") === sel.slice(7,-2); }
      if (/^\[name="long:/.test(sel) || /^\[name="short:/.test(sel) || /^\[name="num:/.test(sel) || /^\[name="likert/.test(sel)) { return node.attributes.get("name") === sel.slice(7,-2); }
      if (/^\[name="skip:/.test(sel)) { return node.attributes.get("name") === sel.slice(7,-2); }
      if (sel === `[data-rich-text-root][data-consigne-id="${this.dataset.consigneId}"]`) return false;
      if (/^\[data-checklist-root\]/.test(sel)) return node.attributes.has("data-checklist-root");
      if (sel === `[data-consigne-id="${this.dataset.consigneId}"]`) return node.attributes.get("data-consigne-id") === this.dataset.consigneId;
      if (sel === "[data-consigne-editor-body]") return node.attributes.has("data-consigne-editor-body");
      if (sel === `[name$=":${this.dataset.consigneId}"]`) return node.attributes.get("name")?.endsWith(`:${this.dataset.consigneId}`);
      return false;
    };
    const walk=(n)=>{ n.children.forEach((c)=>{ if(isMatch(c)) res.push(c); walk(c); }); };
    walk(this); return res;
  }
  addEventListener(t,fn){ const a=this._listeners.get(t)||[]; a.push(fn); this._listeners.set(t,a); }
  dispatchEvent(e){ const a=this._listeners.get(e.type)||[]; a.forEach((fn)=>fn.call(this,e)); return true; }
}

function createRow(consigne) {
  const row = new MockEl("div");
  row.classList = new MockClassList();
  row.setAttribute("data-consigne-id", consigne.id);
  row.dataset.consigneId = String(consigne.id);
  const holder = new MockEl("div");
  holder.setAttribute("data-consigne-input-holder", "");
  row.appendChild(holder);
  return row;
}

function findByName(root, name) {
  let found = null;
  const walk = (n) => {
    if (found) return;
    if (n && typeof n.attributes?.get === 'function' && n.attributes.get('name') === name) {
      found = n;
      return;
    }
    if (Array.isArray(n?.children)) {
      n.children.forEach(walk);
    }
  };
  walk(root);
  return found;
}

(async function run(){
  // Provide globals used by modes.js internals
  global.window = global;
  global.document = { createElement:(t)=> new MockEl(t), createTreeWalker:()=>({ nextNode:()=>false, currentNode:null }) };
  global.Node = { TEXT_NODE: 3 };
  global.NodeFilter = { SHOW_ELEMENT: 1 };
  global.CustomEvent = function(){ return {}; };
  global.Element = MockEl;
  global.HTMLElement = MockEl;
  global.HTMLTextAreaElement = function(){};
  global.Schema = { DAY_ALIAS:{}, DAY_VALUES:new Set(), D:{ info(){}, warn(){}, debug(){}, error(){} }, valueToNumericPoint:()=>null };

  const { setConsigneSkipState, normalizeConsigneValueForPersistence, readConsigneCurrentValue } = require("../modes.js");

  const consigne = { id: "c-skip-1", type: "short", priority: 2, text: "Demo" };
  const row = createRow(consigne);

  // 1) Baseline: pas de skip
  assert.strictEqual(row.dataset.skipAnswered, undefined);

  // 2) Activer le skip et vérifier l’UI (dataset) + champ caché créé/mis à jour
  setConsigneSkipState(row, consigne, true, { updateUI: true });
  assert.strictEqual(row.dataset.skipAnswered, "1", "Le flag de skip doit être activé sur la ligne");
  const hiddenSkip = findByName(row, `skip:${consigne.id}`);
  assert(hiddenSkip, "Le champ caché de skip doit être présent");
  assert.strictEqual(hiddenSkip.value, "1", "La valeur du champ caché de skip doit être '1'");

  // 3) Normalisation pour persistance renvoie {skipped:true}
  const normalized = normalizeConsigneValueForPersistence(consigne, row, "whatever");
  assert.deepStrictEqual(normalized, { skipped: true }, "La valeur normalisée doit refléter le skip");

  // 4) Lecture de la valeur courante doit retourner la valeur saisie (ici vide) ou null,
  // mais l’UI restera bleue via updateConsigneStatusUI; on s’assure que l’appel ne jette pas.
  const current = readConsigneCurrentValue(consigne, row);
  assert.strictEqual(typeof current === "string", true, "readConsigneCurrentValue doit retourner une chaîne pour short");

  // 5) Désactiver le skip: le flag UI doit disparaître et la normalisation redevient transparente
  setConsigneSkipState(row, consigne, false, { updateUI: true });
  assert.strictEqual(row.dataset.skipAnswered, undefined, "Le flag de skip doit être retiré");
  const checkNormalized = normalizeConsigneValueForPersistence(consigne, row, "ok");
  assert.strictEqual(checkNormalized, "ok", "La normalisation ne doit plus marquer skipped après désactivation");

  console.log("Consigne skip basic behavior test passed.");
})().catch((e)=>{ console.error(e); process.exitCode=1; });
