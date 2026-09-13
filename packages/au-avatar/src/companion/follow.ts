import { clamp, damp, keepPointerClear, type Bounds } from './motion.ts'
type Point = { x: number; y: number }

/** Stable following offset with a quiet zone and a persistent route around the pointer. */
export class Follow {
  private side = 1
  private target: Point | null = null
  private output: Point | null = null
  private routeDirection = 0
  reset(): void { this.target = null; this.output = null; this.routeDirection = 0 }

  update(pointer: Point, position: Point, bounds: Bounds, clearance: Bounds, pixel: number, dt = 1/60): Point {
    const room = (side:number):boolean => Math.abs(pointer.x+side*(clearance.x+20*pixel))<=bounds.x
    if(!room(this.side) && room(-this.side)) this.side *= -1
    const below = pointer.y-clearance.y-28*pixel
    const desired = keepPointerClear({x:pointer.x+this.side*(clearance.x+20*pixel),
      y:below>=-bounds.y ? below : pointer.y+clearance.y+28*pixel},pointer,bounds,clearance)
    if(!this.target) this.target={...desired}
    const distance=Math.hypot(desired.x-this.target.x,desired.y-this.target.y)
    const gain=distance>0 ? Math.max(0,distance-18*pixel)/distance : 0
    this.target.x=damp(this.target.x,this.target.x+(desired.x-this.target.x)*gain,5,dt)
    this.target.y=damp(this.target.y,this.target.y+(desired.y-this.target.y)*gain,5,dt)
    const goal=keepPointerClear(this.target,pointer,bounds,clearance)
    let next=goal
    const outside = Math.abs(position.x-pointer.x)>=clearance.x || Math.abs(position.y-pointer.y)>=clearance.y
    if(!outside) next=keepPointerClear(position,pointer,bounds,clearance)
    else if(crosses(position,goal,pointer,clearance)) {
      // Advance around a padded ellipse rather than switching square corner waypoints.
      const rx=clearance.x*1.5+20*pixel, ry=clearance.y*1.5+20*pixel
      const angle=Math.atan2((position.y-pointer.y)/ry,(position.x-pointer.x)/rx)
      const end=Math.atan2((goal.y-pointer.y)/ry,(goal.x-pointer.x)/rx)
      const delta=Math.atan2(Math.sin(end-angle),Math.cos(end-angle))
      this.routeDirection ||= Math.sign(delta)||1
      const turn=angle+this.routeDirection*Math.min(Math.abs(delta),0.45)
      next={x:clamp(pointer.x+Math.cos(turn)*rx,-bounds.x,bounds.x),y:clamp(pointer.y+Math.sin(turn)*ry,-bounds.y,bounds.y)}
    } else this.routeDirection=0
    this.output ??= {...position}
    this.output.x=damp(this.output.x,next.x,7,dt)
    this.output.y=damp(this.output.y,next.y,7,dt)
    return {...this.output}

  }
}

/** Slab intersection against the open pointer exclusion rectangle. */
function crosses(a:Point,b:Point,center:Point,size:Bounds):boolean {
  let low=0,high=1
  for(const axis of ['x','y'] as const) {
    const delta=b[axis]-a[axis],offset=a[axis]-center[axis],extent=size[axis]
    if(Math.abs(delta)<1e-8) { if(Math.abs(offset)>=extent) return false; continue }
    const first=(-extent-offset)/delta,last=(extent-offset)/delta
    low=Math.max(low,Math.min(first,last));high=Math.min(high,Math.max(first,last))
    if(low>=high) return false
  }
  return low<1 && high>0
}
