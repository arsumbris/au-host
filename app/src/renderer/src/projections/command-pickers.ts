import { displayFilePath } from '@arsumbris/au-host-sdk'
import type { MountHost } from '@arsumbris/au-host-sdk'
import { readFiles, type WireReader } from '@arsumbris/au-host-sdk/engine-reads'
import { descriptorLabel } from '@arsumbris/container-core'
import type { PaletteOption } from './SearchPalette'
import { visiblePanes } from './pane-navigation'

export type PickerMode = 'projections' | 'files' | 'panes'
/** Inventory only: selection emits an intent; compositions and capabilities decide its destination. */
export async function pickerOptions(mode: PickerMode, host: MountHost, reader: WireReader): Promise<PaletteOption[]> {
  if(mode==='projections') return (host.describeProjections?.() ?? host.listProjections().map(type=>({type,repo:'',kinds:[]})))
    .map(item=>({id:item.type,label:descriptorLabel(item),detail:item.type}))
    .sort((a,b)=>a.label.localeCompare(b.label)||a.id.localeCompare(b.id))
  if(mode==='panes') return visiblePanes().map(pane=>({id:pane.id,label:pane.label,detail:pane.id}))
    .sort((a,b)=>a.id.localeCompare(b.id))
  const result=await readFiles(reader)
  if(!('ready' in result) || !result.ready || !result.result) throw new Error('The workspace file catalogue is not ready.')
  return result.result.map(file=>({id:file.path,label:file.path.split('/').pop() ?? file.path,detail:displayFilePath(file.path, host.workspace.members)}))
    .sort((a,b)=>a.id.localeCompare(b.id))
}
