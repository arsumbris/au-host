import { reloadPaneRows } from '@arsumbris/container-kit'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ContainerPlacement, ContextMenuItem, DropTarget, IntentPayload, MountHost, OpaqueConfig, PublisherId, StagedMint } from '@arsumbris/au-host-sdk'

import { highlightIntent, isOpenIntent, isOpenPaneIntent, isRevealPaneIntent, isShowPaneIntent, openIntentViewer } from '@arsumbris/intent'
import { isFileSelection } from '@arsumbris/selection'

import {
  BentoLayout,
  findLeaf,
  genId,
  getAllLeaves,
  movePane,
  removePane,
  resizeBranch,
  splitPane,
  splitWithNode,
  updateLeafState,
  type LayoutNode,
  type LeafNode,
  type PaneId,
} from './layout'

// Shared cross-container drag protocol.
import { bareTypeName, createChild, dissolvePane, EmptySlot, floatPaneRow, groupingOutcomeForNewGroup, groupNewPanesEnabled, moveToWindowRow, PaneProjection, paneActionsMenu, projectionLabel, projectionTitleLookup, ROOT_SLOT, resolveViewer, useContainerDialect, useContainerModel, useContainerPlacement, useMergedRef, usePaneSwap, viewerPickOptions, withCarry, wrapPaneInteractive } from '@arsumbris/container-kit'
import '@arsumbris/au-component-catalog/react' // JSX types for the <au-*> action glyphs
import { reportHostDiagnostic, event, on } from '@arsumbris/au-host-sdk'
import { bentoDropDialect } from './layout/bento/drop-dialect'

import { fromSubstrate, qualifierOf, replaceLeafOccupant, seamSlotOf, toSubstrate } from './config-binding'
import type { Bound, PaneState } from './config-binding'
// The persisted config dialect — the generated `bento` instance.
// (`BentoLayout` imported above is the layout React component, a different thing.)
// The runtime `LayoutNode<PaneState>` tree is translated to/from this by config-binding.
import type { Bento as PersistedLayout } from './generated'
import type { Projection } from '@arsumbris/au-host-sdk'

// MountHost provides config, saveConfig, and child mounting.

// A FALLBACK list, used only when `host.listProjections()` comes back empty. It hardcodes projection names
// in the container.
function pane(): LeafNode<PaneState> {
  // An EMPTY leaf: no occupant, so no pool id (only content-bearing state carries one). It renders a
  // picker; the reference unit lands when the picker fills it.
  return { type: 'leaf', id: genId(), state: {} }
}

/** With no configured or stored layout, show one empty pane. Its picker discovers
 * the available projections from the workspace. Starting arrangements belong in
 * composition files, so bento does not construct another projection's config. */
function defaultRoot(): LayoutNode<PaneState> {
  return pane()
}

// Bento persists its root layout. New-pane grouping is a composition-level setting.

/**
 * Materialize a fresh child as a leaf REFERENCE UNIT ({ id, instance }), ARRIVAL-GROUPED when the
 * composition asks: `grouping.group-new-panes` on + the child is a DOCUMENT (carries a `file`) + the
 * grouping container resolves UNAMBIGUOUSLY (an authored `grouping.group-into`, or a sole grouping
 * container). Then the document arrives wrapped in that container (its own tab strip / title), not bare.
 *
 * BENTO DOES NOT NAME THE GROUP. It reads the composition's resolved grouping container from the
 * substrate and calls that container's own `buildGroup` export, so the composition decides — tabs, a
 * column, a third party's carousel. Bento minting a `{ type: 'tabs',... }` would re-privilege one
 * container and re-encode a schema bento does not own.
 *
 * ONLY A DOCUMENT groups (the `file` duck-type — a `document-projection` kind would be the real fix). An
 * AMBIGUOUS-unconfigured grouping choice arrives BARE, never a per-open chooser. A pool-less runtime (a
 * detached secondary window) also arrives bare.
 */
function makeArrivalChild(host: MountHost, content: Projection): { id: string; instance: Projection } {
  const isDoc = (content as { file?: unknown }).file != null
  const pool = host.children.pool
  // Arrival grouping applies only to a DOCUMENT, when the composition wants it (`group-new-panes`) AND the
  // grouping container is UNAMBIGUOUS (an authored `group-into`, or a sole grouping container). An
  // AMBIGUOUS-unconfigured case arrives BARE — never a per-open chooser (the chooser is for the explicit
  // drop gesture only). A pool-less runtime (a detached
  // secondary window) also arrives bare.
  if (isDoc && groupNewPanesEnabled() && pool) {
    const outcome = groupingOutcomeForNewGroup()
    const cap = outcome && (outcome.reason === 'requested' || outcome.reason === 'only') ? outcome.chosen : null
    if (cap) {
      // The doc is pooled (host-assigned id), then the container builds a group around it and the host
      // pools the GROUP as its OWN record (a FRESH id) referencing the doc — the wrap-identity invariant:
      // the synthesized group is named anew, the child keeps its id so its cursor / terminal survive.
      const docId = createChild(host, content)
      const group = cap.build([{ id: docId, instance: content }]) as Projection
      const groupId = pool.createGroup(group)
      return { id: groupId, instance: group }
    }
  }
  return { id: createChild(host, content), instance: content }
}



/** Open beside the most recently focused non-firing pane, falling back to the
 * first non-firer leaf. A focused tabs group can claim the intent first through
 * host focus routing; this selection applies when bento is the focused container. */
function pickOpenTarget(root: LayoutNode<PaneState>, recency: PaneId[], firer: PaneId | null): PaneId | null {
  for (const id of recency) {
    if (id !== firer && findLeaf(root, id)) return id
  }
  return getAllLeaves(root).find((l) => l.id !== firer)?.id ?? null
}

export function BentoApp({ host }: { host: MountHost }): ReactNode {
  // The `::repo` qualifier bento serializes its OWN + its node types with, derived from
  // how the composition claimed bento (cross-repo → `::bento`, same-repo → ''). Read on
  // load; re-applied on every save so the round-trip stays engine-valid.
  const nodeQualifierRef = useRef('')
  const [paneTitles, setPaneTitles] = useState<Map<PublisherId, string>>(() => new Map())
  useEffect(() => host.viewState?.watchAll('pane-title', (publisher, value) => {
    setPaneTitles((previous) => {
      const title = typeof value === 'string' && value.trim() ? value : undefined
      if (previous.get(publisher) === title) return previous
      const next = new Map(previous)
      if (title) next.set(publisher, title)
      else next.delete(publisher)
      return next
    })
  }), [host])
  // The ACTIVE pane's `^:`, from the HOST focus signal (the host owns the truth; bento renders its own
  // ring from it). Drives `au-pane-frame focused` for the leaf whose OCCUPANT `^:` matches. bento no
  // longer tracks focus itself.
  const [activePane, setActivePane] = useState<string | null>(null)
  useEffect(() => host.focus.watchActive?.((id) => setActivePane(id)), [host])
  // Which pane fired + focus recency, so an open-intent opens in the most-recently-focused editor.
  const focusRecencyRef = useRef<PaneId[]>([])

  /**
   * bento's OWN record for a given tree — the ONE serialization used by BOTH the layout SAVE (the
   * cell's `commit`) and the pool-edit seam (`poolEdit`), so the mutating path and the pure path can
   * never disagree about what bento writes. It is ALSO the cell's config-space RESYNC gate (`toConfig`).
   *
   * It CARRIES the composition-scoped fields bento does NOT own (a root bento's `intent-defaults` /
   * `initial-focus`, and any future metadata on that record) verbatim from `host.config`, because a
   * structural edit re-derives from the pool — so a record missing its own metadata would drop routing
   * on the first re-parent. bento names only its OWN top-level fields; everything else is carried,
   * never authored. `^` is excluded; the host stamps it on merge.
   */
  const bentoRecord = (tree: LayoutNode<PaneState>): PersistedLayout =>
    withCarry(
      host,
      toSubstrate(tree, nodeQualifierRef.current),
      ['type', 'root'],
    ) as unknown as PersistedLayout

  // Resolve the persisted config into the runtime tree ONCE, synchronously — this becomes the cell's
  // initial value, so a fresh mount never saves a default over the pool. The `::repo` qualifier bento
  // serializes with is derived here too. Detached members reopen from this same binding in an effect
  // below. A parse failure falls back to the in-code default and surfaces `loadError`.
  const initialRef = useRef<{ bound: Bound; error: string | null } | null>(null)
  if (initialRef.current === null) {
    const config = host.config as PersistedLayout | undefined
    nodeQualifierRef.current = qualifierOf(config?.type)
    try {
      initialRef.current = { bound: config ? fromSubstrate(config) : { root: defaultRoot() }, error: null }
    } catch (err) {
      initialRef.current = { bound: { root: defaultRoot() }, error: err instanceof Error ? err.message : String(err) }
    }
  }
  const [loadError] = useState<string | null>(initialRef.current.error)

  /** Shared layout cell: commit advances and persists the live tree synchronously.
   * Every seam and intent handler reads live(); root drives rendering. Resync compares
   * the serialized bento record, so unrelated pool changes do not reset the layout.
   * Focus remains separate from the layout cell. */
  const save = (next: LayoutNode<PaneState> | null): void => {
    if (next) host.saveConfig(bentoRecord(next))
  }
  const { model: root, live, commit } = useContainerModel<LayoutNode<PaneState> | null>(
    initialRef.current.bound.root,
    save,
    { host, fromConfig: (raw) => fromSubstrate(raw as PersistedLayout).root, toConfig: (t) => (t ? bentoRecord(t) : null) },
  )
  // Read the live tree, transform it, and commit once. Leave a null tree unchanged.
  const update = (fn: (prev: LayoutNode<PaneState>) => LayoutNode<PaneState> | null): void => {
    const prev = live()
    if (prev) commit(fn(prev) ?? prev)
  }

  /** Read fixity from the slot governing the position that holds `id`. */
  const paneFixed = useCallback(
    (id: PaneId) => {
      const tree = live()
      return tree ? findLeaf(tree, id)?.state.slot?.fixed === true : false
    },
    [live],
  )
  // Which pane fired + focus recency, so an open-intent opens in the most-recently-focused editor
  // pane, never the firing file-tree. The firer/focused PUBLISHER maps to a pane through the host's
  // publisher ↔ `^:` bridge (`nodeIdOf`/`publisherOf`), which works whether bento mounts its children
  // itself (legacy) or the PORTAL mounts them flat (bento then only renders anchors, so a mount
  // callback is unavailable). bento's own pane identity is the POSITION id; the bridge speaks the
  // child's `^:` (`state.child.id`), so it maps through the leaf that holds that child.
  const paneForPublisher = (from: PublisherId): PaneId | null => {
    const childId = host.children.nodeIdOf?.(from)
    if (!childId) return null
    const tree = live()
    return tree ? (getAllLeaves(tree).find((l) => l.state.child?.id === childId)?.id ?? null) : null
  }
  const noteFocus = useCallback((id: PaneId): void => {
    focusRecencyRef.current = [id, ...focusRecencyRef.current.filter((x) => x !== id)] // bento's OWN open-target recency
    // NOTE: bento no longer reports to the host focus channel. The host owns a per-window DOM-focus tracker
    // that feeds the focus recency from ACTUAL focus (panes are focusable via the shared pane substrate),
    // so focus is tracked uniformly for every container.
  }, [])

  // Handle `open-intent`: open the file as a new editor PANE, split beside the MOST-RECENTLY-
  // FOCUSED pane (any kind, excluding the firing file-tree). Open FOLLOWS FOCUS — it is NOT
  // anchored to an existing editor. bento has NO preview and NO tab knowledge (the per-container
  // model): preview is the tabs container's feature; a bare bento editor SPLITS. If the file is
  // already open in a bento pane, focus it instead of splitting a duplicate. `mode` is ignored
  // (every bento open is permanent). A focused `tabs` editor group claims first via the host
  // focus-MRU walk; this handler runs when bento itself is the focused container.


  // CLAIM / DECLINE: returns `true` only on the paths that actually opened something, and
  // `false` everywhere it did nothing — so the responder-chain walk continues to the next capable
  // container instead of the intent dying here. The contract reads `void` as a CLAIM, so
  // every path that does nothing must explicitly return `false`.
  const handleOpenIntent = useCallback((intent: IntentPayload, from: PublisherId, apply: boolean): boolean => {
    if (!isOpenIntent(intent)) return false
    const sel = intent.target
    if (typeof sel === 'string' || !isFileSelection(sel)) {
      if (apply && on('intent')) event('intent', 'declined', { by: 'bento', reason: 'not a file to open' }) // trace WHY it declined
      return false // ref-arm unsupported
    }
    const cur = live()
    if (!cur) return false
    // The VIEWER resolves through the explicit ladder (never an implicit default): the firer's
    // `open-intent.with`, then the composition's `viewer-defaults`, then the sole eligible viewer, else
    // a MUST-PICK. `opens-meta` is eligibility only.
    const descriptors = host.describeProjections?.()
    const resolved = resolveViewer(sel.path, descriptors, {
      with: openIntentViewer(intent),
      viewerDefaults: host.viewerDefaults?.(),
    })

    // PLACEMENT (PURE): where would this open land? Already-open in a bento pane (not the firer) → focus
    // it; else a target pane to split beside. null → nowhere to place → DECLINE (let another container try).
    // Computed here so the CLAIM is honest about placement, not just viewer-eligibility.
    const firerPaneId = paneForPublisher(from)
    const fileOf = (l: LeafNode<PaneState>): string | undefined =>
      (l.state.child?.instance as { file?: string } | undefined)?.file
    const alreadyOpen = getAllLeaves(cur).find((l) => l.id !== firerPaneId && fileOf(l) === sel.path)
    const targetPaneId = alreadyOpen ? alreadyOpen.id : (pickOpenTarget(cur, focusRecencyRef.current, firerPaneId) ?? firerPaneId)
    if (!targetPaneId) {
      if (apply && on('intent')) event('intent', 'declined', { by: 'bento', reason: 'no pane to split beside' }) // trace WHY it declined
      return false
    }

    // The ACT, once a viewer is DECIDED. Re-reads the CURRENT root, so it is safe both synchronously and
    // after the async chooser resolves (a must-pick, where the layout may have moved). A go-to-def open
    // carries a `range` on the COMMAND CHANNEL (never the config): mount `{ file }` only, then fire
    // `reveal-if-exists`.
    const openWith = (viewerType: string): void => {
      const c = live()
      if (!c) return
      const content = { type: viewerType, file: sel.path } as Projection
      const revealRange = (): void => {
        if (sel.range) queueMicrotask(() => host.intent.fire(highlightIntent(sel, 'reveal-if-exists')))
      }
      const already = getAllLeaves(c).find((l) => l.id !== firerPaneId && fileOf(l) === sel.path)
      if (already) { noteFocus(already.id); revealRange(); return } // focus the open copy (no duplicate).
      const t = pickOpenTarget(c, focusRecencyRef.current, firerPaneId) ?? firerPaneId
      if (!t) return // placement vanished (async race) — no-op.
      // Fresh content: the HOST assigns the pool id (`createChild` pools the record + returns its `^:`);
      // a fresh document ARRIVES GROUPED when the composition asks, else bare. See `makeArrivalChild`.
      const leaf: LeafNode<PaneState> = { type: 'leaf', id: genId(), state: { child: makeArrivalChild(host, content) } }
      commit(splitPane(c, t, leaf, 'right'))
      revealRange() // the fresh child parks this until its file load resolves (editor mount race).
    }

    if ('mustPick' in resolved) {
      // Empty = NOTHING eligible → DECLINE. >=2 = a GENUINE choice: the host CHOOSER asks (no silent
      // default), and this container opens with the pick (a cancel abandons — already claimed here).

      if (resolved.mustPick.length === 0) {
        if (apply) reportHostDiagnostic({
          code: 'no-viewer-for-file',
          severity: 'warning',
          message: `no projection declares (opens-meta) that it opens "${sel.path}"; the open was declined`,
          subject: sel.path,
        })
        return false
      }
      const chooser = host.chooser
      if (!chooser) {
        if (apply) reportHostDiagnostic({
          code: 'viewer-ambiguous-no-default',
          severity: 'warning',
          message: `multiple viewers can open "${sel.path}" (${resolved.mustPick.join(', ')}) but no chooser surface is available; the open was declined`,
          subject: sel.path,
        })
        return false
      }
      if (apply) {
        void chooser
          .choose({ title: `Open ${sel.path.split('/').pop() ?? sel.path} with`, options: viewerPickOptions(resolved.mustPick, descriptors) })
          .then((picked) => { if (picked) openWith(picked) })
      }
      return true // CLAIMED: this container opens it once the user picks (or abandons on cancel).
    }
    if (apply) openWith(resolved.viewer)
    return true
  }, [noteFocus, host])

  // Handle open-pane-intent by placing the supplied instance permanently beside
  // the most recently focused non-firing pane. Claim only when a pane is placed.
  const handleOpenPaneIntent = useCallback((intent: IntentPayload, from: PublisherId, apply: boolean): boolean => {
    if (!isOpenPaneIntent(intent) || !intent.pane) return false
    const pane = intent.pane
    const prev = live()
    if (!prev) return false
    const firer = paneForPublisher(from)
    const target =
      focusRecencyRef.current.find((id) => id !== firer && findLeaf(prev, id)) ??
      getAllLeaves(prev).find((l) => l.id !== firer)?.id ??
      getAllLeaves(prev)[0]?.id ??
      null
    if (!target) return false // no leaf to place beside — let another container try.
    if (apply) {
      // Fresh content: the HOST assigns the pool id (and, for a grouped document arrival, the group's id).
      // A caller-supplied pane is a document only if it carries a `file`; today's open-pane callers send
      // terminals / agents, so this arrives bare — but a file-bearing open-pane groups like a doc open.
      const leaf: LeafNode<PaneState> = {
        type: 'leaf',
        id: genId(),
        state: { child: makeArrivalChild(host, pane as Projection) },
      }
      commit(splitPane(prev, target, leaf, 'right')) // split beside the target (a new permanent pane)
    }
    return true // CLAIMED: the pane is placed.
  }, [host])

  // Handle show-pane-intent by focusing a matching leaf or creating one beside the
  // focused pane. Instantiate from the type name without authoring other config fields.
  // Nested tabs groups handle their own activation. Decline when no tree is available.
  const handleShowPaneIntent = useCallback((intent: IntentPayload, apply: boolean): boolean => {
    if (!isShowPaneIntent(intent)) return false
    const prev = live()
    if (!prev) return false
    const leaf = getAllLeaves(prev).find(
      (l) => bareTypeName((l.state.child?.instance as { type?: string } | undefined)?.type) === bareTypeName(intent.paneType),
    )
    if (leaf) {
      if (apply) noteFocus(leaf.id) // REVEAL: already here.
      return true
    }
    // CREATE: place a bare instance of the requested type beside where the user is working.
    const target = pickOpenTarget(prev, focusRecencyRef.current, null) ?? getAllLeaves(prev)[0]?.id
    if (!target) return false
    if (apply) {
      const inst = { type: intent.paneType } as Projection
      const fresh: LeafNode<PaneState> = {
        type: 'leaf',
        id: genId(),
        state: { child: { id: createChild(host, inst), instance: inst } },
      }
      commit(splitPane(prev, target, fresh, 'right'))
    }
    return true
  }, [noteFocus, host])

  // REVEAL a specific pane by id: claim + focus the leaf holding it (open-surfaces → "Open editors"
  // click). Declines when this bento does not hold the pane, so the routed walk reaches the one that does.
  // `apply` gates the side effect: the CLAIM runs it dry (apply=false → pure), the COMMIT runs it live
  // (apply=true). Claim and commit run in the same synchronous dispatch tick, so they see identical state
  // and agree by construction — one source of truth, no claim/commit drift. Same pattern below.
  const handleRevealIntent = useCallback((intent: IntentPayload, apply: boolean): boolean => {
    if (!isRevealPaneIntent(intent)) return false
    const tree = live()
    const leaf = tree ? getAllLeaves(tree).find((l) => l.state.child?.id === intent.paneId) : undefined
    if (!leaf) return false
    if (apply) noteFocus(leaf.id)
    return true
  }, [live, noteFocus])

  // Menu and command front ends share the same container-owned split operation.
  const splitEmpty = useCallback((direction: 'right' | 'bottom', at?: PaneId): void => {
    const tree = live()
    if (!tree) return
    const target = at ?? pickOpenTarget(tree, focusRecencyRef.current, null)
    if (!target || !findLeaf(tree, target)) return
    const next = pane()
    commit(splitPane(tree, target, next, direction))
    noteFocus(next.id)
  }, [live, commit, noteFocus])

  useEffect(() => {
    const channel = host.intent
    // bento does NOT declare `promote-intent`: it has no preview/transient concept, so there is
    // nothing to promote. A nested `tabs` container declares it (firer-relative) and promotes its
    // own preview tab; a bare bento editor pane is already permanent.
    const splitCommands = (['right','down'] as const).map(direction => channel.handle(`split-${direction}-intent`, {
      claim: () => !!live() && !!pickOpenTarget(live()!, focusRecencyRef.current, null),
      commit: () => splitEmpty(direction==='down' ? 'bottom' : 'right'),
    }))
    const offOpen = channel.handle('open-intent', { claim: (i, f) => handleOpenIntent(i, f, false), commit: (i, f) => void handleOpenIntent(i, f, true) })
    const offPane = channel.handle('open-pane-intent', { claim: (i, f) => handleOpenPaneIntent(i, f, false), commit: (i, f) => void handleOpenPaneIntent(i, f, true) })
    const offShow = channel.handle('show-pane-intent', { claim: (i) => handleShowPaneIntent(i, false), commit: (i) => void handleShowPaneIntent(i, true) })
    const offReveal = channel.handle('reveal-pane-intent', { claim: (i) => handleRevealIntent(i, false), commit: (i) => void handleRevealIntent(i, true) })
    return () => {
      splitCommands.forEach(off=>off())
      offOpen()
      offPane()
      offShow()
      offReveal()
    }
  }, [host, handleOpenIntent, handleOpenPaneIntent, handleShowPaneIntent, handleRevealIntent, live, splitEmpty])


  // ContainerPlacement handles same-container moves and cross-container extract/inject.
  // Every method reads live(), the post-commit tree, rather than the render closure.

  /**
   * THE ONE REMOVAL PATH. A close and an extract are the same operation; the only difference is
   * whether the caller keeps what came out. Written once so the fixity refusal cannot disagree
   * between the ✕ and the seam.
   *
   * Removing the LAST pane empties the bento, so it falls back to a fresh empty position (a picker)
   * rather than keeping the removed one, which would duplicate it into the target.
   */
  // Resolve either id space to a leaf. The generic close floor (`closePane`) and the agent transport
  // hand the STABLE CHILD id (`state.child.id`, the `^:` — a duplicate placeholder's `__ph-…`, a pooled
  // pane's own id), while bento's own ✕ passes the leaf POSITION id. `findLeaf` matches only the
  // position id, so without this the childId path silently finds nothing. Position id wins; childId is the fallback.
  const findByAnyId = (tree: LayoutNode<PaneState>, id: PaneId): LeafNode<PaneState> | null =>
    findLeaf(tree, id) ?? getAllLeaves(tree).find((l) => l.state.child?.id === id) ?? null

  const removeAt = (paneId: PaneId): LeafNode<PaneState> | null => {
    const tree = live()
    if (!tree) return null
    const leaf = findByAnyId(tree, paneId)
    if (!leaf) return null // a branch id, not a pane
    if (leaf.state.slot?.fixed) return null // a fixed slot can never be emptied
    // Remove by the leaf's POSITION id (what `removePane` matches), regardless of which id came in.
    update((prev) => removePane(prev, leaf.id) ?? { type: 'leaf', id: genId(), state: {} })
    return leaf
  }

  const placement: ContainerPlacement = {
    panes: () => (live() ? getAllLeaves(live()!).map((l) => l.id) : []),
    findPane: (id) => {
      const leaf = live() ? findByAnyId(live()!, id) : null
      return leaf ? { id, type: (leaf.state.child?.instance as { type?: string } | undefined)?.type ?? '' } : null
    },
    // The resolve-at-boundary normalizer: map any inbound address (a leaf POSITION id, or a child `^:`
    // OCCUPANT id) to the canonical POSITION id (`leaf.id`), so the substrate hands every seam below a
    // position and no seam maps ids. bento's positions are `slot.id ?? genId()` — never a child id and a
    // synthetic id for a bare leaf — so this is the id-space that never self-maps. `null` when unknown.
    resolve: (address) => (live() ? (findByAnyId(live()!, address)?.id ?? null) : null),
    // A bento leaf is always visible in the split grid — nothing to activate; focus it.
    activate: (id) => noteFocus(id),
    // The OCCUPANT of this position: its instance AND its own id. `state.child.id` is deliberately
    // NOT the leaf's `id` — the leaf id is the POSITION's, so an emptied-but-still-ruled position
    // keeps its address. Returning the occupant id prevents the substrate from substituting the
    // position's id for the occupant's.
    getSlotContent: (slotId) => {
      // Accept a POSITION id OR an OCCUPANT (child `^:`) id — the same resolution `setSlotContent` does.
      // The wrap seam addresses a pane by its OCCUPANT id (`data-pane-id`), so a raw `findLeaf` (which
      // keys by the leaf POSITION id only) returned null and the wrap silently no-op'd — most visibly at a
      // bare-leaf root, where the position and occupant ids differ.
      const leaf = live() ? findByAnyId(live()!, slotId) : null
      const occ = leaf?.state.child
      return occ === undefined ? null : { instance: occ.instance, id: occ.id }
    },
    // Preserve the position's slot fields and occupant identity when changing content.
  // Spreading the previous state keeps fixed/admission rules attached to the position.
    setSlotContent: (slotId, instance, occupantId) => {
      // No local `admits` guard: the substrate checks it at every seam that reaches here (the
      // centre-wrap and the dissolve), BEFORE anything destructive runs. A second copy of the rule
      // in each of six containers is exactly the divergence `slotFor` exists to remove.
      // The rule lives in `replaceLeafOccupant`, beside the state shape it governs, so it has a
      // name and a test.
      //
      // Accept a POSITION id OR an OCCUPANT (child `^:`) id. A self-filling occupant — a placeholder's
      // onPick, or an open routed into it — addresses this seam by its OWN child id (`host.instanceId`),
      // but `replaceLeafOccupant` keys by the leaf POSITION id (`updateLeafState` matches `node.id`). So
      // resolve to the position first, exactly as `removeAt` does; otherwise the write silently no-ops
      // (no leaf matches the child id) while `setPaneContent` still reports success.
      update((prev) => {
        const posId = findByAnyId(prev, slotId)?.id ?? slotId
        return replaceLeafOccupant(prev, posId, instance as Projection, occupantId)
      })
    },
    // The SAME-container move: bento's in-place split. `sourceLocalId` is a leaf id
    // (bento has no tab strips, so no `gap` reorder / tabgroup move — a
    // center drop is the router's wrap-into-tabs, upstream).
    moveWithin: (sourceLocalId, target: DropTarget) => {
      if (paneFixed(sourceLocalId)) return false // fixed occupant does not move (substrate already gated; defense-in-depth)
      if (target.shape !== 'slot-rect') return false // bento reorders only within a slot-rect
      update((prev) => movePane(prev, sourceLocalId, target.slotId, target.zone))
      return true
    },
    // Cross-container extraction carries the occupant's stable identity. Read live()
    // synchronously so multiple seam calls in one tick see earlier commits.
    extract: (localId) => {
      // The SAME removal the ✕ performs — see `removeAt`. The seam simply keeps what came out. The
      // fixity refusal there is defense-in-depth: the substrate already refused before calling.
      const leaf = removeAt(localId)
      // Carry the CHILD's id, not the position's, so a moved terminal reattaches and a moved editor
      // keeps its cursor at the destination.
      return leaf ? { instance: leaf.state.child?.instance ?? null, id: leaf.state.child?.id ?? localId } : null
    },
    inject: (instance, id, target) => {
      // A FRESH position id; `id` from the router is the CHILD's (carried from extract), so the moved
      // pane keeps its pool identity + view-state — a re-parent REUSES the id, never mints. The slot
      // does NOT travel — the child picks up whatever the destination position says (nothing, for a split).
      const newLeaf: LeafNode<PaneState> = { type: 'leaf', id: genId(), state: { child: { id, instance: instance as Projection } } }
      // Reads `live()` (never `update`, whose null-guard would swallow the empty-bento case where the
      // injected pane BECOMES the root). One commit, built on the post-commit tree.
      const prev = live()
      if (!prev) {
        commit(newLeaf) // empty bento → the injected pane becomes the root
        return
      }
      if (target.shape === 'slot-rect') {
        // CENTER is the generic wrap-into-tabs path (the router builds a `tabs`
        // container, never reaching here), so bento.inject sees only edge zones;
        // guard a stray center defensively by splitting right.
        const zone = target.zone === 'center' ? 'right' : target.zone
        commit(splitWithNode(prev, target.slotId, newLeaf, zone))
      }
      // bento emits no `gap` targets (no tab strip); ignore anything else.
    },
    // The lookup only this container can answer: which slot governs this id. bento resolves a
    // POSITION id directly — its runtime node ids ARE its positions — and falls back to matching a
    // child id, since a drag source names the thing rather than the place.
    slotFor: (id) => {
      const tree = live()
      if (!tree) return null
      const leaf =
        findLeaf(tree, id) ?? getAllLeaves(tree).find((l) => l.state.child?.id === id) ?? null
      return seamSlotOf(leaf?.state.slot)
    },
    // THE POOL-EDIT SEAM: the PURE, pool-writing form of extract/inject/moveWithin. Each
    // computes a new bento record from `live()` and returns it WITHOUT mutating React state; the
    // router batches the source + target records into one atomic `commit`, and the host re-derives
    // the tree once. A re-parent becomes a reference re-point — no in-place tree mutation (the
    // `removeChild` crash) and no stale-snapshot re-serialize (the duplication). Present only when the
    // runtime owns a pool (absent on a detached-window bento, which falls back to the mutating seam).
    ...(host.children.pool
      ? {
          poolEdit: {
            recordId: () => (host.config as { ['^']?: string } | undefined)?.['^'] ?? '',
            extractEdit: (localId) => {
              const tree = live()
              if (!tree) return null
              // Resolve a POSITION id OR an OCCUPANT (`^:`) id: the address-based callers (float / move-to-window /
              // close) address a pane by its occupant id (its `data-pane-id`), while a drag source passes the leaf
              // position id. `findLeaf` alone matches only the position, so an occupant-id caller found nothing.
              const leaf = findByAnyId(tree, localId)
              if (!leaf) return null // a branch id, not a pane
              if (leaf.state.slot?.fixed) return null // a fixed slot's occupant does not leave
              const newTree = removePane(tree, leaf.id) ?? { type: 'leaf', id: genId(), state: {} }
              return {
                record: bentoRecord(newTree),
                occupant: { instance: leaf.state.child?.instance ?? null, id: leaf.state.child?.id ?? localId },
              }
            },
            injectEdit: (instance, id, target) => {
              const tree = live()
              const newLeaf: LeafNode<PaneState> = { type: 'leaf', id: genId(), state: { child: { id, instance: instance as Projection } } }
              if (!tree) return bentoRecord(newLeaf) // empty bento → the injected pane is the root
              if (target.shape !== 'slot-rect') return null // bento places only at a slot-rect edge
              const zone = target.zone === 'center' ? 'right' : target.zone
              return bentoRecord(splitWithNode(tree, target.slotId, newLeaf, zone))
            },
            moveWithinEdit: (sourceLocalId, target) => {
              if (paneFixed(sourceLocalId)) return null
              if (target.shape !== 'slot-rect') return null
              const tree = live()
              if (!tree) return null
              return bentoRecord(movePane(tree, sourceLocalId, target.slotId, target.zone))
            },
            wrapEdit: (slotId, groupInstance, groupId, removeLocalId) => {
              let tree = live()
              if (!tree) return null
              // SAME-container wrap: the dragged pane also lives here, so drop it in the SAME record
              // (a cross-container wrap passes no removeLocalId — the source drops it via extractEdit).
              if (removeLocalId != null) tree = removePane(tree, removeLocalId) ?? tree
              // Accept a POSITION id OR an OCCUPANT (child `^:`) id — the wrap seam (`wrapPaneSolo`)
              // addresses the pane by its OCCUPANT id, but `replaceLeafOccupant` keys by the leaf POSITION
              // id, so without this resolve the wrap silently no-op'd (returned the tree unchanged) — most
              // visibly at a bare-leaf root, where the two ids differ. Same resolve `setSlotContent` does.
              const posId = findByAnyId(tree, slotId)?.id ?? slotId
              // The position now references the GROUP by id; `leafTo` emits `[[^^groupId]]` from the
              // leaf's childId, so the group is a flat sibling, never embedded. The instance is only
              // the pre-remount render content (the remount resolves it fresh from the pool).
              return bentoRecord(replaceLeafOccupant(tree, posId, groupInstance as Projection, groupId))
            },
            // STRUCTURAL channel: STAGE the mint (draw an id, no pool write) so the record rides the
            // same `propose` batch as the wrap/inject edit — a refused proposal leaves no orphan.
            createRecord: (record) => host.children.pool!.stageRecord(record as OpaqueConfig) as StagedMint,
            createGroup: (groupInstance) => host.children.pool!.stageGroup(groupInstance as OpaqueConfig) as StagedMint,
            // THE ASK: propose the batch to the host (falls back to applyStructural when the host lacks the proposal capability).
            propose: (edits) => (host.children.pool!.propose ?? host.children.pool!.applyStructural)(edits as ReadonlyArray<{ id: string; record: OpaqueConfig }>),
          } satisfies NonNullable<ContainerPlacement['poolEdit']>,
        }
      : {}),
  }
  // The callback ref registers bento's placement with the drop router when the
  // layout root mounts (which is AFTER the initial `!root` loading view). bento
  // ALSO declares its drop DIALECT (target emission) on the SAME root element;
  // `useMergedRef` fires both stable callback refs from one `ref=`.
  const setPlacementRoot = useContainerPlacement(placement)
  const setDialectRoot = useContainerDialect(bentoDropDialect)
  const setContainerRoot = useMergedRef(setPlacementRoot, setDialectRoot)

  // Universal swap: replace a leaf's projection in place, carrying its document. Declared BEFORE the
  // `!root` early return — it calls `useState`, so it must run on EVERY render, never conditionally,
  // or the hook count changes when the layout loads (React error #310).
  // Fill or replace a leaf's occupant, PRESERVING its pool id (a save / swap must NOT re-mint the
  // pane's identity — its `^:` keys the pty session + view-state). The host assigns a fresh id ONLY
  // the first time content lands on an empty leaf (the picker). One home for every content-fill site.
  const fillLeaf = useCallback(
    (prev: PaneState, instance: Projection): PaneState => ({
      ...prev,
      child: { id: prev.child?.id ?? createChild(host, instance), instance },
    }),
    [host],
  )

  // Swap routes through the ONE placement-seam address-op (`setPaneContent`), which honours the slot's
  // `fixed` / `admits` at the seam — no bento-local fixity check, and the ⇄ is also hidden for a fixed
  // pane in renderUnitActions. Keyed by the leaf POSITION id, which bento's `findPane` / `slotFor` /
  // `setSlotContent` all resolve.
  const swapPane = usePaneSwap(host)

  if (!root) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', font: 'var(--au-t-xs)/var(--au-lh-xs) var(--au-font-mono)', color: 'var(--au-ink-4, #8a8f9d)' }}>
        {loadError ? `layout failed to load: ${loadError}` : 'resolving layout…'}
      </div>
    )
  }

  const descriptors = host.describeProjections?.() ?? []
  const titleOf = projectionTitleLookup(descriptors)
  const placeholderTypes = new Set(descriptors.filter(p => p.kinds.includes('placeholder-projection')).map(p => bareTypeName(p.type)))
  const containerTypes = new Set(descriptors.filter((p) => p.kinds.includes('container-projection')).map((p) => bareTypeName(p.type)))
  const labelOf = (paneId: PaneId): string => {
    const child = findLeaf(root, paneId)?.state.child
    const publisher = child && host.children.publisherOf?.(child.id)
    const title = publisher && paneTitles.get(publisher)
    const bare = bareTypeName(child?.instance?.type)
    return (title && title !== bare ? title : titleOf(child?.instance?.type)) || projectionLabel(child?.instance?.type) || 'Empty pane'
  }
  /** The FULL type name (label bares it), so a target slot's `admits` can be checked by closure. */
  const typeOf = (paneId: PaneId): string | undefined => findLeaf(root, paneId)?.state.child?.instance?.type

  const renderUnit = (paneId: PaneId, state: PaneState): ReactNode => {
    if (!state.child) {
      // The empty branch is the substrate's now: EmptySlot resolves the placeholder and MATERIALIZES it
      // as this leaf's occupant via the placement seam (bento's setSlotContent, above), so the next render
      // takes the occupant path below. No bento-local picker or onPick — the fill flows through one seam.
      return <EmptySlot host={host} slotId={paneId} />
    }
    // Swap picker: same slot, replace the occupant's projection (document carried).
    if (swapPane.isSwapping(paneId)) return swapPane.swapPicker(paneId, state.child.instance)
    return (
      <PaneProjection
        // Key on type + the open FILE (if any): when an open-intent replaces this
        // pane's file, the key changes and the editor REMOUNTS on the new file. A
        // child saving config (same file) keeps the key stable, so it does not remount.
        key={`${state.child.instance.type}:${(state.child.instance as { file?: string }).file ?? ''}`}
        host={host}
        // The CHILD's own `^:` keys its restorable view-state and its terminal session, so it
        // travels with the thing. `paneId` here is the POSITION's id, which is what a drop target
        /** Read the governing slot at a position, or null when the position has no rules. */
        paneId={state.child.id}
        id={state.child.instance.type ?? ''}
        config={state.child.instance}
        onChildConfig={(next) =>
          // Preserve the position's slot record and child identity when saving changed content.
          update((p) => updateLeafState(p, paneId, (prev) => fillLeaf(prev, next as Projection)))
        }
      />
    )
  }


  // WRAP the pane's OCCUPANT in a NEW single-child container (the pane-header affordance): pick a kind
  // (the composition's `group-into` / a sole target silently, else the host chooser), then re-point the
  // slot at a fresh group holding only this pane. The generic op lives in the substrate; the pane keeps
  // its `^:` id. `contentId` is the occupant's id (its DOM `data-pane-id`), which `placementForPane`
  // resolves and the wrap seam accepts. Chooser absent (older host) → a genuine ambiguous choice cancels.
  const wrapInContainer = (contentId: string): void => {
    const choose = host.chooser ? host.chooser.choose.bind(host.chooser) : async () => null
    void wrapPaneInteractive(contentId, { choose })
  }

  const renderUnitActions = (paneId: PaneId): ReactNode => {
    // The occupant's own id (its `data-pane-id`) is what the wrap/unwrap seams address, not the leaf
    // POSITION id the other bento ops use. Undefined for an empty leaf → no wrap/unwrap offered.
    const contentId = root ? getAllLeaves(root).find((l) => l.id === paneId)?.state.child?.id : undefined
    // UNWRAP dissolves bento when it holds ONE leaf, lifting the pane into bento's grandparent slot.
    const singleLeaf = root ? getAllLeaves(root).length === 1 : false
    const fixed = paneFixed(paneId)
    // The occupant-level actions collapse behind ONE `⋯` overflow menu (the shared `paneActionsMenu`),
    // so a pane header carries one affordance instead of a crowded glyph row. Split / detach stay
    // bento-local rows; swap / wrap / unwrap are the generic ones. The grip (drag) stays inline.
    const rows: ContextMenuItem[] = []
    if (!fixed) rows.push({ id: 'pane.swap', label: 'Swap pane', icon: 'swap', enabled: true, run: () => swapPane.toggle(paneId) })
    rows.push({ id: 'pane.split-right', label: 'Split right', icon: 'split-right', enabled: true, run: () => splitEmpty('right', paneId) })
    rows.push({ id: 'pane.split-down', label: 'Split down', icon: 'split-down', enabled: true, run: () => splitEmpty('bottom', paneId) })
    if (contentId && !fixed)
      rows.push({ id: 'pane.wrap', label: 'Wrap in a container', icon: 'wrap', enabled: true, run: () => wrapInContainer(contentId) })
    if (contentId && singleLeaf && !fixed)
      rows.push({ id: 'pane.unwrap', label: 'Unwrap container', icon: 'unwrap', enabled: true, run: () => dissolvePane(contentId) })
    // Float ("Open in a new window") is the GENERIC host op, shared across every container (not bento's).
    // Keyed by the OCCUPANT's id (its `data-pane-id`), the same id the wrap/unwrap seams take.
    if (contentId && !fixed) {
      const floatRow = floatPaneRow(host, contentId)
      if (floatRow) rows.push(floatRow)
    }
    // Append "Move to other window" LAZILY (its gate turns true when another window opens — not a change to
    // THIS bento's config, so the menu is re-built at open, not cached at render). See paneActionsMenu.
    return paneActionsMenu(host, () => {
      const moveRow = contentId && !fixed ? moveToWindowRow(host, contentId) : null
      return [...rows, ...(moveRow ? [moveRow] : []), ...(contentId ? reloadPaneRows(host, contentId) : [])]
    })
  }

  return (
    <>
      {/* width:100% + minWidth:0 so bento FILLS its container on the main axis regardless of the
          container's display (block OR flex). As the root, bento mounted into a block slot where
          width:auto filled; nested in a flex mount-slot (the dock center), width:auto became
          content-sized and made the sash-resize total drift. Declaring the fill makes it robust. */}
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0, height: '100%', minHeight: 360 }}>
        <div ref={setContainerRoot} style={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <BentoLayout<PaneState>
            containerSlot={ROOT_SLOT}
            root={root}
            renderUnit={renderUnit}
            renderUnitActions={renderUnitActions}
            contentIdOf={(s) => s.child?.id}
            activePane={activePane}
            onFocusPane={noteFocus}
            getPaneLabel={labelOf}
            getPaneType={typeOf}
            isContainerPane={(id) => containerTypes.has(bareTypeName(typeOf(id)))}
            onResize={(branchId, ratio) => update((p) => resizeBranch(p, branchId, ratio))}
            canClosePane={(id) => root.type !== 'leaf' || (!!typeOf(id) && !placeholderTypes.has(bareTypeName(typeOf(id))))}
            onClosePane={(paneId) => { removeAt(paneId) }}
            fixedFor={paneFixed}
          />
          {/* The DragOverlay is HOST-mounted now (once per window), reading the
              window-shared container-core store — so cross-BUNDLE drag (bento ↔
              the tabs bundle) shares one overlay. */}
        </div>
      </div>
    </>
  )
}
