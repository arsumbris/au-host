import {describe, expect, it} from 'vitest'
import {readWorkspaceStartup, selectStartupPath} from '../src/renderer/src/projections/workspace-startup'
import type {WireReader} from '@arsumbris/au-host-sdk/engine-reads'

describe('authored workspace startup', () => {
  it('chooses the template target over a competing source, independently of names or discovery order', () => {
    expect(selectStartupPath(['/extra/a.yaml','/copy/z.yaml'],[],{kind:'composition',path:'/copy/z.yaml'})).toEqual({kind:'composition',path:'/copy/z.yaml'})
  })
  it('restores a valid user choice; stale recents do not displace the authored start', () => {
    expect(selectStartupPath(['a','b'],['b'],{kind:'composition',path:'a'})).toEqual({kind:'composition',path:'b'})
    expect(selectStartupPath(['a'],['gone'],{kind:'composition',path:'a'})).toEqual({kind:'composition',path:'a'})
  })
  it('keeps explicit empty starts empty despite discovered layouts and rejects non-compositions', () => {
    expect(selectStartupPath(['foreign'],[],{kind:'empty'})).toEqual({kind:'empty'})
    expect(selectStartupPath(['foreign'],[],{kind:'composition',path:'missing'}).kind).toBe('error')
    expect(selectStartupPath(['foreign'],[],{kind:'pending'}).kind).toBe('pending')
  })
  it('resolves only the entry startup with its real file origin, including qualified external references', async () => {
    const requests: unknown[]=[]
    const reader = {read: async (request: any) => {
      requests.push(request)
      return {ok:true,ready:true,result:{[request.read]:request.read==='files' ? [{path:'/entry/workspace-startup.yaml'}] : request.read==='instances_of'
        ? [{path:'/entry/workspace-startup.yaml',fields:{initialComposition:'[[layout::custom-source]]'}},{path:'/extra/workspace-startup.yaml',fields:{initialComposition:'[[wrong]]'}}]
        : {path:'/extra/layout.yaml'}}}
    }} as WireReader
    expect(await readWorkspaceStartup(reader,'/entry')).toEqual({kind:'composition',path:'/extra/layout.yaml'})
    expect(requests).toContainEqual({read:'resolve_target',target:'layout::custom-source',origin:'/entry/workspace-startup.yaml'})
  })
  it('does not require the new startup vocabulary in legacy workspaces without a startup file', async () => {
    const requests: unknown[] = []
    const reader = {read: async (request: any) => {
      requests.push(request)
      if (request.read !== 'files') throw new Error('legacy workspace has no startup type')
      return {ok:true,ready:true,result:{files:[]}}
    }} as WireReader
    expect(await readWorkspaceStartup(reader, '/legacy')).toEqual({kind:'legacy'})
    expect(requests).toHaveLength(1)
  })

})
