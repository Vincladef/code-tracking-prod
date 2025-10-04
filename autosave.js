(() => {
  const STORAGE_PREFIX = "hp::autosave::";
  const SAVE_DEBOUNCE_MS = 800;
  const RESTORE_DEBOUNCE_MS = 120;
  const DOCUMENT_FRAGMENT_NODE = 11;
  const TEXT_NODE = 3;
  const trackedForms = new WeakMap();
  let formCounter = 0;

  function getStorage() {
    try {
      return window.localStorage;
    } catch (error) {
      console.warn("[autosave] localStorage inaccessible", error);
      return null;
    }
  }

  const storage = getStorage();
  const api = {
    clear(target) {
      if (!storage) return;
      if (typeof target === "string") {
        try {
          storage.removeItem(target);
        } catch (error) {
          console.warn("[autosave] clear:key", error);
        }
        return;
      }
      if (!target) return;
      const form = target instanceof HTMLFormElement ? target : null;
      if (!form) return;
      const state = trackedForms.get(form);
      if (!state) return;
      if (typeof state.scheduleSave?.cancel === "function") {
        state.scheduleSave.cancel();
      }
      if (typeof state.scheduleRestore?.cancel === "function") {
        state.scheduleRestore.cancel();
      }
      try {
        storage.removeItem(state.key);
      } catch (error) {
        console.warn("[autosave] clear:form", error);
      }
    },
  };

  window.formAutosave = Object.assign(window.formAutosave || {}, api);

  if (!storage) {
    return;
  }

  function debounce(fn, delay) {
    let timeoutId = null;
    function debounced(...args) {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        fn.apply(this, args);
      }, delay);
    }
    debounced.cancel = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
    return debounced;
  }

  function shouldIgnoreForm(form) {
    if (!form || !(form instanceof HTMLFormElement)) return true;
    const attr = (form.getAttribute("data-autosave") || "").toLowerCase();
    if (attr === "off" || attr === "false") return true;
    return false;
  }

  const IGNORED_INPUT_TYPES = new Set(["button", "submit", "reset", "image", "file", "password", "hidden"]);
  const TRACKED_FIELD_SELECTOR = "input, select, textarea";
  const STATUS_REGION_SELECTOR = ".consigne-row__status, [data-status], [role=\"status\"], [aria-live]";

  function shouldTrackField(field) {
    if (!field) return false;
    if (!("form" in field)) return false;
    if (field.disabled) return false;
    if (typeof field.matches === "function" && field.matches("[data-autosave=\"off\"]")) return false;
    if (field.closest && field.closest("[data-autosave=\"off\"]")) return false;
    const tag = field.tagName;
    if (tag === "FIELDSET" || tag === "OBJECT") return false;
    if (tag === "BUTTON") return false;
    const type = (field.type || "").toLowerCase();
    if (IGNORED_INPUT_TYPES.has(type)) return false;
    return true;
  }

  function fieldIdentifier(field) {
    if (!field) return null;
    const explicit = field.getAttribute("data-autosave-field") || field.getAttribute("data-autosave-key");
    if (explicit) return explicit;
    if (field.name) return field.name;
    if (field.id) return `#${field.id}`;
    return null;
  }

  function buildFieldGroups(form) {
    const groups = new Map();
    const elements = Array.from(form.elements || []);
    elements.forEach((element) => {
      if (!shouldTrackField(element)) return;
      const key = fieldIdentifier(element);
      if (!key) return;
      const normalized = String(key);
      if (!groups.has(normalized)) {
        groups.set(normalized, []);
      }
      groups.get(normalized).push(element);
    });
    return groups;
  }

  function isStatusRegion(node) {
    if (!(node instanceof Element)) return false;
    if (typeof node.matches === "function" && node.matches(STATUS_REGION_SELECTOR)) return true;
    if (typeof node.closest === "function") {
      const closest = node.closest(STATUS_REGION_SELECTOR);
      if (closest) return true;
    }
    return false;
  }

  function nodeContainsTrackedField(node) {
    if (!node) return false;
    if (node.nodeType === DOCUMENT_FRAGMENT_NODE) {
      return Array.from(node.childNodes || []).some((child) => nodeContainsTrackedField(child));
    }
    if (!(node instanceof Element)) return false;
    if (typeof node.matches === "function" && node.matches(TRACKED_FIELD_SELECTOR)) return true;
    if (typeof node.querySelector === "function") {
      return Boolean(node.querySelector(TRACKED_FIELD_SELECTOR));
    }
    return false;
  }

  function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function checkedValues(elements, useDefault = false) {
    const values = [];
    elements.forEach((el) => {
      const isChecked = useDefault ? el.defaultChecked : el.checked;
      if (!isChecked) return;
      const value = el.value != null ? String(el.value) : "on";
      values.push(value);
    });
    values.sort();
    return values;
  }

  function selectValues(select, useDefault = false) {
    const values = [];
    const options = Array.from(select.options || []);
    options.forEach((opt) => {
      const selected = useDefault ? opt.defaultSelected : opt.selected;
      if (selected) {
        values.push(opt.value);
      }
    });
    values.sort();
    return values;
  }

  function serializeGroup(elements) {
    if (!elements || !elements.length) return null;
    const first = elements[0];
    if (!first) return null;
    const type = (first.type || "").toLowerCase();
    if (type === "radio") {
      const selected = elements.find((el) => el.checked) || null;
      const currentValue = selected ? selected.value : null;
      const defaultSelected = elements.find((el) => el.defaultChecked) || null;
      const defaultValue = defaultSelected ? defaultSelected.value : null;
      if (currentValue === defaultValue) return null;
      return { type: "radio", value: currentValue };
    }
    if (type === "checkbox") {
      if (elements.length > 1) {
        const currentValues = checkedValues(elements, false);
        const defaultValues = checkedValues(elements, true);
        if (arraysEqual(currentValues, defaultValues)) return null;
        return { type: "checkbox-group", value: currentValues };
      }
      const element = first;
      if (element.checked === element.defaultChecked) return null;
      return { type: "checkbox", value: Boolean(element.checked) };
    }
    if (first instanceof HTMLSelectElement) {
      if (first.multiple) {
        const currentValues = selectValues(first, false);
        const defaultValues = selectValues(first, true);
        if (arraysEqual(currentValues, defaultValues)) return null;
        return { type: "select-multiple", value: currentValues };
      }
      const currentValue = first.value;
      const defaultValue = first.defaultValue;
      if (currentValue === defaultValue) return null;
      return { type: "value", value: currentValue };
    }
    const currentValue = first.value;
    const defaultValue = first.defaultValue;
    if (currentValue === defaultValue) return null;
    return { type: "value", value: currentValue };
  }

  function serializeForm(form) {
    const groups = buildFieldGroups(form);
    const fields = {};
    groups.forEach((elements, key) => {
      const entry = serializeGroup(elements);
      if (entry) {
        fields[key] = entry;
      }
    });
    if (!Object.keys(fields).length) {
      return null;
    }
    return { version: 1, fields };
  }

  function dispatchUpdateEvents(element) {
    if (!element) return;
    const eventInit = { bubbles: true };
    try {
      element.dispatchEvent(new Event("input", eventInit));
    } catch (error) {
      const evt = document.createEvent("Event");
      evt.initEvent("input", true, true);
      element.dispatchEvent(evt);
    }
    try {
      element.dispatchEvent(new Event("change", eventInit));
    } catch (error) {
      const evt = document.createEvent("Event");
      evt.initEvent("change", true, true);
      element.dispatchEvent(evt);
    }
  }

  function applyEntry(elements, entry) {
    if (!entry || !elements || !elements.length) return;
    const type = entry.type;
    if (type === "checkbox") {
      const element = elements[0];
      if (!element) return;
      const desired = entry.value === true;
      if (element.checked !== desired) {
        element.checked = desired;
        dispatchUpdateEvents(element);
      }
      return;
    }
    if (type === "checkbox-group") {
      const values = Array.isArray(entry.value) ? entry.value.map((v) => String(v)) : [];
      const valueSet = new Set(values);
      elements.forEach((element) => {
        const optionValue = element.value != null ? String(element.value) : "on";
        const shouldCheck = valueSet.has(optionValue);
        if (element.checked !== shouldCheck) {
          element.checked = shouldCheck;
          dispatchUpdateEvents(element);
        }
      });
      return;
    }
    if (type === "radio") {
      const desiredValue = entry.value != null ? String(entry.value) : null;
      elements.forEach((element) => {
        const shouldCheck = desiredValue != null && String(element.value) === desiredValue;
        if (element.checked !== shouldCheck) {
          element.checked = shouldCheck;
          dispatchUpdateEvents(element);
        }
      });
      if (desiredValue == null) {
        elements.forEach((element) => {
          if (element.checked) {
            element.checked = false;
            dispatchUpdateEvents(element);
          }
        });
      }
      return;
    }
    const element = elements[0];
    if (!element) return;
    if (type === "select-multiple" && element instanceof HTMLSelectElement) {
      const values = Array.isArray(entry.value) ? entry.value.map((v) => String(v)) : [];
      const valueSet = new Set(values);
      let changed = false;
      Array.from(element.options || []).forEach((option) => {
        const shouldSelect = valueSet.has(option.value);
        if (option.selected !== shouldSelect) {
          option.selected = shouldSelect;
          changed = true;
        }
      });
      if (changed) {
        dispatchUpdateEvents(element);
      }
      return;
    }
    const nextValue = entry.value != null ? String(entry.value) : "";
    if (element.value !== nextValue) {
      element.value = nextValue;
      dispatchUpdateEvents(element);
    }
  }

  function loadState(key) {
    if (!key) return null;
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (error) {
      console.warn("[autosave] read", error);
      return null;
    }
  }

  function persistState(key, state) {
    if (!key) return;
    if (!state) {
      try {
        storage.removeItem(key);
      } catch (error) {
        console.warn("[autosave] remove", error);
      }
      return;
    }
    try {
      storage.setItem(key, JSON.stringify(state));
    } catch (error) {
      console.warn("[autosave] write", error);
    }
  }

  function locationScope() {
    const path = window.location?.pathname || "";
    const hash = window.location?.hash || "";
    return `${path}::${hash}`;
  }

  function computeAnonymousId(form) {
    if (!form.__autosaveAnonId) {
      form.__autosaveAnonId = `form-${Date.now().toString(36)}-${(formCounter += 1).toString(36)}`;
    }
    return form.__autosaveAnonId;
  }

  function computeFormKey(form) {
    const scope = locationScope();
    const explicit = form.getAttribute("data-autosave-key");
    const keyParts = [scope];
    if (explicit) {
      keyParts.push(explicit);
      return `${STORAGE_PREFIX}${keyParts.join("::")}`;
    }
    if (form.id) keyParts.push(`#${form.id}`);
    const nameAttr = form.getAttribute("name");
    if (nameAttr) keyParts.push(`name=${nameAttr}`);
    const action = form.getAttribute("action");
    if (action) keyParts.push(`action=${action}`);
    const classes = (form.className || "").trim();
    if (classes) {
      keyParts.push(`classes=${classes.split(/\s+/).slice(0, 3).join(".")}`);
    }
    const fieldGroups = buildFieldGroups(form);
    if (fieldGroups.size) {
      const fieldNames = Array.from(fieldGroups.keys()).sort();
      keyParts.push(`fields=${fieldNames.join("|")}`);
    }
    if (keyParts.length === 1) {
      keyParts.push(computeAnonymousId(form));
    }
    return `${STORAGE_PREFIX}${keyParts.join("::")}`;
  }

  function restoreForm(form, state, stored) {
    if (!stored || typeof stored !== "object") return;
    const fields = stored.fields;
    if (!fields || typeof fields !== "object") return;
    state.restoring = true;
    try {
      const groups = buildFieldGroups(form);
      Object.keys(fields).forEach((key) => {
        const elements = groups.get(key);
        if (!elements) return;
        applyEntry(elements, fields[key]);
      });
    } finally {
      window.setTimeout(() => {
        state.restoring = false;
      }, 0);
    }
  }

  function registerForm(form) {
    if (shouldIgnoreForm(form)) return;
    if (trackedForms.has(form)) return;
    const key = computeFormKey(form);
    if (!key) return;
    const scheduleSave = debounce(() => {
      const serialized = serializeForm(form);
      if (!serialized) {
        persistState(key, null);
        return;
      }
      persistState(key, serialized);
    }, SAVE_DEBOUNCE_MS);

    const state = {
      key,
      scheduleSave,
      restoring: false,
      scheduleRestore: null,
    };

    state.scheduleRestore = debounce(() => {
      if (state.restoring) return;
      const storedState = loadState(state.key);
      if (storedState) {
        restoreForm(form, state, storedState);
      }
    }, RESTORE_DEBOUNCE_MS);

    const handleInput = (event) => {
      if (event && event.target && event.target.form && event.target.form !== form) return;
      if (state.restoring) return;
      scheduleSave();
    };

    const handleSubmit = () => {
      if (typeof scheduleSave.cancel === "function") {
        scheduleSave.cancel();
      }
      persistState(state.key, null);
    };

    form.addEventListener("input", handleInput);
    form.addEventListener("change", handleInput);
    form.addEventListener("submit", handleSubmit);
    form.addEventListener("reset", handleSubmit);

    trackedForms.set(form, state);

    const stored = loadState(key);
    if (stored) {
      restoreForm(form, state, stored);
    }
  }

  function updateFormKey(form) {
    const state = trackedForms.get(form);
    if (!state) {
      registerForm(form);
      return;
    }
    const nextKey = computeFormKey(form);
    if (!nextKey || nextKey === state.key) return;
    try {
      storage.removeItem(state.key);
    } catch (error) {
      console.warn("[autosave] key:update", error);
    }
    state.key = nextKey;
    const stored = loadState(nextKey);
    if (stored) {
      restoreForm(form, state, stored);
    }
  }

  function handleMutations(mutations) {
    const formsToRestore = new Set();

    const collectTrackedForm = (node) => {
      if (!node) return;
      if (node instanceof HTMLFormElement) return;
      if (node.nodeType === DOCUMENT_FRAGMENT_NODE) {
        Array.from(node.childNodes || []).forEach((child) => collectTrackedForm(child));
        return;
      }
      if (!(node instanceof Element)) return;
      const form = node.closest("form");
      if (form && trackedForms.has(form)) {
        formsToRestore.add(form);
      }
    };

    mutations.forEach((mutation) => {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLFormElement) {
            registerForm(node);
          } else if (node && typeof node.querySelectorAll === "function") {
            const forms = node.querySelectorAll("form");
            forms.forEach((form) => registerForm(form));
          }
        });

        const added = Array.from(mutation.addedNodes || []);
        const removed = Array.from(mutation.removedNodes || []);
        const nodes = added.concat(removed);
        const relevantNodes = nodes.filter((node) => nodeContainsTrackedField(node));
        const target = mutation.target;
        const targetIsStatus = isStatusRegion(target);
        const targetIsTrackedField =
          (target && target.nodeType === DOCUMENT_FRAGMENT_NODE && nodeContainsTrackedField(target)) ||
          (target instanceof Element && typeof target.matches === "function" && target.matches(TRACKED_FIELD_SELECTOR));
        const onlyTextNodes = nodes.length > 0 && nodes.every((node) => node && node.nodeType === TEXT_NODE);

        if (!relevantNodes.length && !targetIsTrackedField) {
          if (targetIsStatus || onlyTextNodes) {
            return;
          }
          if (!nodes.length) {
            if (targetIsStatus) {
              return;
            }
          }
          return;
        }

        relevantNodes.forEach((node) => {
          collectTrackedForm(node);
        });

        if (target instanceof Element && !targetIsStatus && (targetIsTrackedField || relevantNodes.length)) {
          collectTrackedForm(target);
        }
      } else if (mutation.type === "attributes" && mutation.attributeName === "data-autosave-key") {
        const target = mutation.target;
        if (target instanceof HTMLFormElement) {
          updateFormKey(target);
        }
      }
    });

    formsToRestore.forEach((form) => {
      const state = trackedForms.get(form);
      if (!state) return;
      if (typeof state.scheduleRestore === "function") {
        state.scheduleRestore();
        return;
      }
      if (state.restoring) return;
      const stored = loadState(state.key);
      if (stored) {
        restoreForm(form, state, stored);
      }
    });
  }

  Array.from(document.forms || []).forEach((form) => registerForm(form));

  const observer = new MutationObserver(handleMutations);
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-autosave-key"],
  });
})();
