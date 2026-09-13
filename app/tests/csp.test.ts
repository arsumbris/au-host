import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { install } = vi.hoisted(() => ({ install: vi.fn() }))
vi.mock('electron', () => ({ session: { defaultSession: { webRequest: { onHeadersReceived: install } } } }))
import { installRendererCsp } from '../src/main/csp'
const dirs: string[] = []
afterEach(() => { dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); vi.clearAllMocks() })
it('permits projection WASM without permitting JavaScript eval or widening artifact sandbox', () => {
  const rendererDir = mkdtempSync(join(tmpdir(), 'projection-csp-'))
  dirs.push(rendererDir)
  writeFileSync(join(rendererDir, 'index.html'), '<script type="importmap">{"imports":{}}</script>')
  installRendererCsp({ dev: false, rendererDir })
  const headers = (url: string) => {
    const callback = vi.fn()
    install.mock.calls[0][0]({ url, responseHeaders: {} }, callback)
    return callback.mock.calls[0][0].responseHeaders['Content-Security-Policy'][0] as string
  }
  const page = headers('file:///index.html')
  expect(page).toContain("'wasm-unsafe-eval'")
  expect(page).not.toContain("'unsafe-eval'")
  expect(page).toContain("'sha256-")
  const artifact = headers('au-artifact://test/index.html')
  expect(artifact).toContain('sandbox allow-scripts')
  expect(artifact).not.toContain('wasm-unsafe-eval')
})
