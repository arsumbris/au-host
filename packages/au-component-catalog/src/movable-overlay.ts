/** Session-only movement for an already positioned overlay. No storage or keyboard interception. */
export function makeOverlayMovable(surface: HTMLElement, handle: HTMLElement) {
  let moved = false
  let drag: { id: number; x: number; y: number; left: number; top: number } | undefined
  const clamp = () => {
    if (!moved) return
    const r = surface.getBoundingClientRect()
    surface.style.left = `${Math.max(8, Math.min(r.left, innerWidth - r.width - 8))}px`
    surface.style.top = `${Math.max(8, Math.min(r.top, innerHeight - r.height - 8))}px`
  }
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || e.composedPath().some(n => n instanceof Element && n.matches('button,input,au-button,au-icon-button'))) return
    const r = surface.getBoundingClientRect()
    moved = true
    surface.style.transform = 'none'
    surface.style.left = `${r.left}px`; surface.style.top = `${r.top}px`
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top }
    handle.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  const move = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return
    surface.style.left = `${drag.left + e.clientX - drag.x}px`
    surface.style.top = `${drag.top + e.clientY - drag.y}px`
    clamp()
  }
  const end = () => { drag = undefined }
  handle.style.cursor = 'move'; handle.style.touchAction = 'none'
  handle.title = 'Drag to move while open'
  handle.addEventListener('pointerdown', down)
  handle.addEventListener('pointermove', move)
  handle.addEventListener('lostpointercapture', end)
  handle.addEventListener('pointerup', end)
  window.addEventListener('resize', clamp)
  return {
    get moved() { return moved }, clamp,
    dispose() {
      handle.removeEventListener('pointerdown', down); handle.removeEventListener('pointermove', move)
      handle.removeEventListener('lostpointercapture', end); handle.removeEventListener('pointerup', end)
      window.removeEventListener('resize', clamp)
    },
  }
}
