/* editor-checkboxes.js — cases à cocher = comportement "liste à puces" */
(function () {
  const S = () => (window.getSelection()?.rangeCount ? window.getSelection() : null);
  const isCbWrap = (n) =>
    !!(
      n &&
      n.nodeType === 1 &&
      (
        n.classList.contains("cb-wrap") ||
        (typeof n.getAttribute === "function" && n.getAttribute("data-rich-checkbox-wrapper") === "1")
      )
    );
  const isCbInput = (n) => !!(n && n.nodeType === 1 && n.tagName === "INPUT" && n.type === "checkbox");

  function isReallyEmptyText(t) {
    return !(/[^\s\u00A0\u200B\uFEFF]/.test(t || ""));
  }

  function cbRoot(node) {
    if (!node) return null;
    if (isCbWrap(node)) return node;
    if (isCbInput(node)) {
      const wrap = node.closest('.cb-wrap, [data-rich-checkbox-wrapper="1"]');
      return wrap || node;
    }
    if (node.nodeType === 1 && node.closest('.cb-wrap, [data-rich-checkbox-wrapper="1"]')) {
      return node.closest('.cb-wrap, [data-rich-checkbox-wrapper="1"]');
    }
    return null;
  }

  const mkCb = (existingInput) => {
    const w = document.createElement("span");
    w.classList.add("cb-wrap");
    w.setAttribute("data-rich-checkbox-wrapper", "1");
    w.setAttribute("contenteditable", "false");
    w.contentEditable = "false";
    const i = existingInput && isCbInput(existingInput) ? existingInput : document.createElement("input");
    i.setAttribute("type", "checkbox");
    i.type = "checkbox";
    i.setAttribute("data-rich-checkbox", "1");
    i.setAttribute("tabindex", "-1");
    i.tabIndex = -1;
    i.setAttribute("contenteditable", "false");
    i.contentEditable = "false";
    w.appendChild(i);
    return w;
  };

  function normalizeCheckbox(input) {
    if (!isCbInput(input)) return null;
    let wrap = input.closest('.cb-wrap, [data-rich-checkbox-wrapper="1"]');
    if (!wrap) {
      const parent = input.parentNode;
      const next = input.nextSibling;
      wrap = mkCb(input);
      if (parent) parent.insertBefore(wrap, next);
    } else {
      wrap.classList.add("cb-wrap");
      wrap.setAttribute("data-rich-checkbox-wrapper", "1");
      wrap.setAttribute("contenteditable", "false");
      wrap.contentEditable = "false";
      if (!wrap.contains(input)) wrap.appendChild(input);
    }
    input.setAttribute("type", "checkbox");
    input.type = "checkbox";
    input.setAttribute("data-rich-checkbox", "1");
    input.setAttribute("tabindex", "-1");
    input.tabIndex = -1;
    input.setAttribute("contenteditable", "false");
    input.contentEditable = "false";
    return wrap;
  }

  function normalizeCheckboxes(editor) {
    if (!editor) return;
    const checkboxes = Array.from(editor.querySelectorAll('input[type="checkbox"]'));
    checkboxes.forEach((input) => {
      const wrap = normalizeCheckbox(input);
      if (!wrap) return;
      const next = wrap.nextSibling;
      if (!next || next.nodeType !== 3) {
        wrap.after(document.createTextNode(" "));
      } else if (isReallyEmptyText(next.textContent)) {
        next.textContent = " ";
      }
    });
  }

  const firstNonEmpty = (n) => {
    let c = n.firstChild;
    while (
      c &&
      ((c.nodeType === 3 && isReallyEmptyText(c.textContent)) || (c.nodeType === 1 && c.tagName === "BR"))
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
    while (first && first.nodeType === 3 && isReallyEmptyText(first.textContent)) first = first.nextSibling;
    const caretAtStart = r.collapsed && !(r.startContainer.nodeType === 3 && r.startOffset > 0);
    return { mode: "inline", first, node, caretAtStart };
  }

  const startsWithCb = (ctx) => !!cbRoot(ctx?.first);
  function emptyAfterCb(editor, ctx) {
    if (!startsWithCb(ctx)) return false;
    const first = cbRoot(ctx.first);
    if (!first) return false;
    if (ctx.mode === "block") {
      let n = first.nextSibling;
      let empty = true;
      while (n) {
        if (
          (n.nodeType === 3 && !isReallyEmptyText(n.textContent)) ||
          (n.nodeType === 1 && !cbRoot(n) && !isReallyEmptyText(n.textContent))
        ) {
          empty = false;
          break;
        }
        n = n.nextSibling;
      }
      return empty;
    }
    let n = first.nextSibling;
    let empty = true;
    while (n && n !== editor) {
      if (n.nodeName === "BR") break;
      if (
        (n.nodeType === 3 && !isReallyEmptyText(n.textContent)) ||
        (n.nodeType === 1 && !cbRoot(n) && !isReallyEmptyText(n.textContent))
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
  function removeLeadingAndKeepLine(editor, ctx) {
    if (!startsWithCb(ctx)) return false;
    const first = cbRoot(ctx.first);
    if (!first) return false;

    const space = first.nextSibling;
    const anchor = (() => {
      if (space && space.nodeType === 3 && isReallyEmptyText(space.textContent)) {
        return space.nextSibling;
      }
      return first.nextSibling;
    })();

    if (space && space.nodeType === 3 && isReallyEmptyText(space.textContent)) space.remove();
    first.remove();

    const sel = window.getSelection();
    if (!sel) return true;
    const range = document.createRange();

    if (ctx.mode === "block") {
      let caretNode = null;
      if (!ctx.block.textContent || isReallyEmptyText(ctx.block.textContent)) {
        while (ctx.block.firstChild) ctx.block.removeChild(ctx.block.firstChild);
        caretNode = document.createTextNode("");
        ctx.block.appendChild(caretNode);
      } else {
        caretNode = ctx.block.lastChild;
        if (!caretNode || caretNode.nodeType !== 3) {
          caretNode = document.createTextNode("");
          ctx.block.appendChild(caretNode);
        }
      }
      range.setStart(caretNode, caretNode.textContent.length);
    } else {
      let caretNode = null;
      if (anchor && anchor.parentNode === editor) {
        if (anchor.nodeType === 3) {
          caretNode = anchor;
        } else {
          caretNode = document.createTextNode("");
          editor.insertBefore(caretNode, anchor);
        }
      } else {
        caretNode = document.createTextNode("");
        editor.appendChild(caretNode);
      }
      range.setStart(caretNode, 0);
    }

    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
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
    ) {
      return removeLeadingAndKeepLine(editor, ctx);
    }

    function removeTarget(t, prevNext) {
      const root = cbRoot(t);
      if (root) {
        const nb = root[prevNext];
        if (nb && nb.nodeType === 3 && isReallyEmptyText(nb.textContent)) nb.remove();
        root.remove();
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
        if (t && t.nodeType === 3 && isReallyEmptyText(t.textContent)) {
          const x = t.previousSibling;
          if (cbRoot(x)) {
            t.remove();
            t = x;
          }
        }
        return removeTarget(t, "previousSibling");
      } else {
        if (r.startContainer.nodeType === 3 && r.startOffset < r.startContainer.textContent.length)
          return false;
        let t = cont.nextSibling;
        if (t && t.nodeType === 3 && isReallyEmptyText(t.textContent)) {
          const x = t.nextSibling;
          if (cbRoot(x)) {
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
      if (t && t.nodeType === 3 && isReallyEmptyText(t.textContent)) {
        const x = t.previousSibling;
        if (cbRoot(x)) {
          t.remove();
          t = x;
        }
      }
      return removeTarget(t, "previousSibling");
    } else {
      if (r.startContainer.nodeType === 3 && r.startOffset < r.startContainer.textContent.length)
        return false;
      let t = node.nextSibling;
      if (t && t.nodeType === 3 && isReallyEmptyText(t.textContent)) {
        const x = t.nextSibling;
        if (cbRoot(x)) {
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

    normalizeCheckboxes(editor);

    let normalizeScheduled = false;
    const scheduleNormalize = () => {
      if (normalizeScheduled) return;
      normalizeScheduled = true;
      const raf = window.requestAnimationFrame || ((cb) => window.setTimeout(cb, 16));
      raf(() => {
        normalizeScheduled = false;
        normalizeCheckboxes(editor);
      });
    };

    editor.addEventListener("focus", scheduleNormalize);
    editor.addEventListener("input", scheduleNormalize);

    const handleEnter = (event) => {
      const ctx = lineCtx(editor);
      if (!ctx || !startsWithCb(ctx)) return false;
      if (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      }
      if (emptyAfterCb(editor, ctx)) brPlain(editor);
      else brWithCb(editor);
      return true;
    };

    let skipBeforeInputEnter = false;

    editor.addEventListener(
      "beforeinput",
      (e) => {
        if (e.defaultPrevented) return;
        if (e.inputType !== "insertParagraph" && e.inputType !== "insertLineBreak") {
          skipBeforeInputEnter = false;
          return;
        }
        normalizeCheckboxes(editor);
        if (skipBeforeInputEnter) {
          skipBeforeInputEnter = false;
          e.preventDefault();
          return;
        }
        if (handleEnter(e)) {
          skipBeforeInputEnter = true;
        }
      },
      { capture: true }
    );

    editor.addEventListener("keydown", (e) => {
      normalizeCheckboxes(editor);
      if (e.key === "Enter") {
        const handled = handleEnter(e);
        skipBeforeInputEnter = handled;
        if (handled) return;
      } else {
        skipBeforeInputEnter = false;
      }
      if (e.key === "Backspace") {
        if (delAdj(editor, "back")) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
      if (e.key === "Delete") {
        if (delAdj(editor, "del")) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    });

    if (insertBtn) {
      insertBtn.addEventListener("click", () => {
        editor.focus();
        let s = S();
        if (!s) return;
        if (!editor.contains(s.anchorNode)) {
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          s.removeAllRanges();
          s.addRange(range);
        }
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
        editor.focus();
      });
    }
  };
})();
