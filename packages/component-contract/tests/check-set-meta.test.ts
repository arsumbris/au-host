import { describe, expect, it } from 'vitest'

import {
  checkComponentSetMeta,
  componentRefName,
  COMPONENT_CONTRACT_VERSION,
} from '../src/index.ts'

// A well-formed `component-set-runtime-meta` block body (as the engine's
// meta_blocks pass would assemble it — no `type:` claim, provides as def-ref wikilinks).
const valid = {
  entry: './dist/index.js',
  contractVersion: COMPONENT_CONTRACT_VERSION,
  provides: ['[[au-button::au-component-catalog]]'],
}

describe('checkComponentSetMeta', () => {
  it('accepts a valid runtime meta and stamps the type claim', () => {
    const result = checkComponentSetMeta({ ...valid, extra: 'ignored' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // The engine's meta_blocks body omits the type claim; the check stamps it.
      expect(result.meta.type).toBe('component-set-runtime-meta')
      expect(result.meta.entry).toBe('./dist/index.js')
      expect(result.meta.contractVersion).toBe(COMPONENT_CONTRACT_VERSION)
      expect(result.meta.provides).toEqual(['[[au-button::au-component-catalog]]'])
      // `export` is optional; absent here, so it is not carried through.
      expect('export' in result.meta).toBe(false)
    }
  })

  it('carries an explicit export through', () => {
    const result = checkComponentSetMeta({ ...valid, export: 'registerNeon' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.meta.export).toBe('registerNeon')
  })

  it('carries an optional customTokenEntry through, absent by default', () => {
    const absent = checkComponentSetMeta(valid)
    expect(absent.ok).toBe(true)
    if (absent.ok) expect('customTokenEntry' in absent.meta).toBe(false)

    const present = checkComponentSetMeta({ ...valid, customTokenEntry: ['./component-set.tokens.css'] })
    expect(present.ok).toBe(true)
    if (present.ok) expect(present.meta.customTokenEntry).toEqual(['./component-set.tokens.css'])
  })

  it('rejects a malformed customTokenEntry (empty list or non-string entries)', () => {
    for (const bad of [[], [''], [42], 'not-a-list']) {
      const result = checkComponentSetMeta({ ...valid, customTokenEntry: bad })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.some((e) => e.includes('customTokenEntry'))).toBe(true)
    }
  })

  it('rejects non-object values', () => {
    for (const value of [null, undefined, 42, 'meta', [valid]]) {
      const result = checkComponentSetMeta(value)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0)
    }
  })

  it('collects one error per missing or malformed field', () => {
    const result = checkComponentSetMeta({ entry: '', contractVersion: 'nope', provides: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(3)
      expect(result.errors.some((e) => e.includes('entry'))).toBe(true)
      expect(result.errors.some((e) => e.includes('contractVersion'))).toBe(true)
      expect(result.errors.some((e) => e.includes('provides'))).toBe(true)
    }
  })

  it('accepts a bare-string provides (type list-form) and normalizes to an array', () => {
    const result = checkComponentSetMeta({ ...valid, provides: '[[au-button::au-component-catalog]]' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.meta.provides).toEqual(['[[au-button::au-component-catalog]]'])
  })

  it('rejects an empty provides list', () => {
    const result = checkComponentSetMeta({ ...valid, provides: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.includes('provides'))).toBe(true)
  })

  it('rejects a contract version mismatch loudly', () => {
    const result = checkComponentSetMeta({ ...valid, contractVersion: COMPONENT_CONTRACT_VERSION + 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toMatch(/contract version mismatch/)
  })

  it('only checks the version once the fields are well-formed', () => {
    // A bad version AND a bad shape → the shape errors report first, not the version.
    const result = checkComponentSetMeta({ contractVersion: 99, entry: '', provides: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.includes('version mismatch'))).toBe(false)
  })
})

describe('componentRefName', () => {
  it('strips the wikilink frame, the ::repo qualifier, and any display/anchor', () => {
    expect(componentRefName('[[au-button::au-component-catalog]]')).toBe('au-button')
    expect(componentRefName('[[au-dropdown]]')).toBe('au-dropdown')
    expect(componentRefName('[[au-card::component-contract|Card]]')).toBe('au-card')
    expect(componentRefName('[[au-tree#heading]]')).toBe('au-tree')
  })

  it('returns undefined for an empty ref', () => {
    expect(componentRefName('[[]]')).toBeUndefined()
    expect(componentRefName('')).toBeUndefined()
  })
})
