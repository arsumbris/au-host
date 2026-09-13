import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

class Element extends EventTarget {
  children=[]; attributes=new Map(); parent=null
  constructor(tag){super();this.tag=tag;this.dataset={}}
  append(...children){for(const child of children){child.remove();child.parent=this;this.children.push(child)}}
  prepend(child){child.remove();child.parent=this;this.children.unshift(child)}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null}
  replaceChildren(...children){for(const child of [...this.children])child.remove();this.append(...children)}
  setAttribute(key,value){this.attributes.set(key,value)}
  removeAttribute(key){this.attributes.delete(key)}
  toggleAttribute(key,on){if(on)this.setAttribute(key,'');else this.removeAttribute(key)}
}
const document={createElement:tag=>new Element(tag)}
const source=(await readFile(new URL('../src/index.ts',import.meta.url),'utf8')).replace(/import\.meta\.glob\([^\n]+/,"{} as Record<string, string>")
const javascript=ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS})
const exports={}
let choices=[], calls=[], finish
const modules={
  '@arsumbris/au-host-sdk':{defineProjection:value=>value},
  '@arsumbris/container-core':{
    viewerSwitchSets:()=>({viewers:choices,openers:[]}),
    runViewerSwitch:(_host,file,group)=>{calls.push({file,group});return new Promise(resolve=>{finish=resolve})},
  },
  '@arsumbris/selection':{isFileSelection:()=>false,fileSelection:path=>({path})},
  '@arsumbris/intent':{isOpenIntent:()=>false},
  './resolve-file':{resolveExternalFile:async()=>null},
  './viewers':{button:(label,action)=>{const el=document.createElement('button');el.textContent=label;el.addEventListener('au-activate',action);return el}},
  './style.css?inline':{default:''},'@arsumbris/style/document-controls.css?inline':{default:''},
}
// Supply only each projection's declared file metadata; resolution remains the shared helper's job.
const injected=javascript.replace('const metadata = {};',`const metadata = Object.fromEntries(['image','pdf','audio','video','html'].map(kind=>['../type/'+kind+'-viewer.type.yaml','opens: [svg]']));`)
runInNewContext(injected,{exports,require:name=>{assert.ok(name in modules,name);return modules[name]},document})
const flush=()=>new Promise(resolve=>setImmediate(resolve))
const container=new Element('div')
const host={instanceId:'custom-slot',config:{file:'sample.svg::assets'},styles:{inject:()=>()=>{}},assets:{url:async()=>null},intent:{handle:()=>()=>{}}}
choices=[{id:'custom-authoring-view',label:'Custom authoring'}]
const dispose=exports.default.image(container,host)
await flush()
const root=container.children[0],control=root.children.find(el=>el.tag==='au-viewer-switch')
assert.ok(control,'qualified SVG exposes discovered alternate viewer')
assert.equal(control.attributes.get('primary-label'),'Custom authoring')
control.dispatchEvent(new Event('au-activate'))
control.dispatchEvent(new Event('au-activate'))
assert.deepEqual(calls,[{file:'sample.svg::assets',group:'viewers'}],'repeat activation does not launch another chooser')
assert.ok(control.attributes.has('disabled'))
finish({kind:'cancelled'});await flush()
assert.equal(control.attributes.has('disabled'),false,'cancel permits a later retry')
control.dispatchEvent(new Event('au-activate'));finish({kind:'refused'});await flush()
assert.equal(root.children.find(el=>el.className==='mv-status').textContent,'This pane cannot change its viewer.')
dispose();assert.equal(container.children.length,0)
choices=[]
const disposeEmpty=exports.default.image(container,host);await flush()
assert.equal(container.children[0].children.some(el=>el.tag==='au-viewer-switch'),false,'no invented fallback when discovery has no viewer')
disposeEmpty()
console.log('PASS media viewer discovery, qualified reference, repeated activation, cancellation, refusal and disposal')
