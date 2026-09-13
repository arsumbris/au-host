// Repair the node-pty terminal helper's execute bit on macOS.
//
// node-pty ships its prebuilt `spawn-helper` (the tiny binary it execs to fork a pty)
// at mode 0644 — no execute bit. Without +x, opening a terminal fails with
// `posix_spawnp failed`, which breaks in-app terminals and agent CLI sessions.
// Upstream bug: https://github.com/microsoft/node-pty/issues/850 (stable patch tracked
// at https://github.com/microsoft/node-pty/issues/919).
//
// This runs after `electron-rebuild` (see the `rebuild:native` script). It resolves the
// INSTALLED node-pty location via Node module resolution — it never assumes a pnpm store
// layout, never recurses through node_modules, and touches only node-pty's own helper.
// It is idempotent, and a no-op on non-macOS platforms.

import { chmodSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

if (process.platform !== 'darwin') {
  // node-pty's prebuild perms bug is macOS-only; nothing to repair elsewhere.
  process.exit(0)
}

const require = createRequire(import.meta.url)

let nodePtyDir
try {
  nodePtyDir = dirname(require.resolve('node-pty/package.json'))
} catch {
  console.warn('[fix-node-pty-perms] node-pty not found; skipping (run pnpm install first).')
  process.exit(0)
}

// The prebuild helper for THIS arch, plus the locally-rebuilt one if electron-rebuild
// produced it. Both must be executable, since node-pty's loader may select either.
const candidates = [
  join(nodePtyDir, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper'),
  join(nodePtyDir, 'build', 'Release', 'spawn-helper'),
  join(nodePtyDir, 'build', 'Debug', 'spawn-helper'),
]

let repaired = 0
for (const helper of candidates) {
  if (!existsSync(helper)) continue
  const mode = statSync(helper).mode
  const wanted = mode | 0o111 // add execute for user/group/other
  if (wanted !== mode) {
    chmodSync(helper, wanted)
    console.log(`[fix-node-pty-perms] +x ${helper}`)
    repaired++
  }
}

if (repaired === 0) {
  console.log('[fix-node-pty-perms] spawn-helper already executable (or no prebuild present); nothing to do.')
}
