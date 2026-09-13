import { describe, expect, it } from 'vitest'

import { checkProjectionMeta, MOUNT_CONTRACT_VERSION } from '../src/index.ts'

// The runtime meta read off a projection subtype's type-def (`readType` ->
// `meta_blocks`, body assembled into a record). Code is resolved via
// the type owner + this meta's `entry`, not a manifest.json.
const valid = {
  entry: './entry.js',
  contractVersion: MOUNT_CONTRACT_VERSION,
}

describe('checkProjectionMeta', () => {
  it('accepts a valid runtime meta and returns the narrowed shape', () => {
    const result = checkProjectionMeta({ ...valid, extra: 'ignored' })
    // The engine's meta_blocks body omits the type claim; checkProjectionMeta stamps it.
    expect(result).toEqual({ ok: true, meta: { type: 'projection-runtime-meta', ...valid } })
  })

  it('rejects non-object values', () => {
    for (const value of [null, undefined, 42, 'meta', []]) {
      const result = checkProjectionMeta(value)
      if (Array.isArray(value)) {
        // Arrays are objects; they fail on the missing fields instead.
        expect(result.ok).toBe(false)
        continue
      }
      expect(result).toEqual({ ok: false, errors: ['projection runtime meta is not an object'] })
    }
  })

  it('collects one error per missing or malformed field', () => {
    const result = checkProjectionMeta({ entry: undefined })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toEqual([
      "'entry' must be a non-empty string",
      "'contractVersion' must be a number",
    ])
  })

  it('rejects a contract version mismatch loudly', () => {
    const result = checkProjectionMeta({ ...valid, contractVersion: MOUNT_CONTRACT_VERSION + 1 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toEqual([
      `contract version mismatch: projection built against v${MOUNT_CONTRACT_VERSION + 1}, host speaks v${MOUNT_CONTRACT_VERSION}`,
    ])
  })

  it('rejects the pre-RPC v1 by-reference contract', () => {
    // The v2 bump makes MountHost RPC-shaped; a v1 projection fails the handshake.
    const result = checkProjectionMeta({ ...valid, contractVersion: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toEqual([
      `contract version mismatch: projection built against v1, host speaks v${MOUNT_CONTRACT_VERSION}`,
    ])
  })

  it('only checks the version once the fields are well-formed', () => {
    const result = checkProjectionMeta({ contractVersion: 99, entry: '' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    // Field errors come first; no premature version complaint.
    expect(result.errors).toEqual(["'entry' must be a non-empty string"])
  })

  it('carries customTokenEntry through as an array when given an array', () => {
    const meta = { ...valid, customTokenEntry: ['./tokens.css', './more.css'] }
    const result = checkProjectionMeta(meta)
    expect(result).toEqual({ ok: true, meta: { type: 'projection-runtime-meta', ...meta } })
  })

  it('normalizes a bare-string customTokenEntry to an array (type list-form)', () => {
    const result = checkProjectionMeta({ ...valid, customTokenEntry: './tokens.css' })
    if (!result.ok) throw new Error('expected ok')
    // A single-value list may be authored bare; the engine delivers a scalar.
    expect(result.meta.customTokenEntry).toEqual(['./tokens.css'])
  })

  it('omits customTokenEntry from the narrowed meta when absent', () => {
    const result = checkProjectionMeta(valid)
    if (!result.ok) throw new Error('expected ok')
    expect('customTokenEntry' in result.meta).toBe(false)
  })

  it('rejects a malformed customTokenEntry (empty array, empty string, non-string entries)', () => {
    for (const bad of [[], [''], ['ok', ''], [42]]) {
      const result = checkProjectionMeta({ ...valid, customTokenEntry: bad })
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.errors).toContain(
        "'customTokenEntry' must be a non-empty string or array of non-empty strings",
      )
    }
  })
})
