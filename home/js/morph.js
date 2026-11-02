// Minimal DOM patcher: updates the live tree to match freshly rendered markup so CSS transitions,
// focus and in-progress slider drags survive re-renders.
export function morphHTML(root, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(root, tpl.content);
}

function same(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
  if (a.nodeType === 1) return a.getAttribute('data-key') === b.getAttribute('data-key');
  return true;
}

function patchAttrs(el, next) {
  for (const { name } of [...el.attributes]) if (!next.hasAttribute(name)) el.removeAttribute(name);
  for (const { name, value } of next.attributes) if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function patchChildren(parent, next) {
  const oldKids = [...parent.childNodes];
  const newKids = [...next.childNodes];
  newKids.forEach((nw, i) => {
    const old = oldKids[i];
    if (!old) { parent.appendChild(nw); return; }
    if (!same(old, nw)) { parent.replaceChild(nw, old); return; }
    if (old.nodeType !== 1) {
      if (old.nodeValue !== nw.nodeValue) old.nodeValue = nw.nodeValue;
      return;
    }
    const busy = old === document.activeElement || old.dataset.dragging === '1';
    if (old.tagName === 'INPUT' || old.tagName === 'TEXTAREA' || old.tagName === 'SELECT') {
      if (!busy) {
        patchAttrs(old, nw);
        if (old.type === 'checkbox') old.checked = nw.hasAttribute('checked');
        else if (old.tagName !== 'SELECT') old.value = nw.getAttribute('value') ?? nw.textContent ?? '';
      }
      return;
    }
    patchAttrs(old, nw);
    patchChildren(old, nw);
  });
  for (let i = oldKids.length - 1; i >= newKids.length; i--) oldKids[i].remove();
}
