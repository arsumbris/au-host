// Per-window context-menu surface.

import type {
  ActionDescriptor,
  ContextMenuItem,
  ContextMenuSurface,
  MenuAnchor,
  MenuHandle,
  OverlaySite,
  SubmenuDescriptor,
} from '@arsumbris/au-host-sdk'
import { adoptHostSheet } from './adopt-sheet'

/** Viewport gap kept when a menu is flipped or clamped at an edge. */
const MARGIN = 4
/** Overlap between a submenu and its parent, so the diagonal mouse path stays inside one of them. */
const SUBMENU_OVERLAP = 4

/* The surface owns POSITION + SIZE + scrolling; the <au-menu> element owns the LOOK (elev-5 card + row
   chrome). Rows are <au-menu-item>
   (the wash highlight), separators <au-divider>, section labels a slotted [data-section]. */
const STYLE = `
.au-ctxmenu { pointer-events: auto; position: fixed; min-width: min(180px, calc(100vw - 8px)); max-width: min(320px, calc(100vw - 8px)); max-height: calc(100vh - 16px); overflow-y: auto; }
.au-ctxmenu__sep { margin: var(--au-space-1, 4px) 0; }
`

function isAction(item: ContextMenuItem): item is ActionDescriptor {
  return 'run' in item
}
function isSubmenu(item: ContextMenuItem): item is SubmenuDescriptor {
  return 'items' in item
}

/** One open menu in the chain: the root, or a submenu of the level above it. */
interface Level {
  el: HTMLElement
  /** Activatable rows in visual order, for arrow-key roving. Disabled rows are excluded. */
  rows: { el: HTMLElement; item: ActionDescriptor | SubmenuDescriptor }[]
  /** Teardown for the highlight the focused row armed, if any. */
  disarm: (() => void) | null
  releasePlacement?: () => void
}

/** The anchor as a box, so point and rect callers take one path. */
function anchorRect(anchor: MenuAnchor): DOMRect {
  return 'x' in anchor && !('width' in anchor)
    ? new DOMRect(anchor.x, anchor.y, 0, 0)
    : (anchor as DOMRect)
}

export function createContextMenuSurface(site: OverlaySite): ContextMenuSurface {
  const layer = site.claim({ level: 'dropdown' })
  adoptHostSheet(STYLE) // host chrome as a document-level constructable sheet (CSP-exempt); lifetime

  /** The live chain, root first. Empty when nothing is open. */
  let chain: Level[] = []
  /** Bumped on every `open`, so a superseded handle goes inert rather than closing its replacement. */
  let generation = 0
  let resolveClosed: (() => void) | undefined

  function closeFrom(depth: number): void {
    for (const level of chain.slice(depth)) {
      level.disarm?.()
      level.releasePlacement?.()
      level.el.remove()
    }
    chain = chain.slice(0, depth)
  }

  function closeAll(): void {
    closeFrom(0)
    document.removeEventListener('pointerdown', onOutside, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', closeAll)
    window.removeEventListener('resize', closeAll)
    const settle = resolveClosed
    resolveClosed = undefined
    settle?.()
  }

  function onOutside(e: PointerEvent): void {
    if (!chain.some((l) => l.el.contains(e.target as Node))) closeAll()
  }

  /** The level holding focus, or the deepest one when focus is elsewhere. */
  function activeLevel(): Level | undefined {
    const focused = chain.findIndex((l) => l.el.contains(document.activeElement))
    return chain[focused === -1 ? chain.length - 1 : focused]
  }

  function focusRow(level: Level, index: number): void {
    const n = level.rows.length
    if (n === 0) return
    const row = level.rows[((index % n) + n) % n]
    row.el.focus()
    // Arming is per-LEVEL, not global: moving within a submenu must not disarm the parent row's
    // highlight, which is what keeps a preview stable while you traverse into a child.
    level.disarm?.()
    level.disarm = (isAction(row.item) && row.item.enabled && row.item.preview?.()) || null
  }

  function indexOfFocus(level: Level): number {
    return level.rows.findIndex((r) => r.el === document.activeElement)
  }

  function onKey(e: KeyboardEvent): void {
    const level = activeLevel()
    if (!level) return
    const depth = chain.indexOf(level)
    const i = indexOfFocus(level)
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        // Esc closes ONE level, back to the parent — the convention everywhere, and it means a deep
        // traversal is recoverable without dismissing the whole menu and starting over.
        if (depth > 0) {
          closeFrom(depth)
          focusRow(chain[depth - 1], indexOfFocus(chain[depth - 1]))
        } else closeAll()
        return
      case 'ArrowDown':
        e.preventDefault()
        focusRow(level, i + 1)
        return
      case 'ArrowUp':
        e.preventDefault()
        focusRow(level, i - 1)
        return
      case 'ArrowRight': {
        const item = level.rows[i]?.item
        if (item && isSubmenu(item) && item.enabled) {
          e.preventDefault()
          openSubmenu(depth, level.rows[i]!.el, item)
        }
        return
      }
      case 'ArrowLeft':
        if (depth > 0) {
          e.preventDefault()
          closeFrom(depth)
          focusRow(chain[depth - 1], indexOfFocus(chain[depth - 1]))
        }
        return
      case 'Enter':
      case ' ': {
        const item = level.rows[i]?.item
        if (!item) return
        e.preventDefault()
        if (isSubmenu(item)) openSubmenu(depth, level.rows[i]!.el, item)
        else activate(item)
        return
      }
      default:
    }
  }

  function activate(action: ActionDescriptor): void {
    if (!action.enabled) return
    // Close BEFORE running. A row that opens a dialog or moves focus must not have to reason about
    // a menu still sitting over it, and `run` may unmount the projection that opened the menu.
    closeAll()
    action.run()
  }

  function openSubmenu(parentDepth: number, rowEl: HTMLElement, item: SubmenuDescriptor): void {
    // Replace any sibling branch already open at this depth.
    closeFrom(parentDepth + 1)
    const r = rowEl.getBoundingClientRect()
    const level = build(item.items, item.label)
    // Beside the parent row, overlapping slightly; `place` flips it to the row's left at an edge.
    trackPlacement(level, new DOMRect(r.right - SUBMENU_OVERLAP, r.top, 0, 0), r)
    chain.push(level)
    focusRow(level, 0)
  }

  /** Build one menu's DOM. Not yet placed or pushed onto the chain. */
  function build(items: ContextMenuItem[], label = 'Actions'): Level {
    // <au-menu> is the elev-5 look card; the surface adds position +
    // sizing via `.au-ctxmenu`. Rows are <au-menu-item> (structural cast — set-independent).
    const el = document.createElement('au-menu')
    el.setAttribute('role', 'menu')
    el.setAttribute('aria-label', label)
    el.className = 'au-ctxmenu'
    const level: Level = { el, rows: [], disarm: null }

    for (const item of items) {
      if ('separator' in item) {
        const sep = document.createElement('au-divider')
        sep.className = 'au-ctxmenu__sep'
        el.appendChild(sep)
        continue
      }
      if ('section' in item) {
        // A slotted section label — <au-menu> styles `::slotted([data-section])` (sentence-case, quiet).
        const head = document.createElement('div')
        head.setAttribute('data-section', '')
        head.textContent = item.section
        el.appendChild(head)
        continue
      }

      const row = document.createElement('au-menu-item') as HTMLElement & {
        label: string
        icon: string
        submenu: boolean
        disabled: boolean
        destructive: boolean
      }
      row.label = item.label
      if ((isAction(item) || isSubmenu(item)) && item.icon) row.icon = item.icon // leading glyph, when the row declares one
      row.dataset.id = item.id
      if (isSubmenu(item)) row.submenu = true // au-menu-item draws the trailing chevron
      if (isAction(item) && item.destructive) row.destructive = true

      if (!item.enabled) {
        row.disabled = true
        // A disabled row EXPLAINS itself. The contract asks for `reason` precisely so a dead row is
        // never a silent refusal, and the title is where that reaches the human today (au-* native title).
        if (item.reason) row.title = item.reason
      } else {
        row.tabIndex = -1 // programmatically focusable for the roving-focus model
        level.rows.push({ el: row, item })
        row.addEventListener('au-activate', () => {
          if (isSubmenu(item)) openSubmenu(chain.findIndex((l) => l.el === el), row, item)
          else activate(item)
        })
        // Hover opens a submenu and roves focus, matching every native menu.
        row.addEventListener('mouseenter', () => {
          const depth = chain.findIndex((l) => l.el === el)
          if (depth === -1) return
          focusRow(chain[depth]!, chain[depth]!.rows.findIndex((r) => r.el === row))
          if (isSubmenu(item)) openSubmenu(depth, row, item)
          else closeFrom(depth + 1)
        })
      }
      el.appendChild(row)
    }
    layer.el.appendChild(el)
    return level
  }

  /**
   * Place `el` at `at`, flipping rather than clamping when it would leave the viewport.
   *
   * `avoid` is the parent row's box for a submenu: flipping LEFT must clear the parent menu, not
   * merely fit on screen, or the child lands on top of what spawned it.
   */
  function place(el: HTMLElement, at: DOMRect, avoid?: DOMRect): void {
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = at.left
    if (left + w > vw - MARGIN) {
      left = avoid ? avoid.left - w + SUBMENU_OVERLAP : at.left - w
      left = Math.max(MARGIN, left)
    }
    let top = at.top
    if (top + h > vh - MARGIN) top = Math.max(MARGIN, vh - h - MARGIN)
    el.style.left = `${Math.max(MARGIN, left)}px`
    el.style.top = `${Math.max(MARGIN, top)}px`
  }

  /** Custom-element rows finish rendering after insertion. Refit when their real size arrives. */
  function trackPlacement(level: Level, at: DOMRect, avoid?: DOMRect): void {
    const fit = () => { if (level.el.isConnected) place(level.el, at, avoid) }
    const observer = new ResizeObserver(fit)
    observer.observe(level.el)
    level.releasePlacement = () => observer.disconnect()
    fit()
  }

  return {
    open(anchor, items): MenuHandle {
      closeAll()
      const mine = ++generation
      const level = build(items)
      trackPlacement(level, anchorRect(anchor))
      chain.push(level)
      const closed = new Promise<void>((resolve) => { resolveClosed = resolve })
      // KEYBOARD IS LIVE IMMEDIATELY. Only the POINTERDOWN listener is deferred, and the asymmetry
      // is the point: the one-tick guard exists so the opening right-click's own pointerdown does
      // not dismiss the menu it just summoned. A keydown has no such problem, and deferring it
      // would silently eat the first keystroke from anyone who types faster than a macrotask.
      document.addEventListener('keydown', onKey, true)
      window.addEventListener('blur', closeAll)
      window.addEventListener('resize', closeAll)
      setTimeout(() => {
        if (generation !== mine || chain.length === 0) return
        document.addEventListener('pointerdown', onOutside, true)
      })
      return {
        closed,
        close(): void {
          // INERT once superseded: a stale handle must not close the menu that replaced it. This is
          // the whole reason `open` returns a handle instead of the surface carrying `close()`.
          if (generation === mine) closeAll()
        },
      }
    },
  }
}

// Per-window singleton, like the other host surfaces. Built over the overlay SITE rather than over
// `document.body` — this surface names neither the body nor a z-index.
let singleton: ContextMenuSurface | null = null
export function getContextMenuSurface(site: OverlaySite): ContextMenuSurface {
  return (singleton ??= createContextMenuSurface(site))
}
