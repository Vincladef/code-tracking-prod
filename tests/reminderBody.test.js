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
    "tu as 1 objectif à remplir aujourd’hui.",
    "Le message doit se concentrer sur les objectifs lorsqu’il n’y a pas de consignes",
  );

  assertEqual(
    buildReminderBody("Paul", 0, 0),
    "Paul, tu n’as rien à remplir aujourd’hui.",
    "Le message de repli doit être utilisé lorsque tous les compteurs sont nuls",
  );

  assertEqual(
    buildReminderBody("Claire", 0, 0, { weekly: true }),
    "Claire, tu n’as rien à remplir aujourd’hui. Pense aussi à ton bilan de la semaine.",
    "Le rappel hebdo doit s’ajouter même en absence de consignes",
  );

  assertEqual(
    buildReminderBody("", 2, 1, { weekly: true, monthly: true }),
    "tu as 2 consignes et 1 objectif à remplir aujourd’hui. Pense aussi à ton bilan de la semaine et ton bilan du mois.",
    "Les rappels hebdo et mensuel doivent être concaténés",
  );

  assertEqual(
    buildReminderBody("", 0, 0, { yearly: true }),
    "tu n’as rien à remplir aujourd’hui. Pense aussi à ton bilan de l’année.",
    "Le rappel annuel doit être pris en compte seul",
  );

  assertEqual(
    buildReminderBody("Léa", 3, 2, { weekly: true, monthly: true, yearly: true }),
    "Léa, tu as 3 consignes et 2 objectifs à remplir aujourd’hui. Pense aussi à ton bilan de la semaine, ton bilan du mois et ton bilan de l’année.",
    "Les rappels hebdo, mensuel et annuel doivent être listés avec des virgules",
  );
}

try {
  runTests();
  console.log("All reminder body tests passed.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
