// @vitest-environment node
//
// The workspace claim: a switch acquires the new workspace before giving up the old one, a failed switch
// leaves the old claim untouched, claims never race each other, and a stale socket file is taken over.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '' } }))

import { InstancePresence, instanceSocketPath } from '../src/main/instance-socket.ts'

let root: string
let a: string
let b: string
const live: InstancePresence[] = []
const presence = (onFocus = () => {}): InstancePresence => {
  const p = new InstancePresence(onFocus)
  live.push(p)
  return p
}

beforeEach(() => {
  // Short: a unix socket path is capped at 104 bytes on macOS.
  root = fs.mkdtempSync('/tmp/auip-')
  process.env.AU_HOST_DEVICE_DIR = path.join(root, 'd')
  a = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-a-'))
  b = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-b-'))
})
afterEach(() => {
  for (const p of live.splice(0)) p.release()
  delete process.env.AU_HOST_DEVICE_DIR
  for (const d of [root, a, b]) fs.rmSync(d, { recursive: true, force: true })
})

describe('InstancePresence', () => {
  it('a switch binds the new workspace, hands over while both are held, then releases the old', async () => {
    const me = presence()
    expect(await me.claim(a)).toBe(true)
    let heldDuringHandover: [boolean, boolean] | null = null
    expect(
      await me.claim(b, () => {
        heldDuringHandover = [fs.existsSync(instanceSocketPath(a)), fs.existsSync(instanceSocketPath(b))]
      }),
    ).toBe(true)
    expect(heldDuringHandover).toEqual([true, true])
    expect(fs.existsSync(instanceSocketPath(a))).toBe(false)
    expect(me.boundSocket).toBe(instanceSocketPath(b))
  })

  it('a failed switch keeps the old claim and runs no handover', async () => {
    const other = presence()
    expect(await other.claim(b)).toBe(true) // another instance holds b
    const me = presence()
    expect(await me.claim(a)).toBe(true)
    const handover = vi.fn()
    expect(await me.claim(b, handover)).toBe(false)
    expect(handover).not.toHaveBeenCalled()
    expect(me.boundSocket).toBe(instanceSocketPath(a))
    expect(fs.existsSync(instanceSocketPath(a))).toBe(true)
    // …and the old claim still answers: a third instance cannot take a.
    expect(await presence().claim(a)).toBe(false)
  })

  it('a live holder is asked to focus', async () => {
    const focus = vi.fn()
    await presence(focus).claim(a)
    expect(await presence().claim(a)).toBe(false)
    await vi.waitFor(() => expect(focus).toHaveBeenCalled())
  })

  it('concurrent claims settle on the last one requested, leaving no other socket bound', async () => {
    const me = presence()
    const results = await Promise.all([me.claim(a), me.claim(b), me.claim(a), me.claim(a)])
    expect(results).toEqual([true, true, true, true])
    expect(me.boundSocket).toBe(instanceSocketPath(a))
    expect(fs.existsSync(instanceSocketPath(b))).toBe(false)
  })

  it('a stale socket file (nothing listening) is taken over', async () => {
    const socketFile = instanceSocketPath(a)
    fs.mkdirSync(path.dirname(socketFile), { recursive: true })
    fs.writeFileSync(socketFile, '') // a leftover file refuses every connect
    expect(await presence().claim(a)).toBe(true)
  })
})
