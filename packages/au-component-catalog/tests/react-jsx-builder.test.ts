import { describe, expect, it } from 'vitest'

import { buildReactJsxAugmentation, tagToInterface } from '../scripts/react-jsx-builder.ts'

describe('tagToInterface', () => {
  it('maps kebab tags to PascalCase interface names (matching the neutral codegen)', () => {
    expect(tagToInterface('au-button')).toBe('AuButton')
    expect(tagToInterface('au-card')).toBe('AuCard')
    expect(tagToInterface('au-command-palette')).toBe('AuCommandPalette')
    expect(tagToInterface('au-tree-item')).toBe('AuTreeItem')
  })
})

describe('buildReactJsxAugmentation', () => {
  const src = buildReactJsxAugmentation(['au-command-palette', 'au-button', 'au-card'])

  it('imports each interface (sorted) from the sibling ./generated', () => {
    expect(src).toContain("import type { AuButton, AuCard, AuCommandPalette } from './generated'")
    expect(src).toContain("import type { DetailedHTMLProps, HTMLAttributes } from 'react'")
  })

  it('augments react JSX IntrinsicElements with one Props-typed entry per tag', () => {
    expect(src).toContain("declare module 'react'")
    expect(src).toContain('interface IntrinsicElements')
    expect(src).toContain("'au-button': Props<AuButton>")
    expect(src).toContain("'au-card': Props<AuCard>")
    expect(src).toContain("'au-command-palette': Props<AuCommandPalette>")
  })

  it('strips the type discriminant via Omit<T, type>', () => {
    expect(src).toContain("Omit<T, 'type'>")
  })

  it('sorts + dedups tags for a stable, order-independent emit', () => {
    const a = buildReactJsxAugmentation(['au-card', 'au-button', 'au-button'])
    const b = buildReactJsxAugmentation(['au-button', 'au-card'])
    expect(a).toBe(b)
  })

  it('emits no tag entries for an empty catalog (still a valid augmentation shell)', () => {
    const empty = buildReactJsxAugmentation([])
    expect(empty).toContain('interface IntrinsicElements')
    expect(empty).not.toContain('Props<Au') // no component-specific rows
  })
})
