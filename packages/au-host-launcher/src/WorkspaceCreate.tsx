/** Compact pre-graph workspace creation. Template content, not this UI, owns the starting configuration. */
import {useEffect, useRef, useState, type ReactNode} from 'react'
import type {WorkspaceTemplateCatalog} from '@arsumbris/au-host-sdk'
import type {LauncherHost} from './launcher-host'
import type {DaemonConfig} from '@arsumbris/au-host-app'
import {Preview} from './WorkspacePreview'
import {McpSetup} from './McpSetup'
import {DisclosureChevron} from './DisclosureChevron'
import {transitionLauncher} from './presentation-transition'
import {LauncherStage} from './LauncherStage'
import './workspace-create.css'

/** Reveal scroll affordances during movement without changing the reserved gutter. */
function observeScrollActivity(element: HTMLElement): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const raw = getComputedStyle(element).getPropertyValue('--au-m-base').trim()
  const duration = parseFloat(raw) * (raw.endsWith('ms') ? 1 : 1000)
  const idle = Number.isFinite(duration) ? Math.max(600, duration * 4) : 800
  const update = () => {
    element.dataset.scrolling = 'true'
    clearTimeout(timer)
    timer = setTimeout(() => {delete element.dataset.scrolling}, idle)
  }
  element.addEventListener('scroll', update, {passive:true})
  return () => {clearTimeout(timer); element.removeEventListener('scroll', update); delete element.dataset.scrolling}
}

function SourceList({children}: {children: ReactNode}) {
  const viewport = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({above:false, below:false})
  useEffect(() => {
    const element = viewport.current!
    const stopActivity = observeScrollActivity(element)
    const update = () => setEdges({above:element.scrollTop > 2, below:element.scrollTop + element.clientHeight < element.scrollHeight - 2})
    const observer = new ResizeObserver(update)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    element.addEventListener('scroll', update)
    update()
    return () => {stopActivity(); observer.disconnect(); element.removeEventListener('scroll', update)}
  }, [])
  return <div className="starter-source-scroll" data-above={edges.above} data-below={edges.below}>
    <div ref={viewport} className="starter-bring__list" tabIndex={0} aria-label="Available content sources"><div className="starter-source-stack">{children}</div></div>
  </div>
}

export function WorkspaceCreate({host, initialTemplate, config, onConfigChange, onExit, onCreated}: {host: LauncherHost; initialTemplate?:{source:string;path:string}; config: DaemonConfig; onConfigChange: (patch: Partial<DaemonConfig>) => void; onExit: () => void; onCreated: (entry: string) => void}) {
  const [catalog, setCatalog] = useState<WorkspaceTemplateCatalog | null>(null)
  const [selected, select] = useState(0)
  const initialChoice=useRef(initialTemplate)
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [query, setQuery] = useState('')
  const [extras, setExtras] = useState<Record<string, 'edit' | 'discover'>>({})
  const [busy, setBusy] = useState(false)
  const [attempted,setAttempted] = useState(false)
  const [catalogFailed,setCatalogFailed] = useState(false)
  const [reloadCatalog,setReloadCatalog] = useState(0)
  const [error, setError] = useState('')
  const [created, setCreated] = useState('')
  const title = useRef<HTMLHeadingElement>(null)
  const launchCallback=useRef(onCreated)
  launchCallback.current=onCreated
  const shelf = useRef<HTMLDivElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const [moreBelow,setMoreBelow] = useState(false)
  const [moreAbove,setMoreAbove] = useState(false)
  const [scroll, setScroll] = useState({overflow:false, start:true, end:true})
  useEffect(() => {
    const element = shelf.current
    if (!element) return
    const update = () => setScroll({overflow:element.scrollWidth>element.clientWidth+2,start:element.scrollLeft<2,end:element.scrollLeft+element.clientWidth>=element.scrollWidth-2})
    const observer = new ResizeObserver(update); observer.observe(element); element.addEventListener('scroll',update); update()
    return () => {observer.disconnect();element.removeEventListener('scroll',update)}
  },[catalog])
  useEffect(() => {
    const element = form.current
    if (!element) return
    const stopActivity = observeScrollActivity(element)
    const update = () => {setMoreBelow(element.scrollTop+element.clientHeight<element.scrollHeight-3); setMoreAbove(element.scrollTop>3)}
    const observer = new ResizeObserver(update); observer.observe(element); if(element.firstElementChild) observer.observe(element.firstElementChild)
    element.addEventListener('scroll',update); update()
    return () => {stopActivity();observer.disconnect();element.removeEventListener('scroll',update)}
  },[catalog,created])
  useEffect(() => {let disposed = false; setCatalogFailed(false); host.gate.workspaceTemplates().then(value => {if (!disposed) {
      if(initialChoice.current){
        const choice=initialChoice.current
        const index=value.templates.findIndex(t=>t.source===choice.source && t.path===choice.path)
        if(index>=0)select(index)
        else setError('That starter is no longer available. Choose another starter below.')
        initialChoice.current=undefined
      }
      setCatalog(value)
    }}).catch(e => {if (!disposed) {setCatalogFailed(true);setError(String(e))}}); return () => {disposed=true}}, [host,reloadCatalog])
  const starter = catalog?.templates[selected]
  const members = new Set(starter?.members.map(member => member.name) ?? [])
  const sources = catalog?.sources.filter(source => !members.has(source.name) && source.name.toLowerCase().includes(query.toLowerCase())) ?? []
  const nameProblem = !name.trim() ? 'Enter a workspace name.' : !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name.trim()) ? 'Start with a letter or number. Use letters, numbers, dots, hyphens or underscores.' : ''
  const parentProblem = !parent.trim() ? 'Choose the folder that will contain your workspace.' : ''
  useEffect(()=>{
    if(!created)return
    title.current?.focus()
    const raw=getComputedStyle(title.current!).getPropertyValue('--au-m-base').trim()
    const duration=parseFloat(raw)*(raw.endsWith('ms')?1:1000)
    const delay=matchMedia('(prefers-reduced-motion: reduce)').matches?0:(Number.isFinite(duration)?duration*4:0)
    const timer=setTimeout(()=>launchCallback.current(created),delay)
    return ()=>clearTimeout(timer)
  },[created])
  async function create() {
    if (!catalog || busy) return
    setAttempted(true)
    if(nameProblem || parentProblem) {document.getElementById(nameProblem?'workspace-name':'workspace-parent')?.focus(); return}
    setBusy(true); setError('')
    try {
      const result = await host.gate.materializeWorkspace({name, parent, template: starter ? {source: starter.source, path: starter.path} : undefined,
        extras: Object.entries(extras).filter(([name]) => !members.has(name)).map(([name,role]) => ({name,role}))})
      if (!result.ok || !result.entryPath) setError(result.error ?? 'Could not create this workspace.')
      else transitionLauncher(()=>setCreated(result.entryPath!))
    } catch (e) {setError(String(e))} finally {setBusy(false)}
  }
  return <div className="starter-lab starter-lab--compact"><LauncherStage view="setup">
    <section className="starter-gallery starter-create" aria-label="New workspace">
      <div className="starter-gallery__heading"><button onClick={()=>transitionLauncher(onExit)} disabled={busy}>← Launcher</button><span>New workspace</span></div>
      {created ? <div className="starter-created" role="status">{starter?.preview && <div className="starter-created__preview"><Preview layout={starter.preview}/></div>}<span className="starter-created__mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path pathLength="1" d="m6 12 4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span><h2 ref={title} tabIndex={-1}>Workspace created</h2><p>{name} starts with {starter?.name ?? 'an empty workspace'}. Opening your workspace…</p><code>{created}</code></div> : <><form noValidate aria-busy={busy} id="starter-create-form" data-above={moreAbove} data-below={moreBelow} ref={form} onSubmit={event => {event.preventDefault(); void create()}}>
        <fieldset disabled={busy}>
          <div className="starter-create__intro"><h2>Create your workspace</h2><p>Choose a starter. We'll copy its layout and settings into a new folder you own.</p></div>
          <div className="starter-create__identity">
            <div className="starter-field"><label htmlFor="workspace-name">Name your workspace <span>Required</span></label><input id="workspace-name" aria-describedby="workspace-name-help" aria-invalid={attempted && !!nameProblem} autoComplete="off" placeholder="my-workspace" value={name} onChange={e=>setName(e.target.value)} required /><small id="workspace-name-help" data-error={attempted && !!nameProblem}>{attempted && nameProblem ? nameProblem : 'Also used as the new folder name.'}</small></div>
            <div className="starter-field starter-create__location"><label htmlFor="workspace-parent">Keep it in <span>Required</span></label><div><input id="workspace-parent" aria-describedby="workspace-parent-help" aria-invalid={attempted && !!parentProblem} placeholder="Choose a parent folder…" value={parent} onChange={e=>setParent(e.target.value)} required /><button type="button" aria-label="Choose a folder" onClick={async()=>{try {const folder=await host.dialog.pickPath('directory');if(folder)setParent(folder)}catch(e){setError(String(e))}}}><span aria-hidden="true">↗</span></button></div><small id="workspace-parent-help" data-error={attempted && !!parentProblem}>{attempted && parentProblem ? parentProblem : 'Existing files stay untouched.'}</small></div>
          </div>
          <div className="starter-create__section"><h3>Choose your starting workspace</h3><span>Illustrated layout previews</span></div>
          {!catalog ? <div className="starter-feedback" role={catalogFailed?'alert':'status'}><b>{catalogFailed?'Could not load starters':'Finding your starters…'}</b><p>{catalogFailed?error:'Reading the starters configured on this device.'}</p>{catalogFailed && <button type="button" onClick={()=>{setError('');setReloadCatalog(n=>n+1)}}>Try again</button>}</div> : catalog.templates.length ? <div ref={shelf} className="starter-gallery__shelf" data-before={scroll.overflow && !scroll.start} data-after={scroll.overflow && !scroll.end} role="radiogroup" aria-label="Starting workspace" onKeyDown={event => {
            const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
            if (!delta && event.key !== 'Home' && event.key !== 'End') return
            event.preventDefault()
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? catalog.templates.length-1 : (selected + delta + catalog.templates.length) % catalog.templates.length
            select(next)
            const button = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]
            button?.focus({preventScroll:true}); button?.scrollIntoView({block:'nearest',inline:'nearest'})
          }}>{catalog.templates.map((example,index) => <button type="button" role="radio" aria-checked={selected===index} tabIndex={selected===index?0:-1} key={example.source+'/'+example.path} onClick={() => select(index)}>
            <Preview layout={example.preview ?? {label:'Preview unavailable',kind:'empty'}} /><span className="starter-choice__name">{example.name}<span>{selected===index?'✓':''}</span></span>
          </button>)}</div> : <div className="starter-feedback"><b>Start with an empty workspace</b><p>No templates are available on this device. We can still create an empty workspace; you can add views after opening it.</p></div>}
          {scroll.overflow && <div className="starter-scroll-controls"><span>{catalog?.templates.length} starters · scroll to explore</span><button type="button" aria-label="Previous starters" disabled={scroll.start} onClick={()=>shelf.current?.scrollBy({left:-220,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}>←</button><button type="button" aria-label="More starters" disabled={scroll.end} onClick={()=>shelf.current?.scrollBy({left:220,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}>→</button></div>}
          <div className="starter-selection-detail">
            {starter && <header className="starter-selection-heading" aria-live="polite"><h2>{starter.name}</h2><p className="starter-create__summary">{starter.description}</p></header>}
            {!!starter?.highlights?.length && <ul className="starter-highlights">{starter.highlights.map((highlight,i)=><li key={i}><span>✓</span>{highlight}</li>)}</ul>}
            {!!starter?.packages?.length && <details className="starter-package-details"><summary><span>Included with {starter.name}</span><span className="starter-package-count">{starter.packages.length} packages</span><DisclosureChevron /></summary><p>The starter uses these packages. Bundles can make additional tools available; adding a package does not automatically add a pane.</p><ul>{starter.packages.map(name=><li key={name}><span className="starter-included-check" aria-label="Included">✓</span><div><b>{name}</b><span>{catalog?.sources.find(source=>source.name===name)?.description ?? 'Included by this starter.'}</span></div></li>)}</ul></details>}
            {starter && <span className="starter-origin">From {starter.source.split(/[/\\]/).pop()} · your copy can be changed independently</span>}
          </div>
          <details className="starter-bring"><summary><span>Add from this device<span>Optional content folders and tool packages</span></span><span className="starter-bring__toggle">{Object.keys(extras).filter(name=>!members.has(name)).length || ''}<DisclosureChevron /></span></summary>
            <div className="starter-bring__body"><p>Add content or tools already on this device. Editable lets you change the original source from this workspace. Reference makes its content and tools available without making it an editing target. Neither option copies the source or adds a type dependency.</p><input type="search" aria-label="Find a source" placeholder="Find notes, code or a package…" value={query} onChange={e=>setQuery(e.target.value)} /><p className="starter-bring__count">{sources.length} sources{sources.length>4?' · scroll to explore':''}</p><SourceList>
              {sources.map(source => <div className="starter-source" data-selected={!!extras[source.name]} key={source.name}><label><input type="checkbox" role="switch" aria-label={"Include "+source.name} checked={!!extras[source.name]} onChange={e=>setExtras(old=>{const next={...old};if(e.target.checked)next[source.name]='discover';else delete next[source.name];return next})} /><span>{source.name}<span className="starter-source__description">{source.description ?? 'Located on this device.'}</span><small title={source.path}>{source.path}</small></span></label><div className="starter-role-reveal" data-open={!!extras[source.name]} inert={!extras[source.name]}><div><fieldset className="starter-role"><legend>Use {source.name} as</legend>{(['discover','edit'] as const).map(role=><label key={role}><input type="radio" name={'source-role-'+source.name} checked={extras[source.name]===role} onChange={()=>setExtras(old=>({...old,[source.name]:role}))} /><span>{role==='discover'?'Reference':'Editable'}</span></label>)}</fieldset><p className="starter-role-help">{extras[source.name]==='edit'?'Edits affect the original source folder, shared with any other workspace using it.':'Available to this workspace as consumed content and tools; not an editable member.'}</p></div></div></div>)}
              {!sources.length && <p>No matching sources. You can connect more after setup.</p>}
            </SourceList></div>
          </details>
          {!!catalog?.warnings.length && <details className="starter-bring"><summary>Some starters or sources need attention</summary><ul>{catalog.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul></details>}
          <details className="starter-bring starter-connections"><summary><span>Connection settings<span>Engine and agent tools on this device</span></span><span className="starter-bring__toggle"><DisclosureChevron /></span></summary>
            <div className="starter-bring__body"><p>These settings tell Ars Umbris where its installed tools live. They apply on this device; they are not part of your starter.</p>
              <label className="starter-engine-path">Engine executable<span className="starter-field-note">Required to open a workspace</span><input value={config.binaryPath} onChange={e=>onConfigChange({binaryPath:e.target.value})} spellCheck={false} /></label>
              <McpSetup host={host} />
            </div>
          </details>


        </fieldset>
      </form>
          <div className="starter-action-region">{error && !catalogFailed && <div className="starter-feedback starter-create__error" role="alert"><b>{catalogFailed?'Starter discovery failed':'Could not complete this step'}</b><p>{error}</p></div>}<footer className="starter-gallery__footer"><span>{parent && name ? 'New folder: '+name : 'A new folder. Your own copy.'}</span><button className="starter-primary" type="submit" form="starter-create-form" disabled={!catalog || busy}>{busy?'Creating workspace…':'Create workspace'}<span>→</span></button></footer></div>
      </>}
    </section>
  </LauncherStage></div>
}
