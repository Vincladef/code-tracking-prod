// modes.js — Journalier / Pratique / Historique
// Build/version marker to diagnose stale bundles overriding fixes
(function modesBuildTag(){
  try {
    const TAG = "v2025-10-06-02";
    const prev = typeof window !== "undefined" ? window.__hpModesBuildTag : null;
    if (typeof window !== "undefined") {
      window.__hpModesBuildTag = TAG;
      if (prev && prev !== TAG) {
        console.warn("[build] modes:multiple-versions", { prev, current: TAG });
      }
    }
    console.info("[build] modes", TAG);
  } catch (_) {}
})();
/* global Schema, Modes */
window.Modes = window.Modes || {};
const modesFirestore = Schema.firestore || window.firestoreAPI || {};

const modesLogger = Schema.D || { info: () => {}, group: () => {}, groupEnd: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

let checkboxBehaviorSetupPromise = null;

function waitForCheckboxSetupFunction() {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  const existing = window.setupChecklistEditor || window.setupCheckboxListBehavior;
  if (typeof existing === "function") {
    return Promise.resolve(existing);
  }
  if (!checkboxBehaviorSetupPromise) {
    checkboxBehaviorSetupPromise = new Promise((resolve) => {
      const poll = () => {
        const fn = window.setupChecklistEditor || window.setupCheckboxListBehavior;
        if (typeof fn === "function") {
          resolve(fn);
          return;
        }
        window.setTimeout(poll, 50);
      };
      poll();
    });
  }
  return checkboxBehaviorSetupPromise;
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function withAlpha(hex, alpha) {
  const safe = String(hex || "").replace("#", "");
  if (safe.length !== 6) {
    return `rgba(99, 102, 241, ${alpha})`;
  }
  const value = parseInt(safe, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function consigneCategoryStorageKey(uid, mode) {
  if (!uid || !mode) return null;
  return ["consigne", "last-category", uid, mode].map((part) => String(part)).join(":");
}

function readStoredConsigneCategory(uid, mode) {
  const key = consigneCategoryStorageKey(uid, mode);
  if (!key) return null;
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) || null : null;
  } catch (error) {
    modesLogger?.debug?.("consigne.category.read.error", error);
    return null;
  }
}

function storeConsigneCategory(uid, mode, category) {
  const key = consigneCategoryStorageKey(uid, mode);
  try {
    if (typeof localStorage === "undefined") return;
    if (category != null) {
      localStorage.setItem(key, String(category));
    } else {
      localStorage.removeItem(key);
    }
  } catch (error) {
    modesLogger?.debug?.("consigne.category.store.error", error);
  }
}

// Default limits for auto-growing textareas. The max height can be overridden
// with a `data-auto-grow-max` attribute when needed, but defaults to 320px to
// avoid runaway layouts while keeping enough room for comfortable editing.
const AUTO_GROW_MIN_HEIGHT = 120;
const AUTO_GROW_DEFAULT_MAX_HEIGHT = 320;

function autoGrowTextarea(el) {
  if (!(el instanceof HTMLTextAreaElement)) return;
  if (el.dataset.autoGrowBound === "true") return;
  const rawMax = Number(el.getAttribute("data-auto-grow-max"));
  const maxHeight = Math.max(
    AUTO_GROW_MIN_HEIGHT,
    Number.isFinite(rawMax) && rawMax > 0 ? rawMax : AUTO_GROW_DEFAULT_MAX_HEIGHT,
  );
  const resize = () => {
    el.style.height = "auto";
    const scrollHeight = el.scrollHeight;
    const clampedHeight = Math.max(AUTO_GROW_MIN_HEIGHT, Math.min(scrollHeight, maxHeight));
    el.style.height = `${clampedHeight}px`;
    el.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
  };
  el.addEventListener("input", resize);
  el.addEventListener("change", resize);
  el.dataset.autoGrowBound = "true";
  resize();
}

// --- Normalisation du jour (LUN..DIM ou mon..sun) ---
const DAY_ALIAS = Schema.DAY_ALIAS || { mon: "LUN", tue: "MAR", wed: "MER", thu: "JEU", fri: "VEN", sat: "SAM", sun: "DIM" };
const DAY_VALUES = Schema.DAY_VALUES || new Set(["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"]);

function normalizeDay(value) {
  if (!value) return null;
  const lower = String(value).toLowerCase();
  if (DAY_ALIAS[lower]) return DAY_ALIAS[lower];
  const upper = lower.toUpperCase();
  return DAY_VALUES.has(upper) ? upper : null;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const RICH_TEXT_VERSION = 1;
const RICH_TEXT_ALLOWED_TAGS = new Set([
  "P",
  "BR",
  "STRONG",
  "B",
  "EM",
  "I",
  "UL",
  "OL",
  "LI",
  "DIV",
  "SPAN",
  "INPUT",
]);
const RICH_TEXT_ALLOWED_ATTRS = {
  input: ["type", "checked", "data-rich-checkbox", "data-rich-checkbox-index"],
  span: ["data-rich-checkbox-wrapper", "style"],
  div: [],
  p: [],
  br: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  ul: [],
  ol: [],
  li: [],
};

const INLINE_BOLD_REGEX = /font-weight\s*:\s*(bold|[5-9]00)\b/i;
const INLINE_ITALIC_REGEX = /font-style\s*:\s*italic\b/i;

function sanitizeRichTextElement(root) {
  if (!root) return "";
  const stack = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  while (walker.nextNode()) {
    stack.push(walker.currentNode);
  }
  stack.forEach((node) => {
    if (!(node instanceof Element)) return;
    const tagName = node.tagName;
    if (!RICH_TEXT_ALLOWED_TAGS.has(tagName)) {
      const parent = node.parentNode;
      if (parent) {
        while (node.firstChild) {
          parent.insertBefore(node.firstChild, node);
        }
        parent.removeChild(node);
      } else {
        node.remove();
      }
      return;
    }
    const lowerTag = tagName.toLowerCase();
    const styleValue = node.getAttribute("style") || "";
    const hasBold = INLINE_BOLD_REGEX.test(styleValue);
    const hasItalic = INLINE_ITALIC_REGEX.test(styleValue);
    const isCheckboxWrapper = lowerTag === "span" && node.hasAttribute("data-rich-checkbox-wrapper");
    const shouldPreserveNode = lowerTag !== "span" || isCheckboxWrapper || !node.parentNode;
    if (!isCheckboxWrapper && (hasBold || hasItalic)) {
      let content = document.createDocumentFragment();
      while (node.firstChild) {
        content.appendChild(node.firstChild);
      }
      let transformed = content;
      if (hasItalic && lowerTag !== "em" && lowerTag !== "i") {
        const em = document.createElement("em");
        em.appendChild(transformed);
        transformed = em;
      }
      if (hasBold && lowerTag !== "strong" && lowerTag !== "b") {
        const strong = document.createElement("strong");
        strong.appendChild(transformed);
        transformed = strong;
      }
      if (shouldPreserveNode) {
        node.appendChild(transformed);
      } else {
        const parent = node.parentNode;
        if (parent) {
          parent.replaceChild(transformed, node);
        } else {
          node.replaceWith(transformed);
        }
        return;
      }
    }
    const allowedAttrs = RICH_TEXT_ALLOWED_ATTRS[lowerTag] || [];
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (!allowedAttrs.includes(name)) {
        node.removeAttribute(attr.name);
        return;
      }
      if (lowerTag === "input" && name === "type") {
        const typeValue = (attr.value || "").toLowerCase();
        if (typeValue !== "checkbox") {
          node.remove();
          return;
        }
        node.setAttribute("type", "checkbox");
      }
    });
    if (node.hasAttribute("style")) {
      node.removeAttribute("style");
    }
    if (lowerTag === "input") {
      const isChecked = node.checked || node.hasAttribute("checked");
      if (isChecked) node.setAttribute("checked", "");
      else node.removeAttribute("checked");
      node.setAttribute("data-rich-checkbox", "1");
    }
  });
  return root.innerHTML;
}

function sanitizeRichTextHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html || "";
  sanitizeRichTextElement(template.content);
  return template.innerHTML;
}

function plainTextToRichHtml(text) {
  const safe = escapeHtml(text || "");
  if (!safe) return "";
  return `<p>${safe
    .replace(/\r?\n\r?\n/g, "</p><p>")
    .replace(/\r?\n/g, "<br>")}</p>`;
}

function richTextHtmlToPlainText(html) {
  const container = document.createElement("div");
  container.innerHTML = html || "";
  container.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  container.querySelectorAll("li").forEach((li) => {
    if (!li.lastChild || li.lastChild.nodeType !== Node.TEXT_NODE) {
      li.appendChild(document.createTextNode(""));
    }
    li.appendChild(document.createTextNode("\n"));
  });
  container.querySelectorAll("p,div").forEach((el) => {
    if (!el.lastChild || el.lastChild.nodeType !== Node.TEXT_NODE) {
      el.appendChild(document.createTextNode(""));
    }
    el.appendChild(document.createTextNode("\n"));
  });
  container.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    const mark = input.hasAttribute("checked") ? "[x]" : "[ ]";
    input.replaceWith(document.createTextNode(mark));
  });
  const text = container.textContent || "";
  return text.replace(/\u00a0/g, " ").replace(/[ \t]*\n[ \t]*/g, "\n").trim();
}

function extractRichTextCheckboxStates(html) {
  const container = document.createElement("div");
  container.innerHTML = html || "";
  return Array.from(container.querySelectorAll('input[type="checkbox"]')).map((input) =>
    input.hasAttribute("checked") || input.checked
  );
}

function normalizeRichTextValue(raw) {
  if (raw && typeof raw === "object" && typeof raw.toDate === "function") {
    return {
      kind: "richtext",
      version: RICH_TEXT_VERSION,
      html: "",
      text: "",
      checkboxes: [],
    };
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return {
        kind: "richtext",
        version: RICH_TEXT_VERSION,
        html: "",
        text: "",
        checkboxes: [],
      };
    }
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          return normalizeRichTextValue(parsed);
        }
      } catch (error) {
        // ignore and treat as plain text
      }
    }
    const sanitizedHtml = sanitizeRichTextHtml(plainTextToRichHtml(trimmed));
    const html = ensureRichTextStructure(sanitizedHtml) || "";
    const text = richTextHtmlToPlainText(html);
    return {
      kind: "richtext",
      version: RICH_TEXT_VERSION,
      html,
      text,
      checkboxes: extractRichTextCheckboxStates(html),
    };
  }
  if (raw && typeof raw === "object") {
    const sourceHtml = typeof raw.html === "string" ? raw.html : "";
    const sanitized = sanitizeRichTextHtml(sourceHtml);
    const html = ensureRichTextStructure(sanitized) || "";
    const textSource = typeof raw.text === "string" ? raw.text.trim() : "";
    const text = textSource || richTextHtmlToPlainText(html);
    const checkboxesSource = Array.isArray(raw.checkboxes) ? raw.checkboxes.map((item) => item === true) : null;
    const checkboxes = checkboxesSource || extractRichTextCheckboxStates(html);
    return {
      kind: "richtext",
      version: RICH_TEXT_VERSION,
      html,
      text,
      checkboxes,
    };
  }
  return {
    kind: "richtext",
    version: RICH_TEXT_VERSION,
    html: "",
    text: "",
    checkboxes: [],
  };
}

function richTextHasContent(value) {
  const normalized = normalizeRichTextValue(value);
  if (normalized.text && normalized.text.trim()) {
    return true;
  }
  // S'il y a des cases, c'est une réponse, même si aucune n'est cochée.
  if (Array.isArray(normalized.checkboxes) && normalized.checkboxes.length > 0) {
    return true;
  }
  const html = normalized.html || "";
  const stripped = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim();
  return stripped.length > 0;
}

function ensureRichTextStructure(html) {
  const trimmed = (html || "").trim();
  if (!trimmed) return "";
  const container = document.createElement("div");
  container.innerHTML = trimmed;
  if (!container.querySelector("p") && !container.querySelector("div")) {
    return `<p>${trimmed}</p>`;
  }
  return trimmed;
}

window.Modes.richText = {
  version: RICH_TEXT_VERSION,
  sanitizeElement: sanitizeRichTextElement,
  sanitizeHtml: sanitizeRichTextHtml,
  normalizeValue: normalizeRichTextValue,
  hasContent: richTextHasContent,
  toPlainText: richTextHtmlToPlainText,
  ensureStructure: ensureRichTextStructure,
};

function modal(html) {
  const wrap = document.createElement("div");
  wrap.className = "modal fixed inset-0 z-50 bg-black/40 p-4 phone-center";
  wrap.innerHTML = `
    <div class="modal__dialog w-[min(680px,92vw)] overflow-y-auto rounded-2xl bg-white border border-gray-200 p-6 shadow-2xl" data-modal-content style="max-height:var(--viewport-safe-height, calc(100vh - 2rem));">
      ${html}
    </div>`;
  const modalEl = wrap.querySelector("[data-modal-content]");
  const cleanupFns = [];
  const viewport = window.visualViewport;
  const VIEWPORT_MARGIN_BOTTOM = 32;
  const SAFE_PADDING = 16;
  const docEl = document.documentElement;
  const previousSafeHeight = docEl?.style?.getPropertyValue("--viewport-safe-height") ?? null;
  const hadInlineSafeHeight = Boolean(previousSafeHeight && previousSafeHeight.trim() !== "");
  const originalWrapAlignItems = wrap.style.alignItems;
  const originalWrapJustifyContent = wrap.style.justifyContent;
  const originalWrapPaddingTop = wrap.style.paddingTop;
  const originalWrapPaddingBottom = wrap.style.paddingBottom;
  const originalModalPaddingBottom = modalEl?.style?.paddingBottom;

  // iOS Safari et Chrome Android contractent le visualViewport lorsque le clavier logiciel
  // est affiché, en particulier sur des champs texte très longs. On ajuste donc les
  // paddings pour conserver SAFE_PADDING tout en n'appliquant le décalage vertical qu'une
  // seule fois. Comportement vérifié manuellement sur les deux navigateurs.
  const updateFromViewport = () => {
    if (!modalEl) return;
    const height = viewport ? viewport.height : window.innerHeight;
    const offsetTop = viewport ? viewport.offsetTop : 0;
    const offsetLeft = viewport ? viewport.offsetLeft : 0;
    const hiddenBottom = Math.max(0, window.innerHeight - (height + offsetTop));
    const keyboardVisible = viewport ? height + offsetTop < window.innerHeight : false;
    const reservedTop = keyboardVisible ? offsetTop + SAFE_PADDING : 0;
    const reservedBottom = keyboardVisible ? SAFE_PADDING : VIEWPORT_MARGIN_BOTTOM;
    const maxHeight = Math.max(0, height - reservedTop - reservedBottom);

    modalEl.style.maxHeight = `${maxHeight}px`;
    modalEl.style.transform = viewport
      ? `translate3d(${offsetLeft}px, ${keyboardVisible ? 0 : offsetTop}px, 0)`
      : "";
    docEl?.style?.setProperty("--viewport-safe-height", `${maxHeight}px`);

    if (keyboardVisible) {
      wrap.style.alignItems = "flex-start";
      wrap.style.justifyContent = "flex-start";
      wrap.style.paddingTop = `${offsetTop + SAFE_PADDING}px`;
      wrap.style.paddingBottom = `${hiddenBottom + SAFE_PADDING}px`;
      modalEl.style.paddingBottom = originalModalPaddingBottom;
    } else {
      wrap.style.alignItems = originalWrapAlignItems;
      wrap.style.justifyContent = originalWrapJustifyContent;
      wrap.style.paddingTop = originalWrapPaddingTop;
      wrap.style.paddingBottom = originalWrapPaddingBottom;
      modalEl.style.paddingBottom = originalModalPaddingBottom;
    }
  };

  if (viewport) {
    const updateHandler = () => updateFromViewport();
    viewport.addEventListener("resize", updateHandler);
    viewport.addEventListener("scroll", updateHandler);
    cleanupFns.push(() => viewport.removeEventListener("resize", updateHandler));
    cleanupFns.push(() => viewport.removeEventListener("scroll", updateHandler));
  } else {
    const windowUpdateHandler = () => updateFromViewport();
    window.addEventListener("resize", windowUpdateHandler);
    cleanupFns.push(() => window.removeEventListener("resize", windowUpdateHandler));
  }

  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) wrap.remove();
  });

  const originalRemove = wrap.remove.bind(wrap);
  wrap.remove = () => {
    while (cleanupFns.length) {
      const fn = cleanupFns.pop();
      try {
        fn();
      } catch (error) {
        modesLogger?.warn?.("modal:cleanup", error);
      }
    }
    if (docEl) {
      if (hadInlineSafeHeight) docEl.style.setProperty("--viewport-safe-height", previousSafeHeight);
      else docEl.style.removeProperty("--viewport-safe-height");
    }
    wrap.style.alignItems = originalWrapAlignItems;
    wrap.style.justifyContent = originalWrapJustifyContent;
    wrap.style.paddingTop = originalWrapPaddingTop;
    wrap.style.paddingBottom = originalWrapPaddingBottom;
    if (modalEl) {
      modalEl.style.paddingBottom = originalModalPaddingBottom;
    }
    originalRemove();
  };

  document.body.appendChild(wrap);
  updateFromViewport();
  return wrap;
}

function drawer(html) {
  const wrap = document.createElement("div");
  Object.assign(wrap.style, {
    position: "fixed",
    top: "0",
    right: "0",
    bottom: "0",
    left: "0",
    zIndex: "9999",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "rgba(15,23,42,0.35)",
    overscrollBehavior: "contain",
  });
  wrap.setAttribute("role", "presentation");

  const aside = document.createElement("aside");
  aside.innerHTML = html;
  Object.assign(aside.style, {
    width: "min(960px, 94vw)",
    maxWidth: "100%",
    maxHeight: "90vh",
    background: "#fff",
    borderRadius: "1.25rem",
    boxShadow: "0 24px 48px rgba(15,23,42,0.25)",
    padding: "1.5rem",
    overflowY: "auto",
    transform: "translateY(24px) scale(0.98)",
    opacity: "0",
    transition: "transform 0.2s ease-out, opacity 0.2s ease-out",
    willChange: "transform, opacity",
  });
  aside.setAttribute("role", "dialog");
  aside.setAttribute("aria-modal", "true");

  wrap.appendChild(aside);

  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) wrap.remove();
  });

  document.body.appendChild(wrap);
  requestAnimationFrame(() => {
    aside.style.transform = "translateY(0) scale(1)";
    aside.style.opacity = "1";
  });

  return wrap;
}

function pill(text) {
  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full border text-sm" style="border-color:var(--accent-200); background:var(--accent-50); color:#334155;">${escapeHtml(text)}</span>`;
}

const INFO_RESPONSE_LABEL = "Pas de réponse requise";
const INFO_STATIC_BLOCK = `<p class="text-sm text-[var(--muted)]" data-static-info></p>`;

const LIKERT6_ORDER = ["no", "rather_no", "medium", "rather_yes", "yes"];
const LIKERT6_LABELS = {
  no: "Non",
  rather_no: "Plutôt non",
  medium: "Neutre",
  rather_yes: "Plutôt oui",
  yes: "Oui",
  no_answer: "Pas de réponse",
};

const CONSIGNE_ARCHIVE_DELAY_VALUE = "__archive__";

const NOTE_IGNORED_VALUES = new Set(["no_answer"]);

const MONTANT_NUMBER_FORMATTER = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const MONTANT_OPERATOR_SYMBOLS = {
  eq: "=",
  gte: "≥",
  lte: "≤",
};

function normalizeMontantOperator(value) {
  if (value == null) {
    return "eq";
  }
  const raw = String(value).trim().toLowerCase();
  if (!raw) return "eq";
  if (["eq", "=", "egal", "égal", "equal", "a", "à"].includes(raw)) return "eq";
  if ([">=", "gte", ">", "superieur", "supérieur", "plus", "min"].includes(raw)) return "gte";
  if (["<=", "lte", "<", "inferieur", "inférieur", "moins", "max"].includes(raw)) return "lte";
  return "eq";
}

function montantOperatorSymbol(operator) {
  const normalized = normalizeMontantOperator(operator);
  return MONTANT_OPERATOR_SYMBOLS[normalized] || "=";
}

function parseMontantNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, ".").trim();
    if (!normalized) return null;
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function computeMontantEvaluation(amount, goal, operator) {
  const amountNum = Number.isFinite(amount) ? amount : null;
  const goalNum = Number.isFinite(goal) ? goal : null;
  const op = normalizeMontantOperator(operator);
  if (amountNum === null) {
    return { progress: null, met: false, status: "na" };
  }
  if (goalNum === null) {
    return { progress: null, met: false, status: "note" };
  }
  let progress = null;
  let met = false;
  if (op === "lte") {
    if (amountNum <= goalNum) {
      progress = 1;
      met = true;
    } else if (goalNum === 0) {
      progress = 0;
    } else {
      progress = Math.max(0, Math.min(1, goalNum / amountNum));
    }
  } else if (op === "eq") {
    if (goalNum === 0) {
      met = amountNum === 0;
      progress = met ? 1 : 0;
    } else {
      const base = Math.max(Math.abs(goalNum), 1);
      const diff = Math.abs(amountNum - goalNum);
      progress = Math.max(0, Math.min(1, 1 - diff / base));
      met = diff <= Number.EPSILON * base;
    }
  } else {
    if (goalNum === 0) {
      progress = amountNum > 0 ? 1 : 0;
      met = amountNum >= goalNum;
    } else {
      const ratio = amountNum / goalNum;
      progress = Math.max(0, Math.min(1, ratio));
      met = amountNum >= goalNum;
    }
  }
  if (!Number.isFinite(progress)) {
    progress = null;
  }
  let status;
  if (progress === null) {
    status = "note";
  } else if (met) {
    status = "ok-strong";
  } else if (progress >= 0.85) {
    status = "ok-soft";
  } else if (progress >= 0.6) {
    status = "mid";
  } else if (progress >= 0.35) {
    status = "ko-soft";
  } else {
    status = "ko-strong";
  }
  return { progress, met, status };
}

function normalizeMontantValue(rawValue, consigne) {
  const baseUnit = typeof consigne?.montantUnit === "string" ? consigne.montantUnit.trim() : "";
  const amountSource =
    rawValue && typeof rawValue === "object"
      ? rawValue.amount ?? rawValue.value ?? rawValue.quantity ?? null
      : rawValue;
  const unitSource =
    rawValue && typeof rawValue === "object"
      ? rawValue.unit ?? rawValue.label ?? rawValue.word ?? null
      : null;
  const goalSource =
    rawValue && typeof rawValue === "object" && Object.prototype.hasOwnProperty.call(rawValue, "goal")
      ? rawValue.goal
      : consigne?.montantGoal;
  const operatorSource =
    rawValue && typeof rawValue === "object" && Object.prototype.hasOwnProperty.call(rawValue, "operator")
      ? rawValue.operator
      : consigne?.montantGoalOperator;
  const amount = parseMontantNumber(amountSource);
  const goal = parseMontantNumber(goalSource);
  const operator = normalizeMontantOperator(operatorSource);
  const unit = typeof unitSource === "string" && unitSource.trim() ? unitSource.trim() : baseUnit;
  const evaluation = computeMontantEvaluation(amount, goal, operator);
  return {
    kind: "montant",
    amount,
    unit,
    goal: goal !== null ? goal : null,
    operator,
    progress: evaluation.progress,
    met: evaluation.met,
    status: evaluation.status,
  };
}

function buildMontantValue(consigne, amount) {
  const goal = parseMontantNumber(consigne?.montantGoal);
  const operator = normalizeMontantOperator(consigne?.montantGoalOperator);
  const unit = typeof consigne?.montantUnit === "string" ? consigne.montantUnit.trim() : "";
  return normalizeMontantValue({ amount, goal, operator, unit }, consigne);
}

function renderConsigneValueField(consigne, value, fieldId) {
  const type = consigne?.type || "short";
  if (type === "info") {
    return INFO_STATIC_BLOCK;
  }
  if (type === "num") {
    const current = value === "" || value == null ? "" : Number(value);
    return `<input id="${fieldId}" name="value" type="number" step="0.1" class="practice-editor__input" placeholder="Réponse" value="${
      Number.isFinite(current) ? escapeHtml(String(current)) : ""
    }">`;
  }
  if (type === "montant") {
    const normalized = normalizeMontantValue(value, consigne);
    const amount = Number.isFinite(normalized.amount) ? normalized.amount : null;
    const unit = normalized.unit || consigne?.montantUnit || "";
    const goal = Number.isFinite(normalized.goal) ? normalized.goal : null;
    const symbol = montantOperatorSymbol(normalized.operator);
    const objectiveLabel =
      goal !== null
        ? `Objectif ${symbol} ${MONTANT_NUMBER_FORMATTER.format(goal)}${unit ? ` ${unit}` : ""}`
        : "";
    const amountValue = amount === null ? "" : escapeHtml(String(amount));
    return `
      <div class="grid gap-1">
        <div class="flex items-center gap-2">
          <input id="${fieldId}" name="value" type="number" inputmode="decimal" step="any" min="0" class="practice-editor__input" placeholder="Montant" value="${amountValue}">
          ${unit ? `<span class="text-sm text-[var(--muted)]">${escapeHtml(unit)}</span>` : ""}
        </div>
        ${objectiveLabel ? `<p class="text-xs text-[var(--muted)]">${escapeHtml(objectiveLabel)}</p>` : ""}
      </div>
    `;
  }
  if (type === "likert5") {
    const current = value === "" || value == null ? "" : Number(value);
    const options = [0, 1, 2, 3, 4]
      .map((n) => `<option value="${n}" ${current === n ? "selected" : ""}>${n}</option>`)
      .join("");
    return `<select id="${fieldId}" name="value" class="practice-editor__select"><option value=""></option>${options}</select>`;
  }
  if (type === "likert6") {
    const current = value === "" || value == null ? "" : String(value);
    return `<select id="${fieldId}" name="value" class="practice-editor__select">
      <option value="" ${current === "" ? "selected" : ""}>—</option>
      <option value="yes" ${current === "yes" ? "selected" : ""}>Oui</option>
      <option value="rather_yes" ${current === "rather_yes" ? "selected" : ""}>Plutôt oui</option>
      <option value="medium" ${current === "medium" ? "selected" : ""}>Neutre</option>
      <option value="rather_no" ${current === "rather_no" ? "selected" : ""}>Plutôt non</option>
      <option value="no" ${current === "no" ? "selected" : ""}>Non</option>
      <option value="no_answer" ${current === "no_answer" ? "selected" : ""}>Pas de réponse</option>
    </select>`;
  }
  if (type === "yesno") {
    const current = value === "" || value == null ? "" : String(value);
    return `<select id="${fieldId}" name="value" class="practice-editor__select">
      <option value="" ${current === "" ? "selected" : ""}>—</option>
      <option value="yes" ${current === "yes" ? "selected" : ""}>Oui</option>
      <option value="no" ${current === "no" ? "selected" : ""}>Non</option>
    </select>`;
  }
  if (type === "checklist") {
    // Reuse the daily checklist UI (with arrow/skip behavior) inside the history editor
    // so users get the same interaction pattern.
    return inputForType(consigne, value ?? null);
  }
  if (type === "long") {
    return renderRichTextInput("value", {
      initialValue: value,
      placeholder: "Réponse",
      inputId: fieldId,
    });
  }
  return `<input id="${fieldId}" name="value" type="text" class="practice-editor__input" placeholder="Réponse" value="${escapeHtml(
    String(value ?? "")
  )}">`;
}

function readConsigneValueFromForm(consigne, form) {
  const type = consigne?.type || "short";
  if (type === "info") {
    return "";
  }
  if (type === "checklist") {
    const consigneId = consigne && consigne.id != null && consigne.id !== "" ? String(consigne.id) : "";
    // Prefer the standard daily checklist UI markup if present in the history editor
    const dailyRoot = form?.querySelector?.(
      `[data-checklist-root][data-consigne-id="${String(consigneId)}"]`
    );
    if (dailyRoot) {
      // Read from the DOM state like in daily mode to preserve arrow/skip semantics
      const domState = readChecklistDomState(dailyRoot);
      const hasSelection = domState.items.some((checked, index) => checked && !domState.skipped[index]);
      const hasSkip = domState.skipped.some(Boolean);
      if (!hasSelection && !hasSkip) {
        return null;
      }
      return buildChecklistValue(consigne, domState);
    }
    // Fallback: legacy history checklist markup
    const rootCandidates = Array.from(form?.querySelectorAll("[data-history-checklist]") || []);
    const root =
      rootCandidates.find((node) => {
        if (!node || typeof node.getAttribute !== "function") {
          return false;
        }
        const rawId = node.getAttribute("data-consigne-id") || "";
        if (!consigneId) {
          return !rawId;
        }
        return rawId === consigneId;
      }) || rootCandidates[0] || null;
    const fallbackLabelsAttr =
      typeof root?.getAttribute === "function" ? root.getAttribute("data-history-checklist-labels") : "";
    let fallbackLabels = [];
    if (fallbackLabelsAttr) {
      try {
        const parsed = JSON.parse(fallbackLabelsAttr);
        if (Array.isArray(parsed)) {
          fallbackLabels = parsed.map((label) => (typeof label === "string" ? label : String(label ?? "")));
        }
      } catch (_) {
        // ignore parse errors
      }
    }
    const baseLabels = sanitizeChecklistItems(consigne);
    const items = [];
    const skipped = [];
    if (root) {
      const rows = Array.from(root.querySelectorAll("[data-history-checklist-item]"));
      rows.forEach((row, orderIndex) => {
        const rawIndex = row?.getAttribute?.("data-index");
        const parsedIndex = Number(rawIndex);
        const index = Number.isInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : orderIndex;
        const checkbox = row.querySelector("[data-history-checklist-checkbox]");
        const skipBox = row.querySelector("[data-history-checklist-skip]");
        items[index] = checkbox ? Boolean(checkbox.checked) : false;
        skipped[index] = skipBox ? Boolean(skipBox.checked) : false;
      });
    }
    const total = Math.max(baseLabels.length, fallbackLabels.length, items.length);
    const normalizedItems = Array.from({ length: total }, (_, index) => Boolean(items[index]));
    const normalizedSkipped = Array.from({ length: total }, (_, index) => Boolean(skipped[index]));
    const labels = Array.from({ length: total }, (_, index) => {
      if (typeof baseLabels[index] === "string" && baseLabels[index]) {
        return baseLabels[index];
      }
      if (typeof fallbackLabels[index] === "string" && fallbackLabels[index]) {
        return fallbackLabels[index];
      }
      return `Élément ${index + 1}`;
    });
    const hasSelection = normalizedItems.some((checked, index) => checked && !normalizedSkipped[index]);
    const hasSkip = normalizedSkipped.some(Boolean);
    if (!hasSelection && !hasSkip) {
      return null;
    }
    const stableIds = Array.isArray(consigne?.checklistItemIds) ? consigne.checklistItemIds : [];
    const selectedIds = [];
    labels.forEach((label, index) => {
      if (normalizedItems[index] && !normalizedSkipped[index]) {
        selectedIds.push(resolveChecklistItemId(consigne, index, label, stableIds));
      }
    });
    const result = {
      items: normalizedItems,
    };
    if (labels.length) {
      result.labels = labels.map((label) => (typeof label === "string" ? label : String(label ?? "")));
    }
    if (hasSkip) {
      result.skipped = normalizedSkipped;
    }
    if (selectedIds.length) {
      result.selectedIds = selectedIds;
    }
    return result;
  }
  const field = form?.elements?.value;
  if (!field) return "";
  if (type === "long") {
    const normalized = normalizeRichTextValue(field.value || "");
    return richTextHasContent(normalized) ? normalized : "";
  }
  if (type === "short") {
    return (field.value || "").trim();
  }
  if (type === "num") {
    if (field.value === "" || field.value == null) return "";
    const num = Number(field.value);
    return Number.isFinite(num) ? num : "";
  }
  if (type === "montant") {
    if (field.value === "" || field.value == null) return "";
    const amount = Number(field.value);
    if (!Number.isFinite(amount)) {
      return "";
    }
    return buildMontantValue(consigne, amount);
  }
  if (type === "likert5") {
    if (field.value === "" || field.value == null) return "";
    const num = Number(field.value);
    return Number.isFinite(num) ? num : "";
  }
  if (type === "yesno" || type === "likert6") {
    return field.value || "";
  }
  return (field.value || "").trim();
}

function likert6NumericPoint(value) {
  if (!value) return null;
  const index = LIKERT6_ORDER.indexOf(String(value));
  if (index === -1) return null;
  return index;
}

function sanitizeChecklistItems(consigne) {
  const rawItems = Array.isArray(consigne?.checklistItems) ? consigne.checklistItems : [];
  return rawItems
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function generateClientChecklistItemId() {
  if (typeof Schema !== "undefined" && Schema && typeof Schema.generateChecklistItemId === "function") {
    try {
      const generated = Schema.generateChecklistItemId();
      if (generated) {
        return String(generated);
      }
    } catch (error) {
      modesLogger?.warn?.("checklist.id.generate", error);
    }
  }
  if (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch (error) {
      // ignore and fall back
    }
  }
  const nowPart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `chk_${nowPart}_${randomPart}`;
}

function slugifyChecklistLabel(label) {
  if (typeof label !== "string") {
    return "";
  }
  const trimmed = label.trim();
  if (!trimmed) {
    return "";
  }
  const normalized = typeof trimmed.normalize === "function" ? trimmed.normalize("NFD") : trimmed;
  return normalized
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function quickChecklistHash(value) {
  const str = typeof value === "string" ? value : JSON.stringify(value || "");
  let hash = 2166136261;
  for (let index = 0; index < str.length; index += 1) {
    hash ^= str.charCodeAt(index);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16);
}

function fallbackChecklistOptionsHash(items) {
  if (!Array.isArray(items)) {
    return quickChecklistHash("");
  }
  const normalized = items
    .map((item) => (typeof item === "string" ? item.trim() : item == null ? "" : String(item)))
    .filter((item) => item.length > 0);
  return quickChecklistHash(JSON.stringify(normalized));
}

function computeChecklistOptionsHash(consigne) {
  const items = sanitizeChecklistItems(consigne);
  const hashFn = window.ChecklistState?.hashOptions;
  if (typeof hashFn === "function") {
    try {
      const hashed = hashFn(items);
      if (hashed) {
        return String(hashed);
      }
    } catch (error) {
      modesLogger?.warn?.("checklist.hash.error", error);
    }
  }
  return fallbackChecklistOptionsHash(items);
}

function resolveChecklistItemId(consigne, index, label, stableIds = null) {
  const idsSource = Array.isArray(stableIds)
    ? stableIds
    : Array.isArray(consigne?.checklistItemIds)
    ? consigne.checklistItemIds
    : [];
  const explicitId = typeof idsSource[index] === "string" ? idsSource[index].trim() : "";
  if (explicitId) {
    return explicitId;
  }
  const base =
    consigne?.id ??
    consigne?.slug ??
    consigne?.slugId ??
    consigne?.slug_id ??
    consigne?.consigneId ??
    "";
  const baseStr = base ? String(base) : "";
  const labelStr = typeof label === "string" ? label.trim() : "";
  const slug = slugifyChecklistLabel(labelStr);
  const hashSource = labelStr ? `${labelStr}#${index}` : `${index}`;
  const hash = quickChecklistHash(hashSource).slice(0, 8);
  const key = slug ? `${slug}-${hash}` : hash;
  return baseStr ? `${baseStr}:${key}` : key;
}

function collectChecklistSelectedIds(consigne, container, value) {
  const { items: states, skipped: fallbackSkipped } = normalizeChecklistStateArrays(value);
  const domSkipped = [];
  const selected = new Set();
  if (container instanceof Element) {
    const items = Array.from(container.querySelectorAll("[data-checklist-item]"));
    if (items.length) {
      const stableIds = Array.isArray(consigne?.checklistItemIds)
        ? consigne.checklistItemIds
        : [];
      items.forEach((item, index) => {
        const input = item.querySelector('[data-checklist-input], input[type="checkbox"]');
        const fallbackId = resolveChecklistItemId(
          consigne,
          index,
          item.getAttribute("data-checklist-label") || input?.getAttribute?.("data-label") || "",
          stableIds
        );
        const explicitKey =
          input?.getAttribute?.("data-key") ||
          input?.dataset?.key ||
          item.getAttribute("data-checklist-key") ||
          item.getAttribute("data-item-id");
        const itemId = explicitKey || fallbackId;
        const isChecked = input ? Boolean(input.checked) : Boolean(states[index]);
        const isSkipped = (() => {
          if (input && input.dataset?.checklistSkip === "1") {
            return true;
          }
          if (item.dataset?.checklistSkipped === "1") {
            return true;
          }
          return fallbackSkipped[index] || false;
        })();
        domSkipped[index] = isSkipped;
        if (isChecked && !isSkipped) {
          selected.add(String(itemId));
        }
      });
      return Array.from(selected);
    }
  }
  const sanitizedItems = sanitizeChecklistItems(consigne);
  const stableIds = Array.isArray(consigne?.checklistItemIds) ? consigne.checklistItemIds : [];
  sanitizedItems.forEach((_, index) => {
    const checked = Boolean(states[index]);
    const isSkipped = Boolean(domSkipped[index] ?? fallbackSkipped[index]);
    if (checked && !isSkipped) {
      selected.add(resolveChecklistItemId(consigne, index, sanitizedItems[index], stableIds));
    }
  });
  return Array.from(selected);
}

function filterConsignesByParentVisibility(consignes, hiddenParentIds = new Set()) {
  if (!Array.isArray(consignes) || consignes.length === 0) {
    return [];
  }
  const initialVisible = consignes.filter((consigne) => {
    if (!consigne) {
      return false;
    }
    if (consigne.parentId && hiddenParentIds.has(consigne.parentId)) {
      return false;
    }
    return true;
  });
  if (!initialVisible.length) {
    return initialVisible;
  }
  const visibleIdSet = new Set(initialVisible.map((consigne) => consigne?.id).filter(Boolean));
  return initialVisible.filter((consigne) => {
    if (!consigne?.parentId) {
      return true;
    }
    return visibleIdSet.has(consigne.parentId);
  });
}

function readChecklistStates(value) {
  if (Array.isArray(value)) {
    return value.map((item) => item === true);
  }
  if (value && typeof value === "object" && Array.isArray(value.items)) {
    return value.items.map((item) => item === true);
  }
  return [];
}

function readChecklistSkipped(value) {
  if (!value || typeof value !== "object") {
    return [];
  }
  const raw = Array.isArray(value.skipped)
    ? value.skipped
    : Array.isArray(value.skipStates)
    ? value.skipStates
    : [];
  const base = raw.map((item) => item === true);
  if (value.answers && typeof value.answers === "object") {
    const normalizeSkipValue = (input) => {
      if (input === true) return true;
      if (input === false || input == null) return false;
      if (typeof input === "number") {
        if (!Number.isFinite(input)) return false;
        return input !== 0;
      }
      if (typeof input === "string") {
        const normalized = input.trim().toLowerCase();
        if (!normalized) return false;
        return ["1", "true", "yes", "y", "on", "skip", "passed"].includes(normalized);
      }
      return false;
    };
    const answersObject = value.answers;
    const orderedAnswers = Array.isArray(value.checklistItemIds)
      ? value.checklistItemIds.map((id) => answersObject?.[id] || null)
      : Object.values(answersObject);
    const mergedLength = Math.max(base.length, orderedAnswers.length);
    return Array.from({ length: mergedLength }, (_, index) => {
      const existing = Boolean(base[index]);
      if (existing) {
        return true;
      }
      const entry = orderedAnswers[index];
      if (!entry || typeof entry !== "object") {
        return false;
      }
      const rawSkip = Object.prototype.hasOwnProperty.call(entry, "skipped")
        ? entry.skipped
        : entry.skiped;
      return normalizeSkipValue(rawSkip);
    });
  }
  return base;
}

function normalizeChecklistStateArrays(value, length = null) {
  const states = readChecklistStates(value);
  const skipped = readChecklistSkipped(value);
  const size =
    Number.isFinite(length) && length >= 0 ? Number(length) : Math.max(states.length, skipped.length);
  if (!Number.isFinite(size) || size <= 0) {
    return { items: states.slice(), skipped: skipped.slice() };
  }
  const normalizedItems = Array.from({ length: size }, (_, index) => Boolean(states[index]));
  const normalizedSkipped = Array.from({ length: size }, (_, index) => Boolean(skipped[index]));
  return { items: normalizedItems, skipped: normalizedSkipped };
}

function readChecklistDomState(container) {
  if (typeof Element !== "undefined" && container instanceof Element) {
    const inputs = Array.from(container.querySelectorAll("[data-checklist-input]"));
    if (!inputs.length) {
      return { items: [], skipped: [] };
    }
    const items = [];
    const skipped = [];
    inputs.forEach((input) => {
      const host = input.closest("[data-checklist-item]");
      const isSkipped = Boolean(
        (input.dataset && input.dataset.checklistSkip === "1") ||
          (host && host.dataset && host.dataset.checklistSkipped === "1")
      );
      items.push(Boolean(input.checked));
      skipped.push(isSkipped);
    });
    return { items, skipped };
  }
  return { items: [], skipped: [] };
}

function applyChecklistDomState(container, value) {
  if (!(typeof Element !== "undefined" && container instanceof Element)) {
    return;
  }
  const inputs = Array.from(container.querySelectorAll("[data-checklist-input]"));
  if (!inputs.length) {
    return;
  }
  const { items: states, skipped } = normalizeChecklistStateArrays(value, inputs.length);
  inputs.forEach((input, index) => {
    const host = input.closest("[data-checklist-item]");
    const isSkipped = Boolean(skipped[index]);
    const isChecked = Boolean(states[index]);
    input.checked = isSkipped ? true : isChecked;
    if (typeof input.indeterminate === "boolean") {
      input.indeterminate = false;
    }
    if (input.dataset) {
      if (isSkipped) {
        input.dataset.checklistSkip = "1";
      } else {
        delete input.dataset.checklistSkip;
      }
    }
    if (host) {
      if (isSkipped) {
        host.dataset.checklistSkipped = "1";
        host.classList.add("checklist-item--skipped");
        host.setAttribute("data-validated", "skip");
      } else {
        host.classList.remove("checklist-item--skipped");
        if (host.dataset) {
          delete host.dataset.checklistSkipped;
        }
        host.setAttribute("data-validated", isChecked ? "true" : "false");
      }
    }
  });
}

function deriveChecklistStats(value) {
  const { items: states, skipped } = normalizeChecklistStateArrays(value);
  const checkedIds = [];
  let consideredTotal = 0;
  states.forEach((checked, index) => {
    if (skipped[index]) {
      return;
    }
    consideredTotal += 1;
    if (checked) {
      checkedIds.push(index);
    }
  });
  const checkedCount = checkedIds.length;
  const ratio = consideredTotal > 0 ? checkedCount / consideredTotal : 0;
  let percentage = Math.round(ratio * 100);
  if (value && typeof value === "object") {
    const hintedPercentage = Number(value.percentage);
    if (Number.isFinite(hintedPercentage)) {
      percentage = Math.max(0, Math.min(100, Math.round(hintedPercentage)));
    }
  }
  return {
    total: consideredTotal,
    checkedCount,
    checkedIds,
    percentage,
    isEmpty: checkedCount === 0,
    skippedCount: skipped.filter(Boolean).length,
  };
}

function resolveChecklistStatsFromResponse(response) {
  if (!response || typeof response !== "object") {
    return null;
  }
  const base = deriveChecklistStats(response.value);
  const stats = { ...base };
  if (Array.isArray(response.checkedIds)) {
    stats.checkedIds = response.checkedIds.slice();
    stats.checkedCount = response.checkedIds.length;
  }
  if (Number.isFinite(response.checkedCount)) {
    stats.checkedCount = Number(response.checkedCount);
  }
  if (Number.isFinite(response.total)) {
    stats.total = Number(response.total);
  }
  if (Number.isFinite(response.skippedCount)) {
    stats.skippedCount = Number(response.skippedCount);
  }
  if (Number.isFinite(response.percentage)) {
    stats.percentage = Math.max(0, Math.min(100, Math.round(Number(response.percentage))));
  }
  if (response.isEmpty !== undefined) {
    stats.isEmpty = Boolean(response.isEmpty);
  } else {
    stats.isEmpty = stats.checkedCount === 0;
  }
  const total = stats.total;
  if (total > 0) {
    const ratio = stats.checkedCount / total;
    stats.percentage = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  } else if (!Number.isFinite(stats.percentage)) {
    stats.percentage = 0;
  }
  return stats;
}

function buildChecklistValue(consigne, rawValue, fallbackValue = null) {
  const labels = sanitizeChecklistItems(consigne);
  const normalized = normalizeChecklistStateArrays(rawValue, labels.length || undefined);
  const result = { items: [] };
  if (labels.length) {
    result.labels = labels.slice();
    result.items = labels.map((_, index) => Boolean(normalized.items[index]));
    result.skipped = labels.map((_, index) => Boolean(normalized.skipped[index]));
  } else {
    const fallbackLabels = (() => {
      if (rawValue && typeof rawValue === "object" && Array.isArray(rawValue.labels)) {
        return rawValue.labels;
      }
      if (fallbackValue && typeof fallbackValue === "object" && Array.isArray(fallbackValue.labels)) {
        return fallbackValue.labels;
      }
      return [];
    })();
    const fallbackNormalized = normalizeChecklistStateArrays(
      rawValue,
      fallbackLabels.length || undefined
    );
    if (fallbackLabels.length) {
      const normalizedFallback = fallbackLabels.map((label) =>
        typeof label === "string" ? label : String(label)
      );
      result.labels = normalizedFallback;
      result.items = normalizedFallback.map((_, index) => Boolean(fallbackNormalized.items[index]));
      result.skipped = normalizedFallback.map((_, index) => Boolean(fallbackNormalized.skipped[index]));
    } else {
      result.items = fallbackNormalized.items.slice();
      result.skipped = fallbackNormalized.skipped.slice();
    }
  }
  if (!Array.isArray(result.items)) {
    result.items = [];
  }
  if (Array.isArray(result.labels) && result.items.length !== result.labels.length) {
    result.items = result.labels.map((_, index) => Boolean(result.items[index]));
    if (Array.isArray(result.skipped)) {
      result.skipped = result.labels.map((_, index) => Boolean(result.skipped[index]));
    }
  }
  if (Array.isArray(result.skipped) && result.skipped.every((value) => value === false)) {
    delete result.skipped;
  }
  const resolvedAnswers = (() => {
    if (rawValue && typeof rawValue === "object") {
      return rawValue.answers || rawValue.answerMap || null;
    }
    if (fallbackValue && typeof fallbackValue === "object") {
      return fallbackValue.answers || fallbackValue.answerMap || null;
    }
    return null;
  })();
  if (resolvedAnswers && typeof resolvedAnswers === "object") {
    if (resolvedAnswers instanceof Map) {
      result.answers = Object.fromEntries(resolvedAnswers.entries());
    } else {
      result.answers = { ...resolvedAnswers };
    }
  }
  const resolvedSelectedIds = (() => {
    if (rawValue && typeof rawValue === "object" && Array.isArray(rawValue.selectedIds)) {
      return rawValue.selectedIds;
    }
    if (fallbackValue && typeof fallbackValue === "object" && Array.isArray(fallbackValue.selectedIds)) {
      return fallbackValue.selectedIds;
    }
    return null;
  })();
  if (Array.isArray(resolvedSelectedIds) && resolvedSelectedIds.length) {
    result.selectedIds = resolvedSelectedIds.map((value) => String(value));
  }
  return result;
}

function checklistHasSelection(value) {
  const { items, skipped } = normalizeChecklistStateArrays(value);
  return items.some((checked, index) => checked && !skipped[index]);
}

function checklistIsComplete(value) {
  const { items, skipped } = normalizeChecklistStateArrays(value);
  let hasConsidered = false;
  for (let index = 0; index < items.length; index += 1) {
    if (skipped[index]) {
      continue;
    }
    hasConsidered = true;
    if (!items[index]) {
      return false;
    }
  }
  return hasConsidered;
}

function numericPoint(type, value, consigne = null) {
  if (value === null || value === undefined || value === "") return null;
  if (type === "likert6") {
    return likert6NumericPoint(value);
  }
  const point = Schema.valueToNumericPoint(type, value, consigne);
  return Number.isFinite(point) ? point : null;
}

function formatConsigneValue(type, value, options = {}) {
  const wantsHtml = options.mode === "html";
  const consigne = options.consigne || null;
  const providedChecklist = Array.isArray(options.checklistItems) ? options.checklistItems : null;
  if (type === "info") return "";
  if (value && typeof value === "object" && value.skipped === true) {
    const label = "Passée";
    return wantsHtml ? escapeHtml(label) : label;
  }
  if (type === "long") {
    const normalized = normalizeRichTextValue(value);
    if (!richTextHasContent(normalized)) {
      return wantsHtml ? "—" : "—";
    }
    if (wantsHtml) {
      const html = ensureRichTextStructure(normalized.html) || "";
      return html && html.trim() ? html : escapeHtml(normalized.text || "—");
    }
    return normalized.text || "—";
  }
  if (type === "montant") {
    const normalized = normalizeMontantValue(value, consigne);
    if (!Number.isFinite(normalized.amount)) {
      return wantsHtml ? "—" : "—";
    }
    const amountText = MONTANT_NUMBER_FORMATTER.format(normalized.amount);
    const unit = normalized.unit || consigne?.montantUnit || "";
    const baseText = unit ? `${amountText} ${unit}` : amountText;
    const goalText = Number.isFinite(normalized.goal)
      ? `${montantOperatorSymbol(normalized.operator)} ${MONTANT_NUMBER_FORMATTER.format(normalized.goal)}${unit ? ` ${unit}` : ""}`
      : "";
    if (!goalText) {
      return wantsHtml ? escapeHtml(baseText) : baseText;
    }
    const objectiveLabel = `Objectif ${goalText}`;
    if (wantsHtml) {
      return `${escapeHtml(baseText)} <span class="montant-value__objective">(${escapeHtml(objectiveLabel)})</span>`;
    }
    return `${baseText} (${objectiveLabel})`;
  }
  if (value === null || value === undefined || value === "") return "—";
  if (type === "checklist") {
    const { items: states, skipped } = normalizeChecklistStateArrays(value);
    if (wantsHtml) {
      if (!states.length) {
        return '<p class="history-checklist__empty">—</p>';
      }
      const labels = Array.isArray(value?.labels)
        ? value.labels.map((label) => (typeof label === "string" ? label : String(label)))
        : [];
      const itemsMarkup = states
        .map((checked, index) => {
          const label = labels[index] || `Élément ${index + 1}`;
          const skippedState = Boolean(skipped[index]);
          const statusClass = skippedState
            ? "history-checklist__item--skipped"
            : checked
            ? "history-checklist__item--checked"
            : "history-checklist__item--unchecked";
          const symbol = checked ? "☑︎" : "☐";
          const skippedBadge = skippedState
            ? '<span class="badge-skipped">passée</span>'
            : '';
          const labelMarkup = skippedBadge ? `${escapeHtml(label)} ${skippedBadge}` : escapeHtml(label);
          return `<li class="history-checklist__item ${statusClass}"><span class="history-checklist__box" aria-hidden="true">${symbol}</span><span class="history-checklist__label">${labelMarkup}</span></li>`;
        })
        .join("");
      const consideredTotal = states.reduce(
        (acc, _, index) => (skipped[index] ? acc : acc + 1),
        0
      );
      const completed = states.reduce(
        (acc, checked, index) => (skipped[index] || !checked ? acc : acc + 1),
        0
      );
      const ariaLabel =
        consideredTotal > 0
          ? `${completed} sur ${consideredTotal} éléments cochés`
          : "Aucun élément pris en compte";
      return `<ul class="history-checklist" data-checked="${completed}" data-total="${consideredTotal}" aria-label="${escapeHtml(ariaLabel)}">${itemsMarkup}</ul>`;
    }
    if (!states.length) return "—";
    const considered = states.reduce((acc, _, index) => (skipped[index] ? acc : acc + 1), 0);
    if (considered === 0) {
      return "—";
    }
    const done = states.reduce(
      (acc, checked, index) => (skipped[index] || !checked ? acc : acc + 1),
      0
    );
    return `${done} / ${considered}`;
  }
  if (type === "yesno") {
    const text = value === "yes" ? "Oui" : value === "no" ? "Non" : String(value);
    return wantsHtml ? escapeHtml(text) : text;
  }
  if (type === "likert5") {
    const text = String(value);
    return wantsHtml ? escapeHtml(text) : text;
  }
  if (type === "likert6") {
    const mapped = LIKERT6_LABELS[String(value)];
    const text = mapped || String(value);
    return wantsHtml ? escapeHtml(text) : text;
  }
  const fallback = String(value);
  return wantsHtml ? escapeHtml(fallback) : fallback;
}

function priorityTone(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return "medium";
  if (n <= 1) return "high";
  if (n >= 3) return "low";
  return "medium";
}

function priorityLabelFromTone(tone) {
  if (tone === "high") return "haute";
  if (tone === "low") return "basse";
  return "moyenne";
}

function prioChip(p) {
  const tone = priorityTone(p);
  const lbl = priorityLabelFromTone(tone);
  return `<span class="sr-only" data-priority="${tone}">Priorité ${lbl}</span>`;
}

function smallBtn(label, cls = "") {
  return `<button type="button" class="btn btn-ghost text-sm ${cls}">${label}</button>`;
}

function navigate(hash) {
  const fn = window.routeTo;
  if (typeof fn === "function") fn(hash);
  else window.location.hash = hash;
}

function showToast(msg){
  const el = document.createElement("div");
  el.className = "fixed top-4 right-4 z-50 card px-3 py-2 text-sm shadow-lg";
  el.style.transition = "opacity .25s ease, transform .25s ease";
  el.style.opacity = "0";
  el.style.transform = "translateY(6px)";
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateY(0)"; });
  setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateY(-6px)"; setTimeout(()=>el.remove(), 250); }, 1200);
}

const CONSIGNE_PRIORITY_OPTIONS = [
  { value: 1, tone: "high", label: "Priorité haute" },
  { value: 2, tone: "medium", label: "Priorité moyenne" },
  { value: 3, tone: "low", label: "Priorité basse" },
];

let openConsignePriorityMenuState = null;
let consignePriorityMenuListenersBound = false;

function removeConsignePriorityMenuListeners() {
  if (!consignePriorityMenuListenersBound) return;
  document.removeEventListener("click", onDocumentClickConsignePriorityMenu, true);
  document.removeEventListener("keydown", onDocumentKeydownConsignePriorityMenu, true);
  consignePriorityMenuListenersBound = false;
}

function ensureConsignePriorityMenuListeners() {
  if (consignePriorityMenuListenersBound) return;
  document.addEventListener("click", onDocumentClickConsignePriorityMenu, true);
  document.addEventListener("keydown", onDocumentKeydownConsignePriorityMenu, true);
  consignePriorityMenuListenersBound = true;
}

function closeConsignePriorityMenu(state = openConsignePriorityMenuState, { focusTrigger = false } = {}) {
  if (!state) return;
  const { trigger, menu } = state;
  if (menu) {
    menu.hidden = true;
    menu.setAttribute("aria-hidden", "true");
  }
  if (trigger) {
    trigger.setAttribute("aria-expanded", "false");
    if (focusTrigger) {
      try {
        trigger.focus({ preventScroll: true });
      } catch (err) {
        trigger.focus();
      }
    }
  }
  if (openConsignePriorityMenuState && menu && openConsignePriorityMenuState.menu === menu) {
    openConsignePriorityMenuState = null;
    removeConsignePriorityMenuListeners();
  }
}

function openConsignePriorityMenu(state) {
  if (!state) return;
  const { trigger, menu } = state;
  if (!menu || !trigger) return;
  if (openConsignePriorityMenuState && openConsignePriorityMenuState.menu !== menu) {
    closeConsignePriorityMenu(openConsignePriorityMenuState);
  }
  menu.hidden = false;
  menu.setAttribute("aria-hidden", "false");
  if (!menu.hasAttribute("tabindex")) {
    menu.setAttribute("tabindex", "-1");
  }
  trigger.setAttribute("aria-expanded", "true");
  openConsignePriorityMenuState = state;
  ensureConsignePriorityMenuListeners();
  try {
    menu.focus({ preventScroll: true });
  } catch (err) {
    try {
      menu.focus();
    } catch (focusErr) {
      // ignore
    }
  }
}

function onDocumentClickConsignePriorityMenu(event) {
  if (!openConsignePriorityMenuState) return;
  const { trigger, menu } = openConsignePriorityMenuState;
  if (menu && menu.contains(event.target)) return;
  if (trigger && trigger.contains(event.target)) return;
  closeConsignePriorityMenu();
}

function onDocumentKeydownConsignePriorityMenu(event) {
  if (!openConsignePriorityMenuState) return;
  if (event.key === "Escape" || event.key === "Esc") {
    closeConsignePriorityMenu(undefined, { focusTrigger: true });
    event.stopPropagation();
  }
}

function normalizeConsignePriorityValue(value) {
  const num = Number(value);
  if (Number.isFinite(num) && num >= 1 && num <= 3) {
    return num;
  }
  return 2;
}

function updateConsignePriorityMenuSelection(menu, priority) {
  if (!menu) return;
  const normalized = normalizeConsignePriorityValue(priority);
  const buttons = Array.from(menu.querySelectorAll("[data-priority-option]"));
  buttons.forEach((btn) => {
    const optionValue = normalizeConsignePriorityValue(btn?.dataset?.priorityOption);
    const isSelected = optionValue === normalized;
    btn.setAttribute("aria-checked", isSelected ? "true" : "false");
    if (isSelected) {
      btn.dataset.selected = "1";
    } else {
      delete btn.dataset.selected;
    }
  });
}

function updateConsignePriorityTrigger(trigger, priority) {
  if (!trigger) return;
  const tone = priorityTone(priority);
  trigger.dataset.priorityTone = tone;
  const label = priorityLabelFromTone(tone) || "";
  const capitalized = label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : "";
  const title = capitalized
    ? `Changer la priorité (actuelle : ${capitalized})`
    : "Changer la priorité";
  trigger.setAttribute("aria-label", title);
  trigger.title = title;
}

function applyPriorityToneToConsigneRow(row, priority) {
  if (!row) return;
  const tone = priorityTone(priority);
  row.classList.remove("priority-surface-high", "priority-surface-medium", "priority-surface-low");
  row.classList.add("priority-surface", `priority-surface-${tone}`);
  row.dataset.priorityTone = tone;
  const statusHolder = row.querySelector("[data-status]");
  if (statusHolder) {
    statusHolder.dataset.priorityTone = tone;
  }
  const dot = row.querySelector("[data-status-dot]");
  if (dot) {
    dot.dataset.priorityTone = tone;
  }
  const srPriority = row.querySelector("[data-priority]");
  if (srPriority) {
    srPriority.dataset.priority = tone;
    const label = priorityLabelFromTone(tone) || "";
    srPriority.textContent = `Priorité ${label}`;
  }
  const trigger = row.querySelector("[data-priority-trigger]");
  updateConsignePriorityTrigger(trigger, priority);
}

function setupConsignePriorityMenu(row, consigne, ctx) {
  if (!(row instanceof HTMLElement)) return;
  const trigger = row.querySelector("[data-priority-trigger]");
  const menu = row.querySelector("[data-priority-menu]");
  if (!trigger || !menu) return;
  const currentPriority = normalizeConsignePriorityValue(consigne?.priority);
  applyPriorityToneToConsigneRow(row, currentPriority);
  updateConsignePriorityMenuSelection(menu, currentPriority);
  if (trigger.dataset.priorityMenuReady === "1") {
    return;
  }
  trigger.dataset.priorityMenuReady = "1";
  menu.innerHTML = CONSIGNE_PRIORITY_OPTIONS.map((option) => `
    <button type="button"
            class="consigne-row__priority-option"
            data-priority-option="${option.value}"
            data-priority-tone="${option.tone}"
            role="menuitemradio"
            aria-checked="${option.value === currentPriority ? "true" : "false"}">
      ${option.label}
    </button>
  `).join("");
  menu.hidden = true;
  menu.setAttribute("aria-hidden", "true");
  menu.setAttribute("role", "menu");
  if (!menu.hasAttribute("tabindex")) {
    menu.setAttribute("tabindex", "-1");
  }
  const optionButtons = Array.from(menu.querySelectorAll("[data-priority-option]"));
  updateConsignePriorityMenuSelection(menu, currentPriority);
  let isUpdating = false;
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isUpdating) return;
    const isOpen = openConsignePriorityMenuState
      && openConsignePriorityMenuState.menu === menu
      && !menu.hidden;
    if (isOpen) {
      closeConsignePriorityMenu(openConsignePriorityMenuState);
    } else {
      openConsignePriorityMenu({ trigger, menu });
    }
  });
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || event.key === "Esc") {
      closeConsignePriorityMenu({ trigger, menu }, { focusTrigger: true });
      event.stopPropagation();
    }
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || event.key === "Esc") {
      closeConsignePriorityMenu({ trigger, menu }, { focusTrigger: true });
      event.stopPropagation();
    }
  });
  menu.addEventListener("click", async (event) => {
    const option = event.target.closest("[data-priority-option]");
    if (!option) return;
    event.preventDefault();
    event.stopPropagation();
    if (isUpdating) return;
    const nextPriority = normalizeConsignePriorityValue(option.dataset.priorityOption);
    const current = normalizeConsignePriorityValue(consigne?.priority);
    if (nextPriority === current) {
      closeConsignePriorityMenu({ trigger, menu });
      return;
    }
    if (!ctx?.db || !ctx?.user?.uid || !consigne?.id) {
      closeConsignePriorityMenu({ trigger, menu });
      return;
    }
    isUpdating = true;
    optionButtons.forEach((btn) => {
      btn.disabled = true;
    });
    trigger.setAttribute("aria-busy", "true");
    try {
      await Schema.updateConsigne(ctx.db, ctx.user.uid, consigne.id, { priority: nextPriority });
      consigne.priority = nextPriority;
      applyPriorityToneToConsigneRow(row, nextPriority);
      updateConsignePriorityMenuSelection(menu, nextPriority);
    } catch (error) {
      console.error(error);
      showToast("Impossible de mettre à jour la priorité.");
    } finally {
      isUpdating = false;
      optionButtons.forEach((btn) => {
        btn.disabled = false;
      });
      trigger.removeAttribute("aria-busy");
      closeConsignePriorityMenu({ trigger, menu });
    }
  });
}

function summaryScopeLabel(scope) {
  const normalized = String(scope || "").toLowerCase();
  if (normalized === "adhoc" || normalized.includes("ponct")) return "Bilan ponctuel";
  if (normalized === "monthly") return "Bilan mensuel";
  if (normalized === "yearly") return "Bilan annuel";
  return "Bilan hebdomadaire";
}

async function chooseBilanScope(options = {}) {
  const allowMonthly = options.allowMonthly !== false;
  const scopes = [
    { scope: "weekly", label: "Bilan hebdomadaire", description: "Synthèse de la semaine écoulée." },
    { scope: "adhoc", label: "Bilan ponctuel", description: "Instantané sur une date précise." },
  ];
  if (allowMonthly) {
    scopes.push({ scope: "monthly", label: "Bilan mensuel", description: "Vue d’ensemble du mois." });
  }
  scopes.push({ scope: "yearly", label: "Bilan annuel", description: "Recul sur l’année complète." });

  const optionsMarkup = scopes
    .map(
      (item) => `
        <button type="button" class="w-full rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50 focus:border-slate-400 focus:outline-none" data-bilan-scope="${escapeHtml(item.scope)}" data-bilan-label="${escapeHtml(item.label)}">
          <span class="flex items-center justify-between gap-3">
            <span>
              <span class="block font-medium text-slate-800">${escapeHtml(item.label)}</span>
              ${item.description ? `<span class="mt-1 block text-sm text-slate-500">${escapeHtml(item.description)}</span>` : ""}
            </span>
            <span aria-hidden="true" class="text-slate-400">→</span>
          </span>
        </button>`
    )
    .join("");

  const overlay = modal(`
    <div class="space-y-4">
      <header class="space-y-1">
        <h2 class="text-lg font-semibold">Choisir un type de bilan</h2>
        <p class="text-sm text-[var(--muted)]">Sélectionne la période qui correspond le mieux au bilan que tu souhaites réaliser.</p>
      </header>
      <div class="space-y-2">
        ${optionsMarkup}
      </div>
      <div class="flex justify-end">
        <button type="button" class="btn" data-bilan-cancel>Annuler</button>
      </div>
    </div>
  `);

  return new Promise((resolve) => {
    if (!overlay) {
      resolve(null);
      return;
    }
    const originalRemove = overlay.remove.bind(overlay);
    let settled = false;
    const finalize = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
      originalRemove();
    };
    overlay.remove = () => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
      originalRemove();
    };
    overlay.querySelectorAll("[data-bilan-scope]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const scope = btn.getAttribute("data-bilan-scope");
        const label = btn.getAttribute("data-bilan-label") || summaryScopeLabel(scope);
        finalize({ scope, label });
      });
    });
    const cancelBtn = overlay.querySelector("[data-bilan-cancel]");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => finalize(null));
    }
  });
}

function createYearlySummaryEntry(baseDate) {
  const anchor = toStartOfDay(baseDate || new Date());
  if (!anchor) return null;
  const year = anchor.getFullYear();
  const start = new Date(year, 0, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(year, 11, 31, 23, 59, 59, 999);
  const yearKey = typeof Schema?.yearKeyFromDate === "function" ? Schema.yearKeyFromDate(anchor) : String(year);
  return {
    type: DAILY_ENTRY_TYPES.YEARLY,
    year,
    yearKey,
    yearStart: start,
    yearEnd: end,
    navLabel: `Bilan ${year}`,
    navSubtitle: `${year}`,
    weekEndsOn: DAILY_WEEK_ENDS_ON,
  };
}

function createAdhocSummaryEntry(baseDate) {
  const anchor = toStartOfDay(baseDate || new Date());
  if (!anchor) return null;
  const end = new Date(anchor.getTime());
  end.setHours(23, 59, 59, 999);
  const dayKey =
    typeof Schema?.dayKeyFromDate === "function"
      ? Schema.dayKeyFromDate(anchor)
      : anchor.toISOString().slice(0, 10);
  return {
    type: DAILY_ENTRY_TYPES.ADHOC,
    date: anchor,
    dayKey,
    start: anchor,
    end,
    navLabel: "Bilan ponctuel",
    navSubtitle: formatDailyNavLabel(anchor),
    weekEndsOn: DAILY_WEEK_ENDS_ON,
  };
}

function entryForSummaryScope(scope, baseDate = new Date()) {
  const normalized = String(scope || "").toLowerCase();
  if (normalized === "monthly") {
    return createMonthlySummaryEntry(baseDate) || createWeeklySummaryEntry(baseDate);
  }
  if (normalized === "yearly") {
    return createYearlySummaryEntry(baseDate);
  }
  if (normalized === "adhoc" || normalized.includes("ponct")) {
    return createAdhocSummaryEntry(baseDate);
  }
  return createWeeklySummaryEntry(baseDate);
}

async function openBilanModal(ctx, options = {}) {
  const scope = options.scope || "weekly";
  const entry = entryForSummaryScope(scope, new Date());
  if (!entry) {
    showToast("Impossible de préparer le bilan.");
    return null;
  }
  const title = options.title || summaryScopeLabel(scope);
  const periodLabel = entry.navSubtitle || "";
  const contextSubtitle = options.subtitle || "";
  const secondarySubtitle = contextSubtitle && contextSubtitle !== periodLabel ? contextSubtitle : "";
  const overlay = modal(`
    <div class="space-y-4">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div class="space-y-1">
          <h2 class="text-lg font-semibold">${escapeHtml(title)}</h2>
          ${periodLabel ? `<p class="text-sm text-[var(--muted)]">${escapeHtml(periodLabel)}</p>` : ""}
          ${secondarySubtitle ? `<p class="text-sm text-[var(--muted)]">${escapeHtml(secondarySubtitle)}</p>` : ""}
        </div>
        <div class="flex items-center gap-2">
          <div class="relative" data-bilan-settings>
            <button type="button" class="btn btn-ghost" data-bilan-settings-trigger title="Paramètres des bilans">
              <span aria-hidden="true">⚙️</span>
              <span class="sr-only">Paramètres</span>
            </button>
            <div class="card p-3 sm:p-4 space-y-3" data-bilan-settings-panel role="dialog" aria-label="Paramètres des bilans" hidden style="position:absolute; right:0; top:100%; margin-top:6px; min-width: 260px; z-index: 40;">
              <div class="space-y-2">
                <label class="block text-sm font-medium">Jour du bilan hebdomadaire</label>
                <select class="w-full" data-bilan-weekendson>
                  ${[0,1,2,3,4,5,6].map((i)=>{
                    const d=new Date(); d.setDate(d.getDate() + ((i - d.getDay() + 7)%7));
                    const label = DAILY_WEEKDAY_FORMATTER.format(d);
                    return `<option value="${i}">${escapeHtml(label)}</option>`;
                  }).join("")}
                </select>
                <p class="text-xs text-[var(--muted)]">Ce jour détermine quand le bilan hebdo apparaît dans l’onglet journalier et le jour du rappel hebdo.</p>
              </div>
              <fieldset class="space-y-2">
                <legend class="text-sm font-medium">Rappels par e‑mail</legend>
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" data-bilan-weekly-rem />
                  <span>Bilan de la semaine</span>
                </label>
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" data-bilan-monthly-rem />
                  <span>Bilan du mois</span>
                </label>
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" data-bilan-yearly-rem />
                  <span>Bilan de l’année</span>
                </label>
                <p class="text-xs text-[var(--muted)]">Les rappels mensuel et annuel sont envoyés la semaine qui contient la fin de la période, le jour sélectionné ci‑dessus.</p>
              </fieldset>
              <div class="flex items-center justify-end gap-2">
                <button type="button" class="btn btn-ghost" data-bilan-settings-cancel>Fermer</button>
                <button type="button" class="btn" data-bilan-settings-save>Enregistrer</button>
              </div>
            </div>
          </div>
          <button type="button" class="btn" data-bilan-close>Fermer</button>
        </div>
      </header>
      <div class="space-y-4" data-bilan-modal-root>
        <p class="text-sm text-[var(--muted)]">Chargement du bilan…</p>
      </div>
    </div>
  `);
  if (!overlay) {
    return null;
  }
  const closeBtn = overlay.querySelector("[data-bilan-close]");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => overlay.remove());
  }
  const mount = overlay.querySelector("[data-bilan-modal-root]");
  if (!mount) {
    return overlay;
  }
  // Paramètres (roue ⚙️)
  void initializeBilanSettingsControls(ctx, overlay);
  if (!window.Bilan || typeof window.Bilan.renderSummary !== "function") {
    mount.innerHTML = `<p class="text-sm text-red-600">Module de bilan indisponible.</p>`;
    return overlay;
  }
  try {
    const entryOverride = { ...entry, navLabel: title };
    await window.Bilan.renderSummary({
      ctx,
      entry: entryOverride,
      mount,
      sections: options.sections || null,
    });
  } catch (error) {
    console.error("bilan.modal.render", error);
    mount.innerHTML = `<p class="text-sm text-red-600">Impossible de charger les consignes du bilan.</p>`;
  }
  return overlay;
}

function toAppPath(h) {
  return h.replace(/^#\/u\/[^/]+\//, "#/");
}

// --------- CAT DASHBOARD (modal) ---------
window.openCategoryDashboard = async function openCategoryDashboard(ctx, category, options = {}) {
  const providedConsignes = Array.isArray(options.consignes)
    ? options.consignes.filter((item) => item && item.id)
    : null;
  let mode = options.mode === "daily" ? "daily" : "practice";
  let allowMixedMode = options.allowMixedMode === true;
  if (providedConsignes && !options.mode) {
    const modeSet = new Set(
      providedConsignes
        .map((item) => (item.mode === "daily" ? "daily" : item.mode === "practice" ? "practice" : ""))
        .filter(Boolean)
    );
    if (modeSet.size === 1) {
      const [onlyMode] = Array.from(modeSet);
      mode = onlyMode === "daily" ? "daily" : "practice";
    } else if (modeSet.size > 1) {
      allowMixedMode = true;
      mode = "daily";
    }
  }
  const customTitle = typeof options.title === "string" ? options.title : "";
  const customTrendTitle = typeof options.trendTitle === "string" ? options.trendTitle : "";
  const customDetailsTitle = typeof options.detailsTitle === "string" ? options.detailsTitle : "";
  let isPractice = mode === "practice";
  let isDaily = mode === "daily";
  const palette = [
    "#1B9E77",
    "#D95F02",
    "#7570B3",
    "#E7298A",
    "#66A61E",
    "#E6AB02",
    "#A6761D",
    "#1F78B4",
  ];
  const priorityLabels = { 1: "Haute", 2: "Moyenne", 3: "Basse" };

  const percentFormatter = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });
  const numberFormatter = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  const fullDateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const fullDayFormatter = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const shortDateFormatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  function toDate(dateIso) {
    if (!dateIso) return null;
    if (dateIso instanceof Date) {
      const copy = new Date(dateIso.getTime());
      return Number.isNaN(copy.getTime()) ? null : copy;
    }
    let value = String(dateIso);
    if (value.startsWith("ts-")) {
      value = value.slice(3);
    }
    if (!value.includes("T")) {
      const simple = `${value}T12:00:00`;
      const simpleDate = new Date(simple);
      return Number.isNaN(simpleDate.getTime()) ? null : simpleDate;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function normalizePriorityValue(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 1 && num <= 3) return num;
    return 2;
  }

  function typeLabel(type) {
    if (type === "likert6") return "Échelle ×6";
    if (type === "likert5") return "Échelle ×5";
    if (type === "yesno") return "Oui / Non";
    if (type === "montant") return "Montant";
    if (type === "num") return "Numérique";
    if (type === "checklist") return "Checklist";
    if (type === "long") return "Texte long";
    if (type === "short") return "Texte court";
    if (type === "info") return "";
    return "Libre";
  }

  function normalizeScore(type, value) {
    if (value == null) return null;
    if (type === "likert5") return Math.max(0, Math.min(1, value / 4));
    if (type === "likert6") return Math.max(0, Math.min(1, value / (LIKERT6_ORDER.length - 1 || 1)));
    if (type === "yesno") return Math.max(0, Math.min(1, value));
    if (type === "montant") return Math.max(0, Math.min(1, Number(value)));
  if (type === "checklist") {
    const states = readChecklistStates(value);
    if (!states.length) return null;
    const completed = states.filter(Boolean).length;
    return Math.max(0, Math.min(1, completed / states.length));
  }
    return null;
  }

  function formatRelativeDate(dateIso) {
    const d = dateIso instanceof Date ? dateIso : toDate(dateIso);
    if (!d) return "";
    const diffDays = Math.round((today.getTime() - d.getTime()) / 86400000);
    if (diffDays <= 0) return "Aujourd’hui";
    if (diffDays === 1) return "Hier";
    if (diffDays < 7) return `Il y a ${diffDays} j`;
    return "";
  }

  function truncateText(str, max = 160) {
    if (!str) return "—";
    const text = String(str).trim();
    if (!text) return "—";
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
  }

  try {
    const normalizedCategory = typeof category === "string" ? category.trim() : "";
    let effectiveCategory = normalizedCategory;
    let consignes = [];
    let dailyCategories = [];

    if (providedConsignes) {
      const unique = new Map();
      providedConsignes.forEach((item) => {
        if (!item || !item.id) return;
        if (!unique.has(item.id)) {
          unique.set(item.id, item);
        }
      });
      consignes = Array.from(unique.values());
      effectiveCategory = customTitle || normalizedCategory || "Consignes liées";
      dailyCategories = [];
      isPractice = mode === "practice";
      isDaily = mode === "daily";
    } else if (isPractice) {
      consignes = await Schema.listConsignesByCategory(ctx.db, ctx.user.uid, normalizedCategory);
    } else {
      const allDaily = await Schema.fetchConsignes(ctx.db, ctx.user.uid, "daily");
      const activeDaily = (allDaily || []).filter((item) => item?.active !== false);
      dailyCategories = Array.from(new Set(activeDaily.map((item) => item.category || "Général")));
      dailyCategories.sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
      const requestedCategory = normalizedCategory && normalizedCategory !== "__all__" ? normalizedCategory : "";
      effectiveCategory = requestedCategory;
      consignes = requestedCategory
        ? activeDaily.filter((item) => (item.category || "Général") === requestedCategory)
        : activeDaily;
    }

    consignes = providedConsignes
      ? (consignes || []).filter((item) => item && item.id)
      : (consignes || []).filter((item) => item?.active !== false);
    consignes.sort((a, b) => {
      const aLabel = (a.text || a.titre || a.name || "").toString();
      const bLabel = (b.text || b.titre || b.name || "").toString();
      return aLabel.localeCompare(bLabel, "fr", { sensitivity: "base" });
    });
    const iterationMetaMap = new Map();

    const seenFallback = { value: 0 };

    function ensureIterationMeta(key) {
      if (!key) return null;
      let meta = iterationMetaMap.get(key);
      if (!meta) {
        meta = {
          key,
          createdAt: null,
          sessionIndex: null,
          sessionNumber: null,
          sessionId: null,
          sources: new Set(),
        };
        iterationMetaMap.set(key, meta);
      }
      return meta;
    }

    function parseResponseDate(value) {
      if (!value) return null;
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
      }
      if (typeof value.toDate === "function") {
        try {
          const parsed = value.toDate();
          return Number.isNaN(parsed?.getTime?.()) ? null : parsed;
        } catch (err) {
          modesLogger.warn("practice-dashboard:parseDate", err);
        }
      }
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function computeIterationKey(row, createdAt) {
      const sessionId = row.sessionId || row.session_id;
      if (sessionId) return String(sessionId);
      const rawIndex = row.sessionIndex ?? row.session_index;
      if (rawIndex !== undefined && rawIndex !== null && rawIndex !== "") {
        const num = Number(rawIndex);
        if (Number.isFinite(num)) {
          return `session-${String(num + 1).padStart(4, "0")}`;
        }
      }
      const rawNumber = row.sessionNumber ?? row.session_number;
      if (rawNumber !== undefined && rawNumber !== null && rawNumber !== "") {
        const num = Number(rawNumber);
        if (Number.isFinite(num)) {
          return `session-${String(num).padStart(4, "0")}`;
        }
      }
      if (createdAt) {
        const approx = new Date(createdAt.getTime());
        approx.setMilliseconds(0);
        return `ts-${approx.toISOString()}`;
      }
      const fallback = `resp-${seenFallback.value}`;
      seenFallback.value += 1;
      return fallback;
    }

    function computeDayKey(row, createdAt) {
      const rawDay =
        row.dayKey ||
        row.day_key ||
        row.date ||
        row.day ||
        (typeof row.getDayKey === "function" ? row.getDayKey() : null);
      if (rawDay) return String(rawDay);
      const sourceDate = createdAt || parseResponseDate(row.createdAt || row.updatedAt || null);
      if (sourceDate) {
        return Schema.dayKeyFromDate(sourceDate);
      }
      const fallback = `day-${seenFallback.value}`;
      seenFallback.value += 1;
      return fallback;
    }

    const computeTemporalKey = isPractice ? computeIterationKey : computeDayKey;

    if (isPractice) {
      let practiceSessions = [];
      try {
        practiceSessions = await Schema.fetchPracticeSessions(ctx.db, ctx.user.uid, 500);
      } catch (sessionError) {
        modesLogger.warn("practice-dashboard:sessions:error", sessionError);
      }

      (practiceSessions || []).forEach((session) => {
        const createdAt = parseResponseDate(session.startedAt || session.createdAt || session.date || null);
        const key = computeTemporalKey(session, createdAt);
        const meta = ensureIterationMeta(key);
        if (!meta) return;
        meta.sources.add("session");
        if (session.sessionId && !meta.sessionId) {
          meta.sessionId = String(session.sessionId);
        }
        const rawSessionIndex = session.sessionIndex ?? session.session_index;
        if (rawSessionIndex !== undefined && rawSessionIndex !== null && rawSessionIndex !== "") {
          const parsedIndex = Number(rawSessionIndex);
          if (Number.isFinite(parsedIndex)) {
            if (meta.sessionIndex == null || parsedIndex < meta.sessionIndex) {
              meta.sessionIndex = parsedIndex;
            }
            if (meta.sessionNumber == null) {
              meta.sessionNumber = parsedIndex + 1;
            }
          }
        }
        const rawSessionNumber =
          session.sessionNumber ?? session.session_number ?? session.index ?? session.order;
        if (rawSessionNumber !== undefined && rawSessionNumber !== null && rawSessionNumber !== "") {
          const parsedNumber = Number(rawSessionNumber);
          if (Number.isFinite(parsedNumber)) {
            if (meta.sessionNumber == null || parsedNumber < meta.sessionNumber) {
              meta.sessionNumber = parsedNumber;
            }
            if (meta.sessionIndex == null) {
              meta.sessionIndex = parsedNumber - 1;
            }
          }
        }
        if (createdAt && (!meta.createdAt || createdAt < meta.createdAt)) {
          meta.createdAt = createdAt;
        }
      });
    }

    function mergeEntry(entryMap, key, payload) {
      const current = entryMap.get(key) || { date: key, value: "", note: "", createdAt: null };
      if (payload.value !== undefined) {
        current.value = mergeChecklistValues(current.value, payload.value);
      }
      if (payload.note !== undefined) current.note = payload.note;
      if (payload.createdAt instanceof Date) {
        if (!current.createdAt || payload.createdAt > current.createdAt) {
          current.createdAt = payload.createdAt;
        }
      }
      entryMap.set(key, current);
    }

    function normalizeChecklistFlag(value) {
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value !== 0;
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (!normalized) return false;
        if (["1", "true", "vrai", "oui", "yes", "ok", "done", "fait"].includes(normalized)) return true;
        if (["0", "false", "faux", "non", "no", "off"].includes(normalized)) return false;
        const numeric = Number(normalized);
        if (!Number.isNaN(numeric)) {
          return numeric !== 0;
        }
        return false;
      }
      return Boolean(value);
    }

    function parseJsonCandidate(raw) {
      if (typeof raw !== "string") return null;
      const trimmed = raw.trim();
      if (!trimmed) return null;
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        return null;
      }
    }

    function coerceChecklistLabels(source) {
      if (!source) return null;
      if (Array.isArray(source)) {
        return source.map((item) => (item == null ? "" : String(item)));
      }
      const parsed = parseJsonCandidate(source);
      if (parsed) {
        return coerceChecklistLabels(parsed);
      }
      if (typeof source === "string") {
        const parts = source
          .split(/[\n;,]+/)
          .map((part) => part.trim())
          .filter(Boolean);
        if (parts.length) return parts;
      }
      return null;
    }

    function coerceChecklistStructure(input) {
      if (input == null) return null;
      if (Array.isArray(input)) {
        return { items: input.map((item) => normalizeChecklistFlag(item)) };
      }
      if (typeof input === "string") {
        const parsed = parseJsonCandidate(input);
        if (parsed != null) {
          return coerceChecklistStructure(parsed);
        }
        return null;
      }
      if (typeof input === "object") {
        if (
          Array.isArray(input.items) ||
          Array.isArray(input.values) ||
          Array.isArray(input.checked) ||
          Array.isArray(input.answers)
        ) {
          const rawItems = input.items || input.values || input.checked || input.answers || [];
          const rawSkipped = Array.isArray(input.skipped)
            ? input.skipped
            : Array.isArray(input.skipStates)
            ? input.skipStates
            : null;
          const normalizedItems = rawItems.map((item) => normalizeChecklistFlag(item));
          const normalizedStates = normalizeChecklistStateArrays(
            { items: normalizedItems, skipped: Array.isArray(rawSkipped) ? rawSkipped : [] },
            normalizedItems.length || undefined
          );
          const labels = coerceChecklistLabels(input.labels || input.itemsLabels || input.titles || null);
          const structure = { items: normalizedStates.items };
          if (labels && labels.length) {
            structure.labels = labels;
          }
          if (Array.isArray(rawSkipped)) {
            structure.skipped = normalizedStates.skipped;
          }
          return structure;
        }
        if (typeof input.value === "string" || Array.isArray(input.value) || typeof input.value === "object") {
          return coerceChecklistStructure(input.value);
        }
      }
      return null;
    }

    function mergeChecklistValues(currentValue, nextValue) {
      const currentIsChecklist = currentValue && typeof currentValue === "object" && Array.isArray(currentValue.items);
      const nextIsChecklist = nextValue && typeof nextValue === "object" && Array.isArray(nextValue.items);
      if (!currentIsChecklist && !nextIsChecklist) {
        return nextValue;
      }
      if (!currentIsChecklist) {
        return nextIsChecklist
          ? {
              ...nextValue,
              items: nextValue.items.slice(),
              ...(Array.isArray(nextValue.labels) ? { labels: nextValue.labels.slice() } : {}),
              ...(
                Array.isArray(nextValue.skipped)
                  ? { skipped: nextValue.skipped.slice() }
                  : Array.isArray(nextValue.skipStates)
                  ? { skipped: nextValue.skipStates.slice() }
                  : {}
              ),
            }
          : nextValue;
      }
      if (!nextIsChecklist) {
        return currentValue;
      }
      const nextItems = Array.isArray(nextValue.items) ? nextValue.items : [];
      const currentItems = Array.isArray(currentValue.items) ? currentValue.items : [];
      const mergedItems = nextItems.length ? nextItems : currentItems;
      const currentLabels = Array.isArray(currentValue.labels) ? currentValue.labels : [];
      const nextLabels = Array.isArray(nextValue.labels) ? nextValue.labels : [];
      const mergedLabels = nextLabels.length ? nextLabels : currentLabels;
      const nextSkipRaw = Array.isArray(nextValue.skipped)
        ? nextValue.skipped
        : Array.isArray(nextValue.skipStates)
        ? nextValue.skipStates
        : [];
      const currentSkipRaw = Array.isArray(currentValue.skipped)
        ? currentValue.skipped
        : Array.isArray(currentValue.skipStates)
        ? currentValue.skipStates
        : [];
      const hasNextSkip = Array.isArray(nextValue.skipped) || Array.isArray(nextValue.skipStates);
      const hasCurrentSkip = Array.isArray(currentValue.skipped) || Array.isArray(currentValue.skipStates);
      const mergedSkipSource = hasNextSkip ? nextSkipRaw : currentSkipRaw;
      const normalizedStates = normalizeChecklistStateArrays(
        { items: mergedItems, skipped: mergedSkipSource },
        mergedItems.length || undefined
      );
      const merged = {
        ...currentValue,
        ...nextValue,
        items: normalizedStates.items.slice(),
      };
      if (mergedLabels.length) {
        merged.labels = mergedLabels.slice();
      } else if (merged.labels) {
        delete merged.labels;
      }
      const hasSkipValues = normalizedStates.skipped.some((value) => value === true);
      if (hasNextSkip || hasCurrentSkip) {
        if (hasSkipValues) {
          merged.skipped = normalizedStates.skipped.slice();
        } else if (merged.skipped) {
          delete merged.skipped;
        }
      } else if (merged.skipped) {
        delete merged.skipped;
      }
      return merged;
    }

    function parseHistoryEntry(entry) {
      const baseValue =
        entry.v ??
        entry.value ??
        entry.answer ??
        entry.val ??
        entry.score ??
        "";
      const baseStructure = coerceChecklistStructure(baseValue);
      const supplementalStructure =
        baseStructure ??
        coerceChecklistStructure(entry.items) ??
        coerceChecklistStructure(entry.values) ??
        coerceChecklistStructure(entry.answers) ??
        coerceChecklistStructure(entry.checked) ??
        coerceChecklistStructure(entry.checklist) ??
        null;
      let normalizedValue = supplementalStructure || baseStructure || baseValue;
      if (supplementalStructure && !baseStructure && typeof baseValue === "string" && baseValue) {
        normalizedValue = supplementalStructure;
      }
      if (normalizedValue && typeof normalizedValue === "object" && Array.isArray(normalizedValue.items)) {
        const labelCandidates = [
          normalizedValue.labels,
          entry.labels,
          entry.itemsLabels,
          entry.checklistLabels,
          entry.labelsList,
        ];
        for (const candidate of labelCandidates) {
          const parsedLabels = coerceChecklistLabels(candidate);
          if (parsedLabels && parsedLabels.length) {
            normalizedValue.labels = parsedLabels;
            break;
          }
        }
        if (!normalizedValue.items.length) {
          normalizedValue = baseValue;
        }
      }
      const createdAtCandidates = [
        entry.createdAt,
        entry.created_at,
        entry.updatedAt,
        entry.updated_at,
        entry.recordedAt,
        entry.recorded_at,
        entry.pageDate,
        entry.page_date,
        entry.pageDateIso,
        entry.page_date_iso,
        entry.dateIso,
        entry.date_iso,
        entry.timestamp,
        entry.ts,
        entry.dayKey,
        entry.day_key,
        entry.dateKey,
        entry.date_key,
        entry.date,
      ];
      let createdAt = null;
      for (const candidate of createdAtCandidates) {
        if (!candidate) continue;
        const parsed = parseResponseDate(candidate);
        if (parsed) {
          createdAt = parsed;
          break;
        }
      }
      return {
        value: normalizedValue,
        note:
          entry.comment ??
          entry.note ??
          entry.remark ??
          entry.memo ??
          entry.obs ??
          entry.observation ??
          "",
        createdAt,
      };
    }

    const consigneData = await Promise.all(
      consignes.map(async (consigne, index) => {
        const entryMap = new Map();

        let responseRows = [];
        try {
          responseRows = await Schema.fetchResponsesForConsigne(ctx.db, ctx.user.uid, consigne.id, 200);
        } catch (responseError) {
          modesLogger.warn("practice-dashboard:responses:error", responseError);
        }

        (responseRows || [])
          .filter((row) => {
            if (allowMixedMode) return true;
            return (row.mode || consigne.mode || mode) === mode;
          })
          .forEach((row) => {
            const createdAt = parseResponseDate(row.createdAt);
            let sessionIndex = null;
            let sessionId = null;
            let rawNumber = null;
            if (isPractice) {
              const rawIndex = row.sessionIndex ?? row.session_index;
              rawNumber = row.sessionNumber ?? row.session_number;
              sessionIndex =
                rawIndex !== undefined && rawIndex !== null && rawIndex !== ""
                  ? Number(rawIndex)
                  : rawNumber !== undefined && rawNumber !== null && rawNumber !== ""
                  ? Number(rawNumber) - 1
                  : null;
              sessionId =
                row.sessionId ||
                row.session_id ||
                (Number.isFinite(sessionIndex) ? `session-${String(sessionIndex + 1).padStart(4, "0")}` : null);
            }
            const key = computeTemporalKey(row, createdAt);
            const meta = ensureIterationMeta(key);
            if (!meta) return;
            meta.sources.add("response");
            if (isPractice) {
              if (sessionId && !meta.sessionId) meta.sessionId = String(sessionId);
              if (Number.isFinite(sessionIndex)) {
                if (meta.sessionIndex == null || sessionIndex < meta.sessionIndex) {
                  meta.sessionIndex = sessionIndex;
                }
                if (meta.sessionNumber == null) {
                  meta.sessionNumber = sessionIndex + 1;
                }
              }
              if (rawNumber !== undefined && rawNumber !== null && rawNumber !== "") {
                const parsedNumber = Number(rawNumber);
                if (Number.isFinite(parsedNumber)) {
                  if (meta.sessionNumber == null || parsedNumber < meta.sessionNumber) {
                    meta.sessionNumber = parsedNumber;
                  }
                }
              }
            }
            if (createdAt && (!meta.createdAt || createdAt < meta.createdAt)) {
              meta.createdAt = createdAt;
            }
            const value =
              row.value ?? row.v ?? row.answer ?? row.score ?? row.val ?? "";
            const note = row.note ?? row.comment ?? row.remark ?? "";
            mergeEntry(entryMap, key, { value, note, createdAt });
          });

        let historyEntries = [];
        try {
          historyEntries = await Schema.loadConsigneHistory(ctx.db, ctx.user.uid, consigne.id);
        } catch (historyError) {
          modesLogger.warn("practice-dashboard:history:error", historyError);
        }

        const seenHistoryEntryIds = new Set();
        (historyEntries || [])
          .filter((entry) => entry?.date)
          .forEach((entry) => {
            const entryId = entry?.id || entry?.date;
            if (entryId && seenHistoryEntryIds.has(entryId)) {
              return;
            }
            if (entryId) {
              seenHistoryEntryIds.add(entryId);
            }
            const normalized = parseHistoryEntry(entry);
            const key = isDaily
              ? computeTemporalKey({ dayKey: entry.date }, normalized.createdAt)
              : entry.date;
            const meta = ensureIterationMeta(key);
            if (!meta) return;
            meta.sources.add("history");
            if (normalized.createdAt && (!meta.createdAt || normalized.createdAt < meta.createdAt)) {
              meta.createdAt = normalized.createdAt;
            }
            const alreadyExists = entryMap.has(key);
            mergeEntry(entryMap, key, {
              value: normalized.value,
              note: normalized.note,
              createdAt: alreadyExists ? undefined : normalized.createdAt,
            });
          });

        entryMap.forEach((entry, key) => {
          const meta = iterationMetaMap.get(key);
          if (meta && !meta.createdAt && entry.createdAt) {
            meta.createdAt = entry.createdAt;
          }
        });

        return { consigne, entries: entryMap, index };
      }),
    );

    const iterationMeta = Array.from(iterationMetaMap.values())
      .sort((a, b) => {
        const aIndex = Number.isFinite(a.sessionIndex) ? a.sessionIndex : Number.isFinite(a.sessionNumber) ? a.sessionNumber - 1 : null;
        const bIndex = Number.isFinite(b.sessionIndex) ? b.sessionIndex : Number.isFinite(b.sessionNumber) ? b.sessionNumber - 1 : null;
        if (aIndex != null && bIndex != null && aIndex !== bIndex) {
          return aIndex - bIndex;
        }
        const aDate = a.createdAt || toDate(a.key);
        const bDate = b.createdAt || toDate(b.key);
        if (aDate && bDate && aDate.getTime() !== bDate.getTime()) {
          return aDate.getTime() - bDate.getTime();
        }
        if (aIndex != null) return -1;
        if (bIndex != null) return 1;
        return String(a.key).localeCompare(String(b.key));
      })
      .map((meta, idx) => {
        const key = meta.key;
        let dateObj = meta.createdAt || null;
        if (!dateObj) {
          if (typeof key === "string" && key.startsWith("ts-")) {
            const parsed = new Date(key.slice(3));
            if (!Number.isNaN(parsed.getTime())) {
              dateObj = parsed;
            }
          } else {
            dateObj = toDate(key);
          }
        }

        const displayIndex = idx + 1;
        let sessionNumber = null;
        let label = "";
        let fullLabel = "";
        let headerTitle = "";

        if (isPractice) {
          sessionNumber =
            Number.isFinite(meta.sessionNumber)
              ? Number(meta.sessionNumber)
              : Number.isFinite(meta.sessionIndex)
              ? Number(meta.sessionIndex) + 1
              : null;
          label = `Itération ${displayIndex}`;
          if (dateObj) {
            fullLabel = fullDateTimeFormatter.format(dateObj);
          } else if (sessionNumber != null && sessionNumber !== displayIndex) {
            fullLabel = `Session ${sessionNumber}`;
          } else if (sessionNumber != null) {
            fullLabel = label;
          } else {
            fullLabel = String(key);
          }
          const headerParts = [label];
          if (Number.isFinite(sessionNumber) && sessionNumber !== displayIndex) {
            headerParts.push(`Session ${sessionNumber}`);
          }
          if (fullLabel && fullLabel !== label) {
            headerParts.push(fullLabel);
          }
          headerTitle = headerParts.join(" — ");
        } else {
          if (dateObj) {
            label = shortDateFormatter.format(dateObj);
            fullLabel = fullDayFormatter.format(dateObj);
          } else {
            label = `Jour ${displayIndex}`;
            fullLabel = label;
          }
          headerTitle = fullLabel && fullLabel !== label ? `${label} — ${fullLabel}` : fullLabel || label;
        }

        return {
          key,
          iso: key,
          index: idx,
          displayIndex,
          label,
          fullLabel,
          headerTitle,
          sessionNumber,
          sessionIndex: isPractice ? meta.sessionIndex ?? null : null,
          dateObj: dateObj || null,
          dayKey: isDaily ? key : null,
        };
      });

    const iterationMetaByKey = new Map(iterationMeta.map((meta) => [meta.iso, meta]));

    const stats = consigneData.map(({ consigne, entries, index }) => {
      const timeline = iterationMeta.map((meta) => {
        const record = entries.get(meta.iso);
        const rawValue = record ? record.value : "";
        const numeric = numericPoint(consigne.type, rawValue, consigne);
        return {
          dateIso: meta.iso,
          rawValue,
          numeric,
          note: record?.note ?? "",
        };
      });
      const timelineByKey = new Map(timeline.map((point) => [point.dateIso, point]));
      const numericValues = timeline.map((point) => point.numeric).filter((point) => point != null);
      const averageNumeric = numericValues.length
        ? numericValues.reduce((acc, value) => acc + value, 0) / numericValues.length
        : null;
      const averageNormalized = normalizeScore(consigne.type, averageNumeric);
      const orderedEntries = iterationMeta
        .map((meta) => {
          const record = entries.get(meta.iso);
          if (!record) return null;
          const hasValue = record.value !== "" && record.value != null;
          const hasNote = record.note && record.note.trim();
          if (!hasValue && !hasNote) return null;
          return {
            date: meta.iso,
            value: record.value,
            note: record.note,
            createdAt: record.createdAt || meta.dateObj || null,
          };
        })
        .filter(Boolean);
      const lastEntry = orderedEntries[orderedEntries.length - 1] || null;
      const lastDateIso = lastEntry?.date || "";
      const lastMeta = lastDateIso ? iterationMetaByKey.get(lastDateIso) : null;
      // lastDateObj: date d’affichage (peut inclure createdAt si disponible)
      const lastDateObj = lastEntry?.createdAt || lastMeta?.dateObj || null;
      // lastDayDateObj: date purement basée sur le jour (clé de l’itération), pour trier par jour
      const lastDayDateObj = lastMeta?.dateObj || null;
      const lastValue = lastEntry?.value ?? "";
      const lastNote = lastEntry?.note ?? "";
      const priority = normalizePriorityValue(consigne.priority);
      const baseColor = palette[index % palette.length];
      const accentStrong = withAlpha(baseColor, priority === 1 ? 0.9 : priority === 2 ? 0.75 : 0.55);
      const accentSoft = withAlpha(baseColor, priority === 1 ? 0.18 : priority === 2 ? 0.12 : 0.08);
      const accentBorder = withAlpha(baseColor, priority === 1 ? 0.55 : priority === 2 ? 0.4 : 0.28);
      const accentProgress = withAlpha(baseColor, priority === 1 ? 0.88 : priority === 2 ? 0.66 : 0.45);
      const rowAccent = withAlpha(baseColor, priority === 1 ? 0.65 : priority === 2 ? 0.45 : 0.35);

      const rawScoreDisplay =
        averageNormalized != null
          ? percentFormatter.format(averageNormalized)
          : averageNumeric != null
          ? numberFormatter.format(averageNumeric)
          : "—";
      const scoreDisplay = consigne.type === "info" ? "" : rawScoreDisplay;
      const scoreTitle =
        averageNormalized != null
          ? consigne.type === "likert5"
            ? "Score converti en pourcentage sur une échelle de 0 à 4."
            : "Taux moyen de réussite sur la période affichée."
          : averageNumeric != null
          ? "Moyenne des valeurs numériques enregistrées."
          : "Aucune donnée disponible pour le moment.";

      const name = consigne.text || consigne.titre || consigne.name || consigne.id;
      const lastFormattedText = formatConsigneValue(consigne.type, lastValue, { consigne });
      const lastFormattedHtml = formatConsigneValue(consigne.type, lastValue, { mode: "html", consigne });
      const stat = {
        id: consigne.id,
        name,
        priority,
        priorityLabel: priorityLabels[priority] || priorityLabels[2],
        type: consigne.type || "short",
        typeLabel: typeLabel(consigne.type),
        timeline,
        entries: orderedEntries,
        timelineByKey,
        hasNumeric: numericValues.length > 0,
        averageNumeric,
        averageNormalized,
        averageDisplay: scoreDisplay,
        averageTitle: scoreTitle,
        lastDateIso,
        lastDateShort: lastDateObj ? shortDateFormatter.format(lastDateObj) : "Jamais",
        lastDateFull: lastDateObj ? fullDateTimeFormatter.format(lastDateObj) : "Jamais",
        lastRelative: formatRelativeDate(lastDateObj || lastDateIso),
  lastDayDateObj,
        lastValue,
        lastFormatted: lastFormattedText,
        lastFormattedHtml,
        lastCommentRaw: lastNote,
        commentDisplay: truncateText(lastNote, 180),
        statusKind: dotColor(consigne.type, lastValue, consigne),
        totalEntries: orderedEntries.length,
        color: baseColor,
        accentStrong,
        accentSoft,
        accentBorder,
        accentProgress,
        rowAccent,
        consigne,
      };
      return stat;
    });


    const titleText = customTitle
      ? customTitle
      : providedConsignes
      ? "Consignes liées"
      : isPractice
      ? effectiveCategory || "Pratique"
      : effectiveCategory
      ? `Journalier — ${effectiveCategory}`
      : "Journalier — toutes les catégories";
    const headerMainTitle = providedConsignes
      ? "Progression"
      : isPractice
      ? "Tableau de bord"
      : "Progression quotidienne";
    const headerSubtitle = providedConsignes
      ? "Suivi des consignes sélectionnées et de leur progression."
      : isPractice
      ? "Suivi de vos consignes et progression."
      : "Suivi de vos journées et progression.";

    const headerContextText = (() => {
      if (providedConsignes) {
        if (customTitle) return customTitle;
        return "Consignes sélectionnées";
      }
      if (isPractice) {
        return effectiveCategory || "Toutes les consignes";
      }
      if (effectiveCategory) {
        return `Catégorie : ${effectiveCategory}`;
      }
      return "Toutes les catégories";
    })();
    const safeHeaderContext = escapeHtml(headerContextText);

    const historySubtitleText = providedConsignes
      ? "Historique des consignes sélectionnées."
      : isPractice
      ? "Historique des sessions de pratique, du plus récent au plus ancien."
      : "Historique quotidien classé par entrée, du plus récent au plus ancien.";

    const html = `
      <div class="goal-modal modal practice-dashboard practice-dashboard--minimal">
        <div class="goal-modal-card modal-card practice-dashboard__card">
          <div class="practice-dashboard__header">
            <div class="practice-dashboard__title-group">
              <span class="practice-dashboard__context">${safeHeaderContext}</span>
              <h2 class="practice-dashboard__title">${escapeHtml(headerMainTitle)}</h2>
              <p class="practice-dashboard__subtitle">${escapeHtml(historySubtitleText)}</p>
            </div>
            <button type="button" class="practice-dashboard__close btn btn-ghost" data-close aria-label="Fermer">✕</button>
          </div>
          <div class="practice-dashboard__body">
            <div class="practice-dashboard__history" data-history></div>
          </div>
          <footer class="practice-dashboard__footer">
            <div class="practice-dashboard__footer-actions">
              <button type="button" class="btn btn-ghost" data-dismiss-dashboard>Fermer</button>
            </div>
          </footer>
        </div>
      </div>
    `;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const overlay = wrapper.firstElementChild;
    if (!overlay) return;
    const dashboardMode = allowMixedMode ? "mixed" : isPractice ? "practice" : "daily";
    overlay.setAttribute("data-section", isPractice ? "practice" : "daily");
    overlay.setAttribute("data-dashboard-mode", dashboardMode);
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", `${titleText} — tableau de bord`);
    document.body.appendChild(overlay);
    wrapper.innerHTML = "";
    const dashboardCard = overlay.querySelector(".practice-dashboard__card");
    if (dashboardCard) {
      dashboardCard.setAttribute("data-dashboard-mode", dashboardMode);
    }

    const close = () => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelectorAll("[data-close]").forEach((button) => {
      button.addEventListener("click", close);
    });
    overlay.querySelectorAll("[data-dismiss-dashboard]").forEach((button) => {
      button.addEventListener("click", close);
    });
    overlay.querySelector("[data-primary-action]")?.addEventListener("click", close);

    const historyContainer = overlay.querySelector("[data-history]");

    function renderHistory() {
      if (!historyContainer) return;
      if (!stats.length) {
        historyContainer.innerHTML = '<p class="practice-dashboard__empty">Aucune consigne à afficher pour le moment.</p>';
        return;
      }
      const statusLabels = {
        "ok-strong": "Très positif",
        "ok-soft": "Plutôt positif",
        mid: "Intermédiaire",
        "ko-soft": "Plutôt négatif",
        "ko-strong": "Très négatif",
        note: "Réponse notée",
        na: "Sans donnée",
      };
      // En mode journalier, on affiche les consignes les plus récentes (par jour) en premier
      const renderedStats = (isPractice || allowMixedMode)
        ? stats
        : stats
            .slice()
            .sort((a, b) => {
              const at = a.lastDayDateObj ? a.lastDayDateObj.getTime() : -Infinity;
              const bt = b.lastDayDateObj ? b.lastDayDateObj.getTime() : -Infinity;
              // tri décroissant: plus récent en haut
              return bt - at;
            });

      const cards = renderedStats
        .map((stat) => {
          const accentStyle = stat.accentStrong
            ? ` style="--history-accent:${stat.accentStrong}; --history-soft:${stat.accentSoft}; --history-border:${stat.accentBorder};"`
            : "";
          const entries = (stat.entries || [])
            .slice()
            .reverse()
            .map((entry) => {
              const meta = iterationMetaByKey.get(entry.date) || null;
              let pointIndex = Number.isInteger(meta?.index) ? meta.index : -1;
              if (pointIndex === -1) {
                pointIndex = stat.timeline.findIndex((point) => point.dateIso === entry.date);
              }
              if (pointIndex < 0) return "";
              const statusKind = dotColor(stat.type, entry.value, stat.consigne);
              const statusLabel = statusLabels[statusKind] || "Valeur";
              const dateLabel = meta?.fullLabel || meta?.label || entry.date;
              const relativeLabel = formatRelativeDate(meta?.dateObj || entry.date);
              const valueText = formatConsigneValue(stat.type, entry.value, { consigne: stat.consigne });
              const valueHtml = formatConsigneValue(stat.type, entry.value, { mode: "html", consigne: stat.consigne });
              const normalizedValue = valueText == null ? "" : String(valueText).trim();
              const hasValue = normalizedValue && normalizedValue !== "—";
              const fallbackValue = stat.type === "info" ? "" : "—";
              const safeValue = hasValue ? valueHtml : escapeHtml(fallbackValue);
              const noteMarkup = entry.note && entry.note.trim()
                ? `<span class="practice-dashboard__history-note">${escapeHtml(entry.note)}</span>`
                : "";
              const relativeMarkup = relativeLabel
                ? `<span class="practice-dashboard__history-date-sub">${escapeHtml(relativeLabel)}</span>`
                : "";
              return `
                <li class="practice-dashboard__history-item">
                  <button type="button" class="practice-dashboard__history-entry" data-entry data-consigne="${stat.id}" data-index="${pointIndex}">
                    <span class="practice-dashboard__history-entry-main">
                      <span class="practice-dashboard__history-dot practice-dashboard__history-dot--${statusKind}" aria-hidden="true"></span>
                      <span class="practice-dashboard__history-entry-text">
                        <span class="practice-dashboard__history-value">${safeValue}</span>
                        ${noteMarkup}
                      </span>
                    </span>
                    <span class="practice-dashboard__history-date">
                      <span class="practice-dashboard__history-date-main">${escapeHtml(dateLabel)}</span>
                      ${relativeMarkup}
                    </span>
                    <span class="sr-only">${escapeHtml(statusLabel)}</span>
                  </button>
                </li>
              `;
            })
            .filter(Boolean);
          const entriesMarkup = entries.length
            ? `<ol class="practice-dashboard__history-list">${entries.join("")}</ol>`
            : '<p class="practice-dashboard__empty">Aucune entrée enregistrée pour le moment.</p>';
          const metaParts = [];
          if (stat.lastRelative) {
            metaParts.push(`<span>${escapeHtml(stat.lastRelative)}</span>`);
          }
          if (stat.lastDateFull) {
            metaParts.push(`<span>${escapeHtml(stat.lastDateFull)}</span>`);
          }
          const metaMarkup = metaParts.length
            ? metaParts.join('<span class="practice-dashboard__history-meta-sep" aria-hidden="true">•</span>')
            : '<span>Aucune donnée récente</span>';
          const commentMarkup = stat.lastCommentRaw && stat.lastCommentRaw.trim()
            ? `<p class="practice-dashboard__history-last-note"><span class="practice-dashboard__history-last-note-label">Dernier commentaire :</span> ${escapeHtml(stat.commentDisplay)}</p>`
            : "";
          const totalEntries = stat.totalEntries || 0;
          const entriesLabel = totalEntries > 1 ? `${totalEntries} entrées` : `${totalEntries} entrée`;
          const typeChip = stat.typeLabel ? `<span class="practice-dashboard__chip">${escapeHtml(stat.typeLabel)}</span>` : "";
          const lastValueText = stat.lastFormatted || "";
          const hasLastValue = lastValueText && lastValueText.trim() && lastValueText !== "—";
          const lastValueMarkup = hasLastValue
            ? stat.lastFormattedHtml || escapeHtml(lastValueText)
            : escapeHtml(stat.type === "info" ? "" : "—");
          return `
            <section class="practice-dashboard__history-section" data-id="${stat.id}"${accentStyle}>
              <header class="practice-dashboard__history-header">
                <div class="practice-dashboard__history-heading-group">
                  <h3 class="practice-dashboard__history-heading">${escapeHtml(stat.name)}</h3>
                  <p class="practice-dashboard__history-meta">${metaMarkup}</p>
                </div>
                <div class="practice-dashboard__history-tags">
                  <span class="practice-dashboard__chip">Priorité ${escapeHtml(stat.priorityLabel)}</span>
                  ${typeChip}
                  <span class="practice-dashboard__chip">${escapeHtml(entriesLabel)}</span>
                </div>
              </header>
              <div class="practice-dashboard__history-summary" role="list">
                <div class="practice-dashboard__history-summary-item" role="listitem">
                  <span class="practice-dashboard__history-summary-label">Dernière valeur</span>
                  <span class="practice-dashboard__history-summary-value">${lastValueMarkup}</span>
                </div>
                <div class="practice-dashboard__history-summary-item" role="listitem">
                  <span class="practice-dashboard__history-summary-label">Moyenne</span>
                  <span class="practice-dashboard__history-summary-value" title="${escapeHtml(stat.averageTitle)}">${escapeHtml(stat.averageDisplay || (stat.type === "info" ? "" : "—"))}</span>
                </div>
                <div class="practice-dashboard__history-summary-item" role="listitem">
                  <span class="practice-dashboard__history-summary-label">Dernière mise à jour</span>
                  <span class="practice-dashboard__history-summary-value">${escapeHtml(stat.lastDateShort || "Jamais")}</span>
                </div>
              </div>
              ${commentMarkup}
              ${entriesMarkup}
            </section>
          `;
        })
        .join("");
      historyContainer.innerHTML = `<div class="practice-dashboard__history-grid">${cards}</div>`;
    }

    renderHistory();

    historyContainer?.addEventListener("click", (event) => {
      const target = event.target.closest("[data-entry]");
      if (!target) return;
      const consigneId = target.getAttribute("data-consigne");
      const pointIndex = Number(target.getAttribute("data-index"));
      if (!Number.isFinite(pointIndex)) return;
      // Rechercher la stat par id dans la dernière version rendue
      const sections = Array.from(historyContainer.querySelectorAll('.practice-dashboard__history-section'));
      const idx = sections.findIndex((sec) => sec.getAttribute('data-id') === consigneId);
      const renderedStats = (isPractice || allowMixedMode)
        ? stats
        : stats
            .slice()
            .sort((a, b) => {
              const at = a.lastDayDateObj ? a.lastDayDateObj.getTime() : -Infinity;
              const bt = b.lastDayDateObj ? b.lastDayDateObj.getTime() : -Infinity;
              return bt - at;
            });
      const stat = renderedStats.find((item) => item.id === consigneId) || stats.find((item) => item.id === consigneId);
      if (!stat) return;
      if (stat.type === "info") return;
      openCellEditor(stat, pointIndex);
    });

    function buildValueField(consigne, value, fieldId) {
      return renderConsigneValueField(consigne, value, fieldId);
    }

    function readValueFromForm(consigne, form) {
      return readConsigneValueFromForm(consigne, form);
    }

    function updateStatAfterEdit(stat, pointIndex, newRawValue, newNote) {
      const point = stat.timeline[pointIndex];
      if (!point) return;
      const rawValue = newRawValue === null || newRawValue === undefined ? "" : newRawValue;
      const note = newNote ? newNote : "";
      point.rawValue = rawValue;
      point.note = note;
      point.numeric = numericPoint(stat.type, rawValue, stat.consigne);
      if (stat.timelineByKey) {
        stat.timelineByKey.set(point.dateIso, point);
      }
      const meta = iterationMeta[pointIndex];
      const existingIndex = stat.entries.findIndex((entry) => entry.date === point.dateIso);
      const existingEntry = existingIndex !== -1 ? stat.entries[existingIndex] : null;
      const createdAt = existingEntry?.createdAt || meta?.dateObj || null;
      const hasValue = !(rawValue === "" || (typeof rawValue === "string" && !rawValue.trim()));
      const hasNote = !!note && note.trim();
      if (!hasValue && !hasNote) {
        if (existingIndex !== -1) stat.entries.splice(existingIndex, 1);
      } else if (existingIndex !== -1) {
        stat.entries[existingIndex] = { date: point.dateIso, value: rawValue, note, createdAt };
      } else {
        stat.entries.push({ date: point.dateIso, value: rawValue, note, createdAt });
        stat.entries.sort((a, b) => a.date.localeCompare(b.date));
      }

      const numericValues = stat.timeline.map((item) => item.numeric).filter((item) => item != null);
      stat.hasNumeric = numericValues.length > 0;
      stat.averageNumeric = numericValues.length
        ? numericValues.reduce((acc, value) => acc + value, 0) / numericValues.length
        : null;
      stat.averageNormalized = normalizeScore(stat.type, stat.averageNumeric);
      const updatedAverageDisplay = stat.averageNormalized != null
        ? percentFormatter.format(stat.averageNormalized)
        : stat.averageNumeric != null
        ? numberFormatter.format(stat.averageNumeric)
        : "—";
      stat.averageDisplay = stat.type === "info" ? "" : updatedAverageDisplay;
      stat.averageTitle = stat.averageNormalized != null
        ? stat.type === "likert5"
          ? "Score converti en pourcentage sur une échelle de 0 à 4."
          : "Taux moyen de réussite sur la période affichée."
        : stat.averageNumeric != null
        ? "Moyenne des valeurs numériques enregistrées."
        : "Aucune donnée disponible pour le moment.";

      stat.totalEntries = stat.entries.length;
      const lastEntry = stat.entries[stat.entries.length - 1] || null;
      const lastDateIso = lastEntry?.date || "";
      const lastMeta = lastDateIso ? iterationMetaByKey.get(lastDateIso) : null;
      const lastDateObj = lastEntry?.createdAt || lastMeta?.dateObj || null;
      const lastValue = lastEntry?.value ?? "";
  // Maintenir la date de jour utilisée pour le tri décroissant en mode daily
  stat.lastDayDateObj = lastMeta?.dateObj || null;
      stat.lastDateIso = lastDateIso;
      stat.lastDateShort = lastDateObj ? shortDateFormatter.format(lastDateObj) : "Jamais";
      stat.lastDateFull = lastDateObj ? fullDateTimeFormatter.format(lastDateObj) : "Jamais";
      stat.lastRelative = formatRelativeDate(lastDateObj || lastDateIso);
      stat.lastValue = lastValue;
      stat.lastFormatted = formatConsigneValue(stat.type, lastValue, { consigne: stat.consigne });
      stat.lastFormattedHtml = formatConsigneValue(stat.type, lastValue, { mode: "html", consigne: stat.consigne });
      stat.lastCommentRaw = lastEntry?.note ?? "";
      stat.commentDisplay = truncateText(stat.lastCommentRaw, 180);
      stat.statusKind = dotColor(stat.type, lastValue, stat.consigne);
    }

  function openCellEditor(stat, pointIndex) {
      if (stat?.type === "info") {
        return;
      }
      const point = stat.timeline[pointIndex];
      if (!point) return;
      const consigne = stat.consigne;
      const valueId = `practice-editor-value-${stat.id}-${pointIndex}-${Date.now()}`;
  const valueField = buildValueField(consigne, point.rawValue, valueId);
      const noteValue = point.note || "";
      const iterationInfo = iterationMeta[pointIndex];
      const iterationLabel = iterationInfo?.label || `Itération ${pointIndex + 1}`;
      const dateObj = iterationInfo?.dateObj || toDate(point.dateIso);
      const fullDateLabel = iterationInfo?.fullLabel || (dateObj ? fullDateTimeFormatter.format(dateObj) : point.dateIso);
      const dateLabel = fullDateLabel && fullDateLabel !== iterationLabel ? `${iterationLabel} — ${fullDateLabel}` : fullDateLabel || iterationLabel;
      const responseSyncOptions = (() => {
        const createdAt = dateObj instanceof Date && !Number.isNaN(dateObj.getTime()) ? dateObj : null;
        const createdAtIso = createdAt ? createdAt.toISOString() : "";
        const dayKey = createdAt && typeof Schema?.dayKeyFromDate === "function"
          ? Schema.dayKeyFromDate(createdAt)
          : "";
        return {
          responseMode: "practice",
          responseType: consigne?.type,
          responseDayKey: dayKey,
          responseCreatedAt: createdAtIso,
        };
      })();
      const autosaveKeyParts = [
        "practice-entry",
        ctx.user?.uid || "anon",
        stat.id || "stat",
        point.dateIso || pointIndex,
      ];
      const autosaveKey = autosaveKeyParts.map((part) => String(part)).join(":");
      const editorHtml = `
        <form class="practice-editor" data-autosave-key="${escapeHtml(autosaveKey)}">
          <header class="practice-editor__header">
            <h3 class="practice-editor__title">Modifier la note</h3>
            <p class="practice-editor__subtitle">${escapeHtml(stat.name)}</p>
          </header>
          <div class="practice-editor__section">
            <label class="practice-editor__label">Date</label>
            <p class="practice-editor__value">${escapeHtml(dateLabel)}</p>
          </div>
          <div class="practice-editor__section">
            <label class="practice-editor__label" for="${valueId}">Valeur</label>
            ${valueField}
          </div>
          <div class="practice-editor__section">
            <label class="practice-editor__label" for="${valueId}-note">Commentaire</label>
            <textarea id="${valueId}-note" name="note" class="consigne-editor__textarea" placeholder="Ajouter un commentaire">${escapeHtml(noteValue)}</textarea>
          </div>
          <div class="practice-editor__actions">
            <button type="button" class="btn btn-ghost" data-cancel>Annuler</button>
            <button type="button" class="btn btn-danger" data-clear>Effacer</button>
            <button type="submit" class="btn btn-primary">Enregistrer</button>
          </div>
        </form>
      `;
      const panel = modal(editorHtml);
      const form = panel.querySelector("form");
      const cancelBtn = form.querySelector("[data-cancel]");
      const clearBtn = form.querySelector("[data-clear]");
      const submitBtn = form.querySelector('button[type="submit"]');
      cancelBtn?.addEventListener("click", () => panel.remove());
      if (clearBtn) {
        const hasInitialData =
          (point.rawValue !== "" && point.rawValue != null) || (point.note && point.note.trim());
        if (!hasInitialData) {
          clearBtn.disabled = true;
        }
        clearBtn.addEventListener("click", async (event) => {
          event.preventDefault();
          if (!confirm("Effacer la note pour cette date ?")) return;
          clearBtn.disabled = true;
          submitBtn.disabled = true;
          try {
            await Schema.deleteHistoryEntry(ctx.db, ctx.user.uid, stat.id, point.dateIso, responseSyncOptions);
            updateStatAfterEdit(stat, pointIndex, "", "");
            renderHistory();
            panel.remove();
          } catch (err) {
            console.error("practice-dashboard:clear-cell", err);
            clearBtn.disabled = false;
            submitBtn.disabled = false;
          }
        });
      }
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (submitBtn.disabled) return;
        submitBtn.disabled = true;
        if (clearBtn) clearBtn.disabled = true;
        try {
          const rawValue = readValueFromForm(consigne, form);
          const note = (form.elements.note?.value || "").trim();
          const isRawEmpty = rawValue === "" || rawValue == null;
          if (isRawEmpty && !note) {
            await Schema.deleteHistoryEntry(ctx.db, ctx.user.uid, stat.id, point.dateIso, responseSyncOptions);
            updateStatAfterEdit(stat, pointIndex, "", "");
          } else {
            await Schema.saveHistoryEntry(
              ctx.db,
              ctx.user.uid,
              stat.id,
              point.dateIso,
              {
                value: rawValue,
                note,
              },
              responseSyncOptions,
            );
            updateStatAfterEdit(stat, pointIndex, rawValue, note);
          }
          renderHistory();
          panel.remove();
        } catch (err) {
          console.error("practice-dashboard:save-cell", err);
          submitBtn.disabled = false;
          if (clearBtn) clearBtn.disabled = false;
        }
      });
    }

    // Tableau de bord réduit à la liste : aucune logique de graphique nécessaire.
  } catch (err) {
    console.warn("openCategoryDashboard:error", err);
  }
};
// --------- DRAG & DROP (ordre consignes) ---------
window.attachConsignesDragDrop = function attachConsignesDragDrop(container, ctx) {
  let dragId = null;
  let dragWrapper = null;

  container.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.consigne-row');
    if (!el || el.dataset.parentId) return;
    dragId = el.dataset.id;
    dragWrapper = el.closest('.consigne-group') || el;
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragover', (e) => {
    if (!dragId || !dragWrapper) return;
    e.preventDefault();
    let over = e.target.closest('.consigne-row');
    if (!over || over.dataset.parentId) {
      over = e.target.closest('.consigne-group')?.querySelector('.consigne-row');
    }
    if (!over || over.dataset.id === dragId || over.dataset.parentId) return;
    const overWrapper = over.closest('.consigne-group') || over;
    const rect = overWrapper.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    overWrapper.parentNode.insertBefore(
      dragWrapper,
      before ? overWrapper : overWrapper.nextSibling
    );
  });

  container.addEventListener('drop', async (e) => {
    if (!dragId) return;
    e.preventDefault();
    const cards = [...container.querySelectorAll('.consigne-row:not([data-parent-id])')];
    try {
      await Promise.all(cards.map((el, idx) =>
        Schema.updateConsigneOrder(ctx.db, ctx.user.uid, el.dataset.id, (idx+1)*10)
      ));
    } catch (err) {
      console.warn('drag-drop:save-order:error', err);
    }
    dragId = null;
    dragWrapper = null;
  });

  container.addEventListener('dragend', () => {
    dragId = null;
    dragWrapper = null;
  });
};

window.attachDailyCategoryDragDrop = function attachDailyCategoryDragDrop(container, ctx) {
  if (!container || container.__dailyCategoryDragInstalled) return;
  container.__dailyCategoryDragInstalled = true;
  const selector = '.daily-category';
  const ensureDraggable = () => {
    container.querySelectorAll(selector).forEach((category) => {
      if (!category.dataset.categoryDragReady) {
        category.draggable = true;
        category.dataset.categoryDragReady = '1';
      }
    });
  };
  ensureDraggable();
  let dragging = null;
  const clearDrag = () => {
    if (dragging) {
      dragging.classList.remove('opacity-70');
    }
    dragging = null;
  };
  const persistOrder = async () => {
    const rows = Array.from(
      container.querySelectorAll(
        '.daily-category .consigne-row[data-id]:not([data-parent-id])'
      )
    );
    if (!rows.length) return;
    try {
      await Promise.all(
        rows.map((row, index) =>
          Schema.updateConsigneOrder(ctx.db, ctx.user.uid, row.dataset.id, (index + 1) * 10)
        )
      );
    } catch (error) {
      console.warn('drag-drop:save-category-order:error', error);
    }
  };
  container.addEventListener('dragstart', (event) => {
    const category = event.target?.closest(selector);
    if (!category) return;
    if (event.target?.closest('.consigne-row')) return;
    dragging = category;
    category.classList.add('opacity-70');
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', category.dataset.category || '');
    } catch (error) {
      // ignore
    }
  });
  container.addEventListener('dragover', (event) => {
    if (!dragging) return;
    if (event.target?.closest('.consigne-row')) return;
    const over = event.target?.closest(selector);
    if (!over || over === dragging) return;
    event.preventDefault();
    const rect = over.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    over.parentNode.insertBefore(dragging, before ? over : over.nextSibling);
  });
  container.addEventListener('drop', async (event) => {
    if (!dragging) return;
    if (event.target?.closest('.consigne-row')) return;
    event.preventDefault();
    const target = event.target?.closest(selector);
    if (target && target !== dragging) {
      const rect = target.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      target.parentNode.insertBefore(dragging, before ? target : target.nextSibling);
    }
    clearDrag();
    ensureDraggable();
    await persistOrder();
  });
  container.addEventListener('dragend', () => {
    clearDrag();
    ensureDraggable();
  });
};

function resolveCategoryOrderValue(category) {
  const hasOrder = category && Object.prototype.hasOwnProperty.call(category, "order");
  const raw = hasOrder ? category.order : null;
  if (raw == null) {
    return Number.POSITIVE_INFINITY;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Number.POSITIVE_INFINITY;
}

function sortCategoriesForDisplay(list = []) {
  return list
    .slice()
    .sort((a, b) => {
      const orderA = resolveCategoryOrderValue(a);
      const orderB = resolveCategoryOrderValue(b);
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      const nameA = a?.name || "";
      const nameB = b?.name || "";
      return nameA.localeCompare(nameB, "fr", { sensitivity: "base" });
    });
}

function createCategoryMenu({
  categories = [],
  currentName = "",
  onSelect = null,
  onReorder = null,
  disabled = false,
} = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "relative";
  wrapper.dataset.categoryMenu = "true";

  let isOpen = false;
  let dragSourceId = null;
  let dragStartOrder = [];
  let current = currentName || "";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "btn btn-ghost text-sm min-w-[180px] justify-between gap-2 border border-slate-200 text-left";
  trigger.disabled = disabled;
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const triggerLabel = document.createElement("span");
  triggerLabel.className = "truncate";
  trigger.appendChild(triggerLabel);
  const triggerIcon = document.createElement("span");
  triggerIcon.setAttribute("aria-hidden", "true");
  triggerIcon.textContent = "▾";
  trigger.appendChild(triggerIcon);

  const menu = document.createElement("div");
  menu.className = "absolute z-40 mt-2 w-64 rounded-xl border border-slate-200 bg-white shadow-lg";
  menu.hidden = true;

  const menuHeader = document.createElement("div");
  menuHeader.className = "px-3 py-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]";
  menuHeader.textContent = categories.length
    ? "Glisser-déposer pour réordonner"
    : "Aucune catégorie";
  menu.appendChild(menuHeader);

  const list = document.createElement("ul");
  list.className = "max-h-64 overflow-y-auto py-1";
  list.setAttribute("role", "listbox");
  menu.appendChild(list);

  const updateCurrentLabel = (name) => {
    current = name || "";
    triggerLabel.textContent = current || "Choisir…";
    list.querySelectorAll("[data-cat-select]").forEach((btn) => {
      const btnName = btn.getAttribute("data-cat-select") || "";
      const isSelected = btnName === current;
      btn.classList.toggle("bg-slate-100", isSelected);
      btn.classList.toggle("font-semibold", isSelected);
      btn.setAttribute("aria-selected", isSelected ? "true" : "false");
    });
  };

  const escapeId = (value) => {
    if (!value) return "";
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return String(value).replace(/"/g, '\\"');
  };

  function closeMenu() {
    if (!isOpen) return;
    isOpen = false;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", handleDocumentClick);
    document.removeEventListener("keydown", handleKeydown);
  }

  function handleDocumentClick(event) {
    if (!wrapper.contains(event.target)) {
      closeMenu();
    }
  }

  function handleKeydown(event) {
    if (event.key === "Escape") {
      closeMenu();
      trigger.focus({ preventScroll: true });
    }
  }

  function openMenu() {
    if (isOpen || disabled) return;
    isOpen = true;
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("mousedown", handleDocumentClick);
    document.addEventListener("keydown", handleKeydown);
  }

  trigger.addEventListener("click", () => {
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  const captureOrder = () =>
    Array.from(list.querySelectorAll("[data-cat-id]"))
      .map((item) => item.getAttribute("data-cat-id") || "")
      .filter(Boolean);

  const buildItem = (cat) => {
    const item = document.createElement("li");
    item.className = "px-2";
    item.dataset.catId = cat?.id || "";
    item.dataset.catName = cat?.name || "";
    if (!disabled && item.dataset.catId) {
      item.draggable = true;
    }

    const row = document.createElement("div");
    row.className = "flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50";

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "flex-1 truncate text-left";
    selectBtn.textContent = cat?.name || "Sans nom";
    selectBtn.dataset.catSelect = cat?.name || "";
    row.appendChild(selectBtn);

    const handle = document.createElement("span");
    handle.className = "cursor-grab select-none text-lg text-slate-400";
    handle.setAttribute("aria-hidden", "true");
    handle.textContent = "⋮⋮";
    row.appendChild(handle);

    item.appendChild(row);

    selectBtn.addEventListener("click", () => {
      const name = selectBtn.dataset.catSelect || "";
      updateCurrentLabel(name);
      closeMenu();
      if (typeof onSelect === "function") {
        onSelect(name);
      }
    });

    return item;
  };

  if (categories.length) {
    categories.forEach((cat) => {
      list.appendChild(buildItem(cat));
    });
  }

  const handleDragStart = (event) => {
    if (disabled) return;
    const item = event.target.closest("[data-cat-id]");
    if (!item || !item.dataset.catId) return;
    dragSourceId = item.dataset.catId;
    dragStartOrder = captureOrder();
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", item.dataset.catId);
    } catch (error) {
      // ignore — browsers may throw if unsupported
    }
    item.classList.add("ring", "ring-indigo-200");
  };

  const handleDragOver = (event) => {
    if (!dragSourceId) return;
    event.preventDefault();
    const over = event.target.closest("[data-cat-id]");
    if (!over || over.dataset.catId === dragSourceId) return;
    const source = list.querySelector(`[data-cat-id="${escapeId(dragSourceId)}"]`);
    if (!source) return;
    const rect = over.getBoundingClientRect();
    const before = event.clientY - rect.top < rect.height / 2;
    over.parentNode.insertBefore(source, before ? over : over.nextSibling);
  };

  const handleDrop = (event) => {
    if (!dragSourceId) return;
    event.preventDefault();
    const source = list.querySelector(`[data-cat-id="${escapeId(dragSourceId)}"]`);
    if (source) {
      source.classList.remove("ring", "ring-indigo-200");
    }
    const nextOrder = captureOrder();
    const changed = JSON.stringify(nextOrder) !== JSON.stringify(dragStartOrder);
    dragSourceId = null;
    dragStartOrder = [];
    if (changed && typeof onReorder === "function") {
      onReorder(nextOrder);
    }
  };

  const handleDragEnd = () => {
    if (!dragSourceId) return;
    const source = list.querySelector(`[data-cat-id="${escapeId(dragSourceId)}"]`);
    if (source) {
      source.classList.remove("ring", "ring-indigo-200");
    }
    dragSourceId = null;
    dragStartOrder = [];
  };

  list.addEventListener("dragstart", handleDragStart);
  list.addEventListener("dragover", handleDragOver);
  list.addEventListener("drop", handleDrop);
  list.addEventListener("dragend", handleDragEnd);

  wrapper.appendChild(trigger);
  wrapper.appendChild(menu);

  updateCurrentLabel(current);

  return {
    element: wrapper,
    close: closeMenu,
    setCurrent: updateCurrentLabel,
  };
}

async function categorySelect(ctx, mode, currentName = "") {
  const cats = await Schema.fetchCategories(ctx.db, ctx.user.uid);
  const uniqueNames = Array.from(new Set(cats.map((c) => c.name).filter(Boolean)));
  uniqueNames.sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
  const listId = `category-list-${mode}-${Date.now()}`;

  return `
    <label class="block text-sm text-[var(--muted)] mb-1">Catégorie</label>
    <input name="categoryInput"
           list="${listId}"
           class="w-full"
           placeholder="Choisir ou taper un nom…"
           value="${escapeHtml(currentName || "")}">
    <datalist id="${listId}">
      ${uniqueNames.map(n => `<option value="${escapeHtml(n)}"></option>`).join("")}
    </datalist>
    <div class="text-xs text-[var(--muted)] mt-1">
      Tu peux taper un nouveau nom ou choisir dans la liste.
    </div>
  `;
}

function consigneActions() {
  const actionBtn = (label, cls = "") => `
    <button type="button" class="btn btn-ghost text-sm text-left ${cls}" role="menuitem">${label}</button>
  `;
  return `
    <div class="daily-consigne__actions js-consigne-actions" role="group" aria-label="Actions" style="position:relative;">
      <button type="button"
              class="btn btn-ghost text-sm consigne-actions__trigger js-actions-trigger"
              aria-haspopup="true"
              aria-expanded="false"
              title="Actions">
        <span aria-hidden="true">⋮</span>
        <span class="sr-only">Actions</span>
      </button>
      <div class="consigne-actions__panel js-actions-panel card"
           role="menu"
           aria-hidden="true"
           hidden>
        ${actionBtn("Historique", "js-histo")}
        ${actionBtn("Modifier", "js-edit")}
        ${actionBtn("Décaler", "js-delay")}
        ${actionBtn("Activer la répétition espacée", "js-sr-toggle")}
        ${actionBtn("Archiver", "js-archive")}
        ${actionBtn("Supprimer", "js-del text-red-600")}
      </div>
    </div>
  `;
}

const CONSIGNE_ACTION_SELECTOR = ".js-consigne-actions";
let openConsigneActionsRoot = null;
let consigneActionsDocListenersBound = false;
const consigneActionPanelState = new WeakMap();

const CONSIGNE_ACTION_FLOATING_GAP = 8;
let consigneActionsRootSeq = 0;
const consigneActionsRootRegistry = new Map();

function getConsigneActionElements(root) {
  if (!root) return { trigger: null, panel: null };
  const state = consigneActionPanelState.get(root);
  return {
    trigger: root.querySelector(".js-actions-trigger"),
    panel: state?.panel || root.querySelector(".js-actions-panel"),
  };
}

function removeConsigneActionListeners() {
  if (!consigneActionsDocListenersBound) return;
  document.removeEventListener("click", onDocumentClickConsigneActions, true);
  document.removeEventListener("keydown", onDocumentKeydownConsigneActions, true);
  consigneActionsDocListenersBound = false;
}

function ensureConsigneActionListeners() {
  if (consigneActionsDocListenersBound) return;
  document.addEventListener("click", onDocumentClickConsigneActions, true);
  document.addEventListener("keydown", onDocumentKeydownConsigneActions, true);
  consigneActionsDocListenersBound = true;
}

function closeConsigneActionMenu(root, { focusTrigger = false } = {}) {
  if (!root) return;
  const { trigger, panel } = getConsigneActionElements(root);
  if (panel && !panel.hidden) {
    panel.hidden = true;
    panel.setAttribute("aria-hidden", "true");
    unfloatConsigneActionPanel(root, panel);
  }
  if (trigger) {
    trigger.setAttribute("aria-expanded", "false");
    if (focusTrigger) {
      trigger.focus();
    }
  }
  if (openConsigneActionsRoot === root) {
    openConsigneActionsRoot = null;
    removeConsigneActionListeners();
  }
  markConsigneActionState(root, false);
}

function openConsigneActionMenu(root) {
  if (!root) return;
  if (openConsigneActionsRoot && openConsigneActionsRoot !== root) {
    closeConsigneActionMenu(openConsigneActionsRoot);
  }
  const { trigger, panel } = getConsigneActionElements(root);
  if (panel) {
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    if (!panel.hasAttribute("tabindex")) {
      panel.setAttribute("tabindex", "-1");
    }
  }
  if (trigger) {
    trigger.setAttribute("aria-expanded", "true");
  }
  openConsigneActionsRoot = root;
  ensureConsigneActionListeners();
  markConsigneActionState(root, true);
  if (panel) {
    floatConsigneActionPanel(root, panel, trigger);
  }
}

function toggleConsigneActionMenu(root) {
  if (!root) return;
  const { panel } = getConsigneActionElements(root);
  const isOpen = openConsigneActionsRoot === root && panel && !panel.hidden;
  if (isOpen) {
    closeConsigneActionMenu(root);
  } else {
    openConsigneActionMenu(root);
    if (panel && typeof panel.focus === "function") {
      try {
        panel.focus({ preventScroll: true });
      } catch (err) {
        panel.focus();
      }
    }
  }
}

function onDocumentKeydownConsigneActions(event) {
  if (!openConsigneActionsRoot) return;
  if (event.key === "Escape" || event.key === "Esc") {
    closeConsigneActionMenu(openConsigneActionsRoot, { focusTrigger: true });
    event.stopPropagation();
  }
}

function onDocumentClickConsigneActions(event) {
  if (!openConsigneActionsRoot) return;
  const state = consigneActionPanelState.get(openConsigneActionsRoot);
  const panel = state?.panel;
  if (openConsigneActionsRoot.contains(event.target)) return;
  if (panel && panel.contains(event.target)) return;
  closeConsigneActionMenu(openConsigneActionsRoot);
}

function markConsigneActionState(root, isOpen) {
  if (!root || typeof root.closest !== "function") return;
  const shouldOpen = Boolean(isOpen);
  root.classList.toggle("consigne-actions--open", shouldOpen);
  const host = root.closest(".consigne-row, .consigne-card");
  if (host) {
    host.classList.toggle("consigne-row--actions-open", shouldOpen);
  }
}

function floatConsigneActionPanel(root, panel, trigger) {
  if (!root || !panel || !trigger) return;
  const doc = root.ownerDocument || document;
  let state = consigneActionPanelState.get(root);
  if (!state) {
    state = {
      placeholder: doc.createComment("consigne-actions-panel"),
      previousStyle: null,
      rafId: null,
      lastLeft: null,
      lastTop: null,
      panel: panel,
      root,
    };
    consigneActionPanelState.set(root, state);
  } else {
    state.panel = panel;
    state.root = root;
  }
  if (!state.placeholder.parentNode) {
    panel.parentNode?.insertBefore(state.placeholder, panel);
  }
  if (!panel.dataset.consigneActionsRootId) {
    const rootId = root.dataset.consigneActionsId;
    if (rootId) {
      panel.dataset.consigneActionsRootId = rootId;
    }
  }
  if (!state.previousStyle) {
    state.previousStyle = {
      position: panel.style.position || "",
      left: panel.style.left || "",
      right: panel.style.right || "",
      top: panel.style.top || "",
      bottom: panel.style.bottom || "",
      transform: panel.style.transform || "",
      visibility: panel.style.visibility || "",
      zIndex: panel.style.zIndex || "",
      width: panel.style.width || "",
      height: panel.style.height || "",
      maxWidth: panel.style.maxWidth || "",
      willChange: panel.style.willChange || "",
    };
  }
  doc.body.appendChild(panel);
  panel.dataset.consigneActionsFloating = "1";
  panel.style.position = "fixed";
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  panel.style.left = "0";
  panel.style.top = "0";
  panel.style.transform = "translate3d(0, 0, 0)";
  panel.style.zIndex = "2147483000";
  panel.style.visibility = "hidden";
  panel.style.willChange = "transform";
  state.lastLeft = null;
  state.lastTop = null;
  startConsigneActionPanelTracking(state, trigger, panel);
  panel.style.visibility = "visible";
}

function unfloatConsigneActionPanel(root, panel) {
  const state = consigneActionPanelState.get(root);
  if (!state || !panel || panel.dataset.consigneActionsFloating !== "1") return;
  stopConsigneActionPanelTracking(state);
  const { placeholder, previousStyle } = state;
  if (placeholder?.parentNode) {
    placeholder.parentNode.replaceChild(panel, placeholder);
  } else {
    root.append(panel);
  }
  delete panel.dataset.consigneActionsFloating;
  panel.style.position = previousStyle?.position || "";
  panel.style.left = previousStyle?.left || "";
  panel.style.right = previousStyle?.right || "";
  panel.style.top = previousStyle?.top || "";
  panel.style.bottom = previousStyle?.bottom || "";
  panel.style.transform = previousStyle?.transform || "";
  panel.style.visibility = previousStyle?.visibility || "";
  panel.style.zIndex = previousStyle?.zIndex || "";
  panel.style.width = previousStyle?.width || "";
  panel.style.height = previousStyle?.height || "";
  panel.style.maxWidth = previousStyle?.maxWidth || "";
  panel.style.willChange = previousStyle?.willChange || "";
  state.lastLeft = null;
  state.lastTop = null;
}

function startConsigneActionPanelTracking(state, trigger, panel) {
  stopConsigneActionPanelTracking(state);
  const update = () => {
    state.rafId = window.requestAnimationFrame(update);
    positionConsigneActionPanel(state, trigger, panel);
  };
  update();
}

function stopConsigneActionPanelTracking(state) {
  if (!state) return;
  if (state.rafId !== null) {
    window.cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
}

function positionConsigneActionPanel(state, trigger, panel) {
  if (!trigger || !panel) return;
  if (!trigger.isConnected) {
    if (state?.root) {
      closeConsigneActionMenu(state.root);
    }
    return;
  }
  const triggerRect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const gap = CONSIGNE_ACTION_FLOATING_GAP;
  const panelRect = panel.getBoundingClientRect();
  const panelWidth = panel.offsetWidth || panelRect.width || triggerRect.width;
  const panelHeight = panel.offsetHeight || panelRect.height || triggerRect.height;
  let left = triggerRect.right - panelWidth;
  if (left + panelWidth + gap > viewportWidth) {
    left = viewportWidth - panelWidth - gap;
  }
  if (left < gap) {
    left = gap;
  }
  let top = triggerRect.bottom + gap;
  if (top + panelHeight + gap > viewportHeight) {
    const above = triggerRect.top - panelHeight - gap;
    if (above >= gap) {
      top = above;
    } else {
      top = Math.max(gap, viewportHeight - panelHeight - gap);
    }
  }
  const roundedLeft = Math.round(left);
  const roundedTop = Math.round(top);
  if (state.lastLeft !== roundedLeft || state.lastTop !== roundedTop) {
    panel.style.transform = `translate3d(${roundedLeft}px, ${roundedTop}px, 0)`;
    state.lastLeft = roundedLeft;
    state.lastTop = roundedTop;
  }
}

function setupConsigneActionMenus(scope = document, configure) {
  $$(CONSIGNE_ACTION_SELECTOR, scope).forEach((actionsRoot) => {
    if (actionsRoot.dataset.actionsMenuReady === "1") return;
    let rootId = actionsRoot.dataset.consigneActionsId;
    if (!rootId) {
      rootId = String(++consigneActionsRootSeq);
      actionsRoot.dataset.consigneActionsId = rootId;
    }
    consigneActionsRootRegistry.set(rootId, actionsRoot);
    const config = typeof configure === "function" ? configure(actionsRoot) : configure || {};
    const { trigger, panel } = getConsigneActionElements(actionsRoot);
    if (!trigger || !panel) return;
    actionsRoot.dataset.actionsMenuReady = "1";
    panel.dataset.consigneActionsRootId = rootId;
    panel.hidden = true;
    panel.setAttribute("aria-hidden", "true");
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleConsigneActionMenu(actionsRoot);
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Escape" || event.key === "Esc") {
        closeConsigneActionMenu(actionsRoot, { focusTrigger: true });
        event.stopPropagation();
      }
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape" || event.key === "Esc") {
        closeConsigneActionMenu(actionsRoot, { focusTrigger: true });
        event.stopPropagation();
      }
    });

    const srToggleBtn = actionsRoot.querySelector(".js-sr-toggle");
    const srToggleConfig = config?.srToggle;
    if (srToggleBtn && srToggleConfig) {
      const resolveEnabled = () => {
        if (typeof srToggleConfig.getEnabled === "function") {
          try {
            return Boolean(srToggleConfig.getEnabled());
          } catch (err) {
            console.error(err);
            return true;
          }
        }
        return true;
      };
      const updateButton = (enabled) => {
        const nextEnabled = Boolean(enabled);
        srToggleBtn.dataset.enabled = nextEnabled ? "1" : "0";
        srToggleBtn.setAttribute("aria-pressed", nextEnabled ? "true" : "false");
        const title = nextEnabled
          ? "Désactiver la répétition espacée"
          : "Activer la répétition espacée";
        srToggleBtn.textContent = title;
        srToggleBtn.title = title;
      };
      updateButton(resolveEnabled());
      srToggleBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const current = resolveEnabled();
        const next = !current;
        srToggleBtn.disabled = true;
        try {
          const result = await srToggleConfig.onToggle?.(next, {
            event,
            current,
            next,
            update: updateButton,
            close: () => closeConsigneActionMenu(actionsRoot),
            actionsRoot,
          });
          const finalState = typeof result === "boolean" ? result : next;
          updateButton(finalState);
        } catch (err) {
          updateButton(current);
        } finally {
          srToggleBtn.disabled = false;
          closeConsigneActionMenu(actionsRoot);
        }
      });
    }
  });
}

function closeConsigneActionMenuFromNode(node, options) {
  if (!node) return;
  let root = node.closest(CONSIGNE_ACTION_SELECTOR);
  if (!root) {
    const floatingPanel = node.closest("[data-consigne-actions-root-id]");
    if (floatingPanel) {
      const id = floatingPanel.dataset.consigneActionsRootId;
      if (id && consigneActionsRootRegistry.has(id)) {
        root = consigneActionsRootRegistry.get(id);
      }
    }
  }
  if (root) {
    closeConsigneActionMenu(root, options);
  }
}

function renderRichTextInput(
  name,
  {
    consigneId = "",
    initialValue = null,
    placeholder = "",
    inputId = "",
    advanced = false,
    colorPickerDefault = "#1f2937",
  } = {},
) {
  const normalized = normalizeRichTextValue(initialValue);
  const structuredHtml = ensureRichTextStructure(normalized.html) || "";
  const initialHtml = structuredHtml.trim() ? structuredHtml : "<p><br></p>";
  const serialized = escapeHtml(JSON.stringify(normalized));
  const consigneAttr = consigneId !== null && consigneId !== undefined
    ? ` data-consigne-id="${escapeHtml(String(consigneId))}"`
    : "";
  const placeholderAttr = placeholder
    ? ` data-placeholder="${escapeHtml(String(placeholder))}"`
    : "";
  const hiddenIdAttr = inputId ? ` id="${escapeHtml(String(inputId))}"` : "";
  const advancedAttr = advanced ? ' data-rich-text-advanced="1"' : "";
  const colorValue = typeof colorPickerDefault === "string" && colorPickerDefault.trim()
    ? colorPickerDefault.trim()
    : "#1f2937";
  const advancedToolbar = advanced
    ? `
        <span aria-hidden="true" class="consigne-rich-text__toolbar-separator" style="display:inline-flex;width:1px;height:18px;background:rgba(15,23,42,0.12);margin:0 6px;"></span>
        <div class="consigne-rich-text__toolbar-group" data-rich-advanced style="display:inline-flex;align-items:center;gap:4px;">
          <button type="button" class="btn btn-ghost text-xs" data-rich-command="formatBlock" data-rich-value="P" title="Paragraphe" aria-label="Paragraphe">¶</button>
          <button type="button" class="btn btn-ghost text-xs" data-rich-command="formatBlock" data-rich-value="H2" title="Titre" aria-label="Titre">H2</button>
          <button type="button" class="btn btn-ghost text-xs" data-rich-command="formatBlock" data-rich-value="H3" title="Sous-titre" aria-label="Sous-titre">H3</button>
          <select class="btn btn-ghost text-xs" data-rich-select-command="fontSize" title="Taille du texte" aria-label="Taille du texte" style="padding:3px 6px;">
            <option value="">Taille</option>
            <option value="3">Normal</option>
            <option value="4">Grand</option>
            <option value="5">Très grand</option>
          </select>
          <label class="btn btn-ghost text-xs" data-rich-color-trigger title="Couleur du texte" aria-label="Couleur du texte" style="position:relative;overflow:hidden;cursor:pointer;">
            <span aria-hidden="true">A</span>
            <input type="color" value="${escapeHtml(colorValue)}" data-rich-color-picker style="position:absolute;inset:0;opacity:0;cursor:pointer;">
          </label>
          <button type="button" class="btn btn-ghost text-xs" data-rich-command="removeFormat" title="Effacer la mise en forme" aria-label="Effacer la mise en forme">⟲</button>
        </div>
      `
    : "";
  return `
    <div class="consigne-rich-text" data-rich-text-root${consigneAttr}${advancedAttr}>
      <div class="consigne-rich-text__toolbar" data-rich-text-toolbar role="toolbar" aria-label="Mise en forme">
        <button type="button" class="btn btn-ghost text-xs" data-rich-command="bold" title="Gras" aria-label="Gras"><strong>B</strong></button>
        <button type="button" class="btn btn-ghost text-xs" data-rich-command="italic" title="Italique" aria-label="Italique"><em>I</em></button>
        <button type="button" class="btn btn-ghost text-xs" data-rich-command="insertUnorderedList" title="Liste à puces" aria-label="Liste à puces">•</button>
        <button type="button" class="btn btn-ghost text-xs" data-rich-command="insertOrderedList" title="Liste numérotée" aria-label="Liste numérotée">1.</button>
        <button type="button" class="btn btn-ghost text-xs" data-rich-command="checkbox" title="Insérer une case à cocher" aria-label="Insérer une case à cocher">☐</button>
        ${advancedToolbar}
      </div>
      <div class="consigne-rich-text__content consigne-editor__textarea" data-rich-text-content contenteditable="true"${placeholderAttr}>${initialHtml}</div>
      <input type="hidden"${hiddenIdAttr} name="${escapeHtml(String(name))}" value="${serialized}" data-rich-text-input data-rich-text-version="${RICH_TEXT_VERSION}" data-autosave-track="1">
    </div>
  `;
}

function setupRichTextEditor(root) {
  if (!(root instanceof HTMLElement)) return;
  if (root.dataset.richTextReady === "1") return;

  const utils = window.Modes?.richText || {};
  const content = root.querySelector("[data-rich-text-content]");
  const hidden = root.querySelector("[data-rich-text-input]");
  const toolbar = root.querySelector("[data-rich-text-toolbar]");

  if (!hidden || !content) return;

  const ensureCheckboxBehavior = () => {
    if (!content || typeof window === "undefined") return;
    waitForCheckboxSetupFunction().then((setupFn) => {
      if (typeof setupFn !== "function") return;
      try {
        const checkboxButton = toolbar?.querySelector('[data-rich-command="checkbox"]');
        setupFn(content, checkboxButton || null);
      } catch (error) {
        modesLogger?.warn?.("richtext:checkboxes:setup", error);
      }
    });
  };

  ensureCheckboxBehavior();

  const sanitizeElement = typeof utils.sanitizeElement === "function" ? utils.sanitizeElement : null;
  const sanitizeHtml = typeof utils.sanitizeHtml === "function" ? utils.sanitizeHtml : (value) => value;
  const toPlainText = typeof utils.toPlainText === "function" ? utils.toPlainText : (value) => value;
  const hasContent = typeof utils.hasContent === "function" ? utils.hasContent : null;
  const ensureStructure = typeof utils.ensureStructure === "function" ? utils.ensureStructure : null;
  const raf = window.requestAnimationFrame || ((cb) => window.setTimeout(cb, 16));
  const caf = window.cancelAnimationFrame || window.clearTimeout;

  const ensureNotEmpty = () => {
    if (!content) return;
    if (!content.innerHTML || !content.innerHTML.trim()) {
      content.innerHTML = "<p><br></p>";
    }
  };

  const applyInitialState = () => {
    if (!content || !hidden) return;
    let parsed = null;
    try {
      parsed = JSON.parse(hidden.value || "{}");
    } catch (error) {
      parsed = null;
    }
    if (parsed && parsed.html) {
      const html = ensureStructure ? ensureStructure(parsed.html) : parsed.html;
      content.innerHTML = html && html.trim() ? html : "<p><br></p>";
    }
    const boxes = Array.from(content.querySelectorAll('input[type="checkbox"]'));
    boxes.forEach((box, index) => {
      ensureCheckboxWrapper(box);
      box.setAttribute("data-rich-checkbox-index", String(index));
      if (parsed && Array.isArray(parsed.checkboxes) && parsed.checkboxes[index]) {
        box.checked = true;
        box.setAttribute("checked", "");
      } else if (box.checked) {
        box.setAttribute("checked", "");
      } else {
        box.removeAttribute("checked");
      }
    });
    ensureNotEmpty();
  };

  applyInitialState();

  let pending = null;
  let lastSerialized = hidden ? hidden.value : null;
  let savedSelection = null;
  let savedSelectionInfo = null;
  let selectionFrame = null;

  const ownerDocument = content?.ownerDocument || document;
  const boldButton = toolbar?.querySelector('[data-rich-command="bold"]');
  const italicButton = toolbar?.querySelector('[data-rich-command="italic"]');

  const isCheckboxWrapper = (node) => node?.nodeType === Node.ELEMENT_NODE
    && node.getAttribute?.("data-rich-checkbox-wrapper") === "1";

  const isWhitespaceNode = (node) => {
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    const text = node.textContent || "";
    return text.replace(/\u00a0/g, " ").trim().length === 0;
  };

  function ensureCheckboxWrapper(input) {
    if (!input || input.nodeName !== "INPUT") return null;
    input.setAttribute("type", "checkbox");
    input.setAttribute("data-rich-checkbox", "1");
    input.setAttribute("tabindex", "-1");
    input.setAttribute("contenteditable", "false");
    input.tabIndex = -1;
    input.contentEditable = "false";

    let wrapper = input.closest('[data-rich-checkbox-wrapper]');
    if (!wrapper && ownerDocument && typeof ownerDocument.createElement === "function") {
      wrapper = ownerDocument.createElement("span");
      wrapper.setAttribute("data-rich-checkbox-wrapper", "1");
      wrapper.classList.add("cb-wrap");
      wrapper.setAttribute("contenteditable", "false");
      wrapper.contentEditable = "false";
      const parent = input.parentNode;
      if (parent) {
        parent.insertBefore(wrapper, input);
        wrapper.appendChild(input);
      } else {
        wrapper.appendChild(input);
      }
    }
    if (wrapper) {
      wrapper.setAttribute("data-rich-checkbox-wrapper", "1");
      wrapper.classList.add("cb-wrap");
      wrapper.setAttribute("contenteditable", "false");
      wrapper.contentEditable = "false";
      const nextSibling = wrapper.nextSibling;
      if (isWhitespaceNode(nextSibling) && nextSibling.textContent?.includes("\u00a0")) {
        nextSibling.textContent = nextSibling.textContent.replace(/\u00a0/g, " ");
      }
    }
    return wrapper || null;
  }

  const createCheckboxWrapper = () => {
    if (!ownerDocument || typeof ownerDocument.createElement !== "function") return null;
    const wrapper = ownerDocument.createElement("span");
    wrapper.setAttribute("data-rich-checkbox-wrapper", "1");
    wrapper.classList.add("cb-wrap");
    wrapper.setAttribute("contenteditable", "false");
    wrapper.contentEditable = "false";
    const input = ownerDocument.createElement("input");
    input.setAttribute("type", "checkbox");
    input.setAttribute("data-rich-checkbox", "1");
    input.setAttribute("tabindex", "-1");
    input.setAttribute("contenteditable", "false");
    input.tabIndex = -1;
    input.contentEditable = "false";
    wrapper.appendChild(input);
    return { wrapper, input };
  };

  const updateToolbarStates = () => {
    if (!toolbar) return;
    const getSelection = ownerDocument && typeof ownerDocument.getSelection === "function"
      ? ownerDocument.getSelection.bind(ownerDocument)
      : (typeof document.getSelection === "function" ? document.getSelection.bind(document) : null);
    const selection = getSelection ? getSelection() : null;
    const anchorNode = selection?.anchorNode || null;
    const focusNode = selection?.focusNode || null;
    const inside = anchorNode && focusNode && content
      ? content.contains(anchorNode) && content.contains(focusNode)
      : false;
    const toggle = (button, active) => {
      if (!button) return;
      button.classList.toggle("active", Boolean(active));
    };
    if (!inside) {
      toggle(boldButton, false);
      toggle(italicButton, false);
      return;
    }
    let boldActive = false;
    let italicActive = false;
    if (typeof document.queryCommandState === "function") {
      try {
        boldActive = document.queryCommandState("bold");
      } catch (error) {
        boldActive = false;
      }
      try {
        italicActive = document.queryCommandState("italic");
      } catch (error) {
        italicActive = false;
      }
    }
    toggle(boldButton, boldActive);
    toggle(italicButton, italicActive);
  };

  const isRangeInsideContent = (range) => {
    if (!content || !range) return false;
    const ancestor = range.commonAncestorContainer;
    if (!ancestor) return false;
    return content === ancestor || content.contains(ancestor);
  };

  const computeNodePath = (node) => {
    if (!content || !node) return null;
    if (node === content) return [];
    const path = [];
    let current = node;
    while (current && current !== content) {
      const parent = current.parentNode;
      if (!parent) return null;
      const index = Array.prototype.indexOf.call(parent.childNodes || [], current);
      if (index < 0) return null;
      path.unshift(index);
      current = parent;
    }
    return current === content ? path : null;
  };

  const resolveNodePath = (path) => {
    if (!content || !Array.isArray(path)) return null;
    let current = content;
    for (let i = 0; i < path.length; i += 1) {
      if (!current || !current.childNodes) return null;
      current = current.childNodes[path[i]] || null;
    }
    return current;
  };

  const clampOffset = (node, offset) => {
    if (!node) return 0;
    const length = node.nodeType === Node.TEXT_NODE
      ? (node.textContent || "").length
      : (node.childNodes ? node.childNodes.length : 0);
    if (!Number.isFinite(offset)) return length;
    return Math.max(0, Math.min(offset, length));
  };

  const cloneSelectionInfo = (info) => {
    if (!info) return null;
    try {
      return JSON.parse(JSON.stringify(info));
    } catch (error) {
      return null;
    }
  };

  const computeTextIndex = (node, offset) => {
    if (!content || !ownerDocument || typeof ownerDocument.createRange !== "function") {
      return null;
    }
    try {
      const range = ownerDocument.createRange();
      range.selectNodeContents(content);
      const clampedOffset = clampOffset(node, offset);
      range.setEnd(node, clampedOffset);
      return range.toString().length;
    } catch (error) {
      return null;
    }
  };

  const storeSelectionInfo = (range) => {
    if (!range) {
      savedSelectionInfo = null;
      return;
    }
    const startPath = computeNodePath(range.startContainer);
    const endPath = computeNodePath(range.endContainer);
    if (!startPath || !endPath) {
      savedSelectionInfo = null;
      return;
    }
    const startOffset = clampOffset(range.startContainer, range.startOffset);
    const endOffset = clampOffset(range.endContainer, range.endOffset);
    const startIndex = computeTextIndex(range.startContainer, startOffset);
    const endIndex = computeTextIndex(range.endContainer, endOffset);
    const selectionText = typeof range.toString === "function" ? range.toString() : "";
    savedSelectionInfo = {
      start: {
        path: startPath,
        offset: startOffset,
        textIndex: Number.isFinite(startIndex) ? startIndex : null,
      },
      end: {
        path: endPath,
        offset: endOffset,
        textIndex: Number.isFinite(endIndex) ? endIndex : null,
      },
      collapsed: Boolean(range.collapsed),
      text: selectionText,
    };
  };

  const resolveTextIndex = (index) => {
    if (!content || !Number.isFinite(index) || !ownerDocument) {
      return null;
    }
    const walker = ownerDocument.createTreeWalker(content, NodeFilter.SHOW_TEXT, null);
    let remaining = index;
    let lastNode = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const length = (node.textContent || "").length;
      lastNode = node;
      if (remaining <= length) {
        return {
          node,
          offset: Math.max(0, Math.min(remaining, length)),
        };
      }
      remaining -= length;
    }
    if (!lastNode) return null;
    const tailLength = (lastNode.textContent || "").length;
    return {
      node: lastNode,
      offset: tailLength,
    };
  };

  const buildRangeFromInfo = (info) => {
    if (!info || !ownerDocument || typeof ownerDocument.createRange !== "function") return null;
    const range = ownerDocument.createRange();
    const startNode = resolveNodePath(info.start?.path);
    const endNode = resolveNodePath(info.end?.path);
    if (!startNode || !endNode) return null;
    const startOffset = clampOffset(startNode, info.start?.offset);
    const endOffset = clampOffset(endNode, info.end?.offset);
    try {
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      return range;
    } catch (error) {
      return null;
    }
  };

  const buildRangeFromTextIndex = (info) => {
    if (!info || !ownerDocument || typeof ownerDocument.createRange !== "function") return null;
    const startIndex = Number.isFinite(info?.start?.textIndex) ? info.start.textIndex : null;
    let endIndex = Number.isFinite(info?.end?.textIndex) ? info.end.textIndex : null;
    if (endIndex == null && startIndex != null) {
      if (info?.collapsed) {
        endIndex = startIndex;
      } else if (typeof info?.text === "string") {
        endIndex = startIndex + info.text.length;
      }
    }
    const start = resolveTextIndex(startIndex);
    const end = resolveTextIndex(endIndex);
    if (!start || !end) return null;
    try {
      const range = ownerDocument.createRange();
      range.setStart(start.node, clampOffset(start.node, start.offset));
      range.setEnd(end.node, clampOffset(end.node, end.offset));
      return range;
    } catch (error) {
      return null;
    }
  };

  const buildFallbackRange = () => {
    if (!content || !ownerDocument || typeof ownerDocument.createRange !== "function") return null;
    try {
      const range = ownerDocument.createRange();
      range.selectNodeContents(content);
      range.collapse(false);
      return range;
    } catch (error) {
      return null;
    }
  };

  const captureSelection = () => {
    if (!ownerDocument || typeof ownerDocument.getSelection !== "function") {
      savedSelection = null;
      savedSelectionInfo = null;
      return;
    }
    const selection = ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!isRangeInsideContent(range)) {
      return;
    }
    savedSelection = range.cloneRange();
    storeSelectionInfo(savedSelection);
  };

  const scheduleSelectionCapture = () => {
    if (selectionFrame !== null) {
      caf(selectionFrame);
    }
    selectionFrame = raf(() => {
      selectionFrame = null;
      if (!ownerDocument || typeof ownerDocument.getSelection !== "function") {
        return;
      }
      const selection = ownerDocument.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return;
      }
      let range = null;
      try {
        range = selection.getRangeAt(0);
      } catch (error) {
        range = null;
      }
      if (!range || !isRangeInsideContent(range)) {
        return;
      }
      captureSelection();
      updateToolbarStates();
    });
  };

  const restoreSelection = () => {
    if (!ownerDocument || typeof ownerDocument.getSelection !== "function") return;
    const selection = ownerDocument.getSelection();
    if (!selection) return;

    const attemptAddRange = (range, { persist = true } = {}) => {
      if (!range) return false;
      selection.removeAllRanges();
      try {
        selection.addRange(range);
        if (persist) {
          savedSelection = range.cloneRange ? range.cloneRange() : range;
          storeSelectionInfo(savedSelection);
        }
        return true;
      } catch (error) {
        selection.removeAllRanges();
        return false;
      }
    };

    const selectionInfoBackup = cloneSelectionInfo(savedSelectionInfo);
    const savedSelectionBackup = savedSelection && savedSelection.cloneRange
      ? savedSelection.cloneRange()
      : savedSelection;
    const primaryRange = savedSelection && savedSelection.cloneRange
      ? savedSelection.cloneRange()
      : savedSelection;

    if (attemptAddRange(primaryRange)) {
      return;
    }

    const fallbackCandidates = [];
    if (selectionInfoBackup) {
      const rebuiltFromInfo = buildRangeFromInfo(selectionInfoBackup);
      const rebuiltFromIndex = buildRangeFromTextIndex(selectionInfoBackup);
      if (rebuiltFromInfo) {
        fallbackCandidates.push({ range: rebuiltFromInfo, persist: true });
      }
      if (rebuiltFromIndex) {
        fallbackCandidates.push({ range: rebuiltFromIndex, persist: true });
      }
    }
    fallbackCandidates.push({ range: buildFallbackRange(), persist: false });

    for (let i = 0; i < fallbackCandidates.length; i += 1) {
      const candidate = fallbackCandidates[i];
      if (attemptAddRange(candidate.range, { persist: candidate.persist })) {
        if (!candidate.persist && selectionInfoBackup) {
          savedSelection = savedSelectionBackup && savedSelectionBackup.cloneRange
            ? savedSelectionBackup.cloneRange()
            : savedSelectionBackup;
          savedSelectionInfo = selectionInfoBackup;
        }
        return;
      }
    }

    savedSelection = null;
    if (selectionInfoBackup) {
      savedSelectionInfo = selectionInfoBackup;
    }
  };

  const sync = () => {
    pending = null;
    if (!content || !hidden) return;
    if (sanitizeElement) {
      const selectionInfoBackup = cloneSelectionInfo(savedSelectionInfo);
      sanitizeElement(content);
      if (savedSelectionInfo) {
        let refreshed = buildRangeFromInfo(savedSelectionInfo);
        let shouldPersist = Boolean(refreshed);
        if (!refreshed && selectionInfoBackup) {
          refreshed = buildRangeFromTextIndex(selectionInfoBackup);
          shouldPersist = Boolean(refreshed);
        }
        if (!refreshed) {
          refreshed = buildFallbackRange();
          shouldPersist = false;
        }
        if (refreshed) {
          if (shouldPersist) {
            savedSelection = refreshed.cloneRange ? refreshed.cloneRange() : refreshed;
            storeSelectionInfo(savedSelection);
          } else {
            savedSelection = null;
            if (selectionInfoBackup) {
              savedSelectionInfo = selectionInfoBackup;
            }
          }
        } else {
          savedSelection = null;
          if (selectionInfoBackup) {
            savedSelectionInfo = selectionInfoBackup;
          }
        }
      }
    }
    const boxes = Array.from(content.querySelectorAll('input[type="checkbox"]'));
    boxes.forEach((box, index) => {
      ensureCheckboxWrapper(box);
      box.setAttribute("data-rich-checkbox-index", String(index));
      if (box.checked) {
        box.setAttribute("checked", "");
      } else {
        box.removeAttribute("checked");
      }
    });
    ensureNotEmpty();
    const html = sanitizeHtml(content.innerHTML);
    const plain = toPlainText(html);
    const payload = {
      kind: "richtext",
      version: utils.version || RICH_TEXT_VERSION,
      html,
      text: plain,
      checkboxes: boxes.map((box) => Boolean(box.checked)),
    };
    const serializedValue = JSON.stringify(payload);
    if (content) {
      if (hasContent && hasContent(payload)) {
        content.removeAttribute("data-rich-text-empty");
      } else {
        content.setAttribute("data-rich-text-empty", "1");
      }
    }
    if (serializedValue === lastSerialized) return;
    lastSerialized = serializedValue;
    hidden.value = serializedValue;
    if (hasContent) {
      if (hasContent(payload)) delete hidden.dataset.richTextEmpty;
      else hidden.dataset.richTextEmpty = "1";
    }
    hidden.dispatchEvent(new Event("input", { bubbles: true }));
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const schedule = () => {
    if (pending !== null) {
      caf(pending);
    }
    pending = raf(() => {
      pending = null;
      sync();
    });
  };

  const handleSelectionEvent = () => {
    scheduleSelectionCapture();
    updateToolbarStates();
  };

  if (content) {
    content.addEventListener("mouseup", handleSelectionEvent);
    content.addEventListener("keyup", handleSelectionEvent);
    content.addEventListener("focus", handleSelectionEvent);
    content.addEventListener("blur", updateToolbarStates);
  }

  if (ownerDocument && typeof ownerDocument.addEventListener === "function") {
    ownerDocument.addEventListener("selectionchange", handleSelectionEvent);
  }

  const tryExecCommand = (cmd, value = null) => {
    if (typeof document.execCommand !== "function") return false;
    try {
      const result = document.execCommand(cmd, false, value);
      return result !== false;
    } catch (error) {
      return false;
    }
  };

  const getActiveRange = () => {
    if (!ownerDocument || typeof ownerDocument.getSelection !== "function") return null;
    const selection = ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    let range = null;
    try {
      range = selection.getRangeAt(0);
    } catch (error) {
      range = null;
    }
    if (!range || !isRangeInsideContent(range)) return null;
    return range;
  };

  const reapplyRangeSelection = (range) => {
    if (!range || !ownerDocument || typeof ownerDocument.getSelection !== "function") return false;
    const selection = ownerDocument.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    try {
      selection.addRange(range);
    } catch (error) {
      selection.removeAllRanges();
      return false;
    }
    savedSelection = range.cloneRange ? range.cloneRange() : range;
    storeSelectionInfo(savedSelection);
    return true;
  };

  const trimNbsp = (value) => (value || "").replace(/\u00a0/g, " ").trim();

  const getLineStartNode = (range = null) => {
    const activeRange = range || getActiveRange();
    if (!content || !activeRange) return null;
    const anchor = activeRange.startContainer;
    const anchorElement = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
    if (anchorElement && typeof anchorElement.closest === "function" && anchorElement.closest("ul,ol")) {
      return null;
    }
    let node = anchor;
    while (node && node.parentNode !== content) {
      node = node.parentNode;
    }
    if (!node) return null;
    let probe = node.previousSibling;
    while (probe && probe.nodeName !== "BR") {
      node = probe;
      probe = node.previousSibling;
    }
    let first = probe ? probe.nextSibling : content.firstChild;
    while (first && first.nodeType === Node.TEXT_NODE && !trimNbsp(first.textContent || "")) {
      first = first.nextSibling;
    }
    if (first && first.nodeName === "BR") {
      first = first.nextSibling;
      while (first && first.nodeType === Node.TEXT_NODE && !trimNbsp(first.textContent || "")) {
        first = first.nextSibling;
      }
    }
    return first || null;
  };

  const lineStartsWithCheckbox = (range = null) => {
    const first = getLineStartNode(range);
    if (!first) return false;
    if (isCheckboxWrapper(first)) {
      return true;
    }
    return first.nodeType === Node.ELEMENT_NODE
      && first.matches?.('input[type="checkbox"][data-rich-checkbox]');
  };

  const lineEmptyAfterCheckbox = (range = null) => {
    const first = getLineStartNode(range);
    if (!first || !isCheckboxWrapper(first)) {
      return false;
    }
    let sibling = first.nextSibling;
    while (sibling) {
      if (sibling.nodeName === "BR") break;
      if (isCheckboxWrapper(sibling)) {
        return false;
      }
      if (sibling.nodeType === Node.TEXT_NODE) {
        if (trimNbsp(sibling.textContent || "")) {
          return false;
        }
      } else if (sibling.nodeType === Node.ELEMENT_NODE) {
        if (trimNbsp(sibling.textContent || "")) {
          return false;
        }
      }
      sibling = sibling.nextSibling;
    }
    return true;
  };

  const caretAtLineStartAfterCheckbox = (range = null) => {
    const activeRange = range || getActiveRange();
    if (!activeRange || !activeRange.collapsed) {
      return false;
    }
    const first = getLineStartNode(activeRange);
    if (!first || !isCheckboxWrapper(first)) {
      return false;
    }
    const { startContainer, startOffset } = activeRange;
    if (startContainer.nodeType === Node.TEXT_NODE && startOffset > 0) {
      const beforeText = startContainer.textContent
        ? startContainer.textContent.slice(0, startOffset)
        : "";
      if (trimNbsp(beforeText)) {
        return false;
      }
    }
    if (startContainer.nodeType === Node.ELEMENT_NODE && startOffset > 0) {
      return false;
    }
    let node = startContainer;
    while (node && node.parentNode !== content) {
      node = node.parentNode;
    }
    if (!node) {
      return false;
    }
    if (node === first) {
      return true;
    }
    if (node === first.nextSibling) {
      if (node.nodeType === Node.TEXT_NODE) {
        const beforeText = node.textContent
          ? node.textContent.slice(0, activeRange.startOffset)
          : "";
        return !trimNbsp(beforeText);
      }
      if (isWhitespaceNode(node)) {
        return true;
      }
    }
    return false;
  };

  const removeNode = (node) => {
    if (node && node.parentNode) {
      node.parentNode.removeChild(node);
    }
  };

  const deleteAdjacentCheckbox = (direction) => {
    const range = getActiveRange();
    if (!range || !range.collapsed) return false;
    const first = getLineStartNode(range);
    if (!first || !isCheckboxWrapper(first)) {
      return false;
    }

    if (direction === "back" && caretAtLineStartAfterCheckbox(range)) {
      const parent = first.parentNode;
      let caretTarget = first.nextSibling;
      if (caretTarget && isWhitespaceNode(caretTarget)) {
        const next = caretTarget.nextSibling;
        removeNode(caretTarget);
        caretTarget = next;
      }
      removeNode(first);

      if (ownerDocument && typeof ownerDocument.createRange === "function" && ownerDocument.getSelection) {
        const selection = ownerDocument.getSelection();
        if (selection) {
          const newRange = ownerDocument.createRange();
          let target = caretTarget && caretTarget.parentNode === parent ? caretTarget : null;
          if (!target && parent === content) {
            target = content.firstChild;
          }
          if (target) {
            if (target.nodeType === Node.TEXT_NODE) {
              newRange.setStart(target, 0);
            } else {
              newRange.setStartBefore(target);
            }
          } else if (parent === content) {
            newRange.setStart(content, 0);
          } else {
            newRange.selectNodeContents(content);
            newRange.collapse(true);
          }
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
          savedSelection = newRange.cloneRange ? newRange.cloneRange() : newRange;
          storeSelectionInfo(savedSelection);
        }
      }

      schedule();
      scheduleSelectionCapture();
      updateToolbarStates();
      return true;
    }

    const { startContainer, startOffset } = range;
    if (startContainer.nodeType === Node.TEXT_NODE) {
      if (direction === "back" && startOffset > 0) {
        return false;
      }
      const len = startContainer.textContent ? startContainer.textContent.length : 0;
      if (direction === "del" && startOffset < len) {
        return false;
      }
    } else if (startContainer.nodeType === Node.ELEMENT_NODE) {
      if (direction === "back" && startOffset > 0) {
        return false;
      }
      if (direction === "del" && startOffset < (startContainer.childNodes ? startContainer.childNodes.length : 0)) {
        return false;
      }
    }

    let node = startContainer;
    while (node && node.parentNode !== content) {
      node = node.parentNode;
    }
    if (!node) {
      return false;
    }

    const pickNeighbor = () => (direction === "back" ? node.previousSibling : node.nextSibling);
    let target = pickNeighbor();
    if (target && isWhitespaceNode(target)) {
      const candidate = direction === "back" ? target.previousSibling : target.nextSibling;
      if (isCheckboxWrapper(candidate)) {
        removeNode(target);
        target = candidate;
      }
    }
    if (!isCheckboxWrapper(target)) {
      return false;
    }
    const spacer = direction === "back" ? target.previousSibling : target.nextSibling;
    if (spacer && isWhitespaceNode(spacer)) {
      removeNode(spacer);
    }
    removeNode(target);

    schedule();
    scheduleSelectionCapture();
    updateToolbarStates();
    return true;
  };

  const insertPlainBreak = (range) => {
    if (!range || !ownerDocument || typeof ownerDocument.createElement !== "function") {
      return false;
    }
    const br = ownerDocument.createElement("br");
    try {
      range.deleteContents();
      range.insertNode(br);
    } catch (error) {
      return false;
    }
    range.setStartAfter(br);
    range.collapse(true);
    return reapplyRangeSelection(range);
  };

  const insertBreakWithCheckbox = (range) => {
    if (!range || !ownerDocument || typeof ownerDocument.createElement !== "function" || typeof ownerDocument.createRange !== "function") {
      return false;
    }
    try {
      range.deleteContents();
    } catch (error) {
      // ignore deletion issues and continue
    }
    const br = ownerDocument.createElement("br");
    try {
      range.insertNode(br);
    } catch (error) {
      return false;
    }
    const afterBr = ownerDocument.createRange();
    afterBr.setStartAfter(br);
    afterBr.collapse(true);
    const pair = createCheckboxWrapper();
    if (!pair) return false;
    const { wrapper } = pair;
    try {
      afterBr.insertNode(wrapper);
    } catch (error) {
      return false;
    }
    const space = ownerDocument.createTextNode(" ");
    const afterWrapper = ownerDocument.createRange();
    afterWrapper.setStartAfter(wrapper);
    afterWrapper.collapse(true);
    afterWrapper.insertNode(space);
    afterWrapper.setStartAfter(space);
    afterWrapper.collapse(true);
    return reapplyRangeSelection(afterWrapper);
  };

  const insertCheckboxAtCaret = () => {
    if (!ownerDocument || typeof ownerDocument.createRange !== "function") {
      return false;
    }
    const range = getActiveRange();
    if (!range) return false;
    const pair = createCheckboxWrapper();
    if (!pair) return false;
    const { wrapper } = pair;
    const space = ownerDocument.createTextNode(" ");
    try {
      range.deleteContents();
      range.insertNode(wrapper);
    } catch (error) {
      wrapper.remove();
      return false;
    }
    const afterWrapper = ownerDocument.createRange();
    afterWrapper.setStartAfter(wrapper);
    afterWrapper.collapse(true);
    afterWrapper.insertNode(space);
    afterWrapper.setStartAfter(space);
    afterWrapper.collapse(true);
    return reapplyRangeSelection(afterWrapper);
  };

  const fallbackInsertCheckbox = () => insertCheckboxAtCaret();

  const fallbackWrapWithTag = (tagName) => {
    if (!ownerDocument || typeof ownerDocument.createElement !== "function" || typeof ownerDocument.createRange !== "function") {
      return false;
    }
    const range = getActiveRange();
    if (!range || range.collapsed) return false;
    const wrapper = ownerDocument.createElement(tagName);
    let contents = null;
    try {
      contents = range.extractContents();
    } catch (error) {
      contents = null;
    }
    if (!contents) return false;
    wrapper.appendChild(contents);
    try {
      range.insertNode(wrapper);
    } catch (error) {
      return false;
    }
    const newRange = ownerDocument.createRange();
    try {
      newRange.selectNodeContents(wrapper);
    } catch (error) {
      return false;
    }
    return reapplyRangeSelection(newRange);
  };

  if (toolbar && content) {
    toolbar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-rich-command]");
      if (!button) return;
      const command = button.getAttribute("data-rich-command");
      const value = button.getAttribute("data-rich-value");
      if (!command) return;

      if (command === "checkbox" && content.__cbInstalled) {
        return;
      }

      event.preventDefault();
      if (content && typeof content.focus === "function") {
        content.focus();
      }
      restoreSelection();
      if (command === "checkbox") {
        insertCheckboxAtCaret() || fallbackInsertCheckbox();
        scheduleSelectionCapture();
        schedule();
        updateToolbarStates();
        return;
      }
      if (!tryExecCommand(command, value) && (command === "bold" || command === "italic")) {
        fallbackWrapWithTag(command === "bold" ? "strong" : "em");
      }
      scheduleSelectionCapture();
      schedule();
      updateToolbarStates();
    });
  }

  if (toolbar) {
    const selectControls = Array.from(toolbar.querySelectorAll("[data-rich-select-command]"));
    selectControls.forEach((select) => {
      if (select.dataset.richSelectBound === "1") return;
      select.dataset.richSelectBound = "1";
      select.addEventListener("change", (event) => {
        const command = select.getAttribute("data-rich-select-command");
        if (!command) return;
        const optionValue = select.value;
        if (content && typeof content.focus === "function") {
          content.focus();
        }
        restoreSelection();
        if (optionValue) {
          tryExecCommand(command, optionValue);
        } else if (command === "fontSize") {
          tryExecCommand("removeFormat");
        }
        scheduleSelectionCapture();
        schedule();
        updateToolbarStates();
      });
    });

    const colorPickers = Array.from(toolbar.querySelectorAll("[data-rich-color-picker]"));
    colorPickers.forEach((input) => {
      if (input.dataset.richColorBound === "1") return;
      input.dataset.richColorBound = "1";
      input.addEventListener("input", () => {
        const colorValue = input.value;
        if (!colorValue) return;
        if (content && typeof content.focus === "function") {
          content.focus();
        }
        restoreSelection();
        tryExecCommand("foreColor", colorValue);
        scheduleSelectionCapture();
        schedule();
        updateToolbarStates();
      });
    });
  }

  content.addEventListener("input", schedule);
  content.addEventListener("change", schedule);
  content.addEventListener("blur", sync);
  content.addEventListener("click", (event) => {
    if (event.target && event.target.matches('input[type="checkbox"]')) {
      schedule();
    }
  });

  content.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.shiftKey && typeof document.execCommand === "function") {
      event.preventDefault();
      document.execCommand("insertLineBreak", false, null);
      schedule();
      scheduleSelectionCapture();
      updateToolbarStates();
      return;
    }

    if (content.__cbInstalled) {
      if (event.defaultPrevented) {
        scheduleSelectionCapture();
        schedule();
        updateToolbarStates();
      }
      return;
    }

    if (event.key === "Backspace") {
      if (deleteAdjacentCheckbox("back")) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === "Delete") {
      if (deleteAdjacentCheckbox("del")) {
        event.preventDefault();
        return;
      }
    }
    if (event.key !== "Enter") return;
    if (!event.shiftKey) {
      const range = getActiveRange();
      if (lineStartsWithCheckbox(range)) {
        event.preventDefault();
        const handled = lineEmptyAfterCheckbox(range)
          ? insertPlainBreak(range)
          : insertBreakWithCheckbox(range);
        if (handled) {
          scheduleSelectionCapture();
          schedule();
          updateToolbarStates();
        }
        return;
      }
    }
  });

  root.dataset.richTextReady = "1";
  sync();
  updateToolbarStates();
}

function initializeRichTextEditors(scope = document) {
  if (!scope) return;
  const targets = [];
  if (scope instanceof Element) {
    if (scope.matches("[data-rich-text-root]")) {
      targets.push(scope);
    }
    targets.push(...scope.querySelectorAll("[data-rich-text-root]"));
  } else if (scope.querySelectorAll) {
    targets.push(...scope.querySelectorAll("[data-rich-text-root]"));
  }
  targets.forEach((root) => {
    try {
      setupRichTextEditor(root);
    } catch (error) {
      modesLogger?.warn?.("richtext:init:error", error);
    }
  });
}

(function bootstrapRichTextEditors() {
  const run = () => {
    initializeRichTextEditors(document);
    if (typeof MutationObserver !== "function") {
      return;
    }
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            initializeRichTextEditors(node);
          }
        });
      });
    });
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        if (document.body) {
          observer.observe(document.body, { childList: true, subtree: true });
        }
      }, { once: true });
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();

if (window.Modes?.richText) {
  window.Modes.richText.setup = setupRichTextEditor;
  window.Modes.richText.setupAll = initializeRichTextEditors;
}

function inputForType(consigne, initialValue = null, options = {}) {
  const skipLikeInitial = initialValue && typeof initialValue === "object" && initialValue.skipped === true;
  const normalizedInitial = skipLikeInitial ? null : initialValue;
  if (consigne.type === "info") {
    return INFO_STATIC_BLOCK;
  }
  if (consigne.type === "short") {
    const value = escapeHtml(normalizedInitial ?? "");
    return `<input name="short:${consigne.id}" class="w-full" placeholder="Réponse" value="${value}">`;
  }
  if (consigne.type === "long") {
    return renderRichTextInput(`long:${consigne.id}`, {
      consigneId: consigne.id,
      initialValue: normalizedInitial,
      placeholder: "Réponse",
    });
  }
  if (consigne.type === "num") {
    const sliderValue = normalizedInitial != null && normalizedInitial !== ""
      ? Number(normalizedInitial)
      : 5;
    const safeValue = Number.isFinite(sliderValue) ? sliderValue : 5;
    return `
      <div class="scale">
        <input type="range" min="0" max="10" step="1" value="${safeValue}" data-default-value="${safeValue}" name="num:${consigne.id}" class="w-full">
        <div class="scale-ticks">
          <span>0</span><span>1</span><span>2</span><span>3</span><span>4</span>
          <span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>10</span>
        </div>
      </div>
    `;
  }
  if (consigne.type === "montant") {
    const normalized = normalizeMontantValue(normalizedInitial, consigne);
    const amount = Number.isFinite(normalized.amount) ? normalized.amount : "";
    const unit = normalized.unit || consigne.montantUnit || "";
    const goal = Number.isFinite(normalized.goal) ? normalized.goal : null;
    const symbol = montantOperatorSymbol(normalized.operator);
    const objectiveText =
      goal !== null
        ? `Objectif ${symbol} ${MONTANT_NUMBER_FORMATTER.format(goal)}${unit ? ` ${unit}` : ""}`
        : "";
    const amountValue = amount === "" ? "" : escapeHtml(String(amount));
    return `
      <div class="grid gap-1 montant-input">
        <div class="flex items-center gap-2">
          <input name="montant:${consigne.id}" class="w-full" type="number" inputmode="decimal" step="any" min="0" placeholder="Montant" value="${amountValue}">
          ${unit ? `<span class="text-sm text-[var(--muted)]">${escapeHtml(unit)}</span>` : ""}
        </div>
        ${objectiveText ? `<p class="text-xs text-[var(--muted)]">${escapeHtml(objectiveText)}</p>` : ""}
      </div>
    `;
  }
  if (consigne.type === "likert6") {
    const current = (normalizedInitial ?? "").toString();
    // Ordre désiré : Oui → Plutôt oui → Neutre → Plutôt non → Non → Pas de réponse
    return `
      <select name="likert6:${consigne.id}" class="w-full">
        <option value="" ${current === "" ? "selected" : ""}>— choisir —</option>
        <option value="yes" ${current === "yes" ? "selected" : ""}>Oui</option>
        <option value="rather_yes" ${current === "rather_yes" ? "selected" : ""}>Plutôt oui</option>
        <option value="medium" ${current === "medium" ? "selected" : ""}>Neutre</option>
        <option value="rather_no" ${current === "rather_no" ? "selected" : ""}>Plutôt non</option>
        <option value="no" ${current === "no" ? "selected" : ""}>Non</option>
        <option value="no_answer" ${current === "no_answer" ? "selected" : ""}>Pas de réponse</option>
      </select>
    `;
  }
  if (consigne.type === "likert5") {
    const current = normalizedInitial != null ? String(normalizedInitial) : "";
    return `
      <select name="likert5:${consigne.id}" class="w-full">
        <option value="" ${current === "" ? "selected" : ""}>— choisir —</option>
        <option value="0" ${current === "0" ? "selected" : ""}>0</option>
        <option value="1" ${current === "1" ? "selected" : ""}>1</option>
        <option value="2" ${current === "2" ? "selected" : ""}>2</option>
        <option value="3" ${current === "3" ? "selected" : ""}>3</option>
        <option value="4" ${current === "4" ? "selected" : ""}>4</option>
      </select>
    `;
  }
  if (consigne.type === "yesno") {
    const current = (normalizedInitial ?? "").toString();
    return `
      <select name="yesno:${consigne.id}" class="w-full">
        <option value="" ${current === "" ? "selected" : ""}>— choisir —</option>
        <option value="yes" ${current === "yes" ? "selected" : ""}>Oui</option>
        <option value="no" ${current === "no" ? "selected" : ""}>Non</option>
      </select>
    `;
  }
  if (consigne.type === "checklist") {
    const items = sanitizeChecklistItems(consigne);
    const initialStates = (() => {
      if (Array.isArray(normalizedInitial)) {
        return normalizedInitial.map((value) => value === true);
      }
      if (normalizedInitial && typeof normalizedInitial === "object") {
        return readChecklistStates(normalizedInitial);
      }
      return [];
    })();
    const initialSkipStates = (() => {
      if (normalizedInitial && typeof normalizedInitial === "object") {
        return readChecklistSkipped(normalizedInitial);
      }
      return [];
    })();
    const normalizedValue = items.map((_, index) => Boolean(initialStates[index]));
    const normalizedSkipped = items.map((_, index) => Boolean(initialSkipStates[index]));
    const hasInitialStates = normalizedValue.some(Boolean) || normalizedSkipped.some(Boolean);
    const historyDateKey = (() => {
      if (normalizedInitial && typeof normalizedInitial === "object") {
        const candidates = [
          normalizedInitial.__historyDateKey,
          normalizedInitial.historyDateKey,
          normalizedInitial.dateKey,
          normalizedInitial.dayKey,
        ];
        for (const candidate of candidates) {
          if (typeof candidate !== "string") {
            continue;
          }
          const trimmed = candidate.trim();
          if (trimmed) {
            return trimmed;
          }
        }
      }
      return "";
    })();
    const optionsHash = computeChecklistOptionsHash(consigne);
    const optionsAttr = optionsHash ? ` data-checklist-options-hash="${escapeHtml(String(optionsHash))}"` : "";
    const historyAttr = historyDateKey ? ` data-checklist-history-date="${escapeHtml(historyDateKey)}"` : "";
    const autosaveFieldName =
      consigne?.id != null && consigne.id !== ""
        ? `consigne:${String(consigne.id)}:checklist`
        : null;
    const autosaveAttr = autosaveFieldName ? ` data-autosave-field="${escapeHtml(String(autosaveFieldName))}"` : "";
    const stableItemIds = Array.isArray(consigne?.checklistItemIds)
      ? consigne.checklistItemIds
      : [];
    const checkboxes = items
      .map((label, index) => {
        const checked = normalizedValue[index];
        const skipped = normalizedSkipped[index];
        const trimmedLabel = typeof label === "string" ? label.trim() : "";
        const itemId = resolveChecklistItemId(consigne, index, trimmedLabel, stableItemIds);
        const legacyBase =
          consigne?.id ??
          consigne?.slug ??
          consigne?.slugId ??
          consigne?.slug_id ??
          consigne?.consigneId ??
          "";
        const legacyId = legacyBase ? `${legacyBase}:${index}` : String(index);
        const validatedAttr = skipped ? "skip" : checked ? "true" : "false";
        const skipClass = skipped ? " checklist-item--skipped" : "";
        const skipAttr = skipped ? ' data-checklist-skipped="1"' : "";
        const inputSkipAttr = skipped ? ' data-checklist-skip="1"' : "";
        const skipButtonClass = skipped ? "checklist-skip-btn is-active" : "checklist-skip-btn";
        const skipButtonPressed = skipped ? "true" : "false";
        const checkedAttr = checked ? "checked" : "";
        return `
          <label class="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm${skipClass}" data-checklist-item data-item-id="${escapeHtml(itemId)}" data-checklist-key="${escapeHtml(itemId)}" data-checklist-legacy-key="${escapeHtml(legacyId)}" data-checklist-index="${index}" data-checklist-label="${escapeHtml(trimmedLabel)}" data-validated="${validatedAttr}"${skipAttr}>
            <input type="checkbox" class="h-4 w-4" data-checklist-input data-key="${escapeHtml(itemId)}" data-checklist-key="${escapeHtml(itemId)}" data-legacy-key="${escapeHtml(legacyId)}" data-checklist-index="${index}" ${inputSkipAttr} ${checkedAttr}>
            <span class="flex-1">${escapeHtml(label)}</span>
            <button type="button" class="${skipButtonClass}" data-checklist-skip-btn aria-pressed="${skipButtonPressed}" title="Passer cet élément (ne pas le compter)">⏭</button>
          </label>`;
      })
      .join("");
    const fallbackDateKey = 
      options.pageContext?.pageDateIso ||
      (typeof window !== "undefined" && window.AppCtx?.dateIso
        ? String(window.AppCtx.dateIso)
        : typeof Schema?.todayKey === "function"
        ? Schema.todayKey()
        : null);
    const initialPayload = {
      items: normalizedValue,
      skipped: normalizedSkipped,
    };
    if (historyDateKey) {
      initialPayload.dateKey = historyDateKey;
    } else if (fallbackDateKey) {
      initialPayload.dateKey = fallbackDateKey;
    }
    const initialSerialized = escapeHtml(JSON.stringify(initialPayload));
    const scriptContent = String.raw`
      <script>
        (() => {
          const script = document.currentScript;
          const hidden = script?.previousElementSibling;
          const root = hidden?.closest('[data-checklist-root]');
          if (!root || !hidden) return;
          // Empêche les doubles initialisations si le même DOM est réutilisé
          try {
            if (root.dataset && root.dataset.checklistSetup === '1') {
              return;
            }
            if (root.dataset) root.dataset.checklistSetup = '1';
          } catch (_) {}
          const SKIP_DATA_KEY = 'checklistSkip';
          const PREV_CHECKED_KEY = 'checklistPrevChecked';
          const LONG_PRESS_DELAY = 600;
          const historyDateKeyAttr =
            (hidden?.dataset?.checklistHistoryDate && hidden.dataset.checklistHistoryDate.trim()) ||
            (root?.dataset?.checklistHistoryDate && root.dataset.checklistHistoryDate.trim()) ||
            '';
          const isHistoryContext = Boolean(historyDateKeyAttr);
          if (historyDateKeyAttr) {
            if (root?.dataset) {
              root.dataset.checklistHistoryDate = historyDateKeyAttr;
            } else {
              root.setAttribute('data-checklist-history-date', historyDateKeyAttr);
            }
            if (hidden?.dataset) {
              hidden.dataset.checklistHistoryDate = historyDateKeyAttr;
            } else if (typeof hidden.setAttribute === 'function') {
              hidden.setAttribute('data-checklist-history-date', historyDateKeyAttr);
            }
          }
          let pressTimer = null;
          let pressTarget = null;

          const queryInputs = () => Array.from(root.querySelectorAll('[data-checklist-input]'));
          const now = () => (typeof Date !== 'undefined' ? Date.now() : performance?.now?.() || 0);
          const resolveClosest = (target, selector) => {
            if (!target) return null;
            if (target instanceof Element) {
              return target.closest(selector);
            }
            if (target instanceof Node && target.parentElement) {
              return target.parentElement.closest(selector);
            }
            return null;
          };
          const resolveHost = (input) => resolveClosest(input, '[data-checklist-item]');
          const pageDateKey = (() => {
            if (historyDateKeyAttr) return historyDateKeyAttr;
            const ctxKey = (typeof window !== 'undefined' && window.AppCtx?.dateIso) ? String(window.AppCtx.dateIso) : null;
            let hashKey = null;
            try {
              const hash = typeof window.location?.hash === 'string' ? window.location.hash : '';
              const qp = new URLSearchParams((hash.split('?')[1] || ''));
              const d = (qp.get('d') || '').trim();
              hashKey = d || null;
            } catch (_) {}
            return hashKey || ctxKey || (typeof Schema?.todayKey === 'function' ? Schema.todayKey() : null);
          })();
          const setSkipButtonState = (host, skip) => {
            if (!host || typeof host.querySelector !== 'function') return;
            const button = host.querySelector('[data-checklist-skip-btn]');
            if (!button) return;
            if (skip) {
              button.classList.add('is-active');
              button.setAttribute('aria-pressed', 'true');
            } else {
              button.classList.remove('is-active');
              button.setAttribute('aria-pressed', 'false');
            }
          };
          const isSkipped = (input, host = resolveHost(input)) => {
            if (!input) return false;
            if (input.dataset && input.dataset[SKIP_DATA_KEY] === '1') return true;
            if (host && host.dataset && host.dataset.checklistSkipped === '1') return true;
            return false;
          };
          const setSkipState = (input, skip) => {
            const host = resolveHost(input);
            if (!input) return;
            if (skip) {
              let previous = null;
              const hasStoredPrev =
                Boolean(input.dataset) && Object.prototype.hasOwnProperty.call(input.dataset, PREV_CHECKED_KEY);
              if (hasStoredPrev) {
                previous = input.dataset ? input.dataset[PREV_CHECKED_KEY] : null;
              } else if (input.hasAttribute('data-checklist-prev-checked')) {
                previous = input.getAttribute('data-checklist-prev-checked');
              } else {
                previous = input.checked ? '1' : '0';
              }
              if (previous == null) {
                previous = input.checked ? '1' : '0';
              }
              if (input.dataset) {
                input.dataset[PREV_CHECKED_KEY] = previous;
              }
              input.setAttribute('data-checklist-prev-checked', previous);
              if ('indeterminate' in input) {
                input.indeterminate = true;
              }
              input.checked = false;
              input.disabled = true;
              if (input.dataset) {
                input.dataset[SKIP_DATA_KEY] = '1';
              }
              input.setAttribute('data-checklist-skip', '1');
              if (host) {
                host.dataset.checklistSkipped = '1';
                host.setAttribute('data-checklist-skipped', '1');
                host.classList.add('checklist-item--skipped');
                host.setAttribute('data-validated', 'skip');
              }
              setSkipButtonState(host, true);
            } else {
              let previousChecked = null;
              if ('indeterminate' in input) {
                input.indeterminate = false;
              }
              if (input.dataset && Object.prototype.hasOwnProperty.call(input.dataset, PREV_CHECKED_KEY)) {
                previousChecked = input.dataset[PREV_CHECKED_KEY];
                delete input.dataset[PREV_CHECKED_KEY];
              }
              if (previousChecked == null && input.hasAttribute('data-checklist-prev-checked')) {
                previousChecked = input.getAttribute('data-checklist-prev-checked');
              }
              input.removeAttribute('data-checklist-prev-checked');
              if (input.dataset) {
                delete input.dataset[SKIP_DATA_KEY];
              }
              input.removeAttribute('data-checklist-skip');
              const shouldCheck =
                previousChecked != null
                  ? previousChecked === '1' || previousChecked === 'true'
                  : Boolean(input.defaultChecked);
              input.checked = Boolean(shouldCheck);
              input.disabled = false;
              if (host) {
                host.classList.remove('checklist-item--skipped');
                if (host.dataset) {
                  delete host.dataset.checklistSkipped;
                }
                host.removeAttribute('data-checklist-skipped');
                host.setAttribute('data-validated', input.checked ? 'true' : 'false');
              }
              setSkipButtonState(host, false);
            }
          };
          const ensureItemIds = () => {
            const consigneId = root.getAttribute('data-consigne-id') || root.dataset.consigneId || '';
            queryInputs().forEach((input, index) => {
              const host = resolveHost(input);
              if (!host) return;
              const explicitKey = input.getAttribute('data-key') || input.dataset?.key || input.getAttribute('data-item-id') || host.getAttribute('data-item-id');
              const attr = input.getAttribute('data-checklist-index');
              const idx = attr !== null ? attr : index;
              const fallback = consigneId ? String(consigneId) + ':' + idx : String(idx);
              const resolvedKey = (explicitKey && String(explicitKey).trim()) || fallback;
              const legacyKey = input.getAttribute('data-legacy-key') || host.getAttribute('data-checklist-legacy-key') || fallback;
              input.setAttribute('data-key', resolvedKey);
              if (input.dataset) {
                input.dataset.key = resolvedKey;
              }
              input.setAttribute('data-item-id', resolvedKey);
              input.setAttribute('data-legacy-key', legacyKey);
              host.setAttribute('data-item-id', resolvedKey);
              host.setAttribute('data-checklist-key', resolvedKey);
              host.setAttribute('data-checklist-legacy-key', legacyKey);
              const skip = isSkipped(input, host);
              if (skip) {
                host.dataset.checklistSkipped = '1';
                host.setAttribute('data-checklist-skipped', '1');
                host.classList.add('checklist-item--skipped');
                host.setAttribute('data-validated', 'skip');
                if (input.dataset) {
                  input.dataset[SKIP_DATA_KEY] = '1';
                }
                input.setAttribute('data-checklist-skip', '1');
                input.disabled = true;
                setSkipButtonState(host, true);
              } else {
                host.classList.remove('checklist-item--skipped');
                host.removeAttribute('data-checklist-skipped');
                host.setAttribute('data-validated', input.checked ? 'true' : 'false');
                if (input.dataset) {
                  delete input.dataset[SKIP_DATA_KEY];
                }
                input.removeAttribute('data-checklist-skip');
                input.disabled = false;
                setSkipButtonState(host, false);
              }
            });
          };
          const serialize = () => {
            const inputs = queryInputs();
            const payload = {
              items: inputs.map((input) => Boolean(input.checked)),
              skipped: inputs.map((input) => isSkipped(input)),
            };
            if (Array.isArray(payload.skipped) && payload.skipped.every((value) => value === false)) {
              delete payload.skipped;
            }
            return payload;
          };
          const sync = (options = {}) => {
            const payload = serialize();
            // Conserver des métadonnées pour éviter les incohérences (date, options)
            try {
              // Prefer any history date stamped on the root/hidden by the global hydrator;
              // fall back to pageDateKey
              const rootHist = (root?.dataset && root.dataset.checklistHistoryDate) || root.getAttribute('data-checklist-history-date') || '';
              const hiddenHist = (hidden?.dataset && hidden.dataset.checklistHistoryDate) || hidden.getAttribute('data-checklist-history-date') || '';
              const ctxKey = (rootHist && String(rootHist).trim()) || (hiddenHist && String(hiddenHist).trim()) || (pageDateKey ? String(pageDateKey) : '');
              if (ctxKey) payload.dateKey = ctxKey;
              const optHash = (root?.dataset && root.dataset.checklistOptionsHash) || '';
              if (optHash) payload.optionsHash = optHash;
              // Snapshot des clés pour debug/alignment
              const keys = queryInputs().map((i) => i.getAttribute('data-key') || i.getAttribute('data-item-id') || '');
              if (keys.some((k) => k)) payload.itemKeys = keys;
            } catch (_) {}
            try {
              hidden.value = JSON.stringify(payload);
            } catch (error) {
              hidden.value = JSON.stringify(payload.items || []);
            }
            if (options.markDirty) {
              hidden.dataset.dirty = '1';
              root.dataset.checklistDirty = '1';
              root.dataset.checklistDirtyAt = String(now());
            }
            if (options.notify) {
              hidden.dispatchEvent(new Event('input', { bubbles: true }));
              hidden.dispatchEvent(new Event('change', { bubbles: true }));
            }
            ensureItemIds();
          };
          const toggleSkip = (host, nextState = null) => {
            if (!host) return;
            const input = host.querySelector('[data-checklist-input]');
            if (!input) return;
            const current = isSkipped(input, host);
            const next = nextState == null ? !current : Boolean(nextState);
            setSkipState(input, next);
            if (!next && host) {
              host.setAttribute('data-validated', input.checked ? 'true' : 'false');
            }
            root.dataset.checklistDirty = '1';
            root.dataset.checklistDirtyAt = String(now());
            sync({ markDirty: true, notify: true });
            // Déclenche une persistance immédiate via le handler global (app.js)
            try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
          };
          root.addEventListener('click', (event) => {
            const button = resolveClosest(event.target, '[data-checklist-skip-btn]');
            if (!button || !root.contains(button)) return;
            event.preventDefault();
            const host = resolveClosest(button, '[data-checklist-item]');
            toggleSkip(host);
          });
          const getContextMenuState = () => {
            if (!window.__checklistContextMenuState) {
              window.__checklistContextMenuState = { menu: null, button: null, host: null };
            }
            return window.__checklistContextMenuState;
          };
          const closeContextMenu = () => {
            const state = getContextMenuState();
            if (!state.menu || state.menu.hidden) {
              return;
            }
            state.menu.hidden = true;
            state.menu.setAttribute('aria-hidden', 'true');
            state.host = null;
          };
          const ensureContextMenu = () => {
            const state = getContextMenuState();
            if (state.menu && state.button) {
              return state;
            }
            const menu = document.createElement('div');
            menu.dataset.checklistContextMenu = '1';
            menu.className = 'checklist-context-menu';
            menu.setAttribute('role', 'menu');
            menu.setAttribute('aria-hidden', 'true');
            menu.hidden = true;
            const actionBtn = document.createElement('button');
            actionBtn.type = 'button';
            actionBtn.className = 'checklist-context-menu__action';
            actionBtn.dataset.contextAction = 'toggle';
            actionBtn.textContent = 'Passer l’élément';
            actionBtn.addEventListener('click', () => {
              if (!state.host) {
                closeContextMenu();
                return;
              }
              const resume = actionBtn.dataset.actionState === 'resume';
              const host = state.host;
              closeContextMenu();
              toggleSkip(host, resume ? false : true);
            });
            menu.appendChild(actionBtn);
            document.body.appendChild(menu);
            if (!window.__checklistContextMenuListeners) {
              const closeOnPointer = (event) => {
                if (!state.menu || state.menu.hidden) return;
                if (!state.menu.contains(event.target)) {
                  closeContextMenu();
                }
              };
              document.addEventListener('pointerdown', closeOnPointer);
              document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                  closeContextMenu();
                }
              });
              window.addEventListener('blur', () => closeContextMenu());
              window.addEventListener('resize', () => closeContextMenu());
              window.addEventListener('scroll', () => closeContextMenu(), true);
              window.__checklistContextMenuListeners = true;
            }
            state.menu = menu;
            state.button = actionBtn;
            return state;
          };
          const openContextMenu = (host, position) => {
            const state = ensureContextMenu();
            const { menu, button } = state;
            if (!menu || !button || !host) return;
            const currentlySkipped = host.dataset && host.dataset.checklistSkipped === '1';
            const label = currentlySkipped ? 'Reprendre l’élément' : 'Passer l’élément';
            button.textContent = label;
            button.dataset.actionState = currentlySkipped ? 'resume' : 'skip';
            const margin = 8;
            const x = Math.min(Math.max(position.x, margin), window.innerWidth - margin);
            const y = Math.min(Math.max(position.y, margin), window.innerHeight - margin);
            menu.style.left = String(x) + 'px';
            menu.style.top = String(y) + 'px';
            menu.hidden = false;
            menu.setAttribute('aria-hidden', 'false');
            state.host = host;
            try {
              button.focus({ preventScroll: true });
            } catch (error) {
              button.focus();
            }
          };
          const handleContextAction = (host, coords) => {
            if (!host) return;
            const position = coords || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
            openContextMenu(host, position);
          };
          let pressCoords = null;
          const clearPress = () => {
            if (pressTimer) {
              window.clearTimeout(pressTimer);
              pressTimer = null;
            }
            pressTarget = null;
            pressCoords = null;
          };
          const resolveCoords = (event) => ({ x: event.clientX, y: event.clientY });
          const triggerContextMenu = (host, coords) => {
            handleContextAction(host, coords);
          };
          root.addEventListener('contextmenu', (event) => {
            const host = resolveClosest(event.target, '[data-checklist-item]');
            if (!host || !root.contains(host)) return;
            event.preventDefault();
            triggerContextMenu(host, resolveCoords(event));
          });
          root.addEventListener('pointerdown', (event) => {
            if (event.pointerType !== 'touch') {
              clearPress();
              return;
            }
            const host = resolveClosest(event.target, '[data-checklist-item]');
            if (!host || !root.contains(host)) return;
            clearPress();
            pressTarget = host;
            pressCoords = resolveCoords(event);
            pressTimer = window.setTimeout(() => {
              pressTimer = null;
              triggerContextMenu(host, pressCoords || resolveCoords(event));
            }, LONG_PRESS_DELAY);
          });
          root.addEventListener('pointerup', clearPress);
          root.addEventListener('pointercancel', clearPress);
          root.addEventListener('pointerleave', clearPress);
          root.addEventListener('pointermove', (event) => {
            if (!pressTarget || event.pointerType !== 'touch') return;
            const rect = pressTarget.getBoundingClientRect();
            if (
              event.clientX < rect.left - 16 ||
              event.clientX > rect.right + 16 ||
              event.clientY < rect.top - 16 ||
              event.clientY > rect.bottom + 16
            ) {
              clearPress();
            }
          });
          root.addEventListener('change', (event) => {
            if (event.target instanceof Element && event.target.matches('[data-checklist-input]')) {
              closeContextMenu();
              try {
                const consigneId = root.getAttribute('data-consigne-id') || root.dataset?.consigneId || null;
                console.info('[checklist-debug] modes.change:start', {
                  consigneId,
                  hydrating: root?.dataset?.checklistHydrating === '1',
                  localDirty: root?.dataset?.checklistHydrationLocalDirty === '1',
                });
              } catch (_) {}
              // Ne pas ignorer le premier clic pendant l'hydratation: marquer et continuer
              if (root.dataset && root.dataset.checklistHydrating === '1') {
                root.dataset.checklistHydrationLocalDirty = '1';
                // continue without returning so the user's action is applied
              }
              const input = event.target;
              const host = resolveHost(input);
              const skipActive = isSkipped(input, host);
              if (skipActive) {
                setSkipState(input, true);
              } else if (host) {
                host.setAttribute('data-validated', input.checked ? 'true' : 'false');
              }
              root.dataset.checklistDirty = '1';
              root.dataset.checklistDirtyAt = String(now());
              sync({ markDirty: true, notify: true });
              try {
                console.info('[checklist-debug] modes.change:sync', {
                  dirtyAt: root?.dataset?.checklistDirtyAt || null,
                });
              } catch (_) {}
            }
          });
          const hydratePayload = () => {
            try {
              // Protection anti-rebond: ne pas réappliquer si une saisie locale vient d'avoir lieu
              try {
                const ts = root?.dataset?.checklistDirtyAt ? Number(root.dataset.checklistDirtyAt) : 0;
                if (ts && now() - ts < 400) {
                  console.info('[checklist] hydrate.hidden.skip-recent-local-change');
                  return;
                }
              } catch (_) {}
              let raw = JSON.parse(hidden.value || '[]');
              if (isHistoryContext) {
                logChecklistEvent("info", "[checklist-history] hydrate.payload.raw", {
                  dateAttr: historyDateKeyAttr,
                  pageDateKey,
                  raw,
                });
              }
              // Si le hidden payload contient une clé de date incompatible, on n'applique pas
              try {
                const hiddenKey = raw && typeof raw === 'object' && raw.dateKey ? String(raw.dateKey) : null;
                const rawOptionsHash = raw && typeof raw === 'object' && raw.optionsHash ? String(raw.optionsHash) : '';
                const currentOptionsHash = (root?.dataset && root.dataset.checklistOptionsHash) || '';
                if (rawOptionsHash && currentOptionsHash && rawOptionsHash !== currentOptionsHash) {
                  console.info('[checklist] hydrate.hidden.skip-options-mismatch', { rawOptionsHash, currentOptionsHash });
                  return;
                }
                if (hiddenKey && pageDateKey && hiddenKey !== pageDateKey) {
                  console.info('[checklist] hydrate.hidden.fix-date-mismatch', { hiddenKey, pageDateKey });
                  try {
                    const clone = Array.isArray(raw)
                      ? { items: raw.map((v) => v === true) }
                      : { ...raw };
                    clone.dateKey = pageDateKey;
                    raw = clone;
                    hidden.value = JSON.stringify(clone);
                  } catch (_) {}
                }
                if (pageDateKey && !hiddenKey) {
                  // Page avec date explicite mais payload sans dateKey → injecter la clé et continuer
                  console.info('[checklist] hydrate.hidden.inject-dateKey', { pageDateKey });
                  try {
                    const clone = Array.isArray(raw)
                      ? { items: raw.map((v) => v === true) }
                      : { ...raw };
                    clone.dateKey = pageDateKey;
                    raw = clone;
                    hidden.value = JSON.stringify(clone);
                  } catch (_) {}
                }
              } catch (e) {}
              const payload = Array.isArray(raw)
                ? { items: raw.map((item) => item === true), skipped: [] }
                : {
                    items: Array.isArray(raw.items) ? raw.items.map((item) => item === true) : [],
                    skipped: Array.isArray(raw.skipped) ? raw.skipped.map((item) => item === true) : [],
                  };
              if (isHistoryContext) {
                logChecklistEvent("info", "[checklist-history] hydrate.payload.ready", {
                  items: payload.items,
                  skipped: payload.skipped,
                });
              }
              const inputs = queryInputs();
              // Hydratation en mode protégé (inline payload) — ne plus marquer hydratation pour ne pas interférer avec le premier clic
              inputs.forEach((input, index) => {
                const skip = Boolean(payload.skipped[index]);
                const checked = Boolean(payload.items[index]);
                input.checked = checked;
                if (skip) {
                  input.setAttribute('data-checklist-prev-checked', checked ? '1' : '0');
                  if (input.dataset) {
                    input.dataset[PREV_CHECKED_KEY] = checked ? '1' : '0';
                  }
                } else {
                  input.removeAttribute('data-checklist-prev-checked');
                  if (input.dataset) {
                    delete input.dataset[PREV_CHECKED_KEY];
                  }
                }
                setSkipState(input, skip);
                const host = resolveHost(input);
                if (!skip && host) {
                  host.setAttribute('data-validated', input.checked ? 'true' : 'false');
                }
              });
              // Ne pas persister immédiatement ici pour éviter les courses; la prochaine interaction s'en chargera
            } catch (error) {
              console.warn('[checklist] payload', error);
            }
          };
          const hydrate = window.hydrateChecklist;
          const uid = window.AppCtx?.user?.uid || null;
          // Always compute the effective page dayKey first; this is what we want to scope hydration to
          const dateKey = pageDateKey || historyDateKeyAttr || window.AppCtx?.dateIso || (typeof Schema?.todayKey === 'function' ? Schema.todayKey() : null);
          const consigneId = root.getAttribute('data-consigne-id') || root.dataset.consigneId || '';
          // Évite les doubles chemins d'hydratation: si une API globale existe, on la laisse faire
          if (!(typeof hydrate === 'function')) {
            hydratePayload();
          }
          ensureItemIds();
          sync();
          if (typeof hydrate === 'function') {
            // Use the computed page dateKey; avoid defaulting to today to prevent mismatches
            const effectiveDateKey = dateKey;
            try {
              console.info('[checklist-debug] hydrate:start', {
                consigneId,
                dateKey: effectiveDateKey,
                isHistoryContext,
                pageDateKey,
              });
            } catch (_) {}
            if (root.dataset) {
              root.dataset.checklistHydrating = '1';
              root.dataset.checklistHydrationLocalDirty = root.dataset.checklistHydrationLocalDirty || '0';
              root.dataset.checklistHydrationStartedAt = String(now());
            }
            Promise.resolve(hydrate({ uid, consigneId, container: root, itemKeyAttr: 'data-key', dateKey: effectiveDateKey }))
              .then(() => {
                const hadLocalChange = root?.dataset?.checklistHydrationLocalDirty === '1';
                if (!hadLocalChange) {
                  ensureItemIds();
                  sync();
                } else {
                  console.info('[checklist] hydrate.skip-remote-due-local-change');
                }
                try {
                  console.info('[checklist-debug] hydrate:done', {
                    consigneId,
                    hadLocalChange,
                  });
                } catch (_) {}
                if (root.dataset) {
                  delete root.dataset.checklistHydrating;
                  delete root.dataset.checklistHydrationLocalDirty;
                  delete root.dataset.checklistHydrationStartedAt;
                }
              })
              .catch((error) => {
                console.warn('[checklist] hydrate', error);
                if (root.dataset) {
                  delete root.dataset.checklistHydrating;
                  delete root.dataset.checklistHydrationLocalDirty;
                  delete root.dataset.checklistHydrationStartedAt;
                }
              });
          }
        })();
      </script>
    `;
    return `
      <div class="grid gap-2" data-checklist-root data-consigne-id="${escapeHtml(String(consigne.id ?? ""))}"${optionsAttr}${historyAttr}>
        ${checkboxes || `<p class="text-sm text-[var(--muted)]">Aucun élément défini</p>`}
        <input type="hidden" name="checklist:${consigne.id}" value="${initialSerialized}" data-checklist-state data-autosave-track="1"${historyAttr}${autosaveAttr} ${
          hasInitialStates ? 'data-dirty="1"' : ""
        }>
      </div>
      ${scriptContent}
    `;
  }
  return "";
}

function groupConsignes(consignes) {
  const ordered = consignes.slice();
  const orderIndex = new Map(ordered.map((c, idx) => [c.id, idx]));
  const byId = new Map(ordered.map((c) => [c.id, c]));
  const childrenByParent = new Map();
  ordered.forEach((consigne) => {
    if (!consigne.parentId || !byId.has(consigne.parentId)) {
      return;
    }
    const list = childrenByParent.get(consigne.parentId) || [];
    list.push(consigne);
    childrenByParent.set(consigne.parentId, list);
  });
  childrenByParent.forEach((list) => {
    list.sort((a, b) => {
      const ordA = Number(a.order || 0);
      const ordB = Number(b.order || 0);
      if (ordA !== ordB) return ordA - ordB;
      const idxA = orderIndex.get(a.id) ?? 0;
      const idxB = orderIndex.get(b.id) ?? 0;
      if (idxA !== idxB) return idxA - idxB;
      const prioDiff = (a.priority || 0) - (b.priority || 0);
      if (prioDiff !== 0) return prioDiff;
      return (a.text || "").localeCompare(b.text || "");
    });
  });
  const seen = new Set();
  const groups = [];
  ordered.forEach((consigne) => {
    if (consigne.parentId && byId.has(consigne.parentId)) {
      return;
    }
    const children = childrenByParent.get(consigne.id) || [];
    groups.push({ consigne, children });
    seen.add(consigne.id);
    children.forEach((child) => seen.add(child.id));
  });
  ordered.forEach((consigne) => {
    if (!seen.has(consigne.id)) {
      groups.push({ consigne, children: [] });
      seen.add(consigne.id);
    }
  });
  return groups;
}

function normalizeSummaryMetadataInput(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const sources = [metadata];
  if (metadata.summary && typeof metadata.summary === "object") {
    sources.push(metadata.summary);
  }
  const readField = (...keys) => {
    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      for (const key of keys) {
        if (!key || !Object.prototype.hasOwnProperty.call(source, key)) continue;
        const raw = source[key];
        if (raw === null || raw === undefined) continue;
        const stringValue = typeof raw === "string" ? raw.trim() : String(raw).trim();
        if (stringValue) return stringValue;
      }
    }
    return "";
  };
  const normalized = {};
  const scope = readField("summaryScope", "summary_scope", "scope");
  if (scope) normalized.summaryScope = scope;
  const label = readField("summaryLabel", "summary_label", "label");
  if (label) normalized.summaryLabel = label;
  const period = readField("summaryPeriod", "summary_period", "period");
  if (period) normalized.summaryPeriod = period;
  const mode = readField("summaryMode", "summary_mode", "mode");
  if (mode) normalized.summaryMode = mode;
  const source = readField("summarySource", "summary_source", "source");
  if (source) normalized.source = source;
  const origin = readField("summaryOrigin", "summary_origin", "origin");
  if (origin) normalized.origin = origin;
  const context = readField("summaryContext", "summary_context", "context");
  if (context) normalized.context = context;
  const moduleId = readField("summaryModuleId", "summary_module_id", "moduleId", "module_id");
  if (moduleId) normalized.moduleId = moduleId;
  if (!Object.keys(normalized).length) {
    return null;
  }
  return normalized;
}

function serializeSummaryMetadataForComparison(metadata) {
  const normalized = normalizeSummaryMetadataInput(metadata);
  if (!normalized) {
    return "";
  }
  const orderedKeys = Object.keys(normalized).sort();
  const payload = {};
  orderedKeys.forEach((key) => {
    payload[key] = normalized[key];
  });
  return JSON.stringify(payload);
}

function setConsigneSummaryMetadata(row, metadata = null) {
  if (!row || !row.dataset) return;
  const dataset = row.dataset;
  const normalized = normalizeSummaryMetadataInput(metadata);
  if (normalized?.summaryScope) {
    dataset.summaryScope = String(normalized.summaryScope);
    dataset.summarySelected = "1";
  } else {
    delete dataset.summaryScope;
    delete dataset.summarySelected;
  }

  if (normalized?.summaryLabel) dataset.summaryLabel = String(normalized.summaryLabel);
  else delete dataset.summaryLabel;

  if (normalized?.summaryPeriod) dataset.summaryPeriod = String(normalized.summaryPeriod);
  else delete dataset.summaryPeriod;

  if (normalized?.summaryMode) dataset.summaryMode = String(normalized.summaryMode);
  else delete dataset.summaryMode;

  if (normalized?.source) dataset.summarySource = String(normalized.source);
  else delete dataset.summarySource;

  if (normalized?.origin) dataset.summaryOrigin = String(normalized.origin);
  else delete dataset.summaryOrigin;

  if (normalized?.context) dataset.summaryContext = String(normalized.context);
  else delete dataset.summaryContext;

  if (normalized?.moduleId) dataset.summaryModuleId = String(normalized.moduleId);
  else delete dataset.summaryModuleId;
}

function clearConsigneSummaryMetadata(row) {
  setConsigneSummaryMetadata(row, null);
}

function readConsigneSummaryMetadata(row) {
  if (!row || !row.dataset) {
    return null;
  }
  const dataset = row.dataset;
  if (!dataset.summaryScope && !dataset.summaryLabel && !dataset.summaryPeriod && !dataset.summaryMode) {
    return null;
  }
  const raw = {
    summaryScope: dataset.summaryScope,
    summaryLabel: dataset.summaryLabel,
    summaryPeriod: dataset.summaryPeriod,
    summaryMode: dataset.summaryMode,
    summarySource: dataset.summarySource,
    summaryOrigin: dataset.summaryOrigin,
    summaryContext: dataset.summaryContext,
    summaryModuleId: dataset.summaryModuleId,
  };
  return normalizeSummaryMetadataInput(raw);
}

function buildSummaryMetadataForScope(scope, { date = new Date() } = {}) {
  const raw = typeof scope === "string" ? scope.trim().toLowerCase() : "";
  if (!raw) return null;
  const baseDate = date instanceof Date && !Number.isNaN(date.getTime()) ? new Date(date.getTime()) : new Date();
  const result = {
    summaryMode: "bilan",
    source: "bilan",
    moduleId: "bilan",
  };
  if (raw === "week" || raw === "weekly") {
    result.summaryScope = "weekly";
    result.summaryLabel = "Bilan hebdomadaire";
    const weekKey =
      typeof Schema?.weekKeyFromDate === "function"
        ? Schema.weekKeyFromDate(baseDate, DAILY_WEEK_ENDS_ON)
        : typeof Schema?.dayKeyFromDate === "function"
        ? Schema.dayKeyFromDate(baseDate)
        : "";
    result.summaryPeriod = weekKey;
  } else if (
    raw === "adhoc" ||
    raw === "ponctuel" ||
    raw === "ponctuelle" ||
    raw === "ponctual" ||
    raw === "punctual"
  ) {
    result.summaryScope = "adhoc";
    result.summaryLabel = "Bilan ponctuel";
    const dayKey =
      typeof Schema?.dayKeyFromDate === "function"
        ? Schema.dayKeyFromDate(baseDate)
        : baseDate.toISOString().slice(0, 10);
    result.summaryPeriod = dayKey;
    result.summaryDayKey = dayKey;
  } else if (raw === "month" || raw === "monthly") {
    result.summaryScope = "monthly";
    result.summaryLabel = "Bilan mensuel";
    const monthKey =
      typeof Schema?.monthKeyFromDate === "function"
        ? Schema.monthKeyFromDate(baseDate)
        : `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, "0")}`;
    result.summaryPeriod = monthKey;
  } else if (
    raw === "year" ||
    raw === "yearly" ||
    raw === "annual" ||
    raw === "annuel" ||
    raw === "annuelle" ||
    raw === "annee" ||
    raw === "année"
  ) {
    result.summaryScope = "yearly";
    result.summaryLabel = "Bilan annuel";
    const yearKey =
      typeof Schema?.yearKeyFromDate === "function"
        ? Schema.yearKeyFromDate(baseDate)
        : String(baseDate.getFullYear());
    result.summaryPeriod = yearKey;
  } else {
    return null;
  }
  result.scope = result.summaryScope;
  result.label = result.summaryLabel;
  result.period = result.summaryPeriod;
  const originScope = result.summaryScope || "";
  result.origin = originScope ? `bilan:${originScope}` : "bilan";
  const contextParts = ["bilan", originScope || null, result.summaryPeriod || null].filter(Boolean);
  result.context = contextParts.join(":") || "bilan";
  return result;
}

function collectAnswers(form, consignes, options = {}) {
  const dayKey = options.dayKey || null;
  const pageContext = options.pageContext || null;
  const answers = [];
  const attachPageContext = (target) => {
    if (!pageContext || !target) {
      return;
    }
    if (pageContext.pageDate) {
      target.pageDate = pageContext.pageDate;
    }
    if (pageContext.weekStart) {
      target.weekStart = pageContext.weekStart;
    }
    if (pageContext.pageDateIso) {
      target.pageDateIso = pageContext.pageDateIso;
    }
    if (typeof pageContext.pageDayIndex === "number") {
      target.pageDayIndex = pageContext.pageDayIndex;
    }
  };
  const findRowForConsigne = (consigne) => {
    if (!form || !consigne?.id) return null;
    const id = String(consigne.id);
    const escapedId =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(id)
        : id.replace(/"/g, '\\"');
    return form.querySelector(`.consigne-row[data-id="${escapedId}"]`);
  };
  for (const consigne of consignes) {
    if (consigne.type === "info") {
      continue;
    }
    const pushAnswer = (value, extras = {}) => {
      const answer = { consigne, value, dayKey };
      attachPageContext(answer);
      if (extras && typeof extras === "object") {
        Object.assign(answer, extras);
      }
      const row = findRowForConsigne(consigne);
      const summaryMetadata = readConsigneSummaryMetadata(row);
      if (summaryMetadata) {
        Object.assign(answer, summaryMetadata);
      }
      answers.push(answer);
    };
    if (consigne.type === "short") {
      const val = form.querySelector(`[name="short:${consigne.id}"]`)?.value?.trim();
      if (val) pushAnswer(val);
    } else if (consigne.type === "long") {
      const input = form.querySelector(`[name="long:${consigne.id}"]`);
      if (input) {
        const normalized = normalizeRichTextValue(input.value || "");
        if (richTextHasContent(normalized)) {
          pushAnswer(normalized);
        }
      }
    } else if (consigne.type === "num") {
      const val = form.querySelector(`[name="num:${consigne.id}"]`)?.value;
      if (val) pushAnswer(Number(val));
    } else if (consigne.type === "montant") {
      const raw = form.querySelector(`[name="montant:${consigne.id}"]`)?.value;
      if (raw !== "" && raw != null) {
        const amount = Number(raw);
        if (Number.isFinite(amount)) {
          pushAnswer(buildMontantValue(consigne, amount));
        }
      }
    } else if (consigne.type === "likert5") {
      const val = form.querySelector(`[name="likert5:${consigne.id}"]`)?.value;
      if (val !== "" && val != null) pushAnswer(Number(val));
    } else if (consigne.type === "yesno") {
      const val = form.querySelector(`[name="yesno:${consigne.id}"]`)?.value;
      if (val) pushAnswer(val);
    } else if (consigne.type === "likert6") {
      const val = form.querySelector(`[name="likert6:${consigne.id}"]`)?.value;
      if (val) pushAnswer(val);
    } else if (consigne.type === "checklist") {
      const optionsHash = computeChecklistOptionsHash(consigne);
      const hidden = form.querySelector(`[name="checklist:${consigne.id}"]`);
      const container = form.querySelector(
        `[data-checklist-root][data-consigne-id="${String(consigne.id ?? "")}"]`
      );
      let parsedValues = null;
      let parsedHasSelection = false;
      let parsedIsDirty = false;
      if (hidden) {
        parsedIsDirty = hidden.dataset?.dirty === "1";
        try {
          const parsed = JSON.parse(hidden.value || "[]");
          const normalizedValue = buildChecklistValue(consigne, parsed);
          const isDirty = hidden.dataset.dirty === "1";
          const root = hidden.closest(`[data-checklist-root]`);
          const rootDirty = root?.dataset?.checklistDirty === "1";
          if (isDirty || rootDirty) {
            const stats = deriveChecklistStats(normalizedValue);
            const selectedIds = collectChecklistSelectedIds(consigne, root, normalizedValue);
            pushAnswer(normalizedValue, {
              checkedIds: stats.checkedIds,
              checkedCount: stats.checkedCount,
              total: stats.total,
              skippedCount: stats.skippedCount,
              percentage: stats.percentage,
              isEmpty: stats.isEmpty,
              selectedIds,
              optionsHash,
            });
          }
        } catch (error) {
          console.warn("collectAnswers:checklist", error);
        }
      } else {
        const container = form.querySelector(
          `[data-checklist-root][data-consigne-id="${String(consigne.id ?? "")}"]`
        );
        if (container) {
          const domState = readChecklistDomState(container);
          const isDirty = container.dataset.checklistDirty === "1";
          if (isDirty) {
            const normalized = buildChecklistValue(consigne, domState);
            const stats = deriveChecklistStats(normalized);
            const selectedIds = collectChecklistSelectedIds(consigne, container, normalized);
            pushAnswer(normalized, {
              checkedIds: stats.checkedIds,
              checkedCount: stats.checkedCount,
              total: stats.total,
              skippedCount: stats.skippedCount,
              percentage: stats.percentage,
              isEmpty: stats.isEmpty,
              selectedIds,
              optionsHash,
            });
          }
        }
      }
    }
  }
  return answers;
}

async function openConsigneForm(ctx, consigne = null, options = {}) {
  const mode = consigne?.mode || (ctx.route.includes("/practice") ? "practice" : "daily");
  modesLogger.group("ui.consigneForm.open", { mode, consigneId: consigne?.id || null });
  const uid = ctx?.user?.uid || null;
  const lastStoredCategory = readStoredConsigneCategory(uid, mode);
  const defaultCategory = options?.defaultCategory || null;
  const initialCategory = consigne?.category ?? defaultCategory ?? lastStoredCategory ?? "";
  const catUI = await categorySelect(ctx, mode, initialCategory);
  const priority = Number(consigne?.priority ?? 2);
  const monthKey = Schema.monthKeyFromDate(new Date());
  let objectifs = [];
  try {
    objectifs = await Schema.listObjectivesByMonth(ctx.db, ctx.user.uid, monthKey);
  } catch (err) {
    modesLogger.warn("ui.consigneForm.objectifs.error", err);
  }
  const currentObjId = consigne?.objectiveId || "";
  const monthLabelFormatter = new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
  });
  const normalizeMonthLabel = (key) => {
    if (!key) return "";
    const [yearStr, monthStr] = String(key).split("-");
    const year = Number(yearStr);
    const monthIndex = Number(monthStr);
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
      return key;
    }
    const date = new Date(year, (monthIndex || 1) - 1, 1);
    if (Number.isNaN(date.getTime())) {
      return key;
    }
    const raw = monthLabelFormatter.format(date);
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : key;
  };
  const objectiveInfo = objectifs
    .map((o) => {
      const info = {
        id: o.id,
        title: o.titre || "Objectif",
        badge: "",
        period: normalizeMonthLabel(o.monthKey || monthKey),
      };
      if (o.type === "hebdo") {
        const weekNumber = Number(o.weekOfMonth || 0) || 1;
        info.badge = `Semaine ${weekNumber}`;
      } else if (o.type === "mensuel") {
        info.badge = "Mensuel";
      } else if (o.type) {
        info.badge = o.type.charAt(0).toUpperCase() + o.type.slice(1);
      }
      return info;
    })
    .sort((a, b) => a.title.localeCompare(b.title, "fr", { sensitivity: "base" }));
  const objectiveInfoById = new Map(objectiveInfo.map((item) => [item.id, item]));
  const renderObjectiveMeta = (id) => {
    if (!id) {
      return '<span class="objective-select__placeholder">Aucune association pour le moment.</span>';
    }
    const info = objectiveInfoById.get(id);
    if (!info) {
      return '<span class="objective-select__placeholder">Objectif introuvable.</span>';
    }
    const parts = [];
    if (info.badge) {
      parts.push(`<span class="objective-select__badge">${escapeHtml(info.badge)}</span>`);
    }
    if (info.period) {
      parts.push(`<span class="objective-select__period">${escapeHtml(info.period)}</span>`);
    }
    if (!parts.length) {
      parts.push('<span class="objective-select__placeholder">Aucune période renseignée</span>');
    }
    return `<div class="objective-select__summary">${parts.join("")}</div>`;
  };
  const objectifsOptions = objectiveInfo
    .map(
      (info) =>
        `<option value="${escapeHtml(info.id)}" ${info.id === currentObjId ? "selected" : ""}>
          ${escapeHtml(info.title)}
        </option>`
    )
    .join("");
  const objectiveMetaInitial = renderObjectiveMeta(currentObjId);
  const canManageChildren = !consigne?.parentId;
  let childConsignes = [];
  if (canManageChildren && consigne?.id) {
    try {
      childConsignes = await Schema.listChildConsignes(ctx.db, ctx.user.uid, consigne.id);
      childConsignes.sort((a, b) => {
        const orderDiff = (Number(a.order) || 0) - (Number(b.order) || 0);
        if (orderDiff !== 0) return orderDiff;
        const prioDiff = (Number(a.priority) || 0) - (Number(b.priority) || 0);
        if (prioDiff !== 0) return prioDiff;
        return (a.text || "").localeCompare(b.text || "");
      });
    } catch (err) {
      modesLogger.warn("ui.consigneForm.children.load", err);
    }
  }
  const durationFieldName = mode === "daily" ? "ephemeralDurationDays" : "ephemeralDurationIterations";
  const initialDurationRaw = consigne ? consigne[durationFieldName] : null;
  const initialDurationNumber = Number(initialDurationRaw);
  const durationInitialValue =
    Number.isFinite(initialDurationNumber) && initialDurationNumber > 0
      ? initialDurationNumber
      : "";
  const durationValueAttr = durationInitialValue === "" ? "" : escapeHtml(String(durationInitialValue));
  const isEphemeral = consigne?.ephemeral === true;
  const rawSummaryOnlyScope = typeof consigne?.summaryOnlyScope === "string" ? consigne.summaryOnlyScope : "";
  const normalizedSummaryOnlyScope = rawSummaryOnlyScope.trim().toLowerCase();
  const summaryOnlyScope = normalizedSummaryOnlyScope === "weekly" || normalizedSummaryOnlyScope === "week"
    ? "weekly"
    : normalizedSummaryOnlyScope === "monthly" || normalizedSummaryOnlyScope === "month"
    ? "monthly"
    : normalizedSummaryOnlyScope === "yearly" || normalizedSummaryOnlyScope === "year"
    ? "yearly"
    : normalizedSummaryOnlyScope === "summary" || normalizedSummaryOnlyScope === "bilan" || normalizedSummaryOnlyScope === "bilans"
    ? "summary"
    : "";
  let weeklySummaryEnabled = consigne?.weeklySummaryEnabled !== false;
  let monthlySummaryEnabled = consigne?.monthlySummaryEnabled !== false;
  let yearlySummaryEnabled = consigne?.yearlySummaryEnabled !== false;
  const summaryOnlyScopeInitial = summaryOnlyScope || "";
  if (summaryOnlyScope === "weekly") {
    weeklySummaryEnabled = true;
    monthlySummaryEnabled = false;
    yearlySummaryEnabled = false;
  } else if (summaryOnlyScope === "monthly") {
    weeklySummaryEnabled = false;
    monthlySummaryEnabled = true;
    yearlySummaryEnabled = false;
  } else if (summaryOnlyScope === "yearly") {
    weeklySummaryEnabled = false;
    monthlySummaryEnabled = false;
    yearlySummaryEnabled = true;
  }
  const allSummariesDisabled = !weeklySummaryEnabled && !monthlySummaryEnabled && !yearlySummaryEnabled;
  const summaryVisibilityValue = allSummariesDisabled ? "journal" : summaryOnlyScope ? "summary" : "all";
  const advancedOpenAttr =
    isEphemeral || summaryVisibilityValue !== "all" || currentObjId
      ? " open"
      : "";
  const ephemeralHiddenAttr = isEphemeral ? "" : " hidden";
  const durationLabel = mode === "daily" ? "Durée (jours)" : "Durée (itérations)";
  const durationHint =
    mode === "daily"
      ? "La consigne disparaîtra après le nombre de jours indiqué."
      : "La consigne disparaîtra après le nombre d'itérations indiqué.";
  const html = `
    <h3 class="text-lg font-semibold mb-2">${consigne ? "Modifier" : "Nouvelle"} consigne</h3>
    <form class="grid gap-4" id="consigne-form" data-autosave-key="${escapeHtml(
      [
        "consigne",
        ctx.user?.uid || "anon",
        consigne?.id ? `edit-${consigne.id}` : `new-${mode}`,
      ].map((part) => String(part)).join(":")
    )}">
      <label class="grid gap-1">
        <span class="text-sm text-[var(--muted)]">Texte de la consigne</span>
        <input name="text" required class="w-full"
               value="${escapeHtml(consigne?.text || "")}" />
      </label>

      <label class="grid gap-1">
        <span class="text-sm text-[var(--muted)]">Type de réponse</span>
        <select name="type" class="w-full">
          <option value="likert6" ${!consigne || consigne?.type === "likert6" ? "selected" : ""}>Échelle de Likert (0–4)</option>
          <option value="yesno"   ${consigne?.type === "yesno"   ? "selected" : ""}>Oui / Non</option>
          <option value="short"   ${consigne?.type === "short"   ? "selected" : ""}>Texte court</option>
          <option value="long"    ${consigne?.type === "long"    ? "selected" : ""}>Texte long</option>
          <option value="num"     ${consigne?.type === "num"     ? "selected" : ""}>Échelle numérique (0–10)</option>
          <option value="montant" ${consigne?.type === "montant" ? "selected" : ""}>Montant</option>
          <option value="checklist" ${consigne?.type === "checklist" ? "selected" : ""}>Checklist</option>
          <option value="info"    ${consigne?.type === "info"    ? "selected" : ""}>${INFO_RESPONSE_LABEL}</option>
        </select>
      </label>

      <div data-checklist-editor-anchor></div>
      <div data-montant-editor-anchor></div>

      ${catUI}

      <label class="grid gap-1">
        <span class="text-sm text-[var(--muted)]">Priorité</span>
        <select name="priority" class="w-full">
          <option value="1" ${priority === 1 ? "selected" : ""}>Haute</option>
          <option value="2" ${priority === 2 ? "selected" : ""}>Moyenne</option>
          <option value="3" ${priority === 3 ? "selected" : ""}>Basse</option>
        </select>
      </label>

      <label class="inline-flex items-center gap-2">
        <input type="checkbox" name="srEnabled" ${consigne?.srEnabled !== false ? "checked" : ""}>
        <span>⏳ Activer la répétition espacée</span>
      </label>

      <details class="consigne-advanced" data-advanced${advancedOpenAttr}>
        <summary class="consigne-advanced__summary">
          <span class="consigne-advanced__caret" aria-hidden="true">▸</span>
          <span>Paramètres avancés</span>
        </summary>
        <div class="consigne-advanced__content">
          <div class="grid gap-1 objective-select">
            <span class="text-sm text-[var(--muted)]">📌 Associer à un objectif</span>
            <select id="objective-select" class="w-full objective-select__input">
              <option value="">Aucun</option>
              ${objectifsOptions}
            </select>
            <div class="objective-select__meta" data-objective-meta>${objectiveMetaInitial}</div>
          </div>

          <div class="grid gap-2" data-summary-settings>
            <fieldset class="grid gap-1">
              <span class="text-sm text-[var(--muted)]">Visibilité</span>
              <label class="inline-flex items-center gap-2">
                <input type="radio" name="summaryVisibility" value="all" ${summaryVisibilityValue === "all" ? "checked" : ""}>
                <span>Journal et bilans</span>
              </label>
              <label class="inline-flex items-center gap-2">
                <input type="radio" name="summaryVisibility" value="summary" ${summaryVisibilityValue === "summary" ? "checked" : ""}>
                <span>Uniquement bilans</span>
              </label>
              <label class="inline-flex items-center gap-2">
                <input type="radio" name="summaryVisibility" value="journal" ${summaryVisibilityValue === "journal" ? "checked" : ""}>
                <span>Uniquement journal</span>
              </label>
            </fieldset>
          </div>

          <label class="inline-flex items-center gap-2">
            <input type="checkbox" name="ephemeral" ${isEphemeral ? "checked" : ""}>
            <span>Consigne éphémère</span>
          </label>
          <div class="grid gap-1 consigne-advanced__ephemeral" data-ephemeral-settings${ephemeralHiddenAttr}>
            <label class="grid gap-1">
              <span class="text-sm text-[var(--muted)]">${escapeHtml(durationLabel)}</span>
              <input type="number" min="1" step="1" inputmode="numeric" class="w-full" name="${durationFieldName}" value="${durationValueAttr}">
            </label>
            <p class="consigne-advanced__hint">${escapeHtml(durationHint)}</p>
          </div>
        </div>
      </details>

      ${canManageChildren ? `
      <fieldset class="grid gap-2" data-subconsignes>
        <legend class="text-sm text-[var(--muted)]">Sous-consignes</legend>
        <div class="grid gap-2" id="subconsignes-list"></div>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn btn-ghost text-sm" id="add-subconsigne">+ Ajouter une sous-consigne</button>
          <span class="text-xs text-[var(--muted)]">Les sous-consignes partagent la même catégorie, la même priorité et les mêmes réglages que la consigne principale.</span>
        </div>
      </fieldset>
      ` : ""}

      ${mode === "daily" ? `
      <fieldset class="grid gap-2">
        <legend class="text-sm text-[var(--muted)]">Fréquence (jours)</legend>

        <label class="inline-flex items-center gap-2 mb-1">
          <input type="checkbox" id="daily-all" ${(!consigne || !consigne.days || !consigne.days.length) ? "checked" : ""}>
          <span>Quotidien</span>
        </label>

        <div class="flex flex-wrap gap-2" id="daily-days">
          ${["LUN","MAR","MER","JEU","VEN","SAM","DIM"].map((day) => {
            const selected = Array.isArray(consigne?.days) && consigne.days.includes(day);
            return `<label class="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-sm">
        <input type="checkbox" name="days" value="${day}" ${selected ? "checked" : ""}>
        <span>${day}</span>
      </label>`;
          }).join("")}
        </div>
      </fieldset>
      ` : ""}

      <div class="flex justify-end gap-2 pt-2">
        <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `;
  const m = modal(html);
  const advancedDetailsEl = m.querySelector("[data-advanced]");
  const ephemeralCheckboxEl = m.querySelector('input[name="ephemeral"]');
  const ephemeralSettingsEl = m.querySelector("[data-ephemeral-settings]");
  const ephemeralDurationInput = durationFieldName
    ? m.querySelector(`[name="${durationFieldName}"]`)
    : null;
  const syncEphemeralControls = () => {
    if (!ephemeralSettingsEl) return;
    const enabled = Boolean(ephemeralCheckboxEl?.checked);
    if (enabled) {
      ephemeralSettingsEl.hidden = false;
      ephemeralSettingsEl.classList.remove("hidden");
    } else {
      ephemeralSettingsEl.hidden = true;
      ephemeralSettingsEl.classList.add("hidden");
    }
    if (ephemeralDurationInput) {
      ephemeralDurationInput.disabled = !enabled;
    }
  };
  if (ephemeralCheckboxEl) {
    syncEphemeralControls();
    ephemeralCheckboxEl.addEventListener("change", () => {
      syncEphemeralControls();
      if (ephemeralCheckboxEl.checked) {
        if (advancedDetailsEl && typeof advancedDetailsEl.open === "boolean") {
          advancedDetailsEl.open = true;
        }
        if (ephemeralDurationInput) {
          try {
            ephemeralDurationInput.focus({ preventScroll: true });
          } catch (error) {
            ephemeralDurationInput.focus();
          }
        }
      }
    });
  }
  const typeSelectEl = m.querySelector('select[name="type"]');
  const checklistAnchor = m.querySelector('[data-checklist-editor-anchor]');
  const checklistEditor = document.createElement('fieldset');
  checklistEditor.className = 'grid gap-2';
  checklistEditor.dataset.checklistEditor = '';
  const checklistLegend = document.createElement('legend');
  checklistLegend.className = 'text-sm text-[var(--muted)]';
  checklistLegend.textContent = 'Éléments de checklist';
  const checklistList = document.createElement('div');
  checklistList.className = 'grid gap-2';
  checklistList.dataset.checklistList = '';
  const checklistActions = document.createElement('div');
  checklistActions.className = 'flex justify-start';
  const checklistAddBtn = document.createElement('button');
  checklistAddBtn.type = 'button';
  checklistAddBtn.className = 'btn btn-ghost text-sm';
  checklistAddBtn.dataset.checklistAdd = 'true';
  checklistAddBtn.textContent = '+ Ajouter un élément';
  checklistActions.appendChild(checklistAddBtn);
  checklistEditor.append(checklistLegend, checklistList, checklistActions);
  const montantAnchor = m.querySelector('[data-montant-editor-anchor]');
  const initialMontantUnit = typeof consigne?.montantUnit === 'string' ? consigne.montantUnit : '';
  const initialMontantGoalNumber = parseMontantNumber(consigne?.montantGoal);
  const initialMontantGoalValue =
    initialMontantGoalNumber !== null && Number.isFinite(initialMontantGoalNumber)
      ? String(initialMontantGoalNumber)
      : '';
  const initialMontantOperator = normalizeMontantOperator(consigne?.montantGoalOperator);
  const montantEditor = document.createElement('fieldset');
  montantEditor.className = 'grid gap-2';
  montantEditor.dataset.montantEditor = '';
  montantEditor.innerHTML = `
    <legend class="text-sm text-[var(--muted)]">Configuration du montant</legend>
    <label class="grid gap-1">
      <span class="text-sm text-[var(--muted)]">Unité (ex. pompes)</span>
      <input type="text" name="montant-unit" class="w-full" placeholder="Unité" value="${escapeHtml(initialMontantUnit || '')}">
    </label>
    <div class="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:items-end">
      <label class="grid gap-1">
        <span class="text-sm text-[var(--muted)]">Objectif</span>
        <input type="number" inputmode="decimal" step="any" min="0" name="montant-goal" class="w-full" placeholder="Valeur cible" value="${escapeHtml(initialMontantGoalValue)}">
      </label>
      <label class="grid gap-1">
        <span class="text-sm text-[var(--muted)]">Comparaison</span>
        <select name="montant-operator" class="w-full">
          <option value="eq" ${initialMontantOperator === 'eq' ? 'selected' : ''}>Égal à</option>
          <option value="gte" ${initialMontantOperator === 'gte' ? 'selected' : ''}>Supérieur ou égal à</option>
          <option value="lte" ${initialMontantOperator === 'lte' ? 'selected' : ''}>Inférieur ou égal à</option>
        </select>
      </label>
    </div>
    <p class="text-xs text-[var(--muted)]">L’objectif est optionnel.</p>
  `;
  let checklistMounted = false;
  const mountChecklistEditor = () => {
    if (!checklistAnchor || checklistMounted) return;
    checklistAnchor.appendChild(checklistEditor);
    checklistMounted = true;
  };
  const unmountChecklistEditor = () => {
    if (!checklistMounted) return;
    checklistEditor.remove();
    checklistMounted = false;
  };
  let montantMounted = false;
  const mountMontantEditor = () => {
    if (!montantAnchor || montantMounted) return;
    montantAnchor.appendChild(montantEditor);
    montantMounted = true;
  };
  const unmountMontantEditor = () => {
    if (!montantMounted) return;
    montantEditor.remove();
    montantMounted = false;
  };
  const checklistEmptyClass = 'checklist-editor__empty';
  const renderChecklistEmptyState = () => {
    if (!checklistMounted || !checklistList) return;
    const hasItems = checklistList.querySelector('[name="checklist-item"]');
    if (hasItems) {
      const empty = checklistList.querySelector(`.${checklistEmptyClass}`);
      if (empty) empty.remove();
      return;
    }
    const empty = document.createElement('p');
    empty.className = `text-sm text-[var(--muted)] ${checklistEmptyClass}`;
    empty.textContent = "Aucun élément pour l'instant.";
    checklistList.appendChild(empty);
  };
  const addChecklistRow = (initialText = "", initialId = "") => {
    if (!checklistList) return null;
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.dataset.checklistEditorRow = '';
    row.draggable = true;
    const idInput = document.createElement('input');
    idInput.type = 'hidden';
    idInput.name = 'checklist-item-id';
    const resolvedId = typeof initialId === 'string' && initialId.trim().length
      ? initialId.trim()
      : generateClientChecklistItemId();
    idInput.value = resolvedId;
    row.dataset.checklistItemId = resolvedId;
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'checklist-item';
    input.className = 'w-full';
    input.placeholder = "Intitulé de l'élément";
    input.value = initialText;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-ghost text-xs';
    removeBtn.dataset.removeChecklist = 'true';
    removeBtn.textContent = 'Supprimer';
    removeBtn.addEventListener('click', () => {
      row.remove();
      renderChecklistEmptyState();
    });
    row.append(idInput, input, removeBtn);
    checklistList.appendChild(row);
    renderChecklistEmptyState();
    return row;
  };
  const setupChecklistDragAndDrop = () => {
    if (!checklistList || checklistList.__dragInstalled) return;
    checklistList.__dragInstalled = true;
    let dragging = null;
    const clearDrag = () => {
      if (dragging) {
        dragging.classList.remove('opacity-60');
      }
      dragging = null;
    };
    checklistList.addEventListener('dragstart', (event) => {
      const row = event.target?.closest('[data-checklist-editor-row]');
      if (!row) return;
      dragging = row;
      row.classList.add('opacity-60');
      event.dataTransfer.effectAllowed = 'move';
      try {
        event.dataTransfer.setData('text/plain', '');
      } catch (error) {
        // ignore
      }
    });
    checklistList.addEventListener('dragover', (event) => {
      if (!dragging) return;
      event.preventDefault();
      const over = event.target?.closest('[data-checklist-editor-row]');
      if (!over || over === dragging) return;
      const rect = over.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      over.parentNode.insertBefore(dragging, before ? over : over.nextSibling);
    });
    checklistList.addEventListener('drop', (event) => {
      if (!dragging) return;
      event.preventDefault();
      clearDrag();
    });
    checklistList.addEventListener('dragend', clearDrag);
    checklistList.addEventListener('dragleave', (event) => {
      if (!dragging) return;
      const related = event.relatedTarget;
      if (!checklistList.contains(related)) {
        clearDrag();
      }
    });
  };
  checklistAddBtn.addEventListener('click', () => {
    addChecklistRow();
    const lastInput = checklistList?.querySelector('div:last-of-type input[name="checklist-item"]');
    if (lastInput) {
      try {
        lastInput.focus({ preventScroll: true });
      } catch (error) {
        lastInput.focus();
      }
    }
  });
  const initialChecklistItems = Array.isArray(consigne?.checklistItems)
    ? consigne.checklistItems.filter((item) => typeof item === 'string' && item.trim().length > 0)
    : [];
  const initialChecklistIds = Array.isArray(consigne?.checklistItemIds)
    ? consigne.checklistItemIds
    : [];
  if (initialChecklistItems.length) {
    initialChecklistItems.forEach((item, index) => addChecklistRow(item, initialChecklistIds[index] || ''));
  }
  const ensureChecklistHasRow = () => {
    if (!checklistMounted || !checklistList) return;
    if (!checklistList.querySelector('[name="checklist-item"]')) {
      addChecklistRow();
    }
  };
  const syncTypeSpecificVisibility = () => {
    const selectedType = typeSelectEl?.value;
    if (selectedType === 'checklist') {
      mountChecklistEditor();
      ensureChecklistHasRow();
      renderChecklistEmptyState();
      setupChecklistDragAndDrop();
    } else {
      if (checklistList) {
        checklistList.innerHTML = '';
      }
      unmountChecklistEditor();
    }
    if (selectedType === 'montant') {
      mountMontantEditor();
    } else {
      unmountMontantEditor();
    }
  };
  if (typeSelectEl) {
    typeSelectEl.addEventListener('change', () => {
      syncTypeSpecificVisibility();
    });
  }
  syncTypeSpecificVisibility();
  renderChecklistEmptyState();
  const objectiveSelectEl = m.querySelector("#objective-select");
  const objectiveMetaBox = m.querySelector("[data-objective-meta]");
  const syncObjectiveMeta = () => {
    if (!objectiveMetaBox) return;
    const selectedId = objectiveSelectEl?.value || "";
    objectiveMetaBox.innerHTML = renderObjectiveMeta(selectedId);
  };
  if (objectiveSelectEl) {
    objectiveSelectEl.addEventListener("change", syncObjectiveMeta);
  }
  syncObjectiveMeta();
  const removedChildIds = new Set();
  if (canManageChildren) {
    const list = m.querySelector("#subconsignes-list");
    const addBtn = m.querySelector("#add-subconsigne");
    const persistChildOrder = async () => {
      if (!list || !ctx?.db || !ctx?.user?.uid) return;
      const rows = Array.from(list.querySelectorAll('[data-subconsigne][data-id]'));
      if (!rows.length) return;
      try {
        await Promise.all(
          rows.map((row, index) =>
            Schema.updateConsigneOrder(ctx.db, ctx.user.uid, row.dataset.id, (index + 1) * 10)
          )
        );
      } catch (error) {
        console.warn('subconsignes.reorder:persist', error);
      }
    };
    const updateReorderButtonsState = () => {
      if (!list) return;
      const rows = Array.from(list.querySelectorAll('[data-subconsigne]'));
      rows.forEach((row, idx) => {
        const up = row.querySelector('[data-move-up]');
        const down = row.querySelector('[data-move-down]');
        if (up) {
          up.disabled = idx === 0;
          up.classList.toggle('opacity-50', up.disabled);
        }
        if (down) {
          down.disabled = idx === rows.length - 1;
          down.classList.toggle('opacity-50', down.disabled);
        }
      });
    };
    const renderEmpty = () => {
      if (!list) return;
      if (list.children.length) {
        list.setAttribute("data-has-items", "true");
        return;
      }
      list.removeAttribute("data-has-items");
      const empty = document.createElement("div");
      empty.className = "subconsigne-empty";
      empty.textContent = "Aucune sous-consigne pour le moment.";
      list.appendChild(empty);
    };
    const makeRow = (item = {}) => {
      const row = document.createElement("div");
      row.className = "subconsigne-row";
      row.dataset.subconsigne = "";
      if (item.id) row.dataset.id = item.id;
      row.innerHTML = `
        <div class="subconsigne-row__main">
          <input type="text" name="sub-text" class="w-full" placeholder="Texte de la sous-consigne" value="${escapeHtml(item.text || "")}">
          <select name="sub-type" class="w-full">
            <option value="likert6" ${!item.type || item.type === "likert6" ? "selected" : ""}>Échelle de Likert (0–4)</option>
            <option value="yesno" ${item.type === "yesno" ? "selected" : ""}>Oui / Non</option>
            <option value="short" ${item.type === "short" ? "selected" : ""}>Texte court</option>
            <option value="long" ${item.type === "long" ? "selected" : ""}>Texte long</option>
            <option value="num" ${item.type === "num" ? "selected" : ""}>Échelle numérique (0–10)</option>
            <option value="montant" ${item.type === "montant" ? "selected" : ""}>Montant</option>
            <option value="checklist" ${item.type === "checklist" ? "selected" : ""}>Checklist</option>
            <option value="info" ${item.type === "info" ? "selected" : ""}>${INFO_RESPONSE_LABEL}</option>
          </select>
        </div>
        <div class="subconsigne-row__actions">
          <div class="flex items-center gap-1 mr-1">
            <button type="button" class="btn btn-ghost text-xs" data-move-up title="Monter">▲</button>
            <button type="button" class="btn btn-ghost text-xs" data-move-down title="Descendre">▼</button>
          </div>
          <button type="button" class="btn btn-ghost text-xs" data-remove>Supprimer</button>
        </div>
      `;
      const mainSection = row.querySelector(".subconsigne-row__main");
      const typeSelect = row.querySelector('select[name="sub-type"]');
      const subChecklistEditor = document.createElement('fieldset');
      subChecklistEditor.className = 'grid gap-2';
      subChecklistEditor.dataset.subChecklistEditor = '';
      const setSubChecklistVisibility = (visible) => {
        const isVisible = Boolean(visible);
        subChecklistEditor.hidden = !isVisible;
        subChecklistEditor.classList.toggle('hidden', !isVisible);
        if (!isVisible) {
          subChecklistEditor.style.display = 'none';
        } else {
          subChecklistEditor.style.removeProperty('display');
        }
      };
      setSubChecklistVisibility(false);
      const subMontantEditor = document.createElement('fieldset');
      subMontantEditor.className = 'grid gap-2';
      subMontantEditor.dataset.subMontantEditor = '';
      const initialSubMontantUnit = typeof item.montantUnit === 'string' ? item.montantUnit : '';
      const initialSubMontantGoalNumber = parseMontantNumber(item.montantGoal);
      const initialSubMontantGoalValue =
        initialSubMontantGoalNumber !== null && Number.isFinite(initialSubMontantGoalNumber)
          ? String(initialSubMontantGoalNumber)
          : '';
      const initialSubMontantOperator = normalizeMontantOperator(item.montantGoalOperator);
      subMontantEditor.innerHTML = `
        <legend class="text-sm text-[var(--muted)]">Configuration du montant</legend>
        <label class="grid gap-1">
          <span class="text-sm text-[var(--muted)]">Unité (ex. pompes)</span>
          <input type="text" name="sub-montant-unit" class="w-full" placeholder="Unité" value="${escapeHtml(initialSubMontantUnit || '')}">
        </label>
        <div class="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:items-end">
          <label class="grid gap-1">
            <span class="text-sm text-[var(--muted)]">Objectif</span>
            <input type="number" inputmode="decimal" step="any" min="0" name="sub-montant-goal" class="w-full" placeholder="Valeur cible" value="${escapeHtml(initialSubMontantGoalValue)}">
          </label>
          <label class="grid gap-1">
            <span class="text-sm text-[var(--muted)]">Comparaison</span>
            <select name="sub-montant-operator" class="w-full">
              <option value="eq" ${initialSubMontantOperator === 'eq' ? 'selected' : ''}>Égal à</option>
              <option value="gte" ${initialSubMontantOperator === 'gte' ? 'selected' : ''}>Supérieur ou égal à</option>
              <option value="lte" ${initialSubMontantOperator === 'lte' ? 'selected' : ''}>Inférieur ou égal à</option>
            </select>
          </label>
        </div>
        <p class="text-xs text-[var(--muted)]">L’objectif est optionnel.</p>
      `;
      const setSubMontantVisibility = (visible) => {
        const isVisible = Boolean(visible);
        subMontantEditor.hidden = !isVisible;
        subMontantEditor.classList.toggle('hidden', !isVisible);
        if (!isVisible) {
          subMontantEditor.style.display = 'none';
        } else {
          subMontantEditor.style.removeProperty('display');
        }
      };
      setSubMontantVisibility(false);
      const subChecklistLegend = document.createElement('legend');
      subChecklistLegend.className = 'text-sm text-[var(--muted)]';
      subChecklistLegend.textContent = "Éléments de checklist";
      const subChecklistList = document.createElement('div');
      subChecklistList.className = 'grid gap-2';
      subChecklistList.dataset.subChecklistList = '';
      const subChecklistActions = document.createElement('div');
      subChecklistActions.className = 'flex justify-start';
      const subChecklistAddBtn = document.createElement('button');
      subChecklistAddBtn.type = 'button';
      subChecklistAddBtn.className = 'btn btn-ghost text-sm';
      subChecklistAddBtn.dataset.subChecklistAdd = 'true';
      subChecklistAddBtn.textContent = '+ Ajouter un élément';
      subChecklistActions.appendChild(subChecklistAddBtn);
      subChecklistEditor.append(subChecklistLegend, subChecklistList, subChecklistActions);
      if (mainSection) {
        mainSection.appendChild(subChecklistEditor);
        mainSection.appendChild(subMontantEditor);
      }
      const subChecklistEmptyClass = 'subchecklist-editor__empty';
      const renderSubChecklistEmptyState = () => {
        if (!subChecklistList) return;
        const empty = subChecklistList.querySelector(`.${subChecklistEmptyClass}`);
        const hasItems = subChecklistList.querySelector('[name="sub-checklist-item"]');
        if (subChecklistEditor.hidden) {
          if (empty) empty.remove();
          return;
        }
        if (hasItems) {
          if (empty) empty.remove();
          return;
        }
        const emptyState = document.createElement('p');
        emptyState.className = `text-sm text-[var(--muted)] ${subChecklistEmptyClass}`;
        emptyState.textContent = "Aucun élément pour l'instant.";
        subChecklistList.appendChild(emptyState);
      };
      const addSubChecklistRow = (initialText = "", initialId = "") => {
        if (!subChecklistList) return null;
        const itemRow = document.createElement('div');
        itemRow.className = 'flex items-center gap-2';
        itemRow.dataset.subChecklistRow = '';
        itemRow.draggable = true;
        const idInput = document.createElement('input');
        idInput.type = 'hidden';
        idInput.name = 'sub-checklist-item-id';
        const resolvedId = typeof initialId === 'string' && initialId.trim().length
          ? initialId.trim()
          : generateClientChecklistItemId();
        idInput.value = resolvedId;
        itemRow.dataset.subChecklistItemId = resolvedId;
        const input = document.createElement('input');
        input.type = 'text';
        input.name = 'sub-checklist-item';
        input.className = 'w-full';
        input.placeholder = "Intitulé de l'élément";
        input.value = initialText;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-ghost text-xs';
        removeBtn.dataset.removeSubChecklist = 'true';
        removeBtn.textContent = 'Supprimer';
        removeBtn.addEventListener('click', () => {
          itemRow.remove();
          renderSubChecklistEmptyState();
        });
        itemRow.append(idInput, input, removeBtn);
        subChecklistList.appendChild(itemRow);
        renderSubChecklistEmptyState();
        return itemRow;
      };
      const setupSubChecklistDragAndDrop = () => {
        if (!subChecklistList || subChecklistList.__dragInstalled) return;
        subChecklistList.__dragInstalled = true;
        let dragging = null;
        const clearDrag = () => {
          if (dragging) {
            dragging.classList.remove('opacity-60');
          }
          dragging = null;
        };
        subChecklistList.addEventListener('dragstart', (event) => {
          const row = event.target?.closest('[data-sub-checklist-row]');
          if (!row) return;
          dragging = row;
          row.classList.add('opacity-60');
          event.dataTransfer.effectAllowed = 'move';
          try {
            event.dataTransfer.setData('text/plain', '');
          } catch (error) {
            // ignore
          }
        });
        subChecklistList.addEventListener('dragover', (event) => {
          if (!dragging) return;
          event.preventDefault();
          const over = event.target?.closest('[data-sub-checklist-row]');
          if (!over || over === dragging) return;
          const rect = over.getBoundingClientRect();
          const before = event.clientY < rect.top + rect.height / 2;
          over.parentNode.insertBefore(dragging, before ? over : over.nextSibling);
        });
        subChecklistList.addEventListener('drop', (event) => {
          if (!dragging) return;
          event.preventDefault();
          clearDrag();
        });
        subChecklistList.addEventListener('dragend', clearDrag);
      };
      const ensureSubChecklistHasRow = () => {
        if (subChecklistEditor.hidden) return;
        if (!subChecklistList) return;
        if (!subChecklistList.querySelector('[name="sub-checklist-item"]')) {
          addSubChecklistRow();
        }
      };
      if (subChecklistAddBtn) {
        subChecklistAddBtn.addEventListener('click', () => {
          const newRow = addSubChecklistRow();
          const lastInput = newRow?.querySelector('input[name="sub-checklist-item"]');
          if (lastInput) {
            try {
              lastInput.focus({ preventScroll: true });
            } catch (error) {
              lastInput.focus();
            }
          }
        });
      }
      const initialSubChecklistItems = Array.isArray(item?.checklistItems)
        ? item.checklistItems.filter((value) => typeof value === 'string' && value.trim().length > 0)
        : [];
      const initialSubChecklistIds = Array.isArray(item?.checklistItemIds)
        ? item.checklistItemIds
        : [];
      if (initialSubChecklistItems.length) {
        initialSubChecklistItems.forEach((value, index) =>
          addSubChecklistRow(value, initialSubChecklistIds[index] || '')
        );
      }
      setupSubChecklistDragAndDrop();
      const syncSubTypeVisibility = () => {
        const selectedType = typeSelect?.value;
        if (selectedType === 'checklist') {
          setSubChecklistVisibility(true);
          ensureSubChecklistHasRow();
          renderSubChecklistEmptyState();
        } else {
          if (subChecklistList) {
            subChecklistList.innerHTML = '';
          }
          setSubChecklistVisibility(false);
          renderSubChecklistEmptyState();
        }
        if (selectedType === 'montant') {
          setSubMontantVisibility(true);
        } else {
          setSubMontantVisibility(false);
        }
      };
      if (typeSelect) {
        typeSelect.addEventListener('change', () => {
          syncSubTypeVisibility();
        });
      }
      syncSubTypeVisibility();
      row.querySelector('[data-remove]')?.addEventListener('click', () => {
        if (item.id) {
          removedChildIds.add(item.id);
        }
        row.remove();
        if (list && !list.children.length) {
          renderEmpty();
        } else if (list) {
          list.setAttribute("data-has-items", "true");
        }
        updateReorderButtonsState();
      });
      // Reorder controls
      const moveUpBtn = row.querySelector('[data-move-up]');
      const moveDownBtn = row.querySelector('[data-move-down]');
      const moveRow = async (direction) => {
        if (!list) return;
        const rows = Array.from(list.querySelectorAll('[data-subconsigne]'));
        const index = rows.indexOf(row);
        if (index < 0) return;
        if (direction === -1 && index > 0) {
          list.insertBefore(row, rows[index - 1]);
        } else if (direction === 1 && index < rows.length - 1) {
          list.insertBefore(row, rows[index + 1].nextSibling);
        }
        updateReorderButtonsState();
        // Persist order for existing children only (those with an id)
        await persistChildOrder();
      };
      if (moveUpBtn) {
        moveUpBtn.addEventListener('click', () => moveRow(-1));
      }
      if (moveDownBtn) {
        moveDownBtn.addEventListener('click', () => moveRow(1));
      }
      return row;
    };
    if (list) {
      list.innerHTML = "";
      childConsignes.forEach((item) => {
        const row = makeRow(item);
        list.appendChild(row);
      });
      renderEmpty();
      updateReorderButtonsState();
    }
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        if (!list) return;
        if (!list.querySelector('[data-subconsigne]')) {
          list.innerHTML = "";
        }
        const row = makeRow({});
        list.appendChild(row);
        list.setAttribute("data-has-items", "true");
        row.querySelector('input[name="sub-text"]')?.focus();
        updateReorderButtonsState();
      });
    }
  }
  const dailyAll = m.querySelector("#daily-all");
  const daysBox  = m.querySelector("#daily-days");
  if (dailyAll && daysBox) {
    const dayInputs = Array.from(daysBox.querySelectorAll('input[name="days"]'));
    const syncDaysState = (isDaily) => {
      dayInputs.forEach((cb) => {
        if (isDaily) cb.checked = true;
        cb.disabled = isDaily;
        const label = cb.closest("label");
        if (label) {
          label.classList.toggle("opacity-60", isDaily);
        }
      });
    };
    syncDaysState(dailyAll.checked);
    dailyAll.addEventListener("change", () => {
      syncDaysState(dailyAll.checked);
    });
  }
  modesLogger.groupEnd();
  $("#cancel", m).onclick = () => m.remove();

  $("#consigne-form", m).onsubmit = async (e) => {
    e.preventDefault();
    modesLogger.group("ui.consigneForm.submit");
    try {
      const fd = new FormData(e.currentTarget);
      const cat = (fd.get("categoryInput") || "").trim();
      if (!cat) {
        alert("Choisis (ou saisis) une catégorie.");
        return;
      }

      await Schema.ensureCategory(ctx.db, ctx.user.uid, cat, mode);

      storeConsigneCategory(ctx?.user?.uid || null, mode, cat);

      const ephemeralEnabled = fd.get("ephemeral") !== null;
      let ephemeralDurationDays = null;
      let ephemeralDurationIterations = null;
      if (ephemeralEnabled) {
        const rawDurationValue = Number(fd.get(durationFieldName) || 0);
        const normalizedDuration = Math.round(rawDurationValue);
        if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0) {
          alert(
            `Indique une durée valide en ${
              mode === "daily" ? "jours" : "itérations"
            } (minimum 1).`
          );
          return;
        }
        if (mode === "daily") {
          ephemeralDurationDays = normalizedDuration;
        } else {
          ephemeralDurationIterations = normalizedDuration;
        }
      }

      const summaryVisibilityChoice = String(fd.get("summaryVisibility") || "all");
      let weeklySummaryEnabled = true;
      let monthlySummaryEnabled = true;
      let yearlySummaryEnabled = true;
      let summaryOnlyScopeValue = null;
      if (summaryVisibilityChoice === "journal") {
        weeklySummaryEnabled = false;
        monthlySummaryEnabled = false;
        yearlySummaryEnabled = false;
      } else if (summaryVisibilityChoice === "summary") {
        const baseScope = summaryOnlyScopeInitial || "summary";
        if (baseScope === "weekly") {
          weeklySummaryEnabled = true;
          monthlySummaryEnabled = false;
          yearlySummaryEnabled = false;
          summaryOnlyScopeValue = "weekly";
        } else if (baseScope === "monthly") {
          weeklySummaryEnabled = false;
          monthlySummaryEnabled = true;
          yearlySummaryEnabled = false;
          summaryOnlyScopeValue = "monthly";
        } else if (baseScope === "yearly") {
          weeklySummaryEnabled = false;
          monthlySummaryEnabled = false;
          yearlySummaryEnabled = true;
          summaryOnlyScopeValue = "yearly";
        } else {
          weeklySummaryEnabled = true;
          monthlySummaryEnabled = true;
          yearlySummaryEnabled = true;
          summaryOnlyScopeValue = "summary";
        }
      } else {
        summaryOnlyScopeValue = null;
      }

      const payload = {
        ownerUid: ctx.user.uid,
        mode,
        text: fd.get("text").trim(),
        type: fd.get("type"),
        category: cat,
        priority: Number(fd.get("priority") || 2),
        srEnabled: fd.get("srEnabled") !== null,
        weeklySummaryEnabled,
        monthlySummaryEnabled,
        yearlySummaryEnabled,
      summaryOnlyScope: summaryOnlyScopeValue,
      ephemeral: ephemeralEnabled,
      ephemeralDurationDays,
      ephemeralDurationIterations,
      active: true,
      parentId: consigne?.parentId || null,
    };
      if (payload.type === "montant") {
        const unitField = m.querySelector('input[name="montant-unit"]');
        const goalField = m.querySelector('input[name="montant-goal"]');
        const operatorField = m.querySelector('select[name="montant-operator"]');
        const unitValue = unitField?.value ? unitField.value.trim() : "";
        const goalRaw = goalField?.value ? goalField.value.trim() : "";
        let goalValue = null;
        if (goalRaw) {
          const parsedGoal = Number(goalRaw.replace(/,/g, '.'));
          if (!Number.isFinite(parsedGoal)) {
            alert('Indique un objectif numérique valide pour le montant.');
            return;
          }
          goalValue = parsedGoal;
        }
        payload.montantUnit = unitValue;
        payload.montantGoal = goalValue;
        payload.montantGoalOperator = normalizeMontantOperator(operatorField?.value);
      } else {
        payload.montantUnit = "";
        payload.montantGoal = null;
        payload.montantGoalOperator = null;
      }
      if (payload.type === "checklist") {
        const itemRows = Array.from(m.querySelectorAll('[data-checklist-editor-row]'));
        const items = itemRows.map((row) => {
          const input = row.querySelector('input[name="checklist-item"]');
          return input ? input.value.trim() : "";
        });
        const hasAtLeastOne = items.some((text) => text.length > 0);
        if (!hasAtLeastOne) {
          alert("Ajoute au moins un élément à la checklist.");
          return;
        }
        const hasEmpty = items.some((text) => text.length === 0);
        if (hasEmpty) {
          alert("Renseigne chaque élément de checklist ou supprime ceux qui sont vides.");
          return;
        }
        const itemIds = itemRows.map((row) => {
          const hidden = row.querySelector('input[name="checklist-item-id"]');
          let idValue = hidden?.value && typeof hidden.value === 'string' ? hidden.value.trim() : '';
          if (!idValue && hidden) {
            idValue = generateClientChecklistItemId();
            hidden.value = idValue;
          }
          if (!idValue) {
            idValue = generateClientChecklistItemId();
          }
          row.dataset.checklistItemId = idValue;
          return idValue;
        });
        payload.checklistItems = items;
        payload.checklistItemIds = itemIds;
      } else {
        payload.checklistItems = [];
        payload.checklistItemIds = [];
      }
      if (mode === "daily") {
        const isAll = m.querySelector("#daily-all")?.checked;
        payload.days = isAll ? [] : $$("input[name=days]:checked", m).map((input) => input.value);
      }
      modesLogger.info("payload", payload);

      const selectedObjective = m.querySelector("#objective-select")?.value || "";
      const subRows = canManageChildren
        ? Array.from(m.querySelectorAll('[data-subconsigne]'))
        : [];
      if (canManageChildren && subRows.some((row) => !(row.querySelector('input[name="sub-text"]')?.value || "").trim())) {
        alert("Renseigne le texte de chaque sous-consigne ou supprime celles qui sont vides.");
        return;
      }
      if (canManageChildren && subRows.length) {
        let missingSubChecklistItems = false;
        let hasEmptySubChecklistItem = false;
        subRows.forEach((row) => {
          const typeField = row.querySelector('select[name="sub-type"]');
          if (typeField?.value !== 'checklist') return;
          const itemInputs = Array.from(row.querySelectorAll('input[name="sub-checklist-item"]'));
          const items = itemInputs.map((input) => input.value.trim());
          const hasAtLeastOne = items.some((text) => text.length > 0);
          if (!hasAtLeastOne) {
            missingSubChecklistItems = true;
            return;
          }
          if (items.some((text) => text.length === 0)) {
            hasEmptySubChecklistItem = true;
          }
        });
        if (missingSubChecklistItems) {
          alert("Ajoute au moins un élément à chaque checklist de sous-consigne.");
          return;
        }
        if (hasEmptySubChecklistItem) {
          alert("Renseigne chaque élément de checklist de tes sous-consignes ou supprime ceux qui sont vides.");
          return;
        }
      }
      const historySnapshot = {
        mode,
        text: payload.text,
        type: payload.type,
        category: payload.category,
        priority: payload.priority,
        srEnabled: payload.srEnabled,
        days: Array.isArray(payload.days) ? [...payload.days] : payload.days,
        checklistItems: Array.isArray(payload.checklistItems) ? [...payload.checklistItems] : [],
        checklistItemIds: Array.isArray(payload.checklistItemIds) ? [...payload.checklistItemIds] : [],
        ephemeral: payload.ephemeral,
        ephemeralDurationDays: payload.ephemeralDurationDays,
        ephemeralDurationIterations: payload.ephemeralDurationIterations,
        parentId: payload.parentId || null,
        objectiveId: selectedObjective || null,
        weeklySummaryEnabled: payload.weeklySummaryEnabled,
        monthlySummaryEnabled: payload.monthlySummaryEnabled,
        yearlySummaryEnabled: payload.yearlySummaryEnabled,
        summaryOnlyScope: payload.summaryOnlyScope || null,
      };
      if (subRows.length) {
        historySnapshot.childrenCount = subRows.length;
      }
      const historyMetadata = {
        objectiveId: selectedObjective || null,
        hasChildren: subRows.length > 0,
        weeklySummaryEnabled: payload.weeklySummaryEnabled,
        monthlySummaryEnabled: payload.monthlySummaryEnabled,
        yearlySummaryEnabled: payload.yearlySummaryEnabled,
        summaryOnlyScope: payload.summaryOnlyScope || null,
      };
      let consigneId = consigne?.id || null;
      if (consigne) {
        await Schema.updateConsigne(ctx.db, ctx.user.uid, consigne.id, payload, {
          history: {
            kind: "update",
            source: "ui",
            payload: historySnapshot,
            metadata: historyMetadata,
            type: payload.type,
          },
        });
        consigneId = consigne.id;
      } else {
        const ref = await Schema.addConsigne(ctx.db, ctx.user.uid, payload);
        consigneId = ref?.id || consigneId;
        if (consigneId) {
          try {
            await Schema.logConsigneHistoryEntry(ctx.db, ctx.user.uid, consigneId, {
              kind: "create",
              source: "ui",
              payload: historySnapshot,
              metadata: historyMetadata,
              type: payload.type,
            });
          } catch (error) {
            console.warn("consigne.history:create", error);
          }
        }
      }
      if (consigneId) {
        await Schema.linkConsigneToObjective(ctx.db, ctx.user.uid, consigneId, selectedObjective || null);
        if (canManageChildren) {
          const childPayloadBase = {
            ownerUid: ctx.user.uid,
            mode,
            category: payload.category,
            priority: payload.priority,
            srEnabled: payload.srEnabled,
            weeklySummaryEnabled: payload.weeklySummaryEnabled,
            monthlySummaryEnabled: payload.monthlySummaryEnabled,
            yearlySummaryEnabled: payload.yearlySummaryEnabled,
            summaryOnlyScope: payload.summaryOnlyScope,
            ephemeral: payload.ephemeral,
            ephemeralDurationDays: payload.ephemeralDurationDays,
            ephemeralDurationIterations: payload.ephemeralDurationIterations,
            active: true,
            parentId: consigneId,
          };
          const childDays = mode === "daily" ? payload.days || [] : undefined;
      const updates = [];
      let invalidSubMontantGoal = false;
          if (subRows.length) {
            subRows.forEach((row, rowIndex) => {
              const textInput = row.querySelector('input[name="sub-text"]');
              const typeSelect = row.querySelector('select[name="sub-type"]');
              if (!textInput || !typeSelect) return;
              const textValue = textInput.value.trim();
              const typeValue = typeSelect.value;
              const childId = row.dataset.id || null;
              const childPayload = {
                ...childPayloadBase,
                text: textValue,
                type: typeValue,
                checklistItems: [],
                checklistItemIds: [],
                order: (rowIndex + 1) * 10,
              };
              childPayload.montantUnit = "";
              childPayload.montantGoal = null;
              childPayload.montantGoalOperator = null;
              if (mode === "daily") {
                childPayload.days = Array.isArray(childDays) ? [...childDays] : [];
              }
              if (typeValue === 'checklist') {
                const checklistRows = Array.from(row.querySelectorAll('[data-sub-checklist-row]'));
                childPayload.checklistItems = checklistRows.map((subRow) => {
                  const input = subRow.querySelector('input[name="sub-checklist-item"]');
                  return input ? input.value.trim() : '';
                });
                childPayload.checklistItemIds = checklistRows.map((subRow) => {
                  const hidden = subRow.querySelector('input[name="sub-checklist-item-id"]');
                  let idValue = hidden?.value && typeof hidden.value === 'string' ? hidden.value.trim() : '';
                  if (!idValue && hidden) {
                    idValue = generateClientChecklistItemId();
                    hidden.value = idValue;
                  }
                  if (!idValue) {
                    idValue = generateClientChecklistItemId();
                  }
                  subRow.dataset.subChecklistItemId = idValue;
                  return idValue;
                });
              } else if (typeValue === 'montant') {
                const unitField = row.querySelector('input[name="sub-montant-unit"]');
                const goalField = row.querySelector('input[name="sub-montant-goal"]');
                const operatorField = row.querySelector('select[name="sub-montant-operator"]');
                const unitVal = unitField?.value ? unitField.value.trim() : '';
                const goalRaw = goalField?.value ? goalField.value.trim() : '';
                let goalVal = null;
                if (goalRaw) {
                  const parsedGoal = Number(goalRaw.replace(/,/g, '.'));
                  if (!Number.isFinite(parsedGoal)) {
                    invalidSubMontantGoal = true;
                  } else {
                    goalVal = parsedGoal;
                  }
                }
                childPayload.montantUnit = unitVal;
                childPayload.montantGoal = goalVal;
                childPayload.montantGoalOperator = normalizeMontantOperator(operatorField?.value);
              }
              if (childId) {
                updates.push(
                  Schema.updateConsigne(ctx.db, ctx.user.uid, childId, childPayload).then(() =>
                    Schema.linkConsigneToObjective(ctx.db, ctx.user.uid, childId, selectedObjective || null)
                  )
                );
              } else {
                updates.push(
                  Schema.addConsigne(ctx.db, ctx.user.uid, childPayload).then((ref) => {
                    const newId = ref?.id;
                    if (newId) {
                      return Schema.linkConsigneToObjective(ctx.db, ctx.user.uid, newId, selectedObjective || null);
                    }
                    return null;
                  })
                );
              }
            });
          }
          if (invalidSubMontantGoal) {
            alert('Indique un objectif numérique valide pour chaque sous-consigne de type montant.');
            return;
          }
          removedChildIds.forEach((childId) => {
            updates.push(Schema.softDeleteConsigne(ctx.db, ctx.user.uid, childId));
          });
          if (updates.length) {
            await Promise.all(updates);
          }
        }
      }
      m.remove();
      const root = document.getElementById("view-root");
      if (mode === "practice") renderPractice(ctx, root);
      else renderDaily(ctx, root);
    } finally {
      modesLogger.groupEnd();
    }
  };
}

function extractTextualNote(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return "";
    if (NOTE_IGNORED_VALUES.has(trimmed)) return "";
    return trimmed;
  }
  if (typeof value === "object") {
    if (value.kind === "richtext") {
      const plain = typeof value.text === "string" ? value.text.trim() : "";
      if (plain) return plain;
      const fromHtml = richTextHtmlToPlainText(value.html || "");
      if (fromHtml) return fromHtml;
    }
    const candidates = ["note", "comment", "remark", "text", "message"];
    for (const key of candidates) {
      const candidate = value[key];
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (trimmed.length === 0) continue;
        if (NOTE_IGNORED_VALUES.has(trimmed)) continue;
        return trimmed;
      }
    }
  }
  return "";
}

function hasTextualNote(value) {
  return extractTextualNote(value).length > 0;
}

function dotColor(type, v, consigne){
  if (v && typeof v === "object" && v.skipped === true) {
    return "note";
  }
  if (type === "info") {
    return hasTextualNote(v) ? "note" : "na";
  }
  if (type === "montant") {
    const normalized = normalizeMontantValue(v, consigne);
    return normalized.status || "na";
  }
  if (type === "likert6") {
    const map = {
      yes: "ok-strong",
      rather_yes: "ok-soft",
      medium: "mid",
      rather_no: "ko-soft",
      no: "ko-strong",
      no_answer: "note",
    };
    return map[v] || "na";
  }
  if (type === "likert5") {
    const n = Number(v);
    if (!Number.isFinite(n)) return "na";
    if (n >= 5) return "ok-strong";
    if (n === 4) return "ok-soft";
    if (n === 3) return "mid";
    if (n === 2) return "ko-soft";
    if (n <= 1) return "ko-strong";
    return "na";
  }
  if (type === "yesno") {
    if (v === "yes") return "ok-strong";
    if (v === "no") return "ko-strong";
    return "na";
  }
  if (type === "num") {
    const n = Number(v);
    if (!Number.isFinite(n)) return "na";
    if (n >= 7) return "ok-strong";
    if (n >= 4) return "mid";
    return "ko-strong";
  }
  if (type === "checklist") {
    if (v == null) {
      return "na";
    }
    const stats = deriveChecklistStats(v);
    const pct = Number.isFinite(stats.percentage) ? stats.percentage : 0;
    if (pct >= 80) return "ok-strong";
    if (pct >= 60) return "ok-soft";
    if (pct >= 40) return "mid";
    if (pct >= 20) return "ko-soft";
    if (stats.total > 0 || stats.isEmpty) return "ko-strong";
    return "na";
  }
  if (type === "short" || type === "long") {
    return hasTextualNote(v) ? "note" : "na";
  }
  if (hasTextualNote(v)) {
    return "note";
  }
  return "na";
}

const STATUS_LABELS = {
  "ok-strong": "Très positif",
  "ok-soft": "Plutôt positif",
  mid: "Intermédiaire",
  "ko-soft": "Plutôt négatif",
  "ko-strong": "Très négatif",
  note: "Réponse notée",
  na: "Sans donnée",
};

const HISTORY_STATUS_BASE_COLORS = {
  "ok-strong": "#16a34a",
  "ok-soft": "#4ade80",
  mid: "#eab308",
  "ko-soft": "#f87171",
  "ko-strong": "#dc2626",
  note: "#3b82f6",
  na: "#94a3b8",
  default: "#2563eb",
};

function resolveHistoryStatusColors(status) {
  const base = HISTORY_STATUS_BASE_COLORS[status] || HISTORY_STATUS_BASE_COLORS.default;
  return {
    base,
    line: withAlpha(base, 0.95),
    circle: base,
    gradientTop: withAlpha(base, 0.35),
    gradientBottom: withAlpha(base, 0.05),
  };
}

function historyStatusFromAverage(type, values) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  const numericValues = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (!numericValues.length) {
    return null;
  }
  const average = numericValues.reduce((acc, value) => acc + value, 0) / numericValues.length;
  if (!Number.isFinite(average)) {
    return null;
  }
  if (type === "likert6") {
    if (average >= 3.5) return "ok-strong";
    if (average >= 2.5) return "ok-soft";
    if (average >= 1.5) return "mid";
    if (average >= 0.5) return "ko-soft";
    return "ko-strong";
  }
  if (type === "likert5") {
    if (average >= 4.5) return "ok-strong";
    if (average >= 3.5) return "ok-soft";
    if (average >= 2.5) return "mid";
    if (average >= 1.5) return "ko-soft";
    return "ko-strong";
  }
  if (type === "yesno") {
    if (average >= 0.85) return "ok-strong";
    if (average >= 0.6) return "ok-soft";
    if (average >= 0.4) return "mid";
    if (average >= 0.2) return "ko-soft";
    return "ko-strong";
  }
  if (type === "checklist") {
    const pct = average * 100;
    if (pct >= 80) return "ok-strong";
    if (pct >= 60) return "ok-soft";
    if (pct >= 40) return "mid";
    if (pct >= 20) return "ko-soft";
    return "ko-strong";
  }
  if (type === "num") {
    if (average >= 7) return "ok-strong";
    if (average >= 4) return "mid";
    return "ko-strong";
  }
  if (type === "montant") {
    if (!Number.isFinite(average)) return null;
    if (average >= 0.95) return "ok-strong";
    if (average >= 0.75) return "ok-soft";
    if (average >= 0.55) return "mid";
    if (average >= 0.35) return "ko-soft";
    return "ko-strong";
  }
  return null;
}

const CONSIGNE_HISTORY_TIMELINE_DAY_COUNT = 21;
const CONSIGNE_HISTORY_ROW_STATE = new WeakMap();
// Keep the last rendered points per consigne id to allow robust comparisons
// even when the DOM timeline is not yet hydrated or is off-screen (e.g., bilan pages).
const CONSIGNE_HISTORY_LAST_POINTS = new Map();
const CONSIGNE_HISTORY_SCROLL_MIN_STEP = 160;
const CONSIGNE_HISTORY_SCROLL_EPSILON = 6;
const CONSIGNE_HISTORY_DAY_LABEL_FORMATTER = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" });
const CONSIGNE_HISTORY_WEEKDAY_LABEL_FORMATTER = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
const CONSIGNE_HISTORY_DAY_FULL_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
});
const HISTORY_PANEL_FETCH_LIMIT = 120;
const DAILY_HISTORY_MODE_KEYS = new Set(["daily"]);

function formatChecklistLogPayload(payload) {
  if (payload === undefined) {
    return "";
  }
  try {
    return JSON.stringify(
      payload,
      (_, value) => {
        if (value instanceof Date) {
          return value.toISOString();
        }
        if (typeof value === "bigint") {
          return value.toString();
        }
        return value;
      },
    );
  } catch (error) {
    return String(error?.message || error);
  }
}

function logChecklistEvent(level, label, payload) {
  if (typeof console === "undefined") {
    return;
  }
  const logger = console[level] || console.log;
  try {
    if (payload === undefined) {
      logger(label);
    } else {
      logger(`${label} ${formatChecklistLogPayload(payload)}`);
    }
  } catch (_) {
    try {
      logger(label);
    } catch (_) {}
  }
}

function normalizeHistoryMode(row) {
  if (!row || typeof row !== "object") {
    return "";
  }
  const candidates = [row.mode, row.source, row.origin, row.context];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().toLowerCase();
    }
  }
  return "";
}

function parseHistoryResponseDate(value) {
  const parsed = asDate(value);
  return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function resolveHistoryResponseDayKey(row, createdAt) {
  try {
    const info = resolveHistoryEntrySummaryInfo(row);
    if (info && (info.isSummary || info.isBilan)) {
      const base = resolveHistoryTimelineKeyBase(row);
      if (base && typeof base.dayKey === "string" && base.dayKey.trim()) {
        return base.dayKey.trim();
      }
    }
  } catch (_) {}
  const rawDay =
    row?.dayKey ||
    row?.day_key ||
    row?.date ||
    row?.day ||
    (typeof row?.getDayKey === "function" ? row.getDayKey() : null);
  if (typeof rawDay === "string" && rawDay.trim()) {
    return rawDay.trim();
  }
  if (rawDay instanceof Date && !Number.isNaN(rawDay.getTime())) {
    return typeof Schema?.dayKeyFromDate === "function"
      ? Schema.dayKeyFromDate(rawDay)
      : rawDay.toISOString().slice(0, 10);
  }
  if (typeof rawDay === "number" && Number.isFinite(rawDay)) {
    const fromNumber = asDate(rawDay);
    if (fromNumber instanceof Date && !Number.isNaN(fromNumber.getTime())) {
      return typeof Schema?.dayKeyFromDate === "function"
        ? Schema.dayKeyFromDate(fromNumber)
        : fromNumber.toISOString().slice(0, 10);
    }
  }
  const fallbackDate = parseHistoryResponseDate(createdAt);
  if (fallbackDate instanceof Date && !Number.isNaN(fallbackDate.getTime())) {
    return typeof Schema?.dayKeyFromDate === "function"
      ? Schema.dayKeyFromDate(fallbackDate)
      : fallbackDate.toISOString().slice(0, 10);
  }
  return "";
}

function capitalizeHistoryLabel(value) {
  if (typeof value !== "string" || !value.length) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatHistoryDayLabel(date) {
  try {
    return CONSIGNE_HISTORY_DAY_LABEL_FORMATTER.format(date);
  } catch (_) {
    return "";
  }
}

function formatHistoryWeekdayLabel(date) {
  try {
    const raw = CONSIGNE_HISTORY_WEEKDAY_LABEL_FORMATTER.format(date);
    const cleaned = typeof raw === "string" ? raw.replace(/\.$/, "") : raw;
    return capitalizeHistoryLabel(cleaned);
  } catch (_) {
    return "";
  }
}

function formatHistoryDayFullLabel(date) {
  try {
    const raw = CONSIGNE_HISTORY_DAY_FULL_FORMATTER.format(date);
    return capitalizeHistoryLabel(raw);
  } catch (_) {
    return "";
  }
}

function buildHistoryTimelineLabels(date, fallbackKey) {
  // FORCE: Always use fallbackKey (dayKey) first, ignore date parameter completely
  if (fallbackKey) {
    const parsed = modesParseDayKeyToDate(fallbackKey);
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
      return {
        label: formatHistoryDayLabel(parsed),
        weekday: formatHistoryWeekdayLabel(parsed),
      };
    }
    if (typeof fallbackKey === "string") {
      const sessionMatch = fallbackKey.match(/session-(\d+)/i);
      if (sessionMatch) {
        const sessionNumber = Number.parseInt(sessionMatch[1], 10);
        if (Number.isFinite(sessionNumber) && sessionNumber > 0) {
          return { label: String(sessionNumber), weekday: "" };
        }
      }
    }
    return { label: fallbackKey, weekday: "" };
  }
  // Fallback to date only if no fallbackKey
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    return {
      label: formatHistoryDayLabel(date),
      weekday: formatHistoryWeekdayLabel(date),
    };
  }
  return { label: "", weekday: "" };
}

function buildHistoryTimelineTitle(date, fallbackKey, status) {
  const statusLabel = STATUS_LABELS[status] || STATUS_LABELS.na || "Statut";
  // FORCE: Always use fallbackKey (dayKey) first, ignore date parameter completely
  if (fallbackKey) {
    const parsed = modesParseDayKeyToDate(fallbackKey);
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
      const longLabel = formatHistoryDayFullLabel(parsed);
      if (longLabel) {
        return `${longLabel} — ${statusLabel}`;
      }
    }
    return `${fallbackKey} — ${statusLabel}`;
  }
  // Fallback to date only if no fallbackKey
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    const longLabel = formatHistoryDayFullLabel(date);
    if (longLabel) {
      return `${longLabel} — ${statusLabel}`;
    }
  }
  return statusLabel;
}

function parseHistoryTimelineDateInfo(value) {
  if (!value) return null;
  let raw = null;
  if (value instanceof Date) {
    raw = new Date(value.getTime());
  } else if (typeof value?.toDate === "function") {
    try {
      const viaToDate = value.toDate();
      if (viaToDate instanceof Date && !Number.isNaN(viaToDate.getTime())) {
        raw = new Date(viaToDate.getTime());
      }
    } catch (_) {
      raw = null;
    }
  }
  if (!raw && typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (/^\d{1,2}[\/-]\d{1,2}$/.test(trimmed)) {
      return null;
    }
    const dayFirstMatch = /^([0-9]{1,2})[\/-]([0-9]{1,2})[\/-]([0-9]{2,4})$/.exec(trimmed);
    if (dayFirstMatch) {
      const day = Number(dayFirstMatch[1]);
      const month = Number(dayFirstMatch[2]);
      const year = Number(dayFirstMatch[3].length === 2 ? `20${dayFirstMatch[3]}` : dayFirstMatch[3]);
      if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
        const candidate = new Date(year, (month || 1) - 1, day || 1);
        if (!Number.isNaN(candidate.getTime())) {
          raw = candidate;
        }
      }
    }
    if (!raw) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        raw = fallbackAsDate(numeric);
      }
    }
  }
  if (!raw) {
    const fallback = fallbackAsDate(value);
    if (fallback instanceof Date && !Number.isNaN(fallback.getTime())) {
      raw = new Date(fallback.getTime());
    }
  }
  if (!raw || Number.isNaN(raw.getTime())) {
    return null;
  }
  const normalized = new Date(raw.getTime());
  normalized.setHours(0, 0, 0, 0);
  return { date: normalized, timestamp: raw.getTime() };
}

function normalizeHistoryChecklistFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (["1", "true", "vrai", "oui", "yes", "ok", "done", "fait"].includes(normalized)) return true;
    if (["0", "false", "faux", "non", "no", "off"].includes(normalized)) return false;
    const numeric = Number(normalized);
    if (!Number.isNaN(numeric)) {
      return numeric !== 0;
    }
    return false;
  }
  return Boolean(value);
}

function parseHistoryJsonCandidate(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    return null;
  }
}

function coerceHistoryChecklistLabels(source) {
  if (!source) return null;
  if (Array.isArray(source)) {
    const labels = source
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item == null) return "";
        return String(item).trim();
      })
      .filter((item) => item);
    return labels.length ? labels : null;
  }
  if (typeof source === "string") {
    const parsed = parseHistoryJsonCandidate(source);
    if (parsed != null) {
      return coerceHistoryChecklistLabels(parsed);
    }
    return source.trim() ? [source.trim()] : null;
  }
  if (typeof source === "object") {
    if (Array.isArray(source.labels)) {
      return coerceHistoryChecklistLabels(source.labels);
    }
    if (Array.isArray(source.items)) {
      return coerceHistoryChecklistLabels(source.items);
    }
    if (Array.isArray(source.values)) {
      return coerceHistoryChecklistLabels(source.values);
    }
  }
  return null;
}

function coerceHistoryChecklistStructure(input) {
  if (input == null) return null;
  if (Array.isArray(input)) {
    return { items: input.map((item) => normalizeHistoryChecklistFlag(item)) };
  }
  if (typeof input === "string") {
    const parsed = parseHistoryJsonCandidate(input);
    if (parsed != null) {
      return coerceHistoryChecklistStructure(parsed);
    }
    return null;
  }
  if (typeof input === "object") {
    if (
      Array.isArray(input.items) ||
      Array.isArray(input.values) ||
      Array.isArray(input.checked) ||
      Array.isArray(input.answers)
    ) {
      const rawItems = input.items || input.values || input.checked || input.answers || [];
      const rawSkipped = Array.isArray(input.skipped)
        ? input.skipped
        : Array.isArray(input.skipStates)
        ? input.skipStates
        : null;
      const normalizedItems = rawItems.map((item) => normalizeHistoryChecklistFlag(item));
      const normalizedStates = normalizeChecklistStateArrays(
        { items: normalizedItems, skipped: Array.isArray(rawSkipped) ? rawSkipped : [] },
        normalizedItems.length || undefined,
      );
      const labels =
        coerceHistoryChecklistLabels(
          input.labels || input.itemsLabels || input.titles || input.checklistLabels || input.labelsList || null,
        ) || null;
      const structure = { items: normalizedStates.items };
      if (labels && labels.length) {
        structure.labels = labels;
      }
      if (Array.isArray(rawSkipped) && rawSkipped.some((value) => value === true)) {
        structure.skipped = normalizedStates.skipped;
      }
      return structure;
    }
    if (typeof input.value === "string" || Array.isArray(input.value) || typeof input.value === "object") {
      return coerceHistoryChecklistStructure(input.value);
    }
  }
  return null;
}

function resolveHistoryTimelineValue(entry, consigne) {
  if (!entry || typeof entry !== "object") return null;
  const candidateKeys = ["value", "v", "answer", "val", "score"];
  let value;
  for (const key of candidateKeys) {
    if (Object.prototype.hasOwnProperty.call(entry, key) && entry[key] !== undefined) {
      value = entry[key];
      break;
    }
  }
  if (value === undefined && entry.data && typeof entry.data === "object") {
    if (Object.prototype.hasOwnProperty.call(entry.data, "value")) {
      value = entry.data.value;
    }
  }
  if (consigne?.type === "checklist") {
    const structureCandidates = [];
    if (value !== undefined) structureCandidates.push(value);
    structureCandidates.push(entry.items, entry.values, entry.answers, entry.checked, entry.checklist);
    if (entry.data && typeof entry.data === "object") {
      structureCandidates.push(
        entry.data.items,
        entry.data.values,
        entry.data.answers,
        entry.data.checked,
        entry.data.checklist,
      );
    }
    for (const candidate of structureCandidates) {
      const structure = coerceHistoryChecklistStructure(candidate);
      if (structure) {
        if (!structure.labels || !structure.labels.length) {
          const labelCandidates = [entry.labels, entry.itemsLabels, entry.checklistLabels, entry.labelsList];
          for (const labelCandidate of labelCandidates) {
            const parsedLabels = coerceHistoryChecklistLabels(labelCandidate);
            if (parsedLabels && parsedLabels.length) {
              structure.labels = parsedLabels;
              break;
            }
          }
        }
        value = structure;
        break;
      }
    }
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      value = "";
    } else if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        value = JSON.parse(trimmed);
      } catch (_) {
        value = trimmed;
      }
    } else if (consigne?.type === "num" || consigne?.type === "likert5") {
      const num = Number(trimmed);
      if (Number.isFinite(num)) {
        value = num;
      }
    }
  }
  if (consigne?.type === "montant" && typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") {
        value = parsed;
      }
    } catch (_) {}
  }
  if (value === undefined || value === null || value === "") {
    const noteCandidates = ["note", "comment", "remark", "memo", "text", "message"];
    for (const candidate of noteCandidates) {
      const noteValue = entry[candidate];
      if (typeof noteValue === "string" && noteValue.trim()) {
        value = { note: noteValue };
        break;
      }
    }
  }
  return value;
}

function resolveHistoryTimelineNote(entry) {
  if (!entry || typeof entry !== "object") {
    return "";
  }
  const direct = extractTextualNote(entry);
  if (direct) {
    return direct;
  }
  if (entry.data && typeof entry.data === "object") {
    const nested = extractTextualNote(entry.data);
    if (nested) {
      return nested;
    }
  }
  const fallbackKeys = ["memo", "observation", "obs", "remarkText", "remark_text"];
  for (const key of fallbackKeys) {
    const raw = entry[key];
    if (typeof raw !== "string") {
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function formatConsigneHistoryPoint(record, consigne) {
  if (!record) {
    return null;
  }
  const dayKey = record.dayKey || null;
  const date = record.date instanceof Date && !Number.isNaN(record.date.getTime()) ? record.date : null;
  const status = record.status || "na";
  const iterationIndex = Number.isFinite(record.iterationIndex) ? record.iterationIndex : null;
  const iterationNumber = Number.isFinite(record.iterationNumber) ? record.iterationNumber : null;
  const rawIterationLabel =
    typeof record.iterationLabel === "string" && record.iterationLabel.trim()
      ? record.iterationLabel.trim()
      : "";
  const modeSource = typeof consigne?.mode === "string" ? consigne.mode : null;
  const normalizedMode = typeof modeSource === "string" ? modeSource.trim().toLowerCase() : "";
  const isPractice = normalizedMode === "practice" || iterationIndex !== null || /session-/i.test(dayKey || "");
  const isSummary = record?.isSummary === true;
  const summaryScope = typeof record?.summaryScope === "string" ? record.summaryScope : "";
  const baseTitle = buildHistoryTimelineTitle(date, dayKey, status);
  const statusLabel = STATUS_LABELS[status] || "";
  const title = rawIterationLabel
    ? statusLabel
      ? `${rawIterationLabel} — ${statusLabel}`
      : rawIterationLabel
    : baseTitle;
  const labels = buildHistoryTimelineLabels(date, dayKey);
  let labelText = labels.label;
  let weekdayText = labels.weekday;
  if (rawIterationLabel) {
    labelText = rawIterationLabel;
    weekdayText = "";
  }
  const fullDateLabel = (() => {
    if (date) {
      const formatted = formatHistoryDayFullLabel(date);
      if (rawIterationLabel && formatted && formatted !== rawIterationLabel) {
        return `${rawIterationLabel} — ${formatted}`;
      }
      return formatted || rawIterationLabel || labels.label || dayKey || "";
    }
    if (rawIterationLabel) {
      return rawIterationLabel;
    }
    return labels.label || dayKey || "";
  })();
  let valueHtml = "";
  let valueText = "";
  if (consigne) {
    const html = formatConsigneValue(consigne.type, record.value, { mode: "html", consigne });
    const text = formatConsigneValue(consigne.type, record.value, { consigne });
    if (typeof html === "string" && html !== "—") {
      valueHtml = html.trim();
    }
    if (typeof text === "string" && text !== "—") {
      valueText = text.trim();
    }
  }
  const noteSource = typeof record.note === "string" ? record.note : extractTextualNote(record.note);
  const note = typeof noteSource === "string" ? noteSource.trim() : "";
  const hasContent = Boolean(valueHtml || valueText || note);
  const isBilan = record?.isBilan === true;
  const historyId = typeof record?.historyId === "string" ? record.historyId : "";
  const responseId = typeof record?.responseId === "string" ? record.responseId : "";
  const srText = (() => {
    if (rawIterationLabel) {
      return rawIterationLabel;
    }
    if (fullDateLabel) {
      return fullDateLabel;
    }
    return title;
  })();
  return {
    dayKey,
    date,
    status,
    title,
    srLabel: srText || title,
    label: labelText,
    weekdayLabel: weekdayText,
    isPlaceholder: Boolean(record.isPlaceholder),
    isBilan,
    isSummary,
    summaryScope,
    historyId,
    responseId,
    details: {
      dayKey: dayKey || "",
      date,
      label: labelText || "",
      weekdayLabel: weekdayText || "",
      fullDateLabel: fullDateLabel || "",
      status,
      statusLabel: STATUS_LABELS[status] || "",
      valueHtml,
      valueText,
      note,
      hasContent,
      rawValue: record.value,
      iterationIndex: iterationIndex,
      iterationNumber: iterationNumber,
      iterationLabel: rawIterationLabel,
      isPractice,
      isBilan,
      isSummary,
      summaryScope,
      historyId,
      responseId,
      timestamp:
        typeof record.timestamp === "number"
          ? record.timestamp
          : date instanceof Date && !Number.isNaN(date.getTime())
          ? date.getTime()
          : null,
    },
  };
}

function openConsigneHistoryPointDialog(consigne, details) {
  if (!details) {
    return;
  }
  const consigneName =
    consigne?.text || consigne?.titre || consigne?.name || consigne?.label || consigne?.id || "Consigne";
  const fullDateLabel = details.fullDateLabel || "";
  const fallbackLabel = details.label || details.dayKey || "";
  const headerDate = fullDateLabel || fallbackLabel;
  const status = details.status || "na";
  const statusLabel = details.statusLabel || STATUS_LABELS[status] || "";
  const rawHtml = typeof details.valueHtml === "string" ? details.valueHtml.trim() : "";
  const rawText = typeof details.valueText === "string" ? details.valueText.trim() : "";
  const textMarkup = rawText ? escapeHtml(rawText).replace(/\n/g, "<br>") : "";
  const valueContent = rawHtml || textMarkup;
  const note = typeof details.note === "string" ? details.note.trim() : "";
  const hasValue = Boolean(valueContent);
  const hasNote = Boolean(note);
  const valueSection = hasValue
    ? `<section class="space-y-2" data-history-dialog-section><div class="history-dialog__value history-panel__value" data-status="${status}"><span class="history-panel__value-text">${valueContent}</span></div></section>`
    : "";
  const noteSection = hasNote
    ? `<section class="space-y-2" data-history-dialog-note><h3 class="text-sm font-semibold text-slate-600">Note</h3><p class="whitespace-pre-line text-[15px] text-slate-700">${escapeHtml(note)}</p></section>`
    : "";
  const emptySection = !hasValue && !hasNote
    ? '<p class="text-[15px] text-[var(--muted)]">Aucune réponse enregistrée pour ce jour.</p>'
    : "";
  const statusMarkup = statusLabel
    ? `<p class="flex items-center gap-2 text-sm text-slate-600"><span class="consigne-row__dot consigne-row__dot--${status}" aria-hidden="true"></span>${escapeHtml(statusLabel)}</p>`
    : "";
  const headerDateMarkup = headerDate
    ? `<p class="text-sm text-slate-500">${escapeHtml(headerDate)}</p>`
    : "";
  const dialogHtml = `
    <div class="space-y-5" data-history-dialog-root>
      <header class="space-y-1">
        ${headerDateMarkup}
        <h2 class="text-lg font-semibold">${escapeHtml(consigneName)}</h2>
        ${statusMarkup}
      </header>
      <div class="space-y-4" data-history-dialog-content>
        ${valueSection}
        ${noteSection}
        ${emptySection}
      </div>
      <div class="flex justify-end">
        <button type="button" class="btn" data-history-dialog-close>Fermer</button>
      </div>
    </div>
  `;
  const overlay = modal(dialogHtml);
  if (!overlay) {
    return;
  }
  const modalContent = overlay.querySelector("[data-modal-content]");
  if (modalContent) {
    modalContent.setAttribute("role", "dialog");
    modalContent.setAttribute("aria-modal", "true");
    const heading = modalContent.querySelector("h2");
    const content = modalContent.querySelector("[data-history-dialog-content]");
    const uniqueId = `consigne-history-dialog-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    if (heading && !heading.id) {
      heading.id = `${uniqueId}-title`;
    }
    if (heading?.id) {
      modalContent.setAttribute("aria-labelledby", heading.id);
    } else {
      modalContent.setAttribute("aria-label", escapeHtml(consigneName));
    }
    if (content && !content.id) {
      content.id = `${uniqueId}-content`;
    }
    if (content?.id) {
      modalContent.setAttribute("aria-describedby", content.id);
    } else {
      modalContent.removeAttribute("aria-describedby");
    }
  }
  const closeBtn = overlay.querySelector("[data-history-dialog-close]");
  const focusTarget = closeBtn || modalContent?.querySelector("button, [href], input, textarea, select, [tabindex]:not([tabindex='-1'])");
  try {
    focusTarget?.focus({ preventScroll: true });
  } catch (_) {
    focusTarget?.focus?.();
  }
  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      overlay.remove();
    }
  };
  document.addEventListener("keydown", handleKeyDown, true);
  const originalRemove = overlay.remove.bind(overlay);
  overlay.remove = () => {
    document.removeEventListener("keydown", handleKeyDown, true);
    originalRemove();
  };
  if (closeBtn) {
    closeBtn.addEventListener("click", () => overlay.remove());
  }
}

function isSummaryHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const summaryFlags = [entry.isSummary, entry.is_summary, entry.summary];
  if (summaryFlags.some((flag) => flag === true)) {
    return true;
  }
  const summaryScope = entry.summaryScope || entry.summary_scope || entry.summaryMode || entry.summary_mode;
  if (typeof summaryScope === "string" && summaryScope.trim()) {
    return true;
  }
  const source = entry.historySource || entry.history_source || entry.source || entry.origin;
  if (typeof source === "string") {
    const normalized = source.trim().toLowerCase();
    if (normalized.includes("summary") || normalized.includes("bilan")) {
      return true;
    }
  }
  return false;
}

function resolveHistoryEntrySummaryInfo(entry) {
  if (!entry || typeof entry !== "object") {
    return { isSummary: false, scope: "", isBilan: false };
  }
  const normalizedStrings = [];
  const pushString = (value) => {
    if (typeof value === "string" && value.trim()) {
      normalizedStrings.push(value.trim().toLowerCase());
    }
  };
  const directKeys = [
    "summaryScope",
    "summary_scope",
    "summaryKey",
    "summary_key",
    "summaryLabel",
    "summary_label",
    "summaryMode",
    "summary_mode",
    "summaryPeriod",
    "summary_period",
    "period",
    "periodLabel",
    "period_label",
    "periodKey",
    "period_key",
    "periodScope",
    "period_scope",
    "mode",
    "source",
    "origin",
    "context",
    "moduleId",
    "module_id",
  ];
  directKeys.forEach((key) => pushString(entry[key]));
  if (typeof entry.key === "string") {
    pushString(entry.key);
  }
  const nestedSummary = entry.summary && typeof entry.summary === "object" ? entry.summary : null;
  if (nestedSummary) {
    pushString(nestedSummary.scope);
    pushString(nestedSummary.type);
    pushString(nestedSummary.mode);
    pushString(nestedSummary.label);
  }
  const explicitBilanFlags = [
    entry.isBilan,
    entry.is_bilan,
    nestedSummary?.isBilan,
    nestedSummary?.is_bilan,
  ];
  const explicitBilan = explicitBilanFlags.some((flag) => flag === true);
  const explicitSummaryFlag =
    entry.isSummary === true ||
    entry.is_summary === true ||
    entry.summary === true ||
    nestedSummary?.isSummary === true ||
    nestedSummary?.summary === true;
  const hasSummaryField =
    directKeys.some((key) => Object.prototype.hasOwnProperty.call(entry, key)) ||
    Object.prototype.hasOwnProperty.call(entry, "summary") ||
    (nestedSummary && Object.keys(nestedSummary).length > 0);
  const hasBilanMarker = normalizedStrings.some((value) => {
    if (!value) return false;
    // Recognize bilan markers across various separators (space, dash, underscore, colon)
    if (/\bbilans?\b/.test(value)) return true;
    if (value.includes("bilan-") || value.includes("bilan_") || value.includes("bilan:")) return true;
    return false;
  });
  const hasSummaryKeyword = normalizedStrings.some((value) => value.includes("summary"));
  const hasWeeklyMarker = normalizedStrings.some((value) => {
    if (!value) return false;
    return (
      value.includes("hebdo") ||
      value.includes("weekly") ||
      value.includes("week") ||
      /\bsemaine\b/.test(value) ||
      /\bhebdomadaire\b/.test(value) ||
      /\b\d{4}-w\d{1,2}\b(?!-)/i.test(value)
    );
  });
  const hasMonthlyMarker = normalizedStrings.some((value) => {
    if (!value) return false;
    return (
      value.includes("mensu") ||
      value.includes("mensuel") ||
      value.includes("mensuelle") ||
      value.includes("mois") ||
      value.includes("monthly") ||
      value.includes("month") ||
      /\b\d{4}-(0[1-9]|1[0-2])\b(?!-)/.test(value)
    );
  });
  const hasYearlyMarker = normalizedStrings.some((value) => {
    if (!value) return false;
    return (
      value.includes("annuel") ||
      value.includes("annuelle") ||
      value.includes("annual") ||
      value.includes("année") ||
      value.includes("annee") ||
      value.includes("yearly")
    );
  });
  if (!hasSummaryField && !hasSummaryKeyword && !hasWeeklyMarker && !hasMonthlyMarker && !hasYearlyMarker) {
    return { isSummary: false, scope: "", isBilan: false };
  }
  let scope = "";
  if (hasMonthlyMarker) scope = "monthly";
  else if (hasWeeklyMarker) scope = "weekly";
  else if (hasYearlyMarker) scope = "yearly";
  const hasRecognizedBilanScope = scope === "weekly" || scope === "monthly" || scope === "yearly";
  const isBilan = explicitBilan || (hasBilanMarker && hasRecognizedBilanScope);
  return {
    isSummary: explicitSummaryFlag || hasSummaryKeyword || Boolean(scope) || explicitBilan,
    scope,
    isBilan,
  };
}

function resolveHistoryTimelineKeyBase(entry) {
  if (!entry || typeof entry !== "object") {
    return { dayKey: null, date: null, timestamp: null };
  }

  // Prefer explicit period/page dates for summary (bilan) entries so timeline
  // positions them on the intended day (e.g., end of week) instead of the
  // recording timestamp. This avoids Wednesday-vs-Sunday mismatches when the
  // bilan is filled in advance or later.
  try {
    const summaryInfo = resolveHistoryEntrySummaryInfo(entry);
    if (summaryInfo && summaryInfo.isSummary) {
      const extractKey = (obj, ...keys) => {
        for (const k of keys) {
          const v = obj && typeof obj === 'object' ? obj[k] : undefined;
          if (v !== undefined && v !== null && v !== "") return v;
        }
        return null;
      };
      const primaryKey = extractKey(
        entry,
        "dayKey",
        "day_key",
        "pageDateIso",
        "page_date_iso"
      );
      if (typeof primaryKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(primaryKey.trim())) {
        const dayKey = primaryKey.trim();
        const parsed = Schema?.toDate?.(dayKey) || new Date(dayKey);
        const date = parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
        return {
          dayKey,
          date,
          timestamp: date ? date.getTime() : null,
        };
      }
      const pageDate = extractKey(entry, "pageDate", "page_date");
      if (pageDate) {
        const parsed = Schema?.toDate?.(pageDate) || new Date(pageDate);
        if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
          const dayKey = typeof Schema?.dayKeyFromDate === 'function'
            ? Schema.dayKeyFromDate(parsed)
            : parsed.toISOString().slice(0, 10);
          return { dayKey, date: parsed, timestamp: parsed.getTime() };
        }
      }
      // As a last resort for summaries, prefer createdAt if present (we align it to period end upstream)
      const createdAt = extractKey(entry, "createdAt", "created_at");
      if (createdAt) {
        const parsed = Schema?.toDate?.(createdAt) || new Date(createdAt);
        if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
          const dayKey = typeof Schema?.dayKeyFromDate === 'function'
            ? Schema.dayKeyFromDate(parsed)
            : parsed.toISOString().slice(0, 10);
          return { dayKey, date: parsed, timestamp: parsed.getTime() };
        }
      }
    }
  } catch (e) {
    // Fallback to generic path
  }

  const keyCandidates = [];
  const dateCandidates = [];

  const addCandidate = (bucket, value, source) => {
    if (value === undefined || value === null) {
      return;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      bucket.push({ value: trimmed, source });
      return;
    }
    bucket.push({ value, source });
  };

  const addKeyCandidate = (value, source = "entry") => addCandidate(keyCandidates, value, source);
  const addDateCandidate = (value, source = "entry") => addCandidate(dateCandidates, value, source);

  [
    entry.dayKey,
    entry.day_key,
    entry.date,
    entry.dateKey,
    entry.date_key,
    entry.historyKey,
    entry.history_key,
    entry.pageDateIso,
    entry.page_date_iso,
    entry.periodKey,
    entry.period_key,
  ].forEach((value) => addKeyCandidate(value, "field"));

  [
    entry.id,
    entry.documentId,
    entry.document_id,
    entry.docId,
    entry.doc_id,
  ].forEach((value) => addKeyCandidate(value, "docId"));

  [
    entry.pageDate,
    entry.page_date,
    entry.createdAt,
    entry.created_at,
    entry.updatedAt,
    entry.updated_at,
    entry.recordedAt,
    entry.recorded_at,
    entry.sessionDate,
    entry.session_date,
    entry.sessionDayKey,
    entry.session_day_key,
    entry.iterationDate,
    entry.iteration_date,
    entry.timestamp,
    entry.eventAt,
    entry.event_at,
  ].forEach((value) => addDateCandidate(value, "field"));

  const nestedSources = [entry.payload, entry.metadata, entry.details, entry.context, entry.data];
  nestedSources.forEach((source) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return;
    }
    [
      source.dayKey,
      source.day_key,
      source.dateKey,
      source.date_key,
      source.dateIso,
      source.date_iso,
      source.date,
      source.historyDay,
      source.history_day,
      source.periodKey,
      source.period_key,
      source.pageDateIso,
      source.page_date_iso,
    ].forEach((value) => addKeyCandidate(value, "nested"));

    [
      source.pageDate,
      source.page_date,
      source.createdAt,
      source.created_at,
      source.updatedAt,
      source.updated_at,
      source.recordedAt,
      source.recorded_at,
      source.timestamp,
      source.eventAt,
      source.event_at,
    ].forEach((value) => addDateCandidate(value, "nested"));
  });

  const consider = (acc, candidate, weightBase) => {
    const info = parseHistoryTimelineDateInfo(candidate.value);
    if (!info || !(info.date instanceof Date) || Number.isNaN(info.date.getTime())) {
      return acc;
    }
    const derivedDayKey = typeof Schema?.dayKeyFromDate === "function"
      ? Schema.dayKeyFromDate(info.date)
      : info.date.toISOString().slice(0, 10);
    if (!derivedDayKey) {
      return acc;
    }
    const timestamp = typeof info.timestamp === "number" ? info.timestamp : info.date.getTime();
    let weight = weightBase;
    if (typeof candidate.value === "string") {
      if (/^\d{4}-\d{2}-\d{2}/.test(candidate.value)) {
        weight += 2;
      } else if (/^session-/i.test(candidate.value)) {
        weight += 1;
      } else if (/^\d{1,2}[\/\-]\d{1,2}$/.test(candidate.value)) {
        weight -= 3;
      }
    }
    if (timestamp && timestamp > Date.UTC(2005, 0, 1)) {
      weight += 1;
    }
    acc.push({
      dayKey: derivedDayKey,
      date: info.date,
      timestamp,
      weight,
    });
    return acc;
  };

  // Prefer explicit keys (dayKey/dateKey/docId) over recording timestamps.
  // We only fall back to dates when no usable key is present.
  const scoredKeyCandidates = [];
  const seen = new Set();
  keyCandidates.forEach((candidate) => {
    const marker = typeof candidate.value === "string" ? `key:${candidate.value}` : candidate.value;
    if (seen.has(marker)) {
      return;
    }
    seen.add(marker);
    consider(scoredKeyCandidates, candidate, candidate.source === "docId" ? 10 : candidate.source === "nested" ? 9 : 8);
  });

  const scoredDateCandidates = [];
  const seenDates = new Set();
  dateCandidates.forEach((candidate) => {
    const marker = typeof candidate.value === "string" ? `date:${candidate.value}` : candidate.value;
    if (seenDates.has(marker)) {
      return;
    }
    seenDates.add(marker);
    consider(scoredDateCandidates, candidate, candidate.source === "nested" ? 3 : 2);
  });

  const scoredCandidates = scoredKeyCandidates.length ? scoredKeyCandidates : scoredDateCandidates;
  if (scoredCandidates.length) {
    scoredCandidates.sort((a, b) => {
      if (b.weight !== a.weight) {
        return b.weight - a.weight;
      }
      const at = typeof a.timestamp === "number" ? a.timestamp : -Infinity;
      const bt = typeof b.timestamp === "number" ? b.timestamp : -Infinity;
      if (bt !== at) {
        return bt - at;
      }
      return b.dayKey.localeCompare(a.dayKey);
    });
    const best = scoredCandidates[0];
    return {
      dayKey: best.dayKey,
      date: best.date,
      timestamp: typeof best.timestamp === "number" ? best.timestamp : best.date.getTime(),
    };
  }

  return { dayKey: null, date: null, timestamp: null };
}

function parseFiniteNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function practiceIterationIndexFromKey(key) {
  if (typeof key !== "string") {
    return null;
  }
  const match = key.match(/session-(\d+)/i);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, parsed - 1);
}

function extractPracticeIterationIndex(entry, dayKey) {
  const indexCandidates = [
    parseFiniteNumber(entry?.iterationIndex ?? entry?.iteration_index),
    parseFiniteNumber(entry?.sessionIndex ?? entry?.session_index),
  ];
  for (const candidate of indexCandidates) {
    if (candidate !== null) {
      return candidate;
    }
  }
  const numberCandidates = [
    parseFiniteNumber(entry?.iterationNumber ?? entry?.iteration_number),
    parseFiniteNumber(entry?.sessionNumber ?? entry?.session_number),
  ];
  for (const candidate of numberCandidates) {
    if (candidate !== null) {
      return Math.max(0, candidate - 1);
    }
  }
  const fromKey = practiceIterationIndexFromKey(dayKey);
  if (fromKey !== null) {
    return fromKey;
  }
  return null;
}

function sanitizeIterationLabel(label, iterationNumber) {
  if (typeof label !== "string") {
    return "";
  }
  const trimmed = label.trim();
  if (!trimmed) {
    return "";
  }
  if (iterationNumber == null) {
    return trimmed;
  }
  let normalized = trimmed;
  if (typeof normalized.normalize === "function") {
    normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  normalized = normalized.replace(/[^0-9a-zA-Z°\s]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const numberPattern = String(iterationNumber);
  const defaultPattern = new RegExp(`^iteration(?:\s+n[°o])?\s+0*${numberPattern}$`);
  if (defaultPattern.test(normalized)) {
    return "";
  }
  return trimmed;
}

function resolveHistoryTimelineKey(entry, consigne) {
  const base = resolveHistoryTimelineKeyBase(entry);
  const modeSource = typeof consigne?.mode === "string" ? consigne.mode : entry?.mode;
  const normalizedMode = typeof modeSource === "string" ? modeSource.trim().toLowerCase() : "";
  if (normalizedMode === "practice") {
    const initialDayKey = base.dayKey;
    const sessionKeyCandidates = [
      entry?.sessionId,
      entry?.session_id,
      entry?.historyKey,
      entry?.history_key,
      entry?.id,
      entry?.date,
      entry?.dateKey,
      entry?.date_key,
    ];
    let sessionKey = "";
    for (const candidate of sessionKeyCandidates) {
      if (typeof candidate !== "string") {
        continue;
      }
      const trimmed = candidate.trim();
      if (!trimmed) {
        continue;
      }
      if (/session-/i.test(trimmed)) {
        sessionKey = trimmed;
        break;
      }
    }
    let fallbackKey =
      initialDayKey ||
      entry?.historyKey ||
      entry?.history_key ||
      entry?.sessionId ||
      entry?.session_id ||
      entry?.date ||
      entry?.dateKey ||
      entry?.date_key ||
      null;
    // Ignore ambiguous day/month strings like "01/01" that lack a year
    if (typeof fallbackKey === "string" && /^\d{1,2}[\/\-]\d{1,2}$/.test(fallbackKey.trim())) {
      fallbackKey = null;
    }
    if (sessionKey) {
      base.dayKey = sessionKey;
    } else if (!base.dayKey && fallbackKey) {
      base.dayKey = String(fallbackKey);
    }
    const iterationSourceKey = sessionKey || base.dayKey || fallbackKey;
    const iterationIndex = extractPracticeIterationIndex(entry, iterationSourceKey);
    if (iterationIndex !== null) {
      base.iterationIndex = iterationIndex;
      base.iterationNumber = iterationIndex + 1;
      if (base.timestamp === null || base.timestamp === undefined) {
        base.timestamp = iterationIndex;
      }
    } else {
      base.iterationIndex = null;
      base.iterationNumber = null;
    }
    if (base.timestamp === null || base.timestamp === undefined) {
      if (base.date instanceof Date && !Number.isNaN(base.date.getTime())) {
        base.timestamp = base.date.getTime();
      }
    }
    const labelCandidates = [
      entry?.iterationLabel,
      entry?.iteration_label,
      entry?.sessionLabel,
      entry?.session_label,
    ];
    let resolvedLabel = "";
    for (const candidate of labelCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        resolvedLabel = candidate.trim();
        break;
      }
    }
    const sanitizedLabel = sanitizeIterationLabel(resolvedLabel, base.iterationNumber);
    base.iterationLabel = sanitizedLabel;

    // Debug: trace final key selection for practice timeline
    try {
      modesLogger?.debug?.("timeline.key.resolve.practice", {
        consigneId: consigne?.id ?? null,
        entryId: entry?.id || null,
        initialDayKey: initialDayKey || null,
        sessionKey: sessionKey || null,
        fallbackKey: fallbackKey || null,
        resolvedDayKey: base.dayKey || null,
        createdAt: entry?.createdAt || entry?.updatedAt || null,
        iterationIndex: base.iterationIndex ?? null,
        iterationNumber: base.iterationNumber ?? null,
        iterationLabel: base.iterationLabel || "",
      });
    } catch (_) {}
  } else {
    base.iterationIndex = null;
    base.iterationNumber = null;
    base.iterationLabel = "";
  }
  return base;
}

function buildConsigneHistoryTimeline(entries, consigne) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const records = [];
  if (Array.isArray(entries)) {
    entries.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const summaryInfo = resolveHistoryEntrySummaryInfo(entry);
      const keyInfo = resolveHistoryTimelineKey(entry, consigne);
      const { dayKey, date, timestamp, iterationIndex, iterationNumber, iterationLabel } = keyInfo || {};
      if (!dayKey) {
        return;
      }
      let effectiveDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
      if (!effectiveDate) {
        const parsed = modesParseDayKeyToDate(dayKey);
        if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
          effectiveDate = parsed;
        }
      }
      const value = resolveHistoryTimelineValue(entry, consigne);
      const note = resolveHistoryTimelineNote(entry);
      const isBilanEntry = Boolean(summaryInfo?.isBilan);
      const status = dotColor(consigne?.type, value, consigne) || "na";
      const effectiveTimestamp =
        typeof timestamp === "number"
          ? timestamp
          : effectiveDate instanceof Date && !Number.isNaN(effectiveDate.getTime())
          ? effectiveDate.getTime()
          : typeof iterationIndex === "number"
          ? iterationIndex
          : today.getTime();
      const historyId = resolveHistoryDocumentId(entry, dayKey);
      const responseId = resolveHistoryResponseId(entry);
      records.push({
        dayKey,
        date: effectiveDate,
        status,
        value,
        note,
        isBilan: isBilanEntry,
        isSummary: Boolean(summaryInfo?.isSummary),
        summaryScope: typeof summaryInfo?.scope === "string" ? summaryInfo.scope : "",
        timestamp: effectiveTimestamp,
        iterationIndex: typeof iterationIndex === "number" ? iterationIndex : null,
        iterationNumber: typeof iterationNumber === "number" ? iterationNumber : null,
        iterationLabel: typeof iterationLabel === "string" ? iterationLabel : "",
        historyId: typeof historyId === "string" ? historyId : "",
        responseId: typeof responseId === "string" ? responseId : "",
      });
    });
  }
  records.sort((a, b) => {
    if (typeof b.timestamp === "number" && typeof a.timestamp === "number" && b.timestamp !== a.timestamp) {
      return b.timestamp - a.timestamp;
    }
    return (b.date?.getTime?.() || 0) - (a.date?.getTime?.() || 0);
  });
  const limited = records.slice(0, CONSIGNE_HISTORY_TIMELINE_DAY_COUNT);
  const result = limited
    .map((record) =>
      formatConsigneHistoryPoint(
        {
          dayKey: record.dayKey,
          date: record.date,
          status: record.status,
          value: record.value,
          note: record.note,
          timestamp: record.timestamp,
          isPlaceholder: false,
          isBilan: record.isBilan === true,
          isSummary: record.isSummary === true,
          summaryScope: typeof record.summaryScope === "string" ? record.summaryScope : "",
          iterationIndex: record.iterationIndex,
          iterationNumber: record.iterationNumber,
          iterationLabel: record.iterationLabel,
          historyId: record.historyId,
          responseId: record.responseId,
        },
        consigne,
      ),
    )
    .filter(Boolean);
  
  return result;
}

function escapeTimelineSelector(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/"/g, '\\"');
}

function ensureConsigneHistoryDot(item) {
  if (!item) return null;
  let dot = item.querySelector(".consigne-history__dot");
  if (!dot) {
    dot = document.createElement("span");
    dot.className = "consigne-history__dot consigne-row__dot";
    item.insertBefore(dot, item.firstChild || null);
  }
  return dot;
}

function ensureConsigneHistorySr(item) {
  if (!item) return null;
  let sr = item.querySelector(".sr-only");
  if (!sr) {
    sr = document.createElement("span");
    sr.className = "sr-only";
    item.appendChild(sr);
  }
  return sr;
}

function ensureConsigneHistoryMeta(item) {
  if (!item) return null;
  const sr = ensureConsigneHistorySr(item);
  let meta = item.querySelector(".consigne-history__meta");
  if (!meta) {
    meta = document.createElement("span");
    meta.className = "consigne-history__meta";
    if (sr && sr.parentNode === item) {
      item.insertBefore(meta, sr);
    } else {
      item.appendChild(meta);
    }
  }
  return meta;
}

function ensureConsigneHistoryLabel(meta) {
  if (!meta) return null;
  let label = meta.querySelector(".consigne-history__label");
  if (!label) {
    label = document.createElement("span");
    label.className = "consigne-history__label";
    meta.appendChild(label);
  }
  return label;
}

function ensureConsigneHistoryWeekday(meta) {
  if (!meta) return null;
  let weekday = meta.querySelector(".consigne-history__weekday");
  if (!weekday) {
    weekday = document.createElement("span");
    weekday.className = "consigne-history__weekday";
    meta.appendChild(weekday);
  }
  return weekday;
}

function applyConsigneHistoryPoint(item, point) {
  if (!item || !point) {
    return;
  }
  try {
    modesLogger?.debug?.("timeline.apply", {
      incomingDayKey: point?.dayKey || null,
      incomingLabel: point?.label || "",
      incomingWeekday: point?.weekdayLabel || "",
      status: point?.status || "",
    });
  } catch (_) {}
  if (point.dayKey) {
    item.dataset.historyDay = point.dayKey;
  } else {
    delete item.dataset.historyDay;
  }
  // Remove dateIso dataset - we only use historyDay (page date)
  delete item.dataset.dateIso;
  const status = point.status || "na";
  item.dataset.status = status;
  item.dataset.placeholder = point.isPlaceholder ? "1" : "0";
  item.tabIndex = 0;
  const dot = ensureConsigneHistoryDot(item);
  if (dot) {
    dot.className = `consigne-history__dot consigne-row__dot consigne-row__dot--${status}`;
    dot.textContent = "";
    dot.setAttribute("aria-hidden", "true");
  }
  const sr = ensureConsigneHistorySr(item);
  const srText = point.srLabel || point.title || STATUS_LABELS[status] || status;
  if (sr) {
    sr.textContent = srText;
  }
  const meta = ensureConsigneHistoryMeta(item);
  if (meta) {
    const labelEl = ensureConsigneHistoryLabel(meta);
    const weekdayEl = ensureConsigneHistoryWeekday(meta);
    if (labelEl) {
      labelEl.textContent = point.label || "";
      labelEl.hidden = !point.label;
    }
    if (weekdayEl) {
      weekdayEl.textContent = point.weekdayLabel || "";
      weekdayEl.hidden = !point.weekdayLabel;
    }
    meta.hidden = !point.label && !point.weekdayLabel;

    // HAMMER: Override visible labels from the page dayKey so pills always reflect the page date
    try {
      const dayKey = (point.dayKey && String(point.dayKey)) || (item.dataset && item.dataset.historyDay) || "";
      if (dayKey) {
        let newLabel = "";
        let newWeekday = "";
        let useIteration = false;
        // Preserve explicit iteration/session labels when present
        if (point?.details?.isPractice === true || (typeof point?.label === "string" && point.label.trim() && /session-/i.test(dayKey))) {
          useIteration = true;
        }
        if (!useIteration) {
          const sessionMatch = /session-(\d+)/i.exec(dayKey);
          if (sessionMatch) {
            const n = Number.parseInt(sessionMatch[1], 10);
            if (Number.isFinite(n) && n > 0) {
              newLabel = String(n);
              newWeekday = "";
            }
          } else {
            const parsed = modesParseDayKeyToDate(dayKey);
            if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
              newLabel = formatHistoryDayLabel(parsed);
              newWeekday = formatHistoryWeekdayLabel(parsed);
              // Also normalize the title/sr from the page date for consistency
              const long = formatHistoryDayFullLabel(parsed);
              const statusLabel = STATUS_LABELS[status] || status;
              const computedTitle = long ? `${long} — ${statusLabel}` : statusLabel;
              if (computedTitle) {
                item.title = computedTitle;
                if (sr) sr.textContent = computedTitle;
              }
            }
          }
        }
        if (labelEl && newLabel) {
          labelEl.textContent = newLabel;
          labelEl.hidden = false;
        }
        if (weekdayEl) {
          weekdayEl.textContent = newWeekday || "";
          weekdayEl.hidden = !newWeekday;
        }
        meta.hidden = !(labelEl && labelEl.textContent) && !(weekdayEl && weekdayEl.textContent);
        try {
          modesLogger?.debug?.("timeline.hard-render", {
            dayKey,
            pointLabel: point.label || "",
            appliedLabel: labelEl?.textContent || "",
            appliedWeekday: weekdayEl?.textContent || "",
            status,
          });
        } catch (_) {}
      }
    } catch (_) {}
  }
  if (point.isBilan) {
    item.dataset.historySource = "bilan";
    if (dot) {
      dot.className = "consigne-history__dot consigne-history__dot--bilan";
      dot.textContent = "★";
    }
  } else if (point.isSummary) {
    item.dataset.historySource = "summary";
    if (dot) {
      dot.textContent = "";
    }
  } else {
    if (item.dataset) {
      delete item.dataset.historySource;
    }
    if (dot) {
      dot.textContent = "";
    }
  }
  const details = point.details || null;
  if (details) {
    const detailCopy = { ...details };
    if (!detailCopy.historyId && point.historyId) {
      detailCopy.historyId = point.historyId;
    }
    if (!detailCopy.responseId && point.responseId) {
      detailCopy.responseId = point.responseId;
    }
    item._historyDetails = detailCopy;
    item.dataset.historyHasDetails = details.hasContent ? "1" : "0";
    item.setAttribute("aria-haspopup", "dialog");
  } else {
    delete item._historyDetails;
    item.dataset.historyHasDetails = "0";
    item.setAttribute("aria-haspopup", "dialog");
  }
  if (point.historyId) {
    item.dataset.historyId = point.historyId;
  } else {
    delete item.dataset.historyId;
  }
  if (point.responseId) {
    item.dataset.historyResponseId = point.responseId;
  } else {
    delete item.dataset.historyResponseId;
  }
  if (point.title) {
    // Avoid clobbering a title we just computed from dayKey in the hard-render section above
    if (!item.title) {
      item.title = point.title;
    }
  } else {
    item.removeAttribute("title");
  }
  const ariaParts = [];
  const fullLabel = item.title || details?.fullDateLabel || point.title || "";
  if (fullLabel) {
    ariaParts.push(fullLabel);
  }
  const statusLabel = details?.statusLabel || STATUS_LABELS[status] || "";
  if (statusLabel) {
    ariaParts.push(statusLabel);
  }
  if (ariaParts.length) {
    item.setAttribute("aria-label", ariaParts.join(" — "));
  } else {
    item.removeAttribute("aria-label");
  }
}

function computeConsigneHistoryScrollStep(viewport) {
  if (!viewport) {
    return CONSIGNE_HISTORY_SCROLL_MIN_STEP;
  }
  const width = viewport.clientWidth || 0;
  if (width <= 0) {
    return CONSIGNE_HISTORY_SCROLL_MIN_STEP;
  }
  const ratioStep = Math.round(width * 0.8);
  return Math.max(CONSIGNE_HISTORY_SCROLL_MIN_STEP, ratioStep);
}

function updateConsigneHistoryNavState(state) {
  if (!state) {
    return;
  }
  const { viewport, navPrev, navNext, container } = state;
  if (!viewport || (!navPrev && !navNext)) {
    return;
  }
  const containerHidden = container?.hidden === true;
  const scrollWidth = viewport.scrollWidth || 0;
  const clientWidth = viewport.clientWidth || 0;
  const widthDelta = Math.round(scrollWidth) - Math.round(clientWidth);
  const maxScrollRaw = Math.max(0, scrollWidth - clientWidth);
  const maxScroll = Math.max(0, Math.round(maxScrollRaw));
  const normalizedScrollLeft = Math.round(viewport.scrollLeft || 0);
  const hasOverflow = !containerHidden && widthDelta > CONSIGNE_HISTORY_SCROLL_EPSILON;
  const atStart = normalizedScrollLeft <= CONSIGNE_HISTORY_SCROLL_EPSILON;
  const atEnd = normalizedScrollLeft >= maxScroll - CONSIGNE_HISTORY_SCROLL_EPSILON;
  if (navPrev) {
    const showPrev = hasOverflow && !atStart;
    navPrev.hidden = !showPrev;
    navPrev.disabled = !showPrev;
  }
  if (navNext) {
    const showNext = hasOverflow && !atEnd;
    navNext.hidden = !showNext;
    navNext.disabled = !showNext;
  }
}

function setupConsigneHistoryNavigation(state) {
  if (!state) {
    return;
  }
  const { viewport, navPrev, navNext } = state;
  state.updateNavState = () => updateConsigneHistoryNavState(state);
  if (!viewport) {
    return;
  }
  const handleScroll = () => state.updateNavState();
  viewport.addEventListener("scroll", handleScroll, { passive: true });
  state.viewportScrollHandler = handleScroll;
  if (navPrev) {
    navPrev.addEventListener("click", (event) => {
      event.preventDefault();
      const step = computeConsigneHistoryScrollStep(viewport);
      try {
        viewport.scrollBy({ left: -step, behavior: "smooth" });
      } catch (_) {
        viewport.scrollLeft = Math.max(0, viewport.scrollLeft - step);
      }
      state.updateNavState();
    });
  }
  if (navNext) {
    navNext.addEventListener("click", (event) => {
      event.preventDefault();
      const step = computeConsigneHistoryScrollStep(viewport);
      try {
        viewport.scrollBy({ left: step, behavior: "smooth" });
      } catch (_) {
        const maxScroll = Math.max(0, (viewport.scrollWidth || 0) - (viewport.clientWidth || 0));
        viewport.scrollLeft = Math.min(viewport.scrollLeft + step, maxScroll);
      }
      state.updateNavState();
    });
  }
  if (typeof ResizeObserver === "function") {
    try {
      const resizeObserver = new ResizeObserver(() => state.updateNavState());
      resizeObserver.observe(viewport);
      if (state.track) {
        resizeObserver.observe(state.track);
      }
      state.resizeObserver = resizeObserver;
    } catch (_) {}
  }
  state.updateNavState();
}

function scheduleConsigneHistoryNavUpdate(state) {
  if (!state?.updateNavState) {
    return;
  }
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(state.updateNavState);
  } else {
    setTimeout(state.updateNavState, 0);
  }
}

const BILAN_HISTORY_DAY_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
});

function capitalizeFirstLetter(value) {
  if (typeof value !== "string" || !value.length) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatBilanHistoryDateLabel(date, fallback) {
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    return capitalizeFirstLetter(BILAN_HISTORY_DAY_FORMATTER.format(date));
  }
  return fallback || "";
}

function computeRelativeHistoryLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const base = new Date(date.getTime());
  base.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - base.getTime()) / 86400000);
  if (diffDays === 0) return "Aujourd’hui";
  if (diffDays === 1) return "Hier";
  if (diffDays > 1 && diffDays < 7) return `Il y a ${diffDays} j`;
  if (diffDays < 0) {
    const future = Math.abs(diffDays);
    if (future === 1) return "Demain";
    if (future < 7) return `Dans ${future} j`;
  }
  return "";
}

function normalizeHistoryDayKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function resolveHistoryDocumentId(entry, fallback) {
  if (entry && typeof entry === "object") {
    const candidates = [
      entry.id,
      entry.historyId,
      entry.history_id,
      entry.documentId,
      entry.document_id,
      entry.docId,
      entry.doc_id,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }
  }
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }
  return "";
}

function resolveHistoryResponseId(entry, fallback = "") {
  if (entry && typeof entry === "object") {
    const candidates = [
      entry.responseId,
      entry.response_id,
      entry.responseDocId,
      entry.response_doc_id,
      entry.responseRef,
      entry.response_ref,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }
    if (entry.metadata && typeof entry.metadata === "object") {
      const metaResolved = resolveHistoryResponseId(entry.metadata);
      if (metaResolved) {
        return metaResolved;
      }
    }
  }
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }
  return "";
}

function findHistoryEntryForDayKey(entries, consigne, dayKey, options = {}) {
  if (!Array.isArray(entries) || !dayKey) {
    return null;
  }
  const normalizedTarget = normalizeHistoryDayKey(dayKey);
  const responseTarget =
    typeof options.responseId === "string" && options.responseId.trim() ? options.responseId.trim() : "";
  const historyTarget =
    typeof options.historyId === "string" && options.historyId.trim() ? options.historyId.trim() : "";
  const debugLabel = typeof options.debug === "string" ? options.debug : "";
  const expectedSummary =
    consigne?.type === "checklist" && options.expectedSummary && typeof options.expectedSummary === "object"
      ? options.expectedSummary
      : null;

  const scoredMatches = [];

  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const keyInfo = resolveHistoryTimelineKey(entry, consigne);
    const candidateKey = normalizeHistoryDayKey(keyInfo?.dayKey);
    const resolvedHistoryId = resolveHistoryDocumentId(entry, keyInfo?.dayKey || dayKey || candidateKey || "");
    const resolvedResponseId = resolveHistoryResponseId(entry);
    const checklistSummary =
      consigne?.type === "checklist" ? summarizeChecklistValue(entry?.value) : null;
    const timestamp =
      typeof keyInfo?.timestamp === "number"
        ? keyInfo.timestamp
        : keyInfo?.date instanceof Date && !Number.isNaN(keyInfo.date.getTime())
        ? keyInfo.date.getTime()
        : Date.now();

    const historyMatch = historyTarget && resolvedHistoryId && resolvedHistoryId === historyTarget;
    const responseMatch = responseTarget && resolvedResponseId && resolvedResponseId === responseTarget;
    const dayMatch = normalizedTarget && candidateKey && candidateKey === normalizedTarget;

    // Skip obvious non-matches when neither ids nor day align.
    if (!historyMatch && !responseMatch && !dayMatch) {
      return;
    }

    let weight = 0;
    if (historyMatch) weight += 1000;
    if (responseMatch) weight += 200;
    if (dayMatch) weight += 50;
    let summaryDiff = [];
    if (expectedSummary) {
      if (checklistSummary) {
        summaryDiff = diffChecklistSummaries(expectedSummary, checklistSummary);
        if (summaryDiff.length === 0) {
          weight += 400;
        } else {
          weight -= summaryDiff.length * 40;
        }
      } else {
        weight -= 120;
      }
    }
    if (keyInfo?.isSummary) weight -= 10;
    if (typeof entry?.source === "string" && entry.source.includes("summary")) {
      weight -= 5;
    }

    scoredMatches.push({
      entry,
      keyInfo,
      timestamp,
      historyId: resolvedHistoryId || "",
      responseId: resolvedResponseId || "",
      weight,
      matchType: historyMatch ? "history" : responseMatch ? "response" : "day",
      summaryDiff,
      checklistSummary,
    });
  });

  if (!scoredMatches.length) {
    return null;
  }

  scoredMatches.sort((a, b) => {
    if (b.weight !== a.weight) {
      return b.weight - a.weight;
    }
    if (b.timestamp !== a.timestamp) {
      return b.timestamp - a.timestamp;
    }
    if (b.historyId !== a.historyId) {
      return (b.historyId || "").localeCompare(a.historyId || "");
    }
    return (b.responseId || "").localeCompare(a.responseId || "");
  });

  const best = scoredMatches[0];
  if (debugLabel && typeof console !== "undefined" && console?.debug) {
    try {
      console.debug(`[history-match] ${debugLabel}`, {
        dayKey,
        responseTarget,
        historyTarget,
        normalizedTarget,
        best: {
          historyId: best.historyId,
          responseId: best.responseId,
          matchType: best.matchType,
          weight: best.weight,
          summaryDiff: best.summaryDiff || [],
        },
      });
  } catch (_) {}
  }
  return best;
}

function resolveHistoryMode(entry) {
  if (!entry || typeof entry !== "object") {
    return "";
  }
  const candidates = [entry.mode, entry.source, entry.origin, entry.context];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function safeConsigneLabel(consigne) {
  return (
    consigne?.text ||
    consigne?.titre ||
    consigne?.name ||
    consigne?.label ||
    consigne?.id ||
    "Consigne"
  ).toString();
}

async function openBilanHistoryEditor(row, consigne, ctx, options = {}) {
  const dayKey = typeof options.dayKey === "string" ? options.dayKey.trim() : "";
  const details = options.details && typeof options.details === "object" ? options.details : null;
  const trigger = options.trigger instanceof HTMLElement ? options.trigger : null;
  const renderInPanel = options.renderInPanel === true;
  const historyPanel = options.panel instanceof HTMLElement ? options.panel : null;
  if (!dayKey) {
    showToast("Date de bilan introuvable.");
    return;
  }
  if (!ctx?.db || !ctx?.user?.uid) {
    showToast("Connexion requise pour modifier cette réponse.");
    return;
  }
  if (!EDITABLE_HISTORY_TYPES.has(consigne?.type)) {
    showToast("Modification non disponible pour ce type de consigne.");
    return;
  }
  if (!consigne?.id) {
    showToast("Consigne introuvable.");
    return;
  }
  const historyPanelsToRefresh = new Set();
  const registerHistoryPanelRefresh = (candidate) => {
    if (!candidate) {
      return;
    }
    const identifier = typeof candidate === "object" ? candidate.id : candidate;
    if (identifier == null) {
      return;
    }
    historyPanelsToRefresh.add(String(identifier));
  };
  const flushHistoryPanelRefresh = () => {
    historyPanelsToRefresh.forEach((identifier) => {
      refreshOpenHistoryPanel(identifier);
    });
  };
  registerHistoryPanelRefresh(consigne);
  let historyEntries = [];
  try {
    historyEntries = await Schema.loadConsigneHistory(ctx.db, ctx.user.uid, consigne.id);
  } catch (error) {
    modesLogger?.warn?.("bilan.history.editor.load", error);
    showToast("Impossible de charger cette réponse de bilan.");
    return;
  }
  const explicitResponseId =
    typeof options.responseId === "string" && options.responseId.trim() ? options.responseId.trim() : "";
  const explicitHistoryId =
    typeof options.historyId === "string" && options.historyId.trim() ? options.historyId.trim() : "";
  const normalizeChecklistValueForEditor = (raw) => {
    if (raw == null) {
      return null;
    }
    try {
      const fallback = raw && typeof raw === "object" ? raw : null;
      const normalized = buildChecklistValue(consigne, raw, fallback);
      if (!normalized || (Array.isArray(normalized.items) && normalized.items.length === 0 && !normalized.skipped)) {
        return normalized || null;
      }
      return normalized;
    } catch (error) {
      logChecklistEvent("warn", "[checklist-history] normalize", { error: String(error) });
      return null;
    }
  };
  const timelineNormalized =
    consigne.type === "checklist" ? normalizeChecklistValueForEditor(details?.rawValue ?? details?.value ?? null) : null;
  const expectedSummary =
    consigne.type === "checklist"
      ? options.expectedSummary || (timelineNormalized ? summarizeChecklistValue(timelineNormalized) : null)
      : null;
  const match = findHistoryEntryForDayKey(historyEntries, consigne, dayKey, {
    responseId: explicitResponseId,
    historyId: explicitHistoryId,
    debug: consigne.type === "checklist" ? "bilan-editor" : "",
    expectedSummary,
  });
  const entry = match?.entry || null;
  const keyInfo = match?.keyInfo || null;
  const resolvedDayKey = keyInfo?.dayKey || dayKey;
  const historyDocumentId = resolveHistoryDocumentId(entry, resolvedDayKey);
  // For bilan editors, do NOT prefill from timeline/details when no saved entry exists,
  // to avoid showing pre-checked states when there is no recorded bilan answer for this period.
  const entryValue = entry?.value !== undefined ? entry.value : "";
  const createdAtSource =
    entry?.createdAt ?? entry?.updatedAt ?? entry?.recordedAt ?? details?.timestamp ?? null;
  const createdAt = asDate(createdAtSource);
  const dateCandidate =
    (keyInfo?.date instanceof Date && !Number.isNaN(keyInfo.date.getTime()) ? keyInfo.date : null) ||
    (details?.date instanceof Date && !Number.isNaN(details.date.getTime()) ? details.date : null) ||
    (modesParseDayKeyToDate(resolvedDayKey) ?? null) ||
    createdAt ||
    null;
  const dateLabel = formatBilanHistoryDateLabel(dateCandidate, resolvedDayKey);
  const relative = computeRelativeHistoryLabel(dateCandidate);
  const iterationNumber = Number.isFinite(details?.iterationNumber)
    ? details.iterationNumber
    : Number.isFinite(keyInfo?.iterationNumber)
    ? keyInfo.iterationNumber
    : null;
  const rawIterationLabel = (() => {
    if (typeof details?.iterationLabel === "string" && details.iterationLabel.trim()) {
      return details.iterationLabel.trim();
    }
    if (typeof keyInfo?.iterationLabel === "string" && keyInfo.iterationLabel.trim()) {
      return keyInfo.iterationLabel.trim();
    }
    return "";
  })();
  const iterationLabel = sanitizeIterationLabel(rawIterationLabel, iterationNumber);
  const fieldId = `bilan-history-edit-${consigne?.id || "consigne"}-${Date.now().toString(36)}`;
  const timelineSummary = consigne.type === "checklist" && timelineNormalized
    ? summarizeChecklistValue(timelineNormalized)
    : null;
  let displayValue = entryValue;
  let entrySummary = consigne.type === "checklist" ? null : null;
  if (consigne.type === "checklist") {
    const entryNormalized = normalizeChecklistValueForEditor(entryValue);
    if (entryNormalized) {
      displayValue = { ...entryNormalized };
    } else if (timelineNormalized) {
      displayValue = { ...timelineNormalized };
      if (!entry) {
        logChecklistEvent("warn", "[checklist-history] using timeline value (bilan, no entry)", {
          consigneId: consigne.id ?? null,
          dayKey: resolvedDayKey,
        });
      } else {
        logChecklistEvent("warn", "[checklist-history] overriding bilan entry value with timeline summary", {
          consigneId: consigne.id ?? null,
          dayKey: resolvedDayKey,
        });
      }
    }
    entrySummary = summarizeChecklistValue(displayValue);
  }
  if (consigne.type === "checklist" && displayValue && typeof displayValue === "object") {
    displayValue = { ...displayValue, __historyDateKey: resolvedDayKey };
  }
  const valueField = renderConsigneValueField(consigne, displayValue, fieldId);
  const autosaveKey = ["history-entry-bilan", ctx.user?.uid || "anon", consigne?.id || "consigne", resolvedDayKey]
    .map((part) => String(part || ""))
    .join(":");
  const entryMode = resolveHistoryMode(entry) || "bilan";
  const triggerResponseId = (() => {
    if (!(trigger instanceof HTMLElement)) {
      return "";
    }
    const direct =
      (typeof trigger.dataset?.historyResponseId === "string" && trigger.dataset.historyResponseId.trim()
        ? trigger.dataset.historyResponseId.trim()
        : "") ||
      trigger.getAttribute?.("data-history-response-id") ||
      "";
    if (direct && typeof direct === "string" && direct.trim()) {
      return direct.trim();
    }
    const container = trigger.closest("[data-history-entry]");
    if (container) {
      const attr = container.getAttribute("data-response-id");
      if (attr && attr.trim()) {
        return attr.trim();
      }
    }
    return "";
  })();
  const detailResponseId = resolveHistoryResponseId(details);
  const entryResponseId = resolveHistoryResponseId(entry);
  const resolvedResponseId =
    explicitResponseId || triggerResponseId || detailResponseId || entryResponseId || "";
  const responseSyncOptions = {
    responseId: resolvedResponseId,
    responseMode: entryMode,
    responseType: typeof entry?.type === "string" && entry.type.trim() ? entry.type.trim() : consigne?.type,
    responseDayKey: resolvedDayKey,
    responseCreatedAt:
      createdAt instanceof Date && !Number.isNaN(createdAt.getTime())
        ? createdAt.toISOString()
        : typeof createdAtSource === "string"
        ? createdAtSource
        : "",
  };
  let childCandidates = [];
  if (ctx?.db && ctx?.user?.uid && consigne?.id) {
    try {
      childCandidates = await Schema.listChildConsignes(ctx.db, ctx.user.uid, consigne.id);
    } catch (error) {
      try {
        modesLogger?.warn?.("bilan.history.editor.children.load", {
          consigneId: consigne.id,
          error,
        });
      } catch (_) {}
      childCandidates = [];
    }
  }
  const parentInitialHasValue = hasValueForConsigne(consigne, displayValue);
  const baseChildStates = await Promise.all(
    childCandidates.map(async (child) => {
      let childEntries = [];
      try {
        childEntries = await Schema.loadConsigneHistory(ctx.db, ctx.user.uid, child.id);
      } catch (error) {
        try {
          modesLogger?.warn?.("bilan.history.editor.child.load", { childId: child.id, error });
        } catch (_) {}
        childEntries = [];
      }
      const childMatch = findHistoryEntryForDayKey(childEntries, child, resolvedDayKey);
      const childEntry = childMatch?.entry || null;
      const childRawValue = childEntry?.value !== undefined ? childEntry.value : "";
      let childValue = childRawValue;
      if (child.type === "checklist") {
        try {
          const fallbackValue =
            childRawValue && typeof childRawValue === "object" ? childRawValue : null;
          const normalizedChild = buildChecklistValue(child, childRawValue, fallbackValue);
          childValue = normalizedChild ? { ...normalizedChild, __historyDateKey: resolvedDayKey } : null;
        } catch (error) {
          childValue = null;
        }
      }
      const childCreatedAtSource =
        childEntry?.createdAt ?? childEntry?.updatedAt ?? childEntry?.recordedAt ?? null;
      const childCreatedAt = asDate(childCreatedAtSource);
      const childHistoryDocumentId = resolveHistoryDocumentId(childEntry, resolvedDayKey);
      const childResponseId = resolveHistoryResponseId(childEntry);
      const childResponseSyncOptions = {
        responseId: childResponseId,
        responseMode: resolveHistoryMode(childEntry) || entryMode,
        responseType:
          typeof childEntry?.type === "string" && childEntry.type.trim()
            ? childEntry.type.trim()
            : child.type,
        responseDayKey: resolvedDayKey,
        responseCreatedAt:
          childCreatedAt instanceof Date && !Number.isNaN(childCreatedAt.getTime())
            ? childCreatedAt.toISOString()
            : typeof childCreatedAtSource === "string"
            ? childCreatedAtSource
            : "",
      };
      const selectorValue = String(child.id ?? "").replace(/"/g, '\\"');
      const inRow =
        row && row.matches?.(`[data-consigne-id="${selectorValue}"]`)
          ? row
          : row?.querySelector?.(`[data-consigne-id="${selectorValue}"]`) ||
            document.querySelector(`[data-consigne-id="${selectorValue}"]`);
      const domId = `bilan-history-child-${String(child.id ?? "child")}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const fieldBase = `${domId}-${Date.now().toString(36)}`;
      const childInitialHasValue = hasValueForConsigne(child, childValue);
      return {
        consigne: child,
        entry: childEntry,
        value: childValue,
        domId,
        fieldId: `${fieldBase}-value`,
        row: inRow instanceof HTMLElement ? inRow : null,
        responseSyncOptions: childResponseSyncOptions,
        historyDocumentId: childHistoryDocumentId,
        initialHasValue: childInitialHasValue,
      };
    }),
  );
  baseChildStates.forEach((childState) => {
    registerHistoryPanelRefresh(childState?.consigne);
  });
  const childMarkup = baseChildStates.length
    ? `<section class="practice-editor__section space-y-3 border-t border-slate-200 pt-3 mt-3" data-history-children>
        <header class="space-y-1">
          <h3 class="text-base font-semibold">Sous-consignes</h3>
          <p class="text-sm text-slate-600">Complète les sous-consignes liées à cette carte.</p>
        </header>
        <div class="space-y-3">
          ${baseChildStates
            .map((childState, index) => {
              const child = childState.consigne || {};
              const childTitle =
                child.text || child.titre || child.name || `Sous-consigne ${index + 1}`;
              const childDescription = child.description || child.details || child.helper || "";
              const childFieldMarkup = renderConsigneValueField(
                child,
                childState.value,
                childState.fieldId,
              );
              return `
                <article class="space-y-3 rounded-xl border border-slate-200 p-3" data-history-child="${escapeHtml(childState.domId)}" data-consigne-id="${escapeHtml(
                String(child.id ?? ""),
              )}">
                  <div class="space-y-1">
                    <div class="font-medium text-slate-800">${escapeHtml(childTitle)}</div>
                    ${
                      childDescription
                        ? `<p class="text-sm text-slate-600 whitespace-pre-line">${escapeHtml(
                            childDescription,
                          )}</p>`
                        : ""
                    }
                  </div>
                  <div class="space-y-2">
                    ${childFieldMarkup}
                  </div>
                </article>`;
            })
            .join("")}
        </div>
      </section>`
    : "";
  const labelForAttr = consigne.type === "checklist" ? "" : ` for="${escapeHtml(fieldId)}"`;
  const editorHtml = `
    <div class="space-y-5">
      <header class="space-y-1">
        <p class="text-sm text-[var(--muted)]">${escapeHtml(dateLabel)}${
          relative ? ` <span class="text-xs">(${escapeHtml(relative)})</span>` : ""
        }</p>
        <h2 class="text-lg font-semibold">Modifier la réponse</h2>
        <p class="text-sm text-slate-600">${escapeHtml(safeConsigneLabel(consigne))}</p>
      </header>
      <form class="practice-editor" data-autosave-key="${escapeHtml(autosaveKey)}">
        <div class="practice-editor__section">
          <label class="practice-editor__label"${labelForAttr}>Valeur</label>
          ${valueField}
        </div>
        ${childMarkup}
        <div class="practice-editor__actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annuler</button>
          <button type="button" class="btn btn-danger" data-clear>Effacer</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  `;
  let overlay = null;
  let modalContent = null;
  let cleanup = null;
  let submitBtn = null;
  let clearBtn = null;
  let cancelBtn = null;
  let form = null;
  let requestClose = null;
  const restoreFocus = () => {
    if (trigger && typeof trigger.focus === "function") {
      try { trigger.focus({ preventScroll: true }); } catch (_) { trigger.focus(); }
    }
  };
  if (renderInPanel && historyPanel) {
    const previousOverlay = historyPanel.querySelector('.history-panel__edit-overlay');
    if (previousOverlay) {
      previousOverlay.dispatchEvent(new Event('history-edit-request-close'));
    }
    overlay = document.createElement('div');
    overlay.className = 'history-panel__edit-overlay';
    // Force a very high z-index to ensure it sits above any panel content or other overlays
    try { overlay.style.zIndex = '99999'; } catch (_) {}
    overlay.innerHTML = `
      <div class="history-panel__edit-dialog" role="dialog" aria-modal="true" tabindex="-1">
        ${editorHtml}
      </div>
    `;
    historyPanel.appendChild(overlay);
    modalContent = overlay.querySelector('.history-panel__edit-dialog');
    form = overlay.querySelector('form');
    clearBtn = form?.querySelector('[data-clear]');
    submitBtn = form?.querySelector('button[type="submit"]');
    let handleKeyDown;
    let overlayObserver;
    const closeEditor = () => {
      if (cleanup) cleanup();
      if (overlay && overlay.isConnected) overlay.remove();
      restoreFocus();
    };
    requestClose = closeEditor;
    cleanup = () => {
      if (handleKeyDown) {
        document.removeEventListener('keydown', handleKeyDown, true);
        handleKeyDown = null;
      }
      overlay.removeEventListener('history-edit-request-close', closeEditor);
      if (overlayObserver) {
        overlayObserver.disconnect();
        overlayObserver = null;
      }
    };
    handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeEditor();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    overlay.addEventListener('history-edit-request-close', () => {
      closeEditor();
    });
    overlayObserver = new MutationObserver(() => {
      if (!overlay.isConnected && cleanup) cleanup();
    });
    try { overlayObserver.observe(historyPanel, { childList: true }); } catch (_) {}
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeEditor();
      }
    });
    requestAnimationFrame(() => {
      try { modalContent?.focus({ preventScroll: true }); } catch (_) { modalContent?.focus?.(); }
    });
    cancelBtn = overlay.querySelector('[data-cancel]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', (event) => {
        event.preventDefault();
        closeEditor();
      });
    }
  } else {
    overlay = modal(editorHtml);
    if (!overlay) return;
    modalContent = overlay.querySelector('[data-modal-content]');
    if (modalContent) {
      modalContent.setAttribute('role', 'dialog');
      modalContent.setAttribute('aria-modal', 'true');
      modalContent.setAttribute('aria-label', 'Modifier la réponse de bilan');
    }
    form = overlay.querySelector('form');
    clearBtn = overlay.querySelector('[data-clear]');
    submitBtn = form?.querySelector('button[type="submit"]');
    let handleKeyDown = null;
    cleanup = () => {
      if (handleKeyDown) {
        document.removeEventListener('keydown', handleKeyDown, true);
        handleKeyDown = null;
      }
    };
    const closeOverlay = () => {
      cleanup();
      overlay.remove();
      restoreFocus();
    };
    requestClose = closeOverlay;
    handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeOverlay();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeOverlay();
      }
    });
    cancelBtn = overlay.querySelector('[data-cancel]');
    cancelBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      closeOverlay();
    });
  }
  // Enhance textarea and checklist scope for both rendering modes
  initializeChecklistScope(overlay, { dateKey: resolvedDayKey });
  overlay.querySelectorAll('textarea').forEach((textarea) => {
    if (typeof autoGrowTextarea === 'function') {
      autoGrowTextarea(textarea);
    }
  });
  if (clearBtn) {
    const hasInitialChildValue = baseChildStates.some((childState) =>
      hasValueForConsigne(childState.consigne, childState.value),
    );
    // Allow clearing when an entry exists even if it has no textual content
    const hadStoredEntry = Boolean(entry);
    const hasInitialData = hadStoredEntry || parentInitialHasValue || hasInitialChildValue;
    if (!hasInitialData) {
      clearBtn.disabled = true;
    }
    clearBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!confirm("Effacer la réponse pour ce bilan ?")) {
        return;
      }
      clearBtn.disabled = true;
      if (submitBtn) submitBtn.disabled = true;
      try {
        await Schema.deleteHistoryEntry(ctx.db, ctx.user.uid, consigne.id, historyDocumentId, responseSyncOptions);
        try { removeRecentResponsesForDay(consigne.id, resolvedDayKey); } catch (e) {}
        try { await deleteAllResponsesForDay(ctx.db, ctx.user.uid, consigne.id, resolvedDayKey); } catch (e) {}
        // If this history entry originates from a bilan summary, also delete the underlying summary answer
        try {
          const scope = entry?.summaryScope || entry?.periodScope || "";
          const periodKey = entry?.summaryPeriod || entry?.periodKey || "";
          const answerKey = entry?.summaryKey || "";
          if (scope && periodKey && answerKey && Schema?.deleteSummaryAnswer) {
            await Schema.deleteSummaryAnswer(ctx.db, ctx.user.uid, scope, periodKey, answerKey);
          }
        } catch (err) {
          console.error("bilan.history.editor.clear.summaryDelete", err);
        }
        const status = dotColor(consigne.type, "", consigne) || "na";
        updateConsigneHistoryTimeline(row, status, {
          consigne,
          value: "",
          dayKey: resolvedDayKey,
          historyId: historyDocumentId,
          responseId: responseSyncOptions?.responseId || "",
          isBilan: true,
          remove: true,
        });
        triggerConsigneRowUpdateHighlight(row);
        for (const childState of baseChildStates) {
          try {
            await Schema.deleteHistoryEntry(
              ctx.db,
              ctx.user.uid,
              childState.consigne.id,
              childState.historyDocumentId,
              childState.responseSyncOptions,
            );
            try { removeRecentResponsesForDay(childState.consigne.id, resolvedDayKey); } catch (e) {}
            try { await deleteAllResponsesForDay(ctx.db, ctx.user.uid, childState.consigne.id, resolvedDayKey); } catch (e) {}
            // Also delete child summary answers if present
            try {
              const cEntry = childState.entry || null;
              const cScope = cEntry?.summaryScope || cEntry?.periodScope || "";
              const cPeriodKey = cEntry?.summaryPeriod || cEntry?.periodKey || "";
              const cAnswerKey = cEntry?.summaryKey || "";
              if (cScope && cPeriodKey && cAnswerKey && Schema?.deleteSummaryAnswer) {
                await Schema.deleteSummaryAnswer(ctx.db, ctx.user.uid, cScope, cPeriodKey, cAnswerKey);
              }
            } catch (err) {
              console.error("bilan.history.editor.child.clear.summaryDelete", err);
            }
          } catch (error) {
            console.error("bilan.history.editor.child.clear", error);
          }
          const childStatus = dotColor(childState.consigne.type, "", childState.consigne) || "na";
          if (childState.row) {
            updateConsigneHistoryTimeline(childState.row, childStatus, {
              consigne: childState.consigne,
              value: "",
              dayKey: resolvedDayKey,
              historyId: childState.historyDocumentId,
              responseId: childState.responseSyncOptions?.responseId || "",
              iterationLabel,
              remove: true,
            });
            triggerConsigneRowUpdateHighlight(childState.row);
          }
        }
        showToast("Réponses effacées pour ce bilan.");
        // If we are inside the history panel, remove the corresponding list item immediately
        if (renderInPanel && historyPanel) {
          try {
            const li = trigger && trigger.closest('[data-history-entry]');
            if (li && li.parentElement) {
              li.parentElement.removeChild(li);
              const listEl = historyPanel.querySelector('.history-panel__list');
              const badge = historyPanel.querySelector('.history-panel__badge');
              const count = listEl ? listEl.querySelectorAll('[data-history-entry]').length : 0;
              if (badge) badge.textContent = count === 0 ? 'Aucune entrée' : (count === 1 ? '1 entrée' : `${count} entrées`);
              if (listEl && count === 0) {
                listEl.innerHTML = '<li class="history-panel__empty">Aucune réponse pour l’instant.</li>';
              }
            }
          } catch (_) {}
        }
        if (typeof options.onChange === 'function') {
          try { options.onChange(); } catch (e) {}
        }
        if (typeof requestClose === 'function') requestClose();
        flushHistoryPanelRefresh();
      } catch (error) {
        console.error("bilan.history.editor.clear", error);
        clearBtn.disabled = false;
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!submitBtn || submitBtn.disabled) {
      return;
    }
    submitBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    try {
      const rawValue = readConsigneValueFromForm(consigne, form);
      const parentHasValue = hasValueForConsigne(consigne, rawValue);
      const childResults = baseChildStates.map((childState) => {
        const childNode = form.querySelector(`[data-history-child="${childState.domId}"]`);
        const childValue = childNode
          ? readConsigneValueFromForm(childState.consigne, childNode)
          : "";
        const hasValue = hasValueForConsigne(childState.consigne, childValue);
        return {
          state: childState,
          value: childValue,
          hasValue,
        };
      });
      if (!parentHasValue) {
        await Schema.deleteHistoryEntry(ctx.db, ctx.user.uid, consigne.id, historyDocumentId, responseSyncOptions);
        try { removeRecentResponsesForDay(consigne.id, resolvedDayKey); } catch (e) {}
        try { await deleteAllResponsesForDay(ctx.db, ctx.user.uid, consigne.id, resolvedDayKey); } catch (e) {}
        // Also remove the corresponding summary answer if present
        try {
          const scope = entry?.summaryScope || entry?.periodScope || "";
          const periodKey = entry?.summaryPeriod || entry?.periodKey || "";
          const answerKey = entry?.summaryKey || "";
          if (scope && periodKey && answerKey && Schema?.deleteSummaryAnswer) {
            await Schema.deleteSummaryAnswer(ctx.db, ctx.user.uid, scope, periodKey, answerKey);
          }
        } catch (err) {
          console.error("bilan.history.editor.save.summaryDelete", err);
        }
      } else {
        await Schema.saveHistoryEntry(
          ctx.db,
          ctx.user.uid,
          consigne.id,
          historyDocumentId,
          { value: rawValue },
          responseSyncOptions,
        );
      }
      const parentStatus = dotColor(
        consigne.type,
        parentHasValue ? rawValue : "",
        consigne,
      ) || "na";
      updateConsigneHistoryTimeline(row, parentStatus, {
        consigne,
        value: parentHasValue ? rawValue : "",
        dayKey: resolvedDayKey,
        isBilan: true,
        historyId: historyDocumentId,
        responseId: resolvedResponseId,
        remove: parentHasValue ? false : true,
      });
      triggerConsigneRowUpdateHighlight(row);
      for (const { state, value, hasValue } of childResults) {
        if (!hasValue) {
          await Schema.deleteHistoryEntry(
            ctx.db,
            ctx.user.uid,
            state.consigne.id,
            state.historyDocumentId,
            state.responseSyncOptions,
          );
          try { removeRecentResponsesForDay(state.consigne.id, resolvedDayKey); } catch (e) {}
          try { await deleteAllResponsesForDay(ctx.db, ctx.user.uid, state.consigne.id, resolvedDayKey); } catch (e) {}
          // Remove child summary answer if present
          try {
            const cEntry = state.entry || null;
            const cScope = cEntry?.summaryScope || cEntry?.periodScope || "";
            const cPeriodKey = cEntry?.summaryPeriod || cEntry?.periodKey || "";
            const cAnswerKey = cEntry?.summaryKey || "";
            if (cScope && cPeriodKey && cAnswerKey && Schema?.deleteSummaryAnswer) {
              await Schema.deleteSummaryAnswer(ctx.db, ctx.user.uid, cScope, cPeriodKey, cAnswerKey);
            }
          } catch (err) {
            console.error("bilan.history.editor.child.save.summaryDelete", err);
          }
        } else {
          await Schema.saveHistoryEntry(
            ctx.db,
            ctx.user.uid,
            state.consigne.id,
            state.historyDocumentId,
            { value },
            state.responseSyncOptions,
          );
        }
        const childStatus = dotColor(
          state.consigne.type,
          hasValue ? value : "",
          state.consigne,
        ) || "na";
        if (state.row) {
          updateConsigneHistoryTimeline(state.row, childStatus, {
            consigne: state.consigne,
            value: hasValue ? value : "",
            dayKey: resolvedDayKey,
            iterationLabel,
            historyId: state.historyDocumentId,
            responseId: state.responseSyncOptions?.responseId || "",
            remove: hasValue ? false : true,
          });
          triggerConsigneRowUpdateHighlight(state.row);
        }
      }
      const childCleared = childResults.some(
        ({ state, hasValue }) => !hasValue && state.initialHasValue,
      );
      const allValuesCleared = !parentHasValue && !childResults.some(({ hasValue }) => hasValue);
      const toastMessage = allValuesCleared
        ? "Réponses effacées pour ce bilan."
        : childCleared || (!parentHasValue && parentInitialHasValue)
        ? "Réponses de bilan mises à jour."
        : "Réponses de bilan enregistrées.";
      showToast(toastMessage);
      if (typeof options.onChange === 'function') {
        try { options.onChange(); } catch (e) {}
      }
      if (typeof requestClose === 'function') requestClose();
      flushHistoryPanelRefresh();
      // Clear local recent cache and notify global listeners so "global history" views refresh
      try { clearRecentResponsesForConsigne(consigne.id); } catch (_) {}
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('consigne:history:refresh', { detail: { consigneId: consigne.id } }));
        }
      } catch (_) {}
    } catch (error) {
      console.error("bilan.history.editor.save", error);
      submitBtn.disabled = false;
      if (clearBtn) clearBtn.disabled = false;
    }
  });
}

async function openConsigneHistoryEntryEditor(row, consigne, ctx, options = {}) {
  const dayKey = typeof options.dayKey === "string" ? options.dayKey.trim() : "";
  const details = options.details && typeof options.details === "object" ? options.details : null;
  const trigger = options.trigger instanceof HTMLElement ? options.trigger : null;
  const source = typeof options.source === "string" ? options.source.trim() : "";
  if (!dayKey) {
    showToast("Date introuvable pour cette réponse.");
    return;
  }
  if (!ctx?.db || !ctx?.user?.uid) {
    showToast("Connexion requise pour modifier cette réponse.");
    return;
  }
  if (!EDITABLE_HISTORY_TYPES.has(consigne?.type)) {
    showToast("Modification non disponible pour ce type de consigne.");
    return;
  }
  if (!consigne?.id) {
    showToast("Consigne introuvable.");
    return;
  }
  const historyPanelsToRefresh = new Set();
  const registerHistoryPanelRefresh = (candidate) => {
    if (!candidate) {
      return;
    }
    const identifier = typeof candidate === "object" ? candidate.id : candidate;
    if (identifier == null) {
      return;
    }
    historyPanelsToRefresh.add(String(identifier));
  };
  const flushHistoryPanelRefresh = () => {
    historyPanelsToRefresh.forEach((identifier) => {
      refreshOpenHistoryPanel(identifier);
    });
  };
  registerHistoryPanelRefresh(consigne);
  let historyEntries = [];
  try {
    historyEntries = await Schema.loadConsigneHistory(ctx.db, ctx.user.uid, consigne.id);
  } catch (error) {
    try {
      modesLogger?.warn?.("consigne.history.entry.load", error);
    } catch (_) {}
    showToast("Impossible de charger cette réponse.");
    return;
  }
  const explicitResponseId =
    typeof options.responseId === "string" && options.responseId.trim() ? options.responseId.trim() : "";
  const explicitHistoryId =
    typeof options.historyId === "string" && options.historyId.trim() ? options.historyId.trim() : "";
  const panelEntry = options.panelEntry || null;
  const triggerResponseId = (() => {
    if (!(trigger instanceof HTMLElement)) {
      return "";
    }
    const direct =
      (typeof trigger.dataset?.historyResponseId === "string" && trigger.dataset.historyResponseId.trim()
        ? trigger.dataset.historyResponseId.trim()
        : "") ||
      trigger.getAttribute?.("data-history-response-id") ||
      "";
    if (direct && direct.trim()) {
      return direct.trim();
    }
    const container = trigger.closest("[data-history-entry]");
    if (container) {
      const attr = container.getAttribute("data-response-id");
      if (attr && attr.trim()) {
        return attr.trim();
      }
    }
    return "";
  })();
  const triggerHistoryId = (() => {
    if (!(trigger instanceof HTMLElement)) {
      return "";
    }
    const direct =
      (typeof trigger.dataset?.historyId === "string" && trigger.dataset.historyId.trim()
        ? trigger.dataset.historyId.trim()
        : "") ||
      trigger.getAttribute?.("data-history-id") ||
      "";
    if (direct && direct.trim()) {
      return direct.trim();
    }
    const container = trigger.closest("[data-history-entry]");
    if (container) {
      const attr = container.getAttribute("data-history-id");
      if (attr && attr.trim()) {
        return attr.trim();
      }
    }
    return "";
  })();
  const detailResponseId = resolveHistoryResponseId(details);
  const detailHistoryId = (() => {
    if (!details || typeof details !== "object") {
      return "";
    }
    if (typeof details.historyId === "string" && details.historyId.trim()) {
      return details.historyId.trim();
    }
    if (typeof details.history_id === "string" && details.history_id.trim()) {
      return details.history_id.trim();
    }
    try {
      const computed = resolveHistoryDocumentId(details, dayKey);
      if (typeof computed === "string" && computed.trim()) {
        return computed.trim();
      }
    } catch (_) {}
    return "";
  })();
  const normalizeChecklistValueForEditor = (raw) => {
    if (raw == null) {
      return null;
    }
    try {
      const fallback = raw && typeof raw === "object" ? raw : null;
      const normalized = buildChecklistValue(consigne, raw, fallback);
      if (!normalized || (Array.isArray(normalized.items) && normalized.items.length === 0 && !normalized.skipped)) {
        return normalized || null;
      }
      return normalized;
    } catch (error) {
      logChecklistEvent("warn", "[checklist-history] normalize", { error: String(error) });
      return null;
    }
  };
  const timelineNormalized =
    consigne.type === "checklist" ? normalizeChecklistValueForEditor(details?.rawValue ?? details?.value ?? null) : null;
  const expectedSummary =
    consigne.type === "checklist"
      ? options.expectedSummary || (timelineNormalized ? summarizeChecklistValue(timelineNormalized) : null)
      : null;
  const timelineSummary =
    consigne.type === "checklist" && timelineNormalized ? summarizeChecklistValue(timelineNormalized) : null;
  if (consigne.type === "checklist") {
    logChecklistHistoryInspection(consigne, {
      label: "entry-editor:history-load",
      entries: historyEntries,
      focusDayKey: dayKey,
    });
  }
  const match = findHistoryEntryForDayKey(historyEntries, consigne, dayKey, {
    responseId: explicitResponseId || triggerResponseId || detailResponseId || "",
    historyId: explicitHistoryId || triggerHistoryId || detailHistoryId || "",
    debug: consigne.type === "checklist" ? "entry-editor" : "",
    expectedSummary,
  });
  const entry = match?.entry || null;
  const keyInfo = match?.keyInfo || null;
  const matchInfo = match
    ? {
        type: match.matchType || "",
        historyId: match.historyId || "",
        responseId: match.responseId || "",
        candidateDayKey: match.keyInfo?.dayKey || "",
        weight: match.weight ?? null,
        summaryDiff: Array.isArray(match.summaryDiff) ? match.summaryDiff : [],
      }
    : null;
  const resolvedDayKey = keyInfo?.dayKey || dayKey;
  if (consigne.type === "checklist" && !entry) {
    logChecklistEvent("error", "[checklist-history] entry-editor:missing-entry", {
      consigneId: consigne.id ?? null,
      dayKey,
      resolvedDayKey,
      responseTarget: explicitResponseId || triggerResponseId || detailResponseId || "",
      historyTarget: explicitHistoryId || triggerHistoryId || detailHistoryId || "",
      availableEntries: historyEntries.length,
    });
  }
  const historyDocumentId = resolveHistoryDocumentId(entry, resolvedDayKey);
  const entryValue = entry?.value !== undefined ? entry.value : details?.rawValue ?? "";
  const createdAtSource =
    entry?.createdAt ?? entry?.updatedAt ?? entry?.recordedAt ?? details?.timestamp ?? null;
  const createdAt = asDate(createdAtSource);
  const dateCandidate =
    (keyInfo?.date instanceof Date && !Number.isNaN(keyInfo.date.getTime()) ? keyInfo.date : null) ||
    (details?.date instanceof Date && !Number.isNaN(details.date.getTime()) ? details.date : null) ||
    (modesParseDayKeyToDate(resolvedDayKey) ?? null) ||
    createdAt ||
    null;
  const baseDateLabel =
    dateCandidate instanceof Date && !Number.isNaN(dateCandidate.getTime())
      ? formatHistoryDayFullLabel(dateCandidate) || resolvedDayKey
      : resolvedDayKey;
  const iterationNumber = Number.isFinite(details?.iterationNumber)
    ? details.iterationNumber
    : Number.isFinite(keyInfo?.iterationNumber)
    ? keyInfo.iterationNumber
    : null;
  const rawIterationLabel = (() => {
    if (typeof details?.iterationLabel === "string" && details.iterationLabel.trim()) {
      return details.iterationLabel.trim();
    }
    if (typeof keyInfo?.iterationLabel === "string" && keyInfo.iterationLabel.trim()) {
      return keyInfo.iterationLabel.trim();
    }
    return "";
  })();
  const iterationLabel = sanitizeIterationLabel(rawIterationLabel, iterationNumber);
  const primaryLabel = iterationLabel || baseDateLabel;
  const secondaryLabel =
    iterationLabel && baseDateLabel && iterationLabel !== baseDateLabel ? baseDateLabel : "";
  const relative = computeRelativeHistoryLabel(dateCandidate);
  const fieldId = `history-edit-${consigne?.id || "consigne"}-${Date.now().toString(36)}`;
  let displayValue = entryValue;
  let entrySummary = consigne.type === "checklist" ? null : null;
  if (consigne.type === "checklist") {
    const entryNormalized = normalizeChecklistValueForEditor(entryValue);
    if (entryNormalized) {
      displayValue = { ...entryNormalized };
    } else if (timelineNormalized) {
      displayValue = { ...timelineNormalized };
      if (!entry) {
        logChecklistEvent("warn", "[checklist-history] using timeline value (no entry)", {
          consigneId: consigne.id ?? null,
          dayKey: resolvedDayKey,
        });
      } else {
        logChecklistEvent("warn", "[checklist-history] overriding entry value with timeline summary", {
          consigneId: consigne.id ?? null,
          dayKey: resolvedDayKey,
        });
      }
    }
    entrySummary = summarizeChecklistValue(displayValue);
    if (matchInfo && Array.isArray(matchInfo.summaryDiff) && matchInfo.summaryDiff.length === 0) {
      const diffs = diffChecklistSummaries(
        expectedSummary || (timelineNormalized ? summarizeChecklistValue(timelineNormalized) : null),
        entrySummary,
      );
      if (Array.isArray(diffs) && diffs.length) {
        matchInfo.summaryDiff = diffs;
      }
    }
  }
  if (consigne.type === "checklist" && displayValue && typeof displayValue === "object") {
    displayValue = { ...displayValue, __historyDateKey: resolvedDayKey };
  }
  const valueField = renderConsigneValueField(consigne, displayValue, fieldId);
  const autosaveKey = ["history-entry-edit", ctx.user?.uid || "anon", consigne?.id || "consigne", resolvedDayKey]
    .map((part) => String(part || ""))
    .join(":");
  const entryResponseId = resolveHistoryResponseId(entry);
  const resolvedResponseId =
    explicitResponseId || triggerResponseId || detailResponseId || entryResponseId || "";
  const responseSyncOptions = {
    responseId: resolvedResponseId,
    responseMode: resolveHistoryMode(entry) || source,
    responseType: typeof entry?.type === "string" && entry.type.trim() ? entry.type.trim() : consigne?.type,
    responseDayKey: resolvedDayKey,
    responseCreatedAt:
      createdAt instanceof Date && !Number.isNaN(createdAt.getTime())
        ? createdAt.toISOString()
        : typeof createdAtSource === "string"
        ? createdAtSource
        : "",
  };
  if (consigne.type === "checklist") {
    const panelEntry = options.panelEntry || null;
    const panelNormalized =
      panelEntry && panelEntry.value != null ? normalizeChecklistValueForEditor(panelEntry.value) : null;
    const panelSummary = panelNormalized ? summarizeChecklistValue(panelNormalized) : null;
    logChecklistHistoryInspection(consigne, {
      label: "entry-editor:resolution",
      focusDayKey: resolvedDayKey,
      timelineDetails: {
        summary: timelineSummary,
        responseId: explicitResponseId || triggerResponseId || detailResponseId || "",
        historyId: explicitHistoryId || triggerHistoryId || detailHistoryId || "",
        rawValue: timelineNormalized,
      },
      entrySummary: {
        summary: entrySummary,
        responseId: resolvedResponseId,
        historyId: historyDocumentId,
        rawValue: displayValue,
      },
      panelSummary: panelSummary
        ? {
            summary: panelSummary,
            responseId:
              (typeof panelEntry?.responseId === "string" && panelEntry.responseId.trim()) ||
              (typeof panelEntry?.response_id === "string" && panelEntry.response_id.trim()) ||
              (typeof panelEntry?.id === "string" && panelEntry.id.trim()) ||
              "",
            historyId:
              (typeof panelEntry?.historyId === "string" && panelEntry.historyId.trim()) ||
              (typeof panelEntry?.history_id === "string" && panelEntry.history_id.trim()) ||
              "",
            rawValue: panelNormalized,
          }
        : null,
      matchInfo,
      entries: historyEntries,
      maxEntries: 20,
    });
  }
  let childCandidates = [];
  if (ctx?.db && ctx?.user?.uid && consigne?.id) {
    try {
      childCandidates = await Schema.listChildConsignes(ctx.db, ctx.user.uid, consigne.id);
    } catch (error) {
      try {
        modesLogger?.warn?.("consigne.history.entry.children.load", {
          consigneId: consigne.id,
          error,
        });
      } catch (_) {}
      childCandidates = [];
    }
  }
  const parentInitialHasValue = hasValueForConsigne(consigne, displayValue);
  const baseChildStates = await Promise.all(
    childCandidates.map(async (child) => {
      let childEntries = [];
      try {
        childEntries = await Schema.loadConsigneHistory(ctx.db, ctx.user.uid, child.id);
      } catch (error) {
        try {
          modesLogger?.warn?.("consigne.history.entry.child.load", { childId: child.id, error });
        } catch (_) {}
        childEntries = [];
      }
      const childMatch = findHistoryEntryForDayKey(childEntries, child, resolvedDayKey);
      const childEntry = childMatch?.entry || null;
      const childRawValue = childEntry?.value !== undefined ? childEntry.value : "";
      let childValue = childRawValue;
      if (child.type === "checklist") {
        try {
          const fallbackValue =
            childRawValue && typeof childRawValue === "object" ? childRawValue : null;
          const normalizedChild = buildChecklistValue(child, childRawValue, fallbackValue);
          childValue = normalizedChild ? { ...normalizedChild, __historyDateKey: resolvedDayKey } : null;
        } catch (error) {
          childValue = null;
        }
      }
      const childCreatedAtSource =
        childEntry?.createdAt ?? childEntry?.updatedAt ?? childEntry?.recordedAt ?? null;
      const childCreatedAt = asDate(childCreatedAtSource);
      const childHistoryDocumentId = resolveHistoryDocumentId(childEntry, resolvedDayKey);
      const childResponseId = resolveHistoryResponseId(childEntry);
      const childResponseSyncOptions = {
        responseId: childResponseId,
        responseMode: resolveHistoryMode(childEntry) || source,
        responseType:
          typeof childEntry?.type === "string" && childEntry.type.trim()
            ? childEntry.type.trim()
            : child.type,
        responseDayKey: resolvedDayKey,
        responseCreatedAt:
          childCreatedAt instanceof Date && !Number.isNaN(childCreatedAt.getTime())
            ? childCreatedAt.toISOString()
            : typeof childCreatedAtSource === "string"
            ? childCreatedAtSource
            : "",
      };
      const selectorValue = String(child.id ?? "").replace(/"/g, '\\"');
      const inRow =
        row && row.matches?.(`[data-consigne-id="${selectorValue}"]`)
          ? row
          : row?.querySelector?.(`[data-consigne-id="${selectorValue}"]`) ||
            document.querySelector(`[data-consigne-id="${selectorValue}"]`);
      const domId = `history-child-${String(child.id ?? "child")}-${Math.random().toString(36).slice(2, 8)}`;
      const fieldBase = `${domId}-${Date.now().toString(36)}`;
      const childInitialHasValue = hasValueForConsigne(child, childValue);
      return {
        consigne: child,
        entry: childEntry,
        value: childValue,
        domId,
        fieldId: `${fieldBase}-value`,
        row: inRow instanceof HTMLElement ? inRow : null,
        responseSyncOptions: childResponseSyncOptions,
        historyDocumentId: childHistoryDocumentId,
        initialHasValue: childInitialHasValue,
      };
    }),
  );
  baseChildStates.forEach((childState) => {
    registerHistoryPanelRefresh(childState?.consigne);
  });
  const childMarkup = baseChildStates.length
    ? `<section class="practice-editor__section space-y-3 border-t border-slate-200 pt-3 mt-3" data-history-children>
        <header class="space-y-1">
          <h3 class="text-base font-semibold">Sous-consignes</h3>
          <p class="text-sm text-slate-600">Complète les sous-consignes liées à cette carte.</p>
        </header>
        <div class="space-y-3">
          ${baseChildStates
            .map((childState, index) => {
              const child = childState.consigne || {};
              const childTitle =
                child.text || child.titre || child.name || `Sous-consigne ${index + 1}`;
              const childDescription = child.description || child.details || child.helper || "";
              const childFieldMarkup = renderConsigneValueField(
                child,
                childState.value,
                childState.fieldId,
              );
              return `
                <article class="space-y-3 rounded-xl border border-slate-200 p-3" data-history-child="${escapeHtml(childState.domId)}" data-consigne-id="${escapeHtml(
                String(child.id ?? ""),
              )}">
                  <div class="space-y-1">
                    <div class="font-medium text-slate-800">${escapeHtml(childTitle)}</div>
                    ${
                      childDescription
                        ? `<p class="text-sm text-slate-600 whitespace-pre-line">${escapeHtml(
                            childDescription,
                          )}</p>`
                        : ""
                    }
                  </div>
                  <div class="space-y-2">
                    ${childFieldMarkup}
                  </div>
                </article>`;
            })
            .join("")}
        </div>
      </section>`
    : "";
  const labelForAttr2 = consigne.type === "checklist" ? "" : ` for="${escapeHtml(fieldId)}"`;
  const editorHtml = `
    <div class="space-y-5">
      <header class="space-y-1">
        ${primaryLabel ? `<p class="text-sm text-[var(--muted)]">${escapeHtml(primaryLabel)}${
          relative ? ` <span class="text-xs">(${escapeHtml(relative)})</span>` : ""
        }</p>` : ""}
        ${secondaryLabel ? `<p class="text-xs text-slate-500">${escapeHtml(secondaryLabel)}</p>` : ""}
        <h2 class="text-lg font-semibold">Modifier la réponse</h2>
        <p class="text-sm text-slate-600">${escapeHtml(safeConsigneLabel(consigne))}</p>
      </header>
      <form class="practice-editor" data-autosave-key="${escapeHtml(autosaveKey)}">
        <div class="practice-editor__section">
          <label class="practice-editor__label"${labelForAttr2}>Valeur</label>
          ${valueField}
        </div>
        ${childMarkup}
        <div class="practice-editor__actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annuler</button>
          <button type="button" class="btn btn-danger" data-clear>Effacer</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  `;
  const overlay = modal(editorHtml);
  if (!overlay) {
    return;
  }
  initializeChecklistScope(overlay, { dateKey: resolvedDayKey });
  if (consigne.type === "checklist") {
    requestAnimationFrame(() => {
      try {
        const domRoot = overlay.querySelector("[data-checklist-root]");
        if (!domRoot) {
          return;
        }
        const domState = readChecklistDomState(domRoot);
        const domValue = buildChecklistValue(consigne, domState || []);
        const domSummary = summarizeChecklistValue(domValue);
        const hiddenInput = domRoot.querySelector("[data-checklist-state]");
        logChecklistHistoryInspection(consigne, {
          label: "entry-editor:dom",
          focusDayKey: resolvedDayKey,
          domSummary: {
            summary: domSummary,
            rawValue: domValue,
          },
          domAttrs: {
            rootHistoryDate: domRoot.dataset?.checklistHistoryDate || domRoot.getAttribute?.("data-checklist-history-date") || "",
            hiddenHistoryDate:
              (hiddenInput?.dataset?.checklistHistoryDate || hiddenInput?.getAttribute?.("data-checklist-history-date") || ""),
          },
          timelineDetails: {
            summary: timelineSummary,
            responseId: explicitResponseId || triggerResponseId || detailResponseId || "",
            historyId: explicitHistoryId || triggerHistoryId || detailHistoryId || "",
            rawValue: timelineNormalized,
          },
          entrySummary: {
            summary: entrySummary,
            responseId: resolvedResponseId,
            historyId: historyDocumentId,
            rawValue: displayValue,
          },
          matchInfo,
        });
      } catch (error) {
        logChecklistEvent("warn", "[checklist-history] dom-summary failed", { error: String(error) });
      }
    });
  }
  overlay.querySelectorAll("textarea").forEach((textarea) => {
    if (typeof autoGrowTextarea === "function") {
      autoGrowTextarea(textarea);
    }
  });
  const modalContent = overlay.querySelector("[data-modal-content]");
  if (modalContent) {
    modalContent.setAttribute("role", "dialog");
    modalContent.setAttribute("aria-modal", "true");
    modalContent.setAttribute("aria-label", "Modifier la réponse");
  }
  const form = overlay.querySelector("form");
  const cancelBtn = overlay.querySelector("[data-cancel]");
  const clearBtn = overlay.querySelector("[data-clear]");
  const submitBtn = form?.querySelector('button[type="submit"]');
  const restoreFocus = () => {
    if (trigger && typeof trigger.focus === "function") {
      try {
        trigger.focus({ preventScroll: true });
      } catch (_) {
        trigger.focus();
      }
    }
  };
  let handleKeyDown = null;
  const cleanup = () => {
    if (handleKeyDown) {
      document.removeEventListener("keydown", handleKeyDown, true);
      handleKeyDown = null;
    }
  };
  const closeOverlay = () => {
    cleanup();
    overlay.remove();
    restoreFocus();
  };
  handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeOverlay();
    }
  };
  document.addEventListener("keydown", handleKeyDown, true);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeOverlay();
    }
  });
  cancelBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    closeOverlay();
  });
  if (clearBtn) {
    const hasInitialChildValue = baseChildStates.some((childState) =>
      hasValueForConsigne(childState.consigne, childState.value),
    );
    // Allow clearing when a bilan entry exists even if it has no textual content
    const hadStoredEntry = Boolean(entry);
    const hasInitialData = hadStoredEntry || parentInitialHasValue || hasInitialChildValue;
    if (!hasInitialData) {
      clearBtn.disabled = true;
    }
    clearBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!confirm("Effacer la réponse pour cette date ?")) {
        return;
      }
      clearBtn.disabled = true;
      if (submitBtn) submitBtn.disabled = true;
      try {
        await Schema.deleteHistoryEntry(ctx.db, ctx.user.uid, consigne.id, historyDocumentId, responseSyncOptions);
        // Clear local recent cache so Historique reflects deletion
        try { removeRecentResponsesForDay(consigne.id, resolvedDayKey); } catch (e) {}
        // Remove any other response docs for this consigne/day (e.g., duplicate or bilan-mirrored)
        try { await deleteAllResponsesForDay(ctx.db, ctx.user.uid, consigne.id, resolvedDayKey); } catch (e) {}
        // If this entry is a bilan-backed summary, delete the summary answer to avoid reappearance
        try {
          const scope = entry?.summaryScope || entry?.periodScope || "";
          const periodKey = entry?.summaryPeriod || entry?.periodKey || "";
          const answerKey = entry?.summaryKey || "";
          if (scope && periodKey && answerKey && Schema?.deleteSummaryAnswer) {
            await Schema.deleteSummaryAnswer(ctx.db, ctx.user.uid, scope, periodKey, answerKey);
          }
        } catch (err) {
          console.error("consigne.history.editor.clear.summaryDelete", err);
        }
        const status = dotColor(consigne.type, "", consigne) || "na";
        updateConsigneHistoryTimeline(row, status, {
          consigne,
          value: "",
          dayKey: resolvedDayKey,
          historyId: historyDocumentId,
          responseId: responseSyncOptions?.responseId || "",
          iterationLabel,
          remove: true,
        });
        triggerConsigneRowUpdateHighlight(row);
        for (const childState of baseChildStates) {
          try {
            await Schema.deleteHistoryEntry(
              ctx.db,
              ctx.user.uid,
              childState.consigne.id,
              childState.historyDocumentId,
              childState.responseSyncOptions,
            );
            try { removeRecentResponsesForDay(childState.consigne.id, resolvedDayKey); } catch (e) {}
            try { await deleteAllResponsesForDay(ctx.db, ctx.user.uid, childState.consigne.id, resolvedDayKey); } catch (e) {}
            // Also handle child summary deletion
            try {
              const cEntry = childState.entry || null;
              const cScope = cEntry?.summaryScope || cEntry?.periodScope || "";
              const cPeriodKey = cEntry?.summaryPeriod || cEntry?.periodKey || "";
              const cAnswerKey = cEntry?.summaryKey || "";
              if (cScope && cPeriodKey && cAnswerKey && Schema?.deleteSummaryAnswer) {
                await Schema.deleteSummaryAnswer(ctx.db, ctx.user.uid, cScope, cPeriodKey, cAnswerKey);
              }
            } catch (err) {
              console.error("consigne.history.child.clear.summaryDelete", err);
            }
          } catch (error) {
            console.error("consigne.history.child.clear", error);
          }
          const childStatus = dotColor(childState.consigne.type, "", childState.consigne) || "na";
          if (childState.row) {
            updateConsigneHistoryTimeline(childState.row, childStatus, {
              consigne: childState.consigne,
              value: "",
              dayKey: resolvedDayKey,
              historyId: childState.historyDocumentId,
              responseId: childState.responseSyncOptions?.responseId || "",
              iterationLabel,
              remove: true,
            });
            triggerConsigneRowUpdateHighlight(childState.row);
          }
        }
        showToast("Réponses effacées.");
        closeOverlay();
        flushHistoryPanelRefresh();
        // Clear local recent cache and notify global listeners so "global history" views refresh
        try { clearRecentResponsesForConsigne(consigne.id); } catch (_) {}
        try {
          if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('consigne:history:refresh', { detail: { consigneId: consigne.id } }));
          }
        } catch (_) {}
      } catch (error) {
        console.error("consigne.history.editor.clear", error);
        clearBtn.disabled = false;
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!submitBtn || submitBtn.disabled) {
      return;
    }
    submitBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    try {
      const rawValue = readConsigneValueFromForm(consigne, form);
      const parentHasValue = hasValueForConsigne(consigne, rawValue);
      const childResults = baseChildStates.map((childState) => {
        const childNode = form.querySelector(`[data-history-child="${childState.domId}"]`);
        const childValue = childNode
          ? readConsigneValueFromForm(childState.consigne, childNode)
          : "";
        const hasValue = hasValueForConsigne(childState.consigne, childValue);
        return {
          state: childState,
          value: childValue,
          hasValue,
        };
      });
      if (!parentHasValue) {
        await Schema.deleteHistoryEntry(ctx.db, ctx.user.uid, consigne.id, historyDocumentId, responseSyncOptions);
        try { removeRecentResponsesForDay(consigne.id, resolvedDayKey); } catch (e) {}
        try { await deleteAllResponsesForDay(ctx.db, ctx.user.uid, consigne.id, resolvedDayKey); } catch (e) {}
        // Also delete summary answer if this entry originated from a bilan
        try {
          const scope = entry?.summaryScope || entry?.periodScope || "";
          const periodKey = entry?.summaryPeriod || entry?.periodKey || "";
          const answerKey = entry?.summaryKey || "";
          if (scope && periodKey && answerKey && Schema?.deleteSummaryAnswer) {
            await Schema.deleteSummaryAnswer(ctx.db, ctx.user.uid, scope, periodKey, answerKey);
          }
        } catch (err) {
          console.error("consigne.history.editor.save.summaryDelete", err);
        }
      } else {
        await Schema.saveHistoryEntry(
          ctx.db,
          ctx.user.uid,
          consigne.id,
          historyDocumentId,
          { value: rawValue },
          responseSyncOptions,
        );
        try { removeRecentResponsesForDay(consigne.id, resolvedDayKey); } catch (e) {}
      }
      const parentStatus = dotColor(
        consigne.type,
        parentHasValue ? rawValue : "",
        consigne,
      ) || "na";
      updateConsigneHistoryTimeline(row, parentStatus, {
        consigne,
        value: parentHasValue ? rawValue : "",
        dayKey: resolvedDayKey,
        iterationLabel,
        historyId: historyDocumentId,
        responseId: responseSyncOptions?.responseId || "",
        remove: parentHasValue ? false : true,
      });
      triggerConsigneRowUpdateHighlight(row);
      for (const { state, value, hasValue } of childResults) {
        if (!hasValue) {
          await Schema.deleteHistoryEntry(
            ctx.db,
            ctx.user.uid,
            state.consigne.id,
            state.historyDocumentId,
            state.responseSyncOptions,
          );
          try { removeRecentResponsesForDay(state.consigne.id, resolvedDayKey); } catch (e) {}
          try { await deleteAllResponsesForDay(ctx.db, ctx.user.uid, state.consigne.id, resolvedDayKey); } catch (e) {}
          // Delete child summary answer if present
          try {
            const cEntry = state.entry || null;
            const cScope = cEntry?.summaryScope || cEntry?.periodScope || "";
            const cPeriodKey = cEntry?.summaryPeriod || cEntry?.periodKey || "";
            const cAnswerKey = cEntry?.summaryKey || "";
            if (cScope && cPeriodKey && cAnswerKey && Schema?.deleteSummaryAnswer) {
              await Schema.deleteSummaryAnswer(ctx.db, ctx.user.uid, cScope, cPeriodKey, cAnswerKey);
            }
          } catch (err) {
            console.error("consigne.history.child.save.summaryDelete", err);
          }
        } else {
          await Schema.saveHistoryEntry(
            ctx.db,
            ctx.user.uid,
            state.consigne.id,
            state.historyDocumentId,
            { value },
            state.responseSyncOptions,
          );
          try { removeRecentResponsesForDay(state.consigne.id, resolvedDayKey); } catch (e) {}
        }
        const childStatus = dotColor(
          state.consigne.type,
          hasValue ? value : "",
          state.consigne,
        ) || "na";
        if (state.row) {
          updateConsigneHistoryTimeline(state.row, childStatus, {
            consigne: state.consigne,
            value: hasValue ? value : "",
            dayKey: resolvedDayKey,
            iterationLabel,
            historyId: state.historyDocumentId,
            responseId: state.responseSyncOptions?.responseId || "",
            remove: hasValue ? false : true,
          });
          triggerConsigneRowUpdateHighlight(state.row);
        }
      }
      const childCleared = childResults.some(
        ({ state, hasValue }) => !hasValue && state.initialHasValue,
      );
      const allValuesCleared = !parentHasValue && !childResults.some(({ hasValue }) => hasValue);
      const toastMessage = allValuesCleared
        ? "Réponses effacées."
        : childCleared || (!parentHasValue && parentInitialHasValue)
        ? "Réponses mises à jour."
        : "Réponses enregistrées.";
      showToast(toastMessage);
      closeOverlay();
      flushHistoryPanelRefresh();
      // Clear local recent cache and notify global listeners so "global history" views refresh
      try { clearRecentResponsesForConsigne(consigne.id); } catch (_) {}
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('consigne:history:refresh', { detail: { consigneId: consigne.id } }));
        }
      } catch (_) {}
    } catch (error) {
      console.error("consigne.history.editor.save", error);
      submitBtn.disabled = false;
      if (clearBtn) clearBtn.disabled = false;
    }
  });
}

function renderConsigneHistoryTimeline(row, points) {
  const container = row?.querySelector?.("[data-consigne-history]");
  const track = row?.querySelector?.("[data-consigne-history-track]");
  
  if (!container || !track) {
    return false;
  }
  track.innerHTML = "";
  track.setAttribute("role", "list");
  track.setAttribute("aria-label", "Historique des derniers jours");
  if (!Array.isArray(points) || !points.length) {
    container.hidden = true;
    track.dataset.historyMode = "empty";
    return false;
  }
  
  points.forEach((point, index) => {
    const item = document.createElement("div");
    item.className = "consigne-history__item";
    item.setAttribute("role", "listitem");
    applyConsigneHistoryPoint(item, point);
    track.appendChild(item);
  });
  
  container.hidden = false;
  track.dataset.historyMode = "day";
  return true;
}

function updateConsigneHistoryTimeline(row, status, options = {}) {
  const state = CONSIGNE_HISTORY_ROW_STATE.get(row);
  if (!state || !state.track) {
    return;
  }
  // If explicitly asked to remove the encard for this day, do so and update container state
  if (options && options.remove === true) {
    const normalizedHistoryId =
      typeof options.historyId === "string" && options.historyId.trim() ? options.historyId.trim() : "";
    const normalizedResponseId =
      typeof options.responseId === "string" && options.responseId.trim() ? options.responseId.trim() : "";
    const resolveDayKey = () => {
      if (typeof options.dayKey === "string" && options.dayKey.trim()) {
        return options.dayKey.trim();
      }
      if (typeof state.resolveDayKey === "function") {
        try {
          const resolved = state.resolveDayKey();
          if (typeof resolved === "string" && resolved.trim()) {
            return resolved.trim();
          }
        } catch (_) {}
      }
      if (row?.dataset?.dayKey) {
        const fromDataset = row.dataset.dayKey.trim();
        if (fromDataset) {
          return fromDataset;
        }
      }
      if (typeof state.dayKey === "string" && state.dayKey.trim()) {
        return state.dayKey.trim();
      }
      if (typeof Schema?.todayKey === "function") {
        const today = Schema.todayKey();
        if (typeof today === "string" && today.trim()) {
          return today.trim();
        }
      }
      return null;
    };
    const dayKey = resolveDayKey();
    let item = null;
    if (normalizedHistoryId) {
      item = state.track.querySelector(`[data-history-id="${escapeTimelineSelector(normalizedHistoryId)}"]`);
    }
    if (!item && normalizedResponseId) {
      item = state.track.querySelector(
        `[data-history-response-id="${escapeTimelineSelector(normalizedResponseId)}"]`,
      );
    }
    if (!item && dayKey) {
      item = state.track.querySelector(`[data-history-day="${escapeTimelineSelector(dayKey)}"]`);
    }
    const removeLogPayload = {
      consigneId: options?.consigne?.id ?? null,
      dayKey,
      historyId: normalizedHistoryId,
      responseId: normalizedResponseId,
    };
    if (item) {
      item.remove();
      logChecklistEvent("info", "[checklist-history] timeline.remove", removeLogPayload);
    } else {
      logChecklistEvent("warn", "[checklist-history] timeline.remove.missing", removeLogPayload);
    }
    // If no more items, hide the container and mark as empty
    if (!state.track.children.length) {
      if (state.container) state.container.hidden = true;
      state.track.dataset.historyMode = "empty";
      state.hasDayTimeline = false;
    }
    scheduleConsigneHistoryNavUpdate(state);
    return;
  }
  const resolveStateDayKey = () => {
    if (typeof options.dayKey === "string" && options.dayKey.trim()) {
      return options.dayKey.trim();
    }
    if (typeof state.resolveDayKey === "function") {
      try {
        const resolved = state.resolveDayKey();
        if (typeof resolved === "string" && resolved.trim()) {
          return resolved.trim();
        }
      } catch (_) {}
    }
    if (row?.dataset?.dayKey) {
      const fromDataset = row.dataset.dayKey.trim();
      if (fromDataset) {
        return fromDataset;
      }
    }
    if (typeof state.dayKey === "string" && state.dayKey.trim()) {
      return state.dayKey.trim();
    }
    // Prefer the page's selected date (URL ?d) or AppCtx before falling back to today
    try {
      const url = new URL(window.location.href);
      const qd = url.searchParams.get("d");
      if (typeof qd === "string" && qd.trim()) {
        return qd.trim();
      }
    } catch (_) {}
    if (typeof window !== "undefined" && window.AppCtx && typeof window.AppCtx.dateIso === "string") {
      const fromCtx = window.AppCtx.dateIso.trim();
      if (fromCtx) {
        return fromCtx;
      }
    }
    if (typeof Schema?.todayKey === "function") {
      const today = Schema.todayKey();
      if (typeof today === "string" && today.trim()) {
        return today.trim();
      }
    }
    return null;
  };
  const dayKey = resolveStateDayKey();
  if (!dayKey) {
    return;
  }
  state.dayKey = dayKey;
  if (row) {
    if (dayKey) {
      row.dataset.dayKey = dayKey;
    } else {
      delete row.dataset.dayKey;
    }
  }
  logChecklistEvent("info", "[checklist-history] timeline.update", {
    consigneId: options?.consigne?.id ?? null,
    dayKey,
    status,
    remove: options?.remove === true,
    historyId: options?.historyId || "",
    responseId: options?.responseId || "",
  });
  const selector = `[data-history-day="${escapeTimelineSelector(dayKey)}"]`;
  const normalizedHistoryId =
    typeof options.historyId === "string" && options.historyId.trim() ? options.historyId.trim() : "";
  const normalizedResponseId =
    typeof options.responseId === "string" && options.responseId.trim() ? options.responseId.trim() : "";
  let item = null;
  if (normalizedHistoryId) {
    item = state.track.querySelector(`[data-history-id="${escapeTimelineSelector(normalizedHistoryId)}"]`);
  }
  if (!item && normalizedResponseId) {
    item = state.track.querySelector(
      `[data-history-response-id="${escapeTimelineSelector(normalizedResponseId)}"]`,
    );
  }
  const wasMissingItem = !item;
  if (!item) {
    item = state.track.querySelector(selector);
  }
  // Use only dayKey (page date), ignore recording date
  const date = modesParseDayKeyToDate(dayKey);
  const existingDetails = item?._historyDetails || null;
  const consigne = options.consigne || null;
  const effectiveValue = options.value !== undefined ? options.value : existingDetails?.rawValue ?? null;
  const providedNote = typeof options.note === "string" ? options.note : null;
  const derivedNote = providedNote || extractTextualNote(effectiveValue);
  const practiceMode = typeof consigne?.mode === "string" && consigne.mode.trim().toLowerCase() === "practice";
  const iterationIndex = practiceMode ? practiceIterationIndexFromKey(dayKey) : null;
  const iterationNumber = iterationIndex != null ? iterationIndex + 1 : existingDetails?.iterationNumber ?? null;
  let iterationLabel = typeof options.iterationLabel === "string" ? options.iterationLabel : "";
  if (!iterationLabel && typeof existingDetails?.iterationLabel === "string") {
    iterationLabel = existingDetails.iterationLabel;
  }
  iterationLabel = sanitizeIterationLabel(iterationLabel, iterationNumber);
  const providedIsBilan = options.isBilan === true || existingDetails?.isBilan === true;
  const resolvedHistoryId = (() => {
    if (normalizedHistoryId) {
      return normalizedHistoryId;
    }
    const fromExisting =
      (typeof existingDetails?.historyId === "string" && existingDetails.historyId.trim()
        ? existingDetails.historyId.trim()
        : "") ||
      (typeof existingDetails?.history_id === "string" && existingDetails.history_id.trim()
        ? existingDetails.history_id.trim()
        : "") ||
      (typeof item?.dataset?.historyId === "string" && item.dataset.historyId.trim()
        ? item.dataset.historyId.trim()
        : "");
    return fromExisting || "";
  })();
  const resolvedResponseId = (() => {
    if (normalizedResponseId) {
      return normalizedResponseId;
    }
    const fromExisting =
      (typeof existingDetails?.responseId === "string" && existingDetails.responseId.trim()
        ? existingDetails.responseId.trim()
        : "") ||
      (typeof existingDetails?.response_id === "string" && existingDetails.response_id.trim()
        ? existingDetails.response_id.trim()
        : "") ||
      (typeof item?.dataset?.historyResponseId === "string" && item.dataset.historyResponseId.trim()
        ? item.dataset.historyResponseId.trim()
        : "");
    return fromExisting || "";
  })();
  const record = {
    dayKey,
    date: null, // FORCE: null to ignore recording dates, use only dayKey
    status,
    value: effectiveValue,
    note: derivedNote || existingDetails?.note || "",
    timestamp:
      existingDetails?.timestamp || (date ? date.getTime() : iterationIndex != null ? iterationIndex : Date.now()),
    isPlaceholder: false,
    isBilan: providedIsBilan,
    iterationIndex: iterationIndex != null ? iterationIndex : existingDetails?.iterationIndex ?? null,
    iterationNumber,
    iterationLabel,
    historyId: resolvedHistoryId,
    responseId: resolvedResponseId,
  };
  if (!item) {
    item = document.createElement("div");
    item.className = "consigne-history__item";
    item.setAttribute("role", "listitem");
    state.track.insertBefore(item, state.track.firstElementChild || null);
    logChecklistEvent("info", "[checklist-history] timeline.create", {
      consigneId: consigne?.id ?? null,
      dayKey,
      status,
      historyId: resolvedHistoryId,
      responseId: resolvedResponseId,
    });
  } else if (wasMissingItem) {
    logChecklistEvent("info", "[checklist-history] timeline.attach", {
      consigneId: consigne?.id ?? null,
      dayKey,
      status,
      historyId: resolvedHistoryId,
      responseId: resolvedResponseId,
    });
  }
  const fallbackTitle = buildHistoryTimelineTitle(date, dayKey, status);
  const fallbackLabels = buildHistoryTimelineLabels(date, dayKey);
  const point =
    formatConsigneHistoryPoint(record, consigne) ||
    {
      dayKey,
      date,
      status,
      title: iterationLabel
        ? STATUS_LABELS[status]
          ? `${iterationLabel} — ${STATUS_LABELS[status]}`
          : iterationLabel
        : fallbackTitle,
      srLabel: iterationLabel || fallbackTitle,
      label: iterationLabel || fallbackLabels.label,
      weekdayLabel: iterationLabel ? "" : fallbackLabels.weekday,
      isPlaceholder: false,
      isBilan: providedIsBilan,
      details: {
        dayKey: dayKey || "",
        date,
        label: iterationLabel || fallbackLabels.label || "",
        weekdayLabel: iterationLabel ? "" : fallbackLabels.weekday || "",
        fullDateLabel: iterationLabel || fallbackLabels.label || dayKey || "",
        status,
        statusLabel: STATUS_LABELS[status] || "",
        valueHtml: "",
        valueText: "",
        note: derivedNote || existingDetails?.note || "",
        hasContent: Boolean(derivedNote || (existingDetails?.note ?? "")),
        rawValue: record.value,
        iterationIndex: record.iterationIndex ?? null,
        iterationNumber: record.iterationNumber ?? null,
        iterationLabel: iterationLabel || "",
        isPractice: practiceMode,
        isBilan: providedIsBilan,
        timestamp: record.timestamp,
        historyId: resolvedHistoryId,
        responseId: resolvedResponseId,
      },
      historyId: resolvedHistoryId,
      responseId: resolvedResponseId,
    };
  applyConsigneHistoryPoint(item, point);
  state.track.dataset.historyMode = "day";
  state.hasDayTimeline = true;
  if (state.container) {
    state.container.hidden = false;
  }
  while (state.track.children.length > state.limit) {
    state.track.removeChild(state.track.lastElementChild);
  }
  scheduleConsigneHistoryNavUpdate(state);
}

function setupConsigneHistoryTimeline(row, consigne, ctx, options = {}) {
  if (!row || !consigne) {
    return;
  }
  const container = row.querySelector("[data-consigne-history]");
  const track = row.querySelector("[data-consigne-history-track]");
  if (!container || !track) {
    return;
  }
  const previousState = CONSIGNE_HISTORY_ROW_STATE.get(row);
  if (previousState) {
    try {
      previousState.resizeObserver?.disconnect?.();
    } catch (_) {}
    if (previousState.viewport && previousState.viewportScrollHandler) {
      try {
        previousState.viewport.removeEventListener("scroll", previousState.viewportScrollHandler);
      } catch (_) {}
    }
  }
  let explicitDayKey = "";
  if (typeof options.dayKey === "string") {
    const trimmed = options.dayKey.trim();
    if (trimmed) {
      explicitDayKey = trimmed;
    }
  }
  if (!explicitDayKey && row?.dataset?.dayKey) {
    const trimmedDataset = row.dataset.dayKey.trim();
    if (trimmedDataset) {
      explicitDayKey = trimmedDataset;
    }
  }
  const resolveDayKey = typeof options.resolveDayKey === "function" ? options.resolveDayKey : null;
  const viewport = row.querySelector("[data-consigne-history-viewport]") || container;
  const navPrev = row.querySelector("[data-consigne-history-prev]") || null;
  const navNext = row.querySelector("[data-consigne-history-next]") || null;
  const state = {
    track,
    container,
    viewport,
    navPrev,
    navNext,
    hasDayTimeline: false,
    limit: CONSIGNE_HISTORY_TIMELINE_DAY_COUNT,
    dayKey: explicitDayKey,
    resolveDayKey,
  };
  setupConsigneHistoryNavigation(state);
  CONSIGNE_HISTORY_ROW_STATE.set(row, state);
  // Ne pas afficher la timeline avec des données vides - attendre les vraies données
  state.hasDayTimeline = false;
  scheduleConsigneHistoryNavUpdate(state);
  if (!ctx?.db || !ctx?.user?.uid || !consigne?.id) {
    return;
  }
  const timelineFetchLimit = Math.max(CONSIGNE_HISTORY_TIMELINE_DAY_COUNT * 3, 60);
  fetchConsigneHistoryRows(ctx, consigne.id, { limit: timelineFetchLimit })
    .then((result) => {
      if (!row.isConnected) {
        return;
      }
      if (result.error) {
        try {
          modesLogger?.warn?.("consigne.history.timeline", result.error);
        } catch (_) {}
        scheduleConsigneHistoryNavUpdate(state);
        return;
      }
      if (Array.isArray(result.missing) && result.missing.length) {
        scheduleConsigneHistoryNavUpdate(state);
        return;
      }
      const entries = Array.isArray(result.rows) ? result.rows : [];
      const points = buildConsigneHistoryTimeline(entries, consigne);
      state.hasDayTimeline = renderConsigneHistoryTimeline(row, points);
      scheduleConsigneHistoryNavUpdate(state);
    })
    .catch((error) => {
      try {
        modesLogger?.warn?.("consigne.history.timeline", error);
      } catch (_) {}
      scheduleConsigneHistoryNavUpdate(state);
    });
  const handleHistoryActivation = (event) => {
    const isKeyboard = event.type === "keydown";
    if (isKeyboard && event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") {
      return;
    }
    const target = event.target.closest(".consigne-history__item");
    
    if (!target || !state.track.contains(target)) {
      return;
    }
    const rawDetails = target._historyDetails || null;
    // Prefer internal details.dayKey (set at render) over dataset to avoid any later DOM-side overwrites
    const historyDayKey =
      (rawDetails && typeof rawDetails.dayKey === "string" && rawDetails.dayKey.trim()
        ? rawDetails.dayKey.trim()
        : "") ||
      (typeof target.dataset.historyDay === "string" && target.dataset.historyDay.trim()
        ? target.dataset.historyDay.trim()
        : "");
    const isBilanPoint = target.dataset.historySource === "bilan" || rawDetails?.isBilan === true;
    const isSummaryPoint =
      !isBilanPoint && (target.dataset.historySource === "summary" || rawDetails?.isSummary === true);
    const bilanDayKey = isBilanPoint
      ? historyDayKey ||
        (typeof rawDetails?.dayKey === "string" && rawDetails.dayKey.trim() ? rawDetails.dayKey.trim() : "")
      : "";
    const responseIdCandidate =
      typeof rawDetails?.responseId === "string" && rawDetails.responseId.trim()
        ? rawDetails.responseId.trim()
        : typeof target.dataset.historyResponseId === "string" && target.dataset.historyResponseId.trim()
        ? target.dataset.historyResponseId.trim()
        : "";
    const historyIdCandidate =
      typeof rawDetails?.historyId === "string" && rawDetails.historyId.trim()
        ? rawDetails.historyId.trim()
        : typeof target.dataset.historyId === "string" && target.dataset.historyId.trim()
        ? target.dataset.historyId.trim()
        : "";
    if (isBilanPoint && bilanDayKey) {
      if (isKeyboard) {
        event.preventDefault();
      }
      void openBilanHistoryEditor(row, consigne, ctx, {
        dayKey: bilanDayKey,
        details: rawDetails,
        trigger: target,
        responseId: responseIdCandidate,
        historyId: historyIdCandidate,
        expectedSummary: summarizeChecklistValue(rawDetails?.rawValue ?? rawDetails?.value ?? null),
      });
      return;
    }
    if (historyDayKey) {
      if (isKeyboard) {
        event.preventDefault();
      }
      const historySource =
        typeof options.mode === "string" && options.mode.trim().toLowerCase() === "practice" ? "practice" : "daily";
      let timelineSummary = null;
      if (consigne.type === "checklist") {
        timelineSummary = summarizeChecklistValue(rawDetails?.rawValue ?? rawDetails?.value);
        logChecklistHistoryInspection(consigne, {
          label: "timeline:click",
          focusDayKey: historyDayKey,
          timelineDetails: {
            summary: timelineSummary,
            responseId: responseIdCandidate,
            historyId: historyIdCandidate,
            rawValue: rawDetails?.rawValue ?? rawDetails?.value ?? null,
          },
          entries: [],
        });
      }
      if (isSummaryPoint) {
        void openHistory(ctx, consigne, {
          source: historySource,
          focusDayKey: historyDayKey,
          autoEdit: false,
        });
        return;
      }
      if (EDITABLE_HISTORY_TYPES.has(consigne.type)) {
        console.log("[DEBUG] Opening history editor for day:", historyDayKey, "consigne:", consigne.id, "type:", consigne.type);
        void openConsigneHistoryEntryEditor(row, consigne, ctx, {
          dayKey: historyDayKey,
          details: rawDetails,
          trigger: target,
          source: historySource,
          responseId: responseIdCandidate,
          historyId: historyIdCandidate,
          panelEntry: row,
          expectedSummary: timelineSummary,
        });
      } else {
        void openHistory(ctx, consigne, {
          source: historySource,
          focusDayKey: historyDayKey,
          autoEdit: false,
        });
      }
      return;
    }
    if (isKeyboard) {
      event.preventDefault();
    }
    let details = rawDetails ? { ...rawDetails } : null;
    if (!details) {
      const historyDay = target.dataset.historyDay || null;
      const parsedDate = historyDay ? modesParseDayKeyToDate(historyDay) : null;
      const fallbackPoint = formatConsigneHistoryPoint(
        {
          dayKey: historyDay,
          date: parsedDate || null,
          status: target.dataset.status || "na",
          value: null,
          note: "",
          timestamp: parsedDate instanceof Date && !Number.isNaN(parsedDate.getTime()) ? parsedDate.getTime() : Date.now(),
          isPlaceholder: target.dataset.placeholder === "1",
        },
        consigne,
      );
      details = fallbackPoint?.details ? { ...fallbackPoint.details } : null;
    }
    if (!details) {
      return;
    }
    openConsigneHistoryPointDialog(consigne, details);
  };
  state.track.addEventListener("click", handleHistoryActivation);
  state.track.addEventListener("keydown", handleHistoryActivation);
  row.addEventListener("consigne-status-changed", (event) => {
    const status = event?.detail?.status;
    if (typeof status !== "string" || !status) {
      return;
    }
    updateConsigneHistoryTimeline(row, status, {
      consigne,
      value: event?.detail?.value,
      note: event?.detail?.note,
      dayKey: event?.detail?.dayKey,
    });
  });
}

const consigneRowUpdateTimers = new WeakMap();
const CONSIGNE_ROW_UPDATE_DURATION = 900;

function clearConsigneRowUpdateHighlight(row) {
  if (!row) return;
  const timer = consigneRowUpdateTimers.get(row);
  if (timer) {
    clearTimeout(timer);
    consigneRowUpdateTimers.delete(row);
  }
  row.classList.remove("consigne-row--updated");
}

function triggerConsigneRowUpdateHighlight(row) {
  if (!row) return;
  clearConsigneRowUpdateHighlight(row);
  // Force a reflow to ensure the animation restarts if triggered rapidly.
  void row.offsetWidth;
  row.classList.add("consigne-row--updated");
  const timeoutId = setTimeout(() => {
    row.classList.remove("consigne-row--updated");
    consigneRowUpdateTimers.delete(row);
  }, CONSIGNE_ROW_UPDATE_DURATION);
  consigneRowUpdateTimers.set(row, timeoutId);
}

function updateConsigneStatusUI(row, consigne, rawValue) {
  if (!row || !consigne) return;
  const skipFlag = row.dataset.skipAnswered === "1";
  const valueForStatus = skipFlag && (!(rawValue && typeof rawValue === "object" && rawValue.skipped))
    ? { skipped: true }
    : rawValue;
  let status = dotColor(consigne.type, valueForStatus, consigne);
  try {
    modesLogger?.debug?.("consigne.status.update", {
      consigneId: consigne?.id ?? null,
      skip: Boolean(skipFlag),
      status,
    });
  } catch (_) {}
  if (status === "na" && row.dataset.childAnswered === "1") {
    status = "note";
  }
  if (consigne.type === "checklist") {
    const highlight =
      checklistIsComplete(valueForStatus) ||
      (valueForStatus && typeof valueForStatus === "object" && valueForStatus.skipped === true);
    if (highlight) {
      row.classList.add("consigne-row--validated");
    } else {
      row.classList.remove("consigne-row--validated");
    }
  } else {
    row.classList.remove("consigne-row--validated");
  }
  const statusHolder = row.querySelector("[data-status]");
  const dot = row.querySelector("[data-status-dot]");
  const mark = row.querySelector("[data-status-mark]");
  const live = row.querySelector("[data-status-live]");
  const tone = row.dataset.priorityTone || priorityTone(consigne.priority);
  if (tone) {
    row.dataset.priorityTone = tone;
    if (statusHolder) {
      statusHolder.dataset.priorityTone = tone;
    }
    if (dot) {
      dot.dataset.priorityTone = tone;
    }
  }
  row.dataset.status = status;
  if (statusHolder) {
    statusHolder.dataset.status = status;
    statusHolder.setAttribute("data-status", status);
  }
  if (dot) {
    dot.className = `consigne-row__dot consigne-row__dot--${status}`;
  }
  if (mark) {
    const isAnswered = status !== "na";
    mark.classList.toggle("consigne-row__mark--checked", isAnswered);
  }
  let textualNote = "";
  if (live) {
    textualNote = extractTextualNote(valueForStatus);
    const isNoteStatus = status === "note";
    const baseHasValue = (() => {
      if (skipFlag) return true;
      if (consigne.type === "long") {
        return richTextHasContent(valueForStatus);
      }
      if (consigne.type === "checklist") {
        if (valueForStatus && typeof valueForStatus === "object" && valueForStatus.__hasAnswer) {
          return true;
        }
        return hasChecklistResponse(consigne, row, valueForStatus);
      }
      return !(valueForStatus === null || valueForStatus === undefined || valueForStatus === "");
    })();
    const hasValue = isNoteStatus ? textualNote.length > 0 || baseHasValue : baseHasValue;
    const formattedValue = (() => {
      if (isNoteStatus) {
        if (textualNote) return textualNote;
        const fallback = formatConsigneValue(consigne.type, valueForStatus, { consigne });
        if (fallback === null || fallback === undefined || fallback === "" || fallback === "—") {
          return skipFlag ? "Passée" : "Réponse enregistrée";
        }
        return fallback;
      }
      if (consigne.type === "info") return INFO_RESPONSE_LABEL;
      if (!hasValue) return "Sans donnée";
      const result = formatConsigneValue(consigne.type, valueForStatus, { consigne });
      if (result === null || result === undefined || result === "" || result === "—") {
        return skipFlag ? "Passée" : "Réponse enregistrée";
      }
      return result;
    })();
    const label = STATUS_LABELS[status] || "Valeur";
    live.textContent = `${label}: ${formattedValue}`;
  }
  if (status === "na") {
    clearConsigneRowUpdateHighlight(row);
  } else {
    triggerConsigneRowUpdateHighlight(row);
  }
  if (typeof CustomEvent === "function") {
    row.dispatchEvent(new CustomEvent("consigne-status-changed", {
      detail: {
        status,
        consigne,
        value: rawValue,
        note: textualNote,
        dayKey: row?.dataset?.dayKey || null,
      },
    }));
  }
}

function readConsigneCurrentValue(consigne, scope) {
  if (!consigne || !scope) return "";
  const id = consigne.id;
  const type = consigne.type;
  if (type === "info") return "";
  if (type === "short") {
    const input = scope.querySelector(`[name="short:${id}"]`);
    return input ? input.value.trim() : "";
  }
  if (type === "long") {
    const hidden = scope.querySelector(`[name="long:${id}"]`);
    if (hidden) {
      return normalizeRichTextValue(hidden.value || "");
    }
    const editor = scope.querySelector(`[data-rich-text-root][data-consigne-id="${String(id ?? "")}"]`);
    if (editor) {
      const content = editor.querySelector("[data-rich-text-content]");
      const html = content ? content.innerHTML : "";
      return normalizeRichTextValue({ html });
    }
    return normalizeRichTextValue("");
  }
  if (type === "num") {
    const range = scope.querySelector(`[name="num:${id}"]`);
    if (!range || range.value === "" || range.value == null) return "";
    const num = Number(range.value);
    return Number.isFinite(num) ? num : "";
  }
  if (type === "montant") {
    const input = scope.querySelector(`[name="montant:${id}"]`);
    if (!input || input.value === "" || input.value == null) {
      return "";
    }
    const amount = Number(input.value);
    if (!Number.isFinite(amount)) {
      return "";
    }
    return buildMontantValue(consigne, amount);
  }
  if (type === "likert5") {
    const select = scope.querySelector(`[name="likert5:${id}"]`);
    if (!select || select.value === "" || select.value == null) return "";
    const num = Number(select.value);
    return Number.isFinite(num) ? num : "";
  }
  if (type === "yesno") {
    const select = scope.querySelector(`[name="yesno:${id}"]`);
    return select ? select.value : "";
  }
  if (type === "likert6") {
    const select = scope.querySelector(`[name="likert6:${id}"]`);
    return select ? select.value : "";
  }
  if (type === "checklist") {
    const hidden = scope.querySelector(`[name="checklist:${id}"]`);
    let parsedValues = null;
    let isDirty = false;
    if (hidden) {
      isDirty = hidden.dataset?.dirty === "1";
      try {
        const parsed = JSON.parse(hidden.value || "[]");
        const value = buildChecklistValue(consigne, parsed);
        const items = Array.isArray(value?.items) ? value.items : [];
        const skipped = Array.isArray(value?.skipped) ? value.skipped : [];
        const hasMeaningfulState =
          items.some(Boolean) || skipped.some(Boolean) || (value && value.__hasAnswer === true);
        if (!isDirty && !hasMeaningfulState) {
          return null;
        }
        return value;
      } catch (error) {
        console.warn("readConsigneCurrentValue:checklist", error);
      }
    }
    const container = scope.querySelector(
      `[data-checklist-root][data-consigne-id="${String(id ?? "")}"]`
    );
    if (container) {
      const domState = readChecklistDomState(container);
      if (domState.items.length) {
        const isDirty = container.dataset && container.dataset.checklistDirty === "1";
        const hasMeaningfulState =
          domState.items.some((checked, index) => checked && !domState.skipped[index]) ||
          domState.skipped.some(Boolean);
        if (!isDirty && !hasMeaningfulState) {
          return null;
        }
        return buildChecklistValue(consigne, domState);
      }
    }
    return buildChecklistValue(consigne, []);
  }
  const input = scope.querySelector(`[name$=":${id}"]`);
  return input ? input.value : "";
}

function enhanceRangeMeters(scope) {
  if (!scope) return;
  const sliders = scope.querySelectorAll('input[type="range"][name^="num:"]');
  sliders.forEach((slider) => {
    const meter = scope.querySelector(`[data-meter="${slider.name}"]`);
    if (!meter) return;
    const sync = () => {
      meter.textContent = slider.value;
    };
    slider.addEventListener("input", sync);
    slider.addEventListener("change", sync);
    sync();
  });
}

function initializeChecklistScope(scope, { consigneId = null, dateKey = null } = {}) {
  if (!scope) return;

  const collectRoots = (target) => {
    const roots = [];
    if (!target) return roots;
    if (target instanceof Element) {
      if (target.matches("[data-checklist-root]")) {
        roots.push(target);
      }
      roots.push(...target.querySelectorAll("[data-checklist-root]"));
    } else if (typeof target.querySelectorAll === "function") {
      roots.push(...target.querySelectorAll("[data-checklist-root]"));
    }
    return roots;
  };

  const roots = collectRoots(scope);
  if (!roots.length) return;

  const resolveConsigneId = (root) => {
    if (consigneId != null) return String(consigneId ?? "");
    const attr = root.getAttribute("data-consigne-id");
    if (attr && String(attr).trim()) return attr;
    if (root.dataset?.consigneId && String(root.dataset.consigneId).trim()) {
      return root.dataset.consigneId;
    }
    const owner = root.closest("[data-consigne-id]");
    if (owner) {
      const ownerAttr = owner.getAttribute("data-consigne-id");
      if (ownerAttr && String(ownerAttr).trim()) return ownerAttr;
      if (owner.dataset?.consigneId && String(owner.dataset.consigneId).trim()) {
        return owner.dataset.consigneId;
      }
      if (owner.dataset?.id && String(owner.dataset.id).trim()) {
        return owner.dataset.id;
      }
    }
    return "";
  };

  roots.forEach((root) => {
    const resolvedId = resolveConsigneId(root);
    if (resolvedId && !root.getAttribute("data-consigne-id")) {
      root.setAttribute("data-consigne-id", resolvedId);
    }
    const hidden = root.querySelector("[data-checklist-state]");
    if (hidden && resolvedId) {
      const fieldName = `consigne:${resolvedId}:checklist`;
      hidden.setAttribute("data-autosave-field", fieldName);
      if (hidden.dataset) {
        hidden.dataset.autosaveField = fieldName;
      }
    }

    const editor = root.querySelector("[contenteditable]");
    if (editor) {
      const setupFn =
        window.setupChecklistEditor || window.setupCheckboxListBehavior || window.setupCheckboxLikeBullets;
      if (typeof setupFn === "function" && !editor.__cbInstalled) {
        try {
          setupFn(editor);
        } catch (error) {
          modesLogger?.warn?.("checklist:setup", error);
        }
      }
      const enterExit = window.installChecklistEnterExit;
      if (typeof enterExit === "function") {
        try {
          enterExit(editor);
        } catch (error) {
          modesLogger?.warn?.("checklist:enter-exit", error);
        }
      }
    }

    const hydrate = window.hydrateChecklist;
    if (typeof hydrate === "function") {
      try {
        const attrValue =
          typeof root.getAttribute === "function" ? root.getAttribute("data-checklist-history-date") : "";
        const datasetValue =
          root.dataset && typeof root.dataset.checklistHistoryDate === "string"
            ? root.dataset.checklistHistoryDate.trim()
            : "";
        // Derive the page dayKey from the URL hash if not explicitly present on the root
        let pageDateKey = "";
        try {
          const hash = typeof window.location?.hash === "string" ? window.location.hash : "";
          const qp = new URLSearchParams((hash.split("?")[1] || ""));
          const d = (qp.get("d") || "").trim();
          pageDateKey = d || "";
        } catch (_) {}
        if (!pageDateKey) {
          const ctxKey = (typeof window !== "undefined" && window.AppCtx?.dateIso) ? String(window.AppCtx.dateIso) : "";
          pageDateKey = ctxKey || (typeof Schema?.todayKey === "function" ? Schema.todayKey() : "");
        }
        const providedDateKey =
          datasetValue ||
          (typeof attrValue === "string" && attrValue.trim() ? attrValue.trim() : "") ||
          (typeof pageDateKey === "string" && pageDateKey.trim() ? pageDateKey.trim() : "");
        if (providedDateKey) {
          if (root.dataset) {
            root.dataset.checklistHistoryDate = providedDateKey;
          } else {
            root.setAttribute("data-checklist-history-date", providedDateKey);
          }
          if (hidden) {
            try {
              if (hidden.dataset) {
                hidden.dataset.checklistHistoryDate = providedDateKey;
              } else {
                hidden.setAttribute("data-checklist-history-date", providedDateKey);
              }
            } catch (_) {}
          }
        }
        const hydrateOptions = {
          container: root,
          consigneId: resolvedId,
          itemKeyAttr: "data-key",
        };
        if (providedDateKey) {
          hydrateOptions.dateKey = providedDateKey;
        }
        Promise.resolve(hydrate(hydrateOptions)).catch((error) => {
          modesLogger?.warn?.("checklist:hydrate", error);
        });
      } catch (error) {
        modesLogger?.warn?.("checklist:hydrate", error);
      }
    }
  });
}

function findConsigneInputFields(row, consigne) {
  if (!row || !consigne) return [];
  const holder = row.querySelector("[data-consigne-input-holder]");
  if (!holder) return [];
  return Array.from(holder.querySelectorAll(`[name$=":${consigne.id}"]`));
}

function parseConsigneSkipValue(input) {
  if (input === true) return true;
  if (input === false || input == null) return false;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return false;
    return input !== 0;
  }
  if (typeof input === "string") {
    const normalized = input.trim().toLowerCase();
    if (!normalized) return false;
    return ["1", "true", "yes", "y", "on", "skip", "passed"].includes(normalized);
  }
  return false;
}

function applyConsigneSkipState(row, consigne, shouldSkip, { updateUI = true } = {}) {
  if (!row || !consigne) return;
  try {
    modesLogger?.info?.("consigne.skip.apply", {
      consigneId: consigne?.id ?? null,
      shouldSkip: Boolean(shouldSkip),
    });
  } catch (_) {}
  if (shouldSkip) {
    row.dataset.skipAnswered = "1";
    clearConsigneSummaryMetadata(row);
  } else {
    delete row.dataset.skipAnswered;
  }
  if (!updateUI) {
    return;
  }
  const valueForStatus = shouldSkip ? { skipped: true } : readConsigneCurrentValue(consigne, row);
  updateConsigneStatusUI(row, consigne, valueForStatus);
}

function ensureConsigneSkipField(row, consigne) {
  if (!row || !consigne) return null;
  const holder = row.querySelector("[data-consigne-input-holder]");
  if (!holder) return null;
  let input = holder.querySelector("[data-consigne-skip-input]");
  if (!input) {
    input = document.createElement("input");
    input.type = "hidden";
    input.setAttribute("data-consigne-skip-input", "");
    const id = consigne?.id;
    if (id != null) {
      const stringId = String(id);
      input.name = `skip:${stringId}`;
      input.setAttribute("data-autosave-field", `consigne:${stringId}:skip`);
      try {
        modesLogger?.debug?.("consigne.skip.ensure-field", {
          consigneId: stringId,
          name: input.name,
          autosaveField: input.getAttribute("data-autosave-field"),
        });
      } catch (_) {}
    } else {
      input.name = "skip";
    }
    holder.appendChild(input);
  }
  if (!input.dataset.skipHandlerAttached) {
    const sync = () => {
      const shouldSkip = parseConsigneSkipValue(input.value);
      try {
        modesLogger?.debug?.("consigne.skip.sync", {
          consigneId: consigne?.id ?? null,
          raw: input.value,
          parsed: shouldSkip,
        });
      } catch (_) {}
      applyConsigneSkipState(row, consigne, shouldSkip, { updateUI: true });
      // Déclenche la persistance applicative (autosave schemas)
      try {
        const normalizedValue = shouldSkip ? { skipped: true } : readConsigneCurrentValue(consigne, row);
        if (typeof handleValueChange === "function") {
          handleValueChange(consigne, row, normalizedValue);
        }
      } catch (e) {
        modesLogger?.warn?.("consigne.skip.sync.persist", e);
      }
    };
    input.addEventListener("input", sync);
    input.addEventListener("change", sync);
    input.dataset.skipHandlerAttached = "1";
  }
  return input;
}

function setConsigneSkipState(row, consigne, shouldSkip, { emitInputEvents = true, updateUI = true } = {}) {
  if (!row || !consigne) return;
  const input = ensureConsigneSkipField(row, consigne);
  applyConsigneSkipState(row, consigne, shouldSkip, { updateUI });
  if (!input) return;
  const nextValue = shouldSkip ? "1" : "";
  try {
    modesLogger?.info?.("consigne.skip.set", {
      consigneId: consigne?.id ?? null,
      nextValue,
      emitInputEvents: Boolean(emitInputEvents),
      updateUI: Boolean(updateUI),
    });
  } catch (_) {}
  if (input.value === nextValue) return;
  input.value = nextValue;
  if (emitInputEvents) {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function normalizeConsigneValueForPersistence(consigne, row, value) {
  if (!consigne || !row) {
    return value;
  }
  if (row.dataset && row.dataset.skipAnswered === "1") {
    if (value && typeof value === "object" && value.skipped === true) {
      try {
        modesLogger?.debug?.("consigne.skip.normalize", {
          consigneId: consigne?.id ?? null,
          alreadySkipped: true,
        });
      } catch (_) {}
      return value;
    }
    try {
      modesLogger?.info?.("consigne.skip.normalize", {
        consigneId: consigne?.id ?? null,
        forceSkipped: true,
      });
    } catch (_) {}
    return { skipped: true };
  }
  if (consigne?.type === "montant") {
    if (value === null || value === undefined || value === "") {
      return value;
    }
    return normalizeMontantValue(value, consigne);
  }
  return value;
}

function createHiddenConsigneRow(consigne, { initialValue = null } = {}) {
  const row = document.createElement("div");
  row.className = "consigne-row consigne-row--child consigne-row--virtual";
  row.dataset.id = consigne?.id || "";
  if (consigne?.id != null) {
    const stringId = String(consigne.id);
    row.dataset.consigneId = stringId;
    row.setAttribute("data-consigne-id", stringId);
  } else {
    delete row.dataset.consigneId;
    row.removeAttribute("data-consigne-id");
  }
  const tone = priorityTone(consigne?.priority);
  if (tone) {
    row.dataset.priorityTone = tone;
  }
  row.hidden = true;
  row.style.display = "none";
  row.setAttribute("aria-hidden", "true");
  const holder = document.createElement("div");
  holder.hidden = true;
  holder.setAttribute("data-consigne-input-holder", "");
  holder.innerHTML = inputForType(consigne, initialValue);
  row.appendChild(holder);
  enhanceRangeMeters(row);
  initializeChecklistScope(row, { consigneId: consigne?.id ?? null });
  ensureConsigneSkipField(row, consigne);
  // Applique l’état Passer dès le rendu si la valeur précédente l’indique
  try {
    const wasSkipped = !!(initialValue && typeof initialValue === "object" && initialValue.skipped === true);
    if (wasSkipped) {
      setConsigneSkipState(row, consigne, true, { emitInputEvents: false, updateUI: true });
    }
  } catch (_) {}
  return row;
}

function setConsigneRowValue(row, consigne, value) {
  const skipWasActive = row?.dataset?.skipAnswered === "1";
  const maintainOrClearSkip = (hasAnswer) => {
    if (skipWasActive && !hasAnswer) {
      applyConsigneSkipState(row, consigne, true, { updateUI: true });
      return;
    }
    setConsigneSkipState(row, consigne, false, { updateUI: false });
  };
  const skipLikeValue = value && typeof value === "object" && value.skipped === true;
  ensureConsigneSkipField(row, consigne);
  if (skipLikeValue) {
    setConsigneSkipState(row, consigne, true, { updateUI: true });
    return;
  }
  if (consigne?.type === "long") {
    const editor = row?.querySelector(
      `[data-rich-text-root][data-consigne-id="${String(consigne.id ?? "")}"]`
    );
    const hidden = row?.querySelector(`[name="long:${consigne.id}"]`);
    const normalized = normalizeRichTextValue(value);
    if (editor) {
      const content = editor.querySelector("[data-rich-text-content]");
      if (content) {
        const structured = ensureRichTextStructure(normalized.html) || "";
        content.innerHTML = structured.trim() ? structured : "<p><br></p>";
        if (richTextHasContent(normalized)) {
          content.removeAttribute("data-rich-text-empty");
        } else {
          content.setAttribute("data-rich-text-empty", "1");
        }
      }
    }
    if (hidden) {
      hidden.value = JSON.stringify(normalized);
      hidden.dispatchEvent(new Event("input", { bubbles: true }));
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
    }
    updateConsigneStatusUI(row, consigne, normalized);
    const hasContent = richTextHasContent(normalized);
    maintainOrClearSkip(hasContent);
    return;
  }
  if (consigne?.type === "checklist") {
    const container = row?.querySelector(
      `[data-checklist-root][data-consigne-id="${String(consigne.id ?? "")}"]`
    );
    if (!container) {
      updateConsigneStatusUI(row, consigne, value);
      return;
    }
    const normalizedValue =
      value === null || value === undefined
        ? null
        : buildChecklistValue(consigne, value, value && typeof value === "object" ? value : null);
    if (normalizedValue) {
      applyChecklistDomState(container, normalizedValue);
    } else {
      applyChecklistDomState(container, { items: [], skipped: [] });
      const inputs = Array.from(container.querySelectorAll("[data-checklist-input]"));
      inputs.forEach((input) => {
        input.checked = false;
        if (input.dataset) {
          delete input.dataset.checklistSkip;
        }
        const host = input.closest("[data-checklist-item]");
        if (host) {
          host.classList.remove("checklist-item--skipped");
          host.removeAttribute("data-checklist-skipped");
          host.setAttribute("data-validated", "false");
        }
      });
    }
    const hidden = container.querySelector(`[name="checklist:${String(consigne.id ?? "")}"]`);
    if (hidden) {
      const domState = readChecklistDomState(container);
      const payload = {
        items: domState.items,
        skipped: domState.skipped,
      };
      try {
        hidden.value = JSON.stringify(payload);
      } catch (error) {
        hidden.value = JSON.stringify({ items: domState.items });
      }
      if (normalizedValue) {
        hidden.dataset.dirty = "1";
      } else {
        delete hidden.dataset.dirty;
      }
      hidden.dispatchEvent(new Event("input", { bubbles: true }));
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (normalizedValue) {
      container.dataset.checklistDirty = "1";
    } else {
      delete container.dataset.checklistDirty;
    }
    updateConsigneStatusUI(row, consigne, normalizedValue);
    const hasChecklistAnswer = normalizedValue ? hasChecklistResponse(consigne, row, normalizedValue) : false;
    maintainOrClearSkip(hasChecklistAnswer);
    return;
  }
  if (consigne?.type === "montant") {
    const normalized = normalizeMontantValue(value, consigne);
    const fields = findConsigneInputFields(row, consigne);
    const amountField = fields.find(
      (field) => typeof field?.name === "string" && field.name.startsWith(`montant:`)
    );
    if (amountField) {
      const nextValue = Number.isFinite(normalized.amount) ? String(normalized.amount) : "";
      amountField.value = nextValue;
      amountField.dispatchEvent(new Event("input", { bubbles: true }));
      amountField.dispatchEvent(new Event("change", { bubbles: true }));
      const afterValue = readConsigneCurrentValue(consigne, row);
      const hasAnswer = hasValueForConsigne(consigne, afterValue);
      maintainOrClearSkip(hasAnswer);
    } else {
      updateConsigneStatusUI(row, consigne, normalized);
      const hasAnswer = Number.isFinite(normalized.amount);
      maintainOrClearSkip(hasAnswer);
    }
    return;
  }
  const fields = findConsigneInputFields(row, consigne);
  if (!fields.length) {
    updateConsigneStatusUI(row, consigne, value);
    const hasAnswer = hasValueForConsigne(consigne, value);
    maintainOrClearSkip(hasAnswer);
    return;
  }
  const normalizedValue = value === null || value === undefined ? "" : value;
  fields.forEach((field) => {
    let stringValue = normalizedValue;
    if (field.type === "range") {
      const defaultValue = field.getAttribute("data-default-value") || field.defaultValue || field.min || "";
      stringValue = normalizedValue === "" ? defaultValue : normalizedValue;
    }
    if (field.tagName === "SELECT" || field.tagName === "TEXTAREA" || field.tagName === "INPUT") {
      field.value = stringValue === "" ? "" : String(stringValue);
    } else {
      field.value = stringValue === "" ? "" : String(stringValue);
    }
    if (field.type === "range") {
      const meter = row.querySelector(`[data-meter="${field.name}"]`);
      if (meter) meter.textContent = field.value;
    }
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const afterValue = readConsigneCurrentValue(consigne, row);
  const hasAnswer = hasValueForConsigne(consigne, afterValue);
  maintainOrClearSkip(hasAnswer);
}

function attachConsigneEditor(row, consigne, options = {}) {
  if (!row || !consigne) return;
  const trigger = options.trigger || row.querySelector("[data-consigne-open]");
  if (!trigger) return;
  const variant = options.variant === "drawer" ? "drawer" : "modal";
  const childConsignes = Array.isArray(options.childConsignes)
    ? options.childConsignes.filter((item) => item && item.consigne)
    : [];
  const summaryControlsEnabled = options.summaryControlsEnabled === true;
  const rawDelayOptions = options.delayOptions && typeof options.delayOptions === "object"
    ? options.delayOptions
    : null;
  const delayConfig = (() => {
    if (!rawDelayOptions) return null;
    const applyDelayFn = typeof rawDelayOptions.applyDelay === "function"
      ? rawDelayOptions.applyDelay
      : null;
    if (!applyDelayFn) return null;
    const rawAmounts = Array.isArray(rawDelayOptions.amounts) ? rawDelayOptions.amounts : [];
    const numericAmounts = rawAmounts
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);
    const uniqueAmounts = Array.from(new Set(numericAmounts)).sort((a, b) => a - b);
    const allowArchive = rawDelayOptions.allowArchive === true && typeof rawDelayOptions.onArchive === "function";
    if (!uniqueAmounts.length && !allowArchive) return null;
    const label = typeof rawDelayOptions.label === "string" && rawDelayOptions.label.trim()
      ? rawDelayOptions.label.trim()
      : "Ajouter un délai";
    const placeholder = typeof rawDelayOptions.placeholder === "string" && rawDelayOptions.placeholder.trim()
      ? rawDelayOptions.placeholder.trim()
      : "Aucun délai";
    const helper = typeof rawDelayOptions.helper === "string" && rawDelayOptions.helper.trim()
      ? rawDelayOptions.helper.trim()
      : "";
    const disabledHint = typeof rawDelayOptions.disabledHint === "string" && rawDelayOptions.disabledHint.trim()
      ? rawDelayOptions.disabledHint.trim()
      : "Active la répétition espacée pour décaler.";
    const getSrEnabled = typeof rawDelayOptions.getSrEnabled === "function"
      ? rawDelayOptions.getSrEnabled
      : () => true;
    const idBase = `${consigne?.id ?? "consigne"}-${Date.now()}`;
    const archiveLabel = typeof rawDelayOptions.archiveLabel === "string" && rawDelayOptions.archiveLabel.trim()
      ? rawDelayOptions.archiveLabel.trim()
      : "Archiver la consigne";
    const archiveValue = allowArchive
      ? String(rawDelayOptions.archiveValue || CONSIGNE_ARCHIVE_DELAY_VALUE)
      : "";
    return {
      selectId: `consigne-delay-${idBase}`,
      amounts: uniqueAmounts,
      label,
      placeholder,
      helper,
      disabledHint,
      applyDelay: applyDelayFn,
      getSrEnabled,
      allowArchive,
      archiveLabel,
      archiveValue,
      onArchive: typeof rawDelayOptions.onArchive === "function" ? rawDelayOptions.onArchive : null,
    };
  })();
  const summaryToggleLabel =
    typeof options.summaryToggleLabel === "string" && options.summaryToggleLabel.trim()
      ? options.summaryToggleLabel.trim()
      : "Réponse de bilan";
  const summaryDefaultLabel =
    typeof options.summaryDefaultLabel === "string" && options.summaryDefaultLabel.trim()
      ? options.summaryDefaultLabel.trim()
      : summaryToggleLabel;
  const validateButtonLabel = (() => {
    if (typeof options.validateButtonLabel === "string" && options.validateButtonLabel.trim()) {
      return options.validateButtonLabel.trim();
    }
    if (typeof options.validateLabel === "string" && options.validateLabel.trim()) {
      return options.validateLabel.trim();
    }
    return "Valider";
  })();
  childConsignes.forEach((child) => {
    child.srEnabled = child?.srEnabled !== false;
  });
  const TEXT_MODAL_TYPES = new Set(["long", "short", "notes", "texte", "long_text", "short_text"]);
  const CENTER_MODAL_TYPES = new Set(["likert6", "likert5", "yesno", "num", "montant", "checklist", "info", "likert", "oui_non", "scale_0_10", "choix", "multiple"]);
  const pickPhoneModalClass = (item) => {
    const type = item?.type;
    if (TEXT_MODAL_TYPES.has(type)) return "phone-top";
    if (CENTER_MODAL_TYPES.has(type)) return "phone-center";
    return "phone-center";
  };
  const updateParentChildAnsweredFlag = () => {
    if (!row) return false;
    if (!childConsignes.length) {
      delete row.dataset.childAnswered;
      return false;
    }
    const hasChildAnswered = childConsignes.some((childState) => {
      const childRow = childState?.row;
      if (!(childRow instanceof HTMLElement)) return false;
      const status = childRow.dataset?.status;
      return status && status !== "na";
    });
    if (hasChildAnswered) {
      row.dataset.childAnswered = "1";
    } else {
      delete row.dataset.childAnswered;
    }
    return hasChildAnswered;
  };
  const syncParentAnswered = () => {
    if (!row) return false;
    const before = row.dataset.childAnswered === "1";
    const after = updateParentChildAnsweredFlag();
    if (before !== after) {
      const currentValue = readConsigneCurrentValue(consigne, row);
      updateConsigneStatusUI(row, consigne, currentValue);
    }
    return after;
  };
  syncParentAnswered();
  if (childConsignes.length && row) {
    childConsignes.forEach((childState) => {
      if (childState?.row instanceof HTMLElement) {
        childState.row.addEventListener("consigne-status-changed", () => {
          syncParentAnswered();
        });
      }
    });
    const rafSync = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 16);
    rafSync(() => {
      syncParentAnswered();
    });
  } else if (row) {
    delete row.dataset.childAnswered;
  }
  enhanceRangeMeters(row.querySelector("[data-consigne-input-holder]"));
  const openEditor = () => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (trigger && typeof trigger.setAttribute === "function") {
      trigger.setAttribute("aria-expanded", "true");
    }
    const currentValue = readConsigneCurrentValue(consigne, row);
    const title = consigne.text || consigne.titre || consigne.name || consigne.id;
    const description = consigne.description || consigne.details || consigne.helper || "";
    const requiresValidation = consigne.type !== "info" || childConsignes.length > 0;
    const renderChildEditor = (childState, index) => {
      const child = childState.consigne || {};
      const childTitle = child.text || child.titre || child.name || `Sous-consigne ${index + 1}`;
      const childDescription = child.description || child.details || child.helper || "";
      const childValue = readConsigneCurrentValue(child, childState.row || row);
      const baseMenuItemClass =
        "child-menu__item flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none";
      const dangerMenuItemClass = `${baseMenuItemClass} text-red-600 hover:bg-red-50 focus:bg-red-50`;
      const actionButtons = [];
      if (typeof childState.onHistory === "function") {
        actionButtons.push(
          `<button type="button" class="${baseMenuItemClass}" role="menuitem" data-child-action="history">Historique</button>`
        );
      }
      if (typeof childState.onEdit === "function") {
        actionButtons.push(
          `<button type="button" class="${baseMenuItemClass}" role="menuitem" data-child-action="edit">Modifier</button>`
        );
      }
      if (typeof childState.onToggleSr === "function") {
        const srLabel = childState.srEnabled ? "Désactiver la répétition espacée" : "Activer la répétition espacée";
        actionButtons.push(
          `<button type="button" class="${baseMenuItemClass}" role="menuitem" data-child-action="sr-toggle" data-enabled="${childState.srEnabled ? "1" : "0"}">${srLabel}</button>`
        );
      }
      if (typeof childState.onArchive === "function") {
        actionButtons.push(
          `<button type="button" class="${baseMenuItemClass}" role="menuitem" data-child-action="archive">Archiver</button>`
        );
      }
      if (typeof childState.onDelete === "function") {
        actionButtons.push(
          `<button type="button" class="${dangerMenuItemClass}" role="menuitem" data-child-action="delete">Supprimer</button>`
        );
      }
      const actionsHtml = actionButtons.length
        ? `<div class="relative" data-child-menu-root>
            <button type="button" class="btn btn-ghost btn-sm" data-child-menu-toggle aria-haspopup="true" aria-expanded="false">
              <span aria-hidden="true">⋯</span>
              <span class="sr-only">Actions supplémentaires</span>
            </button>
            <div class="absolute right-0 z-10 mt-1 hidden min-w-[200px] origin-top-right rounded-xl border border-slate-200 bg-white p-1 shadow-lg focus:outline-none" data-child-menu role="menu">
              ${actionButtons.map((btn) => `<div role="none">${btn}</div>`).join("")}
            </div>
          </div>`
        : "";
      return `
        <article class="space-y-3 rounded-xl border border-slate-200 p-3" data-child-consigne="${escapeHtml(child.id)}">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="space-y-1">
              <div class="font-medium text-slate-800">${escapeHtml(childTitle)}</div>
              ${childDescription ? `<p class="text-sm text-slate-600 whitespace-pre-line">${escapeHtml(childDescription)}</p>` : ""}
            </div>
            ${actionsHtml}
          </div>
          <div class="space-y-2" data-consigne-editor-child-body>
            ${inputForType(child, childValue)}
          </div>
        </article>`;
    };
    const childMarkup = childConsignes.length
      ? `<section class="practice-editor__section space-y-3 border-t border-slate-200 pt-3 mt-3" data-consigne-editor-children>
          <header class="space-y-1">
            <h3 class="text-base font-semibold">Sous-consignes</h3>
            <p class="text-sm text-slate-600">Complète les sous-consignes liées à cette carte.</p>
          </header>
          <div class="space-y-3">
            ${childConsignes.map((child, index) => renderChildEditor(child, index)).join("")}
          </div>
        </section>`
      : "";
    const summaryMenuItems = [
      { scope: "weekly", label: "Bilan hebdomadaire" },
      { scope: "adhoc", label: "Bilan ponctuel" },
      { scope: "monthly", label: "Bilan mensuel" },
      { scope: "yearly", label: "Bilan annuel" },
    ];
    const summaryMenuMarkup = summaryMenuItems
      .map(
        (item) =>
          `<button type="button" class="practice-editor__summary-menu-item" role="menuitem" data-summary-option="${item.scope}">${item.label}</button>`
      )
      .join("") +
      `<div class="practice-editor__summary-menu-divider" role="separator"></div>
        <button type="button" class="practice-editor__summary-menu-item practice-editor__summary-menu-item--clear" role="menuitem" data-summary-option="clear">Réponse standard</button>`;
    const delayTitleAttr = delayConfig?.helper ? ` title="${escapeHtml(delayConfig.helper)}"` : "";
    const delayControlMarkup = delayConfig
      ? `<div class="practice-editor__delay practice-editor__delay--inline" data-consigne-editor-delay-root${delayTitleAttr}>
          <label for="${escapeHtml(delayConfig.selectId)}" class="practice-editor__delay-label">${escapeHtml(delayConfig.label)}</label>
          <select id="${escapeHtml(delayConfig.selectId)}" class="practice-editor__delay-select" data-consigne-editor-delay>
            <option value="">${escapeHtml(delayConfig.placeholder)}</option>
            ${delayConfig.amounts
              .map((amount) => `<option value="${amount}">${amount} itération${amount > 1 ? "s" : ""}</option>`)
              .join("")}
            ${delayConfig.allowArchive
              ? `<optgroup label="Actions">
                  <option value="${escapeHtml(delayConfig.archiveValue)}" data-consigne-editor-archive-option>🗄️ ${escapeHtml(delayConfig.archiveLabel)}</option>
                </optgroup>`
              : ""}
          </select>
          ${delayConfig.helper ? `<span class="practice-editor__delay-note">${escapeHtml(delayConfig.helper)}</span>` : ""}
          <span class="practice-editor__delay-helper" data-consigne-editor-delay-helper hidden>${escapeHtml(delayConfig.disabledHint)}</span>
        </div>`
      : "";
    const summaryControlMarkup =
      requiresValidation && summaryControlsEnabled
        ? `<div class="practice-editor__summary" data-consigne-editor-summary-root>
          <button type="button" class="btn btn-ghost practice-editor__summary-toggle" data-consigne-editor-summary-toggle aria-haspopup="true" aria-expanded="false">
            <span aria-hidden="true">📝</span>
            <span data-consigne-editor-summary-label>${escapeHtml(summaryToggleLabel)}</span>
          </button>
          <div class="practice-editor__summary-menu card" data-consigne-editor-summary-menu role="menu" hidden>
            ${summaryMenuMarkup}
          </div>
        </div>`
        : "";
    const primaryButtons = requiresValidation
      ? [
          delayControlMarkup,
          '<button type="button" class="btn btn-ghost" data-consigne-editor-cancel>Annuler</button>',
          '<button type="button" class="btn btn-ghost" data-consigne-editor-skip>Passer →</button>',
          `<button type="button" class="btn btn-primary" data-consigne-editor-validate>${escapeHtml(validateButtonLabel)}</button>`,
        ].filter(Boolean)
      : ['<button type="button" class="btn" data-consigne-editor-cancel>Fermer</button>'];
    const primaryActionsMarkup = `<div class="practice-editor__actions-buttons">${primaryButtons.join("\n          ")}</div>`;
    const sideControls = [summaryControlMarkup].filter(Boolean);
    const sideControlsMarkup = sideControls.length
      ? `<div class="practice-editor__actions-controls">${sideControls.join("")}</div>`
      : "";
    const actionsMarkup = `<footer class="practice-editor__actions">
        ${sideControlsMarkup}
        ${primaryActionsMarkup}
      </footer>`;
    const markup = `
      <div class="practice-editor">
        <header class="practice-editor__header">
          <h2 class="text-lg font-semibold">${escapeHtml(title)}</h2>
          ${description ? `<p class="text-sm text-slate-600 whitespace-pre-line" data-consigne-editor-description>${escapeHtml(description)}</p>` : ""}
        </header>
        <section class="practice-editor__section space-y-3" data-consigne-editor-body>
          ${inputForType(consigne, currentValue)}
        </section>
        ${childMarkup}
        ${actionsMarkup}
      </div>
    `;
    const overlay = (variant === "drawer" ? drawer : modal)(markup);
    if (variant !== "drawer" && overlay instanceof HTMLElement) {
      overlay.classList.remove("phone-top", "phone-center");
      const relevantItems = [consigne, ...childConsignes.map((child) => child.consigne).filter(Boolean)];
      const preferTop = relevantItems.some((item) => pickPhoneModalClass(item) === "phone-top");
      overlay.classList.add(preferTop ? "phone-top" : "phone-center");
    }
    initializeChecklistScope(overlay, {});
    overlay.querySelectorAll("textarea").forEach((textarea) => {
      autoGrowTextarea(textarea);
    });
    let delayRoot = null;
    let delaySelect = null;
    let delayHelper = null;
    const updateDelayAvailability = () => {
      if (!delayConfig || !delayRoot || !delaySelect) {
        return;
      }
      let srEnabled = true;
      try {
        srEnabled = delayConfig.getSrEnabled ? !!delayConfig.getSrEnabled(consigne, row) : true;
      } catch (error) {
        try {
          modesLogger?.debug?.("consigne.delay.sr-state", error);
        } catch (_) {}
        srEnabled = true;
      }
      if (srEnabled) {
        delaySelect.disabled = false;
        delayRoot.removeAttribute("aria-disabled");
        if (delayHelper) {
          delayHelper.hidden = true;
        }
      } else {
        delaySelect.value = "";
        delaySelect.disabled = true;
        delayRoot.setAttribute("aria-disabled", "true");
        if (delayHelper) {
          delayHelper.hidden = false;
        }
      }
    };
    const uniqueIdBase = `${Date.now()}-${Math.round(Math.random() * 10000)}`;
    const dialogNode = variant === "drawer" ? overlay.querySelector("aside") : overlay.firstElementChild;
    if (dialogNode) {
      dialogNode.setAttribute("role", "dialog");
      dialogNode.setAttribute("aria-modal", "true");
      const heading = dialogNode.querySelector("h2");
      if (heading && !heading.id) {
        heading.id = `consigne-editor-title-${uniqueIdBase}`;
      }
      if (heading && heading.id) {
        dialogNode.setAttribute("aria-labelledby", heading.id);
        dialogNode.removeAttribute("aria-label");
      } else {
        dialogNode.setAttribute("aria-label", String(title || ""));
      }
      const descriptionEl = dialogNode.querySelector("[data-consigne-editor-description]");
      if (descriptionEl && !descriptionEl.id) {
        descriptionEl.id = `consigne-editor-desc-${uniqueIdBase}`;
      }
      if (descriptionEl && descriptionEl.id) {
        dialogNode.setAttribute("aria-describedby", descriptionEl.id);
      } else {
        dialogNode.removeAttribute("aria-describedby");
      }
    }
    const body = overlay.querySelector("[data-consigne-editor-body]");
    enhanceRangeMeters(body);
    const focusTarget = body?.querySelector("input, select, textarea");
    if (focusTarget) {
      try {
        focusTarget.focus({ preventScroll: true });
      } catch (err) {
        focusTarget.focus();
      }
    }
    const childMenuCleanups = [];
    let isClosed = false;
    const closeOverlay = () => {
      if (isClosed) return;
      isClosed = true;
      while (childMenuCleanups.length) {
        const cleanup = childMenuCleanups.pop();
        try {
          cleanup?.();
        } catch (err) {
          console.error(err);
        }
      }
      document.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
      if (trigger && typeof trigger.setAttribute === "function") {
        trigger.setAttribute("aria-expanded", "false");
      }
      if (trigger && typeof trigger.focus === "function" && document.contains(trigger)) {
        try {
          trigger.focus({ preventScroll: true });
        } catch (err) {
          trigger.focus();
        }
      } else if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
      if (typeof options.onClose === "function") {
        options.onClose();
      }
    };
    const escapeAttrValue = (value) => String(value ?? "").replace(/"/g, '\\"');
    childConsignes.forEach((childState) => {
      const childId = childState?.consigne?.id;
      if (childId == null) return;
      const node = overlay.querySelector(`[data-child-consigne="${escapeAttrValue(childId)}"]`);
      if (!node) return;
      node.querySelectorAll("textarea").forEach((textarea) => {
        autoGrowTextarea(textarea);
      });
      const menuRoot = node.querySelector("[data-child-menu-root]");
      const menuToggle = menuRoot?.querySelector("[data-child-menu-toggle]");
      const menu = menuRoot?.querySelector("[data-child-menu]");
      let menuOpen = false;
      const onMenuDocumentClick = (event) => {
        if (!menuRoot || !menu) return;
        if (!menuRoot.contains(event.target)) {
          closeMenu();
        }
      };
      const onMenuDocumentKeydown = (event) => {
        if (event.key === "Escape" && menuOpen) {
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
        }
      };
      const closeMenu = ({ focus } = {}) => {
        if (!menuRoot || !menuToggle || !menu) return;
        if (!menuOpen) return;
        menuOpen = false;
        menu.classList.add("hidden");
        menuRoot.classList.remove("is-open");
        menuToggle.setAttribute("aria-expanded", "false");
        document.removeEventListener("click", onMenuDocumentClick);
        document.removeEventListener("keydown", onMenuDocumentKeydown, true);
        const active = document.activeElement;
        const shouldFocus =
          focus !== undefined
            ? focus
            : (menu.contains(active) || active === menuToggle);
        if (shouldFocus && typeof menuToggle.focus === "function") {
          try {
            menuToggle.focus({ preventScroll: true });
          } catch (err) {
            menuToggle.focus();
          }
        }
      };
      const openMenu = () => {
        if (!menuRoot || !menuToggle || !menu) return;
        if (menuOpen) return;
        menuOpen = true;
        menu.classList.remove("hidden");
        menuRoot.classList.add("is-open");
        menuToggle.setAttribute("aria-expanded", "true");
        setTimeout(() => {
          document.addEventListener("click", onMenuDocumentClick);
        }, 0);
        document.addEventListener("keydown", onMenuDocumentKeydown, true);
        const firstItem = menu.querySelector("[data-child-action]");
        if (firstItem instanceof HTMLElement) {
          try {
            firstItem.focus({ preventScroll: true });
          } catch (err) {
            firstItem.focus();
          }
        }
      };
      if (menuRoot && menuToggle && menu) {
        menuToggle.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (menuOpen) {
            closeMenu({ focus: true });
          } else {
            openMenu();
          }
        });
        menuToggle.addEventListener("keydown", (event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!menuOpen) {
              openMenu();
            }
          } else if (event.key === "Escape" && menuOpen) {
            event.preventDefault();
            closeMenu({ focus: true });
          }
        });
        menu.addEventListener("click", (event) => {
          event.stopPropagation();
        });
        menu.addEventListener("keydown", (event) => {
          if (event.key === "Escape" && menuOpen) {
            event.preventDefault();
            event.stopPropagation();
            closeMenu({ focus: true });
          }
        });
        childMenuCleanups.push(() => closeMenu({ focus: false }));
      }
      const callHandler = (handler, event) => {
        if (typeof handler === "function") {
          try {
            handler({ event, close: closeOverlay, consigne: childState.consigne, row: childState.row });
          } catch (err) {
            console.error(err);
          }
        }
      };
      const historyBtn = node.querySelector('[data-child-action="history"]');
      if (historyBtn) {
        if (typeof childState.onHistory === "function") {
          historyBtn.addEventListener("click", (event) => {
            event.preventDefault();
            closeMenu({ focus: false });
            callHandler(childState.onHistory, event);
          });
        } else {
          historyBtn.disabled = true;
          historyBtn.setAttribute("aria-disabled", "true");
        }
      }
      const editBtn = node.querySelector('[data-child-action="edit"]');
      if (editBtn) {
        if (typeof childState.onEdit === "function") {
          editBtn.addEventListener("click", (event) => {
            event.preventDefault();
            closeMenu({ focus: false });
            callHandler(childState.onEdit, event);
          });
        } else {
          editBtn.disabled = true;
          editBtn.setAttribute("aria-disabled", "true");
        }
      }
      const srBtn = node.querySelector('[data-child-action="sr-toggle"]');
      if (srBtn) {
        if (typeof childState.onToggleSr === "function") {
          const updateSrButton = (enabled) => {
            const nextEnabled = Boolean(enabled);
            const label = nextEnabled
              ? "Désactiver la répétition espacée"
              : "Activer la répétition espacée";
            srBtn.dataset.enabled = nextEnabled ? "1" : "0";
            srBtn.textContent = label;
          };
          updateSrButton(childState.srEnabled);
          srBtn.addEventListener("click", async (event) => {
            event.preventDefault();
            closeMenu({ focus: false });
            const current = Boolean(childState.srEnabled);
            srBtn.disabled = true;
            try {
              const result = await childState.onToggleSr(!current, {
                event,
                close: closeOverlay,
                update: updateSrButton,
              });
              const finalState = typeof result === "boolean" ? result : !current;
              childState.srEnabled = finalState;
              updateSrButton(finalState);
            } catch (err) {
              console.error(err);
              updateSrButton(current);
            } finally {
              if (overlay.isConnected) {
                srBtn.disabled = false;
              }
            }
          });
        } else {
          srBtn.disabled = true;
          srBtn.setAttribute("aria-disabled", "true");
        }
      }
      const archiveBtn = node.querySelector('[data-child-action="archive"]');
      if (archiveBtn) {
        if (typeof childState.onArchive === "function") {
          archiveBtn.addEventListener("click", async (event) => {
            event.preventDefault();
            closeMenu({ focus: false });
            archiveBtn.disabled = true;
            try {
              const result = await childState.onArchive({ event, close: closeOverlay, consigne: childState.consigne, row: childState.row });
              if (result === false && overlay.isConnected) {
                archiveBtn.disabled = false;
              }
            } catch (err) {
              console.error(err);
              if (overlay.isConnected) {
                archiveBtn.disabled = false;
              }
            }
          });
        } else {
          archiveBtn.disabled = true;
          archiveBtn.setAttribute("aria-disabled", "true");
        }
      }
      const deleteBtn = node.querySelector('[data-child-action="delete"]');
      if (deleteBtn) {
        if (typeof childState.onDelete === "function") {
          deleteBtn.addEventListener("click", async (event) => {
            event.preventDefault();
            closeMenu({ focus: false });
            deleteBtn.disabled = true;
            try {
              const result = await childState.onDelete({ event, close: closeOverlay, consigne: childState.consigne, row: childState.row });
              if (result === false && overlay.isConnected) {
                deleteBtn.disabled = false;
              }
            } catch (err) {
              console.error(err);
              if (overlay.isConnected) {
                deleteBtn.disabled = false;
              }
            }
          });
        } else {
          deleteBtn.disabled = true;
          deleteBtn.setAttribute("aria-disabled", "true");
        }
      }
    });
    const summaryRoot = overlay.querySelector("[data-consigne-editor-summary-root]");
    const summaryToggle = summaryRoot?.querySelector("[data-consigne-editor-summary-toggle]");
    const summaryMenu = summaryRoot?.querySelector("[data-consigne-editor-summary-menu]");
    const summaryLabelEl = summaryRoot?.querySelector("[data-consigne-editor-summary-label]");
    if (delayConfig) {
      delayRoot = overlay.querySelector("[data-consigne-editor-delay-root]");
      delaySelect = overlay.querySelector("[data-consigne-editor-delay]");
      delayHelper = overlay.querySelector("[data-consigne-editor-delay-helper]");
      updateDelayAvailability();
      if (
        delayConfig.allowArchive &&
        delayConfig.archiveValue &&
        delaySelect &&
        typeof delayConfig.onArchive === "function"
      ) {
        const archiveValue = delayConfig.archiveValue;
        delaySelect.addEventListener("change", async (event) => {
          if (!delaySelect) return;
          if (delaySelect.value !== archiveValue) {
            return;
          }
          event.preventDefault();
          const revertSelection = () => {
            if (!overlay.isConnected || !delaySelect) return;
            delaySelect.value = "";
            delaySelect.disabled = false;
            updateDelayAvailability();
          };
          if (delaySelect.disabled) {
            revertSelection();
            return;
          }
          delaySelect.disabled = true;
          try {
            const result = await delayConfig.onArchive({ consigne, row, close: closeOverlay });
            if (result === false) {
              revertSelection();
              return;
            }
          } catch (error) {
            try {
              modesLogger?.warn?.("consigne.delay.archive", error);
            } catch (_) {}
            revertSelection();
            return;
          }
          if (overlay.isConnected) {
            delaySelect.value = "";
            delaySelect.disabled = false;
            updateDelayAvailability();
            closeOverlay();
          }
        });
      }
    }
    const defaultSummaryLabel = summaryDefaultLabel;
    const updateSummaryControlState = () => {
      if (!summaryRoot || !summaryLabelEl) return;
      const metadata = readConsigneSummaryMetadata(row);
      if (metadata && metadata.summaryScope) {
        summaryRoot.dataset.summarySelected = "1";
        const label = metadata.summaryLabel || metadata.label || metadata.summaryScope;
        summaryLabelEl.textContent = label || defaultSummaryLabel;
      } else {
        delete summaryRoot.dataset.summarySelected;
        summaryLabelEl.textContent = defaultSummaryLabel;
      }
    };
    updateSummaryControlState();
    const readSelectedDelayAmount = () => {
      if (!delayConfig || !delaySelect || delaySelect.disabled) {
        return 0;
      }
      if (
        delayConfig.allowArchive &&
        delayConfig.archiveValue &&
        delaySelect.value === delayConfig.archiveValue
      ) {
        return 0;
      }
      const raw = Number(delaySelect.value);
      if (!Number.isFinite(raw) || raw <= 0) {
        return 0;
      }
      return Math.round(raw);
    };
    const commitResponse = ({ summary = null, close = true, requireValueForSummary = false } = {}) => {
      if (consigne.type === "checklist") {
        const selectorId = String(consigne.id ?? "");
        const container = overlay.querySelector(
          `[data-checklist-root][data-consigne-id="${selectorId}"]`
        );
        if (container) {
          container.dataset.checklistDirty = "1";
        }
        const hidden =
          overlay.querySelector(`[name="checklist:${consigne.id}"]`) ||
          overlay.querySelector(`[name="checklist:${selectorId}"]`);
        if (hidden) {
          hidden.dataset.dirty = "1";
        }
      }
      const newValue = readConsigneCurrentValue(consigne, overlay);
      if (summary && requireValueForSummary && !hasValueForConsigne(consigne, newValue)) {
        if (typeof showToast === "function") {
          showToast("Ajoute une réponse avant de créer un bilan.");
        }
        if (focusTarget && typeof focusTarget.focus === "function") {
          try {
            focusTarget.focus({ preventScroll: true });
          } catch (err) {
            focusTarget.focus();
          }
        }
        return false;
      }
      const childValueEntries = [];
      const childAnswerItems = [];
      childConsignes.forEach((childState) => {
        const childValue = readConsigneCurrentValue(childState.consigne, overlay);
        if (childState.row) {
          setConsigneRowValue(childState.row, childState.consigne, childValue);
        }
        childValueEntries.push([childState.consigne?.id, childValue]);
        if (childState.consigne && childState.consigne.id != null) {
          childAnswerItems.push({
            consigne: childState.consigne,
            row: childState.row || null,
            value: childValue,
          });
        }
      });
      updateParentChildAnsweredFlag();
      setConsigneRowValue(row, consigne, newValue);
      syncParentAnswered();
      if (summary) {
        setConsigneSummaryMetadata(row, summary);
      } else {
        clearConsigneSummaryMetadata(row);
      }
      updateSummaryControlState();
      const childValueMap = new Map(childValueEntries.filter(([id]) => id != null));
      if (typeof options.onSubmit === "function") {
        options.onSubmit(newValue, { childValues: childValueMap, summary });
      }
      const selectedDelayAmount = readSelectedDelayAmount();
      if (close) {
        closeOverlay();
      }
      if (selectedDelayAmount > 0 && delayConfig?.applyDelay) {
        if (delaySelect) {
          delaySelect.value = "";
        }
        Promise.resolve()
          .then(() =>
            delayConfig.applyDelay(selectedDelayAmount, {
              consigne,
              row,
              value: newValue,
              summary,
              childValues: childValueMap,
              childAnswers: childAnswerItems,
            })
          )
          .catch((error) => {
            try {
              modesLogger?.warn?.("consigne.delay.apply", error);
            } catch (_) {}
          });
      }
      return true;
    };
    let summaryMenuOpen = false;
    const onSummaryDocumentClick = (event) => {
      if (!summaryRoot) return;
      if (summaryRoot.contains(event.target)) return;
      closeSummaryMenu();
    };
    const onSummaryDocumentKeydown = (event) => {
      if (event.key === "Escape" || event.key === "Esc") {
        event.preventDefault();
        event.stopPropagation();
        closeSummaryMenu({ focusToggle: true });
      }
    };
    const closeSummaryMenu = ({ focusToggle = false } = {}) => {
      if (!summaryMenuOpen) return;
      summaryMenuOpen = false;
      if (summaryMenu) {
        summaryMenu.hidden = true;
      }
      if (summaryRoot) {
        delete summaryRoot.dataset.summaryMenuOpen;
      }
      if (summaryToggle) {
        summaryToggle.setAttribute("aria-expanded", "false");
      }
      document.removeEventListener("click", onSummaryDocumentClick, true);
      document.removeEventListener("keydown", onSummaryDocumentKeydown, true);
      if (focusToggle && summaryToggle && typeof summaryToggle.focus === "function") {
        try {
          summaryToggle.focus({ preventScroll: true });
        } catch (err) {
          summaryToggle.focus();
        }
      }
    };
    const openSummaryMenu = () => {
      if (!summaryRoot || !summaryMenu || !summaryToggle || summaryMenuOpen) return;
      summaryMenu.hidden = false;
      summaryRoot.dataset.summaryMenuOpen = "1";
      summaryToggle.setAttribute("aria-expanded", "true");
      summaryMenuOpen = true;
      document.addEventListener("click", onSummaryDocumentClick, true);
      document.addEventListener("keydown", onSummaryDocumentKeydown, true);
    };
    const toggleSummaryMenu = () => {
      if (summaryMenuOpen) {
        closeSummaryMenu();
      } else {
        openSummaryMenu();
      }
    };
    if (summaryToggle && summaryMenu) {
      summaryToggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleSummaryMenu();
      });
      summaryToggle.addEventListener("keydown", (event) => {
        if (event.key === "Escape" || event.key === "Esc") {
          event.preventDefault();
          closeSummaryMenu({ focusToggle: true });
        }
      });
      summaryMenu.addEventListener("keydown", (event) => {
        if (event.key === "Escape" || event.key === "Esc") {
          event.preventDefault();
          event.stopPropagation();
          closeSummaryMenu({ focusToggle: true });
        }
      });
      summaryMenu.addEventListener("click", (event) => {
        const target = event.target?.closest("[data-summary-option]");
        if (!target) return;
        event.preventDefault();
        const choice = target.getAttribute("data-summary-option");
        if (!choice) return;
        if (choice === "clear") {
          closeSummaryMenu();
          commitResponse({ summary: null, close: true, requireValueForSummary: false });
          return;
        }
        const metadata = buildSummaryMetadataForScope(choice, { date: new Date() });
        if (!metadata) {
          closeSummaryMenu();
          return;
        }
        const success = commitResponse({ summary: metadata, close: true, requireValueForSummary: true });
        if (!success) {
          return;
        }
        closeSummaryMenu();
        if (typeof showToast === "function") {
          const toastLabel = metadata.summaryLabel || metadata.label || "Bilan";
          showToast(`${toastLabel} enregistré.`);
        }
      });
      childMenuCleanups.push(() => closeSummaryMenu());
    }
    const background = variant === "drawer" ? overlay.firstElementChild : overlay;
    if (background) {
      background.addEventListener("click", (event) => {
        const isDrawerBg = variant === "drawer" && event.target === background;
        const isModalBg = variant !== "drawer" && event.target === overlay;
        if (isDrawerBg || isModalBg) {
          event.preventDefault();
          closeOverlay();
        }
      });
    }
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    const cancelBtn = overlay.querySelector("[data-consigne-editor-cancel]");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", (event) => {
        event.preventDefault();
        closeOverlay();
      });
    }
    const skipBtn = overlay.querySelector("[data-consigne-editor-skip]");
    if (skipBtn) {
      skipBtn.addEventListener("click", (event) => {
        event.preventDefault();
        // Assure la présence du champ caché et met à jour l'UI immédiatement
        try {
          modesLogger?.group?.("ui.consigne.skip.click", { consigneId: consigne?.id ?? null });
        } catch (_) {}
        try {
          const targetRow = (row && row.isConnected) ? row : overlay.ownerDocument?.querySelector?.(`[data-consigne-id="${String(consigne?.id ?? "")}" ]`);
          const r = targetRow || row;
          if (r) {
            ensureConsigneSkipField(r, consigne);
            setConsigneSkipState(r, consigne, true);
            // Sécurise l’UI si un écouteur manquerait
            applyConsigneSkipState(r, consigne, true, { updateUI: true });
            // Déclenche une persistance applicative immédiate
            try {
              if (typeof handleValueChange === 'function') {
                handleValueChange(consigne, r, { skipped: true });
              }
              if (typeof runAutoSave === 'function' && consigne?.id != null) {
                runAutoSave(consigne.id);
              }
            } catch (e) {
              modesLogger?.warn?.('consigne.skip.click.persist', e);
            }
            // Déclenche une persistance éventuelle pour les checklists imbriquées dans la consigne
            const root = r.querySelector?.('[data-checklist-root]');
            const persistFn = window.ChecklistState && window.ChecklistState.persistRoot;
            if (root && typeof persistFn === 'function') {
              const ctxUid = window.AppCtx?.user?.uid || null;
              const ctxDb = window.AppCtx?.db || null;
              try {
                modesLogger?.info?.('consigne.skip.persist.attempt', {
                  consigneId: consigne?.id ?? null,
                  hasChecklistRoot: Boolean(root),
                });
              } catch (_) {}
              Promise.resolve(persistFn.call(window.ChecklistState, root, { uid: ctxUid, db: ctxDb })).catch((e) => {
                console.warn('[consigne] persist:skip', e);
              });
            }
            // Persistance directe de la réponse skip pour la consigne
            try {
              const db = window.AppCtx?.db || null;
              const uid = window.AppCtx?.user?.uid || null;
              const dayKey = (typeof window !== 'undefined' && window.AppCtx?.dateIso)
                ? String(window.AppCtx.dateIso)
                : (typeof Schema?.todayKey === 'function' ? Schema.todayKey() : null);
              if (db && uid) {
                const answers = [{ consigne, value: { skipped: true }, dayKey }];
                if (Schema?.saveResponses) {
                  Schema.saveResponses(db, uid, 'daily', answers)
                    .then(() => {
                      modesLogger?.info?.('consigne.skip.persist.saved', { consigneId: consigne?.id ?? null, dayKey });
                      try { showToast && showToast('Passée enregistrée.'); } catch (_) {}
                    })
                    .catch((error) => {
                      modesLogger?.warn?.('consigne.skip.persist.fail', { consigneId: consigne?.id ?? null, error: String(error && error.message || error) });
                      try { showToast && showToast("Échec de l'enregistrement. Réessaye."); } catch (_) {}
                    });
                }
              } else {
                modesLogger?.warn?.('consigne.skip.persist.skipped', { reason: 'no-db-or-uid' });
              }
            } catch (e) {
              modesLogger?.warn?.('consigne.skip.persist.error', e);
            }
            try {
              modesLogger?.info?.('consigne.skip.ui', {
                consigneId: consigne?.id ?? null,
                status: r?.dataset?.status || null,
                skipFlag: r?.dataset?.skipAnswered || null,
              });
            } catch (_) {}
          }
        } catch (err) {
          console.warn('[consigne] skip:handler', err);
        }
        updateParentChildAnsweredFlag();
        syncParentAnswered();
        updateSummaryControlState();
        if (typeof options.onSkip === "function") {
          options.onSkip({ event, close: closeOverlay, consigne, row });
        }
        closeOverlay();
        try { modesLogger?.groupEnd?.(); } catch (_) {}
      });
    }
    const validateBtn = overlay.querySelector("[data-consigne-editor-validate]");
    if (validateBtn) {
      validateBtn.addEventListener("click", (event) => {
        event.preventDefault();
        commitResponse({ summary: null, close: true });
      });
    }
  };
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openEditor();
  });
  if (trigger && typeof trigger.setAttribute === "function") {
    trigger.setAttribute("aria-expanded", "false");
  }
}

function hasChecklistResponse(consigne, row, value) {
  if (value && typeof value === "object" && value.__hasAnswer === true) {
    return true;
  }
  if (checklistHasSelection(value)) {
    return true;
  }
  const skippedStates = readChecklistSkipped(value);
  if (skippedStates.some(Boolean)) {
    return true;
  }
  if (row instanceof HTMLElement) {
    const container = row.querySelector(
      `[data-checklist-root][data-consigne-id="${String(consigne.id ?? "")}"]`
    );
    if (container) {
      const domState = readChecklistDomState(container);
      const hasSelected = domState.items.some((checked, index) => checked && !domState.skipped[index]);
      if (hasSelected || domState.skipped.some(Boolean)) {
        return true;
      }
    }
  }
  return false;
}

function hasValueForConsigne(consigne, value) {
  if (value && typeof value === "object" && value.skipped === true) {
    return false;
  }
  const type = consigne?.type;
  if (type === "long") {
    return richTextHasContent(value);
  }
  if (type === "short") {
    return typeof value === "string" && value.trim().length > 0;
  }
  if (type === "checklist") {
    if (checklistHasSelection(value)) {
      return true;
    }
    return readChecklistSkipped(value).some(Boolean);
  }
  if (type === "num") {
    if (value === null || value === undefined || value === "") return false;
    const num = Number(value);
    return Number.isFinite(num);
  }
  if (type === "montant") {
    if (value === null || value === undefined || value === "") {
      return false;
    }
    const normalized = normalizeMontantValue(value, consigne);
    return Number.isFinite(normalized.amount);
  }
  return !(value === null || value === undefined || value === "");
}

function bindConsigneRowValue(row, consigne, { onChange, initialValue } = {}) {
  if (!row || !consigne) return;
  const syncSkipStateFromValue = (value) => {
    if (!row || !consigne) return;
    const skipInValue = Boolean(value && typeof value === "object" && value.skipped === true);
    const skipActive = row?.dataset?.skipAnswered === "1";
    const hasAnswer = consigne.type === "checklist"
      ? hasChecklistResponse(consigne, row, value)
      : hasValueForConsigne(consigne, value);
    const shouldSkip = (skipInValue || skipActive) && !hasAnswer;
    if (shouldSkip !== skipActive) {
      setConsigneSkipState(row, consigne, shouldSkip, { emitInputEvents: false, updateUI: false });
    }
  };
  const mapValueForStatus = (value) => {
    syncSkipStateFromValue(value);
    if (row?.dataset?.skipAnswered === "1") {
      if (hasValueForConsigne(consigne, value)) {
        delete row.dataset.skipAnswered;
        return value;
      }
      return { skipped: true };
    }
    if (consigne.type === "checklist" && value && typeof value === "object") {
      const hasAnswer = hasChecklistResponse(consigne, row, value);
      return { ...value, __hasAnswer: hasAnswer };
    }
    return value;
  };
  const emit = (value) => {
    const statusValue = mapValueForStatus(value);
    if (onChange) onChange(value);
    updateConsigneStatusUI(row, consigne, statusValue);
  };
  const read = () => readConsigneCurrentValue(consigne, row);
  if (initialValue !== undefined) {
    emit(initialValue);
  } else {
    emit(read());
  }
  const raf = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : (cb) => setTimeout(cb, 16);
  const fields = Array.from(row.querySelectorAll(`[name$=":${consigne.id}"]`));
  if (fields.length) {
    const handler = () => emit(read());
    fields.forEach((field) => {
      field.addEventListener("input", handler);
      field.addEventListener("change", handler);
    });
    raf(() => emit(read()));
  } else {
    raf(() => emit(read()));
  }
}

function formatHistoryChartValue(type, value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "";
  }
  if (type === "checklist") {
    const pct = Math.round(Number(value) * 100);
    return `${pct}%`;
  }
  if (type === "yesno") {
    return value >= 0.5 ? "Oui" : "Non";
  }
  if (type === "likert6") {
    const index = Math.round(Number(value));
    const key = LIKERT6_ORDER[index] || "";
    return LIKERT6_LABELS[key] || key || String(index);
  }
  if (type === "likert5") {
    return String(Math.round(Number(value) * 100) / 100);
  }
  if (type === "num") {
    const rounded = Math.round(Number(value) * 100) / 100;
    return String(rounded);
  }
  if (type === "montant") {
    const rounded = Math.round(Number(value) * 100) / 100;
    return String(rounded);
  }
  return String(value);
}


function renderHistoryChart(data, { type, mode } = {}) {
  const dataset = Array.isArray(data)
    ? { points: data }
    : data && typeof data === "object"
    ? data
    : { points: [] };
  const rawPoints = Array.isArray(dataset.points) ? dataset.points : [];
  const supportsChart = !(type === "long" || type === "short" || type === "info");
  if (!supportsChart) {
    return `
      <div class="history-panel__chart history-panel__chart--simple history-panel__chart--empty">
        <p class="history-panel__chart-empty-text">Ce type de consigne ne génère pas de graphique.</p>
      </div>
    `;
  }

  const sanitizedPoints = Array.isArray(rawPoints)
    ? rawPoints
        .filter(
          (entry) =>
            entry &&
            entry.date instanceof Date &&
            !Number.isNaN(entry.date.getTime()) &&
            entry.value !== null &&
            entry.value !== undefined &&
            Number.isFinite(Number(entry.value))
        )
        .map((entry) => {
          const rawScope =
            typeof entry.summaryScope === "string"
              ? entry.summaryScope
              : typeof entry.summary_scope === "string"
              ? entry.summary_scope
              : "";
          const normalizedScope = rawScope.trim().toLowerCase();
          const recordedAtValue =
            entry.recordedAt instanceof Date && !Number.isNaN(entry.recordedAt.getTime())
              ? new Date(entry.recordedAt.getTime())
              : null;
          const recordedAtFromString =
            !recordedAtValue && typeof entry.recordedAt === "string"
              ? new Date(entry.recordedAt)
              : null;
          const recordedAt =
            recordedAtValue && recordedAtValue instanceof Date && !Number.isNaN(recordedAtValue.getTime())
              ? recordedAtValue
              : recordedAtFromString && !Number.isNaN(recordedAtFromString.getTime())
              ? recordedAtFromString
              : null;
          const dayKeyValue =
            typeof entry.dayKey === "string"
              ? entry.dayKey
              : typeof entry.day_key === "string"
              ? entry.day_key
              : "";
          let summaryScope = "";
          if (normalizedScope.includes("mensu") || normalizedScope.includes("month")) {
            summaryScope = "monthly";
          } else if (
            normalizedScope.includes("hebdo") ||
            normalizedScope.includes("week") ||
            /\bhebdomadaire\b/.test(normalizedScope)
          ) {
            summaryScope = "weekly";
          } else if (
            normalizedScope.includes("annuel") ||
            normalizedScope.includes("annuelle") ||
            normalizedScope.includes("annual") ||
            normalizedScope.includes("yearly")
          ) {
            summaryScope = "yearly";
          } else if (
            normalizedScope.includes("ponct") ||
            normalizedScope.includes("adhoc") ||
            normalizedScope.includes("ad-hoc")
          ) {
            summaryScope = "adhoc";
          }
          const hasBilanFlag = Boolean(entry.isBilan) || normalizedScope.includes("bilan");
          const hasSummaryFlag =
            Boolean(entry.isSummary) ||
            Boolean(summaryScope) ||
            hasBilanFlag ||
            normalizedScope.includes("summary") ||
            normalizedScope.includes("yearly") ||
            normalizedScope.includes("annuel") ||
            normalizedScope.includes("ponct");
          return {
            date: new Date(entry.date),
            value: Number(entry.value),
            progress:
              entry.progress !== undefined && entry.progress !== null && Number.isFinite(Number(entry.progress))
                ? Number(entry.progress)
                : null,
            isSummary: hasSummaryFlag,
            summaryScope,
            isBilan: hasBilanFlag,
            recordedAt: recordedAt ? new Date(recordedAt.getTime()) : null,
            dayKey: dayKeyValue,
          };
        })
    : [];

  const sorted = sanitizedPoints.slice().sort((a, b) => a.date - b.date);
  if (!sorted.length) {
    return `
      <div class="history-panel__chart history-panel__chart--simple history-panel__chart--empty">
        <p class="history-panel__chart-empty-text">Aucune donnée enregistrée pour le moment.</p>
      </div>
    `;
  }

  const values = sorted.map((entry) => {
    if (type === "montant" && Number.isFinite(entry.progress)) {
      return entry.progress;
    }
    return entry.value;
  });
  const chartValues = sorted.map((entry) => entry.value);
  let min = Math.min(...chartValues);
  let max = Math.max(...chartValues);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (type === "yesno") {
    min = Math.min(0, min);
    max = Math.max(1, max);
  }
  if (type === "likert6") {
    min = 0;
    max = LIKERT6_ORDER.length - 1;
  }
  const hasVariance = Math.abs(max - min) > Number.EPSILON;
  let yPadding;
  if (type === "likert6") {
    yPadding = hasVariance ? 0 : 0.5;
  } else if (type === "yesno") {
    yPadding = 0;
  } else {
    yPadding = hasVariance ? 0 : 1;
  }
  if (!Number.isFinite(yPadding) || yPadding < 0) {
    yPadding = 0;
  }
  let yMin = min - yPadding;
  let yMax = max + yPadding;
  if (type === "yesno") {
    yMin = 0;
    yMax = 1;
  }
  if (type === "likert6") {
    yMin = hasVariance ? min : min - yPadding;
    yMax = hasVariance ? max : max + yPadding;
  }
  if (!Number.isFinite(yMin)) {
    yMin = hasVariance ? min : min - 1;
  }
  if (!Number.isFinite(yMax)) {
    yMax = hasVariance ? max : max + 1;
  }
  if (yMax <= yMin) {
    yMax = yMin + 1;
  }
  const yRange = yMax - yMin || 1;

  const averageStatus = historyStatusFromAverage(type, values) || "na";
  const colorPalette = resolveHistoryStatusColors(averageStatus);

  const chartWidth = 960;
  const chartHeight = 320;
  const paddingTop = 24;
  const paddingRight = 56;
  const paddingBottom = 60;
  const paddingLeft = 64;
  const innerWidth = chartWidth - paddingLeft - paddingRight;
  const innerHeight = chartHeight - paddingTop - paddingBottom;

  const axisFormatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" });
  const tooltipFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });
  const timeFormatter = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const iterationFormatter = new Intl.NumberFormat("fr-FR");

  const coords = sorted.map((entry, index) => {
    const ratio = sorted.length === 1 ? 0.5 : index / Math.max(sorted.length - 1, 1);
    const x = paddingLeft + ratio * innerWidth;
    const normalized = Number.isFinite(entry.value) ? (entry.value - yMin) / yRange : 0.5;
    const clamped = Number.isFinite(normalized) ? Math.min(Math.max(normalized, 0), 1) : 0.5;
    const y = paddingTop + (1 - clamped) * innerHeight;
    const axisRaw = entry.dayKey || axisFormatter.format(entry.date);
    const axisLabel = axisRaw ? axisRaw.charAt(0).toUpperCase() + axisRaw.slice(1) : axisRaw;
    const tooltipDate = tooltipFormatter.format(entry.date);
    const timeLabel = entry.recordedAt ? timeFormatter.format(entry.recordedAt) : "";
    const summaryLabel =
      entry.summaryScope === "monthly"
        ? "Bilan mensuel"
        : entry.summaryScope === "weekly"
        ? "Bilan hebdomadaire"
        : entry.summaryScope === "yearly"
        ? "Bilan annuel"
        : entry.isBilan
        ? "Bilan"
        : entry.isSummary
        ? "Synthèse"
        : "";
    const tooltipMeta = [tooltipDate, timeLabel, summaryLabel]
      .map((part) => part && part.trim())
      .filter(Boolean)
      .join(" · ");
    return {
      x,
      y,
      value: entry.value,
      axisLabel,
      tooltipMeta,
      tooltipDate,
      timeLabel,
      iteration: index + 1,
      isBilan: Boolean(entry.isBilan),
    };
  });

  const linePath = coords
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
  const baselineY = paddingTop + innerHeight;
  let areaPath = "";
  if (coords.length === 1) {
    const point = coords[0];
    const x = point.x.toFixed(2);
    const y = point.y.toFixed(2);
    const base = baselineY.toFixed(2);
    areaPath = `M${x},${base} L${x},${y} L${(point.x + 0.1).toFixed(2)},${y} L${(point.x + 0.1).toFixed(2)},${base} Z`;
  } else if (coords.length > 1) {
    const firstX = coords[0].x.toFixed(2);
    const lastX = coords[coords.length - 1].x.toFixed(2);
    const segments = coords
      .map((point) => `L${point.x.toFixed(2)},${point.y.toFixed(2)}`)
      .join(" ");
    areaPath = `M${firstX},${baselineY.toFixed(2)} ${segments} L${lastX},${baselineY.toFixed(2)} Z`;
  }

  const yTicksCount = 4;
  const yTicks = Array.from({ length: yTicksCount + 1 }, (_, idx) => {
    const ratio = idx / yTicksCount;
    const value = yMax - ratio * (yMax - yMin);
    const label = formatHistoryChartValue(type, value);
    const y = paddingTop + ratio * innerHeight;
    return { y, label };
  });

  const approxCharWidth = 7.5;
  const minLabelWidth = 52;
  const labelPadding = 10;
  const labelEntries = coords
    .map((point, index) => {
      const label = point.axisLabel;
      if (!label) return null;
      const estimatedWidth = Math.max(minLabelWidth, label.length * approxCharWidth);
      return { index, point, label, width: estimatedWidth };
    })
    .filter(Boolean);

  const visibleLabelEntries = [];
  for (const entry of labelEntries) {
    if (!visibleLabelEntries.length) {
      visibleLabelEntries.push(entry);
      continue;
    }
    const previous = visibleLabelEntries[visibleLabelEntries.length - 1];
    const minGap = (previous.width + entry.width) / 2 + labelPadding;
    if (entry.point.x - previous.point.x >= minGap) {
      visibleLabelEntries.push(entry);
    }
  }

  const lastEntry = labelEntries[labelEntries.length - 1];
  if (lastEntry && !visibleLabelEntries.some((entry) => entry.index === lastEntry.index)) {
    let inserted = false;
    for (let i = visibleLabelEntries.length - 1; i >= 0; i -= 1) {
      const candidate = visibleLabelEntries[i];
      const minGap = (candidate.width + lastEntry.width) / 2 + labelPadding;
      if (lastEntry.point.x - candidate.point.x >= minGap) {
        visibleLabelEntries.splice(i + 1, visibleLabelEntries.length - i - 1, lastEntry);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      const firstEntry = visibleLabelEntries[0] || labelEntries[0];
      if (firstEntry) {
        const minGapEnds = (firstEntry.width + lastEntry.width) / 2 + labelPadding;
        if (lastEntry.point.x - firstEntry.point.x >= minGapEnds) {
          visibleLabelEntries.length = 0;
          visibleLabelEntries.push(firstEntry, lastEntry);
        } else {
          visibleLabelEntries.length = 0;
          visibleLabelEntries.push(lastEntry);
        }
      } else {
        visibleLabelEntries.push(lastEntry);
      }
    }
  }

  const visibleLabelIndices = new Set(visibleLabelEntries.map((entry) => entry.index));

  const xAxisLabels = coords
    .map((point, index) => {
      const label = point.axisLabel;
      if (!label || !visibleLabelIndices.has(index)) return "";
      return `<text class="history-chart__axis-label history-chart__axis-label--x" x="${point.x.toFixed(2)}" y="${(chartHeight - paddingBottom + 32).toFixed(2)}">${escapeHtml(
        label
      )}</text>`;
    })
    .join("");

  const yAxisLabels = yTicks
    .map(
      (tick) => `
        <text class="history-chart__axis-label history-chart__axis-label--y" x="${(paddingLeft - 16).toFixed(2)}" y="${(tick.y + 4).toFixed(2)}">${escapeHtml(
          tick.label
        )}</text>
      `
    )
    .join("");

  const horizontalLines = yTicks
    .map(
      (tick) => `
        <line class="history-chart__grid-line" x1="${paddingLeft.toFixed(2)}" x2="${(chartWidth - paddingRight).toFixed(
        2
      )}" y1="${tick.y.toFixed(2)}" y2="${tick.y.toFixed(2)}"></line>
      `
    )
    .join("");

  const pointsMarkup = coords
    .map((point) => {
      const valueLabel = formatHistoryChartValue(type, point.value);
      const iterationLabel = iterationFormatter.format(point.iteration);
      const metaParts = [point.tooltipMeta, `Réponse ${iterationLabel}`].filter(Boolean);
      const tooltipMeta = metaParts.join(" · ");
      const ariaParts = [valueLabel, tooltipMeta].filter(Boolean);
      const ariaLabel = ariaParts.join(" — ");
      const metaAttr = tooltipMeta ? ` data-meta="${escapeHtml(tooltipMeta)}"` : "";
      const pointColor = point.isBilan ? "#7c3aed" : colorPalette.circle;
      const pointClasses = ["history-chart__point"];
      if (point.isBilan) {
        pointClasses.push("history-chart__point--bilan");
      }
      const pointStyle = ` style="--history-point-color:${escapeHtml(pointColor)}"`;
      return `
        <g class="${pointClasses.join(" ")}" data-history-point data-value="${escapeHtml(valueLabel)}"${metaAttr}${pointStyle} transform="translate(${point.x.toFixed(
        2
      )}, ${point.y.toFixed(2)})" tabindex="0" aria-label="${escapeHtml(ariaLabel)}">
          <circle class="history-chart__point-hit" r="14"></circle>
          <circle class="history-chart__point-node" r="6"></circle>
        </g>
      `;
    })
    .join("");

  const plural = sorted.length > 1 ? "s" : "";
  const responseCountLabel = `${sorted.length || 0} réponse${plural}`;

  const gradientId = `historyChartSimple-${Math.random().toString(36).slice(2, 10)}`;
  const chartLabel = `Évolution des réponses enregistrées (${responseCountLabel})`;

  return `
    <div class="history-panel__chart history-panel__chart--simple" data-average-status="${escapeHtml(averageStatus)}">
      <div class="history-panel__chart-scroll">
        <figure class="history-chart">
          <svg class="history-chart__svg" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="${escapeHtml(
            chartLabel
          )}" focusable="false">
          <defs>
            <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${escapeHtml(colorPalette.gradientTop)}"></stop>
              <stop offset="100%" stop-color="${escapeHtml(colorPalette.gradientBottom)}"></stop>
            </linearGradient>
          </defs>
          <rect class="history-chart__surface" x="${paddingLeft.toFixed(2)}" y="${paddingTop.toFixed(2)}" width="${innerWidth.toFixed(
            2
          )}" height="${innerHeight.toFixed(2)}" rx="18"></rect>
          ${horizontalLines}
          <line class="history-chart__axis-line" x1="${paddingLeft.toFixed(2)}" y1="${baselineY.toFixed(2)}" x2="${(chartWidth -
            paddingRight
          ).toFixed(2)}" y2="${baselineY.toFixed(2)}"></line>
          <line class="history-chart__axis-line" x1="${paddingLeft.toFixed(2)}" y1="${paddingTop.toFixed(2)}" x2="${paddingLeft.toFixed(
            2
          )}" y2="${baselineY.toFixed(2)}"></line>
          ${yAxisLabels}
          ${xAxisLabels}
          ${
            areaPath
              ? `<path class="history-chart__area" d="${areaPath}" fill="url(#${gradientId})"></path>`
              : ""
          }
          ${
            linePath
              ? `<path class="history-chart__line" d="${linePath}" fill="none" stroke="${escapeHtml(colorPalette.line)}"></path>`
              : ""
          }
          ${pointsMarkup}
        </svg>
        </figure>
      </div>
    </div>
  `;
}



function enhanceHistoryChart(container) {
  if (!container) return;
  const chartRoot = container.querySelector('.history-panel__chart');
  if (!chartRoot) return;
  const scrollContainer = chartRoot.querySelector('.history-panel__chart-scroll') || chartRoot;
  const points = Array.from(chartRoot.querySelectorAll('[data-history-point]'));
  if (!points.length) return;

  const tooltipClass = 'history-chart__tooltip';
  let tooltip = chartRoot._historyTooltip;
  if (!(tooltip instanceof HTMLElement) || !tooltip.classList.contains(tooltipClass)) {
    tooltip = document.createElement('div');
    tooltip.className = tooltipClass;
    tooltip.innerHTML = `
      <div class="history-chart__tooltip-value"></div>
      <div class="history-chart__tooltip-meta"></div>
    `;
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    chartRoot._historyTooltip = tooltip;
  }

  const valueEl = tooltip.querySelector('.history-chart__tooltip-value');
  const metaEl = tooltip.querySelector('.history-chart__tooltip-meta');

  const clearActive = () => {
    points.forEach((pt) => pt.classList.remove('is-active'));
  };

  const hideTooltip = () => {
    clearActive();
    tooltip.classList.remove('is-visible');
    tooltip.classList.remove('history-chart__tooltip--below');
    tooltip.hidden = true;
    tooltip.style.left = '';
    tooltip.style.top = '';
  };

  const showTooltip = (point) => {
    if (!point) return;
    clearActive();
    point.classList.add('is-active');
    if (valueEl) valueEl.textContent = point.getAttribute('data-value') || '';
    if (metaEl) {
      const metaText = point.getAttribute('data-meta') || '';
      metaEl.textContent = metaText;
      metaEl.hidden = !metaText;
    }

    const node = point.querySelector('.history-chart__point-node') || point;
    const nodeRect = node.getBoundingClientRect();
    const gap = 18;
    const visibleGap = 10;
    tooltip.style.setProperty('--history-tooltip-gap', `${gap}px`);
    tooltip.style.setProperty('--history-tooltip-visible-gap', `${visibleGap}px`);
    tooltip.hidden = false;
    tooltip.classList.remove('history-chart__tooltip--below');
    tooltip.classList.add('is-visible');

    const tooltipHeight = tooltip.offsetHeight || 0;
    const shouldFlip = nodeRect.top - gap - tooltipHeight < 12;
    if (shouldFlip) {
      tooltip.classList.add('history-chart__tooltip--below');
    }

    const top = shouldFlip ? nodeRect.bottom : nodeRect.top;
    const left = nodeRect.left + nodeRect.width / 2;

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  points.forEach((point) => {
    point.addEventListener('pointerenter', () => showTooltip(point));
    point.addEventListener('pointermove', () => showTooltip(point));
    point.addEventListener('pointerleave', hideTooltip);
    point.addEventListener('focus', () => showTooltip(point));
    point.addEventListener('blur', hideTooltip);
  });

  chartRoot.addEventListener('pointerleave', hideTooltip);
  chartRoot.addEventListener('pointercancel', hideTooltip);
  if (scrollContainer && scrollContainer !== chartRoot) {
    scrollContainer.addEventListener('scroll', hideTooltip, { passive: true });
  }
}


function getRecentResponsesStore() {
  if (typeof window === "undefined") {
    return null;
  }
  const existing = window.__hpRecentResponses;
  if (existing instanceof Map) {
    return existing;
  }
  if (existing && typeof existing === "object") {
    const map = new Map();
    try {
      Object.entries(existing).forEach(([key, value]) => {
        if (!key) return;
        if (Array.isArray(value)) {
          map.set(key, value.slice());
        }
      });
    } catch (error) {
      console.warn("recentResponsesStore:normalize", error);
    }
    window.__hpRecentResponses = map;
    return map;
  }
  return null;
}

function clearRecentResponsesForConsigne(consigneId) {
  if (!consigneId) return;
  const store = getRecentResponsesStore();
  if (!store) return;
  try {
    store.delete(consigneId);
  } catch (error) {
    console.warn("recentResponsesStore:clear", error);
  }
}

function removeRecentResponsesForDay(consigneId, dayKey) {
  if (!consigneId || !dayKey) return;
  const store = getRecentResponsesStore();
  if (!store) return;
  try {
    const list = store.get(consigneId) || [];
    if (!Array.isArray(list) || !list.length) return;
    const filtered = list.filter((entry) => String(entry?.dayKey || "") !== String(dayKey));
    if (filtered.length) {
      store.set(consigneId, filtered);
    } else {
      store.delete(consigneId);
    }
  } catch (error) {
    console.warn("recentResponsesStore:removeDay", error);
  }
}

async function deleteAllResponsesForDay(db, uid, consigneId, dayKey) {
  if (!db || !uid || !consigneId || !dayKey) return;
  const { collection, where, query, getDocs, deleteDoc } = modesFirestore || {};
  if (typeof collection !== 'function' || typeof query !== 'function' || typeof where !== 'function' || typeof getDocs !== 'function') {
    return;
  }
  try {
    const qy = query(
      collection(db, 'u', uid, 'responses'),
      where('consigneId', '==', consigneId),
      where('dayKey', '==', dayKey)
    );
    const snap = await getDocs(qy);
    const tasks = (snap?.docs || []).map((docSnap) => {
      try {
        return deleteDoc(docSnap.ref);
      } catch (error) {
        console.warn('history.deleteAllResponsesForDay:delete', error);
        return null;
      }
    });
    if (tasks.length) {
      await Promise.all(tasks);
    }
  } catch (error) {
    console.warn('history.deleteAllResponsesForDay', error);
  }
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
      modesLogger?.debug?.("ui.history.asDate.toDate", error);
    }
  }
  if (typeof value.toMillis === "function") {
    try {
      const millis = value.toMillis();
      if (Number.isFinite(millis)) {
        return fallbackAsDate(millis);
      }
    } catch (error) {
      modesLogger?.debug?.("ui.history.asDate.toMillis", error);
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
    // Handle UTC dateIso by extracting the date part to avoid timezone conversion
    if (trimmed.includes('T') && trimmed.includes('Z')) {
      const dateString = trimmed.split('T')[0]; // Extract YYYY-MM-DD part
      const parsed = new Date(dateString);
      return normalizeDateInstance(parsed);
    } else {
      const parsed = new Date(trimmed);
      return normalizeDateInstance(parsed);
    }
  }
  return null;
}

function asDate(value) {
  const util = window?.DateUtils?.asDate;
  if (typeof util === "function") {
    try {
      const resolved = util(value);
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
      modesLogger?.debug?.("ui.history.asDate.external", error);
    }
  }
  return fallbackAsDate(value);
}

function firstValidDate(candidates) {
  if (!Array.isArray(candidates)) {
    return null;
  }
  for (const candidate of candidates) {
    const date = asDate(candidate);
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return null;
}

function parseHistoryDateInput(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const fromDayKey = modesParseDayKeyToDate(trimmed);
    if (fromDayKey instanceof Date && !Number.isNaN(fromDayKey.getTime())) {
      return fromDayKey;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const fromNumber = asDate(numeric);
      if (fromNumber instanceof Date && !Number.isNaN(fromNumber.getTime())) {
        return fromNumber;
      }
    }
    if (!/\d{4}/.test(trimmed)) {
      return null;
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const normalized = asDate(value);
  return normalized instanceof Date && !Number.isNaN(normalized.getTime()) ? normalized : null;
}

function resolveHistoryEntryDate(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const candidates = [
    row.pageDate,
    row.page_date,
    row.pageDateIso,
    row.page_date_iso,
    row.pageDateISO,
    row.dayKey,
    row.day_key,
    row.date,
    row.createdAt,
    row.created_at,
    row.recordedAt,
    row.recorded_at,
    row.updatedAt,
    row.updated_at,
  ];
  return firstValidDate(candidates.map((candidate) => parseHistoryDateInput(candidate) || candidate));
}

function resolveHistorySortTime(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const primary = resolveHistoryEntryDate(row);
  if (primary instanceof Date && !Number.isNaN(primary.getTime())) {
    return primary.getTime();
  }
  const fallback = firstValidDate([
    row?.createdAt,
    row?.created_at,
    row?.recordedAt,
    row?.recorded_at,
    row?.updatedAt,
    row?.updated_at,
  ]);
  if (fallback instanceof Date && !Number.isNaN(fallback.getTime())) {
    return fallback.getTime();
  }
  return null;
}

function compareHistoryRowsDesc(a, b) {
  const aTime = resolveHistorySortTime(a);
  const bTime = resolveHistorySortTime(b);
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);
  if (aValid && bValid && aTime !== bTime) {
    return bTime - aTime;
  }
  if (aValid && !bValid) {
    return -1;
  }
  if (!aValid && bValid) {
    return 1;
  }
  if (aValid && bValid) {
    return 0;
  }
  const aId = historyRowIdentity(a);
  const bId = historyRowIdentity(b);
  if (aId || bId) {
    return String(bId || "").localeCompare(String(aId || ""));
  }
  return 0;
}

function historyRowIdentity(row) {
  if (!row || typeof row !== "object") {
    return "";
  }
  if (row.id) {
    return `id:${row.id}`;
  }
  const resolvedDate = resolveHistoryEntryDate(row);
  const rawDate = resolvedDate || null;
  let iso = "";
  if (rawDate instanceof Date && !Number.isNaN(rawDate.getTime())) {
    iso = rawDate.toISOString();
  }
  let valueKey = "";
  try {
    valueKey = JSON.stringify(row.value ?? null);
  } catch (error) {
    valueKey = String(row.value ?? "");
  }
  return `created:${iso}::value:${valueKey}`;
}

function mergeRowsWithRecent(rows, consigneId) {
  const remoteRows = Array.isArray(rows) ? rows.slice() : [];
  const store = getRecentResponsesStore();
  if (!store || !consigneId) {
    return remoteRows;
  }
  const local = store.get(consigneId) || [];
  if (!Array.isArray(local) || !local.length) {
    return remoteRows;
  }
  const remoteIds = new Set(remoteRows.map((row) => historyRowIdentity(row)).filter(Boolean));
  const existingIds = new Set(remoteIds);
  const merged = remoteRows.slice();
  const pending = [];
  local.forEach((entry) => {
    const identity = historyRowIdentity(entry);
    if (!identity) {
      return;
    }
    if (existingIds.has(identity)) {
      return;
    }
    merged.push(entry);
    existingIds.add(identity);
    pending.push(entry);
  });
  if (pending.length) {
    pending.sort(compareHistoryRowsDesc);
    store.set(consigneId, pending.slice(0, 10));
  } else {
    store.delete(consigneId);
  }
  merged.sort(compareHistoryRowsDesc);
  return merged;
}

async function fetchConsigneHistoryRows(ctx, consigneId, options = {}) {
  const result = { rows: [], size: 0, missing: null, error: null };
  if (!ctx || !ctx.db || !ctx.user?.uid || !consigneId) {
    return result;
  }
  const { collection, where, orderBy, limit, query, getDocs } = modesFirestore || {};
  const requiredFns = ["collection", "where", "orderBy", "limit", "query", "getDocs"];
  const missingFns = requiredFns.filter((fn) => typeof modesFirestore?.[fn] !== "function");
  if (missingFns.length) {
    result.missing = missingFns;
    return result;
  }
  const fetchLimitRaw = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : HISTORY_PANEL_FETCH_LIMIT;
  const fetchLimit = Math.max(1, Math.min(fetchLimitRaw, 500));
  let snap = null;
  try {
    snap = await getDocs(
      query(
        collection(ctx.db, "u", ctx.user.uid, "responses"),
        where("consigneId", "==", consigneId),
        orderBy("createdAt", "desc"),
        limit(fetchLimit),
      ),
    );
  } catch (error) {
    result.error = error;
    return result;
  }
  const docs = Array.isArray(snap?.docs) ? snap.docs : [];
  result.size = typeof snap?.size === "number" ? snap.size : docs.length;
  let rows = docs.map((docSnap) => {
    const data = docSnap.data() || {};
    return {
      id: docSnap.id,
      responseId: docSnap.id,
      ...data,
    };
  });
  rows = mergeRowsWithRecent(rows, consigneId);
  if (options.filterDailyDuplicates !== false) {
    const seenDailyDayKeys = new Set();
    rows = rows.filter((row) => {
      const modeKey = normalizeHistoryMode(row);
      if (!DAILY_HISTORY_MODE_KEYS.has(modeKey)) {
        return true;
      }
      const createdAtSource = row?.createdAt ?? row?.updatedAt ?? null;
      const createdAt = parseHistoryResponseDate(createdAtSource);
      const primaryDate = resolveHistoryEntryDate(row) || createdAt;
      const resolvedDayKey = resolveHistoryResponseDayKey(row, primaryDate);
      if (!resolvedDayKey) {
        return true;
      }
      const normalizedKey = normalizeHistoryDayKey(resolvedDayKey);
      if (!normalizedKey) {
        return true;
      }
      if (seenDailyDayKeys.has(normalizedKey)) {
        return false;
      }
      seenDailyDayKeys.add(normalizedKey);
      return true;
    });
  }
  result.rows = rows;
  return result;
}

function collectConsigneTimelineSnapshot(consigne) {
  if (!consigne || consigne.id == null || typeof document === "undefined") {
    return null;
  }
  const consigneId = String(consigne.id);
  // Prefer the standard selector first, but also support bilan rows which carry data-id
  const selector = `[data-consigne-id="${escapeTimelineSelector(consigneId)}"]`;
  let row = document.querySelector(selector);
  if (!(row instanceof HTMLElement)) {
    // Bilan page rows use data-id instead of data-consigne-id
    const altSelector = `[data-id="${escapeTimelineSelector(consigneId)}"]`;
    const candidate = document.querySelector(altSelector);
    if (candidate instanceof HTMLElement) {
      row = candidate;
    }
  }
  if (!(row instanceof HTMLElement)) {
    return null;
  }
  const state = CONSIGNE_HISTORY_ROW_STATE.get(row) || null;
  // Prefer the tracked timeline from state, but fall back to querying the DOM directly
  const track = state?.track || row.querySelector?.("[data-consigne-history-track]") || null;
  if (!track) {
    return { row, items: [] };
  }
  const nodes = Array.from(track.querySelectorAll(".consigne-history__item"));
  const items = nodes.map((item, index) => {
    const details = item._historyDetails && typeof item._historyDetails === "object" ? item._historyDetails : {};
    const rawDayKey =
      (typeof details.dayKey === "string" && details.dayKey.trim()) ||
      (typeof item.dataset.historyDay === "string" && item.dataset.historyDay.trim()) ||
      "";
    const normalizedDayKey = normalizeHistoryDayKey(rawDayKey);
    const status = item.dataset.status || details.status || "";
    const historyId =
      (typeof details.historyId === "string" && details.historyId.trim()) ||
      (typeof item.dataset.historyId === "string" && item.dataset.historyId.trim()) ||
      "";
    const responseId =
      (typeof details.responseId === "string" && details.responseId.trim()) ||
      (typeof item.dataset.historyResponseId === "string" && item.dataset.historyResponseId.trim()) ||
      "";
    return {
      index,
      dayKey: rawDayKey,
      normalizedDayKey,
      status,
      historyId,
      responseId,
      details,
    };
  });
  return { row, items };
}

function findOpenHistoryPanelRoot(consigneId) {
  if (consigneId == null || typeof document === "undefined") {
    return null;
  }
  const selector = `[data-history-panel-consigne="${escapeTimelineSelector(String(consigneId))}"]`;
  const panel = document.querySelector(selector);
  return panel instanceof HTMLElement ? panel : null;
}

function refreshOpenHistoryPanel(consigneId) {
  const panelRoot = findOpenHistoryPanelRoot(consigneId);
  if (!panelRoot) {
    return false;
  }
  const reopen = panelRoot.__historyReopen;
  if (typeof reopen === "function") {
    try {
      reopen();
      return true;
    } catch (error) {
      try {
        console.warn("history.panel.refresh", { consigneId, error });
      } catch (_) {}
    }
  }
  return false;
}

// Ensure any global "consigne:history:refresh" event triggers a panel refresh
if (typeof window !== "undefined" && !window.__hpHistoryRefreshBound) {
  try {
    window.__hpHistoryRefreshBound = true;
    window.addEventListener(
      "consigne:history:refresh",
      (event) => {
        const targetId = event?.detail?.consigneId ?? event?.detail?.id ?? null;
        if (targetId == null) return;
        try {
          refreshOpenHistoryPanel(String(targetId));
        } catch (_) {}
      },
      { passive: true },
    );
  } catch (_) {}
}

function refreshConsigneTimelineWithRows(consigne, rows) {
  if (!consigne || consigne.id == null) {
    return;
  }
  const snapshot = collectConsigneTimelineSnapshot(consigne);
  if (!snapshot || !(snapshot.row instanceof HTMLElement)) {
    return;
  }
  const points = buildConsigneHistoryTimeline(rows, consigne);
  try {
    // Cache for later comparison/logging when DOM snapshot isn't available yet
    CONSIGNE_HISTORY_LAST_POINTS.set(String(consigne.id), Array.isArray(points) ? points.slice() : []);
  } catch (_) {}
  const state = CONSIGNE_HISTORY_ROW_STATE.get(snapshot.row) || null;
  const rendered = renderConsigneHistoryTimeline(snapshot.row, points);
  if (state) {
    state.hasDayTimeline = Boolean(points.length);
    state.track = snapshot.row.querySelector("[data-consigne-history-track]") || state.track;
    scheduleConsigneHistoryNavUpdate(state);
  }
  if (!rendered && state) {
    state.track.dataset.historyMode = "empty";
  }
}

function summarizeChecklistValue(value) {
  try {
    const stats = deriveChecklistStats(value);
    if (!stats) {
      return null;
    }
    const checkedCount =
      stats.checkedCount ?? stats.checked ?? (Array.isArray(stats.checkedIds) ? stats.checkedIds.length : null);
    const skippedCount = stats.skippedCount ?? stats.skipped ?? null;
    const total = stats.total ?? null;
    const percentage = stats.percentage ?? null;
    const empty =
      typeof stats.isEmpty === "boolean"
        ? stats.isEmpty
        : checkedCount != null
        ? checkedCount === 0
        : false;
    return {
      total,
      checked: checkedCount,
      skipped: skippedCount,
      percentage,
      empty,
    };
  } catch (_) {
    return null;
  }
}

function diffChecklistSummaries(summaryA, summaryB) {
  const keys = ["checked", "total", "skipped", "percentage", "empty"];
  if (!summaryA && !summaryB) {
    return [];
  }
  if (!summaryA || !summaryB) {
    return [
      {
        field: "summary",
        left: summaryA ?? null,
        right: summaryB ?? null,
        kind: "missing",
      },
    ];
  }
  const normalizeNumber = (value) => {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.round(num * 1000) / 1000;
  };
  const differences = [];
  keys.forEach((key) => {
    const left = summaryA[key];
    const right = summaryB[key];
    if (typeof left === "number" || typeof right === "number") {
      const normLeft = normalizeNumber(left);
      const normRight = normalizeNumber(right);
      if (normLeft !== normRight) {
        differences.push({ field: key, left: normLeft, right: normRight });
      }
      return;
    }
    if (left !== right) {
      differences.push({ field: key, left, right });
    }
  });
  return differences;
}

function logChecklistHistoryInspection(consigne, payload = {}) {
  if (!consigne || consigne.type !== "checklist") {
    return;
  }
  try {
    const label = `[checklist-history] ${payload.label || "inspection"} (#${consigne.id ?? "?"})`;
    console.log(label);
    if (payload.focusDayKey || payload.timelineDetails || payload.entrySummary || payload.panelSummary || payload.matchInfo) {
      logChecklistEvent("info", "[checklist-history] focus", {
        dayKey: payload.focusDayKey || "",
        timeline: payload.timelineDetails || null,
        entry: payload.entrySummary || null,
        panel: payload.panelSummary || null,
        match: payload.matchInfo || null,
        dom: payload.domSummary || null,
      });
    }
    if (payload.matchInfo && payload.matchInfo.type && payload.matchInfo.type !== "history") {
      logChecklistEvent("warn", `[checklist-history] attention: correspondance basée sur ${payload.matchInfo.type} (${payload.matchInfo.weight ?? "?"})`, {
        consigneId: consigne.id ?? null,
        dayKey: payload.focusDayKey || "",
        match: payload.matchInfo,
      });
    }
    const summaryMap = {
      timeline: payload.timelineDetails?.summary || null,
      entry: payload.entrySummary?.summary || null,
      panel: payload.panelSummary?.summary || null,
      dom: payload.domSummary?.summary || null,
    };
    const summaryEntries = Object.entries(summaryMap).filter(([, summary]) => summary != null);
    if (summaryEntries.length) {
      logChecklistEvent("info", "[checklist-history] summary-compare", {
        timeline: summaryMap.timeline || null,
        entry: summaryMap.entry || null,
        panel: summaryMap.panel || null,
        dom: summaryMap.dom || null,
      });
      const keys = Object.keys(summaryMap);
      keys.forEach((baseName, index) => {
        const baseSummary = summaryMap[baseName];
        if (!baseSummary) {
          return;
        }
        for (let i = index + 1; i < keys.length; i += 1) {
          const compareName = keys[i];
          const compareSummary = summaryMap[compareName];
          if (!compareSummary) {
            continue;
          }
          const diffs = diffChecklistSummaries(baseSummary, compareSummary);
          if (diffs.length) {
            const severity =
              baseName === "timeline" || compareName === "timeline"
                ? "error"
                : "warn";
            logChecklistEvent(severity, `[checklist-history] mismatch ${baseName} vs ${compareName} (#${consigne.id ?? "?"})`, {
              dayKey: payload.focusDayKey || "",
              differences: diffs,
              [baseName]: baseSummary,
              [compareName]: compareSummary,
            });
          }
        }
      });
    }
    if (Array.isArray(payload.entries)) {
      const rows = payload.entries.slice(0, payload.maxEntries ?? 40).map((entry, index) => {
        const keyInfo = resolveHistoryTimelineKey(entry, consigne);
        // Normalize the value exactly like the timeline does to ensure status/metrics alignment
        const displayValue = resolveHistoryTimelineValue(entry, consigne);
        const summary = summarizeChecklistValue(displayValue);
        const historyId =
          (typeof entry?.historyId === "string" && entry.historyId.trim()) ||
          (typeof entry?.history_id === "string" && entry.history_id.trim()) ||
          "";
        const responseId =
          (typeof entry?.responseId === "string" && entry.responseId.trim()) ||
          (typeof entry?.response_id === "string" && entry.response_id.trim()) ||
          (typeof entry?.id === "string" && entry.id.trim()) ||
          "";
        return {
          index,
          dayKey: keyInfo?.dayKey || "",
          normalizedDayKey: normalizeHistoryDayKey(keyInfo?.dayKey),
          status: dotColor(consigne.type, displayValue, consigne) || "na",
          historyId,
          responseId,
          checked: summary?.checked ?? null,
          total: summary?.total ?? null,
          skipped: summary?.skipped ?? null,
          percentage: summary?.percentage ?? null,
          empty: summary?.empty ?? null,
        };
      });
      rows.forEach((row) => {
        logChecklistEvent("info", "[checklist-history] history-entry", row);
      });
      if (payload.entries.length > rows.length) {
        logChecklistEvent("info", "[checklist-history] history-entry:truncated", {
          count: payload.entries.length,
          displayed: rows.length,
        });
      }
    }
  } catch (error) {
    logChecklistEvent("warn", "[checklist-history] inspection failed", { error: String(error) });
  }
}

function logConsigneHistoryComparison(consigne, panelMetas, context = {}) {
  if (!consigne || !Array.isArray(panelMetas)) {
    return;
  }
  try {
    const timelineSnapshot = collectConsigneTimelineSnapshot(consigne);
    let timelineItems = Array.isArray(timelineSnapshot?.items) ? timelineSnapshot.items : null;
    // If DOM snapshot is empty (e.g., bilan row not yet hydrated), fall back to the last rendered points cache
    if (timelineItems && timelineItems.length === 0) {
      try {
        const cachedPoints = CONSIGNE_HISTORY_LAST_POINTS.get(String(consigne.id)) || [];
        if (Array.isArray(cachedPoints) && cachedPoints.length) {
          timelineItems = cachedPoints.map((pt, index) => ({
            index,
            dayKey: pt?.dayKey || "",
            normalizedDayKey: normalizeHistoryDayKey(pt?.dayKey || ""),
            status: pt?.status || "",
            responseId: pt?.responseId || "",
            historyId: pt?.historyId || "",
          }));
        }
      } catch (_) {}
    }
    const timelineEntries = timelineItems
      ? timelineItems.map((item) => ({
          index: item.index,
          dayKey: item.dayKey,
          normalizedDayKey: item.normalizedDayKey,
          status: item.status || "",
          responseId: item.responseId || "",
          historyId: item.historyId || "",
        }))
      : null;
    const panelEntries = panelMetas.map((meta) => ({
      index: meta.index,
      dayKey: meta.dayKey || "",
      normalizedDayKey: meta.normalizedDayKey || "",
      status: meta.status || "",
      responseId: meta.responseId || "",
      historyId: meta.historyId || "",
    }));

    const buildKey = (entry) => {
      if (!entry || typeof entry !== "object") {
        return "";
      }
      const historyKey = typeof entry.historyId === "string" && entry.historyId.trim()
        ? `history:${entry.historyId.trim()}`
        : "";
      if (historyKey) {
        return historyKey;
      }
      const responseKey = typeof entry.responseId === "string" && entry.responseId.trim()
        ? `response:${entry.responseId.trim()}`
        : "";
      if (responseKey) {
        return responseKey;
      }
      const normalizedDayKey = typeof entry.normalizedDayKey === "string" && entry.normalizedDayKey.trim()
        ? entry.normalizedDayKey.trim()
        : "";
      const indexPart = Number.isFinite(entry.index) ? String(entry.index) : "";
      const dayKey = typeof entry.dayKey === "string" && entry.dayKey.trim() ? entry.dayKey.trim() : "";
      if (normalizedDayKey || dayKey) {
        return `day:${normalizedDayKey || dayKey}:${indexPart}`;
      }
      return `idx:${indexPart}`;
    };

    const timelineMap = new Map();
    if (timelineEntries) {
      timelineEntries.forEach((entry) => {
        const key = buildKey(entry);
        timelineMap.set(key, entry);
      });
    }
    const panelMap = new Map();
    panelEntries.forEach((entry) => {
      const key = buildKey(entry);
      panelMap.set(key, entry);
    });

    const missingInTimeline = [];
    panelMap.forEach((entry, key) => {
      if (!timelineMap.has(key)) {
        missingInTimeline.push(entry);
      }
    });
    const missingInPanel = [];
    timelineMap.forEach((entry, key) => {
      if (!panelMap.has(key)) {
        missingInPanel.push(entry);
      }
    });
    const statusMismatches = [];
    const idMismatches = [];
    panelMap.forEach((entry, key) => {
      if (!timelineMap.has(key)) {
        return;
      }
      const timelineEntry = timelineMap.get(key);
      if ((entry.status || "na") !== (timelineEntry.status || "na")) {
        statusMismatches.push({
          key,
          panel: entry.status || "",
          timeline: timelineEntry.status || "",
        });
      }
      const panelResponse = entry.responseId || "";
      const timelineResponse = timelineEntry.responseId || "";
      if (panelResponse !== timelineResponse) {
        idMismatches.push({
          key,
          panel: panelResponse || "(aucun)",
          timeline: timelineResponse || "(aucun)",
        });
      }
    });

    const hasTimeline = Boolean(timelineSnapshot && timelineEntries);
    const hasDifferences =
      !hasTimeline ||
      missingInTimeline.length > 0 ||
      missingInPanel.length > 0 ||
      statusMismatches.length > 0 ||
      idMismatches.length > 0;

    const label = `[history-sync] ${safeConsigneLabel(consigne)} (#${consigne.id ?? "?"})`;
    const groupMethod = hasDifferences ? console.group : console.groupCollapsed;
    if (typeof groupMethod !== "function") {
      if (hasDifferences) {
        console.warn(label, "différences détectées", {
          missingInTimeline,
          missingInPanel,
          statusMismatches,
          idMismatches,
          hasTimeline,
          context,
        });
      } else {
        console.info(`${label}: OK`, { count: panelEntries.length, context });
      }
      return;
    }

    groupMethod.call(console, label);
    console.info("contexte", context);
    if (!hasTimeline) {
      console.warn("Pastilles non disponibles pour comparaison (row introuvable ou timeline vide).");
    } else {
      console.table?.(timelineEntries);
    }
    console.table?.(panelEntries);
    if (missingInTimeline.length) {
      console.warn("Présent dans l’historique (panel) mais absent des pastilles :", missingInTimeline);
    }
    if (missingInPanel.length) {
      console.warn("Présent dans les pastilles mais absent du panneau :", missingInPanel);
    }
    if (statusMismatches.length) {
      console.warn("Statuts divergents :", statusMismatches);
    }
    if (idMismatches.length) {
      console.warn("responseId divergents :", idMismatches);
    }
    if (!hasDifferences) {
      console.info(`Aucune divergence détectée (${panelEntries.length} entrées synchronisées).`);
    }
    console.groupEnd();
  } catch (error) {
    console.warn("[history-sync] comparaison impossible", error);
  }
}

const EDITABLE_HISTORY_TYPES = new Set([
  "short",
  "long",
  "num",
  "montant",
  "likert5",
  "likert6",
  "yesno",
  "checklist",
]);

async function openHistory(ctx, consigne, options = {}) {
  options = { ...options };
  const focusDayKeyOption =
    typeof options.focusDayKey === "string" && options.focusDayKey.trim() ? options.focusDayKey.trim() : "";
  const autoEdit = options.autoEdit === true;
  options.autoEdit = false;
  const consigneId = consigne?.id || "";
  const consigneType = consigne?.type || "";
  modesLogger.group("ui.history.open", { consigneId, type: consigneType });

  if (!consigneId) {
    modesLogger.warn("ui.history.consigne.missing", { consigne });
    showToast("Historique indisponible : consigne introuvable.");
    modesLogger.groupEnd();
    return null;
  }

  const uid = ctx?.user?.uid;
  if (!uid) {
    modesLogger.warn("ui.history.user.missing", { hasCtx: Boolean(ctx) });
    showToast("Historique indisponible : utilisateur non identifié.");
    modesLogger.groupEnd();
    return null;
  }

  const safeConsigneLabel = (item) =>
    (item?.text || item?.titre || "Sans titre").toString();

  let parentConsigneForDropdown = null;
  let childConsignesForDropdown = [];
  if (consigne.parentId) {
    const parentId = consigne.parentId;
    try {
      const parentRef = modesFirestore.doc(ctx.db, "u", uid, "consignes", parentId);
      const parentSnap = await modesFirestore.getDoc(parentRef);
      if (Schema.snapshotExists?.(parentSnap)) {
        parentConsigneForDropdown = { id: parentSnap.id, ...(parentSnap.data() || {}) };
      }
    } catch (error) {
      modesLogger.warn("ui.history.parent.load", { error, parentId });
    }
    if (parentConsigneForDropdown) {
      try {
        childConsignesForDropdown = await Schema.listChildConsignes(ctx.db, uid, parentConsigneForDropdown.id);
      } catch (error) {
        modesLogger.warn("ui.history.children.load", { error, parentId });
      }
    }
  } else if (consigne.id) {
    try {
      childConsignesForDropdown = await Schema.listChildConsignes(ctx.db, uid, consigne.id);
    } catch (error) {
      modesLogger.warn("ui.history.children.load", { error, parentId: consigne.id });
    }
  }

  const dropdownConsignes = [];
  const seenConsigneIds = new Set();
  const pushConsigneCandidate = (item) => {
    const id = String(item?.id ?? "");
    if (!id || seenConsigneIds.has(id)) return;
    dropdownConsignes.push(item);
    seenConsigneIds.add(id);
  };

  if (parentConsigneForDropdown) {
    pushConsigneCandidate(parentConsigneForDropdown);
  }
  if (!consigne.parentId) {
    pushConsigneCandidate(consigne);
  }
  childConsignesForDropdown.forEach((child) => {
    pushConsigneCandidate(child);
  });
  if (consigne.parentId) {
    const currentId = String(consigne.id ?? "");
    if (!seenConsigneIds.has(currentId)) {
      pushConsigneCandidate(consigne);
    } else {
      const index = dropdownConsignes.findIndex((item) => String(item?.id ?? "") === currentId);
      if (index >= 0) {
        dropdownConsignes[index] = consigne;
      }
    }
  }

  const dropdownConsigneMap = new Map(dropdownConsignes.map((item) => [String(item?.id ?? ""), item]));
  const hasDropdownSelection = dropdownConsignes.length > 1;

  const historyFetch = await fetchConsigneHistoryRows(ctx, consigneId, { limit: HISTORY_PANEL_FETCH_LIMIT });
  if (!ctx?.db || (Array.isArray(historyFetch.missing) && historyFetch.missing.length)) {
    modesLogger.warn("ui.history.firestore.missing", {
      hasDb: Boolean(ctx?.db),
      missing: historyFetch.missing || [],
    });
    showToast("Historique indisponible : connexion aux données manquante.");
    modesLogger.groupEnd();
    return null;
  }
  if (historyFetch.error) {
    modesLogger.warn("ui.history.firestore.error", historyFetch.error);
    showToast("Impossible de charger l’historique pour le moment.");
    modesLogger.groupEnd();
    return null;
  }

  const size = historyFetch.size;
  modesLogger.info("ui.history.rows", size);
  let rows = Array.isArray(historyFetch.rows) ? historyFetch.rows.slice() : [];

  const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const dayDisplayFormatter = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
  const capitalizeLabel = (value) => (typeof value === "string" && value.length ? value.charAt(0).toUpperCase() + value.slice(1) : value);
  const formatDisplayDate = (date, { preferDayView = false } = {}) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "";
    }
    const formatter = preferDayView ? dayDisplayFormatter : dateTimeFormatter;
    const raw = formatter.format(date);
    return capitalizeLabel(raw);
  };
  const priorityToneValue = priorityTone(consigne.priority);

  function relativeLabel(date) {
    if (!date || Number.isNaN(date.getTime())) return "";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const base = new Date(date.getTime());
    base.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today.getTime() - base.getTime()) / 86400000);
    if (diffDays === 0) return "Aujourd’hui";
    if (diffDays === 1) return "Hier";
    if (diffDays > 1 && diffDays < 7) return `Il y a ${diffDays} j`;
    if (diffDays < 0) {
      const future = Math.abs(diffDays);
      if (future === 1) return "Demain";
      if (future < 7) return `Dans ${future} j`;
    }
    return "";
  }

  function firstNonEmptyString(...values) {
    for (const value of values) {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }
    return "";
  }

  const chartPoints = [];
  const HISTORY_RANGE_PRESETS = {
    iterations: [
      { value: "last5", label: "5 dernières itérations" },
      { value: "last10", label: "10 dernières itérations" },
      { value: "last20", label: "20 dernières itérations" },
      { value: "last50", label: "50 dernières itérations" },
    ],
    periods: [
      { value: "7d", label: "Hebdomadaire" },
      { value: "30d", label: "Mensuel" },
      { value: "365d", label: "Annuel" },
      { value: "bilan", label: "Bilans" },
      { value: "all", label: "Toutes les entrées" },
    ],
  };
  const FALLBACK_HISTORY_RANGE = "last20";

  function buildHistoryRangePresets(source) {
    const iterationPresets = HISTORY_RANGE_PRESETS.iterations.slice();
    const periodPresets = HISTORY_RANGE_PRESETS.periods.slice();
    if (source === "daily") {
      return periodPresets;
    }
    if (source === "practice") {
      return periodPresets.concat(iterationPresets);
    }
    return iterationPresets.concat(periodPresets);
  }

  function ensureHistoryRangeKey(rangeKey, presets) {
    const values = new Set(presets.map((preset) => preset.value));
    if (values.has(rangeKey)) {
      return rangeKey;
    }
    return presets[0]?.value || FALLBACK_HISTORY_RANGE;
  }

  function applyHistoryRange(points, rangeKey, options = {}) {
    const allPoints = Array.isArray(points) ? points : [];
    const validPoints = allPoints
      .filter((pt) => pt && pt.date instanceof Date && !Number.isNaN(pt.date.getTime()))
      .map((pt) => ({ ...pt }));
    const DAY_MS = 86400000;
    const sortedAsc = validPoints.slice().sort((a, b) => a.date - b.date);
    const normalizedOffset = Number.isFinite(options.offset) ? Math.trunc(options.offset) : 0;

    const buildResult = (items, range = {}, options = {}) => {
      const sanitized = (Array.isArray(items) ? items : []).slice().sort((a, b) => a.date - b.date);
      const firstDate = sanitized[0]?.date ?? null;
      const lastDate = sanitized[sanitized.length - 1]?.date ?? null;
      let start = range.start instanceof Date && !Number.isNaN(range.start.getTime()) ? range.start : firstDate;
      let end = range.end instanceof Date && !Number.isNaN(range.end.getTime()) ? range.end : lastDate;
      if (start && end && end <= start) {
        end = new Date(start.getTime() + DAY_MS);
      }
      return {
        points: sanitized,
        range: {
          start: start || null,
          end: end || null,
        },
        axis: typeof options.axis === "string" ? options.axis : "",
      };
    };

    const mostRecentPoint = sortedAsc[sortedAsc.length - 1]?.date instanceof Date
      ? new Date(sortedAsc[sortedAsc.length - 1].date)
      : new Date();

    switch (rangeKey) {
      case "last5":
      case "last10":
      case "last20":
      case "last50": {
        const count = Number(rangeKey.replace("last", ""));
        const subset = sortedAsc.slice(-count);
        return buildResult(subset, {}, { axis: "iteration" });
      }
      case "7d": {
        const anchor = mostRecentPoint instanceof Date ? new Date(mostRecentPoint) : new Date();
        anchor.setHours(0, 0, 0, 0);
        const startOfWindow = new Date(anchor);
        startOfWindow.setDate(startOfWindow.getDate() - 6 + normalizedOffset * 7);
        const endOfWindow = new Date(startOfWindow.getTime() + 7 * DAY_MS);
        const filtered = sortedAsc.filter((pt) => pt.date >= startOfWindow && pt.date < endOfWindow);
        return buildResult(filtered, { start: startOfWindow, end: endOfWindow }, { axis: "rolling7d" });
      }
      case "30d": {
        const anchor = mostRecentPoint instanceof Date ? new Date(mostRecentPoint) : new Date();
        const startOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
        startOfMonth.setMonth(startOfMonth.getMonth() + normalizedOffset);
        const endOfMonth = new Date(startOfMonth.getFullYear(), startOfMonth.getMonth() + 1, 1);
        const filtered = sortedAsc.filter((pt) => pt.date >= startOfMonth && pt.date < endOfMonth);
        return buildResult(filtered, { start: startOfMonth, end: endOfMonth }, { axis: "month" });
      }
      case "365d": {
        const anchor = mostRecentPoint instanceof Date ? new Date(mostRecentPoint) : new Date();
        const startOfYear = new Date(anchor.getFullYear(), 0, 1);
        startOfYear.setFullYear(startOfYear.getFullYear() + normalizedOffset);
        const endOfYear = new Date(startOfYear.getFullYear() + 1, 0, 1);
        const filtered = sortedAsc.filter((pt) => pt.date >= startOfYear && pt.date < endOfYear);
        return buildResult(filtered, { start: startOfYear, end: endOfYear }, { axis: "year" });
      }
      case "bilan": {
        const filtered = sortedAsc.filter((pt) => pt.isBilan);
        return buildResult(filtered, {}, { axis: "bilan" });
      }
      case "all":
      default:
        return buildResult(sortedAsc);
    }
  }

  const HISTORY_NAVIGATION_FALLBACK_LIMITS = {
    "7d": 52,
    "30d": 24,
    "365d": 5,
  };

  function computeHistoryNavigationBounds(points) {
    const fallbackBounds = Object.entries(HISTORY_NAVIGATION_FALLBACK_LIMITS).reduce((acc, [key, limit]) => {
      acc[key] = { min: Number.isFinite(limit) ? -Math.abs(limit) : 0, max: 0 };
      return acc;
    }, {});
    const bounds = { ...fallbackBounds };
    if (!Array.isArray(points) || !points.length) {
      return bounds;
    }
    const sortedAsc = points
      .filter((pt) => pt && pt.date instanceof Date && !Number.isNaN(pt.date.getTime()))
      .slice()
      .sort((a, b) => a.date - b.date);
    if (!sortedAsc.length) {
      return bounds;
    }
    const first = sortedAsc[0].date;
    const last = sortedAsc[sortedAsc.length - 1].date;
    if (!(first instanceof Date) || !(last instanceof Date)) {
      return bounds;
    }

    const DAY_MS = 86400000;
    const startOfWeek = (date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const day = d.getDay();
      const diffToMonday = (day + 6) % 7;
      d.setDate(d.getDate() - diffToMonday);
      return d;
    };
    const latestWeekStart = startOfWeek(last);
    const earliestWeekStart = startOfWeek(first);
    const diffWeeks = Math.max(0, Math.floor((latestWeekStart - earliestWeekStart) / (7 * DAY_MS)));
    const fallbackWeek = fallbackBounds["7d"]?.min ?? 0;
    bounds["7d"] = { min: Math.min(-diffWeeks, fallbackWeek), max: 0 };

    const monthIndex = (date) => date.getFullYear() * 12 + date.getMonth();
    const latestMonthIndex = monthIndex(last);
    const earliestMonthIndex = monthIndex(first);
    const diffMonths = Math.max(0, latestMonthIndex - earliestMonthIndex);
    const fallbackMonth = fallbackBounds["30d"]?.min ?? 0;
    bounds["30d"] = { min: Math.min(-diffMonths, fallbackMonth), max: 0 };

    const diffYears = Math.max(0, last.getFullYear() - first.getFullYear());
    const fallbackYear = fallbackBounds["365d"]?.min ?? 0;
    bounds["365d"] = { min: Math.min(-diffYears, fallbackYear), max: 0 };

    return bounds;
  }

  const historySource = typeof options.source === "string" ? options.source.toLowerCase() : "";
  const historyRangePresets = buildHistoryRangePresets(historySource);
  const defaultHistoryRange = ensureHistoryRangeKey(FALLBACK_HISTORY_RANGE, historyRangePresets);
  const historyRangeOptions = historyRangePresets
    .map((option) => {
      const selectedAttr = option.value === defaultHistoryRange ? " selected" : "";
      return `<option value="${escapeHtml(option.value)}"${selectedAttr}>${escapeHtml(option.label)}</option>`;
    })
    .join("");

  const rowMetas = [];
  const list = rows
    .map((r, index) => {
      const recordedAt = firstValidDate([
        r.createdAt,
        r.created_at,
        r.recordedAt,
        r.recorded_at,
        r.updatedAt,
        r.updated_at,
      ]);
      const primaryDate = resolveHistoryEntryDate(r);
      const timelineKeyInfo = resolveHistoryTimelineKey(r, consigne);
      const canonicalDayKey = timelineKeyInfo?.dayKey || "";
      const dayKeyFallback = resolveHistoryResponseDayKey(r, primaryDate || recordedAt);
      const dayKey = canonicalDayKey || dayKeyFallback;
      const dayDate =
        timelineKeyInfo?.date instanceof Date && !Number.isNaN(timelineKeyInfo.date.getTime())
          ? timelineKeyInfo.date
          : dayKey
          ? modesParseDayKeyToDate(dayKey)
          : null;
      const displayDate = firstValidDate([dayDate, primaryDate, recordedAt]);
      const iso = displayDate instanceof Date ? displayDate.toISOString() : "";
      const dateText = displayDate instanceof Date
        ? formatDisplayDate(displayDate, { preferDayView: Boolean(dayDate) })
        : "Date inconnue";
      const relative = displayDate instanceof Date ? relativeLabel(displayDate) : "";
  const formattedText = formatConsigneValue(consigne.type, r.value, { consigne });
  const formattedHtml = formatConsigneValue(consigne.type, r.value, { mode: "html", consigne });
  // Align panel status computation with timeline by normalizing the value first
  const normalizedValueForStatus = resolveHistoryTimelineValue(r, consigne);
  const status = dotColor(consigne.type, normalizedValueForStatus ?? r.value, consigne) || "na";
  const numericValue = numericPoint(consigne.type, normalizedValueForStatus ?? r.value, consigne);
      const montantDetails =
        consigne.type === "montant" ? normalizeMontantValue(r.value, consigne) : null;
      const chartValue =
        consigne.type === "montant"
          ? Number.isFinite(montantDetails?.amount)
            ? montantDetails.amount
            : Number.NaN
          : Number(numericValue);
      const note = r.note && String(r.note).trim();
      const summaryInfo = resolveHistoryEntrySummaryInfo(r);
      const normalizedDayKey = normalizeHistoryDayKey(dayKey);
      const computedHistoryId = resolveHistoryDocumentId(r, dayKey);
      const historyId =
        (typeof r.historyId === "string" && r.historyId.trim()) ||
        (typeof r.history_id === "string" && r.history_id.trim()) ||
        (typeof computedHistoryId === "string" && computedHistoryId.trim() ? computedHistoryId.trim() : "");
      const computedResponseId = resolveHistoryResponseId(r);
      const responseId =
        (typeof r.responseId === "string" && r.responseId.trim()) ||
        (typeof r.response_id === "string" && r.response_id.trim()) ||
        (typeof r.id === "string" && r.id.trim()) ||
        (typeof computedResponseId === "string" && computedResponseId.trim() ? computedResponseId.trim() : "");
      rowMetas.push({
        index,
        dayKey,
        normalizedDayKey,
        status,
        historyId,
        responseId,
        value: r.value,
        note: note || "",
        source: summaryInfo.isBilan ? "bilan" : normalizeHistoryMode(r),
      });
      const rawSummaryLabel = summaryInfo.isSummary
        ? firstNonEmptyString(
            r.summaryLabel,
            r.summary_label,
            r.summary?.label,
            r.summary?.title,
            r.summaryTitle,
            r.summary_title,
            r.label
          )
        : "";
      const defaultBilanLabel = summaryInfo.isBilan
        ? summaryInfo.scope === "monthly"
          ? "Bilan mensuel"
          : summaryInfo.scope === "weekly"
          ? "Bilan hebdomadaire"
          : summaryInfo.scope === "yearly"
          ? "Bilan annuel"
          : "Bilan"
        : "";
      const summaryLabel = rawSummaryLabel || defaultBilanLabel;
      const summaryNoteLabel = summaryLabel
        ? summaryInfo.isBilan
          ? summaryInfo.scope === "monthly"
            ? "Note de bilan mensuel"
            : summaryInfo.scope === "weekly"
            ? "Note de bilan hebdomadaire"
            : summaryInfo.scope === "yearly"
            ? "Note de bilan annuel"
            : "Note de bilan"
          : summaryLabel
        : "";
      const noteClasses = ["history-panel__note"];
      let noteDataAttrs = "";
      let noteBadgeMarkup = "";
      if (note && summaryNoteLabel) {
        if (summaryInfo.isBilan) {
          noteClasses.push("history-panel__note--bilan");
          const scopeAttr = summaryInfo.scope
            ? ` data-note-scope="${escapeHtml(summaryInfo.scope)}"`
            : "";
          noteDataAttrs = ` data-note-source="bilan"${scopeAttr}`;
        }
        noteBadgeMarkup = `<span class="history-panel__note-badge">${escapeHtml(summaryNoteLabel)}</span>`;
      }
      const noteMarkup = note
        ? `<p class="${noteClasses.join(" ")}"${noteDataAttrs}>${noteBadgeMarkup}${noteBadgeMarkup ? " " : ""}<span class="history-panel__note-text">${escapeHtml(note)}</span></p>`
        : "";
      const statusLabel = STATUS_LABELS[status] || "Valeur";
      const hasFormatted = formattedText && formattedText.trim() && formattedText !== "—";
      const formattedMarkup = hasFormatted ? formattedHtml : escapeHtml(consigne.type === "info" ? "" : "—");
      let checklistBadgeMarkup = "";
      if (consigne.type === "checklist") {
        const stats = resolveChecklistStatsFromResponse(r) || deriveChecklistStats(r.value);
        if (stats) {
          const pct = Number.isFinite(stats.percentage) ? stats.percentage : 0;
          const colorFn = window.ColorUtils?.checklistColor;
          let colorKey = null;
          if (typeof colorFn === "function") {
            colorKey = colorFn(pct);
          } else if (pct >= 80) {
            colorKey = "green";
          } else if (pct >= 60) {
            colorKey = "green-light";
          } else if (pct >= 40) {
            colorKey = "yellow";
          } else if (pct >= 20) {
            colorKey = "red-light";
          } else {
            colorKey = "red";
          }
          const badgeClasses = ["badge", "badge--checklist"];
          if (colorKey) {
            badgeClasses.push(colorKey);
          }
          checklistBadgeMarkup = `<span class="${badgeClasses.join(" ")}">${escapeHtml(`${pct}%`)}</span>`;
        }
      }
      if (displayDate instanceof Date && numericValue !== null && !Number.isNaN(numericValue)) {
        chartPoints.push({
          date: displayDate,
          value: chartValue,
          progress: montantDetails?.progress ?? null,
          isSummary: Boolean(summaryInfo.isSummary),
          summaryScope: summaryInfo.scope || "",
          isBilan: Boolean(summaryInfo.isBilan),
          recordedAt: recordedAt instanceof Date && !Number.isNaN(recordedAt?.getTime?.()) ? recordedAt : null,
          dayKey: typeof dayKey === "string" ? dayKey : "",
        });
      }
      const summaryAttr = summaryInfo.isSummary
        ? ` data-summary="1"${summaryInfo.scope ? ` data-summary-scope="${escapeHtml(summaryInfo.scope)}"` : ""}`
        : "";
      const bilanAttr = summaryInfo.isBilan ? ' data-history-source="bilan"' : "";
      const summaryClass = summaryInfo.isSummary ? " history-panel__item--summary" : "";
      const bilanClass = summaryInfo.isBilan ? " history-panel__item--bilan" : "";
      const summaryBadge = summaryLabel
        ? `<span class="history-panel__summary-badge">${escapeHtml(summaryLabel)}</span>`
        : "";
      let markerTitle = "";
      if (summaryInfo.isSummary && summaryLabel) {
        markerTitle = summaryLabel;
      } else if (summaryInfo.isBilan) {
        markerTitle = summaryLabel || "Bilan";
      }
      const summaryMarker = summaryInfo.isBilan
        ? `<span class="history-panel__summary-marker"${markerTitle ? ` title="${escapeHtml(markerTitle)}"` : ""} aria-hidden="true"></span>`
        : "";
      const valueClasses = ["history-panel__value"];
      if (summaryInfo.isSummary) {
        valueClasses.push("history-panel__value--summary");
      }
      let recordedMetaLabel = "";
      if (dayDate && recordedAt && !Number.isNaN(recordedAt.getTime())) {
        const sameDay =
          recordedAt.getFullYear() === dayDate.getFullYear() &&
          recordedAt.getMonth() === dayDate.getMonth() &&
          recordedAt.getDate() === dayDate.getDate();
        if (!sameDay) {
          recordedMetaLabel = formatDisplayDate(recordedAt, { preferDayView: false });
        }
      }
      const metaParts = [];
      if (relative) {
        metaParts.push(`<span class="history-panel__meta">${escapeHtml(relative)}</span>`);
      }
      if (recordedMetaLabel && recordedMetaLabel !== dateText) {
        metaParts.push(
          `<span class="history-panel__meta">${escapeHtml(`Enregistré le ${recordedMetaLabel}`)}</span>`
        );
      }
      if (summaryBadge) {
        metaParts.push(summaryBadge);
      }
      const metaRowMarkup = metaParts.length
        ? `<div class="history-panel__meta-row">${metaParts.join(" ")}</div>`
        : "";
      const dayKeyAttr = dayKey ? ` data-day-key="${escapeHtml(dayKey)}"` : "";
      const responseIdAttr = responseId ? ` data-response-id="${escapeHtml(String(responseId))}"` : "";
      const historyIdAttr = historyId ? ` data-history-id="${escapeHtml(String(historyId))}"` : "";
      // Allow editing normal entries and bilan summary entries
      const canEditEntry = EDITABLE_HISTORY_TYPES.has(consigne.type) && dayKey && (!summaryInfo.isSummary || summaryInfo.isBilan);
      const editButtonMarkup = canEditEntry
        ? `<button type="button" class="history-panel__item-edit" data-history-edit aria-label="Modifier la réponse">Modifier</button>`
        : "";
      return `
        <li class="history-panel__item${summaryClass}${bilanClass}" data-history-entry data-history-index="${index}" data-priority-tone="${escapeHtml(priorityToneValue)}" data-status="${escapeHtml(status)}"${summaryAttr}${dayKeyAttr}${responseIdAttr}${historyIdAttr}${bilanAttr}>
          <div class="history-panel__item-row">
            <span class="${valueClasses.join(" ")}" data-priority-tone="${escapeHtml(priorityToneValue)}" data-status="${escapeHtml(status)}">
              <span class="history-panel__dot history-panel__dot--${status}" data-status-dot data-priority-tone="${escapeHtml(priorityToneValue)}" aria-hidden="true"></span>
              ${summaryMarker}
              <span class="history-panel__value-text">${formattedMarkup}</span>
              ${checklistBadgeMarkup}
              <span class="sr-only">${escapeHtml(statusLabel)}</span>
            </span>
            <div class="history-panel__item-meta-group">
              <time class="history-panel__date" datetime="${escapeHtml(iso)}">${escapeHtml(dateText)}</time>
              ${editButtonMarkup}
            </div>
          </div>
          ${metaRowMarkup}
          ${noteMarkup}
        </li>
      `;
    })
    .join("");

  refreshConsigneTimelineWithRows(consigne, rows);
  logConsigneHistoryComparison(consigne, rowMetas, {
    source: historySource || options.source || "",
    size,
    panelCount: rowMetas.length,
  });
  logChecklistHistoryInspection(consigne, {
    label: "panel:rows",
    entries: rows,
  });

  const totalLabel = rows.length === 0 ? "Aucune entrée" : rows.length === 1 ? "1 entrée" : `${rows.length} entrées`;
  const navigationBounds = computeHistoryNavigationBounds(chartPoints);
  const initialChartPoints = applyHistoryRange(chartPoints, defaultHistoryRange);
  const chartMarkup = renderHistoryChart(initialChartPoints, { type: consigne.type, mode: historySource });
  const consigneOptionsMarkup = hasDropdownSelection
    ? dropdownConsignes
        .map((item) => {
          const id = String(item?.id ?? "");
          if (!id) return "";
          const selected = id === String(consigne.id ?? "");
          return `<option value="${escapeHtml(id)}"${selected ? " selected" : ""}>${escapeHtml(
            safeConsigneLabel(item)
          )}</option>`;
        })
        .join("")
    : "";
  const historyHeadingMarkup = hasDropdownSelection
    ? `Historique — <span class="history-panel__heading-select"><span class="sr-only">Choisir une consigne</span><select data-history-consigne aria-label="Choisir une consigne">${consigneOptionsMarkup}</select></span>`
    : `Historique — ${escapeHtml(safeConsigneLabel(consigne))}`;

  const resolveNavigationBounds = (key) => {
    const fallbackLimit = HISTORY_NAVIGATION_FALLBACK_LIMITS[key];
    const defaultBounds = Number.isFinite(fallbackLimit)
      ? { min: -Math.abs(fallbackLimit), max: 0 }
      : { min: 0, max: 0 };
    const bounds = navigationBounds[key];
    if (bounds && typeof bounds === "object") {
      const hasMin = Object.prototype.hasOwnProperty.call(bounds, "min");
      const hasMax = Object.prototype.hasOwnProperty.call(bounds, "max");
      return {
        min: hasMin ? bounds.min : defaultBounds.min,
        max: hasMax ? bounds.max : defaultBounds.max,
      };
    }
    return defaultBounds;
  };

  const html = `
    <div class="history-panel">
      <header class="history-panel__header">
        <div class="history-panel__title">
          <h3 class="history-panel__heading">${historyHeadingMarkup}</h3>
          <p class="history-panel__subtitle">Dernières réponses enregistrées</p>
        </div>
        <div class="history-panel__actions">
          <label class="history-panel__range">
            <span>Vue</span>
            <select data-history-range>${historyRangeOptions}</select>
          </label>
          <div class="history-panel__nav" data-history-nav hidden>
            <button type="button" class="history-panel__nav-btn" data-history-nav-prev aria-label="Période précédente">&larr;</button>
            <span class="history-panel__nav-label" data-history-range-label></span>
            <button type="button" class="history-panel__nav-btn" data-history-nav-next aria-label="Période suivante">&rarr;</button>
          </div>
          <span class="history-panel__badge">${escapeHtml(totalLabel)}</span>
          <button class="btn btn-ghost text-sm" data-close>Fermer</button>
        </div>
      </header>
      <div class="history-panel__body">
        <div data-history-chart>${chartMarkup}</div>
        <ul class="history-panel__list">${list || '<li class="history-panel__empty">Aucune réponse pour l’instant.</li>'}</ul>
      </div>
    </div>
  `;
  const panel = drawer(html);
  panel.querySelector('[data-close]')?.addEventListener('click', () => panel.remove());
  const panelRoot = panel.querySelector('.history-panel');
  if (panelRoot) {
    if (consigne?.id != null) {
      panelRoot.dataset.historyPanelConsigne = String(consigne.id);
    } else {
      delete panelRoot.dataset.historyPanelConsigne;
    }
  }

  const chartContainer = panel.querySelector('[data-history-chart]');
  const rangeSelector = panel.querySelector('[data-history-range]');
  const navContainer = panel.querySelector('[data-history-nav]');
  const navLabel = panel.querySelector('[data-history-range-label]');
  const navPrev = panel.querySelector('[data-history-nav-prev]');
  const navNext = panel.querySelector('[data-history-nav-next]');
  const consigneSelector = panel.querySelector('[data-history-consigne]');
  const listContainer = panel.querySelector('.history-panel__list');
  if (consigneSelector) {
    consigneSelector.addEventListener('change', (event) => {
      const nextId = String(event.target?.value ?? '');
      const currentId = String(consigne.id ?? '');
      if (!nextId || nextId === currentId) {
        return;
      }
      const nextConsigne = dropdownConsigneMap.get(nextId);
      if (!nextConsigne) {
        return;
      }
      panel.remove();
      openHistory(ctx, nextConsigne, options);
    });
  }

  const reopenHistory = () => {
    try {
      panel.remove();
    } catch (error) {
      modesLogger.warn('ui.history.panel.remove', error);
    }
    openHistory(ctx, consigne, options);
  };
  if (panelRoot) {
    panelRoot.__historyReopen = reopenHistory;
  }

  const openEntryEditor = async (entryIndex, itemNode) => {
    if (!EDITABLE_HISTORY_TYPES.has(consigne.type)) {
      showToast("Modification non disponible pour ce type de consigne.");
      return;
    }
    const row = rows[entryIndex];
    if (!row) return;
    const dayKeyAttr = itemNode?.getAttribute('data-day-key');
    const responseIdAttr = itemNode?.getAttribute('data-response-id');
    const historyIdAttr = itemNode?.getAttribute('data-history-id');
    const isBilanEntry = itemNode?.getAttribute('data-history-source') === 'bilan';
    const dayKey = dayKeyAttr && dayKeyAttr.trim() ? dayKeyAttr.trim() : resolveHistoryResponseDayKey(row, null);
    if (!dayKey) {
      showToast("Impossible d’identifier la date de cette réponse.");
      return;
    }
    if (consigne.type === "checklist") {
      const panelSummary = summarizeChecklistValue(row.value);
      logChecklistHistoryInspection(consigne, {
        label: "panel:item",
        focusDayKey: dayKey,
        panelSummary: panelSummary
          ? {
              summary: panelSummary,
              responseId:
                (typeof row.responseId === "string" && row.responseId.trim()) ||
                (typeof row.response_id === "string" && row.response_id.trim()) ||
                (typeof row.id === "string" && row.id.trim()) ||
                (responseIdAttr && responseIdAttr.trim()) ||
                "",
              historyId:
                (typeof row.historyId === "string" && row.historyId.trim()) ||
                (typeof row.history_id === "string" && row.history_id.trim()) ||
                (historyIdAttr && historyIdAttr.trim()) ||
                "",
              rawValue: row.value ?? null,
            }
          : null,
        entries: [],
      });
    }
    let historyDocumentId = dayKey;
    let resolveHistoryDocPromise = null;
    if (ctx?.db && typeof Schema?.loadConsigneHistory === "function") {
      resolveHistoryDocPromise = (async () => {
        try {
          const historyEntries = await Schema.loadConsigneHistory(ctx.db, ctx.user.uid, consigne.id);
          const match = findHistoryEntryForDayKey(historyEntries, consigne, dayKey, {
            responseId: responseIdAttr,
            historyId: historyIdAttr,
          });
          const historyEntry = match?.entry || null;
          const resolvedId = resolveHistoryDocumentId(historyEntry, dayKey);
          if (resolvedId) {
            historyDocumentId = resolvedId;
          }
        } catch (error) {
          modesLogger?.warn?.("ui.history.resolveDocId", { consigneId: consigne.id, dayKey, error });
        }
      })();
    }
    const ensureHistoryDocumentId = async () => {
      if (resolveHistoryDocPromise) {
        try {
          await resolveHistoryDocPromise;
        } catch (_) {}
        resolveHistoryDocPromise = null;
      }
      return historyDocumentId;
    };
    const createdAtSource = row.createdAt ?? row.updatedAt ?? null;
    const createdAt = asDate(createdAtSource);
    const dayDate = dayKey ? modesParseDayKeyToDate(dayKey) : null;
    const displayDate = dayDate || createdAt;
    const dateLabel = displayDate && !Number.isNaN(displayDate.getTime())
      ? formatDisplayDate(displayDate, { preferDayView: Boolean(dayDate) })
      : dayKey || 'Date inconnue';
    const relative = displayDate ? relativeLabel(displayDate) : '';
    const noteValue = row.note ? String(row.note) : '';
    const fieldId = `history-edit-value-${consigne.id}-${entryIndex}-${Date.now()}`;
    // If this is a bilan entry, open the dedicated bilan editor instead of the inline editor,
    // rendering inside the history panel so it appears on top.
    if (isBilanEntry) {
      await openBilanHistoryEditor(null, consigne, ctx, {
        dayKey,
        details: { rawValue: row.value, date: displayDate, timestamp: createdAtSource, isBilan: true },
        trigger: itemNode,
        renderInPanel: true,
        panel,
        responseId: responseIdAttr,
        onChange: reopenHistory,
      });
      return;
    }
    const valueField = renderConsigneValueField(consigne, row.value, fieldId);
    const autosaveKey = [`history-entry`, ctx.user?.uid || 'anon', consigne.id || 'consigne', dayKey]
      .map((part) => String(part || ''))
      .join(':');
    const responseSyncOptions = {
      responseId: responseIdAttr && responseIdAttr.trim() ? responseIdAttr.trim() : row.id || '',
      responseMode: normalizeHistoryMode(row) || row.mode || row.source || '',
      responseType: typeof row.type === 'string' && row.type.trim() ? row.type.trim() : consigne.type,
      responseDayKey: dayKey,
      responseCreatedAt:
        createdAt instanceof Date && !Number.isNaN(createdAt.getTime())
          ? createdAt.toISOString()
          : typeof createdAtSource === 'string'
          ? createdAtSource
          : '',
    };
    const syncTimelineAfterPanelChange = ({
      remove = false,
      value = "",
      note = "",
      historyId = "",
      responseId = "",
    } = {}) => {
      const snapshot = collectConsigneTimelineSnapshot(consigne);
      const timelineRow = snapshot?.row || null;
      if (!timelineRow) {
        return;
      }
      const normalizedValue = remove ? "" : value;
      const normalizedNote = remove ? "" : note;
      let status = "na";
      if (!remove) {
        const hasValue =
          normalizedValue !== null &&
          normalizedValue !== undefined &&
          !(typeof normalizedValue === "string" && normalizedValue === "");
        if (hasValue) {
          status = dotColor(consigne.type, normalizedValue, consigne) || "na";
        } else if (typeof normalizedNote === "string" && normalizedNote.trim()) {
          status = "note";
        }
      }
      updateConsigneHistoryTimeline(timelineRow, status, {
        consigne,
        value: normalizedValue,
        note: normalizedNote,
        dayKey,
        historyId,
        responseId,
        remove,
      });
      triggerConsigneRowUpdateHighlight(timelineRow);
    };
    const labelForAttr3 = consigne.type === "checklist" ? "" : ` for="${fieldId}"`;
    const editorHtml = `
      <form class="practice-editor" data-autosave-key="${escapeHtml(autosaveKey)}">
        <header class="practice-editor__header">
          <h3 class="practice-editor__title">Modifier la réponse</h3>
          <p class="practice-editor__subtitle">${escapeHtml(safeConsigneLabel(consigne))}</p>
        </header>
        <div class="practice-editor__section">
          <label class="practice-editor__label">Date</label>
          <p class="practice-editor__value">${escapeHtml(dateLabel)}${relative ? ` <span class="practice-editor__meta">(${escapeHtml(relative)})</span>` : ''}</p>
        </div>
        <div class="practice-editor__section">
          <label class="practice-editor__label"${labelForAttr3}>Valeur</label>
          ${valueField}
        </div>
        <div class="practice-editor__section">
          <label class="practice-editor__label" for="${fieldId}-note">Commentaire</label>
          <textarea id="${fieldId}-note" name="note" class="consigne-editor__textarea" placeholder="Ajouter un commentaire">${escapeHtml(noteValue)}</textarea>
        </div>
        <div class="practice-editor__actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annuler</button>
          <button type="button" class="btn btn-danger" data-clear>Effacer</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    `;
    const previousOverlay = panel.querySelector('.history-panel__edit-overlay');
    if (previousOverlay) {
      previousOverlay.dispatchEvent(new Event('history-edit-request-close'));
    }
    const overlay = document.createElement('div');
    overlay.className = 'history-panel__edit-overlay';
    overlay.innerHTML = `
      <div class="history-panel__edit-dialog" role="dialog" aria-modal="true" tabindex="-1">
        ${editorHtml}
      </div>
    `;
    panel.appendChild(overlay);
    const dialog = overlay.querySelector('.history-panel__edit-dialog');
    // Initialize checklist behaviors and scoping for history inline editor
    try {
      initializeChecklistScope(overlay, { dateKey: dayKey });
    } catch (_) {}
    const form = overlay.querySelector('form');
    const cancelBtn = form?.querySelector('[data-cancel]');
    const clearBtn = form?.querySelector('[data-clear]');
    const submitBtn = form?.querySelector('button[type="submit"]');
    let handleKeyDown;
    let overlayObserver;
    let cleanupListeners = null;
    const closeEditor = () => {
      if (cleanupListeners) {
        cleanupListeners();
      }
      if (overlay.isConnected) {
        overlay.remove();
      }
    };
    cleanupListeners = () => {
      if (handleKeyDown) {
        document.removeEventListener('keydown', handleKeyDown, true);
        handleKeyDown = null;
      }
      overlay.removeEventListener('history-edit-request-close', closeEditor);
      if (overlayObserver) {
        overlayObserver.disconnect();
        overlayObserver = null;
      }
      cleanupListeners = null;
    };
    handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeEditor();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    overlay.addEventListener('history-edit-request-close', closeEditor);
    overlayObserver = new MutationObserver(() => {
      if (!overlay.isConnected && cleanupListeners) {
        cleanupListeners();
      }
    });
    try {
      overlayObserver.observe(panel, { childList: true });
    } catch (error) {
      modesLogger?.warn?.('ui.history.edit.observe', error);
    }
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeEditor();
      }
    });
    requestAnimationFrame(() => {
      dialog?.focus({ preventScroll: true });
    });
    cancelBtn?.addEventListener('click', closeEditor);
    if (clearBtn) {
      const hasInitialData = (row.value !== '' && row.value != null) || (noteValue && noteValue.trim());
      if (!hasInitialData) {
        clearBtn.disabled = true;
      }
      clearBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        if (!confirm('Effacer la note pour cette date ?')) {
          return;
        }
        clearBtn.disabled = true;
        if (submitBtn) submitBtn.disabled = true;
        try {
          const targetDocId = await ensureHistoryDocumentId();
          await Schema.deleteHistoryEntry(ctx.db, ctx.user.uid, consigne.id, targetDocId, responseSyncOptions);
          try { removeRecentResponsesForDay(consigne.id, dayKey); } catch (e) {}
          try { await deleteAllResponsesForDay(ctx.db, ctx.user.uid, consigne.id, dayKey); } catch (e) {}
          syncTimelineAfterPanelChange({
            remove: true,
            historyId: targetDocId,
            responseId: responseSyncOptions?.responseId || "",
          });
            // Remove the item immediately in the UI for instant feedback
            try {
              const li = itemNode && itemNode.closest('[data-history-entry]');
              if (li && li.parentElement) {
                li.parentElement.removeChild(li);
                // Update header badge and empty state if needed
                const listEl = panel.querySelector('.history-panel__list');
                const badge = panel.querySelector('.history-panel__badge');
                const count = listEl ? listEl.querySelectorAll('[data-history-entry]').length : 0;
                if (badge) badge.textContent = count === 0 ? 'Aucune entrée' : (count === 1 ? '1 entrée' : `${count} entrées`);
                if (listEl && count === 0) {
                  listEl.innerHTML = '<li class="history-panel__empty">Aucune réponse pour l’instant.</li>';
                }
              }
            } catch (_) {}
          closeEditor();
          reopenHistory();
          // Clear local recent cache and notify global listeners so other views refresh
          try { clearRecentResponsesForConsigne(consigne.id); } catch (_) {}
          try {
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
              window.dispatchEvent(new CustomEvent('consigne:history:refresh', { detail: { consigneId: consigne.id } }));
            }
          } catch (_) {}
        } catch (error) {
          console.error('history-entry:clear', error);
          clearBtn.disabled = false;
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!submitBtn || submitBtn.disabled) return;
      submitBtn.disabled = true;
      if (clearBtn) clearBtn.disabled = true;
      try {
        const rawValue = readConsigneValueFromForm(consigne, form);
        const note = (form.elements.note?.value || '').trim();
        const isRawEmpty = rawValue === '' || rawValue == null;
        const targetDocId = await ensureHistoryDocumentId();
        if (isRawEmpty && !note) {
          await Schema.deleteHistoryEntry(ctx.db, ctx.user.uid, consigne.id, targetDocId, responseSyncOptions);
          try { removeRecentResponsesForDay(consigne.id, dayKey); } catch (e) {}
          try { await deleteAllResponsesForDay(ctx.db, ctx.user.uid, consigne.id, dayKey); } catch (e) {}
          syncTimelineAfterPanelChange({
            remove: true,
            historyId: targetDocId,
            responseId: responseSyncOptions?.responseId || "",
          });
        } else {
          await Schema.saveHistoryEntry(
            ctx.db,
            ctx.user.uid,
            consigne.id,
            targetDocId,
            {
              value: rawValue,
              note,
            },
            responseSyncOptions
          );
          try { removeRecentResponsesForDay(consigne.id, dayKey); } catch (e) {}
          syncTimelineAfterPanelChange({
            remove: false,
            value: rawValue,
            note,
            historyId: targetDocId,
            responseId: responseSyncOptions?.responseId || "",
          });
        }
        closeEditor();
        reopenHistory();
        // Clear local recent cache and notify global listeners so other views refresh
        try { clearRecentResponsesForConsigne(consigne.id); } catch (_) {}
        try {
          if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('consigne:history:refresh', { detail: { consigneId: consigne.id } }));
          }
        } catch (_) {}
      } catch (error) {
        console.error('history-entry:save', error);
        submitBtn.disabled = false;
        if (clearBtn) clearBtn.disabled = false;
      }
    });
  };

  if (listContainer) {
    listContainer.addEventListener('click', (event) => {
      const editTrigger = event.target.closest('[data-history-edit]');
      if (!editTrigger) return;
      const itemNode = editTrigger.closest('[data-history-entry]');
      if (!itemNode) return;
      const rawIndex = itemNode.getAttribute('data-history-index');
      const entryIndex = Number(rawIndex);
      if (!Number.isInteger(entryIndex) || entryIndex < 0 || entryIndex >= rows.length) {
        return;
      }
      event.preventDefault();
      void openEntryEditor(entryIndex, itemNode);
    });
    if (focusDayKeyOption) {
      const focusIndex = rows.findIndex((row) => {
        const createdAtSource = row?.createdAt ?? row?.updatedAt ?? null;
        const resolvedKey = resolveHistoryResponseDayKey(row, createdAtSource);
        return resolvedKey === focusDayKeyOption;
      });
      if (focusIndex >= 0) {
        const focusItem = listContainer.querySelector(
          `[data-history-entry][data-history-index="${focusIndex}"]`,
        );
        if (focusItem) {
          requestAnimationFrame(() => {
            try {
              focusItem.scrollIntoView({ block: "nearest", inline: "nearest" });
            } catch (_) {
              focusItem.scrollIntoView();
            }
            if (autoEdit && EDITABLE_HISTORY_TYPES.has(consigne.type)) {
              void openEntryEditor(focusIndex, focusItem);
            }
          });
        }
      }
    }
  }

  const NAVIGABLE_RANGES = new Set(["7d", "30d", "365d"]);
  const navigationState = {
    key: defaultHistoryRange,
    offsets: {
      "7d": 0,
      "30d": 0,
      "365d": 0,
    },
  };

  const weekRangeFormatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" });
  const monthRangeFormatter = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
  const yearRangeFormatter = new Intl.DateTimeFormat("fr-FR", { year: "numeric" });

  const formatHistoryRangeLabel = (result) => {
    if (!result || !result.range) return "";
    const start = result.range.start instanceof Date && !Number.isNaN(result.range.start.getTime()) ? result.range.start : null;
    const end = result.range.end instanceof Date && !Number.isNaN(result.range.end.getTime()) ? result.range.end : null;
    if (!start || !end) return "";
    const axis = typeof result.axis === "string" ? result.axis.toLowerCase() : "";
    if (axis === "rolling7d") {
      let inclusiveEnd = new Date(end.getTime() - 86400000);
      if (inclusiveEnd < start) {
        inclusiveEnd = new Date(start);
      }
      const sameYear = start.getFullYear() === inclusiveEnd.getFullYear();
      const startLabel = `${weekRangeFormatter.format(start)}${sameYear ? "" : ` ${yearRangeFormatter.format(start)}`}`;
      const endLabel = `${weekRangeFormatter.format(inclusiveEnd)} ${yearRangeFormatter.format(inclusiveEnd)}`;
      return `Du ${startLabel} au ${endLabel}`;
    }
    if (axis === "week") {
      let inclusiveEnd = new Date(end.getTime() - 86400000);
      if (inclusiveEnd < start) {
        inclusiveEnd = new Date(start);
      }
      const sameYear = start.getFullYear() === inclusiveEnd.getFullYear();
      const startLabel = `${weekRangeFormatter.format(start)}${sameYear ? "" : ` ${yearRangeFormatter.format(start)}`}`;
      const endLabel = `${weekRangeFormatter.format(inclusiveEnd)} ${yearRangeFormatter.format(inclusiveEnd)}`;
      return `Semaine du ${startLabel} au ${endLabel}`;
    }
    if (axis === "month") {
      return monthRangeFormatter.format(start);
    }
    if (axis === "year") {
      return `Année ${yearRangeFormatter.format(start)}`;
    }
    return "";
  };

  const updateNavControls = (selected, result) => {
    if (!navContainer || !navLabel || !navPrev || !navNext) return;
    const isNavigable = NAVIGABLE_RANGES.has(selected);
    navContainer.hidden = !isNavigable;
    if (!isNavigable) {
      navLabel.textContent = "";
      return;
    }
    const bounds = resolveNavigationBounds(selected);
    const offset = navigationState.offsets[selected] || 0;
    navLabel.textContent = formatHistoryRangeLabel(result);
    navPrev.disabled = offset <= (bounds.min ?? offset);
    navNext.disabled = offset >= (bounds.max ?? 0);
  };

  if (chartContainer && rangeSelector) {
    const updateChart = (forcedKey = null) => {
      const selectedKey = ensureHistoryRangeKey(forcedKey || rangeSelector.value || defaultHistoryRange, historyRangePresets);
      navigationState.key = selectedKey;
      if (rangeSelector.value !== selectedKey) {
        rangeSelector.value = selectedKey;
      }
      const offset = navigationState.offsets[selectedKey] || 0;
      const filteredPoints = applyHistoryRange(chartPoints, selectedKey, { offset });
      chartContainer.innerHTML = renderHistoryChart(filteredPoints, { type: consigne.type, mode: historySource });
      enhanceHistoryChart(chartContainer);
      updateNavControls(selectedKey, filteredPoints);
    };

    rangeSelector.addEventListener("change", () => {
      const selectedKey = ensureHistoryRangeKey(rangeSelector.value || defaultHistoryRange, historyRangePresets);
      if (NAVIGABLE_RANGES.has(selectedKey)) {
        navigationState.offsets[selectedKey] = 0;
      }
      updateChart(selectedKey);
    });

    if (navPrev) {
      navPrev.addEventListener("click", () => {
        const selectedKey = navigationState.key;
        if (!NAVIGABLE_RANGES.has(selectedKey)) return;
        const bounds = resolveNavigationBounds(selectedKey);
        const currentOffset = navigationState.offsets[selectedKey] || 0;
        const nextOffset = Math.max(bounds.min ?? currentOffset, currentOffset - 1);
        if (nextOffset === currentOffset) return;
        navigationState.offsets[selectedKey] = nextOffset;
        updateChart(selectedKey);
      });
    }

    if (navNext) {
      navNext.addEventListener("click", () => {
        const selectedKey = navigationState.key;
        if (!NAVIGABLE_RANGES.has(selectedKey)) return;
        const bounds = resolveNavigationBounds(selectedKey);
        const currentOffset = navigationState.offsets[selectedKey] || 0;
        const nextOffset = Math.min(bounds.max ?? 0, currentOffset + 1);
        if (nextOffset === currentOffset) return;
        navigationState.offsets[selectedKey] = nextOffset;
        updateChart(selectedKey);
      });
    }

    updateChart(defaultHistoryRange);
  }
  if (chartContainer && !rangeSelector) {
    enhanceHistoryChart(chartContainer);
  }

  modesLogger.groupEnd();

}

async function renderPractice(ctx, root, _opts = {}) {
  modesLogger.group("screen.practice.render", { hash: ctx.route });
  root.innerHTML = "";
  const container = document.createElement("div");
  container.className = "space-y-4";
  container.classList.add("w-full", "max-w-4xl", "mx-auto");
  container.dataset.practiceContainer = "1";
  container.__practiceCtx = ctx;
  root.appendChild(container);

  const currentHash = ctx.route || window.location.hash || "#/practice";
  const fetchedCategories = await Schema.fetchCategories(ctx.db, ctx.user.uid);
  const categories = sortCategoriesForDisplay(
    fetchedCategories.filter((cat) => cat.mode === "practice")
  );
  const qp = new URLSearchParams(currentHash.split("?")[1] || "");
  const requestedCat = qp.get("cat") || "";
  const storedCat = readStoredConsigneCategory(ctx?.user?.uid || null, "practice") || "";
  const categoryNames = categories.map((cat) => cat.name).filter(Boolean);

  let currentCat = requestedCat && categoryNames.includes(requestedCat) ? requestedCat : "";
  if (!currentCat) {
    if (storedCat && categoryNames.includes(storedCat)) {
      currentCat = storedCat;
    } else if (categoryNames.length) {
      currentCat = categoryNames[0];
    }
  }

  const basePath = (ctx.route || "#/practice").split("?")[0];
  if (currentCat && currentCat !== requestedCat) {
    storeConsigneCategory(ctx?.user?.uid || null, "practice", currentCat);
    navigate(`${toAppPath(basePath)}?cat=${encodeURIComponent(currentCat)}`);
    return;
  }

  if (!currentCat && categoryNames.length) {
    currentCat = categoryNames[0];
  }

  if (currentCat) {
    storeConsigneCategory(ctx?.user?.uid || null, "practice", currentCat);
  } else {
    storeConsigneCategory(ctx?.user?.uid || null, "practice", null);
  }

  const autosaveDayKey = typeof Schema.todayKey === "function"
    ? Schema.todayKey()
    : new Date().toISOString().slice(0, 10);
  const practiceFormAutosaveKey = [
    "practice-session",
    ctx.user?.uid || "anon",
    currentCat || "all",
    autosaveDayKey || "today",
  ].map((part) => String(part)).join(":");

  async function archiveConsigneWithRefresh(consigne, { close, row } = {}) {
    if (!consigne || !consigne.id) {
      return false;
    }
    const safeLabel = consigne.text || consigne.titre || "cette consigne";
    const confirmed = confirm(
      `Archiver « ${safeLabel} » ?\nTu pourras la retrouver dans les réponses archivées.`
    );
    if (!confirmed) {
      return false;
    }
    try {
      await Schema.archiveConsigne(ctx.db, ctx.user.uid, consigne.id);
      if (typeof close === "function") {
        try {
          close();
        } catch (error) {
          console.warn("practice.archive.close", error);
        }
      }
      const fallbackRow = row && row instanceof Element ? row : findPracticeConsigneRowById(consigne.id, container);
      if (fallbackRow) {
        const isChildRow = fallbackRow.classList.contains("consigne-row--child") && !fallbackRow.classList.contains("consigne-row--parent");
        removePracticeConsigneRow(fallbackRow, { removeGroup: !isChildRow });
        if (isChildRow) {
          const parentCard = fallbackRow.closest(".consigne-row--parent");
          if (parentCard && parentCard.__practiceEditorConfig) {
            const childConsignes = Array.isArray(parentCard.__practiceEditorConfig.childConsignes)
              ? parentCard.__practiceEditorConfig.childConsignes
              : [];
            parentCard.__practiceEditorConfig.childConsignes = childConsignes.filter((childCfg) => {
              const childId = childCfg?.consigne?.id ?? childCfg?.id;
              return String(childId) !== String(consigne.id);
            });
          }
        }
      }
      removePracticeHiddenConsigne(consigne.id, container);
      showToast("Consigne archivée.");
      return true;
    } catch (error) {
      console.error(error);
      showToast("Impossible d'archiver la consigne.");
      return false;
    }
  }

  const card = document.createElement("section");
  card.className = "card space-y-4 p-3 sm:p-4";
  card.dataset.practiceRoot = "1";
  card.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <span class="text-sm text-[var(--muted)]">Catégorie</span>
        <div data-practice-category-holder class="relative"></div>
      </div>
      <div class="flex items-center gap-2">
        ${smallBtn("📝 Faire un bilan", "js-bilan")}
        ${smallBtn("+ Nouvelle consigne", "js-new")}
      </div>
    </div>
    <form id="practice-form" class="grid gap-3" data-autosave-key="${escapeHtml(practiceFormAutosaveKey)}"></form>
    <div class="flex justify-end">
      <button class="btn btn-primary" type="button" id="save">Enregistrer</button>
    </div>
  `;
  container.appendChild(card);

  const categoryHolder = card.querySelector("[data-practice-category-holder]");
  if (categoryHolder) {
    if (categories.length) {
      const picker = createCategoryMenu({
        categories,
        currentName: currentCat,
        disabled: !categories.length,
        onSelect: (name) => {
          if (!name || name === currentCat) {
            storeConsigneCategory(ctx?.user?.uid || null, "practice", name || null);
            return;
          }
          storeConsigneCategory(ctx?.user?.uid || null, "practice", name);
          navigate(`${toAppPath(basePath)}?cat=${encodeURIComponent(name)}`);
        },
        onReorder: async (orderedIds) => {
          if (!ctx?.db || !ctx?.user?.uid) return;
          try {
            await Schema.reorderCategories(ctx.db, ctx.user.uid, orderedIds);
          } catch (error) {
            console.warn("practice.categories.reorder", error);
          }
        },
      });
      if (picker?.element) {
        categoryHolder.appendChild(picker.element);
      }
    } else {
      const empty = document.createElement("span");
      empty.className = "text-sm text-[var(--muted)]";
      empty.textContent = "Aucune catégorie";
      categoryHolder.appendChild(empty);
    }
  }
  card.querySelector(".js-new").onclick = () => openConsigneForm(ctx, null, { defaultCategory: currentCat });
  const bilanBtn = card.querySelector(".js-bilan");
  if (bilanBtn) {
    const hasCategory = Boolean(currentCat);
    bilanBtn.disabled = !hasCategory;
    bilanBtn.classList.toggle("opacity-50", !hasCategory);
    bilanBtn.onclick = async () => {
      if (!currentCat) return;
      await loadBilanSettings(ctx);
      const scopeChoice = await chooseBilanScope({
        allowMonthly: DAILY_MONTHLY_ENABLED,
      });
      if (!scopeChoice) {
        return;
      }
      const { scope } = scopeChoice;
      const practiceConsignes = summaryConsignes.slice();
      openBilanModal(ctx, {
        scope,
        title: `${scopeChoice.label} — ${currentCat}`,
        subtitle: `Catégorie : ${currentCat}`,
        sections: {
          practice: practiceConsignes,
          daily: [],
          objective: [],
        },
      });
    };
  }

  const all = await Schema.fetchConsignes(ctx.db, ctx.user.uid, "practice");
  const categoryConsignes = all.filter((c) => (c.category || "") === currentCat);
  const playableConsignes = categoryConsignes.filter((c) => !c.summaryOnlyScope);
  modesLogger.info("screen.practice.consignes", playableConsignes.length);

  const sortConsignesForDisplay = (list) =>
    list.slice().sort((a, b) => {
      const orderA = Number(a.order || 0);
      const orderB = Number(b.order || 0);
      if (orderA !== orderB) return orderA - orderB;
      const prioA = Number(a.priority || 0);
      const prioB = Number(b.priority || 0);
      if (prioA !== prioB) return prioA - prioB;
      return (a.text || a.titre || "").localeCompare(b.text || b.titre || "");
    });

  const orderSorted = sortConsignesForDisplay(playableConsignes);
  const summaryConsignes = sortConsignesForDisplay(categoryConsignes);

  const sessionIndex = await Schema.countPracticeSessions(ctx.db, ctx.user.uid);
  container.dataset.practiceSessionIndex = String(Number(sessionIndex) || 0);
  const visible = [];
  const hidden = [];
  for (const c of orderSorted) {
    if (c.srEnabled === false) {
      visible.push(c);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const st = await Schema.readSRState(ctx.db, ctx.user.uid, c.id, "consigne");
    if (!st || st.nextAllowedIndex === undefined || st.nextAllowedIndex <= sessionIndex) {
      visible.push(c);
    } else {
      hidden.push({ c, remaining: st.nextAllowedIndex - sessionIndex });
    }
  }

  const hiddenParentIds = new Set(hidden.map((entry) => entry?.c?.id).filter(Boolean));
  const visibleConsignes = filterConsignesByParentVisibility(visible, hiddenParentIds);

  const form = card.querySelector("#practice-form");
  const PRACTICE_EMPTY_HTML =
    '<div class="rounded-xl border border-dashed border-gray-200 bg-white p-3 text-sm text-[var(--muted)]">Aucune consigne visible pour cette itération.</div>';

  const escapeHiddenId = (value) => {
    if (!value && value !== 0) return "";
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(String(value));
    }
    return String(value).replace(/"/g, '\\"');
  };

  function findPracticeConsigneRowById(consigneId, scopeRoot) {
    if (consigneId == null) {
      return null;
    }
    const rootEl = scopeRoot || container || document;
    const selector = `[data-consigne-id="${escapeHiddenId(consigneId)}"]`;
    return rootEl.querySelector(selector);
  }

  function removePracticeHiddenConsigne(consigneId, scopeRoot) {
    if (consigneId == null) {
      return;
    }
    const box = (scopeRoot || container)?.querySelector?.("[data-practice-hidden-box]");
    if (!box) return;
    const list = box.querySelector("[data-practice-hidden-list]");
    if (!list) return;
    const selector = `[data-practice-hidden-item][data-consigne-id="${escapeHiddenId(consigneId)}"]`;
    const item = list.querySelector(selector);
    if (!item) {
      return;
    }
    item.remove();
    updatePracticeHiddenCounts();
  }

  const updatePracticeHiddenCounts = () => {
    const box = container.querySelector("[data-practice-hidden-box]");
    if (!box) return;
    const list = box.querySelector("[data-practice-hidden-list]");
    const title = box.querySelector("[data-practice-hidden-title]");
    const items = list ? list.querySelectorAll("[data-practice-hidden-item]") : [];
    const count = items.length;
    if (title) {
      title.textContent = `Masquées par répétition espacée (${count})`;
    }
    if (!count) {
      box.remove();
    }
  };

  const ensurePracticeHiddenBox = () => {
    let box = container.querySelector("[data-practice-hidden-box]");
    if (box) {
      return box;
    }
    box = document.createElement("div");
    box.className = "card p-3 space-y-2";
    box.dataset.practiceHiddenBox = "1";
    const title = document.createElement("div");
    title.className = "font-medium";
    title.dataset.practiceHiddenTitle = "1";
    box.appendChild(title);
    const list = document.createElement("ul");
    list.className = "text-sm text-[var(--muted)] space-y-1";
    list.dataset.practiceHiddenList = "1";
    box.appendChild(list);
    box.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const ctxRef = container.__practiceCtx;
      if (!ctxRef || !ctxRef.db || !ctxRef.user?.uid) {
        return;
      }
      const item = target.closest("[data-practice-hidden-item]");
      if (!item) {
        return;
      }
      const historyTrigger = target.closest(".js-histo-hidden");
      const resetTrigger = target.closest(".js-reset-sr");
      if (historyTrigger) {
        const consigneData = item.__consigneData;
        if (consigneData) {
          openHistory(ctxRef, consigneData, { source: "practice" });
        }
        return;
      }
      if (resetTrigger) {
        const id = resetTrigger.dataset.id || item.dataset.consigneId || "";
        if (!id) {
          return;
        }
        try {
          await Schema.resetSRForConsigne(ctxRef.db, ctxRef.user.uid, id);
          item.remove();
          updatePracticeHiddenCounts();
          showToast("Répétition espacée réinitialisée.");
        } catch (error) {
          console.error("practice.hidden.reset", error);
          showToast("Impossible de réinitialiser la répétition espacée.");
        }
      }
    });
    container.appendChild(box);
    return box;
  };

  const createPracticeHiddenItem = (consigne, remaining) => {
    const item = document.createElement("li");
    item.className = "practice-hidden__item";
    item.dataset.practiceHiddenItem = "1";
    if (consigne?.id != null) {
      const stringId = String(consigne.id);
      item.dataset.consigneId = stringId;
    }
    item.__consigneData = consigne || null;
    const label = document.createElement("div");
    label.className = "practice-hidden__text";
    const safeLabel = consigne?.text || consigne?.titre || "cette consigne";
    label.innerHTML = `<span class="font-medium text-slate-600">${escapeHtml(safeLabel)}</span> — revient dans ${remaining} itération(s)`;
    const actions = document.createElement("div");
    actions.className = "practice-hidden__actions";
    const historyBtn = document.createElement("button");
    historyBtn.type = "button";
    historyBtn.className = "btn btn-ghost text-xs js-histo-hidden";
    historyBtn.dataset.id = consigne?.id || "";
    historyBtn.textContent = "Historique";
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "btn btn-ghost text-xs js-reset-sr";
    resetBtn.dataset.id = consigne?.id || "";
    resetBtn.textContent = "Réinitialiser";
    actions.appendChild(historyBtn);
    actions.appendChild(resetBtn);
    item.appendChild(label);
    item.appendChild(actions);
    return item;
  };

  const appendPracticeHiddenConsigne = (consigne, remaining) => {
    if (!consigne) return;
    const box = ensurePracticeHiddenBox();
    const list = box.querySelector("[data-practice-hidden-list]");
    if (!list) return;
    if (consigne.id != null) {
      const selector = `[data-practice-hidden-item][data-consigne-id="${escapeHiddenId(consigne.id)}"]`;
      const existing = list.querySelector(selector);
      if (existing) {
        existing.remove();
      }
    }
    const item = createPracticeHiddenItem(consigne, remaining);
    list.appendChild(item);
    updatePracticeHiddenCounts();
  };

  function removePracticeConsigneRow(targetRow, { removeGroup = true } = {}) {
    if (!targetRow) return;
    const cardRoot = targetRow.closest("[data-practice-root]");
    const containerForm = cardRoot ? cardRoot.querySelector("#practice-form") : form;
    const group = targetRow.closest(".consigne-group");
    if (group && removeGroup) {
      group.remove();
    } else {
      targetRow.remove();
      if (group && !removeGroup) {
        const childRows = group.querySelectorAll(".consigne-row--child:not(.consigne-row--parent)");
        if (!childRows.length) {
          // Si aucun enfant restant, laisser uniquement la consigne parent visible.
          const parentRow = group.querySelector(".consigne-row--parent");
          if (!parentRow) {
            group.remove();
          }
        }
      }
    }
    if (cardRoot) {
      const lowDetails = cardRoot.querySelectorAll(".daily-category__low");
      lowDetails.forEach((detailsEl) => {
        const nested = detailsEl.querySelector(".daily-category__items--nested");
        const groupCount = nested ? nested.querySelectorAll(".consigne-group").length : 0;
        if (!groupCount) {
          detailsEl.remove();
        } else {
          const summary = detailsEl.querySelector(".daily-category__low-summary");
          if (summary) {
            summary.textContent = `Priorité basse (${groupCount})`;
          }
        }
      });
    }
    const hasRemaining = (cardRoot || form)?.querySelector?.(".consigne-group");
    if (!hasRemaining && containerForm) {
      containerForm.innerHTML = PRACTICE_EMPTY_HTML;
    }
  }

  const handlePracticeConsigneDelayed = (consigne, targetRow, delayState) => {
    if (!targetRow) return;
    removePracticeConsigneRow(targetRow);
    const state = delayState || {};
    const baseIndex = Number(container.dataset.practiceSessionIndex || sessionIndex || 0);
    const nextAllowed = Number(state.nextAllowedIndex ?? 0);
    if (Number.isFinite(nextAllowed)) {
      const remaining = Math.max(0, nextAllowed - baseIndex);
      appendPracticeHiddenConsigne(consigne, remaining);
    } else {
      updatePracticeHiddenCounts();
    }
  };

  if (!visibleConsignes.length) {
    form.innerHTML = PRACTICE_EMPTY_HTML;
  } else {
    form.innerHTML = "";

  const makeItem = (c, { isChild = false, deferEditor = false, editorOptions = null } = {}) => {
    const tone = priorityTone(c.priority);
    const row = document.createElement("div");
    row.className = `consigne-row priority-surface priority-surface-${tone}`;
    row.dataset.id = c.id;
    if (c?.id != null) {
      const stringId = String(c.id);
      row.dataset.consigneId = stringId;
      row.setAttribute("data-consigne-id", stringId);
    } else {
      delete row.dataset.consigneId;
      row.removeAttribute("data-consigne-id");
    }
    row.dataset.priorityTone = tone;
    if (isChild) {
      row.classList.add("consigne-row--child");
      if (c.parentId) {
        row.dataset.parentId = c.parentId;
      } else {
        delete row.dataset.parentId;
      }
      row.draggable = false;
    } else {
      row.classList.add("consigne-row--parent");
      delete row.dataset.parentId;
      row.draggable = true;
    }
    row.innerHTML = `
        <div class="consigne-row__header">
          <div class="consigne-row__main">
            <button type="button" class="consigne-row__toggle" data-consigne-open aria-haspopup="dialog">
              <span class="consigne-row__title">${escapeHtml(c.text)}</span>
              ${prioChip(Number(c.priority) || 2)}
            </button>
          </div>
        <div class="consigne-row__meta">
          <span class="consigne-row__status" data-status="na">
            <button type="button"
                    class="consigne-row__dot-button"
                    data-priority-trigger
                    aria-haspopup="true"
                    aria-expanded="false"
                    title="Changer la priorité">
              <span class="consigne-row__dot consigne-row__dot--na" data-status-dot aria-hidden="true"></span>
            </button>
            <div class="consigne-row__priority-menu" data-priority-menu hidden></div>
            <span class="consigne-row__mark" data-status-mark aria-hidden="true"></span>
            <span class="sr-only" data-status-live aria-live="polite"></span>
          </span>
          ${consigneActions()}
        </div>
        </div>
        <div class="consigne-history" data-consigne-history hidden>
          <button type="button" class="consigne-history__nav" data-consigne-history-prev aria-label="Faire défiler l’historique vers la gauche" hidden><span aria-hidden="true">&lsaquo;</span></button>
          <div class="consigne-history__viewport" data-consigne-history-viewport>
            <div class="consigne-history__track" data-consigne-history-track role="list"></div>
          </div>
          <button type="button" class="consigne-history__nav" data-consigne-history-next aria-label="Faire défiler l’historique vers la droite" hidden><span aria-hidden="true">&rsaquo;</span></button>
        </div>
        <div data-consigne-input-holder hidden></div>
      `;
      const statusHolder = row.querySelector("[data-status]");
      if (statusHolder) {
        statusHolder.dataset.priorityTone = tone;
      }
      const statusDot = row.querySelector("[data-status-dot]");
      if (statusDot) {
        statusDot.dataset.priorityTone = tone;
      }
      setupConsignePriorityMenu(row, c, ctx);
      const holder = row.querySelector("[data-consigne-input-holder]");
      if (holder) {
        holder.innerHTML = inputForType(c);
        enhanceRangeMeters(holder);
        initializeChecklistScope(holder, { consigneId: c?.id ?? null });
        ensureConsigneSkipField(row, c);
      }
      setupConsigneHistoryTimeline(row, c, ctx, { mode: "practice" });
      const bH = row.querySelector(".js-histo");
      const bE = row.querySelector(".js-edit");
      const bD = row.querySelector(".js-del");
      const bA = row.querySelector(".js-archive");
      bH.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closeConsigneActionMenuFromNode(bH); Schema.D.info("ui.history.click", c.id); openHistory(ctx, c, { source: "practice" }); };
      bE.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closeConsigneActionMenuFromNode(bE); Schema.D.info("ui.editConsigne.click", c.id); openConsigneForm(ctx, c); };
      bD.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        closeConsigneActionMenuFromNode(bD);
        if (confirm("Supprimer cette consigne ? (historique conservé)")) {
          Schema.D.info("ui.deleteConsigne.confirm", c.id);
          await Schema.softDeleteConsigne(ctx.db, ctx.user.uid, c.id);
          renderPractice(ctx, root);
        }
      };
      if (bA) {
        bA.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeConsigneActionMenuFromNode(bA);
          await archiveConsigneWithRefresh(c, { row });
        };
      }
      let srEnabled = c?.srEnabled !== false;
      const delayBtn = row.querySelector(".js-delay");
      const updateDelayState = (enabled) => {
        if (!delayBtn) return;
        delayBtn.disabled = !enabled;
        delayBtn.classList.toggle("opacity-50", !enabled);
        delayBtn.title = enabled
          ? "Décaler la prochaine itération"
          : "Active la répétition espacée pour décaler";
      };
      if (delayBtn) {
        updateDelayState(srEnabled);
        delayBtn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeConsigneActionMenuFromNode(delayBtn);
          if (delayBtn.disabled) {
            showToast("Active la répétition espacée pour utiliser le décalage.");
            return;
          }
          const raw = prompt("Décaler de combien d'itérations ?", "1");
          if (raw === null) return;
          const value = Number(String(raw).replace(",", "."));
          const rounded = Math.round(value);
          if (!Number.isFinite(value) || !Number.isFinite(rounded) || rounded < 1) {
            showToast("Entre un entier positif.");
            return;
          }
          const amount = rounded;
          delayBtn.disabled = true;
          try {
            const state = await Schema.delayConsigne({
              db: ctx.db,
              uid: ctx.user.uid,
              consigne: c,
              mode: "practice",
              amount,
              sessionIndex,
            });
            showToast(`Consigne décalée de ${amount} itération${amount > 1 ? "s" : ""}.`);
            handlePracticeConsigneDelayed(c, row, state);
          } catch (err) {
            console.error(err);
            showToast("Impossible de décaler la consigne.");
          } finally {
            updateDelayState(srEnabled);
          }
        };
      }
      setupConsigneActionMenus(row, () => ({
        srToggle: {
          getEnabled: () => srEnabled,
          onToggle: async (next) => {
            try {
              await Schema.updateConsigne(ctx.db, ctx.user.uid, c.id, { srEnabled: next });
              srEnabled = next;
              c.srEnabled = next;
              updateDelayState(srEnabled);
              return srEnabled;
            } catch (err) {
              console.error(err);
              showToast("Impossible de mettre à jour la répétition espacée.");
              return srEnabled;
            }
          },
        },
        archive: () => archiveConsigneWithRefresh(c, { row }),
      }));
      const applyDelayFromEditor = async (rawAmount, context = {}) => {
        const numeric = Number(rawAmount);
        const rounded = Math.round(numeric);
        if (!Number.isFinite(numeric) || rounded < 1) {
          return false;
        }
        if (!srEnabled) {
          showToast("Active la répétition espacée pour utiliser le décalage.");
          return false;
        }
        if (!ctx?.db || !ctx?.user?.uid) {
          return false;
        }
        const answersToPersist = [];
        const rawSessionIndex = Number(sessionIndex);
        const normalizedSessionIndex = Number.isFinite(rawSessionIndex) ? rawSessionIndex : 0;
        const sessionNumber = normalizedSessionIndex + 1;
        const sessionId = `session-${String(sessionNumber).padStart(4, "0")}`;
        const pushAnswer = (targetConsigne, targetRow, rawValue, extraSummary = null) => {
          if (!targetConsigne || targetConsigne.id == null) {
            return;
          }
          if (rawValue === undefined) {
            return;
          }
          const hostRow = targetRow || row;
          const normalizedValue = normalizeConsigneValueForPersistence(
            targetConsigne,
            hostRow,
            rawValue,
          );
          const hasContent = hasValueForConsigne(targetConsigne, normalizedValue);
          if (!hasContent) {
            return;
          }
          const answer = {
            consigne: targetConsigne,
            value: normalizedValue,
            sessionIndex: normalizedSessionIndex,
            sessionNumber,
            sessionId,
          };
          // Ensure a stable dayKey is persisted for practice answers to keep pills aligned with the page date
          try {
            const pageDayKey = (typeof window !== 'undefined' && window.AppCtx?.dateIso)
              || (typeof Schema?.todayKey === 'function' ? Schema.todayKey() : null);
            if (pageDayKey) {
              answer.dayKey = pageDayKey;
            }
          } catch (_) {}
          const normalizedSummary =
            extraSummary && typeof extraSummary === "object"
              ? normalizeSummaryMetadataInput(extraSummary)
              : null;
          if (normalizedSummary) {
            Object.assign(answer, normalizedSummary);
          }
          answersToPersist.push(answer);
        };
        if (context && Object.prototype.hasOwnProperty.call(context, "value")) {
          pushAnswer(consigne, row, context.value, context.summary || null);
        }
        if (Array.isArray(context?.childAnswers)) {
          context.childAnswers.forEach((entry) => {
            if (!entry || typeof entry !== "object") {
              return;
            }
            pushAnswer(entry.consigne, entry.row || null, entry.value);
          });
        }
        if (answersToPersist.length) {
          try {
            await Schema.saveResponses(ctx.db, ctx.user.uid, "practice", answersToPersist);
          } catch (error) {
            console.error("practice.delay.save", error);
            showToast("Impossible d'enregistrer la réponse avant de décaler.");
            return false;
          }
        }
        try {
          const state = await Schema.delayConsigne({
            db: ctx.db,
            uid: ctx.user.uid,
            consigne: c,
            mode: "practice",
            amount: rounded,
            sessionIndex,
          });
          showToast(`Consigne décalée de ${rounded} itération${rounded > 1 ? "s" : ""}.`);
          handlePracticeConsigneDelayed(c, row, state);
          return true;
        } catch (err) {
          console.error(err);
          showToast("Impossible de décaler la consigne.");
          return false;
        }
      };
      const editorConfig = { variant: "modal", ...(editorOptions || {}) };
      if (!editorConfig.delayOptions) {
        editorConfig.delayOptions = {
          amounts: [1, 3, 5, 10, 15, 20],
          label: "Revoir dans",
          placeholder: "Sans délai",
          helper: "Appliqué après validation.",
          disabledHint: "Active la répétition espacée pour décaler.",
          getSrEnabled: () => srEnabled,
          applyDelay: applyDelayFromEditor,
          allowArchive: true,
          archiveLabel: "Archiver la consigne",
          archiveValue: CONSIGNE_ARCHIVE_DELAY_VALUE,
          onArchive: ({ close } = {}) => archiveConsigneWithRefresh(c, { close, row }),
        };
      }
      row.__practiceEditorConfig = editorConfig;
      if (!deferEditor) {
        attachConsigneEditor(row, c, editorConfig);
      }
      bindConsigneRowValue(row, c, {
        onChange: (value) => {
          if (value === null || value === undefined) {
            delete row.dataset.currentValue;
          } else {
            row.dataset.currentValue = String(value);
          }
        },
      });
      return row;
    };

    const grouped = groupConsignes(visibleConsignes);
    const renderGroup = (group, target) => {
      const wrapper = document.createElement("div");
      wrapper.className = "consigne-group";
      const parentCard = makeItem(group.consigne, { isChild: false, deferEditor: true });
      wrapper.appendChild(parentCard);
      const childConfigs = group.children.map((child) => {
        const childRow = createHiddenConsigneRow(child);
        childRow.dataset.parentId = child.parentId || group.consigne.id || "";
        childRow.draggable = false;
        parentCard.appendChild(childRow);
        bindConsigneRowValue(childRow, child);
        let srEnabled = child?.srEnabled !== false;
        const config = {
          consigne: child,
          row: childRow,
          srEnabled,
          onHistory: () => {
            Schema.D.info("ui.history.click", child.id);
            openHistory(ctx, child, { source: "practice" });
          },
          onEdit: ({ close } = {}) => {
            Schema.D.info("ui.editConsigne.click", child.id);
            if (typeof close === "function") {
              close();
            }
            openConsigneForm(ctx, child);
          },
          onDelete: async ({ close } = {}) => {
            if (!confirm("Supprimer cette consigne ? (historique conservé)")) {
              return false;
            }
            Schema.D.info("ui.deleteConsigne.confirm", child.id);
            await Schema.softDeleteConsigne(ctx.db, ctx.user.uid, child.id);
            if (typeof close === "function") {
              close();
            }
            renderPractice(ctx, root);
            return true;
          },
          onArchive: ({ close } = {}) => archiveConsigneWithRefresh(child, { close, row: childRow }),
          onToggleSr: async (next) => {
            try {
              await Schema.updateConsigne(ctx.db, ctx.user.uid, child.id, { srEnabled: next });
              srEnabled = next;
              config.srEnabled = srEnabled;
              child.srEnabled = next;
              return srEnabled;
            } catch (err) {
              console.error(err);
              showToast("Impossible de mettre à jour la répétition espacée.");
              return srEnabled;
            }
          },
        };
        return config;
      });
      const inheritedEditorConfig =
        (parentCard && parentCard.__practiceEditorConfig) || {};
      const editorConfig = {
        ...inheritedEditorConfig,
        variant: "modal",
        childConsignes: childConfigs,
      };
      attachConsigneEditor(parentCard, group.consigne, editorConfig);
      target.appendChild(wrapper);
    };

    const highs = grouped.filter((group) => (group.consigne.priority || 2) <= 2);
    const lows = grouped.filter((group) => (group.consigne.priority || 2) >= 3);

    highs.forEach((group) => renderGroup(group, form));

    if (lows.length) {
      const lowDetails = document.createElement("details");
      lowDetails.className = "daily-category__low";
      const lowCount = lows.reduce((acc, group) => acc + 1 + group.children.length, 0);
      lowDetails.innerHTML = `<summary class="daily-category__low-summary">Priorité basse (${lowCount})</summary>`;
      const lowStack = document.createElement("div");
      lowStack.className = "daily-category__items daily-category__items--nested";
      lows.forEach((group) => renderGroup(group, lowStack));
      lowDetails.appendChild(lowStack);
      form.appendChild(lowDetails);
    }

    if (typeof window.attachConsignesDragDrop === "function") {
      window.attachConsignesDragDrop(form, ctx);
    }
  }

  if (hidden.length) {
    const box = ensurePracticeHiddenBox();
    const list = box.querySelector("[data-practice-hidden-list]");
    if (list) {
      list.innerHTML = "";
      hidden.forEach((entry) => {
        const item = createPracticeHiddenItem(entry.c, entry.remaining);
        list.appendChild(item);
      });
      updatePracticeHiddenCounts();
    }
  } else {
    const existing = container.querySelector("[data-practice-hidden-box]");
    if (existing) {
      existing.remove();
    }
  }

  const saveBtn = card.querySelector("#save");
  saveBtn.onclick = async (e) => {
    e.preventDefault();
    const answers = collectAnswers(form, visibleConsignes);
    const sessionNumber = sessionIndex + 1;
    const sessionId = `session-${String(sessionNumber).padStart(4, "0")}`;
    answers.forEach((ans) => {
      ans.sessionIndex = sessionIndex;
      ans.sessionNumber = sessionNumber;
      ans.sessionId = sessionId;
    });

    // Ensure a stable dayKey is persisted for practice answers to keep pills aligned with the page date
    try {
      const pageDayKey = (typeof window !== 'undefined' && window.AppCtx?.dateIso)
        || (typeof Schema?.todayKey === 'function' ? Schema.todayKey() : null);
      if (pageDayKey) {
        answers.forEach((ans) => { ans.dayKey = pageDayKey; });
      }
    } catch (_) {}

    saveBtn.disabled = true;
    saveBtn.textContent = "Enregistrement…";

    try {
      if (answers.length) {
        await Schema.saveResponses(ctx.db, ctx.user.uid, "practice", answers);
      }
      await Schema.startNewPracticeSession(ctx.db, ctx.user.uid, {
        sessionId,
        index: sessionNumber,
        sessionIndex,
      });

      if (form && window.formAutosave?.clear) {
        window.formAutosave.clear(form);
      }

      $$("input[type=text],textarea", form).forEach((input) => (input.value = ""));
      $$("input[type=range]", form).forEach((input) => {
        input.value = 5;
        input.dispatchEvent(new Event("input"));
      });
      $$("select", form).forEach((input) => {
        input.selectedIndex = 0;
      });
      $$("input[type=radio]", form).forEach((input) => (input.checked = false));
      $$("[data-rich-text-root]", form).forEach((editor) => {
        const hidden = editor.querySelector("[data-rich-text-input]");
        const content = editor.querySelector("[data-rich-text-content]");
        if (content) {
          content.innerHTML = "<p><br></p>";
        }
        if (hidden) {
          const emptyValue = normalizeRichTextValue("");
          hidden.value = JSON.stringify(emptyValue);
          hidden.dispatchEvent(new Event("input", { bubbles: true }));
          hidden.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });

      showToast(answers.length ? "Itération enregistrée" : "Itération passée");
      saveBtn.classList.add("btn-saved");
      saveBtn.textContent = "✓ Enregistré";
      setTimeout(() => {
        saveBtn.classList.remove("btn-saved");
        saveBtn.textContent = "Enregistrer";
        saveBtn.disabled = false;
      }, 900);

      renderPractice(ctx, root);
    } catch (err) {
      console.error(err);
      saveBtn.disabled = false;
      saveBtn.textContent = "Enregistrer";
    }
  };
  modesLogger.groupEnd();
}

const DOW = ["DIM","LUN","MAR","MER","JEU","VEN","SAM"];
const DAILY_ENTRY_TYPES = {
  DAY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
  ADHOC: "adhoc",
};

function normalizeDailyView(value) {
  if (!value) return null;
  const normalized = String(value).toLowerCase();
  if (normalized === "week" || normalized === "weekly") {
    return DAILY_ENTRY_TYPES.WEEKLY;
  }
  if (normalized === "month" || normalized === "monthly") {
    return DAILY_ENTRY_TYPES.MONTHLY;
  }
  if (
    normalized === "year" ||
    normalized === "yearly" ||
    normalized === "annuel" ||
    normalized === "annuelle" ||
    normalized === "annual"
  ) {
    return DAILY_ENTRY_TYPES.YEARLY;
  }
  return null;
}
const DAILY_WEEKDAY_FORMATTER = new Intl.DateTimeFormat("fr-FR", { weekday: "long" });
const DAILY_DATE_FORMATTER = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" });
const DAILY_SHORT_RANGE_FORMATTER = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" });
const DAILY_LONG_DATE_FORMATTER = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "2-digit", month: "long" });
const DAILY_MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const BILAN_MODULE_ID = "bilan";
const BILAN_DEFAULT_SETTINGS = {
  weekEndsOn: 0,
  monthlyEnabled: true,
  weeklyReminderEnabled: false,
  monthlyReminderEnabled: false,
  yearlyReminderEnabled: false,
};

let DAILY_WEEK_ENDS_ON = BILAN_DEFAULT_SETTINGS.weekEndsOn;
let DAILY_MONTHLY_ENABLED = BILAN_DEFAULT_SETTINGS.monthlyEnabled;

let bilanSettingsCache = null;
let bilanSettingsUid = null;
let bilanSettingsPromise = null;

function normalizeWeekdayIndex(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const rounded = Math.round(num);
  return ((rounded % 7) + 7) % 7;
}

function normalizeBilanReminder(value) {
  if (value === true) return true;
  if (value === false) return false;
  if (value && typeof value === "object") {
    if (typeof value.enabled === "boolean") {
      return value.enabled;
    }
  }
  return false;
}

function normalizeBilanSettings(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const weekEndsOn = normalizeWeekdayIndex(data.weekEndsOn ?? data.weekEnd ?? BILAN_DEFAULT_SETTINGS.weekEndsOn);
  const monthlyEnabled = data.monthlyEnabled !== false;
  const weeklyReminderEnabled = normalizeBilanReminder(data.weeklyReminder ?? data.weeklyReminderEnabled);
  const monthlyReminderEnabled = normalizeBilanReminder(data.monthlyReminder ?? data.monthlyReminderEnabled);
  const yearlyReminderEnabled = normalizeBilanReminder(data.yearlyReminder ?? data.yearlyReminderEnabled);
  return {
    weekEndsOn,
    monthlyEnabled,
    weeklyReminderEnabled,
    monthlyReminderEnabled,
    yearlyReminderEnabled,
  };
}

function setBilanRuntimeSettings(settings) {
  const normalized = normalizeBilanSettings(settings);
  DAILY_WEEK_ENDS_ON = normalized.weekEndsOn;
  DAILY_MONTHLY_ENABLED = normalized.monthlyEnabled;
  bilanSettingsCache = normalized;
  return normalized;
}

async function loadBilanSettings(ctx) {
  const uid = ctx?.user?.uid;
  if (!uid || !ctx?.db || typeof Schema?.loadModuleSettings !== "function") {
    return setBilanRuntimeSettings(BILAN_DEFAULT_SETTINGS);
  }
  if (bilanSettingsCache && bilanSettingsUid === uid) {
    return bilanSettingsCache;
  }
  if (bilanSettingsPromise && bilanSettingsUid === uid) {
    return bilanSettingsPromise;
  }
  bilanSettingsUid = uid;
  bilanSettingsPromise = (async () => {
    try {
      const raw = await Schema.loadModuleSettings(ctx.db, uid, BILAN_MODULE_ID);
      return setBilanRuntimeSettings(raw);
    } catch (error) {
      console.warn("bilan.settings.load", error);
      return setBilanRuntimeSettings(BILAN_DEFAULT_SETTINGS);
    } finally {
      bilanSettingsPromise = null;
    }
  })();
  return bilanSettingsPromise;
}

async function initializeBilanSettingsControls(ctx, host) {
  if (!host || typeof host.querySelector !== "function") {
    return;
  }
  const wrapper = host.querySelector("[data-bilan-settings]");
  if (!wrapper || wrapper.dataset.bilanSettingsBound === "1") {
    return;
  }
  wrapper.dataset.bilanSettingsBound = "1";
  const trigger = wrapper.querySelector("[data-bilan-settings-trigger]");
  const panel = wrapper.querySelector("[data-bilan-settings-panel]");
  const select = wrapper.querySelector("[data-bilan-weekendson]");
  const weeklyCb = wrapper.querySelector("[data-bilan-weekly-rem]");
  const monthlyCb = wrapper.querySelector("[data-bilan-monthly-rem]");
  const yearlyCb = wrapper.querySelector("[data-bilan-yearly-rem]");
  const btnSave = wrapper.querySelector("[data-bilan-settings-save]");
  const btnCancel = wrapper.querySelector("[data-bilan-settings-cancel]");
  if (!trigger || !panel || !select || !btnSave) {
    return;
  }
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");

  const applySettingsToForm = (settings) => {
    if (!settings || typeof settings !== "object") {
      return;
    }
    if (typeof settings.weekEndsOn === "number") {
      select.value = String(settings.weekEndsOn);
    }
    if (weeklyCb) {
      weeklyCb.checked = !!settings.weeklyReminderEnabled;
    }
    if (monthlyCb) {
      monthlyCb.checked = !!settings.monthlyReminderEnabled;
    }
    if (yearlyCb) {
      yearlyCb.checked = !!settings.yearlyReminderEnabled;
    }
  };

  try {
    const settings = await loadBilanSettings(ctx);
    applySettingsToForm(settings);
  } catch (error) {
    console.warn("bilan.settings.prefill", error);
  }

  let outsideHandler = null;
  const cleanupOutsideHandler = () => {
    if (outsideHandler) {
      document.removeEventListener("click", outsideHandler, true);
      outsideHandler = null;
    }
  };

  const closePanel = () => {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    cleanupOutsideHandler();
  };

  const openPanel = () => {
    if (!panel.hidden) {
      return;
    }
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    cleanupOutsideHandler();
    outsideHandler = (event) => {
      if (!wrapper.contains(event.target)) {
        closePanel();
      }
    };
    setTimeout(() => {
      if (outsideHandler) {
        document.addEventListener("click", outsideHandler, true);
      }
    }, 0);
  };

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (panel.hidden) {
      openPanel();
    } else {
      closePanel();
    }
  });

  panel.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  if (btnCancel) {
    btnCancel.addEventListener("click", (event) => {
      event.preventDefault();
      closePanel();
    });
  }

  let isSaving = false;
  btnSave.addEventListener("click", async (event) => {
    event.preventDefault();
    if (isSaving || !ctx?.db || !ctx?.user?.uid) {
      return;
    }
    const payload = {
      weekEndsOn: normalizeWeekdayIndex(select.value),
      weeklyReminderEnabled: weeklyCb ? !!weeklyCb.checked : false,
      monthlyReminderEnabled: monthlyCb ? !!monthlyCb.checked : false,
      yearlyReminderEnabled: yearlyCb ? !!yearlyCb.checked : false,
    };
    try {
      isSaving = true;
      btnSave.disabled = true;
      await Schema.saveModuleSettings(ctx.db, ctx.user.uid, BILAN_MODULE_ID, payload);
      setBilanRuntimeSettings(payload);
      closePanel();
      if (typeof showToast === "function") {
        showToast("Paramètres de bilan enregistrés.");
      }
    } catch (error) {
      console.error("bilan.settings.save", error);
      if (typeof showToast === "function") {
        showToast("Impossible d’enregistrer les paramètres.");
      }
    } finally {
      isSaving = false;
      btnSave.disabled = false;
    }
  });

  if (typeof MutationObserver === "function" && document?.body) {
    const observer = new MutationObserver(() => {
      if (!wrapper.isConnected) {
        cleanupOutsideHandler();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

function modesParseDayKeyToDate(key) {
  if (typeof key !== "string") {
    return null;
  }
  const trimmed = key.trim();
  if (!trimmed) {
    return null;
  }
  if (typeof parseDayKeyToDate === "function") {
    try {
      const parsedViaGlobal = parseDayKeyToDate(trimmed);
      if (parsedViaGlobal instanceof Date && !Number.isNaN(parsedViaGlobal.getTime())) {
        return parsedViaGlobal;
      }
    } catch (error) {
      modesLogger?.debug?.("ui.daily.parseDayKey", error);
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [yearStr, monthStr, dayStr] = trimmed.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      const candidate = new Date(year, (month || 1) - 1, day || 1);
      if (!Number.isNaN(candidate.getTime())) {
        candidate.setHours(0, 0, 0, 0);
        return candidate;
      }
    }
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }
  return null;
}

function modesToFirestoreTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  const tsSource =
    modesFirestore?.Timestamp ||
    Schema.firestore?.Timestamp ||
    (typeof window !== "undefined" && window.firebase?.firestore?.Timestamp) ||
    (typeof window !== "undefined" && window.firebase?.Timestamp) ||
    null;
  if (tsSource && typeof tsSource.fromDate === "function") {
    try {
      return tsSource.fromDate(date);
    } catch (error) {
      modesLogger?.debug?.("ui.daily.timestamp", error);
    }
  }
  return null;
}

function modesMondayStartOf(date) {
  const base = toStartOfDay(date);
  if (!base) return null;
  const diff = (base.getDay() + 6) % 7;
  const monday = new Date(base.getTime());
  monday.setDate(monday.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function computeDailyPageContext({ date, dayKey } = {}) {
  const fromDate = date instanceof Date ? toStartOfDay(date) : null;
  const fromKey = !fromDate && dayKey ? modesParseDayKeyToDate(dayKey) : null;
  const baseDate = fromDate || fromKey || toStartOfDay(new Date());
  if (!baseDate) {
    return null;
  }
  const pageDateIso = typeof Schema?.dayKeyFromDate === "function"
    ? Schema.dayKeyFromDate(baseDate)
    : baseDate.toISOString().slice(0, 10);
  const weekStartDate = modesMondayStartOf(baseDate);
  const weekStart = weekStartDate && typeof Schema?.dayKeyFromDate === "function"
    ? Schema.dayKeyFromDate(weekStartDate)
    : weekStartDate
    ? weekStartDate.toISOString().slice(0, 10)
    : "";
  const pageDayIndex = ((baseDate.getDay() + 6) % 7 + 7) % 7;
  const pageDate = modesToFirestoreTimestamp(baseDate);
  return {
    pageDate,
    pageDateIso,
    weekStart,
    pageDayIndex,
  };
}

function toStartOfDay(dateInput) {
  const date = dateInput instanceof Date ? new Date(dateInput.getTime()) : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}
function formatDailyNavLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const weekday = DAILY_WEEKDAY_FORMATTER.format(date) || "";
  const digits = DAILY_DATE_FORMATTER.format(date) || "";
  const capitalized = weekday ? `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}` : "";
  return [capitalized, digits].filter(Boolean).join(" ");
}
function formatWeekRangeLabel(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return "";
  const startLabel = DAILY_SHORT_RANGE_FORMATTER.format(start);
  const endLabel = DAILY_SHORT_RANGE_FORMATTER.format(end);
  return `${startLabel} → ${endLabel}`;
}
function formatMonthLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const raw = DAILY_MONTH_LABEL_FORMATTER.format(date);
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "";
}
function weekAnchorForDate(dateInput) {
  const base = toStartOfDay(dateInput);
  if (!base) return null;
  const offset = (DAILY_WEEK_ENDS_ON - base.getDay() + 7) % 7;
  const anchor = new Date(base.getTime());
  anchor.setDate(anchor.getDate() + offset);
  return anchor;
}
function weekWindowForAnchor(anchor) {
  const end = toStartOfDay(anchor);
  if (!end) return null;
  const start = new Date(end.getTime());
  start.setDate(start.getDate() - 6);
  return { start, end };
}
function monthlySummaryInfoForAnchor(anchor) {
  if (!DAILY_MONTHLY_ENABLED) return null;
  const range = weekWindowForAnchor(anchor);
  if (!range) return null;
  let monthEnd = null;
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const cursor = new Date(range.start.getTime());
    cursor.setDate(range.start.getDate() + dayOffset);
    const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    if (cursor.getDate() === lastDay) {
      monthEnd = cursor;
      break;
    }
  }
  if (!monthEnd) return null;
  const monthKey = typeof Schema?.monthKeyFromDate === "function"
    ? Schema.monthKeyFromDate(monthEnd)
    : `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = formatMonthLabel(monthEnd);
  return { monthEnd, monthKey, monthLabel };
}
function createDayEntry(date) {
  const normalized = toStartOfDay(date);
  if (!normalized) return null;
  const dayCode = DOW[normalized.getDay()];
  const navLabel = formatDailyNavLabel(normalized);
  const todayKey = typeof Schema?.todayKey === "function" ? Schema.todayKey() : null;
  const dayKey = typeof Schema?.dayKeyFromDate === "function" ? Schema.dayKeyFromDate(normalized) : null;
  const isTodaySelected = todayKey && dayKey ? todayKey === dayKey : false;
  return {
    type: DAILY_ENTRY_TYPES.DAY,
    date: normalized,
    dayCode,
    navLabel,
    navSubtitle: isTodaySelected ? "Aujourd’hui" : "",
    isToday: isTodaySelected,
  };
}
function createWeeklySummaryEntry(anchorDate) {
  const anchor = weekAnchorForDate(anchorDate);
  if (!anchor) return null;
  const range = weekWindowForAnchor(anchor);
  if (!range) return null;
  const weekKey = typeof Schema?.weekKeyFromDate === "function"
    ? Schema.weekKeyFromDate(anchor, DAILY_WEEK_ENDS_ON)
    : null;
  return {
    type: DAILY_ENTRY_TYPES.WEEKLY,
    sunday: anchor,
    weekStart: range.start,
    weekEnd: range.end,
    weekEndsOn: DAILY_WEEK_ENDS_ON,
    weekKey,
    navLabel: "Bilan de la semaine",
    navSubtitle: formatWeekRangeLabel(range.start, range.end),
  };
}
function createMonthlySummaryEntry(anchorDate) {
  const weekly = createWeeklySummaryEntry(anchorDate);
  if (!weekly) return null;
  const monthInfo = monthlySummaryInfoForAnchor(weekly.sunday);
  if (!monthInfo) return null;
  return {
    ...weekly,
    type: DAILY_ENTRY_TYPES.MONTHLY,
    monthEnd: monthInfo.monthEnd,
    monthKey: monthInfo.monthKey,
    monthLabel: monthInfo.monthLabel,
    navLabel: "Bilan du mois",
    navSubtitle: monthInfo.monthLabel || weekly.navSubtitle,
  };
}
function entryToDayKey(entry) {
  if (entry?.type === DAILY_ENTRY_TYPES.DAY) {
    return typeof Schema?.dayKeyFromDate === "function" ? Schema.dayKeyFromDate(entry.date) : null;
  }
  if ((entry?.type === DAILY_ENTRY_TYPES.WEEKLY || entry?.type === DAILY_ENTRY_TYPES.MONTHLY) && entry.sunday) {
    return typeof Schema?.dayKeyFromDate === "function" ? Schema.dayKeyFromDate(entry.sunday) : null;
  }
  if (entry?.type === DAILY_ENTRY_TYPES.YEARLY) {
    const anchor = entry.yearEnd instanceof Date ? entry.yearEnd : entry.yearStart;
    return anchor && typeof Schema?.dayKeyFromDate === "function"
      ? Schema.dayKeyFromDate(anchor)
      : null;
  }
  if (entry?.type === DAILY_ENTRY_TYPES.ADHOC) {
    if (typeof entry.dayKey === "string" && entry.dayKey) {
      return entry.dayKey;
    }
    return typeof Schema?.dayKeyFromDate === "function" ? Schema.dayKeyFromDate(entry.date) : null;
  }
  return null;
}
function isWeekBoundaryDay(entry) {
  if (!entry || entry.type !== DAILY_ENTRY_TYPES.DAY) return false;
  const date = entry.date instanceof Date ? entry.date : null;
  if (!date) return false;
  return date.getDay() === DAILY_WEEK_ENDS_ON;
}
function computeNextEntry(entry) {
  if (!entry) return null;
  if (entry.type === DAILY_ENTRY_TYPES.DAY) {
    if (isWeekBoundaryDay(entry)) {
      const weekly = createWeeklySummaryEntry(entry.date);
      if (weekly) return weekly;
    }
    const nextDate = new Date(entry.date.getTime());
    nextDate.setDate(nextDate.getDate() + 1);
    return createDayEntry(nextDate);
  }
  if (entry.type === DAILY_ENTRY_TYPES.WEEKLY) {
    const monthly = createMonthlySummaryEntry(entry.sunday);
    if (monthly) return monthly;
    if (entry.sunday instanceof Date) {
      const nextDate = new Date(entry.sunday.getTime());
      nextDate.setDate(nextDate.getDate() + 1);
      return createDayEntry(nextDate);
    }
    return null;
  }
  if (entry.type === DAILY_ENTRY_TYPES.MONTHLY) {
    const monthEnd = entry.monthEnd instanceof Date ? entry.monthEnd : null;
    if (monthEnd && monthEnd.getMonth() === 11) {
      const yearly = createYearlySummaryEntry(monthEnd);
      if (yearly) {
        return yearly;
      }
    }
    if (entry.sunday instanceof Date) {
      const nextDate = new Date(entry.sunday.getTime());
      nextDate.setDate(nextDate.getDate() + 1);
      return createDayEntry(nextDate);
    }
  }
  if (entry.type === DAILY_ENTRY_TYPES.YEARLY) {
    const anchor = entry.yearEnd instanceof Date ? entry.yearEnd : entry.yearStart;
    if (anchor instanceof Date) {
      const nextDate = new Date(anchor.getTime());
      nextDate.setDate(nextDate.getDate() + 1);
      return createDayEntry(nextDate);
    }
    return null;
  }
  if (entry.type === DAILY_ENTRY_TYPES.ADHOC) {
    if (entry.date instanceof Date) {
      const nextDate = new Date(entry.date.getTime());
      nextDate.setDate(nextDate.getDate() + 1);
      return createDayEntry(nextDate);
    }
    return null;
  }
  return null;
}
function computePrevEntry(entry) {
  if (!entry) return null;
  if (entry.type === DAILY_ENTRY_TYPES.DAY) {
    const prevDate = new Date(entry.date.getTime());
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDay = createDayEntry(prevDate);
    if (prevDay && isWeekBoundaryDay(prevDay)) {
      if (prevDay.date instanceof Date && prevDay.date.getMonth() === 11 && prevDay.date.getDate() === 31) {
        const yearly = createYearlySummaryEntry(prevDay.date);
        if (yearly) return yearly;
      }
      const monthly = createMonthlySummaryEntry(prevDay.date);
      if (monthly) return monthly;
      const weekly = createWeeklySummaryEntry(prevDay.date);
      if (weekly) return weekly;
    }
    return prevDay;
  }
  if (entry.type === DAILY_ENTRY_TYPES.WEEKLY) {
    return createDayEntry(entry.sunday);
  }
  if (entry.type === DAILY_ENTRY_TYPES.MONTHLY) {
    const weekly = createWeeklySummaryEntry(entry.sunday);
    if (weekly) return weekly;
    return createDayEntry(entry.sunday);
  }
  if (entry.type === DAILY_ENTRY_TYPES.YEARLY) {
    const anchor = entry.yearEnd instanceof Date ? entry.yearEnd : entry.yearStart;
    if (anchor instanceof Date) {
      const monthly = createMonthlySummaryEntry(anchor);
      if (monthly) return monthly;
      const weekly = createWeeklySummaryEntry(anchor);
      if (weekly) return weekly;
      return createDayEntry(anchor);
    }
    return null;
  }
  if (entry.type === DAILY_ENTRY_TYPES.ADHOC) {
    if (entry.date instanceof Date) {
      return createDayEntry(entry.date);
    }
    return null;
  }
  return null;
}
function entryToQuery(entry, basePath, qp) {
  const params = new URLSearchParams(qp);
  params.delete("day");
  if (entry?.type === DAILY_ENTRY_TYPES.DAY) {
    params.delete("view");
    const key = entryToDayKey(entry);
    if (key) {
      params.set("d", key);
    } else {
      params.delete("d");
    }
  } else if (entry?.type === DAILY_ENTRY_TYPES.ADHOC) {
    params.delete("view");
    const key = entryToDayKey(entry);
    if (key) {
      params.set("d", key);
    } else {
      params.delete("d");
    }
  } else if (
    entry?.type === DAILY_ENTRY_TYPES.WEEKLY ||
    entry?.type === DAILY_ENTRY_TYPES.MONTHLY ||
    entry?.type === DAILY_ENTRY_TYPES.YEARLY
  ) {
    const viewValue = entry.type === DAILY_ENTRY_TYPES.WEEKLY
      ? "week"
      : entry.type === DAILY_ENTRY_TYPES.MONTHLY
      ? "month"
      : "year";
    params.set("view", viewValue);
    const key = entryToDayKey(entry);
    if (key) {
      params.set("d", key);
    }
  }
  const search = params.toString();
  return `${basePath}${search ? `?${search}` : ""}`;
}
function dateForDayFromToday(label){
  const target = DOW.indexOf(label);
  const today = new Date(); today.setHours(0,0,0,0);
  if (target < 0) return today;
  const cur = today.getDay(); // 0..6 (DIM=0)
  const delta = (target - cur + 7) % 7;
  const d = new Date(today);
  d.setDate(d.getDate() + delta);
  return d;
}
function daysBetween(a,b){
  const ms = (b.setHours(0,0,0,0), a.setHours(0,0,0,0), (b-a));
  return Math.max(0, Math.round(ms/86400000));
}

async function renderDaily(ctx, root, opts = {}) {
  root.innerHTML = "";
  const container = document.createElement("div");
  container.className = "space-y-4";
  container.classList.add("w-full", "max-w-4xl", "mx-auto");
  root.appendChild(container);

  const currentHash = ctx.route || window.location.hash || "#/daily";
  const qp = new URLSearchParams(currentHash.split("?")[1] || "");
  await loadBilanSettings(ctx);
  const dateIso = opts.dateIso || qp.get("d");
  const explicitDate = dateIso ? toStartOfDay(dateIso) : null;
  const requestedDay = normalizeDay(opts.day) || normalizeDay(qp.get("day"));
  const requestedView = normalizeDailyView(opts.view || qp.get("view"));

  let entry = null;
  let selectedDate = null;
  let currentDay = null;

  const baseDate = explicitDate
    ? new Date(explicitDate.getTime())
    : requestedDay
    ? (() => {
        const d = dateForDayFromToday(requestedDay);
        d.setHours(0, 0, 0, 0);
        return d;
      })()
    : toStartOfDay(new Date());

  if (baseDate) {
    selectedDate = new Date(baseDate.getTime());
  }

  if (requestedView === DAILY_ENTRY_TYPES.WEEKLY) {
    entry = createWeeklySummaryEntry(selectedDate);
  } else if (requestedView === DAILY_ENTRY_TYPES.MONTHLY) {
    entry = createMonthlySummaryEntry(selectedDate) || createWeeklySummaryEntry(selectedDate);
  } else if (requestedView === DAILY_ENTRY_TYPES.YEARLY) {
    entry = createYearlySummaryEntry(selectedDate);
  }

  if (!entry && selectedDate) {
    entry = createDayEntry(selectedDate);
  }

  if (!entry) {
    selectedDate = toStartOfDay(new Date());
    entry = createDayEntry(selectedDate);
  }

  if (entry?.type === DAILY_ENTRY_TYPES.DAY) {
    currentDay = entry.dayCode || requestedDay || null;
    if (entry.date instanceof Date) {
      selectedDate = new Date(entry.date.getTime());
    }
  } else {
    currentDay = null;
  }

  const navLabel = entry?.navLabel || (selectedDate ? formatDailyNavLabel(selectedDate) : "Journalier");
  const navSubtitle = entry?.navSubtitle || "";
  const isDayEntry = entry?.type === DAILY_ENTRY_TYPES.DAY;
  // For weekly/monthly/yearly summary pages, still propagate a concrete dayKey (the route's d=...)
  // so checklist hydration/persistence consistently target the visible page date instead of "today".
  const selectedKey = selectedDate && typeof Schema?.dayKeyFromDate === "function"
    ? Schema.dayKeyFromDate(selectedDate)
    : null;
  // Propagate the effective page date into global context so checklist hydration/persistence is day-scoped
  try {
    if (typeof window !== "undefined") {
      const nextIso = selectedKey || null;
      if (!window.AppCtx || window.AppCtx !== ctx) {
        window.AppCtx = ctx;
      }
      ctx.dateIso = nextIso;
      window.AppCtx.dateIso = nextIso;
    }
  } catch (_) {}
  const pageContext = computeDailyPageContext({ date: selectedDate, dayKey: selectedKey });
  modesLogger.group("screen.daily.render", {
    hash: ctx.route,
    entryType: entry?.type || DAILY_ENTRY_TYPES.DAY,
    day: currentDay,
    date: selectedDate?.toISOString?.(),
  });

  const card = document.createElement("section");
  card.className = "card space-y-4 p-3 sm:p-4";
  card.innerHTML = `
    <div class="flex flex-wrap items-center gap-2">
      <div class="day-nav" data-day-nav>
        <button type="button" class="day-nav-btn" data-dir="prev" aria-label="Entrée précédente">
          <span aria-hidden="true">←</span>
        </button>
        <div class="day-nav-label">
          <span data-nav-main>${escapeHtml(navLabel)}</span>
          ${navSubtitle ? `<span class="day-nav-sub">${escapeHtml(navSubtitle)}</span>` : ""}
        </div>
        <button type="button" class="day-nav-btn" data-dir="next" aria-label="Entrée suivante">
          <span aria-hidden="true">→</span>
        </button>
      </div>
      <div class="daily-header-actions flex items-center gap-2">${smallBtn("📝 Faire un bilan", "js-bilan")}${smallBtn("+ Nouvelle consigne", "js-new")}</div>
    </div>
  `;
  container.appendChild(card);

  const navContainer = card.querySelector("[data-day-nav]");
  if (navContainer) {
    const basePath = toAppPath((currentHash.split("?")[0]) || "#/daily");
    const prevEntry = computePrevEntry(entry);
    const nextEntry = computeNextEntry(entry);
    const prevBtn = navContainer.querySelector('[data-dir="prev"]');
    const nextBtn = navContainer.querySelector('[data-dir="next"]');
    if (prevBtn) {
      prevBtn.disabled = !prevEntry;
      prevBtn.classList.toggle("opacity-50", !prevEntry);
      prevBtn.onclick = prevEntry
        ? () => navigate(entryToQuery(prevEntry, basePath, qp))
        : null;
    }
    if (nextBtn) {
      nextBtn.disabled = !nextEntry;
      nextBtn.classList.toggle("opacity-50", !nextEntry);
      nextBtn.onclick = nextEntry
        ? () => navigate(entryToQuery(nextEntry, basePath, qp))
        : null;
    }
    const mainLabel = navContainer.querySelector("[data-nav-main]");
    if (mainLabel) {
      mainLabel.textContent = navLabel;
    }
    const subLabel = navContainer.querySelector(".day-nav-sub");
    if (subLabel) {
      subLabel.textContent = navSubtitle;
      subLabel.hidden = !navSubtitle;
    }
  }
  card.querySelector(".js-new").onclick = () => openConsigneForm(ctx, null);
  const bilanBtn = card.querySelector(".js-bilan");
  if (bilanBtn) {
    bilanBtn.onclick = async () => {
      await loadBilanSettings(ctx);
      const scopeChoice = await chooseBilanScope({ allowMonthly: DAILY_MONTHLY_ENABLED });
      if (!scopeChoice) {
        return;
      }
      openBilanModal(ctx, {
        scope: scopeChoice.scope,
        title: scopeChoice.label,
      });
    };
  }

  if (!isDayEntry) {
    const summaryCard = document.createElement("section");
    summaryCard.className = "card space-y-4 p-3 sm:p-4";
    const summaryTitle = entry?.navLabel || "Bilan";
    const summarySubtitle = entry?.navSubtitle || "";
    summaryCard.innerHTML = `
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div class="space-y-1">
          <h2 class="text-lg font-semibold">${escapeHtml(summaryTitle)}</h2>
          ${summarySubtitle ? `<p class="text-sm text-[var(--muted)]">${escapeHtml(summarySubtitle)}</p>` : ""}
        </div>
        <div class="flex items-center gap-2">
          <div class="relative" data-bilan-settings>
            <button type="button" class="btn btn-ghost" data-bilan-settings-trigger title="Paramètres des bilans">
              <span aria-hidden="true">⚙️</span>
              <span class="sr-only">Paramètres</span>
            </button>
            <div class="card p-3 sm:p-4 space-y-3" data-bilan-settings-panel role="dialog" aria-label="Paramètres des bilans" hidden style="position:absolute; right:0; top:100%; margin-top:6px; min-width: 260px; z-index: 40;">
              <div class="space-y-2">
                <label class="block text-sm font-medium">Jour du bilan hebdomadaire</label>
                <select class="w-full" data-bilan-weekendson>
                  ${[0,1,2,3,4,5,6].map((i)=>{
                    const d=new Date(); d.setDate(d.getDate() + ((i - d.getDay() + 7)%7));
                    const label = DAILY_WEEKDAY_FORMATTER.format(d);
                    return `<option value="${i}">${escapeHtml(label)}</option>`;
                  }).join("")}
                </select>
                <p class="text-xs text-[var(--muted)]">Ce jour détermine quand le bilan hebdo apparaît dans l’onglet journalier et le jour du rappel hebdo.</p>
              </div>
              <fieldset class="space-y-2">
                <legend class="text-sm font-medium">Rappels par e‑mail</legend>
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" data-bilan-weekly-rem />
                  <span>Bilan de la semaine</span>
                </label>
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" data-bilan-monthly-rem />
                  <span>Bilan du mois</span>
                </label>
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" data-bilan-yearly-rem />
                  <span>Bilan de l’année</span>
                </label>
                <p class="text-xs text-[var(--muted)]">Les rappels mensuel et annuel sont envoyés la semaine qui contient la fin de la période, le jour sélectionné ci‑dessus.</p>
              </fieldset>
              <div class="flex items-center justify-end gap-2">
                <button type="button" class="btn btn-ghost" data-bilan-settings-cancel>Fermer</button>
                <button type="button" class="btn" data-bilan-settings-save>Enregistrer</button>
              </div>
            </div>
          </div>
        </div>
      </header>
      <div class="space-y-4" data-summary-root>
        <p class="text-sm text-[var(--muted)]">Chargement du bilan…</p>
      </div>
    `;
    container.appendChild(summaryCard);
    const summaryRoot = summaryCard.querySelector("[data-summary-root]");
    if (!summaryRoot) {
      modesLogger.groupEnd();
      if (window.__appBadge && typeof window.__appBadge.refresh === "function") {
        window.__appBadge.refresh(ctx.user?.uid).catch(() => {});
      }
      return;
    }
    // Paramètres (roue ⚙️) dans l'encart de bilan du journalier
    void initializeBilanSettingsControls(ctx, summaryCard);
    if (!window.Bilan || typeof window.Bilan.renderSummary !== "function") {
      summaryRoot.innerHTML = `<p class="text-sm text-[var(--muted)]">Module de bilan indisponible.</p>`;
      modesLogger.groupEnd();
      if (window.__appBadge && typeof window.__appBadge.refresh === "function") {
        window.__appBadge.refresh(ctx.user?.uid).catch(() => {});
      }
      return;
    }
    try {
      await window.Bilan.renderSummary({ ctx, entry, mount: summaryRoot });
    } catch (error) {
      console.error("daily.summary.render", error);
      summaryRoot.innerHTML = `<p class="text-sm text-red-600">Impossible de charger les consignes du bilan.</p>`;
    }
    modesLogger.groupEnd();
    if (window.__appBadge && typeof window.__appBadge.refresh === "function") {
      window.__appBadge.refresh(ctx.user?.uid).catch(() => {});
    }
    return;
  }

  const all = await Schema.fetchConsignes(ctx.db, ctx.user.uid, "daily");
  // Objectifs du jour (affichage dans l’onglet Journalier)
  let objectivesDueToday = [];
  try {
    objectivesDueToday = await Schema.listObjectivesDueOn(ctx.db, ctx.user.uid, selectedDate);
  } catch (e) {
    try { modesLogger?.warn?.("daily.objectivesDue.load", e); } catch (_) {}
    objectivesDueToday = [];
  }
  const interactiveConsignes = all.filter((c) => !c.summaryOnlyScope);
  const consignes = interactiveConsignes.filter((c) => !c.days?.length || c.days.includes(currentDay));
  modesLogger.info("screen.daily.consignes", consignes.length);

  const dayKey = selectedKey;
  const visible = [];
  const hidden = [];
  await Promise.all(consignes.map(async (c) => {
    if (c.srEnabled === false) { visible.push(c); return; }
    // eslint-disable-next-line no-await-in-loop
    const st = await Schema.readSRState(ctx.db, ctx.user.uid, c.id, "consigne");
    const nextISO = st?.nextVisibleOn || st?.hideUntil;
    if (!nextISO) { visible.push(c); return; }
    const next = new Date(nextISO);
    if (next <= selectedDate) visible.push(c);
    else hidden.push({ c, daysLeft: daysBetween(new Date(), next), when: next });
  }));

  const hiddenParentIds = new Set(hidden.map((entry) => entry?.c?.id).filter(Boolean));
  const visibleConsignes = filterConsignesByParentVisibility(visible, hiddenParentIds);

  const orderIndex = new Map(visibleConsignes.map((c, idx) => [c.id, idx]));
  const catGroups = new Map();
  visibleConsignes.forEach((consigne) => {
    const cat = consigne.category || "Général";
    const list = catGroups.get(cat) || [];
    list.push(consigne);
    catGroups.set(cat, list);
  });
  const categoryGroups = Array.from(catGroups.entries()).map(([cat, list]) => {
    const sorted = list.slice().sort((a, b) => {
      const idxA = orderIndex.get(a.id) ?? 0;
      const idxB = orderIndex.get(b.id) ?? 0;
      if (idxA !== idxB) return idxA - idxB;
      const prioDiff = (a.priority || 2) - (b.priority || 2);
      if (prioDiff !== 0) return prioDiff;
      return (a.text || "").localeCompare(b.text || "");
    });
    const groups = groupConsignes(sorted);
    const total = groups.reduce((acc, group) => acc + 1 + group.children.length, 0);
    return [cat, { groups, total }];
  });

  const previousAnswersRaw = await Schema.fetchDailyResponses(ctx.db, ctx.user.uid, dayKey);
  const previousAnswers = previousAnswersRaw instanceof Map
    ? previousAnswersRaw
    : new Map(previousAnswersRaw || []);
  const normalizedCurrentDayKey =
    typeof dayKey === "string" && dayKey.trim() ? normalizeHistoryDayKey(dayKey) : "";
  const resolvePreviousEntryDayKey = (entry) => {
    if (!entry || typeof entry !== "object") {
      return "";
    }
    const candidates = [
      entry.dayKey,
      entry.day_key,
      entry.dateKey,
      entry.date_key,
      entry.responseDayKey,
      entry.day,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return normalizeHistoryDayKey(candidate);
      }
    }
    return "";
  };

  const observedValues = new Map();
  const autoSaveStates = new Map();
  const autoSaveErrorState = { lastShownAt: 0 };

  const AUTO_SAVE_DEFAULT_DELAY = 900;
  const AUTO_SAVE_LONG_DELAY = 1400;
  const AUTO_SAVE_FAST_DELAY = 200;

  const serializeValueForComparison = (consigne, value) => {
    if (consigne?.type === "long") {
      try {
        return JSON.stringify(normalizeRichTextValue(value));
      } catch (error) {
        console.warn("daily.autosave.serialize.richtext", error);
        return JSON.stringify({ value });
      }
    }
    if (Array.isArray(value) || (value && typeof value === "object")) {
      try {
        return JSON.stringify(value);
      } catch (error) {
        console.warn("daily.autosave.serialize.object", error);
        return String(value);
      }
    }
    if (value === null || value === undefined) {
      return "";
    }
    return String(value);
  };

  const resolveAutoSaveDelay = (consigne) => {
    const type = consigne?.type;
    if (type === "long") return AUTO_SAVE_LONG_DELAY;
    if (type === "short") return AUTO_SAVE_DEFAULT_DELAY;
    if (type === "checklist") return AUTO_SAVE_FAST_DELAY;
    if (type === "yesno" || type === "likert6" || type === "likert5" || type === "num" || type === "montant") {
      return AUTO_SAVE_FAST_DELAY;
    }
    return AUTO_SAVE_DEFAULT_DELAY;
  };

  const markAnswerAsSaved = (consigne, value, serialized, summary = null) => {
    const base = previousAnswers.get(consigne.id) || { consigneId: consigne.id };
    const entry = {
      ...base,
      value,
      dayKey,
      updatedAt: new Date().toISOString(),
      __serialized: serialized,
    };
    if (pageContext) {
      if (pageContext.pageDate) {
        entry.pageDate = pageContext.pageDate;
      }
      if (pageContext.weekStart) {
        entry.weekStart = pageContext.weekStart;
      }
      if (pageContext.pageDateIso) {
        entry.pageDateIso = pageContext.pageDateIso;
      }
      if (typeof pageContext.pageDayIndex === "number") {
        entry.pageDayIndex = pageContext.pageDayIndex;
      }
    }
    if (consigne.type === "checklist") {
      const stats = deriveChecklistStats(value);
      entry.checkedIds = stats.checkedIds;
      entry.checkedCount = stats.checkedCount;
      entry.total = stats.total;
      entry.percentage = stats.percentage;
      entry.isEmpty = stats.isEmpty;
    }
    if (summary && typeof summary === "object") {
      Object.assign(entry, summary);
    } else {
      ["summaryScope", "summaryLabel", "summaryPeriod", "summaryMode"].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(entry, key)) {
          delete entry[key];
        }
      });
      ["source", "origin", "context", "moduleId"].forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(entry, key)) {
          return;
        }
        const value = entry[key];
        if (value === null || value === undefined) {
          delete entry[key];
          return;
        }
        const stringValue = String(value).toLowerCase();
        if (stringValue.startsWith("bilan")) {
          delete entry[key];
        }
      });
    }
    previousAnswers.set(consigne.id, entry);
  };

  const notifyAutoSaveError = () => {
    const now = Date.now();
    if (now - autoSaveErrorState.lastShownAt < 8000) {
      return;
    }
    autoSaveErrorState.lastShownAt = now;
    showToast("Impossible d’enregistrer automatiquement. Vérifie ta connexion.");
  };

  const runAutoSave = (consigneId) => {
    const state = autoSaveStates.get(consigneId);
    if (!state) return;
    state.timeout = null;
    if (!state.pendingHasContent) {
      autoSaveStates.delete(consigneId);
      return;
    }
    if (!ctx?.db || !ctx?.user?.uid) {
      notifyAutoSaveError();
      const retryDelay = Math.max(2000, resolveAutoSaveDelay(state.consigne));
      state.timeout = setTimeout(() => runAutoSave(consigneId), retryDelay);
      autoSaveStates.set(consigneId, state);
      return;
    }
    const { consigne, pendingValue, pendingSerialized, pendingSummary } = state;
    state.inFlight = true;
    autoSaveStates.set(consigneId, state);
    const normalizedSummary = normalizeSummaryMetadataInput(pendingSummary);
    const extras = {};
    if (consigne.type === "checklist") {
      const stats = deriveChecklistStats(pendingValue);
      Object.assign(extras, {
        checkedIds: stats.checkedIds,
        checkedCount: stats.checkedCount,
        total: stats.total,
        percentage: stats.percentage,
        isEmpty: stats.isEmpty,
      });
    }
    if (pageContext) {
      if (pageContext.pageDate) {
        extras.pageDate = pageContext.pageDate;
      }
      if (pageContext.weekStart) {
        extras.weekStart = pageContext.weekStart;
      }
      if (pageContext.pageDateIso) {
        extras.pageDateIso = pageContext.pageDateIso;
      }
      if (typeof pageContext.pageDayIndex === "number") {
        extras.pageDayIndex = pageContext.pageDayIndex;
      }
    }
    const answers = [{ consigne, value: pendingValue, dayKey, ...extras }];
    if (normalizedSummary) {
      Object.assign(answers[0], normalizedSummary);
    }
    if (consigne.type === "checklist") {
      logChecklistEvent("info", "[checklist-history] daily.autosave.payload", {
        consigneId: consigne?.id ?? null,
        dayKey,
        items: Array.isArray(pendingValue?.items) ? pendingValue.items : null,
        skipped: Array.isArray(pendingValue?.skipped) ? pendingValue.skipped : null,
        hasSummary: !!normalizedSummary,
      });
    }
    try {
      modesLogger?.info?.("daily.autosave.enqueue", {
        consigneId: consigne?.id ?? null,
        type: consigne?.type || null,
        hasSummary: !!normalizedSummary,
        dayKey,
        skipped: !!(pendingValue && typeof pendingValue === 'object' && pendingValue.skipped === true),
      });
    } catch (_) {}
    Schema.saveResponses(ctx.db, ctx.user.uid, "daily", answers)
      .then(async () => {
        try {
          modesLogger?.info?.("daily.autosave.saved", {
            consigneId: consigne?.id ?? null,
            dayKey,
          });
        } catch (_) {}
        markAnswerAsSaved(consigne, pendingValue, pendingSerialized, normalizedSummary);
        if (window.__appBadge && typeof window.__appBadge.refresh === "function") {
          try {
            await window.__appBadge.refresh(ctx.user?.uid);
          } catch (error) {
            console.warn("daily.autosave.badge", error);
          }
        }
      })
      .catch((error) => {
        console.error("daily.autosave.error", error);
        try {
          modesLogger?.warn?.("daily.autosave.fail", {
            consigneId: consigne?.id ?? null,
            dayKey,
            error: String(error && error.message || error) || "unknown",
          });
        } catch (_) {}
        notifyAutoSaveError();
        const retryDelay = Math.min(10000, Math.max(2000, resolveAutoSaveDelay(consigne) * 2));
        state.timeout = setTimeout(() => runAutoSave(consigneId), retryDelay);
      })
      .finally(() => {
        const latest = autoSaveStates.get(consigneId);
        if (!latest) {
          return;
        }
        latest.inFlight = false;
        const hasPendingChange = latest.pendingHasContent && latest.pendingSerialized !== pendingSerialized;
        if (hasPendingChange && !latest.timeout) {
          const delay = resolveAutoSaveDelay(latest.consigne);
          latest.timeout = setTimeout(() => runAutoSave(consigneId), delay);
          autoSaveStates.set(consigneId, latest);
          return;
        }
        if (latest.timeout) {
          autoSaveStates.set(consigneId, latest);
          return;
        }
        if (hasPendingChange) {
          const delay = resolveAutoSaveDelay(latest.consigne);
          latest.timeout = setTimeout(() => runAutoSave(consigneId), delay);
          autoSaveStates.set(consigneId, latest);
          return;
        }
        autoSaveStates.delete(consigneId);
      });
  };

  const scheduleAutoSave = (consigne, value, { serialized, hasContent, summary } = {}) => {
    if (!consigne || !consigne.id) return;
    const consigneId = consigne.id;
    const computedSerialized = serialized !== undefined ? serialized : serializeValueForComparison(consigne, value);
    const effectiveHasContent = hasContent !== undefined ? hasContent : hasValueForConsigne(consigne, value);
    const state = autoSaveStates.get(consigneId) || {
      consigne,
      pendingValue: null,
      pendingSerialized: null,
      pendingHasContent: false,
      pendingSummary: null,
      timeout: null,
      inFlight: false,
    };
    state.consigne = consigne;
    state.pendingValue = value;
    state.pendingSerialized = computedSerialized;
    state.pendingHasContent = effectiveHasContent;
    state.pendingSummary = effectiveHasContent
      ? normalizeSummaryMetadataInput(summary)
      : null;

    const savedEntry = previousAnswers.get(consigneId);
    if (savedEntry && savedEntry.__serialized === undefined && Object.prototype.hasOwnProperty.call(savedEntry, "value")) {
      try {
        const baseSerialized = serializeValueForComparison(consigne, savedEntry.value);
        const savedSummary = normalizeSummaryMetadataInput(savedEntry);
        const savedSummarySerialized = serializeSummaryMetadataForComparison(savedSummary);
        savedEntry.__serialized = savedSummarySerialized
          ? `${baseSerialized}__summary__${savedSummarySerialized}`
          : baseSerialized;
        previousAnswers.set(consigneId, savedEntry);
      } catch (error) {
        console.warn("daily.autosave.serialize.previous", error);
      }
    }
    if (savedEntry && savedEntry.__serialized === computedSerialized && !state.inFlight) {
      if (state.timeout) {
        clearTimeout(state.timeout);
      }
      autoSaveStates.delete(consigneId);
      return;
    }

    if (!effectiveHasContent) {
      if (state.timeout) {
        clearTimeout(state.timeout);
      }
      if (!state.inFlight) {
        autoSaveStates.delete(consigneId);
      } else {
        autoSaveStates.set(consigneId, state);
      }
      return;
    }

    if (state.inFlight) {
      autoSaveStates.set(consigneId, state);
      return;
    }

    if (state.timeout) {
      clearTimeout(state.timeout);
    }
    const delay = resolveAutoSaveDelay(consigne);
    state.timeout = setTimeout(() => runAutoSave(consigneId), delay);
    autoSaveStates.set(consigneId, state);
  };

  const handleValueChange = (consigne, row, value, { serialized, summary, baseSerialized } = {}) => {
    const normalizedValue = normalizeConsigneValueForPersistence(consigne, row, value);
    const skipActive = Boolean(row?.dataset?.skipAnswered === "1");
    const hasContent = skipActive
      ? true
      : consigne.type === "checklist"
        ? hasChecklistResponse(consigne, row, normalizedValue)
        : hasValueForConsigne(consigne, normalizedValue);
    try {
      modesLogger?.debug?.("consigne.value.change", {
        consigneId: consigne?.id ?? null,
        type: consigne?.type || null,
        skipActive,
        hasContent,
        normalizedIsSkipped: !!(normalizedValue && typeof normalizedValue === 'object' && normalizedValue.skipped === true),
      });
    } catch (_) {}
    if (!hasContent) {
      previousAnswers.delete(consigne.id);
      if (row) {
        clearConsigneSummaryMetadata(row);
      }
    }
    const summaryMetadata =
      summary !== undefined
        ? normalizeSummaryMetadataInput(summary)
        : normalizeSummaryMetadataInput(readConsigneSummaryMetadata(row));
    const summarySerialized = serializeSummaryMetadataForComparison(summaryMetadata);
    const computedBaseSerialized =
      baseSerialized !== undefined
        ? baseSerialized
        : serializeValueForComparison(consigne, normalizedValue);
    const providedCombined = typeof serialized === "string" ? serialized : null;
    const combinedSerialized =
      providedCombined !== null
        ? providedCombined
        : summarySerialized
          ? `${computedBaseSerialized}__summary__${summarySerialized}`
          : computedBaseSerialized;
    if (row) {
      if (!hasContent) {
        delete row.dataset.currentValue;
      } else if (typeof normalizedValue === "object") {
        row.dataset.currentValue = computedBaseSerialized;
      } else {
        row.dataset.currentValue = String(normalizedValue);
      }
    }
    scheduleAutoSave(consigne, normalizedValue, {
      serialized: combinedSerialized,
      hasContent,
      summary: hasContent ? summaryMetadata : null,
    });
  };

  const renderItemCard = (item, { isChild = false, deferEditor = false, editorOptions = null } = {}) => {
    const previous = previousAnswers.get(item.id);
    const previousHasValue = Boolean(
      previous && Object.prototype.hasOwnProperty.call(previous, "value"),
    );
    let hasPrevValue = false;
    if (previousHasValue) {
      if (item.type === "checklist") {
        const previousDayKey = resolvePreviousEntryDayKey(previous);
        const sameDay = normalizedCurrentDayKey
          ? previousDayKey === normalizedCurrentDayKey
          : Boolean(previousDayKey);
        if (sameDay && hasChecklistResponse(item, null, previous.value)) {
          hasPrevValue = true;
        }
      } else {
        hasPrevValue = true;
      }
    }
    const initialValue = hasPrevValue ? previous.value : null;
    const row = document.createElement("div");
    const tone = priorityTone(item.priority);
    row.className = `consigne-row priority-surface priority-surface-${tone}`;
    row.dataset.id = item.id;
    if (item?.id != null) {
      const stringId = String(item.id);
      row.dataset.consigneId = stringId;
      row.setAttribute("data-consigne-id", stringId);
    } else {
      delete row.dataset.consigneId;
      row.removeAttribute("data-consigne-id");
    }
    row.dataset.priorityTone = tone;
    if (typeof dayKey === "string" && dayKey) {
      row.dataset.dayKey = dayKey;
    } else {
      delete row.dataset.dayKey;
    }
    if (isChild) {
      row.classList.add("consigne-row--child");
      if (item.parentId) {
        row.dataset.parentId = item.parentId;
      } else {
        delete row.dataset.parentId;
      }
      row.draggable = false;
    } else {
      row.classList.add("consigne-row--parent");
      delete row.dataset.parentId;
      row.draggable = true;
    }
    row.innerHTML = `
      <div class="consigne-row__header">
        <div class="consigne-row__main">
          <button type="button" class="consigne-row__toggle" data-consigne-open aria-haspopup="dialog">
            <span class="consigne-row__title">${escapeHtml(item.text)}</span>
            ${prioChip(Number(item.priority) || 2)}
          </button>
        </div>
        <div class="consigne-row__meta">
          <span class="consigne-row__status" data-status="na">
            <button type="button"
                    class="consigne-row__dot-button"
                    data-priority-trigger
                    aria-haspopup="true"
                    aria-expanded="false"
                    title="Changer la priorité">
              <span class="consigne-row__dot consigne-row__dot--na" data-status-dot aria-hidden="true"></span>
            </button>
            <div class="consigne-row__priority-menu" data-priority-menu hidden></div>
            <span class="consigne-row__mark" data-status-mark aria-hidden="true"></span>
            <span class="sr-only" data-status-live aria-live="polite"></span>
          </span>
          ${consigneActions()}
        </div>
      </div>
      <div class="consigne-history" data-consigne-history hidden>
        <button type="button" class="consigne-history__nav" data-consigne-history-prev aria-label="Faire défiler l’historique vers la gauche" hidden><span aria-hidden="true">&lsaquo;</span></button>
        <div class="consigne-history__viewport" data-consigne-history-viewport>
          <div class="consigne-history__track" data-consigne-history-track role="list"></div>
        </div>
        <button type="button" class="consigne-history__nav" data-consigne-history-next aria-label="Faire défiler l’historique vers la droite" hidden><span aria-hidden="true">&rsaquo;</span></button>
      </div>
      <div data-consigne-input-holder hidden></div>
    `;
    const statusHolder = row.querySelector("[data-status]");
    if (statusHolder) {
      statusHolder.dataset.priorityTone = tone;
    }
    const statusDot = row.querySelector("[data-status-dot]");
    if (statusDot) {
      statusDot.dataset.priorityTone = tone;
    }
    setupConsignePriorityMenu(row, item, ctx);
    const holder = row.querySelector("[data-consigne-input-holder]");
    if (holder) {
      holder.innerHTML = inputForType(item, previous?.value ?? null, { pageContext });
      enhanceRangeMeters(holder);
      initializeChecklistScope(holder, { consigneId: item?.id ?? null });
      ensureConsigneSkipField(row, item);
      // Si la valeur précédente indiquait un « Passer », applique l’état dès le rendu initial
      try {
        const prevVal = previous?.value;
        const wasSkipped = !!(prevVal && typeof prevVal === "object" && prevVal.skipped === true);
        if (wasSkipped) {
          setConsigneSkipState(row, item, true, { emitInputEvents: false, updateUI: true });
        }
      } catch (_) {}
    }
    setupConsigneHistoryTimeline(row, item, ctx, { mode: "daily", dayKey });
    const previousSummary = normalizeSummaryMetadataInput(previous);
    if (previousSummary) {
      setConsigneSummaryMetadata(row, previousSummary);
    } else {
      clearConsigneSummaryMetadata(row);
    }
    const bH = row.querySelector(".js-histo");
    const bE = row.querySelector(".js-edit");
    const bD = row.querySelector(".js-del");
    bH.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closeConsigneActionMenuFromNode(bH); Schema.D.info("ui.history.click", item.id); openHistory(ctx, item, { source: "daily" }); };
    bE.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closeConsigneActionMenuFromNode(bE); Schema.D.info("ui.editConsigne.click", item.id); openConsigneForm(ctx, item); };
    bD.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      closeConsigneActionMenuFromNode(bD);
      if (confirm("Supprimer cette consigne ? (historique conservé)")) {
        Schema.D.info("ui.deleteConsigne.confirm", item.id);
        await Schema.softDeleteConsigne(ctx.db, ctx.user.uid, item.id);
        renderDaily(ctx, root, { day: currentDay });
      }
    };
    let srEnabled = item?.srEnabled !== false;
    const delayBtn = row.querySelector(".js-delay");
    const updateDelayState = (enabled) => {
      if (!delayBtn) return;
      delayBtn.disabled = !enabled;
      delayBtn.classList.toggle("opacity-50", !enabled);
      delayBtn.title = enabled
        ? "Décaler la prochaine apparition"
        : "Active la répétition espacée pour décaler";
    };
    if (delayBtn) {
      updateDelayState(srEnabled);
      delayBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeConsigneActionMenuFromNode(delayBtn);
        if (delayBtn.disabled) {
          showToast("Active la répétition espacée pour utiliser le décalage.");
          return;
        }
        const raw = prompt("Décaler de combien de jours ?", "1");
        if (raw === null) return;
        const value = Number(String(raw).replace(",", "."));
        const rounded = Math.round(value);
        if (!Number.isFinite(value) || !Number.isFinite(rounded) || rounded < 1) {
          showToast("Entre un entier positif.");
          return;
        }
        const amount = rounded;
        delayBtn.disabled = true;
        try {
          await Schema.delayConsigne({
            db: ctx.db,
            uid: ctx.user.uid,
            consigne: item,
            mode: "daily",
            amount,
          });
          showToast(`Consigne décalée de ${amount} jour${amount > 1 ? "s" : ""}.`);
          renderDaily(ctx, root, { ...opts, day: currentDay, dateIso });
        } catch (err) {
          console.error(err);
          showToast("Impossible de décaler la consigne.");
        } finally {
          updateDelayState(srEnabled);
        }
      };
    }
    setupConsigneActionMenus(row, () => ({
      srToggle: {
        getEnabled: () => srEnabled,
        onToggle: async (next) => {
          try {
            await Schema.updateConsigne(ctx.db, ctx.user.uid, item.id, { srEnabled: next });
            srEnabled = next;
            item.srEnabled = next;
            updateDelayState(srEnabled);
            return srEnabled;
          } catch (err) {
            console.error(err);
            showToast("Impossible de mettre à jour la répétition espacée.");
            return srEnabled;
          }
        },
      },
    }));

    const editorConfig = { variant: "modal", ...(editorOptions || {}) };
    if (!deferEditor) {
      attachConsigneEditor(row, item, editorConfig);
    }
    bindConsigneRowValue(row, item, {
      initialValue,
      onChange: (value) => {
        const normalizedValue = normalizeConsigneValueForPersistence(item, row, value);
        const baseSerialized = serializeValueForComparison(item, normalizedValue);
        const summaryMetadata = readConsigneSummaryMetadata(row);
        const summarySerialized = serializeSummaryMetadataForComparison(summaryMetadata);
        const combinedSerialized = summarySerialized
          ? `${baseSerialized}__summary__${summarySerialized}`
          : baseSerialized;
        const previousSerialized = observedValues.get(item.id);
        if (previousSerialized === undefined) {
          observedValues.set(item.id, combinedSerialized);
          return;
        }
        if (previousSerialized === combinedSerialized) {
          return;
        }
        observedValues.set(item.id, combinedSerialized);
        handleValueChange(item, row, normalizedValue, {
          serialized: combinedSerialized,
          summary: summaryMetadata,
          baseSerialized,
        });
      },
    });

    return row;
  };

  const renderGroup = (group, target) => {
    const wrapper = document.createElement("div");
    wrapper.className = "consigne-group";
    const parentCard = renderItemCard(group.consigne, { isChild: false, deferEditor: true });
    wrapper.appendChild(parentCard);
    const childConfigs = group.children.map((child) => {
      const previous = previousAnswers.get(child.id);
      const previousHasValue = Boolean(
        previous && Object.prototype.hasOwnProperty.call(previous, "value"),
      );
      let hasPrevValue = false;
      if (previousHasValue) {
        if (child.type === "checklist") {
          const previousDayKey = resolvePreviousEntryDayKey(previous);
          const sameDay = normalizedCurrentDayKey
            ? previousDayKey === normalizedCurrentDayKey
            : Boolean(previousDayKey);
          if (sameDay && hasChecklistResponse(child, null, previous.value)) {
            hasPrevValue = true;
          }
        } else {
          hasPrevValue = true;
        }
      }
      const initialValue = hasPrevValue ? previous.value : null;
      const childRow = createHiddenConsigneRow(child, { initialValue });
      childRow.dataset.parentId = child.parentId || group.consigne.id || "";
      childRow.draggable = false;
      parentCard.appendChild(childRow);
      const childSummary = normalizeSummaryMetadataInput(previous);
      if (childSummary) {
        setConsigneSummaryMetadata(childRow, childSummary);
      } else {
        clearConsigneSummaryMetadata(childRow);
      }
      bindConsigneRowValue(childRow, child, {
        initialValue,
        onChange: (value) => {
          const normalizedValue = normalizeConsigneValueForPersistence(child, childRow, value);
          const baseSerialized = serializeValueForComparison(child, normalizedValue);
          const summaryMetadata = readConsigneSummaryMetadata(childRow);
          const summarySerialized = serializeSummaryMetadataForComparison(summaryMetadata);
          const combinedSerialized = summarySerialized
            ? `${baseSerialized}__summary__${summarySerialized}`
            : baseSerialized;
          const prevSerialized = observedValues.get(child.id);
          if (prevSerialized === undefined) {
            observedValues.set(child.id, combinedSerialized);
            return;
          }
          if (prevSerialized === combinedSerialized) {
            return;
          }
          observedValues.set(child.id, combinedSerialized);
          handleValueChange(child, childRow, normalizedValue, {
            serialized: combinedSerialized,
            summary: summaryMetadata,
            baseSerialized,
          });
        },
      });
      let srEnabled = child?.srEnabled !== false;
      const config = {
        consigne: child,
        row: childRow,
        srEnabled,
        onHistory: () => {
          Schema.D.info("ui.history.click", child.id);
          openHistory(ctx, child, { source: "daily" });
        },
        onEdit: ({ close } = {}) => {
          Schema.D.info("ui.editConsigne.click", child.id);
          if (typeof close === "function") {
            close();
          }
          openConsigneForm(ctx, child);
        },
        onDelete: async ({ close } = {}) => {
          if (!confirm("Supprimer cette consigne ? (historique conservé)")) {
            return false;
          }
          Schema.D.info("ui.deleteConsigne.confirm", child.id);
          await Schema.softDeleteConsigne(ctx.db, ctx.user.uid, child.id);
          if (typeof close === "function") {
            close();
          }
          renderDaily(ctx, root, { ...opts, day: currentDay, dateIso });
          return true;
        },
        onToggleSr: async (next) => {
          try {
            await Schema.updateConsigne(ctx.db, ctx.user.uid, child.id, { srEnabled: next });
            srEnabled = next;
            config.srEnabled = srEnabled;
            child.srEnabled = next;
            return srEnabled;
          } catch (err) {
            console.error(err);
            showToast("Impossible de mettre à jour la répétition espacée.");
            return srEnabled;
          }
        },
      };
      return config;
    });
    attachConsigneEditor(parentCard, group.consigne, {
      variant: "modal",
      childConsignes: childConfigs,
    });
    target.appendChild(wrapper);
  };

  const form = document.createElement("form");
  form.className = "daily-grid";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
  });
  card.appendChild(form);

  // Insère une section dédiée si un ou plusieurs objectifs sont dus aujourd’hui
  if (Array.isArray(objectivesDueToday) && objectivesDueToday.length) {
    const section = document.createElement("section");
    section.className = "daily-category daily-grid__item";
    section.dataset.category = "Objectifs du jour";
    const total = objectivesDueToday.length;
    section.innerHTML = `
      <div class="daily-category__header">
        <div class="daily-category__name">Objectifs du jour</div>
        <span class="daily-category__count">${total} objectif${total > 1 ? "s" : ""}</span>
      </div>`;
    const stack = document.createElement("div");
    stack.className = "daily-category__items";
    section.appendChild(stack);

    objectivesDueToday.forEach((obj) => {
      const title = obj?.titre || obj?.title || obj?.name || "Objectif";
      const row = document.createElement("div");
      row.className = "consigne-row priority-surface priority-surface-medium";
      row.dataset.objectiveId = String(obj?.id || "");

      const fieldId = `obj-${String(obj?.id || Math.random()).replace(/[^a-zA-Z0-9_-]/g, "")}`;
      row.innerHTML = `
        <div class="consigne-row__header">
          <div class="consigne-row__main">
            <button type="button" class="consigne-row__toggle" data-objective-open aria-haspopup="dialog">
              <span class="consigne-row__title">${escapeHtml(title)}</span>
            </button>
          </div>
          <div class="consigne-row__meta">
            <span class="consigne-row__status" data-status="na">
              <span class="consigne-row__dot consigne-row__dot--na" data-status-dot aria-hidden="true"></span>
              <span class="consigne-row__mark" data-status-mark aria-hidden="true"></span>
              <span class="sr-only" data-status-live aria-live="polite"></span>
            </span>
          </div>
        </div>`;

      const openBtn = row.querySelector('[data-objective-open]');
      const currentDayIso = typeof Schema?.dayKeyFromDate === "function"
        ? Schema.dayKeyFromDate(selectedDate)
        : (selectedDate && selectedDate.toISOString ? selectedDate.toISOString().slice(0,10) : "");

      // Utilitaire statut couleur comme les consignes
      const applyObjectiveStatus = (val) => {
        const statusHolder = row.querySelector('[data-status]');
        const dot = row.querySelector('[data-status-dot]');
        const mark = row.querySelector('[data-status-mark]');
        const live = row.querySelector('[data-status-live]');
        const n = val == null ? null : Number(val);
        let status = 'na';
        if (Number.isFinite(n) && n > 0) {
          if (n >= 5) status = 'ok-strong';
          else if (n === 4) status = 'ok-soft';
          else if (n === 3) status = 'mid';
          else if (n === 2) status = 'ko-soft';
          else status = 'ko-strong';
        }
        row.dataset.status = status;
        if (statusHolder) {
          statusHolder.dataset.status = status;
          statusHolder.setAttribute('data-status', status);
        }
        if (dot) {
          dot.className = `consigne-row__dot consigne-row__dot--${status}`;
        }
        if (mark) {
          mark.classList.toggle('consigne-row__mark--checked', status !== 'na');
        }
        if (live) {
          const labels = { 'ok-strong': 'Très positif', 'ok-soft': 'Plutôt positif', mid: 'Intermédiaire', 'ko-soft': 'Plutôt négatif', 'ko-strong': 'Très négatif', note: 'Réponse notée', na: 'Sans donnée' };
          live.textContent = `${labels[status] || 'Valeur'}`;
        }
      };

      // Ouvre une modale pour répondre à l'objectif (même logique que les consignes)
      if (openBtn) {
        openBtn.addEventListener('click', async () => {
          let initialValue = '';
          try {
            const existing = await Schema.getObjectiveEntry(ctx.db, ctx.user.uid, obj.id, currentDayIso);
            if (existing && existing.v !== undefined && existing.v !== null) {
              initialValue = String(existing.v);
            }
          } catch (e) {
            try { modesLogger?.warn?.('daily.objectivesDue.prefill', e); } catch (_) {}
          }
          const content = document.createElement('div');
          content.innerHTML = `
            <div class="space-y-4">
              <header class="space-y-1">
                <h2 class="text-lg font-semibold">${escapeHtml(title)}</h2>
                <p class="text-sm text-[var(--muted)]">Répondre à l’objectif du jour</p>
              </header>
              <div class="grid gap-2">
                <label class="text-sm" for="${fieldId}">Réponse</label>
                <select id="${fieldId}" class="practice-editor__select">
                  <option value="" ${initialValue===''?'selected':''}>—</option>
                  <option value="5" ${initialValue==='5'?'selected':''}>Oui</option>
                  <option value="4" ${initialValue==='4'?'selected':''}>Plutôt oui</option>
                  <option value="3" ${initialValue==='3'?'selected':''}>Neutre</option>
                  <option value="2" ${initialValue==='2'?'selected':''}>Plutôt non</option>
                  <option value="1" ${initialValue==='1'?'selected':''}>Non</option>
                  <option value="0" ${initialValue==='0'?'selected':''}>Pas de réponse</option>
                </select>
              </div>
              <div class="flex justify-end gap-2">
                <button type="button" class="btn" data-close>Annuler</button>
                <button type="button" class="btn btn-primary" data-save>Enregistrer</button>
              </div>
            </div>`;
          const overlay = modal(content.outerHTML);
          if (!overlay) return;
          const close = () => overlay.remove();
          overlay.querySelector('[data-close]')?.addEventListener('click', close);
          overlay.querySelector('[data-save]')?.addEventListener('click', async () => {
            const sel = overlay.querySelector(`#${CSS.escape(fieldId)}`);
            const raw = sel ? sel.value : '';
            const val = raw === '' ? null : Number(raw);
            try {
              await Schema.saveObjectiveEntry(ctx.db, ctx.user.uid, obj.id, currentDayIso, val);
              applyObjectiveStatus(val);
              showToast('Réponse enregistrée.');
              close();
            } catch (err) {
              console.error('objective.entry.save', err);
              showToast('Impossible d’enregistrer la réponse.');
            }
          });
        });
      }

      stack.appendChild(row);

      // Initialiser le statut visuel depuis la valeur existante
      (async () => {
        try {
          const existing = await Schema.getObjectiveEntry(ctx.db, ctx.user.uid, obj.id, currentDayIso);
          if (existing && existing.v !== undefined && existing.v !== null) {
            applyObjectiveStatus(existing.v);
          } else {
            applyObjectiveStatus(null);
          }
        } catch (e) {
          try { modesLogger?.warn?.('daily.objectivesDue.initStatus', e); } catch (_) {}
        }
      })();
    });

    // Mettre la section en tête de grille
    form.appendChild(section);
  }

  if (!visibleConsignes.length) {
    const empty = document.createElement("div");
    empty.className = "rounded-xl border border-dashed border-gray-200 bg-white p-3 text-sm text-[var(--muted)] daily-grid__item";
    empty.innerText = "Aucune consigne visible pour ce jour.";
    form.appendChild(empty);
  } else {
    categoryGroups.forEach(([cat, info]) => {
      const { groups, total } = info;
      const section = document.createElement("section");
      section.className = "daily-category daily-grid__item";
      section.dataset.category = cat;
      section.innerHTML = `
        <div class="daily-category__header">
          <div class="daily-category__name">${escapeHtml(cat)}</div>
          <span class="daily-category__count">${total} consigne${total > 1 ? "s" : ""}</span>
        </div>`;
      const stack = document.createElement("div");
      stack.className = "daily-category__items";
      section.appendChild(stack);

      const highs = groups.filter((g) => (g.consigne.priority || 2) <= 2);
      const lows = groups.filter((g) => (g.consigne.priority || 2) >= 3);

      highs.forEach((group) => renderGroup(group, stack));

      if (lows.length) {
        const det = document.createElement("details");
        det.className = "daily-category__low";
        const lowCount = lows.reduce((acc, group) => acc + 1 + group.children.length, 0);
        det.innerHTML = `<summary class="daily-category__low-summary">Priorité basse (${lowCount})</summary>`;
        const box = document.createElement("div");
        box.className = "daily-category__items daily-category__items--nested";
        lows.forEach((group) => renderGroup(group, box));
        det.appendChild(box);
        stack.appendChild(det);
      }

      form.appendChild(section);
    });
  }

  if (typeof window.attachConsignesDragDrop === "function") {
    window.attachConsignesDragDrop(form, ctx);
  }
  if (typeof window.attachDailyCategoryDragDrop === "function") {
    window.attachDailyCategoryDragDrop(form, ctx);
  }

  if (hidden.length) {
    const box = document.createElement("div");
    box.className = "card p-3 space-y-2";
    box.innerHTML = `<div class="font-medium">Masquées par répétition espacée (${hidden.length})</div>
  <ul class="text-sm text-[var(--muted)] space-y-1">
    ${hidden.map(h => `
      <li class="practice-hidden__item">
        <div class="practice-hidden__text"><span class="font-medium text-slate-600">${escapeHtml(h.c.text)}</span> — revient dans ${h.daysLeft} jour(s) (le ${h.when.toLocaleDateString()})</div>
        <div class="practice-hidden__actions">
          <button type="button" class="btn btn-ghost text-xs js-histo-hidden" data-id="${h.c.id}">Historique</button>
          <button type="button" class="btn btn-ghost text-xs js-reset-sr" data-id="${h.c.id}">Réinitialiser</button>
        </div>
      </li>`).join("")}
  </ul>`;
    container.appendChild(box);

    box.addEventListener("click", async (e) => {
      const id = e.target?.dataset?.id;
      if (!id) return;
      if (e.target.classList.contains("js-histo-hidden")) {
        const c = hidden.find((x) => x.c.id === id)?.c;
        if (c) openHistory(ctx, c, { source: "daily" });
      } else if (e.target.classList.contains("js-reset-sr")) {
        await Schema.resetSRForConsigne(ctx.db, ctx.user.uid, id);
        renderDaily(ctx, root, { day: currentDay });
      }
    });
  }

  const actions = document.createElement("div");
  actions.className = "daily-grid__item daily-grid__actions";
  actions.innerHTML = `
    <div class="flex w-full justify-end text-sm text-[var(--muted)]">
      <span class="inline-flex items-center gap-2 rounded-full border border-dashed border-slate-300/60 px-3 py-1">
        <span aria-hidden="true">💾</span>
        <span>Enregistrement automatique</span>
      </span>
    </div>`;
  form.appendChild(actions);

  modesLogger.groupEnd();
  if (window.__appBadge && typeof window.__appBadge.refresh === "function") {
    window.__appBadge.refresh(ctx.user?.uid).catch(() => {});
  }
}

function renderHistory() {}

async function openPracticeArchiveViewer(ctx) {
  if (!ctx?.db || !ctx?.user?.uid) {
    showToast("Connecte-toi pour accéder aux archives.");
    return;
  }
  const overlay = modal(`
    <div class="space-y-6" data-practice-archive-modal>
      <header class="space-y-1">
        <h2 class="text-xl font-semibold">Réponses archivées</h2>
        <p class="text-sm text-slate-600">Consignes de l’onglet Pratique mises de côté.</p>
      </header>
      <div class="space-y-3" data-practice-archive-list>
        <div class="text-sm text-[var(--muted)]">Chargement…</div>
      </div>
      <div class="flex justify-end">
        <button type="button" class="btn" data-practice-archive-close>Fermer</button>
      </div>
    </div>
  `);
  const dialog = overlay.querySelector("[data-modal-content]");
  const heading = overlay.querySelector("h2");
  if (dialog && heading) {
    if (!heading.id) {
      heading.id = `practice-archive-title-${Date.now()}`;
    }
    dialog.setAttribute("aria-labelledby", heading.id);
  }
  const closeBtn = overlay.querySelector("[data-practice-archive-close]");
  closeBtn?.addEventListener("click", () => overlay.remove());
  const list = overlay.querySelector("[data-practice-archive-list]");
  const showEmpty = () => {
    if (list) {
      list.innerHTML = "<div class=\"text-sm text-[var(--muted)]\">Aucune consigne archivée.</div>";
    }
  };
  const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const normalizeDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value?.toDate === "function") {
      try {
        return value.toDate();
      } catch (_) {
        return null;
      }
    }
    if (typeof value === "string") {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  };
  let archivedItems = [];
  try {
    archivedItems = await Schema.listArchivedConsignes(ctx.db, ctx.user.uid, "practice");
  } catch (error) {
    console.error("practice.archives.load", error);
    if (list) {
      list.innerHTML = "<div class=\"text-sm text-red-600\">Impossible de charger les archives.</div>";
    }
    return;
  }
  if (!list) {
    return;
  }
  if (!archivedItems.length) {
    showEmpty();
  } else {
    const sorted = archivedItems
      .slice()
      .sort((a, b) => {
        const catA = (a.category || "").localeCompare(b.category || "");
        if (catA !== 0) return catA;
        return (a.text || a.titre || "").localeCompare(b.text || b.titre || "");
      });
    const itemsMarkup = sorted
      .map((consigne) => {
        const title = consigne.text || consigne.titre || consigne.name || consigne.id || "Consigne";
        const category = consigne.category || "Sans catégorie";
        const archivedDate = normalizeDate(consigne.archivedAt);
        const archivedLabel = archivedDate ? dateFormatter.format(archivedDate) : null;
        const noteParts = [];
        if (category) {
          noteParts.push(`<span class=\"rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600\">${escapeHtml(category)}</span>`);
        }
        if (archivedLabel) {
          noteParts.push(`<span class=\"text-xs text-slate-500\">Archivée le ${escapeHtml(archivedLabel)}</span>`);
        }
        return `
          <article class="space-y-3 rounded-xl border border-slate-200 p-3" data-practice-archive-entry data-consigne-id="${escapeHtml(consigne.id)}">
            <header class="flex flex-wrap items-start justify-between gap-3">
              <div class="space-y-1">
                <h3 class="font-medium text-slate-800">${escapeHtml(title)}</h3>
                ${noteParts.length ? `<div class="flex flex-wrap gap-2">${noteParts.join("")}</div>` : ""}
              </div>
              <button type="button" class="btn btn-primary" data-practice-archive-restore>Restaurer</button>
            </header>
            ${consigne.description ? `<p class="text-sm text-slate-600 whitespace-pre-line">${escapeHtml(consigne.description)}</p>` : ""}
          </article>
        `;
      })
      .join("");
    list.innerHTML = itemsMarkup;
  }
  list.addEventListener("click", async (event) => {
    const restoreBtn = event.target?.closest?.("[data-practice-archive-restore]");
    if (!restoreBtn) return;
    const entry = restoreBtn.closest("[data-practice-archive-entry]");
    if (!entry) return;
    const consigneId = entry.getAttribute("data-consigne-id");
    if (!consigneId) return;
    restoreBtn.disabled = true;
    try {
      await Schema.unarchiveConsigne(ctx.db, ctx.user.uid, consigneId);
      showToast("Consigne restaurée.");
      entry.remove();
      if (!list.querySelector("[data-practice-archive-entry]")) {
        showEmpty();
      }
      if (ctx.route && String(ctx.route).startsWith("#/practice")) {
        const viewRoot = document.getElementById("view-root");
        if (viewRoot) {
          renderPractice(ctx, viewRoot);
        }
      }
    } catch (error) {
      console.error("practice.archives.restore", error);
      restoreBtn.disabled = false;
      showToast("Impossible de restaurer la consigne.");
    }
  });
  requestAnimationFrame(() => {
    closeBtn?.focus?.();
  });
}

Modes.openCategoryDashboard = window.openCategoryDashboard;
Modes.openConsigneForm = openConsigneForm;
Modes.openHistory = openHistory;
Modes.renderPractice = renderPractice;
Modes.renderDaily = renderDaily;
Modes.renderHistory = renderHistory;
Modes.openPracticeArchiveViewer = openPracticeArchiveViewer;
Modes.attachConsignesDragDrop = window.attachConsignesDragDrop;
Modes.attachDailyCategoryDragDrop = window.attachDailyCategoryDragDrop;
Modes.inputForType = inputForType;
Modes.collectAnswers = collectAnswers;
Modes.enhanceRangeMeters = enhanceRangeMeters;
Modes.groupConsignes = groupConsignes;
Modes.priorityTone = priorityTone;
Modes.prioChip = prioChip;
Modes.showToast = showToast;
Modes.openBilanModal = openBilanModal;
Modes.bindConsigneRowValue = bindConsigneRowValue;
Modes.attachConsigneEditor = attachConsigneEditor;
Modes.createHiddenConsigneRow = createHiddenConsigneRow;
Modes.hasValueForConsigne = hasValueForConsigne;
Modes.setConsigneSummaryMetadata = setConsigneSummaryMetadata;
Modes.clearConsigneSummaryMetadata = clearConsigneSummaryMetadata;
Modes.readConsigneSummaryMetadata = readConsigneSummaryMetadata;
Modes.buildSummaryMetadataForScope = buildSummaryMetadataForScope;
Modes.setupConsigneActionMenus = setupConsigneActionMenus;
Modes.setupConsignePriorityMenu = setupConsignePriorityMenu;
Modes.closeConsigneActionMenuFromNode = closeConsigneActionMenuFromNode;
Modes.setupConsigneHistoryTimeline = setupConsigneHistoryTimeline;

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    readConsigneCurrentValue,
    dotColor,
    buildChecklistValue,
    sanitizeChecklistItems,
    readChecklistStates,
    readChecklistSkipped,
    // Expose select internals for tests (non-breaking for runtime)
    setConsigneSkipState,
    normalizeConsigneValueForPersistence,
    normalizeMontantValue,
    parseHistoryTimelineDateInfo,
    __test__: {
      resolveHistoryTimelineKeyBase,
    },
  };
}
