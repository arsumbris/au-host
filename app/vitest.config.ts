import { defineConfig } from 'vitest/config'

// Vitest runs the renderer/main UNIT tests under `tests/`. Without an explicit `include` it also globs
// `e2e/tests/*.spec.ts` — which are PLAYWRIGHT specs (`pnpm test:e2e`), not vitest, so vitest chokes on
// `test.use()` / `test()` called outside its runner and reports every e2e file as a failed collection.
// Scoping to `tests/**/*.test.ts` keeps the two runners disjoint. Each unit test declares its own DOM
// environment inline (`// @vitest-environment happy-dom`) where it needs one.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
