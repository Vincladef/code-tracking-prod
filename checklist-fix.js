(function () {
  function installChecklistEnterExit(rootEl) {
    if (!rootEl || rootEl.__checklistExitInstalled) return;
    rootEl.__checklistExitInstalled = true;

    rootEl.addEventListener(
      "beforeinput",
      (e) => {
        if (e.defaultPrevented) return;
        if (e.inputType === "insertParagraph") {
          const selection = getSelection();
          const li = closestTaskItemWithCheckbox(selection?.anchorNode, rootEl);
          if (!li) return;
          if (!isTaskItemEmpty(li)) return;

          e.preventDefault();
          exitEmptyTaskItem(li);
        } else if (e.inputType === "deleteContentBackward") {
          const selection = getSelection();
          if (!selection || !selection.isCollapsed) return;
          const li = closestTaskItemWithCheckbox(selection.anchorNode, rootEl);
          if (!li) return;
          if (!isCaretAtStartOf(li, selection)) return;
          if (!isTaskItemEmpty(li)) return;

          e.preventDefault();
          exitEmptyTaskItem(li);
        }
      },
      { capture: true }
    );

    rootEl.addEventListener("keydown", (e) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key === "Enter") {
        const selection = getSelection();
        const li = closestTaskItemWithCheckbox(selection?.anchorNode, rootEl);
        if (!li) return;
        if (!isTaskItemEmpty(li)) return;

        e.preventDefault();
        exitEmptyTaskItem(li);
      } else if (e.key === "Backspace") {
        const selection = getSelection();
        if (!selection || !selection.isCollapsed) return;
        const li = closestTaskItemWithCheckbox(selection.anchorNode, rootEl);
        if (!li) return;
        if (!isCaretAtStartOf(li, selection)) return;
        if (!isTaskItemEmpty(li)) return;

        e.preventDefault();
        exitEmptyTaskItem(li);
      }
    });
  }

  function closestTaskItemWithCheckbox(node, rootEl) {
    for (let n = node; n && n !== rootEl; n = n.parentNode) {
      if (n.nodeType === 1 && n.nodeName === "LI") {
        if (n.querySelector?.('input[type="checkbox"]')) {
          return n;
        }
      }
    }
    return null;
  }

  function isTaskItemEmpty(li) {
    if (!li) return false;
    const clone = li.cloneNode(true);
    clone.querySelectorAll('input[type="checkbox"], br').forEach((n) => n.remove());
    const text = clone.textContent.replace(/\u200B/g, "").trim();
    return text.length === 0;
  }

  function exitEmptyTaskItem(li) {
    if (!li) return;
    const list = li.parentElement;
    if (!list) return;
    const doc = li.ownerDocument || document;
    const onlyItem = list.children.length === 1;

    const paragraph = doc.createElement("p");
    paragraph.appendChild(doc.createElement("br"));

    if (onlyItem) {
      list.replaceWith(paragraph);
    } else {
      let afterList = list.nextSibling;
      while (afterList && afterList.nodeType === 3 && !afterList.textContent.trim()) {
        afterList = afterList.nextSibling;
      }
      li.remove();
      if (afterList && afterList.nodeName === "P") {
        placeCaretAtStart(afterList);
        return;
      }
      list.insertAdjacentElement("afterend", paragraph);
    }

    placeCaretAtStart(paragraph);
  }

  function placeCaretAtStart(el) {
    if (!el) return;
    const doc = el.ownerDocument || document;
    const range = doc.createRange();
    range.setStart(el, 0);
    range.collapse(true);
    const selection = doc.getSelection ? doc.getSelection() : window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function isCaretAtStartOf(li, selection) {
    if (!selection || selection.rangeCount === 0) return false;
    const caretRange = selection.getRangeAt(0);
    if (!caretRange.collapsed) return false;
    const startRange = caretRange.cloneRange();
    startRange.selectNodeContents(li);
    startRange.collapse(true);
    return caretRange.compareBoundaryPoints(Range.START_TO_START, startRange) === 0;
  }

  if (typeof window !== "undefined") {
    window.installChecklistEnterExit = installChecklistEnterExit;
  }
})();
