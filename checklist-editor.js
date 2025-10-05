/* checklist-editor.js
   Comportement "liste à puces" pour les cases à cocher dans un contenteditable.
   - Mobile: gère 'beforeinput' (insertParagraph / deleteContentBackward/Forward)
   - Desktop: garde un fallback 'keydown'
   - Compatible lignes en <div>/<p> (Chrome/Safari) OU <br> (certains resets)
*/

(function () {
  const isCb = (n) => !!(n && n.nodeType === 1 && n.classList.contains("cb-wrap"));

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

  const firstNonEmpty = (node) => {
    let c = node.firstChild;
    while (
      c &&
      ((c.nodeType === 3 && !c.textContent.trim()) || (c.nodeType === 1 && c.tagName === "BR"))
    ) {
      c = c.nextSibling;
    }
    return c;
  };

  function getLineCtx(editor) {
    const s = sel();
    if (!s) return null;
    const r = s.getRangeAt(0);
    // remonter jusqu’à un enfant direct de l’éditeur
    let node = r.startContainer;
    while (node && node.parentNode !== editor) node = node.parentNode;
    if (!node) return null;

    // Mode "block" si enfant direct est DIV/P/LI
    if (
      node.nodeType === 1 &&
      node.parentNode === editor &&
      /^(DIV|P|LI)$/i.test(node.tagName)
    ) {
      const block = node;
      // caret au tout début du block ?
      const atStart = (() => {
        if (!r.collapsed) return false;
        if (r.startContainer.nodeType === 3 && r.startOffset > 0) return false;
        let cur = r.startContainer;
        while (cur && cur.parentNode !== block) cur = cur.parentNode;
        return cur === firstNonEmpty(block) || cur === block;
      })();
      return { mode: "block", block, first: firstNonEmpty(block), caretAtStart: atStart };
    }

    // Sinon, mode "inline" (lignes séparées par <br>)
    let prev = node.previousSibling;
    while (prev && prev.nodeName !== "BR") prev = prev.previousSibling;
    let first = prev ? prev.nextSibling : editor.firstChild;
    while (first && first.nodeType === 3 && !first.textContent.trim()) first = first.nextSibling;
    const caretAtStart =
      r.collapsed && !(r.startContainer.nodeType === 3 && r.startOffset > 0);
    return { mode: "inline", node, first, caretAtStart };
  }

  const lineStartsWithCb = (ctx) => !!(ctx && isCb(ctx.first));

  function lineEmptyAfterCb(editor, ctx) {
    if (!lineStartsWithCb(ctx)) return false;
    if (ctx.mode === "block") {
      let n = ctx.first.nextSibling;
      while (n) {
        if (
          (n.nodeType === 3 && n.textContent.trim()) ||
          (n.nodeType === 1 && !isCb(n) && n.textContent.trim())
        )
          return false;
        n = n.nextSibling;
      }
      return true;
    }
    // inline
    let n = ctx.first.nextSibling;
    while (n && n !== editor) {
      if (n.nodeName === "BR") break;
      if (
        (n.nodeType === 3 && n.textContent.trim()) ||
        (n.nodeType === 1 && !isCb(n) && n.textContent.trim())
      )
        return false;
      n = n.nextSibling;
    }
    return true;
  }

  function setCaret(rangeOrNode, startAfter = true) {
    const s = sel();
    if (!s) return;
    let r = null;
    if (rangeOrNode instanceof Range) r = rangeOrNode;
    else {
      r = document.createRange();
      if (startAfter) r.setStartAfter(rangeOrNode);
      else r.setStartBefore(rangeOrNode);
      r.collapse(true);
    }
    s.removeAllRanges();
    s.addRange(r);
  }

  function insertPlainLine(editor, ctx) {
    if (ctx.mode === "block") {
      const newBlock = document.createElement(ctx.block.tagName);
      newBlock.appendChild(document.createElement("br")); // vrai bloc vide
      ctx.block.after(newBlock);
      const r = document.createRange();
      r.setStart(newBlock, 0);
      r.collapse(true);
      setCaret(r);
      return;
    }
    const s = sel();
    const r = s.getRangeAt(0);
    const br = document.createElement("br");
    r.deleteContents();
    r.insertNode(br);
    setCaret(br);
  }

  function insertLineWithCb(editor, ctx) {
    if (ctx.mode === "block") {
      const nb = document.createElement(ctx.block.tagName);
      const wrap = makeCb();
      nb.appendChild(wrap);
      nb.appendChild(document.createTextNode(" "));
      ctx.block.after(nb);
      const r = document.createRange();
      r.setStart(nb, nb.childNodes.length);
      r.collapse(true);
      setCaret(r);
      return;
    }
    const s = sel();
    const r = s.getRangeAt(0);
    const br = document.createElement("br");
    r.deleteContents();
    r.insertNode(br);
    r.setStartAfter(br);
    r.collapse(true);
    const wrap = makeCb();
    r.insertNode(wrap);
    const space = document.createTextNode(" ");
    const r2 = document.createRange();
    r2.setStartAfter(wrap);
    r2.collapse(true);
    r2.insertNode(space);
    r2.setStartAfter(space);
    r2.setEndAfter(space);
    setCaret(r2);
  }

  function removeLeadingCb(editor, ctx) {
    const first = ctx.first;
    if (!isCb(first)) return false;
    const space = first.nextSibling;
    if (space && space.nodeType === 3 && /^\s$/.test(space.textContent)) space.remove();
    first.remove();
    return true;
  }

  function deleteAdjacentCb(editor, ctx, direction /*'back'|'del'*/) {
    const s = sel();
    if (!s) return false;
    const r = s.getRangeAt(0);
    if (!r.collapsed) return false;

    // 1) tout début de ligne checkbox → retirer la "puce"
    if (ctx.caretAtStart && lineStartsWithCb(ctx) && direction === "back") {
      return removeLeadingCb(editor, ctx);
    }

    // 2) sinon, supprimer la cb voisine
    if (ctx.mode === "block") {
      let n = r.startContainer;
      while (n && n.parentNode !== ctx.block) n = n.parentNode;
      const container = n || ctx.block;

      if (direction === "back") {
        if (r.startContainer.nodeType === 3 && r.startOffset > 0) return false;
        let t = container.previousSibling;
        if (t && t.nodeType === 3 && /^\s$/.test(t.textContent)) {
          const x = t.previousSibling;
          if (isCb(x)) {
            t.remove();
            t = x;
          }
        }
        if (isCb(t)) {
          const nb = t.previousSibling;
          if (nb && nb.nodeType === 3 && /^\s$/.test(nb.textContent)) nb.remove();
          t.remove();
          return true;
        }
      } else {
        if (
          r.startContainer.nodeType === 3 &&
          r.startOffset < r.startContainer.textContent.length
        )
          return false;
        let t = container.nextSibling;
        if (t && t.nodeType === 3 && /^\s$/.test(t.textContent)) {
          const x = t.nextSibling;
          if (isCb(x)) {
            t.remove();
            t = x;
          }
        }
        if (isCb(t)) {
          const nb = t.nextSibling;
          if (nb && nb.nodeType === 3 && /^\s$/.test(nb.textContent)) nb.remove();
          t.remove();
          return true;
        }
      }
      return false;
    }

    // inline
    let node = r.startContainer;
    while (node && node.parentNode !== editor) node = node.parentNode;
    if (!node) return false;

    if (direction === "back") {
      if (r.startContainer.nodeType === 3 && r.startOffset > 0) return false;
      let t = node.previousSibling;
      if (t && t.nodeType === 3 && /^\s$/.test(t.textContent)) {
        const x = t.previousSibling;
        if (isCb(x)) {
          t.remove();
          t = x;
        }
      }
      if (isCb(t)) {
        const nb = t.previousSibling;
        if (nb && nb.nodeType === 3 && /^\s$/.test(nb.textContent)) nb.remove();
        t.remove();
        return true;
      }
    } else {
      if (
        r.startContainer.nodeType === 3 &&
        r.startOffset < r.startContainer.textContent.length
      )
        return false;
      let t = node.nextSibling;
      if (t && t.nodeType === 3 && /^\s$/.test(t.textContent)) {
        const x = t.nextSibling;
        if (isCb(x)) {
          t.remove();
          t = x;
        }
      }
      if (isCb(t)) {
        const nb = t.nextSibling;
        if (nb && nb.nodeType === 3 && /^\s$/.test(nb.textContent)) nb.remove();
        t.remove();
        return true;
      }
    }
    return false;
  }

  function onInsertParagraph(editor) {
    const ctx = getLineCtx(editor);
    if (!ctx || !lineStartsWithCb(ctx)) return false;
    if (lineEmptyAfterCb(editor, ctx)) insertPlainLine(editor, ctx); // item vide -> sortir
    else insertLineWithCb(editor, ctx); // sinon -> nouvel item
    return true;
  }
  function onDeleteBackward(editor) {
    const ctx = getLineCtx(editor);
    if (!ctx) return false;
    return deleteAdjacentCb(editor, ctx, "back");
  }
  function onDeleteForward(editor) {
    const ctx = getLineCtx(editor);
    if (!ctx) return false;
    return deleteAdjacentCb(editor, ctx, "del");
  }

  window.setupChecklistEditor = function (editor, insertBtn) {
    if (!editor || editor.__cbInstalled) return;
    editor.__cbInstalled = true;

    // ---- Mobile-first: beforeinput ----
    editor.addEventListener(
      "beforeinput",
      (e) => {
        // IMPORTANT: must be able to preventDefault()
        if (e.inputType === "insertParagraph") {
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
      { capture: true },
    );

    // ---- Desktop fallback: keydown ----
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

    // ---- Bouton "☐" ----
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
        s.removeAllRanges();
        s.addRange(r2);
      });
    }
  };

  if (typeof window !== "undefined") {
    window.setupCheckboxListBehavior = window.setupChecklistEditor;
  }
})();
