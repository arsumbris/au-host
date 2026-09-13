export interface LabelRect { x: number; y: number; width: number; height: number }

/** Greedy placement in priority order, leaving a small gutter between labels. */
export function reserveLabel(occupied: LabelRect[], rect: LabelRect): boolean {
  if (occupied.some((r) => rect.x < r.x + r.width && rect.x + rect.width > r.x && rect.y < r.y + r.height && rect.y + rect.height > r.y)) return false
  occupied.push(rect)
  return true
}

/** Pick the nearest center within a screen-space target, independent of zoom. */
export function pickNode<T extends { x?: number; y?: number }>(nodes: readonly T[], x: number, y: number, scale: number, radius: (node: T) => number): T | null {
  let best: T | null = null
  let distance = Infinity
  for (const node of nodes) {
    if (node.x == null || node.y == null) continue
    const d = Math.hypot(node.x - x, node.y - y) * scale
    if (d <= Math.max(10, radius(node) * scale + 3) && d < distance) { best = node; distance = d }
  }
  return best
}

/** Convert the reference-frame approach to the elapsed time of the current display frame. */
export function frameEase(reference: number, elapsedMs: number): number {
  const rate = Math.min(1, Math.max(0.001, reference))
  return 1 - Math.pow(1 - rate, Math.max(0, elapsedMs) / (1000 / 60))
}

/** Keep a repository's categorical assignment independent of the current repository list. */
export function paletteIndex(identity: string, count: number): number {
  let hash = 2166136261
  for (const character of identity) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return (hash >>> 0) % Math.max(1, count)
}

/** Dense hubs need less ink per connection to keep their combined emphasis restrained. */
export function hoverEdgeAlpha(connectionCount: number): number {
  return Math.max(0.08, 0.34 / Math.sqrt(Math.max(1, connectionCount / 8)))
}
