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
  normalizeMontantValue,
  normalizeConsigneValueForPersistence,
  dotColor,
} = require("../modes.js");

function createMontantConsigne(overrides = {}) {
  return {
    id: "montant-1",
    type: "montant",
    montantGoal: 20,
    montantGoalOperator: "eq",
    montantUnit: "pompes",
    ...overrides,
  };
}

function testEqualityObjectivesAreMet() {
  const consigne = createMontantConsigne();
  const normalized = normalizeMontantValue({ amount: 20 }, consigne);
  assert.deepStrictEqual(
    normalized,
    {
      kind: "montant",
      amount: 20,
      unit: "pompes",
      goal: 20,
      operator: "eq",
      progress: 1,
      met: true,
      status: "ok-strong",
    },
    "Une réponse égale à l’objectif doit être considérée atteinte avec un progrès complet",
  );
}

function testGreaterThanObjectivesComputeProgressRatio() {
  const consigne = createMontantConsigne({ montantGoal: 30, montantGoalOperator: "gte", montantUnit: "km" });
  const normalized = normalizeMontantValue({ amount: "15", unit: "km" }, consigne);
  assert.strictEqual(normalized.amount, 15, "Le montant doit être normalisé en nombre");
  assert.strictEqual(normalized.goal, 30, "L’objectif numérique doit être conservé");
  assert.strictEqual(normalized.operator, "gte", "L’opérateur doit être normalisé");
  assert.strictEqual(normalized.unit, "km", "L’unité fournie doit être privilégiée");
  assert.strictEqual(normalized.met, false, "L’objectif ne doit pas être marqué atteint sous le seuil");
  assert.ok(
    normalized.progress > 0 && normalized.progress < 1,
    "Le progrès doit être borné entre 0 et 1 lorsque le ratio est partiel",
  );
  assert.strictEqual(
    normalized.status,
    "ko-soft",
    "Un objectif supérieur partiellement atteint doit produire un statut intermédiaire négatif",
  );
}

function testMissingObjectiveFallsBackToNote() {
  const consigne = createMontantConsigne({ montantGoal: null, montantGoalOperator: "lte" });
  const normalized = normalizeMontantValue({ amount: 10 }, consigne);
  assert.strictEqual(normalized.goal, null, "Sans objectif, le champ doit rester nul");
  assert.strictEqual(normalized.operator, "lte", "L’opérateur doit être normalisé depuis la consigne");
  assert.strictEqual(normalized.status, "note", "Sans objectif numérique, le statut doit être noté");
  assert.strictEqual(normalized.progress, null, "Le progrès doit rester nul sans objectif pour comparaison");
  assert.strictEqual(normalized.met, false, "Sans objectif, l’état atteint doit rester faux");
}

function testPersistenceNormalizationProducesEvaluatedObject() {
  const consigne = createMontantConsigne();
  const row = { dataset: {} };
  const normalized = normalizeConsigneValueForPersistence(consigne, row, 15);
  assert.deepStrictEqual(
    normalized,
    {
      kind: "montant",
      amount: 15,
      unit: "pompes",
      goal: 20,
      operator: "eq",
      progress: 0.75,
      met: false,
      status: "mid",
    },
    "La persistance doit produire un objet évalué cohérent pour les montants",
  );
}

function testDotColorReflectsDistanceFromObjective() {
  const consigne = createMontantConsigne({ montantGoal: 100, montantGoalOperator: "eq" });
  assert.strictEqual(dotColor("montant", { amount: 100 }, consigne), "ok-strong", "Une réponse égale à l’objectif doit être verte");
  assert.strictEqual(dotColor("montant", { amount: 90 }, consigne), "ok-soft", "Une réponse proche doit être vert clair");
  assert.strictEqual(dotColor("montant", { amount: 65 }, consigne), "mid", "Une réponse moyenne doit être jaune");
  assert.strictEqual(dotColor("montant", { amount: 45 }, consigne), "ko-soft", "Une réponse éloignée doit tendre vers le rouge clair");
  assert.strictEqual(dotColor("montant", { amount: 10 }, consigne), "ko-strong", "Une réponse très éloignée doit être rouge");
}

try {
  testEqualityObjectivesAreMet();
  testGreaterThanObjectivesComputeProgressRatio();
  testMissingObjectiveFallsBackToNote();
  testPersistenceNormalizationProducesEvaluatedObject();
  testDotColorReflectsDistanceFromObjective();
  console.log("Montant normalization tests passed.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
