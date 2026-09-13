import { createHtmlViewer } from './html'
import { createVideoViewer } from './video'
import { createAudioViewer } from './audio'
export type ViewerKind = 'image' | 'pdf' | 'video' | 'audio' | 'html'
export interface ViewState { htmlWidth?: number; page?: number; pdfScale?: string; zoom?: number; left?: number; top?: number; time?: number; volume?: number; rate?: number; checker?: boolean }
export interface Viewer { element: HTMLElement; controls: HTMLElement[]; destroy(): void }
export function button(label: string, action: () => void): HTMLElement {
  const el = document.createElement('au-button'); el.setAttribute('variant','ghost'); el.setAttribute('size','sm'); el.textContent = label; el.addEventListener('au-activate',action); return el
}
// The shared document-mode recipe remains native, matching reader/editor positioning and anatomy.
export function documentModeButton(action: () => void): HTMLButtonElement {
  const el = document.createElement('button'); el.type = 'button'; el.addEventListener('click',action); return el
}
export function createViewer(kind: ViewerKind, url: string, name: string, state: ViewState, save: (s: ViewState) => void, status: (s: string, failed?: boolean) => void): Viewer {
  if (kind === 'html') return createHtmlViewer(url, name, state, save, status)
  if (kind === 'video') return createVideoViewer(url, name, state, save, status)
  if (kind === 'audio') return createAudioViewer(url, name, state, save, status)
  const element = document.createElement('div'); element.className = 'mv-stage'; element.tabIndex = 0
  element.setAttribute('aria-label', `${name} preview`)
  const controls: HTMLElement[] = []
  let cleanup = () => {}
  if (kind === 'image') {
    const img = document.createElement('img'); img.alt = name; img.draggable = false; img.hidden = true
    const mat = document.createElement('div'); mat.className = 'mv-image-mat'; mat.append(img); element.append(mat)
    let zoom = state.zoom ?? 0, checker = state.checker ?? true, ready = false
    element.classList.add('mv-image-stage')
    const group = (name: string, ...items: HTMLElement[]) => {
      const el = document.createElement('div'); el.className = 'mv-image-tools'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', name); el.append(...items); return el
    }
    const label = document.createElement('span'); label.className = 'mv-value'
    const persist = () => save({zoom,checker,left:element.scrollLeft,top:element.scrollTop})
    const render = () => {
      if (!img.naturalWidth) return
      const spacing = getComputedStyle(mat)
      const availableWidth = element.clientWidth - parseFloat(spacing.paddingLeft) - parseFloat(spacing.paddingRight)
      const availableHeight = element.clientHeight - parseFloat(spacing.paddingTop) - parseFloat(spacing.paddingBottom)
      if (availableWidth <= 0 || availableHeight <= 0) return
      const fit = Math.min(1, availableWidth/img.naturalWidth, availableHeight/img.naturalHeight)
      const scale = zoom || Math.max(.01,fit)
      img.style.width = `${img.naturalWidth*scale}px`; img.style.height = `${img.naturalHeight*scale}px`
      zoomOut.toggleAttribute('disabled', !ready || scale <= .05); zoomIn.toggleAttribute('disabled', !ready || scale >= 16)
      label.textContent = `${Math.round(scale*100)}%`; img.classList.toggle('mv-checker',checker)
      fitButton.setAttribute('variant', zoom === 0 ? 'outline' : 'ghost')
      actualButton.setAttribute('variant', zoom === 1 ? 'outline' : 'ghost')
      fitButton.setAttribute('aria-pressed', String(zoom === 0))
      actualButton.setAttribute('aria-pressed', String(zoom === 1))
      const pannable = img.width > availableWidth || img.height > availableHeight
      element.classList.toggle('mv-pannable', pannable)
      status(`${img.naturalWidth} × ${img.naturalHeight} px · + / − zoom · 0 fit${pannable ? ' · Drag to pan' : ''}`)
    }
    const change = (factor: number) => {
      if (!ready) return
      const viewport = element.getBoundingClientRect(), before = img.getBoundingClientRect()
      const centerX = viewport.left + element.clientWidth / 2, centerY = viewport.top + element.clientHeight / 2
      const x = Math.max(0, Math.min(1, (centerX - before.left) / before.width))
      const y = Math.max(0, Math.min(1, (centerY - before.top) / before.height))
      zoom = Math.max(.05, Math.min(16, (zoom || img.width / img.naturalWidth || 1) * factor))
      render()
      const after = img.getBoundingClientRect()
      element.scrollLeft += after.left + x * after.width - centerX
      element.scrollTop += after.top + y * after.height - centerY
      persist()
    }
    const fitButton = button('Fit',()=>{zoom=0;render();persist()})
    const actualButton = button('Actual size',()=>{zoom=1;render();persist()})
    const zoomOut = button('−',()=>change(1/1.25)), zoomIn = button('+',()=>change(1.25))
    zoomOut.setAttribute('aria-label','Zoom out'); zoomIn.setAttribute('aria-label','Zoom in')
    label.setAttribute('aria-label', 'Image scale')
    const background = document.createElement('au-checkbox') as HTMLElement & { checked: boolean }
    background.setAttribute('label','Transparency grid'); background.checked=checker
    background.addEventListener('au-change',()=>{checker=background.checked;render();persist()})
    const imageControls = [fitButton, actualButton, zoomOut, zoomIn, background]
    imageControls.forEach(el=>el.setAttribute('disabled',''))
    controls.push(group('Image size', fitButton, actualButton), group('Image zoom', zoomOut, label, zoomIn), background)
    img.onload = () => {img.hidden=false;ready=true;imageControls.forEach(el=>el.removeAttribute('disabled'));render();element.scrollTo(state.left??0,state.top??0)}
    img.onerror = () => {img.hidden=true;ready=false;imageControls.forEach(el=>el.setAttribute('disabled',''));status('This image could not be decoded. Try opening it externally.', true)}
    let resizeFrame = 0
    const scheduleRender = () => {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(render)
    }
    const observer = new ResizeObserver(scheduleRender)
    observer.observe(element)
    observer.observe(mat)
    // Padding can change either box when the mat switches between viewport and intrinsic sizing.
    const matBorderObserver = new ResizeObserver(scheduleRender)
    matBorderObserver.observe(mat, { box: 'border-box' })
    let drag: {x:number;y:number;left:number;top:number}|undefined
    element.onpointerdown = e => {if(e.button!==0||!element.classList.contains('mv-pannable'))return;element.focus();drag={x:e.clientX,y:e.clientY,left:element.scrollLeft,top:element.scrollTop};element.setPointerCapture(e.pointerId)}
    element.onpointermove = e => {if(drag)element.scrollTo(drag.left+drag.x-e.clientX,drag.top+drag.y-e.clientY)}
    element.onpointerup = element.onpointercancel = () => {drag=undefined;persist()}
    element.onkeydown = e => {if(e.key==='+'||e.key==='='){change(1.25);e.preventDefault()}else if(e.key==='-'){change(1/1.25);e.preventDefault()}else if(e.key==='0'&&ready){zoom=0;render();persist();e.preventDefault()}}
    element.onscroll = persist
    img.src=url; cleanup=()=>{observer.disconnect();matBorderObserver.disconnect();cancelAnimationFrame(resizeFrame);img.onload=null;img.onerror=null;img.removeAttribute('src')}
  } else {
    element.classList.add('mv-document')
    const frame=document.createElement('iframe');frame.title=`${kind.toUpperCase()} preview — ${name}`;frame.referrerPolicy='no-referrer'
    frame.src=url;frame.onload=()=>status('PDF · use the document toolbar to search and navigate')
    element.append(frame);controls.push(button('Reload',()=>{frame.src=url}));cleanup=()=>{frame.src='about:blank'}
  }
  return {element,controls,destroy:cleanup}
}
