import { defineConfig } from '@playwright/test'

// The E2E harness launches the REAL built Electron app (see fixtures/app.ts). Serial (workers: 1) because
// each test boots an Electron process against the ONE vault daemon; generous timeouts cover the
// daemon-connect + composition-mount boot.
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
})
