import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source=await readFile(new URL('../src/resolve-file.ts',import.meta.url),'utf8')
const exports={}
runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}),{
  exports,require:()=>({readResolveMember:(reader,path)=>reader('member',path),readResolveTarget:(reader,target)=>reader('target',target)}),
})
const resolve=exports.resolveExternalFile
const ready=result=>({ready:true,result})
let calls=[]
const reader=async(kind,value)=>{calls.push([kind,value]);return kind==='member'?ready({root:'/vault',repo:'assets'}):ready({path:'/vault/image.svg'})}
assert.equal(await resolve(reader,'/vault/image.svg'),'/vault/image.svg')
assert.deepEqual(calls,[['member','/vault/image.svg'],['target','image.svg::assets']])
calls=[]
assert.equal(await resolve(reader,'image.svg::assets'),'/vault/image.svg')
assert.deepEqual(calls,[['target','image.svg::assets']])
for(const ownership of [{ready:false},ready(null),ready({root:'/different',repo:'assets'})]){
  let targetReads=0
  assert.equal(await resolve(async kind=>{if(kind==='target')targetReads++;return ownership},'/vault/image.svg'),null)
  assert.equal(targetReads,0)
}
for(const result of [{ready:false},ready(null),ready({path:'/vault/other.svg'})]){
  assert.equal(await resolve(async kind=>kind==='member'?ready({root:'/vault',repo:'assets'}):result,'/vault/image.svg'),null)
}
assert.equal(await resolve(reader,'/vault/../image.svg'),null)
assert.equal(await resolve(async kind=>kind==='member'?ready({root:'C:\\vault',repo:'assets'}):ready({path:'C:\\vault\\image.svg'}),'C:\\vault\\image.svg'),'C:\\vault\\image.svg')
console.log('PASS external file ownership, qualified lookup, readiness, scope, literal identity and Windows paths')
