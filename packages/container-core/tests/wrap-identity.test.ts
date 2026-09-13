// BLOCK-ID IDENTITY ACROSS A CENTRE-WRAP.
//
// A centre-zone drop turns one occupied position into a container holding two children. Three
// records exist afterwards where one existed before, and each is written with an engine `^:`
// block-id. This file pins the one rule that keeps those ids sound:
//
//   A NEWLY SYNTHESIZED RECORD GETS A FRESH ID. AN EXISTING RECORD NEVER HAS ITS ID CHANGED.
//
// WHY IT MATTERS MORE THAN IT LOOKS. `^:` is the engine's addressing layer, not a host convention.
// Two records sharing an id in one file is `block-id-duplicate`, an ERROR,
// and its stated behaviour is that "references resolve to the FIRST only" — so a duplicate does not
// fail loudly at the point of use, it silently retargets every `[[^^id]]` pointing at the record
// that now comes second in document order. A wrap can appear to "transfer" a lock to the synthesized wrapper when the reference
// resolves to the wrong record because the wrapper is written at the id its own child keeps.
//
// WHY THE CHILD KEEPS THE ID AND THE WRAPPER TAKES THE FRESH ONE, and not the other way round.
// The child's id is its PANE id, which keys its host-owned terminal session and its restorable
// view-state (cursor, scroll, folds). Re-keying the child would silently kill a running terminal on
// a drag gesture. Nothing references a synthesized wrapper, so the fresh id costs nothing there.
// The general rule falls out: an id belongs to the thing the author named, and a gesture that
// creates a new thing must not take its name.
//
// WHAT IS FAKED, stated so this is not read as more coverage than it is: the grouping capability is
// a stand-in that emits each child with `^: id`, which is what `GroupingCapability.build` documents
// and what every real container's codec does. The serialization is the REAL `makeSlotCodec`, so
// the assertion is on the record shape that actually reaches disk, not on the router's call log.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deregisterContainer, registerContainer, routeDrop } from '../src/registry.ts'
import { setSlotTypeProvider } from '../src/slots.ts'
import { setGroupingProvider, type GroupingCapability } from '../src/grouping.ts'
import type { ContainerPlacement, DragSource, DropTarget } from '@arsumbris/au-host-sdk'

// --------------------------------------------------------------------- harness

let minted = 0
const genId = (): string => `mint-${minted++}`

/** Every `^` in a record tree, in document order — which is the order the engine resolves by. */
function blockIds(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) blockIds(v, out)
    return out
  }
  if (value == null || typeof value !== 'object') return out
  const rec = value as Record<string, unknown>
  if (typeof rec['^'] === 'string') out.push(rec['^'])
  for (const [k, v] of Object.entries(rec)) {
    if (k === '^') continue
    blockIds(v, out)
  }
  return out
}

/**
 * A target fixture with distinct position and occupant ids. setSlotContent swaps the instance;
 * assertions must detect whether it preserves the occupant id. Equal fixture ids would hide an
 * accidental substitution of the position id.
 */
function targetContainer(positionId: string, occupantId: string, instance: unknown) {
  const occupant = { id: occupantId, instance }
  const slotId = positionId
  const el = { parentElement: null, contains: () => false } as unknown as Element
  const placement = {
    panes: () => [occupant.id],
    findPane: (id: string) => (id === occupant.id ? { id, type: 'x' } : null),
    activate: () => {},
    // Return the complete occupant, including its stable id, so duplicate-id assertions exercise
    // the same contract as a real container.
    getSlotContent: (id: string) => (id === slotId ? { instance: occupant.instance, id: occupant.id } : null),
    setSlotContent: (id: string, next: unknown, occupantId?: string) => {
      if (id !== slotId) return
      occupant.instance = next
      // Honouring `occupantId` is the implementor obligation under test; a fake that ignored it
      // would silently exempt itself from the rule every real container has to follow.
      if (occupantId !== undefined) occupant.id = occupantId
    },
    moveWithin: () => true,
    extract: () => null,
    inject: () => {},
  } as unknown as ContainerPlacement
  // The wrapper's POOL RECORD — its own `^:` id plus the instance the grouping build produced. Under
  // the composition pool the codec writes the POSITION as a `[[^^id]]` REFERENCE to this record (that
  // ref emission is pinned in slot-codec.test.ts); the id-soundness under test — no duplicate, the
  // child keeps its id, the wrapper takes a fresh one — is a property of THIS record and its children.
  const written = (): unknown => ({ '^': occupant.id, ...(occupant.instance as object) })
  return { el, placement, occupant, written }
}

/** A source container the dragged pane leaves. */
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

/** Mirrors what a real container's `build` does: each child's stable id lands as its `^:`. */
const groupingCap: GroupingCapability = {
  typeName: 'tabs',
  build: (children) => ({
    type: 'tabs',
    tabs: children.map((c) => ({ '^': c.id, ...(c.instance as object) })),
  }),
  minChildren: 2,
}

const registered: Element[] = []
let targetElement: Element | null = null

const drag = (localId: string): DragSource =>
  ({ containerKind: 'k', localId, role: 'pane', label: localId, type: 'editor-pane' }) as DragSource

const centre = (slotId: string): DropTarget =>
  ({ shape: 'slot-rect', containerKind: 'k', slotId, zone: 'center' }) as DropTarget

beforeEach(() => {
  minted = 0
  vi.stubGlobal('document', { querySelector: () => targetElement })
  setSlotTypeProvider({ isA: (c, a) => c === a })
  setGroupingProvider({ forNewGroup: () => groupingCap, forKind: () => null })
})

afterEach(() => {
  for (const el of registered.splice(0)) deregisterContainer(el)
  setSlotTypeProvider(null)
  setGroupingProvider(null)
  targetElement = null
  vi.unstubAllGlobals()
})

// --------------------------------------------------------------------- the rule

describe('a centre-wrap and the `^:` ids it writes', () => {
  // Wrapping preserves each child's id and assigns a distinct id to the new group.
  // References must continue to resolve to the child rather than to its wrapper.
  it('emits no duplicate block-id — the synthesized wrapper must not take its child\'s id', () => {
    // The gesture: an editor dropped onto the CENTRE of the pane holding `files`.
    const tgt = targetContainer('files', 'tree-1', { type: 'file-tree' })
    const src = sourceContainer('ed1', { type: 'editor-pane' })
    registerContainer(tgt.el, tgt.placement); registered.push(tgt.el)
    registerContainer(src.el, src.placement); registered.push(src.el)
    targetElement = tgt.el

    routeDrop(drag('ed1'), centre('files'), { sourceEl: src.el })

    const ids = blockIds(tgt.written())
    // THE ASSERTION THAT MATTERS. Not "the ids are what I expect" — "no id appears twice", which is
    // the engine's own rule and stays true however the wrapper is named.
    expect(new Set(ids).size, `duplicate block-id in ${JSON.stringify(tgt.written())}`).toBe(ids.length)
  })

  it('keeps the wrapped child\'s own id, so its terminal session and view-state survive', () => {
    // The other half, and the reason the fix is "fresh id for the WRAPPER" rather than a rename:
    // re-keying the child would silently kill a running terminal on a drag.
    const tgt = targetContainer('files', 'tree-1', { type: 'file-tree' })
    const src = sourceContainer('ed1', { type: 'editor-pane' })
    registerContainer(tgt.el, tgt.placement); registered.push(tgt.el)
    registerContainer(src.el, src.placement); registered.push(src.el)
    targetElement = tgt.el

    routeDrop(drag('ed1'), centre('files'), { sourceEl: src.el })

    // `files` still names the file-tree, so `[[^^files]]` keeps pointing at what the author meant.
    expect(blockIds(tgt.written())).toContain('tree-1')
    expect(blockIds(tgt.written())).toContain('ed1')
  })

  it('names the wrapper with an id belonging to neither the position nor either child', () => {
    // The positive half. The two tests above would both pass if the wrapper were written with NO id
    // at all, so this pins that it genuinely gets one — a synthesized record is named, not anonymous.
    const tgt = targetContainer('files', 'tree-1', { type: 'file-tree' })
    const src = sourceContainer('ed1', { type: 'editor-pane' })
    registerContainer(tgt.el, tgt.placement); registered.push(tgt.el)
    registerContainer(src.el, src.placement); registered.push(src.el)
    targetElement = tgt.el

    routeDrop(drag('ed1'), centre('files'), { sourceEl: src.el })

    const ids = blockIds(tgt.written())
    expect(ids).toHaveLength(3)
    expect(ids.filter((id) => id !== 'tree-1' && id !== 'ed1')).toHaveLength(1)
  })
})

// --------------------------------------------------------------------- the mirror gesture

describe('a dissolve and the id its survivor keeps', () => {
  // THE OTHER DIRECTION OF THE SAME RULE. A dissolve takes a group down to its lone child and puts
  // that child back in the grandparent position. The child is an EXISTING record simply moving up a
  // level, so nothing about it is new and nothing about it may be renamed.
  //
  // `setSlotContent`'s `occupantId` preserves the survivor's id and restorable cursor/scroll state.
  //
  // The dissolve path walks the DOM (up to the enclosing container, then to the parent slot it
  // occupies), which is why it is faked rather than driven through a real tree — the harness note at
  // the top of this file applies here too.
  it('puts the survivor back under ITS OWN id, not the parent position\'s', () => {
    const received: { instance: unknown; occupantId?: string }[] = []

    const parentSlotEl = { dataset: { droptargetId: 'region' } } as unknown as HTMLElement
    const parentEl = {
      parentElement: null,
      closest: () => parentSlotEl,
      contains: () => false,
    } as unknown as Element
    const parentPlacement = {
      panes: () => [], findPane: () => null, activate: () => {},
      getSlotContent: () => null,
      setSlotContent: (_slotId: string, instance: unknown, occupantId?: string) => {
        received.push({ instance, occupantId })
      },
      moveWithin: () => true, extract: () => null, inject: () => {},
    } as unknown as ContainerPlacement

    // This group has two panes and extract removes one immediately. panes() reads the live model;
    // the router must capture the pre-extraction set before it invokes extract.
    const held = ['leaving', 'survivor']
    const groupEl = { parentElement: parentEl, closest: () => parentSlotEl } as unknown as Element
    const groupPlacement = {
      panes: () => [...held],
      findPane: (id: string) => (held.includes(id) ? { id, type: 'editor-pane' } : null),
      activate: () => {},
      // The survivor's OWN id is deliberately different from the parent position's (`region`) and
      // from anything else in play — if the fix reads the wrong one, the assertion below cannot pass
      // by coincidence.
      getSlotContent: (id: string) =>
        id === 'survivor' ? { instance: { type: 'terminal' }, id: 'term-7' } : null,
      setSlotContent: () => {},
      moveWithin: () => true,
      extract: (id: string) => {
        const at = held.indexOf(id)
        if (at < 0) return null
        held.splice(at, 1)
        return { instance: { type: 'editor-pane' }, id }
      },
      inject: () => {},
    } as unknown as ContainerPlacement

    const sinkEl = { parentElement: null } as unknown as Element
    const sink = {
      panes: () => [], findPane: () => null, activate: () => {}, getSlotContent: () => null,
      setSlotContent: () => {}, moveWithin: () => true, extract: () => null, inject: () => {},
    } as unknown as ContainerPlacement

    registerContainer(parentEl, parentPlacement); registered.push(parentEl)
    registerContainer(groupEl, groupPlacement); registered.push(groupEl)
    registerContainer(sinkEl, sink); registered.push(sinkEl)
    // The group declares a floor of 2, so dropping to one child dissolves it.
    setGroupingProvider({ forNewGroup: () => groupingCap, forKind: () => groupingCap })
    targetElement = sinkEl

    // An EDGE zone, not a centre: a centre would take the wrap path instead of the cross-container
    // move the dissolve follows. And a `slot-rect` rather than an `empty` — `queryTargetElement`
    // resolves only `slot-rect` and `gap`, returning null for `empty` / `free-point` ("no producer
    // yet"), so an `empty` target makes `routeDrop` return before anything happens at all.
    routeDrop(
      drag('leaving'),
      { shape: 'slot-rect', containerKind: 'sink', slotId: 'sink-slot', zone: 'left' } as DropTarget,
      { sourceEl: groupEl },
    )

    expect(received).toHaveLength(1)
    // `term-7`, never `region`. The survivor is a terminal, so getting this wrong orphans a live pty.
    expect(received[0]!.occupantId).toBe('term-7')
  })
})
