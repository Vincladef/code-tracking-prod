const assert = require("assert");

global.window = global.window || {};
if (typeof global.window.Schema !== "object" || global.window.Schema === null) {
  global.window.Schema = {};
}
global.Schema = global.window.Schema;

const Schema = require("../schema");

const normalizeChecklistItemPayload = Schema?.__test__?.normalizeChecklistItemPayload;

if (typeof normalizeChecklistItemPayload !== "function") {
  console.error("normalizeChecklistItemPayload helper unavailable");
  process.exitCode = 1;
} else {
  function testPreservesExplicitIds() {
    const items = ["Alpha", "Beta", "Gamma"];
    const ids = ["id-1", "id-2", "id-3"];
    const normalized = normalizeChecklistItemPayload(items, ids);
    assert.deepStrictEqual(normalized.items, ["Alpha", "Beta", "Gamma"], "La normalisation ne doit pas modifier les libellés valides");
    assert.deepStrictEqual(normalized.ids, ["id-1", "id-2", "id-3"], "Les identifiants explicites doivent être conservés");
  }

  function testAllowsDuplicateLabelsWithDifferentIds() {
    const items = ["Revue", "Revue", "Revue"];
    const ids = ["rev-1", "rev-2", "rev-3"];
    const normalized = normalizeChecklistItemPayload(items, ids);
    assert.deepStrictEqual(normalized.items, ["Revue", "Revue", "Revue"], "Les libellés dupliqués doivent rester présents");
    assert.deepStrictEqual(normalized.ids, ["rev-1", "rev-2", "rev-3"], "Chaque doublon doit conserver son identifiant dédié");
  }

  function testGeneratesMissingIdsWithoutTouchingExistingOnes() {
    const items = ["Plan", "Faire", "Relire"];
    const ids = ["plan-id", "", null];
    const normalized = normalizeChecklistItemPayload(items, ids);
    assert.strictEqual(normalized.ids[0], "plan-id", "L’identifiant existant doit être conservé");
    assert.ok(normalized.ids[1] && normalized.ids[1] !== "plan-id", "Un nouvel identifiant doit être généré pour la deuxième entrée");
    assert.ok(normalized.ids[2] && normalized.ids[2] !== normalized.ids[1], "Chaque identifiant généré doit être unique");
  }

  try {
    testPreservesExplicitIds();
    testAllowsDuplicateLabelsWithDifferentIds();
    testGeneratesMissingIdsWithoutTouchingExistingOnes();
    console.log("Checklist ID stability tests passed.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

