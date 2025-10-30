(function () {
  function getSelectionFor(rootEl) {
    const doc = rootEl?.ownerDocument || document;
    return doc.getSelection ? doc.getSelection() : window.getSelection();
  }

  function installChecklistEnterExit(rootEl) {
    if (!rootEl || rootEl.__checklistExitInstalled) return;
    rootEl.__checklistExitInstalled = true;

    rootEl.addEventListener(
      "beforeinput",
      (event) => {
        if (event.defaultPrevented) return;
        const selection = getSelectionFor(rootEl);
        if (!selection || !selection.isCollapsed) return;

        if (event.inputType === "insertParagraph") {
          const context = closestTaskContainer(selection.anchorNode, rootEl);
          if (!context) return;
          if (!isTaskEmpty(context.container)) return;

          event.preventDefault();
          exitEmptyTask(context);
        } else if (event.inputType === "deleteContentBackward") {
          const context = closestTaskContainer(selection.anchorNode, rootEl);
          if (!context) return;
          if (!isAtStartOfNode(selection, context.textHost)) return;
          if (!isTaskEmpty(context.container)) return;

          event.preventDefault();
          exitEmptyTask(context);
        }
      },
      { capture: true }
    );

    rootEl.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || event.isComposing) return;
      const selection = getSelectionFor(rootEl);
      if (!selection || !selection.isCollapsed) return;

      if (event.key === "Enter") {
        const context = closestTaskContainer(selection.anchorNode, rootEl);
        if (!context) return;
        if (!isTaskEmpty(context.container)) return;

        event.preventDefault();
        exitEmptyTask(context);
      } else if (event.key === "Backspace") {
        const context = closestTaskContainer(selection.anchorNode, rootEl);
        if (!context) return;
        if (!isAtStartOfNode(selection, context.textHost)) return;
        if (!isTaskEmpty(context.container)) return;

        event.preventDefault();
        exitEmptyTask(context);
      }
    });
  }

  function closestTaskContainer(node, stop) {
    let current = node;
    while (current && current !== stop) {
      if (current.nodeType === 1) {
        if (current.nodeName === "LI" && containsCheckbox(current)) {
          return {
            type: "list",
            container: current,
            list: current.parentElement,
            textHost: current,
          };
        }
        if (isBlockCheckboxHost(current)) {
          return {
            type: "block",
            container: current,
            list: null,
            textHost: current,
          };
        }
      }
      current = current.parentNode;
    }

    if (stop && current === stop && current.nodeType === 1 && containsCheckbox(current)) {
      if (current.nodeName === "LI") {
        return {
          type: "list",
          container: current,
          list: current.parentElement,
          textHost: current,
        };
      }
      if (isBlockCheckboxHost(current)) {
        return {
          type: "block",
          container: current,
          list: null,
          textHost: current,
        };
      }
    }

    return null;
  }

  function containsCheckbox(element) {
    return !!element.querySelector?.('input[type="checkbox"]');
  }

  function isBlockCheckboxHost(element) {
    if (!element || element.nodeType !== 1) return false;
    const name = element.nodeName;
    if (name !== "P" && name !== "DIV") return false;

    let child = element.firstChild;
    while (child) {
      if (child.nodeType === 1) {
        if (isCheckboxElement(child)) return true;
        if (isCheckboxWrapper(child) && containsCheckbox(child)) return true;
        break;
      }
      if (child.nodeType === 3 && child.textContent.trim().length > 0) {
        return false;
      }
      child = child.nextSibling;
    }
    return false;
  }

  function isCheckboxElement(node) {
    return !!(node && node.nodeType === 1 && node.tagName === "INPUT" && node.type === "checkbox");
  }

  function isCheckboxWrapper(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.classList?.contains("cb-wrap")) return true;
    return node.getAttribute?.("data-rich-checkbox-wrapper") === "1";
  }

  function isTaskEmpty(container) {
    if (!container) return false;
    const clone = container.cloneNode(true);
    clone.querySelectorAll('input[type="checkbox"], label, br, .cb-wrap, [data-rich-checkbox-wrapper="1"]').forEach((node) =>
      node.remove()
    );
    const text = (clone.textContent || "").replace(/\u200B/g, "").trim();
    return text.length === 0;
  }

  function isAtStartOfNode(selection, node) {
    if (!selection || selection.rangeCount === 0 || !node) return false;
    const range = selection.getRangeAt(0);
    if (!range.collapsed) return false;
    const doc = node.ownerDocument || document;
    const startRange = doc.createRange();
    startRange.selectNodeContents(node);
    startRange.collapse(true);
    return range.compareBoundaryPoints(Range.START_TO_START, startRange) === 0;
  }

  function exitEmptyTask(context) {
    if (!context || !context.container) return;
    const doc = context.container.ownerDocument || document;
    const paragraph = doc.createElement("p");
    paragraph.appendChild(doc.createElement("br"));

    if (context.type === "list" && context.list) {
      const list = context.list;
      const onlyItem = list.children.length === 1;

      if (onlyItem) {
        list.replaceWith(paragraph);
        placeCaret(paragraph);
        return;
      }

      const afterList = nextMeaningfulSibling(list);
      context.container.remove();
      if (afterList && afterList.nodeName === "P") {
        placeCaret(afterList);
        return;
      }
      list.insertAdjacentElement("afterend", paragraph);
      placeCaret(paragraph);
      return;
    }

    context.container.replaceWith(paragraph);
    placeCaret(paragraph);
  }

  function nextMeaningfulSibling(node) {
    let next = node?.nextSibling || null;
    while (next && next.nodeType === 3 && !next.textContent.trim()) {
      next = next.nextSibling;
    }
    return next;
  }

  function placeCaret(target) {
    if (!target) return;
    const doc = target.ownerDocument || document;
    const selection = doc.getSelection ? doc.getSelection() : window.getSelection();
    if (!selection) return;
    const range = doc.createRange();
    range.setStart(target, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  if (typeof window !== "undefined") {
    window.installChecklistEnterExit = installChecklistEnterExit;
  }
})();

(function () {
  const GLOBAL = typeof window !== "undefined" ? window : globalThis;
  const checklistLogger =
    typeof GLOBAL.Schema === "object" && GLOBAL.Schema && typeof GLOBAL.Schema.D === "object"
      ? GLOBAL.Schema.D
      : null;

  function logChecklistEvent(event, payload, level = "info") {
    const label = `checklist.${event}`;
    const loggerMethod =
      checklistLogger && typeof checklistLogger[level] === "function"
        ? checklistLogger[level].bind(checklistLogger)
        : null;
    const fallback =
      level === "warn"
        ? console.warn
        : level === "error"
        ? console.error
        : console.info;
    if (loggerMethod) {
      if (payload === undefined) {
        loggerMethod(label);
      } else {
        loggerMethod(label, payload);
      }
      return;
    }
    if (payload === undefined) {
      fallback.call(console, `[checklist] ${event}`);
    } else {
      fallback.call(console, `[checklist] ${event}`, payload);
    }
  }

  const DEFAULT_TIMEZONE = "Europe/Paris";

  function todayKey(date = new Date()) {
    const input = date instanceof Date ? new Date(date.getTime()) : new Date(date || Date.now());
    if (!(input instanceof Date) || Number.isNaN(input.getTime())) {
      return todayKey(new Date());
    }
    if (typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function") {
      try {
        const formatter = new Intl.DateTimeFormat("fr-FR", {
          timeZone: DEFAULT_TIMEZONE,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const parts = formatter.formatToParts(input);
        const lookup = { day: "", month: "", year: "" };
        parts.forEach((part) => {
          if (part && part.type && part.value && part.type in lookup) {
            lookup[part.type] = part.value;
          }
        });
        if (lookup.year && lookup.month && lookup.day) {
          return `${lookup.year}-${lookup.month}-${lookup.day}`;
        }
      } catch (error) {
        console.warn("[checklist-fix] todayKey", error);
      }
    }
    const year = input.getFullYear();
    const month = String(input.getMonth() + 1).padStart(2, "0");
    const day = String(input.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function resolveFirestoreDb() {
    const ctxDb = GLOBAL.AppCtx?.db;
    if (ctxDb && typeof ctxDb.collection === "function") {
      return ctxDb;
    }
    const firebase = GLOBAL.firebase;
    if (firebase && typeof firebase.firestore === "function") {
      try {
        return firebase.firestore();
      } catch (error) {
        console.warn("[checklist-fix] firestore", error);
      }
    }
    return null;
  }

  async function fallbackLoadAnswer(uid, consigneId, dateKey) {
    const db = resolveFirestoreDb();
    if (!db || !uid || !consigneId || !dateKey) {
      return null;
    }
    try {
      const ref = db
        .collection("u")
        .doc(uid)
        .collection("answers")
        .doc(dateKey)
        .collection("consignes")
        .doc(consigneId);
      const snap = await ref.get();
      if (!snap || !snap.exists) {
        logChecklistEvent("persist.load.empty", { consigneId, dateKey });
        return null;
      }
      const data = snap.data() || null;
      const selected = Array.isArray(data?.selectedIds) ? data.selectedIds.length : 0;
      logChecklistEvent("persist.load.fallback", { consigneId, dateKey, selected });
      return data;
    } catch (error) {
      console.warn("[checklist-fix] loadAnswer", error);
      logChecklistEvent("persist.load.error", { consigneId, dateKey, message: error?.message || String(error) }, "warn");
      return null;
    }
  }

  async function fallbackSaveAnswer(uid, consigneId, dateKey, payload = {}) {
    const db = resolveFirestoreDb();
    if (!db || !uid || !consigneId || !dateKey) {
      return null;
    }
    const selected = Array.isArray(payload.selectedIds)
      ? payload.selectedIds
      : Array.isArray(payload.selected)
      ? payload.selected
      : [];
    const skippedRaw = Array.isArray(payload.skippedIds)
      ? payload.skippedIds
      : Array.isArray(payload.skipped)
      ? payload.skipped
      : [];
    const skipped = [];
    skippedRaw.forEach((value) => {
      const str = String(value ?? "").trim();
      if (!str || skipped.includes(str)) {
        return;
      }
      skipped.push(str);
    });
    const data = {
      type: "checklist",
      selectedIds: selected,
      checked: selected,
      skippedIds: skipped,
      updatedAt: payload.updatedAt || Date.now(),
      dateKey,
    };
    try {
      const ref = db
        .collection("u")
        .doc(uid)
        .collection("answers")
        .doc(dateKey)
        .collection("consignes")
        .doc(consigneId);
      await ref.set(data, { merge: true });
      logChecklistEvent("persist.fallback", {
        consigneId,
        dateKey,
        selected: selected.length,
        skipped: skipped.length,
      });
      return data;
    } catch (error) {
      console.warn("[checklist-fix] saveAnswer", error);
      logChecklistEvent("persist.fallback.error", { consigneId, dateKey, message: error?.message || String(error) }, "warn");
      return null;
    }
  }

  function resolveConsigneId(root) {
    if (!(root instanceof Element)) {
      return "";
    }
    const attr = root.getAttribute("data-consigne-id");
    if (attr && String(attr).trim()) {
      return String(attr).trim();
    }
    if (root.dataset?.consigneId && String(root.dataset.consigneId).trim()) {
      return String(root.dataset.consigneId).trim();
    }
    const owner = root.closest("[data-consigne-id]");
    if (owner) {
      const ownerAttr = owner.getAttribute("data-consigne-id");
      if (ownerAttr && String(ownerAttr).trim()) {
        return String(ownerAttr).trim();
      }
      if (owner.dataset?.consigneId && String(owner.dataset.consigneId).trim()) {
        return String(owner.dataset.consigneId).trim();
      }
    }
    return "";
  }

  function collectInputs(root) {
    if (!(root instanceof Element)) {
      return [];
    }
    const selector = '[data-checklist-input], input[type="checkbox"]';
    return Array.from(root.querySelectorAll(selector)).filter((input) => input instanceof HTMLInputElement);
  }

  function applyKeyAttributes(input, host, itemKeyAttr, key, legacyKey) {
    const safeKey = key != null ? String(key) : null;
    const safeLegacy = legacyKey != null ? String(legacyKey) : null;
    if (safeKey && itemKeyAttr) {
      input.setAttribute(itemKeyAttr, safeKey);
    }
    if (safeKey) {
      input.setAttribute("data-key", safeKey);
      input.setAttribute("data-item-id", safeKey);
      if (input.dataset) {
        input.dataset.key = safeKey;
        input.dataset.itemId = safeKey;
      }
    }
    if (safeLegacy) {
      input.setAttribute("data-legacy-key", safeLegacy);
      if (input.dataset) {
        input.dataset.legacyKey = safeLegacy;
      }
    }
    if (host instanceof Element) {
      if (safeKey) {
        host.setAttribute("data-item-id", safeKey);
        host.setAttribute("data-checklist-key", safeKey);
        if (host.dataset) {
          host.dataset.itemId = safeKey;
          host.dataset.checklistKey = safeKey;
        }
      }
      if (safeLegacy) {
        host.setAttribute("data-checklist-legacy-key", safeLegacy);
        if (host.dataset) {
          host.dataset.checklistLegacyKey = safeLegacy;
        }
      }
    }
  }

  function resolveInputKey(input, host, options = {}) {
    const itemKeyAttr = options.itemKeyAttr || "data-key";
    const consigneId = options.consigneId || "";
    const index = Number.isFinite(options.index) ? Number(options.index) : null;
    const keyCandidates = [];
    const attrKey = itemKeyAttr ? input.getAttribute(itemKeyAttr) : null;
    if (attrKey) keyCandidates.push(String(attrKey));
    if (input.dataset?.key) keyCandidates.push(String(input.dataset.key));
    const explicitChecklistKey = input.getAttribute("data-checklist-key") || input.dataset?.checklistKey;
    if (explicitChecklistKey) keyCandidates.push(String(explicitChecklistKey));
    const explicitItemId = input.getAttribute("data-item-id") || input.dataset?.itemId;
    if (explicitItemId) keyCandidates.push(String(explicitItemId));
    if (host instanceof Element) {
      const hostKey = host.getAttribute("data-checklist-key") || host.dataset?.checklistKey;
      if (hostKey) keyCandidates.push(String(hostKey));
      const hostItem = host.getAttribute("data-item-id") || host.dataset?.itemId;
      if (hostItem) keyCandidates.push(String(hostItem));
    }
    const resolved = keyCandidates.find((value) => String(value).trim().length > 0);
    if (resolved && String(resolved).trim()) {
      return String(resolved).trim();
    }
    if (index != null) {
      const fallback = consigneId ? `${consigneId}:${index}` : String(index);
      return fallback;
    }
    return consigneId ? `${consigneId}:${Date.now()}` : String(Date.now());
  }

  function resolveLegacyKey(input, host, options = {}) {
    const consigneId = options.consigneId || "";
    const index = Number.isFinite(options.index) ? Number(options.index) : null;
    const candidates = [];
    const attr = input.getAttribute("data-legacy-key");
    if (attr) candidates.push(String(attr));
    if (input.dataset?.legacyKey) candidates.push(String(input.dataset.legacyKey));
    if (host instanceof Element) {
      const hostLegacy = host.getAttribute("data-checklist-legacy-key") || host.dataset?.checklistLegacyKey;
      if (hostLegacy) candidates.push(String(hostLegacy));
    }
    const resolved = candidates.find((value) => String(value).trim().length > 0);
    if (resolved && String(resolved).trim()) {
      return String(resolved).trim();
    }
    if (index != null) {
      const fallback = consigneId ? `${consigneId}:${index}` : String(index);
      return fallback;
    }
    return consigneId ? `${consigneId}:${Date.now()}` : String(Date.now());
  }

  function collectSelectedKeys(root, itemKeyAttr) {
    if (!(root instanceof Element)) {
      return [];
    }
    const consigneId = resolveConsigneId(root);
    const inputs = collectInputs(root);
    return inputs
      .map((input, index) => {
        const host = input.closest("[data-checklist-item]");
        const key = resolveInputKey(input, host, { itemKeyAttr, consigneId, index });
        const legacy = resolveLegacyKey(input, host, { consigneId, index });
        applyKeyAttributes(input, host, itemKeyAttr, key, legacy);
        if (!input.checked) {
          return null;
        }
        return key ? String(key) : null;
      })
      .filter(Boolean);
  }

  function collectSkippedKeys(root, itemKeyAttr) {
    if (!(root instanceof Element)) {
      return [];
    }
    const consigneId = resolveConsigneId(root);
    const inputs = collectInputs(root);
    return inputs
      .map((input, index) => {
        const host = input.closest("[data-checklist-item]");
        const key = resolveInputKey(input, host, { itemKeyAttr, consigneId, index });
        const legacy = resolveLegacyKey(input, host, { consigneId, index });
        applyKeyAttributes(input, host, itemKeyAttr, key, legacy);
        const skipDataset = input.dataset?.[SKIP_DATA_KEY] === "1";
        const skipHost = host?.dataset?.checklistSkipped === "1";
        if (!skipDataset && !skipHost) {
          return null;
        }
        return key ? String(key) : null;
      })
      .filter(Boolean);
  }

  function applySelectedKeys(root, itemKeyAttr, selectedKeys = [], skippedKeys = []) {
    if (!(root instanceof Element)) {
      return;
    }
    const consigneId = resolveConsigneId(root);
    const inputs = collectInputs(root);
    const keySet = new Set(selectedKeys.map((value) => String(value)));
    const skippedSet = new Set(skippedKeys.map((value) => String(value)));
    inputs.forEach((input, index) => {
      if (!(input instanceof HTMLInputElement)) {
        return;
      }
      const host = input.closest("[data-checklist-item]");
      const key = resolveInputKey(input, host, { itemKeyAttr, consigneId, index });
      const legacyKey = resolveLegacyKey(input, host, { consigneId, index });
      applyKeyAttributes(input, host, itemKeyAttr, key, legacyKey);
      const isSkipped = skippedSet.has(String(key)) || skippedSet.has(String(legacyKey));
      const shouldCheck = !isSkipped && (keySet.has(String(key)) || keySet.has(String(legacyKey)));
      if (isSkipped) {
        const prev = input.checked ? "1" : "0";
        input.checked = false;
        input.setAttribute("data-checklist-prev-checked", prev);
        input.setAttribute("data-checklist-skip", "1");
        if (input.dataset) {
          input.dataset[PREV_CHECKED_KEY] = prev;
          input.dataset[SKIP_DATA_KEY] = "1";
        }
        if (host) {
          if (host.dataset) {
            host.dataset.checklistSkipped = "1";
          }
          host.setAttribute("data-checklist-skipped", "1");
          if (host.classList && typeof host.classList.add === "function") {
            host.classList.add("checklist-item--skipped");
          }
          host.setAttribute("data-validated", "skip");
        }
      } else {
        if (input.checked !== shouldCheck) {
          input.checked = shouldCheck;
        }
        input.removeAttribute("data-checklist-prev-checked");
        input.removeAttribute("data-checklist-skip");
        if (input.dataset) {
          delete input.dataset[PREV_CHECKED_KEY];
          delete input.dataset[SKIP_DATA_KEY];
        }
        if (host) {
          if (host.dataset) {
            delete host.dataset.checklistSkipped;
          }
          host.removeAttribute("data-checklist-skipped");
          if (host.classList && typeof host.classList.remove === "function") {
            host.classList.remove("checklist-item--skipped");
          }
          host.setAttribute("data-validated", shouldCheck ? "true" : "false");
        }
      }
    });
    const hidden = root.querySelector("[data-checklist-state]");
    if (hidden) {
      try {
        const values = inputs.map((input) => (input instanceof HTMLInputElement ? Boolean(input.checked) : false));
        hidden.value = JSON.stringify(values);
      } catch (error) {
        console.warn("[checklist-fix] hidden", error);
      }
      if (hidden.dataset) {
        hidden.dataset.dirty = "1";
      }
      if (typeof hidden.dispatchEvent === "function" && typeof Event === "function") {
        try {
          hidden.dispatchEvent(new Event("input", { bubbles: true }));
          hidden.dispatchEvent(new Event("change", { bubbles: true }));
        } catch (error) {
          console.warn("[checklist-fix] hidden:dispatch", error);
        }
      }
    }
    if (root && root.dataset) {
      root.dataset.checklistDirty = "1";
    }
  }

  function resolveUid(fallback) {
    if (fallback) {
      return fallback;
    }
    const ctxUid = GLOBAL.AppCtx?.user?.uid;
    if (ctxUid) {
      return ctxUid;
    }
    const authUid = GLOBAL.Schema?.currentUser?.uid;
    if (authUid) {
      return authUid;
    }
    return null;
  }

  const SKIP_DATA_KEY = "checklistSkip";
  const PREV_CHECKED_KEY = "checklistPrevChecked";

  async function hydrateChecklist(options = {}) {
    const root = options.container instanceof Element ? options.container : null;
    if (!root) {
      return null;
    }
    const itemKeyAttr = options.itemKeyAttr || "data-key";
    const consigneId =
      options.consigneId ||
      root.getAttribute("data-consigne-id") ||
      root.dataset?.consigneId ||
      null;
    const uid = resolveUid(options.uid);
  const dateKey = options.dateKey || (typeof GLOBAL.AppCtx?.dateIso === 'string' && GLOBAL.AppCtx.dateIso ? GLOBAL.AppCtx.dateIso : todayKey());
    const manager = GLOBAL.ChecklistState || null;
    const db = options.db || GLOBAL.AppCtx?.db || null;
    const log = (event, extra = {}, level = "info") => {
      const baseDetails =
        extra && typeof extra === "object"
          ? { consigneId: consigneId || null, ...extra }
          : { consigneId: consigneId || null, value: extra };
      logChecklistEvent(event, baseDetails, level);
    };

    log("hydrate.start", {
      hasRoot: Boolean(root),
      hasUid: Boolean(uid),
      hasManager: Boolean(manager),
    });

    const hiddenInput = root.querySelector("[data-checklist-state]");

    if (hiddenInput && !hiddenInput.__checklistHiddenListener) {
      const applyHiddenState = () => {
        let parsed = null;
        try {
          parsed = hiddenInput.value ? JSON.parse(hiddenInput.value) : null;
        } catch (error) {
          console.warn("[checklist-fix] hidden:parse", error);
          return;
        }
        // Si la page a une date explicite et que la valeur cachée n'a pas de dateKey
        // ou que la dateKey ne correspond pas au jour de la page, on ignore.
        try {
          const hiddenKey = parsed && typeof parsed === 'object' && parsed.dateKey ? String(parsed.dateKey) : null;
          const rootHistoryKey =
            root?.dataset && typeof root.dataset.checklistHistoryDate === 'string'
              ? root.dataset.checklistHistoryDate.trim()
              : null;
          const hiddenHistoryKey =
            hiddenInput?.dataset && typeof hiddenInput.dataset.checklistHistoryDate === 'string'
              ? hiddenInput.dataset.checklistHistoryDate.trim()
              : null;
          const hash = typeof GLOBAL.location?.hash === 'string' ? GLOBAL.location.hash : '';
          let hashDate = null;
          try {
            const qp = new URLSearchParams((hash.split('?')[1] || ''));
            hashDate = (qp.get('d') || '').trim() || null;
          } catch (_) {}
          const pageKey = typeof GLOBAL.AppCtx?.dateIso === 'string' && GLOBAL.AppCtx.dateIso ? GLOBAL.AppCtx.dateIso : null;
          const expectedKey = rootHistoryKey || hiddenHistoryKey || hashDate || pageKey || null;
          if (expectedKey) {
            if (!hiddenKey) {
              log("hydrate.hidden.skip-missing-dateKey", { pageKey: expectedKey });
              return;
            }
            if (hiddenKey !== expectedKey) {
              log("hydrate.hidden.skip-date-mismatch", { hiddenKey, pageKey: expectedKey });
              return;
            }
          }
        } catch (e) {
          // ignore
        }
        const payload = Array.isArray(parsed)
          ? { items: parsed.map((value) => value === true), skipped: [] }
          : {
              items: Array.isArray(parsed?.items)
                ? parsed.items.map((value) => value === true)
                : [],
              skipped: Array.isArray(parsed?.skipped)
                ? parsed.skipped.map((value) => value === true)
                : [],
            };
        const inputs = collectInputs(root);
        inputs.forEach((input, index) => {
          if (!(input instanceof HTMLInputElement)) {
            return;
          }
          const host = input.closest("[data-checklist-item]");
          const shouldCheck = Boolean(payload.items[index]);
          const shouldSkip = Boolean(payload.skipped[index]);
          input.checked = shouldCheck;
          if (shouldSkip) {
            const prev = shouldCheck ? "1" : "0";
            // Un item skippé ne doit jamais être coché
            input.checked = false;
            input.setAttribute("data-checklist-prev-checked", prev);
            input.setAttribute("data-checklist-skip", "1");
            if (input.dataset) {
              input.dataset[PREV_CHECKED_KEY] = prev;
              input.dataset[SKIP_DATA_KEY] = "1";
            }
            if (host) {
              if (host.dataset) {
                host.dataset.checklistSkipped = "1";
              }
              host.setAttribute("data-checklist-skipped", "1");
              if (host.classList && typeof host.classList.add === "function") {
                host.classList.add("checklist-item--skipped");
              }
              host.setAttribute("data-validated", "skip");
            }
          } else {
            input.removeAttribute("data-checklist-prev-checked");
            input.removeAttribute("data-checklist-skip");
            if (input.dataset) {
              delete input.dataset[PREV_CHECKED_KEY];
              delete input.dataset[SKIP_DATA_KEY];
            }
            if (host) {
              if (host.dataset) {
                delete host.dataset.checklistSkipped;
              }
              host.removeAttribute("data-checklist-skipped");
              if (host.classList && typeof host.classList.remove === "function") {
                host.classList.remove("checklist-item--skipped");
              }
              host.setAttribute("data-validated", shouldCheck ? "true" : "false");
            }
          }
        });
        const checkedCount = inputs.reduce((count, input) => (input.checked ? count + 1 : count), 0);
        const skippedCount = inputs.reduce(
          (count, input) =>
            input instanceof HTMLInputElement && input.dataset?.[SKIP_DATA_KEY] === "1" ? count + 1 : count,
          0
        );
        log("hydrate.hidden", { checked: checkedCount, skipped: skippedCount });
      };
      const handler = () => {
        applyHiddenState();
      };
      hiddenInput.addEventListener("input", handler);
      hiddenInput.addEventListener("change", handler);
      hiddenInput.__checklistHiddenListener = handler;
      applyHiddenState();
    }

    if (!root.__hydrateChecklistBound) {
      root.addEventListener(
        "change",
        (event) => {
          const target = event?.target;
          if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
            return;
          }
          if (
            !target.matches('[data-checklist-input]') &&
            !(itemKeyAttr && target.hasAttribute(itemKeyAttr))
          ) {
            return;
          }
          const host = target.closest("[data-checklist-item]");
          if (host) {
            host.setAttribute("data-validated", target.checked ? "true" : "false");
          }
          const selectedKeys = collectSelectedKeys(root, itemKeyAttr);
          const skippedKeys = collectSkippedKeys(root, itemKeyAttr);
          const selectedCount = selectedKeys.length;
          const skippedCount = skippedKeys.length;
          log("change", { selected: selectedCount, skipped: skippedCount });
          const effectiveUid = resolveUid(uid);
          if (manager && typeof manager.persistRoot === "function") {
            try {
              const result = manager.persistRoot(root, { consigneId, dateKey, uid: effectiveUid, db });
              Promise.resolve(result)
                .then((payload) => {
                  const persisted = Array.isArray(payload?.selectedIds) ? payload.selectedIds.length : null;
                  const persistedSkipped = Array.isArray(payload?.skippedIds) ? payload.skippedIds.length : null;
                  log("persist.manager", {
                    selected: selectedCount,
                    skipped: skippedCount,
                    persisted,
                    persistedSkipped,
                  });
                })
                .catch((error) => {
                  console.warn("[checklist-fix] persistRoot", error);
                  log(
                    "persist.manager.error",
                    {
                      selected: selectedCount,
                      skipped: skippedCount,
                      message: error?.message || String(error),
                    },
                    "warn"
                  );
                });
            } catch (error) {
              console.warn("[checklist-fix] persistRoot", error);
              log(
                "persist.manager.error",
                {
                  selected: selectedCount,
                  skipped: skippedCount,
                  message: error?.message || String(error),
                },
                "warn"
              );
            }
            return;
          }
          if (!effectiveUid || !consigneId) {
            return;
          }
          Promise.resolve(
            fallbackSaveAnswer(effectiveUid, consigneId, dateKey, {
              type: "checklist",
              selected: selectedKeys,
              selectedIds: selectedKeys,
              skipped: skippedKeys,
              skippedIds: skippedKeys,
              updatedAt: Date.now(),
            })
          ).catch((error) => {
            log(
              "persist.fallback.error",
              {
                selected: selectedCount,
                skipped: skippedCount,
                message: error?.message || String(error),
              },
              "warn"
            );
          });
        },
        { passive: true }
      );
      root.__hydrateChecklistBound = true;
    }

    if (root.__hydrateChecklistPromise) {
      return root.__hydrateChecklistPromise;
    }

    const promise = (async () => {
      const effectiveUid = resolveUid(uid);
      if (!consigneId || !effectiveUid) {
        return null;
      }
      let saved = null;
      const selectedCount = (value) => {
        if (!value) return 0;
        if (Array.isArray(value.selectedIds)) return value.selectedIds.length;
        if (Array.isArray(value.selected)) return value.selected.length;
        if (Array.isArray(value.checked)) return value.checked.length;
        return 0;
      };
      if (manager && typeof manager.loadSelection === "function" && db) {
        try {
          saved = await manager.loadSelection(db, effectiveUid, consigneId, { dateKey });
          if (saved) {
            log("hydrate.manager", { dateKey: saved.dateKey || null, selected: selectedCount(saved) });
          } else {
            log("hydrate.manager.empty");
          }
        } catch (error) {
          console.warn("[checklist-fix] loadSelection", error);
          log("hydrate.manager.error", { message: error?.message || String(error) }, "warn");
        }
      }
        if (!saved) {
          saved = await fallbackLoadAnswer(effectiveUid, consigneId, dateKey);
          if (saved) {
            log("hydrate.fallback", { dateKey: saved.dateKey || null, selected: selectedCount(saved) });
          } else {
            log("hydrate.fallback.empty", { dateKey });
          }
      }
      let appliedWithManager = false;
      if (saved && manager && typeof manager.applySelection === "function") {
        try {
          manager.applySelection(root, saved, { consigneId, dateKey, uid: effectiveUid, db });
          appliedWithManager = true;
          log("hydrate.apply.manager", { selected: selectedCount(saved) });
        } catch (error) {
          console.warn("[checklist-fix] applySelection", error);
          log("hydrate.apply.error", { message: error?.message || String(error) }, "warn");
        }
      }
        if (saved && !appliedWithManager) {
          const selected = Array.isArray(saved?.selectedIds)
            ? saved.selectedIds
            : Array.isArray(saved?.selected)
            ? saved.selected
            : [];
          const skipped = Array.isArray(saved?.skippedIds)
            ? saved.skippedIds
            : Array.isArray(saved?.skipped)
            ? saved.skipped
            : [];
          applySelectedKeys(root, itemKeyAttr, selected, skipped);
          log("hydrate.apply.dom", { selected: selected.length, skipped: skipped.length });
      }
      return saved;
    })()
      .catch((error) => {
        console.warn("[checklist-fix] hydrate", error);
        log("hydrate.error", { message: error?.message || String(error) }, "warn");
        return null;
      })
      .finally(() => {
        root.__hydrateChecklistPromise = null;
        root.__hydrateChecklistHydrated = true;
        log("hydrate.done", { hydrated: true });
      });

    root.__hydrateChecklistPromise = promise;
    return promise;
  }

  if (typeof GLOBAL !== "undefined") {
    GLOBAL.hydrateChecklist = hydrateChecklist;
    GLOBAL.checklistTodayKey = todayKey;
  }
})();
