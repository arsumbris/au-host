import {useEffect,useRef,useState,type PointerEvent as ReactPointerEvent,type KeyboardEvent as ReactKeyboardEvent} from 'react'
import {useResizeDrag,useDragStart} from '@arsumbris/container-kit'
import type {MountHost,ContextMenuItem} from '@arsumbris/au-host-sdk'
import '@arsumbris/au-component-catalog/react'

/** The container supplies geometry and commits; the shared splitter supplies presentation. */
export function ColumnSplitter({label,controls,value,minPixels,begin,onResize}: {
 label:string;controls:string;value:number;minPixels:number
 begin:(event:ReactPointerEvent)=>{onMove:(event:PointerEvent)=>void;onEnd?:(commit:boolean)=>void}|null
 onResize:(event:ReactKeyboardEvent<HTMLElement>)=>void
}) {
 const ref=useRef<HTMLElement>(null)
 const [minimum,setMinimum]=useState(0)
 const {onPointerDown,dragging}=useResizeDrag(begin)
 useEffect(()=>{
  const el=ref.current
  const before=el?.previousElementSibling
  const after=el?.nextElementSibling
  if(!before || !after) return
  const update=()=>{const total=before.getBoundingClientRect().height+after.getBoundingClientRect().height;setMinimum(total ? Math.min(50,100*minPixels/total) : 50)}
  const observer=new ResizeObserver(update)
  observer.observe(before);observer.observe(after);update()
  return ()=>observer.disconnect()
 },[minPixels])
 return <au-splitter ref={ref} orientation="horizontal" dragging={dragging} disabled={minimum>=50}
  aria-label={`Resize ${label}`} aria-controls={controls} aria-valuenow={Math.round(value)} aria-valuemin={Math.ceil(minimum)} aria-valuemax={Math.floor(100-minimum)}
  title="Drag to resize · Arrow keys to adjust · Shift for larger steps"
  onKeyDown={event=>{if(minimum<50) onResize(event)}}
  onPointerDown={event=>{if(event.button===0 && minimum<50) onPointerDown(event)}} />
}

/** Click/keyboard alternatives use the same container move operation as the pointer path. */
export function ColumnGrip({host,paneId,type,label,rows}: {
 host:MountHost;paneId:string;type?:string;label:string;rows:ContextMenuItem[]|(()=>ContextMenuItem[])
}) {
 const startDrag=useDragStart()
 const dragged=useRef(false)
 const menuRef=useRef<ReturnType<NonNullable<MountHost['contextMenu']>['open']>|null>(null)
 useEffect(()=>()=>menuRef.current?.close(),[])
 return <au-grip-glyph label={`Move ${label}`} title="Drag to move · Click or right-click for pane actions" aria-haspopup="menu"
  onClick={event=>{
   event.stopPropagation()
   if(dragged.current && event.detail>0) {dragged.current=false;return}
   dragged.current=false
   const trigger=event.currentTarget
   const menu=host.contextMenu?.open(trigger.getBoundingClientRect(),typeof rows==='function'?rows():rows)
   if(!menu) return
   menuRef.current=menu
   trigger.setAttribute('aria-expanded','true')
   void menu.closed?.then(()=>{if(menuRef.current!==menu)return;menuRef.current=null;trigger.setAttribute('aria-expanded','false');if(trigger.isConnected)trigger.focus()})
  }}
  onContextMenu={event=>{
   event.preventDefault();event.stopPropagation()
   event.currentTarget.click()
  }}
  onKeyDown={event=>{if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();event.currentTarget.click()}}}
  onPointerDown={event=>{
   event.stopPropagation()
   if(event.button!==0) return
   dragged.current=false
   startDrag(event,{containerKind:'column',localId:paneId,role:'pane',label,type,onDragStart:()=>{dragged.current=true}})
  }} />
}
