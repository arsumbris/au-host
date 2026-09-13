import {describe,it,expect} from 'vitest'
import {highlightCode,languageForPath} from './index'
import {LanguageSupport} from '@codemirror/language'
import {highlightTree,tagHighlighter,tags} from '@lezer/highlight'
import {yamlScalarKind} from './yaml'
const source='key: text\ncount: 42\nready: false\nempty: null\nquoted: "false"\nforced: !!str 42\ndate: 2026-09-08\nblock: |\n  multiline text\nanchor: &anchor {value: true}\nalias: *anchor\n'
function classes(text:string){return highlightCode(text,'yaml').filter(x=>x.className).map(x=>[x.text,x.className])}
describe('YAML scalar highlighting',()=>{
 it.each([['0','number'],['-42','number'],['1.2e+3','number'],['.inf','number'],['0o17','number'],['0xFF','number'],['false','bool'],['NULL','null'],['yes','string'],['2026-09-08','string'],['1_000','string']])('%s is %s',(value,kind)=>expect(yamlScalarKind(value)).toBe(kind))
 it('distinguishes source values without coloring keys as values',()=>{
  const spans=classes(source)
  for(const pair of [['key','au-syntax-name'],['text','au-syntax-string'],['42','au-syntax-value'],['false','au-syntax-type'],['null','au-syntax-type'],['"false"','au-syntax-string'],['2026-09-08','au-syntax-string']])expect(spans).toContainEqual(pair)
  expect(spans.filter(x=>x[0]==='42')).toContainEqual(['42','au-syntax-string'])
  expect(highlightCode(source,'yaml').map(x=>x.text).join('')).toBe(source)
 })
 it('uses the same scalar tags in Markdown frontmatter and YAML fences',()=>{
  const language=(languageForPath('note.md') as LanguageSupport).language
  const text='---\ncount: 42\n---\n\n```yaml\nready: false\n```\n'
  const seen:string[]=[]
  highlightTree(language.parser.parse(text),tagHighlighter([{tag:tags.number,class:'number'},{tag:tags.bool,class:'bool'}]),(from,to,cls)=>seen.push(`${cls}:${text.slice(from,to)}`))
  expect(seen).toContain('number:42');expect(seen).toContain('bool:false')
 })
})


it('respects each document version when classifying YAML values', () => {
 const source = '%YAML 1.1\n---\nready: yes\ncount: 1_000\n...\n%YAML 1.2\n---\nready: yes\ncount: 1_000\n'
 const spans = classes(source)
 expect(spans).toContainEqual(['yes','au-syntax-type'])
 expect(spans).toContainEqual(['yes','au-syntax-string'])
 expect(spans).toContainEqual(['1_000','au-syntax-value'])
 expect(spans).toContainEqual(['1_000','au-syntax-string'])
})


it('carries YAML 1.1 rules through a stream until another version is declared', () => {
 const spans=classes('%YAML 1.1\n---\nready: yes\n---\nready: yes')
 expect(spans.filter(span=>span[0]==='yes')).toEqual([['yes','au-syntax-type'],['yes','au-syntax-type']])
})
