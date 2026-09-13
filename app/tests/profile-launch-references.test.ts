import {expect,it,vi} from 'vitest'
import {resolveLaunch} from '../../projections/agent-sessions/src/model'
const profile={name:'default',path:'/vault/profiles/default.yaml',inject:['[[co-inhabitant]]']}
const skills={skills:[],skipped:[]}
const injects={injects:[{key:'vault:context',path:'/vault/inject/co-inhabitant.md',owner:'vault'},{key:'other:context',path:'/other/inject/co-inhabitant.md',owner:'other'}],skipped:[]}
it('resolves bare context in the profile origin instead of picking a same-name manifest item',async()=>{
 const read=vi.fn().mockResolvedValue({ok:true,ready:true,result:{resolve_target:{path:'/vault/inject/co-inhabitant.md'}}})
 const result=await resolveLaunch(profile,skills,injects as never,{read} as never)
 expect(read).toHaveBeenCalledWith({read:'resolve_target',target:'co-inhabitant',origin:profile.path})
 expect(result.inject).toEqual(['vault:context'])
})
it('uses engine resolution for qualified and path links too',async()=>{
 const read=vi.fn().mockResolvedValue({ok:true,ready:true,result:{resolve_target:{path:'/other/inject/co-inhabitant.md'}}})
 expect((await resolveLaunch({...profile,inject:['[[inject/co-inhabitant::other]]']},skills,injects as never,{read} as never)).inject).toEqual(['other:context'])
})
it('does not guess when the engine cannot resolve a link',async()=>{
 const read=vi.fn().mockResolvedValue({ok:true,ready:true,result:{resolve_target:null}})
 await expect(resolveLaunch(profile,skills,injects as never,{read} as never)).rejects.toThrow('Missing context')
})
it('preserves omitted and empty selections without querying the engine',async()=>{
 const read=vi.fn()
 const result=await resolveLaunch({name:'empty',skills:[],inject:undefined},skills,injects as never,{read} as never)
 expect(result.skills).toEqual([]);expect(result.inject).toBeUndefined();expect(read).not.toHaveBeenCalled()
})
