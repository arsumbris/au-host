import { dragStore, isContentDropHit, type DragState } from '@arsumbris/container-core';
import { floatingSurfaceMaterialCSS } from '@arsumbris/style/surface-material';

// The preview's look lives in a document-level constructable stylesheet, adopted once per document.
// A constructable sheet is CSSOM, not a parsed `<style>` element, so it is CSP-exempt (the same
// mechanism `host.styles.inject` / `adoptHostSheet` use) and it carries the nested `&::before` / `@media`
// rules of the floating material that a flat inline `style` attribute cannot express. Static rules, so
// adopting once and leaving it is leak-free; only the preview ELEMENT is per-drag.
const PREVIEW_CSS = `.au-content-drag-preview {
  ${floatingSurfaceMaterialCSS}
  position:fixed; top:0; left:0; z-index:var(--au-z-tooltip); pointer-events:none;
  display:flex; align-items:center; gap:var(--au-space-2); box-sizing:border-box;
  max-width: min(320px, calc(100vw - 16px)); padding:var(--au-space-2) var(--au-space-3);
  border:1px solid var(--au-line-2); border-radius:var(--au-radius-row);
  box-shadow:var(--au-sh-pop); color:var(--au-ink-1);
  font:var(--au-t-sm)/var(--au-lh-sm) var(--au-font-sans);
}
.au-content-drag-preview__name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.au-content-drag-preview__action { flex:none; color:var(--au-ink-3); font-size:var(--au-t-xs); }
.au-content-drag-preview au-icon { flex:none; }`;

const adoptedDocs = new WeakSet<Document>();
function ensurePreviewSheet(doc: Document, win: Window): void {
  if (adoptedDocs.has(doc)) return;
  // Construct with the TARGET window's realm: a constructable sheet can only be adopted into the
  // document it was constructed in, so a floated window needs its own `CSSStyleSheet`.
  const sheet = new (win as Window & typeof globalThis).CSSStyleSheet();
  sheet.replaceSync(PREVIEW_CSS);
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  adoptedDocs.add(doc);
}

/** A visual companion only, drawn inside the host's per-window drag overlay `layer` (never a body portal).
 *  The existing registry remains the sole drop authority. */
export function mountContentDragPreview(drag: DragState, layer: HTMLElement): () => void {
  const doc = layer.ownerDocument;
  const win = doc.defaultView!;
  const source = drag.sourceEl instanceof HTMLElement ? drag.sourceEl : null;
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  ensurePreviewSheet(doc, win);
  const preview = doc.createElement('div');
  preview.className = 'au-content-drag-preview';
  preview.setAttribute('aria-hidden', 'true');
  const iconName = source?.querySelector('au-icon')?.getAttribute('name')
    ?? source?.shadowRoot?.querySelector('au-icon')?.getAttribute('name');
  if (iconName) {
    const icon = doc.createElement('au-icon'); icon.setAttribute('name', iconName); icon.setAttribute('size', 'sm'); preview.append(icon);
  }
  const label = doc.createElement('span'); label.className = 'au-content-drag-preview__name'; label.textContent = drag.source.label;
  const action = doc.createElement('span'); action.className = 'au-content-drag-preview__action';
  preview.append(label, action); layer.append(preview);
  const css = win.getComputedStyle(preview);
  const durationToken = css.getPropertyValue('--au-m-fast').trim();
  const duration = parseFloat(durationToken) * (durationToken.endsWith('ms') ? 1 : 1000) || 140;
  const easing = css.getPropertyValue('--au-e-soft').trim() || 'ease-out';
  const gap = parseFloat(css.columnGap) || 12;
  let point = drag.startOffset;
  let frame = 0;
  let cancelled = false;
  let hasTarget = false;
  const previousOpacity = source?.style.getPropertyValue('opacity') ?? '';
  const previousPriority = source?.style.getPropertyPriority('opacity') ?? '';
  if (source) source.style.opacity = 'var(--au-opacity-muted)';
  function place() {
    frame = 0;
    const r = preview.getBoundingClientRect();
    const x = Math.max(8, Math.min(win.innerWidth - r.width - 8, point.x + gap));
    const y = Math.max(8, Math.min(win.innerHeight - r.height - 8, point.y + gap));
    preview.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }
  function schedule() { if (!frame) frame = win.requestAnimationFrame(place); }
  function move(e: PointerEvent) { point = {x:e.clientX, y:e.clientY}; schedule(); }
  function key(e: KeyboardEvent) { if (e.key === 'Escape') cancelled = true; }
  function cancel() { cancelled = true; }
  const update = () => {
    const current = dragStore.getState().drag;
    if (!current) return;
    const hover = current.hover;
    hasTarget = !!hover;
    action.textContent = hover ? isContentDropHit(hover) ? hover.spec.previewLabel ?? 'Drop' : 'Open' : '';
    schedule();
  };
  const unsubscribe = dragStore.subscribe(update);
  update(); place();
  const entrance = reduced ? null : preview.animate([{opacity:0, scale:'.96'}, {opacity:1, scale:'1'}], {duration,easing});
  win.addEventListener('pointermove', move);
  win.addEventListener('keydown', key, true);
  win.addEventListener('pointercancel', cancel, true);
  win.addEventListener('blur', cancel, true);
  return () => {
    unsubscribe(); win.cancelAnimationFrame(frame); entrance?.cancel();
    win.removeEventListener('pointermove', move);
    win.removeEventListener('keydown', key, true);
    win.removeEventListener('pointercancel', cancel, true);
    win.removeEventListener('blur', cancel, true);
    if (source) {
      if (previousOpacity) source.style.setProperty('opacity', previousOpacity, previousPriority);
      else source.style.removeProperty('opacity');
    }
    const remove = () => { preview.remove(); };
    if (reduced || !preview.animate) { remove(); return; }
    const target = (cancelled || !hasTarget) && source?.isConnected ? source.getBoundingClientRect() : null;
    const finish = preview.animate([
      {opacity:1, transform:preview.style.transform, scale:'1'},
      {opacity:0, transform:target ? `translate3d(${target.x}px, ${target.y}px, 0)` : preview.style.transform, scale:'.96'},
    ], {duration,easing,fill:'forwards'});
    void finish.finished.then(remove, remove);
  };
}
