const assert = require("assert");

// Minimal stubs
const noop = () => {};

global.window = Object.assign(global.window || {}, {
  firestoreAPI: {},
  setTimeout: global.setTimeout,
  clearTimeout: global.clearTimeout,
  addEventListener: noop,
  removeEventListener: noop,
});

global.document = {
  createElement: () => ({
    style: {},
    classList: { add: noop, remove: noop },
    setAttribute: noop,
    appendChild: noop,
    remove: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
  }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop,
  removeEventListener: noop,
  body: { appendChild: noop },
};

global.localStorage = {
  getItem: () => null,
  setItem: noop,
  removeItem: noop,
};

global.navigator = {};

global.Schema = {
  firestore: {},
  D: { info: noop, group: noop, groupEnd: noop, debug: noop, warn: noop, error: noop },
  DAY_ALIAS: { mon: "LUN", tue: "MAR", wed: "MER", thu: "JEU", fri: "VEN", sat: "SAM", sun: "DIM" },
  DAY_VALUES: new Set(["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"]),
};

// Firestore compat stubs used by schema
const savedDocs = [];
Schema.firestore = {
  collection: (...parts) => ({ __path: parts.join("/") }),
  doc: (...parts) => ({ __docPath: parts.join("/") }),
  setDoc: async () => {},
  getDoc: async () => ({ exists: false, data: () => ({}) }),
  getDocs: async () => ({ docs: [] }),
  addDoc: async (colRef, payload) => {
    savedDocs.push({ colRef, payload });
    return { id: Math.random().toString(36).slice(2) };
  },
  deleteDoc: async () => {},
  query: (...args) => ({ args }),
  where: (...args) => ({ where: args }),
  orderBy: (...args) => ({ orderBy: args }),
  updateDoc: async () => {},
  limit: (n) => n,
  serverTimestamp: () => new Date(),
  deleteField: () => ({ __delete__: true }),
  runTransaction: async (db, fn) => fn({}),
  Timestamp: { fromDate: (d) => d },
};

// Load schema after globals are ready
require("../schema.js");

(function runTests() {
  // Prepare input answers without dayKey in practice mode
  const answers = [
    {
      consigne: { id: "c1", type: "likert6", category: "Général" },
      value: "yes",
      // no dayKey on purpose
      sessionIndex: 0,
      sessionNumber: 1,
      sessionId: "session-0001",
    },
  ];

  // Invoke saveResponses through global Schema
  return Schema
    .saveResponses({}, "u1", "practice", answers)
    .then(() => {
      // Verify a response was captured and includes a non-null dayKey
      assert(savedDocs.length > 0, "A response document should have been created");
      const created = savedDocs.find((d) => /u\/u1\/responses$/.test(String(d.colRef.__path)));
      assert(created, "Response should be saved under u/u1/responses");
      assert.strictEqual(
        typeof created.payload.dayKey,
        "string",
        "dayKey must be set on response payload"
      );
      assert(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(created.payload.dayKey), "dayKey must be YYYY-MM-DD");

      // registerRecentResponses should derive and store dayKey too
      const store = window.__hpRecentResponses;
      assert(store instanceof Map, "Recent response store must be a Map");
      const list = store.get("c1") || [];
      assert(list.length >= 1, "Recent responses should include saved entry");
      const first = list[0];
      assert.strictEqual(typeof first.dayKey, "string", "Recent entry must carry dayKey");
      assert(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(first.dayKey), "Recent dayKey must be YYYY-MM-DD");

      console.log("Practice dayKey persistence test passed.");
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
})();
