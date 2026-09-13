import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectionBuildDirectory, projectionBuildManifest, publishProjectionBuild, retainProjectionBuild, releaseProjectionBuild, pruneProjectionBuilds } from '@arsumbris/au-host-sdk/build'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'external projection '))
  roots.push(root)
  await mkdir(join(root, 'output'))
  await writeFile(join(root, 'output', 'index.js'), 'export const revision = 1')
  return root
}

describe('projection build publication', () => {
  it('publishes independent immutable snapshots outside the host checkout', async () => {
    const root = await fixture()
    const one = await publishProjectionBuild(root, 'output')
    await writeFile(join(root, 'output', 'index.js'), 'export const revision = 2')
    const two = await publishProjectionBuild(root, 'output')
    expect(await readFile(join(one.directory, 'output/index.js'), 'utf8')).toContain('revision = 1')
    expect(await readFile(join(two.directory, 'output/index.js'), 'utf8')).toContain('revision = 2')
    expect(JSON.parse(await readFile(projectionBuildManifest(root), 'utf8'))).toEqual(two)
  })
  it('leaves no failed snapshot and preserves the last successful publication', async () => {
    const root = await fixture()
    const good = await publishProjectionBuild(root, 'output')
    const before = await readdir(projectionBuildDirectory(root))
    await expect(publishProjectionBuild(root, 'missing')).rejects.toThrow()
    expect(await readdir(projectionBuildDirectory(root))).toEqual(before)
    expect(JSON.parse(await readFile(projectionBuildManifest(root), 'utf8'))).toEqual(good)
  })
  it('retains leased modules for lazy assets and prunes them when released', async () => {
    const root = await fixture()
    const old = await publishProjectionBuild(root, 'output')
    await retainProjectionBuild(old)
    for (let i = 0; i < 6; i++) await publishProjectionBuild(root, 'output')
    expect(await readFile(join(old.directory, 'output/index.js'), 'utf8')).toContain('revision = 1')
    await releaseProjectionBuild(old)
    await pruneProjectionBuilds(root)
    await expect(readFile(join(old.directory, 'output/index.js'))).rejects.toThrow()
    const directories = (await readdir(projectionBuildDirectory(root), { withFileTypes: true })).filter(e => e.isDirectory())
    expect(directories.length).toBeLessThanOrEqual(4)
  })
  it('rejects escaping or package-root output', async () => {
    const root = await fixture()
    await expect(publishProjectionBuild(root, '../outside')).rejects.toThrow('inside its package')
    await expect(publishProjectionBuild(root, '.')).rejects.toThrow('inside its package')
  })
  it('does not prune an in-progress publication from another builder', async () => {
    const root = await fixture()
    const pending = join(projectionBuildDirectory(root), '00000000-0000-0000-0000-000000000000')
    await mkdir(pending, { recursive: true })
    await writeFile(join(pending, 'partial.js'), 'still writing')
    for (let i = 0; i < 5; i++) await publishProjectionBuild(root, 'output')
    expect(await readFile(join(pending, 'partial.js'), 'utf8')).toBe('still writing')
  })
})
