import { describe, it, expect } from 'vitest'
import type { WireReader } from '@arsumbris/au-host-sdk/engine-reads'
import { completionsFor, makeSource, type CompletionDeps } from './completion'

// A stub daemon: answers `type_closure` from a fixture, everything else empty.
// Shaped like the wire — `{ ready, version, result: { <verb>: … } }` — so the
// SDK's own helper does the unwrapping and we test what it actually hands us.
function reader(closures: Record<string, unknown[]>): WireReader {
  return {
    async read(request: { read: string } & Record<string, unknown>) {
      if (request.read !== 'type_closure') return { ready: true, version: 1, result: {} } as never
      const name = request.name as string
      return {
        ready: true,
        version: 1,
        result: { type_closure: closures[name] ?? [] },
      } as never
    },
  }
}

function field(name: string, shape: string, required: boolean, doc?: string) {
  return {
    name,
    shape,
    shape_ast: null,
    required,
    ...(doc !== undefined && { doc }),
    origin: { name: 'decision', repo: 'notes', closure_id: 'abc' },
  }
}

const DECISION = {
  identity: { name: 'decision', repo: 'notes', closure_id: 'abc' },
  ancestors: [],
  fields: [
    field('description', 'String', true, 'what was decided'),
    field('confidence', '[low, high]', false),
    field('rationale', 'String', false),
  ],
}

function deps(closures: Record<string, unknown[]>): CompletionDeps {
  return { engine: reader(closures), path: () => 'notes/a.md' }
}

describe('completionsFor — frontmatter keys', () => {
  it('offers the claimed type\'s effective fields', async () => {
    const out = await completionsFor(deps({ decision: [DECISION] }), '---\ntype: decision\n', 'notes/a.md')
    expect(out.map((o) => o.label).sort()).toEqual(['confidence', 'description', 'rationale'])
  })

  it('drops fields already present in the block', async () => {
    const before = '---\ntype: decision\ndescription: "x"\n'
    const out = await completionsFor(deps({ decision: [DECISION] }), before, 'notes/a.md')
    expect(out.map((o) => o.label).sort()).toEqual(['confidence', 'rationale'])
  })

  // A required-but-absent field is the highest-value suggestion, so it is marked
  // and boosted above the optional ones.
  it('marks required fields and sorts them first', async () => {
    const out = await completionsFor(deps({ decision: [DECISION] }), '---\ntype: decision\n', 'notes/a.md')
    const description = out.find((o) => o.label === 'description')
    expect(description?.detail).toBe('String · required')
    expect(description?.boost).toBe(1)
    expect(out.find((o) => o.label === 'rationale')?.detail).toBe('String')
  })

  it('surfaces the field docstring, which the engine captures for exactly this', async () => {
    const out = await completionsFor(deps({ decision: [DECISION] }), '---\ntype: decision\n', 'notes/a.md')
    expect(out.find((o) => o.label === 'description')?.info).toBe('what was decided')
  })

  it('completes the key with its colon, so the caret lands on the value', async () => {
    const out = await completionsFor(deps({ decision: [DECISION] }), '---\ntype: decision\n', 'notes/a.md')
    expect(out.find((o) => o.label === 'confidence')?.apply).toBe('confidence: ')
  })

  // A bare claim is MULTI-FIT: one identity per mounted repo can match, and every
  // identity's fields are legitimate candidates.
  it('unions the fields across every matching identity, deduped', async () => {
    const other = {
      identity: { name: 'decision', repo: 'other', closure_id: 'def' },
      ancestors: [],
      fields: [field('description', 'String', true), field('owner', 'person*', false)],
    }
    const out = await completionsFor(deps({ decision: [DECISION, other] }), '---\ntype: decision\n', 'notes/a.md')
    expect(out.map((o) => o.label).sort()).toEqual(['confidence', 'description', 'owner', 'rationale'])
  })

  it('gathers a mixin claim across both claimed types', async () => {
    const deliverable = {
      identity: { name: 'deliverable', repo: 'notes', closure_id: 'ghi' },
      ancestors: [],
      fields: [field('audience', 'String', false)],
    }
    const before = '---\ntype:\n  - decision\n  - deliverable\n'
    const out = await completionsFor(deps({ decision: [DECISION], deliverable: [deliverable] }), before, 'notes/a.md')
    expect(out.map((o) => o.label).sort()).toEqual(['audience', 'confidence', 'description', 'rationale'])
  })

  it('offers nothing for an unclaimed block, rather than guessing', async () => {
    expect(await completionsFor(deps({}), '---\n', 'notes/a.md')).toEqual([])
  })

  it('offers nothing when the claim resolves to no type', async () => {
    expect(await completionsFor(deps({}), '---\ntype: ghost\n', 'notes/a.md')).toEqual([])
  })

  // An inline record's keys belong to that record's own type, not the block's
  // claim, so offering the outer type's fields there would be wrong.
  it('declines inside an inline record', async () => {
    const before = '---\ntype: decision\nsupport:\n  description: "x"\n  conf'
    expect(await completionsFor(deps({ decision: [DECISION] }), before, 'notes/a.md')).toEqual([])
  })
})

describe('completionsFor — type-def files', () => {
  // A type-def's top-level keys are the engine's reserved set, never a claimed
  // type's fields. Offering instance fields here would be actively wrong.
  it('offers the reserved keys, not instance fields', async () => {
    const out = await completionsFor(deps({ decision: [DECISION] }), '---\ntype: decision\n', 'notes/type/x.type.yaml')
    expect(out.map((o) => o.label).sort()).toEqual(['abstract', 'body', 'fields', 'meta', 'sealed', 'type'])
  })

  it('recognises a bundle and a type/ directory as type-def sites', async () => {
    const bundle = await completionsFor(deps({}), '---\n', 'notes/type/decision.yamls')
    const dir = await completionsFor(deps({}), '---\n', 'notes/type/nested/x.yaml')
    expect(bundle.map((o) => o.label)).toContain('sealed')
    expect(dir.map((o) => o.label)).toContain('sealed')
  })
})

describe('completionsFor — quiet where nothing is meaningful', () => {
  it('offers nothing in body prose', async () => {
    const out = await completionsFor(deps({ decision: [DECISION] }), '---\ntype: decision\n---\n\nplain prose', 'notes/a.md')
    expect(out).toEqual([])
  })

  it('offers nothing with no file open', async () => {
    expect(await completionsFor(deps({}), 'some prose', null)).toEqual([])
  })
})

// ── fm-value ─────────────────────────────────────────────────────────────

// A richer stub: `type_closure` plus `instances_of` and `subtypes`.
function valueReader(fields: unknown[], instances: Record<string, string[]> = {}, subtypes: Record<string, string[]> = {}): WireReader {
  return {
    async read(request: { read: string } & Record<string, unknown>) {
      const wrap = (v: unknown) => ({ ready: true, version: 1, result: { [request.read]: v } }) as never
      if (request.read === 'type_closure') {
        return wrap([{ identity: { name: 'd', repo: 'notes', closure_id: 'a' }, ancestors: [], fields }])
      }
      if (request.read === 'instances_of') {
        return wrap((instances[request.type as string] ?? []).map((path) => ({ path, claim: [], fields: {}, name: 'x', hash: 'h', type_owners: [], member: 'notes', claimed: true, inherited: false, origin: 'file', span: { start: 0, end: 0 }, locator: null })))
      }
      if (request.read === 'subtypes') {
        // WHOLE-ENVELOPE: `readSubtypes` passes `unwrap: false`, so `result` is
        // `{ base, subtypes }` itself, not nested under the verb key.
        return {
          ready: true,
          version: 1,
          result: { base: request.base, subtypes: (subtypes[request.base as string] ?? []).map((name) => ({ name, repo: 'notes' })) },
        } as never
      }
      return wrap(null)
    },
  }
}

function shaped(shape_ast: unknown, extra: Record<string, unknown> = {}) {
  return [{ name: 'f', shape: 'x', shape_ast, required: false, origin: { name: 'd', repo: 'notes', closure_id: 'a' }, ...extra }]
}

const at = (v = '') => `---\ntype: d\nf: ${v}`

describe('completionsFor — frontmatter values', () => {
  it('offers an enum\'s literal members, the exact closed case', async () => {
    const d: CompletionDeps = { engine: valueReader(shaped({ kind: 'enum', members: ['low', 'high'] })), path: () => 'a.md' }
    const out = await completionsFor(d, at(), 'a.md')
    expect(out.map((o) => o.label)).toEqual(['low', 'high'])
    expect(out[0].apply).toBe('low')
  })

  it('offers nothing for a String, rather than inventing values', async () => {
    const d: CompletionDeps = { engine: valueReader(shaped({ kind: 'primitive', name: 'String' })), path: () => 'a.md' }
    expect(await completionsFor(d, at(), 'a.md')).toEqual([])
  })

  it('special-cases Boolean, whose value set is exactly two', async () => {
    const d: CompletionDeps = { engine: valueReader(shaped({ kind: 'primitive', name: 'Boolean' })), path: () => 'a.md' }
    expect((await completionsFor(d, at(), 'a.md')).map((o) => o.label)).toEqual(['true', 'false'])
  })

  it('offers instances of a reference slot as quoted wikilinks', async () => {
    const d: CompletionDeps = {
      engine: valueReader(shaped({ kind: 'reference', name: 'person' }), { person: ['people/alice.md'] }),
      path: () => 'a.md',
    }
    const out = await completionsFor(d, at(), 'a.md')
    expect(out[0]).toMatchObject({ label: 'alice', detail: 'people/alice.md', apply: '"[[alice]]"' })
  })

  it('does not double an opening quote the author already typed', async () => {
    const d: CompletionDeps = {
      engine: valueReader(shaped({ kind: 'reference', name: 'person' }), { person: ['people/alice.md'] }),
      path: () => 'a.md',
    }
    expect((await completionsFor(d, at('"'), 'a.md'))[0].apply).toBe('[[alice]]')
  })

  // `file*` and `any*` admit every file / node, so there is no type to enumerate.
  it('offers nothing for the no-closure built-ins', async () => {
    for (const name of ['file', 'any']) {
      const d: CompletionDeps = { engine: valueReader(shaped({ kind: 'reference', name })), path: () => 'a.md' }
      expect(await completionsFor(d, at(), 'a.md')).toEqual([])
    }
  })

  it('offers type-defs under a def-ref bound', async () => {
    const d: CompletionDeps = {
      engine: valueReader(shaped({ kind: 'def-reference', bound: { kind: 'single', name: 'mcp.tool' } }), {}, { 'mcp.tool': ['mcp.tool.grep'] }),
      path: () => 'a.md',
    }
    expect((await completionsFor(d, at(), 'a.md'))[0]).toMatchObject({ label: 'mcp.tool.grep', apply: '"[[mcp.tool.grep]]"' })
  })

  it('offers nothing for an unconstrained type*, which has no ceiling to read from', async () => {
    const d: CompletionDeps = { engine: valueReader(shaped({ kind: 'def-reference' })), path: () => 'a.md' }
    expect(await completionsFor(d, at(), 'a.md')).toEqual([])
  })

  // A list element and a pinned value are still values of the inner shape.
  it('passes through the list wrapper to the element shape', async () => {
    const d: CompletionDeps = {
      engine: valueReader(shaped({ kind: 'list', min: 0, inner: { kind: 'enum', members: ['a', 'b'] } })),
      path: () => 'a.md',
    }
    expect((await completionsFor(d, '---\ntype: d\nf:\n  - ', 'a.md')).map((o) => o.label)).toEqual(['a', 'b'])
  })

  it('passes through the pinned wrapper', async () => {
    const d: CompletionDeps = {
      engine: valueReader(shaped({ kind: 'pinned', inner: { kind: 'reference', name: 'person' } }), { person: ['alice.md'] }),
      path: () => 'a.md',
    }
    expect((await completionsFor(d, at(), 'a.md')).map((o) => o.label)).toEqual(['alice'])
  })

  it('unions a compound slot\'s branches', async () => {
    const d: CompletionDeps = {
      engine: valueReader(
        shaped({ kind: 'union', branches: [{ kind: 'primitive', name: 'String' }, { kind: 'enum', members: ['x'] }] }),
      ),
      path: () => 'a.md',
    }
    expect((await completionsFor(d, at(), 'a.md')).map((o) => o.label)).toEqual(['x'])
  })

  it('offers nothing for a field outside the shape, an open-world extra', async () => {
    const d: CompletionDeps = { engine: valueReader(shaped({ kind: 'enum', members: ['x'] })), path: () => 'a.md' }
    expect(await completionsFor(d, '---\ntype: d\nunknownField: ', 'a.md')).toEqual([])
  })
})

// ── fm-type ──────────────────────────────────────────────────────────────

type StubType = { name: string; repo: string; abstract?: boolean; sealed?: string[] | null; doc?: string }

function typeReader(types: StubType[], roles: Record<string, string>, ownRepo: string | null): WireReader {
  return {
    async read(request: { read: string } & Record<string, unknown>) {
      const wrap = (v: unknown) => ({ ready: true, version: 1, result: { [request.read]: v } }) as never
      if (request.read === 'types') {
        return wrap(types.map((t) => ({ ...t, abstract: t.abstract ?? false, sealed: t.sealed ?? null })))
      }
      if (request.read === 'members') {
        return wrap(Object.entries(roles).map(([repo, role]) => ({ repo, root: `/${repo}`, scattered: false, editable: role !== 'dep', local: true, role })))
      }
      if (request.read === 'resolve_member') {
        return wrap(ownRepo === null ? null : { repo: ownRepo, root: `/${ownRepo}`, editable: true, local: true, role: 'entry' })
      }
      return wrap(null)
    },
  }
}

const ROLES = { notes: 'entry', library: 'dep', gallery: 'discover' }

function typeDeps(types: StubType[], own: string | null = 'notes'): CompletionDeps {
  return { engine: typeReader(types, ROLES, own), path: () => 'notes/a.md' }
}

describe('completionsFor — the type claim', () => {
  it('offers an own-repo type bare, the canonical form', async () => {
    const out = await completionsFor(typeDeps([{ name: 'decision', repo: 'notes' }]), '---\ntype: ', 'notes/a.md')
    expect(out.map((o) => o.label)).toEqual(['decision'])
  })

  // Crossing a peer's type needs it declared as a dep, so a dep's type is offered
  // WITH its ::repo — the qualifier is required, not optional, outside your repo.
  it('offers a dep\'s type qualified', async () => {
    const out = await completionsFor(typeDeps([{ name: 'book', repo: 'library' }]), '---\ntype: ', 'notes/a.md')
    expect(out.map((o) => o.label)).toEqual(['book::library'])
  })

  // THE PEER GATE. A discover member is mounted so its parts compose, not as a
  // type-dependency: naming it fires `type-repo-not-a-dependency`. Qualifying
  // does not rescue it, so it must not be offered at all.
  it('omits a mounted member that is not a declared dep', async () => {
    const types = [{ name: 'widget', repo: 'gallery' }, { name: 'decision', repo: 'notes' }]
    const out = await completionsFor(typeDeps(types), '---\ntype: ', 'notes/a.md')
    expect(out.map((o) => o.label)).toEqual(['decision'])
  })

  it('omits a sealed parent and an abstract type on an instance', async () => {
    const types = [
      { name: 'decision', repo: 'notes', sealed: ['decision.open'] },
      { name: 'base', repo: 'notes', abstract: true },
      { name: 'decision.open', repo: 'notes' },
    ]
    const out = await completionsFor(typeDeps(types), '---\ntype: ', 'notes/a.md')
    expect(out.map((o) => o.label)).toEqual(['decision.open'])
  })

  // In a type-def the same key is a PARENT claim, where abstract and sealed are
  // not merely legal but the point: fields flow down to concrete subtypes.
  it('keeps abstract and sealed types in a type-def, where type: is a parent claim', async () => {
    const types = [
      { name: 'decision', repo: 'notes', sealed: ['decision.open'] },
      { name: 'base', repo: 'notes', abstract: true },
    ]
    const deps = { engine: typeReader(types, ROLES, 'notes'), path: () => 'notes/type/x.type.yaml' }
    const out = await completionsFor(deps, '---\ntype: ', 'notes/type/x.type.yaml')
    expect(out.map((o) => o.label).sort()).toEqual(['base', 'decision'])
  })

  it('drops a type already claimed, which would be a duplicate-claim', async () => {
    const types = [{ name: 'decision', repo: 'notes' }, { name: 'note', repo: 'notes' }]
    const before = '---\ntype:\n  - decision\n  - '
    const out = await completionsFor(typeDeps(types), before, 'notes/a.md')
    expect(out.map((o) => o.label)).toEqual(['note'])
  })

  it('surfaces the type docstring', async () => {
    const out = await completionsFor(typeDeps([{ name: 'decision', repo: 'notes', doc: 'a choice made' }]), '---\ntype: ', 'notes/a.md')
    expect(out[0].info).toBe('a choice made')
  })
})

// ── wikilinks ────────────────────────────────────────────────────────────

type StubFile = { path: string; kind?: string }
type StubAnchor = { text: string; level: number }
type StubBlock = { id: string; kind: string; type_claim?: string[] | null }

function stem(path: string) {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/**
 * `anchors` / `block_ids` answer `T[] | null`, and null is a DIFFERENT outcome
 * from empty: null is an unresolved target, empty is a file that resolved and
 * carries none. The stub keeps that distinction so the tests can assert it.
 */
function linkReader(
  files: StubFile[],
  anchors: Record<string, StubAnchor[] | null> = {},
  blockIds: Record<string, StubBlock[] | null> = {},
  roles: Record<string, string> = ROLES,
): WireReader {
  return {
    async read(request: { read: string } & Record<string, unknown>) {
      const wrap = (v: unknown) => ({ ready: true, version: 1, result: { [request.read]: v } }) as never
      if (request.read === 'files') {
        return wrap(files.map((f) => ({ path: f.path, stem: stem(f.path), repo: 'notes', kind: f.kind ?? 'note' })))
      }
      if (request.read === 'anchors') {
        const v = anchors[request.target as string]
        return wrap(v === undefined ? null : v === null ? null : v.map((a) => ({ ...a, span: { start: 0, end: 0 } })))
      }
      if (request.read === 'block_ids') {
        const v = blockIds[request.target as string]
        return wrap(v === undefined ? null : v === null ? null : v.map((b) => ({ type_claim: null, ...b, span: { start: 0, end: 0 } })))
      }
      if (request.read === 'members') {
        return wrap(Object.entries(roles).map(([repo, role]) => ({ repo, root: `/${repo}`, scattered: false, editable: true, local: true, role })))
      }
      return wrap(null)
    },
  }
}

function linkDeps(
  files: StubFile[],
  anchors: Record<string, StubAnchor[] | null> = {},
  blockIds: Record<string, StubBlock[] | null> = {},
): CompletionDeps {
  return { engine: linkReader(files, anchors, blockIds), path: () => 'notes/a.md' }
}

describe('completionsFor — wikilinks', () => {
  it('offers the file set as targets, labelled by the stem a link resolves by', async () => {
    const out = await completionsFor(linkDeps([{ path: 'notes/alice.md' }, { path: 'notes/refs/runbook.yaml' }]), 'see [[', 'notes/a.md')
    expect(out.map((o) => o.label)).toEqual(['alice', 'runbook'])
    expect(out[0]).toMatchObject({ detail: 'notes/alice.md', apply: 'alice' })
  })

  // File completion includes assets as well as notes, matching the file reference
  // resolver's supported targets.
  it('offers assets, which the implicit-identity scan could never name', async () => {
    const out = await completionsFor(linkDeps([{ path: 'refs/paper.pdf', kind: 'asset' }]), '[[', 'notes/a.md')
    expect(out.map((o) => o.label)).toEqual(['paper'])
  })

  it('offers targets in a frontmatter reference slot too, not only in prose', async () => {
    const before = '---\ntype: d\nassumptions:\n  - "[[al'
    const out = await completionsFor(linkDeps([{ path: 'notes/alice.md' }]), before, 'notes/a.md')
    expect(out.map((o) => o.label)).toEqual(['alice'])
  })

  // A plain VALUE link is not peer-gated: any member is reachable. Only a TYPE
  // crossing needs a declared dep, so this set is wider than typeClaims offers.
  it('offers every member for a ::repo scope, including a non-dep', async () => {
    const out = await completionsFor(linkDeps([{ path: 'notes/a.md' }]), '[[alice::', 'notes/a.md')
    expect(out.map((o) => o.label).sort()).toEqual(['gallery', 'library', 'notes'])
  })

  it('offers a target file\'s headings for an anchor', async () => {
    const d = linkDeps([{ path: 'notes/alice.md' }], { alice: [{ text: 'Intro', level: 1 }, { text: 'Details', level: 2 }] })
    const out = await completionsFor(d, '[[alice#', 'notes/a.md')
    expect(out.map((o) => o.label)).toEqual(['Intro', 'Details'])
    // `text` already excludes a trailing `^id` marker, so it inserts as-is.
    expect(out[1]).toMatchObject({ detail: '##', apply: 'Details' })
  })

  it('offers every block-id for a bare ^, which is navigational', async () => {
    const d = linkDeps([{ path: 'notes/alice.md' }], {}, {
      alice: [{ id: 'rec', kind: 'record' }, { id: 'fence', kind: 'typed_block' }, { id: 'para', kind: 'marker' }],
    })
    const out = await completionsFor(d, '[[alice^', 'notes/a.md')
    expect(out.map((o) => o.label)).toEqual(['rec', 'fence', 'para'])
  })

  // A `^^` block-referent demands a TYPED value: satisfied by record and
  // typed_block, never by marker, which is navigational only. Typedness rides
  // `kind`, so the filter is on kind and there is no separate flag.
  it('filters a ^^ block-referent to the typed surfaces', async () => {
    const d = linkDeps([{ path: 'notes/alice.md' }], {}, {
      alice: [{ id: 'rec', kind: 'record' }, { id: 'fence', kind: 'typed_block' }, { id: 'para', kind: 'marker' }],
    })
    const out = await completionsFor(d, '[[alice^^', 'notes/a.md')
    expect(out.map((o) => o.label)).toEqual(['rec', 'fence'])
  })

  it('shows the block\'s own claim, which is what a ^^ reference is checked against', async () => {
    const d = linkDeps([{ path: 'notes/alice.md' }], {}, { alice: [{ id: 'rec', kind: 'record', type_claim: ['decision', 'note'] }] })
    expect((await completionsFor(d, '[[alice^', 'notes/a.md'))[0].detail).toBe('decision, note')
  })

  // The read lists every OCCURRENCE so a duplicate stays visible as
  // `block-id-duplicate` reports it. The menu wants one row per id.
  it('collapses duplicate occurrences to one menu row', async () => {
    const d = linkDeps([{ path: 'notes/alice.md' }], {}, { alice: [{ id: 'dup', kind: 'marker' }, { id: 'dup', kind: 'marker' }] })
    expect((await completionsFor(d, '[[alice^', 'notes/a.md')).map((o) => o.label)).toEqual(['dup'])
  })

  // NULL and EMPTY are different answers. Collapsing them would show a blank menu
  // for a typo, which reads as "this file has no headings" and teaches the wrong
  // model.
  it('distinguishes an unresolved target from a file with no headings', async () => {
    const unresolved = await completionsFor(linkDeps([{ path: 'notes/a.md' }], { alice: null }), '[[ghost#', 'notes/a.md')
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0].label).toBe('no file resolves to "ghost"')

    const resolvedButBare = await completionsFor(linkDeps([{ path: 'notes/a.md' }], { alice: [] }), '[[alice#', 'notes/a.md')
    expect(resolvedButBare).toEqual([])
  })

  it('makes the reason row inert, so Enter dismisses without inserting', async () => {
    const out = await completionsFor(linkDeps([{ path: 'notes/a.md' }], { alice: null }), '[[ghost#', 'notes/a.md')
    expect(typeof out[0].apply).toBe('function')
  })

  it('distinguishes the same two outcomes for block-ids', async () => {
    const unresolved = await completionsFor(linkDeps([{ path: 'notes/a.md' }], {}, { alice: null }), '[[ghost^', 'notes/a.md')
    expect(unresolved[0].label).toBe('no file resolves to "ghost"')
    expect(await completionsFor(linkDeps([{ path: 'notes/a.md' }], {}, { alice: [] }), '[[alice^', 'notes/a.md')).toEqual([])
  })
})

// Explicit completion must distinguish invalid or unresolved claims from an empty result.

const ALICE = `---
type: [person, quality]
name: "Alice"
ga`

describe('completionsFor — the inline-claim file that broke live', () => {
  it('reads both claims of an inline flow sequence and offers their fields', async () => {
    const person = { identity: { name: 'person', repo: 'v', closure_id: 'a' }, ancestors: [], fields: [field('name', 'String', true)] }
    const quality = { identity: { name: 'quality', repo: 'v', closure_id: 'b' }, ancestors: [], fields: [field('grade', 'String', false)] }
    const out = await completionsFor(deps({ person: [person], quality: [quality] }), ALICE, 'content/alice.md')
    // `name` is already used in the block, so only the unfilled ones remain.
    expect(out.map((o) => o.label)).toEqual(['grade'])
  })
})

describe('completionsFor — typeClaims does not fail closed', () => {
  // The daemon serves one workspace; the open file lived in another. resolve_member
  // answered nothing, so nothing counted as own-repo and the dep filter emptied the
  // menu — indistinguishable from "no types exist".
  it('says the file is outside the workspace instead of offering nothing', async () => {
    const engine = typeReader([{ name: 'decision', repo: 'notes' }], ROLES, null)
    const out = await completionsFor({ engine, path: () => 'elsewhere/a.md' }, '---\ntype: ', 'elsewhere/a.md')
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe('this file is not in the served workspace')
    expect(typeof out[0].apply).toBe('function')
  })

  it('still offers types normally once the member resolves', async () => {
    const engine = typeReader([{ name: 'decision', repo: 'notes' }], ROLES, 'notes')
    const out = await completionsFor({ engine, path: () => 'notes/a.md' }, '---\ntype: ', 'notes/a.md')
    expect(out.map((o) => o.label)).toEqual(['decision'])
  })
})

// The CodeMirror half: a fake context carrying just what the source reads.
function cmContext(doc: string, explicit: boolean) {
  return { state: { doc: { sliceString: (_f: number, _t: number) => doc } }, pos: doc.length, explicit } as never
}

describe('makeSource — an explicit invocation always answers', () => {
  const dead: WireReader = {
    async read() {
      throw new Error('socket closed')
    },
  }

  // A dead socket THROWS rather than answering not-ready, so without a catch the
  // source's promise rejects and CodeMirror surfaces it over the buffer.
  it('survives a throwing transport and names the reason', async () => {
    const source = makeSource({ engine: dead, path: () => 'a.md' })
    const out = await source(cmContext('---\ntype: d\nx', true))
    expect(out?.options).toHaveLength(1)
    expect(out?.options[0].label).toBe('engine not connected')
  })

  // Explicit completion must answer even when no candidates can be returned.
  it('answers in prose, where there is nothing to complete', async () => {
    const source = makeSource(deps({}))
    const out = await source(cmContext('---\ntype: d\n---\n\njust prose', true))
    expect(out?.options[0].label).toBe('nothing to complete here')
  })

  it('names the slot it recognised when that slot has no candidates', async () => {
    const source = makeSource(deps({}))
    const out = await source(cmContext('---\ntype: ghost\nx', true))
    expect(out?.options[0].label).toBe('no field suggestions here')
  })

  // The auto-open is unsolicited, so it must not nag with a reason mid-word.
  it('stays silent when NOT explicit', async () => {
    const source = makeSource(deps({}))
    expect(await source(cmContext('---\ntype: ghost\nx', false))).toBeNull()
  })

  it('returns real candidates unchanged, with no status row', async () => {
    const source = makeSource(deps({ decision: [DECISION] }))
    const out = await source(cmContext('---\ntype: decision\n', true))
    expect(out?.options.map((o) => o.label).sort()).toEqual(['confidence', 'description', 'rationale'])
  })
})
