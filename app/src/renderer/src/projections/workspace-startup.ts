import {UNSAVED_COMPOSITION} from '@arsumbris/au-host-sdk'
import {readFiles, readInstancesOf, readResolveTarget, type WireReader} from '@arsumbris/au-host-sdk/engine-reads'

export type StartupChoice = {kind: 'pending'} | {kind: 'legacy'} | {kind: 'empty'} | {kind: 'unsaved'} | {kind: 'composition'; path: string} | {kind: 'error'; message: string}

/** Only the entry's startup file controls launch; settings in consumed sources do not. */
export async function readWorkspaceStartup(reader: WireReader, entry: string): Promise<StartupChoice> {
  const origin = `${entry.replace(/\/$/, '')}/workspace-startup.yaml`
  const files = await readFiles(reader)
  if ('ok' in files && !files.ok) return {kind: 'error', message: files.error}
  if (!('ready' in files) || !files.ready) return {kind: 'pending'}
  if (!files.result.some(file => file.path === origin)) return {kind: 'legacy'}
  const response = await readInstancesOf(reader, 'workspace-startup::au-host-sdk', {origins: ['file']})
  if ('ok' in response && !response.ok) return {kind: 'error', message: response.error}
  if (!('ready' in response) || !response.ready) return {kind: 'pending'}
  const rows = response.result.filter(row => row.path === origin)
  if (!rows.length) return {kind: 'error', message: 'workspace-startup.yaml is not a valid workspace-startup configuration. Repair it or choose a composition.'}
  const reference = rows[0].fields.initialComposition
  if (reference === undefined) return {kind: 'empty'}
  if (typeof reference !== 'string') return {kind: 'error', message: 'The workspace initial composition must be a reference.'}
  const resolved = await readResolveTarget(reader, reference.startsWith('[[') && reference.endsWith(']]') ? reference.slice(2, -2) : reference, origin)
  if ('ok' in resolved && !resolved.ok) return {kind: 'error', message: resolved.error}
  if (!('ready' in resolved) || !resolved.ready) return {kind: 'pending'}
  if (!resolved.result?.path) return {kind: 'error', message: `Cannot resolve the initial composition ${reference}. Choose a composition or repair workspace-startup.yaml.`}
  return {kind: 'composition', path: resolved.result.path}
}

/**
 * What opens on launch. The most recently open composition wins: the unsaved one when it was last open and
 * its draft survives (`unsavedDraft`), else the most recent composition still on disk. Only then does the
 * entry's startup file decide.
 */
export function selectStartupPath(paths: string[], recent: string[], startup: StartupChoice, unsavedDraft = false): StartupChoice {
  if (startup.kind === 'pending') return startup
  if (recent[0] === UNSAVED_COMPOSITION && unsavedDraft) return {kind: 'unsaved'}
  const remembered = recent.find(path => paths.includes(path))
  if (remembered) return {kind: 'composition', path: remembered}
  if (startup.kind === 'composition' && !paths.includes(startup.path)) return {kind: 'error', message: 'The initial reference does not identify an available composition. Choose a composition or repair workspace-startup.yaml.'}
  if (startup.kind === 'legacy') return paths[0] ? {kind: 'composition', path: paths[0]} : {kind: 'empty'}
  return startup
}
