function pluralize(count, singular, plural = null) {
  if (count === 1) return singular;
  return plural || `${singular}s`;
}

function buildReminderBody(firstName, consigneCount, objectiveCount, options = {}) {
  const prefix = firstName ? `${firstName}, ` : "";
  if (consigneCount === 0 && objectiveCount === 0) {
    let message = `${prefix}tu n’as rien à remplir aujourd’hui.`;
    const extras = reminderExtras(options);
    if (extras) {
      message = `${message} Pense aussi à ${extras}.`;
    }
    return message;
  }
  const objectiveLabel = pluralize(objectiveCount, "objectif");
  if (consigneCount === 0) {
    let message = `${prefix}tu as ${objectiveCount} ${objectiveLabel} à remplir aujourd’hui.`;
    const extras = reminderExtras(options);
    if (extras) {
      message = `${message} Pense aussi à ${extras}.`;
    }
    return message;
  }
  const consigneLabel = pluralize(consigneCount, "consigne");
  let message = `${prefix}tu as ${consigneCount} ${consigneLabel} et ${objectiveCount} ${objectiveLabel} à remplir aujourd’hui.`;
  const extras = reminderExtras(options);
  if (extras) {
    message = `${message} Pense aussi à ${extras}.`;
  }
  return message;
}

function reminderExtras(options = {}) {
  const weekly = options && typeof options === "object" && options.weekly;
  const monthly = options && typeof options === "object" && options.monthly;
  const yearly = options && typeof options === "object" && options.yearly;
  const mentions = [];
  if (weekly) {
    mentions.push("ton bilan de la semaine");
  }
  if (monthly) {
    mentions.push("ton bilan du mois");
  }
  if (yearly) {
    mentions.push("ton bilan de l’année");
  }
  if (!mentions.length) {
    return "";
  }
  if (mentions.length === 1) {
    return mentions[0];
  }
  if (mentions.length === 2) {
    return `${mentions[0]} et ${mentions[1]}`;
  }
  const last = mentions.pop();
  return `${mentions.join(", ")} et ${last}`;
}

module.exports = { buildReminderBody };
