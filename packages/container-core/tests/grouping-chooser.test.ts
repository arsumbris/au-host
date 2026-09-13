// THE GROUPING WRAP CHOICE, ASKED — not silently defaulted.
//
// A centre-wrap that could use two-or-more declared grouping containers must ASK, never pick the
// name-sorted first. The transactional `routeDrop` stays SYNCHRONOUS; the ask is hoisted into
// `routeDropWithGrouping`, which reads the ambiguity with the sync `centerWrapGroupingOutcome`,
// awaits the host-installed chooser, and hands the pick back through `ctx.groupingOverride`.
//
// The grouping capabilities here are stand-ins whose `build` tags the group with its own type name,
// so an assertion can say WHICH container built the group. The routing + refusal logic is the real
// `routeDrop`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  centerWrapGroupingOutcome,
  deregisterContainer,
  registerContainer,
  routeDrop,
  routeDropWithGrouping,
} from '../src/registry.ts'
import { setSlotTypeProvider } from '../src/slots.ts'
import {
  setGroupingChooser,
  setGroupingProvider,
  type GroupingCapability,
  type GroupingChoiceOutcome,
} from '../src/grouping.ts'
import type { ContainerPlacement, DragSource, DropTarget } from '@arsumbris/au-host-sdk'

// --------------------------------------------------------------------- harness

let minted = 0
const cap = (name: string): GroupingCapability => ({
  typeName: name,
  build: (children) => ({ type: name, children: children.map((c) => ({ '^': c.id, ...(c.instance as object) })) }),
  minChildren: 2,
})
const column = cap('column')
const tabs = cap('tabs')

function targetContainer(slotId: string, occupantId: string, instance: unknown) {
  const occ = { id: occupantId, instance }
  const el = { parentElement: null, contains: () => false } as unknown as Element
  const placement = {
    panes: () => [occ.id],
    findPane: (id: string) => (id === occ.id ? { id, type: 'x' } : null),
    activate: () => {},
    getSlotContent: (id: string) => (id === slotId ? { instance: occ.instance, id: occ.id } : null),
    setSlotContent: (id: string, next: unknown) => {
      if (id === slotId) occ.instance = next
    },
    moveWithin: () => true,
    extract: () => null,
    inject: () => {},
  } as unknown as ContainerPlacement
  return { el, placement, occ }
}

function sourceContainer(paneId: string, instance: unknown) {
  const held = [paneId]
  const el = { parentElement: null, contains: () => false } as unknown as Element
  const placement = {
    panes: () => [...held],
    findPane: (id: string) => (held.includes(id) ? { id, type: 'editor-pane' } : null),
    activate: () => {},
    getSlotContent: () => null,
    setSlotContent: () => {},
    moveWithin: () => true,
    extract: (id: string) => {
      const at = held.indexOf(id)
      if (at < 0) return null
      held.splice(at, 1)
      return { instance, id }
    },
    inject: () => {},
  } as unknown as ContainerPlacement
  return { el, placement }
}

const drag = (localId: string): DragSource =>
  ({ containerKind: 'k', localId, role: 'pane', label: localId, type: 'editor-pane' }) as DragSource
const centre = (slotId: string): DropTarget =>
  ({ shape: 'slot-rect', containerKind: 'k', slotId, zone: 'center' }) as DropTarget
const edge = (slotId: string): DropTarget =>
  ({ shape: 'slot-rect', containerKind: 'k', slotId, zone: 'left' }) as DropTarget

const registered: Element[] = []
let targetElement: Element | null = null

const defaulted = (): GroupingChoiceOutcome => ({ chosen: column, reason: 'defaulted', available: ['column', 'tabs'] })
const only = (): GroupingChoiceOutcome => ({ chosen: column, reason: 'only', available: ['column'] })

function installProvider(outcome?: () => GroupingChoiceOutcome): void {
  setGroupingProvider({
    forNewGroup: () => (outcome ? outcome().chosen : column),
    forKind: (k) => (k === 'column' ? column : k === 'tabs' ? tabs : null),
    outcomeForNewGroup: outcome,
  })
}

function setupWrap(): { tgt: ReturnType<typeof targetContainer>; src: ReturnType<typeof sourceContainer> } {
  const tgt = targetContainer('files', 'tree-1', { type: 'file-tree' })
  const src = sourceContainer('ed1', { type: 'editor-pane' })
  registerContainer(tgt.el, tgt.placement)
  registered.push(tgt.el)
  registerContainer(src.el, src.placement)
  registered.push(src.el)
  targetElement = tgt.el
  return { tgt, src }
}

const builtType = (tgt: ReturnType<typeof targetContainer>): unknown => (tgt.occ.instance as { type: string }).type

beforeEach(() => {
  minted = 0
  vi.stubGlobal('document', { querySelector: () => targetElement })
  setSlotTypeProvider({ isA: (c, a) => c === a })
})
afterEach(() => {
  for (const el of registered.splice(0)) deregisterContainer(el)
  setSlotTypeProvider(null)
  setGroupingProvider(null)
  setGroupingChooser(null)
  targetElement = null
  vi.unstubAllGlobals()
})

// --------------------------------------------------------------------- ctx.groupingOverride

describe('ctx.groupingOverride — the pre-resolved wrap container', () => {
  it('routeDrop wraps with the override, not the provider default', () => {
    installProvider(defaulted) // provider default is column
    const { tgt, src } = setupWrap()
    routeDrop(drag('ed1'), centre('files'), { sourceEl: src.el, groupingOverride: tabs })
    expect(builtType(tgt)).toBe('tabs')
  })

  it('routeDrop falls back to the provider default when no override is given (unchanged behaviour)', () => {
    installProvider(defaulted)
    const { tgt, src } = setupWrap()
    routeDrop(drag('ed1'), centre('files'), { sourceEl: src.el })
    expect(builtType(tgt)).toBe('column')
  })
})

// --------------------------------------------------------------------- centerWrapGroupingOutcome

describe('centerWrapGroupingOutcome — the sync ambiguity predicate', () => {
  it('reports the available set for an ambiguous (defaulted) centre-wrap of an occupied slot', () => {
    installProvider(defaulted)
    const { src } = setupWrap()
    expect(centerWrapGroupingOutcome(drag('ed1'), centre('files'), { sourceEl: src.el })).toEqual({
      available: ['column', 'tabs'],
    })
  })

  it('is null when only one container declares grouping (reason: only)', () => {
    installProvider(only)
    const { src } = setupWrap()
    expect(centerWrapGroupingOutcome(drag('ed1'), centre('files'), { sourceEl: src.el })).toBeNull()
  })

  it('is null for a non-centre (edge) drop — that is a split, not a wrap', () => {
    installProvider(defaulted)
    const { src } = setupWrap()
    expect(centerWrapGroupingOutcome(drag('ed1'), edge('files'), { sourceEl: src.el })).toBeNull()
  })

  it('is null for a centre drop on an EMPTY slot — that places, it does not group', () => {
    installProvider(defaulted)
    const { src } = setupWrap()
    expect(centerWrapGroupingOutcome(drag('ed1'), centre('empty-slot'), { sourceEl: src.el })).toBeNull()
  })
})

// --------------------------------------------------------------------- routeDropWithGrouping

describe('routeDropWithGrouping — ask, then route synchronously', () => {
  it('asks the chooser and wraps with the picked container', async () => {
    installProvider(defaulted) // default column
    setGroupingChooser(async () => 'tabs')
    const { tgt, src } = setupWrap()
    await routeDropWithGrouping(drag('ed1'), centre('files'), { sourceEl: src.el })
    expect(builtType(tgt)).toBe('tabs') // the pick, not the name-sorted default
  })

  it('aborts the drop when the chooser is cancelled', async () => {
    installProvider(defaulted)
    setGroupingChooser(async () => null)
    const { tgt, src } = setupWrap()
    await routeDropWithGrouping(drag('ed1'), centre('files'), { sourceEl: src.el })
    expect(builtType(tgt)).toBe('file-tree') // unchanged — no group was formed
  })

  it('routes straight through (provider default) when no chooser is installed', async () => {
    installProvider(defaulted)
    const { tgt, src } = setupWrap()
    await routeDropWithGrouping(drag('ed1'), centre('files'), { sourceEl: src.el })
    expect(builtType(tgt)).toBe('column') // degrades to today's default
  })

  it('does not ask for a single-container (non-ambiguous) wrap', async () => {
    installProvider(only)
    let asked = false
    setGroupingChooser(async () => {
      asked = true
      return 'tabs'
    })
    const { tgt, src } = setupWrap()
    await routeDropWithGrouping(drag('ed1'), centre('files'), { sourceEl: src.el })
    expect(asked).toBe(false)
    expect(builtType(tgt)).toBe('column') // the sole declared container
  })
})
