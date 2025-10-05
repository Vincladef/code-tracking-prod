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

  const isCbWrap = n => !!(n && n.nodeType === 1 && n.classList.contains('cb-wrap'));
  const isCbInput = n => !!(n && n.nodeType === 1 && n.tagName === 'INPUT' && n.type === 'checkbox');

  function cbRoot(node) {
    if (!node) return null;
    if (isCbWrap(node)) return node;
    if (isCbInput(node)) return node;                   // accepte l'INPUT nue
    if (node.nodeType === 1 && node.closest('.cb-wrap')) return node.closest('.cb-wrap');
    return null;
  }

  function makeCbWrap() {
    const wrap = document.createElement('span');
    wrap.className = 'cb-wrap';
    wrap.contentEditable = 'false';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.tabIndex = -1;
    wrap.appendChild(cb);
    return wrap;
  }

  function firstNonEmpty(node) {
    let c = node.firstChild;
    while (c && ((c.nodeType === 3 && !c.textContent.trim()) || (c.nodeType === 1 && c.tagName === 'BR'))) c = c.nextSibling;
    return c;
  }

  function lineCtx(editor) {
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

  function startsWithCb(ctx) {
    return !!cbRoot(ctx?.first);
  }

  function emptyAfterCb(editor, ctx) {
    if (!startsWithCb(ctx)) return false;
    const first = cbRoot(ctx.first);
    if (ctx.mode === 'block') {
      let n = first.nextSibling, empty = true;
      while (n) {
        if ((n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && !cbRoot(n) && n.textContent.trim())) { empty = false; break; }
        n = n.nextSibling;
      }
      return empty;
    }
    // inline
    let n = first.nextSibling, empty = true;
    while (n && n !== editor) {
      if (n.nodeName === 'BR') break;
      if ((n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && !cbRoot(n) && n.textContent.trim())) { empty = false; break; }
      n = n.nextSibling;
    }
    return empty;
  }

  function insertPlainBreak(editor) {
    const s = Sel(); if (!s) return;
    const r = s.getRangeAt(0);
    const ctx = lineCtx(editor);

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
    const ctx = lineCtx(editor);

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
    if (!startsWithCb(ctx)) return false;
    const first = cbRoot(ctx.first);
    const space = first.nextSibling;
    if (space && space.nodeType === 3 && /^\s$/.test(space.textContent)) space.remove();
    first.remove();
    return true;
  }

  function deleteAdjacentCb(editor, direction) {
    const s = Sel(); if (!s) return false;
    const r = s.getRangeAt(0); if (!r.collapsed) return false;
    const ctx = lineCtx(editor); if (!ctx) return false;

    // Backspace au tout début d’une ligne "checkbox" -> enlève la puce
    if (direction === 'back') {
      const atStart = (ctx.mode === 'block') ? (ctx.caretAtStart && startsWithCb(ctx))
                                             : (ctx.caretAtStart && startsWithCb(ctx));
      if (atStart) return removeLeadingCb(editor, ctx);
    }

    // sinon, suppression de la case voisine
    function kill(node, prevNext) {
      const root = cbRoot(node);
      if (!root) return false;
      const nb = root[prevNext];
      if (nb && nb.nodeType === 3 && /^\s$/.test(nb.textContent)) nb.remove();
      root.remove();
      return true;
    }

    if (ctx.mode === 'block') {
      let cont = r.startContainer; while (cont && cont.parentNode !== ctx.block) cont = cont.parentNode;
      cont = cont || ctx.block;
      if (direction === 'back') {
        if (r.startContainer.nodeType === 3 && r.startOffset > 0) return false;
        let t = cont.previousSibling;
        if (t && t.nodeType === 3 && /^\s$/.test(t.textContent)) { const x = t.previousSibling; if (cbRoot(x)) { t.remove(); t = x; } }
        return kill(t, 'previousSibling');
      } else {
        if (r.startContainer.nodeType === 3 && r.startOffset < r.startContainer.textContent.length) return false;
        let t = cont.nextSibling;
        if (t && t.nodeType === 3 && /^\s$/.test(t.textContent)) { const x = t.nextSibling; if (cbRoot(x)) { t.remove(); t = x; } }
        return kill(t, 'nextSibling');
      }
    }

    // inline
    let node = r.startContainer; while (node && node.parentNode !== editor) node = node.parentNode;
    if (!node) return false;
    if (direction === 'back') {
      if (r.startContainer.nodeType === 3 && r.startOffset > 0) return false;
      let t = node.previousSibling;
      if (t && t.nodeType === 3 && /^\s$/.test(t.textContent)) { const x = t.previousSibling; if (cbRoot(x)) { t.remove(); t = x; } }
      return kill(t, 'previousSibling');
    } else {
      if (r.startContainer.nodeType === 3 && r.startOffset < r.startContainer.textContent.length) return false;
      let t = node.nextSibling;
      if (t && t.nodeType === 3 && /^\s$/.test(t.textContent)) { const x = t.nextSibling; if (cbRoot(x)) { t.remove(); t = x; } }
      return kill(t, 'nextSibling');
    }
  }

  // API globale
  window.setupCheckboxLikeBullets = function (editorEl, insertBtnEl) {
    if (!editorEl || editorEl.__cbInstalled) return;
    editorEl.__cbInstalled = true;

    editorEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const ctx = lineCtx(editorEl);
        if (!ctx || !startsWithCb(ctx)) return;
        e.preventDefault();
        emptyAfterCb(editorEl, ctx) ? insertPlainBreak(editorEl) : insertBreakWithCheckbox(editorEl);
      }
      if (e.key === 'Backspace') { if (deleteAdjacentCb(editorEl, 'back')) e.preventDefault(); }
      if (e.key === 'Delete')   { if (deleteAdjacentCb(editorEl, 'del'))  e.preventDefault(); }
    });

    if (insertBtnEl) {
      insertBtnEl.addEventListener('click', () => {
        editorEl.focus();
        const s = Sel(); if (!s) return;
        const r = s.getRangeAt(0);
        // on insère un wrap (plus robuste pour caret), mais l’algorithme acceptera aussi l’INPUT nue si tu en as déjà
        const w = makeCbWrap();
        r.deleteContents(); r.insertNode(w);
        const sp = document.createTextNode(' ');
        const r2 = document.createRange(); r2.setStartAfter(w); r2.collapse(true); r2.insertNode(sp);
        r2.setStartAfter(sp); r2.setEndAfter(sp);
        s.removeAllRanges(); s.addRange(r2);
      });
    }
  };
})();
