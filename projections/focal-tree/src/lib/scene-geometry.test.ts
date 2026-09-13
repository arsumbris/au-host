import { describe, expect, it } from 'vitest'
import { clippedEdge, fitCamera, markerRadius, placeLabels } from './scene-geometry'

describe('focal scene presentation', () => {
  it('frames the default three-node chain inside a sidebar without changing its coordinates', () => {
    const nodes = [{cx:0,cy:0},{cx:-120,cy:0},{cx:-240,cy:0}]
    const camera = fitCamera(nodes,256,200)
    for(const n of nodes) expect(128+n.cx*camera.scale).toBeGreaterThanOrEqual(28)
    expect(nodes[2].cx).toBe(-240)
    expect(markerRadius(48,.5,camera.scale)).toBeLessThanOrEqual(9)
  })
  it('keeps labels clear of the return target after re-rooting', () => {
    const nodes=[
      {id:'telescope',label:'meridian-telescope.md',depth:0,x:128,y:100,r:9},
      {id:'observatory',label:'aurora-observatory.md',depth:1,x:180,y:100,r:4},
    ]
    const labels=placeLabels(nodes,256,200,1,text=>text.length*6)
    expect(labels).toHaveLength(2)
    for(const label of labels) {
      expect(label.x).toBeGreaterThanOrEqual(10)
      expect(label.x+label.width).toBeLessThanOrEqual(246)
      for(const node of nodes) expect(node.x>=label.x && node.x<=label.x+label.width && node.y>=label.y && node.y<=label.y+label.height).toBe(false)
    }
  })
  it('clips edges to the markers and suppresses lines between overlapping markers', () => {
    expect(clippedEdge({x:0,y:0,r:8},{x:100,y:0,r:4})).toEqual([{x:10,y:0},{x:94,y:0}])
    expect(clippedEdge({x:0,y:0,r:8},{x:10,y:0,r:4})).toBeNull()
  })
  it('ellipsizes long labels and does not display labels outside the configured depth', () => {
    const nodes=[{id:'a',label:'a'.repeat(80),depth:0,x:128,y:100,r:9},{id:'b',label:'hidden',depth:2,x:50,y:50,r:3}]
    const labels=placeLabels(nodes,256,200,1,text=>text.length*6)
    expect(labels).toHaveLength(1)
    expect(labels[0].text.endsWith('…')).toBe(true)
  })
})
