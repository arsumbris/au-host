// The host owns the overlay lifetime and tracing; host and catalogue share the exact presentation.
import type { ChooseRequest, ChooserSurface } from './host-config'
import { getOverlaySite } from './overlay-site'
import { adoptHostSheet } from './adopt-sheet'
import { event, on, resumeCause } from '@arsumbris/au-host-sdk'
import { createChooserPresentation, chooserStyle, CHOOSER_BACK, CHOOSER_SUPERSEDED, type ChooserStep, type Choice } from '@arsumbris/au-component-catalog/chooser-presentation'
import { slotBounds } from '@arsumbris/container-kit'

export { CHOOSER_BACK }
export const STYLE = chooserStyle
export type HostChooserSurface = ChooserSurface & { step(request: ChooserStep): Promise<Choice> }

// Remember the actual invoking gesture, not whichever editor retained DOM focus.
// Overlay substeps keep the original anchor; this observes input without consuming any key.
let invocationAnchor: DOMRect | null = null
function outsideOverlay(event: Event): boolean {
  return !event.composedPath().some(node => node instanceof HTMLElement && node.classList.contains('au-overlay-root'))
}
document.addEventListener('pointerdown', event => {
  if (outsideOverlay(event)) invocationAnchor = new DOMRect(event.clientX, event.clientY, 0, 0)
}, true)
document.addEventListener('keydown', event => {
  if (!outsideOverlay(event)) return
  const target = event.composedPath().find(node => node instanceof HTMLElement) as HTMLElement | undefined
  if (!target) return
  const rect = target.getBoundingClientRect()
  // A document-sized keyboard target anchors near its leading edge, not across the whole document.
  invocationAnchor = new DOMRect(rect.left, rect.top, 0, Math.min(rect.height, parseFloat(getComputedStyle(target).getPropertyValue('--au-row-h')) || rect.height))
}, true)

let singleton: HostChooserSurface | null = null
export function getChooserSurface(): HostChooserSurface {
  if (singleton) return singleton
  adoptHostSheet(STYLE)
  // `slotBounds` (container substrate) resolves an option's `data-pane-id` anchor to its full on-screen
  // extent — unioning a container's several portaled regions — so the presentation stays DOM-convention-free.
  const presentation = createChooserPresentation(getOverlaySite().claim({ level: 'overlay' }).el, () => invocationAnchor, slotBounds)
  // The request the presentation is showing; a withdrawn request closes the presentation only if it is still this one.
  let showing: ChooserStep | null = null
  async function step(req: ChooserStep): Promise<Choice> {
    const signal = req.signal
    if (signal?.aborted) {
      if (on('chooser')) resumeCause(req.cause, () => event('chooser', 'withdrawn', { title: req.title }))
      return null
    }
    if (on('chooser')) resumeCause(req.cause, () => event('chooser', 'open', { title: req.title, options: req.options.map(o => o.label) }))
    let withdrawn = false
    const onAbort = (): void => {
      withdrawn = true
      if (showing === req) presentation.dispose()
    }
    signal?.addEventListener('abort', onAbort)
    showing = req
    const shown = await presentation.choose(req)
    signal?.removeEventListener('abort', onAbort)
    if (showing === req) showing = null
    // A withdrawal reaches the caller as a cancel; the trace keeps it distinct from a superseding open.
    const picked = withdrawn ? null : shown
    if (on('chooser')) {
      const label = typeof picked === 'string' ? req.options.find(o => o.id === picked)?.label ?? picked : null
      const outcome = withdrawn ? 'withdrawn' : picked === CHOOSER_BACK ? 'back' : picked === CHOOSER_SUPERSEDED ? 'superseded' : picked ? 'pick' : 'cancel'
      resumeCause(req.cause, () => event('chooser', outcome, { picked: label }))
    }
    return picked
  }
  singleton = { step, choose: async (req: ChooseRequest) => {
    const picked = await step(req)
    return typeof picked === 'string' ? picked : null
  } }
  return singleton
}
