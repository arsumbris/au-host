// Playwright global-teardown: stop the vault daemon the harness started.
import { stopDaemon } from './support/daemon'
import { localMembers } from './support/local-members'

export default async function globalTeardown(): Promise<void> {
  stopDaemon()
  localMembers(false)
}
