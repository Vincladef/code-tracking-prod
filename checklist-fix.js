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
        .collection("users")
        .doc(uid)
        .collection("answers")
        .doc(dateKey)
        .collection("consignes")
        .doc(consigneId);
      const snap = await ref.get();
      if (!snap || !snap.exists) {
        return null;
      }
      return snap.data() || null;
    } catch (error) {
      console.warn("[checklist-fix] loadAnswer", error);
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
    const data = {
      type: "checklist",
      selectedIds: selected,
      checked: selected,
      updatedAt: payload.updatedAt || Date.now(),
      dateKey,
    };
    try {
      const ref = db
        .collection("users")
        .doc(uid)
        .collection("answers")
        .doc(dateKey)
        .collection("consignes")
        .doc(consigneId);
      await ref.set(data, { merge: true });
      return data;
    } catch (error) {
      console.warn("[checklist-fix] saveAnswer", error);
      return null;
    }
  }

  function collectSelectedKeys(root, itemKeyAttr) {
    if (!(root instanceof Element)) {
      return [];
    }
    const selector = `input[type="checkbox"][${itemKeyAttr}]`;
    return Array.from(root.querySelectorAll(selector))
      .map((input) => {
        if (!(input instanceof HTMLInputElement)) {
          return null;
        }
        const key = input.getAttribute(itemKeyAttr);
        return input.checked && key ? String(key) : null;
      })
      .filter(Boolean);
  }

  function applySelectedKeys(root, itemKeyAttr, selectedKeys = []) {
    if (!(root instanceof Element)) {
      return;
    }
    const selector = `input[type="checkbox"][${itemKeyAttr}]`;
    const inputs = Array.from(root.querySelectorAll(selector));
    const keySet = new Set(selectedKeys.map((value) => String(value)));
    inputs.forEach((input) => {
      if (!(input instanceof HTMLInputElement)) {
        return;
      }
      const key = input.getAttribute(itemKeyAttr);
      const host = input.closest("[data-checklist-item]");
      const legacyKey = input.getAttribute("data-legacy-key") || host?.getAttribute?.("data-checklist-legacy-key");
      const shouldCheck =
        (key && keySet.has(String(key))) || (legacyKey ? keySet.has(String(legacyKey)) : false);
      if (input.checked !== shouldCheck) {
        input.checked = shouldCheck;
      }
      if (host) {
        host.setAttribute("data-validated", shouldCheck ? "true" : "false");
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
    const dateKey = options.dateKey || todayKey();
    const manager = GLOBAL.ChecklistState || null;
    const db = options.db || GLOBAL.AppCtx?.db || null;

    if (!root.__hydrateChecklistBound) {
      root.addEventListener(
        "change",
        (event) => {
          const target = event?.target;
          if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
            return;
          }
          if (!target.matches(`input[type="checkbox"][${itemKeyAttr}]`)) {
            return;
          }
          const host = target.closest("[data-checklist-item]");
          if (host) {
            host.setAttribute("data-validated", target.checked ? "true" : "false");
          }
          const selectedKeys = collectSelectedKeys(root, itemKeyAttr);
          if (manager && typeof manager.persistRoot === "function") {
            try {
              manager.persistRoot(root, { consigneId, dateKey });
            } catch (error) {
              console.warn("[checklist-fix] persistRoot", error);
            }
            return;
          }
          const effectiveUid = resolveUid(uid);
          if (!effectiveUid || !consigneId) {
            return;
          }
          fallbackSaveAnswer(effectiveUid, consigneId, dateKey, {
            type: "checklist",
            selected: selectedKeys,
            selectedIds: selectedKeys,
            updatedAt: Date.now(),
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
      if (manager && typeof manager.loadSelection === "function" && db) {
        try {
          saved = await manager.loadSelection(db, effectiveUid, consigneId);
        } catch (error) {
          console.warn("[checklist-fix] loadSelection", error);
        }
      }
      if (!saved) {
        saved = await fallbackLoadAnswer(effectiveUid, consigneId, dateKey);
      }
      const selected = Array.isArray(saved?.selectedIds)
        ? saved.selectedIds
        : Array.isArray(saved?.selected)
        ? saved.selected
        : [];
      applySelectedKeys(root, itemKeyAttr, selected);
      return saved;
    })()
      .catch((error) => {
        console.warn("[checklist-fix] hydrate", error);
        return null;
      })
      .finally(() => {
        root.__hydrateChecklistPromise = null;
        root.__hydrateChecklistHydrated = true;
      });

    root.__hydrateChecklistPromise = promise;
    return promise;
  }

  if (typeof GLOBAL !== "undefined") {
    GLOBAL.hydrateChecklist = hydrateChecklist;
    GLOBAL.checklistTodayKey = todayKey;
  }
})();
