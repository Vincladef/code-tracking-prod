(() => {
  const DateUtils = (window.DateUtils = window.DateUtils || {});

  const PARIS_TIMEZONE = "Europe/Paris";
  const DAY_KEY_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  function normalizeInput(value) {
    if (value == null) {
      return Date.now();
    }
    if (value instanceof Date) {
      return value.getTime();
    }
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value.trim());
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.getTime();
      }
    }
    const fallback = new Date(value);
    const time = fallback.getTime();
    return Number.isNaN(time) ? Date.now() : time;
  }

  DateUtils.dayKeyParis = function dayKeyParis(input) {
    const timestamp = normalizeInput(input);
    const formatted = DAY_KEY_FORMATTER.format(timestamp);
    const [day, month, year] = formatted.split("/");
    if (!day || !month || !year) {
      return "";
    }
    return `${year}-${month}-${day}`;
  };
})();
