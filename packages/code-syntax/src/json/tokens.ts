import { ExternalTokenizer } from '@lezer/lr'
import { Identifier, ExtendedString, Dialect_json5 } from './parser.terms.ts'

// JSON5 IdentifierName uses Unicode identifier characters and permits Unicode escapes.
export const identifiers = new ExternalTokenizer((input, stack) => {
  if (!stack.dialectEnabled(Dialect_json5) || !stack.canShift(Identifier)) return
  let length = 0
  for (;;) {
    let text = '', width = 1
    if (input.peek(length) === 92 && input.peek(length + 1) === 117) {
      const hex = Array.from({ length: 4 }, (_, i) => String.fromCharCode(input.peek(length + 2 + i))).join('')
      if (!/^[0-9a-f]{4}$/i.test(hex)) break
      text = String.fromCharCode(parseInt(hex, 16)); width = 6
    } else {
      const first = input.peek(length)
      if (first < 0) break
      text = String.fromCharCode(first)
      if (first >= 0xd800 && first <= 0xdbff) { text += String.fromCharCode(input.peek(length + 1)); width = 2 }
    }
    if (!(length ? /^[$\u200c\u200d\p{ID_Continue}]$/u : /^[$_\p{ID_Start}]$/u).test(text)) break
    length += width
  }
  if (length) { input.advance(length); input.acceptToken(Identifier) }
}, { contextual: true })


/** JSON5 quoted strings, including line continuations and the restricted zero escape. */
export const strings = new ExternalTokenizer((input, stack) => {
  if (!stack.dialectEnabled(Dialect_json5) || !stack.canShift(ExtendedString)) return
  const quote = input.next
  if (quote !== 34 && quote !== 39) return
  let length = 1
  for (;;) {
    const char = input.peek(length++)
    if (char < 0 || char === 10 || char === 13) return
    if (char === quote) { input.advance(length); input.acceptToken(ExtendedString); return }
    if (char !== 92) continue
    const escape = input.peek(length++)
    if (escape < 0 || (escape >= 49 && escape <= 57)) return
    if (escape === 48 && input.peek(length) >= 48 && input.peek(length) <= 57) return
    if (escape === 13 && input.peek(length) === 10) length++
    if (escape === 117 || escape === 120) {
      for (let i = 0; i < (escape === 117 ? 4 : 2); i++) {
        if (!/^[0-9a-f]$/i.test(String.fromCharCode(input.peek(length++)))) return
      }
    }
  }
}, { contextual: true })
