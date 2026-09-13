import type {CSSProperties} from 'react'
import type {WorkspaceTemplatePreview as Layout} from '@arsumbris/au-host-sdk'
import './workspace-create.css'

function Skeleton({layout}: {layout: Layout}) {
  const style = {flex: `${layout.weight ?? 1} 1 0`} as CSSProperties
  if (layout.children?.length) return <div className="starter-layout" style={{...style, flexDirection: layout.axis === 'column' ? 'column' : 'row'}}>{layout.children.map((child, i) => <Skeleton layout={child} key={i} />)}</div>
  return <div className={`starter-pane starter-pane--${layout.kind}`} style={style}>
    <div className="starter-pane__bar"><span>{layout.label}</span><i /></div>
    <div className="starter-pane__content">
      {layout.kind === 'empty' ? <div className="starter-empty"><span>＋</span><span>A space to make yours</span></div> :
        Array.from({length: layout.kind === 'terminal' ? 3 : 7}, (_, i) => <div className="starter-line" key={i}><i /><b /></div>)}
    </div>
  </div>
}

export function Preview({layout}: {layout: Layout}) {
  return <div className="starter-window" aria-hidden="true"><div className="starter-window__chrome"><span><i /><i /><i /></span><b /><i /></div><Skeleton layout={layout} /></div>
}


