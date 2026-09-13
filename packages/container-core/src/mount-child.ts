/**
 * Mount a child projection in a slot without a framework dependency.
 * attachContainer registers a vanilla container with the substrate; mountChild renders its children.
 */

import type { MountHost, PaneId, PublisherId } from '@arsumbris/au-host-sdk';
import { isPlaceholderRecord } from '@arsumbris/au-host-sdk';
import { closePane } from './registry.ts';

export interface MountChildOptions {
  /** The child projection instance id — its mount identity. */
  id: string
  /** The child's INITIAL config. Read once, at mount. */
  config?: unknown
  /**
   * The pane's STABLE id. Keys the child's per-pane RESTORABLE view-state (an editor's cursor and
   * scroll), so a child that moves between containers keeps it. Omitting it is legal and means the
   * child gets no per-pane view-state, which is a silent loss of scroll position rather than a
   * visible break — so pass it unless the slot genuinely has no stable identity.
   */
  paneId?: PaneId
  /** The child's `saveConfig` writeback (the child's config bubbling up to this container). */
  onChildConfigChange?: (next: unknown) => void
  /** Reports the mounted child's publisher id, so a container can map a fired intent's `from` back to its pane. */
  onMounted?: (publisher: PublisherId) => void
  /**
   * This call IS the flat portal host (`PaneHost`), so MOUNT the record for real even when the portal is
   * active — do not take the anchor branch (that is for a CONTAINER placing a child, which the portal
   * turns into an anchor). A container never sets this; only the portal layer does.
   */
  flatMount?: boolean
  /**
   * Render a mount failure into the slot. The default writes a `.au-child-mount-error` element
   * carrying the message. A failed child must leave something VISIBLE — a dead layout with no
   * explanation is the silence defect, and a container is exactly where it would hide.
   */
  renderError?: (slot: HTMLElement, message: string) => void
}

export interface ChildMount {
  /** Unmount the child and clear the slot. Idempotent, and safe to call before the mount resolves. */
  unmount: () => void
}

function defaultRenderError(slot: HTMLElement, message: string): void {
  const el = slot.ownerDocument.createElement('div');
  el.className = 'au-child-mount-error';
  // Tokens, not literals: the substrate must not hardcode a palette. `--au-color-danger` is a
  // registered `@property`, so the fallback is unreachable and present only for a host that has
  // not injected the token sheet at all.
  el.style.cssText = 'padding:8px;font:12px ui-monospace,monospace;color:var(--au-color-danger)';
  el.textContent = `mount failed: ${message}`;
  slot.appendChild(el);
}

/**
 * Mount `options.id` into `slot`, returning a handle that tears it down.
 *
 * The async race is the part worth getting right: `host.children.mount` is a promise, so a slot can
 * be torn down BEFORE it resolves. Unmounting then must still unmount the child that is about to
 * arrive, or the projection stays live with no slot — a leaked pane, and for a terminal a leaked
 * pty. `unmount()` is therefore safe at any point in the lifecycle.
 */
export function mountChild(host: MountHost, slot: HTMLElement, options: MountChildOptions): ChildMount {
  // PORTAL MODE: the child is mounted ONCE as a flat top-level `PaneHost` and portaled in, so this
  // container does NOT mount it — the slot becomes the ANCHOR the coordinator appends the live element
  // into. No placeholder / mount / error path here: the flat `PaneHost` (via its own `mountChild`) owns
  // all of that. Registering needs the stable `^:` (`paneId`); without one there is nothing to portal.
  if (!options.flatMount && host.children.portalActive?.() && options.paneId) {
    const paneId = options.paneId;
    // Anchor by SETTING the attribute; the single host-owned observer derives placement from it (the
    // live element nests inside). No imperative register — the same act, and cost, as the React
    // `usePaneAnchor`. See the DOM-authoritative-anchors spec.
    slot.setAttribute('data-pane-id', paneId);
    return {
      unmount: () => slot.removeAttribute('data-pane-id'),
    };
  }
  // The DUPLICATE degrade, vanilla twin of PaneProjection's: this position resolved to a synthetic
  // placeholder record (the same pool record is placed more than once; the first site mounts, this one
  // degrades). Render the diagnostic pane, mount nothing.
  if (isPlaceholderRecord(options.config)) {
    return renderPlaceholder(slot, options.config.collidedId, options.paneId);
  }
  // Tag the real mount's slot by its stable `^:`, so a duplicate placeholder elsewhere can frame it on
  // hover (the React path tags a wrapper div the same way).
  if (options.paneId) slot.setAttribute('data-pane-id', options.paneId);

  let handle: { unmount: () => void } | undefined;
  let cancelled = false;

  const arg = {
    id: options.id,
    config: options.config,
    ...(options.onChildConfigChange ? { onChildConfigChange: options.onChildConfigChange } : {}),
    // `nodeId` is a STAND-IN superset of the mount contract; the host reads it off the runtime
    // object. The cast suppresses the excess-property check, matching `PaneProjection`.
    ...(options.paneId === undefined ? {} : { nodeId: options.paneId }),
  } as Parameters<MountHost['children']['mount']>[1];

  const mountSite = slot.ownerDocument.createElement('div');
  mountSite.style.height = '100%';
  slot.appendChild(mountSite);
  void host.children
    .mount(mountSite, arg)
    .then((h) => {
      if (cancelled) {
        h.unmount();
        return;
      }
      handle = h;
      options.onMounted?.(h.publisher);
    })
    .catch((err: unknown) => {
      if (cancelled) return;
      const message = err instanceof Error ? err.message : String(err);
      (options.renderError ?? defaultRenderError)(mountSite, message);
    });

  return {
    unmount: () => {
      if (cancelled) return;
      cancelled = true;
      handle?.unmount();
      slot.removeAttribute('data-pane-id');
      mountSite.remove();
    },
  };
}

/**
 * The DUPLICATE-degrade diagnostic pane, vanilla twin of container-kit's `DuplicatePlaceholderPane`.
 * One pool record is referenced at more than one position in a single mounted tree — type-legal, so
 * the type system cannot bar it; the host mounts the FIRST site and renders this at every other. Never
 * empty, never a picker: it names the collision and the fix.
 *
 * On hover it frames, layout-inspector style, the real mounted pane (`data-pane-id={collidedId}`) and
 * every sibling placeholder for the same id (`data-placeholder-for`). A plain DOM outline — no shared
 * stylesheet, no other projection needed. Palette via tokens, never literals (the substrate rule).
 *
 * The FIX is a button: "Remove this placement" closes THIS position via `closePane` (the same floor the
 * container's ✕ uses), dropping the extra reference and re-deriving the tree, exactly like ✕.
 */
function renderPlaceholder(slot: HTMLElement, collidedId: string, paneId?: PaneId): ChildMount {
  const doc = slot.ownerDocument;
  const setHighlight = (on: boolean): void => {
    // A block-id is an engine-enforced safe charset (`[A-Za-z0-9_-]+`), so no CSS.escape is needed.
    const marks = [
      ...doc.querySelectorAll<HTMLElement>(`[data-pane-id="${collidedId}"]`),
      ...doc.querySelectorAll<HTMLElement>(`[data-placeholder-for="${collidedId}"]`),
    ];
    for (const el of marks) {
      el.style.outline = on ? '2px solid var(--au-color-warn)' : '';
      el.style.outlineOffset = on ? '-2px' : '';
    }
  };
  const el = doc.createElement('div');
  el.className = 'au-duplicate-placeholder';
  el.setAttribute('data-placeholder-for', collidedId);
  el.style.cssText =
    'height:100%;display:flex;flex-direction:column;gap:6px;justify-content:center;padding:16px;' +
    'box-sizing:border-box;font:12px ui-monospace,monospace;color:var(--au-color-warn);' +
    'background:var(--au-color-surface);cursor:default';
  const title = doc.createElement('div');
  title.style.cssText = 'font-weight:600';
  title.textContent = 'Duplicate view';
  const body = doc.createElement('div');
  body.style.cssText = 'color:var(--au-color-text);line-height:1.5';
  body.textContent = `This view (^${collidedId}) is placed more than once. A view can appear only once, so the first placement mounts and this one is a placeholder.`;
  const hint = doc.createElement('div');
  hint.style.cssText = 'color:var(--au-ink-3)';
  hint.textContent = 'Hover to see where it is.';
  el.append(title, body, hint);
  if (paneId) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Remove this placement';
    btn.style.cssText =
      'align-self:flex-start;margin-top:4px;padding:4px 10px;font:inherit;color:var(--au-color-warn);' +
      'background:transparent;border:1px solid var(--au-color-warn);border-radius:4px;cursor:pointer';
    btn.addEventListener('click', () => closePane(paneId));
    el.append(btn);
  }
  el.addEventListener('mouseenter', () => setHighlight(true));
  el.addEventListener('mouseleave', () => setHighlight(false));
  slot.appendChild(el);
  return {
    unmount: () => {
      setHighlight(false);
      el.remove();
    },
  };
}
