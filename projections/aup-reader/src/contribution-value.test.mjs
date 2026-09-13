import test from 'node:test'
import assert from 'node:assert/strict'
import {contributionValue, TupleValue, BrandedValue} from './contribution-value.ts'
test('reference rendering retains repo, commit, anchor and referent block',()=>{
 assert.equal(contributionValue({kind:'reference',target:'note',repo:'custom',commit:'abc',anchor:'Heading',block_id:{id:'item',referent:true}}),'[[note::custom@abc#Heading^^item]]')
})
test('nested contributions keep tuple element brands and scalar distinctions',()=>{
 const tuple=contributionValue({kind:'tuple',elements:[{value:{kind:'scalar',value:0},brand:'distance'},{value:{kind:'scalar',value:false}}]})
 assert.ok(tuple instanceof TupleValue)
 assert.ok(tuple.items[0] instanceof BrandedValue)
 assert.equal(tuple.items[0].value,0)
 assert.equal(tuple.items[1],false)
 assert.deepEqual(contributionValue({kind:'inline_record',fields:[{field:'custom',values:[{kind:'scalar',value:null}]}]}),{custom:[null]})
})
test('malformed authored values remain readable',()=>{
 assert.equal(contributionValue({kind:'malformed_constructor',raw:'distance(?)'}),'distance(?)')
})
