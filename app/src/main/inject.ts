// The inject-manifest hook (main process) — the ALWAYS-ON-context twin of `skills.ts`.
//
// Reads the CC adapter's `bin/gen-inject.ts --manifest` over the workspace: PRINT the discovered
// `mcp.inject` instances as JSON (writes nothing). Drives the launch picker (what to render, with
// role + prepaid byte cost) + the visible-by-absence surface (skipped injects with reasons). Inject
// MATERIALIZATION happens inside the adapter's `launch.ts` at launch time (see `agent-launch.ts`),
// where the role-scoped default set (absent `--inject` = entry/edit injects, NOT all) is honored.
//
// Contract with the adapter entrypoint (owned by the au-mcp family):
// - STDOUT: the manifest JSON.
// - STDERR: diagnostics (skipped-inject reasons, GC sweeps, the BUDGET EXCEEDED overflow line).
// - exit 1: failure (e.g. the engine daemon is not up on the entry).
// - exit 2: a missing --workspace.
//
// A failure DEGRADES to an empty manifest rather than throwing. The CLI path is by-PATH
// (`node <nodeArgs> <adapter>/bin/gen-inject.ts`) — the adapter is a private package with no bin field.

import { spawn } from 'node:child_process'
import * as path from 'node:path'

import type { DiscoveredAdapter, InjectManifest } from '../shared/daemon-api'
import { loadToolPaths } from './tool-paths'

interface RunResult {
  /** Non-empty when the spawn itself failed (bad node/adapter path). */
  spawnError?: string
  out: string
  err: string
  code: number | null
}

/** Run the resolved adapter's gen-inject entrypoint with the given trailing args. Never throws. */
function run(adapter: DiscoveredAdapter, extraArgs: string[], onLog?: (line: string) => void): Promise<RunResult> {
  const { paths } = loadToolPaths()
  const entry = path.join(adapter.dir, adapter.runtime.injectEntry)
  const args = [...paths.nodeArgs, entry, ...extraArgs]

  return new Promise<RunResult>((resolve) => {
    let out = ''
    let err = ''
    const child = spawn(paths.node, args, { cwd: adapter.dir, env: process.env })
    child.on('error', (e) => resolve({ spawnError: `failed to spawn gen-inject (${paths.node}): ${e.message}`, out: '', err: '', code: null }))
    child.stdout.on('data', (c) => {
      out += c.toString('utf8')
    })
    child.stderr.on('data', (c) => {
      const s = c.toString('utf8')
      err += s
      if (onLog) for (const line of s.split('\n')) if (line.trim().length > 0) onLog(`gen-inject: ${line}`)
    })
    child.on('exit', (code) => resolve({ out, err, code }))
  })
}

const EMPTY_MANIFEST: InjectManifest = { injects: [], skipped: [] }

/**
 * Read the discovered-injects MANIFEST for the launch picker (`gen-inject --manifest`).
 * Degrades to an empty manifest (never throws): a spawn failure, non-zero exit, or malformed
 * JSON all come back as `{ injects: [], skipped: [] }` so the picker renders "no injects".
 */
export async function injectManifest(workspace: string, adapter: DiscoveredAdapter, onLog?: (line: string) => void): Promise<InjectManifest> {
  const r = await run(adapter, ['--workspace', workspace, '--manifest'], onLog)
  if (r.spawnError || r.code !== 0) return EMPTY_MANIFEST
  try {
    const parsed = JSON.parse(r.out.trim() || '{}') as Partial<InjectManifest>
    return { injects: parsed.injects ?? [], skipped: parsed.skipped ?? [] }
  } catch {
    return EMPTY_MANIFEST
  }
}
