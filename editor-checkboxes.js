// editor-checkboxes.js
// Comportement "liste à puces" pour les checkboxes dans un contenteditable.

export function setupCheckboxListBehavior(editor, insertBtn) {
  if (!editor || editor.__cbInstalled) return;
  editor.__cbInstalled = true;

  // ---------- helpers ----------
  const isCb = n => !!(n && n.classList && n.classList.contains('cb-wrap'));

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

  function lineStartNode() {
    const s = sel(); if (!s) return null;
    const r = s.getRangeAt(0);
    let node = r.startContainer;
    while (node && node.parentNode !== editor) node = node.parentNode;
    if (!node) return null;
    let prev = node.previousSibling;
    while (prev && prev.nodeName !== 'BR') prev = prev.previousSibling;
    let first = prev ? prev.nextSibling : editor.firstChild;
    while (first && first.nodeType === 3 && !first.textContent.trim()) first = first.nextSibling;
    return first || null;
  }

  const lineStartsWithCb = () => isCb(lineStartNode());

  function lineEmptyAfterCb() {
    const first = lineStartNode();
    if (!isCb(first)) return false;
    let n = first.nextSibling;
    while (n && n !== editor) {
      if (n.nodeName === 'BR') break;
      if ((n.nodeType === 3 && n.textContent.trim()) ||
          (n.nodeType === 1 && !isCb(n) && n.textContent.trim())) return false;
      n = n.nextSibling;
    }
    return true;
  }

  function caretAtStartAfterCb() {
    const s = sel(); if (!s) return false;
    const r = s.getRangeAt(0);
    if (!r.collapsed) return false;
    const first = lineStartNode();
    if (!isCb(first)) return false;
    let node = r.startContainer, offset = r.startOffset;
    if (node.nodeType === 3 && offset > 0) return false;
    while (node && node.parentNode !== editor) node = node.parentNode;
    return node === first || node === first.nextSibling;
  }

  function insertPlainBr() {
    const s = sel(); if (!s) return;
    const r = s.getRangeAt(0);
    const br = document.createElement('br');
    r.deleteContents(); r.insertNode(br);
    r.setStartAfter(br); r.setEndAfter(br);
    s.removeAllRanges(); s.addRange(r);
  }

  function insertBrWithCb() {
    const s = sel(); if (!s) return;
    const r = s.getRangeAt(0);
    const br = document.createElement('br');
    r.deleteContents(); r.insertNode(br);
    r.setStartAfter(br); r.collapse(true);
    const wrap = makeCb(); r.insertNode(wrap);
    const space = document.createTextNode(' ');
    const r2 = document.createRange(); r2.setStartAfter(wrap); r2.collapse(true); r2.insertNode(space);
    r2.setStartAfter(space); r2.setEndAfter(space);
    s.removeAllRanges(); s.addRange(r2);
  }

  function deleteAdjCb(direction) {
    const s = sel(); if (!s) return false;
    const r = s.getRangeAt(0); if (!r.collapsed) return false;

    // Backspace au tout début d’une ligne “checkbox” → retirer la puce (exactement comme <li> vide)
    if (direction === 'back' && caretAtStartAfterCb()) {
      const first = lineStartNode();
      if (isCb(first)) {
        const space = first.nextSibling;
        if (space && space.nodeType === 3 && /^\s$/.test(space.textContent)) space.remove();
        first.remove();
        return true;
      }
    }

    // suppression de la cb voisine (avant / après)
    let node = r.startContainer;
    while (node && node.parentNode !== editor) node = node.parentNode;
    if (!node) return false;

    let target = null;
    if (direction === 'back') {
      if (r.startContainer.nodeType === 3 && r.startOffset > 0) return false;
      target = node.previousSibling;
      if (target && target.nodeType === 3 && /^\s$/.test(target.textContent)) {
        const t = target.previousSibling; if (isCb(t)) { target.remove(); target = t; }
      }
    } else {
      if (r.startContainer.nodeType === 3 &&
          r.startOffset < r.startContainer.textContent.length) return false;
      target = node.nextSibling;
      if (target && target.nodeType === 3 && /^\s$/.test(target.textContent)) {
        const t = target.nextSibling; if (isCb(t)) { target.remove(); target = t; }
      }
    }
    if (isCb(target)) {
      const neighbor = (direction === 'back') ? target.previousSibling : target.nextSibling;
      if (neighbor && neighbor.nodeType === 3 && /^\s$/.test(neighbor.textContent)) neighbor.remove();
      target.remove();
      return true;
    }
    return false;
  }

  // ---------- events ----------
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (!lineStartsWithCb()) return;           // ligne normale → comportement natif
      e.preventDefault();
      if (lineEmptyAfterCb()) insertPlainBr();   // item vide → sortir de la “liste”
      else insertBrWithCb();                     // sinon → nouvel item
    }
    if (e.key === 'Backspace') {
      if (deleteAdjCb('back')) e.preventDefault();
    }
    if (e.key === 'Delete') {
      if (deleteAdjCb('del')) e.preventDefault();
    }
  });

  if (insertBtn) {
    insertBtn.addEventListener('click', () => {
      editor.focus();
      const s = sel(); if (!s) return;
      const r = s.getRangeAt(0);
      const node = makeCb();
      r.deleteContents(); r.insertNode(node);
      const space = document.createTextNode(' ');
      const r2 = document.createRange(); r2.setStartAfter(node); r2.collapse(true); r2.insertNode(space);
      r2.setStartAfter(space); r2.setEndAfter(space);
      s.removeAllRanges(); s.addRange(r2);
    });
  }
}


