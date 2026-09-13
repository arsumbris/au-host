import { getDocument, PDFWorker } from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker&inline'
import { EventBus, PDFViewer, PDFLinkService, PDFFindController } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { button, type Viewer, type ViewState } from './viewers'

type Input = HTMLElement & {value: string; disabled: boolean}

/** Reading controls belong to this PDF composition, never to host routing. */
export function createPdfViewer(url: string, name: string, state: ViewState, save: (s: ViewState) => void, status: (s: string, failed?: boolean) => void): Viewer {
  const element = document.createElement('div'); element.className = 'mv-pdf-reader'
  const scroll = document.createElement('div'); scroll.className = 'mv-pdf-scroll'; scroll.tabIndex = 0; scroll.setAttribute('aria-label', 'PDF pages')
  const pages = document.createElement('div'); pages.className = 'pdfViewer'; scroll.append(pages); element.append(scroll)
  const native = document.createElement('iframe'); native.title = `PDF document tools — ${name}`; native.referrerPolicy = 'no-referrer'; native.hidden = true; element.append(native)
  const group = (label: string) => {const el = document.createElement('div'); el.className = 'mv-pdf-control-group'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', label); return el}
  const navigation = group('Page navigation'), scale = group('Document scale'), search = group('Find in document')
  const input = (label: string, className: string): Input => {const el = document.createElement('au-input') as Input; el.setAttribute('aria-label', label); el.setAttribute('size', 'sm'); el.className = className; el.value = ''; return el}
  const pageInput = input('Page number', 'mv-pdf-page-input'), query = input('Find in PDF', 'mv-pdf-query')
  query.setAttribute('placeholder', 'Find in PDF…')
  const pageCount = document.createElement('span'); pageCount.className = 'mv-pdf-count'; pageCount.textContent = '/ —'
  const matches = document.createElement('span'); matches.className = 'mv-pdf-matches'; matches.setAttribute('role', 'status')
  const eventBus = new EventBus(), linkService = new PDFLinkService({eventBus})
  const findController = new PDFFindController({eventBus, linkService})
  let reader: PDFViewer | undefined, alive = true, ready = false, tools = false, restoring = true
  let workerPort: Worker | undefined
  let loadTask: ReturnType<typeof getDocument> | undefined, worker: PDFWorker | undefined
  const persist = () => {if (reader && ready && !restoring) save({...state, page: reader.currentPageNumber, pdfScale: reader.currentScaleValue, top: scroll.scrollTop})}
  const update = () => {
    pageInput.disabled = !ready || tools
    previous.toggleAttribute('disabled', !ready || tools || !reader || reader.currentPageNumber <= 1)
    next.toggleAttribute('disabled', !ready || tools || !reader || reader.currentPageNumber >= reader.pagesCount)
    for (const control of [zoomOut, zoomIn, fit, actual]) control.toggleAttribute('disabled', !ready || tools)
    query.disabled = !ready || tools
    for (const control of [findPrevious, findNext]) control.toggleAttribute('disabled', !ready || tools || !query.value)
    if (reader && ready) {
      pageInput.value = String(reader.currentPageNumber); pageCount.textContent = `/ ${reader.pagesCount}`
      zoomValue.textContent = `${Math.round(reader.currentScale * 100)}%`
      fit.setAttribute('aria-pressed', String(reader.currentScaleValue === 'page-width'))
      actual.setAttribute('aria-pressed', String(reader.currentScaleValue === '1'))
    }
  }
  const turn = (delta: number) => {if (reader && ready) {reader.currentPageNumber = Math.max(1, Math.min(reader.pagesCount, reader.currentPageNumber + delta)); update(); persist()}}
  const previous = button('←', () => turn(-1)); previous.setAttribute('aria-label', 'Previous page')
  const next = button('→', () => turn(1)); next.setAttribute('aria-label', 'Next page')
  navigation.append(previous, pageInput, pageCount, next)
  const zoom = (factor: number) => {if (reader && ready) {reader.currentScale = Math.min(5, Math.max(.1, reader.currentScale * factor)); update(); persist()}}
  const zoomOut = button('−', () => zoom(1 / 1.25)); zoomOut.setAttribute('aria-label', 'Zoom out')
  const zoomIn = button('+', () => zoom(1.25)); zoomIn.setAttribute('aria-label', 'Zoom in')
  const zoomValue = document.createElement('span'); zoomValue.className = 'mv-value'
  const fit = button('Fit width', () => {if (reader) {reader.currentScaleValue = 'page-width'; update(); persist()}})
  const actual = button('100%', () => {if (reader) {reader.currentScale = 1; update(); persist()}})
  scale.append(zoomOut, zoomValue, zoomIn, fit, actual)
  const find = (backwards: boolean, again = false) => {eventBus.dispatch('find', {source: element, type: again ? 'again' : '', query: query.value, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: backwards, matchDiacritics: false}); update()}
  const findPrevious = button('↑', () => find(true, true)); findPrevious.setAttribute('aria-label', 'Previous match')
  const findNext = button('↓', () => find(false, true)); findNext.setAttribute('aria-label', 'Next match')
  search.append(query, findPrevious, findNext, matches)
  const mode = button('Document tools', () => {
    tools = !tools; native.hidden = !tools; scroll.hidden = tools
    navigation.hidden = tools; scale.hidden = tools; search.hidden = tools
    mode.textContent = tools ? 'Return to reading' : 'Document tools'
    if (tools && !native.src) native.src = url
    if (!tools && reader) {reader.update(); scroll.focus()}
    status(tools ? 'Document tools · browser reader for print, download and annotations' : '')
    update()
  })
  pageInput.addEventListener('au-change', () => {
    const value = Number(pageInput.value)
    if (reader && Number.isInteger(value) && value >= 1 && value <= reader.pagesCount) {reader.currentPageNumber = value; persist()}
    update()
  })
  query.addEventListener('au-input', () => find(false))
  query.addEventListener('keydown', event => {if (event.key === 'Enter') {event.preventDefault(); find(event.shiftKey, true)} else if (event.key === 'Escape') {query.value = ''; find(false); scroll.focus()}})
  element.addEventListener('keydown', event => {
    if (tools) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {event.preventDefault(); query.focus()}
    if (event.target !== scroll) return
    if (event.key === '+' || event.key === '=') {event.preventDefault(); zoom(1.25)}
    if (event.key === '-') {event.preventDefault(); zoom(1 / 1.25)}
  })
  eventBus.on('pagechanging', () => {update(); persist()})
  eventBus.on('scalechanging', () => {update(); persist()})
  eventBus.on('updatefindmatchescount', ({matchesCount}: {matchesCount: {current: number; total: number}}) => {matches.textContent = query.value ? `${matchesCount.current} / ${matchesCount.total}` : ''})
  eventBus.on('updatefindcontrolstate', ({state: result}: {state: number}) => {if (result === 1) matches.textContent = 'No matches'; else if (!query.value) matches.textContent = ''})
  eventBus.on('pagesinit', () => {
    if (!reader || !alive) return
    ready = true; reader.currentScaleValue = state.pdfScale ?? 'page-width'
    reader.currentPageNumber = Math.max(1, Math.min(reader.pagesCount, state.page ?? 1))
    restoring = false; update()
  })
  eventBus.on('pagerendered', ({error}: {error?: unknown}) => {if (alive) status(error ? 'This PDF page could not be rendered. Open Document tools to inspect it.' : '', !!error)})
  const observer = new ResizeObserver(() => {if (reader && ready && !tools && reader.currentScaleValue === 'page-width') reader.currentScaleValue = 'page-width'})
  observer.observe(scroll)
  update()
  // Defer until the supplied viewer is mounted: PDFViewer requires measurable, positioned content.
  const mountFrame = requestAnimationFrame(async () => {
    if (!alive) return
    try {
      workerPort = new PdfWorker()
      const workerFailure = new Promise<never>((_, reject) => {workerPort!.addEventListener('error', () => reject(new Error('The PDF worker could not start.')), {once: true})})
      worker = PDFWorker.create({port: workerPort})
      reader = new PDFViewer({container: scroll, viewer: pages, eventBus, linkService, findController, removePageBorders: true})
      linkService.setViewer(reader)
      loadTask = getDocument({url, worker})
      const document = await Promise.race([loadTask.promise, workerFailure])
      if (!alive) return
      linkService.setDocument(document); findController.setDocument(document); reader.setDocument(document)
    } catch (error) {if (alive) status(`Could not read this PDF. ${error instanceof Error ? error.message : String(error)}`, true)}
  })
  return {element, controls: [navigation, scale, search, mode], destroy() {
    alive = false; cancelAnimationFrame(mountFrame); observer.disconnect(); persist(); reader?.cleanup(); void loadTask?.destroy(); worker?.destroy(); workerPort?.terminate(); native.src = 'about:blank'
  }}
}
