/** Keep document actions aligned with the document's scroll offset. Reader and editor own their
 * scrollers; this preserves that ownership without moving framework-managed toolbar nodes. */
export function bindDocumentToolbar(root: HTMLElement, scroller: HTMLElement): () => void {
  const toolbar = root.querySelector<HTMLElement>(':scope > .au-document-toolbar')
  if (!toolbar) return () => {}
  const padding = scroller.style.paddingBlockStart
  const sync = () => {
    const offset = Math.min(Math.max(0, scroller.scrollTop), toolbar.offsetHeight)
    root.style.setProperty('--document-toolbar-offset', `${-offset}px`)
  }
  const measure = () => {
    root.style.setProperty('--document-toolbar-size', `${toolbar.offsetHeight}px`)
    root.style.setProperty('--document-scrollbar-inset', `${Math.max(0, scroller.offsetWidth - scroller.clientWidth)}px`)
    scroller.style.paddingBlockStart = 'var(--document-toolbar-size)'
    sync()
  }
  const observer = new ResizeObserver(measure)
  observer.observe(toolbar)
  observer.observe(scroller)
  root.dataset.scrollToolbar = 'true'
  measure()
  const reveal = () => { scroller.scrollTop = 0; sync() }
  scroller.addEventListener('scroll', sync, {passive:true})
  toolbar.addEventListener('focusin', reveal)
  return () => {
    observer.disconnect()
    scroller.removeEventListener('scroll', sync)
    toolbar.removeEventListener('focusin', reveal)
    scroller.style.paddingBlockStart = padding
    root.removeAttribute('data-scroll-toolbar')
    root.style.removeProperty('--document-toolbar-size')
    root.style.removeProperty('--document-toolbar-offset')
    root.style.removeProperty('--document-scrollbar-inset')
  }
}
