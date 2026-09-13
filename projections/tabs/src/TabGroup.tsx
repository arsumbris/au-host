/**
 * The `tabs` container's tab strip. COMPOSES <au-tab-bar> (the design tab strip — cells, scroll, scrim,
 * roving-nav, middle-click, all in its shadow) instead of hand-rolling cells. TabGroup owns only the
 * CONTAINER concerns the bar deliberately leaves to it:
 *  - the `gap` DROPTARGET wrapper (light DOM) the drop router resolves;
 *  - the header PORTAL (the strip shares ONE bar with the pane's grip + actions via the contribution seam);
 *  - the body `slot-rect` droptarget;
 *  - driving the DRAG PROTOCOL from the bar's contract: the cell's `au-tab-drag-start` event (gesture
 *    origin) + `<au-tab-bar>.tabCellRects()` (cell geometry, read by the drop dialect + insertion overlay).
 * That contract is the general answer to "a shadow-DOM component participating in the DOM-authoritative
 * drag protocol" — tabs is its first customer.
 *
 * Lives HERE (projections/tabs), not container-kit: only the tabs projection renders a tab strip.
 *
 */

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DATA_ATTR, useLayoutDrag } from '@arsumbris/container-kit';
import '@arsumbris/au-component-catalog/react'; // JSX types for <au-tab-bar>

/** One tab in the strip: its stable id, its display label, and whether it is the
 *  single ephemeral preview tab (rendered italic). */
export interface TabItem {
  id: string;
  label: string;
  icon?: string;
  isPreview?: boolean;
  group?: boolean;
  groupLabel?: string;
  /** The tab's slot is FIXED: no drag handle and no close control (one flag — move and remove are one
   *  under the container-slot model). */
  fixed?: boolean;
  /** The tab's occupant has unsaved changes (published on the `dirty` view-state slice). Renders the
   *  dirty dot on the cell (the close control yields to it). Discovery, distinct from the close-guard. */
  dirty?: boolean;
}

/** The subset of <au-tab-bar>'s element contract TabGroup drives imperatively: the tab model + active id
 *  (set as PROPERTIES, the settled pattern for array/complex values on a custom element), and the geometry
 *  read `tabCellRects` the drop dialect + insertion overlay use in place of light-DOM `[data-tab-id]`. */
interface TabBarEl extends HTMLElement {
  tabs: { id: string; label: string; icon?: string; group?: boolean; isPreview?: boolean; moveLocked?: boolean; removeLocked?: boolean; dirty?: boolean }[];
  activeId: string | null;
  draggingId: string | null;
  /** Show the trailing "+" add button in the track; the bar emits `au-add` when it is pressed. */
  add: boolean;
  tabCellRects(): { id: string; left: number; width: number }[];
}

export interface TabGroupProps {
  hideStrip?: boolean;
  tabs: TabItem[];
  activeIndex: number;
  /** The owning container's kind (e.g. `tabs`) + this group's droptarget slot id. Tags the emitted drop
   *  targets so the shared hit-tester routes drops to the owning container. */
  containerKind: string;
  slotId: string;
  onActivate: (index: number) => void;
  onClose: (id: string) => void;
  /** Render the ACTIVE tab's content (the mounted child projection). Only the active tab is rendered. */
  renderContent: (tab: TabItem, index: number) => ReactNode;
  /** Optional per-strip chrome (the active tab's swap control) — placed in the bar's trailing actions cluster. */
  renderTabActions?: (tab: TabItem) => ReactNode;
  /** A drag began on a tab's grip (from the bar's `au-tab-drag-start`). The container starts its drag
   *  protocol: `sourceEl` resolves the slot rules, `point` is the pointer origin. */
  onTabDragStart?: (tabId: string, point: { x: number; y: number }, sourceEl: HTMLElement) => void;
  /** Optional: double-click a tab (e.g. promote a preview). */
  onTabDoubleClick?: (tab: TabItem) => void;
  /** Optional: press the trailing "+" add button. When provided, the bar renders the button and calls
   *  this on press (the container adds a new tab). Absent → no add button. */
  onAdd?: () => void;
  /** The id of the tab currently being dragged (from the container's drag store), lifted in the bar. */
  draggingTabId?: string | null;
  /** Whether the active content is focused (drives the standalone focus outline). */
  focused?: boolean;
  /** The enclosing pane header's offered `center` region (the contribution seam), or `null`. When present
   *  the strip is PORTALED into it (ONE bar with the pane grip + actions) and drops its own surface; when
   *  `null` it renders inline above the body (the standalone / root fallback). */
  headerTarget?: HTMLElement | null;
}

/** The tab id under an event's composedPath — the cell's `data-tab-id`, set by <au-tab-bar> in its shadow.
 *  `composedPath()` pierces the shadow boundaries, so it resolves the pressed / clicked cell. */
function tabIdFromPath(e: Event): string | null {
  for (const t of e.composedPath()) {
    const id = (t as HTMLElement).dataset?.['tabId'];
    if (id) return id;
  }
  return null;
}

export function TabGroup({
  tabs,
  activeIndex,
  containerKind,
  slotId,
  onActivate,
  onClose,
  renderContent,
  renderTabActions,
  onTabDragStart,
  onTabDoubleClick,
  onAdd,
  draggingTabId = null,
  focused = false,
  headerTarget = null,
  hideStrip = false,
}: TabGroupProps): ReactNode {
  const dragging = useLayoutDrag((s) => s.drag !== null);
  const activeIdx = Math.max(0, Math.min(activeIndex, tabs.length - 1));
  const activeTab = tabs[activeIdx];
  const activeActions = activeTab && renderTabActions ? renderTabActions(activeTab) : null;
  const contributed = !!headerTarget;
  const barRef = useRef<TabBarEl | null>(null);

  // Feed the bar its model as PROPERTIES (array/complex values do not round-trip as attributes). A fixed
  // tab is both move- and remove-locked (no grip, no close).
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    bar.tabs = tabs.map((t) => ({
      id: t.id,
      label: t.label,
      group: t.group,
      icon: t.icon,
      isPreview: t.isPreview,
      moveLocked: t.fixed,
      removeLocked: t.fixed,
      dirty: t.dirty,
    }));
    bar.activeId = activeTab?.id ?? null;
    bar.draggingId = draggingTabId;
    // Render the "+" only when the container gave us an add handler.
    bar.add = onAdd != null;
  }, [tabs, activeTab, draggingTabId, onAdd]);

  // Wire the bar's CUSTOM events (React does not bind them). Select / close carry the id in `detail`;
  // drag-start + double-click resolve the cell via composedPath.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const onSelect = (e: Event): void => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id != null) onActivate(tabs.findIndex((t) => t.id === id));
    };
    const onCloseEvt = (e: Event): void => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id != null) onClose(id);
    };
    const onDragStart = (e: Event): void => {
      const id = tabIdFromPath(e);
      const detail = (e as CustomEvent<{ clientX: number; clientY: number }>).detail;
      if (id && detail && onTabDragStart) onTabDragStart(id, { x: detail.clientX, y: detail.clientY }, bar);
    };
    const onDbl = (e: Event): void => {
      const id = tabIdFromPath(e);
      const t = id ? tabs.find((x) => x.id === id) : undefined;
      if (t && onTabDoubleClick) onTabDoubleClick(t);
    };
    const onAddEvt = (): void => onAdd?.();
    bar.addEventListener('au-select', onSelect);
    bar.addEventListener('au-close', onCloseEvt);
    bar.addEventListener('au-tab-drag-start', onDragStart);
    bar.addEventListener('dblclick', onDbl);
    bar.addEventListener('au-add', onAddEvt);
    return () => {
      bar.removeEventListener('au-select', onSelect);
      bar.removeEventListener('au-close', onCloseEvt);
      bar.removeEventListener('au-tab-drag-start', onDragStart);
      bar.removeEventListener('dblclick', onDbl);
      bar.removeEventListener('au-add', onAddEvt);
    };
  }, [tabs, onActivate, onClose, onTabDragStart, onTabDoubleClick, onAdd]);

  // The gap DROPTARGET wrapper (light DOM). The bar's cells live in its shadow, so the drop dialect + the
  // insertion overlay read `bar.tabCellRects()` rather than light-DOM `[data-tab-id]`. When contributed the
  // bar goes SURFACE-FREE (the pane header owns the bar) and fills the offered region.
  const strip = (
    <div
      {...{
        [DATA_ATTR.droptargetShape]: 'gap',
        [DATA_ATTR.containerKind]: containerKind,
        [DATA_ATTR.droptargetId]: slotId,
        // When CONTRIBUTED the strip is portaled into the enclosing pane header, a subtree with no
        // slot boundary of tabs' own — so mark this wrapper as tabs' `data-layout-container-slot`, else
        // the drop dialect's identity check (`gap.closest(slot) === mySlotEl`) walks past the region to
        // the pane owner (bento) and the reorder gap is rejected. Standalone, the outer root is the
        // boundary, so this wrapper must NOT carry it (it would split the strip off the outer root).
        ...(contributed ? { [DATA_ATTR.containerSlot]: slotId } : {}),
      }}
      style={{ display: 'flex', flexShrink: 0, minWidth: 0, ...(contributed ? { flex: 1 } : null) }}
    >
      <au-tab-bar
        ref={barRef}
        style={{
          flex: 1,
          minWidth: 0,
          ...(contributed ? { background: 'transparent', boxShadow: 'none' } : null),
        }}
      >
        {/* The active tab's per-tab actions (swap / wrap / unwrap its CONTENT). Shown whether standalone
            OR contributed: when contributed the enclosing pane header carries the OCCUPANT-level actions
            (which swap / wrap the WHOLE tabs), a DIFFERENT level from these (which act on the active tab's
            content), so they are not duplicates — and a single-tab tabs' unwrap exists only here. */}
        {activeActions ? <span slot="actions">{activeActions}</span> : null}
      </au-tab-bar>
    </div>
  );

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        isolation: 'isolate',
        borderRadius: contributed ? undefined : 'var(--au-radius-panel)',
      }}
    >
      {!contributed && focused && <div aria-hidden="true" style={{position:'absolute',inset:0,borderRadius:'inherit',pointerEvents:'none',zIndex:'var(--au-z-raised)',boxShadow:'inset 0 0 0 1px var(--au-pane-focus-color, var(--au-line-3))'}} />}
      {!hideStrip && (headerTarget ? createPortal(strip, headerTarget) : strip)}
      <div
        {...(activeTab
          ? {
              [DATA_ATTR.droptargetShape]: 'slot-rect',
              [DATA_ATTR.containerKind]: containerKind,
              [DATA_ATTR.droptargetId]: activeTab.id,
            }
          : {})}
        role="tabpanel"
        aria-label={activeTab?.label}
        style={{
          flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column',
          // Expose this group's own receiver around a nested container. Establish
          // geometry once at drag start, without moving hit areas during aiming.
          ...(dragging && activeTab?.group ? {
            padding: 'var(--au-space-5)',
            borderRadius: 'var(--au-radius-md)',
            background: 'color-mix(in oklab, var(--au-ink-1) 3%, transparent)',
            boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--au-ink-1) 16%, transparent)',
          } : null),
        }}
      >
        {activeTab && (activeTab.group
          ? <au-pane-frame flush nested key={activeTab.id}>
              <au-pane-header compact><span slot="title">{activeTab.groupLabel}</span></au-pane-header>
              {renderContent(activeTab, activeIdx)}
            </au-pane-frame>
          : renderContent(activeTab, activeIdx))}
      </div>
    </div>
  );
}
