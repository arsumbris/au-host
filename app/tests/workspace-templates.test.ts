import {afterEach, describe, expect, it} from 'vitest'
import {cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import {parse, stringify} from 'yaml'
import {discoverWorkspaceTemplates, materializeWorkspace} from '../src/main/workspace-templates'
const roots: string[] = []
const baselines = path.resolve('tests/fixtures/workspace-templates')
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(),'au-template-test-')); roots.push(root)
  const paths = {hostConfig:path.join(root,'host'),engineConfig:path.join(root,'engine')}
  mkdirSync(paths.hostConfig);mkdirSync(paths.engineConfig)
  writeFileSync(path.join(paths.hostConfig,'workspace-template-repos.yaml'),stringify({repos:[{path:baselines}]}))
  writeFileSync(path.join(paths.engineConfig,'repos.yaml'),stringify({repos:[{name:'host-bundle',path:'/test/host'},{name:'mcp-bundle',path:'/test/mcp'},{name:'notes',path:'/test/notes',remote:'preserve-me'}]}))
  return {root,paths}
}
afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})))
describe('workspace starter materialization',()=>{
  it('preserves manifest order and exposes the authored skeleton',()=>{
    const {paths}=fixture(); const catalog=discoverWorkspaceTemplates(paths)
    expect(catalog.warnings).toEqual([])
    expect(catalog.templates.map(t=>t.name)).toEqual(['Blank','Full shell','Reader'])
    expect(catalog.templates[1].preview?.children).toHaveLength(3)
  })
  it('copies a full baseline, renames self, adds role, preserves source/deps and registers both indexes',()=>{
    const {root,paths}=fixture(); const original=readFileSync(path.join(baselines,'full-shell/.arsumbris/repo.yaml'),'utf8')
    const result=materializeWorkspace(paths,{parent:root,name:'my-notes',template:{source:baselines,path:'full-shell'},extras:[{name:'notes',role:'edit'}]})
    expect(result.ok,result.error).toBe(true)
    const read=(file:string)=>parse(readFileSync(file,'utf8'))
    const repo=read(path.join(result.entryPath!,'.arsumbris/repo.yaml'))
    expect(read(path.join(result.entryPath!,'workspace-startup.yaml'))).toEqual({type:'workspace-startup::au-host-sdk',initialComposition:'[[workspace-layout]]'})
    expect(repo.name).toBe('my-notes'); expect(repo.deps).toEqual(parse(original).deps)
    expect(read(path.join(result.entryPath!,'.arsumbris/workspace.yaml'))).toMatchObject({edit:['my-notes','notes'],discover:['host-bundle','mcp-bundle']})
    expect(readFileSync(path.join(result.entryPath!,'workspace-layout.yaml'),'utf8')).toBe(readFileSync(path.join(baselines,'full-shell/workspace-layout.yaml'),'utf8'))
    expect(readFileSync(path.join(baselines,'full-shell/.arsumbris/repo.yaml'),'utf8')).toBe(original)
    expect(read(path.join(paths.engineConfig,'workspaces.yaml')).workspaces).toContainEqual({name:'my-notes',path:result.entryPath})
    expect(read(path.join(paths.engineConfig,'repos.yaml')).repos).toContainEqual({name:'notes',path:'/test/notes',remote:'preserve-me'})
  })
  it('git-inits the created workspace: a real repo, one clean initial commit, scaffold tracked',()=>{
    const {root,paths}=fixture()
    const result=materializeWorkspace(paths,{parent:root,name:'gitted',template:{source:baselines,path:'blank'},extras:[]})
    expect(result.ok,result.error).toBe(true)
    const dir=result.entryPath!
    expect(existsSync(path.join(dir,'.git'))).toBe(true)
    const git=(args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim()
    expect(git(['status','--porcelain'])).toBe('')                 // no uncommitted changes (requirement A)
    expect(git(['rev-list','--count','HEAD'])).toBe('1')            // exactly one initial commit
    expect(git(['log','-1','--format=%an'])).toBe('au-host')        // explicit tool identity, no dependency on user git config
    expect(git(['ls-files']).split('\n')).toEqual(expect.arrayContaining(['.arsumbris/repo.yaml','workspace-startup.yaml']))
  })
  it('refuses an existing folder and duplicate identity without modifying it',()=>{
    const {root,paths}=fixture();mkdirSync(path.join(root,'existing'));writeFileSync(path.join(root,'existing/keep'),'unchanged')
    const request={parent:root,name:'existing',template:{source:baselines,path:'blank'},extras:[]}
    expect(materializeWorkspace(paths,request).ok).toBe(false)
    expect(readFileSync(path.join(root,'existing/keep'),'utf8')).toBe('unchanged')
    expect(materializeWorkspace(paths,{...request,name:'notes'}).ok).toBe(false)
  })
  it('surfaces broken sources, supplies the bare floor and never replaces malformed registries',()=>{
    const {root,paths}=fixture()
    writeFileSync(path.join(paths.hostConfig,'workspace-template-repos.yaml'),stringify({repos:[{path:root}]}))
    expect(discoverWorkspaceTemplates(paths).warnings).toHaveLength(1)
    const result=materializeWorkspace(paths,{parent:root,name:'empty',extras:[]})
    expect(result.ok,result.error).toBe(true)
    expect(readdirSync(result.entryPath!).sort()).toEqual(['.arsumbris', '.git', 'workspace-startup.yaml'])
    writeFileSync(path.join(paths.engineConfig,'repos.yaml'),'repos: [broken')
    expect(materializeWorkspace(paths,{parent:root,name:'another',extras:[]}).ok).toBe(false)
    expect(readFileSync(path.join(paths.engineConfig,'repos.yaml'),'utf8')).toBe('repos: [broken')
  })
})

describe('portable startup materialization', () => {
  it('preserves an ordinary startup file and renames only its self-qualified reference', () => {
    const {root,paths}=fixture()
    const source=path.join(root,'templates')
    cpSync(baselines,source,{recursive:true})
    writeFileSync(path.join(source,'blank/workspace-startup.yaml'),stringify({type:'workspace-startup::au-host-sdk',initialComposition:'[[custom-layout::blank]]'}))
    writeFileSync(path.join(paths.hostConfig,'workspace-template-repos.yaml'),stringify({repos:[{path:source}]}))
    for(const name of ['first-copy','second-copy']){
      const result=materializeWorkspace(paths,{parent:root,name,template:{source,path:'blank'},extras:[]})
      expect(result.ok,result.error).toBe(true)
      expect(parse(readFileSync(path.join(result.entryPath!,'workspace-startup.yaml'),'utf8')).initialComposition).toBe(`[[custom-layout::${name}]]`)
    }
    expect(parse(readFileSync(path.join(source,'blank/workspace-startup.yaml'),'utf8')).initialComposition).toBe('[[custom-layout::blank]]')
  })
  it('refuses competing manifest and copied startup declarations before publishing', () => {
    const {root,paths}=fixture(), source=path.join(root,'templates')
    cpSync(baselines,source,{recursive:true})
    writeFileSync(path.join(source,'reader/workspace-startup.yaml'),stringify({type:'workspace-startup::au-host-sdk',initialComposition:'[[other]]'}))
    writeFileSync(path.join(paths.hostConfig,'workspace-template-repos.yaml'),stringify({repos:[{path:source}]}))
    const result=materializeWorkspace(paths,{parent:root,name:'conflict',template:{source,path:'reader'},extras:[]})
    expect(result.ok).toBe(false)
    expect(result.error).toContain('different initial compositions')
    expect(readdirSync(root)).not.toContain('conflict')
  })
})
