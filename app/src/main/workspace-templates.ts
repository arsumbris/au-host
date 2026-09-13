import {cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {parse, stringify} from 'yaml'
import type {MaterializeWorkspaceRequest, WorkspaceTemplateCatalog, LocatedWorkspaceTemplate, WorkspaceTemplatePreview} from '@arsumbris/au-host-sdk'
import {initGitRepo} from './gate-create'

/** Explicit paths allow isolated tests without changing the engine SDK's device-path semantics. */
export interface TemplateDevicePaths { hostConfig: string; engineConfig: string }
type Doc = Record<string, unknown>
function document(file: string, missing: Doc = {}): Doc {
  if (!existsSync(file)) return missing
  const value: unknown = parse(readFileSync(file, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Cannot read configuration: ${file}`)
  return value as Doc
}
function rows(doc: Doc, key: string): Doc[] {
  if (doc[key] === undefined) return []
  if (!Array.isArray(doc[key]) || doc[key].some(v => !v || typeof v !== 'object' || Array.isArray(v))) throw new Error(`Invalid ${key} list`)
  return doc[key] as Doc[]
}
function names(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) throw new Error('Invalid workspace member list')
  return value as string[]
}
function templateFolder(source: string, relative: string): string {
  if (!relative || path.isAbsolute(relative)) throw new Error('Template path must be relative')
  const root = realpathSync(source)
  const folder = realpathSync(path.resolve(root, relative))
  if (!folder.startsWith(root + path.sep)) throw new Error('Template must be inside its source folder')
  return folder
}
function preview(value: unknown, depth = 0): WorkspaceTemplatePreview | undefined {
  if (!value || typeof value !== 'object' || depth > 4) return undefined
  const p = value as Doc
  const children = Array.isArray(p.children) ? p.children.slice(0, 8).map(child => preview(child, depth+1)).filter((child): child is WorkspaceTemplatePreview => !!child) : undefined
  return {axis: p.axis === 'column' ? 'column' : 'row', children,
    label: typeof p.label === 'string' ? p.label.slice(0,80) : undefined,
    kind: typeof p.kind === 'string' && ['tree','document','list','terminal','empty'].includes(p.kind) ? p.kind : 'empty',
    weight: typeof p.weight === 'number' && Number.isFinite(p.weight) ? Math.max(.1,Math.min(20,p.weight)) : 1}
}
function readTemplate(source: string, entry: Doc): LocatedWorkspaceTemplate {
  if (typeof entry.path !== 'string' || typeof entry.name !== 'string' || typeof entry.description !== 'string') throw new Error('Template needs a path, name and description')
  if (entry.initialComposition !== undefined && (typeof entry.initialComposition !== 'string' || !/^\[\[[^\]\r\n]+\]\]$/.test(entry.initialComposition))) throw new Error('Initial composition must be a composition wikilink')
  const folder = templateFolder(source, entry.path)
  const repo = document(path.join(folder, '.arsumbris/repo.yaml'))
  const workspace = document(path.join(folder, '.arsumbris/workspace.yaml'))
  if (typeof repo.name !== 'string' || !names(workspace.edit).includes(repo.name)) throw new Error('Template must declare its own workspace identity')
  return {path: entry.path, name: entry.name, description: entry.description, source,
    initialComposition: entry.initialComposition as string | undefined,
    highlights: Array.isArray(entry.highlights) ? entry.highlights.filter((v): v is string => typeof v === 'string').slice(0,6) : undefined,
    packages: [...new Set([...rows(repo, 'deps').flatMap(dep => typeof dep.name === 'string' ? [dep.name] : []), ...names(workspace.edit).filter(name => name !== repo.name), ...names(workspace.discover)])],
    preview: preview(entry.preview),
    members: (['edit','discover'] as const).flatMap(role => names(workspace[role]).filter(name => name !== repo.name).map(name => ({name, role}))),
  }
}
export function discoverWorkspaceTemplates(paths: TemplateDevicePaths): WorkspaceTemplateCatalog {
  const result: WorkspaceTemplateCatalog = {templates: [], sources: [], warnings: []}
  try {
    for (const entry of rows(document(path.join(paths.engineConfig, 'repos.yaml')), 'repos')) {
      if (typeof entry.name !== 'string' || typeof entry.path !== 'string') throw new Error('Invalid located repository')
      let description: string | undefined
      try {const repo = document(path.join(entry.path, '.arsumbris/repo.yaml')); if(typeof repo.description === 'string') description=repo.description} catch { /* A located source remains selectable even when its descriptive metadata is unavailable. */ }
      result.sources.push({name: entry.name, path: entry.path, description})
    }
  } catch (e) { result.warnings.push(String(e)) }
  try {
    for (const source of rows(document(path.join(paths.hostConfig, 'workspace-template-repos.yaml')), 'repos')) {
      try {
        if (typeof source.path !== 'string' || !path.isAbsolute(source.path)) throw new Error('Template source needs an absolute path')
        const manifest = path.join(source.path, 'workspace-templates.yaml')
        if (!existsSync(manifest)) throw new Error(`Missing template list: ${source.path}`)
        for (const entry of rows(document(manifest), 'templates')) {
          try { result.templates.push(readTemplate(source.path, entry)) }
          catch (e) { result.warnings.push(`${source.path}: ${String(e)}`) }
        }
      } catch (e) { result.warnings.push(String(e)) }
    }
  } catch (e) { result.warnings.push(String(e)) }
  return result
}
function assertCopyable(folder: string): void {
  for (const entry of readdirSync(folder)) {
    const file = path.join(folder, entry), stat = lstatSync(file)
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`Template contains a link or special file: ${entry}`)
    if (stat.isDirectory()) assertCopyable(file)
  }
}
/** Copy first; publish only validated content. Never copy over an existing destination or identity. */
export function materializeWorkspace(paths: TemplateDevicePaths, request: MaterializeWorkspaceRequest): {ok: boolean; entryPath?: string; error?: string} {
  let staging: string | undefined
  try {
    const name = request.name.trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error('Use a name starting with a letter or number, followed by letters, numbers, dots, dashes or underscores.')
    const parent = realpathSync(request.parent)
    if (!lstatSync(parent).isDirectory()) throw new Error('Choose a folder for your workspace')
    const target = path.join(parent, name)
    if (existsSync(target)) throw new Error('That folder already exists. Choose another name or open it instead.')
    const catalog = discoverWorkspaceTemplates(paths)
    const template = request.template && catalog.templates.find(t => t.source === request.template?.source && t.path === request.template.path)
    if (request.template && !template) throw new Error('This starter is no longer available. Choose another starter.')
    if (!request.template && catalog.templates.length) throw new Error('Choose a starter before creating your workspace.')
    const reposFile = path.join(paths.engineConfig, 'repos.yaml'), workspacesFile = path.join(paths.engineConfig, 'workspaces.yaml')
    const repos = document(reposFile), workspaces = document(workspacesFile)
    const repoRows = rows(repos, 'repos'), workspaceRows = rows(workspaces, 'workspaces')
    if (repoRows.some(r => r.name === name) || workspaceRows.some(r => (r.name ?? (typeof r.path === 'string' ? path.basename(r.path) : undefined)) === name)) throw new Error('That workspace name is already registered. Choose another name.')
    const located = new Map(repoRows.map(r => [r.name, r.path]))
    for (const extra of request.extras) if (!located.has(extra.name) || !['edit','discover'].includes(extra.role)) throw new Error('A selected source is no longer available.')
    staging = mkdtempSync(path.join(parent, '.au-create-'))
    if (template) {
      const source = templateFolder(template.source, template.path)
      assertCopyable(source)
      cpSync(source, staging, {recursive: true, force: false, errorOnExist: true})
    } else {
      mkdirSync(path.join(staging, '.arsumbris'))
      writeFileSync(path.join(staging, '.arsumbris/repo.yaml'), stringify({type:'au.engine.repo::au-engine', name}))
      writeFileSync(path.join(staging, '.arsumbris/workspace.yaml'), stringify({type:'au.engine.workspace::au-engine', edit:[name], discover:['host-bundle','mcp-bundle']}))
    }
    const repoFile = path.join(staging, '.arsumbris/repo.yaml'), workspaceFile = path.join(staging, '.arsumbris/workspace.yaml')
    const repo = document(repoFile), workspace = document(workspaceFile), previousName = repo.name
    repo.name = name
    workspace.edit = names(workspace.edit).map(member => member === previousName ? name : member)
    const declared = new Set([...names(workspace.edit), ...names(workspace.discover)])
    for (const extra of request.extras) {
      if (declared.has(extra.name)) continue
      workspace[extra.role] = [...names(workspace[extra.role]), extra.name]
      declared.add(extra.name)
    }
    const startupFile = path.join(staging, 'workspace-startup.yaml')
    const startup = existsSync(startupFile) ? document(startupFile) : {type: 'workspace-startup::au-host-sdk'}
    if (startup.type !== 'workspace-startup::au-host-sdk') throw new Error('workspace-startup.yaml must declare workspace-startup::au-host-sdk.')
    if (template?.initialComposition !== undefined) {
      if (startup.initialComposition !== undefined && startup.initialComposition !== template.initialComposition) throw new Error('The manifest and workspace-startup.yaml declare different initial compositions.')
      startup.initialComposition = template.initialComposition
    }
    if (startup.initialComposition !== undefined) {
      if (typeof startup.initialComposition !== 'string' || !/^\[\[[^\]\r\n]+\]\]$/.test(startup.initialComposition)) throw new Error('Initial composition must be a composition wikilink')
      const selfQualifier = `::${previousName}]]`
      if (startup.initialComposition.endsWith(selfQualifier)) startup.initialComposition = startup.initialComposition.slice(0, -selfQualifier.length) + `::${name}]]`
    }
    writeFileSync(startupFile, stringify(startup))
    const deps = rows(repo, 'deps')
    if (!deps.some(dep => dep.name === 'au-host-sdk')) repo.deps = [...deps, {name: 'au-host-sdk'}]
    writeFileSync(repoFile, stringify(repo)); writeFileSync(workspaceFile, stringify(workspace))
    // Refuse broken registration rather than producing a workspace that cannot find its members.
    for (const member of declared) if (member !== name && !located.has(member)) throw new Error(`Locate ${member} before creating this workspace.`)
    // Make the new workspace a git working tree with one clean initial commit, in staging so the `.git`
    // publishes atomically with the content via the rename below. Best-effort + skips a starter that
    // already carries its own `.git` (see initGitRepo). The engine's refactors + clean-at-HEAD guard need it.
    initGitRepo(staging, name)
    mkdirSync(paths.engineConfig, {recursive:true})
    const repoBefore = existsSync(reposFile) ? readFileSync(reposFile) : undefined
    const workspacesBefore = existsSync(workspacesFile) ? readFileSync(workspacesFile) : undefined
    mkdirSync(target) // exclusive destination reservation; never replace a concurrently created folder
    try {renameSync(staging, target); staging = undefined}
    catch (error) {try {rmdirSync(target)} catch { /* Preserve a destination changed by another actor. */ } throw error}
    try {
      writeFileSync(reposFile, stringify({...repos, repos:[...repoRows,{name,path:target}]}))
      writeFileSync(workspacesFile, stringify({...workspaces, workspaces:[...workspaceRows,{name,path:target}]}))
    } catch (error) {
      // Restore only this synchronous transaction's owned writes; report any rollback failure.
      if (repoBefore) writeFileSync(reposFile, repoBefore); else rmSync(reposFile, {force:true})
      if (workspacesBefore) writeFileSync(workspacesFile, workspacesBefore); else rmSync(workspacesFile, {force:true})
      rmSync(target, {recursive:true, force:true})
      throw error
    }
    return {ok:true, entryPath:target}
  } catch (e) { return {ok:false,error:e instanceof Error ? e.message : String(e)} }
  finally { if (staging) rmSync(staging, {recursive:true,force:true}) }
}
