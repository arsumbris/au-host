import type { OpenSurface } from '@arsumbris/au-host-sdk'

/** Keep the list still across a projection remount; actual closes settle after the handoff window. */
export function stableOpenSurfaces(publish: (surfaces: OpenSurface[]) => void, delay = 160) {
  let shown: OpenSurface[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  const identities = (surfaces: OpenSurface[]) => new Set(surfaces.flatMap(s =>
    s.contents.map(c => `${s.surfaceId}\0${c.identity}`)))
  return {
    update(next: OpenSurface[]) {
      clearTimeout(timer)
      const incoming = identities(next)
      const removesContent = [...identities(shown)].some(id => !incoming.has(id))
      const commit = () => { shown = next; publish(next) }
      if (removesContent) timer = setTimeout(commit, delay)
      else commit()
    },
    dispose() { clearTimeout(timer) },
  }
}
