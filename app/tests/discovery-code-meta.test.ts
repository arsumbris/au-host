// Projection discovery loads only code a type declares itself.
//
// A code-pointing meta (`projection-runtime-meta`) is the type's OWN block, never an ancestor's: an
// inherited one, several own ones, or an unmet required meta make a concrete projection a REJECTION with
// its reason, never a silent absence and never a mount on someone else's code. Drives `discoverProjections`
// over a fake reader serving synthetic type views, so no daemon is involved.

import { describe, expect, it } from 'vitest'

import type { WireReader, WireSubtype } from '@arsumbris/au-engine-sdk/reads'

import { discoverProjections } from '../src/renderer/src/projections/discovery.ts'
import { MOUNT_CONTRACT_VERSION } from '@arsumbris/au-host-sdk'

const RUNTIME = { name: 'projection-runtime-meta', hash: 'h', type_owners: ['au-host-sdk'] }

/** A runtime block declared by `from` (a type in package `pkg-<from>`). */
function runtimeBlock(from: string, entry = './dist/index.js') {
  return {
    type_name: 'projection-runtime-meta::au-host-sdk',
    body: [
      { name: 'entry', value: entry },
      { name: 'contractVersion', value: MOUNT_CONTRACT_VERSION },
    ],
    source: { file: `/ws/pkg-${from}/type/${from}.type.yaml` },
    from: { name: from, repo: 'pkg', hash: 'h' },
  }
}

function subtype(name: string, opts: { blocks?: ReturnType<typeof runtimeBlock>[]; abstract?: boolean; unmet?: string[] } = {}): WireSubtype {
  return {
    name,
    repo: 'pkg',
    hash: 'h',
    abstract: opts.abstract ?? false,
    parents: [],
    required_meta: [],
    unmet_required_meta: opts.unmet ?? [],
    sealed: null,
    fields: [],
    meta_blocks: null,
    body: null,
    effective_fields: [],
    effective_meta: opts.blocks?.length ? [{ meta_type: RUNTIME, blocks: opts.blocks }] : [],
    effective_body: null,
    source: { file: `/ws/pkg-${name}/type/${name}.type.yaml` },
  } as unknown as WireSubtype
}

const reader = (subtypes: WireSubtype[]): WireReader => ({
  read: async () => ({ ready: true, version: 1, result: { base: 'projection', subtypes } }) as never,
})

describe('discoverProjections: code is the type\'s own', () => {
  it('loads a type that declares its own runtime block, from its own package', async () => {
    const { projections, rejected } = await discoverProjections(reader([subtype('leaf', { blocks: [runtimeBlock('leaf')] })]))
    expect(rejected).toEqual([])
    expect(projections.map((p) => [p.typeName, p.packageRoot])).toEqual([['leaf', '/ws/pkg-leaf']])
  })

  it('rejects, with its reason, a concrete type that only inherits an ancestor\'s code', async () => {
    const { projections, rejected } = await discoverProjections(reader([subtype('preset', { blocks: [runtimeBlock('base')] })]))
    expect(projections).toEqual([])
    expect(rejected).toHaveLength(1)
    expect(rejected[0].typeName).toBe('preset')
    expect(rejected[0].errors.join(' ')).toMatch(/no `projection-runtime-meta` of its own.*base::pkg.*never loaded/)
  })

  it('rejects a type declaring two runtime blocks of its own', async () => {
    const { rejected } = await discoverProjections(reader([subtype('leaf', { blocks: [runtimeBlock('leaf'), runtimeBlock('leaf', './other.js')] })]))
    expect(rejected.map((r) => r.typeName)).toEqual(['leaf'])
  })

  it('rejects a type the engine reports unmet, carrying the engine\'s verdict', async () => {
    const { rejected } = await discoverProjections(reader([subtype('bare', { unmet: ['projection-runtime-meta::au-host-sdk'] })]))
    expect(rejected[0].errors.join(' ')).toMatch(/unmet: projection-runtime-meta::au-host-sdk/)
  })

  it('never mounts an abstract type, even one carrying code', async () => {
    const { projections, rejected } = await discoverProjections(reader([subtype('kind', { abstract: true, blocks: [runtimeBlock('kind')] })]))
    expect(projections).toEqual([])
    expect(rejected).toEqual([])
  })

  it('skips a type that declares no code and owes none', async () => {
    const { projections, rejected } = await discoverProjections(reader([subtype('note')]))
    expect(projections).toEqual([])
    expect(rejected).toEqual([])
  })
})
