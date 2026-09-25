// Playwright global-teardown: remove the run root (local members + any vault a crashed test left behind).
import { rmSync } from 'node:fs'
import { RUN_ROOT_ENV } from './support/vault'

export default async function globalTeardown(): Promise<void> {
  const root = process.env[RUN_ROOT_ENV]
  if (root) rmSync(root, { recursive: true, force: true })
}
