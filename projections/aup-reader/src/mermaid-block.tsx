import { useEffect, useState } from 'react'
import { CodeBlock } from './code-block'

// A ```mermaid fence renders as a diagram. Mermaid is loaded on first use and configured per render,
// because its config is global and the active theme may have changed since the last diagram.
// securityLevel 'strict' sanitises the generated SVG and disables click handlers inside diagrams.
// A definition that fails to parse falls back to the plain code block plus the parser's message.

let renderCount = 0

type Rendered = { status: 'pending' } | { status: 'ok'; svg: string } | { status: 'error'; message: string }

async function renderMermaid(source: string): Promise<string> {
  const { default: mermaid } = await import('mermaid')
  const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark')
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' })
  // Parse first: a failed render() leaves Mermaid's own error graphic attached to document.body.
  await mermaid.parse(source)
  const { svg } = await mermaid.render(`au-mermaid-${++renderCount}`, source)
  return svg
}

export function MermaidBlock({ code }: { code: string }) {
  const [state, setState] = useState<Rendered>({ status: 'pending' })
  useEffect(() => {
    let live = true
    renderMermaid(code).then(
      (svg) => { if (live) setState({ status: 'ok', svg }) },
      (err: unknown) => { if (live) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) }) },
    )
    return () => { live = false }
  }, [code])

  if (state.status === 'ok') return <div className="au-reader-mermaid" role="img" dangerouslySetInnerHTML={{ __html: state.svg }} />
  return (
    <>
      <CodeBlock code={code} language="mermaid" />
      {state.status === 'error' && <p className="au-reader-mermaid-error">Diagram error: {state.message}</p>}
    </>
  )
}
