/* checklist-editor.js — v2
   Cases à cocher dans un contenteditable qui se comportent comme une vraie liste :
   - Enter sur "☐ + texte"   => nouvelle case à la ligne suivante
   - Enter sur "☐ + (vide)"  => sortie du "mode case" (ligne normale, sans case)
   - Backspace/Suppr au bon endroit => supprime la case (ou "retire la puce" au tout début)
   Gère:
     * mobile (Android/iOS) via 'beforeinput' (insertParagraph / insertLineBreak / deleteContentBackward/Forward)
     * desktop via 'keydown'
     * éditeurs en <div>/<p>/li par ligne OU séparés par <br>
*/

(function () {
  const ZERO_WIDTH = /\u200B/g;
  const isCbWrap = (n) => !!(n && n.nodeType === 1 && n.classList.contains("cb-wrap"));
  const isCheckboxEl = (n) => !!(n && n.nodeType === 1 && n.tagName === "INPUT" && n.type === "checkbox");
  const isCheckboxNode = (n) => isCbWrap(n) || isCheckboxEl(n);
  const isBreak = (n) => !!(n && n.nodeType === 1 && n.tagName === "BR");
  const isMeaninglessText = (n) =>
    !!(
      n &&
      n.nodeType === 3 &&
      !n.textContent.replace(ZERO_WIDTH, "").trim()
    );

  function hasContent(node) {
    if (!node) return false;
    if (node.nodeType === 3) {
      return !!node.textContent.replace(ZERO_WIDTH, "").trim();
    }
    if (isCheckboxNode(node) || isBreak(node)) return false;
    if (node.nodeType === 1) {
      return !!node.textContent.replace(ZERO_WIDTH, "").trim();
    }
    return false;
  }

  function firstMeaningful(node) {
    if (!node) return null;
    let c = node.firstChild;
    while (c && (isMeaninglessText(c) || isBreak(c))) c = c.nextSibling;
    return c || null;
  }

  function makeCb() {
    const wrap = document.createElement("span");
    wrap.className = "cb-wrap";
    wrap.contentEditable = "false";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.tabIndex = -1;
    wrap.appendChild(cb);
    return wrap;
  }

  const sel = () => (window.getSelection()?.rangeCount ? window.getSelection() : null);

  function setCaret(rangeOrNode, placeAfter = true) {
    const s = sel();
    if (!s) return;
    let r;
    if (rangeOrNode instanceof Range) r = rangeOrNode;
    else {
      r = document.createRange();
      if (placeAfter) r.setStartAfter(rangeOrNode);
      else r.setStartBefore(rangeOrNode);
      r.collapse(true);
    }
    s.removeAllRanges();
    s.addRange(r);
  }

  function isDescendant(node, root) {
    let cur = node;
    while (cur) {
      if (cur === root) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  function nodeBefore(node, root) {
    let cur = node;
    while (cur && cur !== root && !cur.previousSibling) cur = cur.parentNode;
    if (!cur || cur === root) {
      if (!cur || !cur.previousSibling) return null;
    }
    cur = cur.previousSibling;
    while (cur && cur.lastChild && isDescendant(cur.lastChild, root)) cur = cur.lastChild;
    return cur && isDescendant(cur, root) ? cur : null;
  }

  function nodeAfter(node, root) {
    let cur = node;
    while (cur && cur !== root && !cur.nextSibling) cur = cur.parentNode;
    if (!cur || cur === root) {
      if (!cur || !cur.nextSibling) return null;
    }
    cur = cur.nextSibling;
    while (cur && cur.firstChild && isDescendant(cur.firstChild, root)) cur = cur.firstChild;
    return cur && isDescendant(cur, root) ? cur : null;
  }

  function caretPrevNode(range, root) {
    const container = range.startContainer;
    const offset = range.startOffset;
    if (container.nodeType === 3) {
      if (offset > 0) return { blocked: true };
      return { node: nodeBefore(container, root) };
    }
    if (offset === 0) {
      return { node: nodeBefore(container, root) };
    }
    const child = container.childNodes[offset - 1];
    if (!child) return { node: nodeBefore(container, root) };
    if (child.nodeType === 3) {
      if (child.textContent.replace(ZERO_WIDTH, "").length) return { blocked: true };
    }
    return { node: child };
  }

  function caretNextNode(range, root) {
    const container = range.startContainer;
    const offset = range.startOffset;
    if (container.nodeType === 3) {
      if (offset < container.textContent.length) return { blocked: true };
      return { node: nodeAfter(container, root) };
    }
    const child = container.childNodes[offset];
    if (!child) return { node: nodeAfter(container, root) };
    if (child.nodeType === 3) {
      if (child.textContent.replace(ZERO_WIDTH, "").length) return { blocked: true };
    }
    return { node: child };
  }

  function getLineCtx(editor) {
    const s = sel();
    if (!s) return null;
    const r = s.getRangeAt(0);
    let node = r.startContainer;
    while (node && node.parentNode !== editor) node = node.parentNode;
    if (!node) return null;

    if (node.nodeType === 1 && node.parentNode === editor && /^(DIV|P|LI)$/i.test(node.tagName)) {
      const block = node;
      const first = firstMeaningful(block);
      const caretAtStart = (() => {
        if (!r.collapsed) return false;
        if (r.startContainer.nodeType === 3 && r.startOffset > 0) return false;
        let cur = r.startContainer;
        while (cur && cur.parentNode !== block) cur = cur.parentNode;
        return cur === first || cur === block;
      })();
      return { mode: "block", block, first, caretAtStart };
    }

    let prev = node.previousSibling;
    while (prev && prev.nodeName !== "BR") prev = prev.previousSibling;
    let first = prev ? prev.nextSibling : editor.firstChild;
    while (first && isMeaninglessText(first)) first = first.nextSibling;
    const caretAtStart = r.collapsed && !(r.startContainer.nodeType === 3 && r.startOffset > 0);
    return { mode: "inline", node, first, caretAtStart };
  }

  const startsWithCheckbox = (ctx) => !!(ctx && isCheckboxNode(ctx.first));

  function emptyAfterCheckbox(editor, ctx) {
    if (!startsWithCheckbox(ctx)) return false;

    const checkInline = (start, boundary) => {
      let n = start.nextSibling;
      while (n && n !== boundary) {
        if (isBreak(n)) break;
        if (hasContent(n)) return false;
        if (isCheckboxNode(n)) return false;
        n = n.nextSibling;
      }
      return true;
    };

    if (ctx.mode === "block") {
      let n = ctx.first.nextSibling;
      while (n) {
        if (hasContent(n)) return false;
        if (isCheckboxNode(n)) return false;
        if (isBreak(n)) return true;
        n = n.nextSibling;
      }
      return true;
    }
    return checkInline(ctx.first, editor);
  }

  function removeCheckboxNode(node, options = {}) {
    const { removeLeft = true, removeRight = true } = options;
    if (!node) return;
    if (removeLeft) {
      let sib = node.previousSibling;
      while (sib && isMeaninglessText(sib)) {
        const prev = sib.previousSibling;
        sib.remove();
        sib = prev;
      }
    }
    if (removeRight) {
      let sib = node.nextSibling;
      while (sib && isMeaninglessText(sib)) {
        const next = sib.nextSibling;
        sib.remove();
        sib = next;
      }
    }
    node.remove();
  }

  function removeLeadingCheckbox(editor, ctx) {
    const first = ctx.first;
    if (!isCheckboxNode(first)) return false;
    removeCheckboxNode(first, { removeLeft: false });
    return true;
  }

  function insertPlainLine(editor, ctx) {
    if (ctx.mode === "block") {
      const newBlock = document.createElement(ctx.block.tagName);
      newBlock.appendChild(document.createElement("br"));
      ctx.block.after(newBlock);
      const r = document.createRange();
      r.setStart(newBlock, 0);
      r.collapse(true);
      setCaret(r);
      return;
    }
    const s = sel();
    if (!s) return;
    const r = s.getRangeAt(0);
    r.deleteContents();
    const br = document.createElement("br");
    r.insertNode(br);
    setCaret(br);
  }

  function insertLineWithCheckbox(editor, ctx) {
    if (ctx.mode === "block") {
      const newBlock = document.createElement(ctx.block.tagName);
      const wrap = makeCb();
      newBlock.appendChild(wrap);
      newBlock.appendChild(document.createTextNode(" "));
      ctx.block.after(newBlock);
      const r = document.createRange();
      r.setStart(newBlock, newBlock.childNodes.length);
      r.collapse(true);
      setCaret(r);
      return;
    }
    const s = sel();
    if (!s) return;
    const r = s.getRangeAt(0);
    r.deleteContents();
    const br = document.createElement("br");
    r.insertNode(br);
    const wrap = makeCb();
    const space = document.createTextNode(" ");
    const r2 = document.createRange();
    r2.setStartAfter(br);
    r2.collapse(true);
    r2.insertNode(space);
    r2.setStartBefore(space);
    r2.insertNode(wrap);
    const caretRange = document.createRange();
    caretRange.setStartAfter(space);
    caretRange.collapse(true);
    setCaret(caretRange);
  }

  function deleteAdjacentCheckbox(editor, ctx, direction /* 'back' | 'del' */) {
    const s = sel();
    if (!s) return false;
    const r = s.getRangeAt(0);
    if (!r.collapsed) return false;

    if (direction === "back" && ctx.caretAtStart && startsWithCheckbox(ctx)) {
      return removeLeadingCheckbox(editor, ctx);
    }

    const boundary = ctx.mode === "block" ? ctx.block : editor;
    const info = direction === "back" ? caretPrevNode(r, boundary) : caretNextNode(r, boundary);
    if (!info || info.blocked) return false;
    let target = info.node;
    if (!target) return false;

    if (!isDescendant(target, boundary)) return false;
    if (!isCheckboxNode(target)) {
      if (target.nodeType === 3 && target.textContent.replace(ZERO_WIDTH, "").trim()) return false;
      if (direction === "back") target = nodeBefore(target, boundary);
      else target = nodeAfter(target, boundary);
      if (!target || !isCheckboxNode(target)) return false;
    }

    removeCheckboxNode(target);
    return true;
  }

  function onInsertParagraph(editor) {
    const ctx = getLineCtx(editor);
    if (!ctx || !startsWithCheckbox(ctx)) return false;
    if (emptyAfterCheckbox(editor, ctx)) insertPlainLine(editor, ctx);
    else insertLineWithCheckbox(editor, ctx);
    return true;
  }

  function onDeleteBackward(editor) {
    const ctx = getLineCtx(editor);
    if (!ctx) return false;
    return deleteAdjacentCheckbox(editor, ctx, "back");
  }

  function onDeleteForward(editor) {
    const ctx = getLineCtx(editor);
    if (!ctx) return false;
    return deleteAdjacentCheckbox(editor, ctx, "del");
  }

  window.setupChecklistEditor = function (editor, insertBtn) {
    if (!editor || editor.__cbInstalled) return;
    editor.__cbInstalled = true;

    editor.addEventListener(
      "beforeinput",
      (e) => {
        if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") {
          if (onInsertParagraph(editor)) {
            e.preventDefault();
          }
        } else if (e.inputType === "deleteContentBackward") {
          if (onDeleteBackward(editor)) {
            e.preventDefault();
          }
        } else if (e.inputType === "deleteContentForward") {
          if (onDeleteForward(editor)) {
            e.preventDefault();
          }
        }
      },
      { capture: true }
    );

    editor.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (onInsertParagraph(editor)) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === "Backspace") {
        if (onDeleteBackward(editor)) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === "Delete") {
        if (onDeleteForward(editor)) {
          e.preventDefault();
          return;
        }
      }
    });

    if (insertBtn) {
      insertBtn.addEventListener("click", () => {
        editor.focus();
        const s = sel();
        if (!s) return;
        const r = s.getRangeAt(0);
        const node = makeCb();
        r.deleteContents();
        r.insertNode(node);
        const space = document.createTextNode(" ");
        const r2 = document.createRange();
        r2.setStartAfter(node);
        r2.collapse(true);
        r2.insertNode(space);
        r2.setStartAfter(space);
        r2.setEndAfter(space);
        setCaret(r2);
      });
    }
  };

  if (typeof window !== "undefined") {
    window.setupCheckboxListBehavior = window.setupChecklistEditor;
  }
})();
