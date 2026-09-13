import { describe, expect, it } from 'vitest'
import { LanguageSupport } from '@codemirror/language'
import { highlightSource, highlightCode, languageForFence, languageForPath, languageDefinitionForPath, languages } from './index'

describe('shared source highlighting', () => {
  it.each([
    ['typescript', 'const title: string = "夜空"; // note\n'],
    ['python', 'def observe(count):\n    return count + 1\n'],
    ['yaml', 'enabled: false\ncount: 0\n'],
    ['rust', 'fn main() { let x = 42; }'],
    ['json', '{"count": 0, "enabled": false}'],
    ['java', 'public class Main { int count = 3; }'],
    ['csharp', 'public class Main { string title = "Hi"; }'],
    ['kotlin', 'val count: Int = 3'],
    ['ruby', 'def greet(name)\n  puts "Hello"\nend'],
    ['swift', 'let count: Int = 3'],
    ['powershell', '$count = 3 # note'],
    ['css', '.card { color: red; display: flex; }'],
  ])('preserves source and emits syntax spans for %s', (language, code) => {
    const spans = highlightCode(code, language)
    expect(spans.map(s => s.text).join('')).toBe(code)
    expect(spans.some(s => s.className)).toBe(true)
  })
  it('keeps unknown languages and markup as literal source', () => {
    const code = '<script>alert("x")</script>\n'
    expect(highlightCode(code, 'unknown-language')).toEqual([{ text: code }])
  })
  it('resolves fence aliases and metadata', () => {
    expect(languageForFence('typescript title=example')).not.toBeNull()
    expect(languageForFence('yaml [:conditions]')).not.toBeNull()
    expect(languageForFence('unknown')).toBeNull()
  })
  it('keeps registered names unambiguous and recognizes cross-platform paths', () => {
    const names = languages.flatMap(l => [...new Set([l.id, ...l.extensions, ...(l.aliases ?? [])])])
    expect(new Set(names).size).toBe(names.length)
    expect(languageDefinitionForPath('C:\\src\\Main.CS')?.id).toBe('csharp')
    expect(languageDefinitionForPath('/src/Dockerfile')?.id).toBe('dockerfile')
    expect(languageDefinitionForPath('unknown.xyz')).toBeUndefined()
  })
  it('mounts a language parser for Markdown with mixed fenced languages', () => {
    const support = languageForPath('notes.md')
    expect(support).toBeInstanceOf(LanguageSupport)
    const tree = (support as LanguageSupport).language.parser.parse('---\ntitle: Test\n---\n\n```typescript\nconst x = 1\n```\n')
    expect(tree.length).toBeGreaterThan(0)
  })
})

// Preview source discovery must agree with the shared file language registry.
describe('source previews', () => {
  it.each(['sample.yaml', 'sample.yamls', 'sample.json', 'sample.ts'])('preserves source using the parser for %s', path => {
    const text = path.endsWith('.ts') ? 'const label = "夜空"; // note\n' : path.endsWith('.json') ? '{"label":"夜空","active":true}' : 'label: "夜空"\nactive: true\n'
    const parts = highlightSource(text, path)
    expect(parts.map(p => p.text).join('')).toBe(text)
    expect(parts.some(p => p.className)).toBe(true)
  })
  it('highlights fenced YAML within Markdown and preserves unknown source', () => {
    const text = '## Example\n\n```yaml\nactive: true\n```\n'
    expect(highlightSource(text, 'example.md').some(p => p.className === 'au-syntax-name')).toBe(true)
    expect(highlightSource(text, 'example.unknown')).toEqual([{text}])
  })
})
