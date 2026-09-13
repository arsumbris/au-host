import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveAssetFile } from '../src/main/asset-response'

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'au-asset-response-'))
  for (const name of ['tone.wav', 'clip.webm', 'empty.wav']) {
    await writeFile(join(dir, name), name === 'empty.wav' ? '' : '0123456789')
  }
})
afterAll(() => rm(dir, { recursive: true, force: true }))
const request = (range?: string, method = 'GET') => new Request('https://asset.test/', {
  method, headers: range ? { range } : {},
})
describe('authorized asset file responses', () => {
  it('declares local media types and serves the full bytes', async () => {
    for (const [name, mime] of [['tone.wav', 'audio/wav'], ['clip.webm', 'video/webm']]) {
      const response = await serveAssetFile(join(dir, name), request())
      expect(response.headers.get('content-type')).toBe(mime)
      expect(response.headers.get('content-length')).toBe('10')
      expect(await response.text()).toBe('0123456789')
    }
  })
  it.each([
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=8-999', '89', 'bytes 8-9/10'],
  ])('serves a bounded range %s', async (range, bytes, contentRange) => {
    const response = await serveAssetFile(join(dir, 'tone.wav'), request(range))
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(contentRange)
    expect(response.headers.get('content-length')).toBe(String(bytes.length))
    expect(await response.text()).toBe(bytes)
  })
  it.each(['bytes=10-', 'bytes=8-2', 'bytes=-0'])('rejects unsatisfiable range %s', async range => {
    const response = await serveAssetFile(join(dir, 'tone.wav'), request(range))
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */10')
  })
  it('returns metadata only for HEAD and ignores its range', async () => {
    const response = await serveAssetFile(join(dir, 'tone.wav'), request('bytes=2-5', 'HEAD'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('10')
    expect(await response.text()).toBe('')
  })
  it('handles empty, missing and unsupported-method requests', async () => {
    expect((await serveAssetFile(join(dir, 'empty.wav'), request())).status).toBe(200)
    expect((await serveAssetFile(join(dir, 'empty.wav'), request('bytes=0-'))).status).toBe(416)
    expect((await serveAssetFile(join(dir, 'missing.wav'), request())).status).toBe(404)
    expect((await serveAssetFile(join(dir, 'tone.wav'), request(undefined, 'POST'))).status).toBe(405)
  })
})
