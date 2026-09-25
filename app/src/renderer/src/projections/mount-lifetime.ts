// The lifetime of ONE projection mount, and the overlay surfaces scoped to it.
//
// The overlay surfaces are per-window singletons, shared by every mount. A view that opens a menu, a
// popover, a preview card, a claimed layer, a confirm or a chooser and then goes away would otherwise
// leave that overlay above the composition, or a pending decision answering into a dead view. The host owns the
// mount's end, so the host closes what the mount opened: each mount's host hands out SCOPED surfaces
// that register every live handle here, and `end()` closes them. A projection owes no bookkeeping for
// its own unmount.
//
// Opening through a scoped surface after the mount ended is an async continuation of a dead view. It
// opens nothing, answers as a cancel, and is traced (`overlay` / `open-after-unmount`).

import { event, on } from '@arsumbris/au-host-sdk'
import type {
  ChooseRequest,
  ChooserSurface,
  ConfirmOutcome,
  ConfirmRequest,
  ConfirmSurface,
  ContextMenuSurface,
  MenuHandle,
  OverlayLayer,
  OverlaySite,
  PopoverHandle,
  PopoverSurface,
  PreviewSurface,
} from '@arsumbris/au-host-sdk'

export interface MountLifetime {
  readonly ended: boolean
  /** Aborts when the mount ends. */
  readonly signal: AbortSignal
  /** Register a release to run at the end. Returns an unregister, for a handle that closed on its own. */
  hold(release: () => void): () => void
  /** End the mount: run every held release, once. Idempotent. */
  end(): void
}

export function createMountLifetime(): MountLifetime {
  const held = new Set<() => void>()
  const abort = new AbortController()
  let ended = false
  return {
    get ended() {
      return ended
    },
    signal: abort.signal,
    hold(release) {
      held.add(release)
      return () => {
        held.delete(release)
      }
    },
    end() {
      if (ended) return
      ended = true
      abort.abort()
      for (const release of [...held]) {
        held.delete(release)
        try {
          release()
        } catch (err) {
          console.error('[host] releasing an overlay at unmount threw', err)
        }
      }
    },
  }
}

function openedAfterEnd(surface: string): void {
  if (on('overlay')) event('overlay', 'open-after-unmount', { surface })
}

/** Aborts when either the caller's own signal or the mount's does. */
function joinSignals(own: AbortSignal | undefined, mount: AbortSignal): AbortSignal {
  return own ? AbortSignal.any([own, mount]) : mount
}

export function scopeContextMenu(life: MountLifetime, inner: ContextMenuSurface): ContextMenuSurface {
  return {
    open(anchor, items): MenuHandle {
      if (life.ended) {
        openedAfterEnd('context-menu')
        return { close() {}, closed: Promise.resolve() }
      }
      const handle = inner.open(anchor, items)
      const drop = life.hold(() => handle.close())
      void handle.closed?.then(drop)
      return {
        close() {
          drop()
          handle.close()
        },
        ...(handle.closed ? { closed: handle.closed } : {}),
      }
    },
  }
}

export function scopePopover(life: MountLifetime, inner: PopoverSurface): PopoverSurface {
  return {
    open(anchor, fill, onDismiss): PopoverHandle {
      if (life.ended) {
        openedAfterEnd('popover')
        return { close() {} }
      }
      let drop = (): void => {}
      const handle = inner.open(anchor, fill, () => {
        drop()
        onDismiss?.()
      })
      drop = life.hold(() => handle.close())
      return {
        close() {
          drop()
          handle.close()
        },
      }
    },
  }
}

export function scopeOverlaySite(life: MountLifetime, inner: OverlaySite): OverlaySite {
  return {
    claim(options): OverlayLayer {
      if (life.ended) {
        openedAfterEnd('overlay-layer')
        // A detached element: whatever the dead view draws into it never reaches the document.
        return { el: document.createElement('div'), release() {} }
      }
      const layer = inner.claim(options)
      const drop = life.hold(() => layer.release())
      return {
        el: layer.el,
        release() {
          drop()
          layer.release()
        },
      }
    },
  }
}

export function scopeConfirm(life: MountLifetime, inner: ConfirmSurface): ConfirmSurface {
  return {
    confirm(request: ConfirmRequest): Promise<ConfirmOutcome> {
      if (life.ended) {
        openedAfterEnd('confirm')
        return Promise.resolve({ confirmed: false })
      }
      return inner.confirm({ ...request, signal: joinSignals(request.signal, life.signal) })
    },
  }
}

export function scopeChooser(life: MountLifetime, inner: ChooserSurface): ChooserSurface {
  return {
    choose(request: ChooseRequest): Promise<string | null> {
      if (life.ended) {
        openedAfterEnd('chooser')
        return Promise.resolve(null)
      }
      return inner.choose({ ...request, signal: joinSignals(request.signal, life.signal) })
    },
  }
}

export function scopePreview(life: MountLifetime, inner: PreviewSurface): PreviewSurface {
  // The preview shows one root stack per window at a time, so only this view's LATEST key can still be
  // its own; at the end it is hidden only if it is still the one showing, never another view's card.
  let lastKey: string | null = null
  let held = false
  return {
    show(key, rect, fill, linkResolver, onOpen) {
      if (life.ended) {
        openedAfterEnd('preview')
        return
      }
      lastKey = key
      if (!held) {
        held = true
        life.hold(() => {
          if (lastKey !== null && inner.isShowing(lastKey)) inner.hide()
        })
      }
      inner.show(key, rect, fill, linkResolver, onOpen)
    },
    hide: () => inner.hide(),
    isOver: (x, y) => inner.isOver(x, y),
    isShowing: (key) => inner.isShowing(key),
  }
}
