const assert = require("assert");

global.window = global.window || {};
global.window.DateUtils = global.window.DateUtils || {};

global.console = global.console || console;

require("../utils/dates.js");

const { asDate } = global.window.DateUtils;

(function runTests() {
  assert.strictEqual(asDate(null), null, "Null values should return null");
  assert.strictEqual(asDate(undefined), null, "Undefined values should return null");
  assert.strictEqual(asDate(0), null, "Zero should be treated as an invalid timestamp");

  const ms = Date.UTC(2023, 9, 22);
  const fromMillis = asDate(ms);
  assert(fromMillis instanceof Date, "Millisecond input should return a Date instance");
  assert.strictEqual(fromMillis.getTime(), ms, "Millisecond input should not be altered");

  const fromSeconds = asDate(ms / 1000);
  assert(fromSeconds instanceof Date, "Second input should return a Date instance");
  assert.strictEqual(fromSeconds.getTime(), ms, "Second input should be normalized to milliseconds");

  const timestampStub = { seconds: Math.floor(ms / 1000), nanoseconds: 500000000 };
  const fromTimestamp = asDate(timestampStub);
  assert(fromTimestamp instanceof Date, "Timestamp-like object should return a Date instance");
  assert.strictEqual(fromTimestamp.getTime(), ms + 500, "Nanoseconds should be converted to milliseconds");

  const toDateStub = { toDate: () => new Date(ms) };
  const fromToDate = asDate(toDateStub);
  assert(fromToDate instanceof Date, "Objects exposing toDate should be supported");
  assert.strictEqual(fromToDate.getTime(), ms, "toDate values should be preserved");

  const iso = "2023-10-22T12:34:00Z";
  const fromIso = asDate(iso);
  assert(fromIso instanceof Date, "ISO strings should be parsed");
  assert.strictEqual(fromIso.toISOString(), "2023-10-22T12:34:00.000Z");

  const blank = asDate("   ");
  assert.strictEqual(blank, null, "Blank strings should return null");

  console.log("Date utils asDate tests passed.");
})();
