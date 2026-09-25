// Playwright global-setup: assert the built app exists and create the run root — the parent of this run's
// local members and of every per-test vault copy (support/vault.ts). The build itself is run by `pnpm e2e`.
import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAIN_ENTRY } from './support/paths'
import { installLocalMembers } from './support/local-members'
import { RUN_ROOT_ENV } from './support/vault'

export default async function globalSetup(): Promise<void> {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(`built main entry missing: ${MAIN_ENTRY}\nRun \`pnpm --filter app build\` first (or use \`pnpm e2e\`).`)
  }
  // Canonical, so the entry path the app, the daemon and the recents seed see is one spelling.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'au-e2e-run-')))
  installLocalMembers(root)
  // Environment set here reaches the test workers.
  process.env[RUN_ROOT_ENV] = root
}
