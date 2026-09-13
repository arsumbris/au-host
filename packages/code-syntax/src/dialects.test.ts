import { describe, expect, it } from 'vitest'
import { LanguageSupport } from '@codemirror/language'
import { highlightCode, languageForPath } from './index'
function errors(source: string, extension: string) {
  const support = languageForPath(`source.${extension}`)!
  const language = support instanceof LanguageSupport ? support.language : support
  const errors: number[] = []
  language.parser.parse(source).iterate({ enter(node) { if (node.type.isError) errors.push(node.from) } })
  return errors
}
const jsonc = '{ // config\n "enabled": true, /* comment */ "items": [1, 2,],\n}'
const json5 = String.raw`{unquoted: 'text', unicode: '\u0041', hexEscape: '\x42', \u006bey: +0xFF, café: -.5, infinity: -Infinity, nan: +NaN, continued: 'one\
two',}`
describe('dedicated configuration language grammars', () => {
  it('separates JSON, JSONC and JSON5 syntax', () => {
    expect(errors(jsonc, 'jsonc')).toEqual([])
    expect(errors(jsonc, 'json').length).toBeGreaterThan(0)
    expect(errors(json5, 'json5')).toEqual([])
    expect(errors(json5, 'jsonc').length).toBeGreaterThan(0)
    expect(errors('{"value": undefined}', 'json5').length).toBeGreaterThan(0)
  })
  it('handles JSON5 string escapes and Unicode separators accurately', () => {
    for (const source of [String.raw`{value: '\0x'}`, String.raw`{value: '\u0041'}`, String.raw`{value: '\x42'}`, "{value: 'a\u2028b'}"])
      expect(errors(source, 'json5')).toEqual([])
    for (const source of [String.raw`{value: '\01'}`, String.raw`{value: '\9'}`, String.raw`{value: '\u00XZ'}`])
      expect(errors(source, 'json5').length).toBeGreaterThan(0)
  })
  it('colors JSONC comments and JSON5 properties and values without source loss', () => {
    for (const [source, language] of [[jsonc, 'jsonc'], [json5, 'json5']]) {
      const spans = highlightCode(source!, language!)
      expect(spans.map(span => span.text).join('')).toBe(source)
      expect(spans.some(span => span.className === 'au-syntax-name')).toBe(true)
    }
    expect(highlightCode(jsonc, 'jsonc').some(span => span.className === 'au-syntax-comment' && span.text.includes('config'))).toBe(true)
    expect(highlightCode(json5, 'json5')).toContainEqual({ text: '+0xFF', className: 'au-syntax-value' })
  })
  it.each([
    ['scss', '$space: 4px; @mixin inset($n) { padding: $n; } .card { @include inset($space); &:hover { color: red; } }'],
    ['less', '@space: 4px; .inset(@n) { padding: @n; } .card { .inset(@space); &:hover { color: red; } }'],
  ])('uses a dedicated %s parser for variables, mixins and nesting', (extension, source) => {
    expect(errors(source, extension)).toEqual([])
    expect(highlightCode(source, extension).map(span => span.text).join('')).toBe(source)
  })
})
