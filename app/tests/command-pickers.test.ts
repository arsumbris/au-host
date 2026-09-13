import { expect, it, vi } from 'vitest'
vi.mock('../src/renderer/src/projections/pane-navigation',()=>({visiblePanes:()=>[]}))
import { pickerOptions } from '../src/renderer/src/projections/command-pickers'
import type { MountHost } from '@arsumbris/au-host-sdk'
it('offers unfamiliar discovered projections in stable name order without built-in promotion',async()=>{
 const host={describeProjections:()=>[{type:'zebra-lens::custom',repo:'custom',kinds:[]},{type:'alpha-canvas::custom',repo:'custom',kinds:[]}]} as unknown as MountHost
 expect((await pickerOptions('projections',host,{read:vi.fn()})).map(x=>x.id)).toEqual(['alpha-canvas::custom','zebra-lens::custom'])
})
it('lists catalogue assets as well as documents and preserves complete path identities',async()=>{
 const read=vi.fn().mockResolvedValue({ok:true,ready:true,result:{files:[{path:'/vault/z.png',repo:'vault',stem:'z',kind:'asset'},{path:'/vault/a.md',repo:'vault',stem:'a',kind:'markdown'}]}})
 const host={workspace:{members:[{name:'vault',root:'/vault'}]}} as MountHost
 const options=await pickerOptions('files',host,{read})
 expect(options.map(x=>x.id)).toEqual(['/vault/a.md','/vault/z.png'])
 expect(options.map(x=>x.detail)).toEqual(['vault / a.md','vault / z.png'])
 expect(read).toHaveBeenCalledWith({read:'files'})
})
