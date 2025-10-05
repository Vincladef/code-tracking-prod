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
  const isCbWrap = (n) => !!(n && n.nodeType === 1 && n.classList.contains('cb-wrap'));
  const isCheckboxEl = (n) => !!(n && n.nodeType === 1 && n.tagName === 'INPUT' && n.type === 'checkbox');
  const isMeaninglessText = (n) =>
    n &&
    n.nodeType === 3 &&
    !n.textContent.replace(/\u200B/g, '').trim();

  function firstMeaningful(node) {
    let c = node ? node.firstChild : null;
    while (c && (isMeaninglessText(c) || (c.nodeType === 1 && c.tagName === 'BR'))) {
      c = c.nextSibling;
    }
    return c || null;
  }

  function hasMeaningfulContent(node) {
    if (!node) return false;
    if (node.nodeType === 3) {
      return !!node.textContent.replace(/\u200B/g, '').trim();
    }
    if (node.nodeType !== 1) return false;
    if (isCbWrap(node) || isCheckboxEl(node) || node.tagName === 'BR') return false;
    let child = node.firstChild;
    while (child) {
      if (hasMeaningfulContent(child)) return true;
      child = child.nextSibling;
    }
    return false;
  }

  function makeCb() {
    const wrap = document.createElement('span');
    wrap.className = 'cb-wrap';
    wrap.contentEditable = 'false';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.tabIndex = -1;
    wrap.appendChild(cb);
    return wrap;
  }

  const sel = () => (window.getSelection()?.rangeCount ? window.getSelection() : null);

  function setCaret(rangeOrNode, placeAfter = true) {
    const s = sel();
    if (!s) return;
    let range = null;
    if (rangeOrNode instanceof Range) {
      range = rangeOrNode;
    } else {
      range = document.createRange();
      if (placeAfter) range.setStartAfter(rangeOrNode);
      else range.setStartBefore(rangeOrNode);
      range.collapse(true);
    }
    s.removeAllRanges();
    s.addRange(range);
  }

  function getLineCtx(editor) {
    const s = sel();
    if (!s) return null;
    const r = s.getRangeAt(0);
    let node = r.startContainer;
    while (node && node.parentNode !== editor) node = node.parentNode;
    if (!node) return null;

    if (
      node.nodeType === 1 &&
      node.parentNode === editor &&
      /^(DIV|P|LI)$/i.test(node.tagName)
    ) {
      const block = node;
      const first = firstMeaningful(block);
      const caretAtStart = (() => {
        if (!r.collapsed) return false;
        if (r.startContainer.nodeType === 3 && r.startOffset > 0) return false;
        let cur = r.startContainer;
        while (cur && cur.parentNode !== block) cur = cur.parentNode;
        return cur === first || cur === block;
      })();
      return { mode: 'block', block, first, caretAtStart };
    }

    let prev = node.previousSibling;
    while (prev && prev.nodeName !== 'BR') prev = prev.previousSibling;
    let first = prev ? prev.nextSibling : editor.firstChild;
    while (first && isMeaninglessText(first)) first = first.nextSibling;
    const caretAtStart =
      r.collapsed && !(r.startContainer.nodeType === 3 && r.startOffset > 0);
    return { mode: 'inline', node, first, caretAtStart };
  }

  function startsWithCheckbox(ctx) {
    if (!ctx || !ctx.first) return false;
    return isCbWrap(ctx.first) || isCheckboxEl(ctx.first);
  }

  function emptyAfterCheckbox(editor, ctx) {
    if (!startsWithCheckbox(ctx)) return false;

    if (ctx.mode === 'block') {
      let n = ctx.first.nextSibling;
      while (n) {
        if (hasMeaningfulContent(n)) return false;
        n = n.nextSibling;
      }
      return true;
    }

    let n = ctx.first.nextSibling;
    while (n) {
      if (n.nodeName === 'BR') break;
      if (hasMeaningfulContent(n)) return false;
      n = n.nextSibling;
    }
    return true;
  }

  function removeLeadingCheckbox(ctx) {
    if (!startsWithCheckbox(ctx)) return null;
    const checkbox = ctx.first;
    const parent = checkbox.parentNode;
    let next = checkbox.nextSibling;
    checkbox.remove();

    while (next && isMeaninglessText(next)) {
      const toRemove = next;
      next = next.nextSibling;
      toRemove.remove();
    }

    if (parent && parent.normalize) parent.normalize();
    return { parent, next };
  }

  function insertLineWithCheckbox(editor, ctx) {
    if (ctx.mode === 'block') {
      const newBlock = document.createElement(ctx.block.tagName);
      const wrap = makeCb();
      newBlock.appendChild(wrap);
      newBlock.appendChild(document.createTextNode(' '));
      ctx.block.after(newBlock);
      const range = document.createRange();
      range.setStart(newBlock, newBlock.childNodes.length);
      range.collapse(true);
      setCaret(range);
      return;
    }

    const s = sel();
    if (!s) return;
    const range = s.getRangeAt(0);
    const br = document.createElement('br');
    range.deleteContents();
    range.insertNode(br);
    range.setStartAfter(br);
    range.collapse(true);
    const wrap = makeCb();
    range.insertNode(wrap);
    const space = document.createTextNode(' ');
    const r2 = document.createRange();
    r2.setStartAfter(wrap);
    r2.collapse(true);
    r2.insertNode(space);
    r2.setStartAfter(space);
    r2.setEndAfter(space);
    setCaret(r2);
  }

  function insertPlainLine(editor, ctx) {
    const removal = removeLeadingCheckbox(ctx);
    if (!removal) return false;

    if (ctx.mode === 'block') {
      const block = ctx.block;
      if (!block.textContent.replace(/\u200B/g, '').trim()) {
        block.innerHTML = '';
        block.appendChild(document.createElement('br'));
      }
      const range = document.createRange();
      range.setStart(block, 0);
      range.collapse(true);
      setCaret(range);
    } else {
      const range = document.createRange();
      if (removal.next && removal.next.nodeName === 'BR') {
        range.setStartAfter(removal.next);
      } else if (removal.next) {
        range.setStartBefore(removal.next);
      } else if (removal.parent) {
        range.selectNodeContents(removal.parent);
        range.collapse(false);
      } else {
        range.selectNodeContents(editor);
        range.collapse(false);
      }
      const br = document.createElement('br');
      range.insertNode(br);
      setCaret(br);
    }
    return true;
  }

  function deleteAdjacentCheckbox(editor, ctx, direction /* 'back' | 'del' */) {
    const s = sel();
    if (!s) return false;
    const range = s.getRangeAt(0);
    if (!range.collapsed) return false;

    if (direction === 'back' && ctx.caretAtStart && startsWithCheckbox(ctx)) {
      const removal = removeLeadingCheckbox(ctx);
      if (!removal) return false;
      if (ctx.mode === 'block') {
        const block = ctx.block;
        if (!block.textContent.replace(/\u200B/g, '').trim()) {
          block.innerHTML = '';
          block.appendChild(document.createElement('br'));
        }
        const caretRange = document.createRange();
        caretRange.setStart(block, 0);
        caretRange.collapse(true);
        setCaret(caretRange);
      } else {
        const caretRange = document.createRange();
        if (removal.next) {
          caretRange.setStartBefore(removal.next);
        } else if (removal.parent) {
          caretRange.selectNodeContents(removal.parent);
          caretRange.collapse(false);
        } else {
          caretRange.selectNodeContents(editor);
          caretRange.collapse(false);
        }
        setCaret(caretRange);
      }
      return true;
    }

    const checkNeighbor = (candidate) => {
      if (!candidate) return false;
      if (candidate.nodeType === 3 && !candidate.textContent.replace(/\u200B/g, '').trim()) {
        const nextCandidate = direction === 'back' ? candidate.previousSibling : candidate.nextSibling;
        if (nextCandidate && (isCbWrap(nextCandidate) || isCheckboxEl(nextCandidate))) {
          candidate.remove();
          return removeNode(nextCandidate);
        }
      }
      if (isCbWrap(candidate) || isCheckboxEl(candidate)) {
        return removeNode(candidate);
      }
      return false;
    };

    function removeNode(node) {
      const sibling = direction === 'back' ? node.previousSibling : node.nextSibling;
      node.remove();
      if (sibling && sibling.nodeType === 3 && !sibling.textContent.replace(/\u200B/g, '').trim()) {
        sibling.remove();
      }
      return true;
    }

    if (ctx.mode === 'block') {
      let container = range.startContainer;
      while (container && container.parentNode !== ctx.block) container = container.parentNode;
      if (!container) container = ctx.block;
      if (direction === 'back') {
        if (range.startContainer.nodeType === 3 && range.startOffset > 0) return false;
        return checkNeighbor(container.previousSibling);
      }
      if (
        range.startContainer.nodeType === 3 &&
        range.startOffset < range.startContainer.textContent.length
      )
        return false;
      return checkNeighbor(container.nextSibling);
    }

    let container = range.startContainer;
    while (container && container.parentNode !== editor) container = container.parentNode;
    if (!container) return false;
    if (direction === 'back') {
      if (range.startContainer.nodeType === 3 && range.startOffset > 0) return false;
      return checkNeighbor(container.previousSibling);
    }
    if (
      range.startContainer.nodeType === 3 &&
      range.startOffset < range.startContainer.textContent.length
    )
      return false;
    return checkNeighbor(container.nextSibling);
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
    return deleteAdjacentCheckbox(editor, ctx, 'back');
  }

  function onDeleteForward(editor) {
    const ctx = getLineCtx(editor);
    if (!ctx) return false;
    return deleteAdjacentCheckbox(editor, ctx, 'del');
  }

  window.setupChecklistEditor = function (editor, insertBtn) {
    if (!editor || editor.__cbInstalled) return;
    editor.__cbInstalled = true;

    editor.addEventListener(
      'beforeinput',
      (e) => {
        if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
          if (onInsertParagraph(editor)) e.preventDefault();
        } else if (e.inputType === 'deleteContentBackward') {
          if (onDeleteBackward(editor)) e.preventDefault();
        } else if (e.inputType === 'deleteContentForward') {
          if (onDeleteForward(editor)) e.preventDefault();
        }
      },
      { capture: true },
    );

    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (onInsertParagraph(editor)) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'Backspace') {
        if (onDeleteBackward(editor)) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'Delete') {
        if (onDeleteForward(editor)) {
          e.preventDefault();
        }
      }
    });

    if (insertBtn) {
      insertBtn.addEventListener('click', () => {
        editor.focus();
        const s = sel();
        if (!s) return;
        const range = s.getRangeAt(0);
        const node = makeCb();
        range.deleteContents();
        range.insertNode(node);
        const space = document.createTextNode(' ');
        const after = document.createRange();
        after.setStartAfter(node);
        after.collapse(true);
        after.insertNode(space);
        after.setStartAfter(space);
        after.setEndAfter(space);
        s.removeAllRanges();
        s.addRange(after);
      });
    }
  };

  if (typeof window !== 'undefined') {
    window.setupCheckboxListBehavior = window.setupChecklistEditor;
  }
})();
