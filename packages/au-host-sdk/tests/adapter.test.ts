import { describe, expect, it } from 'vitest'

import { createMountHost, MOUNT_CONTRACT_VERSION } from '../src/index.ts'
import type { HostToProjection, HostTransport, ProjectionToHost } from '../src/index.ts'
import type { SubscriptionEvent } from '@arsumbris/au-engine-sdk/wire'

// A transport that captures what the adapter sends and lets the test push
// broker replies back. Stands in for au-host's direct / bridge transports.
function fakeTransport() {
  const sent: ProjectionToHost[] = []
  let handler: ((message: HostToProjection) => void) | null = null
  const transport: HostTransport = {
    send(message) {
      sent.push(message)
    },
    receive(onMessage) {
      handler = onMessage
      return () => {
        handler = null
      }
    },
  }
  return { transport, sent, emit: (message: HostToProjection) => handler?.(message) }
}

// The host implements composition (loader + tree); the adapter only forwards it.
const children = {
  mount: async () => ({ publisher: 'p1', unmount() {} }),
}
// The host also implements the view-state bus; the adapter forwards it too.
const viewState = { publish() {}, follow: () => () => {}, watchAll: () => () => {} }
// The v3 host-composition surfaces are likewise host-implemented and forwarded.
const files = {
  read: async () => ({ ok: true, content: '' }),
  write: async () => ({ ok: true }),
  exists: async () => true,
  delete: async () => ({ ok: true }),
  rename: async () => ({ ok: true }),
}
const workspace = { members: [{ name: 'member', root: '/member', scattered: false, editable: true, local: true, role: 'entry' as const }] }
const selection = { publish() {}, follow: () => () => {} }
// The view-state channels are host-implemented and forwarded too.
const intent = { fire: () => false, handle: () => () => {} }
const focus = { report() {} }
const viewStore = { get: () => undefined, set() {} }
// The terminal capability is host-owned and forwarded; instanceId is its key.
const terminal = {
  attach: () => ({
    onData: () => () => {},
    onExit: () => () => {},
    write() {},
    resize() {},
    send() {},
    cwd: async () => undefined,
    detach() {},
    close() {},
  }),
}
const instanceId = 'node-1'
// The compositor surfaces are host-implemented and forwarded too.
const listContributions = () => []
const listProjections = () => []
const subscribeContributions = () => () => {}
const preview = { show() {}, hide() {}, isOver: () => false, isShowing: () => false }
const engineReady = { subscribe: () => () => {} }
const confirm = { confirm: async () => ({ confirmed: false }) }
const shell = { showItemInFolder: async () => {}, openPath: async () => '', openExternal: async () => {} }
const saveConfig = () => {}
const info = {
  contractVersion: MOUNT_CONTRACT_VERSION,
  entry: { path: '/entry' },
  config: { open: 'a.md' },
  saveConfig,
  files,
  workspace,
  children,
  viewState,
  selection,
  intent,
  focus,
  viewStore,
  instanceId,
  terminal,
  listContributions,
  listProjections,
  subscribeContributions,
  preview,
  engineReady,
  confirm,
  shell,
}

describe('createMountHost', () => {
  it('carries the host-supplied info', () => {
    const { transport } = fakeTransport()
    const host = createMountHost(transport, info)
    expect(host.contractVersion).toBe(MOUNT_CONTRACT_VERSION)
    expect(host.entry).toEqual({ path: '/entry' })
  })

  it('forwards the host-supplied composition surface untouched', () => {
    const { transport } = fakeTransport()
    const host = createMountHost(transport, info)
    // The adapter owns the engine RPC; everything else is the host's, passed through.
    expect(host.children).toBe(children)
    expect(host.viewState).toBe(viewState)
    expect(host.files).toBe(files)
    expect(host.workspace).toBe(workspace)
    expect(host.selection).toBe(selection)
    expect(host.intent).toBe(intent)
    expect(host.focus).toBe(focus)
    expect(host.viewStore).toBe(viewStore)
    expect(host.terminal).toBe(terminal)
    expect(host.instanceId).toBe(instanceId)
    expect(host.listContributions).toBe(listContributions)
    expect(host.listProjections).toBe(listProjections)
    expect(host.subscribeContributions).toBe(subscribeContributions)
    expect(host.preview).toBe(preview)
    expect(host.saveConfig).toBe(saveConfig)
    expect(host.config).toEqual({ open: 'a.md' })
  })

  // Iterate every member of info so the forwarding check covers newly added capabilities automatically.
  // An omitted optional member would otherwise look like an unsupported capability.
  it('forwards EVERY member of info, including ones this test was never told about', () => {
    const { transport } = fakeTransport()
    // Optional capabilities the base fixture omits — a new one added to MountHostInfo belongs here.
    const extra = {
      theme: { getOverrides: () => ({}), save() {}, clear() {}, getActiveTheme: () => null, setActiveTheme() {} },
      components: { getActiveSet: () => null, setActiveSet() {} },
      tokens: { rejected: () => [], unreadableSheets: () => 0, subscribe: () => () => {} },
      describeProjections: () => [],
      // The OVERLAY SITE. Listed here because this guard is generic over `info`'s KEYS, not
      // over `MountHostInfo`'s TYPE — a member absent from this fixture is covered vacuously, which
      // is the one way this test can still miss what it was written to catch.
      overlay: { claim: () => ({ el: null as unknown as HTMLElement, release() {} }) },
      contextMenu: { open: () => ({ close() {} }) },
    }
    const full = { ...info, ...extra } as unknown as Parameters<typeof createMountHost>[1]
    const host = createMountHost(transport, full) as unknown as Record<string, unknown>

    // `engine` is the adapter's OWN construction (it wraps the transport), and these two are
    // value-copied rather than passed by identity. Everything else must arrive untouched.
    const adapterOwned = new Set(['contractVersion', 'entry', 'config'])
    const missing: string[] = []
    for (const [key, value] of Object.entries(full as unknown as Record<string, unknown>)) {
      if (adapterOwned.has(key)) continue
      if (host[key] !== value) missing.push(key)
    }
    expect(missing).toEqual([])
    // and the adapter really did add its own surface, so the loop above was not vacuous
    expect(typeof host.engine).toBe('object')
  })

  it('round-trips a read through the transport', async () => {
    const { transport, sent, emit } = fakeTransport()
    const host = createMountHost(transport, info)
    const pending = host.engine.read({ read: 'ready' })
    expect(sent).toEqual([{ kind: 'read', id: 1, request: { read: 'ready' } }])
    emit({ kind: 'read-result', id: 1, result: { ok: true, ready: true, version: 3 } })
    expect(await pending).toEqual({ ok: true, ready: true, version: 3 })
  })

  it('matches concurrent read replies by id, out of order', async () => {
    const { transport, emit } = fakeTransport()
    const host = createMountHost(transport, info)
    const a = host.engine.read({ read: 'a' })
    const b = host.engine.read({ read: 'b' })
    emit({ kind: 'read-result', id: 2, result: { ok: true, ready: false } })
    emit({ kind: 'read-result', id: 1, result: { ok: false, error: 'nope' } })
    expect(await b).toEqual({ ok: true, ready: false })
    expect(await a).toEqual({ ok: false, error: 'nope' })
  })

  it('routes subscription events and returns a synchronous unsubscribe', () => {
    const { transport, sent, emit } = fakeTransport()
    const host = createMountHost(transport, info)
    const events: SubscriptionEvent[] = []
    const off = host.engine.subscribe({ subscribe: 'ready' }, (event) => events.push(event))
    expect(typeof off).toBe('function')
    expect(sent).toEqual([{ kind: 'subscribe', channel: 1, request: { subscribe: 'ready' } }])
    emit({ kind: 'event', channel: 1, event: { kind: 'initial-value', atVersion: 1, result: 7 } })
    off()
    expect(sent[1]).toEqual({ kind: 'unsubscribe', channel: 1 })
    // Events after unsubscribe are dropped, not delivered to a dead channel.
    emit({ kind: 'event', channel: 1, event: { kind: 'change', changeKind: 'x', atVersion: 2 } })
    expect(events).toEqual([{ kind: 'initial-value', atVersion: 1, result: 7 }])
  })

  it('tears the channel down on closed and makes unsubscribe idempotent', () => {
    const { transport, sent, emit } = fakeTransport()
    const host = createMountHost(transport, info)
    const off = host.engine.subscribe({ subscribe: 'ready' }, () => {})
    emit({ kind: 'event', channel: 1, event: { kind: 'closed', reason: 'fatal' } })
    off()
    // `closed` already tore the channel down, so off() sends no unsubscribe.
    expect(sent).toEqual([{ kind: 'subscribe', channel: 1, request: { subscribe: 'ready' } }])
  })
})
