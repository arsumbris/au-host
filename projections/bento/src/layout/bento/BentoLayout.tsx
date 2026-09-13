import {
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  DATA_ATTR,
  ROOT_SLOT,
  useDragStart,
  useLayoutDrag,
  useOfferedHeaderRegion,
  useResizeDrag,
  type DragStartSpec,
} from '@arsumbris/container-kit';
import '@arsumbris/au-component-catalog/react'; // JSX types for the <au-*> chrome intrinsic elements
import type { LayoutNode, LeafNode, PaneId } from './types';

/* During a drag, inset each leaf body to expose a frame ring owned by bento.
 * The ring offers bento split targets; the centre resolves to the nested child
 * or a group wrap through deepest-wins routing. Bento renders this geometry
 * from the shared drag state. */
const FRAME_INSET = 'var(--au-space-5)';
/** The neutral receiver ring exposes nesting during a drag. It stays quieter than
 * the resolved landing band and uses the same rounded vocabulary as pane chrome. */
const framedContentStyle = {
  padding: FRAME_INSET,
  borderRadius: 'var(--au-radius-md)',
  background: 'color-mix(in oklab, var(--au-ink-1) 3%, transparent)',
  boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--au-ink-1) 16%, transparent)',
} as const;

// Bento's pane chrome is the swappable token-only <au-*> vocabulary: <au-pane-header> is the header
// frame, into which bento SLOTS its own <au-grip-glyph> (or an <au-icon name="lock"> on a fixed pane)
// and <au-close-button> and listens for their events; <au-splitter> is the sash. bento owns the drag
// PHYSICS (via the shared useResizeDrag) and the handlers — the frame stays pure layout (see the
// pane-header contribution seam). The drag-time frame-inset + focus outline below are bento's
// own drop-dialect / focus PRESENTATION, not chrome, and stay inline for now.

/** Render callback the host provides to paint a leaf's content.
 *  Bento does not look inside `unit` — the host's `renderUnit` switches on the
 *  unit's kind / paneType (or on whatever shape the host wires in for P). */
export type RenderUnit<PaneState> = (
  paneId: PaneId,
  unit: PaneState,
) => ReactNode;

/** Optional render callback for per-leaf header actions (settings cogs, menus, etc.).
 *  Bento renders whatever React node the host returns into the header's right-hand
 *  area (between the label and the close button). Bento doesn't interpret the
 *  node — it's just mounted as-is — so hosts can put anything there. */
export type RenderUnitActions<PaneState> = (
  paneId: PaneId,
  unit: PaneState,
) => ReactNode;

export interface BentoLayoutProps<PaneState> {
  root: LayoutNode<PaneState>;
  /** The slot id this bento occupies in its parent container. Pass
   *  `ROOT_SLOT` (or any non-slot identifier) when the bento IS the
   *  root container. Used to emit `data-layout-container-slot` so the
   *  cross-container hit-tester can derive the leaf's container path. */
  containerSlot: string;
  renderUnit: RenderUnit<PaneState>;
  /** Optional: host-provided content to render in each leaf's header. */
  renderUnitActions?: RenderUnitActions<PaneState>;
  /** The CONTENT id of a leaf's occupant (`state.child.id`, the `^:` the pane box carries as
   *  `data-pane-id`). Bento declares it because it owns the `PaneState` shape. The header OFFERS its
   *  `center` region under this id, so an occupant (a tabs strip) that resolves the same id from the
   *  DOM contributes into ONE bar with the grip + actions. Absent occupant → undefined → no region,
   *  the title shows. See the pane-header contribution seam. */
  contentIdOf?: (state: PaneState) => PaneId | undefined;
  /** The active pane's `^:` (the HOST focus signal). A leaf rings when its OCCUPANT `^:` matches. */
  activePane: string | null;
  onFocusPane: (paneId: PaneId) => void;
  getPaneLabel: (paneId: PaneId) => string;
  /** The pane's projection TYPE name, so a target slot can decide whether it admits it. A prop for
   *  the same reason `getPaneLabel` is one: this layout is generic over its pane payload and cannot
   *  reach inside it. Optional, so a caller that has not supplied it simply reports no type. */
  /** Presentation only: the occupant declares the container kind in its descriptor closure. */
  isContainerPane?: (paneId: PaneId) => boolean;
  getPaneType?: (paneId: PaneId) => string | undefined;
  /** Optional: a pane shown as a PREVIEW (transient) — its label renders italic,
   *  the editor convention for a tab that the next open replaces in place. */
  isPreview?: (paneId: PaneId) => boolean;
  onResize: (branchId: string, newRatio: number) => void;
  /** Optional drag-boundary callbacks for sash resize. Hosts can use
   *  these to coalesce per-frame `onResize` calls into one logical
   *  gesture (e.g. one undo entry per drag). `commit` is true when
   *  the gesture ended via pointer up; false on pointer cancel. */
  onResizeStart?: (branchId: string) => void;
  onResizeEnd?: (branchId: string, commit: boolean) => void;
  onClosePane: (paneId: PaneId) => void;
  canClosePane?: (paneId: PaneId) => boolean;
  /** Whether the governing slot is fixed. Fixed positions have a lock glyph, no
   * drag handle, and no close button; their occupant cannot be displaced. */
  fixedFor?: (paneId: PaneId) => boolean;
  /** Fires when the user double-clicks a pane header. `leafRect` is the leaf container's
   *  current bounding rect, so the host can size / position derived
   *  UI (e.g. a floating-overlay pop-out) relative to the source.
   *  The callback does NOT fire when the click target is the close ✕
   *  or the actions slot — those have their own behaviour. */
  onPaneHeaderDoubleClick?: (paneId: PaneId, leafRect: DOMRect) => void;
  /** Show a large translucent knob centered on every sash, extending
   *  beyond the 5px line so touch users have a generous hit target.
   *  Stacking-context-safe: the knob inherits the sash's z-index. */
  bigSashKnobs?: boolean;
  /** Panes to paint with a candidate-highlight overlay. The host passes the
   *  leaf ids of a subtree it's about to act on (e.g. a node-refs promote
   *  target), so the user sees the subtree's extent. Overlay only — never
   *  intercepts pointer events. */
  highlightedPaneIds?: ReadonlySet<PaneId>;
}

/** The candidate-highlight overlay painted over a pane in {@link BentoLayoutProps.highlightedPaneIds}.
 *  Absolute, inert (no pointer events), and the shared WARN token (`--au-color-warn`) so it reads as
 *  attention, distinct from the accent focus/drop signal — unified with the app's palette. */
function HighlightOverlay() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        background: 'color-mix(in oklab, var(--au-color-warn, #e0aa46) 16%, transparent)',
        outline: '2px solid color-mix(in oklab, var(--au-color-warn, #e0aa46) 85%, transparent)',
        outlineOffset: -2,
        zIndex: 30,
      }}
    />
  );
}

/** Renders a bento layout tree. Drag emit only — every pointerdown
 *  defers actual `useLayoutDrag.start` until the threshold is crossed,
 *  so a click on a header doesn't register as a no-op drag. Resolution
 *  (drop targets, zones, dispatch) lives in `@arsumbris/container-kit`
 *  (the shared drag protocol) and the workspace router. */
export function BentoLayout<PaneState>(props: BentoLayoutProps<PaneState>) {
  const startDrag = useDragStart();

  return (
    <div
      {...{ [DATA_ATTR.containerSlot]: props.containerSlot ?? ROOT_SLOT }}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <BentoNode node={props.root} startDrag={startDrag} {...props} />
    </div>
  );
}

interface BentoNodeProps<PaneState> extends BentoLayoutProps<PaneState> {
  node: LayoutNode<PaneState>;
  startDrag: (e: ReactPointerEvent, spec: DragStartSpec) => void;
}

function BentoNode<PaneState>(props: BentoNodeProps<PaneState>) {
  const { node } = props;

  if (node.type === 'leaf') {
    return <LeafPane leaf={node} {...props} />;
  }

  const { direction, ratio, children, id: branchId } = node;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: direction,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: ratio, overflow: 'hidden', display: 'flex', minWidth: 0, minHeight: 0 }}>
        <BentoNode {...props} node={children[0]} />
      </div>
      <Sash
        direction={direction}
        branchId={branchId}
        onResize={props.onResize}
        onResizeStart={props.onResizeStart}
        onResizeEnd={props.onResizeEnd}
        bigKnob={props.bigSashKnobs ?? false}
      />
      <div style={{ flex: 1 - ratio, overflow: 'hidden', display: 'flex', minWidth: 0, minHeight: 0 }}>
        <BentoNode {...props} node={children[1]} />
      </div>
    </div>
  );
}

function LeafPane<PaneState>(
  props: BentoNodeProps<PaneState> & { leaf: LeafNode<PaneState> },
) {
  const {
    leaf,
    renderUnit,
    renderUnitActions,
    activePane,
    getPaneLabel,
    getPaneType,
    isPreview,
    onClosePane,
    onFocusPane,
    onPaneHeaderDoubleClick,
    startDrag,
    fixedFor,
    contentIdOf,
  } = props;
  const fixed = fixedFor?.(leaf.id) === true;
  // The occupant's content id (== its `data-pane-id`), so the header offers its `center` region under
  // the SAME id the occupant resolves from the DOM. Undefined for an empty pane → no region offered.
  const contentPaneId = contentIdOf?.(leaf.state);
  // The active-pane ring follows the HOST focus signal: this leaf rings when its OCCUPANT `^:`
  // (`contentPaneId`) is the active pane. An empty position (no occupant) never rings.
  const isFocused = contentPaneId != null && activePane === contentPaneId;
  const isHighlighted = props.highlightedPaneIds?.has(leaf.id) ?? false;
  const label = getPaneLabel(leaf.id);
  const actions = renderUnitActions?.(leaf.id, leaf.state);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Frame-inset while a drag is active (bento's drop-dialect presentation).
  const dragging = useLayoutDrag((s) => !!s.drag);

  return (
    <div
      ref={containerRef}
      data-bento-pane-id={leaf.id}
      {...{ [DATA_ATTR.droptargetShape]: 'slot-rect', [DATA_ATTR.containerKind]: 'bento', [DATA_ATTR.droptargetId]: leaf.id }}
      // Capture phase so focus fires before any inner handler can
      // stopPropagation — e.g. ViewportPane's canvas pointerdown
      // handlers (orbit / gizmo) would otherwise prevent focus from
      // landing when clicking inside the 3D canvas.
      onMouseDownCapture={() => onFocusPane(leaf.id)}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* The pane frame owns rounded clipping, border, and focus ring. Its nested header
          supplies the masthead. The outer div remains the drop-router and focus anchor. */}
      <au-pane-frame flush nested={props.isContainerPane?.(leaf.id)} focused={isFocused}>
        <PaneHeader
          label={label}
          paneId={contentPaneId}
          preview={isPreview?.(leaf.id)}
          container={props.isContainerPane?.(leaf.id)}
          focused={isFocused}
          moveLocked={fixed}
          removeLocked={fixed || props.canClosePane?.(leaf.id) === false}
          onClose={() => onClosePane(leaf.id)}
          onGrabPointerDown={(e) => {
            // `type` lets a TARGET slot decide whether it admits this pane.
            const type = getPaneType?.(leaf.id);
            startDrag(e, {
              containerKind: 'bento',
              localId: leaf.id,
              role: 'pane',
              label,
              ...(type === undefined ? {} : { type }),
            });
          }}
          onDoubleClick={
            onPaneHeaderDoubleClick
              ? () => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (rect) onPaneHeaderDoubleClick(leaf.id, rect);
                }
              : undefined
          }
          actions={actions}
        />
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', ...(dragging ? framedContentStyle : null) }}>
          {renderUnit(leaf.id, leaf.state)}
        </div>
      </au-pane-frame>
      {isHighlighted && <HighlightOverlay />}
    </div>
  );
}

function PaneHeader({
  label,
  container,
  paneId,
  preview,
  focused,
  moveLocked,
  removeLocked,
  onClose,
  onGrabPointerDown,
  onDoubleClick,
  actions,
}: {
  label: string;
  container?: boolean;
  /** The occupant's content id. The header OFFERS its `center` region under this id, so an occupant
   *  (a tabs strip) that resolves the same id from the DOM contributes into ONE bar. Absent → no region. */
  paneId?: PaneId;
  /** A PREVIEW (transient) pane — its label renders italic, like a preview tab. */
  preview?: boolean;
  /** The active pane — lifts the masthead rule one rung. */
  focused?: boolean;
  /** Fixed → a lock glyph instead of the drag handle. */
  moveLocked?: boolean;
  /** Remove-locked → no close ✕. */
  removeLocked?: boolean;
  onClose: () => void;
  onGrabPointerDown: (e: ReactPointerEvent) => void;
  onDoubleClick?: () => void;
  actions?: ReactNode;
}) {
  // THE REGIONED HEADER is the <au-pane-header> frame (leading | title | center | actions). bento owns
  // the CONTROLS: it SLOTS its own grip (or an <au-icon name="lock"> on a fixed pane) into `leading`
  // and its close ✕ into `actions`, and wires their handlers directly — the frame never threads them
  // (the pane-header contribution seam). The OFFERED `center` region is the default-slot div;
  // `claimed` flips true when a tabs strip portals in, and the title yields to it — ONE bar.
  const { ref: regionRef, claimed } = useOfferedHeaderRegion(paneId ?? null, 'center');
  return (
    <au-pane-header surface="panel" compact={container === true && !claimed} context={claimed ? label : undefined} focused={focused ?? false} onDoubleClick={onDoubleClick}>
      {/* leading: the drag grip (bento wires the drag on it), or a lock glyph on a fixed pane. */}
      {moveLocked ? (
        <au-icon slot="leading" name="lock" size="xs" label="Move-locked" />
      ) : (
        <au-grip-glyph slot="leading" label="Drag pane" onPointerDown={onGrabPointerDown} />
      )}
      {/* title: shown until an occupant claims the center region (then its strip fills the bar). The
          italic preview title gets trailing pad so its final glyph's overhang is not clipped. */}
      {!claimed && (
        <span
          slot="title"
          title={label}
          style={{
            fontStyle: preview ? 'italic' : undefined,
            paddingInlineEnd: preview ? '0.2em' : undefined,
          }}
        >
          {label}
        </span>
      )}
      {/* center (default slot): the OFFERED region — an occupant portals its header content here.
          Present but empty until claimed, so an ordinary projection leaves its title in place. */}
      <div ref={regionRef} style={{ display: 'flex', alignItems: 'center', minWidth: 0, height: '100%' }} />
      {/* actions: host-contributed cogs + the close ✕ — CONTROLS, never suppressed. */}
      <span
        slot="actions"
        onDoubleClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--au-space-1)' }}
      >
        {actions}
        {!removeLocked && (
          <au-close-button
            label="Close pane"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          />
        )}
      </span>
    </au-pane-header>
  );
}

function Sash({
  direction,
  branchId,
  onResize,
  onResizeStart,
  onResizeEnd,
  bigKnob,
}: {
  direction: 'row' | 'column';
  branchId: string;
  onResize: (branchId: string, newRatio: number) => void;
  onResizeStart?: (branchId: string) => void;
  onResizeEnd?: (branchId: string, commit: boolean) => void;
  bigKnob: boolean;
}) {
  const ref = useRef<HTMLElement>(null);

  // The pointer-capture lifecycle is shared (useResizeDrag); the PHYSICS — a pointer delta mapped to a
  // split ratio against the parent's rect — stays bento's, captured in `begin` on pointerdown.
  const begin = useCallback(
    (_e: ReactPointerEvent) => {
      const parent = ref.current?.parentElement;
      if (!parent) return null;
      const rect = parent.getBoundingClientRect();
      const start = direction === 'row' ? rect.left : rect.top;
      const size = direction === 'row' ? rect.width : rect.height;
      if (size <= 0) return null;
      onResizeStart?.(branchId);
      return {
        onMove: (ev: PointerEvent) => {
          const pos = direction === 'row' ? ev.clientX : ev.clientY;
          onResize(branchId, (pos - start) / size);
        },
        onEnd: (commit: boolean) => onResizeEnd?.(branchId, commit),
      };
    },
    [branchId, direction, onResize, onResizeStart, onResizeEnd],
  );
  const { onPointerDown, dragging } = useResizeDrag(begin);

  // `<au-splitter>` renders the sash LOOK (hairline + knob, accent on hover / drag) from tokens; bento
  // owns the resize physics above. A `row` layout splits side-by-side panes (a vertical col-resize seam);
  // a `column` layout stacks them (a horizontal row-resize seam). `bigKnob` picks the touch-sized slab.
  return (
    <au-splitter
      ref={ref}
      orientation={direction === 'row' ? 'vertical' : 'horizontal'}
      dragging={dragging}
      knobSize={bigKnob ? 'grab' : 'hairline'}
      onPointerDown={onPointerDown}
    />
  );
}
