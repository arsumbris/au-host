import {useEffect, useState} from 'react'
import type {WorkspaceTemplateCatalog} from '@arsumbris/au-host-sdk'
import type {LauncherHost} from './launcher-host'
import {Preview} from './WorkspacePreview'
import {Button} from './design/Button/Button'
import './welcome.css'

/** Pre-graph welcome: illustrations describe available content, never choose a layout. */
export function Welcome({host,onCreate,onOpen}:{host:LauncherHost;onCreate:(template?:{source:string;path:string})=>void;onOpen:()=>void}) {
  const [unavailable,setUnavailable]=useState(false)
  const [catalog,setCatalog]=useState<WorkspaceTemplateCatalog|null>(null)
  useEffect(()=>{
    let cancelled=false
    void host.gate.workspaceTemplates().then(value=>{if(!cancelled)setCatalog(value)}).catch(()=>{if(!cancelled){setUnavailable(true);setCatalog({templates:[],sources:[],warnings:[]})}})
    return ()=>{cancelled=true}
  },[host])
  const previews=catalog?.templates.slice(0,3) ?? []
  return <section className="au-welcome" aria-label="Get started">
    <p className="au-welcome__intro">Create a workspace from a starter,<br/>or open a workspace you already have.</p>
    <div className="au-welcome__actions">
      <Button variant="cta" size="lg" onClick={()=>onCreate()}>Create a workspace <span aria-hidden="true">→</span></Button>
      <Button variant="ghost" onClick={onOpen}>Open an existing workspace…</Button>
    </div>
    <div className="au-welcome__glimpse" aria-label="Available starter previews" aria-busy={catalog===null}>
      {previews.length ? <>
        <div className="au-welcome__previews">{previews.map(template=><button type="button" className="au-welcome__starter" key={template.source+'/'+template.path} onClick={()=>onCreate({source:template.source,path:template.path})} aria-label={"Start with "+template.name}>
          {template.preview ? <Preview layout={template.preview}/> : <div className="au-welcome__unavailable">Preview unavailable</div>}
          <span className="au-welcome__starter-name">{template.name}<span aria-hidden="true"> →</span></span>
        </button>)}</div>
        <p>Choose a starter, then name your workspace</p>
      </> : <p>{catalog===null?'Finding available starters…':unavailable?'Starter previews are unavailable. You can retry in the next step.':'You can start empty and add your own views.'}</p>}
    </div>
  </section>
}
