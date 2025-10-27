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

const modes = require("../modes.js");
const { parseHistoryTimelineDateInfo } = modes;
const { resolveHistoryTimelineKeyBase } = modes.__test__ || {};

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

  const millis = 1697932800000;
  const seconds = Math.floor(millis / 1000);
  const fromMillis = parseHistoryTimelineDateInfo(millis);
  assert(fromMillis && fromMillis.date instanceof Date, "Millisecond inputs should resolve");
  assert.strictEqual(fromMillis.date.getFullYear(), 2023);
  assert.strictEqual(fromMillis.date.getMonth(), 9);
  assert.strictEqual(fromMillis.date.getDate(), 22);

  const fromSeconds = parseHistoryTimelineDateInfo(seconds);
  assert(fromSeconds && fromSeconds.date instanceof Date, "Second-based inputs should be normalized");
  assert.strictEqual(fromSeconds.date.getTime(), fromMillis.date.getTime());

  const fromSecondsString = parseHistoryTimelineDateInfo(String(seconds));
  assert(
    fromSecondsString && fromSecondsString.date instanceof Date,
    "Numeric strings should be interpreted as epoch seconds"
  );
  assert.strictEqual(fromSecondsString.date.getTime(), fromMillis.date.getTime());

  const timestampStub = { seconds, nanoseconds: 0 };
  const fromTimestamp = parseHistoryTimelineDateInfo(timestampStub);
  assert(
    fromTimestamp && fromTimestamp.date instanceof Date,
    "Timestamp-like objects should convert via seconds/nanoseconds"
  );
  assert.strictEqual(fromTimestamp.date.getTime(), fromMillis.date.getTime());

  const sentinelTimestamp = { seconds: 0, nanoseconds: 0 };
  const fromSentinel = parseHistoryTimelineDateInfo(sentinelTimestamp);
  assert.strictEqual(fromSentinel, null, "Server timestamp sentinels must be ignored");

  if (typeof resolveHistoryTimelineKeyBase === "function") {
    const entryWithDocId = {
      id: "2024-10-22",
      date: "01/01",
      value: "ok",
    };
    const keyInfo = resolveHistoryTimelineKeyBase(entryWithDocId);
    assert(keyInfo, "resolveHistoryTimelineKeyBase should return an object");
    assert.strictEqual(keyInfo.dayKey, "2024-10-22", "Document id must be used as a fallback day key");
    assert(keyInfo.date instanceof Date, "Fallback using document id should yield a Date instance");
    assert.strictEqual(keyInfo.date.getFullYear(), 2024);
    assert.strictEqual(keyInfo.date.getMonth(), 9);
    assert.strictEqual(keyInfo.date.getDate(), 22);

    const preferCreatedAt = resolveHistoryTimelineKeyBase({
      dayKey: "2024-01-01",
      createdAt: new Date("2024-10-22T09:05:00.000Z"),
    });
    assert(preferCreatedAt, "resolveHistoryTimelineKeyBase should resolve entries with createdAt fallback");
    assert.strictEqual(preferCreatedAt.dayKey, "2024-10-22");
    assert.strictEqual(preferCreatedAt.date.getUTCFullYear(), 2024);
    assert.strictEqual(preferCreatedAt.date.getUTCMonth(), 9);
    assert.strictEqual(preferCreatedAt.date.getUTCDate(), 22);

    const preferNestedTimestamp = resolveHistoryTimelineKeyBase({
      dayKey: "2024-01-01",
      payload: {
        createdAt: { seconds: 1729641600, nanoseconds: 0 },
      },
      metadata: {
        sessionDayKey: "session-0010",
      },
    });
    assert(preferNestedTimestamp, "resolveHistoryTimelineKeyBase should leverage nested timestamps");
    assert.strictEqual(preferNestedTimestamp.dayKey, "2024-10-23");
    assert.strictEqual(preferNestedTimestamp.date.getUTCFullYear(), 2024);
    assert.strictEqual(preferNestedTimestamp.date.getUTCMonth(), 9);
    assert.strictEqual(preferNestedTimestamp.date.getUTCDate(), 23);
  }

  console.log("History date parsing test passed.");
})();
