const assert = require("assert");

const noop = () => {};

global.Modes = {};

global.window = {
  Modes: global.Modes,
  firestoreAPI: {},
  setTimeout: global.setTimeout,
  clearTimeout: global.clearTimeout,
  addEventListener: noop,
  removeEventListener: noop,
};

const docStub = {
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

global.document = docStub;
global.localStorage = {
  getItem: () => null,
  setItem: noop,
  removeItem: noop,
};

global.navigator = {};
global.Element = function Element() {};
global.HTMLElement = global.Element;
global.HTMLTextAreaElement = function HTMLTextAreaElement() {};

global.Schema = {
  firestore: {},
  D: { info: noop, group: noop, groupEnd: noop, debug: noop, warn: noop, error: noop },
  DAY_ALIAS: { mon: "LUN", tue: "MAR", wed: "MER", thu: "JEU", fri: "VEN", sat: "SAM", sun: "DIM" },
  DAY_VALUES: new Set(["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"]),
  dayKeyFromDate: (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  },
};

const { parseHistoryTimelineDateInfo } = require("../modes.js");

(function runTests() {
  const noYear = parseHistoryTimelineDateInfo("01/01");
  assert.strictEqual(noYear, null, "Strings without a year must not resolve to January 2001");

  const dayFirst = parseHistoryTimelineDateInfo("22/10/2024");
  assert(dayFirst && dayFirst.date instanceof Date, "Day-first format should parse to a Date instance");
  assert.strictEqual(dayFirst.date.getFullYear(), 2024);
  assert.strictEqual(dayFirst.date.getMonth(), 9);
  assert.strictEqual(dayFirst.date.getDate(), 22);

  const twoDigitYear = parseHistoryTimelineDateInfo("05/03/24");
  assert(twoDigitYear && twoDigitYear.date instanceof Date, "Two-digit years should be expanded");
  assert.strictEqual(twoDigitYear.date.getFullYear(), 2024);
  assert.strictEqual(twoDigitYear.date.getMonth(), 2);
  assert.strictEqual(twoDigitYear.date.getDate(), 5);

  const iso = parseHistoryTimelineDateInfo("2024-10-22");
  assert(iso && iso.date instanceof Date, "ISO dates should still be supported");
  assert.strictEqual(iso.date.getFullYear(), 2024);
  assert.strictEqual(iso.date.getMonth(), 9);
  assert.strictEqual(iso.date.getDate(), 22);

  console.log("History date parsing test passed.");
})();
