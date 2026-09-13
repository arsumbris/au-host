import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ member: vi.fn(), target: vi.fn(), client: {} }))
vi.mock('@arsumbris/au-engine-sdk', () => ({
  DaemonClient: {},
  manageConnection: () => ({ client: mocks.client, onStateChange: vi.fn() }),
  toTypedSubscriber: vi.fn(),
}))
vi.mock('@arsumbris/au-engine-sdk/reads', () => ({
  readContent: vi.fn(), readDeviceConfig: vi.fn(),
  readResolveMember: mocks.member, readResolveTarget: mocks.target,
}))

import { EngineConnections } from '../src/main/engine-connections'

const ready = (result: unknown) => ({ ready: true, version: 1, result })
const entry = '/workspace'
const file = '/scattered/media/images/sample.svg'

describe('engine-mediated asset resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.member.mockResolvedValue(ready({ repo: 'media', root: '/scattered/media' }))
    mocks.target.mockResolvedValue(ready({ path: file }))
  })

  it('qualifies discovered absolute paths using engine ownership, including scattered members', async () => {
    expect(await new EngineConnections().resolveTarget(entry, file)).toBe(file)
    expect(mocks.member).toHaveBeenCalledWith(mocks.client, file)
    expect(mocks.target).toHaveBeenCalledWith(mocks.client, 'images/sample.svg::media')
  })

  it('uses the engine-selected nested member rather than the entry or first ancestor', async () => {
    mocks.member.mockResolvedValue(ready({ repo: 'nested', root: '/scattered/media/images' }))
    expect(await new EngineConnections().resolveTarget(entry, file)).toBe(file)
    expect(mocks.target).toHaveBeenCalledWith(mocks.client, 'sample.svg::nested')
  })

  it('does not resolve duplicate basenames scopelessly', async () => {
    await new EngineConnections().resolveTarget(entry, file)
    expect(mocks.target).not.toHaveBeenCalledWith(mocks.client, 'sample.svg')
    expect(mocks.target).toHaveBeenCalledTimes(1)
  })

  it.each([null, { repo: 'unrelated', root: '/another' }])('rejects unknown or inconsistent ownership: %j', async owner => {
    mocks.member.mockResolvedValue(ready(owner))
    expect(await new EngineConnections().resolveTarget(entry, file)).toBeNull()
    expect(mocks.target).not.toHaveBeenCalled()
  })

  it('does not authorize an ignored or missing file merely because it has an owner', async () => {
    mocks.target.mockResolvedValue(ready(null))
    expect(await new EngineConnections().resolveTarget(entry, file)).toBeNull()
  })

  it('rejects reference reinterpretation or a changed target', async () => {
    mocks.target.mockResolvedValue(ready({ path: '/scattered/media/images/other.svg' }))
    expect(await new EngineConnections().resolveTarget(entry, file)).toBeNull()
  })

  it('normalizes absolute paths before ownership lookup', async () => {
    expect(await new EngineConnections().resolveTarget(entry, '/scattered/media/images/../images/sample.svg')).toBe(file)
    expect(mocks.member).toHaveBeenCalledWith(mocks.client, file)
  })

  it.each(['images/sample.svg::media', 'sample.svg', 'sample.svg::media@deadbeef'])('preserves existing reference semantics: %s', async reference => {
    await new EngineConnections().resolveTarget(entry, reference)
    expect(mocks.member).not.toHaveBeenCalled()
    expect(mocks.target).toHaveBeenCalledWith(mocks.client, reference)
  })

  it.each([{ ready: false }, { error: 'unreachable' }])('fails closed while ownership is unavailable: %j', async response => {
    mocks.member.mockResolvedValue(response)
    expect(await new EngineConnections().resolveTarget(entry, file)).toBeNull()
    expect(mocks.target).not.toHaveBeenCalled()
  })

  it('fails closed when the resolver throws', async () => {
    mocks.target.mockRejectedValue(new Error('disconnected'))
    expect(await new EngineConnections().resolveTarget(entry, file)).toBeNull()
  })
})
