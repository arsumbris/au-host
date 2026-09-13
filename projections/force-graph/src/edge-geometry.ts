export interface EdgePoint { x: number; y: number }

/** Keep the endpoint on the node rim along the curve's endpoint tangent. */
export function clippedEdge(source: EdgePoint, target: EdgePoint, sourceRadius: number, targetRadius: number, bend: number) {
  const dx = target.x - source.x, dy = target.y - source.y
  const distance = Math.hypot(dx, dy)
  if (distance <= sourceRadius + targetRadius || distance === 0) return null
  const control = { x: (source.x + target.x) / 2 - dy / distance * bend, y: (source.y + target.y) / 2 + dx / distance * bend }
  const startLength = Math.hypot(control.x-source.x, control.y-source.y)
  const endLength = Math.hypot(control.x-target.x, control.y-target.y)
  return {
    start: {x:source.x+(control.x-source.x)/startLength*sourceRadius,y:source.y+(control.y-source.y)/startLength*sourceRadius},
    control,
    end: {x:target.x+(control.x-target.x)/endLength*targetRadius,y:target.y+(control.y-target.y)/endLength*targetRadius},
  }
}
