/* editor-checkboxes.js
   Comportement "liste à puces" pour les cases à cocher dans un contenteditable :
   - Enter sur ligne "case + texte"  -> nouvelle case à la ligne suivante
   - Enter sur ligne "case seule"    -> sortie du mode case (ligne normale)
   - Backspace au tout début         -> retire la case (comme enlever la puce)
   - Backspace/Suppr près d’une case -> supprime la case
   Gère **à la fois** les éditeurs qui créent des <div>/<p> par ligne ET ceux qui utilisent <br>.
*/
(function () {
  function isCbWrap(n) { return !!(n && n.nodeType === 1 && n.classList.contains('cb-wrap')); }
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
  function getSel() {
    const s = window.getSelection();
    return (s && s.rangeCount) ? s : null;
  }
  function firstNonEmptyChild(node) {
    let c = node.firstChild;
    while (c && ((c.nodeType === 3 && !c.textContent.trim()) || (c.nodeType === 1 && c.tagName === 'BR'))) c = c.nextSibling;
    return c;
  }
  function getLineContext(editor) {
    const s = getSel(); if (!s) return null;
    const r = s.getRangeAt(0);
    // remonter jusqu’à un enfant direct de l’éditeur
    let node = r.startContainer;
    while (node && node.parentNode !== editor) node = node.parentNode;
    if (!node) return null;

    // Cas A: l’éditeur a des blocs (<div>/<p>/<li>) comme enfants
    if (node.nodeType === 1 && node.parentNode === editor &&
        /^(DIV|P|LI)$/i.test(node.tagName)) {
      const block = node;
      return {
        mode: 'block',
        block,
        first: firstNonEmptyChild(block),
        caretAtBlockStart: (() => {
          const a = r.startContainer, o = r.startOffset;
          if (!r.collapsed) return false;
          // si caret dans un texte non au début -> pas début
          if (a.nodeType === 3 && o > 0) return false;
          // début si le container "logique" est le 1er contenu éditable du block
          const first = firstNonEmptyChild(block);
          let cur = a;
          while (cur && cur.parentNode !== block) cur = cur.parentNode;
          return cur === first || cur === block;
        })()
      };
    }

    // Cas B: lignes au fil des siblings séparées par <br>
    // trouver le <br> précédent
    let prev = node.previousSibling;
    while (prev && prev.nodeName !== 'BR') prev = prev.previousSibling;
    let first = prev ? prev.nextSibling : editor.firstChild;
    while (first && first.nodeType === 3 && !first.textContent.trim()) first = first.nextSibling;

    // caret au tout début ? (pas de texte avant dans le nœud)
    const caretAtStart = r.collapsed && !(r.startContainer.nodeType === 3 && r.startOffset > 0);

    return { mode: 'inline', first, node, caretAtStart };
  }

  function lineStartsWithCb(ctx) {
    if (!ctx) return false;
    if (ctx.mode === 'block') return isCbWrap(ctx.first);
    return isCbWrap(ctx.first);
  }

  function lineEmptyAfterCb(editor, ctx) {
    if (!ctx) return false;
    if (!lineStartsWithCb(ctx)) return false;

    function hasMeaningfulAfter(start, untilNode /*only for inline*/) {
      let n = start.nextSibling, empty = true;
      while (n && n !== editor) {
        if (n.nodeName === 'BR') break;
        if ((n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && !isCbWrap(n) && n.textContent.trim())) { empty = false; break; }
        n = n.nextSibling;
      }
      return !empty;
    }

    if (ctx.mode === 'block') {
      let n = ctx.first.nextSibling, empty = true;
      while (n) {
        if ((n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && !isCbWrap(n) && n.textContent.trim())) { empty = false; break; }
        n = n.nextSibling;
      }
      return empty;
    }
    // inline
    return !hasMeaningfulAfter(ctx.first);
  }

  function insertPlainBreak(editor) {
    const s = getSel(); if (!s) return;
    const r = s.getRangeAt(0);

    // En mode block : insérer **un nouveau block vide** après
    const ctx = getLineContext(editor);
    if (ctx && ctx.mode === 'block') {
      const newBlock = document.createElement(ctx.block.tagName);
      newBlock.appendChild(document.createElement('br')); // ligne vraiment vide
      ctx.block.after(newBlock);
      const nr = document.createRange();
      nr.setStart(newBlock, 0); nr.collapse(true);
      s.removeAllRanges(); s.addRange(nr);
      return;
    }

    // Mode inline : juste <br>
    const br = document.createElement('br');
    r.deleteContents(); r.insertNode(br);
    r.setStartAfter(br); r.setEndAfter(br);
    s.removeAllRanges(); s.addRange(r);
  }

  function insertBreakWithCb(editor) {
    const s = getSel(); if (!s) return;
    const r = s.getRangeAt(0);
    const ctx = getLineContext(editor);

    if (ctx && ctx.mode === 'block') {
      const newBlock = document.createElement(ctx.block.tagName);
      const wrap = makeCb();
      newBlock.appendChild(wrap);
      newBlock.appendChild(document.createTextNode(' '));
      ctx.block.after(newBlock);
      const nr = document.createRange();
      nr.setStart(newBlock, newBlock.childNodes.length);
      nr.collapse(true);
      s.removeAllRanges(); s.addRange(nr);
      return;
    }

    // inline
    const br = document.createElement('br');
    r.deleteContents(); r.insertNode(br);
    r.setStartAfter(br); r.collapse(true);
    const wrap = makeCb(); r.insertNode(wrap);
    const space = document.createTextNode(' ');
    const r2 = document.createRange(); r2.setStartAfter(wrap); r2.collapse(true); r2.insertNode(space);
    r2.setStartAfter(space); r2.setEndAfter(space);
    s.removeAllRanges(); s.addRange(r2);
  }

  function removeLeadingCb(editor, ctx) {
    // "Backspace au tout début" sur une ligne checkbox : on enlève la puce
    if (!ctx) return false;
    if (!lineStartsWithCb(ctx)) return false;

    if (ctx.mode === 'block') {
      const space = ctx.first.nextSibling;
      if (space && space.nodeType === 3 && /^\s$/.test(space.textContent)) space.remove();
      ctx.first.remove();
      return true;
    }
    // inline
    const space = ctx.first.nextSibling;
    if (space && space.nodeType === 3 && /^\s$/.test(space.textContent)) space.remove();
    ctx.first.remove();
    return true;
  }

  function deleteAdjacentCb(editor, direction) {
    const s = getSel(); if (!s) return false;
    const r = s.getRangeAt(0); if (!r.collapsed) return false;

    const ctx = getLineContext(editor);
    if (!ctx) return false;

    // 1) début de ligne -> retirer la "puce" (exactement comme une <li> vide)
    if (direction === 'back') {
      if ((ctx.mode === 'block' && ctx.caretAtBlockStart && lineStartsWithCb(ctx)) ||
          (ctx.mode === 'inline' && ctx.caretAtStart && lineStartsWithCb(ctx))) {
        return removeLeadingCb(editor, ctx);
      }
    }

    // 2) sinon, supprimer la cb voisine
    let container;
    if (ctx.mode === 'block') {
      // limiter la recherche aux enfants du block
      let n = r.startContainer;
      while (n && n.parentNode !== ctx.block) n = n.parentNode;
      container = n || ctx.block;
      if (direction === 'back') {
        // si texte avec offset>0 -> ne rien faire
        if (r.startContainer.nodeType === 3 && r.startOffset > 0) return false;
        let t = container.previousSibling;
        if (t && t.nodeType === 3 && /^\s$/.test(t.textContent)) { const x = t.previousSibling; if (isCbWrap(x)) { t.remove(); t = x; } }
        if (isCbWrap(t)) { const nb = t.previousSibling; if (nb && nb.nodeType === 3 && /^\s$/.test(nb.textContent)) nb.remove(); t.remove(); return true; }
      } else {
        if (r.startContainer.nodeType === 3 && r.startOffset < r.startContainer.textContent.length) return false;
        let t = container.nextSibling;
        if (t && t.nodeType === 3 && /^\s$/.test(t.textContent)) { const x = t.nextSibling; if (isCbWrap(x)) { t.remove(); t = x; } }
        if (isCbWrap(t)) { const nb = t.nextSibling; if (nb && nb.nodeType === 3 && /^\s$/.test(nb.textContent)) nb.remove(); t.remove(); return true; }
      }
      return false;
    }

    // inline
    let node = r.startContainer;
    while (node && node.parentNode !== editor) node = node.parentNode;
    if (!node) return false;

    if (direction === 'back') {
      if (r.startContainer.nodeType === 3 && r.startOffset > 0) return false;
      let t = node.previousSibling;
      if (t && t.nodeType === 3 && /^\s$/.test(t.textContent)) { const x = t.previousSibling; if (isCbWrap(x)) { t.remove(); t = x; } }
      if (isCbWrap(t)) { const nb = t.previousSibling; if (nb && nb.nodeType === 3 && /^\s$/.test(nb.textContent)) nb.remove(); t.remove(); return true; }
    } else {
      if (r.startContainer.nodeType === 3 &&
          r.startOffset < r.startContainer.textContent.length) return false;
      let t = node.nextSibling;
      if (t && t.nodeType === 3 && /^\s$/.test(t.textContent)) { const x = t.nextSibling; if (isCbWrap(x)) { t.remove(); t = x; } }
      if (isCbWrap(t)) { const nb = t.nextSibling; if (nb && nb.nodeType === 3 && /^\s$/.test(nb.textContent)) nb.remove(); t.remove(); return true; }
    }
    return false;
  }

  function insertCheckboxAtCaret(editor) {
    const s = getSel(); if (!s) return;
    const r = s.getRangeAt(0);
    const ctx = getLineContext(editor);

    if (ctx && ctx.mode === 'block') {
      const node = makeCb();
      r.deleteContents(); r.insertNode(node);
      const space = document.createTextNode(' ');
      const r2 = document.createRange();
      r2.setStartAfter(node); r2.collapse(true); r2.insertNode(space);
      r2.setStartAfter(space); r2.setEndAfter(space);
      s.removeAllRanges(); s.addRange(r2);
      return;
    }

    const node = makeCb();
    r.deleteContents(); r.insertNode(node);
    const space = document.createTextNode(' ');
    const r2 = document.createRange();
    r2.setStartAfter(node); r2.collapse(true); r2.insertNode(space);
    r2.setStartAfter(space); r2.setEndAfter(space);
    s.removeAllRanges(); s.addRange(r2);
  }

  window.setupCheckboxListBehavior = function (editor, insertBtn) {
    if (!editor || editor.__cbInstalled) return;
    editor.__cbInstalled = true;

    // Enter / Backspace / Delete
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const ctx = getLineContext(editor);
        if (!ctx || !lineStartsWithCb(ctx)) return; // ligne normale -> natif
        e.preventDefault();
        if (lineEmptyAfterCb(editor, ctx)) insertPlainBreak(editor); // item vide -> sortir
        else insertBreakWithCb(editor);                               // sinon -> nouvelle case
      }
      if (e.key === 'Backspace') {
        if (deleteAdjacentCb(editor, 'back')) e.preventDefault();
      }
      if (e.key === 'Delete') {
        if (deleteAdjacentCb(editor, 'del')) e.preventDefault();
      }
    });

    // bouton “☐” si fourni
    if (insertBtn) {
      insertBtn.addEventListener('click', () => {
        editor.focus();
        insertCheckboxAtCaret(editor);
      });
    }
  };
})();
