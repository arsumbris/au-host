// Binding between the PERSISTED bento config (the generated `bento` substrate
// shape) and the in-memory runtime `LayoutNode` tree (bento's generic
// window manager). The substrate is what a composition stores and the engine
// validates; the runtime is what drag / tree-ops / rendering operate on. They
// diverge on discriminant names, the leaf payload (a typed projection instance
// vs the runtime `state`), node ids, and the inline/ref arm — this module is the
// translation at the load/save boundary.
//
// a leaf binds ONE child projection instance via `content: projection&`.
// The instance's `type` names the view; its other fields ARE that view's config.

import type { Bento, BentoNodeBranch } from './generated'
import type { Occupant, Projection } from '@arsumbris/au-host-sdk'
import { makeSlotCodec, mintBlockId, persistedId, type SlotState as CoreSlotState } from '@arsumbris/container-core'
import { genId, updateLeafState } from './layout/bento/tree-ops'
import type { BranchNode, LayoutNode, LeafNode } from './layout/bento/types'

/** What the POSITION says, when it says anything. bento adds nothing to the shared slot: it sizes
 *  its splits through `bento-node.branch.ratio`, so it honours no size and no collapse. */
export type SlotState = CoreSlotState

/**
 * THE UNION CODEC — reading and writing `<projection& | bento-slot | bento-node.branch&>` at a LEAF
 * position is the substrate's, not bento's. Bento keeps the two things that really are its own: the
 * BRANCH arm (a structural node no other container has) and the tree wrapper it reads into.
 *
 * Per-qualifier, because a composition authored in another repo claims bento's types QUALIFIED, and
 * the qualifier is known per save rather than at module load. Reads never need it.
 */
const slotsFor = (qualifier: string) =>
  makeSlotCodec<Projection>({ slotType: 'bento-slot', qualifier, label: 'bento' })
const slots = slotsFor('')

/** The slot at a position as the SEAM speaks it, or null when the position says nothing.
 *  Shared with `BentoApp`'s `slotFor`. */
export const seamSlotOf = (slot: SlotState | undefined): ReturnType<typeof slots.toSeamSlot> =>
  slots.toSeamSlot(slot)

/** Runtime payload for one leaf: an opaque child projection and its governing slot.
 * `id` addresses the position and stays stable across content swaps. `childId`
 * identifies the occupant, travels with it, and keys restorable view state and
 * terminal sessions. The position can remain addressable while empty. */
export interface PaneState {
  /**
   * The occupant as a REFERENCE UNIT: its `^:` pool id and its instance, TOGETHER. Coupling them
   * (id REQUIRED whenever content is present) is the structural guarantee — "content without a
   * pool id" is not representable, so the render/serialize mismatch that collapses a layout cannot be
   * built. An EMPTY leaf (a picker slot) has no `child`. The id is HOST-ASSIGNED for fresh content
   * (`createChild`) or substrate-minted for a synthesized record; a container never schemes it.
   *
   */
  child?: Occupant<Projection>
  slot?: SlotState
}

/**
 * Replace a POSITION's OCCUPANT, leaving the position itself untouched. What bento's
 * `setSlotContent` does, given a name so it can be tested and so the rule has one home.
 *
 * Preserve the position's `slot` record (`admits` / `fixed` / `label` / carried fields)
 * and the occupant's `childId` when updating content. Returning only `{ content }` would discard
 * them during centre-wrap or dissolve, collapsing a ruled position to a bare child under fresh ids
 * in an otherwise valid file without a diagnostic.
 *
 * `occupantId` absent means keep the occupant's current id; present means the caller is naming it
 * (a wrap names the synthesized wrapper, a dissolve names the survivor it is putting back).
 *
 *
 * A gesture replaces an OCCUPANT, never a POSITION.
 */
export function replaceLeafOccupant(
  root: LayoutNode<PaneState>,
  slotId: string,
  instance: Projection,
  occupantId?: string,
): LayoutNode<PaneState> {
  return updateLeafState(root, slotId, (state) => ({
    ...state,
    // Reuse the named or existing pool id; a wrap/dissolve always supplies one, so the substrate
    // fallback is a defensive floor (this pure reducer has no host to assign from).
    child: { id: occupantId ?? state.child?.id ?? mintBlockId(), instance },
  }))
}

/** The bound runtime tree. A floated pane is a first-class `window` pool record (its parent is the
 *  window node), not a bento-tracked member, so binding produces only the layout tree. */
export interface Bound {
  root: LayoutNode<PaneState>
}

/** A value at a CHILD POSITION: the three-branch union. Named once because every load / save
 *  function takes or returns exactly this. */
type NodeValue = Bento['root']

// `persistedId` is the substrate's — it reads the engine's identity-layer `^:` off any inline
// record, which is not a bento concept.

// Cross-repo type qualifiers. A composition authored in ANOTHER repo must claim
// bento's types QUALIFIED (`bento::bento`, `bento-node.leaf::bento`), because a bare
// name resolves repo-locally (the engine's rule: a type not defined in the file's own
// repo needs `::repo`). bento's RUNTIME matches the bare discriminant, and its SAVE
// re-applies the qualifier so the round-trip stays valid. bento-node shares bento's
// repo, so the composition's own type qualifier applies to every node type.

/** Strip a `::repo` qualifier from a type name (for the runtime discriminant match). */
function bareType(t: string): string {
  const i = t.indexOf('::')
  return i < 0 ? t : t.slice(0, i)
}

/** The `::repo` qualifier of a type name, or '' if unqualified. */
export function qualifierOf(t: string | undefined): string {
  if (!t) return ''
  const i = t.indexOf('::')
  return i < 0 ? '' : t.slice(i)
}

// --- load: persisted substrate -> runtime WM tree ---

/** Build the runtime tree from a persisted `bento` instance. A node's runtime `id`
 *  is its persisted `^:` block-id (stable across reloads), minted only when
 *  the persisted node carries none. Children arrive already resolved (the host resolves
 *  the composition pool before mounting), so binding is a pure structural translation. */
export function fromSubstrate(layout: Bento): Bound {
  return { root: nodeFrom(layout.root) }
}

function nodeFrom(node: NodeValue): LayoutNode<PaneState> {
  // Match the BARE discriminant (the runtime `type` may carry a `::repo` qualifier the
  // literal generated type doesn't spell). Manual narrowing via `as`, since switching on
  // a stripped string loses TS's discriminant narrowing. A bare `mountable*` child (a
  // string ref) has no `.type`, so guard the string case before touching it.
  if (typeof node !== 'string' && bareType(node.type) === 'bento-node.branch') {
    const b = node as BentoNodeBranch
    const children = b.children.map((c) => nodeFrom(c))
    if (children.length !== 2) {
      // bento's runtime is a binary tree (binary branching); 3+ panes per
      // row are authored as nested binary branches.
      throw new Error(`bento: a branch needs exactly 2 children, got ${children.length}`)
    }
    const branch: BranchNode<PaneState> = {
      type: 'branch',
      id: persistedId(node) ?? genId(),
      direction: b.direction,
      ratio: b.ratio,
      children: [children[0], children[1]],
    }
    return branch
  }
  // Both remaining arms — a `bento-slot` and a BARE mountable ref — are the same union the codec
  // reads, so there is one path rather than two that could disagree about what a position says.
  return leafFrom(node)
}

/** One LEAF position: whatever occupies it (possibly nothing), plus what the position says.
 *  The runtime node id is the POSITION's — the slot's own `^:` when authored, else minted — and it
 *  is never the occupant's, so an emptied-but-still-ruled position keeps its address. */
function leafFrom(node: NodeValue): LeafNode<PaneState> {
  const { child, slot } = slots.read(node)
  return {
    type: 'leaf',
    id: slot.id ?? genId(),
    state: {
      // The codec already returns an `Occupant` ({ id, instance }); hold it verbatim as the reference
      // unit. `child.id` is the pool `^:` the codec preserved (or substrate-minted for an id-less legacy child).
      ...(child === undefined ? {} : { child }),
      ...(slots.speaks(slot) ? { slot } : {}),
    },
  }
}

// The host derives config ownership from the type graph and preserves unowned fields
// at saveConfig. This projection emits only the fields it understands.
export function toSubstrate(root: LayoutNode<PaneState>, qualifier = ''): Bento {
  return { type: `bento${qualifier}`, root: nodeBody(root, qualifier) } as unknown as Bento
}

/** Serialize a node's OWN structure, recursing through its children. */
function nodeBody(node: LayoutNode<PaneState>, qualifier: string): NodeValue {
  switch (node.type) {
    case 'branch':
      return {
        '^': node.id,
        type: `bento-node.branch${qualifier}`,
        direction: node.direction,
        ratio: node.ratio,
        children: node.children.map((c) => nodeBody(c, qualifier)),
      } as unknown as NodeValue
    case 'leaf':
      return leafTo(node, qualifier)
  }
}

/** Serialize a leaf position through the shared union codec. The occupant is emitted as a
 *  `[[^^childId]]` REFERENCE into the composition pool (the codec's `write` does this for every
 *  container), so bento's record embeds only its own structure + child ref-ids and never a stale
 *  child. A bare position → the bare ref; a ruled position → a `bento-slot` record whose `child` is
 *  the ref; an empty position → an empty placeholder slot, to keep the branch's arity of two. */
function leafTo(node: LeafNode<PaneState>, qualifier: string): NodeValue {
  const { child, slot } = node.state
  const written = slotsFor(qualifier).write({
    // The occupant is already a reference unit ({ id, instance }) — write it as-is. Its `^:` id is
    // present by construction (host-assigned or substrate-minted), so serialize never mints a fresh
    // one: render and serialize name the child the SAME way. That is the guarantee.
    ...(child === undefined ? {} : { child }),
    slot: slot ?? {},
  })
  return (written ?? { type: `bento-slot${qualifier}` }) as unknown as NodeValue
}

