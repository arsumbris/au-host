import type { MountHost } from '@arsumbris/au-host-sdk'
import { SourceView } from './source-view'
import { useMemo } from 'react'
import { highlightCode, type CodeSpan } from '@arsumbris/code-syntax'
import { codeLines } from './code-lines'

function runs(spans: readonly CodeSpan[]) {
  return spans.map((span, i) => span.className ? <span key={i} className={span.className}>{span.text}</span> : span.text)
}
export function CodeBlock({ code, language = '', numbered = false, host, path }: { code: string; language?: string; numbered?: boolean; host?: MountHost; path?: string | null }) {
  const viewport = code.length > 50_000 || code.split('\n').length > 1000
  const spans = useMemo(() => viewport ? [] : highlightCode(code, language), [code, language, viewport])
  const lines = useMemo(() => numbered ? codeLines(spans) : null, [spans, numbered])
  return <div className="au-reader-code-frame"><au-code-block language={language} copy copy-text={code}><>{viewport ? <SourceView source={code} language={language} numbered={numbered} host={host} path={path} /> : <pre className={`au-reader-code${numbered ? ' au-reader-code-numbered' : ''}`}><code>{lines ? lines.map((line, i) => <span className="au-reader-code-line" data-line={i + 1} key={i}>{runs(line)}</span>) : runs(spans)}</code></pre>}</></au-code-block></div>
}
