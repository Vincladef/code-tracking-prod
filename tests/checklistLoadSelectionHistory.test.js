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
  assert.deepStrictEqual(result.selectedIds, [], "Previous-day selections must not auto-apply");
  assert.deepStrictEqual(result.answers, {}, "Answers from previous days should not auto-apply");
  assert.strictEqual(
    result.previousDateKey,
    "2024-05-01",
    "The payload should expose the original date for hint rendering"
  );

  console.log("Checklist history load test passed.");
})();
