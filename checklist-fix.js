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
