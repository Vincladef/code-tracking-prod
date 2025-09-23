/* eslint-disable no-console */

if (typeof global.window === "undefined") {
  global.window = { Schema: {}, firebase: null };
} else {
  global.window.Schema = global.window.Schema || {};
  global.window.firebase = global.window.firebase || null;
}

global.Schema = global.window.Schema;
if (typeof global.window.console === "undefined") {
  global.window.console = console;
}

const {
  weeksOf,
  weekDateRange,
  weekOfMonthFromDate,
} = require("../schema.js");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (attendu: ${expected}, obtenu: ${actual})`);
  }
}

function runTests() {
  const aprilWeeks = weeksOf("2023-04");
  assertEqual(JSON.stringify(aprilWeeks), JSON.stringify([1, 2, 3, 4, 5]), "Avril 2023 devrait compter 5 semaines");

  const augustRange = weekDateRange("2020-08", 1);
  assert(augustRange, "La première semaine d’août 2020 doit être définie");
  assertEqual(
    augustRange.label,
    "Semaine du 27 juillet au 02 août",
    "Libellé de la première semaine d’août 2020 incorrect",
  );

  const septemberRange = weekDateRange("2023-09", 5);
  assert(septemberRange, "La cinquième semaine de septembre 2023 doit être définie");
  assertEqual(
    septemberRange.label,
    "Semaine du 25 au 30 septembre",
    "Libellé de la dernière semaine de septembre 2023 incorrect",
  );

  assertEqual(
    weekOfMonthFromDate(new Date("2020-08-02")),
    1,
    "Le 2 août 2020 devrait appartenir à la première semaine",
  );
  assertEqual(
    weekOfMonthFromDate(new Date("2020-08-03")),
    2,
    "Le 3 août 2020 devrait appartenir à la deuxième semaine",
  );
}

try {
  runTests();
  console.log("All week range tests passed.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
