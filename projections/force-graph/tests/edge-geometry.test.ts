import {test} from 'node:test'
import assert from 'node:assert/strict'
import {clippedEdge} from '../src/edge-geometry.ts'

test('straight connections terminate on both node boundaries',()=>{
 const edge=clippedEdge({x:0,y:0},{x:100,y:0},10,20,0)!
 assert.deepEqual(edge.start,{x:10,y:0})
 assert.deepEqual(edge.end,{x:80,y:0})
})
test('curved connections preserve radial boundary distances',()=>{
 for(const bend of [-20,20]) {
  const edge=clippedEdge({x:0,y:0},{x:100,y:0},10,20,bend)!
  assert(Math.abs(Math.hypot(edge.start.x,edge.start.y)-10)<1e-10)
  assert(Math.abs(Math.hypot(edge.end.x-100,edge.end.y)-20)<1e-10)
  assert.equal(edge.control.y,bend)
 }
})
test('overlapping nodes do not create inverted link segments',()=>{
 assert.equal(clippedEdge({x:0,y:0},{x:5,y:0},10,10,2),null)
 assert.equal(clippedEdge({x:0,y:0},{x:0,y:0},0,0,0),null)
})
