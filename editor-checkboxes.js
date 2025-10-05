/* editor-checkboxes.js — cases à cocher = comportement "liste à puces"
   - Enter sur "case + texte"  -> nouvelle case
   - Enter sur "case seule"    -> sortir du mode case
   - Backspace au tout début   -> retire la "puce"
   - Backspace/Suppr adjacent  -> supprime la case
   Compatible éditeurs "en blocs" (<div>/<p>) ET "au <br>".
*/
(function () {
  function isCbWrap(n){return !!(n&&n.nodeType===1&&n.classList.contains('cb-wrap'));}

  function makeCb(){
    const wrap=document.createElement('span');wrap.className='cb-wrap';wrap.contentEditable='false';
    const cb=document.createElement('input');cb.type='checkbox';cb.tabIndex=-1;wrap.appendChild(cb);return wrap;
  }

  const sel=()=> (window.getSelection()?.rangeCount?window.getSelection():null);

  function firstNonEmptyChild(node){
    let c=node.firstChild;
    while(c && ((c.nodeType===3 && !c.textContent.trim()) || (c.nodeType===1 && c.tagName==='BR'))) c=c.nextSibling;
    return c;
  }

  function getLineContext(editor){
    const s=sel(); if(!s) return null;
    const r=s.getRangeAt(0);
    // remonter jusqu’à un ENFANT DIRECT de l’éditeur
    let node=r.startContainer;
    while(node && node.parentNode!==editor) node=node.parentNode;
    if(!node) return null;

    // Cas A: l’éditeur a des BLOCS (DIV/P/LI)
    if(node.nodeType===1 && node.parentNode===editor && /^(DIV|P|LI)$/i.test(node.tagName)){
      const block=node;
      const ctx={
        mode:'block',
        block,
        first:firstNonEmptyChild(block),
        caretAtBlockStart:(()=>{ if(!r.collapsed) return false;
          const a=r.startContainer,o=r.startOffset;
          if(a.nodeType===3 && o>0) return false;
          let cur=a; while(cur && cur.parentNode!==block) cur=cur.parentNode;
          const first=firstNonEmptyChild(block);
          return cur===first || cur===block;
        })()
      };
      ctx.caretNodeInBlock=(function(){let n=r.startContainer; while(n&&n.parentNode!==block) n=n.parentNode; return n||block;})();
      return ctx;
    }

    // Cas B: lignes séparées par <br>
    let prev=node.previousSibling; while(prev && prev.nodeName!=='BR') prev=prev.previousSibling;
    let first=prev?prev.nextSibling:editor.firstChild;
    while(first && first.nodeType===3 && !first.textContent.trim()) first=first.nextSibling;
    const caretAtStart=r.collapsed && !(r.startContainer.nodeType===3 && r.startOffset>0);
    return {mode:'inline', first, node, caretAtStart};
  }

  function lineStartsWithCb(ctx){ return !!(ctx && isCbWrap(ctx.first)); }

  function lineEmptyAfterCb(editor,ctx){
    if(!ctx || !lineStartsWithCb(ctx)) return false;
    if(ctx.mode==='block'){
      let n=ctx.first.nextSibling, empty=true;
      while(n){
        if((n.nodeType===3 && n.textContent.trim()) || (n.nodeType===1 && !isCbWrap(n) && n.textContent.trim())) {empty=false;break;}
        n=n.nextSibling;
      }
      return empty;
    }
    // inline
    let n=ctx.first.nextSibling, empty=true;
    while(n && n!==editor){
      if(n.nodeName==='BR') break;
      if((n.nodeType===3 && n.textContent.trim()) || (n.nodeType===1 && !isCbWrap(n) && n.textContent.trim())) {empty=false;break;}
      n=n.nextSibling;
    }
    return empty;
  }

  function insertPlainBreak(editor){
    const s=sel(); if(!s) return; const r=s.getRangeAt(0);
    const ctx=getLineContext(editor);
    if(ctx && ctx.mode==='block'){
      const newBlock=document.createElement(ctx.block.tagName);
      newBlock.appendChild(document.createElement('br'));
      ctx.block.after(newBlock);
      const nr=document.createRange(); nr.setStart(newBlock,0); nr.collapse(true);
      s.removeAllRanges(); s.addRange(nr); return;
    }
    const br=document.createElement('br'); r.deleteContents(); r.insertNode(br);
    r.setStartAfter(br); r.setEndAfter(br); s.removeAllRanges(); s.addRange(r);
  }

  function insertBreakWithCb(editor){
    const s=sel(); if(!s) return; const r=s.getRangeAt(0);
    const ctx=getLineContext(editor);
    if(ctx && ctx.mode==='block'){
      const newBlock=document.createElement(ctx.block.tagName);
      const wrap=makeCb(); newBlock.appendChild(wrap); newBlock.appendChild(document.createTextNode(' '));
      ctx.block.after(newBlock);
      const nr=document.createRange(); nr.setStart(newBlock,newBlock.childNodes.length); nr.collapse(true);
      s.removeAllRanges(); s.addRange(nr); return;
    }
    const br=document.createElement('br'); r.deleteContents(); r.insertNode(br); r.setStartAfter(br); r.collapse(true);
    const wrap=makeCb(); r.insertNode(wrap);
    const space=document.createTextNode(' ');
    const r2=document.createRange(); r2.setStartAfter(wrap); r2.collapse(true); r2.insertNode(space);
    r2.setStartAfter(space); r2.setEndAfter(space); s.removeAllRanges(); s.addRange(r2);
  }

  function removeLeadingCb(editor,ctx){
    if(!ctx || !lineStartsWithCb(ctx)) return false;
    const space=ctx.first.nextSibling; if(space && space.nodeType===3 && /^\s$/.test(space.textContent)) space.remove();
    ctx.first.remove(); return true;
  }

  function deleteAdjacentCb(editor, direction){
    const s=sel(); if(!s) return false; const r=s.getRangeAt(0); if(!r.collapsed) return false;
    const ctx=getLineContext(editor); if(!ctx) return false;

    // 1) Backspace tout début -> retirer la "puce"
    if(direction==='back'){
      const atStart = (ctx.mode==='block') ? (ctx.caretAtBlockStart && lineStartsWithCb(ctx))
                                           : (ctx.caretAtStart && lineStartsWithCb(ctx));
      if(atStart) return removeLeadingCb(editor,ctx);
    }

    // 2) sinon, supprimer la case voisine
    if(ctx.mode==='block'){
      let container=r.startContainer; while(container && container.parentNode!==ctx.block) container=container.parentNode;
      container = container || ctx.block;
      if(direction==='back'){
        if(r.startContainer.nodeType===3 && r.startOffset>0) return false;
        let t=container.previousSibling;
        if(t && t.nodeType===3 && /^\s$/.test(t.textContent)){ const x=t.previousSibling; if(isCbWrap(x)){ t.remove(); t=x; } }
        if(isCbWrap(t)){ const nb=t.previousSibling; if(nb && nb.nodeType===3 && /^\s$/.test(nb.textContent)) nb.remove(); t.remove(); return true; }
      }else{
        if(r.startContainer.nodeType===3 && r.startOffset<r.startContainer.textContent.length) return false;
        let t=container.nextSibling;
        if(t && t.nodeType===3 && /^\s$/.test(t.textContent)){ const x=t.nextSibling; if(isCbWrap(x)){ t.remove(); t=x; } }
        if(isCbWrap(t)){ const nb=t.nextSibling; if(nb && nb.nodeType===3 && /^\s$/.test(nb.textContent)) nb.remove(); t.remove(); return true; }
      }
      return false;
    }

    // inline
    let node=r.startContainer; while(node && node.parentNode!==editor) node=node.parentNode;
    if(!node) return false;
    if(direction==='back'){
      if(r.startContainer.nodeType===3 && r.startOffset>0) return false;
      let t=node.previousSibling;
      if(t && t.nodeType===3 && /^\s$/.test(t.textContent)){ const x=t.previousSibling; if(isCbWrap(x)){ t.remove(); t=x; } }
      if(isCbWrap(t)){ const nb=t.previousSibling; if(nb && nb.nodeType===3 && /^\s$/.test(nb.textContent)) nb.remove(); t.remove(); return true; }
    }else{
      if(r.startContainer.nodeType===3 && r.startOffset<r.startContainer.textContent.length) return false;
      let t=node.nextSibling;
      if(t && t.nodeType===3 && /^\s$/.test(t.textContent)){ const x=t.nextSibling; if(isCbWrap(x)){ t.remove(); t=x; } }
      if(isCbWrap(t)){ const nb=t.nextSibling; if(nb && nb.nodeType===3 && /^\s$/.test(nb.textContent)) nb.remove(); t.remove(); return true; }
    }
    return false;
  }

  window.setupCheckboxListBehavior=function(editor, insertBtn){
    if(!editor || editor.__cbInstalled) return; editor.__cbInstalled=true;

    editor.addEventListener('keydown',(e)=>{
      if(e.key==='Enter'){
        const ctx=getLineContext(editor);
        if(!ctx || !lineStartsWithCb(ctx)) return; // ligne normale -> natif
        e.preventDefault();
        if(lineEmptyAfterCb(editor,ctx)) insertPlainBreak(editor); else insertBreakWithCb(editor);
      }
      if(e.key==='Backspace'){ if(deleteAdjacentCb(editor,'back')) e.preventDefault(); }
      if(e.key==='Delete'){ if(deleteAdjacentCb(editor,'del')) e.preventDefault(); }
    });

    if(insertBtn){
      insertBtn.addEventListener('click',()=>{
        editor.focus();
        const s=sel(); if(!s) return; const r=s.getRangeAt(0);
        const node=makeCb(); r.deleteContents(); r.insertNode(node);
        const space=document.createTextNode(' ');
        const r2=document.createRange(); r2.setStartAfter(node); r2.collapse(true); r2.insertNode(space);
        r2.setStartAfter(space); r2.setEndAfter(space); s.removeAllRanges(); s.addRange(r2);
      });
    }
  };
})();
