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

  const mayWeeks = weeksOf("2021-05");
  assertEqual(JSON.stringify(mayWeeks), JSON.stringify([1, 2, 3, 4, 5, 6]), "Mai 2021 devrait compter 6 semaines");

  const augustRange = weekDateRange("2020-08", 1);
  assert(augustRange, "La première semaine d’août 2020 doit être définie");
  assertEqual(
    augustRange.label,
    "Semaine du 27 juillet au 02 août",
    "Libellé de la première semaine d’août 2020 incorrect",
  );
  assertEqual(
    augustRange.start.getDay(),
    1,
    "La première semaine d’août 2020 doit commencer un lundi",
  );
  assertEqual(
    augustRange.end.getDay(),
    0,
    "La première semaine d’août 2020 doit se terminer un dimanche",
  );

  const octoberRange = weekDateRange("2023-10", 4);
  assert(octoberRange, "La quatrième semaine d’octobre 2023 doit être définie");
  assertEqual(
    octoberRange.label,
    "Semaine du 16 au 22 octobre",
    "Libellé de la dernière semaine d’octobre 2023 incorrect",
  );
  assertEqual(
    octoberRange.start.getDay(),
    1,
    "La quatrième semaine d’octobre 2023 doit commencer un lundi",
  );
  assertEqual(
    octoberRange.end.getDay(),
    0,
    "La quatrième semaine d’octobre 2023 doit se terminer un dimanche",
  );

  const aprilLastRange = weekDateRange("2023-04", 5);
  assert(aprilLastRange, "La cinquième semaine d’avril 2023 doit être définie");
  assertEqual(
    aprilLastRange.label,
    "Semaine du 24 au 30 avril",
    "Libellé de la cinquième semaine d’avril 2023 incorrect",
  );
  assertEqual(
    aprilLastRange.start.getDay(),
    1,
    "La cinquième semaine d’avril 2023 doit commencer un lundi",
  );
  assertEqual(
    aprilLastRange.end.getDay(),
    0,
    "La cinquième semaine d’avril 2023 doit se terminer un dimanche",
  );

  const augustLastRange = weekDateRange("2020-08", 6);
  assert(augustLastRange, "La sixième semaine d’août 2020 doit être définie");
  assertEqual(
    augustLastRange.label,
    "Semaine du 31 août au 06 septembre",
    "Libellé de la sixième semaine d’août 2020 incorrect",
  );
  assertEqual(
    augustLastRange.start.getDay(),
    1,
    "La sixième semaine d’août 2020 doit commencer un lundi",
  );
  assertEqual(
    augustLastRange.end.getDay(),
    0,
    "La sixième semaine d’août 2020 doit se terminer un dimanche",
  );

  assertEqual(
    weekOfMonthFromDate(new Date("2020-08-02")),
    1,
    "Le 2 août 2020 devrait appartenir à la première semaine",
  );
  assertEqual(
    weekOfMonthFromDate(new Date("2020-08-10")),
    3,
    "Le 10 août 2020 devrait appartenir à la troisième semaine",
  );
}

try {
  runTests();
  console.log("All week range tests passed.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
