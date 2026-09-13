import {button, type Viewer, type ViewState} from './viewers'

const widths = [0, 360, 768, 1280]

/** A local artifact has its own document viewport; this is not device emulation. */
export function createHtmlViewer(url: string, name: string, state: ViewState, save: (s: ViewState) => void, status: (message: string, failed?: boolean) => void): Viewer {
  const element = document.createElement('div'); element.className = 'mv-html-stage'
  const scroll = document.createElement('au-scroll-area'); scroll.setAttribute('axis', 'both'); scroll.className = 'mv-html-scroll'
  const frame = document.createElement('iframe'); frame.title = `HTML preview — ${name}`; frame.referrerPolicy = 'no-referrer'; frame.setAttribute('sandbox', 'allow-scripts')
  scroll.append(frame); element.append(scroll)
  const viewport = document.createElement('div'); viewport.className = 'mv-html-viewport'; viewport.setAttribute('role', 'group'); viewport.setAttribute('aria-label', 'Preview viewport')
  const label = document.createElement('span'); label.textContent = 'Viewport'
  const width = document.createElement('au-select') as HTMLElement & {value: string; options: {value: string; label: string}[]}
  width.setAttribute('label', 'Preview width'); width.setAttribute('size', 'sm')
  width.options = widths.map(value => ({value: String(value), label: value ? `${value} px` : 'Fit pane'}))
  width.value = String(widths.includes(state.htmlWidth ?? 0) ? state.htmlWidth ?? 0 : 0)
  const dimensions = document.createElement('span'); dimensions.className = 'mv-html-dimensions'; dimensions.setAttribute('aria-label', 'Actual preview size')
  viewport.append(label, width, dimensions)
  let alive = true, loaded = false
  const measure = () => {
    if (!alive) return
    const fixed = Number(width.value)
    frame.style.width = fixed ? `${fixed}px` : `${element.clientWidth}px`
    frame.style.height = `${element.clientHeight}px`
    dimensions.textContent = `${Math.round(frame.clientWidth)} × ${Math.round(frame.clientHeight)}`
  }
  const observer = new ResizeObserver(measure); observer.observe(element)
  width.addEventListener('au-change', () => {if (!widths.includes(Number(width.value))) return; measure(); save({...state, htmlWidth: Number(width.value)})})
  const reload = button('Reload', () => {loaded = false; status('Loading preview…', true); frame.src = url})
  frame.onload = () => {if (alive) {loaded = true; measure(); status('Isolated HTML preview')}}
  frame.onerror = () => {if (alive) status('The HTML document could not be loaded. Retry, or open it externally.', true)}
  frame.src = url
  // Frame load is deliberately not an application-ready signal. The host owns delivery errors.
  return {element, controls: [reload, viewport], destroy() {alive = false; observer.disconnect(); frame.onload = null; frame.onerror = null; if (loaded) frame.src = 'about:blank'; else frame.removeAttribute('src')}}
}
