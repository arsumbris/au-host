// A TypeKey is `name::owner`: an authored ref resolves in its file's repo, a wire identity keys as-is, and the
// written form is bare only in the owner's own files.

import { describe, expect, it } from 'vitest'

import { ARITY_META, authoredRef, codeMetaBlock, PROJECTION_RUNTIME_META, metaBlock, metaBlocks, CONTAINER_PROJECTION, hasKind, keyOf, metaTypeKeys, nameOf, ownerOf, typeKey, type TypeKey } from '../src/type-key.ts'

describe('typeKey', () => {
  it('resolves a bare name in the authoring file repo', () => {
    expect(typeKey('tabs', 'my-repo')).toBe('tabs::my-repo')
  })
  it('takes a qualified name as written', () => {
    expect(typeKey('tabs::tabs', 'my-repo')).toBe('tabs::tabs')
  })
  it('treats an empty qualifier as bare', () => {
    expect(typeKey('tabs::', 'my-repo')).toBe('tabs::my-repo')
  })
  it('keeps two repos same-named types apart', () => {
    expect(typeKey('tabs', 'peer')).not.toBe(typeKey('tabs::tabs', 'my-repo'))
  })
})

describe('keyOf / nameOf / ownerOf', () => {
  it('keys a wire identity and splits it back', () => {
    const k = keyOf({ name: 'container-projection', repo: 'au-host-sdk' })
    expect(k).toBe(CONTAINER_PROJECTION)
    expect(nameOf(k)).toBe('container-projection')
    expect(ownerOf(k)).toBe('au-host-sdk')
  })
})

describe('authoredRef', () => {
  it('writes bare in the owner repo and qualified elsewhere', () => {
    const k = typeKey('tabs::tabs', 'my-repo')
    expect(authoredRef(k, 'tabs')).toBe('tabs')
    expect(authoredRef(k, 'my-repo')).toBe('tabs::tabs')
  })
  it('round-trips through typeKey from either repo', () => {
    const k = keyOf({ name: 'tabs', repo: 'tabs' })
    for (const repo of ['tabs', 'my-repo']) expect(typeKey(authoredRef(k, repo), repo)).toBe(k)
  })
})

describe('hasKind', () => {
  it('matches the owner, not only the name', () => {
    const ours = { kinds: [CONTAINER_PROJECTION] }
    const peers = { kinds: [keyOf({ name: 'container-projection', repo: 'peer' })] as TypeKey[] }
    expect(hasKind(ours, CONTAINER_PROJECTION)).toBe(true)
    expect(hasKind(peers, CONTAINER_PROJECTION)).toBe(false)
  })
})

describe('metaTypeKeys', () => {
  it('keys a meta type once per owner, and not at all when unresolved', () => {
    expect(metaTypeKeys({ name: 'arity-meta', type_owners: ['au-host-sdk'] })).toEqual([ARITY_META])
    expect(metaTypeKeys({ name: 'arity-meta', type_owners: [] })).toEqual([])
  })
})

describe('metaBlock', () => {
  const def = {
    effective_meta: [
      { meta_type: { name: 'arity-meta', type_owners: ['au-host-sdk'] }, blocks: ['inherited'] },
      { meta_type: { name: 'arity-meta', type_owners: ['peer'] }, blocks: ['peer-a', 'peer-b'] },
    ],
  }
  it('finds the block of that meta identity only', () => {
    expect(metaBlock(def, ARITY_META)).toBe('inherited')
  })
  it('returns no winner for a conflict, and every block from metaBlocks', () => {
    const peer = keyOf({ name: 'arity-meta', repo: 'peer' })
    expect(metaBlock(def, peer)).toBeUndefined()
    expect(metaBlocks(def, peer)).toEqual(['peer-a', 'peer-b'])
  })
})

describe('codeMetaBlock', () => {
  const runtime = { name: 'projection-runtime-meta', hash: 'h', type_owners: ['au-host-sdk'] }
  const block = (from: string, entry = './dist/index.js') => ({ from: { name: from, repo: 'pkg' }, entry })
  const view = (blocks: ReturnType<typeof block>[], unmet: string[] = []) => ({
    name: 'leaf',
    repo: 'pkg',
    unmet_required_meta: unmet,
    effective_meta: blocks.length ? [{ meta_type: runtime, blocks }] : [],
  })

  it('loads the type\'s own block', () => {
    const own = block('leaf')
    expect(codeMetaBlock(view([own]), PROJECTION_RUNTIME_META)).toEqual({ kind: 'own', block: own })
  })
  it('never loads an ancestor\'s block, and says why', () => {
    const r = codeMetaBlock(view([block('base')]), PROJECTION_RUNTIME_META)
    expect(r.kind).toBe('not-own')
    expect(r.kind === 'not-own' && r.reason).toMatch(/base::pkg.*never loaded/)
  })
  it('refuses several own blocks', () => {
    expect(codeMetaBlock(view([block('leaf'), block('leaf', './other.js')]), PROJECTION_RUNTIME_META).kind).toBe('not-own')
  })
  it('carries the engine\'s unmet required meta', () => {
    const r = codeMetaBlock(view([], ['projection-runtime-meta::au-host-sdk']), PROJECTION_RUNTIME_META)
    expect(r.kind === 'not-own' && r.reason).toMatch(/unmet: projection-runtime-meta::au-host-sdk/)
  })
  it('is absent when nothing declares or requires it', () => {
    expect(codeMetaBlock(view([]), PROJECTION_RUNTIME_META)).toEqual({ kind: 'absent' })
  })
  it('matches the meta by identity, not by name', () => {
    const peer = { name: 'leaf', repo: 'pkg', unmet_required_meta: [], effective_meta: [{ meta_type: { ...runtime, type_owners: ['peer'] }, blocks: [block('leaf')] }] }
    expect(codeMetaBlock(peer, PROJECTION_RUNTIME_META)).toEqual({ kind: 'absent' })
  })
})
