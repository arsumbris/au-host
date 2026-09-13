import { highlightCode } from '@arsumbris/code-syntax'
import { stringify } from 'yaml'

/** Display engine values as YAML, using the same parser and syntax roles as Reader. */
export function valueView(value: unknown): HTMLElement {
  const pre = document.createElement('pre')
  pre.className = 'au-ti-value'
  if (value === undefined) {
    pre.textContent = 'Not set'
    pre.classList.add('absent')
    return pre
  }
  const code = stringify(value, { lineWidth: 0 }).trimEnd()
  for (const part of highlightCode(code, 'yaml')) {
    const span = document.createElement('span')
    span.textContent = part.text
    if (part.className) span.className = part.className
    pre.append(span)
  }
  return pre
}
