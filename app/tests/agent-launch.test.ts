import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiscoveredAdapter } from '../src/shared/daemon-api'
vi.mock('../src/main/tool-paths', () => ({
  loadToolPaths: () => ({ paths: { node: process.execPath, nodeArgs: [] } }),
  resolveAgentBinary: () => '/fixture/bin/arbitrary-agent',
}))
import { launchAgent } from '../src/main/agent-launch'
import { resolveLaunch } from '../../projections/agent-sessions/src/model'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function adapter(): DiscoveredAdapter {
  const dir = mkdtempSync(join(tmpdir(), 'au-launch-test-'))
  roots.push(dir)
  writeFileSync(join(dir, 'launch.mjs'), `process.stdout.write(JSON.stringify({session:'fixture',env:{},binary:process.execPath,argv:process.argv.slice(2),command:'fixture'}))`)
  return { name: 'custom.adapter', dir, runtime: { agentBinary: 'arbitrary-agent', launchEntry: './launch.mjs' } } as DiscoveredAdapter
}
it('passes profile literally across the real process boundary and preserves tri-state selections', async () => {
  const profile = '/profiles/a space; $(literal) "quote".yaml'
  const result = await launchAgent('/workspace with spaces', { profile, skills: [], inject: ['repo:context'] }, adapter())
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  expect(result.argv).toEqual(['--workspace', '/workspace with spaces', '--binary', '/fixture/bin/arbitrary-agent', '--skills', '', '--inject', 'repo:context', '--profile', profile])
})
it('omits unspecified selections and profile', async () => {
  const result = await launchAgent('/workspace', {}, adapter())
  if (!result.ok) throw new Error(result.error)
  expect(result.argv).toEqual(['--workspace', '/workspace', '--binary', '/fixture/bin/arbitrary-agent'])
})
it('launches saved restrictions through their profile locator rather than retired inline flags', async () => {
  const selection = await resolveLaunch({ name: 'restricted', path: '/profiles/restricted.yaml', tools: [], nativeToolAllowlist: [] }, { skills: [], skipped: [] }, { injects: [], skipped: [] }, {} as never)
  const result = await launchAgent('/workspace', selection, adapter())
  if (!result.ok) throw new Error(result.error)
  expect(result.argv).toEqual(['--workspace', '/workspace', '--binary', '/fixture/bin/arbitrary-agent', '--profile', '/profiles/restricted.yaml'])
})
it.each([{ tools: [] }, { nativeTools: ['tool'] }])('rejects retired inline restrictions instead of silently launching unrestricted', async opts => {
  const result = await launchAgent('/workspace', opts, adapter())
  expect(result).toEqual({ ok: false, error: expect.stringContaining('agent profile') })
})
