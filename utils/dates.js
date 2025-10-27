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

  const MILLIS_EPOCH_THRESHOLD = Date.UTC(2000, 0, 1);

  function normalizeDateInstance(date) {
    if (!(date instanceof Date)) {
      return null;
    }
    const time = date.getTime();
    if (!Number.isFinite(time) || time <= 0 || time < MILLIS_EPOCH_THRESHOLD) {
      return null;
    }
    return new Date(time);
  }

  function fallbackAsDate(value) {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return normalizeDateInstance(value);
    }
    if (typeof value.toDate === "function") {
      try {
        const viaToDate = value.toDate();
        const normalized = normalizeDateInstance(viaToDate);
        if (normalized) {
          return normalized;
        }
      } catch (error) {
        console.warn("date.asDate.toDate", error);
      }
    }
    if (typeof value.toMillis === "function") {
      try {
        const millis = value.toMillis();
        if (Number.isFinite(millis)) {
          return fallbackAsDate(millis);
        }
      } catch (error) {
        console.warn("date.asDate.toMillis", error);
      }
    }
    if (typeof value === "object") {
      const seconds =
        typeof value.seconds === "number"
          ? value.seconds
          : typeof value._seconds === "number"
          ? value._seconds
          : null;
      if (seconds && Number.isFinite(seconds)) {
        const nanosRaw =
          typeof value.nanoseconds === "number"
            ? value.nanoseconds
            : typeof value._nanoseconds === "number"
            ? value._nanoseconds
            : 0;
        const nanos = Number.isFinite(nanosRaw) ? nanosRaw : 0;
        const millis = seconds * 1000 + Math.floor(nanos / 1e6);
        if (millis > 0) {
          return fallbackAsDate(millis);
        }
      }
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const normalized = value < 1e12 ? value * 1000 : value;
      if (!Number.isFinite(normalized) || normalized <= 0) {
        return null;
      }
      const date = new Date(normalized);
      return normalizeDateInstance(date);
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return fallbackAsDate(numeric);
      }
      const parsed = new Date(trimmed);
      return normalizeDateInstance(parsed);
    }
    return null;
  }

  DateUtils.asDate = function asDate(value) {
    const external = typeof window?.DateUtils?.asDate === "function" && window.DateUtils !== DateUtils
      ? window.DateUtils.asDate
      : null;
    if (external && external !== asDate) {
      try {
        const resolved = external(value);
        if (resolved instanceof Date && !Number.isNaN(resolved.getTime())) {
          return new Date(resolved.getTime());
        }
        if (resolved == null) {
          return null;
        }
        if (typeof resolved === "number" && Number.isFinite(resolved)) {
          const viaNumber = new Date(resolved);
          return Number.isNaN(viaNumber.getTime()) ? null : viaNumber;
        }
        if (typeof resolved === "string") {
          const viaString = new Date(resolved);
          return Number.isNaN(viaString.getTime()) ? null : viaString;
        }
      } catch (error) {
        console.warn("date.asDate.external", error);
      }
    }
    return fallbackAsDate(value);
  };

  DateUtils.dayKeyParis = function dayKeyParis(input) {
    const timestamp = normalizeInput(input);
    const formatted = DAY_KEY_FORMATTER.format(timestamp);
    const [day, month, year] = formatted.split("/");
    if (!day || !month || !year) {
      return "";
    }
    return `${year}-${month}-${day}`;
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = DateUtils;
  }
})();
