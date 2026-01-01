  // Empêche la coche sur une checklist utilisateur si skipped
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    document.addEventListener("click", function(e) {
      const target = e.target;
      if (target && target.type === "checkbox" && target.closest) {
        // On cible uniquement les checklists utilisateur (hors éditeur riche)
        const root = target.closest('[data-checklist-root]');
        if (root && !target.closest('.rt-editor')) {
          const item = target.closest('.checklist-item, [data-checklist-item]');
          if (item && (item.classList.contains('checklist-item--skipped') || item.getAttribute('data-checklist-skipped') === '1' || target.getAttribute('data-checklist-skip') === '1')) {
            e.preventDefault();
            e.stopPropagation();
            // Message utilisateur (optionnel)
            if (!item.querySelector('.skip-warning')) {
              const msg = document.createElement('span');
              msg.textContent = 'Cet élément est ignoré. Retirez le mode "ignorer" pour pouvoir cocher.';
              msg.className = 'skip-warning';
              msg.style.color = '#d9534f';
              msg.style.fontSize = '0.9em';
              msg.style.marginLeft = '8px';
              item.appendChild(msg);
              setTimeout(() => { msg.remove(); }, 2500);
            }
          }
        }
      }
    }, true);
  }
// app.js — bootstrapping, routing, context, nav
/* global Schema, Modes, Goals */
(() => {
  if (window.__APP_ROUTER_INITIALIZED__) {
    return;
  }
  window.__APP_ROUTER_INITIALIZED__ = true;
  const appFirestore = Schema.firestore || window.firestoreAPI || {};
  const snapshotExists =
    Schema.snapshotExists ||
    ((snap) => (typeof snap?.exists === "function" ? snap.exists() : !!snap?.exists));

  const firebaseCompatApp = window.firebase || {};
  const BASE_TITLE = "Habitudes & Pratique";
  const BASE_SHORT_APP_NAME = "Habitudes";
  const INSTALL_NAME_SEPARATOR = " — ";
  const ADMIN_ACCESS_KEY = "hp::admin::authorized";
  const ADMIN_LOGIN_PAGE = "admin.html";
  const DEFAULT_NOTIFICATION_ICON =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAB6ElEQVR42u3d0U0gQAxDwVRGudccRUANJwTrxLNSGvCb/52Pf59frvfGCAAYAgAHgAPAAeAAuHv/8wAoC94KYkTvxjDCd0MY8bsRjPDdEEb8bgQjfDeEEb8bwYjfjWDE70Yw4ncjGPG7EYz43QhG/G4EAAAgfjOCEb8bAQAAiN+MYMTvRgAAAOI3IwAAAPGbEQAAgPjNCAAAQPxmBAAAAAAA4tciAAAA8ZsRAAAAAAAAAID4nQgAAAAAAAAAQPxOBAAAAAAAAAAAAAAAACB+GwIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAiWxwcAAAAAAAAAAAAAAAAI2uIDAAAAAAAAAASd8QEAAAAAAAAAgs74AADg17Dm+AAAAAAA/g6ujQ8AAO8AQPA+PgAAvAUAwdv4AADwHkA7gtfbAwDAewCtCBJ2jwHQhiBlcwAAyAHQgiBp7zgA1xGkbQ0AAHkAriJI3DkWwDUEqRtHA7iCIHnfeADbEaRvuwLAVgQbdl0DYBuCLZuuArAFwaY91wFIhrBxx7UA0hBs3XA1gAQI27c7AeAVggu7nQHwlxAu7XUOwG9huLrRaQA/xdCwCwAAAAAAAAAAAAAAAADQBuAb8crY5qD79QEAAAAASUVORK5CYII=";

  const PRIMARY_SERVICE_WORKER_FILE = "firebase-messaging-sw.js";
  const LEGACY_SERVICE_WORKER_FILE = "sw.js";

  function getAdminStorage() {
    try {
      return window.sessionStorage;
    } catch (error) {
      console.warn("[admin] sessionStorage inaccessible", error);
      return null;
    }
  }

  function hasAdminAccess() {
    const storage = getAdminStorage();
    return storage?.getItem(ADMIN_ACCESS_KEY) === "true";
  }

  function redirectToAdminLogin() {
    const loginUrl = new URL(ADMIN_LOGIN_PAGE, window.location.href);
    if (loginUrl.pathname === window.location.pathname && loginUrl.hash === window.location.hash) {
      return;
    }
    window.location.href = loginUrl.toString();
  }

  // --- feature flags & logger ---
  const DEBUG = true;
  const LOG = true;
  const L = Schema.D || {
    on: false,
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
    group: () => {},
    groupEnd: () => {},
  };
  if (L) L.on = DEBUG;
  const appLog = (event, payload) => {
    if (!LOG) return;
    if (payload === undefined) {
      console.info("[app]", event);
      return;
    }
    console.info("[app]", event, payload);
  };
  function logStep(step, data) {
    L.group(step);
    if (data) L.info(data);
    L.groupEnd();
  }

  const ctx = {
    app: null,
    db: null,
    user: null, // { uid } passed by index.html
    profile: null, // profile doc
    categories: [],
    route: "#/admin",
  };

  function updateChecklistStateContext() {
    const manager = window.ChecklistState;
    if (!manager) {
      return;
    }
    if (ctx.db && ctx.user?.uid && typeof manager.setContext === "function") {
      manager.setContext({ db: ctx.db, uid: ctx.user.uid });
      return;
    }
    if (typeof manager.clearContext === "function") {
      manager.clearContext();
    }
  }

  function ensureChecklistHydration(scope) {
    const manager = window.ChecklistState;
    if (!manager) return;
    const hydrate = manager.hydrateExistingRoots || manager.hydrateRoots;
    if (typeof hydrate !== "function") return;

    const run = () => {
      try {
        hydrate.call(manager, scope || document);
      } catch (error) {
        console.warn("[app] checklist:hydrate", error);
      }
    };

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(run);
    } else {
      setTimeout(run, 0);
    }
  }

  function renderWithChecklistHydration(result, scope) {
    if (result && typeof result.then === "function") {
      return result
        .then((value) => {
          ensureChecklistHydration(scope);
          return value;
        })
        .catch((error) => {
          ensureChecklistHydration(scope);
          throw error;
        });
    }

    ensureChecklistHydration(scope);
    return result;
  }

  function ensureRichTextModalCheckboxBehavior() {
    if (typeof document === "undefined") return;

    const resolveCheckboxSetupFn = () =>
      window.setupCheckboxLikeBullets ||
      window.setupCheckboxListBehavior ||
      window.setupChecklistEditor;

    const setupEditorOnce = (editorEl, insertBtn) => {
      const setupFn = resolveCheckboxSetupFn();
      if (typeof setupFn !== "function") return false;
      if (!editorEl) return false;
      if (editorEl.__cbInstalled) return true;
      try {
        setupFn(editorEl, insertBtn || null);
      } catch (error) {
        console.warn("[app] checklist-editor:setup", error);
      }
      return true;
    };

    const upgradeTextarea = (textarea) => {
      if (!(textarea instanceof HTMLElement) || textarea.tagName !== "TEXTAREA") {
        return textarea;
      }
      if (textarea.dataset.rtEditorDisplayId) {
        const existing = document.getElementById(textarea.dataset.rtEditorDisplayId);
        if (existing) return existing;
      }

      const doc = textarea.ownerDocument || document;
      const originalId = textarea.id || "rt-editor";
      const display = doc.createElement("div");
      display.id = originalId;
      const classList = new Set((textarea.className || "").split(/\s+/).filter(Boolean));
      classList.add("rt-editor");
      display.className = Array.from(classList).join(" ");
      display.setAttribute("contenteditable", "true");
      const placeholder = textarea.getAttribute("placeholder");
      if (placeholder) {
        display.setAttribute("data-placeholder", placeholder);
      }

      const setDisplayContent = (value) => {
        const raw = value || "";
        if (
          raw &&
          /<\s*(div|p|span|ul|ol|li|input|br|strong|em|h[1-6]|blockquote|section|article|header|footer|pre|code|table|tbody|thead|tr|td|th|label|form|button|a)\b/i.test(raw)
        ) {
          display.innerHTML = raw;
          return;
        }
        display.innerHTML = "";
        const fragment = doc.createDocumentFragment();
        const lines = raw.split(/\r?\n/);
        if (lines.length === 1 && lines[0] === "") {
          fragment.appendChild(doc.createElement("br"));
        } else {
          lines.forEach((line, index) => {
            if (index > 0) fragment.appendChild(doc.createElement("br"));
            if (line) fragment.appendChild(doc.createTextNode(line));
          });
        }
        display.appendChild(fragment);
      };

      setDisplayContent(textarea.value || "");

      const hidden = textarea;
      const hiddenId = `${originalId}-hidden`;
      hidden.id = hiddenId;
      hidden.hidden = true;
      hidden.style.display = "none";
      hidden.setAttribute("aria-hidden", "true");
      hidden.dataset.rtEditorDisplayId = originalId;
      hidden.classList.add("rt-editor__hidden-input");

      textarea.insertAdjacentElement("beforebegin", display);

      const syncHidden = (dispatch = false) => {
        hidden.value = display.innerHTML;
        if (dispatch) {
          try {
            hidden.dispatchEvent(new Event("input", { bubbles: true }));
          } catch (err) {
            console.warn("[app] rt-editor:hidden:input", err);
          }
        }
      };

      display.addEventListener("input", () => syncHidden(true));
      display.addEventListener("blur", () => syncHidden(false));

      const form = hidden.closest("form");
      if (form && !form.__rtEditorEnterGuard) {
        form.__rtEditorEnterGuard = true;
        form.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && document.activeElement === display) {
            event.preventDefault();
          }
        });
      }
      if (form) {
        form.addEventListener("reset", () => {
          window.setTimeout(() => {
            const defaultValue = hidden.defaultValue || "";
            setDisplayContent(defaultValue);
            syncHidden(false);
          }, 0);
        });
      }

      syncHidden(false);

      const insertBtn = document.getElementById("insert-checkbox");
      setupEditorOnce(display, insertBtn || null);

      return display;
    };

    const trySetup = () => {
      let editorEl = document.getElementById("rt-editor");
      if (!editorEl) return false;
      if (editorEl.tagName === "TEXTAREA") {
        editorEl = upgradeTextarea(editorEl);
      }
      if (!editorEl) return false;
      if (!editorEl.isContentEditable) {
        editorEl.setAttribute("contenteditable", "true");
      }
      if (!editorEl.classList.contains("rt-editor")) {
        editorEl.classList.add("rt-editor");
      }
      const insertBtn = document.getElementById("insert-checkbox");
      return setupEditorOnce(editorEl, insertBtn || null);
    };

    const hasSetupFn = () => typeof resolveCheckboxSetupFn() === "function";

    trySetup();

    if (!hasSetupFn() && typeof window.setTimeout === "function") {
      const waitForFn = () => {
        if (hasSetupFn()) {
          trySetup();
          return;
        }
        window.setTimeout(waitForFn, 120);
      };
      window.setTimeout(waitForFn, 120);
    }

    if (typeof MutationObserver === "function" && document.body) {
      const observer = new MutationObserver(() => {
        trySetup();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  window.ensureRichTextModalCheckboxBehavior = ensureRichTextModalCheckboxBehavior;
  ensureRichTextModalCheckboxBehavior();

  function installChecklistAutosaveEvents() {
    if (typeof document === "undefined") {
      return;
    }
    if (window.__checklistAutosaveEventsInstalled) {
      return;
    }
    window.__checklistAutosaveEventsInstalled = true;

    const toEscapedSelector = (value) => {
      const stringValue = String(value ?? "");
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        try {
          return CSS.escape(stringValue);
        } catch (error) {
          console.warn("[app] checklist:escape", error);
        }
      }
      return stringValue.replace(/"/g, '\\"');
    };

    const ensureRootUid = (root) => {
      if (!root) return null;
      const existing = root.getAttribute("data-checklist-root-uid") || (root.dataset && root.dataset.checklistRootUid) || "";
      if (existing) return existing;
      const uid = `chk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        root.setAttribute("data-checklist-root-uid", uid);
        if (root.dataset) root.dataset.checklistRootUid = uid;
      } catch (_) {}
      return uid;
    };

    const ensureItemId = (input, root, host) => {
      if (!input || !root || !host) {
        return host?.getAttribute?.("data-item-id") || null;
      }
      const consigneId = root.getAttribute("data-consigne-id") || root.dataset.consigneId || "";
      const explicitKey =
        input.getAttribute("data-key") ||
        input.dataset?.key ||
        input.getAttribute("data-item-id") ||
        host.getAttribute("data-item-id");
      const explicitLegacy =
        input.getAttribute("data-legacy-key") ||
        input.dataset?.legacyKey ||
        host.getAttribute("data-checklist-legacy-key") ||
        null;
      if (explicitKey) {
        const key = String(explicitKey);
        input.setAttribute("data-item-id", key);
        input.setAttribute("data-key", key);
        input.setAttribute("data-stable-key", key);
        input.dataset.key = key;
        input.dataset.stableKey = key;
        host.setAttribute("data-item-id", key);
        host.setAttribute("data-checklist-key", key);
        host.setAttribute("data-checklist-stable-key", key);
        if (explicitLegacy) {
          const legacy = String(explicitLegacy);
          input.setAttribute("data-legacy-key", legacy);
          if (input.dataset) {
            input.dataset.legacyKey = legacy;
          }
          host.setAttribute("data-checklist-legacy-key", legacy);
        }
        return key;
      }
      const attr = input.getAttribute("data-checklist-index");
      let indexValue = attr !== null ? attr : null;
      if (indexValue === null) {
        const inputs = Array.from(root.querySelectorAll("[data-checklist-input]"));
        const position = inputs.indexOf(input);
        if (position !== -1) {
          indexValue = String(position);
        }
      }
      if (indexValue === null) {
        indexValue = String(Date.now());
      }
      const prefix = consigneId ? `${String(consigneId)}:` : "";
      const itemId = `${prefix}${indexValue}`;
      const legacyKey =
        explicitLegacy ||
        (consigneId ? `${String(consigneId)}:${indexValue}` : String(indexValue));
      input.setAttribute("data-item-id", itemId);
      input.setAttribute("data-key", itemId);
      input.setAttribute("data-stable-key", itemId);
      input.dataset.key = itemId;
      input.dataset.stableKey = itemId;
      input.setAttribute("data-legacy-key", legacyKey);
      input.dataset.legacyKey = legacyKey;
      host.setAttribute("data-item-id", itemId);
      host.setAttribute("data-checklist-key", itemId);
      host.setAttribute("data-checklist-legacy-key", legacyKey);
      host.setAttribute("data-checklist-stable-key", itemId);
      return itemId;
    };

    const updateHiddenState = (root) => {
      if (!root) {
        return;
      }
      const hidden = root.querySelector("[data-checklist-state]");
      if (!hidden) {
        return;
      }
      try {
        const inputs = Array.from(root.querySelectorAll("[data-checklist-input]"));
        const payload = {
          items: inputs.map((node) => Boolean(node.checked)),
          skipped: inputs.map((node) => (node.dataset?.checklistSkip === "1" ? true : false)),
        };
        try {
          // Prefer the explicit history date when present (in history editor contexts),
          // otherwise fall back to the current page date or today.
          const historyKeyAttr =
            root.getAttribute("data-checklist-history-date") ||
            (root.dataset ? root.dataset.checklistHistoryDate : null) ||
            (hidden.getAttribute && hidden.getAttribute("data-checklist-history-date")) ||
            (hidden.dataset ? hidden.dataset.checklistHistoryDate : null);
          // Use URL ?d=... as the primary fallback for summary/bilan pages
          let urlDayKey = null;
          try {
            const hash = typeof window.location?.hash === 'string' ? window.location.hash : '';
            const search = typeof window.location?.search === 'string' ? window.location.search : '';
            const pick = (s) => {
              if (!s) return null;
              const m = String(s).match(/[?&]d=(\d{4}-\d{2}-\d{2})\b/i);
              return m ? m[1] : null;
            };
            urlDayKey = pick(search) || pick(hash) || null;
          } catch (_) {}
          const effectiveKey = historyKeyAttr && String(historyKeyAttr).trim()
            ? String(historyKeyAttr).trim()
            : (urlDayKey || ((typeof window !== 'undefined' && window.AppCtx?.dateIso)
                ? String(window.AppCtx.dateIso)
                : (typeof Schema?.todayKey === 'function' ? Schema.todayKey() : null)));
          if (effectiveKey) {
            payload.dateKey = effectiveKey;
          }
        } catch (e) {}
        if (Array.isArray(payload.skipped) && payload.skipped.every((value) => value === false)) {
          delete payload.skipped;
        }
        // Debug visibility: summarize what will be written to the hidden field
        try {
          const consigneId = root.getAttribute("data-consigne-id") || root.dataset?.consigneId || null;
          const checkedCount = inputs.reduce((n, node) => (node.checked ? n + 1 : n), 0);
          const skippedCount = inputs.reduce(
            (n, node) => (node.dataset?.checklistSkip === "1" ? n + 1 : n),
            0
          );
          console.info("[checklist-debug] hidden:update", {
            consigneId,
            dateKey: payload?.dateKey || null,
            items: inputs.length,
            checked: checkedCount,
            skipped: skippedCount,
          });
        } catch (_) {}
        const answers = {};
        inputs.forEach((input, index) => {
          const host = input.closest("[data-checklist-item]");
          const rawId =
            host?.getAttribute?.("data-item-id") ||
            input.getAttribute("data-item-id") ||
            input.dataset?.key ||
            input.dataset?.itemId ||
            String(index);
          const itemId = String(rawId ?? "").trim();
          if (!itemId) {
            return;
          }
          const skipFlag =
            (input.dataset && input.dataset.checklistSkip === "1") ||
            (host && host.dataset && host.dataset.checklistSkipped === "1");
          let value;
          if (skipFlag) {
            value = "no";
          } else {
            value = Boolean(input.checked) ? "yes" : "no";
          }
          answers[itemId] = { value, skipped: skipFlag };
        });
        if (Object.keys(answers).length) {
          payload.answers = answers;
        }
  hidden.value = JSON.stringify(payload);
  hidden.dataset.dirty = "1";
  // Un seul événement suffit; cela évite un double traitement dans les listeners
  hidden.dispatchEvent(new Event("input", { bubbles: true }));
      } catch (error) {
        console.warn("[app] checklist:hidden", error);
      }
    };

    const findChecklistItemNode = (consigneId, itemId) => {
      const hasIds = consigneId && itemId;
      if (!hasIds) {
        return null;
      }
      const escapedConsigne = toEscapedSelector(consigneId);
      const escapedItem = toEscapedSelector(itemId);
      const selector = `[data-checklist-root][data-consigne-id="${escapedConsigne}"] [data-checklist-item][data-item-id="${escapedItem}"]`;
      try {
        const node = document.querySelector(selector);
        if (node) {
          return node;
        }
      } catch (error) {
        console.warn("[app] checklist:query", error);
      }
      return document.querySelector(`[data-checklist-item][data-item-id="${escapedItem}"]`);
    };

    const CHECKLIST_SKIP_DATA_KEY = "checklistSkip";
    const CHECKLIST_PREV_CHECKED_KEY = "checklistPrevChecked";

    const storePreviousCheckedState = (input) => {
      if (!input) {
        return "0";
      }
      let previous = null;
      if (input.dataset && Object.prototype.hasOwnProperty.call(input.dataset, CHECKLIST_PREV_CHECKED_KEY)) {
        previous = input.dataset[CHECKLIST_PREV_CHECKED_KEY];
      }
      if (previous == null && input.hasAttribute("data-checklist-prev-checked")) {
        previous = input.getAttribute("data-checklist-prev-checked");
      }
      if (previous == null) {
        previous = input.checked ? "1" : "0";
      }
      if (input.dataset) {
        input.dataset[CHECKLIST_PREV_CHECKED_KEY] = previous;
      }
      input.setAttribute("data-checklist-prev-checked", previous);
      return previous;
    };

    const readPreviousCheckedState = (input) => {
      if (!input) {
        return null;
      }
      let previous = null;
      if (input.dataset && Object.prototype.hasOwnProperty.call(input.dataset, CHECKLIST_PREV_CHECKED_KEY)) {
        previous = input.dataset[CHECKLIST_PREV_CHECKED_KEY];
        delete input.dataset[CHECKLIST_PREV_CHECKED_KEY];
      }
      if (previous == null && input.hasAttribute("data-checklist-prev-checked")) {
        previous = input.getAttribute("data-checklist-prev-checked");
      }
      input.removeAttribute("data-checklist-prev-checked");
      return previous;
    };

    const updateSkipButtonState = (host, skip) => {
      if (!host || typeof host.querySelector !== "function") {
        return;
      }
      const button = host.querySelector("[data-checklist-skip-btn]");
      if (!button) {
        return;
      }
      if (skip) {
        button.classList.add("is-active");
        button.setAttribute("aria-pressed", "true");
      } else {
        button.classList.remove("is-active");
        button.setAttribute("aria-pressed", "false");
      }
    };

    const applySkipState = (input, host, skip, options = {}) => {
      if (!input) {
        return;
      }
      if (skip) {
        storePreviousCheckedState(input);
        if ("indeterminate" in input) {
          input.indeterminate = true;
        }
        input.checked = false;
        input.disabled = true;
        if (input.dataset) {
          input.dataset[CHECKLIST_SKIP_DATA_KEY] = "1";
        }
        input.setAttribute("data-checklist-skip", "1");
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
        updateSkipButtonState(host, true);
        return;
      }

      if ("indeterminate" in input) {
        input.indeterminate = false;
      }
      input.disabled = false;
      if (input.dataset) {
        delete input.dataset[CHECKLIST_SKIP_DATA_KEY];
      }
      input.removeAttribute("data-checklist-skip");
      let nextChecked = readPreviousCheckedState(input);
      if (nextChecked == null && Object.prototype.hasOwnProperty.call(options, "fallbackChecked")) {
        nextChecked = options.fallbackChecked ? "1" : "0";
        if (input.dataset) {
          input.dataset[CHECKLIST_PREV_CHECKED_KEY] = nextChecked;
        }
        input.setAttribute("data-checklist-prev-checked", nextChecked);
      }
      if (nextChecked != null) {
        const normalized = nextChecked === "1" || nextChecked === "true";
        input.checked = normalized;
      }
      if (host) {
        if (host.dataset) {
          delete host.dataset.checklistSkipped;
        }
        host.removeAttribute("data-checklist-skipped");
        if (host.classList && typeof host.classList.remove === "function") {
          host.classList.remove("checklist-item--skipped");
        }
        host.setAttribute("data-validated", input.checked ? "true" : "false");
      }
      updateSkipButtonState(host, false);
    };

    document.addEventListener("click", (event) => {
      const target = event?.target;
      if (!(target instanceof Element)) {
        return;
      }
      const button = target.closest("[data-checklist-skip-btn]");
      if (!button) {
        return;
      }
      const host = button.closest("[data-checklist-item]");
      const root = button.closest("[data-checklist-root]");
      if (!host || !root) {
        return;
      }
      const input = host.querySelector("[data-checklist-input]");
      if (!input) {
        return;
      }
      event.preventDefault();
      const wasSkipped =
        (input.dataset && input.dataset.checklistSkip === "1") ||
        (host.dataset && host.dataset.checklistSkipped === "1");
      const nextSkipped = !wasSkipped;
      applySkipState(input, host, nextSkipped);
      const changeEvent = new Event("change", { bubbles: true });
      input.dispatchEvent(changeEvent);
    });

    document.addEventListener("change", async (event) => {
      const target = event?.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
        return;
      }
      if (!target.matches("[data-checklist-input]")) {
        return;
      }
      const root = target.closest("[data-checklist-root]");
      const item = target.closest("[data-checklist-item]");
      if (!root || !item) {
        return;
      }
      const consigneId = root.getAttribute("data-consigne-id") || root.dataset.consigneId || null;
      const rootUid = ensureRootUid(root);
      const itemId = ensureItemId(target, root, item);
      const skipped =
        (target.dataset && target.dataset.checklistSkip === "1") ||
        (item.dataset && item.dataset.checklistSkipped === "1");
      // Log the raw change event context before any side effects
      try {
        console.info("[checklist-debug] change:event", {
          consigneId,
          itemId,
          checked: Boolean(target.checked),
          skipped,
          hydrating: root?.dataset?.checklistHydrating === "1",
          localDirty: root?.dataset?.checklistHydrationLocalDirty === "1",
        });
      } catch (_) {}
      if (skipped) {
        // L'élément est skippé: on réapplique le skip pour garantir la cohérence
        applySkipState(target, item, true);
      } else {
        // Chemin normal: ne pas appeler applySkipState(false) ici pour éviter de restaurer
        // un ancien état via data-checklist-prev-checked. On se contente de marquer validé.
        if (item) {
          item.setAttribute("data-validated", target.checked ? "true" : "false");
        }
      }
      // Marquer la saisie locale tout de suite pour protéger contre une réhydratation immédiate
      try {
        if (root && root.dataset) {
          root.dataset.checklistDirty = "1";
          root.dataset.checklistDirtyAt = String(Date.now());
        }
      } catch (_) {}
      updateHiddenState(root);
      const persistFn = window.ChecklistState?.persistRoot;
      if (typeof persistFn === "function") {
        const ctxUid = window.AppCtx?.user?.uid || null;
        const ctxDb = window.AppCtx?.db || null;
        // If a history date is set on this root, propagate it explicitly to ensure correct scoping
        const historyKey =
          root.getAttribute("data-checklist-history-date") ||
          (root.dataset ? root.dataset.checklistHistoryDate : null) ||
          null;
        // Derive page date from URL as a strong fallback (bilan pages)
        let urlDayKey = null;
        try {
          const hash = typeof window.location?.hash === "string" ? window.location.hash : "";
          const search = typeof window.location?.search === "string" ? window.location.search : "";
          const pick = (s) => {
            if (!s) return null;
            const m = String(s).match(/[?&]d=(\d{4}-\d{2}-\d{2})\b/i);
            return m ? m[1] : null;
          };
          urlDayKey = pick(search) || pick(hash) || null;
        } catch (_) {}
        const persistDayKey = historyKey || urlDayKey || (window.AppCtx?.dateIso || undefined);
        try {
          console.info("[checklist-debug] dayKey:resolve", {
            consigneId,
            persistDayKey: persistDayKey || null,
          });
        } catch (_) {}
        Promise.resolve(
          persistFn.call(window.ChecklistState, root, { uid: ctxUid, db: ctxDb, dateKey: persistDayKey })
        ).catch((error) => {
          console.warn("[app] checklist:persist", error);
        });
      }
  // déjà marqué ci-dessus
      // Determine event dayKey to scope updates to the correct day/root
      const historyKey =
        root.getAttribute("data-checklist-history-date") ||
        (root.dataset ? root.dataset.checklistHistoryDate : null) ||
        null;
      // Derive URL ?d as the preferred fallback to ensure summary context drives the dayKey
      let urlDayKey = null;
      try {
        const hash = typeof window.location?.hash === 'string' ? window.location.hash : '';
        const search = typeof window.location?.search === 'string' ? window.location.search : '';
        const pick = (s) => {
          if (!s) return null;
          const m = String(s).match(/[?&]d=(\d{4}-\d{2}-\d{2})\b/i);
          return m ? m[1] : null;
        };
        urlDayKey = pick(search) || pick(hash) || null;
      } catch (_) {}
      const eventDayKey = historyKey && String(historyKey).trim()
        ? String(historyKey).trim()
        : (urlDayKey || ((typeof window !== 'undefined' && window.AppCtx?.dateIso)
            ? String(window.AppCtx.dateIso)
            : (typeof Schema?.todayKey === 'function' ? Schema.todayKey() : null)));
      try {
        console.info("[checklist-debug] event:emit", {
          consigneId,
          itemId,
          dayKey: eventDayKey || null,
        });
      } catch (_) {}

      const detail = {
        consigneId,
        itemId,
        checked: Boolean(target.checked),
        skipped,
        type: "checklist",
        dayKey: eventDayKey || null,
        rootUid: rootUid || null,
      };
      let queueError = null;
      if (typeof window.queueSave === "function") {
        try {
          await window.queueSave({
            kind: "checklist-answer",
            consigneId,
            itemId,
            checked: Boolean(target.checked),
            ts: Date.now(),
          });
        } catch (error) {
          queueError = error;
        }
      }
      if (queueError) {
        console.error("Checklist save failed", queueError);
        document.dispatchEvent(
          new CustomEvent("answer:failed", {
            detail: { ...detail, err: queueError },
          })
        );
        return;
      }
      document.dispatchEvent(new CustomEvent("answer:saved", { detail }));
    });

    const HISTORY_LIMIT = 200;

    document.addEventListener("answer:saved", (event) => {
      const detail = event?.detail || {};
      if (detail.type !== "checklist") {
        return;
      }
      // Prioritize updates within the same root where the change originated
      let node = null;
      const targetRootUid = detail.rootUid || null;
      if (targetRootUid) {
        try {
          const scopedRoot = document.querySelector(`[data-checklist-root][data-checklist-root-uid="${toEscapedSelector(targetRootUid)}"]`);
          if (scopedRoot) {
            node = scopedRoot.querySelector(`[data-checklist-item][data-item-id="${toEscapedSelector(detail.itemId)}"]`);
          }
        } catch (error) {
          console.warn("[app] checklist:answer-saved:scope", error);
        }
      }
      // As a secondary guard, if a dayKey was provided, restrict updates to roots matching that dayKey
      if (!node && detail.dayKey) {
        const roots = Array.from(document.querySelectorAll("[data-checklist-root]"));
        const matchingRoots = roots.filter((r) => {
          const rk = r.getAttribute("data-checklist-history-date") || (r.dataset ? r.dataset.checklistHistoryDate : null) || null;
          if (rk && String(rk).trim()) {
            return String(rk).trim() === String(detail.dayKey).trim();
          }
          // If no explicit history date, fall back to current page date
          const pageKey = (typeof window !== 'undefined' && window.AppCtx?.dateIso) ? String(window.AppCtx.dateIso) : null;
          return pageKey != null && String(pageKey).trim() === String(detail.dayKey).trim();
        });
        for (const root of matchingRoots) {
          const candidate = root.querySelector(`[data-checklist-item][data-item-id="${toEscapedSelector(detail.itemId)}"]`);
          if (candidate) {
            node = candidate;
            break;
          }
        }
      }
      // Final fallback: do not update any node outside a scoped/matching root to avoid cross-day uniformization
      if (!node) {
        return;
      }
      if (node) {
        const ownerRoot = node.closest && node.closest("[data-checklist-root]");
        const isHistoryRoot = ownerRoot && (
          ownerRoot.getAttribute("data-checklist-history-date") ||
          (ownerRoot.dataset && ownerRoot.dataset.checklistHistoryDate)
        );
        // In history overlays, the native click already applied the UI change.
        // Avoid re-applying state here to prevent weird toggles; just add the visual feedback.
        if (isHistoryRoot) {
          node.classList.remove("saved-burst");
          void node.offsetWidth;
          node.classList.add("saved-burst");
          return;
        }
        const isSkipped = detail.skipped === true;
        if (isSkipped) {
          if (node.dataset) {
            node.dataset.checklistSkipped = "1";
          }
          node.setAttribute("data-checklist-skipped", "1");
          if (node.classList && typeof node.classList.add === "function") {
            node.classList.add("checklist-item--skipped");
          }
          node.setAttribute("data-validated", "skip");
        } else {
          if (node.dataset) {
            delete node.dataset.checklistSkipped;
          }
          node.removeAttribute("data-checklist-skipped");
          if (node.classList && typeof node.classList.remove === "function") {
            node.classList.remove("checklist-item--skipped");
          }
          node.setAttribute("data-validated", detail.checked ? "true" : "false");
        }
        const checkbox = node.querySelector?.("[data-checklist-input]") || node.querySelector?.('input[type="checkbox"]');
        if (checkbox instanceof HTMLInputElement) {
          applySkipState(checkbox, node, isSkipped, {
            fallbackChecked: Boolean(detail.checked),
          });
          if (!isSkipped) {
            checkbox.checked = Boolean(detail.checked);
            node.setAttribute("data-validated", checkbox.checked ? "true" : "false");
          }
        }
        node.classList.remove("saved-burst");
        void node.offsetWidth;
        node.classList.add("saved-burst");
      }
  const log = Array.isArray(window.historyLog) ? window.historyLog : [];
      window.historyLog = log;
      const entry = {
        consigneId: detail.consigneId || null,
        itemId: detail.itemId || null,
        type: detail.type,
        value: detail.skipped ? null : detail.checked ? 1 : 0,
        skipped: Boolean(detail.skipped),
        at: new Date().toISOString(),
      };
      log.unshift(entry);
      if (log.length > HISTORY_LIMIT) {
        log.length = HISTORY_LIMIT;
      }
      document.dispatchEvent(
        new CustomEvent("history:updated", {
          detail: {
            latest: entry,
            entries: log.slice(0, 20),
          },
        })
      );
    });

    document.addEventListener("answer:failed", (event) => {
      const detail = event?.detail || {};
      if (detail.type !== "checklist") {
        return;
      }
      const targetRootUid = detail.rootUid || null;
      const root = targetRootUid
        ? document.querySelector(`[data-checklist-root][data-checklist-root-uid="${toEscapedSelector(targetRootUid)}"]`)
        : null;
      let node = root
        ? root.querySelector(`[data-checklist-item][data-item-id="${toEscapedSelector(detail.itemId)}"]`)
        : null;
      if (node) {
        const ownerRoot = node.closest && node.closest("[data-checklist-root]");
        const isHistoryRoot = ownerRoot && (
          ownerRoot.getAttribute("data-checklist-history-date") ||
          (ownerRoot.dataset && ownerRoot.dataset.checklistHistoryDate)
        );
        // Avoid re-applying in history overlays (same rationale as in answer:saved)
        if (isHistoryRoot) {
          return;
        }
      }
      if (node) {
        node.classList.remove("saved-burst");
        const isSkipped = detail.skipped === true;
        if (isSkipped) {
          if (node.dataset) {
            node.dataset.checklistSkipped = "1";
          }
          node.setAttribute("data-checklist-skipped", "1");
          if (node.classList && typeof node.classList.add === "function") {
            node.classList.add("checklist-item--skipped");
          }
          node.setAttribute("data-validated", "skip");
        } else {
          if (node.dataset) {
            delete node.dataset.checklistSkipped;
          }
          node.removeAttribute("data-checklist-skipped");
          if (node.classList && typeof node.classList.remove === "function") {
            node.classList.remove("checklist-item--skipped");
          }
          node.setAttribute("data-validated", detail.checked ? "true" : "false");
        }
        const checkbox = node.querySelector?.("[data-checklist-input]") || node.querySelector?.('input[type="checkbox"]');
        if (checkbox instanceof HTMLInputElement) {
          applySkipState(checkbox, node, isSkipped, {
            fallbackChecked: Boolean(detail.checked),
          });
          if (!isSkipped) {
            checkbox.checked = Boolean(detail.checked);
            node.setAttribute("data-validated", checkbox.checked ? "true" : "false");
          }
        }
      }
    });

    const initializeStates = () => {
      const roots = Array.from(document.querySelectorAll("[data-checklist-root]"));
      roots.forEach((root) => {
        const boxes = Array.from(root.querySelectorAll("[data-checklist-input]"));
        boxes.forEach((input) => {
          const item = input.closest("[data-checklist-item]");
          if (!item) {
            return;
          }
          ensureItemId(input, root, item);
          item.setAttribute("data-validated", input.checked ? "true" : "false");
        });
      });
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initializeStates, { once: true });
    } else {
      initializeStates();
    }
  }

  window.installChecklistAutosaveEvents = installChecklistAutosaveEvents;
  installChecklistAutosaveEvents();

  const badgeManager = (() => {
    const DOW = ["DIM", "LUN", "MAR", "MER", "JEU", "VEN", "SAM"];
    let refreshPromise = null;

    function isBadgeSupported() {
      if (typeof navigator === "undefined") return false;
      return typeof navigator.setAppBadge === "function" || typeof navigator.setClientBadge === "function";
    }

    function resolveBadgeApi() {
      if (typeof navigator === "undefined") return { set: null, clear: null };
      const set = navigator.setAppBadge || navigator.setClientBadge;
      const clear = navigator.clearAppBadge || navigator.clearClientBadge;
      return { set, clear };
    }

    function isStandaloneDisplay() {
      try {
        const media = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)");
        return (media && media.matches) || window.navigator?.standalone === true;
      } catch (error) {
        return window.navigator?.standalone === true;
      }
    }

    async function applyBadgeValue(value) {
      const { set, clear } = resolveBadgeApi();
      if (!set) return;
      try {
        if (Number.isFinite(value) && value > 0) {
          await set.call(navigator, Math.round(value));
        } else if (clear) {
          await clear.call(navigator);
        } else {
          await set.call(navigator, 0);
        }
      } catch (error) {
        console.warn("[badge] apply", error);
      }
    }

    function normalizeDateLike(value) {
      const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
      if (Number.isNaN(date.getTime())) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        return now;
      }
      date.setHours(0, 0, 0, 0);
      return date;
    }

    function toDate(value) {
      if (!value) return null;
      if (value instanceof Date) return new Date(value.getTime());
      if (typeof value.toDate === "function") {
        try {
          const fromFirestore = value.toDate();
          if (fromFirestore instanceof Date && !Number.isNaN(fromFirestore.getTime())) {
            return fromFirestore;
          }
        } catch (error) {
          console.warn("[badge] toDate", error);
        }
      }
      if (typeof value === "number") {
        const asDate = new Date(value);
        if (!Number.isNaN(asDate.getTime())) return asDate;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const asDate = new Date(trimmed);
        if (!Number.isNaN(asDate.getTime())) return asDate;
      }
      return null;
    }

    function parseMonthKey(monthKey) {
      const [yearStr, monthStr] = String(monthKey || "").split("-");
      const year = Number(yearStr);
      const month = Number(monthStr);
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return null;
      }
      return { year, month };
    }

    function shiftMonthKey(baseKey, offset) {
      if (!Number.isFinite(offset)) return baseKey;
      const parsed = parseMonthKey(baseKey);
      if (!parsed) return baseKey;
      const base = new Date(parsed.year, parsed.month - 1 + offset, 1);
      return Schema.monthKeyFromDate(base);
    }

    function computeTheoreticalObjectiveDate(goal) {
      if (!goal) return null;
      const explicitEnd = toDate(goal.endDate);
      if (explicitEnd) {
        explicitEnd.setHours(0, 0, 0, 0);
        return explicitEnd;
      }
      if (goal.type === "hebdo") {
        const range = Schema.weekDateRange(goal.monthKey, goal.weekOfMonth || goal.weekIndex || 1);
        if (range?.end instanceof Date) {
          const end = new Date(range.end.getTime());
          end.setHours(0, 0, 0, 0);
          return end;
        }
      }
      if (goal.type === "mensuel") {
        const parsed = parseMonthKey(goal.monthKey);
        if (parsed) {
          const end = new Date(parsed.year, parsed.month, 0);
          end.setHours(0, 0, 0, 0);
          return end;
        }
      }
      const start = toDate(goal.startDate);
      if (start) {
        start.setHours(0, 0, 0, 0);
        return start;
      }
      return null;
    }

    function customObjectiveReminderDate(goal) {
      if (!goal) return null;
      const raw = goal.notifyAt ?? goal.notifyDate ?? goal.notificationDate ?? null;
      const custom = toDate(raw);
      if (!custom) return null;
      custom.setHours(0, 0, 0, 0);
      return custom;
    }

    async function countDailyPending(db, uid, targetDate) {
      if (!db || !uid) return 0;
      const date = normalizeDateLike(targetDate);
      const dayLabel = DOW[date.getDay()];
      const dayKey = Schema.dayKeyFromDate(date);
      let consignes = [];
      try {
        consignes = await Schema.fetchConsignes(db, uid, "daily");
      } catch (error) {
        console.warn("[badge] daily:consignes", error);
        return 0;
      }
      if (!Array.isArray(consignes) || !consignes.length) {
        return 0;
      }
      const todaysConsignes = consignes.filter((item) => {
        const days = Array.isArray(item.days) ? item.days : [];
        if (!days.length) return true;
        return days.includes(dayLabel);
      });
      if (!todaysConsignes.length) {
        return 0;
      }

      let responses = new Map();
      try {
        responses = await Schema.fetchDailyResponses(db, uid, dayKey);
      } catch (error) {
        console.warn("[badge] daily:responses", error);
        responses = new Map();
      }

      let count = 0;
      for (const consigne of todaysConsignes) {
        const hasResponse = responses instanceof Map && responses.has(consigne.id);
        if (hasResponse) {
          continue;
        }
        if (consigne.srEnabled === false) {
          count += 1;
          continue;
        }
        try {
          const state = await Schema.readSRState(db, uid, consigne.id, "consigne");
          const nextISO = state?.nextVisibleOn || state?.hideUntil;
          if (!nextISO) {
            count += 1;
            continue;
          }
          const next = new Date(nextISO);
          if (Number.isNaN(next.getTime()) || next <= date) {
            count += 1;
          }
        } catch (error) {
          console.warn("[badge] daily:sr", error);
          count += 1;
        }
      }
      return count;
    }

    async function countObjectivePending(db, uid, targetDate) {
      if (!db || !uid) return 0;
      const date = normalizeDateLike(targetDate);
      const targetIso = Schema.dayKeyFromDate(date);
      const currentMonthKey = Schema.monthKeyFromDate(date);
      const previousMonthKey = shiftMonthKey(currentMonthKey, -1);
      const monthKeys = new Set([currentMonthKey]);
      if (previousMonthKey && previousMonthKey !== currentMonthKey) {
        monthKeys.add(previousMonthKey);
      }

      const objectivesById = new Map();
      await Promise.all(
        Array.from(monthKeys).map(async (monthKey) => {
          if (!monthKey) return;
          try {
            const rows = await Schema.listObjectivesByMonth(db, uid, monthKey);
            if (!Array.isArray(rows)) return;
            rows.forEach((row) => {
              if (row && row.id) {
                objectivesById.set(row.id, row);
              }
            });
          } catch (error) {
            console.warn("[badge] goals:list", error);
          }
        })
      );

      if (!objectivesById.size) {
        return 0;
      }

      let count = 0;
      for (const objective of objectivesById.values()) {
        if (!objective || objective.notifyOnTarget === false) {
          continue;
        }
        const dueDate = customObjectiveReminderDate(objective) || computeTheoreticalObjectiveDate(objective);
        if (!dueDate) continue;
        const dueIso = Schema.dayKeyFromDate(dueDate);
        if (dueIso !== targetIso) continue;

        let entry = null;
        if (typeof Schema.getObjectiveEntry === "function") {
          try {
            entry = await Schema.getObjectiveEntry(db, uid, objective.id, targetIso);
          } catch (error) {
            console.warn("[badge] goals:entry", error);
          }
        }
        if (entry && entry.v !== undefined && entry.v !== null) {
          continue;
        }
        count += 1;
      }
      return count;
    }

    async function refresh(explicitUid, options = {}) {
      if (!isBadgeSupported()) {
        return 0;
      }
      if (!isStandaloneDisplay()) {
        await applyBadgeValue(0);
        return 0;
      }
      const db = ctx.db;
      const uid = explicitUid || ctx.user?.uid || null;
      if (!db || !uid) {
        await applyBadgeValue(0);
        return 0;
      }
      const date = normalizeDateLike(options.date || new Date());
      if (!refreshPromise) {
        refreshPromise = (async () => {
          const [daily, goals] = await Promise.all([
            countDailyPending(db, uid, date),
            countObjectivePending(db, uid, date),
          ]);
          const total = Number(daily || 0) + Number(goals || 0);
          await applyBadgeValue(total);
          return total;
        })().catch((error) => {
          console.warn("[badge] refresh", error);
          return 0;
        });
      }
      try {
        return await refreshPromise;
      } finally {
        refreshPromise = null;
      }
    }

    async function clear() {
      if (!isBadgeSupported()) return;
      await applyBadgeValue(0);
    }

    return {
      refresh,
      clear,
      isBadgeSupported,
      countDailyPending,
      countObjectivePending,
    };
  })();

  window.__appBadge = {
    refresh: (uid, options) => badgeManager.refresh(uid, options),
    clear: () => badgeManager.clear(),
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        badgeManager.refresh().catch(() => {});
      }
    });
  }

  let profileUnsubscribe = null;

  const PUSH_PREFS_KEY = "hp::push::prefs";
  let pushPrefsCache = null;
  let messagingInstancePromise = null;
  let serviceWorkerRegistrationPromise = null;
  let foregroundListenerBound = false;

  const INSTALL_TARGET_STORAGE_KEY = "hp::install::target";
  const INSTALL_TARGET_QUERY_PARAM = "installTarget";
  let currentInstallShortcutSuffix = "";
  let currentInstallShortcutTarget = null;

  function serializeInstallTargetCookieValue(normalized) {
    const params = new URLSearchParams();
    params.set(INSTALL_TARGET_QUERY_PARAM, normalized);
    return params.toString();
  }

  function readInstallTargetFromCookie() {
    if (typeof document === "undefined" || typeof document.cookie !== "string") {
      return null;
    }
    try {
      const prefix = `${INSTALL_TARGET_STORAGE_KEY}=`;
      const rawCookie = document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(prefix));
      if (!rawCookie) return null;
      const serialized = rawCookie.slice(prefix.length);
      if (!serialized) return null;
      const params = new URLSearchParams(serialized);
      const rawValue = params.get(INSTALL_TARGET_QUERY_PARAM);
      const normalized = normalizeInstallTargetHash(rawValue);
      if (!normalized) {
        clearInstallTargetCookie();
      }
      return normalized;
    } catch (error) {
      console.warn("[install] target:cookie:read", error);
      return null;
    }
  }

  function writeInstallTargetCookie(normalized) {
    if (typeof document === "undefined") {
      return false;
    }
    try {
      const serialized = serializeInstallTargetCookieValue(normalized);
      const maxAge = 60 * 60 * 24 * 365; // 1 an
      const secureFlag = window.location?.protocol === "https:" ? " Secure;" : "";
      document.cookie = `${INSTALL_TARGET_STORAGE_KEY}=${serialized}; Max-Age=${maxAge}; Path=/; SameSite=Lax;${secureFlag}`;
      return true;
    } catch (error) {
      console.warn("[install] target:cookie:write", error);
      return false;
    }
  }

  function clearInstallTargetCookie() {
    if (typeof document === "undefined") {
      return;
    }
    try {
      const secureFlag = window.location?.protocol === "https:" ? " Secure;" : "";
      document.cookie = `${INSTALL_TARGET_STORAGE_KEY}=; Max-Age=0; Path=/; SameSite=Lax;${secureFlag}`;
    } catch (error) {
      console.warn("[install] target:cookie:clear", error);
    }
  }

  function normalizeInstallTargetHash(hash) {
    if (!hash || typeof hash !== "string") return null;
    const trimmed = hash.trim();
    if (!trimmed) return null;

    if (/^#\/admin(?:\/|\?|$)/.test(trimmed)) {
      const [rawPath = "", searchPart = ""] = trimmed.split("?");
      const pathSegments = rawPath.replace(/^#\/+/g, "").split("/");
      if (!pathSegments[0]) {
        return "#/admin";
      }
      const normalizedPath = `#/${pathSegments.filter(Boolean).join("/") || "admin"}`;
      return searchPart ? `${normalizedPath}?${searchPart}` : normalizedPath;
    }

    if (!/^#\/u\//.test(trimmed)) return null;
    const [rawPath = "", searchPart = ""] = trimmed.split("?");
    const pathSegments = rawPath.replace(/^#\/+/g, "").split("/");
    if (!pathSegments[1]) return null;
    if (pathSegments.length < 3 || !pathSegments[2]) {
      pathSegments[2] = "daily";
    }
    const normalizedPath = `#/${pathSegments.filter(Boolean).join("/")}`;
    return searchPart ? `${normalizedPath}?${searchPart}` : normalizedPath;
  }

  function readInstallTargetFromQuery() {
    if (typeof window === "undefined" || typeof URL !== "function") {
      return null;
    }
    try {
      const url = new URL(window.location.href);
      const raw = url.searchParams.get(INSTALL_TARGET_QUERY_PARAM);
      if (!raw) return null;
      const normalized = normalizeInstallTargetHash(raw);
      if (!normalized) {
        // Nettoyage du paramètre invalide pour éviter les incohérences
        writeInstallTargetToQuery(null);
      }
      return normalized;
    } catch (error) {
      console.warn("[install] target:query:read", error);
      return null;
    }
  }

  function writeInstallTargetToQuery(normalized) {
    if (typeof window === "undefined" || typeof URL !== "function") {
      return false;
    }
    try {
      const url = new URL(window.location.href);
      const current = url.searchParams.get(INSTALL_TARGET_QUERY_PARAM);
      if (normalized) {
        if (current === normalized) return true;
        url.searchParams.set(INSTALL_TARGET_QUERY_PARAM, normalized);
      } else if (!current) {
        return true;
      } else {
        url.searchParams.delete(INSTALL_TARGET_QUERY_PARAM);
      }
      const nextUrl = url.toString();
      if (nextUrl !== window.location.href && typeof window.history?.replaceState === "function") {
        window.history.replaceState(null, "", nextUrl);
      }
      return true;
    } catch (error) {
      console.warn("[install] target:query:write", error);
      return false;
    }
  }

  function loadInstallTargetHash() {
    const fromQuery = readInstallTargetFromQuery();
    if (fromQuery) return fromQuery;
    const storage = getSafeStorage();
    if (storage) {
      try {
        const raw = storage.getItem(INSTALL_TARGET_STORAGE_KEY);
        const normalized = normalizeInstallTargetHash(raw);
        if (normalized) return normalized;
        if (raw) {
          storage.removeItem(INSTALL_TARGET_STORAGE_KEY);
        }
      } catch (error) {
        console.warn("[install] target:load", error);
      }
    }
    return readInstallTargetFromCookie();
  }

  function saveInstallTargetHash(hash) {
    const normalized = normalizeInstallTargetHash(hash);
    if (!normalized) return false;
    writeInstallTargetToQuery(normalized);
    let persisted = false;
    const storage = getSafeStorage();
    if (storage) {
      try {
        storage.setItem(INSTALL_TARGET_STORAGE_KEY, normalized);
        persisted = true;
      } catch (error) {
        console.warn("[install] target:save", error);
      }
    }
    if (writeInstallTargetCookie(normalized)) {
      persisted = true;
    }
    return persisted;
  }

  function rememberInstallTargetFromHash(hash) {
    const normalized = normalizeInstallTargetHash(hash);
    if (!normalized || !/^#\/u\//.test(normalized)) {
      return;
    }
    currentInstallShortcutTarget = normalized;
    try {
      const persisted = saveInstallTargetHash(normalized);
      if (
        window.__appInstallTarget &&
        typeof window.__appInstallTarget.save === "function" &&
        window.__appInstallTarget.save !== saveInstallTargetHash
      ) {
        window.__appInstallTarget.save(normalized);
      } else if (!persisted) {
        console.warn("[install] target:remember:persist", "no persistence layer available");
      }
    } catch (error) {
      console.warn("[install] target:remember", error);
    }
    syncInstallShortcutManifest("set-target").catch(() => {});
  }

  function clearInstallTargetHash() {
    currentInstallShortcutTarget = null;
    const storage = getSafeStorage();
    if (storage) {
      try {
        storage.removeItem(INSTALL_TARGET_STORAGE_KEY);
      } catch (error) {
        console.warn("[install] target:clear", error);
      }
    }
    clearInstallTargetCookie();
    try {
      writeInstallTargetToQuery(null);
    } catch (error) {
      console.warn("[install] target:clear:query", error);
    }
    syncInstallShortcutManifest("clear-target").catch(() => {});
  }

  window.__appInstallTarget = {
    save: saveInstallTargetHash,
    load: loadInstallTargetHash,
    clear: clearInstallTargetHash,
  };

  const installShortcutManager = (() => {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    const originalHref = manifestLink ? manifestLink.getAttribute("href") : null;
    const baseAppleTitle = appleTitleMeta?.getAttribute("content") || BASE_TITLE;
    const manifestFallback = {
      name: BASE_TITLE,
      short_name: BASE_SHORT_APP_NAME,
      description: "Suivi quotidien des habitudes et de la pratique.",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#f6f7fb",
      theme_color: "#3ea6eb",
      lang: "fr",
      dir: "ltr",
      icons: [
        {
          src: "data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%20512%20512%27%20role%3D%27img%27%20aria-label%3D%27Habitudes%20et%20Pratique%27%3E%0A%20%20%3Crect%20width%3D%27512%27%20height%3D%27512%27%20rx%3D%27116%27%20fill%3D%27%233EA6EB%27%2F%3E%0A%20%20%3Ctext%20x%3D%2750%25%27%20y%3D%2758%25%27%20text-anchor%3D%27middle%27%20font-family%3D%27%22Segoe%20UI%20Emoji%22%2C%20%22Apple%20Color%20Emoji%22%2C%20%22Noto%20Color%20Emoji%22%2C%20sans-serif%27%20font-size%3D%27260%27%3E%F0%9F%8C%B1%3C%2Ftext%3E%0A%3C%2Fsvg%3E",
          sizes: "any",
          type: "image/svg+xml"
        },
        {
          src: "data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%20512%20512%27%20role%3D%27img%27%20aria-label%3D%27Habitudes%20et%20Pratique%27%3E%0A%20%20%3Crect%20width%3D%27512%27%20height%3D%27512%27%20fill%3D%27%233EA6EB%27%20rx%3D%27116%27%2F%3E%0A%20%20%3Ctext%20x%3D%2750%25%27%20y%3D%2758%25%27%20text-anchor%3D%27middle%27%20font-family%3D%27%22Segoe%20UI%20Emoji%22%2C%20%22Apple%20Color%20Emoji%22%2C%20%22Noto%20Color%20Emoji%22%2C%20sans-serif%27%20font-size%3D%27260%27%3E%F0%9F%8C%B1%3C%2Ftext%3E%0A%3C%2Fsvg%3E",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any maskable"
        }
      ]
    };
    let baseManifest = null;
    let baseManifestPromise = null;
    let currentBlobUrl = null;
    let lastSuffix = null;
    let lastTarget = null;

    function cleanupBlobUrl() {
      if (!currentBlobUrl) return;
      try {
        URL.revokeObjectURL(currentBlobUrl);
      } catch (error) {
        console.warn("[install] manifest:revoke", error);
      }
      currentBlobUrl = null;
    }

    async function ensureBaseManifest() {
      if (baseManifest) return baseManifest;
      if (baseManifestPromise) return baseManifestPromise;
      if (!manifestLink || !originalHref) {
        baseManifestPromise = Promise.resolve(null);
        return baseManifestPromise;
      }
      const manifestUrl = new URL(originalHref, window.location.href);
      baseManifestPromise = fetch(manifestUrl.toString())
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then((data) => {
          baseManifest = data || null;
          return baseManifest;
        })
        .catch((error) => {
          console.warn("[install] manifest:load", error);
          return null;
        });
      return baseManifestPromise;
    }

    function computeLabel(base, suffix, maxLength) {
      const baseLabel = (base || "").trim();
      const trimmedSuffix = (suffix || "").trim();
      if (!trimmedSuffix) {
        return baseLabel || trimmedSuffix;
      }
      const separator = INSTALL_NAME_SEPARATOR;
      const candidate = `${trimmedSuffix}${separator}${baseLabel}`.trim();
      if (!maxLength || candidate.length <= maxLength) {
        return candidate;
      }
      const availableForSuffix = maxLength - baseLabel.length - separator.length;
      if (availableForSuffix <= 0) {
        return (baseLabel || candidate).slice(0, maxLength);
      }
      const ellipsis = "…";
      let suffixPart = trimmedSuffix;
      if (suffixPart.length > availableForSuffix) {
        if (availableForSuffix > ellipsis.length) {
          const room = Math.max(1, availableForSuffix - ellipsis.length);
          suffixPart = suffixPart.slice(0, room).trimEnd();
          if (!suffixPart) {
            suffixPart = trimmedSuffix.slice(0, room);
          }
          suffixPart = `${suffixPart}${ellipsis}`;
        } else {
          suffixPart = suffixPart.slice(0, availableForSuffix).trimEnd();
          if (!suffixPart) {
            suffixPart = trimmedSuffix.slice(0, availableForSuffix);
          }
        }
      }
      let result = `${suffixPart}${separator}${baseLabel}`.trim();
      if (result.length > maxLength) {
        result = result.slice(0, maxLength);
      }
      if (!result) {
        return candidate.slice(0, maxLength);
      }
      return result;
    }

    function computeStartUrl(baseUrl, normalizedTarget) {
      const fallbackStart = manifestFallback.start_url || "./";
      const baseValue = typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : fallbackStart;
      const [pathAndQueryPart = "", baseHash = ""] = baseValue.split("#");
      const [pathPartRaw = "", searchPart = ""] = pathAndQueryPart.split("?");
      const pathPart = pathPartRaw || (fallbackStart.includes("?") ? fallbackStart.split("?")[0] : fallbackStart) || "./";
      const searchParams = new URLSearchParams(searchPart || "");
      if (normalizedTarget) {
        searchParams.set(INSTALL_TARGET_QUERY_PARAM, normalizedTarget);
      } else {
        searchParams.delete(INSTALL_TARGET_QUERY_PARAM);
      }
      const searchString = searchParams.toString();
      const query = searchString ? `?${searchString}` : "";
      let hash = "";
      if (normalizedTarget) {
        hash = normalizedTarget.startsWith("#") ? normalizedTarget : `#${normalizedTarget}`;
      } else if (baseHash) {
        hash = `#${baseHash}`;
      }
      return `${pathPart}${query}${hash}`;
    }

    async function applySuffix(nextSuffix, targetUrl) {
      const targetSuffix = (nextSuffix || "").trim();
      const normalizedTarget = normalizeInstallTargetHash(targetUrl) || null;
      if (lastSuffix === targetSuffix && lastTarget === normalizedTarget) {
        return;
      }
      lastSuffix = targetSuffix;
      lastTarget = normalizedTarget;
      const baseData = await ensureBaseManifest();
      const manifestSource = baseData || manifestFallback;
      const baseName = manifestSource?.name || BASE_TITLE;
      const baseShortName = manifestSource?.short_name || BASE_SHORT_APP_NAME;
      const baseStartUrl = manifestSource?.start_url || manifestFallback.start_url || "./";
      if (!targetSuffix && !normalizedTarget) {
        cleanupBlobUrl();
        if (manifestLink && originalHref) {
          manifestLink.setAttribute("href", originalHref);
        }
        if (appleTitleMeta) {
          appleTitleMeta.setAttribute("content", baseAppleTitle);
        }
        return;
      }
      const manifestCopy = JSON.parse(JSON.stringify(manifestSource || {}));
      manifestCopy.name = computeLabel(baseName, targetSuffix, 60);
      manifestCopy.short_name = computeLabel(baseShortName, targetSuffix, 30);
      manifestCopy.start_url = computeStartUrl(baseStartUrl, normalizedTarget);
      if (appleTitleMeta) {
        appleTitleMeta.setAttribute("content", computeLabel(baseAppleTitle, targetSuffix, 48));
      }
      if (!manifestLink) {
        return;
      }
      try {
        const blob = new Blob([JSON.stringify(manifestCopy)], { type: "application/manifest+json" });
        cleanupBlobUrl();
        const blobUrl = URL.createObjectURL(blob);
        manifestLink.setAttribute("href", blobUrl);
        currentBlobUrl = blobUrl;
      } catch (error) {
        console.warn("[install] manifest:update", error);
      }
    }

    return { applySuffix };
  })();

  function syncInstallShortcutManifest(context) {
    if (!installShortcutManager || typeof installShortcutManager.applySuffix !== "function") {
      return Promise.resolve();
    }
    return installShortcutManager.applySuffix(currentInstallShortcutSuffix, currentInstallShortcutTarget).catch((error) => {
      if (context) {
        console.warn(`[install] manifest:${context}`, error);
      } else {
        console.warn("[install] manifest", error);
      }
      throw error;
    });
  }

  const storedInstallShortcutTarget =
    window.__appInstallTarget && typeof window.__appInstallTarget.load === "function"
      ? window.__appInstallTarget.load()
      : null;
  if (storedInstallShortcutTarget && /^#\/u\//.test(storedInstallShortcutTarget)) {
    currentInstallShortcutTarget = storedInstallShortcutTarget;
  }
  syncInstallShortcutManifest("startup").catch(() => {});

  function normalizeInstallSuffix(rawValue) {
    if (typeof rawValue !== "string") {
      return "";
    }
    const trimmed = rawValue.trim();
    if (!trimmed) return "";
    const normalized = typeof trimmed.normalize === "function" ? trimmed.normalize("NFKC") : trimmed;
    const lower = normalized.toLowerCase();
    if (lower === "utilisateur") {
      return "";
    }
    return trimmed;
  }

  async function updateInstallShortcutLabel(rawValue) {
    const suffix = normalizeInstallSuffix(rawValue);
    currentInstallShortcutSuffix = suffix;
    await syncInstallShortcutManifest("label");
  }

  function safeUpdateInstallShortcutLabel(rawValue, context) {
    const { segments } = parseHash(ctx.route || window.location.hash || "#/admin");
    const routeKey = segments[0] || "admin";
    let targetValue = rawValue;
    if (routeKey === "admin") {
      const normalized = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
      if (normalized !== "admin") {
        targetValue = "Admin";
      }
    }
    updateInstallShortcutLabel(targetValue).catch((error) => {
      if (context) {
        console.warn(`[install] label:${context}`, error);
      } else {
        console.warn("[install] label", error);
      }
    });
  }

  function resolveInstallLabelFromProfile(profile) {
    if (!profile) return "";
    return profile.displayName || profile.name || profile.slug || "";
  }

  function getSafeStorage() {
    try {
      return window.localStorage;
    } catch (error) {
      console.warn("[push] storage inaccessible", error);
      return null;
    }
  }

  function loadPushPrefs() {
    if (pushPrefsCache) return pushPrefsCache;
    const storage = getSafeStorage();
    if (!storage) {
      pushPrefsCache = {};
      return pushPrefsCache;
    }
    try {
      const raw = storage.getItem(PUSH_PREFS_KEY);
      if (!raw) {
        pushPrefsCache = {};
        return pushPrefsCache;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        pushPrefsCache = {};
        return pushPrefsCache;
      }
      pushPrefsCache = parsed;
    } catch (error) {
      console.warn("[push] prefs:parse", error);
      pushPrefsCache = {};
    }
    return pushPrefsCache;
  }

  function savePushPrefs(nextPrefs) {
    pushPrefsCache = nextPrefs || {};
    const storage = getSafeStorage();
    if (!storage) return;
    try {
      storage.setItem(PUSH_PREFS_KEY, JSON.stringify(pushPrefsCache));
    } catch (error) {
      console.warn("[push] prefs:save", error);
    }
  }

  function getPushPreference(uid) {
    if (!uid) return null;
    const prefs = loadPushPrefs();
    return prefs[uid] || null;
  }

  function setPushPreference(uid, value) {
    if (!uid) return;
    const prefs = { ...loadPushPrefs() };
    prefs[uid] = { ...(prefs[uid] || {}), ...value };
    savePushPrefs(prefs);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  }

  function isStandaloneModeActive() {
    if (typeof window === "undefined") return false;
    try {
      if (typeof window.matchMedia === "function") {
        const media = window.matchMedia("(display-mode: standalone)");
        if (media && typeof media.matches === "boolean" && media.matches) {
          return true;
        }
      }
    } catch (error) {
      // ignore matchMedia errors, fallback to navigator.standalone
    }
    return window.navigator?.standalone === true;
  }

  function isIosDevice() {
    if (typeof navigator === "undefined") return false;
    const platform = navigator.platform || "";
    const userAgent = navigator.userAgent || "";
    const maxTouchPoints = Number(navigator.maxTouchPoints || 0);
    const directMatch = /iPad|iPhone|iPod/.test(platform);
    const ipadOs13Plus = /MacIntel/.test(platform) && maxTouchPoints > 1;
    const uaMatch = /iphone|ipad|ipod/i.test(userAgent);
    return directMatch || ipadOs13Plus || uaMatch;
  }

  function isPushSupported() {
    return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
  }

  async function ensureMessagingInstance() {
    if (messagingInstancePromise) return messagingInstancePromise;
    messagingInstancePromise = (async () => {
      const supported = typeof firebaseCompatApp?.messaging?.isSupported === "function"
        ? await firebaseCompatApp.messaging.isSupported()
        : false;
      if (!supported) {
        console.info("[push] messaging non supporté");
        return null;
      }
      try {
        return ctx.app ? firebaseCompatApp.messaging(ctx.app) : firebaseCompatApp.messaging();
      } catch (error) {
        console.warn("[push] messaging indisponible", error);
        return null;
      }
    })();
    return messagingInstancePromise;
  }

  async function ensureServiceWorkerRegistration() {
    if (serviceWorkerRegistrationPromise) return serviceWorkerRegistrationPromise;
    if (window.__appSWRegistrationPromise) {
      serviceWorkerRegistrationPromise = window.__appSWRegistrationPromise;
      return serviceWorkerRegistrationPromise;
    }
    if (!("serviceWorker" in navigator)) return null;
    const basePath = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}`;
    const primarySwUrl = new URL(PRIMARY_SERVICE_WORKER_FILE, basePath);
    const legacySwUrl = new URL(LEGACY_SERVICE_WORKER_FILE, basePath);
    serviceWorkerRegistrationPromise = (async () => {
      try {
        const existing = await navigator.serviceWorker.getRegistration();
        if (existing) {
          const scriptUrl =
            existing.active?.scriptURL ||
            existing.installing?.scriptURL ||
            existing.waiting?.scriptURL ||
            "";
          const knownSuffixes = [
            `/${PRIMARY_SERVICE_WORKER_FILE}`,
            `/${LEGACY_SERVICE_WORKER_FILE}`,
          ];
          if (!knownSuffixes.some((suffix) => scriptUrl.endsWith(suffix))) {
            existing.update().catch((error) => {
              console.warn("[push] sw:update", error);
            });
          }
          return existing;
        }
      } catch (error) {
        console.warn("[push] sw:getRegistration", error);
      }
      try {
        const registration = await navigator.serviceWorker.register(primarySwUrl.href, {
          scope: "./",
        });
        window.__appSWRegistrationPromise = Promise.resolve(registration);
        return registration;
      } catch (error) {
        console.warn("[push] sw:register", error);
        if (primarySwUrl.href !== legacySwUrl.href) {
          try {
            const fallbackRegistration = await navigator.serviceWorker.register(
              legacySwUrl.href,
              { scope: "./" }
            );
            window.__appSWRegistrationPromise = Promise.resolve(fallbackRegistration);
            return fallbackRegistration;
          } catch (fallbackError) {
            console.warn("[push] sw:register:fallback", fallbackError);
          }
        }
        return null;
      }
    })();
    window.__appSWRegistrationPromise = serviceWorkerRegistrationPromise;
    return serviceWorkerRegistrationPromise;
  }

  function bindForegroundNotifications(messaging) {
    if (foregroundListenerBound) return;
    if (!messaging || typeof messaging.onMessage !== "function") return;
    try {
      messaging.onMessage((payload = {}) => {
        const notification = payload.notification || {};
        const data = payload.data || {};

        const hasNotificationPayload = Boolean(
          (notification && notification.title) || notification.body
        );

        if (hasNotificationPayload) {
          // Le payload "notification" est affiché automatiquement par Firebase.
          return;
        }

        try {
          const title = data.title || "Rappel";
          const body =
            data.body || "Tu as des éléments à remplir aujourd’hui.";
          const link = data.link || "/";

          const notificationInstance = new Notification(title, {
            body,
            icon: data.icon || DEFAULT_NOTIFICATION_ICON,
            badge: data.badge || "/badge.png",
            data: { link },
          });

          if (notificationInstance && typeof notificationInstance.addEventListener === "function") {
            notificationInstance.addEventListener("click", () => {
              if (link) window.open(link, "_blank");
            });
          }
        } catch (error) {
          console.warn("[push] foreground:notify", error);
        }
      });
      foregroundListenerBound = true;
    } catch (error) {
      console.warn("[push] foreground:onMessage", error);
    }
  }

  async function preparePushToken({ interactive = false } = {}) {
    const requiresHomeScreenInstall = isIosDevice() && !isStandaloneModeActive();

    if (interactive && requiresHomeScreenInstall) {
      const instructions = [
        "Pour recevoir les notifications sur iPhone/iPad :",
        "1. Ouvre Habitudes & Pratique dans Safari.",
        "2. Appuie sur le bouton « Partager » (carré avec une flèche).",
        "3. Choisis « Ajouter à l’écran d’accueil » pour installer l’app.",
        "4. Depuis l’icône sur l’écran d’accueil, rouvre l’app puis appuie sur « Activer les notifications ».",
      ].join("\n");
      alert(instructions);
      return null;
    }

    if (!isPushSupported()) {
      if (interactive) alert("Les notifications ne sont pas disponibles sur ce navigateur.");
      return null;
    }

    let permission = "denied";
    try {
      permission = Notification.permission;
      if (interactive || permission === "default") {
        permission = await Notification.requestPermission();
      }
    } catch (error) {
      console.warn("[push] permission:error", error);
      if (interactive) alert("Impossible de demander l’autorisation de notifications.");
      return null;
    }

    if (permission !== "granted") {
      if (interactive) alert("Permission de notifications refusée.");
      return null;
    }

    const messaging = await ensureMessagingInstance();
    if (!messaging) {
      if (interactive) alert("Impossible d’initialiser le service de notifications Firebase.");
      return null;
    }

    const registration = await ensureServiceWorkerRegistration();
    if (!registration) {
      if (interactive) alert("Impossible d’initialiser le service worker des notifications.");
      return null;
    }

    let token = null;
    try {
      token = await messaging.getToken({
        vapidKey: "BMKhViKlpYs9dtqHYQYIU9rmTJQA3rPUP2h5Mg1YlA6lUs4uHk74F8rT9y8hT1U2N4M-UUE7-YvbAjYfTpjA1nM",
        serviceWorkerRegistration: registration
      });
    } catch (error) {
      console.warn("[push] getToken", error);
      if (interactive) alert("Impossible de récupérer le jeton de notifications.");
      return null;
    }

    if (!token) {
      if (interactive) alert("Impossible de récupérer le jeton de notifications.");
      return null;
    }

    return { token, messaging };
  }

  async function enablePushForUid(uid, { interactive = false } = {}) {
    if (!uid || !ctx.db) return false;

    const setup = await preparePushToken({ interactive });
    if (!setup) return false;

    try {
      await Schema.savePushToken(ctx.db, uid, setup.token);
      setPushPreference(uid, { token: setup.token, enabled: true, updatedAt: Date.now() });
      bindForegroundNotifications(setup.messaging);
      return true;
    } catch (error) {
      console.warn("[push] saveToken", error);
      if (interactive) alert("Impossible d’enregistrer le jeton de notifications.");
      return false;
    }
  }

  async function disablePushForUid(uid, { interactive = false } = {}) {
    if (!uid || !ctx.db) return false;
    const pref = getPushPreference(uid);
    const token = pref?.token;
    if (!token) {
      setPushPreference(uid, { enabled: false });
      return true;
    }
    try {
      await Schema.disablePushToken(ctx.db, uid, token);
      setPushPreference(uid, { enabled: false, token, updatedAt: Date.now() });
      return true;
    } catch (error) {
      console.warn("[push] disableToken", error);
      if (interactive) alert("Impossible de désactiver les notifications pour cet utilisateur.");
      return false;
    }
  }

  function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
      btn.dataset.loading = "1";
      btn.disabled = true;
      btn.classList.add("opacity-60");
    } else {
      btn.classList.remove("opacity-60");
      btn.dataset.loading = "0";
      if (isPushSupported()) {
        btn.disabled = false;
      }
    }
  }

  function syncNotificationButtonsForUid(uid) {
    if (!uid) return;
    const pref = getPushPreference(uid);
    const enabled = !!(pref && pref.enabled && pref.token);
    const requiresHomeScreenInstall = isIosDevice() && !isStandaloneModeActive();
    const selector = `[data-notif-toggle][data-uid="${cssEscape(uid)}"]`;
    queryAll(selector).forEach((btn) => {
      btn.dataset.enabled = enabled ? "1" : "0";
      const label = enabled ? "🔕 Désactiver les notifications" : "🔔 Activer les notifications";
      btn.textContent = label;
      if (!isPushSupported()) {
        btn.disabled = true;
        btn.title = "Notifications non disponibles sur cet appareil";
      } else if (requiresHomeScreenInstall) {
        btn.disabled = false;
        btn.title =
          "Installe d’abord l’app sur l’écran d’accueil via Safari, puis rouvre-la pour appuyer sur « Activer les notifications ».";
      } else if (!btn.dataset.loading || btn.dataset.loading === "0") {
        btn.disabled = false;
        btn.title = enabled ? "Désactiver les notifications" : "Activer les notifications";
      }
    });

    if (ctx.user?.uid === uid) {
      const status = queryOne("#notification-status");
      if (status) {
        if (!isPushSupported()) {
          status.textContent = "Les notifications ne sont pas disponibles sur ce navigateur.";
        } else if (requiresHomeScreenInstall) {
          status.textContent =
            "Pour activer les notifications sur iPhone/iPad, ajoute d’abord l’app à l’écran d’accueil via Safari (Partager > Ajouter à l’écran d’accueil), puis ouvre-la depuis l’icône avant d’appuyer sur « Activer les notifications ».";
        } else if (enabled) {
          status.textContent = "Notifications actives sur cet appareil. Utilise le menu ⋮ pour les gérer.";
        } else {
          status.textContent = "Notifications désactivées sur cet appareil. Active-les depuis le menu ⋮.";
        }
      }
    }
  }

  async function handleNotificationToggle(uid, trigger, { interactive = false } = {}) {
    if (!uid) return;

    if (interactive) {
      const { segments } = parseHash(ctx.route || window.location.hash || "#/admin");
      const routeKey = segments[0] || "admin";
      const routeUid = segments[1] || null;
      const activeUid = ctx.user?.uid || null;
      const managingOwnNotifications = routeKey === "u" && routeUid === uid && activeUid === uid;

      if (!managingOwnNotifications) {
        appLog("push:toggle:blocked", { uid, routeKey, routeUid, activeUid });
        alert("Active les notifications depuis l’app de l’utilisateur.");
        return;
      }
    }

    const pref = getPushPreference(uid);
    const enabled = !!(pref && pref.enabled && pref.token);
    setButtonLoading(trigger, true);
    try {
      if (enabled) {
        await disablePushForUid(uid, { interactive });
      } else {
        await enablePushForUid(uid, { interactive });
      }
    } catch (error) {
      console.warn("[push] toggle:error", error);
      if (interactive) alert("Impossible de mettre à jour les notifications.");
    } finally {
      setButtonLoading(trigger, false);
      if (trigger && !isPushSupported()) {
        trigger.disabled = true;
      }
      syncNotificationButtonsForUid(uid);
    }
  }

  async function refreshUserBadge(uid, explicitName = null) {
    const el = document.querySelector("[data-username]");
    if (!el) return;
    const { segments } = parseHash(ctx.route || location.hash || "#/admin");
    const routeKey = segments[0] || "admin";
    const isAdminRoute = routeKey === "admin";

    const applyBadge = (label, updateTitle = true) => {
      appLog("badge:update", { label, updateTitle });
      el.textContent = label;
      if (!updateTitle) return;
      if (!label || label === "…") {
        document.title = BASE_TITLE;
        return;
      }
      document.title = `${BASE_TITLE} — ${label}`;
    };

    if (isAdminRoute) {
      applyBadge("Admin");
      safeUpdateInstallShortcutLabel("Admin", "admin-route");
      return;
    }

    if (explicitName != null) {
      const safeName = explicitName || "Utilisateur";
      applyBadge(safeName);
      safeUpdateInstallShortcutLabel(safeName, "explicit");
      return;
    }

    if (!uid) {
      applyBadge("Utilisateur");
      safeUpdateInstallShortcutLabel(null, "missing-uid");
      return;
    }
    applyBadge("…", false);
    try {
      const resolved = await Schema.getUserName(uid);
      const label = resolved || "Utilisateur";
      applyBadge(label);
      safeUpdateInstallShortcutLabel(resolved, "resolved");
    } catch (err) {
      console.warn("refreshUserBadge", err);
      applyBadge("Utilisateur");
      safeUpdateInstallShortcutLabel(null, "resolve-error");
    }
  }

  function setupProfileWatcher(db, uid) {
    appLog("profile:watch:setup", { uid });
    if (typeof profileUnsubscribe === "function") {
      try {
        profileUnsubscribe();
        appLog("profile:watch:cleanup", { uid });
      } catch (error) {
        console.warn("profile:watch:cleanup", error);
      }
      profileUnsubscribe = null;
    }
    if (!db || !uid || typeof db.collection !== "function") {
      appLog("profile:watch:skip", { uid, reason: "missing-db-or-uid" });
      return;
    }
    try {
      const ref = db.collection("u").doc(uid);
      if (!ref || typeof ref.onSnapshot !== "function") {
        appLog("profile:watch:skip", { uid, reason: "missing-onSnapshot" });
        return;
      }
      profileUnsubscribe = ref.onSnapshot(
        (snap) => {
          if (!snapshotExists(snap)) return;
          const data = snap.data() || {};
          ctx.profile = { ...(ctx.profile || {}), ...data, uid };
          renderSidebar();
          syncSheetsMenuVisibility();
          refreshUserBadge(uid, data.displayName || data.name || data.slug || "Utilisateur");
          safeUpdateInstallShortcutLabel(resolveInstallLabelFromProfile(ctx.profile), "profile-watch");
          appLog("profile:watch:update", { uid, hasData: !!Object.keys(data || {}).length });
        },
        (error) => {
          console.warn("profile:watch:error", error);
        }
      );
      appLog("profile:watch:bound", { uid });
    } catch (error) {
      console.warn("profile:watch:error", error);
    }
  }

  const queryOne = (sel) => document.querySelector(sel);

  const queryAll = (sel) => Array.from(document.querySelectorAll(sel));

  const userActions = {
    container: document.getElementById("user-actions"),
    trigger: document.getElementById("user-actions-trigger"),
    panel: document.getElementById("user-actions-panel"),
    notif: document.getElementById("user-actions-notifications"),
    archives: document.getElementById("user-actions-archives"),
    toggleHistory: document.getElementById("user-actions-toggle-history"),
    exportSheets: document.getElementById("user-actions-export-sheets"),
    stats: document.getElementById("user-actions-stats"),
    install: document.getElementById("install-app-button"),
  };

  let userActionsOpen = false;

  function closeUserActionsMenu() {
    if (userActions.panel) {
      userActions.panel.classList.add("hidden");
    }
    if (userActions.trigger) {
      userActions.trigger.setAttribute("aria-expanded", "false");
    }
    userActionsOpen = false;
  }

  function openUserActionsMenu() {
    try {
      window.Modes?.updateHistoryNaToggleButton?.();
    } catch (_) { }
    if (userActions.panel) {
      userActions.panel.classList.remove("hidden");
    }
    if (userActions.trigger) {
      userActions.trigger.setAttribute("aria-expanded", "true");
    }
    userActionsOpen = true;
  }

  function toggleUserActionsMenu() {
    if (userActionsOpen) closeUserActionsMenu();
    else openUserActionsMenu();
  }

  function setUserActionsVisibility(visible) {
    if (!userActions.container) return;
    if (visible) {
      userActions.container.classList.remove("hidden");
      userActions.container.setAttribute("aria-hidden", "false");
    } else {
      userActions.container.classList.add("hidden");
      userActions.container.setAttribute("aria-hidden", "true");
      closeUserActionsMenu();
      if (userActions.notif) {
        userActions.notif.dataset.uid = "";
        userActions.notif.disabled = true;
      }
    }
  }

  function updateUserActionsTarget(uid) {
    if (!userActions.notif) return;
    if (!uid) {
      userActions.notif.dataset.uid = "";
      userActions.notif.disabled = true;
      return;
    }
    userActions.notif.dataset.uid = uid;
    if (!isPushSupported()) {
      userActions.notif.disabled = true;
      userActions.notif.title = "Notifications non disponibles sur cet appareil";
    } else {
      userActions.notif.disabled = false;
      userActions.notif.removeAttribute("title");
    }
  }

  const GOOGLE_OAUTH_CLIENT_ID =
    "739389871966-gsbgn9tfg0vnv3imtsfvtn4rgn7emafu.apps.googleusercontent.com";
  const GOOGLE_OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
  ].join(" ");
  const GOOGLE_TOKEN_STORAGE_KEY = "hp::google::access_token";
  const GOOGLE_TOKEN_EXP_STORAGE_KEY = "hp::google::access_token_expires_at";
  let googleTokenClient = null;

  function readStoredGoogleAccessToken() {
    try {
      const token = window.sessionStorage?.getItem(GOOGLE_TOKEN_STORAGE_KEY) || "";
      const rawExp = window.sessionStorage?.getItem(GOOGLE_TOKEN_EXP_STORAGE_KEY) || "";
      const expiresAt = rawExp ? Number(rawExp) : 0;
      if (!token || !expiresAt || Number.isNaN(expiresAt)) return null;
      if (Date.now() >= expiresAt - 15_000) return null;
      return token;
    } catch (_) {
      return null;
    }
  }

  function storeGoogleAccessToken(token, expiresInSeconds) {
    try {
      const expiresAt = Date.now() + Math.max(0, Number(expiresInSeconds) || 0) * 1000;
      window.sessionStorage?.setItem(GOOGLE_TOKEN_STORAGE_KEY, token);
      window.sessionStorage?.setItem(GOOGLE_TOKEN_EXP_STORAGE_KEY, String(expiresAt));
    } catch (_) { }
  }

  function clearStoredGoogleAccessToken() {
    try {
      window.sessionStorage?.removeItem(GOOGLE_TOKEN_STORAGE_KEY);
      window.sessionStorage?.removeItem(GOOGLE_TOKEN_EXP_STORAGE_KEY);
    } catch (_) { }
  }

  function waitForGoogleOAuth(timeoutMs = 12_000) {
    if (window.google?.accounts?.oauth2?.initTokenClient) {
      return Promise.resolve(true);
    }
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (window.google?.accounts?.oauth2?.initTokenClient) {
          window.clearInterval(timer);
          resolve(true);
          return;
        }
        if (Date.now() - started > timeoutMs) {
          window.clearInterval(timer);
          reject(new Error("Google OAuth indisponible"));
        }
      }, 120);
    });
  }

  async function getGoogleAccessToken({ interactive = true } = {}) {
    const cached = readStoredGoogleAccessToken();
    if (cached) return cached;
    await waitForGoogleOAuth();
    if (!GOOGLE_OAUTH_CLIENT_ID) {
      throw new Error("Google OAuth client_id manquant");
    }
    return new Promise((resolve, reject) => {
      googleTokenClient =
        googleTokenClient ||
        window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_OAUTH_CLIENT_ID,
          scope: GOOGLE_OAUTH_SCOPES,
          callback: () => { },
        });

      googleTokenClient.callback = (resp) => {
        if (!resp) {
          reject(new Error("Autorisation Google annulée"));
          return;
        }
        if (resp.error) {
          clearStoredGoogleAccessToken();
          reject(new Error(resp.error_description || resp.error));
          return;
        }
        const token = resp.access_token;
        if (!token) {
          reject(new Error("Token Google manquant"));
          return;
        }
        storeGoogleAccessToken(token, resp.expires_in);
        resolve(token);
      };

      try {
        googleTokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
      } catch (error) {
        reject(error);
      }
    });
  }

  function resolveLastExportSheetId() {
    const profile = ctx.profile || {};
    const exportState = profile.exportSheets || profile.export_sheets || null;
    if (!exportState || typeof exportState !== "object") return null;
    const sheetId = exportState.spreadsheetId || exportState.spreadsheet_id || null;
    return typeof sheetId === "string" && sheetId.trim() ? sheetId.trim() : null;
  }

  function syncSheetsMenuVisibility() {
    // refresh button removed; keep for future extensions.
  }

  async function googleApiJson(url, { method = "GET", token, body } = {}) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const message = data?.error?.message || data?.message || `Erreur Google (${res.status})`;
      const error = new Error(message);
      error.status = res.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  function cellValueForSheets(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "boolean") return value ? "1" : "0";
    if (value && typeof value === "object") {
      if (value.kind === "richtext") {
        const text = typeof value.text === "string" ? value.text.trim() : "";
        if (text) return text;
        const html = typeof value.html === "string" ? value.html : "";
        if (html && typeof document !== "undefined") {
          try {
            const el = document.createElement("div");
            el.innerHTML = html;
            const plain = (el.textContent || "").trim();
            if (plain) return plain;
          } catch (_) { }
        }
      }
      const noteKeys = ["note", "comment", "remark", "text", "message"];
      for (const key of noteKeys) {
        const candidate = value[key];
        if (typeof candidate === "string") {
          const trimmed = candidate.trim();
          if (trimmed) return trimmed;
        }
      }
    }
    const maybeDate = value && typeof value.toDate === "function" ? value.toDate() : null;
    if (maybeDate instanceof Date && !Number.isNaN(maybeDate.getTime())) {
      return maybeDate.toISOString();
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  function makeRowsFromObjectsAuto(items) {
    const list = Array.isArray(items) ? items : [];
    const keySet = new Set();
    list.forEach((item) => {
      if (!item || typeof item !== "object") return;
      Object.keys(item).forEach((k) => keySet.add(k));
    });
    const keys = Array.from(keySet);
    keys.sort();
    const header = keys.length ? keys : ["id"];
    const rows = list.map((item) => header.map((k) => cellValueForSheets(item?.[k])));
    return [header, ...rows];
  }

  function toDayKey(value) {
    if (!value) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
      if (trimmed.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
      return null;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value.toDate === "function") {
      try {
        const d = value.toDate();
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      } catch (_) { }
    }
    if (typeof value === "number") {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return null;
  }

  function pickRecentSorted(values, limitCount) {
    const list = Array.from(new Set((values || []).filter(Boolean)));
    list.sort((a, b) => a.localeCompare(b));
    const max = Math.max(1, Number(limitCount) || 0);
    if (list.length <= max) return list;
    return list.slice(list.length - max);
  }

  function toMillisSafe(value) {
    if (!value) return 0;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
    if (value && typeof value.toDate === "function") {
      try {
        const d = value.toDate();
        if (d instanceof Date && Number.isFinite(d.getTime())) return d.getTime();
      } catch (_) { }
    }
    const parsed = new Date(value);
    const ms = parsed.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }

  function normalizeConsigneTitle(consigne) {
    const label =
      consigne?.text ||
      consigne?.titre ||
      consigne?.title ||
      consigne?.label ||
      consigne?.name ||
      "";
    return String(label || "").trim() || String(consigne?.id || "");
  }

  function monthKeyFromDayKey(dayKey) {
    if (!dayKey || typeof dayKey !== "string") return null;
    const trimmed = dayKey.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
    return trimmed.slice(0, 7);
  }

  function buildResponseIndex(rows, { sessionDayKeyById = null } = {}) {
    const index = new Map();
    (rows || []).forEach((row) => {
      const consigneId = row?.consigneId || row?.consigne_id || row?.consigne || null;
      if (!consigneId) return;
      let dayKey = toDayKey(row?.dayKey || row?.pageDateIso || row?.dateKey || null);
      if (!dayKey && row?.sessionId && sessionDayKeyById) {
        dayKey = sessionDayKeyById.get(String(row.sessionId)) || null;
      }
      if (!dayKey) return;
      const key = String(consigneId);
      const byDay = index.get(key) || new Map();
      const existing = byDay.get(dayKey);
      const next = existing ? existing : row;
      byDay.set(dayKey, next);
      index.set(key, byDay);
    });
    return index;
  }

  function hasResponseContent(consigne, responseRow) {
    if (!responseRow) return false;
    if (consigne?.type === "checklist") return true;
    const v = responseRow.value;
    if (v === undefined || v === null) {
      return Boolean(String(responseRow.note || "").trim());
    }
    if (typeof v === "string") {
      return Boolean(v.trim()) || Boolean(String(responseRow.note || "").trim());
    }
    if (typeof v === "object") {
      try {
        if (window?.Modes?.richText?.hasContent && window?.Modes?.richText?.normalizeValue) {
          const normalized = Modes.richText.normalizeValue(v);
          return Modes.richText.hasContent(normalized);
        }
      } catch (_) { }
      return true;
    }
    return true;
  }

  function pickLastWindow(list, size) {
    const arr = Array.isArray(list) ? list : [];
    const n = Math.max(0, Number(size) || 0);
    if (n <= 0) return [];
    if (arr.length <= n) return arr.slice();
    return arr.slice(arr.length - n);
  }

  function buildPracticeSessionIndex(rows) {
    const index = new Map();
    (rows || []).forEach((row) => {
      const consigneId = row?.consigneId || row?.consigne_id || row?.consigne || null;
      const sessionId = row?.sessionId || row?.session_id || null;
      if (!consigneId || !sessionId) return;
      const key = String(consigneId);
      const sessKey = String(sessionId);
      const bySession = index.get(key) || new Map();
      const existing = bySession.get(sessKey) || null;
      const existingTime = existing ? new Date(existing.createdAt || existing.updatedAt || 0).getTime() : 0;
      const nextTime = new Date(row.createdAt || row.updatedAt || 0).getTime();
      if (!existing || nextTime >= existingTime) {
        bySession.set(sessKey, row);
      }
      index.set(key, bySession);
    });
    return index;
  }

  function parseSessionOrderFromKey(key) {
    const str = String(key || "");
    const m = str.match(/^session-(\d+)$/i);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n - 1;
  }

  function buildPracticeHistoryIndex(rows) {
    const index = new Map();
    (rows || []).forEach((row) => {
      const consigneId = row?.consigneId || row?.consigne_id || row?.consigne || null;
      const historyKey = row?.historyKey || row?.entryId || row?.key || row?.id || null;
      if (!consigneId || !historyKey) return;
      const key = String(consigneId);
      const sessKey = String(historyKey);
      const bySession = index.get(key) || new Map();
      const existing = bySession.get(sessKey) || null;
      const existingTime = existing ? toMillisSafe(existing.updatedAt || existing.createdAt || 0) : 0;
      const nextTime = toMillisSafe(row.updatedAt || row.createdAt || 0);
      if (!existing || nextTime >= existingTime) {
        bySession.set(sessKey, row);
      }
      index.set(key, bySession);
    });
    return index;
  }

  function formatChecklistCell(consigne, answerRow) {
    if (!answerRow) return "";
    const checkedCount = Number(answerRow.checkedCount ?? answerRow.checked_count);
    const total = Number(answerRow.total);
    if (Number.isFinite(checkedCount) && Number.isFinite(total) && total > 0) {
      const pct = Math.round((checkedCount / total) * 100);
      return `${pct}%`;
    }
    const selected = Array.isArray(answerRow.selectedIds) ? answerRow.selectedIds.length : null;
    const skipped = Array.isArray(answerRow.skippedIds) ? answerRow.skippedIds.length : null;
    if (selected !== null && skipped !== null) {
      const totalCount = selected + skipped;
      if (totalCount > 0) {
        const pct = Math.round((selected / totalCount) * 100);
        return `${pct}%`;
      }
      return "";
    }
    const answers = answerRow.answers;
    if (answers && typeof answers === "object") {
      try {
        return JSON.stringify(answers);
      } catch (_) { }
    }
    return cellValueForSheets(answerRow);
  }

  function formatValueCell(consigne, responseRow) {
    if (!responseRow) return "";
    const v = responseRow.value;
    if (v === undefined || v === null || v === "") {
      const note = responseRow.note;
      if (note) return String(note);
      return "";
    }
    if (consigne?.type === "yesno") {
      if (v === "yes") return "Oui";
      if (v === "no") return "Non";
    }
    if (consigne?.type === "likert6") {
      const map = {
        yes: "Oui",
        rather_yes: "Plutôt oui",
        neutral: "Neutre",
        rather_no: "Plutôt non",
        no: "Non",
        no_answer: "Sans réponse",
      };
      if (map[String(v)]) return map[String(v)];
    }
    return cellValueForSheets(v);
  }

  async function formatDashboardSheets(token, spreadsheetId, sheetIdsByTitle) {
    const meta = await googleApiJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties,sheets.conditionalFormats`,
      { token }
    );
    const conditionalCountsBySheetId = new Map();
    (meta?.sheets || []).forEach((s) => {
      const sheetId = s?.properties?.sheetId;
      if (typeof sheetId !== "number") return;
      const count = Array.isArray(s?.conditionalFormats) ? s.conditionalFormats.length : 0;
      conditionalCountsBySheetId.set(sheetId, count);
    });

    const requests = [];
    Object.entries(sheetIdsByTitle || {}).forEach(([title, sheetId]) => {
      if (typeof sheetId !== "number") return;
      const isDashboard = ["Journalier", "Pratique", "Objectifs", "README"].includes(title);
      const isMonthly = /^Journalier \d{4}-\d{2}$/.test(title) || /^Pratique \d{4}-\d{2}$/.test(title);
      const isSummary = title === "Résumé";
      if (!isDashboard && !isMonthly && !isSummary) return;

      const existingRules = conditionalCountsBySheetId.get(sheetId) || 0;
      for (let i = existingRules - 1; i >= 0; i -= 1) {
        requests.push({ deleteConditionalFormatRule: { sheetId, index: i } });
      }

      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: {
              frozenRowCount: 1,
              frozenColumnCount: title === "README" ? 0 : 2,
            },
          },
          fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
        },
      });
      if (title !== "README") {
        requests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
                textFormat: { bold: true },
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)",
          },
        });
      }

      if (title !== "README") {
        requests.push({
          setBasicFilter: {
            filter: {
              range: {
                sheetId,
                startRowIndex: 0,
                startColumnIndex: 0,
                endRowIndex: 2000,
                endColumnIndex: 2000,
              },
            },
          },
        });
      }

      if (title !== "README") {
        const dataRange = {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: 2,
          endRowIndex: 2000,
          endColumnIndex: 2000,
        };
        const yesRule = {
          addConditionalFormatRule: {
            index: 0,
            rule: {
              ranges: [dataRange],
              booleanRule: {
                condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "Oui" }] },
                format: { backgroundColor: { red: 0.85, green: 0.95, blue: 0.85 } },
              },
            },
          },
        };
        const noRule = {
          addConditionalFormatRule: {
            index: 0,
            rule: {
              ranges: [dataRange],
              booleanRule: {
                condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "Non" }] },
                format: { backgroundColor: { red: 0.98, green: 0.86, blue: 0.86 } },
              },
            },
          },
        };
        requests.push(yesRule, noRule);

        if (isSummary) {
          requests.push({
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 0,
                startColumnIndex: 2,
                endRowIndex: 2000,
                endColumnIndex: 2000,
              },
              cell: {
                userEnteredFormat: {
                  numberFormat: { type: "PERCENT", pattern: "0%" },
                },
              },
              fields: "userEnteredFormat.numberFormat",
            },
          });
          const pctRule = {
            addConditionalFormatRule: {
              index: 0,
              rule: {
                ranges: [dataRange],
                gradientRule: {
                  minpoint: { type: "NUMBER", value: "0", color: { red: 0.98, green: 0.86, blue: 0.86 } },
                  midpoint: { type: "NUMBER", value: "0.5", color: { red: 0.99, green: 0.95, blue: 0.82 } },
                  maxpoint: { type: "NUMBER", value: "1", color: { red: 0.85, green: 0.95, blue: 0.85 } },
                },
              },
            },
          };
          requests.push(pctRule);
        }
      }
    });
    if (!requests.length) return;
    await googleApiJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      { method: "POST", token, body: { requests } }
    );
  }

  async function readCollectionDocsCompat(ref) {
    try {
      const snap = await ref.get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    } catch (_) {
      return [];
    }
  }

  async function ensureSheetTabs(token, spreadsheetId, tabTitles) {
    const meta = await googleApiJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`,
      { token }
    );
    const existing = new Map();
    (meta?.sheets || []).forEach((s) => {
      const title = s?.properties?.title;
      const sheetId = s?.properties?.sheetId;
      if (typeof title === "string" && title && typeof sheetId === "number") {
        existing.set(title, sheetId);
      }
    });
    const missing = (Array.isArray(tabTitles) ? tabTitles : []).filter((t) => t && !existing.has(t));
    if (missing.length) {
      await googleApiJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
        {
          method: "POST",
          token,
          body: {
            requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
          },
        }
      );
      return ensureSheetTabs(token, spreadsheetId, tabTitles);
    }
    const out = {};
    existing.forEach((sheetId, title) => {
      out[title] = sheetId;
    });
    return out;
  }

  async function clearAndWriteSheet(token, spreadsheetId, sheetTitle, rows) {
    const range = encodeURIComponent(`${sheetTitle}!A1`);
    await googleApiJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}:clear`,
      { method: "POST", token, body: {} }
    );
    await googleApiJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?valueInputOption=USER_ENTERED`,
      { method: "PUT", token, body: { values: Array.isArray(rows) ? rows : [] } }
    );
  }

  async function setPublicReadPermission(token, spreadsheetId) {
    try {
      await googleApiJson(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}/permissions?sendNotificationEmail=false`,
        {
          method: "POST",
          token,
          body: { type: "anyone", role: "reader", allowFileDiscovery: false },
        }
      );
      return { ok: true, error: null };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async function callSheetsExport(mode) {
    const uid = ctx.user?.uid;
    if (!uid) {
      alert("Aucun utilisateur sélectionné.");
      return null;
    }

    try {
      const exportMode = mode === "refresh" ? "refresh" : "create";
      const existingSheetId = exportMode === "refresh" ? resolveLastExportSheetId() : null;
      if (exportMode === "refresh" && !existingSheetId) {
        alert("Aucun Google Sheet existant à actualiser.");
        return null;
      }
      const token = await getGoogleAccessToken({ interactive: true });

      if (!ctx.db || typeof ctx.db.collection !== "function") {
        alert("Firestore non initialisé.");
        return null;
      }

      const userRef = ctx.db.collection("u").doc(uid);
      const profileSnap = await userRef.get();
      const profile = profileSnap?.exists ? profileSnap.data() || {} : {};
      const displayName = profile.displayName || profile.name || uid;

      let spreadsheetId = existingSheetId;
      let spreadsheetUrl = null;

      if (exportMode === "create") {
        const dateLabel = new Date().toISOString().slice(0, 10);
        const title = `Export Habitudes — ${displayName} — ${dateLabel}`;
        const created = await googleApiJson("https://sheets.googleapis.com/v4/spreadsheets", {
          method: "POST",
          token,
          body: {
            properties: { title },
            sheets: [{ properties: { title: "README" } }],
          },
        });
        spreadsheetId = created?.spreadsheetId || null;
        spreadsheetUrl = created?.spreadsheetUrl || null;
      }

      if (!spreadsheetId) {
        alert("Impossible de créer le Google Sheet.");
        return null;
      }

      const meta = await googleApiJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl`,
        { token }
      );
      spreadsheetUrl = meta?.spreadsheetUrl || spreadsheetUrl;

      const categories = await readCollectionDocsCompat(userRef.collection("categories"));
      const consignes = await readCollectionDocsCompat(userRef.collection("consignes"));
      const responses = await readCollectionDocsCompat(userRef.collection("responses"));
      const sessions = await readCollectionDocsCompat(userRef.collection("sessions"));
      const sr = await readCollectionDocsCompat(userRef.collection("sr"));
      const modules = await readCollectionDocsCompat(userRef.collection("modules"));
      const pushTokens = await readCollectionDocsCompat(userRef.collection("pushTokens"));
      const history = await readCollectionDocsCompat(userRef.collection("history"));

      const checklistRows = [];
      try {
        const answerDatesSnap = await userRef.collection("answers").get();
        for (const dateDoc of answerDatesSnap.docs) {
          const dateKey = dateDoc.id;
          const consSnap = await userRef
            .collection("answers")
            .doc(dateKey)
            .collection("consignes")
            .get();
          consSnap.forEach((doc) => {
            checklistRows.push({
              dateKey,
              consigneId: doc.id,
              ...(doc.data() || {}),
            });
          });
        }
      } catch (error) {
        console.warn("exportUserToSheet:answers:read", error);
      }

      const consigneHistory = [];
      try {
        for (const consigne of consignes) {
          if (!consigne?.id) continue;
          const snap = await userRef
            .collection("consignes")
            .doc(consigne.id)
            .collection("history")
            .get();
          snap.forEach((doc) => {
            consigneHistory.push({
              consigneId: consigne.id,
              entryId: doc.id,
              ...(doc.data() || {}),
            });
          });
        }
      } catch (error) {
        console.warn("exportUserToSheet:consigneHistory:read", error);
      }

      const objectifs = await readCollectionDocsCompat(userRef.collection("objectifs"));
      const objectiveNotes = await readCollectionDocsCompat(userRef.collection("objectiveNotes"));

      const dailyConsignes = (consignes || []).filter((c) => c?.mode === "daily");
      const practiceConsignes = (consignes || []).filter((c) => c?.mode === "practice");

      const dailyResponseRows = (responses || []).filter((r) => r?.mode === "daily");
      const practiceResponseRows = (responses || []).filter((r) => r?.mode === "practice");

      // Practice timeline in the UI is driven by /u/{uid}/history/{consigneId}/entries/*
      // We read those entries to ensure the Sheets export shows the same answers.
      const practiceHistoryRows = [];
      try {
        for (const c of practiceConsignes) {
          const consigneId = String(c?.id || "");
          if (!consigneId) continue;
          const snap = await userRef.collection("history").doc(consigneId).collection("entries").get();
          snap.forEach((docSnap) => {
            practiceHistoryRows.push({
              consigneId,
              historyKey: docSnap.id,
              ...(docSnap.data() || {}),
            });
          });
        }
      } catch (error) {
        console.warn("exportUserToSheet:practiceHistory:read", error);
      }

      const sessionDayKeyById = new Map();
      const sessionById = new Map();
      (sessions || []).forEach((s) => {
        const id = s?.id;
        if (!id) return;
        sessionById.set(String(id), s);
        const dayKey = toDayKey(s?.startedAt || s?.createdAt || null);
        if (dayKey) sessionDayKeyById.set(String(id), dayKey);
      });

      const dailyIndex = buildResponseIndex(dailyResponseRows);
      const practiceSessionIndex = buildPracticeSessionIndex(practiceResponseRows);
      const practiceHistoryIndex = buildPracticeHistoryIndex(practiceHistoryRows);
      const checklistIndex = buildResponseIndex(checklistRows);

      const allDailyDayKeys = Array.from(
        new Set(
          [
            ...dailyResponseRows.map((r) => toDayKey(r?.dayKey || r?.pageDateIso || null)),
            ...checklistRows.map((r) => toDayKey(r?.dateKey || r?.dayKey || null)),
          ].filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));

      const DAILY_MAX_DAYS = 720;
      const PRACTICE_MAX_SESSIONS = 800;

      const dailyDayKeys = pickRecentSorted(allDailyDayKeys, DAILY_MAX_DAYS);

      const sortedSessions = (sessions || []).slice().sort((a, b) => {
        const at = toMillisSafe(a?.startedAt || a?.createdAt || 0);
        const bt = toMillisSafe(b?.startedAt || b?.createdAt || 0);
        return at - bt;
      });

      // Build practice session columns from:
      // - actual session docs (preferred)
      // - any sessionId found in practice responses (covers legacy/fallback ids like session-0001)
      const practiceSessionMetaById = new Map();
      sortedSessions.forEach((s, idx) => {
        const id = String(s?.id || "");
        if (!id) return;
        const dayKey = toDayKey(s?.startedAt || s?.createdAt || null) || "";
        practiceSessionMetaById.set(id, {
          id,
          dayKey,
          order: idx,
          source: "sessions",
        });
      });

      (practiceResponseRows || []).forEach((row) => {
        const rawId = row?.sessionId || row?.session_id || null;
        if (!rawId) return;
        const id = String(rawId);
        if (!id) return;
        if (practiceSessionMetaById.has(id)) {
          const existing = practiceSessionMetaById.get(id);
          const dk = existing?.dayKey || "";
          if (dk) return;
          const inferred =
            toDayKey(row?.dayKey || row?.pageDateIso || row?.createdAt || row?.updatedAt || null) || "";
          if (inferred) {
            practiceSessionMetaById.set(id, { ...existing, dayKey: inferred });
          }
          return;
        }
        const inferredDayKey =
          toDayKey(row?.dayKey || row?.pageDateIso || row?.createdAt || row?.updatedAt || null) || "";
        const numericOrder = Number.isFinite(Number(row?.sessionIndex))
          ? Number(row.sessionIndex)
          : Number.isFinite(Number(row?.sessionNumber))
            ? Number(row.sessionNumber) - 1
            : null;
        practiceSessionMetaById.set(id, {
          id,
          dayKey: inferredDayKey,
          order: numericOrder,
          source: "responses",
        });
        if (inferredDayKey && !sessionDayKeyById.has(id)) {
          sessionDayKeyById.set(id, inferredDayKey);
        }
      });

      (practiceHistoryRows || []).forEach((row) => {
        const rawId = row?.historyKey || row?.entryId || row?.key || row?.id || null;
        if (!rawId) return;
        const id = String(rawId);
        if (!id) return;
        if (practiceSessionMetaById.has(id)) {
          const existing = practiceSessionMetaById.get(id);
          const dk = existing?.dayKey || "";
          if (dk) return;
          const inferred =
            toDayKey(row?.dayKey || row?.pageDateIso || row?.pageDate || row?.createdAt || row?.updatedAt || id) || "";
          if (inferred) {
            practiceSessionMetaById.set(id, { ...existing, dayKey: inferred });
            if (!sessionDayKeyById.has(id)) sessionDayKeyById.set(id, inferred);
          }
          return;
        }
        const inferredDayKey =
          toDayKey(row?.dayKey || row?.pageDateIso || row?.pageDate || row?.createdAt || row?.updatedAt || id) || "";
        const numericOrder = Number.isFinite(Number(row?.sessionIndex))
          ? Number(row.sessionIndex)
          : Number.isFinite(Number(row?.sessionNumber))
            ? Number(row.sessionNumber) - 1
            : parseSessionOrderFromKey(id);
        practiceSessionMetaById.set(id, {
          id,
          dayKey: inferredDayKey,
          order: numericOrder,
          source: "history",
        });
        if (inferredDayKey && !sessionDayKeyById.has(id)) {
          sessionDayKeyById.set(id, inferredDayKey);
        }
      });

      const sessionColumnsAll = Array.from(practiceSessionMetaById.values())
        .sort((a, b) => {
          const ao = Number.isFinite(a.order) ? a.order : Number.POSITIVE_INFINITY;
          const bo = Number.isFinite(b.order) ? b.order : Number.POSITIVE_INFINITY;
          if (ao !== bo) return ao - bo;
          const ad = a.dayKey || "";
          const bd = b.dayKey || "";
          if (ad && bd && ad !== bd) return ad.localeCompare(bd);
          if (ad && !bd) return -1;
          if (!ad && bd) return 1;
          return String(a.id).localeCompare(String(b.id));
        })
        .map((meta, idx) => {
          const dayKey = meta.dayKey || "";
          const label = `S${idx + 1}${dayKey ? ` — ${dayKey}` : ""}`;
          return { id: String(meta.id || ""), label };
        })
        .filter((s) => s.id);

      const practiceSessionCols =
        sessionColumnsAll.length > PRACTICE_MAX_SESSIONS
          ? sessionColumnsAll.slice(sessionColumnsAll.length - PRACTICE_MAX_SESSIONS)
          : sessionColumnsAll;

      const dailyWindows = {
        "7j": pickLastWindow(allDailyDayKeys, 7),
        "30j": pickLastWindow(allDailyDayKeys, 30),
        "90j": pickLastWindow(allDailyDayKeys, 90),
      };
      const practiceWindows = {
        "10 sessions": pickLastWindow(sessionColumnsAll, 10),
        "30 sessions": pickLastWindow(sessionColumnsAll, 30),
        "100 sessions": pickLastWindow(sessionColumnsAll, 100),
      };

      const summaryRows = [];
      summaryRows.push(["Journalier — complétion", "", "", "", "", ""]);
      summaryRows.push(["Catégorie", "Consigne", "7j", "30j", "90j"]);
      dailyConsignes.forEach((c) => {
        const id = String(c?.id || "");
        if (!id) return;
        const byDayChecklist = checklistIndex.get(id) || new Map();
        const byDayResp = dailyIndex.get(id) || new Map();
        const calc = (keys) => {
          const list = Array.isArray(keys) ? keys : [];
          if (!list.length) return "";
          let answered = 0;
          list.forEach((dayKey) => {
            if (c?.type === "checklist") {
              if (byDayChecklist.get(dayKey)) answered += 1;
            } else {
              const row = byDayResp.get(dayKey) || null;
              if (hasResponseContent(c, row)) answered += 1;
            }
          });
          return answered / list.length;
        };
        summaryRows.push([
          cellValueForSheets(c?.category || ""),
          normalizeConsigneTitle(c),
          calc(dailyWindows["7j"]),
          calc(dailyWindows["30j"]),
          calc(dailyWindows["90j"]),
        ]);
      });
      summaryRows.push(["", "", "", "", "", ""]);
      summaryRows.push(["Pratique — complétion", "", "", "", "", ""]);
      summaryRows.push(["Catégorie", "Consigne", "10 sessions", "30 sessions", "100 sessions"]);
      practiceConsignes.forEach((c) => {
        const id = String(c?.id || "");
        if (!id) return;
        const byHistory = practiceHistoryIndex.get(id) || new Map();
        const bySession = practiceSessionIndex.get(id) || new Map();
        const calc = (sessList) => {
          const list = Array.isArray(sessList) ? sessList : [];
          if (!list.length) return "";
          let answered = 0;
          list.forEach((sess) => {
            const key = String(sess?.id || "");
            const row = byHistory.get(key) || bySession.get(key) || null;
            if (hasResponseContent(c, row)) answered += 1;
          });
          return answered / list.length;
        };
        summaryRows.push([
          cellValueForSheets(c?.category || ""),
          normalizeConsigneTitle(c),
          calc(practiceWindows["10 sessions"]),
          calc(practiceWindows["30 sessions"]),
          calc(practiceWindows["100 sessions"]),
        ]);
      });

      const dailyHeader = ["Catégorie", "Consigne", ...dailyDayKeys];
      const dailyTable = [dailyHeader];
      dailyConsignes.forEach((c) => {
        const id = String(c?.id || "");
        if (!id) return;
        const row = [
          cellValueForSheets(c?.category || ""),
          normalizeConsigneTitle(c),
        ];
        const byDayChecklist = checklistIndex.get(id) || new Map();
        const byDayResp = dailyIndex.get(id) || new Map();
        dailyDayKeys.forEach((dayKey) => {
          if (c?.type === "checklist") {
            row.push(formatChecklistCell(c, byDayChecklist.get(dayKey) || null));
          } else {
            row.push(formatValueCell(c, byDayResp.get(dayKey) || null));
          }
        });
        dailyTable.push(row);
      });

      const practiceHeader = ["Catégorie", "Consigne", ...practiceSessionCols.map((s) => s.label)];
      const practiceTable = [practiceHeader];
      practiceConsignes.forEach((c) => {
        const id = String(c?.id || "");
        if (!id) return;
        const row = [
          cellValueForSheets(c?.category || ""),
          normalizeConsigneTitle(c),
        ];
        const byHistory = practiceHistoryIndex.get(id) || new Map();
        const bySession = practiceSessionIndex.get(id) || new Map();
        practiceSessionCols.forEach((sess) => {
          row.push(formatValueCell(c, byHistory.get(sess.id) || bySession.get(sess.id) || null));
        });
        practiceTable.push(row);
      });

      const monthlyTitles = [];
      const dailyByMonth = new Map();
      allDailyDayKeys.forEach((dayKey) => {
        const monthKey = monthKeyFromDayKey(dayKey);
        if (!monthKey) return;
        const list = dailyByMonth.get(monthKey) || [];
        list.push(dayKey);
        dailyByMonth.set(monthKey, list);
      });
      const monthsSorted = Array.from(dailyByMonth.keys()).sort((a, b) => a.localeCompare(b));
      const practiceByMonth = new Map();
      sessionColumnsAll.forEach((sess) => {
        const dayKey = sessionDayKeyById.get(sess.id) || null;
        const monthKey = dayKey ? monthKeyFromDayKey(dayKey) : null;
        if (!monthKey) return;
        const list = practiceByMonth.get(monthKey) || [];
        list.push(sess);
        practiceByMonth.set(monthKey, list);
      });
      const practiceMonthsSorted = Array.from(practiceByMonth.keys()).sort((a, b) => a.localeCompare(b));
      const allMonths = Array.from(new Set([...monthsSorted, ...practiceMonthsSorted])).sort((a, b) => a.localeCompare(b));
      const cappedMonths = allMonths.length > 36 ? allMonths.slice(allMonths.length - 36) : allMonths;
      cappedMonths.forEach((monthKey) => {
        monthlyTitles.push(`Journalier ${monthKey}`);
        monthlyTitles.push(`Pratique ${monthKey}`);
      });

      const objectifsRows = makeRowsFromObjectsAuto(objectifs);
      const objectiveNotesRows = makeRowsFromObjectsAuto(objectiveNotes);
      const objectifsTable = [
        ["Section", "Données"],
        ["Objectifs", ""],
        ...objectifsRows,
        ["", ""],
        ["Notes Objectifs", ""],
        ...objectiveNotesRows,
      ];

      const tabTitles = [
        "README",
        "Résumé",
        "Journalier",
        "Pratique",
        "Objectifs",
        ...monthlyTitles,
      ];

      const sheetIdsByTitle = await ensureSheetTabs(token, spreadsheetId, tabTitles);

      const readmeRows = [
        ["Clé", "Valeur"],
        ["Exporté le", new Date().toISOString()],
        ["UID", uid],
        ["Utilisateur", displayName],
        ["Mode", exportMode],
        ["Aide", "Les onglets Journalier / Pratique affichent les consignes en lignes et les dates/sessions en colonnes."],
        ["Aide", "Clique sur Exporter depuis l’app pour régénérer le tableau."],
        ["Historique", "Des onglets par mois sont générés pour l’historique complet (limité aux 36 derniers mois pour éviter un fichier trop lourd)."],
      ];

      await clearAndWriteSheet(token, spreadsheetId, "README", readmeRows);
      await clearAndWriteSheet(token, spreadsheetId, "Résumé", summaryRows);
      await clearAndWriteSheet(token, spreadsheetId, "Journalier", dailyTable);
      await clearAndWriteSheet(token, spreadsheetId, "Pratique", practiceTable);
      await clearAndWriteSheet(token, spreadsheetId, "Objectifs", objectifsTable);

      for (const monthKey of cappedMonths) {
        const dailyKeys = (dailyByMonth.get(monthKey) || []).slice().sort((a, b) => a.localeCompare(b));
        const dailyMonthHeader = ["Catégorie", "Consigne", ...dailyKeys];
        const dailyMonthTable = [dailyMonthHeader];
        dailyConsignes.forEach((c) => {
          const id = String(c?.id || "");
          if (!id) return;
          const row = [cellValueForSheets(c?.category || ""), normalizeConsigneTitle(c)];
          const byDayChecklist = checklistIndex.get(id) || new Map();
          const byDayResp = dailyIndex.get(id) || new Map();
          dailyKeys.forEach((dayKey) => {
            if (c?.type === "checklist") row.push(formatChecklistCell(c, byDayChecklist.get(dayKey) || null));
            else row.push(formatValueCell(c, byDayResp.get(dayKey) || null));
          });
          dailyMonthTable.push(row);
        });
        await clearAndWriteSheet(token, spreadsheetId, `Journalier ${monthKey}`, dailyMonthTable);

        const practiceSess = (practiceByMonth.get(monthKey) || []).slice();
        const practiceMonthHeader = ["Catégorie", "Consigne", ...practiceSess.map((s) => s.label)];
        const practiceMonthTable = [practiceMonthHeader];
        practiceConsignes.forEach((c) => {
          const id = String(c?.id || "");
          if (!id) return;
          const row = [cellValueForSheets(c?.category || ""), normalizeConsigneTitle(c)];
          const bySession = practiceSessionIndex.get(id) || new Map();
          practiceSess.forEach((sess) => {
            row.push(formatValueCell(c, bySession.get(sess.id) || null));
          });
          practiceMonthTable.push(row);
        });
        await clearAndWriteSheet(token, spreadsheetId, `Pratique ${monthKey}`, practiceMonthTable);
      }

      await formatDashboardSheets(token, spreadsheetId, sheetIdsByTitle);

      const publicAccess = await setPublicReadPermission(token, spreadsheetId);

      const exportState = {
        spreadsheetId,
        spreadsheetUrl,
        updatedAt: appFirestore.serverTimestamp(),
      };
      if (exportMode === "create") {
        exportState.createdAt = appFirestore.serverTimestamp();
      }
      await userRef.set({ exportSheets: exportState }, { merge: true });

      return {
        ok: true,
        uid,
        mode: exportMode,
        spreadsheetId,
        spreadsheetUrl,
        publicAccess: {
          type: "anyone_with_link",
          role: "reader",
          ok: publicAccess.ok,
          error: publicAccess.error,
        },
      };
    } catch (error) {
      console.warn("exportUserToSheet:error", error);
      if (error && (error.status === 401 || error.status === 403)) {
        clearStoredGoogleAccessToken();
      }
      alert(error?.message || "Impossible d’exporter vers Google Sheets.");
      return null;
    }
  }

  function handleUserActionsOutsideClick(event) {
    if (!userActionsOpen || !userActions.container) return;
    if (!userActions.container.contains(event.target)) {
      closeUserActionsMenu();
    }
  }

  function handleUserActionsEscape(event) {
    if (event.key === "Escape" && userActionsOpen) {
      closeUserActionsMenu();
    }
  }

  userActions.trigger?.addEventListener("click", (event) => {
    event.preventDefault();
    toggleUserActionsMenu();
  });

  userActions.notif?.addEventListener("click", () => {
    const targetUid = userActions.notif?.dataset?.uid;
    if (!targetUid) return;
    handleNotificationToggle(targetUid, userActions.notif, { interactive: true });
    closeUserActionsMenu();
  });

  userActions.archives?.addEventListener("click", () => {
    closeUserActionsMenu();
    try {
      const opener = window.Modes?.openPracticeArchiveViewer;
      if (typeof opener === "function") {
        opener(ctx);
      }
    } catch (error) {
      console.error("user-actions:archives", error);
      if (typeof window.Modes?.showToast === "function") {
        window.Modes.showToast("Impossible d’ouvrir les archives.");
      }
    }
  });

  userActions.stats?.addEventListener("click", () => {
    closeUserActionsMenu();
    const uid = ctx.user?.uid || null;
    if (!uid) return;
    const url = `${location.origin}${location.pathname}#/u/${encodeURIComponent(uid)}/stats`;
    try {
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (win) return;
    } catch (_) { }
    routeTo("#/stats");
  });

  userActions.toggleHistory?.addEventListener("click", () => {
    closeUserActionsMenu();
    try {
      const toggle = window.Modes?.toggleHistoryNaVisibility;
      if (typeof toggle === "function") {
        toggle();
      }
    } catch (error) {
      console.error("user-actions:toggle-history", error);
    }
  });

  userActions.exportSheets?.addEventListener("click", async () => {
    closeUserActionsMenu();
    let popup = null;
    try {
      popup = window.open("about:blank", "_blank", "noopener,noreferrer");
    } catch (_) {
      popup = null;
    }
    const result = await callSheetsExport("create");
    const url = result?.spreadsheetUrl || "";
    if (url) {
      if (popup && !popup.closed) {
        try {
          popup.location.href = url;
          return;
        } catch (_) { }
      }
      window.location.href = url;
      return;
    }
    if (popup && !popup.closed) {
      try {
        popup.close();
      } catch (_) { }
    }
  });

  try {
    window.Modes?.updateHistoryNaToggleButton?.();
  } catch (_) { }

  if (userActions.install) {
    userActions.install.addEventListener("click", () => {
      closeUserActionsMenu();
    });
  }

  document.addEventListener("click", handleUserActionsOutsideClick);
  document.addEventListener("keydown", handleUserActionsEscape);

  window.__closeUserActionsMenu = closeUserActionsMenu;

  function getAuthInstance() {
    if (!firebaseCompatApp || typeof firebaseCompatApp.auth !== "function") return null;
    try {
      return ctx.app ? firebaseCompatApp.auth(ctx.app) : firebaseCompatApp.auth();
    } catch (err) {
      console.warn("firebase.auth() fallback", err);
      return firebaseCompatApp.auth();
    }
  }

  let authInitPromise = null;
  let signInPromise = null;

  async function ensureSignedIn() {
    const auth = getAuthInstance();
    if (!auth) return null;
    if (auth.currentUser) return auth.currentUser;

    if (!authInitPromise) {
      authInitPromise = new Promise((resolve) => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
          unsubscribe();
          resolve(user);
        });
      }).finally(() => {
        authInitPromise = null;
      });
    }

    const existing = await authInitPromise;
    if (existing) return existing;

    if (!signInPromise) {
      signInPromise = auth
        .signInAnonymously()
        .then((cred) => cred.user)
        .finally(() => {
          signInPromise = null;
        });
    }

    return signInPromise;
  }

  function routeTo(hash) {
    // hash like "#/daily", "#/practice?new=1", etc.
    if (!hash) hash = "#/admin";

    if (hash.startsWith("#/admin") && !hasAdminAccess()) {
      redirectToAdminLogin();
      return;
    }

    // Si l'argument est déjà une URL utilisateur complète, on la prend telle quelle
    if (/^#\/u\/[^/]+\//.test(hash)) {
      appLog("routeTo", { from: location.hash || null, requested: hash, target: hash });
      ctx.route = hash;
      window.location.hash = hash;
      render();
      return;
    }

    // If we are currently on a user URL, prefix all routes with /u/{uid}/...
    const m = (location.hash || "").match(/^#\/u\/([^/]+)/);
    const base = m ? `#/u/${m[1]}/` : "#/";
    const stayInUserSpace = m && !hash.startsWith("#/admin") && !hash.startsWith("#/u/");
    const target = stayInUserSpace ? base + hash.replace(/^#\//, "") : hash;

    if (target.startsWith("#/admin") && !hasAdminAccess()) {
      redirectToAdminLogin();
      return;
    }

    appLog("routeTo", { from: location.hash || null, requested: hash, target });
    ctx.route = target;
    window.location.hash = target;
    render();
  }
  window.routeTo = routeTo;

  function routeToDefault() {
    const storedTarget = loadInstallTargetHash();
    if (storedTarget) {
      if (location.hash !== storedTarget) {
        location.hash = storedTarget;
      } else {
        handleRoute();
      }
      return;
    }

    const defaultHash = hasAdminAccess() ? "#/admin" : "#/daily";
    if (location.hash !== defaultHash) {
      location.hash = defaultHash;
    } else {
      handleRoute();
    }
  }

  function setActiveNav(sectionKey) {
    const alias = sectionKey === "dashboard" ? "daily" : sectionKey;
    const map = {
      admin: "#/admin",
      daily: "#/daily",
      practice: "#/practice",
      history: "#/history",
      goals: "#/goals",
      stats: "#/stats",
    };
    const activeTarget = map[alias] || "#/admin";
    const accentSection = map[alias] ? alias : "daily";

    document.body.setAttribute("data-section", accentSection);

    queryAll("button[data-route]").forEach((btn) => {
      const target = btn.getAttribute("data-route");
      const isActive = target === activeTarget;
      btn.setAttribute("aria-current", isActive ? "page" : "false");
    });
  }

  function parseHash(hashValue) {
    const hash = hashValue || "#/admin";
    const normalized = hash.replace(/^#/, "");
    const [pathPartRaw, searchPart = ""] = normalized.split("?");
    const pathPart = pathPartRaw.replace(/^\/+/, "");
    const segments = pathPart ? pathPart.split("/") : [];
    const qp = new URLSearchParams(searchPart);
    return { hash, segments, search: searchPart, qp };
  }

  function syncUserActionsContext() {
    const { segments } = parseHash(ctx.route || location.hash || "#/admin");
    const routeKey = segments[0] || "admin";
    const isAdminRoute = routeKey === "admin";
    const activeUid = ctx.user?.uid || null;
    const visible = !isAdminRoute && !!activeUid;
    setUserActionsVisibility(visible);
    if (visible) {
      updateUserActionsTarget(activeUid);
      syncNotificationButtonsForUid(activeUid);
      syncSheetsMenuVisibility();
    } else {
      updateUserActionsTarget(null);
    }
  }

  async function loadCategories() {
    // Categories are per user, default fallback if empty
    appLog("categories:load:start", { uid: ctx.user?.uid });
    const uid = ctx.user.uid;
    const cats = await Schema.fetchCategories(ctx.db, uid);
    ctx.categories = cats;
    appLog("categories:load:done", { count: cats.length });
    renderSidebar();
  }

  function ensureSidebarStructure() {
    const sidebar = queryOne("#sidebar");
    if (!sidebar) return null;
    if (!sidebar.dataset.ready) {
      sidebar.innerHTML = `
        <div class="grid gap-4">
          <section class="card space-y-3 p-4">
            <div class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Profil</div>
            <div id="profile-box" class="space-y-2 text-sm"></div>
            <div id="notification-box" class="space-y-2 border-t border-gray-200 pt-3">
              <div class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Notifications</div>
              <p id="notification-status" class="text-sm text-[var(--muted)]"></p>
              <p class="text-xs text-[var(--muted)]">Gère les notifications depuis le menu ⋮ en haut de page.</p>
            </div>
          </section>
          <section class="card space-y-3 p-4">
            <div class="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Catégories</div>
            <div id="category-box" class="space-y-2 text-sm"></div>
          </section>
        </div>
      `;
      sidebar.dataset.ready = "1";
    }
    return sidebar;
  }

  function renderSidebar() {
    const sidebar = ensureSidebarStructure();
    const box = queryOne("#profile-box");
    const status = queryOne("#notification-status");
    if (!sidebar || !box) return;

    appLog("sidebar:render", { profile: ctx.profile, categories: ctx.categories?.length });

    if (!ctx.user?.uid) {
      const empty = document.createElement("span");
      empty.className = "muted";
      empty.textContent = "Aucun utilisateur sélectionné.";
      box.replaceChildren(empty);
      if (status) status.textContent = "Sélectionnez un utilisateur pour accéder aux paramètres.";
      const catBoxEmpty = queryOne("#category-box");
      if (catBoxEmpty) {
        const catEmpty = document.createElement("span");
        catEmpty.className = "muted";
        catEmpty.textContent = "Sélectionnez un utilisateur pour voir ses catégories.";
        catBoxEmpty.replaceChildren(catEmpty);
      }
      return;
    }

    const profileName = ctx.profile?.displayName || ctx.profile?.name || "Utilisateur";
    const link = `${location.origin}${location.pathname}#/u/${ctx.user.uid}`;

    const nameDiv = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = profileName;
    nameDiv.appendChild(strong);

    const uidDiv = document.createElement("div");
    uidDiv.className = "muted";
    uidDiv.append(document.createTextNode("UID : "));
    const code = document.createElement("code");
    code.textContent = ctx.user.uid;
    uidDiv.appendChild(code);

    const linkDiv = document.createElement("div");
    linkDiv.className = "muted";
    linkDiv.append(document.createTextNode("Lien direct : "));
    const anchor = document.createElement("a");
    anchor.className = "link";
    anchor.href = link;
    anchor.textContent = link;
    linkDiv.appendChild(anchor);

    box.replaceChildren(nameDiv, uidDiv, linkDiv);

    syncNotificationButtonsForUid(ctx.user.uid);

    const catBox = queryOne("#category-box");
    if (catBox) {
      if (!ctx.categories.length) {
        const empty = document.createElement("span");
        empty.className = "muted";
        empty.textContent = "Aucune catégorie. Elles seront créées automatiquement lors de l’ajout d’une consigne.";
        catBox.replaceChildren(empty);
      } else {
        const fragments = ctx.categories.map((c) => {
          const row = document.createElement("div");
          row.className = "flex";

          const nameSpan = document.createElement("span");
          nameSpan.textContent = c?.name ?? "";

          const modeSpan = document.createElement("span");
          modeSpan.className = "pill";
          modeSpan.textContent = c?.mode ?? "";

          row.append(nameSpan, modeSpan);
          return row;
        });
        catBox.replaceChildren(...fragments);
      }
    }
  }

  function bindNav() {
    // Navigation haut (Daily, Practice, etc.)
    appLog("nav:bind:start");
    queryAll("button[data-route]").forEach(btn => {
      const target = btn.getAttribute("data-route");
      appLog("nav:bind:button", { target });
      btn.onclick = () => routeTo(target);
    });

    // Boutons spécifiques (seulement si présents dans le DOM)
    const btnSession = queryOne("#btn-new-session");
    if (btnSession) {
      appLog("nav:bind:newSessionButton");
      btnSession.onclick = () => routeTo("#/practice?new=1");
    }

    const btnConsigne = queryOne("#btn-add-consigne");
    if (btnConsigne) {
      appLog("nav:bind:addConsigne");
      btnConsigne.onclick = () => Modes.openConsigneForm(ctx);
    }

    const btnGoal = queryOne("#btn-add-goal");
    if (btnGoal) {
      appLog("nav:bind:addGoal");
      btnGoal.onclick = () => Goals.openGoalForm(ctx);
    }
  }

  function redirectToDefaultSection() {
    routeToDefault();
  }

  async function ensureOwnRoute(parsed) {
    let desired = parsed.segments[0] || "daily";
    if (!desired) desired = "daily";

    const qp = parsed.qp || new URLSearchParams(parsed.search || "");
    const requestedUid = qp.get("u");

    let authUser;
    try {
      authUser = await ensureSignedIn();
    } catch (error) {
      if (DEBUG) console.warn("[Auth] anonymous sign-in failed", error);
    }

    const fallbackUid = authUser?.uid;
    const targetUid = requestedUid || fallbackUid;

    if (!targetUid) {
      redirectToDefaultSection();
      return;
    }

    if (requestedUid) {
      qp.delete("u");
    }
    const searchPart = qp.toString();
    const target = `#/u/${targetUid}/${desired}${searchPart ? `?${searchPart}` : ""}`;

    if (location.hash !== target) {
      location.replace(target);
    } else if (!ctx.user || ctx.user.uid !== targetUid) {
      await initApp({
        app: ctx.app,
        db: ctx.db,
        user: { uid: targetUid }
      });
    }
  }

  // --- Router global (admin <-> user) ---
  async function handleRoute() {
    const currentHash = location.hash || "#/admin";
    const parsed = parseHash(currentHash);
    ctx.route = currentHash;
    appLog("handleRoute", parsed);

    const routeName = parsed.segments[0] || "admin";

    if (routeName === "admin") {
      if (!hasAdminAccess()) {
        redirectToAdminLogin();
        return;
      }
      try {
        await ensureSignedIn();
      } catch (error) {
        if (DEBUG) console.warn("[Auth] anonymous sign-in failed", error);
      }
      render();
      return;
    }

    if (routeName === "u") {
      const qp = parsed.qp || new URLSearchParams(parsed.search || "");
      const uid = parsed.segments[1];
      let section = parsed.segments[2];
      const requestedUid = qp.get("u");
      const targetUid = requestedUid || uid;

      if (!targetUid) {
        redirectToDefaultSection();
        return;
      }

      if (!section) {
        if (requestedUid) qp.delete("u");
        const searchPart = qp.toString();
        const target = `#/u/${targetUid}/daily${searchPart ? `?${searchPart}` : ""}`;
        location.replace(target);
        return;
      }

      if (requestedUid && requestedUid !== uid) {
        qp.delete("u");
        const searchPart = qp.toString();
        const target = `#/u/${targetUid}/${section}${searchPart ? `?${searchPart}` : ""}`;
        location.replace(target);
        return;
      }

      if (ctx.user?.uid === targetUid) {
        return;
      }

      await initApp({
        app: ctx.app,
        db: ctx.db,
        user: {
          uid: targetUid
        }
      });
      return;
    }

    await ensureOwnRoute(parsed);
  }

  function startRouter(app, db) {
    // We keep app/db in the context for the screens
    appLog("router:start", { hash: location.hash });
    ctx.app = app;
    ctx.db = db;
    if (typeof Schema.bindDb === "function") Schema.bindDb(db);
    updateChecklistStateContext();
    bindNav();
    rememberInstallTargetFromHash(location.hash || "");
    if (!location.hash || location.hash === "#") {
      routeToDefault();
    } else {
      handleRoute(); // initial render
    }
    window.addEventListener("hashchange", () => {
      rememberInstallTargetFromHash(location.hash || "");
      appLog("router:hashchange", { hash: location.hash });
      handleRoute();
    }); // navigation
  }

  // Local ensureProfile function
  async function ensureProfile(db, uid) {
    appLog("profile:ensure:start", { uid });
    const ref = appFirestore.doc(db, "u", uid);
    const snap = await appFirestore.getDoc(ref);
    if (snapshotExists(snap)) {
      const data = snap.data();
      appLog("profile:ensure:existing", { uid });
      return data;
    }
    const newProfile = {
      name: "Nouvel utilisateur",
      displayName: "Nouvel utilisateur",
      createdAt: new Date().toISOString()
    };
    await appFirestore.setDoc(ref, newProfile);
    appLog("profile:ensure:created", { uid });
    return newProfile;
  }

  async function ensurePushSubscriptionForUid(uid, { interactive = false } = {}) {
    const targetUid = uid || ctx.user?.uid;
    if (!targetUid) return;
    const success = await enablePushForUid(targetUid, { interactive });
    if (success) syncNotificationButtonsForUid(targetUid);
  }

  async function initApp({ app, db, user }) {
    // Show the sidebar in user mode
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.style.display = "";

    L.group("app.init", user?.uid);
    appLog("app:init:start", { uid: user?.uid });
    if (!user || !user.uid) {
      L.error("No UID in context");
      appLog("app:init:error", { reason: "missing uid" });
      L.groupEnd();
      return;
    }
    ctx.app = app;
    ctx.db = db;
    ctx.user = user;
    updateChecklistStateContext();

    await refreshUserBadge(user.uid);

    const profile = await ensureProfile(db, user.uid);
    ctx.profile = { uid: user.uid, ...profile };
    appLog("app:init:profile", { profile });
    safeUpdateInstallShortcutLabel(resolveInstallLabelFromProfile(ctx.profile), "profile-init");

    renderSidebar();
    setupProfileWatcher(ctx.db, user.uid);

    await loadCategories();
    bindNav();

    ctx.route = location.hash || "#/admin";
    rememberInstallTargetFromHash(ctx.route);
    appLog("app:init:route", { route: ctx.route });
    syncUserActionsContext();
    window.addEventListener("hashchange", () => {
      ctx.route = location.hash || "#/admin";
      rememberInstallTargetFromHash(ctx.route);
      appLog("app:init:hashchange", { route: ctx.route });
      render();
    });
    await render();
    badgeManager.refresh(user.uid).catch(() => {});
    const pref = getPushPreference(user.uid);
    if (pref?.enabled && isPushSupported()) {
      ensurePushSubscriptionForUid(user.uid, { interactive: false }).catch(console.error);
    }
    appLog("app:init:rendered");
    L.groupEnd();
  }

  function newUid() {
    // Simple, readable, unique UID
    return "u-" + Math.random().toString(36).slice(2, 10);
  }

  let adminUserSort = (typeof localStorage !== "undefined" && localStorage.getItem("admin:userSort")) || "name-asc";

  const parseEmailInput = (value) => {
    if (!value) return { emails: [], invalid: null };
    const tokens = String(value)
      .split(/[\n,;]+/)
      .map((token) => token.trim())
      .filter(Boolean);
    const seen = new Set();
    const emails = [];
    for (const token of tokens) {
      if (!/^.+@.+\..+$/.test(token)) {
        return { emails: [], invalid: token };
      }
      const normalized = token.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      emails.push(token);
    }
    return { emails, invalid: null };
  };

  const emailMultiState = new WeakMap();
  const EMAIL_MULTI_STYLES_ID = "email-multi-styles";

  function ensureEmailMultiStyles() {
    if (document.getElementById(EMAIL_MULTI_STYLES_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = EMAIL_MULTI_STYLES_ID;
    style.textContent = `
      .email-multi {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .email-multi-editor {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
        background: var(--card-bg, #ffffff);
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 0.75rem;
        padding: 0.75rem;
        box-shadow: inset 0 1px 1px rgba(15, 23, 42, 0.04);
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .email-multi-editor:focus-within {
        border-color: var(--accent, #3ea6eb);
        box-shadow: 0 0 0 2px rgba(62, 166, 235, 0.15);
      }
      .email-multi-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .email-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        border-radius: 999px;
        background: var(--accent, #3ea6eb);
        color: #ffffff;
        padding: 0.25rem 0.75rem;
        font-size: 0.85rem;
      }
      .email-pill-remove {
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font-size: 0.9rem;
        line-height: 1;
        padding: 0;
        display: inline-flex;
        align-items: center;
      }
      .email-pill-remove:focus-visible {
        outline: 2px solid rgba(255, 255, 255, 0.7);
        border-radius: 999px;
      }
      .email-multi-input {
        flex: 1;
        min-width: 12rem;
        border: none;
        background: transparent;
        font-size: 0.95rem;
      }
      .email-multi-input:focus {
        outline: none;
      }
      .email-multi-add {
        border: none;
        border-radius: 999px;
        background: var(--accent, #3ea6eb);
        color: #ffffff;
        cursor: pointer;
        font-size: 0.85rem;
        padding: 0.4rem 0.9rem;
        transition: background-color 0.15s ease, opacity 0.15s ease;
      }
      .email-multi-add:hover {
        background: #3398d9;
      }
      .email-multi-add:focus-visible {
        outline: 2px solid rgba(62, 166, 235, 0.35);
        outline-offset: 2px;
      }
      .email-multi-helper {
        font-size: 0.8rem;
        color: var(--muted, #6b7280);
      }
      .email-multi-error {
        font-size: 0.8rem;
        color: #dc2626;
      }
      .email-modal-overlay {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        background: rgba(15, 23, 42, 0.35);
        backdrop-filter: blur(2px);
      }
      .email-modal-card {
        width: min(100%, 28rem);
        background: var(--card-bg, #ffffff);
        color: var(--text, #1f2937);
        border-radius: 1rem;
        padding: 1.75rem;
        box-shadow: 0 24px 55px rgba(15, 23, 42, 0.25);
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }
      .email-modal-title {
        font-size: 1.1rem;
        font-weight: 600;
        margin: 0;
      }
      .email-modal-subtitle {
        margin: 0.25rem 0 0;
        font-size: 0.9rem;
        color: var(--muted, #6b7280);
      }
      .email-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
    `;
    document.head.appendChild(style);
  }

  function resolveEmailMultiRoot(reference) {
    if (!reference) return null;
    if (reference instanceof Element) return reference;
    if (typeof reference === "string") return document.querySelector(reference);
    return null;
  }

  function setupEmailMultiInput(root, options = {}) {
    const target = resolveEmailMultiRoot(root);
    if (!target || emailMultiState.has(target)) return null;

    ensureEmailMultiStyles();

    const {
      initial = [],
      placeholder = "Ajoutez une adresse email puis appuyez sur Entrée",
      helperText = "Appuyez sur Entrée, Tab ou cliquez sur Ajouter pour valider chaque email. Vous pouvez aussi coller plusieurs adresses d’un coup.",
      addButtonLabel = "Ajouter",
      inputId = null,
      autoFocus = false,
    } = options;

    target.innerHTML = "";
    target.classList.add("email-multi");

    const editor = document.createElement("div");
    editor.className = "email-multi-editor";

    const pills = document.createElement("div");
    pills.className = "email-multi-pills";

    const input = document.createElement("input");
    input.type = "email";
    input.placeholder = placeholder;
    input.autocomplete = "off";
    input.className = "email-multi-input";
    if (inputId) {
      input.id = inputId;
    }

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "email-multi-add";
    addButton.textContent = addButtonLabel;

    editor.append(pills, input, addButton);
    target.append(editor);

    let helper = null;
    if (helperText) {
      helper = document.createElement("p");
      helper.className = "email-multi-helper";
      helper.textContent = helperText;
      target.append(helper);
    }

    const error = document.createElement("p");
    error.className = "email-multi-error";
    error.style.display = "none";
    target.append(error);

    const state = {
      emails: [],
      seen: new Set(),
      input,
      pills,
      error,
      helper,
      editor,
    };

    const setError = (message) => {
      if (!error) return;
      if (message) {
        error.textContent = message;
        error.style.display = "";
      } else {
        error.textContent = "";
        error.style.display = "none";
      }
    };

    const renderPills = () => {
      pills.innerHTML = "";
      state.emails.forEach((email) => {
        const pill = document.createElement("span");
        pill.className = "email-pill";
        pill.dataset.emailPill = "1";
        pill.dataset.value = email;

        const text = document.createElement("span");
        text.textContent = email;

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "email-pill-remove";
        removeButton.dataset.emailRemove = email;
        removeButton.setAttribute("aria-label", `Supprimer ${email}`);
        removeButton.textContent = "×";

        pill.append(text, removeButton);
        pills.appendChild(pill);
      });
    };

    const addEmails = (value, { fromInput = false, suppressError = false } = {}) => {
      if (value === undefined || value === null || value === "") {
        if (!suppressError) {
          setError(null);
        }
        return true;
      }
      const serialized = Array.isArray(value) ? value.join("\n") : String(value);
      const { emails, invalid } = parseEmailInput(serialized);
      if (invalid) {
        if (!suppressError) {
          setError(`Adresse email invalide : ${invalid}`);
        }
        if (fromInput) {
          state.input.focus();
        }
        return false;
      }
      let added = false;
      emails.forEach((email) => {
        const key = email.toLowerCase();
        if (state.seen.has(key)) return;
        state.seen.add(key);
        state.emails.push(email);
        added = true;
      });
      if (added) {
        renderPills();
      }
      if (!suppressError) {
        setError(null);
      }
      return true;
    };

    const removeEmail = (email) => {
      if (!email) return;
      const key = email.toLowerCase();
      if (!state.seen.has(key)) return;
      state.seen.delete(key);
      const index = state.emails.findIndex((item) => item.toLowerCase() === key);
      if (index >= 0) {
        state.emails.splice(index, 1);
      }
      renderPills();
      setError(null);
    };

    const removeLastEmail = () => {
      if (!state.emails.length) return;
      const last = state.emails.pop();
      if (last) {
        state.seen.delete(last.toLowerCase());
      }
      renderPills();
      setError(null);
    };

    const commitPending = () => {
      const raw = state.input.value;
      if (!raw) {
        setError(null);
        return true;
      }
      const success = addEmails(raw, { fromInput: true });
      if (success) {
        state.input.value = "";
      }
      return success;
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "Tab" || event.key === "," || event.key === ";") {
        event.preventDefault();
        commitPending();
        return;
      }
      if (event.key === "Backspace" && !state.input.value) {
        event.preventDefault();
        removeLastEmail();
      }
    });

    input.addEventListener("input", () => {
      if (/[\n,;]/.test(state.input.value)) {
        commitPending();
      } else {
        setError(null);
      }
    });

    input.addEventListener("blur", () => {
      commitPending();
    });

    addButton.addEventListener("click", () => {
      commitPending();
      state.input.focus();
    });

    target.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-email-remove]");
      if (!btn) return;
      const email = btn.dataset.emailRemove;
      removeEmail(email);
      state.input.focus();
    });

    emailMultiState.set(target, {
      ...state,
      setError,
      renderPills,
      addEmails,
      removeEmail,
      removeLastEmail,
      commitPending,
      getValues: () => state.emails.slice(),
      setValues: (values = []) => {
        state.emails = [];
        state.seen.clear();
        renderPills();
        if (Array.isArray(values) && values.length) {
          addEmails(values, { suppressError: true });
        } else {
          setError(null);
        }
      },
      focus: () => state.input.focus(),
      clear: () => {
        state.emails = [];
        state.seen.clear();
        renderPills();
        setError(null);
        state.input.value = "";
      },
    });

    renderPills();
    if (Array.isArray(initial) && initial.length) {
      addEmails(initial, { suppressError: true });
      renderPills();
    }
    if (autoFocus) {
      setTimeout(() => {
        state.input.focus();
      }, 0);
    }

    return emailMultiState.get(target);
  }

  function getEmailMultiValues(reference) {
    const root = resolveEmailMultiRoot(reference);
    if (!root) return [];
    const state = emailMultiState.get(root);
    return state ? state.getValues() : [];
  }

  function setEmailMultiValues(reference, values = []) {
    const root = resolveEmailMultiRoot(reference);
    if (!root) return;
    const state = emailMultiState.get(root);
    if (state) {
      state.setValues(values);
    }
  }

  function commitEmailMultiPending(reference) {
    const root = resolveEmailMultiRoot(reference);
    if (!root) return true;
    const state = emailMultiState.get(root);
    return state ? state.commitPending() : true;
  }

  function focusEmailMultiInput(reference) {
    const root = resolveEmailMultiRoot(reference);
    if (!root) return;
    const state = emailMultiState.get(root);
    if (state) {
      state.focus();
    }
  }

  function clearEmailMultiInput(reference) {
    const root = resolveEmailMultiRoot(reference);
    if (!root) return;
    const state = emailMultiState.get(root);
    if (state) {
      state.clear();
    }
  }

  function setEmailMultiError(reference, message) {
    const root = resolveEmailMultiRoot(reference);
    if (!root) return;
    const state = emailMultiState.get(root);
    if (state) {
      state.setError(message);
    }
  }

  function renderAdmin(db) {
    // Hide the sidebar in admin mode
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.style.display = "none";

    if (typeof profileUnsubscribe === "function") {
      try { profileUnsubscribe(); } catch (error) { console.warn("profile:watch:cleanup", error); }
      profileUnsubscribe = null;
    }
    refreshUserBadge(null);

    const root = document.getElementById("view-root");
    appLog("admin:render");
    root.innerHTML = `
      <div class="space-y-5">
        <section class="card p-5 space-y-2">
          <div class="space-y-1">
            <h2 class="text-xl font-semibold">Admin — Utilisateurs</h2>
            <p class="text-sm text-[var(--muted)]">Gérez vos profils et vos rappels même sur petit écran.</p>
          </div>
        </section>
        <div class="grid gap-4 md:grid-cols-2">
          <form id="new-user-form" class="card p-4 space-y-3" data-autosave-key="admin:new-user">
            <div class="space-y-1">
              <div class="font-semibold">Créer un utilisateur</div>
              <p class="text-sm text-[var(--muted)]">Ajoutez rapidement une nouvelle fiche depuis votre téléphone.</p>
            </div>
            <input type="text" id="new-user-name" placeholder="Nom de l’utilisateur" required class="w-full" />
            <div class="space-y-2">
              <label for="new-user-email-input" class="flex flex-col text-[var(--muted)]">
                <span class="text-sm font-medium">Emails de l’utilisateur</span>
                <span class="text-xs font-normal">Optionnel — validez chaque adresse avec Entrée ou le bouton “Ajouter”.</span>
              </label>
              <div id="new-user-email" data-input-id="new-user-email-input"></div>
            </div>
            <button class="btn btn-primary w-full sm:w-auto" type="submit">Créer l’utilisateur</button>
          </form>
          <section class="card p-4 space-y-3">
            <div class="font-semibold">Astuces rapides</div>
            <ul class="space-y-2 text-sm text-[var(--muted)]">
              <li class="flex items-start gap-2">
                <span class="mt-0.5">✏️</span>
                <span>Renommez les profils pour refléter les surnoms courants et éviter les confusions.</span>
              </li>
              <li class="flex items-start gap-2">
                <span class="mt-0.5">🗑️</span>
                <span>Supprimez les comptes inactifs afin de garder une vue claire et légère.</span>
              </li>
            </ul>
          </section>
        </div>
        <section class="card p-4 space-y-4">
          <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div class="font-semibold">Utilisateurs existants</div>
            <p class="text-xs text-[var(--muted)] sm:text-right">Utilisez les actions ci-dessous pour gérer chaque profil.</p>
          </div>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p class="text-sm text-[var(--muted)]">Tri des utilisateurs</p>
            <label class="flex items-center gap-2 text-sm text-[var(--muted)]">
              <span>Afficher par :</span>
              <select id="admin-user-sort" class="w-full sm:w-auto">
                <option value="name-asc">Nom (A → Z)</option>
                <option value="name-desc">Nom (Z → A)</option>
                <option value="created-desc">Création (récent → ancien)</option>
                <option value="created-asc">Création (ancien → récent)</option>
              </select>
            </label>
          </div>
          <div id="user-list" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"></div>
        </section>
      </div>
    `;

    const newUserEmailRoot = document.getElementById("new-user-email");
    if (newUserEmailRoot) {
      setupEmailMultiInput(newUserEmailRoot, {
        inputId: newUserEmailRoot.dataset.inputId || "new-user-email-input",
        helperText:
          "Appuyez sur Entrée, Tab ou cliquez sur Ajouter pour valider chaque email. Vous pouvez aussi coller plusieurs adresses à la fois.",
      });
    }

    const sortSelect = document.getElementById("admin-user-sort");
    if (sortSelect) {
      sortSelect.value = adminUserSort;
      sortSelect.addEventListener("change", () => {
        adminUserSort = sortSelect.value;
        try {
          localStorage.setItem("admin:userSort", adminUserSort);
        } catch (storageError) {
          console.warn("admin:sort:storage:error", storageError);
        }
        loadUsers(db);
      });
    }

    const form = document.getElementById("new-user-form");
    if (form) {
      form.addEventListener("submit", async(e) => {
        e.preventDefault();
        const input = document.getElementById("new-user-name");
        const name = input?.value?.trim();
        const emailRoot = document.getElementById("new-user-email");
        commitEmailMultiPending(emailRoot);
        const emails = getEmailMultiValues(emailRoot);
        const { invalid } = parseEmailInput(emails.join("\n"));
        if (invalid) {
          setEmailMultiError(emailRoot, `Adresse email invalide : ${invalid}`);
          alert(`Adresse email invalide: ${invalid}`);
          return;
        }
        if (!name) return;
        appLog("admin:newUser:submit", { name });
        const uid = newUid();
        try {
          await appFirestore.setDoc(appFirestore.doc(db, "u", uid), {
            name: name,
            displayName: name,
            createdAt: new Date().toISOString(),
            ...(emails.length
              ? {
                  email: emails[0],
                  emails,
                }
              : {}),
          });
          if (input) input.value = "";
          if (emailRoot) clearEmailMultiInput(emailRoot);
          appLog("admin:newUser:created", { uid, name });
          loadUsers(db);
        } catch (error) {
          console.error("admin:newUser:error", error);
          appLog("admin:newUser:error", { message: error?.message || String(error) });
          alert("Création impossible. Réessaie plus tard.");
        }
      });
    }

    loadUsers(db);
  }

  async function loadUsers(db) {
    const list = document.getElementById("user-list");
    if (!list) return;
    list.innerHTML = "<div class='text-sm text-[var(--muted)]'>Chargement…</div>";
    appLog("admin:users:load:start");
    const escapeHtml = (value) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    const normalizeEmails = (data) => {
      const seen = new Set();
      const result = [];
      const pushEmail = (value) => {
        if (typeof value !== "string") return;
        const trimmed = value.trim();
        if (!trimmed) return;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        result.push(trimmed);
      };
      if (Array.isArray(data?.emails)) {
        data.emails.forEach(pushEmail);
      }
      if (typeof data?.email === "string") {
        pushEmail(data.email);
      }
      return result;
    };
    try {
      const ss = await appFirestore.getDocs(appFirestore.collection(db, "u"));
      const items = [];
      const uids = [];
      ss.forEach(d => {
        const data = d.data();
        const uid = d.id;
        const displayName = data.displayName || data.name || "(sans nom)";
        const emails = normalizeEmails(data);
        const createdAtRaw = data.createdAt || data.createdAtIso || data.created_at || null;
        const createdAtIso = (() => {
          if (!createdAtRaw) return "";
          if (createdAtRaw instanceof Date) return createdAtRaw.toISOString();
          if (typeof createdAtRaw === "string") {
            const trimmed = createdAtRaw.trim();
            if (!trimmed) return "";
            const date = new Date(trimmed);
            if (!Number.isNaN(date.getTime())) return date.toISOString();
            return trimmed;
          }
          return "";
        })();
        appLog("admin:users:load:item", { uid, displayName });
        items.push({
          uid,
          displayName,
          emails,
          createdAt: createdAtIso,
          data,
        });
      });

      const collator = new Intl.Collator("fr", { sensitivity: "base" });
      const parseDate = (value) => {
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.getTime();
      };

      items.sort((a, b) => {
        switch (adminUserSort) {
          case "name-desc":
            return collator.compare(b.displayName, a.displayName);
          case "created-asc": {
            const aDate = parseDate(a.createdAt);
            const bDate = parseDate(b.createdAt);
            if (aDate === bDate) {
              return collator.compare(a.displayName, b.displayName);
            }
            if (aDate === null) return 1;
            if (bDate === null) return -1;
            return aDate - bDate;
          }
          case "created-desc": {
            const aDate = parseDate(a.createdAt);
            const bDate = parseDate(b.createdAt);
            if (aDate === bDate) {
              return collator.compare(a.displayName, b.displayName);
            }
            if (aDate === null) return 1;
            if (bDate === null) return -1;
            return bDate - aDate;
          }
          case "name-asc":
          default:
            return collator.compare(a.displayName, b.displayName);
        }
      });

      const cards = items.map(({ uid, displayName, emails }) => {
        const safeName = escapeHtml(displayName);
        const safeUid = escapeHtml(uid);
        const emailLinks = emails
          .map((value) => {
            const safeValue = escapeHtml(value);
            const href = `mailto:${encodeURIComponent(value)}`;
            return `<a class="text-[var(--accent)]" href="${href}">${safeValue}</a>`;
          })
          .join("<br />");
        const encodedEmails = encodeURIComponent(JSON.stringify(emails));
        const encodedUid = encodeURIComponent(uid);
        const link = `${location.origin}${location.pathname}#/u/${encodedUid}/daily`;
        uids.push(uid);
        return `
          <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
            <div class="flex flex-col gap-1">
              <div class="font-semibold text-base">${safeName}</div>
              <div class="text-xs text-[var(--muted)] break-all">UID&nbsp;: ${safeUid}</div>
              <div class="text-xs text-[var(--muted)] break-all">
                Email${emails.length > 1 ? "s" : ""}&nbsp;:
                ${emails.length
                  ? emailLinks
                  : '<span class="italic">Non renseigné</span>'}
              </div>
            </div>
            <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <a class="btn btn-ghost text-sm inline-flex justify-center w-full sm:w-auto"
                 href="${link}"
                 target="_blank"
                 rel="noopener noreferrer"
                 data-uid="${safeUid}"
                 data-action="open">Ouvrir</a>
              <button type="button"
                      class="btn btn-ghost text-sm inline-flex justify-center w-full sm:w-auto"
                      data-uid="${safeUid}"
                      data-emails="${encodedEmails}"
                      data-action="email"
                      title="Mettre à jour les adresses email de ${safeName}">✉️ Emails</button>
              <button type="button"
                      class="btn btn-ghost text-sm inline-flex justify-center w-full sm:w-auto"
                      data-uid="${safeUid}"
                      data-notif-toggle="1"
                      title="Gérer les notifications de ${safeName}">🔔 Activer les notifications</button>
              <button type="button"
                      class="btn btn-ghost text-sm inline-flex justify-center w-full sm:w-auto"
                      data-uid="${safeUid}"
                      data-name="${safeName}"
                      data-action="rename"
                      title="Renommer ${safeName}">✏️ Renommer</button>
              <button type="button"
                      class="btn btn-ghost text-sm inline-flex justify-center w-full sm:w-auto text-red-600"
                      data-uid="${safeUid}"
                      data-name="${safeName}"
                      data-action="delete"
                      title="Supprimer ${safeName}">🗑️ Supprimer</button>
            </div>
          </div>
        `;
      });
      list.innerHTML = cards.join("") || "<div class='text-sm text-[var(--muted)]'>Aucun utilisateur</div>";
      uids.forEach((itemUid) => {
        syncNotificationButtonsForUid(itemUid);
      });
      appLog("admin:users:load:done", { count: items.length });

      if (!list.dataset.bound) {
        list.addEventListener("click", async (e) => {
          const actionTarget = e.target.closest("[data-uid]");
          if (!actionTarget) return;
          const { uid, action, name } = actionTarget.dataset;
          if (!uid) return;
          if (actionTarget.hasAttribute("data-notif-toggle")) {
            e.preventDefault();
            appLog("admin:users:notifications:toggle", { uid });
            handleNotificationToggle(uid, actionTarget, { interactive: true });
            return;
          }
          if (action === "email") {
            let currentEmails = [];
            try {
              currentEmails = actionTarget.dataset.emails
                ? JSON.parse(decodeURIComponent(actionTarget.dataset.emails))
                : [];
            } catch (error) {
              console.warn("admin:users:email:dataset:error", error);
              currentEmails = [];
            }
            appLog("admin:users:email:dialog:open", { uid, currentEmails });
            const dialogResult = await openEmailDialog({
              title: name ? `Emails de ${name}` : "Emails du profil",
              subtitle: "Ajoutez, modifiez ou supprimez les adresses email à notifier.",
              initialEmails: currentEmails,
            });
            if (dialogResult === null) {
              appLog("admin:users:email:cancelled", { uid });
              return;
            }
            const { emails: parsedEmails, invalid } = parseEmailInput(dialogResult.join("\n"));
            if (invalid) {
              appLog("admin:users:email:invalid", { uid, invalid });
              alert(`Adresse email invalide: ${invalid}`);
              return;
            }
            appLog("admin:users:email:dialog:submit", { uid, nextEmails: parsedEmails });
            try {
              const userRef = appFirestore.doc(db, "u", uid);
              const hasEmails = parsedEmails.length > 0;
              const deleteField =
                typeof appFirestore.deleteField === "function"
                  ? appFirestore.deleteField()
                  : null;
              const payload = hasEmails
                ? {
                    email: parsedEmails[0],
                    emails: parsedEmails,
                  }
                : {
                    email: deleteField,
                    emails: deleteField,
                  };
              await appFirestore.setDoc(userRef, payload, { merge: true });
              appLog("admin:users:email:write", { uid, nextEmails: parsedEmails });
              await loadUsers(db);
            } catch (error) {
              console.error("admin:users:email:error", error);
              appLog("admin:users:email:error", { uid, message: error?.message || String(error) });
              alert("Impossible de mettre à jour les adresses email.");
            }
            return;
          }
          if ((action || actionTarget.tagName === "A") && (action || "open") === "open") {
            if (!actionTarget.target || actionTarget.target === "_self") {
              e.preventDefault();
              location.hash = `#/u/${uid}`;
              appLog("admin:users:navigate", { uid });
              handleRoute();
            }
            return;
          }

          e.preventDefault();
          if (action === "rename") {
            const currentName = name || "";
            appLog("admin:users:rename:prompt", { uid, currentName });
            const nextName = prompt("Nouveau nom de l’utilisateur :", currentName);
            if (nextName === null) {
              appLog("admin:users:rename:cancelled", { uid });
              return;
            }
            const trimmed = nextName.trim();
            if (!trimmed) {
              appLog("admin:users:rename:invalid", { uid, value: nextName });
              alert("Le nom ne peut pas être vide.");
              return;
            }
            if (trimmed === currentName.trim()) {
              appLog("admin:users:rename:unchanged", { uid });
              return;
            }
            try {
              const userRef = appFirestore.doc(db, "u", uid);
              await appFirestore.setDoc(
                userRef,
                {
                  name: trimmed,
                  displayName: trimmed,
                },
                { merge: true }
              );
              appLog("admin:users:rename:write", { uid, nextName: trimmed });
              try {
                const snap = await appFirestore.getDoc(userRef);
                if (snapshotExists(snap)) {
                  const storedData = snap.data() || {};
                  const storedName = storedData.displayName || storedData.name || null;
                  appLog("admin:users:rename:confirm", { uid, storedName });
                } else {
                  appLog("admin:users:rename:confirm", { uid, storedName: null, exists: false });
                }
              } catch (verifyError) {
                console.warn("admin:users:rename:verify:error", verifyError);
              }
              await loadUsers(db);
            } catch (error) {
              console.error("admin:users:rename:error", error);
              appLog("admin:users:rename:error", { uid, message: error?.message || String(error) });
              alert("Impossible de renommer l’utilisateur.");
            }
            return;
          }

          if (action === "delete") {
            const label = name || uid;
            if (!confirm(`Supprimer l’utilisateur « ${label} » ? Cette action est irréversible.`)) {
              appLog("admin:users:delete:cancelled", { uid });
              return;
            }
            try {
              appLog("admin:users:delete:start", { uid });
              await appFirestore.deleteDoc(appFirestore.doc(db, "u", uid));
              appLog("admin:users:delete:done", { uid });
              await loadUsers(db);
            } catch (error) {
              console.error("admin:users:delete:error", error);
              alert("Impossible de supprimer l’utilisateur.");
            }
          }
        });
        list.dataset.bound = "1";
      }
    } catch (error) {
      console.warn("admin:users:load:error", error);
      appLog("admin:users:load:error", { message: error?.message || String(error) });
      list.innerHTML = "<div class='text-sm text-red-600'>Impossible de charger les utilisateurs.</div>";
    }
  }

  async function openEmailDialog({
    title = "Adresses email",
    subtitle = "",
    initialEmails = [],
    confirmLabel = "Enregistrer",
    cancelLabel = "Annuler",
  } = {}) {
    ensureEmailMultiStyles();

    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "email-modal-overlay";

      const form = document.createElement("form");
      form.className = "email-modal-card";
      form.setAttribute("role", "dialog");
      form.setAttribute("aria-modal", "true");
      form.setAttribute("aria-label", title);

      const header = document.createElement("div");
      const titleEl = document.createElement("h3");
      titleEl.className = "email-modal-title";
      titleEl.textContent = title;
      header.append(titleEl);
      if (subtitle) {
        const subtitleEl = document.createElement("p");
        subtitleEl.className = "email-modal-subtitle";
        subtitleEl.textContent = subtitle;
        header.append(subtitleEl);
      }
      form.append(header);

      const body = document.createElement("div");
      body.className = "space-y-2";

      const label = document.createElement("label");
      label.setAttribute("for", "email-dialog-input");
      label.className = "text-sm font-medium text-[var(--muted)]";
      label.textContent = "Adresses email";
      body.append(label);

      const multiRoot = document.createElement("div");
      multiRoot.dataset.inputId = "email-dialog-input";
      body.append(multiRoot);

      form.append(body);

      const actions = document.createElement("div");
      actions.className = "email-modal-actions";

      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "btn btn-ghost";
      cancelButton.textContent = cancelLabel;
      actions.append(cancelButton);

      const submitButton = document.createElement("button");
      submitButton.type = "submit";
      submitButton.className = "btn btn-primary";
      submitButton.textContent = confirmLabel;
      actions.append(submitButton);

      form.append(actions);
      overlay.append(form);
      document.body.append(overlay);

      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      setupEmailMultiInput(multiRoot, {
        inputId: "email-dialog-input",
        initial: initialEmails,
        autoFocus: true,
        helperText:
          "Appuyez sur Entrée, Tab ou cliquez sur Ajouter pour valider chaque email. Vous pouvez aussi coller plusieurs adresses.",
      });

      const cleanup = (result) => {
        document.body.style.overflow = previousOverflow;
        document.removeEventListener("keydown", onKeydown, true);
        overlay.remove();
        resolve(result);
      };

      const onKeydown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cleanup(null);
        }
      };

      document.addEventListener("keydown", onKeydown, true);

      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          cleanup(null);
        }
      });

      cancelButton.addEventListener("click", (event) => {
        event.preventDefault();
        cleanup(null);
      });

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        commitEmailMultiPending(multiRoot);
        const values = getEmailMultiValues(multiRoot);
        const { invalid } = parseEmailInput(values.join("\n"));
        if (invalid) {
          setEmailMultiError(multiRoot, `Adresse email invalide : ${invalid}`);
          return;
        }
        cleanup(values);
      });
    });
  }

  function renderUser(db, uid) {
    appLog("render:user", { uid });
    initApp({
      app: ctx.app,
      db,
      user: {
        uid
      }
    });
  }

  function renderStats(ctx, root, qp) {
    const uid = ctx.user?.uid || null;
    if (!uid) {
      root.innerHTML = "<div class='card p-4'>Aucun utilisateur sélectionné.</div>";
      return;
    }
    if (!ctx.db || typeof ctx.db.collection !== "function") {
      root.innerHTML = "<div class='card p-4'>Firestore non initialisé.</div>";
      return;
    }

    const escapeHtml = (value) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const tableHtml = (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) return "<div class='text-sm text-[var(--muted)]'>Aucune donnée.</div>";
      const head = Array.isArray(list[0]) ? list[0] : [];
      const body = list.slice(1);
      const thead = head.length
        ? `<thead><tr>${head
            .map(
              (c) =>
                `<th class='border-b border-slate-200 bg-slate-50 px-2 py-2 text-left text-xs font-semibold text-slate-600'>${escapeHtml(
                  c
                )}</th>`
            )
            .join("")}</tr></thead>`
        : "";
      const tbody = body.length
        ? `<tbody>${body
            .map(
              (row) =>
                `<tr>${(Array.isArray(row) ? row : [])
                  .map((cell) => `<td class='border-b border-slate-100 px-2 py-2 align-top text-sm'>${escapeHtml(cell)}</td>`)
                  .join("")}</tr>`
            )
            .join("")}</tbody>`
        : "";
      return `<div class='overflow-auto rounded-xl border border-slate-200'><table class='min-w-full border-collapse'>${thead}${tbody}</table></div>`;
    };

    root.innerHTML = `
      <div class='space-y-4'>
        <section class='card p-5'>
          <div class='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div>
              <div class='text-xs font-semibold uppercase tracking-wide text-[var(--muted)]'>Statistiques</div>
              <div class='text-lg font-semibold' data-stats-title>${escapeHtml(uid)}</div>
              <div class='text-sm text-[var(--muted)]' data-stats-subtitle>Chargement…</div>
            </div>
            <div class='flex flex-wrap items-end gap-2'>
              <label class='text-sm text-[var(--muted)] flex flex-col gap-1'>
                <span>Journalier</span>
                <select class='w-44' data-stats-days>
                  <option value='30'>30 jours</option>
                  <option value='90'>90 jours</option>
                  <option value='180' selected>180 jours</option>
                  <option value='720'>720 jours</option>
                  <option value='all'>Tout</option>
                </select>
              </label>
              <label class='text-sm text-[var(--muted)] flex flex-col gap-1'>
                <span>Pratique</span>
                <select class='w-44' data-stats-sessions>
                  <option value='10'>10 sessions</option>
                  <option value='30'>30 sessions</option>
                  <option value='100'>100 sessions</option>
                  <option value='300' selected>300 sessions</option>
                  <option value='800'>800 sessions</option>
                  <option value='all'>Tout</option>
                </select>
              </label>
              <label class='text-sm text-[var(--muted)] flex flex-col gap-1'>
                <span>Données brutes</span>
                <select class='w-56' data-stats-raw></select>
              </label>
            </div>
          </div>
        </section>

        <details class='card p-4' open>
          <summary class='cursor-pointer font-semibold'>Résumé</summary>
          <div class='mt-3' data-stats-summary></div>
        </details>

        <details class='card p-4'>
          <summary class='cursor-pointer font-semibold'>Journalier</summary>
          <div class='mt-3' data-stats-daily></div>
        </details>

        <details class='card p-4'>
          <summary class='cursor-pointer font-semibold'>Pratique</summary>
          <div class='mt-3' data-stats-practice></div>
        </details>

        <details class='card p-4'>
          <summary class='cursor-pointer font-semibold'>Objectifs</summary>
          <div class='mt-3 grid gap-4'>
            <div>
              <div class='text-sm font-semibold mb-2'>Objectifs</div>
              <div note=1 data-stats-goals></div>
            </div>
            <div>
              <div class='text-sm font-semibold mb-2'>Notes objectifs</div>
              <div note=1 data-stats-goal-notes></div>
            </div>
          </div>
        </details>

        <details class='card p-4'>
          <summary class='cursor-pointer font-semibold'>Données brutes (toutes)</summary>
          <div class='mt-3' data-stats-raw-table></div>
        </details>
      </div>
    `;

    const subtitleEl = root.querySelector("[data-stats-subtitle]");
    const daysSelect = root.querySelector("[data-stats-days]");
    const sessionsSelect = root.querySelector("[data-stats-sessions]");
    const rawSelect = root.querySelector("[data-stats-raw]");
    const summaryEl = root.querySelector("[data-stats-summary]");
    const dailyEl = root.querySelector("[data-stats-daily]");
    const practiceEl = root.querySelector("[data-stats-practice]");
    const goalsEl = root.querySelector("[data-stats-goals]");
    const goalNotesEl = root.querySelector("[data-stats-goal-notes]");
    const rawTableEl = root.querySelector("[data-stats-raw-table]");

    const userRef = ctx.db.collection("u").doc(uid);

    (async () => {
      try {
        const profileSnap = await userRef.get();
        const profile = profileSnap?.exists ? profileSnap.data() || {} : {};
        const displayName = profile.displayName || profile.name || uid;

        const categories = await readCollectionDocsCompat(userRef.collection("categories"));
        const consignes = await readCollectionDocsCompat(userRef.collection("consignes"));
        const responses = await readCollectionDocsCompat(userRef.collection("responses"));
        const sessions = await readCollectionDocsCompat(userRef.collection("sessions"));
        const sr = await readCollectionDocsCompat(userRef.collection("sr"));
        const modules = await readCollectionDocsCompat(userRef.collection("modules"));
        const pushTokens = await readCollectionDocsCompat(userRef.collection("pushTokens"));
        const history = await readCollectionDocsCompat(userRef.collection("history"));

        const checklistRows = [];
        try {
          const answerDatesSnap = await userRef.collection("answers").get();
          for (const dateDoc of answerDatesSnap.docs) {
            const dateKey = dateDoc.id;
            const consSnap = await userRef.collection("answers").doc(dateKey).collection("consignes").get();
            consSnap.forEach((doc) => {
              checklistRows.push({ dateKey, consigneId: doc.id, ...(doc.data() || {}) });
            });
          }
        } catch (_) { }

        const consigneHistory = [];
        try {
          for (const consigne of consignes) {
            if (!consigne?.id) continue;
            const snap = await userRef.collection("consignes").doc(consigne.id).collection("history").get();
            snap.forEach((doc) => {
              consigneHistory.push({ consigneId: consigne.id, entryId: doc.id, ...(doc.data() || {}) });
            });
          }
        } catch (_) { }

        const objectifs = await readCollectionDocsCompat(userRef.collection("objectifs"));
        const objectiveNotes = await readCollectionDocsCompat(userRef.collection("objectiveNotes"));

        const dailyConsignes = (consignes || []).filter((c) => c?.mode === "daily");
        const practiceConsignes = (consignes || []).filter((c) => c?.mode === "practice");
        const dailyResponseRows = (responses || []).filter((r) => r?.mode === "daily");
        const practiceResponseRows = (responses || []).filter((r) => r?.mode === "practice");

        const practiceHistoryRows = [];
        try {
          for (const c of practiceConsignes) {
            const consigneId = String(c?.id || "");
            if (!consigneId) continue;
            const snap = await userRef.collection("history").doc(consigneId).collection("entries").get();
            snap.forEach((docSnap) => {
              practiceHistoryRows.push({ consigneId, historyKey: docSnap.id, ...(docSnap.data() || {}) });
            });
          }
        } catch (_) { }

        const dailyIndex = buildResponseIndex(dailyResponseRows);
        const practiceSessionIndex = buildPracticeSessionIndex(practiceResponseRows);
        const practiceHistoryIndex = buildPracticeHistoryIndex(practiceHistoryRows);
        const checklistIndex = buildResponseIndex(checklistRows);

        const allDailyDayKeys = Array.from(
          new Set(
            [
              ...dailyResponseRows.map((r) => toDayKey(r?.dayKey || r?.pageDateIso || null)),
              ...checklistRows.map((r) => toDayKey(r?.dateKey || r?.dayKey || null)),
            ].filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b));

        const sessionDayKeyById = new Map();
        const sessionIds = [];
        const seenSessions = new Set();
        (sessions || [])
          .slice()
          .sort((a, b) => toMillisSafe(a?.startedAt || a?.createdAt || 0) - toMillisSafe(b?.startedAt || b?.createdAt || 0))
          .forEach((s) => {
            const id = String(s?.id || "");
            if (!id || seenSessions.has(id)) return;
            seenSessions.add(id);
            sessionIds.push(id);
            const dk = toDayKey(s?.startedAt || s?.createdAt || null);
            if (dk) sessionDayKeyById.set(id, dk);
          });
        (practiceResponseRows || []).forEach((r) => {
          const id = String(r?.sessionId || r?.session_id || "");
          if (!id || seenSessions.has(id)) return;
          seenSessions.add(id);
          sessionIds.push(id);
          const dk = toDayKey(r?.dayKey || r?.pageDateIso || r?.createdAt || r?.updatedAt || null);
          if (dk && !sessionDayKeyById.has(id)) sessionDayKeyById.set(id, dk);
        });
        (practiceHistoryRows || []).forEach((r) => {
          const id = String(r?.historyKey || r?.entryId || r?.key || r?.id || "");
          if (!id || seenSessions.has(id)) return;
          seenSessions.add(id);
          sessionIds.push(id);
          const dk = toDayKey(r?.dayKey || r?.pageDateIso || r?.pageDate || r?.createdAt || r?.updatedAt || id);
          if (dk && !sessionDayKeyById.has(id)) sessionDayKeyById.set(id, dk);
        });

        const sessionColumnsAll = sessionIds.map((id, idx) => {
          const dk = sessionDayKeyById.get(id) || "";
          return { id, label: `S${idx + 1}${dk ? ` — ${dk}` : ""}` };
        });

        const rawSources = {
          profile: [profile],
          categories,
          consignes,
          responses,
          sessions,
          sr,
          modules,
          pushTokens,
          history,
          objectifs,
          objectiveNotes,
          checklistRows,
          consigneHistory,
          practiceHistoryRows,
        };

        if (rawSelect) {
          rawSelect.innerHTML = Object.keys(rawSources)
            .map((k) => `<option value='${escapeHtml(k)}'>${escapeHtml(k)}</option>`)
            .join("");
          rawSelect.value = "consignes";
        }

        const renderSummary = () => {
          if (!summaryEl) return;
          const dailyWindows = {
            "7j": pickLastWindow(allDailyDayKeys, 7),
            "30j": pickLastWindow(allDailyDayKeys, 30),
            "90j": pickLastWindow(allDailyDayKeys, 90),
          };
          const practiceWindows = {
            "10 sessions": pickLastWindow(sessionColumnsAll, 10),
            "30 sessions": pickLastWindow(sessionColumnsAll, 30),
            "100 sessions": pickLastWindow(sessionColumnsAll, 100),
          };

          const rows = [];
          rows.push(["Journalier — complétion", "", "", "", ""]);
          rows.push(["Catégorie", "Consigne", "7j", "30j", "90j"]);
          dailyConsignes.forEach((c) => {
            const id = String(c?.id || "");
            if (!id) return;
            const byDayChecklist = checklistIndex.get(id) || new Map();
            const byDayResp = dailyIndex.get(id) || new Map();
            const calc = (keys) => {
              const list = Array.isArray(keys) ? keys : [];
              if (!list.length) return "";
              let answered = 0;
              list.forEach((dayKey) => {
                if (c?.type === "checklist") {
                  if (byDayChecklist.get(dayKey)) answered += 1;
                } else {
                  const row = byDayResp.get(dayKey) || null;
                  if (hasResponseContent(c, row)) answered += 1;
                }
              });
              return answered / list.length;
            };
            rows.push([
              cellValueForSheets(c?.category || ""),
              normalizeConsigneTitle(c),
              calc(dailyWindows["7j"]),
              calc(dailyWindows["30j"]),
              calc(dailyWindows["90j"]),
            ]);
          });
          rows.push(["", "", "", "", ""]);
          rows.push(["Pratique — complétion", "", "", "", ""]);
          rows.push(["Catégorie", "Consigne", "10 sessions", "30 sessions", "100 sessions"]);
          practiceConsignes.forEach((c) => {
            const id = String(c?.id || "");
            if (!id) return;
            const byHistory = practiceHistoryIndex.get(id) || new Map();
            const bySession = practiceSessionIndex.get(id) || new Map();
            const calc = (sessList) => {
              const list = Array.isArray(sessList) ? sessList : [];
              if (!list.length) return "";
              let answered = 0;
              list.forEach((sess) => {
                const key = String(sess?.id || "");
                const row = byHistory.get(key) || bySession.get(key) || null;
                if (hasResponseContent(c, row)) answered += 1;
              });
              return answered / list.length;
            };
            rows.push([
              cellValueForSheets(c?.category || ""),
              normalizeConsigneTitle(c),
              calc(practiceWindows["10 sessions"]),
              calc(practiceWindows["30 sessions"]),
              calc(practiceWindows["100 sessions"]),
            ]);
          });
          summaryEl.innerHTML = tableHtml(rows);
        };

        const renderDaily = () => {
          if (!dailyEl) return;
          const raw = daysSelect?.value || "all";
          const limit = raw === "all" ? null : Number(raw);
          const dayKeys = limit ? pickRecentSorted(allDailyDayKeys, limit) : allDailyDayKeys.slice();
          const header = ["Catégorie", "Consigne", ...dayKeys];
          const rows = [header];
          dailyConsignes.forEach((c) => {
            const id = String(c?.id || "");
            if (!id) return;
            const row = [cellValueForSheets(c?.category || ""), normalizeConsigneTitle(c)];
            const byDayChecklist = checklistIndex.get(id) || new Map();
            const byDayResp = dailyIndex.get(id) || new Map();
            dayKeys.forEach((dayKey) => {
              if (c?.type === "checklist") row.push(formatChecklistCell(c, byDayChecklist.get(dayKey) || null));
              else row.push(formatValueCell(c, byDayResp.get(dayKey) || null));
            });
            rows.push(row);
          });
          dailyEl.innerHTML = tableHtml(rows);
        };

        const renderPractice = () => {
          if (!practiceEl) return;
          const raw = sessionsSelect?.value || "all";
          const limit = raw === "all" ? null : Number(raw);
          const cols = limit ? pickRecentSorted(sessionColumnsAll, limit) : sessionColumnsAll.slice();
          const header = ["Catégorie", "Consigne", ...cols.map((s) => s.label)];
          const rows = [header];
          practiceConsignes.forEach((c) => {
            const id = String(c?.id || "");
            if (!id) return;
            const row = [cellValueForSheets(c?.category || ""), normalizeConsigneTitle(c)];
            const byHistory = practiceHistoryIndex.get(id) || new Map();
            const bySession = practiceSessionIndex.get(id) || new Map();
            cols.forEach((sess) => {
              row.push(formatValueCell(c, byHistory.get(sess.id) || bySession.get(sess.id) || null));
            });
            rows.push(row);
          });
          practiceEl.innerHTML = tableHtml(rows);
        };

        const renderGoals = () => {
          if (goalsEl) goalsEl.innerHTML = tableHtml(makeRowsFromObjectsAuto(objectifs));
          if (goalNotesEl) goalNotesEl.innerHTML = tableHtml(makeRowsFromObjectsAuto(objectiveNotes));
        };

        const renderRaw = () => {
          if (!rawTableEl) return;
          const key = String(rawSelect?.value || "");
          const data = rawSources[key] || [];
          rawTableEl.innerHTML = tableHtml(makeRowsFromObjectsAuto(data));
        };

        if (subtitleEl) {
          subtitleEl.textContent = `${displayName} — ${dailyConsignes.length} consignes daily, ${practiceConsignes.length} consignes pratique, ${objectifs.length} objectifs.`;
        }

        const rerender = () => {
          renderSummary();
          renderDaily();
          renderPractice();
          renderGoals();
          renderRaw();
        };

        daysSelect?.addEventListener("change", rerender);
        sessionsSelect?.addEventListener("change", rerender);
        rawSelect?.addEventListener("change", rerender);

        rerender();
      } catch (error) {
        root.innerHTML = `<div class='card p-4'>${escapeHtml(error?.message || String(error))}</div>`;
      }
    })();
  }

  function render() {
    const root = document.getElementById("view-root");
    if (!root) return;

    root.classList.remove("route-enter");
    // eslint-disable-next-line no-unused-expressions
    root.offsetHeight;
    root.classList.add("route-enter");

    const h = ctx.route || location.hash || "#/admin";
    appLog("render:start", { hash: h });
    const tokens = h.replace(/^#\//, "").split("/"); // ["u","{uid}","daily?day=mon"] ou ["daily?..."]

    let section = tokens[0];
    let sub = null;
    const modesApi = typeof window !== "undefined" ? window.Modes : null;
    const goalsApi = typeof window !== "undefined" ? window.Goals : null;
    const modesReady = () =>
      modesApi &&
      typeof modesApi.renderDaily === "function" &&
      typeof modesApi.renderPractice === "function" &&
      typeof modesApi.renderHistory === "function";
    if (section === "u") {
      // /u/{uid}/{sub}
      const uid = tokens[1];
      sub = (tokens[2] || "daily");
      // IMPORTANT: enlever la query de 'sub'
      sub = sub.split("?")[0];
      ctx.user = { uid };
      updateChecklistStateContext();
    } else {
      ctx.user = null;
      updateChecklistStateContext();
    }

    syncUserActionsContext();

    // Query params (toujours depuis l'URL complète)
    const qp = new URLSearchParams((h.split("?")[1] || ""));

    const currentSection = section === "u" ? sub : section;
    setActiveNav(currentSection);
    appLog("render:section", { section: currentSection, uid: ctx.user?.uid || null });
    if (ctx.user?.uid) {
      badgeManager.refresh(ctx.user.uid).catch(() => {});
    }

    switch (currentSection) {
      case "admin":
        if (!hasAdminAccess()) {
          redirectToAdminLogin();
          return;
        }
        return renderAdmin(ctx.db);
      case "dashboard":
      case "daily":
        // Propager la date de la page dans le contexte global pour les checklists
        // afin que l'hydratation et la persistance soient scorées par jour (indépendance samedi/dimanche)
        {
          if (!modesReady()) {
            console.warn("Modes module not ready (daily). Retrying soon…");
            window.setTimeout(render, 50);
            return;
          }
          const pageDateIso = (qp.get("d") || "").trim();
          ctx.dateIso = pageDateIso || null;
          // AppCtx est une référence à ctx (assignée plus bas), une mutation suffit
          // mais on s'assure de l'alignement au cas où
          if (typeof window !== "undefined") {
            window.AppCtx = ctx;
          }
        }
        return renderWithChecklistHydration(
          modesApi.renderDaily(ctx, root, {
            day: qp.get("day"),
            dateIso: qp.get("d"),
            view: qp.get("view"),
          }),
          root
        );
      case "practice":
        if (!modesReady()) {
          console.warn("Modes module not ready (practice). Retrying soon…");
          window.setTimeout(render, 50);
          return;
        }
        return renderWithChecklistHydration(
          modesApi.renderPractice(ctx, root, { newSession: qp.get("new") === "1" }),
          root
        );
      case "history":
        if (!modesReady()) {
          console.warn("Modes module not ready (history). Retrying soon…");
          window.setTimeout(render, 50);
          return;
        }
        return renderWithChecklistHydration(modesApi.renderHistory(ctx, root), root);
      case "goals":
        if (!goalsApi || typeof goalsApi.renderGoals !== "function") {
          console.warn("Goals module not ready. Retrying soon…");
          window.setTimeout(render, 50);
          return;
        }
        return renderWithChecklistHydration(goalsApi.renderGoals(ctx, root), root);
      case "stats":
        return renderStats(ctx, root, qp);
      default:
        root.innerHTML = "<div class='card'>Page inconnue.</div>";
    }
  }

  window.AppCtx = ctx;
  window.startRouter = startRouter;
  window.initApp = initApp;
  window.renderAdmin = renderAdmin;
})();
