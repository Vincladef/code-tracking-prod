// modes.js — Journalier / Pratique / Historique
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
  if (!key) return;
  try {
    if (typeof localStorage === "undefined") return;
    if (category) {
      localStorage.setItem(key, category);
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
  const rawMax = Number.parseInt(el.dataset.autoGrowMax || "", 10);
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

const NOTE_IGNORED_VALUES = new Set(["no_answer"]);

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

function resolveChecklistItemId(consigne, index, label) {
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
  const states = readChecklistStates(value);
  const selected = new Set();
  if (container instanceof Element) {
    const items = Array.from(container.querySelectorAll("[data-checklist-item]"));
    if (items.length) {
      items.forEach((item, index) => {
        const input = item.querySelector('[data-checklist-input], input[type="checkbox"]');
        const fallbackId = resolveChecklistItemId(
          consigne,
          index,
          item.getAttribute("data-checklist-label") || input?.getAttribute?.("data-label") || ""
        );
        const explicitKey =
          input?.getAttribute?.("data-key") ||
          input?.dataset?.key ||
          item.getAttribute("data-checklist-key") ||
          item.getAttribute("data-item-id");
        const itemId = explicitKey || fallbackId;
        const isChecked = input ? Boolean(input.checked) : Boolean(states[index]);
        if (isChecked) {
          selected.add(String(itemId));
        }
      });
      return Array.from(selected);
    }
  }
  const sanitizedItems = sanitizeChecklistItems(consigne);
  states.forEach((checked, index) => {
    if (checked) {
      selected.add(resolveChecklistItemId(consigne, index, sanitizedItems[index]));
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

function deriveChecklistStats(value) {
  const states = readChecklistStates(value);
  const total = states.length;
  const checkedIds = [];
  states.forEach((checked, index) => {
    if (checked) {
      checkedIds.push(index);
    }
  });
  const checkedCount = checkedIds.length;
  const ratio = total > 0 ? checkedCount / total : 0;
  let percentage = Math.round(ratio * 100);
  if (value && typeof value === "object") {
    const hintedPercentage = Number(value.percentage);
    if (Number.isFinite(hintedPercentage)) {
      percentage = Math.max(0, Math.min(100, Math.round(hintedPercentage)));
    }
  }
  return {
    total,
    checkedCount,
    checkedIds,
    percentage,
    isEmpty: checkedCount === 0,
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
  const rawStates = readChecklistStates(rawValue);
  const result = { items: [] };
  if (labels.length) {
    result.labels = labels.slice();
    result.items = labels.map((_, index) => Boolean(rawStates[index]));
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
    if (fallbackLabels.length) {
      const normalizedFallback = fallbackLabels.map((label) =>
        typeof label === "string" ? label : String(label)
      );
      result.labels = normalizedFallback;
      result.items = normalizedFallback.map((_, index) => Boolean(rawStates[index]));
    } else {
      result.items = rawStates.slice();
    }
  }
  if (!Array.isArray(result.items)) {
    result.items = [];
  }
  if (Array.isArray(result.labels) && result.items.length !== result.labels.length) {
    result.items = result.labels.map((_, index) => Boolean(result.items[index]));
  }
  return result;
}

function checklistHasSelection(value) {
  return readChecklistStates(value).some(Boolean);
}

function checklistIsComplete(value) {
  const states = readChecklistStates(value);
  return states.length > 0 && states.every(Boolean);
}

function numericPoint(type, value) {
  if (value === null || value === undefined || value === "") return null;
  if (type === "likert6") {
    return likert6NumericPoint(value);
  }
  const point = Schema.valueToNumericPoint(type, value);
  return Number.isFinite(point) ? point : null;
}

function formatConsigneValue(type, value, options = {}) {
  const wantsHtml = options.mode === "html";
  if (type === "info") return "";
  if (value && typeof value === "object" && value.skipped) {
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
  if (value === null || value === undefined || value === "") return "—";
  if (type === "checklist") {
    const states = readChecklistStates(value);
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
          const statusClass = checked
            ? "history-checklist__item--checked"
            : "history-checklist__item--unchecked";
          const symbol = checked ? "☑︎" : "☐";
          return `<li class="history-checklist__item ${statusClass}"><span class="history-checklist__box" aria-hidden="true">${symbol}</span><span class="history-checklist__label">${escapeHtml(label)}</span></li>`;
        })
        .join("");
      const completed = states.filter(Boolean).length;
      const ariaLabel = `${completed} sur ${states.length} éléments cochés`;
      return `<ul class="history-checklist" data-checked="${completed}" data-total="${states.length}" aria-label="${escapeHtml(ariaLabel)}">${itemsMarkup}</ul>`;
    }
    if (!states.length) return "—";
    const done = states.filter(Boolean).length;
    return `${done} / ${states.length}`;
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

function summaryScopeLabel(scope) {
  const normalized = String(scope || "").toLowerCase();
  if (normalized === "monthly") return "Bilan mensuel";
  if (normalized === "yearly") return "Bilan annuel";
  return "Bilan hebdomadaire";
}

async function chooseBilanScope(options = {}) {
  const allowMonthly = options.allowMonthly !== false;
  const scopes = [
    { scope: "weekly", label: "Bilan hebdomadaire", description: "Synthèse de la semaine écoulée." },
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
    type: "yearly",
    year,
    yearKey,
    yearStart: start,
    yearEnd: end,
    navLabel: `Bilan ${year}`,
    navSubtitle: `${year}`,
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
        <button type="button" class="btn" data-bilan-close>Fermer</button>
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
      if (payload.value !== undefined) current.value = payload.value;
      if (payload.note !== undefined) current.note = payload.note;
      if (payload.createdAt instanceof Date) {
        if (!current.createdAt || payload.createdAt > current.createdAt) {
          current.createdAt = payload.createdAt;
        }
      }
      entryMap.set(key, current);
    }

    function parseHistoryEntry(entry) {
      return {
        value:
          entry.v ??
          entry.value ??
          entry.answer ??
          entry.val ??
          entry.score ??
          "",
        note:
          entry.comment ??
          entry.note ??
          entry.remark ??
          entry.memo ??
          entry.obs ??
          entry.observation ??
          "",
        createdAt: parseResponseDate(entry.createdAt || entry.updatedAt || null),
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
        const numeric = numericPoint(consigne.type, rawValue);
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
      const lastDateObj = lastEntry?.createdAt || lastMeta?.dateObj || null;
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
      const lastFormattedText = formatConsigneValue(consigne.type, lastValue);
      const lastFormattedHtml = formatConsigneValue(consigne.type, lastValue, { mode: "html" });
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
        lastValue,
        lastFormatted: lastFormattedText,
        lastFormattedHtml,
        lastCommentRaw: lastNote,
        commentDisplay: truncateText(lastNote, 180),
        statusKind: dotColor(consigne.type, lastValue),
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
      const cards = stats
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
              const statusKind = dotColor(stat.type, entry.value);
              const statusLabel = statusLabels[statusKind] || "Valeur";
              const dateLabel = meta?.fullLabel || meta?.label || entry.date;
              const relativeLabel = formatRelativeDate(meta?.dateObj || entry.date);
              const valueText = formatConsigneValue(stat.type, entry.value);
              const valueHtml = formatConsigneValue(stat.type, entry.value, { mode: "html" });
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
      const stat = stats.find((item) => item.id === consigneId);
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
      point.numeric = numericPoint(stat.type, rawValue);
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
      stat.lastDateIso = lastDateIso;
      stat.lastDateShort = lastDateObj ? shortDateFormatter.format(lastDateObj) : "Jamais";
      stat.lastDateFull = lastDateObj ? fullDateTimeFormatter.format(lastDateObj) : "Jamais";
      stat.lastRelative = formatRelativeDate(lastDateObj || lastDateIso);
      stat.lastValue = lastValue;
      stat.lastFormatted = formatConsigneValue(stat.type, lastValue);
      stat.lastFormattedHtml = formatConsigneValue(stat.type, lastValue, { mode: "html" });
      stat.lastCommentRaw = lastEntry?.note ?? "";
      stat.commentDisplay = truncateText(stat.lastCommentRaw, 180);
      stat.statusKind = dotColor(stat.type, lastValue);
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
            await Schema.deleteHistoryEntry(ctx.db, ctx.user.uid, stat.id, point.dateIso);
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
            await Schema.deleteHistoryEntry(ctx.db, ctx.user.uid, stat.id, point.dateIso);
            updateStatAfterEdit(stat, pointIndex, "", "");
          } else {
            await Schema.saveHistoryEntry(ctx.db, ctx.user.uid, stat.id, point.dateIso, {
              value: rawValue,
              note,
            });
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
        ${actionBtn("Supprimer", "js-del text-red-600")}
      </div>
    </div>
  `;
}

const CONSIGNE_ACTION_SELECTOR = ".js-consigne-actions";
let openConsigneActionsRoot = null;
let consigneActionsDocListenersBound = false;

function getConsigneActionElements(root) {
  if (!root) return { trigger: null, panel: null };
  return {
    trigger: root.querySelector(".js-actions-trigger"),
    panel: root.querySelector(".js-actions-panel"),
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

function onDocumentClickConsigneActions(event) {
  if (!openConsigneActionsRoot) return;
  if (openConsigneActionsRoot.contains(event.target)) return;
  closeConsigneActionMenu(openConsigneActionsRoot);
}

function onDocumentKeydownConsigneActions(event) {
  if (!openConsigneActionsRoot) return;
  if (event.key === "Escape" || event.key === "Esc") {
    closeConsigneActionMenu(openConsigneActionsRoot, { focusTrigger: true });
    event.stopPropagation();
  }
}

function setupConsigneActionMenus(scope = document, configure) {
  $$(CONSIGNE_ACTION_SELECTOR, scope).forEach((actionsRoot) => {
    if (actionsRoot.dataset.actionsMenuReady === "1") return;
    const config = typeof configure === "function" ? configure(actionsRoot) : configure || {};
    const { trigger, panel } = getConsigneActionElements(actionsRoot);
    if (!trigger || !panel) return;
    actionsRoot.dataset.actionsMenuReady = "1";
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
  const root = node.closest(CONSIGNE_ACTION_SELECTOR);
  if (root) {
    closeConsigneActionMenu(root, options);
  }
}

function renderRichTextInput(name, { consigneId = "", initialValue = null, placeholder = "", inputId = "" } = {}) {
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
  return `
    <div class="consigne-rich-text" data-rich-text-root${consigneAttr}>
      <div class="consigne-rich-text__toolbar" data-rich-text-toolbar role="toolbar" aria-label="Mise en forme">
        <button type="button" class="btn btn-ghost text-xs" data-rich-command="bold" title="Gras" aria-label="Gras"><strong>B</strong></button>
        <button type="button" class="btn btn-ghost text-xs" data-rich-command="italic" title="Italique" aria-label="Italique"><em>I</em></button>
        <button type="button" class="btn btn-ghost text-xs" data-rich-command="insertUnorderedList" title="Liste à puces" aria-label="Liste à puces">•</button>
        <button type="button" class="btn btn-ghost text-xs" data-rich-command="insertOrderedList" title="Liste numérotée" aria-label="Liste numérotée">1.</button>
        <button type="button" class="btn btn-ghost text-xs" data-rich-command="checkbox" title="Insérer une case à cocher" aria-label="Insérer une case à cocher">☐</button>
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

  const ensureCheckboxWrapper = (input) => {
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
  };

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
      if (!tryExecCommand(command, null) && (command === "bold" || command === "italic")) {
        fallbackWrapWithTag(command === "bold" ? "strong" : "em");
      }
      scheduleSelectionCapture();
      schedule();
      updateToolbarStates();
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

function inputForType(consigne, initialValue = null) {
  if (consigne.type === "info") {
    return INFO_STATIC_BLOCK;
  }
  if (consigne.type === "short") {
    const value = escapeHtml(initialValue ?? "");
    return `<input name="short:${consigne.id}" class="w-full" placeholder="Réponse" value="${value}">`;
  }
  if (consigne.type === "long") {
    return renderRichTextInput(`long:${consigne.id}`, {
      consigneId: consigne.id,
      initialValue,
      placeholder: "Réponse",
    });
  }
  if (consigne.type === "num") {
    const sliderValue = initialValue != null && initialValue !== ""
      ? Number(initialValue)
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
  if (consigne.type === "likert6") {
    const current = (initialValue ?? "").toString();
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
    const current = initialValue != null ? String(initialValue) : "";
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
    const current = (initialValue ?? "").toString();
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
    const normalizedValue = Array.isArray(initialValue)
      ? items.map((_, index) => Boolean(initialValue[index]))
      : items.map(() => false);
    const optionsHash = computeChecklistOptionsHash(consigne);
    const optionsAttr = optionsHash ? ` data-checklist-options-hash="${escapeHtml(String(optionsHash))}"` : "";
    const checkboxes = items
      .map((label, index) => {
        const checked = normalizedValue[index];
        const trimmedLabel = typeof label === "string" ? label.trim() : "";
        const itemId = resolveChecklistItemId(consigne, index, trimmedLabel);
        const legacyBase =
          consigne?.id ??
          consigne?.slug ??
          consigne?.slugId ??
          consigne?.slug_id ??
          consigne?.consigneId ??
          "";
        const legacyId = legacyBase ? `${legacyBase}:${index}` : String(index);
        const validatedAttr = checked ? "true" : "false";
        return `
          <label class="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm" data-checklist-item data-item-id="${escapeHtml(itemId)}" data-checklist-key="${escapeHtml(itemId)}" data-checklist-legacy-key="${escapeHtml(legacyId)}" data-checklist-index="${index}" data-checklist-label="${escapeHtml(trimmedLabel)}" data-validated="${validatedAttr}">
            <input type="checkbox" class="h-4 w-4" data-checklist-input data-key="${escapeHtml(itemId)}" data-checklist-key="${escapeHtml(itemId)}" data-legacy-key="${escapeHtml(legacyId)}" data-checklist-index="${index}" ${checked ? "checked" : ""}>
            <span class="flex-1">${escapeHtml(label)}</span>
          </label>`;
      })
      .join("");
    const initialSerialized = escapeHtml(JSON.stringify(normalizedValue));
    return `
      <div class="grid gap-2" data-checklist-root data-consigne-id="${escapeHtml(String(consigne.id ?? ""))}"${optionsAttr}>
        ${checkboxes || `<p class="text-sm text-[var(--muted)]">Aucun élément défini</p>`}
        <input type="hidden" name="checklist:${consigne.id}" value="${initialSerialized}" data-checklist-state data-autosave-track="1" ${
          Array.isArray(initialValue) ? 'data-dirty="1"' : ""
        }>
      </div>
      <script>(()=>{const script=document.currentScript;const hidden=script.previousElementSibling;const root=hidden?.closest('[data-checklist-root]');if(!root||!hidden)return;const queryInputs=()=>Array.from(root.querySelectorAll('[data-checklist-input]'));const ensureItemIds=()=>{const consigneId=root.getAttribute('data-consigne-id')||root.dataset.consigneId||'';queryInputs().forEach((input,index)=>{const host=input.closest('[data-checklist-item]');if(!host)return;const explicitKey=input.getAttribute('data-key')||input.dataset?.key||input.getAttribute('data-item-id')||host.getAttribute('data-item-id');const attr=input.getAttribute('data-checklist-index');const idx=attr!==null?attr:index;const fallback=consigneId?String(consigneId)+":"+idx:String(idx);const resolvedKey=(explicitKey&&String(explicitKey).trim())||fallback;const legacyKey=input.getAttribute('data-legacy-key')||host.getAttribute('data-checklist-legacy-key')||fallback;input.setAttribute('data-key',resolvedKey);input.dataset.key=resolvedKey;input.setAttribute('data-item-id',resolvedKey);input.setAttribute('data-legacy-key',legacyKey);host.setAttribute('data-item-id',resolvedKey);host.setAttribute('data-checklist-key',resolvedKey);host.setAttribute('data-checklist-legacy-key',legacyKey);host.setAttribute('data-validated',input.checked?'true':'false');});};const sync=(options={})=>{const inputs=queryInputs();const values=inputs.map((input)=>Boolean(input.checked));hidden.value=JSON.stringify(values);if(options.markDirty){hidden.dataset.dirty='1';}if(options.notify){hidden.dispatchEvent(new Event('input',{bubbles:true}));hidden.dispatchEvent(new Event('change',{bubbles:true}));}ensureItemIds();};root.addEventListener('change',(event)=>{if(event.target&&event.target.matches('[data-checklist-input]')){sync({markDirty:true,notify:true});}});sync();const hydrate=window.hydrateChecklist;const uid=window.AppCtx?.user?.uid||null;const consigneId=root.getAttribute('data-consigne-id')||root.dataset.consigneId||'';if(typeof hydrate==='function'){Promise.resolve(hydrate({uid,consigneId,container:root,itemKeyAttr:'data-key'})).then(()=>sync()).catch((error)=>{console.warn('[checklist] hydrate',error);});}})();</script>
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
      if (hidden) {
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
          const values = Array.from(container.querySelectorAll("[data-checklist-input]"))
            .map((box) => Boolean(box.checked));
          const isDirty = container.dataset.checklistDirty === "1";
          if (isDirty) {
            const normalized = buildChecklistValue(consigne, values);
            const stats = deriveChecklistStats(normalized);
            const selectedIds = collectChecklistSelectedIds(consigne, container, normalized);
            pushAnswer(normalized, {
              checkedIds: stats.checkedIds,
              checkedCount: stats.checkedCount,
              total: stats.total,
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
  const advancedOpenAttr = isEphemeral ? " open" : "";
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
          <option value="checklist" ${consigne?.type === "checklist" ? "selected" : ""}>Checklist</option>
          <option value="info"    ${consigne?.type === "info"    ? "selected" : ""}>${INFO_RESPONSE_LABEL}</option>
        </select>
      </label>

      <div data-checklist-editor-anchor></div>

      ${catUI}

      <div class="grid gap-1 objective-select">
        <span class="text-sm text-[var(--muted)]">📌 Associer à un objectif</span>
        <select id="objective-select" class="w-full objective-select__input">
          <option value="">Aucun</option>
          ${objectifsOptions}
        </select>
        <div class="objective-select__meta" data-objective-meta>${objectiveMetaInitial}</div>
      </div>

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
  const addChecklistRow = (initialText = "") => {
    if (!checklistList) return null;
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
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
    row.append(input, removeBtn);
    checklistList.appendChild(row);
    renderChecklistEmptyState();
    return row;
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
  if (initialChecklistItems.length) {
    initialChecklistItems.forEach((item) => addChecklistRow(item));
  }
  const ensureChecklistHasRow = () => {
    if (!checklistMounted || !checklistList) return;
    if (!checklistList.querySelector('[name="checklist-item"]')) {
      addChecklistRow();
    }
  };
  const syncChecklistVisibility = () => {
    const isChecklist = typeSelectEl?.value === 'checklist';
    if (!isChecklist) {
      if (checklistList) {
        checklistList.innerHTML = '';
      }
      unmountChecklistEditor();
      return;
    }
    mountChecklistEditor();
    ensureChecklistHasRow();
    renderChecklistEmptyState();
  };
  if (typeSelectEl) {
    typeSelectEl.addEventListener('change', () => {
      syncChecklistVisibility();
    });
  }
  syncChecklistVisibility();
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
            <option value="checklist" ${item.type === "checklist" ? "selected" : ""}>Checklist</option>
            <option value="info" ${item.type === "info" ? "selected" : ""}>${INFO_RESPONSE_LABEL}</option>
          </select>
        </div>
        <div class="subconsigne-row__actions">
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
      const addSubChecklistRow = (initialText = "") => {
        if (!subChecklistList) return null;
        const itemRow = document.createElement('div');
        itemRow.className = 'flex items-center gap-2';
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
        itemRow.append(input, removeBtn);
        subChecklistList.appendChild(itemRow);
        renderSubChecklistEmptyState();
        return itemRow;
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
      if (initialSubChecklistItems.length) {
        initialSubChecklistItems.forEach((value) => addSubChecklistRow(value));
      }
      const syncSubChecklistVisibility = () => {
        const isChecklist = typeSelect?.value === 'checklist';
        if (!isChecklist) {
          if (subChecklistList) {
            subChecklistList.innerHTML = '';
          }
          setSubChecklistVisibility(false);
          renderSubChecklistEmptyState();
          return;
        }
        setSubChecklistVisibility(true);
        ensureSubChecklistHasRow();
        renderSubChecklistEmptyState();
      };
      if (typeSelect) {
        typeSelect.addEventListener('change', () => {
          syncSubChecklistVisibility();
        });
      }
      syncSubChecklistVisibility();
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
      });
      return row;
    };
    if (list) {
      list.innerHTML = "";
      childConsignes.forEach((item) => {
        const row = makeRow(item);
        list.appendChild(row);
      });
      renderEmpty();
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

      const payload = {
        ownerUid: ctx.user.uid,
        mode,
        text: fd.get("text").trim(),
        type: fd.get("type"),
        category: cat,
        priority: Number(fd.get("priority") || 2),
        srEnabled: fd.get("srEnabled") !== null,
        ephemeral: ephemeralEnabled,
        ephemeralDurationDays,
        ephemeralDurationIterations,
        active: true,
        parentId: consigne?.parentId || null,
      };
      if (payload.type === "checklist") {
        const itemInputs = Array.from(m.querySelectorAll('[name="checklist-item"]'));
        const items = itemInputs.map((input) => input.value.trim());
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
        payload.checklistItems = items;
      } else {
        payload.checklistItems = [];
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
        ephemeral: payload.ephemeral,
        ephemeralDurationDays: payload.ephemeralDurationDays,
        ephemeralDurationIterations: payload.ephemeralDurationIterations,
        parentId: payload.parentId || null,
        objectiveId: selectedObjective || null,
      };
      if (subRows.length) {
        historySnapshot.childrenCount = subRows.length;
      }
      const historyMetadata = {
        objectiveId: selectedObjective || null,
        hasChildren: subRows.length > 0,
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
            ephemeral: payload.ephemeral,
            ephemeralDurationDays: payload.ephemeralDurationDays,
            ephemeralDurationIterations: payload.ephemeralDurationIterations,
            active: true,
            parentId: consigneId,
          };
          const childDays = mode === "daily" ? payload.days || [] : undefined;
          const updates = [];
          if (subRows.length) {
            subRows.forEach((row) => {
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
              };
              if (mode === "daily") {
                childPayload.days = Array.isArray(childDays) ? [...childDays] : [];
              }
              if (typeValue === 'checklist') {
                const checklistInputs = Array.from(row.querySelectorAll('input[name="sub-checklist-item"]'));
                childPayload.checklistItems = checklistInputs.map((input) => input.value.trim());
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

function dotColor(type, v){
  if (v && typeof v === "object" && v.skipped) {
    return "note";
  }
  if (type === "info") {
    return hasTextualNote(v) ? "note" : "na";
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
  return null;
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
  let status = dotColor(consigne.type, valueForStatus);
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
  if (live) {
    const textualNote = extractTextualNote(valueForStatus);
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
        const fallback = formatConsigneValue(consigne.type, valueForStatus);
        if (fallback === null || fallback === undefined || fallback === "" || fallback === "—") {
          return skipFlag ? "Passée" : "Réponse enregistrée";
        }
        return fallback;
      }
      if (consigne.type === "info") return INFO_RESPONSE_LABEL;
      if (!hasValue) return "Sans donnée";
      const result = formatConsigneValue(consigne.type, valueForStatus);
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
      detail: { status, consigne, value: rawValue },
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
    if (hidden) {
      const isDirty = hidden.dataset && hidden.dataset.dirty === "1";
      if (!isDirty) {
        return null;
      }
      try {
        const parsed = JSON.parse(hidden.value || "[]");
        return buildChecklistValue(consigne, parsed);
      } catch (error) {
        console.warn("readConsigneCurrentValue:checklist", error);
      }
    }
    const container = scope.querySelector(
      `[data-checklist-root][data-consigne-id="${String(id ?? "")}"]`
    );
    if (container) {
      const boxes = Array.from(container.querySelectorAll("[data-checklist-input]"));
      if (boxes.length) {
        const isDirty = container.dataset && container.dataset.checklistDirty === "1";
        const hasChecked = boxes.some((box) => Boolean(box.checked));
        if (!isDirty && !hasChecked) {
          return null;
        }
        return buildChecklistValue(consigne, boxes.map((box) => Boolean(box.checked)));
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

function findConsigneInputFields(row, consigne) {
  if (!row || !consigne) return [];
  const holder = row.querySelector("[data-consigne-input-holder]");
  if (!holder) return [];
  return Array.from(holder.querySelectorAll(`[name$=":${consigne.id}"]`));
}

function createHiddenConsigneRow(consigne, { initialValue = null } = {}) {
  const row = document.createElement("div");
  row.className = "consigne-row consigne-row--child consigne-row--virtual";
  row.dataset.id = consigne?.id || "";
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
  return row;
}

function setConsigneRowValue(row, consigne, value) {
  if (row) {
    delete row.dataset.skipAnswered;
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
    const boxes = Array.from(container.querySelectorAll("[data-checklist-input]"));
    const normalizedValue =
      value === null || value === undefined
        ? null
        : buildChecklistValue(consigne, value, value && typeof value === "object" ? value : null);
    const states = normalizedValue ? readChecklistStates(normalizedValue) : [];
    boxes.forEach((box, index) => {
      box.checked = Boolean(states[index]);
    });
    const hidden = container.querySelector(`[name="checklist:${String(consigne.id ?? "")}"]`);
    if (hidden) {
      const serialized = JSON.stringify(boxes.map((box) => Boolean(box.checked)));
      hidden.value = serialized;
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
    return;
  }
  const fields = findConsigneInputFields(row, consigne);
  if (!fields.length) {
    updateConsigneStatusUI(row, consigne, value);
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
  const CENTER_MODAL_TYPES = new Set(["likert6", "likert5", "yesno", "num", "checklist", "info", "likert", "oui_non", "scale_0_10", "choix", "multiple"]);
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
    const primaryActionsMarkup = requiresValidation
      ? `<div class="practice-editor__actions-buttons">
          <button type="button" class="btn btn-ghost" data-consigne-editor-cancel>Annuler</button>
          <button type="button" class="btn btn-ghost" data-consigne-editor-skip>Passer →</button>
          <button type="button" class="btn btn-primary" data-consigne-editor-validate>${escapeHtml(validateButtonLabel)}</button>
        </div>`
      : `<div class="practice-editor__actions-buttons">
          <button type="button" class="btn" data-consigne-editor-cancel>Fermer</button>
        </div>`;
    const actionsMarkup = `<footer class="practice-editor__actions">
        ${summaryControlMarkup}
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
    overlay.querySelectorAll("textarea").forEach((textarea) => {
      autoGrowTextarea(textarea);
    });
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
      childConsignes.forEach((childState) => {
        const childValue = readConsigneCurrentValue(childState.consigne, overlay);
        if (childState.row) {
          setConsigneRowValue(childState.row, childState.consigne, childValue);
        }
        childValueEntries.push([childState.consigne?.id, childValue]);
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
      if (close) {
        closeOverlay();
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
        row.dataset.skipAnswered = "1";
        clearConsigneSummaryMetadata(row);
        updateParentChildAnsweredFlag();
        updateConsigneStatusUI(row, consigne, { skipped: true });
        syncParentAnswered();
        updateSummaryControlState();
        if (typeof options.onSkip === "function") {
          options.onSkip({ event, close: closeOverlay, consigne, row });
        }
        closeOverlay();
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
  const states = readChecklistStates(value);
  if (states.length > 0) {
    return true;
  }
  if (row instanceof HTMLElement) {
    const hidden = row.querySelector(`[name="checklist:${consigne.id}"]`);
    if (hidden && hidden.dataset.dirty === "1") {
      return true;
    }
    const container = row.querySelector(
      `[data-checklist-root][data-consigne-id="${String(consigne.id ?? "")}"]`
    );
    if (container && container.dataset.checklistDirty === "1") {
      return true;
    }
  }
  return false;
}

function hasValueForConsigne(consigne, value) {
  const type = consigne?.type;
  if (type === "long") {
    return richTextHasContent(value);
  }
  if (type === "short") {
    return typeof value === "string" && value.trim().length > 0;
  }
  if (type === "checklist") {
    const states = readChecklistStates(value);
    return states.length > 0;
  }
  if (type === "num") {
    if (value === null || value === undefined || value === "") return false;
    const num = Number(value);
    return Number.isFinite(num);
  }
  return !(value === null || value === undefined || value === "");
}

function bindConsigneRowValue(row, consigne, { onChange, initialValue } = {}) {
  if (!row || !consigne) return;
  const mapValueForStatus = (value) => {
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
          }
          const hasBilanFlag = Boolean(entry.isBilan) || normalizedScope.includes("bilan");
          const hasSummaryFlag =
            Boolean(entry.isSummary) ||
            Boolean(summaryScope) ||
            hasBilanFlag ||
            normalizedScope.includes("summary") ||
            normalizedScope.includes("yearly") ||
            normalizedScope.includes("annuel");
          return {
            date: new Date(entry.date),
            value: Number(entry.value),
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

  const values = sorted.map((entry) => entry.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
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

  const xAxisLabels = coords
    .map((point) => {
      const label = point.axisLabel;
      if (!label) return "";
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

function historyRowIdentity(row) {
  if (!row || typeof row !== "object") {
    return "";
  }
  if (row.id) {
    return `id:${row.id}`;
  }
  const rawDate = row.createdAt?.toDate?.() ?? row.createdAt ?? row.updatedAt ?? null;
  let iso = "";
  if (rawDate instanceof Date) {
    if (!Number.isNaN(rawDate.getTime())) {
      iso = rawDate.toISOString();
    }
  } else if (typeof rawDate === "string" || typeof rawDate === "number") {
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) {
      iso = parsed.toISOString();
    }
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
    pending.sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      return bTime - aTime;
    });
    store.set(consigneId, pending.slice(0, 10));
  } else {
    store.delete(consigneId);
  }
  merged.sort((a, b) => {
    const aRaw = a.createdAt?.toDate?.() ?? a.createdAt ?? a.updatedAt ?? null;
    const bRaw = b.createdAt?.toDate?.() ?? b.createdAt ?? b.updatedAt ?? null;
    const aTime = aRaw instanceof Date ? aRaw.getTime() : new Date(aRaw || 0).getTime();
    const bTime = bRaw instanceof Date ? bRaw.getTime() : new Date(bRaw || 0).getTime();
    return bTime - aTime;
  });
  return merged;
}

async function openHistory(ctx, consigne, options = {}) {
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

  const missingFirestoreFns = ["collection", "where", "orderBy", "limit", "query", "getDocs"].filter(
    (fn) => typeof modesFirestore?.[fn] !== "function"
  );
  if (!ctx?.db || missingFirestoreFns.length) {
    modesLogger.warn("ui.history.firestore.missing", {
      hasDb: Boolean(ctx?.db),
      missing: missingFirestoreFns,
    });
    showToast("Historique indisponible : connexion aux données manquante.");
    modesLogger.groupEnd();
    return null;
  }

  let ss;
  try {
    const qy = modesFirestore.query(
      modesFirestore.collection(ctx.db, "u", uid, "responses"),
      modesFirestore.where("consigneId", "==", consigneId),
      modesFirestore.orderBy("createdAt", "desc"),
      modesFirestore.limit(60)
    );
    ss = await modesFirestore.getDocs(qy);
  } catch (error) {
    modesLogger.warn("ui.history.firestore.error", error);
    showToast("Impossible de charger l’historique pour le moment.");
    modesLogger.groupEnd();
    return null;
  }

  const docs = Array.isArray(ss?.docs) ? ss.docs : [];
  const size = typeof ss?.size === "number" ? ss.size : docs.length;
  modesLogger.info("ui.history.rows", size);
  let rows = docs.map((d) => ({ id: d.id, ...d.data() }));
  rows = mergeRowsWithRecent(rows, consigneId);

  const DAILY_MODE_KEYS = new Set(["daily"]);

  function normalizeMode(row) {
    const candidates = [row?.mode, row?.source, row?.origin, row?.context];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim().toLowerCase();
      }
    }
    return "";
  }

  function parseDateForDaily(value) {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
    }
    if (typeof value.toDate === "function") {
      try {
        const parsed = value.toDate();
        return Number.isNaN(parsed?.getTime?.()) ? null : parsed;
      } catch (error) {
        modesLogger.warn("ui.history.daily.parse", error);
      }
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function resolveDayKey(row, createdAt) {
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
      return Schema?.dayKeyFromDate ? Schema.dayKeyFromDate(rawDay) : "";
    }
    if (typeof rawDay === "number" && Number.isFinite(rawDay)) {
      const fromNumber = new Date(rawDay);
      if (!Number.isNaN(fromNumber.getTime())) {
        return Schema?.dayKeyFromDate ? Schema.dayKeyFromDate(fromNumber) : "";
      }
    }
    if (createdAt instanceof Date && Schema?.dayKeyFromDate) {
      return Schema.dayKeyFromDate(createdAt);
    }
    return "";
  }

  const seenDailyDayKeys = new Set();
  rows = rows.filter((row) => {
    const modeKey = normalizeMode(row);
    if (!DAILY_MODE_KEYS.has(modeKey)) {
      return true;
    }
    const createdAtSource = row?.createdAt ?? row?.updatedAt ?? null;
    const createdAt = parseDateForDaily(createdAtSource);
    const dayKey = resolveDayKey(row, createdAt);
    if (!dayKey) {
      return true;
    }
    if (seenDailyDayKeys.has(dayKey)) {
      return false;
    }
    seenDailyDayKeys.add(dayKey);
    return true;
  });

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

  function detectSummaryNote(row) {
    if (!row || typeof row !== "object") {
      return { isSummary: false, scope: "", isBilan: false };
    }
    const normalizedStrings = [];
    const pushString = (value) => {
      if (typeof value === "string" && value.trim()) {
        normalizedStrings.push(value.trim().toLowerCase());
      }
    };
    pushString(row.summaryScope);
    pushString(row.summary_scope);
    pushString(row.summaryKey);
    pushString(row.summary_key);
    pushString(row.summaryLabel);
    pushString(row.summary_label);
    pushString(row.summaryMode);
    pushString(row.summary_mode);
    pushString(row.summaryPeriod);
    pushString(row.summary_period);
    pushString(row.period);
    pushString(row.periodLabel);
    pushString(row.period_label);
    pushString(row.periodKey);
    pushString(row.period_key);
    pushString(row.periodScope);
    pushString(row.period_scope);
    pushString(row.mode);
    pushString(row.source);
    pushString(row.origin);
    pushString(row.context);
    pushString(row.moduleId);
    pushString(row.module_id);
    if (typeof row.key === "string") {
      pushString(row.key);
    }
    const hasSummaryObject =
      Object.prototype.hasOwnProperty.call(row, "summary") &&
      row.summary &&
      typeof row.summary === "object";
    if (hasSummaryObject) {
      pushString(row.summary.scope);
      pushString(row.summary.type);
      pushString(row.summary.mode);
      pushString(row.summary.label);
    }
    const hasSummaryField =
      Object.prototype.hasOwnProperty.call(row, "summaryScope") ||
      Object.prototype.hasOwnProperty.call(row, "summary_scope") ||
      Object.prototype.hasOwnProperty.call(row, "summaryKey") ||
      Object.prototype.hasOwnProperty.call(row, "summary_key") ||
      Object.prototype.hasOwnProperty.call(row, "summaryLabel") ||
      Object.prototype.hasOwnProperty.call(row, "summary_label") ||
      Object.prototype.hasOwnProperty.call(row, "summaryMode") ||
      Object.prototype.hasOwnProperty.call(row, "summary_mode") ||
      Object.prototype.hasOwnProperty.call(row, "summaryPeriod") ||
      Object.prototype.hasOwnProperty.call(row, "summary_period") ||
      hasSummaryObject;
    const hasBilanMarker = normalizedStrings.some((value) => value.includes("bilan"));
    const hasSummaryKeyword =
      normalizedStrings.some((value) => value.includes("summary")) || hasBilanMarker;
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
    return {
      isSummary: hasSummaryField || hasSummaryKeyword || Boolean(scope),
      scope,
      isBilan: hasBilanMarker || hasWeeklyMarker || hasMonthlyMarker || hasYearlyMarker,
    };
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

  const EDITABLE_HISTORY_TYPES = new Set(["short", "long", "num", "likert5", "likert6", "yesno"]);

  const list = rows
    .map((r, index) => {
      const createdAtSource = r.createdAt?.toDate?.() ?? r.createdAt ?? r.updatedAt ?? null;
      let createdAt = createdAtSource ? new Date(createdAtSource) : null;
      if (createdAt && Number.isNaN(createdAt.getTime())) {
        createdAt = null;
      }
      const dayKey = resolveDayKey(r, createdAt);
      const dayDate = dayKey ? modesParseDayKeyToDate(dayKey) : null;
      const displayDate = dayDate || createdAt;
      const iso = displayDate && !Number.isNaN(displayDate.getTime()) ? displayDate.toISOString() : "";
      const dateText = displayDate && !Number.isNaN(displayDate.getTime())
        ? formatDisplayDate(displayDate, { preferDayView: Boolean(dayDate) })
        : "Date inconnue";
      const relative = displayDate ? relativeLabel(displayDate) : "";
      const formattedText = formatConsigneValue(consigne.type, r.value);
      const formattedHtml = formatConsigneValue(consigne.type, r.value, { mode: "html" });
      const status = dotColor(consigne.type, r.value) || "na";
      const numericValue = numericPoint(consigne.type, r.value);
      const note = r.note && String(r.note).trim();
      const summaryInfo = detectSummaryNote(r);
      const summaryLabel = summaryInfo.isSummary
        ? summaryInfo.scope === "monthly"
          ? "Bilan mensuel"
          : summaryInfo.scope === "weekly"
          ? "Bilan hebdomadaire"
          : summaryInfo.scope === "yearly"
          ? "Bilan annuel"
          : "Bilan"
        : "";
      const summaryNoteLabel = summaryInfo.isSummary
        ? summaryInfo.scope === "monthly"
          ? "Note de bilan mensuel"
          : summaryInfo.scope === "weekly"
          ? "Note de bilan hebdomadaire"
          : summaryInfo.scope === "yearly"
          ? "Note de bilan annuel"
          : "Note de bilan"
        : "";
      const noteClasses = ["history-panel__note"];
      let noteDataAttrs = "";
      let noteBadgeMarkup = "";
      if (note && summaryInfo.isSummary) {
        noteClasses.push("history-panel__note--bilan");
        const scopeLabel = summaryNoteLabel || "Note de bilan";
        noteBadgeMarkup = `<span class="history-panel__note-badge">${escapeHtml(scopeLabel)}</span>`;
        const scopeAttr = summaryInfo.scope
          ? ` data-note-scope="${escapeHtml(summaryInfo.scope)}"`
          : "";
        noteDataAttrs = ` data-note-source="bilan"${scopeAttr}`;
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
      if (displayDate && numericValue !== null && !Number.isNaN(numericValue)) {
        chartPoints.push({
          date: displayDate,
          value: Number(numericValue),
          isSummary: Boolean(summaryInfo.isSummary),
          summaryScope: summaryInfo.scope || "",
          isBilan: Boolean(summaryInfo.isBilan),
          recordedAt: createdAt instanceof Date && !Number.isNaN(createdAt?.getTime?.()) ? createdAt : null,
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
      const summaryMarker = summaryLabel
        ? `<span class="history-panel__summary-marker" title="${escapeHtml(summaryLabel)}" aria-hidden="true"></span>`
        : "";
      const valueClasses = ["history-panel__value"];
      if (summaryInfo.isSummary) {
        valueClasses.push("history-panel__value--summary");
      }
      let recordedMetaLabel = "";
      if (dayDate && createdAt && !Number.isNaN(createdAt.getTime())) {
        const sameDay =
          createdAt.getFullYear() === dayDate.getFullYear() &&
          createdAt.getMonth() === dayDate.getMonth() &&
          createdAt.getDate() === dayDate.getDate();
        if (!sameDay) {
          recordedMetaLabel = formatDisplayDate(createdAt, { preferDayView: false });
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
      const responseIdAttr = r.id ? ` data-response-id="${escapeHtml(String(r.id))}"` : "";
      const canEditEntry = EDITABLE_HISTORY_TYPES.has(consigne.type) && !summaryInfo.isSummary && dayKey;
      const editButtonMarkup = canEditEntry
        ? `<button type="button" class="history-panel__item-edit" data-history-edit aria-label="Modifier la réponse">Modifier</button>`
        : "";
      return `
        <li class="history-panel__item${summaryClass}${bilanClass}" data-history-entry data-history-index="${index}" data-priority-tone="${escapeHtml(priorityToneValue)}" data-status="${escapeHtml(status)}"${summaryAttr}${dayKeyAttr}${responseIdAttr}${bilanAttr}>
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

  const openEntryEditor = (entryIndex, itemNode) => {
    if (!EDITABLE_HISTORY_TYPES.has(consigne.type)) {
      showToast("Modification non disponible pour ce type de consigne.");
      return;
    }
    const row = rows[entryIndex];
    if (!row) return;
    const dayKeyAttr = itemNode?.getAttribute('data-day-key');
    const responseIdAttr = itemNode?.getAttribute('data-response-id');
    const dayKey = dayKeyAttr && dayKeyAttr.trim() ? dayKeyAttr.trim() : resolveDayKey(row, null);
    if (!dayKey) {
      showToast("Impossible d’identifier la date de cette réponse.");
      return;
    }
    const createdAtSource = row.createdAt?.toDate?.() ?? row.createdAt ?? row.updatedAt ?? null;
    let createdAt = createdAtSource ? new Date(createdAtSource) : null;
    if (createdAt && Number.isNaN(createdAt.getTime())) {
      createdAt = null;
    }
    const dayDate = dayKey ? modesParseDayKeyToDate(dayKey) : null;
    const displayDate = dayDate || createdAt;
    const dateLabel = displayDate && !Number.isNaN(displayDate.getTime())
      ? formatDisplayDate(displayDate, { preferDayView: Boolean(dayDate) })
      : dayKey || 'Date inconnue';
    const relative = displayDate ? relativeLabel(displayDate) : '';
    const noteValue = row.note ? String(row.note) : '';
    const fieldId = `history-edit-value-${consigne.id}-${entryIndex}-${Date.now()}`;
    const valueField = renderConsigneValueField(consigne, row.value, fieldId);
    const autosaveKey = [`history-entry`, ctx.user?.uid || 'anon', consigne.id || 'consigne', dayKey]
      .map((part) => String(part || ''))
      .join(':');
    const responseSyncOptions = {
      responseId: responseIdAttr && responseIdAttr.trim() ? responseIdAttr.trim() : row.id || '',
      responseMode: normalizeMode(row) || row.mode || row.source || '',
      responseType: typeof row.type === 'string' && row.type.trim() ? row.type.trim() : consigne.type,
      responseDayKey: dayKey,
      responseCreatedAt:
        createdAt instanceof Date && !Number.isNaN(createdAt.getTime())
          ? createdAt.toISOString()
          : typeof createdAtSource === 'string'
          ? createdAtSource
          : '',
    };
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
          <label class="practice-editor__label" for="${fieldId}">Valeur</label>
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
          await Schema.deleteHistoryEntry(ctx.db, ctx.user.uid, consigne.id, dayKey, responseSyncOptions);
          closeEditor();
          reopenHistory();
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
        if (isRawEmpty && !note) {
          await Schema.deleteHistoryEntry(ctx.db, ctx.user.uid, consigne.id, dayKey, responseSyncOptions);
        } else {
          await Schema.saveHistoryEntry(
            ctx.db,
            ctx.user.uid,
            consigne.id,
            dayKey,
            {
              value: rawValue,
              note,
            },
            responseSyncOptions
          );
        }
        closeEditor();
        reopenHistory();
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
      openEntryEditor(entryIndex, itemNode);
    });
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

  const card = document.createElement("section");
  card.className = "card space-y-4 p-3 sm:p-4";
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
      const practiceConsignes = orderSorted.slice();
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
  const consignes = all.filter((c) => (c.category || "") === currentCat);
  modesLogger.info("screen.practice.consignes", consignes.length);

  const orderSorted = consignes.slice().sort((a, b) => {
    const orderA = Number(a.order || 0);
    const orderB = Number(b.order || 0);
    if (orderA !== orderB) return orderA - orderB;
    const prioA = Number(a.priority || 0);
    const prioB = Number(b.priority || 0);
    if (prioA !== prioB) return prioA - prioB;
    return (a.text || a.titre || "").localeCompare(b.text || b.titre || "");
  });

  const sessionIndex = await Schema.countPracticeSessions(ctx.db, ctx.user.uid);
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
  if (!visibleConsignes.length) {
    form.innerHTML = `<div class="rounded-xl border border-dashed border-gray-200 bg-white p-3 text-sm text-[var(--muted)]">Aucune consigne visible pour cette itération.</div>`;
  } else {
    form.innerHTML = "";

    const makeItem = (c, { isChild = false, deferEditor = false, editorOptions = null } = {}) => {
      const tone = priorityTone(c.priority);
      const row = document.createElement("div");
      row.className = `consigne-row priority-surface priority-surface-${tone}`;
      row.dataset.id = c.id;
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
              <span class="consigne-row__dot consigne-row__dot--na" data-status-dot aria-hidden="true"></span>
              <span class="consigne-row__mark" data-status-mark aria-hidden="true"></span>
              <span class="sr-only" data-status-live aria-live="polite"></span>
            </span>
            ${consigneActions()}
          </div>
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
      const holder = row.querySelector("[data-consigne-input-holder]");
      if (holder) {
        holder.innerHTML = inputForType(c);
        enhanceRangeMeters(holder);
      }
      const bH = row.querySelector(".js-histo");
      const bE = row.querySelector(".js-edit");
      const bD = row.querySelector(".js-del");
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
            await Schema.delayConsigne({
              db: ctx.db,
              uid: ctx.user.uid,
              consigne: c,
              mode: "practice",
              amount,
              sessionIndex,
            });
            showToast(`Consigne décalée de ${amount} itération${amount > 1 ? "s" : ""}.`);
            renderPractice(ctx, root);
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
      }));
      const editorConfig = { variant: "modal", ...(editorOptions || {}) };
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
    const box = document.createElement("div");
    box.className = "card p-3 space-y-2";
    box.innerHTML = `<div class="font-medium">Masquées par répétition espacée (${hidden.length})</div>
  <ul class="text-sm text-[var(--muted)] space-y-1">
    ${hidden.map(h => `
      <li class="flex items-center justify-between gap-2">
        <span><span class="font-medium text-slate-600">${escapeHtml(h.c.text)}</span> — revient dans ${h.remaining} itération(s)</span>
        <span class="flex items-center gap-1">
          <button type="button" class="btn btn-ghost text-xs js-histo-hidden" data-id="${h.c.id}">Historique</button>
          <button type="button" class="btn btn-ghost text-xs js-reset-sr" data-id="${h.c.id}">Réinitialiser</button>
        </span>
      </li>`).join("")}
  </ul>`;
    container.appendChild(box);

    box.addEventListener("click", async (e) => {
      const id = e.target?.dataset?.id;
      if (!id) return;
      if (e.target.classList.contains("js-histo-hidden")) {
        const c = hidden.find((x) => x.c.id === id)?.c;
        if (c) openHistory(ctx, c, { source: "practice" });
      } else if (e.target.classList.contains("js-reset-sr")) {
        await Schema.resetSRForConsigne(ctx.db, ctx.user.uid, id);
        renderPractice(ctx, root);
      }
    });
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
};
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
  return {
    weekEndsOn,
    monthlyEnabled,
    weeklyReminderEnabled,
    monthlyReminderEnabled,
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
  return null;
}
function computeNextEntry(entry) {
  if (!entry) return null;
  if (entry.type === DAILY_ENTRY_TYPES.DAY) {
    const nextDate = new Date(entry.date.getTime());
    nextDate.setDate(nextDate.getDate() + 1);
    return createDayEntry(nextDate);
  }
  return null;
}
function computePrevEntry(entry) {
  if (!entry) return null;
  if (entry.type === DAILY_ENTRY_TYPES.DAY) {
    const prevDate = new Date(entry.date.getTime());
    prevDate.setDate(prevDate.getDate() - 1);
    return createDayEntry(prevDate);
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
  } else if (entry?.type === DAILY_ENTRY_TYPES.WEEKLY || entry?.type === DAILY_ENTRY_TYPES.MONTHLY) {
    params.set("view", entry.type === DAILY_ENTRY_TYPES.WEEKLY ? "week" : "month");
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

  let entry = null;
  let selectedDate = null;
  let currentDay = null;

  if (explicitDate) {
    selectedDate = new Date(explicitDate.getTime());
    entry = createDayEntry(selectedDate);
    currentDay = entry?.dayCode || null;
  } else if (requestedDay) {
    selectedDate = dateForDayFromToday(requestedDay);
    selectedDate.setHours(0, 0, 0, 0);
    entry = createDayEntry(selectedDate);
    currentDay = requestedDay;
  } else {
    selectedDate = toStartOfDay(new Date());
    entry = createDayEntry(selectedDate);
    currentDay = entry?.dayCode || null;
  }

  if (!entry) {
    selectedDate = toStartOfDay(new Date());
    entry = createDayEntry(selectedDate);
    currentDay = entry?.dayCode || null;
  }

  const navLabel = entry?.navLabel || (selectedDate ? formatDailyNavLabel(selectedDate) : "Journalier");
  const navSubtitle = entry?.navSubtitle || "";
  const isDayEntry = entry?.type === DAILY_ENTRY_TYPES.DAY;
  const selectedKey = isDayEntry && selectedDate && typeof Schema?.dayKeyFromDate === "function"
    ? Schema.dayKeyFromDate(selectedDate)
    : null;
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

  const all = await Schema.fetchConsignes(ctx.db, ctx.user.uid, "daily");
  const consignes = all.filter((c) => !c.days?.length || c.days.includes(currentDay));
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
    if (type === "yesno" || type === "likert6" || type === "likert5" || type === "num") {
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
    Schema.saveResponses(ctx.db, ctx.user.uid, "daily", answers)
      .then(async () => {
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
    const hasContent = consigne.type === "checklist"
      ? hasChecklistResponse(consigne, row, value)
      : hasValueForConsigne(consigne, value);
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
        : serializeValueForComparison(consigne, value);
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
      } else if (typeof value === "object") {
        row.dataset.currentValue = computedBaseSerialized;
      } else {
        row.dataset.currentValue = String(value);
      }
    }
    scheduleAutoSave(consigne, value, {
      serialized: combinedSerialized,
      hasContent,
      summary: hasContent ? summaryMetadata : null,
    });
  };

  const renderItemCard = (item, { isChild = false, deferEditor = false, editorOptions = null } = {}) => {
    const previous = previousAnswers.get(item.id);
    const hasPrevValue = previous && Object.prototype.hasOwnProperty.call(previous, "value");
    const initialValue = hasPrevValue ? previous.value : null;
    const row = document.createElement("div");
    const tone = priorityTone(item.priority);
    row.className = `consigne-row priority-surface priority-surface-${tone}`;
    row.dataset.id = item.id;
    row.dataset.priorityTone = tone;
    if (isChild) {
      row.classList.add("consigne-row--child");
      if (item.parentId) {
        row.dataset.parentId = item.parentId;
      } else {
        delete row.dataset.parentId;
      }
    } else {
      row.classList.add("consigne-row--parent");
      delete row.dataset.parentId;
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
            <span class="consigne-row__dot consigne-row__dot--na" data-status-dot aria-hidden="true"></span>
            <span class="consigne-row__mark" data-status-mark aria-hidden="true"></span>
            <span class="sr-only" data-status-live aria-live="polite"></span>
          </span>
          ${consigneActions()}
        </div>
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
    const holder = row.querySelector("[data-consigne-input-holder]");
    if (holder) {
      holder.innerHTML = inputForType(item, previous?.value ?? null);
      enhanceRangeMeters(holder);
    }
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
        const baseSerialized = serializeValueForComparison(item, value);
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
        handleValueChange(item, row, value, {
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
      const hasPrevValue = previous && Object.prototype.hasOwnProperty.call(previous, "value");
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
          const baseSerialized = serializeValueForComparison(child, value);
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
          handleValueChange(child, childRow, value, {
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

  if (hidden.length) {
    const box = document.createElement("div");
    box.className = "card p-3 space-y-2";
    box.innerHTML = `<div class="font-medium">Masquées par répétition espacée (${hidden.length})</div>
  <ul class="text-sm text-[var(--muted)] space-y-1">
    ${hidden.map(h => `
      <li class="flex items-center justify-between gap-2">
        <span><span class="font-medium text-slate-600">${escapeHtml(h.c.text)}</span> — revient dans ${h.daysLeft} jour(s) (le ${h.when.toLocaleDateString()})</span>
        <span class="flex items-center gap-1">
          <button type="button" class="btn btn-ghost text-xs js-histo-hidden" data-id="${h.c.id}">Historique</button>
          <button type="button" class="btn btn-ghost text-xs js-reset-sr" data-id="${h.c.id}">Réinitialiser</button>
        </span>
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

Modes.openCategoryDashboard = window.openCategoryDashboard;
Modes.openConsigneForm = openConsigneForm;
Modes.openHistory = openHistory;
Modes.renderPractice = renderPractice;
Modes.renderDaily = renderDaily;
Modes.renderHistory = renderHistory;
Modes.attachConsignesDragDrop = window.attachConsignesDragDrop;
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
Modes.closeConsigneActionMenuFromNode = closeConsigneActionMenuFromNode;

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    readConsigneCurrentValue,
    dotColor,
    buildChecklistValue,
    sanitizeChecklistItems,
    readChecklistStates,
  };
}
