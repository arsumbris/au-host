// Static inventory and token checks; not a visual or accessibility certification.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..')
const src=path.join(root,'packages/au-component-set/src')
const entry=readFileSync(path.join(src,'index.ts'),'utf8')
const imports=new Map()
for(const match of entry.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(.+)'/g)) {
 for(const name of match[1].split(',').map(s=>s.trim()).filter(Boolean)) imports.set(name,match[2]+'.ts')
}
const hooks=JSON.parse(readFileSync(new URL('./token-hooks.json',import.meta.url),'utf8'))
const cascade=new Set()
const registry=new Set()
for(const file of ['tokens.css','ext.css']) for(const m of readFileSync(path.join(root,'packages/style',file),'utf8').matchAll(/@property\s+(--[\w-]+)/g)) registry.add(m[1])
for(const file of ['tokens.css','ext.css']) for(const m of readFileSync(path.join(root,'packages/style',file),'utf8').matchAll(/(--au-[\w-]+)\s*:/g)) cascade.add(m[1])
const sources=readdirSync(src).filter(f=>f.endsWith('.ts')).map(file=>({file,text:readFileSync(path.join(src,file),'utf8')}))
const locallyDefined=new Set(sources.flatMap(({text})=>[...text.matchAll(/(--au-[\w-]+)\s*:/g)].map(m=>m[1])))
const rows=[...entry.matchAll(/api\.define\('([^']+)',\s*(\w+)\)/g)].map(([,tag,klass])=>{
 const file=imports.get(klass)?.replace(/^\.\//,'')
 if(!file) throw Error(`Unresolved owner for ${tag}`)
 const text=readFileSync(path.join(src,file),'utf8')
 const tokens=[...new Set([...text.matchAll(/var\(\s*(--au-[\w-]+)/g)].map(m=>m[1]))]
 const unresolved=tokens.filter(t=>!registry.has(t)&&!cascade.has(t)&&!locallyDefined.has(t)&&!hooks[t])
 return {tag,file,tokens:tokens.length,unresolved,motion:/\b(?:transition|animation)\s*:/.test(text),reduced:/prefers-reduced-motion|reducedControlMotion/.test(text),focus:/controlFocusStyle/.test(text),material:/floatingSurfaceMaterial/.test(text)}
})
// Floating components must compose the shared material rather than fork its theme wiring.
const floatingOwners = ['au-command-palette.ts', 'au-menu.ts', 'au-modal.ts', 'au-drawer.ts', 'au-toast.ts', 'au-hovercard.ts', 'au-color-picker.ts', 'picker-style.ts']
for (const file of floatingOwners) {
  const source = readFileSync(path.join(src, file), 'utf8')
  if (!source.includes('${floatingSurfaceMaterial}')) throw Error(`Missing shared floating material: ${file}`)
}
const material = readFileSync(path.join(root, 'packages/style/surface-material.ts'), 'utf8')
for (const file of ['packages/au-component-set/src/surface-material.ts', 'app/src/renderer/src/projections/overlay-site.ts']) {
  if (!readFileSync(path.join(root, file), 'utf8').includes('floatingSurfaceMaterialCSS')) throw Error(`Missing shared material consumer: ${file}`)
}
for (const role of ['--au-floating-fill', '--au-floating-background-image', '--au-floating-edge-image', '--au-material-filter', '--au-surface-alpha']) {
  if (!material.includes(role)) throw Error(`Missing floating material role: ${role}`)
}
for (const file of ['au-popover.ts', 'au-select.ts', 'au-combobox.ts', 'au-workspace-switcher.ts']) {
  const source = readFileSync(path.join(src, file), 'utf8')
  if (!source.includes('pickerSurface')) throw Error(`Missing shared picker surface: ${file}`)
}
const unknown=[...new Set(rows.flatMap(r=>r.unresolved))].sort()
if(process.argv.includes('--check')&&unknown.length) process.exitCode=1
console.log(JSON.stringify({components:rows.length,registeredTokens:registry.size,unclassified:unknown,motionWithoutLocalReducedRule:rows.filter(r=>r.motion&&!r.reduced).map(r=>r.tag)},null,2))
