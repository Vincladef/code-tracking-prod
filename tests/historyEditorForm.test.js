const assert = require("assert");
global.window = global.window || {};
global.window.CSS = global.window.CSS || { escape: (value) => value };
global.window.Modes = global.window.Modes || {};
global.Modes = global.window.Modes;
global.Schema = global.Schema || {};
global.Schema.firestore = global.Schema.firestore || {};
global.window.HistoryStore = global.window.HistoryStore || {
  configure: () => {},
  ensure: async () => [],
  upsert: () => {},
  remove: () => {},
  invalidate: () => {},
  getEntry: () => null,
};
global.HistoryStore = global.window.HistoryStore;
global.document = global.document || {
  readyState: "complete",
  addEventListener: () => {},
  querySelectorAll: () => [],
};

class FakeElement {}
global.Element = global.Element || FakeElement;
global.HTMLElement = global.HTMLElement || FakeElement;

const Modes = require("../modes.js");

const { renderConsigneValueField, readConsigneValueFromForm, reloadConsigneHistory, logConsigneSnapshot } = Modes.__test__;

function createElement(tag, attributes = {}) {
  const element = Object.create(FakeElement.prototype);
  Object.assign(element, {
    tagName: tag.toUpperCase(),
    attributes: { ...attributes },
    dataset: {},
    children: [],
    parent: null,
    value: attributes.value != null ? String(attributes.value) : "",
    appendChild(child) {
      child.parent = this;
      this.children.push(child);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name.startsWith("data-")) {
        const dataKey = name
          .slice(5)
          .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[dataKey] = String(value);
      }
    },
    querySelector(selector) {
      return findFirst(this, selector);
    },
    querySelectorAll(selector) {
      return findAll(this, selector);
    },
  });
  Object.keys(element.attributes).forEach((key) => {
    if (key.startsWith("data-")) {
      const dataKey = key
        .slice(5)
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      element.dataset[dataKey] = String(element.attributes[key]);
    }
  });
  return element;
}

function selectorParts(selector) {
  const matches = selector.match(/\[[^\]]+\]/g) || [];
  return matches.map((part) => part.slice(1, -1));
}

function matches(element, selector) {
  const parts = selectorParts(selector);
  if (!parts.length) {
    return false;
  }
  return parts.every((part) => {
    const [attr, rawValue] = part.split("=");
    if (rawValue === undefined) {
      return element.attributes.hasOwnProperty(attr);
    }
    const expected = rawValue.replace(/^"|"$/g, "");
    return element.attributes[attr] === expected;
  });
}

function findFirst(root, selector) {
  if (matches(root, selector)) {
    return root;
  }
  for (const child of root.children) {
    const found = findFirst(child, selector);
    if (found) return found;
  }
  return null;
}

function findAll(root, selector, acc = []) {
  if (matches(root, selector)) {
    acc.push(root);
  }
  root.children.forEach((child) => findAll(child, selector, acc));
  return acc;
}

(function runHistoryFormTests() {

  const parentConsigne = { id: "parent-1", type: "likert6" };
  const childConsigne = { id: "child-1", type: "short" };

  const parentMarkup = renderConsigneValueField(parentConsigne, "", "parent-field", {
    fieldName: "history-value",
    ownerId: parentConsigne.id,
  });
  assert.ok(
    parentMarkup.includes('data-history-field="history-value"'),
    "le rendu parent doit exposer data-history-field",
  );
  assert.ok(
    parentMarkup.includes('data-history-consigne="parent-1"'),
    "le rendu parent doit exposer data-history-consigne",
  );

  const form = createElement("form");

  const parentField = createElement("select", {
    name: "history-value",
    "data-history-field": "history-value",
    "data-history-consigne": parentConsigne.id,
  });
  parentField.value = "rather_no";

  const childWrapper = createElement("div", {
    "data-history-child": "child-dom",
  });
  const childFieldName = `history-child-${childConsigne.id}`;
  const childField = createElement("input", {
    name: childFieldName,
    value: "Nouvelle note",
    "data-history-field": childFieldName,
    "data-history-consigne": childConsigne.id,
  });
  childField.value = "Nouvelle note";

  childWrapper.appendChild(childField);
  form.appendChild(parentField);
  form.appendChild(childWrapper);

  form.elements = {
    [parentField.getAttribute("name")]: parentField,
    [childFieldName]: childField,
  };

  const parentValue = readConsigneValueFromForm(parentConsigne, form);
  const childValue = readConsigneValueFromForm(childConsigne, childWrapper);

  assert.strictEqual(parentValue, "rather_no", "La valeur likert6 doit être lue correctement");
  assert.strictEqual(childValue, "Nouvelle note", "La valeur texte du champ enfant doit être récupérée");

  console.log("History editor form tests passed.");
})();

(async function runHistoryReloadTests() {
  const ensureCalls = [];
  global.window.HistoryStore.ensure = async (consigneId, options = {}) => {
    ensureCalls.push({ consigneId, options });
    return [{ historyId: "entry-1", value: "ok" }];
  };
  const ctx = { db: {}, user: { uid: "user-1" } };
  const results = await reloadConsigneHistory(ctx, "consigne-1");
  assert.strictEqual(ensureCalls.length, 1, "reloadConsigneHistory doit appeler HistoryStore.ensure une fois");
  assert.strictEqual(ensureCalls[0].options.force, true, "reloadConsigneHistory doit forcer le rafraîchissement");
  assert.ok(Array.isArray(results), "reloadConsigneHistory doit renvoyer un tableau");
  console.log("History reload tests passed.");
})();

(function runConsigneSnapshotLogTests() {
  const captured = [];
  const originalInfo = console.info;
  const originalWarn = console.warn;
  console.info = (...args) => {
    captured.push(args);
  };
  console.warn = (...args) => {
    captured.push(args);
  };

  const consigne = { id: "consigne-visual", type: "short", text: "Consigne visu" };
  const row = createElement("div", {
    "data-consigne-id": consigne.id,
    "data-day-key": "2024-01-01",
  });
  const title = createElement("span", { "data-consigne-title": "" });
  title.textContent = consigne.text;
  row.appendChild(title);
  const statusHolder = createElement("span", {
    "data-status": "na",
    "data-priority-tone": "neutral",
  });
  const statusDot = createElement("span", {
    "data-status-dot": "",
    "data-status": "na",
    "data-priority-tone": "neutral",
  });
  statusHolder.appendChild(statusDot);
  row.appendChild(statusHolder);
  const historyContainer = createElement("div", { "data-consigne-history": "" });
  const track = createElement("div", { "data-consigne-history-track": "" });
  const item = createElement("div", {
    "data-history-day": "2024-01-01",
    "data-status": "na",
    "data-history-id": "h-1",
    "data-history-response-id": "r-1",
  });
  track.appendChild(item);
  historyContainer.appendChild(track);
  row.appendChild(historyContainer);

  logConsigneSnapshot("unit.test", consigne, { row, extra: { scope: "test" } });

  console.info = originalInfo;
  console.warn = originalWarn;
  assert.ok(
    captured.some((entry) => entry && entry[0] && String(entry[0]).includes("[consigne-visual] unit.test")),
    "logConsigneSnapshot doit produire un log visuel",
  );
  console.log("Consigne snapshot log tests passed.");
})();

