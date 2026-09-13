import { expect, it } from 'vitest'
import { resumeSelection } from '../src/main/resume-selection'
const record = {id:'kernel-id',run:2,lastActiveMs:1,sizeBytes:4,harness:'unfamiliar.adapter',resumeRef:'opaque recipe \' " --',profile:'[[restricted::profiles]]'}
it('selects adapter, opaque recipe and recorded profile from the kernel row',()=>{
 expect(resumeSelection([record],'kernel-id')).toEqual({adapter:'unfamiliar.adapter',options:{resumeRef:record.resumeRef,profile:record.profile}})
})
it('keeps bare profile absent rather than substituting a launcher default',()=>{
 expect(resumeSelection([{...record,profile:undefined}],record.id).options.profile).toBeUndefined()
})
it('rejects missing, retired and unlaunchable records',()=>{
 for(const records of [[],[{...record,harness:undefined}],[{...record,resumeRef:undefined}]]) expect(()=>resumeSelection(records,record.id)).toThrow('no longer dormant')
})
