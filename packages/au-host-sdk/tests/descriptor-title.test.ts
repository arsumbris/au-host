// `descriptorTitle` — the single reader of a projection's DECLARED display name.
//
// The name a projection shows is a PROPERTY declared on its type-def (`projection-presentation-meta`)
// and carried to a container on `ProjectionDescriptor.meta`, so a header reads it with no engine read
// of its own. This reader is the ONE place the meta-type name lives; container-core routes through it.

import { describe, expect, it } from 'vitest'

import { descriptorOpens, descriptorTitle, OPENS_META_TYPE, PRESENTATION_META_TYPE } from '../src/index.ts'

const withTitle = (title: unknown): { meta: Record<string, Record<string, unknown>> } => ({
  meta: { [PRESENTATION_META_TYPE]: { title } },
})

describe('descriptorTitle', () => {
  it('reads the declared title off the presentation meta block', () => {
    expect(descriptorTitle(withTitle('Editor'))).toBe('Editor')
  })

  it('is undefined when no presentation block is declared', () => {
    expect(descriptorTitle({ meta: { 'projection-runtime-meta': { entry: './x' } } })).toBeUndefined()
    expect(descriptorTitle({ meta: {} })).toBeUndefined()
    expect(descriptorTitle({})).toBeUndefined()
    expect(descriptorTitle(undefined)).toBeUndefined()
  })

  it('rejects a non-string or empty title rather than returning a bad value', () => {
    expect(descriptorTitle(withTitle(''))).toBeUndefined()
    expect(descriptorTitle(withTitle(42))).toBeUndefined()
    expect(descriptorTitle(withTitle(null))).toBeUndefined()
  })
})

const withOpens = (opens: unknown): { meta: Record<string, Record<string, unknown>> } => ({
  meta: { [OPENS_META_TYPE]: { opens } },
})

describe('descriptorOpens', () => {
  it('reads the declared extension list', () => {
    expect(descriptorOpens(withOpens(['md', 'markdown']))).toEqual(['md', 'markdown'])
    expect(descriptorOpens(withOpens(['*']))).toEqual(['*'])
  })

  it('is undefined when no opens block is declared', () => {
    expect(descriptorOpens({ meta: { 'projection-presentation-meta': { title: 'X' } } })).toBeUndefined()
    expect(descriptorOpens(undefined)).toBeUndefined()
  })

  it('filters non-string / empty entries, and is undefined if nothing survives', () => {
    expect(descriptorOpens(withOpens(['md', 42, '', 'mdx']))).toEqual(['md', 'mdx'])
    expect(descriptorOpens(withOpens([]))).toBeUndefined()
    expect(descriptorOpens(withOpens('md'))).toBeUndefined() // not a list
  })
})
