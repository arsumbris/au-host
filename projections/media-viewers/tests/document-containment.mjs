import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { chromium } from '../../../app/node_modules/@playwright/test/index.mjs'

const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8')
const source = await readFile(new URL('../src/viewers.ts', import.meta.url), 'utf8')
const artifact = await readFile(new URL('../../../dogfood/reader-fixtures/html-preview-lab.html', import.meta.url), 'utf8')
const javascript = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  await page.setContent(`<style>:root{--au-space-2:8px;--au-line-1:#555;--au-radius-panel:8px;--au-color-surface-1:#222;--au-ink-1:#eee;--au-ink-3:#bbb}body{margin:0}#pane{height:500px;display:flex}#neighbor{position:absolute;left:1000px;top:0;width:100px;height:100px;background:red}${css}</style><div id="pane"><section class="mv-root"><div class="mv-toolbar">Preview controls</div><div class="mv-body"></div><div class="mv-status">Sandboxed HTML</div></section></div><button id="neighbor">Host neighbor</button>`)
  await page.evaluate(async ({ javascript, artifact }) => {
    const moduleUrl = URL.createObjectURL(new Blob([javascript], { type: 'text/javascript' }))
    const { createViewer } = await import(moduleUrl)
    URL.revokeObjectURL(moduleUrl)
    const artifactUrl = URL.createObjectURL(new Blob([artifact], { type: 'text/html' }))
    const viewer = createViewer('html', artifactUrl, 'lab.html', {}, () => {}, () => {})
    document.querySelector('.mv-body').append(viewer.element)
    window.cleanup = () => { viewer.destroy(); URL.revokeObjectURL(artifactUrl) }
  }, { javascript, artifact })
  const frame = page.frameLocator('iframe')
  await frame.locator('#sections p').last().waitFor()
  for (const width of [280, 320, 900]) {
    await page.locator('#pane').evaluate((el, width) => { el.style.width = `${width}px` }, width)
    const geometry = await page.evaluate(() => {
      const names = ['#pane', '.mv-root', '.mv-body', '.mv-stage', 'iframe']
      return Object.fromEntries(names.map(name => {
        const el = document.querySelector(name), rect = el.getBoundingClientRect()
        return [name, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, scroll: el.scrollWidth, client: el.clientWidth }]
      }))
    })
    for (const name of ['.mv-root', '.mv-body', '.mv-stage', 'iframe']) {
      assert.ok(geometry[name].right <= geometry['#pane'].right + 1, `${width}: ${name} right overflow`)
      assert.ok(geometry[name].bottom <= geometry['#pane'].bottom + 1, `${width}: ${name} bottom overflow`)
    }
    assert.equal(geometry['.mv-stage'].scroll, geometry['.mv-stage'].client)
    const overflow = await frame.locator('html').evaluate(el => el.scrollWidth > el.clientWidth)
    assert.ok(overflow, 'Stress content retains its own horizontal overflow')
    await frame.locator('#note').fill(`Input at ${width}`)
    await frame.locator('#update').click()
    assert.equal(await frame.locator('#message').textContent(), `Input at ${width}`)
    await frame.locator('html').evaluate(() => window.scrollTo(0, 1000))
    const badge = await frame.locator('.fixed').evaluate(el => {
      const rect = el.getBoundingClientRect()
      return { bottom: rect.bottom, height: innerHeight, right: rect.right, width: innerWidth }
    })
    assert.ok(badge.bottom <= badge.height && badge.right <= badge.width)
    await page.locator('#neighbor').click()
    await frame.locator('html').evaluate(() => window.scrollTo(0, 0))
    console.log(`PASS ${width}px: bounded document frame, internal overflow, fixed badge, input and outside click`)
  }
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts')
  assert.equal(await page.locator('iframe').getAttribute('referrerpolicy'), 'no-referrer')
  await page.screenshot({ path: '/tmp/html-preview-containment.png' })
  await page.evaluate(() => window.cleanup())
} finally {
  await browser.close()
}
