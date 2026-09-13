/**
 * Mount a child projection into a DOM slot through host.children.mount. Wire saveConfig writeback,
 * report its publisher id and use the stable nodeId for per-pane view-state. Render a placeholder
 * when mounting fails. This wrapper supplies React containers with shared child-mount behavior.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChildHandle, MountHost, PaneId, PublisherId } from '@arsumbris/au-host-sdk';
import { isPlaceholderRecord, recordMountType } from '@arsumbris/au-host-sdk';
import { closePane } from '@arsumbris/container-core';
import { usePaneAnchor } from './pane-portal.tsx';

/**
 * `config` is the child's INITIAL state at mount; the effect deliberately does
 * NOT depend on it, so a child saving its config doesn't remount itself (that
 * would loop). A full composition switch remounts via the kernel root instead.
 */
export function PaneProjection({
  host,
  paneId,
  id,
  config,
  onChildConfig,
  onMounted,
}: {
  host: MountHost;
  /** The pane's STABLE id — keys the child's per-pane restorable view-state. */
  paneId: PaneId;
  /** The child projection instance id (its mount identity). */
  id: string;
  config?: unknown;
  onChildConfig: (next: unknown) => void;
  /** Reports the mounted child's publisher id, so a container can map a fired
   *  intent's `from` node back to its pane. */
  onMounted?: (publisher: PublisherId) => void;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // PORTAL MODE: when the host runs the portal layer, this projection does NOT mount the child. The
  // child is mounted ONCE as a flat top-level `PaneHost` (so a re-parent never unmounts it); here we
  // render only an empty ANCHOR the coordinator portals the live element into. `usePaneAnchor` is a
  // hook, so it is called unconditionally; the mount effect below early-returns in portal mode.
  const portal = host.children.portalActive?.() ?? false;
  const anchorRef = usePaneAnchor(paneId);
  // A DUPLICATE-degrade placeholder: the host resolved this pane's `^:` to a synthetic placeholder
  // record (the record is referenced more than once; the first site mounts, this one degrades). Set in
  // the effect from the resolved record; when set, we render the diagnostic pane and DO NOT mount.
  const [placeholder, setPlaceholder] = useState<{ collidedId: string } | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const onChildConfigRef = useRef(onChildConfig);
  onChildConfigRef.current = onChildConfig;
  const onMountedRef = useRef(onMounted);
  onMountedRef.current = onMounted;

  useEffect(() => {
    // AUTO-POOL (BOTH modes): if this child is not yet a pool record but we hold its inline config,
    // register it under its stable id, so it becomes a first-class pool record (addressable by a
    // re-parent, never a dangling ref on reload). Covers a freshly CREATED pane (the picker mints local
    // content) and a legacy inline container. UNDER THE PORTAL this is essential: a container renders
    // only an anchor for its child, so without pooling here a picker-created pane never becomes a pool
    // record and `PanePortalLayer` never mounts a `PaneHost` for it — the pane opens EMPTY. The parent
    // already references this same id, so the ref stays consistent regardless of mount order.
    // Call UNCONDITIONALLY (not only when absent): `ensureRecord` upserts when this pane id was REUSED
    // for different content — a preview tab swapping files renders a fresh instance (the `type:file`
    // key), and in portal mode there is no unmount cleanup to remove the old record, so without this the
    // flat `PaneHost` keeps mounting the stale file. A same-file record (reload / re-anchor) is left as
    // the authoritative pooled copy by `ensureRecord` itself.
    if (host.children.pool && configRef.current != null) {
      host.children.pool.ensureRecord(paneId, configRef.current);
    }
    if (portal) return; // portal mode mounts the child elsewhere (the flat PaneHost); this is just an anchor.
    const slot = ref.current;
    if (!slot) return;
    let handle: ChildHandle | undefined;
    let cancelled = false;
    setError(null);
    // THE COMPOSITION POOL, preferred: resolve this child's record FRESH by its `^:` id, so a
    // structural remount mounts the CURRENT record and can never resurrect a stale cached copy (the
    // re-parent duplication class). The host wires the child's `saveConfig` to the pool, so no
    // `onChildConfigChange` relay is passed. Falls back to the parent-supplied `id`/`config`/`onChildConfigChange`
    // for a host WITHOUT a pool (a detached window), using the parent relay.
    // `nodeId` is the pane's STABLE `^:`, keying its per-pane view-state; the cast suppresses the
    // excess-property check for the STAND-IN superset fields.
    const pooled = host.children.pool?.resolveRecord(paneId);
    // The DUPLICATE degrade: a placeholder record mounts NOTHING — it renders the diagnostic pane
    // (below) instead. Detected here, where the record is already resolved, so no extra resolve.
    if (isPlaceholderRecord(pooled)) {
      setPlaceholder({ collidedId: pooled.collidedId });
      return;
    }
    setPlaceholder(null);
    // `recordMountType`, not `pooled.type` directly: a MIXIN-typed record has `type` as an ARRAY, which
    // a `typeof === 'string'` guard would reject → the container never mounts (blank).
    const pooledMountType = recordMountType(pooled);
    const mountArg = (
      pooledMountType
        ? { id: pooledMountType, config: pooled, nodeId: paneId }
        : {
            id,
            config: configRef.current,
            onChildConfigChange: (next: unknown) => onChildConfigRef.current(next),
            nodeId: paneId,
          }
    ) as unknown as Parameters<typeof host.children.mount>[1];
    const mountSite = document.createElement('div');
    mountSite.style.height = '100%';
    slot.appendChild(mountSite);
    host.children
      .mount(mountSite, mountArg)
      .then((h) => {
        if (cancelled) h.unmount();
        else {
          handle = h;
          onMountedRef.current?.(h.publisher);
        }
      })
      .catch((err) => {
        // graceful failure: a bad child renders a placeholder, never a dead layout.
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      handle?.unmount();
      mountSite.remove();
    };
  }, [host, id, paneId]);

  if (portal) {
    // The ANCHOR: an empty box the portal coordinator appends the pane's live host element into. Keeps
    // `data-pane-id` so a duplicate placeholder's hover-frame still finds the mounted pane by its `^:`.
    // The flat `PaneHost` owns the mount (and renders the duplicate placeholder itself), so this holds
    // no mount effect and no error state — it is purely where the live element is portaled.
    return <div data-pane-id={paneId} ref={anchorRef} style={{ height: '100%' }} />;
  }

  if (placeholder) {
    return <DuplicatePlaceholderPane collidedId={placeholder.collidedId} paneId={paneId} />;
  }

  return (
    // `data-pane-id` tags this pane's box by its stable `^:`, so a duplicate placeholder can frame the
    // real mount (and its sibling placeholders) on hover, layout-inspector style, with a plain DOM query.
    // `tabindex=-1` + the mousedown handler make the pane focusable so DOM focus (the host's single focus
    // source) reflects every interaction, matching the portal content host.
    <div
      data-pane-id={paneId}
      tabIndex={-1}
      onMouseDown={(e) => {
        const box = e.currentTarget
        queueMicrotask(() => {
          if (!box.contains(document.activeElement)) box.focus({ preventScroll: true })
        })
      }}
      style={{ height: '100%', overflow: 'auto', outline: 'none' }}
    >
      {error && (
        <div style={{ color: '#fb817c', padding: 8, font: '12px ui-monospace, monospace' }}>
          mount failed: {error}
        </div>
      )}
      <div ref={ref} style={{ height: '100%' }} />
    </div>
  );
}

/**
 * The DUPLICATE-degrade diagnostic pane. One pool record is referenced at more than one position in a
 * single mounted tree — type-legal, so the type system cannot bar it; the host mounts the FIRST site
 * and renders THIS at every other. Never empty, never a picker: it names the collision and the fix.
 *
 * On hover it frames — layout-inspector style — the real mounted pane (the box tagged
 * `data-pane-id={collidedId}`) and every sibling placeholder for the same id (`data-placeholder-for`),
 * so the author sees exactly which view is doubled. A plain DOM outline, self-contained: no shared
 * stylesheet, no dependency on any other projection being mounted, no cross-projection coordination.
 *
 * The FIX it names is a button: "Remove this placement" closes THIS position via `closePane` — the same
 * floor the container's ✕ uses — which drops the extra reference (the canonical placement keeps the
 * record) and re-derives the tree, so the placeholder vanishes and the slot collapses, exactly like ✕.
 */
function DuplicatePlaceholderPane({ collidedId, paneId }: { collidedId: string; paneId: PaneId }): ReactNode {
  const setHighlight = (on: boolean): void => {
    // A block-id is an engine-enforced safe charset (`[A-Za-z0-9_-]+`), so no CSS.escape is needed.
    const marks = [
      ...document.querySelectorAll<HTMLElement>(`[data-pane-id="${collidedId}"]`),
      ...document.querySelectorAll<HTMLElement>(`[data-placeholder-for="${collidedId}"]`),
    ];
    for (const el of marks) {
      el.style.outline = on ? '2px solid var(--au-color-warn)' : '';
      el.style.outlineOffset = on ? '-2px' : '';
    }
  };
  useEffect(() => () => setHighlight(false), []); // clear on unmount, never leak an outline
  return (
    // Palette via tokens, never literals (the substrate rule); mirrors container-core's vanilla twin.
    <div
      data-placeholder-for={collidedId}
      onMouseEnter={() => setHighlight(true)}
      onMouseLeave={() => setHighlight(false)}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        justifyContent: 'center',
        padding: 16,
        font: '12px ui-monospace, monospace',
        color: 'var(--au-color-warn)',
        background: 'var(--au-color-surface)',
        boxSizing: 'border-box',
        cursor: 'default',
      }}
    >
      <div style={{ fontWeight: 600 }}>Duplicate view</div>
      <div style={{ color: 'var(--au-color-text)', lineHeight: 1.5 }}>
        This view (<code>^{collidedId}</code>) is placed more than once. A view can appear only once, so
        the first placement mounts and this one is a placeholder.
      </div>
      <div style={{ color: 'var(--au-ink-3)' }}>Hover to see where it is.</div>
      <button
        type="button"
        onClick={() => closePane(paneId)}
        style={{
          alignSelf: 'flex-start',
          marginTop: 4,
          padding: '4px 10px',
          font: 'inherit',
          color: 'var(--au-color-warn)',
          background: 'transparent',
          border: '1px solid var(--au-color-warn)',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        Remove this placement
      </button>
    </div>
  );
}
