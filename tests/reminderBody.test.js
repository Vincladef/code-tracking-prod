const { buildReminderBody } = require("../functions/reminder");

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (attendu: ${expected}, obtenu: ${actual})`);
  }
}

function runTests() {
  assertEqual(
    buildReminderBody("", 2, 3),
    "tu as 2 consignes et 3 objectifs à remplir aujourd’hui.",
    "Le message doit mentionner les compteurs au pluriel",
  );

  assertEqual(
    buildReminderBody("Marie", 1, 1),
    "Marie, tu as 1 consigne et 1 objectif à remplir aujourd’hui.",
    "Le message doit gérer le singulier et le préfixe",
  );

  assertEqual(
    buildReminderBody("", 0, 1),
    "tu as 0 consignes et 1 objectif à remplir aujourd’hui.",
    "Le message doit afficher zéro consigne explicitement",
  );

  assertEqual(
    buildReminderBody("Paul", 0, 0),
    "Paul, tu n’as rien à remplir aujourd’hui.",
    "Le message de repli doit être utilisé lorsque tous les compteurs sont nuls",
  );
}

try {
  runTests();
  console.log("All reminder body tests passed.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
