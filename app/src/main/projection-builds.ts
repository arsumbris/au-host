import { readFile, realpath } from 'node:fs/promises'
import { watchFile, unwatchFile } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { WebContents } from 'electron'
import { projectionBuildDirectory, projectionBuildManifest, publishProjectionBuild, retainProjectionBuild, releaseProjectionBuild, pruneProjectionBuilds, type ProjectionBuild } from '@arsumbris/au-host-sdk/build'
import { registerSource, unregisterSource } from './projection-sources'

async function readBuild(root: string): Promise<ProjectionBuild | undefined> {
  let text: string
  try { text = await readFile(projectionBuildManifest(root), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const build = JSON.parse(text) as ProjectionBuild
  if (!/^[a-z0-9-]+$/.test(build.revision) || typeof build.directory !== 'string') throw new Error('Invalid projection build publication')
  const directory = await realpath(build.directory)
  const builds = await realpath(projectionBuildDirectory(root))
  if (!directory.startsWith(builds + sep)) throw new Error('Projection publication escapes its build directory')
  return { revision: build.revision, directory }
}

export async function resolveProjectionSource(key: string, root: string, entry: string, fromDisk: boolean, development = true, owner = 0): Promise<string> {
  const packageRoot = await realpath(root)
  const file = resolve(packageRoot, entry)
  const subpath = relative(packageRoot, file)
  if (isAbsolute(subpath) || subpath.startsWith('..')) throw new Error('Projection entry escapes its package')
  if (fromDisk && !development) throw new Error('Projection development is disabled')
  const build = !development ? undefined : fromDisk
    ? await publishProjectionBuild(packageRoot, dirname(file))
    : await readBuild(packageRoot)
  const versionKey = build ? `${key}-${build.revision}` : key
  if (build) await retainProjectionBuild(build)
  await registerSource(versionKey, build?.directory ?? packageRoot)
  let source = retainedSources.get(versionKey)
  if (!source) {
    source = { root: packageRoot, build, owners: new Set() }
    retainedSources.set(versionKey, source)
  }
  source.owners.add(owner)
  return `au-projection://${versionKey}`
}

/** Each renderer owns its watchers; destroying it releases every polling handle. */
export function watchProjectionBuild(sender: WebContents, root: string): () => void {
  const manifest = projectionBuildManifest(root)
  let disposed = false
  const listener = (): void => {
    if (!disposed && !sender.isDestroyed()) sender.send('projection:build', { root })
  }
  watchFile(manifest, { persistent: false, interval: 250 }, listener)
  return () => { disposed = true; unwatchFile(manifest, listener) }
}

const retainedSources = new Map<string, { root: string; build?: ProjectionBuild; owners: Set<number> }>()

export async function releaseProjectionSources(owner: number): Promise<void> {
  const roots = new Set<string>()
  for (const [key, source] of retainedSources) {
    source.owners.delete(owner)
    if (source.owners.size) continue
    unregisterSource(key)
    retainedSources.delete(key)
    if (source.build && ![...retainedSources.values()].some(other => other.build?.directory === source.build?.directory)) {
      await releaseProjectionBuild(source.build)
      roots.add(source.root)
    }
  }
  for (const root of roots) await pruneProjectionBuilds(root)
}
