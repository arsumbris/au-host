import type { CodeSpan } from '@arsumbris/code-syntax'

/** Split highlighted runs at authored newlines without adding copyable gutter text. */
export function codeLines(spans: readonly CodeSpan[]): CodeSpan[][] {
  const lines: CodeSpan[][] = [[]]
  for (const span of spans) {
    const parts = span.text.split('\n')
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] || i < parts.length - 1) lines[lines.length - 1]!.push({ ...span, text: parts[i] + (i < parts.length - 1 ? '\n' : '') })
      if (i < parts.length - 1) lines.push([])
    }
  }
  return lines
}
