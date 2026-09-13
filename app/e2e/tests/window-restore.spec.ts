// Behaviour (persisted windows restore on load): a composition that
// DECLARES a second, non-primary window has that window re-realized as its own OS surface when the
// composition loads — WITHOUT any float gesture. This is the restore half of window persistence: a floated
// window round-trips in the git composition's `windows:`, and on reopen the authority opens its surface.
//
// (The PERSIST half — a live float serializing its window record into the composition — is exercised by
// float-dock / cross-window-move + the composition-pool roundtrip probe. Together they lock the round-trip
// without a vault-polluting float-then-restart two-launch.)
import { test, expect } from '../fixtures/app'

test.use({ composition: 'two-window' })

test('a persisted secondary window is realized as its own OS surface on load', async ({ page, electronApp, events }) => {
  // The PRIMARY window mounts its editor content in the main portal.
  await expect(page.locator('.cm-content').first()).toContainText('Sample content')

  // The SECONDARY window declared in the composition is realized on load — a second OS window opens, with a
  // `window-restored` trace, and NO float gesture was made. `realizePersistedWindows` opens it during the
  // boot mount, which may complete before this test body runs, so poll the window set rather than waitForEvent.
  await expect.poll(() => electronApp.windows().length, { timeout: 15_000 }).toBe(2)
  await events.waitFor((e) => e.category === 'lifecycle' && e.name === 'window-restored', { timeout: 15_000 })

  // The restored window renders the shared surface shell (its Root actions header) — it is a live surface,
  // not just a pool record.
  const restored = electronApp.windows().find((w) => w !== page)
  expect(restored, 'a second OS window was realized').toBeTruthy()
  await restored!.getByRole('button', { name: 'Root actions' }).waitFor({ timeout: 30_000 })
})
