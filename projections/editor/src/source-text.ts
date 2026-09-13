import { makeByteToChar } from '@arsumbris/preview-content'
import { MapMode, RangeSet, RangeValue, StateEffect, StateField, Text, type EditorState } from '@codemirror/state'
import { invertedEffects } from '@codemirror/commands'

class LineEnding extends RangeValue {
  constructor(readonly text: string) { super() }
  override startSide = 1
  override endSide = -1
  override mapMode = MapMode.TrackDel
  override eq(other: LineEnding): boolean { return this.text === other.text }
}
interface SourceLayout { endings: RangeSet<LineEnding>; preferred: string }
export const loadSourceLayout = StateEffect.define<SourceLayout>()
const sourceLayout = StateField.define<SourceLayout>({
  create: () => ({ endings: RangeSet.empty, preferred: '\n' }),
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(loadSourceLayout)) return effect.value
    return tr.docChanged ? { ...value, endings: value.endings.map(tr.changes) } : value
  },
})

/** Keep authored line separators separate from CodeMirror's normalized positions. */
export function readSource(source: string) {
  const endings = []
  let removed = 0
  let preferred = '\n'
  for (const match of source.matchAll(/\r\n|\r|\n/g)) {
    if (!endings.length) preferred = match[0]
    const from = match.index! - removed
    endings.push(new LineEnding(match[0]).range(from, from + 1))
    removed += match[0].length - 1
  }
  return { doc: Text.of(source.split(/\r\n|\r|\n/)), layout: { endings: RangeSet.of(endings), preferred } }
}
export const preserveSourceText = [
  sourceLayout,
  invertedEffects.of(tr => tr.docChanged ? [loadSourceLayout.of(tr.startState.field(sourceLayout))] : []),
]
export function writeSource(state: EditorState): string {
  const { endings, preferred } = state.field(sourceLayout)
  const cursor = endings.iter()
  const chunks: string[] = []
  let position = 0
  for (const line of state.doc.iterLines()) {
    chunks.push(line)
    position += line.length
    if (position < state.doc.length) {
      while (cursor.value && cursor.from < position) cursor.next()
      chunks.push(cursor.value && cursor.from === position ? cursor.value.text : preferred)
      position++
    }
  }
  return chunks.join('')
}

/** Translate wire bytes over the authored file into normalized editor positions. */
export function sourceByteToChar(state: EditorState): (byte: number) => number {
  const source = writeSource(state)
  const toChar = makeByteToChar(source)
  const extra = [...source.matchAll(/\r\n/g)].map(match => match.index! + 1)
  return byte => {
    const position = toChar(byte)
    let low = 0, high = extra.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (extra[mid]! < position) low = mid + 1
      else high = mid
    }
    return position - low
  }
}
