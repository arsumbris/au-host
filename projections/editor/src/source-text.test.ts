import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { history, undo, redo } from '@codemirror/commands'
import { readSource, writeSource, preserveSourceText, loadSourceLayout } from './source-text'
function state(source: string) {
 const parsed=readSource(source)
 return EditorState.create({doc:parsed.doc,extensions:[history(),preserveSourceText]}).update({effects:loadSourceLayout.of(parsed.layout)}).state
}
describe('source line endings',()=>{
 for(const source of ['', 'one\n', 'one\r\ntwo\r\n', 'one\rtwo\r', 'one\r\ntwo\nthree\rfour', 'café 日本語 🪶\r\n']) {
  it(`round trips ${JSON.stringify(source)}`,()=>expect(writeSource(state(source))).toBe(source))
 }
 it('preserves mixed endings through edits and undo/redo',()=>{
  let current=state('one\r\ntwo\nthree\rfour')
  const target={get state(){return current},dispatch(tr:any){current=tr.state}}
  current=current.update({changes:{from:4,to:8,insert:'new\nline\n'}}).state
  expect(writeSource(current)).toBe('one\r\nnew\r\nline\r\nthree\rfour')
  undo(target);expect(writeSource(current)).toBe('one\r\ntwo\nthree\rfour')
  redo(target);expect(writeSource(current)).toBe('one\r\nnew\r\nline\r\nthree\rfour')
 })
})

it('maps engine bytes over CRLF and Unicode to editor positions',async()=>{
 const {sourceByteToChar}=await import('./source-text')
 const value=state('é\r\n🪶\r\nend')
 const map=sourceByteToChar(value)
 expect(map(4)).toBe(2)
 expect(map(8)).toBe(4)
 expect(map(10)).toBe(5)
 expect(map(999)).toBe(value.doc.length)
})
