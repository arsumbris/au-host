// Executes the discovered adapter launcher. The adapter owns launch configuration and environment.

import { spawn } from 'node:child_process'
import * as path from 'node:path'

import type { AgentLaunchResult, DiscoveredAdapter } from '../shared/daemon-api'
import { loadToolPaths, resolveAgentBinary } from './tool-paths'

/**
 * A tri-state selection flag. Mirrors the launcher's own parse (absent = default/all;
 * present-empty = none; a list = only those). `undefined` omits the flag; a value list
 * (possibly empty) emits `--flag <comma-joined>` — an empty list becomes `--flag ''`, the
 * "none" selection. Comma-joining is accepted by every axis (`parseSelect` / `parseTools`).
 */
function selectFlag(name: string, values?: string[]): string[] {
  if (values === undefined) return []
  return [name, values.join(',')]
}

/** Prepare a launch using the adapter-owned CLI contract. */
export async function launchAgent(
  workspace: string,
  opts: { resumeRef?: string; skills?: string[]; inject?: string[]; profile?: string; tools?: string[]; nativeTools?: string[] },
  adapter: DiscoveredAdapter,
  onLog?: (line: string) => void,
): Promise<AgentLaunchResult> {
  if (opts.tools !== undefined || opts.nativeTools !== undefined) {
    return { ok: false, error: 'Inline tool selections are not supported. Save tool permissions in an agent profile and select that profile before launching.' }
  }
  const { paths } = loadToolPaths()

  // The agent binary the adapter declares (`adapter-runtime-meta.agentBinary`), resolved to a
  // location: shared executable discovery, then a per-machine `paths.yaml` `binaries` override.
  const agentBinary = adapter.runtime.agentBinary
  if (!agentBinary) return { ok: false, error: `adapter '${adapter.name}' declares no agentBinary in its adapter-runtime-meta` }
  const binary = resolveAgentBinary(agentBinary)
  if (!binary) {
    return { ok: false, error: `agent binary '${agentBinary}' not found on PATH — set paths.yaml 'binaries.${agentBinary}' to its location` }
  }

  // The adapter's launch bin, from its runtime meta (relative to the discovered adapter dir).
  const entry = path.join(adapter.dir, adapter.runtime.launchEntry)
  const args = [
    ...paths.nodeArgs,
    entry,
    '--workspace', workspace,
    '--binary', binary,
    ...selectFlag('--skills', opts.skills),
    ...selectFlag('--inject', opts.inject),
    ...(opts.profile === undefined ? [] : ['--profile', opts.profile]),
    ...(opts.resumeRef === undefined ? [] : ['--resume', opts.resumeRef]),
  ]

  return new Promise<AgentLaunchResult>((resolve) => {
    let out = ''
    let err = ''
    const child = spawn(paths.node, args, { cwd: adapter.dir, env: process.env })
    child.on('error', (e) => resolve({ ok: false, error: `failed to spawn launch (${paths.node}): ${e.message}` }))
    child.stdout.on('data', (c) => {
      out += c.toString('utf8')
    })
    child.stderr.on('data', (c) => {
      const s = c.toString('utf8')
      err += s
      if (onLog) for (const line of s.split('\n')) if (line.trim().length > 0) onLog(`launch: ${line}`)
    })
    child.on('exit', (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: err.trim() || `launch exited with code ${code}` })
        return
      }
      try {
        const parsed = JSON.parse(out.trim()) as Omit<AgentLaunchResult & { ok: true }, 'ok'>
        resolve({ ok: true, ...parsed })
      } catch {
        resolve({ ok: false, error: `launch produced unparseable output: ${out.trim().slice(0, 200)}` })
      }
    })
  })
}
