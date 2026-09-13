import { parse } from 'yaml'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readPreviewMutation, readSubtypes } from '@arsumbris/au-engine-sdk/reads'
import { saveProfile } from '../src/main/profiles'
import type { EngineConnections } from '../src/main/engine-connections'
vi.mock('@arsumbris/au-engine-sdk/reads', () => ({ readPreviewMutation: vi.fn(), readSubtypes: vi.fn() }))
const preview = vi.mocked(readPreviewMutation)
const writeFile = vi.fn(async (..._args: unknown[]) => ({ok:true}))
const readFile = vi.fn(async () => ({ok:true,hash:'existing-hash'}))
const engine = {wireReader:async()=>({}),readFile,writeFile} as unknown as EngineConnections
const valid = {ready:true as const,result:{target:{path:'/workspace/operations/agent-profile/Study.yaml',hash:'hash',identities:[{name:'agent-profile',repo:'au-mcp-sdk',hash:'type-hash'}],diagnostics:[]},blast_radius:[]}}
beforeEach(()=>{vi.clearAllMocks();preview.mockResolvedValue(valid);vi.mocked(readSubtypes).mockResolvedValue({ready:true,result:{subtypes:[{name:"mcp.adapter.custom",repo:"custom-vendored-adapter"}]}} as never)})
describe('profile save validation',()=>{
 it('refuses ignored files before writing',async()=>{
  preview.mockResolvedValue({...valid,result:{...valid.result,target:{...valid.result.target,hash:null,identities:[]}}})
  expect(await saveProfile(engine,'/workspace','Study',{})).toMatchObject({ok:false,error:expect.stringContaining('scope')})
  expect(writeFile).not.toHaveBeenCalled()
 })
 it('refuses a not-ready engine before writing',async()=>{
  preview.mockResolvedValue({ready:false})
  expect((await saveProfile(engine,'/workspace','Study',{})).ok).toBe(false)
  expect(writeFile).not.toHaveBeenCalled()
 })
 it('surfaces a structural rejection',async()=>{
  preview.mockResolvedValue({ready:true,result:{reject:{message:'Outside workspace'}}})
  expect(await saveProfile(engine,'/workspace','Study',{})).toEqual({ok:false,error:'Outside workspace'})
  expect(writeFile).not.toHaveBeenCalled()
 })
 it('updates the discovered source rather than creating an entry-local duplicate',async()=>{
  await saveProfile(engine,'/workspace','Study',{path:'/workspace/content/profiles/Study.yaml',tools:[],adapter:'mcp.adapter.custom'})
  expect(writeFile).toHaveBeenCalledWith('/workspace','/workspace/content/profiles/Study.yaml',expect.stringContaining('tools: []'),'existing-hash')
  expect(parse(String(writeFile.mock.calls[0]?.[2])).adapter).toBe('[[mcp.adapter.custom::custom-vendored-adapter]]')
 })
 it('creates a validated named profile in the entry without inventing restrictions',async()=>{
  await saveProfile(engine,'/workspace','Study',{})
  expect(writeFile).toHaveBeenCalledWith('/workspace','/workspace/operations/agent-profile/Study.yaml',expect.any(String),'existing-hash')
  expect(parse(String(writeFile.mock.calls[0]?.[2]))).not.toHaveProperty('tools')
 })
})

it('does not write an unqualified adapter when discovery is unavailable', async () => {
 vi.mocked(readSubtypes).mockResolvedValue({ready:false})
 expect((await saveProfile(engine,'/workspace','Study',{adapter:'mcp.adapter.custom'})).ok).toBe(false)
 expect(writeFile).not.toHaveBeenCalled()
})
it('Ask at start omits the adapter and does not require adapter discovery', async () => {
 await saveProfile(engine,'/workspace','Study',{})
 expect(parse(String(writeFile.mock.calls[0]?.[2]))).not.toHaveProperty('adapter')
 expect(readSubtypes).not.toHaveBeenCalled()
})
