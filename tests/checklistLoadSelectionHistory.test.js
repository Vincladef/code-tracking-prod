const assert = require("assert");

(async function runTest() {
  global.window = global.window || {};
  const historyPayload = {
    selectedIds: ["consigne-1:legacy-1"],
    optionsHash: "hash-123",
    dateKey: "2024-05-01",
    answers: {
      "consigne-1:legacy-1": { value: "yes", skipped: false },
    },
  };

  const noop = () => {};
  const fakeDocSnap = { data: () => historyPayload };

  global.window.firestoreAPI = {
    collection: (db, ...segments) => ({ db, segments }),
    addDoc: noop,
    query: (...args) => ({ args }),
    where: (...args) => ({ type: "where", args }),
    orderBy: (...args) => ({ type: "orderBy", args }),
    limit: (value) => ({ type: "limit", value }),
    getDocs: async (queryDescriptor) => {
      const segments = queryDescriptor?.args?.[0]?.segments || [];
      if (segments[0] === "u" && segments[2] === "history") {
        return { docs: [fakeDocSnap] };
      }
      return { docs: [] };
    },
    serverTimestamp: () => new Date(),
    doc: () => ({}),
    getDoc: async () => ({ exists: () => false }),
    setDoc: noop,
  };

  const db = {};
  require("../utils/checklist-state.js");
  const manager = global.window.ChecklistState;
  const result = await manager.loadSelection(db, "user-1", "consigne-1");

  assert(result, "loadSelection should resolve to a payload");
  assert.strictEqual(result.consigneId, "consigne-1", "The payload should keep the consigne id");
  assert.deepStrictEqual(
    result.selectedIds,
    ["consigne-1:legacy-1"],
    "Selected ids from history should be preserved"
  );
  assert(result.answers, "History fallback should include answers");
  assert.strictEqual(
    result.answers["consigne-1:legacy-1"].value,
    "yes",
    "Checklist answers from history should be kept in the payload"
  );

  console.log("Checklist history load test passed.");
})();
