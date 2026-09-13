import { randomUUID } from 'node:crypto'
import { cp, mkdir, rename, writeFile, readdir, rm, stat, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { auRepoDir } from '@arsumbris/au-engine-sdk'

/** A completed build, published atomically after its immutable files are available. */
export interface ProjectionBuild {
  revision: string
  directory: string
}

/**
 * The `.arsumbris/<owner>/` tenant the projection build-cache lives under, in the projection's OWN repo.
 * Framework-neutral by design: it names au-host-sdk (the SDK that owns this build-publish convention and
 * exports both `projectionLiveReload` and `publishProjectionBuild`), NOT the consuming app. So an author's
 * build plugin and any host app built on the framework rendezvous at the same, app-agnostic cache path.
 */
export const PROJECTION_BUILD_OWNER = 'au-host-sdk'

export function projectionBuildDirectory(packageRoot: string): string {
  return join(auRepoDir(packageRoot, PROJECTION_BUILD_OWNER, 'cache'), 'projection-builds')
}

export function projectionBuildManifest(packageRoot: string): string {
  return join(projectionBuildDirectory(packageRoot), 'current.json')
}

/** Publish a successful output directory. Call only after the build has finished writing. */
export async function publishProjectionBuild(packageRoot: string, outputDirectory: string): Promise<ProjectionBuild> {
  const root = resolve(packageRoot)
  const output = resolve(root, outputDirectory)
  const subpath = relative(root, output)
  if (!subpath || subpath.startsWith('..') || isAbsolute(subpath)) {
    throw new Error('Projection output must be a directory inside its package')
  }
  const revision = randomUUID()
  const builds = projectionBuildDirectory(root)
  const directory = join(builds, revision)
  const target = join(directory, subpath)
  const temporary = join(builds, `${revision}.json`)
  try {
    await mkdir(dirname(target), { recursive: true })
    await cp(output, target, { recursive: true, dereference: false, errorOnExist: true })
    const build = { revision, directory }
    await writeFile(join(directory, '.published'), '')
    await writeFile(temporary, JSON.stringify(build))
    await rename(temporary, projectionBuildManifest(root))
    await pruneProjectionBuilds(root).catch(() => {})
    return build
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    await rm(directory, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/** Vite/Rollup build hook. Watch builds publish only after a successful write. */
export function projectionLiveReload(options: { packageRoot?: string } = {}) {
  let root = options.packageRoot ? resolve(options.packageRoot) : process.cwd()
  return {
    name: 'au-projection-live-reload',
    configResolved(config: { root: string }) { root = options.packageRoot ? resolve(options.packageRoot) : config.root },
    async writeBundle(output: { dir?: string; file?: string }) {
      const directory = output.dir ?? (output.file ? dirname(output.file) : undefined)
      if (!directory) throw new Error('Projection live reload requires an output directory')
      await publishProjectionBuild(root, directory)
    },
  }
}

/** A renderer may lazily request assets from any module it imported during its lifetime. */
export async function retainProjectionBuild(build: ProjectionBuild): Promise<void> {
  await writeFile(join(build.directory, `.lease-${process.pid}`), '')
}

export async function releaseProjectionBuild(build: ProjectionBuild): Promise<void> {
  await rm(join(build.directory, `.lease-${process.pid}`), { force: true })
}

/** Keep recent publications and every generation leased by a live host process. */
export async function pruneProjectionBuilds(root: string): Promise<void> {
  const builds = projectionBuildDirectory(root)
  const current = JSON.parse(await readFile(projectionBuildManifest(root), 'utf8')) as ProjectionBuild
  const entries = await readdir(builds, { withFileTypes: true })
  const candidates = await Promise.all(entries.filter(entry => entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name))
    .map(async entry => {
      const directory = join(builds, entry.name)
      try { return { directory, time: (await stat(join(directory, '.published'))).birthtimeMs } }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    }))
  const revisions = candidates.filter((entry): entry is { directory: string; time: number } => entry !== undefined)
  revisions.sort((a, b) => b.time - a.time)
  for (const build of revisions.slice(3)) {
    if (build.directory === current.directory) continue
    let retained = false
    for (const name of await readdir(build.directory)) {
      const match = /^\.lease-(\d+)$/.exec(name)
      if (!match) continue
      try { process.kill(Number(match[1]), 0); retained = true }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') retained = true }
    }
    if (!retained) await rm(build.directory, { recursive: true, force: true })
  }
}
