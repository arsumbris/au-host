// The host's PREVIEW SURFACE: a per-window stack of ephemeral overlay cards (a mount-site).

// The host owns the CHROME (positioning, viewport-clamp, theming, dismissal); a caller supplies
// the CONTENT via a `fill`. The surface is content-agnostic (no engine dep). Mount sites are
// plural and the host owns each site's chrome —


// NESTING + SAFETY CONES (technique studied from au-mind-map, adapted world→screen space):
// - cards form a depth-indexed STACK. A wikilink inside a card (tagged `data-preview-path` by the
//   content) cmd+hovered spawns a CHILD card at depth+1, without closing the parent.
// - a frame's SAFE ZONE is the convex HULL of its anchor-box + its (padded) card-box — a "cone"
//   bridging them. On every pointer move we keep the DEEPEST frame whose cone holds the pointer
//   and drop everything deeper. So moving diagonally from a parent toward a child keeps the chain.
// - cmd GATES the spawn timer only; PROXIMITY (the cones) owns dismissal. Escape / click-outside
//   collapse the whole stack. Exposed as `host.preview` — a v5 contract capability.

// `PreviewSurface` / `FillFn` / `LinkResolver` are the v5 contract types, owned by
// au-host-sdk. This file is the
// host-side IMPLEMENTATION behind `MountHost.preview`.
import type { FillFn, LinkResolver, PreviewSurface } from '@arsumbris/au-host-sdk'

import { getOverlaySite } from './overlay-site'
import { adoptHostSheet } from './adopt-sheet'

export type { FillFn, LinkResolver, PreviewSurface }

const MARGIN = 8
const CONE_PAD = 16 // grow each card box before the cone hull, a forgiving safe zone
const DWELL_MS = 240

// ─── geometry: convex hull + point-in-polygon (screen coords, y-down) ────────
interface Pt {
  x: number
  y: number
}
function corners(r: DOMRect): Pt[] {
  return [
    { x: r.left, y: r.top },
    { x: r.right, y: r.top },
    { x: r.right, y: r.bottom },
    { x: r.left, y: r.bottom },
  ]
}
function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}
/** Andrew's monotone chain. Returns the hull CCW; fine for the point-in-polygon test below. */
function convexHull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y)
  if (p.length < 3) return p
  const lower: Pt[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Pt[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}
function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
/** Rounded visual hull only; pointer retention continues to use the full safety polygon. */
function roundedHull(points: Pt[], radius: number): string {
  const toward = (a: Pt, b: Pt): Pt => {
    const distance = Math.hypot(b.x - a.x, b.y - a.y)
    const t = distance ? Math.min(radius / distance, 0.5) : 0
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  }
  return points.map((p, i) => {
    const before = toward(p, points[(i + points.length - 1) % points.length])
    const after = toward(p, points[(i + 1) % points.length])
    return `${i ? 'L' : 'M'} ${before.x} ${before.y} Q ${p.x} ${p.y} ${after.x} ${after.y}`
  }).join(' ') + ' Z'
}

function padded(r: DOMRect, p: number): DOMRect {
  return new DOMRect(r.left - p, r.top - p, r.width + 2 * p, r.height + 2 * p)
}

export const STYLE = `
/* Cards restore pointer events within the non-interactive overlay layer; cones remain non-interactive.
   Layer-local z-indexes order each cone below its card, interleaved by depth in renderCones. */
.au-pcard { pointer-events: auto; position: fixed; z-index: 60; box-sizing: border-box; width: 460px; max-width: calc(100vw - 16px);
  display: flex; flex-direction: column; overflow: hidden; color: var(--au-ink-2);
  font: var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans); }
.au-pcard-scroll { min-height: 0; }
.au-pcard-scroll-content { padding-block: var(--au-space-1); }
.au-pcard-header { flex: none; padding: var(--au-space-3);
  border-bottom: 1px solid var(--au-line-1); font-weight: var(--au-w-medium); display: flex; gap: var(--au-space-2); align-items: baseline; flex-wrap: wrap; }
.au-pcard-header:has(.au-pcard-open) { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
.au-pcard-header:has(.au-pcard-open) .au-pcard-types { grid-column: 1; }
.au-pcard-open { grid-column: 2; grid-row: 1; cursor: pointer; }
.au-pcard-name { color: var(--au-ink-1); overflow-wrap: anywhere; }
.au-pcard-types { color: var(--au-ink-3); font-weight: var(--au-w-body); font-size: var(--au-t-2xs); }
.au-pcard-section { padding: var(--au-space-2) var(--au-space-3); border-bottom: 1px solid var(--au-line-1); }
.au-pcard-section:last-child { border-bottom: none; }
.au-pcard-label { font-size: var(--au-t-xs); color: var(--au-ink-3); margin-bottom: var(--au-space-1); }
.au-pcard .au-syntax-comment { color: var(--au-code-comment); font-style: italic; }
.au-pcard .au-syntax-string { color: var(--au-code-string); }
.au-pcard .au-syntax-value { color: var(--au-code-number); }
.au-pcard .au-syntax-function { color: var(--au-code-function); }
.au-pcard .au-syntax-keyword { color: var(--au-code-keyword); }
.au-pcard .au-syntax-type { color: var(--au-code-type); }
.au-pcard .au-syntax-name { color: var(--au-code-property); }
.au-pcard .au-syntax-variable { color: var(--au-code-variable); }
.au-pcard .au-syntax-punctuation { color: var(--au-code-punctuation); }
.au-pcard-pre { font-family: var(--au-font-mono); margin: 0; white-space: pre-wrap; word-break: break-word; line-height: var(--au-lh-base); }
.au-pcard-sub { color: var(--au-ink-3); margin-top: var(--au-space-1); }
.au-pcard-doc { color: var(--au-ink-2); margin-top: var(--au-space-1); white-space: pre-wrap; }
.au-pcard-code { display: grid; grid-template-columns: auto minmax(0, 1fr); font-family: var(--au-font-mono); column-gap: var(--au-space-2); line-height: var(--au-lh-base); }
.au-pcard-gutter { text-align: right; color: var(--au-ink-4); user-select: none; -webkit-user-select: none; white-space: pre; }
.au-pcard-codeline { white-space: pre-wrap; overflow-wrap: anywhere; }
.au-pcard-codeline.target { background: color-mix(in srgb, var(--au-color-accent) 16%, transparent); border-radius: var(--au-radius-sm); }
.au-pcard-gutter.target { color: var(--au-color-accent); }
.au-pcard-muted { color: var(--au-ink-4); padding: var(--au-space-2) var(--au-space-2-5); }
.au-pcard-error { color: var(--au-color-danger); padding: var(--au-space-2) var(--au-space-2-5); }
/* Inline error line INSIDE a section, which already pads — so this one must not. */
.au-pcard-error-text { color: var(--au-color-danger); }
/* Find-all-references preview list rows. */
.au-pcard-ref { display: flex; gap: var(--au-space-2); align-items: baseline; padding: var(--au-space-0-5) 0; cursor: pointer; }
.au-pcard-ref:hover { text-decoration: underline; }
.au-pcard-ref-name { color: var(--au-color-accent); }
.au-pcard-ref-slot { color: var(--au-ink-4); font-size: var(--au-t-2xs); }
/* A quiet projection connects source and card. The forgiving hit geometry is independent
   of this visual envelope, so softening the presentation never narrows pointer transfer. */
.au-pcard-cones { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 59;
  animation: au-pcard-projection-in var(--au-m-fast, 160ms) var(--au-e-soft, cubic-bezier(0.22, 1, 0.36, 1)); }
.au-pcard-cone { stroke: color-mix(in srgb, var(--au-color-accent) 14%, transparent); stroke-width: 1; stroke-linejoin: round; }
.au-pcard-cone-source { fill: color-mix(in srgb, var(--au-color-accent) 3%, transparent);
  stroke: color-mix(in srgb, var(--au-color-accent) 22%, transparent); stroke-width: 1; }
.au-pcard-cone-start { stop-color: var(--au-color-accent); stop-opacity: .09; }
.au-pcard-cone-end { stop-color: var(--au-color-accent); stop-opacity: .015; }
@keyframes au-pcard-projection-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .au-pcard-cones { animation: none; } }
/* the header doubles as the DRAG handle for moving a card around the stack */
.au-pcard-header { cursor: move; }
/* a resolved wikilink inside a card is a NESTED-preview affordance under cmd */
/* Preview links use the text cursor; holding the modifier enables the pointer affordance below. */
.au-pcard [data-preview-path] { cursor: text; }
.au-pcard.mod [data-preview-path] { cursor: pointer; text-decoration-thickness: 2px; }
.au-pcard .au-tok-key { color: var(--au-color-accent); }
.au-pcard .au-tok-heading { color: var(--au-color-text); font-weight: var(--au-w-strong); }
.au-pcard .au-tok-comment { color: var(--au-color-muted); font-style: italic; }
.au-pcard .au-tok-val-string { color: var(--au-code-string); }
.au-pcard .au-tok-val-number { color: var(--au-code-number); }
.au-pcard .au-tok-val-bool { color: var(--au-code-type); }
.au-pcard .au-tok-val-ref { color: var(--au-color-accent); }
.au-pcard .au-tok-builtin { color: var(--au-code-type); font-style: italic; }
.au-pcard .au-tok-wikilink { color: var(--au-link-internal); text-decoration: none; }
.au-pcard .au-tok-broken-wikilink { color: var(--au-color-danger); }
.au-pcard .au-tok-blockid { color: var(--au-color-anchor); }
`

interface Frame {
  key: string
  anchor: DOMRect // the box this frame was spawned from (the cone's base)
  el: HTMLElement
  cone: SVGSVGElement // this frame's own cone overlay, z-indexed just below its card
  gen: number
  resize: ResizeObserver
}

const SVGNS = 'http://www.w3.org/2000/svg'

function createPreviewSurface(root: HTMLElement): PreviewSurface {
  adoptHostSheet(STYLE) // host chrome as a document-level constructable sheet (CSP-exempt); lifetime

  const frames: Frame[] = []
  let resolver: LinkResolver | null = null
  let opener: ((path: string) => void) | null = null
  let gen = 0
  let modHeld = false
  let dragging = false
  let dwellTimer: ReturnType<typeof setTimeout> | undefined
  let dwellSpan: Element | null = null
  let listening = false

  // INTERLEAVED z-order: cone₀ < card₀ < cone₁ < card₁ < … so each child's cone sits ABOVE its
  // parent card (visible over it) but below its own card. Each frame owns a cone SVG; we set both
  // the card's and the cone's z-index by depth here. Screen coords map 1:1 to SVG user-space.
  function renderCones(): void {
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]
      f.cone.style.zIndex = `${60 + 2 * i}`
      f.el.style.zIndex = `${61 + 2 * i}`
      const card = f.el.getBoundingClientRect()
      const gradientId = `au-preview-projection-${f.gen}`
      const defs = document.createElementNS(SVGNS, 'defs')
      const gradient = document.createElementNS(SVGNS, 'linearGradient')
      gradient.id = gradientId
      gradient.setAttribute('gradientUnits', 'userSpaceOnUse')
      gradient.setAttribute('x1', `${f.anchor.x + f.anchor.width / 2}`)
      gradient.setAttribute('y1', `${f.anchor.y + f.anchor.height / 2}`)
      gradient.setAttribute('x2', `${card.x + card.width / 2}`)
      gradient.setAttribute('y2', `${card.y + card.height / 2}`)
      for (const [offset, className] of [['0%', 'au-pcard-cone-start'], ['100%', 'au-pcard-cone-end']]) {
        const stop = document.createElementNS(SVGNS, 'stop')
        stop.setAttribute('offset', offset)
        stop.setAttribute('class', className)
        gradient.append(stop)
      }
      defs.append(gradient)
      const projection = document.createElementNS(SVGNS, 'path')
      projection.setAttribute('d', roundedHull(convexHull([...corners(f.anchor), ...corners(padded(card, 4))]), 6))
      projection.setAttribute('class', 'au-pcard-cone')
      projection.setAttribute('fill', `url(#${gradientId})`)
      const source = document.createElementNS(SVGNS, 'rect')
      source.setAttribute('x', `${f.anchor.left}`)
      source.setAttribute('y', `${f.anchor.top}`)
      source.setAttribute('width', `${f.anchor.width}`)
      source.setAttribute('height', `${f.anchor.height}`)
      source.setAttribute('rx', '6')
      source.setAttribute('class', 'au-pcard-cone-source')
      f.cone.replaceChildren(defs, projection, source)
    }
  }

  // Drag a card around by its header (the whole header is the handle). The cone tracks the live
  // rect for free (coneOf reads getBoundingClientRect), and the keep-alive is SUSPENDED while a
  // drag is in flight so moving outside the cone doesn't tear the stack down mid-drag.
  function attachDrag(el: HTMLElement): void {
    el.addEventListener('pointerdown', (e) => {
      const target = e.target as Element | null
      if (e.button !== 0 || !target?.closest('.au-pcard-header')) return
      if (target.closest('au-button, button, a, input, select, textarea, [role=button]')) return
      e.preventDefault()
      dragging = true
      const r = el.getBoundingClientRect()
      const baseLeft = r.left
      const baseTop = r.top
      const startX = e.clientX
      const startY = e.clientY
      el.style.bottom = '' // switch to top-anchored for the drag
      el.style.top = `${baseTop}px`
      el.setPointerCapture(e.pointerId)
      const move = (ev: PointerEvent): void => {
        el.style.left = `${baseLeft + (ev.clientX - startX)}px`
        el.style.top = `${baseTop + (ev.clientY - startY)}px`
        renderCones()
      }
      const up = (ev: PointerEvent): void => {
        dragging = false
        try {
          el.releasePointerCapture(ev.pointerId)
        } catch {
          /* already released */
        }
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
    })
  }

  function clearDwell(): void {
    if (dwellTimer) clearTimeout(dwellTimer)
    dwellTimer = undefined
    dwellSpan = null
  }

  // Prefer reading space beside the source; fall back vertically in narrow windows.
  // Bound the preview height so its shared scroll area carries long content.
  function clamp(card: HTMLElement, anchor: DOMRect, _depth: number): void {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const gap = 8
    const width = Math.min(card.offsetWidth || 460, vw - 2 * MARGIN)
    const heightLimit = Math.min(480, vh * 0.6, vh - 2 * MARGIN)
    const right = vw - anchor.right - MARGIN - gap
    const left = anchor.left - MARGIN - gap
    const beside = right >= width || left >= width
    const below = vh - anchor.bottom - MARGIN - gap
    const above = anchor.top - MARGIN - gap
    const downward = below >= Math.min(240, heightLimit) || below >= above
    const available = beside ? heightLimit : Math.max(0, downward ? below : above)
    card.style.maxHeight = `${Math.min(heightLimit, available)}px`
    const height = Math.min(card.offsetHeight, heightLimit, available)
    const x = beside
      ? (right >= width ? anchor.right + gap : anchor.left - width - gap)
      : Math.max(MARGIN, Math.min(anchor.left, vw - width - MARGIN))
    const y = beside
      ? Math.max(MARGIN, Math.min(anchor.top, vh - height - MARGIN))
      : (downward ? anchor.bottom + gap : anchor.top - gap - height)
    card.style.left = `${x}px`
    card.style.top = `${y}px`
    card.style.bottom = ''
    // Point the shared scale/fade toward its actual source, including above/left flips.
    const originX = Math.max(0, Math.min(width, anchor.x + anchor.width / 2 - x))
    const originY = Math.max(0, Math.min(height, anchor.y + anchor.height / 2 - y))
    card.style.transformOrigin = `${originX}px ${originY}px`
  }

  function truncate(count: number): void {
    while (frames.length > count) {
      const f = frames.pop()!
      f.resize.disconnect()
      f.el.remove()
      f.cone.remove()
    }
    if (frames.length === 0) stopListening()
    renderCones()
  }

  function showAt(depth: number, key: string, anchor: DOMRect, fill: FillFn): void {
    truncate(depth)
    const myGen = ++gen
    const el = document.createElement('au-hovercard')
    el.className = 'au-pcard' + (modHeld ? ' mod' : '')
    root.appendChild(el)
    attachDrag(el)
    const cone = document.createElementNS(SVGNS, 'svg')
    cone.setAttribute('class', 'au-pcard-cones')
    cone.setAttribute('aria-hidden', 'true')
    root.appendChild(cone)
    // Shared scroll-area layout can settle after fill resolves; keep the projection attached.
    const resize = new ResizeObserver(() => renderCones())
    const frame: Frame = { key, anchor, el, cone, gen: myGen, resize }
    frames.push(frame)
    resize.observe(el)
    clamp(el, anchor, depth)
    renderCones()
    // `isCurrent` goes false once this frame is dropped (truncated) or superseded at its depth.
    const isCurrent = (): boolean => frame.gen === myGen && frames.includes(frame)
    void Promise.resolve(fill(el, isCurrent)).then(() => {
      if (isCurrent()) {
        const header = el.querySelector(':scope > .au-pcard-header')
        const path = el.dataset.previewFile
        const open = opener
        if (header && path && open) {
          const action = document.createElement('au-button')
          action.className = 'au-pcard-open'
          action.setAttribute('variant', 'ghost')
          action.setAttribute('size', 'sm')
          action.textContent = 'Open ↗'
          action.title = `Open ${path.replace(/\\/g, '/').split('/').pop() || 'file'}`
          action.addEventListener('click', (event) => {
            event.stopPropagation()
            if (!isCurrent()) return
            hide()
            open(path)
          })
          header.append(action)
        }
        const scroll = document.createElement('au-scroll-area')
        scroll.setAttribute('axis', 'y')
        scroll.className = 'au-pcard-scroll'
        const content = document.createElement('div')
        content.className = 'au-pcard-scroll-content'
        for (const node of Array.from(el.childNodes)) if (node !== header) content.append(node)
        scroll.append(content)
        el.append(scroll)
        clamp(el, anchor, depth) // re-clamp once content settled (size changed)
        renderCones()
      }
    })
    startListening()
  }

  function coneOf(f: Frame): Pt[] {
    return convexHull([...corners(f.anchor), ...corners(padded(f.el.getBoundingClientRect(), CONE_PAD))])
  }

  function onMove(e: PointerEvent): void {
    if (frames.length === 0) return
    if (dragging) return renderCones() // a card is being dragged: keep cones synced, suspend dismissal
    setMod(e.metaKey || e.ctrlKey) // read the modifier off the move (keydown may post-date the show)
    const pt = { x: e.clientX, y: e.clientY }
    // Keep-alive: the deepest frame whose cone still holds the pointer; drop everything deeper.
    let deepest = -1
    for (let i = 0; i < frames.length; i++) if (pointInPolygon(pt, coneOf(frames[i]))) deepest = i
    truncate(deepest + 1)
    if (frames.length === 0) return
    // Child-spawn: cmd + a `data-preview-path` link inside some card → dwell → spawn at depth+1.
    if (!modHeld || !resolver) return clearDwell()
    const hit = (document.elementFromPoint(pt.x, pt.y) as Element | null)?.closest('[data-preview-path]') as HTMLElement | null
    const path = hit?.dataset.previewPath
    if (!hit || !path) return clearDwell()
    const depth = frames.findIndex((f) => f.el.contains(hit))
    if (depth < 0) return clearDwell()
    const childKey = `nest:${depth + 1}:${path}`
    if (frames[depth + 1]?.key === childKey) return // already showing this child
    if (dwellSpan === hit) return // already dwelling on this link
    clearDwell()
    dwellSpan = hit
    dwellTimer = setTimeout(() => {
      // Reset dwell before spawning so the same link can spawn another preview after the child closes.
      // The child-key guard prevents a duplicate while that preview remains open.
      dwellTimer = undefined
      dwellSpan = null
      if (resolver) showAt(depth + 1, childKey, hit.getBoundingClientRect(), resolver(path))
    }, DWELL_MS)
  }

  // Re-clamp every live card to the viewport (cards are position:fixed, clamped once at spawn —
  // a window resize would otherwise drift them off-screen). Anchors are spawn-time rects, so this
  // is best-effort on resize; cone geometry is refreshed too.
  function reclampAll(): void {
    for (let i = 0; i < frames.length; i++) clamp(frames[i].el, frames[i].anchor, i)
    renderCones()
  }
  const onResize = (): void => reclampAll()

  function setMod(held: boolean): void {
    modHeld = held
    for (const f of frames) f.el.classList.toggle('mod', held)
    if (!held) clearDwell()
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') return hide()
    if (e.key === 'Meta' || e.key === 'Control') setMod(e.metaKey || e.ctrlKey)
  }
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Meta' || e.key === 'Control') setMod(e.metaKey || e.ctrlKey)
  }
  const onDown = (e: PointerEvent): void => {
    const inCard = (e.target as Element | null)?.closest?.('.au-pcard')
    // A press outside every card collapses the stack.
    if (!inCard) return hide()
    // cmd/ctrl + press a `data-preview-path` link inside a card → OPEN it (the cmd-pointer cursor
    // promised this). Handled on POINTERDOWN, not click: while cmd is held the stack mutates under
    // the pointer (nested-preview spawns), so a `click` (which needs pointerdown+up on the same
    // element) often never fires. hide() here removes the card synchronously, so any content-row
    // `click` handler can't double-open. The consumer supplied the open via show()'s `onOpen`.
    if ((e.metaKey || e.ctrlKey) && opener) {
      const hit = (e.target as Element | null)?.closest?.('[data-preview-path]') as HTMLElement | null
      const path = hit?.dataset.previewPath
      if (path) {
        e.preventDefault()
        e.stopPropagation()
        const open = opener
        open(path)
        hide()
      }
    }
  }

  function startListening(): void {
    if (listening) return
    listening = true
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('resize', onResize)
  }
  function stopListening(): void {
    dragging = false // reset even if a drag was interrupted (e.g. Escape mid-drag)
    if (!listening) return
    listening = false
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerdown', onDown, true)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('resize', onResize)
    clearDwell()
  }

  function hide(): void {
    truncate(0)
    resolver = null
    opener = null
    clearDwell()
  }

  return {
    show(key, rect, fill, linkResolver, onOpen) {
      // A fresh root: the same key already at the root is a no-op (hover jitter guard).
      if (frames.length >= 1 && frames[0].key === key) return
      resolver = linkResolver ?? null
      opener = onOpen ?? null
      showAt(0, key, rect, fill)
    },
    hide,
    isShowing: (key) => frames.length > 0 && frames[0].key === key,
    isOver(x, y) {
      for (const f of frames) {
        const r = f.el.getBoundingClientRect()
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true
      }
      return false
    },
  }
}

// One preview surface per renderer window. It claims the overlay site's `popover` band, above
// confirm's `overlay` band, so a preview can appear above an open confirmation dialog.
let singleton: PreviewSurface | null = null
export function getPreviewSurface(): PreviewSurface {
  return (singleton ??= createPreviewSurface(getOverlaySite().claim({ level: 'popover' }).el))
}
