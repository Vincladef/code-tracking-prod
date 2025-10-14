const assert = require("assert");

class MockEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.detail = options.detail || null;
  }
}

class MockClassList {
  constructor() {
    this._set = new Set();
  }
  add(...classes) { classes.forEach((c) => c && this._set.add(c)); }
  remove(...classes) { classes.forEach((c) => this._set.delete(c)); }
  contains(c) { return this._set.has(c); }
}

class MockElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.parentNode = null;
    this.ownerDocument = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.classList = new MockClassList();
    this.hidden = false;
    this._listeners = new Map();
  }
  appendChild(child) {
    child.parentElement = this;
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }
  setAttribute(name, value) {
    const stringValue = value === undefined ? "" : String(value);
    this.attributes.set(name, stringValue);
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      this.dataset[key] = stringValue;
    }
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      delete this.dataset[key];
    }
  }
  matches(selector) {
    if (!selector) return false;
    let remainder = selector.trim();
    if (!remainder) return false;
    if (remainder.includes(",")) {
      return remainder
        .split(",")
        .map((part) => part.trim())
        .some((part) => this.matches(part));
    }
    if (remainder.startsWith("input")) {
      if (this.tagName !== "INPUT") return false;
      const tagPart = remainder.match(/^input(?:\[type="([^"]+)"\])?/);
      if (tagPart) {
        const [, typeValue] = tagPart;
        if (typeValue && String(this.type).toLowerCase() !== typeValue.toLowerCase()) return false;
        remainder = remainder.slice(tagPart[0].length);
      }
    }
    while (remainder.startsWith("[")) {
      const endIndex = remainder.indexOf("]");
      if (endIndex === -1) return false;
      const part = remainder.slice(1, endIndex);
      remainder = remainder.slice(endIndex + 1);
      if (!part) continue;
      const eqIndex = part.indexOf("=");
      if (eqIndex === -1) {
        if (!this.attributes.has(part)) return false;
      } else {
        const attr = part.slice(0, eqIndex);
        const raw = part.slice(eqIndex + 1).replace(/^"|"$/g, "");
        if (this.getAttribute(attr) !== raw) return false;
      }
    }
    return remainder.length === 0;
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
  querySelectorAll(selector) {
    const results = [];
    const visit = (n) => {
      n.children.forEach((child) => {
        if (child.matches(selector)) results.push(child);
        visit(child);
      });
    };
    visit(this);
    return results;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, listener) {
    const list = this._listeners.get(type) || [];
    list.push(listener);
    this._listeners.set(type, list);
  }
  dispatchEvent(event) {
    const list = this._listeners.get(event.type) || [];
    list.forEach((listener) => typeof listener === "function" && listener.call(this, event));
    return true;
  }
}

class MockInputElement extends MockElement {
  constructor() { super("input"); this.type = "checkbox"; this.checked = false; this.indeterminate = false; this.value = ""; }
}
class MockHiddenInput extends MockInputElement { constructor() { super(); this.type = "hidden"; } }

function setupDom() {
  const document = {
    body: new MockElement("body"),
    createElement(tag) { const t = String(tag).toLowerCase(); const el = t === "input" ? new MockInputElement() : new MockElement(tag); el.ownerDocument = document; return el; },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
  };
  document.body.ownerDocument = document;
  return document;
}

function buildChecklistDom(document) {
  const root = new MockElement("div");
  root.ownerDocument = document;
  root.setAttribute("data-checklist-root", "1");
  root.setAttribute("data-consigne-id", "consigne-guard");

  const hostA = new MockElement("label"); hostA.ownerDocument = document; hostA.setAttribute("data-checklist-item", "1"); hostA.setAttribute("data-checklist-key", "consigne-guard:item-a"); hostA.setAttribute("data-item-id", "consigne-guard:item-a");
  const inputA = new MockInputElement(); inputA.ownerDocument = document; inputA.setAttribute("data-checklist-input", ""); inputA.setAttribute("data-checklist-key", "consigne-guard:item-a"); hostA.appendChild(inputA); root.appendChild(hostA);

  const hostB = new MockElement("label"); hostB.ownerDocument = document; hostB.setAttribute("data-checklist-item", "1"); hostB.setAttribute("data-checklist-key", "consigne-guard:item-b"); hostB.setAttribute("data-item-id", "consigne-guard:item-b");
  const inputB = new MockInputElement(); inputB.ownerDocument = document; inputB.setAttribute("data-checklist-input", ""); inputB.setAttribute("data-checklist-key", "consigne-guard:item-b"); hostB.appendChild(inputB); root.appendChild(hostB);

  const hidden = new MockHiddenInput(); hidden.ownerDocument = document; hidden.setAttribute("data-checklist-state", "1"); root.appendChild(hidden);
  return { root, inputA, inputB, hidden };
}

(async function runTest() {
  global.window = { location: { hash: "" } };
  global.document = setupDom();
  global.window.document = global.document;
  global.Element = MockElement;
  global.HTMLElement = MockElement;
  global.HTMLInputElement = MockInputElement;
  global.CustomEvent = MockEvent;
  global.Event = MockEvent;
  global.navigator = {};

  const { root, inputA, inputB, hidden } = buildChecklistDom(global.document);
  global.document.body.appendChild(root);

  // Manager sans sélection: on veut s'assurer que seule la hidden state pourrait cocher
  global.window.ChecklistState = {
    async loadSelection() { return { selectedIds: [] }; },
    async persistRoot() { return null; },
  };

  require("../checklist-fix.js");

  // Cas 1: mismatch de date -> hidden ignorée
  hidden.value = JSON.stringify({ items: [true, false], skipped: [false, false], dateKey: "2024-11-16" });
  global.window.location.hash = "#/jour?d=2024-11-17";
  await global.window.hydrateChecklist({ container: root, consigneId: "consigne-guard" });
  assert.strictEqual(inputA.checked, false, "Hidden avec dateKey mismatch ne doit pas s'appliquer");
  assert.strictEqual(inputB.checked, false, "Hidden avec dateKey mismatch ne doit pas s'appliquer (B)");

  // Cas 2: date en phase -> hidden appliquée via event input
  const { root: root2, inputA: a2, inputB: b2, hidden: h2 } = buildChecklistDom(global.document);
  global.document.body.appendChild(root2);
  global.window.location.hash = "#/jour?d=2024-11-16";
  await global.window.hydrateChecklist({ container: root2, consigneId: "consigne-guard" });
  h2.value = JSON.stringify({ items: [true, false], skipped: [false, false], dateKey: "2024-11-16" });
  h2.dispatchEvent(new MockEvent("input"));
  assert.strictEqual(a2.checked, true, "Hidden avec dateKey identique doit cocher l'item A");
  assert.strictEqual(b2.checked, false);

  // Cas 3: date explicite sur la page mais hidden SANS dateKey -> ignorée
  const { root: root3, inputA: a3, inputB: b3, hidden: h3 } = buildChecklistDom(global.document);
  global.document.body.appendChild(root3);
  global.window.location.hash = "#/jour?d=2024-11-19";
  await global.window.hydrateChecklist({ container: root3, consigneId: "consigne-guard" });
  h3.value = JSON.stringify({ items: [true, false], skipped: [false, false] });
  h3.dispatchEvent(new MockEvent("input"));
  assert.strictEqual(a3.checked, false, "Hidden sans dateKey ne doit pas s'appliquer quand la page a un jour explicite");
  assert.strictEqual(b3.checked, false);

  console.log("Checklist hidden date guard tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
