import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { artifactPath } from '../src/main/asset-response'

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (request: Request) => Promise<Response>>() }))
vi.mock('electron', () => ({ protocol: {
  handle: (scheme: string, handler: (request: Request) => Promise<Response>) => handlers.set(scheme, handler),
} }))
import { artifactScheme, installAssetProtocol, registerAsset } from '../src/main/asset-sources'

let root: string, entry: string, token: string
const resources = [
  ['style.css', 'text/css'], ['script.js', 'text/javascript'], ['module.mjs', 'text/javascript'],
  ['data.json', 'application/json'], ['font.woff', 'font/woff'], ['font.woff2', 'font/woff2'],
  ['image.svg', 'image/svg+xml'], ['poster.png', 'image/png'], ['clip.webm', 'video/webm'],
] as const
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'au-artifact-test-')))
  const base = join(root, 'artifact')
  await mkdir(join(base, 'nested'), { recursive: true })
  entry = join(base, 'report.html')
  await writeFile(entry, '<!doctype html><link rel="stylesheet" href="nested/style.css">')
  await writeFile(join(root, 'secret.txt'), 'outside')
  await mkdir(join(root, 'artifact-sibling'))
  await writeFile(join(root, 'artifact-sibling', 'secret.txt'), 'outside sibling')
  for (const [name] of resources) await writeFile(join(base, 'nested', name), '0123456789')
  await symlink(join(root, 'secret.txt'), join(base, 'escape.txt'))
  await symlink(join(root, 'artifact-sibling'), join(base, 'escape-dir'))
  await symlink(join(base, 'nested', 'style.css'), join(base, 'inside.css'))
  token = (await registerAsset(entry))!
  installAssetProtocol()
})
afterAll(() => rm(root, { recursive: true, force: true }))
const load = (path: string, init?: RequestInit, host = token) => handlers.get('au-artifact')!(new Request(`au-artifact://${host}${path}`, init))

describe('registered HTML artifact protocol', () => {
  it('exposes the standard secure scheme and serves the actual entry at the minted URL', async () => {
    expect(artifactScheme.privileges).toMatchObject({ standard: true, secure: true, supportFetchAPI: true })
    expect(await registerAsset(entry)).toBe(token)
    for (const path of ['/', '/index.html']) {
      const response = await load(path)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/html')
      expect(await response.text()).toContain('<!doctype html>')
    }
  })
  it.each(resources)('serves relative resource %s with MIME %s', async (name, mime) => {
    const response = await load(`/nested/${name}?version=1`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(mime)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.text()).toBe('0123456789')
  })
  it('retains streaming range, HEAD and unsupported-method behavior', async () => {
    const partial = await load('/nested/clip.webm', { headers: { range: 'bytes=2-5' } })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await partial.text()).toBe('2345')
    const head = await load('/index.html', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    expect((await load('/index.html', { method: 'POST' })).status).toBe(405)
  })
  it('rejects unregistered and non-HTML tokens, missing resources and directories', async () => {
    expect((await load('/index.html', undefined, 'unknown')).status).toBe(404)
    const image = (await registerAsset(join(root, 'artifact/nested/poster.png')))!
    expect((await load('/index.html', undefined, image)).status).toBe(404)
    expect((await load('/missing.css')).status).toBe(404)
    expect((await load('/nested')).status).toBe(404)
  })
  it.each(['/../secret.txt', '/%2e%2e%2fsecret.txt', '/%2e%2e%2fartifact-sibling/secret.txt', '/escape.txt', '/escape-dir/secret.txt', '/%00', '/%zz'])('rejects escaping or malformed resource %s', async path => {
    // Direct resolver also checks paths before WHATWG URL dot-segment normalization.
    expect(await artifactPath(entry, path)).toBeNull()
    expect((await load(path)).status).toBe(404)
  })
  it('allows a symlink only when its real target remains in the artifact directory', async () => {
    expect(await artifactPath(entry, '/inside.css')).toBe(join(root, 'artifact/nested/style.css'))
    const response = await load('/inside.css')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('0123456789')
  })
})
