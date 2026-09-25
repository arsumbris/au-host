// @vitest-environment node
//
// A local store never overwrites data it could not read: only a missing file is a first run. A file that
// exists but cannot be read, does not parse, or is not a JSON object is moved aside before anything is
// written; if it cannot be moved, nothing is written.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import fsModule from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

import { LocalStoreFile } from '../src/main/local-store-file.ts'

let dir: string
let file: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-store-'))
  file = path.join(dir, 'store.json')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

const store = () => new LocalStoreFile<Record<string, number>>(file, () => ({}))
const asides = () => fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'))

describe('LocalStoreFile', () => {
  it('a missing file is a first run, and a flush creates it', () => {
    const s = store()
    s.get().a = 1
    s.flushNow()
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ a: 1 })
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([])
  })

  it('round-trips an existing object', () => {
    fs.writeFileSync(file, JSON.stringify({ a: 2 }))
    expect(store().get()).toEqual({ a: 2 })
  })

  it('an unparsable file is moved aside before the first flush', () => {
    fs.writeFileSync(file, '{ not json')
    const s = store()
    s.get().a = 1
    s.flushNow()
    expect(asides()).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, asides()[0]), 'utf8')).toBe('{ not json')
  })

  it('valid JSON that is not an object is moved aside, not used', () => {
    fs.writeFileSync(file, 'null')
    expect(store().get()).toEqual({})
    expect(asides()).toHaveLength(1)
  })

  it('a file that exists but cannot be read is moved aside, not treated as empty', () => {
    fs.writeFileSync(file, JSON.stringify({ precious: 1 }))
    fs.chmodSync(file, 0o000)
    const s = store()
    s.get().a = 1
    s.flushNow()
    fs.chmodSync(path.join(dir, asides()[0]), 0o600)
    expect(JSON.parse(fs.readFileSync(path.join(dir, asides()[0]), 'utf8'))).toEqual({ precious: 1 })
  })

  it('an unusable file that cannot be moved aside is never overwritten', () => {
    fs.writeFileSync(file, '{ not json')
    // Only the move-aside fails; the flush's own temp write + rename would succeed.
    const rename = fsModule.renameSync
    fsModule.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
      if (String(to).includes('.corrupt-')) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
      return rename(from, to)
    }) as typeof fsModule.renameSync
    syncBuiltinESMExports()
    try {
      const s = store()
      s.get().a = 1
      s.flushNow()
    } finally {
      fsModule.renameSync = rename
      syncBuiltinESMExports()
    }
    expect(fs.readFileSync(file, 'utf8')).toBe('{ not json')
  })
})
