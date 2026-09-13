import { defineProjection, type MountFn } from '@arsumbris/au-host-sdk'
import { viewerSwitchSets, runViewerSwitch } from '@arsumbris/container-core'
import { isFileSelection, fileSelection, type Selection } from '@arsumbris/selection'
import { isOpenIntent } from '@arsumbris/intent'
import { createViewer, button, type ViewerKind, type Viewer, type ViewState } from './viewers'
import { resolveExternalFile } from './resolve-file'
import css from './style.css?inline'
import documentControlsCss from '@arsumbris/style/document-controls.css?inline'

const metadata = import.meta.glob('../type/*.type.yaml', { query: '?raw', eager: true, import: 'default' }) as Record<string, string>
function projection(kind: ViewerKind) {
  const extensions = new Set(metadata[`../type/${kind}-viewer.type.yaml`].match(/opens: \[([^\]]+)\]/)?.[1].split(',').map(value => value.trim()) ?? [])
  const mount: MountFn = (container, host) => {
    const root=document.createElement('section');root.className=`mv-root au-document-view mv-${kind}-root`
    const toolbar=document.createElement('div');toolbar.className='mv-toolbar au-document-toolbar';toolbar.setAttribute('aria-label','Preview controls')
    const tools=document.createElement('div');tools.className='mv-tools'
    const actions=document.createElement('div');actions.className='mv-actions'
    const body=document.createElement('div');body.className='mv-body'
    const status=document.createElement('div');status.className='mv-status';status.setAttribute('role','status')
    toolbar.append(tools,actions);root.append(toolbar,body,status);container.append(root)
    const offStyle=host.styles?.inject(css + documentControlsCss,container)
    let file='',revision=0,alive=true,viewer: Viewer|undefined
    const report=(message:string, failed=false)=>{
      const loading=message==='Loading preview…'
      root.setAttribute('aria-busy',String(loading))
      status.textContent=message;status.tabIndex=failed&&!loading?0:-1;root.dataset.state=failed?'empty':'ready'
      if(failed){
        const empty=document.createElement('au-empty-state')
        const noun=kind==='pdf'?'PDF':kind==='html'?'HTML preview':kind
        empty.setAttribute('label',!file?`No ${noun} selected`:loading?`Loading ${noun}…`:`${noun[0].toUpperCase()+noun.slice(1)} unavailable`)
        if(!loading)empty.setAttribute('hint',message)
        else {
          const spinner=document.createElement('au-spinner')
          spinner.setAttribute('size','sm');spinner.setAttribute('aria-hidden','true')
          spinner.slot='icon';empty.append(spinner)
        }
        if(file&&!loading){
          const retry=button(`Retry ${noun}`, ()=>{void open(file).catch(error=>report(String(error),true))})
          retry.slot='action';empty.append(retry)
        }
        status.replaceChildren(empty)
      }
    }
    const reportActionError=(message:string)=>{if(alive)report(message,root.dataset.state==='empty')}
    report('Choose a file from the file tree to preview.',true)
    const switcher=document.createElement('au-viewer-switch')
    let switching=false
    let primaryGroup:'viewers'|'openers'='viewers'
    const runSwitch=async(group:'viewers'|'openers')=>{
      if(!file||!host.instanceId||switching)return
      switching=true;switcher.setAttribute('disabled','');switcher.setAttribute('aria-busy','true')
      try {
        const outcome=await runViewerSwitch(host,file,group)
        if(outcome.kind==='none')reportActionError('No other way to open this file is available.')
        else if(outcome.kind==='refused')reportActionError('This pane cannot change its viewer.')
      } catch(error){reportActionError(String(error))}
      finally {
        switching=false
        if(alive){switcher.removeAttribute('disabled');switcher.removeAttribute('aria-busy')}
      }
    }
    switcher.addEventListener('au-activate',()=>{void runSwitch(primaryGroup)})
    switcher.addEventListener('au-more',()=>{void runSwitch('openers')})
    const external=button('Open externally',()=>{void (async()=>{
      const source=file,request=revision
      const path=await resolveExternalFile(host.engine,source)
      if(!alive||request!==revision)return
      if(!path){reportActionError('The file could not be resolved.');return}
      const error=await host.shell?.openPath(path);if(error)reportActionError(error)
    })().catch(error=>reportActionError(String(error)))})
    external.hidden=!host.shell
    external.setAttribute('disabled','')
    actions.append(external,button('Full screen',()=>{void (document.fullscreenElement?document.exitFullscreen():root.requestFullscreen()).catch(()=>reportActionError('Full screen is unavailable here.'))}))
    const open=async(next:string)=>{
      const request=++revision;viewer?.destroy();viewer=undefined;file=next;body.replaceChildren();tools.replaceChildren();switcher.remove()
      external.toggleAttribute('disabled',!next)
      if(!next){report('Choose a file from the file tree to preview.',true);return}
      report('Loading preview…',true)
      if(host.instanceId){
        const sets=viewerSwitchSets(host,next)
        primaryGroup=sets.viewers.length?'viewers':'openers'
        const primary=sets[primaryGroup]
        if(primary.length){
          switcher.setAttribute('primary-label',primary.length===1?primary[0].label:'Open with')
          switcher.toggleAttribute('has-more',sets.viewers.length>0&&sets.openers.length>0)
          root.prepend(switcher)
        }
      }
      const url=await host.assets?.url(next)
      if(!alive||request!==revision)return
      if(!url){report(kind==='image'?'The host could not resolve this image. Retry, or reopen it from the workspace.':`Could not load ${next.split('/').pop()}. Check that the file still exists in this workspace.`,true);return}
      const name=next.split('/').pop()??next
      const stored=host.viewStore.get(next);const state=(stored && typeof stored==='object'?stored:{}) as ViewState
      viewer=createViewer(kind,url,name,state,s=>host.viewStore.set(s,next),report)
      body.append(viewer.element);tools.append(...viewer.controls)
      host.viewState?.publish('pane-title',name)
      host.openSurfaces?.setContent([{identity:`file:${next}`,payload:fileSelection(next)}])
    }
    const reflect=(config:unknown)=>{const next=(config as {file?:unknown})?.file;if(typeof next==='string'&&next!==file)void open(next).catch(error=>{if(alive)report(String(error),true)})}
    const offConfig=host.onOwnConfigChange?.(reflect)
    const offOpen=host.intent.handle('open-intent',{
      claim:(intent)=>{
        if(!isOpenIntent(intent))return false
        const target=intent.target as Selection
        return isFileSelection(target)&&extensions.has(target.path.split('.').pop()?.toLowerCase()??'')
      },
      commit:(intent)=>{
        if(!isOpenIntent(intent))return
        const target=intent.target as Selection
        if(!isFileSelection(target))return
        // The host selects this projection through its opens-meta declaration.
        void open(target.path).catch(error=>{if(alive)report(String(error),true)})
      },
    })
    reflect(host.config)
    return()=>{alive=false;revision++;viewer?.destroy();offConfig?.();offOpen();offStyle?.();root.remove()}
  }
  return mount
}
export default defineProjection({image:projection('image'),pdf:projection('pdf'),audio:projection('audio'),video:projection('video'),html:projection('html')})
