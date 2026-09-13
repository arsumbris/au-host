import { LRLanguage, LanguageSupport, continuedIndent, foldInside, foldNodeProp, indentNodeProp } from '@codemirror/language'
import { styleTags, tags } from '@lezer/highlight'
import { parser } from './json/parser.ts'

const configLanguage = LRLanguage.define({
  parser: parser.configure({ props: [
    styleTags({ 'String!': tags.string, 'PropertyName!': tags.propertyName, 'Number!': tags.number, 'True False': tags.bool, Null: tags.null, LineComment: tags.lineComment, BlockComment: tags.blockComment, '{ }': tags.brace, '[ ]': tags.squareBracket, ': ,': tags.separator }),
    indentNodeProp.add({ Object: continuedIndent({ except: /^\s*}/ }), Array: continuedIndent({ except: /^\s*\]/ }) }),
    foldNodeProp.add({ 'Object Array': foldInside }),
  ] }),
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } } },
})

/** JSONC configuration syntax allows comments and trailing commas, but not JSON5 literals. */
export function jsonc() { return new LanguageSupport(configLanguage) }
export function json5() { return new LanguageSupport(configLanguage.configure({ dialect: 'json5' })) }
