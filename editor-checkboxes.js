/* editor-checkboxes.js — cases à cocher = comportement "liste à puces" */
(function () {
  const S = () => (window.getSelection()?.rangeCount ? window.getSelection() : null);
  const isCb = (n) => !!(n && n.nodeType === 1 && n.classList.contains("cb-wrap"));
  const mkCb = () => {
    const w = document.createElement("span");
    w.className = "cb-wrap";
    w.contentEditable = "false";
    const i = document.createElement("input");
    i.type = "checkbox";
    i.tabIndex = -1;
    w.appendChild(i);
    return w;
  };

  const firstNonEmpty = (n) => {
    let c = n.firstChild;
    while (
      c &&
      ((c.nodeType === 3 && !c.textContent.trim()) || (c.nodeType === 1 && c.tagName === "BR"))
    )
      c = c.nextSibling;
    return c;
  };

  function lineCtx(editor) {
    const s = S();
    if (!s) return null;
    const r = s.getRangeAt(0);
    let node = r.startContainer;
    while (node && node.parentNode !== editor) node = node.parentNode;
    if (!node) return null;

    if (node.nodeType === 1 && node.parentNode === editor && /^(DIV|P|LI)$/i.test(node.tagName)) {
      const block = node;
      const first = firstNonEmpty(block);
      let cur = r.startContainer;
      while (cur && cur.parentNode !== block) cur = cur.parentNode;
      const caretAtStart =
        r.collapsed &&
        !(r.startContainer.nodeType === 3 && r.startOffset > 0) &&
        (cur === first || cur === block);
      return { mode: "block", block, first, caretAtStart, caretNode: cur || block };
    }
    let prev = node.previousSibling;
    while (prev && prev.nodeName !== "BR") prev = prev.previousSibling;
    let first = prev ? prev.nextSibling : editor.firstChild;
    while (first && first.nodeType === 3 && !first.textContent.trim()) first = first.nextSibling;
    const caretAtStart = r.collapsed && !(r.startContainer.nodeType === 3 && r.startOffset > 0);
    return { mode: "inline", first, node, caretAtStart };
  }

  const startsWithCb = (ctx) => !!(ctx && isCb(ctx.first));
  function emptyAfterCb(editor, ctx) {
    if (!startsWithCb(ctx)) return false;
    if (ctx.mode === "block") {
      let n = ctx.first.nextSibling;
      let empty = true;
      while (n) {
        if (
          (n.nodeType === 3 && n.textContent.trim()) ||
          (n.nodeType === 1 && !isCb(n) && n.textContent.trim())
        ) {
          empty = false;
          break;
        }
        n = n.nextSibling;
      }
      return empty;
    }
    let n = ctx.first.nextSibling;
    let empty = true;
    while (n && n !== editor) {
      if (n.nodeName === "BR") break;
      if (
        (n.nodeType === 3 && n.textContent.trim()) ||
        (n.nodeType === 1 && !isCb(n) && n.textContent.trim())
      ) {
        empty = false;
        break;
      }
      n = n.nextSibling;
    }
    return empty;
  }

  function brPlain(editor) {
    const s = S();
    if (!s) return;
    const r = s.getRangeAt(0);
    const ctx = lineCtx(editor);
    if (ctx && ctx.mode === "block") {
      const nb = document.createElement(ctx.block.tagName);
      nb.appendChild(document.createElement("br"));
      ctx.block.after(nb);
      const nr = document.createRange();
      nr.setStart(nb, 0);
      nr.collapse(true);
      s.removeAllRanges();
      s.addRange(nr);
      return;
    }
    const br = document.createElement("br");
    r.deleteContents();
    r.insertNode(br);
    r.setStartAfter(br);
    r.setEndAfter(br);
    s.removeAllRanges();
    s.addRange(r);
  }
  function brWithCb(editor) {
    const s = S();
    if (!s) return;
    const r = s.getRangeAt(0);
    const ctx = lineCtx(editor);
    if (ctx && ctx.mode === "block") {
      const nb = document.createElement(ctx.block.tagName);
      const w = mkCb();
      nb.appendChild(w);
      nb.appendChild(document.createTextNode(" "));
      ctx.block.after(nb);
      const nr = document.createRange();
      nr.setStart(nb, nb.childNodes.length);
      nr.collapse(true);
      s.removeAllRanges();
      s.addRange(nr);
      return;
    }
    const br = document.createElement("br");
    r.deleteContents();
    r.insertNode(br);
    r.setStartAfter(br);
    r.collapse(true);
    const w = mkCb();
    r.insertNode(w);
    const sp = document.createTextNode(" ");
    const r2 = document.createRange();
    r2.setStartAfter(w);
    r2.collapse(true);
    r2.insertNode(sp);
    r2.setStartAfter(sp);
    r2.setEndAfter(sp);
    s.removeAllRanges();
    s.addRange(r2);
  }
  function removeLeading(editor, ctx) {
    if (!startsWithCb(ctx)) return false;
    const space = ctx.first.nextSibling;
    if (space && space.nodeType === 3 && /^\s$/.test(space.textContent)) space.remove();
    ctx.first.remove();
    return true;
  }
  function delAdj(editor, dir) {
    const s = S();
    if (!s) return false;
    const r = s.getRangeAt(0);
    if (!r.collapsed) return false;
    const ctx = lineCtx(editor);
    if (!ctx) return false;
    if (
      dir === "back" &&
      ((ctx.mode === "block" && ctx.caretAtStart && startsWithCb(ctx)) ||
        (ctx.mode === "inline" && ctx.caretAtStart && startsWithCb(ctx)))
    )
      return removeLeading(editor, ctx);

    function removeTarget(t, prevNext) {
      if (isCb(t)) {
        const nb = t[prevNext];
        if (nb && nb.nodeType === 3 && /^\s$/.test(nb.textContent)) nb.remove();
        t.remove();
        return true;
      }
      return false;
    }

    if (ctx.mode === "block") {
      let cont = r.startContainer;
      while (cont && cont.parentNode !== ctx.block) cont = cont.parentNode;
      cont = cont || ctx.block;
      if (dir === "back") {
        if (r.startContainer.nodeType === 3 && r.startOffset > 0) return false;
        let t = cont.previousSibling;
        if (t && t.nodeType === 3 && /^\s$/.test(t.textContent)) {
          const x = t.previousSibling;
          if (isCb(x)) {
            t.remove();
            t = x;
          }
        }
        return removeTarget(t, "previousSibling");
      } else {
        if (r.startContainer.nodeType === 3 && r.startOffset < r.startContainer.textContent.length)
          return false;
        let t = cont.nextSibling;
        if (t && t.nodeType === 3 && /^\s$/.test(t.textContent)) {
          const x = t.nextSibling;
          if (isCb(x)) {
            t.remove();
            t = x;
          }
        }
        return removeTarget(t, "nextSibling");
      }
    }

    let node = r.startContainer;
    while (node && node.parentNode !== editor) node = node.parentNode;
    if (!node) return false;
    if (dir === "back") {
      if (r.startContainer.nodeType === 3 && r.startOffset > 0) return false;
      let t = node.previousSibling;
      if (t && t.nodeType === 3 && /^\s$/.test(t.textContent)) {
        const x = t.previousSibling;
        if (isCb(x)) {
          t.remove();
          t = x;
        }
      }
      return removeTarget(t, "previousSibling");
    } else {
      if (r.startContainer.nodeType === 3 && r.startOffset < r.startContainer.textContent.length)
        return false;
      let t = node.nextSibling;
      if (t && t.nodeType === 3 && /^\s$/.test(t.textContent)) {
        const x = t.nextSibling;
        if (isCb(x)) {
          t.remove();
          t = x;
        }
      }
      return removeTarget(t, "nextSibling");
    }
  }

  window.setupCheckboxListBehavior = function (editor, insertBtn) {
    if (!editor || editor.__cbInstalled) return;
    editor.__cbInstalled = true;

    editor.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const ctx = lineCtx(editor);
        if (!ctx || !startsWithCb(ctx)) return;
        e.preventDefault();
        emptyAfterCb(editor, ctx) ? brPlain(editor) : brWithCb(editor);
      }
      if (e.key === "Backspace") {
        if (delAdj(editor, "back")) e.preventDefault();
      }
      if (e.key === "Delete") {
        if (delAdj(editor, "del")) e.preventDefault();
      }
    });

    if (insertBtn) {
      insertBtn.addEventListener("click", () => {
        editor.focus();
        const s = S();
        if (!s) return;
        const r = s.getRangeAt(0);
        const w = mkCb();
        r.deleteContents();
        r.insertNode(w);
        const sp = document.createTextNode(" ");
        const r2 = document.createRange();
        r2.setStartAfter(w);
        r2.collapse(true);
        r2.insertNode(sp);
        r2.setStartAfter(sp);
        r2.setEndAfter(sp);
        s.removeAllRanges();
        s.addRange(r2);
      });
    }
  };
})();
