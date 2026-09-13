import { useEffect, useState } from 'react'
import type { MountHost } from '@arsumbris/au-host-sdk'

/** Resolve document-relative images through the host's existing asset capability. */
export function MarkdownImage({ source, alt, path, host }: { source: string; alt: string; path: string | null; host: MountHost }) {
  const external = /^(https?:)?\/\//i.test(source)
  const identity = `${path ?? ''}\0${source}`
  const [resolved, setResolved] = useState<{ source: string; url: string | null } | null>(null)
  useEffect(() => {
    if (external || !source) return
    let live = true
    const folder = path?.replace(/\\/g, '/').split('/').slice(0, -1).join('/') ?? ''
    const segments: string[] = []
    const raw = source.startsWith('/') ? source.slice(1) : [folder, source].filter(Boolean).join('/')
    for (const segment of raw.split('/')) {
      if (segment === '.' || !segment) continue
      if (segment === '..') { if (!segments.length) return; segments.pop() }
      else segments.push(segment)
    }
    let ref = segments.join('/')
    try { ref = decodeURIComponent(ref) } catch { /* Retain literal malformed URL escapes. */ }
    void (host.assets?.url(ref) ?? Promise.resolve(null)).then(url => { if (live) setResolved({ source: identity, url }) })
    return () => { live = false }
  }, [source, path, host, external, identity])
  const url = external ? source : resolved?.source === identity ? resolved.url : null
  if (!url) return <span className="au-md__image-fallback" role="img" aria-label={alt || 'Image'}>{alt || 'Image'}{resolved?.source === identity ? ' — image unavailable' : ''}</span>
  return <img className="au-md__img" src={url} alt={alt} loading="lazy" />
}
