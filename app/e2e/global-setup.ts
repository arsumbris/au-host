// Playwright global-setup: assert the built app exists and clear any stale vault daemon so the launched
// app spawns a fresh one over AU_ENTRY (the normal launch flow). The build itself is run by `pnpm e2e`.
import { existsSync } from 'node:fs'
import { stopDaemon } from './support/daemon'
import { MAIN_ENTRY } from './support/paths'
import { localMembers } from './support/local-members'

export default async function globalSetup(): Promise<void> {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(`built main entry missing: ${MAIN_ENTRY}\nRun \`pnpm --filter app build\` first (or use \`pnpm e2e\`).`)
  }
  stopDaemon() // clear a stale vault daemon; the app spawns its own
  localMembers(true)
}
