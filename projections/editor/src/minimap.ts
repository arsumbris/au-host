// MINIMAP for the editor projection.
//
// A document minimap gutter: a scaled silhouette of the whole document down the right edge, with
// a viewport indicator you can click / drag to scroll. Canvas-rendered (one cheap fill per line), so
// it costs nothing near the text layout. OFF by default — the editor only installs this extension
// when its config's `minimap` field is true (an additive optional type-def field; see index.ts).
//
// Tokens only: line silhouette in `--au-ink-3`, the viewport window a faint `--au-ink-1` fill with an
// `--au-color-accent` edge. NO left-edge accent bar, NO opaque pane fill — the gutter is transparent
// and the silhouette floats over the card surface, matching the editor's own transparent chrome.

import { type Extension, type Text } from '@codemirror/state'
import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from '@codemirror/view'

const MINIMAP_W = 64 // css px, the reserved gutter width
const LINE_PX = 3 // css px per document line at full scale (shrinks to fit a tall document)
const PAD_X = 4 // horizontal inset inside the gutter
// Above this the per-line silhouette is skipped (uniform bars) — keeps a pathological file cheap.
const MAX_SILHOUETTE_BYTES = 2_000_000

/** Resolve a `--au-*` token to a concrete color for the canvas (canvas can't read CSS vars). */
function token(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

class MinimapPlugin implements PluginValue {
  private readonly wrap: HTMLDivElement
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly ro: ResizeObserver
  private readonly onScroll: () => void
  private raf = 0
  private dragging = false
  // The rendered silhouette, kept across frames — see `silhouetteCanvas`.
  private silhouette: HTMLCanvasElement | null = null
  private silhouetteDoc: Text | null = null
  private silhouetteKey = ''

  constructor(private readonly view: EditorView) {
    this.wrap = document.createElement('div')
    this.wrap.className = 'au-minimap'
    this.wrap.dataset.auPressHold = 'off' // a press here scrolls the minimap, never an ancestor drag
    this.canvas = document.createElement('canvas')
    this.wrap.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    view.dom.appendChild(this.wrap)

    // Pointer → scroll. A click jumps; a drag scrubs. Positions map minimap-y back to a doc fraction.
    this.wrap.addEventListener('pointerdown', (e) => {
      this.dragging = true
      this.wrap.setPointerCapture(e.pointerId)
      this.scrollToPointer(e)
    })
    this.wrap.addEventListener('pointermove', (e) => {
      if (this.dragging) this.scrollToPointer(e)
    })
    const stop = (e: PointerEvent): void => {
      this.dragging = false
      try {
        this.wrap.releasePointerCapture(e.pointerId)
      } catch {
        /* pointer already released */
      }
    }
    this.wrap.addEventListener('pointerup', stop)
    this.wrap.addEventListener('pointercancel', stop)

    // The minimap does not scroll with content, so redraw the viewport window on every editor scroll.
    this.onScroll = () => this.schedule()
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })
    this.ro = new ResizeObserver(() => this.schedule())
    this.ro.observe(this.wrap)
    this.schedule()
  }

  update(u: ViewUpdate): void {
    if (u.docChanged || u.viewportChanged || u.geometryChanged) this.schedule()
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
    this.wrap.remove()
  }

  private schedule(): void {
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(() => this.draw())
  }

  /** Total silhouette height in css px (whole doc at LINE_PX, shrunk to fit the gutter if taller). */
  private contentHeight(lineCount: number, gutterH: number): { lineH: number; total: number } {
    const lineH = Math.min(LINE_PX, gutterH / Math.max(1, lineCount))
    return { lineH, total: lineCount * lineH }
  }

  private scrollToPointer(e: PointerEvent): void {
    const rect = this.wrap.getBoundingClientRect()
    const y = e.clientY - rect.top
    const scroller = this.view.scrollDOM
    const lineCount = this.view.state.doc.lines
    const { total } = this.contentHeight(lineCount, rect.height)
    const frac = total > 0 ? Math.max(0, Math.min(1, y / total)) : 0
    const max = scroller.scrollHeight - scroller.clientHeight
    // Center the clicked position in the viewport rather than pinning it to the top.
    scroller.scrollTop = Math.max(0, Math.min(max, frac * scroller.scrollHeight - scroller.clientHeight / 2))
  }

  private draw(): void {
    const rect = this.wrap.getBoundingClientRect()
    const cssW = rect.width
    const cssH = rect.height
    if (cssW < 1 || cssH < 1) return
    const dpr = window.devicePixelRatio || 1
    if (this.canvas.width !== Math.round(cssW * dpr) || this.canvas.height !== Math.round(cssH * dpr)) {
      this.canvas.width = Math.round(cssW * dpr)
      this.canvas.height = Math.round(cssH * dpr)
    }
    const ctx = this.ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const doc = this.view.state.doc
    const { total } = this.contentHeight(doc.lines, cssH)
    const inkStyle = token(this.view.dom, '--au-ink-3', 'rgba(160,156,146,0.7)')
    ctx.drawImage(this.silhouetteCanvas(doc, cssW, cssH, dpr, inkStyle), 0, 0, cssW, cssH)

    // Viewport window: the currently-visible slice, mapped from the scroller into minimap space.
    const scroller = this.view.scrollDOM
    const sh = scroller.scrollHeight
    if (sh > 0) {
      const y = (scroller.scrollTop / sh) * total
      const h = Math.max(6, (scroller.clientHeight / sh) * total)
      ctx.fillStyle = token(this.view.dom, '--au-ink-1', 'rgba(245,243,238,1)')
      ctx.globalAlpha = 0.1
      ctx.fillRect(0, y, cssW, h)
      ctx.globalAlpha = 0.9
      ctx.strokeStyle = token(this.view.dom, '--au-color-accent', 'rgba(245,243,238,1)')
      ctx.lineWidth = 1
      ctx.strokeRect(0.5, y + 0.5, cssW - 1, h - 1)
    }
    ctx.globalAlpha = 1
  }

  /** Cache the document silhouette by document, geometry, and ink. A scroll only
   * changes the viewport rectangle and blits the cached image, keeping the O(doc)
   * rendering pass out of the animation frame loop. */
  private silhouetteCanvas(doc: Text, cssW: number, cssH: number, dpr: number, ink: string): HTMLCanvasElement {
    const key = `${cssW}x${cssH}@${dpr}|${ink}`
    if (this.silhouette && this.silhouetteDoc === doc && this.silhouetteKey === key) return this.silhouette
    const canvas = this.silhouette ?? document.createElement('canvas')
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const { lineH, total } = this.contentHeight(doc.lines, cssH)
    const drawW = cssW - PAD_X * 2
    ctx.fillStyle = ink
    ctx.globalAlpha = 0.55
    if (doc.length <= MAX_SILHOUETTE_BYTES) {
      // Per-line silhouette: a bar inset by the leading indent, its width scaled by trimmed length.
      // `iterLines` walks the rope in place — no whole-document string, no per-line array.
      const barH = Math.max(1, lineH - 0.5)
      let i = 0
      for (const line of doc.iterLines()) {
        const trimmed = line.replace(/\s+$/, '')
        if (trimmed.length > 0) {
          const indent = line.length - line.trimStart().length
          const len = trimmed.length - indent
          // Map a nominal 80-col line to the full width; clamp so long lines don't overflow.
          const x0 = PAD_X + Math.min(drawW * 0.5, (indent / 80) * drawW)
          const w = Math.max(1, Math.min(cssW - PAD_X - x0, (len / 80) * drawW))
          ctx.fillRect(x0, i * lineH, w, barH)
        }
        i++
      }
    } else {
      // Very large document: a uniform column so the viewport window is still usable.
      ctx.globalAlpha = 0.25
      ctx.fillRect(PAD_X, 0, drawW, total)
    }
    ctx.globalAlpha = 1

    this.silhouette = canvas
    this.silhouetteDoc = doc
    this.silhouetteKey = key
    return canvas
  }
}

// Reserve the gutter on the right and float the minimap over the editor's right edge. `.cm-scroller`
// gets right margin so wrapped text never runs under the minimap; the minimap itself is absolute on
// the editor root so it stays put while the content scrolls.
const minimapTheme = EditorView.theme({
  '.cm-scroller': { marginRight: `${MINIMAP_W}px` },
  '.au-minimap': {
    position: 'absolute',
    top: '0',
    right: '0',
    bottom: '0',
    width: `${MINIMAP_W}px`,
    cursor: 'pointer',
    background: 'transparent',
    borderLeft: '1px solid var(--au-line-2, var(--au-color-border))',
    zIndex: '1',
  },
  '.au-minimap canvas': { display: 'block', width: '100%', height: '100%' },
})

/** The minimap extension: the canvas plugin + the gutter-reserving theme. Install ONLY when enabled. */
export function minimap(): Extension {
  return [ViewPlugin.fromClass(MinimapPlugin), minimapTheme]
}
