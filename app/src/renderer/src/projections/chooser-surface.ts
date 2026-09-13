// The host owns the overlay lifetime and tracing; host and catalogue share the exact presentation.
import type { ChooseRequest, ChooserSurface } from './host-config'
import { getOverlaySite } from './overlay-site'
import { adoptHostSheet } from './adopt-sheet'
import { event, on, resumeCause } from '@arsumbris/au-host-sdk'
import { createChooserPresentation, chooserStyle, CHOOSER_BACK, type ChooserStep, type Choice } from '@arsumbris/au-component-catalog/chooser-presentation'

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
  const presentation = createChooserPresentation(getOverlaySite().claim({ level: 'overlay' }).el, () => invocationAnchor)
  async function step(req: ChooserStep): Promise<Choice> {
    if (on('chooser')) resumeCause(req.cause, () => event('chooser', 'open', { title: req.title, options: req.options.map(o => o.label) }))
    const picked = await presentation.choose(req)
    if (on('chooser')) {
      const label = typeof picked === 'string' ? req.options.find(o => o.id === picked)?.label ?? picked : null
      resumeCause(req.cause, () => event('chooser', picked === CHOOSER_BACK ? 'back' : picked ? 'pick' : 'cancel', { picked: label }))
    }
    return picked
  }
  singleton = { step, choose: async (req: ChooseRequest) => {
    const picked = await step(req)
    return typeof picked === 'string' ? picked : null
  } }
  return singleton
}
