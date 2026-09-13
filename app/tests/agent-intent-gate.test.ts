// The gate on the agent-host socket's `fireIntent`.
//
// Agent-fired intents must be explicitly permitted by the discovered type graph.
// These cases verify rejection of unknown, undeclared and invalid requests.
//
// Drives `buildGateTable` (the pure fold) + `checkAgentIntent` (the decision) over synthetic
// type-defs, so no daemon is involved. Live type-graph behavior needs separate integration coverage.

import { beforeEach, describe, expect, it } from 'vitest'

import type { WireShape, WireSubtype } from '@arsumbris/au-engine-sdk/reads'

import { buildGateTable, checkAgentIntent, installAgentIntents } from '../src/renderer/src/projections/agent-intent-gate.ts'
import type { DiscoveredProjection } from '../src/renderer/src/projections/discovery.ts'

/** A minimal discovered projection — only `typeName` and `kinds` are read by the gate. */
function projection(typeName: string, kinds: string[]): DiscoveredProjection {
  return {
    typeName,
    repo: 'x',
    entry: './dist/index.js',
    contractVersion: 7,
    packageRoot: `/x/${typeName}`,
    kinds,
    ownedFields: [],
    handles: [],
  }
}

/** The projection population the derived payload check resolves names against. */
const PROJECTIONS = [
  projection('terminal', ['pane-projection', 'projection']),
  projection('bento', ['container-projection', 'projection']),
]

function field(name: string, shape: string, ast: WireShape | null): WireSubtype['fields'][number] {
  return { name, shape, shape_ast: ast, required: true }
}

/** A synthetic intent type-def. `agent` absent = declares no `intent-agent-meta` at all. */
function intentDef(
  name: string,
  opts: { agent?: boolean; kind?: string; dispatch?: string; fields?: WireSubtype['fields'] } = {},
): WireSubtype {
  const meta: NonNullable<WireSubtype['meta_blocks']> = []
  if (opts.kind !== undefined) {
    meta.push({
      type_name: 'intent-routing-meta::au-host-sdk',
      body: [
        { name: 'kind', value: opts.kind },
        ...(opts.dispatch === undefined ? [] : [{ name: 'dispatch', value: opts.dispatch }]),
      ],
    } as never)
  }
  if (opts.agent !== undefined) {
    meta.push({ type_name: 'intent-agent-meta::intent', body: [{ name: 'firable', value: opts.agent }] } as never)
  }
  return { name, fields: opts.fields ?? [], meta_blocks: meta } as unknown as WireSubtype
}

const install = (defs: WireSubtype[]): void => {
  installAgentIntents(buildGateTable(defs, PROJECTIONS))
}

beforeEach(() => {
  install([])
})

describe('default-deny — the posture, not a special case', () => {
  it('refuses an intent that is not in the type graph at all', () => {
    // An authored interface alone does not register an agent-callable intent.
    install([intentDef('open-intent', { agent: true, kind: 'routed', dispatch: 'ambient' })])
    const v = checkAgentIntent('open-pane-intent')
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('unknown-intent-type')
  })

  it('refuses a discovered intent that declares nothing', () => {
    // What every NEW intent gets for free. An author who never thinks about the agent bridge ships
    // an intent an agent cannot fire, rather than one it can.
    install([intentDef('some-new-intent', { kind: 'routed' })])
    expect(checkAgentIntent('some-new-intent')).toMatchObject({ allowed: false, reason: 'not-declared-agent-firable' })
  })

  it('refuses when the table is EMPTY — an unanswered engine must not open the gate', () => {
    // The window between the socket coming up and the first discovery pass, and any failed read.
    expect(checkAgentIntent('open-intent')).toMatchObject({ allowed: false, reason: 'unknown-intent-type' })
  })

  it('distinguishes a decided NO from silence', () => {
    // Different authoring situations: one needs a decision, the other already had one. A surfacer
    // matches on the code, so collapsing them would lose that.
    install([intentDef('promote-intent', { agent: false, kind: 'routed', dispatch: 'firer-relative' })])
    expect(checkAgentIntent('promote-intent')).toMatchObject({ allowed: false, reason: 'declared-not-agent-firable' })
  })
})

describe('the declaration is LITERAL, never inherited', () => {
  it('does not let a subtype inherit its parent’s permission', () => {
    // A subtype ADDS fields, so inherited permission would cover a payload the parent never
    // declared — and a third party subtyping a firable intent would be firable before anyone read
    // it. Matches the engine's own `required:` satisfaction rule.
    install([
      intentDef('ui-notification', { agent: true, kind: 'broadcast' }),
      intentDef('ui-notification-progress', { kind: 'broadcast' }), // declares nothing of its own
    ])
    expect(checkAgentIntent('ui-notification')).toMatchObject({ allowed: true })
    expect(checkAgentIntent('ui-notification-progress')).toMatchObject({
      allowed: false,
      reason: 'not-declared-agent-firable',
    })
  })
})

describe('the derived payload check overrides any declaration', () => {
  it('refuses a projection-bearing field even when declared firable', () => {
    // Classify dangerous verbs by their payload shape, not their name.
    // An intent whose fields admit mountable content remains refused regardless of the type's label.
    install([
      intentDef('open-pane-intent', {
        agent: true,
        kind: 'routed',
        fields: [field('pane', 'projection::au-host-sdk&', { kind: 'inline-or-reference', name: 'projection::au-host-sdk' })],
      }),
    ])
    const v = checkAgentIntent('open-pane-intent')
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('privileged-payload')
    expect(v.message).toContain('pane')
  })

  it('refuses a bare `any` field — an uninterpreted blob can hold a config', () => {
    install([intentDef('blob-intent', { agent: true, fields: [field('payload', 'any', { kind: 'any' })] })])
    expect(checkAgentIntent('blob-intent')).toMatchObject({ allowed: false, reason: 'privileged-payload' })
  })

  it('sees through a LIST wrapper', () => {
    // The obvious escape: ship a list of configs instead of one.
    install([
      intentDef('many-panes', {
        agent: true,
        fields: [
          field('panes', 'projection::au-host-sdk&[]', {
            kind: 'list',
            min: 0,
            inner: { kind: 'inline-or-reference', name: 'projection::au-host-sdk' },
          }),
        ],
      }),
    ])
    expect(checkAgentIntent('many-panes')).toMatchObject({ allowed: false, reason: 'privileged-payload' })
  })

  it('sees through a UNION branch', () => {
    install([
      intentDef('either-intent', {
        agent: true,
        fields: [
          field('what', '<String | bento&>', {
            kind: 'union',
            branches: [{ kind: 'primitive', name: 'String' as never }, { kind: 'inline-or-reference', name: 'bento' }],
          }),
        ],
      }),
    ])
    expect(checkAgentIntent('either-intent')).toMatchObject({ allowed: false, reason: 'privileged-payload' })
  })

  it('catches a projection SUBTYPE by name, not just the base', () => {
    // `terminal` is the one that runs a shell. Naming it directly must not slip past a check that
    // only knew the word `projection`.
    install([
      intentDef('open-terminal', {
        agent: true,
        fields: [field('pane', 'terminal&', { kind: 'inline-or-reference', name: 'terminal' })],
      }),
    ])
    expect(checkAgentIntent('open-terminal')).toMatchObject({ allowed: false, reason: 'privileged-payload' })
  })
})

describe('what must still be allowed — the gate is not a wall', () => {
  it('allows a selection-bearing intent: a reference names something that already exists', () => {
    // `open-intent.target` admits `selection&`; this valid selection payload must pass the gate.
    install([
      intentDef('open-intent', {
        agent: true,
        kind: 'routed',
        dispatch: 'ambient',
        fields: [field('target', 'selection::selection&', { kind: 'inline-or-reference', name: 'selection::selection' })],
      }),
    ])
    expect(checkAgentIntent('open-intent')).toMatchObject({ allowed: true })
  })

  it('allows a plain reference to a projection — a pointer supplies no content', () => {
    // `T*` names a node the workspace already holds. The distinction the derived check rests on.
    install([
      intentDef('point-at-pane', {
        agent: true,
        fields: [field('at', 'projection::au-host-sdk*', { kind: 'reference', name: 'projection::au-host-sdk' })],
      }),
    ])
    expect(checkAgentIntent('point-at-pane')).toMatchObject({ allowed: true })
  })

  it('allows a record field of ordinary vocabulary', () => {
    // `ui-notification.actions` is a record list. Not everything inline is dangerous.
    install([
      intentDef('ui-notification', {
        agent: true,
        kind: 'broadcast',
        fields: [
          field('actions', 'ui-notification-action[]', {
            kind: 'list',
            min: 0,
            inner: { kind: 'record', name: 'ui-notification-action' },
          }),
        ],
      }),
    ])
    expect(checkAgentIntent('ui-notification')).toMatchObject({ allowed: true })
  })
})

describe('routing comes from the type-def, not the caller', () => {
  it('returns the DECLARED kind and dispatch for the host to stamp', () => {
    // An attacker flipping `kind` to `broadcast` would reach EVERY capable handler at once,
    // bypassing claim/decline. The declaration is already the single source;
    // this is what lets the host stop trusting the socket's copy.
    install([intentDef('open-intent', { agent: true, kind: 'routed', dispatch: 'ambient' })])
    expect(checkAgentIntent('open-intent').routing).toEqual({ kind: 'routed', dispatch: 'ambient' })
  })

  it('omits dispatch for a broadcast, which declares none', () => {
    install([intentDef('ui-intent-highlight', { agent: true, kind: 'broadcast' })])
    expect(checkAgentIntent('ui-intent-highlight').routing).toEqual({ kind: 'broadcast' })
  })
})

describe('name handling', () => {
  it('matches a `::repo`-qualified fired type against the bare declaration', () => {
    // A caller may write either form; names are workspace-unique, so a qualifier is a scope.
    install([intentDef('open-intent', { agent: true, kind: 'routed' })])
    expect(checkAgentIntent('open-intent::intent')).toMatchObject({ allowed: true })
  })

  it('refuses a non-string type rather than throwing', () => {
    // The payload is untrusted, so `type` may be anything at all.
    install([intentDef('open-intent', { agent: true })])
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(checkAgentIntent(bad)).toMatchObject({ allowed: false, reason: 'unknown-intent-type' })
    }
  })
})
