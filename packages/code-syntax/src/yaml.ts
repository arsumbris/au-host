import { Schema } from 'yaml'
import { yamlLanguage, yamlFrontmatter } from '@codemirror/lang-yaml'
import { LanguageSupport, LRLanguage, StreamLanguage } from '@codemirror/language'
import { parseMixed, type Input, type SyntaxNodeRef } from '@lezer/common'
import { styleTags, tags } from '@lezer/highlight'

const schemas = { '1.2': new Schema({ schema: 'core' }), '1.1': new Schema({ schema: 'yaml-1.1' }) }

/** Use the preview parser's scalar tag rules so source colors agree with declared YAML versions. */
export function yamlScalarKind(value: string, version: '1.1' | '1.2' = '1.2'): 'string' | 'number' | 'bool' | 'null' {
  const tag = schemas[version].tags.find(tag => tag.default && 'test' in tag && tag.test?.test(value))?.tag
  if (tag === 'tag:yaml.org,2002:null') return 'null'
  if (tag === 'tag:yaml.org,2002:bool') return 'bool'
  if (tag === 'tag:yaml.org,2002:int' || tag === 'tag:yaml.org,2002:float') return 'number'
  return 'string'
}
const scalarParsers = Object.fromEntries(['string', 'number', 'bool', 'null'].map(kind => [kind, StreamLanguage.define({
  token(stream) { stream.skipToEnd(); return kind },
  tokenTable: { null: tags.null },
}).parser]))

function scalarMount(node: SyntaxNodeRef, input: Input) {
  if (node.name !== 'Literal' || node.node.parent?.name === 'Key') return null
  const parent = node.node.parent
  const tag = parent?.getChild('Tag')
  const explicit = tag ? input.read(tag.from, tag.to) : ''
  const value = input.read(node.from, node.to)
  let document = parent
  while (document && document.name !== 'Document') document = document.parent
  let legacy = false
  // YAML 1.1 directives persist across documents until a later version directive.
  for (let prior = document; prior; prior = prior.prevSibling) {
    const directive = prior.getChildren('Directive').map(node => input.read(node.from, node.to)).find(text => /^%YAML[ \t]+1\.[12](?:\s|$)/.test(text))
    if (directive) { legacy = /^%YAML[ \t]+1\.1(?:\s|$)/.test(directive); break }
  }
  const kind = explicit === '!!str' || explicit === '!<tag:yaml.org,2002:str>' ? 'string' : yamlScalarKind(value, legacy ? '1.1' : '1.2')
  return { parser: scalarParsers[kind]! }
}
export const sourceYamlLanguage = yamlLanguage.configure({
  props: [styleTags({ BlockLiteralContent: tags.string, 'Anchor Alias': tags.labelName })],
  wrap: parseMixed(scalarMount),
})
export function sourceYaml() { return new LanguageSupport(sourceYamlLanguage) }

export function markdownWithYaml(content: LanguageSupport): LanguageSupport {
  const base = yamlFrontmatter({ content })
  return new LanguageSupport((base.language as LRLanguage).configure({
    wrap: parseMixed(node => node.name === 'FrontmatterContent' ? { parser: sourceYamlLanguage.parser }
      : node.name === 'Body' ? { parser: content.language.parser } : null),
  }), base.support)
}
