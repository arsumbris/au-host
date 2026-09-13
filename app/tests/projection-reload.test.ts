// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineProjection } from '@arsumbris/au-host-sdk'
import { mountReloadableProjection, projectionReload } from '../src/renderer/src/projections/projection-reload'
import { loadProjection } from '../src/renderer/src/projections/loader'

vi.mock('../src/renderer/src/projections/loader', () => ({ loadProjection: vi.fn() }))
const loader = vi.mocked(loadProjection)
const registration = { key: 'test', source: { mode: 'esm' as const, path: '/test' }, entry: './dist/index.js' }
const built = (name: string) => ({ module: { default: defineProjection({ mount: () => () => {} }), name }, baseUrl: `au-projection://${name}` })
let cleanup: (() => void)[] = []
let buildEvent: (event: { root: string }) => void
beforeEach(() => {
  loader.mockReset()
  Object.assign(window, { main: { projections: {
    isDevelopment: vi.fn(async () => true),
    watchBuild: vi.fn(async () => {}),
    onBuild: vi.fn(listener => { buildEvent = listener; return vi.fn() }),
  } } })
})
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); vi.restoreAllMocks() })

async function fixture(id = 'pane', consent = vi.fn(async () => true)) {
  const lifecycle: string[] = []
  let publisher = 0
  loader.mockResolvedValueOnce(built('one'))
  const handle = await mountReloadableProjection({
    id, registration, consent,
    mount(module, onUnmount) {
      lifecycle.push(`mount:${module.name}`)
      return { publisher: `${++publisher}`, unmount() { lifecycle.push(`dispose:${module.name}`); onUnmount() } }
    },
  })
  cleanup.push(() => handle.unmount())
  return { lifecycle, handle, consent }
}

describe('targeted projection replacement', () => {
  it('loads and validates first, then replaces only the addressed mount', async () => {
    const first = await fixture('first')
    const other = await fixture('other')
    loader.mockResolvedValueOnce(built('two'))
    await projectionReload.reload('first')
    expect(first.lifecycle).toEqual(['mount:one', 'dispose:one', 'mount:two'])
    expect(other.lifecycle).toEqual(['mount:one'])
    expect(first.handle.publisher).toBe('2')
    expect(projectionReload.status('first')?.busy).toBe(false)
  })

  it('retains the mounted preview when import fails and permits recovery', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = await fixture()
    loader.mockRejectedValueOnce(new Error('bad import'))
    await expect(projectionReload.reload('pane')).rejects.toThrow('bad import')
    expect(f.lifecycle).toEqual(['mount:one'])
    expect(projectionReload.status('pane')?.error).toBe('bad import')
    loader.mockResolvedValueOnce(built('fixed'))
    await projectionReload.reload('pane')
    expect(f.lifecycle.at(-1)).toBe('mount:fixed')
    expect(projectionReload.status('pane')?.error).toBeUndefined()
  })

  it('refuses an invalid export without disposing the live mount', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = await fixture()
    loader.mockResolvedValueOnce({ module: {}, baseUrl: 'au-projection://broken' })
    await expect(projectionReload.reload('pane')).rejects.toThrow('registered mount')
    expect(f.lifecycle).toEqual(['mount:one'])
  })

  it('honors unsaved-state veto before teardown', async () => {
    const f = await fixture('pane', vi.fn(async () => false))
    loader.mockResolvedValueOnce(built('two'))
    await projectionReload.reload('pane')
    expect(f.consent).toHaveBeenCalledOnce()
    expect(f.lifecycle).toEqual(['mount:one'])
  })

  it('does not remount after the pane closes during an import', async () => {
    const f = await fixture()
    let finish!: (value: ReturnType<typeof built>) => void
    loader.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const pending = projectionReload.reload('pane')
    f.handle.unmount()
    finish(built('two'))
    await pending
    expect(f.lifecycle).toEqual(['mount:one', 'dispose:one'])
    expect(projectionReload.status('pane')).toBeUndefined()
  })

  it('watches only opted-in mounts and releases the subscription on close', async () => {
    const f = await fixture('first')
    const other = await fixture('other')
    expect(window.main.projections.watchBuild).not.toHaveBeenCalled()
    projectionReload.setWatching('first', true)
    loader.mockResolvedValueOnce(built('two'))
    buildEvent({ root: '/test' })
    await vi.waitFor(() => expect(f.lifecycle.at(-1)).toBe('mount:two'))
    expect(other.lifecycle).toEqual(['mount:one'])
    f.handle.unmount()
    expect(window.main.projections.watchBuild).toHaveBeenLastCalledWith('/test', false)
  })
  it('processes a newer queued build after an earlier import fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = await fixture('queued-recovery')
    let fail!: (error: Error) => void
    loader.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject }))
    const first = projectionReload.reload('queued-recovery').catch(() => {})
    loader.mockResolvedValueOnce(built('recovered'))
    const next = projectionReload.reload('queued-recovery').catch(() => {})
    fail(new Error('incomplete build'))
    await Promise.all([first, next])
    expect(f.lifecycle.at(-1)).toBe('mount:recovered')
  })

  it('does not expose development controls when disabled', async () => {
    vi.mocked(window.main.projections.isDevelopment).mockResolvedValueOnce(false)
    await fixture('production')
    expect(projectionReload.status('production')).toBeUndefined()
  })

  it('reports watch setup failure and restores the stopped state', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await fixture('watch-failure')
    vi.mocked(window.main.projections.watchBuild).mockRejectedValueOnce(new Error('watch unavailable'))
    projectionReload.setWatching('watch-failure', true)
    await vi.waitFor(() => expect(projectionReload.status('watch-failure')?.watching).toBe(false))
    expect(projectionReload.status('watch-failure')?.error).toContain('watch unavailable')
  })

  it('can recover after both a replacement mount and its rollback throw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    loader.mockResolvedValueOnce(built('initial'))
    let broken = false
    const handle = await mountReloadableProjection({
      id: 'double-failure', registration, consent: async () => true,
      mount(module, onUnmount) {
        if (broken && module.name !== 'fixed') throw new Error('mount failed')
        return { publisher: String(module.name), unmount: onUnmount }
      },
    })
    cleanup.push(() => handle.unmount())
    broken = true
    loader.mockResolvedValueOnce(built('broken'))
    await expect(projectionReload.reload('double-failure')).rejects.toThrow('mount and recovery failed')
    expect(projectionReload.status('double-failure')?.busy).toBe(false)
    loader.mockResolvedValueOnce(built('fixed'))
    await projectionReload.reload('double-failure')
    expect(handle.publisher).toBe('fixed')
    expect(projectionReload.status('double-failure')?.error).toBeUndefined()
  })

})
