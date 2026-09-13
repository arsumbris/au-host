import type { ChildHandle, LoadedModule, ProjectionReloadStatus } from '@arsumbris/au-host-sdk'
import { isDefinedProjection, reportHostDiagnostic, clearCondition } from '@arsumbris/au-host-sdk'
import { loadProjection, type ProjectionRegistration } from './loader'

interface ReloadMount {
  registration: ProjectionRegistration
  reload(fromDisk: boolean): Promise<void>
  setWatching(enabled: boolean): void
  dispose(): void
  watching: boolean
  busy: boolean
  error?: string
}

const mounts = new Map<string, ReloadMount>()
const watchers = new Map<string, { count: number; stop: () => void }>()
let stopEvents: (() => void) | undefined

function watch(root: string): () => void {
  let current = watchers.get(root)
  if (!current) {
    void window.main.projections.watchBuild(root, true).catch(error => {
      if (watchers.get(root) !== current) return
      for (const mount of mounts.values()) {
        if (mount.registration.source.mode === 'esm' && mount.registration.source.path === root) {
          mount.error = String(error)
          mount.setWatching(false)
        }
      }
      reportHostDiagnostic({ code: 'projection-watch-failed', severity: 'warning', subject: root, message: String(error) })
    })
    current = { count: 0, stop: () => { void window.main.projections.watchBuild(root, false).catch(() => {}) } }
    watchers.set(root, current)
  }
  current.count++
  if (!stopEvents) stopEvents = window.main.projections.onBuild(({ root: changed }) => {
    for (const mount of mounts.values()) {
      if (mount.watching && mount.registration.source.mode === 'esm' && mount.registration.source.path === changed) {
        void mount.reload(false).catch(() => {})
      }
    }
  })
  return () => {
    if (--current.count === 0) { current.stop(); watchers.delete(root) }
    if (watchers.size === 0) { stopEvents?.(); stopEvents = undefined }
  }
}

export const projectionReload = {
  status(id: string): ProjectionReloadStatus | undefined {
    const mount = mounts.get(id)
    return mount ? { watching: mount.watching, busy: mount.busy, error: mount.error } : undefined
  },
  async reload(id: string): Promise<void> {
    const mount = mounts.get(id)
    if (!mount) throw new Error('This projection is no longer mounted in this window')
    await mount.reload(true)
  },
  setWatching(id: string, enabled: boolean): void {
    const mount = mounts.get(id)
    if (!mount) throw new Error('This projection is no longer mounted in this window')
    mount.setWatching(enabled)
  },
}

/** Own a replacement at its original mount site; the caller owns the host lifecycle. */
export async function mountReloadableProjection(options: {
  id: string
  registration: ProjectionRegistration
  mount(module: LoadedModule, onUnmount: () => void): ChildHandle
  consent(): Promise<boolean>
}): Promise<ChildHandle> {
  const enabled = await window.main.projections.isDevelopment()
  let loaded = await loadProjection(options.registration)
  let alive = true
  let replacing = false
  let generation = 0
  let pending: Promise<void> | undefined
  let queued = false
  let queuedDisk = false
  let unwatch: (() => void) | undefined
  const externalUnmount = (): void => { if (!replacing) dispose() }
  let current: ChildHandle | undefined
  const state: ReloadMount = {
    registration: options.registration, watching: false, busy: false,
    dispose,
    setWatching(enabled) {
      if (state.watching === enabled) return
      unwatch?.(); unwatch = undefined
      state.watching = enabled
      if (enabled && options.registration.source.mode === 'esm') unwatch = watch(options.registration.source.path)
    },
    reload(fromDisk) {
      if (!alive) return Promise.resolve()
      queued = true
      queuedDisk ||= fromDisk
      if (pending) return pending
      pending = (async () => {
        let failure: unknown
        while (queued && alive) {
          const disk = queuedDisk
          queued = false; queuedDisk = false
          state.busy = true
          const request = ++generation
          try {
            const next = await loadProjection(options.registration, disk)
            if (!alive || request !== generation) return
            if (next.baseUrl === loaded.baseUrl && current) { state.error = undefined; failure = undefined; continue }
            const registered = next.module.default
            const exp = options.registration.export ?? 'mount'
            if (!isDefinedProjection(registered) || typeof (registered as LoadedModule)[exp] !== 'function') {
              throw new Error(`The new build does not export a registered ${exp} projection`)
            }
            if (!await options.consent() || !alive) continue
            replacing = true
            const previous = loaded
            try {
              current?.unmount()
              current = options.mount(next.module, externalUnmount)
              loaded = next
              state.error = undefined
              clearCondition('projection-reload-failed', options.id)
              failure = undefined
            } catch (error) {
              try { current = options.mount(previous.module, externalUnmount) }
              catch (rollbackError) {
                current = undefined
                throw new AggregateError([error, rollbackError], 'Projection mount and recovery failed; correct the build and reload again')
              }
              throw error
            } finally { replacing = false }
          } catch (error) {
            state.error = error instanceof Error ? error.message : String(error)
            console.error('Projection reload failed:', state.error)
            reportHostDiagnostic({ code: 'projection-reload-failed', severity: 'warning', subject: options.id, message: state.error })
            failure = error
          } finally { state.busy = false }
        }
        if (failure) throw failure
      })().finally(() => { pending = undefined })
      return pending
    },
  }
  function dispose(): void {
    if (!alive) return
    alive = false; generation++
    unwatch?.()
    clearCondition('projection-reload-failed', options.id)
    if (mounts.get(options.id) === state) mounts.delete(options.id)
  }
  current = options.mount(loaded.module, externalUnmount)
  if (enabled && options.id && options.registration.source.mode === 'esm') {
    mounts.set(options.id, state)
  }
  return {
    get publisher() { return current?.publisher ?? '' },
    unmount() { dispose(); current?.unmount() },
  }
}
