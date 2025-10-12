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

const {
  readConsigneCurrentValue,
  dotColor,
  buildChecklistValue,
  sanitizeChecklistItems,
  readChecklistStates,
  readChecklistSkipped,
} = require("../modes.js");

function testChecklistValueRemainsNullUntilDirty() {
  const consigne = { id: "c1", type: "checklist" };
  const hidden = {
    value: JSON.stringify({ items: [false, false], skipped: [false, false] }),
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
  hidden.value = JSON.stringify({ items: [true, false], skipped: [false, false] });
  const afterDirty = readConsigneCurrentValue(consigne, scope);
  assert.deepStrictEqual(
    afterDirty,
    { items: [true, false] },
    "Une checklist marquée sale doit retourner les cases cochées"
  );
}

function testReadConsigneCurrentValueKeepsSkippedItems() {
  const consigne = { id: "c2", type: "checklist" };
  const hidden = {
    value: JSON.stringify({ items: [true, true, false], skipped: [true, false, false] }),
    dataset: { dirty: "1" },
  };
  const scope = {
    querySelector: (selector) => {
      if (selector === '[name="checklist:c2"]') {
        return hidden;
      }
      return null;
    },
  };
  const value = readConsigneCurrentValue(consigne, scope);
  assert.deepStrictEqual(
    value,
    { items: [true, true, false], skipped: [true, false, false] },
    "Les éléments passés doivent rester marqués lors de la lecture"
  );
}

function testDotColorTreatsNullAsNa() {
  assert.strictEqual(dotColor("checklist", null), "na", "La couleur d’un état neutre doit rester grise");
}

function testDotColorSignalsAllUncheckedAsKo() {
  assert.strictEqual(
    dotColor("checklist", { items: [false, false, false] }),
    "ko-strong",
    "Une checklist explicitement décochée doit s’afficher en rouge",
  );
}

function testBuildChecklistValueRespectsConsigneLabels() {
  const consigne = { checklistItems: ["  Première ", "Deuxième", ""] };
  const built = buildChecklistValue(consigne, [true, false, true]);
  assert.deepStrictEqual(
    built,
    { items: [true, false], labels: ["Première", "Deuxième"] },
    "Les labels de consigne doivent être nettoyés et faire correspondre les états",
  );
}

function testBuildChecklistValueKeepsSkippedStates() {
  const consigne = { checklistItems: ["Alpha", "Beta", "Gamma"] };
  const built = buildChecklistValue(consigne, {
    items: [true, false, true],
    skipped: [false, true, false],
  });
  assert.deepStrictEqual(
    built,
    {
      labels: ["Alpha", "Beta", "Gamma"],
      items: [true, false, true],
      skipped: [false, true, false],
    },
    "Les états passés doivent être conservés lors de la normalisation",
  );
}

function testBuildChecklistValueSupportsSkipStatesAlias() {
  const consigne = { checklistItems: ["Un", "Deux"] };
  const built = buildChecklistValue(consigne, {
    items: [true, false],
    skipStates: [false, true],
  });
  assert.deepStrictEqual(
    built,
    {
      labels: ["Un", "Deux"],
      items: [true, false],
      skipped: [false, true],
    },
    "Les états passés doivent être restaurés même lorsqu’ils proviennent de skipStates",
  );
}

function testReadChecklistStatesNormalizesValues() {
  const states = readChecklistStates({ items: [true, "yes", 1, false] });
  assert.deepStrictEqual(
    states,
    [true, false, false, false],
    "Seules les valeurs booléennes strictes doivent être conservées",
  );
}

function testReadChecklistSkippedNormalizesValues() {
  const skipped = readChecklistSkipped({ skipped: ["yes", true, 1, false] });
  assert.deepStrictEqual(
    skipped,
    [false, true, false, false],
    "Les éléments passés doivent être convertis en booléens",
  );
}

function testSanitizeChecklistItemsDropsEmptyEntries() {
  const consigne = { checklistItems: ["Alpha", "", "  ", "Beta"] };
  assert.deepStrictEqual(
    sanitizeChecklistItems(consigne),
    ["Alpha", "Beta"],
    "Les libellés vides ou blancs doivent être filtrés",
  );
}

try {
  testChecklistValueRemainsNullUntilDirty();
  testReadConsigneCurrentValueKeepsSkippedItems();
  testDotColorTreatsNullAsNa();
  testDotColorSignalsAllUncheckedAsKo();
  testBuildChecklistValueRespectsConsigneLabels();
  testBuildChecklistValueKeepsSkippedStates();
  testBuildChecklistValueSupportsSkipStatesAlias();
  testReadChecklistStatesNormalizesValues();
  testReadChecklistSkippedNormalizesValues();
  testSanitizeChecklistItemsDropsEmptyEntries();
  console.log("All checklist status tests passed.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
