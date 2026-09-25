// A spawned instance (AU_ENTRY) auto-opens its workspace only on the engine's definite answer that every
// declared member mounts. Here the vault declares an edit member that resolves nowhere, and the engine
// binary is preconfigured, so auto-open is otherwise possible: the launcher must stay on the gate, name
// the unlocated member, and hold Start. Every other spec is the control: a fully located vault auto-opens.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { AU_BINARY, EVENT_CATEGORIES, MAIN_ENTRY } from '../support/paths'
import { seedComposition, shortTempDir } from '../support/recents'
import { freshVault, removeVault } from '../support/vault'
import { stopDaemon } from '../support/daemon'

const GHOST = 'e2e-ghost-member'

test('an unlocated member keeps a spawned instance on the gate', async () => {
  const vault = freshVault()
  const manifest = join(vault, '.arsumbris', 'workspace.yaml')
  writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('edit:\n  - e2e-vault\n', `edit:\n  - e2e-vault\n  - ${GHOST}\n`))
  expect(readFileSync(manifest, 'utf8')).toContain(`  - ${GHOST}\n`)
  spawnSync('git', ['commit', '--quiet', '--all', '--message', 'declare an unlocated member'], { cwd: vault })

  const hostDir = shortTempDir('auh-')
  seedComposition('sanity', hostDir, vault)
  mkdirSync(join(hostDir, 'config'), { recursive: true })
  writeFileSync(join(hostDir, 'config', 'paths.yaml'), `au: ${AU_BINARY}\n`)
  const profile = mkdtempSync(join(tmpdir(), 'au-host-e2e-'))
  try {
    const app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
      env: { ...process.env, AU_HOST_DEVICE_DIR: hostDir, AU_ENTRY: vault, AU_HOST_EVENTS: EVENT_CATEGORIES, AU_E2E_OFFSCREEN: '1' } as Record<string, string>,
    })
    try {
      const page = await app.firstWindow()
      // The engine's answer names the member, and the gate holds Start.
      await expect(page.locator('.gate-missing-names')).toHaveText(GHOST, { timeout: 60_000 })
      await expect(page.getByRole('button', { name: 'Start and open workspace →', exact: true })).toBeDisabled()
      // It stays there: no daemon start, no composition mounted.
      await page.waitForTimeout(3_000)
      await expect(page.locator('[data-pane-id]')).toHaveCount(0)
      await expect(page.locator('.gate-missing-names')).toHaveText(GHOST)
    } finally {
      await app.close()
    }
  } finally {
    stopDaemon(vault)
    removeVault(vault)
    rmSync(profile, { recursive: true, force: true })
    rmSync(hostDir, { recursive: true, force: true })
  }
})
