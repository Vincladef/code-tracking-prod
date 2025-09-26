function pluralize(count, singular, plural = null) {
  if (count === 1) return singular;
  return plural || `${singular}s`;
}

function buildReminderBody(firstName, consigneCount, objectiveCount) {
  const prefix = firstName ? `${firstName}, ` : "";
  if (consigneCount === 0 && objectiveCount === 0) {
    return `${prefix}tu n’as rien à remplir aujourd’hui.`;
  }
  const consigneLabel = pluralize(consigneCount, "consigne");
  const objectiveLabel = pluralize(objectiveCount, "objectif");
  return `${prefix}tu as ${consigneCount} ${consigneLabel} et ${objectiveCount} ${objectiveLabel} à remplir aujourd’hui.`;
}

module.exports = { buildReminderBody };
