const assert = require("assert");
const originalDateNow = Date.now;

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
  add(...classes) {
    classes.forEach((cls) => cls && this._set.add(cls));
  }
  remove(...classes) {
    classes.forEach((cls) => this._set.delete(cls));
  }
  contains(value) {
    return this._set.has(value);
  }
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
    this.textContent = "";
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
    if (name === "value") {
      this.value = stringValue;
    }
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = stringValue;
    }
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
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
    const visit = (node) => {
      node.children.forEach((child) => {
        if (child.matches(selector)) {
          results.push(child);
        }
        visit(child);
      });
    };
    visit(this);
    return results;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
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
  cloneNode(deep) {
    const clone = new MockElement(this.tagName);
    this.attributes.forEach((value, name) => {
      clone.setAttribute(name, value);
    });
    clone.textContent = this.textContent;
    clone.value = this.value;
    if (deep) {
      this.children.forEach((child) => {
        clone.appendChild(child.cloneNode(true));
      });
    }
    return clone;
  }
}

class MockInputElement extends MockElement {
  constructor(type = "checkbox") {
    super("input");
    this.type = type;
    this.checked = false;
    this.indeterminate = false;
    this.value = "";
  }
}

class MockHiddenInput extends MockInputElement {
  constructor() {
    super("hidden");
  }
}

class MockLocalStorage {
  constructor() {
    this._store = new Map();
  }
  get length() {
    return this._store.size;
  }
  key(index) {
    const keys = Array.from(this._store.keys());
    return keys[index] || null;
  }
  getItem(key) {
    return this._store.has(key) ? this._store.get(key) : null;
  }
  setItem(key, value) {
    this._store.set(String(key), String(value));
  }
  removeItem(key) {
    this._store.delete(key);
  }
  clear() {
    this._store.clear();
  }
}

function setupDom() {
  const document = {
    body: new MockElement("body"),
    createElement(tag) {
      const lowered = String(tag).toLowerCase();
      const element = lowered === "input" ? new MockInputElement() : new MockElement(tag);
      element.ownerDocument = document;
      return element;
    },
    querySelectorAll(selector) {
      return this.body.querySelectorAll(selector);
    },
    addEventListener() {},
    removeEventListener() {},
    createEvent() {
      return {
        initEvent() {},
      };
    },
  };
  document.body.ownerDocument = document;
  return document;
}

function buildChecklistDom(document) {
  const root = new MockElement("div");
  root.ownerDocument = document;
  root.setAttribute("data-checklist-root", "1");
  root.setAttribute("data-consigne-id", "consigne-guard");

  const hostA = new MockElement("label");
  hostA.ownerDocument = document;
  hostA.setAttribute("data-checklist-item", "1");
  hostA.setAttribute("data-checklist-key", "consigne-guard:item-a");
  const inputA = new MockInputElement();
  inputA.ownerDocument = document;
  inputA.setAttribute("data-checklist-input", "");
  inputA.setAttribute("data-checklist-key", "consigne-guard:item-a");
  hostA.appendChild(inputA);
  root.appendChild(hostA);

  const hostB = new MockElement("label");
  hostB.ownerDocument = document;
  hostB.setAttribute("data-checklist-item", "1");
  hostB.setAttribute("data-checklist-key", "consigne-guard:item-b");
  const inputB = new MockInputElement();
  inputB.ownerDocument = document;
  inputB.setAttribute("data-checklist-input", "");
  inputB.setAttribute("data-checklist-key", "consigne-guard:item-b");
  hostB.appendChild(inputB);
  root.appendChild(hostB);

  const hidden = new MockHiddenInput();
  hidden.ownerDocument = document;
  hidden.setAttribute("data-checklist-state", "1");
  root.appendChild(hidden);

  return { root, inputA, inputB, hidden };
}

(async function runTest() {
  Date.now = () => Date.UTC(2024, 10, 19, 12, 0, 0);

  const document = setupDom();
  global.document = document;
  global.window = {
    document,
    location: { hash: "", search: "" },
  };
  global.window.window = global.window;
  global.window.document = document;
  global.location = global.window.location;
  global.Element = MockElement;
  global.HTMLElement = MockElement;
  global.HTMLInputElement = MockInputElement;
  global.CustomEvent = MockEvent;
  global.Event = MockEvent;
  global.navigator = {};
  global.window.navigator = global.navigator;

  const storage = new MockLocalStorage();
  global.localStorage = storage;
  global.window.localStorage = storage;

  require("../utils/checklist-state.js");
  const manager = global.window.ChecklistState;

  const previousDateKey = "2024-11-18";
  const payload = {
    type: "checklist",
    consigneId: "consigne-guard",
    dateKey: previousDateKey,
    selectedIds: ["consigne-guard:item-a"],
    skippedIds: [],
    answers: {
      "consigne-guard:item-a": { value: "yes", skipped: false },
    },
    checklistValue: {
      dateKey: previousDateKey,
      items: [true, false],
      skipped: [false, false],
      answers: {
        "consigne-guard:item-a": { value: "yes", skipped: false },
      },
    },
    ts: Date.UTC(2024, 10, 18, 21, 0, 0),
  };

  const storageKey = manager.storageKey("user-1", "consigne-guard", previousDateKey);
  storage.setItem(storageKey, JSON.stringify(payload));

  const { root, inputA, inputB, hidden } = buildChecklistDom(document);
  document.body.appendChild(root);

  manager.setContext({ uid: "user-1", db: null });
  manager.hydrateExistingRoots();

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.strictEqual(inputA.checked, false, "Les sélections de la veille ne doivent pas se pré-cocher");
  assert.strictEqual(inputB.checked, false, "Les autres cases doivent rester décochées");

  const hiddenValue = hidden.value ? JSON.parse(hidden.value) : null;
  assert(hiddenValue, "Le champ caché doit être hydraté avec un payload vide");
  assert.strictEqual(hiddenValue.dateKey, "2024-11-19", "Le hidden state doit refléter la date du jour");
  assert.deepStrictEqual(hiddenValue.items, [false, false], "Aucune case ne doit être marquée comme cochée");
  if (hiddenValue.answers) {
    const positiveAnswers = Object.values(hiddenValue.answers).filter((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const value = String(entry.value ?? "").toLowerCase();
      return value === "yes" || value === "maybe";
    });
    assert.strictEqual(positiveAnswers.length, 0, "Aucune réponse positive ne doit être propagée");
  }

  console.log("Checklist localStorage isolation test passed.");

  Date.now = originalDateNow;
})().catch((error) => {
  Date.now = originalDateNow;
  console.error(error);
  process.exitCode = 1;
});
