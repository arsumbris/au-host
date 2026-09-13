import { useEffect, useRef } from 'react'
import type { MountHost } from '@arsumbris/au-host-sdk'
import { mountSourceView, type SourceViewSnapshot } from '@arsumbris/code-syntax/view'

export function SourceView({ source, language, numbered, host, path }: {
  source: string; language: string; numbered: boolean; host?: MountHost; path?: string | null
}) {
  const element = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!element.current) return
    const key = `reader.source.${path ?? language}`
    return mountSourceView(element.current, {
      source, language, numbered,
      snapshot: host?.viewStore?.get(key) as SourceViewSnapshot | undefined,
      onSnapshot: snapshot => host?.viewStore?.set(snapshot, key),
    })
  }, [source, language, numbered, host, path])
  return <div ref={element} className="au-reader-source-view" />
}
