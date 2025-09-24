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
  assertEqual(JSON.stringify(aprilWeeks), JSON.stringify([1, 2, 3, 4]), "Avril 2023 devrait compter 4 semaines sans doublon");

  const mayWeeks = weeksOf("2021-05");
  assertEqual(JSON.stringify(mayWeeks), JSON.stringify([1, 2, 3, 4]), "Mai 2021 devrait compter 4 semaines sans doublon");

  const october2025Weeks = weeksOf("2025-10");
  assertEqual(JSON.stringify(october2025Weeks), JSON.stringify([1, 2, 3, 4, 5]), "Octobre 2025 devrait compter 5 semaines");

  const september2025Weeks = weeksOf("2025-09");
  assertEqual(
    JSON.stringify(september2025Weeks),
    JSON.stringify([1, 2, 3, 4]),
    "Septembre 2025 ne doit pas contenir la semaine partagée avec octobre",
  );

  const augustRange = weekDateRange("2020-08", 1);
  assert(augustRange, "La première semaine d’août 2020 doit être définie");
  assertEqual(
    augustRange.label,
    "Semaine du 03 au 09 août",
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
    "Semaine du 23 au 29 octobre",
    "Libellé de la quatrième semaine d’octobre 2023 incorrect",
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

  const aprilLastRange = weekDateRange("2023-04", 4);
  assert(aprilLastRange, "La dernière semaine d’avril 2023 doit être définie");
  assertEqual(
    aprilLastRange.label,
    "Semaine du 24 au 30 avril",
    "Libellé de la dernière semaine d’avril 2023 incorrect",
  );
  assertEqual(
    aprilLastRange.start.getDay(),
    1,
    "La dernière semaine d’avril 2023 doit commencer un lundi",
  );
  assertEqual(
    aprilLastRange.end.getDay(),
    0,
    "La dernière semaine d’avril 2023 doit se terminer un dimanche",
  );

  const septemberFirstRange = weekDateRange("2020-09", 1);
  assert(septemberFirstRange, "La première semaine de septembre 2020 doit être définie");
  assertEqual(
    septemberFirstRange.label,
    "Semaine du 31 août au 06 septembre",
    "Libellé de la première semaine de septembre 2020 incorrect",
  );
  assertEqual(
    septemberFirstRange.start.getDay(),
    1,
    "La première semaine de septembre 2020 doit commencer un lundi",
  );
  assertEqual(
    septemberFirstRange.end.getDay(),
    0,
    "La première semaine de septembre 2020 doit se terminer un dimanche",
  );

  const october2025FirstRange = weekDateRange("2025-10", 1);
  assert(october2025FirstRange, "La première semaine d’octobre 2025 doit être définie");
  assertEqual(
    october2025FirstRange.label,
    "Semaine du 29 septembre au 05 octobre",
    "Libellé de la première semaine d’octobre 2025 incorrect",
  );

  const september2025LastRange = weekDateRange("2025-09", 4);
  assert(september2025LastRange, "La dernière semaine de septembre 2025 doit être définie");
  assertEqual(
    september2025LastRange.label,
    "Semaine du 22 au 28 septembre",
    "Libellé de la dernière semaine de septembre 2025 incorrect",
  );

  assertEqual(
    weekOfMonthFromDate(new Date("2020-08-02")),
    5,
    "Le 2 août 2020 devrait appartenir à la cinquième semaine de juillet",
  );
  assertEqual(
    weekOfMonthFromDate(new Date("2020-08-10")),
    2,
    "Le 10 août 2020 devrait appartenir à la deuxième semaine d’août",
  );
  assertEqual(
    weekOfMonthFromDate(new Date("2025-09-29")),
    1,
    "Le 29 septembre 2025 devrait appartenir à la première semaine d’octobre",
  );
}

try {
  runTests();
  console.log("All week range tests passed.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
