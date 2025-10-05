// editor-checkboxes.js
// Comportement "liste" pour les cases à cocher dans un contenteditable (#rt-editor).
// Drop-in: appelle setupCheckboxListBehavior(editorEl) après avoir créé/vidé l'éditeur.

export function setupCheckboxListBehavior(editor) {
  if (!editor || editor.__cbInstalled) return;
  editor.__cbInstalled = true;

  // ----- helpers
  function isCbWrap(node) {
    return !!(node && node.classList && node.classList.contains("cb-wrap"));
  }

  function makeCbWrap() {
    const wrap = document.createElement("span");
    wrap.className = "cb-wrap";
    wrap.contentEditable = "false";
    wrap.setAttribute("contenteditable", "false");
    wrap.setAttribute("data-rich-checkbox-wrapper", "1");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.tabIndex = -1;
    cb.setAttribute("tabindex", "-1");
    cb.setAttribute("type", "checkbox");
    cb.setAttribute("data-rich-checkbox", "1");
    cb.setAttribute("contenteditable", "false");
    cb.contentEditable = "false";
    wrap.appendChild(cb);
    return wrap;
  }

  function getSel() {
    const s = window.getSelection();
    return s && s.rangeCount ? s : null;
  }

  function lineStartNode() {
    const sel = getSel();
    if (!sel) return null;
    const r = sel.getRangeAt(0);
    let node = r.startContainer;
    // remonter jusqu'à enfant direct de l'éditeur
    while (node && node.parentNode !== editor) node = node.parentNode;
    if (!node) return null;
    // chercher le <br> précédent
    let prev = node.previousSibling;
    while (prev && prev.nodeName !== "BR") prev = prev.previousSibling;
    // premier nœud de la ligne
    let first = prev ? prev.nextSibling : editor.firstChild;
    // ignorer textes vides
    while (first && first.nodeType === 3 && !first.textContent.trim()) first = first.nextSibling;
    return first || null;
  }

  function lineStartsWithCb() {
    const first = lineStartNode();
    return isCbWrap(first);
  }

  function lineEmptyAfterCb() {
    const first = lineStartNode();
    if (!isCbWrap(first)) return false;
    let n = first.nextSibling;
    while (n && n !== editor) {
      if (n.nodeName === "BR") break;
      if (
        (n.nodeType === 3 && n.textContent.trim()) ||
        (n.nodeType === 1 && !isCbWrap(n) && n.textContent.trim())
      )
        return false;
      n = n.nextSibling;
    }
    return true;
  }

  function insertPlainBr() {
    const sel = getSel();
    if (!sel) return;
    const r = sel.getRangeAt(0);
    const br = document.createElement("br");
    r.deleteContents();
    r.insertNode(br);
    r.setStartAfter(br);
    r.setEndAfter(br);
    sel.removeAllRanges();
    sel.addRange(r);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function insertBrWithCb() {
    const sel = getSel();
    if (!sel) return;
    const r = sel.getRangeAt(0);
    const br = document.createElement("br");
    r.deleteContents();
    r.insertNode(br);
    r.setStartAfter(br);
    r.collapse(true);
    const wrap = makeCbWrap();
    r.insertNode(wrap);
    const space = document.createTextNode(" ");
    const r2 = document.createRange();
    r2.setStartAfter(wrap);
    r2.collapse(true);
    r2.insertNode(space);
    r2.setStartAfter(space);
    r2.setEndAfter(space);
    sel.removeAllRanges();
    sel.addRange(r2);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function caretAtStartAfterCb() {
    const sel = getSel();
    if (!sel) return false;
    const r = sel.getRangeAt(0);
    if (!r.collapsed) return false;
    const first = lineStartNode();
    if (!isCbWrap(first)) return false;
    // On considère "début" si caret est sur le premier nœud éditable de la ligne avec offset 0
    let node = r.startContainer;
    const offset = r.startOffset;
    if (node.nodeType === 3 && offset > 0) return false;
    while (node && node.parentNode !== editor) node = node.parentNode;
    return node === first.nextSibling || node === first;
  }

  function deleteAdjacentCb(direction /* 'back' | 'del' */) {
    const sel = getSel();
    if (!sel) return false;
    const r = sel.getRangeAt(0);
    if (!r.collapsed) return false;

    // 1) Backspace tout début de ligne -> retirer la "puce" (cb-wrap)
    if (direction === "back" && caretAtStartAfterCb()) {
      const first = lineStartNode();
      if (isCbWrap(first)) {
        const space = first.nextSibling;
        if (space && space.nodeType === 3 && /^\s$/.test(space.textContent)) space.remove();
        first.remove();
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
    }

    // 2) sinon suppression de la cb voisine
    // se placer sur un enfant direct
    let node = r.startContainer;
    while (node && node.parentNode !== editor) node = node.parentNode;
    if (!node) return false;

    let target = null;
    if (direction === "back") {
      if (r.startContainer.nodeType === 3 && r.startOffset > 0) return false;
      target = node.previousSibling;
      if (target && target.nodeType === 3 && /^\s$/.test(target.textContent)) {
        const t = target.previousSibling;
        if (isCbWrap(t)) {
          target.remove();
          target = t;
        }
      }
    } else {
      if (
        r.startContainer.nodeType === 3 &&
        r.startOffset < r.startContainer.textContent.length
      )
        return false;
      target = node.nextSibling;
      if (target && target.nodeType === 3 && /^\s$/.test(target.textContent)) {
        const t = target.nextSibling;
        if (isCbWrap(t)) {
          target.remove();
          target = t;
        }
      }
    }
    if (isCbWrap(target)) {
      const neighbor = direction === "back" ? target.previousSibling : target.nextSibling;
      if (neighbor && neighbor.nodeType === 3 && /^\s$/.test(neighbor.textContent)) neighbor.remove();
      target.remove();
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    return false;
  }

  // ----- events
  editor.addEventListener("keydown", (e) => {
    // Enter : logique "liste"
    if (e.key === "Enter") {
      if (!lineStartsWithCb()) return; // ligne normale -> natif
      e.preventDefault();
      if (lineEmptyAfterCb()) insertPlainBr(); // item vide -> on sort
      else insertBrWithCb(); // sinon -> nouvel item
      return;
    }
    // Backspace / Delete : suppression de la puce
    if (e.key === "Backspace") {
      if (deleteAdjacentCb("back")) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Delete") {
      if (deleteAdjacentCb("del")) {
        e.preventDefault();
        return;
      }
    }
  });

  // Expose un inserteur public si tu as un bouton "☐"
  editor.insertCheckboxAtCaret = function insertCheckboxAtCaret() {
    const sel = getSel();
    if (!sel) return false;
    const r = sel.getRangeAt(0);
    const node = makeCbWrap();
    const space = document.createTextNode(" ");
    r.deleteContents();
    r.insertNode(node);
    const r2 = document.createRange();
    r2.setStartAfter(node);
    r2.collapse(true);
    r2.insertNode(space);
    r2.setStartAfter(space);
    r2.setEndAfter(space);
    sel.removeAllRanges();
    sel.addRange(r2);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  };
}

if (typeof window !== "undefined") {
  window.setupCheckboxListBehavior = setupCheckboxListBehavior;
  try {
    window.dispatchEvent(new Event("editor-checkboxes:ready"));
  } catch (error) {
    if (typeof document !== "undefined" && typeof document.createEvent === "function") {
      const evt = document.createEvent("Event");
      evt.initEvent("editor-checkboxes:ready", true, true);
      window.dispatchEvent(evt);
    }
  }
}

export default setupCheckboxListBehavior;
