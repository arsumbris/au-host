import { activatePane } from '@arsumbris/container-core'
import { getOpenSurfacesIndex } from './open-surfaces'
import { getChooserSurface } from './chooser-surface'
import { isMacRenderer } from './platform'
import { adoptHostSheet } from './adopt-sheet'

let focusStyleInstalled = false
function preparePaneFocus(el: HTMLElement): void {
  if (!focusStyleInstalled) {
    adoptHostSheet(`
      .au-pane-keyboard-focus { border-radius: var(--au-radius-md); }
      .au-pane-keyboard-focus:focus { outline: none; }
      .au-pane-keyboard-focus:focus-visible {
        outline: 1px solid var(--au-control-focus, var(--au-focus-outer));
        outline-offset: -1px;
      }
      :root:has(.au-chooser-spatial-backdrop) .au-pane-keyboard-focus:focus-visible { outline: none; }
      @media (forced-colors: active) {
        .au-pane-keyboard-focus:focus-visible { outline-color: Highlight; }
      }
    `)
    focusStyleInstalled = true
  }
  el.classList.add('au-pane-keyboard-focus')
}

const remembered = new Map<string, HTMLElement>()
let lastPane: string | undefined
function deepActive(): Element | null {
  let el=document.activeElement
  while(el?.shadowRoot?.activeElement) el=el.shadowRoot.activeElement
  return el
}
function paneOf(el:Element|null):string|undefined {
  while(el) {
    const id=el.getAttribute('data-pane-id')
    if(id) return id
    el=el.parentElement ?? ((el.getRootNode() as ShadowRoot).host || null)
  }
  return undefined
}
export function keyboardContext(event?:Event) {
  const path=event?.composedPath() ?? [deepActive()].filter(Boolean)
  const target=path.find(el=>el instanceof Element) as Element|undefined
  const rawPane=paneOf(target ?? null)
  const panes=visiblePanes()
  let pane=panes.find(item=>item.id===rawPane)?.id
  if (!pane && rawPane) {
    const container=document.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(rawPane)}"]`)
    const children=panes.filter(item=>container?.contains(item.el))
    pane=children.find(item=>item.id===lastPane)?.id ?? (children.length===1 ? children[0]!.id : undefined)
  }
  if (pane) lastPane=pane
  else pane=panes.find(item=>item.id===lastPane)?.id
  const projection=getOpenSurfacesIndex().list().find(s=>s.surfaceId===pane)?.projection
  if(pane && target instanceof HTMLElement && paneOf(target)===pane && (target.tabIndex>=0 || deepActive()===target)) remembered.set(pane,target)
  const text=path.some(el=>el instanceof Element && (el.matches('input,textarea,[contenteditable="true"],.cm-editor') || !!el.closest('.cm-editor')))
  const terminal=path.some(el=>el instanceof Element && !!el.closest('.xterm'))
  return {pane,projection,input:terminal?'terminal':text?'text':'workspace',platform:isMacRenderer()?'mac':/Win/.test(navigator.platform)?'windows':'linux'}
}
export interface VisiblePane {id:string;el:HTMLElement;rect:DOMRect;label:string}
export function visiblePanes():VisiblePane[] {
  const surfaces=getOpenSurfacesIndex().list()
  const candidates=[...document.querySelectorAll<HTMLElement>('[data-pane-id]:not([data-pane-host])')].filter(el=>{
    const r=el.getBoundingClientRect(),style=getComputedStyle(el)
    return r.width>1&&r.height>1&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight&&style.visibility!=='hidden'&&!el.closest('[inert],[hidden]')
  })
  const unique=new Map<string,VisiblePane>()
  for(const el of candidates) {
    if(candidates.some(other=>other!==el&&el.contains(other))) continue
    const id=el.dataset.paneId!
    const surface=surfaces.find(s=>s.surfaceId===id)
    const content=surface?.contents[0]?.identity
    unique.set(id,{id,el,rect:el.getBoundingClientRect(),label:content ? `${content.split('/').pop()}` : `${surface?.projection.split('::')[0]?.replaceAll('-', ' ') ?? 'Pane'}`})
  }
  return [...unique.values()]
}
export function focusPane(id:string):void {
  const target=visiblePanes().find(p=>p.id===id)
  if(!target) throw new Error('The pane is no longer visible.')
  preparePaneFocus(target.el)
  activatePane(id)
  lastPane=id
  const prior=remembered.get(id)
  if(prior?.isConnected && paneOf(prior) === id) {prior.focus({preventScroll:true});if(paneOf(deepActive())===id)return}
  const candidates=target.el.querySelectorAll<HTMLElement>('[contenteditable="true"],textarea,input:not([type="hidden"]),button:not(:disabled),[tabindex="0"]')
  for (const candidate of candidates) {
    if (!candidate.getClientRects().length || candidate.closest('[hidden],[inert]') || getComputedStyle(candidate).visibility==='hidden') continue
    candidate.focus({preventScroll:true})
    if (paneOf(deepActive())===id) return
  }
  target.el.tabIndex=-1;target.el.focus({preventScroll:true})
}
export function directionalPane(from:string,direction:string):string|undefined {
  const panes=visiblePanes(),source=panes.find(p=>p.id===from)
  if(!source) return undefined
  const axis:Record<string,[number,number]>={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]}
  const vector=axis[direction]
  if(!vector) return undefined
  const [dx,dy]=vector,r=source.rect,x=r.left+r.width/2,y=r.top+r.height/2
  return panes.filter(p=>p.id!==from).map(p=>{
    const q=p.rect,along=(q.left+q.width/2-x)*dx+(q.top+q.height/2-y)*dy
    const overlap=dx ? Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top) : Math.min(r.right,q.right)-Math.max(r.left,q.left)
    const ortho=Math.abs((q.left+q.width/2-x)*dy-(q.top+q.height/2-y)*dx)
    return {p,along,overlap,cost:along+ortho*2}
  }).filter(p=>p.along>0).sort((a,b)=>Number(b.overlap>0)-Number(a.overlap>0)||a.cost-b.cost||a.p.id.localeCompare(b.p.id))[0]?.p.id
}
export async function choosePane():Promise<void> {
  const before=deepActive() as HTMLElement|null
  const panes=visiblePanes()
  if(!panes.length) throw new Error('No visible panes to focus.')
  const picked=await getChooserSurface().choose({title:'Focus a pane',options:panes.map(p=>({id:p.id,label:p.label,anchor:p.id}))})
  if(picked) focusPane(picked)
  else if(before?.isConnected) before.focus({preventScroll:true})
}
