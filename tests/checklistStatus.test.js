const assert = require("assert");

function setupDomStubs() {
  const noop = () => {};
  global.window = {
    Modes: {},
    firestoreAPI: {},
    addEventListener: noop,
    removeEventListener: noop,
    requestAnimationFrame: (cb) => {
      if (typeof cb === "function") {
        cb();
      }
      return 0;
    },
    cancelAnimationFrame: noop,
    __appBadge: null,
  };
  global.Modes = global.window.Modes;
  global.Schema = {
    firestore: {},
    DAY_ALIAS: {},
    DAY_VALUES: new Set(),
    D: {},
  };
  const createElement = (tag = "") => ({
    tagName: String(tag).toUpperCase(),
    innerHTML: "",
    content: {
      innerHTML: "",
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    appendChild: noop,
    removeChild: noop,
    insertBefore: noop,
    setAttribute: noop,
    removeAttribute: noop,
    addEventListener: noop,
    removeEventListener: noop,
    append: noop,
    remove: noop,
    replaceWith: noop,
    classList: { add: noop, remove: noop },
    style: {},
    dataset: {},
    firstChild: null,
    lastChild: null,
  });
  global.document = {
    createElement,
    createTreeWalker: () => ({
      currentNode: null,
      nextNode: () => false,
    }),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild: noop },
  };
  global.window.document = global.document;
  global.Node = { TEXT_NODE: 3 };
  global.NodeFilter = { SHOW_ELEMENT: 1 };
  global.Element = function Element() {};
  global.HTMLTextAreaElement = function HTMLTextAreaElement() {};
  global.Event = function Event() {};
  global.performance = { now: () => 0 };
}

setupDomStubs();

const { readConsigneCurrentValue, dotColor, collectAnswers } = require("../modes.js");

function testChecklistValueRemainsNullUntilDirty() {
  const consigne = { id: "c1", type: "checklist" };
  const hidden = {
    value: JSON.stringify([false, false]),
    dataset: {},
  };
  const scope = {
    querySelector: (selector) => {
      if (selector === '[name="checklist:c1"]') {
        return hidden;
      }
      return null;
    },
  };
  const initial = readConsigneCurrentValue(consigne, scope);
  assert.strictEqual(initial, null, "Une checklist neuve doit retourner null tant qu’elle est propre");

  hidden.dataset.dirty = "1";
  hidden.value = JSON.stringify([true, false]);
  const afterDirty = readConsigneCurrentValue(consigne, scope);
  assert.deepStrictEqual(afterDirty, [true, false], "Une checklist marquée sale doit retourner les cases cochées");
}

function testDotColorTreatsNullAsNa() {
  assert.strictEqual(dotColor("checklist", null), "na", "La couleur d’un état neutre doit rester grise");
}

function testDotColorSignalsAllUncheckedAsKo() {
  assert.strictEqual(
    dotColor("checklist", [false, false, false]),
    "ko-strong",
    "Une checklist explicitement décochée doit s’afficher en rouge",
  );
}

function testCollectAnswersFallsBackToCheckboxes() {
  const consigne = { id: "c1", type: "checklist" };
  const hidden = {
    value: JSON.stringify([false, false]),
    dataset: {},
  };
  const boxes = [{ checked: true }, { checked: false }];
  const container = {
    querySelectorAll: (selector) => {
      if (selector === "[data-checklist-input]") {
        return boxes;
      }
      return [];
    },
  };
  const form = {
    querySelector: (selector) => {
      if (selector === '[name="checklist:c1"]') {
        return hidden;
      }
      if (selector === '[data-checklist-root][data-consigne-id="c1"]') {
        return container;
      }
      return null;
    },
  };
  const answers = collectAnswers(form, [consigne]);
  assert.strictEqual(answers.length, 1, "Une checklist cochée doit produire une réponse");
  assert.deepStrictEqual(
    answers[0].value,
    [true, false],
    "La réponse doit refléter l’état des cases à cocher",
  );
}

try {
  testChecklistValueRemainsNullUntilDirty();
  testDotColorTreatsNullAsNa();
  testDotColorSignalsAllUncheckedAsKo();
  testCollectAnswersFallsBackToCheckboxes();
  console.log("All checklist status tests passed.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
