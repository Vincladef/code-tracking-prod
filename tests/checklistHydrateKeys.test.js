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
  add(...classes) {
    classes.forEach((cls) => {
      if (cls) this._set.add(cls);
    });
  }
  remove(...classes) {
    classes.forEach((cls) => {
      this._set.delete(cls);
    });
  }
  contains(cls) {
    return this._set.has(cls);
  }
}

class MockElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.ownerDocument = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.classList = new MockClassList();
    this.hidden = false;
    this._listeners = new Map();
  }

  appendChild(child) {
    if (!(child instanceof MockElement)) {
      throw new Error("Only MockElement instances can be appended");
    }
    child.parentElement = this;
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentElement = null;
      child.parentNode = null;
    }
    return child;
  }

  setAttribute(name, value) {
    const stringValue = value === undefined ? "" : String(value);
    this.attributes.set(name, stringValue);
    if (name.startsWith("data-")) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = stringValue;
    }
  }

  getAttribute(name) {
    if (!this.attributes.has(name)) {
      return null;
    }
    return this.attributes.get(name);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith("data-")) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      delete this.dataset[key];
    }
  }

  contains(node) {
    if (node === this) {
      return true;
    }
    return this.children.some((child) => child.contains(node));
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
      if (this.tagName !== "INPUT") {
        return false;
      }
      const tagPart = remainder.match(/^input(?:\[type="([^"]+)"\])?/);
      if (tagPart) {
        const [, typeValue] = tagPart;
        if (typeValue && String(this.type).toLowerCase() !== typeValue.toLowerCase()) {
          return false;
        }
        remainder = remainder.slice(tagPart[0].length);
      }
    }

    while (remainder.startsWith("[")) {
      const endIndex = remainder.indexOf("]");
      if (endIndex === -1) {
        return false;
      }
      const part = remainder.slice(1, endIndex);
      remainder = remainder.slice(endIndex + 1);
      if (!part) continue;
      const eqIndex = part.indexOf("=");
      if (eqIndex === -1) {
        if (!this.attributes.has(part)) {
          return false;
        }
      } else {
        const attr = part.slice(0, eqIndex);
        const raw = part.slice(eqIndex + 1).replace(/^"|"$/g, "");
        if (this.getAttribute(attr) !== raw) {
          return false;
        }
      }
    }

    return remainder.length === 0;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) {
        return node;
      }
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

  removeEventListener(type, listener) {
    const list = this._listeners.get(type) || [];
    const index = list.indexOf(listener);
    if (index !== -1) {
      list.splice(index, 1);
    }
    this._listeners.set(type, list);
  }

  dispatchEvent(event) {
    const list = this._listeners.get(event.type) || [];
    list.forEach((listener) => {
      if (typeof listener === "function") {
        listener.call(this, event);
      }
    });
    return true;
  }
}

class MockInputElement extends MockElement {
  constructor() {
    super("input");
    this.type = "checkbox";
    this.checked = false;
    this.indeterminate = false;
    this.value = "";
  }
}

class MockHiddenInput extends MockInputElement {
  constructor() {
    super();
    this.type = "hidden";
  }
}

function setupDom() {
  const document = {
    body: new MockElement("body"),
    createElement(tag) {
      if (String(tag).toLowerCase() === "input") {
        const input = new MockInputElement();
        input.ownerDocument = document;
        return input;
      }
      const el = new MockElement(tag);
      el.ownerDocument = document;
      return el;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
  };
  document.body.ownerDocument = document;
  return document;
}

function buildChecklistDom(document) {
  const root = new MockElement("div");
  root.ownerDocument = document;
  root.setAttribute("data-checklist-root", "1");
  root.setAttribute("data-consigne-id", "consigne-1");

  const hostA = new MockElement("label");
  hostA.ownerDocument = document;
  hostA.setAttribute("data-checklist-item", "1");
  hostA.setAttribute("data-checklist-key", "consigne-1:item-a");
  hostA.setAttribute("data-item-id", "consigne-1:item-a");

  const inputA = new MockInputElement();
  inputA.ownerDocument = document;
  inputA.setAttribute("data-checklist-input", "");
  inputA.setAttribute("data-checklist-key", "consigne-1:item-a");
  hostA.appendChild(inputA);
  root.appendChild(hostA);

  const hostB = new MockElement("label");
  hostB.ownerDocument = document;
  hostB.setAttribute("data-checklist-item", "1");
  hostB.setAttribute("data-checklist-key", "consigne-1:item-b");
  hostB.setAttribute("data-item-id", "consigne-1:item-b");

  const inputB = new MockInputElement();
  inputB.ownerDocument = document;
  inputB.setAttribute("data-checklist-input", "");
  inputB.setAttribute("data-checklist-key", "consigne-1:item-b");
  hostB.appendChild(inputB);
  root.appendChild(hostB);

  const hidden = new MockHiddenInput();
  hidden.ownerDocument = document;
  hidden.setAttribute("data-checklist-state", "1");
  hidden.value = JSON.stringify({ items: [false, false], skipped: [false, false] });
  root.appendChild(hidden);

  return { root, inputA, inputB, hidden };
}

(async function runTest() {
  global.window = {};
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

  let persistCalls = 0;
  global.window.AppCtx = { user: { uid: "user-1" }, db: {} };
  global.window.ChecklistState = {
    async loadSelection() {
      return { selectedIds: ["consigne-1:item-b"] };
    },
    async persistRoot() {
      persistCalls += 1;
      return null;
    },
  };

  require("../checklist-fix.js");

  await global.window.hydrateChecklist({ container: root, consigneId: "consigne-1", itemKeyAttr: "data-key" });

  assert.strictEqual(inputB.checked, true, "The saved key should restore the matching checkbox");
  assert.strictEqual(
    inputB.getAttribute("data-key"),
    "consigne-1:item-b",
    "Hydration should assign a stable data-key attribute"
  );
  assert.strictEqual(
    inputA.getAttribute("data-key"),
    "consigne-1:item-a",
    "Inputs without data-key should receive one during hydration"
  );

  inputA.checked = true;
  const changeEvent = { type: "change", target: inputA };
  root.dispatchEvent(changeEvent);

  assert.strictEqual(persistCalls, 1, "Persist should be triggered after a change event");
  assert.strictEqual(inputA.getAttribute("data-key"), "consigne-1:item-a");
  assert.strictEqual(root.dataset.checklistDirty, "1", "The checklist should be marked dirty after a change");

  const payload = JSON.parse(hidden.value || "[]");
  const items = Array.isArray(payload.items) ? payload.items : payload;
  assert.strictEqual(items[0], false, "Hydration should leave untouched items unchecked before edits");

  // Second scenario: ensure answers map hydrates when no selectedIds are present.
  require("../utils/checklist-state.js");
  const manager = global.window.ChecklistState;
  manager.loadSelection = async () => ({
    consigneId: "consigne-1",
    selectedIds: [],
    answers: {
      "consigne-1:item-b": { value: "yes", skipped: false },
    },
    optionsHash: "hash-1",
  });
  manager.persistRoot = async () => {
    persistCalls += 1;
    return null;
  };

  const { root: root2, inputA: inputA2, inputB: inputB2, hidden: hidden2 } = buildChecklistDom(global.document);
  global.document.body.appendChild(root2);

  await global.window.hydrateChecklist({ container: root2, consigneId: "consigne-1", itemKeyAttr: "data-key" });

  assert.strictEqual(inputB2.checked, true, "Checklist answers map should hydrate checked items");
  assert.strictEqual(inputA2.checked, false, "Unanswered items should remain unchecked");
  const payload2 = JSON.parse(hidden2.value || "[]");
  const items2 = Array.isArray(payload2.items) ? payload2.items : payload2;
  assert.strictEqual(items2[1], true, "Serialized state should reflect hydrated answers");

  console.log("Checklist hydration tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
