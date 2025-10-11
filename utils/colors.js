(() => {
  const root = (window.ColorUtils = window.ColorUtils || {});

  function clampNumber(value, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return min;
    }
    if (num <= min) return min;
    if (num >= max) return max;
    return num;
  }

  root.checklistColor = function checklistColor(pct) {
    const safe = clampNumber(pct, 0, 100);
    if (safe < 20) return "red";
    if (safe < 40) return "red-light";
    if (safe < 60) return "yellow";
    if (safe < 80) return "green-light";
    return "green";
  };
})();
