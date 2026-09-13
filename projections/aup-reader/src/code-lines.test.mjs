import test from 'node:test'
import assert from 'node:assert/strict'
import { codeLines } from './code-lines.ts'
test('numbered code keeps exact source across token boundaries and empty lines',()=>{
 const source=[{text:'one\r\n\n',className:'au-syntax-string'},{text:'two'},{text:' + three\n',className:'au-syntax-keyword'}]
 const lines=codeLines(source)
 assert.equal(lines.length,4)
 assert.equal(lines.flat().map(s=>s.text).join(''),source.map(s=>s.text).join(''))
 assert.equal(lines[0][0].className,'au-syntax-string')
 assert.deepEqual(codeLines([]),[[]])
})
