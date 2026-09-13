/** Presentation geometry only. The focal layout and its canonical coordinates remain unchanged. */
export interface Point { x: number; y: number }
export interface Camera { tx: number; ty: number; scale: number }
export interface LabelNode extends Point { id: string; label: string; r: number; depth: number; cluster?: number }
export interface LabelBox { id: string; text: string; x: number; y: number; width: number; height: number }

export function fitCamera(nodes: { cx: number; cy: number }[], width: number, height: number): Camera {
  const extentX = Math.max(1, ...nodes.map(n => Math.abs(n.cx)))
  const extentY = Math.max(1, ...nodes.map(n => Math.abs(n.cy)))
  return { tx: 0, ty: 0, scale: Math.max(0.1, Math.min(1, (width / 2 - 28) / extentX, (height / 2 - 28) / extentY)) }
}

export function markerRadius(radius: number, nodeScale: number, cameraScale: number, depth = 0): number {
  const cap = 6 + 3 * Math.max(0, 1 - depth)
  return Math.max(3, Math.min(cap, radius * cameraScale) * nodeScale / 0.5)
}

export function clippedEdge(a: Point & { r: number }, b: Point & { r: number }): [Point, Point] | null {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy)
  if (d <= a.r + b.r + 4) return null
  return [{ x: a.x + dx / d * (a.r + 2), y: a.y + dy / d * (a.r + 2) },
    { x: b.x - dx / d * (b.r + 2), y: b.y - dy / d * (b.r + 2) }]
}

/** Place readable labels without covering markers or other labels; all markers stay available. */
export function placeLabels(nodes: LabelNode[], width: number, height: number, depth: number, measure: (text: string) => number): LabelBox[] {
  const result: LabelBox[] = []
  const intersects = (a: LabelBox, b: { x: number; y: number; width: number; height: number }): boolean =>
    a.x < b.x + b.width + 3 && a.x + a.width + 3 > b.x && a.y < b.y + b.height + 3 && a.y + a.height + 3 > b.y
  for (const n of [...nodes].filter(n => !n.cluster && n.depth <= depth).sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id))) {
    if (n.x < 8 || n.x > width - 8 || n.y < 8 || n.y > height - 12) continue
    const h = 14
    const candidates = [
      { side: 'below', limit: width - 24 },
      { side: 'above', limit: width - 24 },
      { side: 'right', limit: width - n.x - n.r - 20 },
      { side: 'left', limit: n.x - n.r - 20 },
    ]
    for (const candidate of candidates) {
      const max = Math.min(148, candidate.limit)
      if (max < 32) continue
      let text = n.label
      if (measure(text) > max) {
        while (text.length && measure(text + '…') > max) text = text.slice(0, -1)
        text += '…'
      }
      const w = measure(text)
      const x = candidate.side === 'right' ? n.x + n.r + 10 : candidate.side === 'left' ? n.x - n.r - w - 10 : n.x - w / 2
      const y = candidate.side === 'above' ? n.y - n.r - h - 10 : candidate.side === 'below' ? n.y + n.r + 10 : n.y - h / 2
      const box = { id: n.id, text, x: Math.max(10, Math.min(width - 10 - w, x)), y, width: w, height: h }
      if (box.y < 8 || box.y + h > height - 8) continue
      if (result.some(other => intersects(box, other))) continue
      if (nodes.some(other => intersects(box, { x: other.x - other.r - 2, y: other.y - other.r - 2, width: other.r * 2 + 4, height: other.r * 2 + 4 }))) continue
      result.push(box)
      break
    }
  }
  return result
}
