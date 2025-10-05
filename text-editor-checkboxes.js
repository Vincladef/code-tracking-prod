/* text-editor-checkboxes.js
   Cases à cocher qui se comportent comme une liste à puces dans un contenteditable :
   - Enter sur "case + texte"  -> insère une nouvelle case à la ligne suivante
   - Enter sur "case seule"    -> sort du "mode case" (ligne normale)
   - Backspace/Suppr           -> supprime la puce (et l'espace adjacent)
   Compatible lignes en <div>/<p> et en <br>. Reconnaît:
     - <span class="cb-wrap"><input type="checkbox"></span>
     - <input type="checkbox"> nue
*/
(function () {
  const Sel = () => (window.getSelection()?.rangeCount ? window.getSelection() : null);

  const isCbWrap = (n) =>
    !!(
      n &&
      n.nodeType === 1 &&
      (
        n.classList.contains('cb-wrap') ||
        (typeof n.getAttribute === 'function' && n.getAttribute('data-rich-checkbox-wrapper') === '1')
      )
    );
  const isCbInput = n => !!(n && n.nodeType === 1 && n.tagName === 'INPUT' && n.type === 'checkbox');

  function isReallyEmptyText(t) {
    return !/[^\s\u00A0\u200B\uFEFF]/.test(t || '');
  }

  function cbRoot(node) {
    if (!node) return null;
    if (isCbWrap(node)) return node;
    if (isCbInput(node)) {
      const wrap = node.closest('.cb-wrap, [data-rich-checkbox-wrapper="1"]');
      return wrap || node;                   // accepte l'INPUT nue
    }
    if (node.nodeType === 1 && node.closest('.cb-wrap, [data-rich-checkbox-wrapper="1"]')) {
      return node.closest('.cb-wrap, [data-rich-checkbox-wrapper="1"]');
    }
    return null;
  }

  function makeCbWrap(existingInput) {
    const wrap = document.createElement('span');
    wrap.classList.add('cb-wrap');
    wrap.setAttribute('data-rich-checkbox-wrapper', '1');
    wrap.setAttribute('contenteditable', 'false');
    wrap.contentEditable = 'false';
    const cb = existingInput && isCbInput(existingInput) ? existingInput : document.createElement('input');
    cb.setAttribute('type', 'checkbox');
    cb.type = 'checkbox';
    cb.setAttribute('data-rich-checkbox', '1');
    cb.setAttribute('tabindex', '-1');
    cb.tabIndex = -1;
    cb.setAttribute('contenteditable', 'false');
    cb.contentEditable = 'false';
    wrap.appendChild(cb);
    return wrap;
  }

  function normalizeCheckbox(input) {
    if (!isCbInput(input)) return null;
    let wrap = input.closest('.cb-wrap, [data-rich-checkbox-wrapper="1"]');
    if (!wrap) {
      const parent = input.parentNode;
      const next = input.nextSibling;
      wrap = makeCbWrap(input);
      if (parent) parent.insertBefore(wrap, next);
    } else {
      wrap.classList.add('cb-wrap');
      wrap.setAttribute('data-rich-checkbox-wrapper', '1');
      wrap.setAttribute('contenteditable', 'false');
      wrap.contentEditable = 'false';
      if (!wrap.contains(input)) wrap.appendChild(input);
    }
    input.setAttribute('type', 'checkbox');
    input.type = 'checkbox';
    input.setAttribute('data-rich-checkbox', '1');
    input.setAttribute('tabindex', '-1');
    input.tabIndex = -1;
    input.setAttribute('contenteditable', 'false');
    input.contentEditable = 'false';
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
        wrap.after(document.createTextNode(' '));
      } else if (!next.textContent) {
        next.textContent = ' ';
      }
    });
  }

  function firstNonEmpty(node) {
    let c = node.firstChild;
    while (c && ((c.nodeType === 3 && !c.textContent.trim()) || (c.nodeType === 1 && c.tagName === 'BR'))) c = c.nextSibling;
    return c;
  }

  function getLineContext(editor) {
    const s = Sel(); if (!s) return null;
    const r = s.getRangeAt(0);
    // remonte à un enfant direct du contenteditable
    let node = r.startContainer;
    while (node && node.parentNode !== editor) node = node.parentNode;
    if (!node) return null;

    // Mode "block" (Chrome/Safari créent des <div>/<p>)
    if (node.nodeType === 1 && node.parentNode === editor && /^(DIV|P|LI)$/i.test(node.tagName)) {
      const block = node;
      let cur = r.startContainer; while (cur && cur.parentNode !== block) cur = cur.parentNode;
      const first = firstNonEmpty(block);
      const caretAtStart = r.collapsed && !(r.startContainer.nodeType === 3 && r.startOffset > 0) &&
                           (cur === first || cur === block);
      return { mode: 'block', block, first, caretAtStart, caretNode: cur || block };
    }

    // Mode "inline" (séparé par <br>)
    let prev = node.previousSibling; while (prev && prev.nodeName !== 'BR') prev = prev.previousSibling;
    let first = prev ? prev.nextSibling : editor.firstChild;
    while (first && first.nodeType === 3 && !first.textContent.trim()) first = first.nextSibling;
    const caretAtStart = r.collapsed && !(r.startContainer.nodeType === 3 && r.startOffset > 0);
    return { mode: 'inline', first, node, caretAtStart };
  }

  function lineStartsWithCb(ctx) {
    return !!cbRoot(ctx?.first);
  }

  function lineEmptyAfterCb(editor, ctx) {
    if (!ctx) return false;

    const first = (ctx.first?.closest?.('.cb-wrap')) || ctx.first;
    const isCb = first && (
      (first.nodeType === 1 && first.classList?.contains('cb-wrap')) ||
      (first.nodeType === 1 && first.tagName === 'INPUT' && first.type === 'checkbox')
    );
    if (!isCb) return false;

    let n = first.nextSibling, empty = true;
    while (n && (ctx.mode === 'inline' ? n !== editor : true)) {
      if (ctx.mode === 'inline' && n.nodeName === 'BR') break;
      if (n.nodeType === 3 && !isReallyEmptyText(n.textContent)) { empty = false; break; }
      if (n.nodeType === 1) {
        if (n.tagName === 'BR' || (n.classList && n.classList.contains('cb-wrap')) || isReallyEmptyText(n.textContent)) {
          // ignorer
        } else { empty = false; break; }
      }
      n = n.nextSibling;
    }
    return empty;
  }

  function insertPlainBreak(editor) {
    const s = Sel(); if (!s) return;
    const r = s.getRangeAt(0);
    const ctx = getLineContext(editor);

    if (ctx && ctx.mode === 'block') {
      const nb = document.createElement(ctx.block.tagName);
      nb.appendChild(document.createElement('br'));
      ctx.block.after(nb);
      const nr = document.createRange(); nr.setStart(nb, 0); nr.collapse(true);
      s.removeAllRanges(); s.addRange(nr);
      return;
    }

    const br = document.createElement('br');
    r.deleteContents(); r.insertNode(br);
    r.setStartAfter(br); r.setEndAfter(br);
    s.removeAllRanges(); s.addRange(r);
  }

  function insertBreakWithCheckbox(editor) {
    const s = Sel(); if (!s) return;
    const r = s.getRangeAt(0);
    const ctx = getLineContext(editor);

    if (ctx && ctx.mode === 'block') {
      const nb = document.createElement(ctx.block.tagName);
      const wrap = makeCbWrap();
      nb.appendChild(wrap);
      nb.appendChild(document.createTextNode(' '));
      ctx.block.after(nb);
      const nr = document.createRange(); nr.setStart(nb, nb.childNodes.length); nr.collapse(true);
      s.removeAllRanges(); s.addRange(nr);
      return;
    }

    const br = document.createElement('br');
    r.deleteContents(); r.insertNode(br);
    r.setStartAfter(br); r.collapse(true);
    const wrap = makeCbWrap();
    r.insertNode(wrap);
    const space = document.createTextNode(' ');
    const r2 = document.createRange(); r2.setStartAfter(wrap); r2.collapse(true); r2.insertNode(space);
    r2.setStartAfter(space); r2.setEndAfter(space);
    s.removeAllRanges(); s.addRange(r2);
  }

  function removeLeadingCb(editor, ctx) {
    if (!lineStartsWithCb(ctx)) return false;
    const first = cbRoot(ctx.first);
    if (!first) return false;
    const space = first.nextSibling;
    if (space && space.nodeType === 3 && isReallyEmptyText(space.textContent)) space.remove();
    first.remove();
    return true;
  }

  function removeLeadingCbAndKeepSameLine(editor, ctx) {
    const first = (ctx.first?.closest?.('.cb-wrap')) || ctx.first;
    if (!first) return;

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
    if (!sel) return;
    const r = document.createRange();

    if (ctx.mode === 'block') {
      let caretNode = null;
      if (!ctx.block.textContent || isReallyEmptyText(ctx.block.textContent)) {
        while (ctx.block.firstChild) ctx.block.removeChild(ctx.block.firstChild);
        caretNode = document.createTextNode('');
        ctx.block.appendChild(caretNode);
      } else {
        caretNode = ctx.block.lastChild;
        if (!caretNode || caretNode.nodeType !== 3) {
          caretNode = document.createTextNode('');
          ctx.block.appendChild(caretNode);
        }
      }
      r.setStart(caretNode, caretNode.textContent.length);
    } else {
      let caretNode = null;
      if (anchor && anchor.parentNode === editor) {
        if (anchor.nodeType === 3) {
          caretNode = anchor;
        } else {
          caretNode = document.createTextNode('');
          editor.insertBefore(caretNode, anchor);
        }
      } else {
        caretNode = document.createTextNode('');
        editor.appendChild(caretNode);
      }
      r.setStart(caretNode, 0);
    }
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function deleteAdjacentCb(editor, direction) {
    const s = Sel(); if (!s) return false;
    const r = s.getRangeAt(0); if (!r.collapsed) return false;
    const ctx = getLineContext(editor); if (!ctx) return false;

    // Backspace au tout début d’une ligne "checkbox" -> enlève la puce
    if (direction === 'back') {
      const atStart = (ctx.mode === 'block') ? (ctx.caretAtStart && lineStartsWithCb(ctx))
                                             : (ctx.caretAtStart && lineStartsWithCb(ctx));
      if (atStart) return removeLeadingCb(editor, ctx);
    }

    // sinon, suppression de la case voisine
    function kill(node, prevNext) {
      const root = cbRoot(node);
      if (!root) return false;
      const nb = root[prevNext];
      if (nb && nb.nodeType === 3 && isReallyEmptyText(nb.textContent)) nb.remove();
      root.remove();
      return true;
    }

    if (ctx.mode === 'block') {
      let cont = r.startContainer; while (cont && cont.parentNode !== ctx.block) cont = cont.parentNode;
      cont = cont || ctx.block;
      if (direction === 'back') {
        if (r.startContainer.nodeType === 3 && r.startOffset > 0) return false;
        let t = cont.previousSibling;
        if (t && t.nodeType === 3 && isReallyEmptyText(t.textContent)) { const x = t.previousSibling; if (cbRoot(x)) { t.remove(); t = x; } }
        return kill(t, 'previousSibling');
      } else {
        if (r.startContainer.nodeType === 3 && r.startOffset < r.startContainer.textContent.length) return false;
        let t = cont.nextSibling;
        if (t && t.nodeType === 3 && isReallyEmptyText(t.textContent)) { const x = t.nextSibling; if (cbRoot(x)) { t.remove(); t = x; } }
        return kill(t, 'nextSibling');
      }
    }

    // inline
    let node = r.startContainer; while (node && node.parentNode !== editor) node = node.parentNode;
    if (!node) return false;
    if (direction === 'back') {
      if (r.startContainer.nodeType === 3 && r.startOffset > 0) return false;
      let t = node.previousSibling;
      if (t && t.nodeType === 3 && isReallyEmptyText(t.textContent)) { const x = t.previousSibling; if (cbRoot(x)) { t.remove(); t = x; } }
      return kill(t, 'previousSibling');
    } else {
      if (r.startContainer.nodeType === 3 && r.startOffset < r.startContainer.textContent.length) return false;
      let t = node.nextSibling;
      if (t && t.nodeType === 3 && isReallyEmptyText(t.textContent)) { const x = t.nextSibling; if (cbRoot(x)) { t.remove(); t = x; } }
      return kill(t, 'nextSibling');
    }
  }

  // API globale
  function insertCheckboxAtCaret(editorEl) {
    const s = Sel();
    if (!s) return;
    const r = s.getRangeAt(0);
    const w = makeCbWrap();
    r.deleteContents();
    r.insertNode(w);
    const sp = document.createTextNode(' ');
    const r2 = document.createRange();
    r2.setStartAfter(w);
    r2.collapse(true);
    r2.insertNode(sp);
    r2.setStartAfter(sp);
    r2.setEndAfter(sp);
    s.removeAllRanges();
    s.addRange(r2);
  }

  window.setupCheckboxLikeBullets = function (editorEl, insertBtnEl) {
    if (!editorEl || editorEl.__cbInstalled) return;
    editorEl.__cbInstalled = true;

    normalizeCheckboxes(editorEl);

    let normalizeScheduled = false;
    const scheduleNormalize = () => {
      if (normalizeScheduled) return;
      normalizeScheduled = true;
      const raf = window.requestAnimationFrame || ((cb) => window.setTimeout(cb, 16));
      raf(() => {
        normalizeScheduled = false;
        normalizeCheckboxes(editorEl);
      });
    };

    editorEl.addEventListener('focus', scheduleNormalize);
    editorEl.addEventListener('input', scheduleNormalize);

    editorEl.addEventListener('keydown', (e) => {
      normalizeCheckboxes(editorEl);
      if (e.key === 'Enter') {
        const ctx = getLineContext(editorEl);
        if (!ctx) return;
        if (!lineStartsWithCb(ctx)) return;
        e.preventDefault();
        e.stopPropagation();
        if (lineEmptyAfterCb(editorEl, ctx)) {
          e.stopImmediatePropagation();
          removeLeadingCbAndKeepSameLine(editorEl, ctx);
          return;
        }
        insertBreakWithCheckbox(editorEl);
        return;
      }
      if (e.key === 'Backspace') {
        if (deleteAdjacentCb(editorEl, 'back')) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
      if (e.key === 'Delete') {
        if (deleteAdjacentCb(editorEl, 'del')) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    });

    if (insertBtnEl) {
      insertBtnEl.addEventListener('click', () => {
        editorEl.focus();
        let s = Sel();
        if (!s) return;
        if (!editorEl.contains(s.anchorNode)) {
          const range = document.createRange();
          range.selectNodeContents(editorEl);
          range.collapse(false);
          s.removeAllRanges();
          s.addRange(range);
        }
        insertCheckboxAtCaret(editorEl);
        editorEl.focus();
      });
    }
  };

  window.getLineContext = getLineContext;
})();
