/** Literal path fragments embedded in gitignore rules, never authored pattern input. */
export function literalPatternText(text: string): string {
  if (/[\r\n]/.test(text)) throw Error('This name contains a line break and cannot be represented by one exclusion rule.')
  return text.replace(/[\\*?\[\]]/g, '\\$&').replace(/ +$/, spaces => '\\ '.repeat(spaces.length))
}

export function pathPattern(relative: string, directory: boolean, include = false): string {
  return `${include ? '!' : ''}/${literalPatternText(relative)}${directory ? '/' : ''}`
}

export function lineKind(line: string): 'blank' | 'comment' | 'pattern' {
  if (line.trim() === '') return 'blank'
  // A leading space is a literal part of a pattern; it does not introduce a comment.
  return line.startsWith('#') ? 'comment' : 'pattern'
}
