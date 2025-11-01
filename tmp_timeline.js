function renderConsigneHistoryTimeline(row, points) {
  const container = row?.querySelector?.("[data-consigne-history]");
  const track = row?.querySelector?.("[data-consigne-history-track]");
  if (!container || !track) {
    return false;
  }
  const timelinePoints = Array.isArray(points) ? points.filter(Boolean) : [];
  while (track.firstChild) {
    track.removeChild(track.firstChild);
  }
  track.setAttribute("role", "list");
  track.dataset.historyMode = timelinePoints.length ? "day" : "empty";
  if (!timelinePoints.length) {
    container.hidden = true;
    return false;
  }
  const fragment = document.createDocumentFragment();
  timelinePoints.forEach((point) => {
    const item = document.createElement("div");
    item.className = "consigne-history__item";
    item.setAttribute("role", "listitem");
    applyConsigneHistoryPoint(item, point);
    fragment.appendChild(item);
  });
  track.appendChild(fragment);
  container.hidden = false;
  return true;
}


function updateConsigneHistoryTimeline(row) {
  if (!row) {
    return;
  }
  const state = CONSIGNE_HISTORY_ROW_STATE.get(row);
  if (state && typeof state.refresh === "function") {
    state.refresh();
  }
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
  if (previousState?.cleanup) {
    try {
      previousState.cleanup();
    } catch (_) {}
  }
  const normalizeChildConsignes = (list) => {
    if (!Array.isArray(list)) return [];
    const map = new Map();
    list.forEach((child) => {
      if (!child || child.id == null) return;
      const stringId = String(child.id);
      if (map.has(stringId)) return;
      map.set(stringId, {
        id: stringId,
        consigne: child,
        type: child.type || "short",
        label: child.text || child.titre || child.name || `Sous-consigne ${map.size + 1}`,
      });
    });
    return Array.from(map.values());
  };

  const state = {
    row,
    consigne,
    ctx,
    container,
    track,
    mode: typeof options.mode === "string" ? options.mode : "timeline",
    dayKey: typeof options.dayKey === "string" ? options.dayKey : "",
    entries: [],
    cleanup: null,
    refresh: null,
    childConsignes: normalizeChildConsignes(options.childConsignes),
    childHistoryCache: new Map(),
  };

  const refreshTimeline = async () => {
    if (!ctx?.db || !ctx?.user?.uid) {
      return;
    }
    try {
      const entries = await Schema.loadConsigneHistory(ctx.db, ctx.user.uid, consigne.id);
      state.entries = entries;
      const childHistoryById = new Map();
      if (state.childConsignes.length) {
        await Promise.all(state.childConsignes.map(async (childInfo) => {
          if (!childInfo?.id) return;
          if (!state.childHistoryCache.has(childInfo.id)) {
            try {
              const childEntries = await Schema.loadConsigneHistory(ctx.db, ctx.user.uid, childInfo.consigne.id);
              state.childHistoryCache.set(childInfo.id, Array.isArray(childEntries) ? childEntries : []);
            } catch (error) {
              state.childHistoryCache.set(childInfo.id, []);
              console.warn("timeline.child.load", { consigneId: childInfo.consigne.id, error });
            }
          }
          childHistoryById.set(childInfo.id, state.childHistoryCache.get(childInfo.id) || []);
        }));
      }
      const points = buildConsigneHistoryTimeline(entries, consigne);
      if (childHistoryById.size && points.length) {
        points.forEach((point) => {
          const normalizedDayKey = normalizeHistoryDayKey(point?.dayKey || "");
          if (!normalizedDayKey) {
            if (point?.details?.children) {
              delete point.details.children;
            }
            return;
          }
          const childSummaries = state.childConsignes.map((childInfo) => {
            const childEntries = childHistoryById.get(childInfo.id) || [];
            const match = findHistoryEntryForDayKey(childEntries, childInfo.consigne, normalizedDayKey, { allowSummaries: true });
            const childEntry = match?.entry || null;
            const childValue = childEntry && Object.prototype.hasOwnProperty.call(childEntry, "value") ? childEntry.value : null;
            const status = dotColor(childInfo.type, childValue, childInfo.consigne) || "na";
            const valueDisplay = formatConsigneValue(childInfo.type, childValue, { consigne: childInfo.consigne }) || "—";
            const noteText = typeof childEntry?.note === "string" ? childEntry.note.trim() : "";
            return {
              id: childInfo.id,
              label: childInfo.label,
              status,
              value: valueDisplay || "—",
              note: noteText,
            };
          });
          if (!point.details) {
            point.details = {};
          }
          point.details.children = childSummaries;
        });
      }
      renderConsigneHistoryTimeline(row, points);
      try {
        CONSIGNE_HISTORY_LAST_POINTS.set(String(consigne.id), Array.isArray(points) ? points.slice() : []);
      } catch (_) {}
    } catch (error) {
      console.error("timeline.refresh", error);
    }
  };

  const handleClick = (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".consigne-history__item") : null;
    if (!target) {
      return;
    }
    event.preventDefault();
    const historyDay = typeof target.dataset?.historyDay === "string" ? target.dataset.historyDay : "";
    const historyId = typeof target.dataset?.historyId === "string" ? target.dataset.historyId : "";
    const responseId =
      typeof target.dataset?.historyResponseId === "string" ? target.dataset.historyResponseId : "";
    const details = target._historyDetails && typeof target._historyDetails === "object" ? target._historyDetails : {};
    openConsigneHistoryEntryEditor(row, consigne, ctx, {
      dayKey: historyDay || state.dayKey,
      trigger: target,
      source: state.mode,
      historyId: historyId || details.historyId || "",
      responseId: responseId || details.responseId || "",
      details,
      onChange: () => {
        refreshTimeline();
        if (typeof options.onChange === "function") {
          try {
            options.onChange();
          } catch (_) {}
        }
      },
    });
  };

  track.addEventListener("click", handleClick);

  state.refresh = refreshTimeline;
  state.cleanup = () => {
    track.removeEventListener("click", handleClick);
  };

  CONSIGNE_HISTORY_ROW_STATE.set(row, state);

  refreshTimeline();
}


function pushPrefillDebugContext(context) {
  PREFILL_DEBUG_CONTEXT_STACK.push(context || null);
}

function popPrefillDebugContext() {
  if (PREFILL_DEBUG_CONTEXT_STACK.length) {
    PREFILL_DEBUG_CONTEXT_STACK.pop();
  }
}

function peekPrefillDebugContext() {
  if (!PREFILL_DEBUG_CONTEXT_STACK.length) {
    return null;
  }
  return PREFILL_DEBUG_CONTEXT_STACK[PREFILL_DEBUG_CONTEXT_STACK.length - 1] || null;
}

function safeJsonSample(value, maxLength = 160) {
  try {
    const raw = JSON.stringify(value);
    if (typeof raw === "string") {
      return raw.length > maxLength ? `${raw.slice(0, maxLength)}…` : raw;
    }
  } catch (_) {}
  try {
    const str = String(value);
    return str.length > maxLength ? `${str.slice(0, maxLength)}…` : str;
  } catch (_) {}
  return null;
}

function summarizePrefillValue(value) {
  if (value == null) {
    return { type: value === null ? "null" : "undefined" };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return {
      type: "string",
      length: value.length,
      preview: trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed,
    };
  }
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      preview: safeJsonSample(value),
    };
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    return {
      type: "object",
      keys,
      preview: safeJsonSample(value),
    };
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { type: typeof value, value };
  }
  return { type: typeof value };
}

function recordPrefillDebug(row, info = {}) {
  if (!(row instanceof HTMLElement)) {
    return;
  }
  const existing = PREFILL_DEBUG_STATE.get(row) || { history: [] };
  const entry = {
    timestamp: info.timestamp || Date.now(),
    consigneId: info.consigneId ?? null,
    consigneType: info.consigneType ?? null,
    context: info.context || null,
    directSource: info.directSource || null,
    valueSummary: summarizePrefillValue(info.value),
    stack: typeof info.stack === "string" ? info.stack : "",
  };
  existing.last = entry;
  existing.history.push(entry);
  if (existing.history.length > 8) {
    existing.history.shift();
  }
  PREFILL_DEBUG_STATE.set(row, existing);
}

function readPrefillDebug(row) {
  if (!(row instanceof HTMLElement)) {
    return null;
  }
  return PREFILL_DEBUG_STATE.get(row) || null;
}

function deriveStackFrame(stack) {
  if (!stack) return "";
  const lines = String(stack)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "";
  const projectLine = lines.find((line) => line.includes("modes.js"));
  return projectLine || lines[1] || lines[0] || "";
}

function maybeReportUnexpectedPrefill(consigne, row, { status, value, note, hasOwnAnswer, skipFlag }) {
  if (!row || !consigne) {
    return;
  }
  if (status === "na") {
    return;
  }
  const rawDayKey = row.dataset?.dayKey || "";
  const normalizedDayKey = normalizeHistoryDayKey(rawDayKey || "");
  const logKey = `${consigne.id ?? "unknown"}::${normalizedDayKey || rawDayKey || "none"}::${status}`;
  if (PREFILL_UNEXPECTED_LOGGED.has(logKey)) {
    return;
  }
  const snapshot = collectConsigneTimelineSnapshot(consigne);
  const timelineItems = Array.isArray(snapshot?.items) ? snapshot.items : [];
  const timelineHasMatchingDay = timelineItems.some((item) => {
    const itemKey = item?.normalizedDayKey || normalizeHistoryDayKey(item?.dayKey || "");
    if (!itemKey && !normalizedDayKey) {
      return false;
    }
    const comparable = itemKey || item?.dayKey || "";
    return comparable && comparable === (normalizedDayKey || rawDayKey);
  });
  if (timelineHasMatchingDay) {
    return;
  }
  const debugInfo = readPrefillDebug(row);
  const lastEntry = debugInfo?.last || null;
  const lastStackFrame = deriveStackFrame(lastEntry?.stack || "");
  const payload = {
    consigneId: consigne?.id ?? null,
    consigneType: consigne?.type || null,
    dayKey: rawDayKey || null,
    normalizedDayKey: normalizedDayKey || null,
    status,
    skipFlag,
    hasOwnAnswer,
    notePreview: note || "",
    valueSummary: summarizePrefillValue(value),
    timelineCount: timelineItems.length,
    timelineHasMatchingDay,
    timelineSample: timelineItems.slice(0, 5).map((item) => ({
      dayKey: item?.dayKey || null,
      normalizedDayKey: item?.normalizedDayKey || null,
      status: item?.status || null,
      historyId: item?.historyId || null,
      responseId: item?.responseId || null,
    })),
    debugContext: lastEntry?.context || null,
    debugValueSummary: lastEntry?.valueSummary || null,
    debugDirectSource: lastEntry?.directSource || null,
    triggerStackFrame: lastStackFrame,
    stackExcerpt: lastEntry?.stack ? lastEntry.stack.split("\n").slice(0, 8) : [],
  };
  prefillAlert("❌ unexpected daily prefill without history", payload);
  PREFILL_UNEXPECTED_LOGGED.add(logKey);
}

function reportUnexpectedPrefillOnEditorOpen(consigne, row, currentValue) {
  try {
    if (!row || !consigne) return;
    const rawDayKey = row?.dataset?.dayKey || (typeof window !== 'undefined' && window.AppCtx && window.AppCtx.dateIso) || "";
    const normalizedDayKey = normalizeHistoryDayKey(rawDayKey || "");
    const skipFlag = row?.dataset?.skipAnswered === "1";
    const valueForStatus = skipFlag && (!(currentValue && typeof currentValue === "object" && currentValue.skipped))
      ? { skipped: true }
      : currentValue;
    const status = dotColor(consigne.type, valueForStatus, consigne);
    const hasOwnAnswer = consigne.type === "checklist"
      ? hasChecklistResponse(consigne, row, valueForStatus)
      : hasValueForConsigne(consigne, valueForStatus);
    if (!hasOwnAnswer && status === "na") {
      return;
    }
    const snapshot = collectConsigneTimelineSnapshot(consigne);
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    const hasMatching = normalizedDayKey
      ? items.some((it) => (it?.normalizedDayKey || normalizeHistoryDayKey(it?.dayKey || "")) === normalizedDayKey)
      : items.length > 0 ? false : false;
    // If there's no history match for this day (or no timeline items at all), flag it.
    if (!hasMatching) {
      const debugInfo = readPrefillDebug(row);
      const lastEntry = debugInfo?.last || null;
      const lastStackFrame = deriveStackFrame(lastEntry?.stack || "");
      const payload = {
        consigneId: consigne?.id ?? null,
        consigneType: consigne?.type || null,
        dayKey: rawDayKey || null,
        normalizedDayKey: normalizedDayKey || null,
        status,
        skipFlag,
        hasOwnAnswer,
        datasetStatus: row?.dataset?.status || null,
        valueSummary: summarizePrefillValue(currentValue),
        timelineCount: items.length,
        timelineSample: items.slice(0, 5).map((it) => ({ dayKey: it?.dayKey || null, normalizedDayKey: it?.normalizedDayKey || null, status: it?.status || null })),
        debugContext: lastEntry?.context || null,
        debugDirectSource: lastEntry?.directSource || null,
        triggerStackFrame: deriveStackFrame(new Error('click-prefill-check').stack),
        lastUpdateStack: lastStackFrame,
      };
      prefillAlert("❌ unexpected prefill on click — no history", payload);
    }
  } catch (error) {
    prefillLog("prefill.debug.onClick.error", { error: String(error?.message || error) });
  }
}

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
  // Track whether this row truly has an answer
  let hasOwnAnswer = false;
  try {
    hasOwnAnswer = consigne.type === "checklist"
      ? hasChecklistResponse(consigne, row, valueForStatus)
      : hasValueForConsigne(consigne, valueForStatus);
  } catch (_) {
    hasOwnAnswer = false;
  }
  try {
    prefillLog("status.compute", {
      at: "updateConsigneStatusUI",
      consigneId: consigne?.id ?? null,
      type: consigne?.type || null,
      dayKey: row?.dataset?.dayKey || null,
      skipFlag,
      valueType: valueForStatus == null ? "null" : typeof valueForStatus,
      incomingStatus: status,
      prevStatus: row?.dataset?.status || null,
      hasOwnAnswer,
    });
  } catch (_) {}
  try {
    modesLogger?.debug?.("consigne.status.update", {
      consigneId: consigne?.id ?? null,
      skip: Boolean(skipFlag),
      status,
    });
  } catch (_) {}
  // Persist hasAnswer flag for parent propagation logic
  if (hasOwnAnswer) {
    row.dataset.hasAnswer = "1";
  } else {
    delete row.dataset.hasAnswer;
  }
  // Do not elevate parent status based solely on child activity; keep parent 'na'
  // until it has its own explicit answer. This avoids pre-coloring without a dot.
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
  try {
    maybeReportUnexpectedPrefill(consigne, row, {
      status,
      value: valueForStatus,
      note: textualNote,
      hasOwnAnswer,
      skipFlag,
    });
  } catch (error) {
    prefillLog("prefill.debug.unexpected.log.error", { error: String(error?.message || error) });
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

function initializeChecklistScope() {
  return;
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
          ? `<p class="practice-dashboard__history-last-note"><span class="practice-dashboard__history-last-note-label">Dernière note :</span> ${escapeHtml(stat.commentDisplay)}</p>`
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
            <label class="practice-editor__label" for="${valueId}-note">Note</label>
            <textarea id="${valueId}-note" name="note" class="consigne-editor__textarea" placeholder="Ajouter une note">${escapeHtml(noteValue)}</textarea>
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

  const makeItem = (c, { isChild = false, deferEditor = false, editorOptions = null, historyChildren = [] } = {}) => {
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
        holder.innerHTML = inputForType(c, HYDRATION_DISABLED ? null : undefined);
        enhanceRangeMeters(holder);
        ensureConsigneSkipField(row, c);
      }
      setupConsigneHistoryTimeline(row, c, ctx, { mode: "practice", childConsignes: Array.isArray(historyChildren) ? historyChildren : [] });
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
      const parentCard = makeItem(group.consigne, { isChild: false, deferEditor: true, historyChildren: group.children });
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
  let previousAnswers = previousAnswersRaw instanceof Map
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
      entry.pageDateIso,
      entry.page_date_iso,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return normalizeHistoryDayKey(candidate);
      }
    }
    return "";
  };

  const isSummaryLikeEntry = (entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const scope =
      (typeof entry.summaryScope === "string" && entry.summaryScope.trim()) ||
      (typeof entry.summary_scope === "string" && entry.summary_scope.trim()) ||
      "";
    if (scope) {
      return true;
    }
    const source = typeof entry.source === "string" ? entry.source.toLowerCase() : "";
    const origin = typeof entry.origin === "string" ? entry.origin.toLowerCase() : "";
    if (source.includes("summary") || origin.includes("summary")) {
      return true;
    }
    return false;
  };

  if (previousAnswers && previousAnswers.size && normalizedCurrentDayKey) {
    const filtered = new Map();
    previousAnswers.forEach((entry, consigneId) => {
      const entryKey = resolvePreviousEntryDayKey(entry);
      if (
        entryKey &&
        entryKey === normalizedCurrentDayKey &&
        !isSummaryLikeEntry(entry)
      ) {
        filtered.set(consigneId, entry);
      }
    });
    previousAnswers = filtered;
  }

  const observedValues = new Map();
  const autoSaveStates = new Map();
  const autoSaveErrorState = { lastShownAt: 0 };
  const suppressedAutoSaveScopes = new Set();

  const resolveAutoSaveScopeKey = (consigneId, scopeDayKey = dayKey) => {
    const safeConsigneId = typeof consigneId === "string" || typeof consigneId === "number"
      ? String(consigneId)
      : "";
    const normalizedScopeDayKey =
      typeof scopeDayKey === "string" && scopeDayKey.trim()
        ? normalizeHistoryDayKey(scopeDayKey)
        : "";
    return `${safeConsigneId}::${normalizedScopeDayKey}`;
  };

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
    const savePromise = Schema.saveResponses(ctx.db, ctx.user.uid, "daily", answers);
    state.inFlightPromise = savePromise;
    autoSaveStates.set(consigneId, state);
    savePromise
      .then(async () => {
        try {
          modesLogger?.info?.("daily.autosave.saved", {
            consigneId: consigne?.id ?? null,
            dayKey,
          });
        } catch (_) {}
        markAnswerAsSaved(consigne, pendingValue, pendingSerialized, normalizedSummary);
        try {
          const escapeConsigneId =
            typeof CSS !== "undefined" && typeof CSS.escape === "function"
              ? CSS.escape(String(consigne?.id ?? ""))
              : String(consigne?.id ?? "").replace(/"/g, '\\"');
          const escapeDayKey =
            typeof CSS !== "undefined" && typeof CSS.escape === "function"
              ? CSS.escape(String(dayKey ?? ""))
              : String(dayKey ?? "").replace(/"/g, '\\"');
          const selector = `[data-consigne-id="${escapeConsigneId}"][data-day-key="${escapeDayKey}"]`;
          const row = typeof document !== "undefined" ? document.querySelector(selector) : null;
          if (row && typeof updateConsigneHistoryTimeline === "function") {
            updateConsigneHistoryTimeline(row);
          }
        } catch (error) {
          console.warn("daily.autosave.timeline.refresh", error);
        }
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
        latest.inFlightPromise = null;
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

  const flushAutoSaveForConsigneImpl = async (consigneId, targetDayKey = null) => {
    if (!consigneId) {
      return;
    }
    const state = autoSaveStates.get(consigneId);
    if (!state) {
      const existing = previousAnswers.get(consigneId);
      if (existing) {
        const normalizedTarget =
          typeof targetDayKey === "string" && targetDayKey.trim()
            ? normalizeHistoryDayKey(targetDayKey)
            : normalizedCurrentDayKey;
        const entryKey = resolvePreviousEntryDayKey(existing);
        if (!normalizedTarget || !entryKey || normalizedTarget === entryKey) {
          previousAnswers.delete(consigneId);
        }
      }
      return;
    }
    if (state.timeout) {
      clearTimeout(state.timeout);
      state.timeout = null;
    }
    state.pendingHasContent = false;
    state.pendingValue = null;
    state.pendingSerialized = null;
    state.pendingSummary = null;
    autoSaveStates.set(consigneId, state);
    const promise = state.inFlightPromise;
    if (promise && typeof promise.then === "function") {
      try {
        await promise;
      } catch (_) {}
    } else if (state.inFlight) {
      await new Promise((resolve) => {
        const startedAt = Date.now();
        const poll = () => {
          const latest = autoSaveStates.get(consigneId);
          if (!latest || !latest.inFlight) {
            resolve();
            return;
          }
          if (Date.now() - startedAt > 2000) {
            resolve();
            return;
          }
          setTimeout(poll, 80);
        };
        poll();
      });
    }
    const normalizedTarget =
      typeof targetDayKey === "string" && targetDayKey.trim()
        ? normalizeHistoryDayKey(targetDayKey)
        : normalizedCurrentDayKey;
    const existing = previousAnswers.get(consigneId);
    if (existing) {
      const entryKey = resolvePreviousEntryDayKey(existing);
      if (!normalizedTarget || !entryKey || normalizedTarget === entryKey) {
        previousAnswers.delete(consigneId);
      }
    }
    autoSaveStates.delete(consigneId);
  };
  flushAutoSaveForConsigne = flushAutoSaveForConsigneImpl;

  const runWithAutoSaveSuppressedImpl = async (consigneId, scopeDayKey, task) => {
    if (!consigneId || typeof task !== "function") {
      return typeof task === "function" ? task() : undefined;
    }
    const scopeKey = resolveAutoSaveScopeKey(consigneId, scopeDayKey);
    const alreadySuppressed = suppressedAutoSaveScopes.has(scopeKey);
    suppressedAutoSaveScopes.add(scopeKey);
    try {
      await flushAutoSaveForConsigneImpl(consigneId, scopeDayKey);
      return await task();
    } finally {
      if (!alreadySuppressed) {
        suppressedAutoSaveScopes.delete(scopeKey);
      }
    }
  };
  runWithAutoSaveSuppressed = runWithAutoSaveSuppressedImpl;

  const scheduleAutoSave = (consigne, value, { serialized, hasContent, summary } = {}) => {
    if (!consigne || !consigne.id) return;
    const consigneId = consigne.id;
    const scopeKey = resolveAutoSaveScopeKey(consigneId, dayKey);
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
      inFlightPromise: null,
    };
    if (state.inFlightPromise === undefined) {
      state.inFlightPromise = null;
    }
    state.consigne = consigne;
    state.pendingValue = value;
    state.pendingSerialized = computedSerialized;
    state.pendingHasContent = effectiveHasContent;
    state.pendingSummary = effectiveHasContent
      ? normalizeSummaryMetadataInput(summary)
      : null;

    if (suppressedAutoSaveScopes.has(scopeKey)) {
      if (state.timeout) {
        clearTimeout(state.timeout);
        state.timeout = null;
      }
      if (!state.inFlight) {
        autoSaveStates.delete(consigneId);
      } else {
        state.pendingHasContent = false;
        state.pendingValue = null;
        state.pendingSerialized = null;
        state.pendingSummary = null;
        autoSaveStates.set(consigneId, state);
      }
      return;
    }

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

  // applyDailyPrefillUpdate implementation removed

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

  const renderItemCard = (item, { isChild = false, deferEditor = false, editorOptions = null, historyChildren = [] } = {}) => {
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
      holder.innerHTML = inputForType(item, HYDRATION_DISABLED ? null : (previous?.value ?? null), { pageContext });
      enhanceRangeMeters(holder);
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
    setupConsigneHistoryTimeline(row, item, ctx, { mode: "daily", dayKey, childConsignes: Array.isArray(historyChildren) ? historyChildren : [] });
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

    // Post-render audit: detect pre-marked rows without matching history/pre-fills for the current day
    try {
      const auditDay = normalizedCurrentDayKey || dayKey || null;
      window.requestAnimationFrame(() => {
        try {
          const datasetStatus = row?.dataset?.status || null;
          const currentVal = readConsigneCurrentValue(item, row);
          const computedStatus = dotColor(item.type, currentVal, item);
          const prevEntry = previousAnswers.get(item.id) || null;
          const prevKey = prevEntry ? resolvePreviousEntryDayKey(prevEntry) : null;
          const hasPrevForToday = Boolean(prevKey && auditDay && prevKey === auditDay);
          const isSummaryLike = prevEntry ? Boolean((prevEntry.summaryScope || prevEntry.summary_scope || "").trim()) ||
            (typeof prevEntry.source === "string" && prevEntry.source.toLowerCase().includes("summary")) ||
            (typeof prevEntry.origin === "string" && prevEntry.origin.toLowerCase().includes("summary")) : false;
          const mismatch = (datasetStatus && datasetStatus !== "na") && !hasPrevForToday;
          prefillLog("row-init", {
            at: "renderItemCard",
            consigneId: item.id,
            type: item.type,
            dayKey: auditDay,
            datasetStatus,
            computedStatus,
            hasPrevForToday,
            prevEntryDayKey: prevKey || null,
            isSummaryLikePrev: isSummaryLike,
          });
          if (mismatch) {
            prefillAlert("row-mismatch", {
              consigneId: item.id,
              reason: "status-not-na-without-day-prev",
              at: "renderItemCard:post",
            });
          }
        } catch (_) {}
      });
    } catch (_) {}

    return row;
  };

  const renderGroup = (group, target) => {
    const wrapper = document.createElement("div");
    wrapper.className = "consigne-group";
    const parentCard = renderItemCard(group.consigne, { isChild: false, deferEditor: true, historyChildren: group.children });
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
// Expose timeline updater and status resolver for other modules (bilan)
Modes.updateConsigneHistoryTimeline = updateConsigneHistoryTimeline;
Modes.dotColor = dotColor;

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