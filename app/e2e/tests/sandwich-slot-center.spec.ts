// A slot SUBTYPE at a field that declares its base: the sandwich `center` declares `container-slot`, the
// fixture wraps it in a `sandwich-slot`. The host reads the wrapper by closure and mounts its child, so
// the window shows the tree AND the editor rather than rendering blank.
import { test, expect } from '../fixtures/app'

test.use({ composition: 'sandwich-slot-center' })

test('a sandwich-slot around the sandwich center mounts its pane', async ({ page }) => {
  await expect(page.locator('au-tree-row').first()).toBeVisible()
  await expect(page.locator('.cm-content')).toBeVisible()
})
