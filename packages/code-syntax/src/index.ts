import { markdown } from '@codemirror/lang-markdown'
import { sourceYaml, markdownWithYaml } from './yaml.ts'
import { cpp } from '@codemirror/lang-cpp'
import { jsonc, json5 } from './json.ts'
import { sass } from '@codemirror/lang-sass'
import { less } from '@codemirror/lang-less'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { go } from '@codemirror/legacy-modes/mode/go'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { Language, LanguageSupport, StreamLanguage } from '@codemirror/language'
import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight'

import { java, csharp, kotlin, scala, dart } from '@codemirror/legacy-modes/mode/clike'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'

export interface LanguageDefinition {
  id: string
  extensions: readonly string[]
  aliases?: readonly string[]
  filenames?: readonly string[]
  prose?: boolean
  create: () => LanguageSupport | Language
}

/** Shared source/fence catalog. Add a parser factory and its names here to extend both views. */
export const languages: readonly LanguageDefinition[] = [
  { id: 'markdown', extensions: ['md', 'markdown', 'mdx'], prose: true, create: () => markdownWithYaml(markdown({ codeLanguages: languageForFence })) },
  { id: 'javascript', extensions: ["js", "mjs", "cjs"], aliases: [], create: () => javascript() },
  { id: 'typescript', extensions: ["ts", "mts", "cts"], aliases: [], create: () => javascript({ typescript: true }) },
  { id: 'jsx', extensions: ["jsx"], aliases: [], create: () => javascript({ jsx: true }) },
  { id: 'tsx', extensions: ["tsx"], aliases: [], create: () => javascript({ typescript: true, jsx: true }) },
  { id: 'yaml', extensions: ["yaml", "yml", "yamls"], aliases: [], create: () => sourceYaml() },
  { id: 'json', extensions: ["json"], aliases: [], create: () => json() },
  { id: 'jsonc', extensions: ['jsonc'], create: jsonc },
  { id: 'json5', extensions: ['json5'], create: json5 },
  { id: 'scss', extensions: ['scss'], create: () => sass() },
  { id: 'less', extensions: ['less'], create: () => less() },
  { id: 'css', extensions: ["css"], aliases: [], create: () => css() },
  { id: 'html', extensions: ["html", "htm", "xhtml"], aliases: [], create: () => html() },
  { id: 'python', extensions: ["py", "pyi"], aliases: [], create: () => python() },
  { id: 'rust', extensions: ["rs"], aliases: [], create: () => rust() },
  { id: 'cpp', extensions: ["c", "h", "cc", "cpp", "cxx", "hpp", "hh"], aliases: ["c++", "cplusplus"], create: () => cpp() },
  { id: 'sql', extensions: ["sql"], aliases: [], create: () => sql() },
  { id: 'xml', extensions: ["xml", "svg"], aliases: [], create: () => xml() },
  { id: 'go', extensions: ["go"], aliases: [], create: () => StreamLanguage.define(go) },
  { id: 'shell', extensions: ["sh", "bash", "zsh"], aliases: ["shellscript"], create: () => StreamLanguage.define(shell) },
  { id: 'toml', extensions: ["toml"], aliases: [], create: () => StreamLanguage.define(toml) },
  { id: 'java', extensions: ["java"], aliases: [], create: () => StreamLanguage.define(java) },
  { id: 'csharp', extensions: ["cs"], aliases: ["c#"], create: () => StreamLanguage.define(csharp) },
  { id: 'kotlin', extensions: ["kt", "kts"], aliases: [], create: () => StreamLanguage.define(kotlin) },
  { id: 'scala', extensions: ["scala", "sc"], aliases: [], create: () => StreamLanguage.define(scala) },
  { id: 'dart', extensions: ["dart"], aliases: [], create: () => StreamLanguage.define(dart) },
  { id: 'ruby', extensions: ["rb", "rake"], aliases: [], create: () => StreamLanguage.define(ruby) },
  { id: 'swift', extensions: ["swift"], aliases: [], create: () => StreamLanguage.define(swift) },
  { id: 'powershell', extensions: ["ps1", "psm1", "psd1"], aliases: ["pwsh"], create: () => StreamLanguage.define(powerShell) },
  { id: 'dockerfile', extensions: ['dockerfile'], aliases: ['docker'], filenames: ['dockerfile', 'containerfile'], create: () => StreamLanguage.define(dockerFile) },
]
const byName = new Map<string, LanguageDefinition>()
const byFilename = new Map<string, LanguageDefinition>()
for (const definition of languages) {
  for (const name of [definition.id, ...definition.extensions, ...(definition.aliases ?? [])]) byName.set(name, definition)
  for (const name of definition.filenames ?? []) byFilename.set(name, definition)
}
export function languageDefinitionForPath(path: string): LanguageDefinition | undefined {
  const file = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  return byFilename.get(file) ?? byName.get(file.includes('.') ? file.slice(file.lastIndexOf('.') + 1) : '')
}
export function languageForPath(path: string): LanguageSupport | Language | null {
  return languageDefinitionForPath(path)?.create() ?? null
}
export function languageForFence(info: string): Language | null {
  const definition = byName.get(info.trim().split(/\s+/)[0]?.toLowerCase() ?? '')
  // Avoid recursive Markdown language construction within fenced code discovery.
  if (!definition || definition.prose) return null
  const support = definition.create()
  return support instanceof LanguageSupport ? support.language : support
}

const highlighter = tagHighlighter([
  { tag: t.comment, class: 'au-syntax-comment' },
  { tag: [t.string, t.character], class: 'au-syntax-string' },
  { tag: [t.number, t.atom], class: 'au-syntax-value' },
  { tag: [t.bool, t.null, t.labelName, t.typeName, t.className, t.tagName, t.attributeName], class: 'au-syntax-type' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: 'au-syntax-function' },
  { tag: [t.keyword, t.meta], class: 'au-syntax-keyword' },
  { tag: t.propertyName, class: 'au-syntax-name' },
  { tag: t.variableName, class: 'au-syntax-variable' },
  { tag: [t.punctuation, t.operator], class: 'au-syntax-punctuation' },
])
export interface CodeSpan { text: string; className?: string }
/** Plain spans preserve every source byte; consumers render text nodes, never HTML. */
export function highlightCode(code: string, language: string): CodeSpan[] {
  return highlightParsed(code, languageForFence(language))
}

/** Source previews use the same path discovery and parser as Reader/Editor. */
export function highlightSource(code: string, path: string): CodeSpan[] {
  const support = languageForPath(path)
  return highlightParsed(code, support instanceof LanguageSupport ? support.language : support)
}

function highlightParsed(code: string, language: Language | null): CodeSpan[] {
  const parser = language?.parser
  if (!parser || code.length > 250_000) return [{ text: code }]
  const spans: CodeSpan[] = []
  let end = 0
  highlightTree(parser.parse(code), highlighter, (from, to, className) => {
    if (from > end) spans.push({ text: code.slice(end, from) })
    spans.push({ text: code.slice(from, to), className })
    end = to
  })
  if (end < code.length) spans.push({ text: code.slice(end) })
  return spans
}
