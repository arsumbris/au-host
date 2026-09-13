import test from 'node:test'
import assert from 'node:assert/strict'
import {parseYamlDocuments, TaggedYamlValue} from './yaml-documents.ts'
test('YAML preview preserves typed scalar distinctions and authored date text',()=>{
 const {documents,error}=parseYamlDocuments('title: "42"\ncount: 42\nready: false\ndate: 2026-09-08\nempty: null\ntext: |\n  first\n  second\n')
 assert.equal(error,undefined)
 assert.deepEqual(documents,[{title:'42',count:42,ready:false,date:'2026-09-08',empty:null,text:'first\nsecond\n'}])
})
test('streams, arrays and aliases remain inspectable without source rewriting',()=>{
 const {documents}=parseYamlDocuments('---\n- one\n- two\n---\nbase: &base {count: 42}\nalias: *base\n')
 assert.deepEqual(documents[0],['one','two'])
 assert.equal(documents[1].base,documents[1].alias)
 const recursive=parseYamlDocuments('root: &root {self: *root}')
 assert.equal(recursive.documents[0].root,recursive.documents[0].root.self)
})
test('invalid YAML reports an error instead of substituting structured values',()=>{
 assert.equal(parseYamlDocuments('title: [broken').documents.length,0)
 assert.ok(parseYamlDocuments('title: [broken').error)
 assert.equal(parseYamlDocuments('value: !unknown tagged').documents[0].value.tag, '!unknown')
})
test('core scalars, large integers and duplicate keys are represented honestly',()=>{
 const parsed=parseYamlDocuments('yes: yes\nnumber: 1_000\nlarge: 9007199254740993\n')
 assert.equal(parsed.documents[0].yes,'yes')
 assert.equal(parsed.documents[0].number,'1_000')
 assert.equal(parsed.documents[0].large,9007199254740993n)
 assert.match(parseYamlDocuments('a: 1\na: 2').error,/line 2/)
})


test('declared YAML versions resolve their own scalar rules and aliases remain bounded', () => {
 assert.equal(parseYamlDocuments('%YAML 1.1\n---\nvalue: yes').documents[0].value, true)
 const source = 'a: &a [one, two, three]\nb: &b [*a, *a, *a, *a, *a]\nc: &c [*b, *b, *b, *b, *b]\nd: [*c, *c, *c, *c, *c]'
 assert.ok(parseYamlDocuments(source).error)
})


test('complex keys remain distinct and tags retain their authored information', () => {
 const map = parseYamlDocuments('? [north, east]\n: corner\n1: numeric\n"1": text').documents[0]
 assert.ok(map instanceof Map)
 assert.equal(map.size, 3)
 assert.equal(map.get(1), 'numeric'); assert.equal(map.get('1'), 'text')
 assert.deepEqual([...map.keys()][0], ['north','east'])
 const tagged = parseYamlDocuments('value: !widget {name: sample}').documents[0].value
 assert.ok(tagged instanceof TaggedYamlValue); assert.equal(tagged.tag, '!widget')
 assert.deepEqual(tagged.value, {name:'sample'})
})

test('YAML 1.1 merges honor explicit overrides and first-source precedence', () => {
 const result = parseYamlDocuments('%YAML 1.1\n---\nfirst: &a {x: 1, y: 2}\nsecond: &b {x: 3, z: 4}\nmerged: {<<: [*a, *b], y: 9}').documents[0]
 assert.deepEqual(result.merged, new Map([['x',1],[true,9],['z',4]]))
})


test('merged non-text keys keep identity even without explicit overrides', () => {
 const result = parseYamlDocuments('%YAML 1.1\n---\nbase: &base {1: numeric, "1": text}\nmerged: {<<: *base}').documents[0]
 assert.ok(result.merged instanceof Map)
 assert.equal(result.merged.get(1), 'numeric'); assert.equal(result.merged.get('1'), 'text')
})
