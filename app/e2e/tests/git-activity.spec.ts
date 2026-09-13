// Behaviour: the cross-repo git activity projection renders its stream, a row expands to its detail, and a
// changed file in the panel fires an open-intent — all in the running app, over the real recent_commits
// read + subscription. The vault sits inside the au-host working tree, so the stream is non-empty. This
// locks the render → expand → file-open path; the mutation FOLD is covered separately by group.test.ts,
// and live-append / real-daemon grouping are manually verified (they need a controlled git tree).
import { test, expect } from '../fixtures/app'

test.use({ composition: 'git-activity' })

test('the activity stream renders, a row expands to detail, and a changed file fires open-intent', async ({ page, events }) => {
  // The recent_commits read + subscription render the merged commit stream in the running app.
  const row = page.locator('.au-git-activity-row').first()
  await expect(row).toBeVisible({ timeout: 30_000 })

  // Clicking a row expands its detail panel in place.
  await row.click()
  await expect(page.locator('.au-git-activity-panel').first()).toBeVisible({ timeout: 10_000 })

  // A changed file in the panel fires an open-intent (the secondary editor-open affordance).
  const file = page.locator('.au-git-activity-file').first()
  await expect(file).toBeVisible({ timeout: 10_000 })
  await events.clear()
  await file.click()
  await events.waitFor((e) => e.name === 'fire' && e.fields?.type === 'open-intent', {
    filter: { category: 'intent' },
  })

  // No standing error condition was raised (a dropped mount or failed read would surface one).
  const errors = (await events.conditions()).filter((c) => c.severity === 'error')
  expect(errors, `standing error conditions: ${JSON.stringify(errors, null, 2)}`).toHaveLength(0)
})
