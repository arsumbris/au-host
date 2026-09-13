import { useEffect, useRef } from 'react'
import { AVATAR_STYLE, createAvatar } from '@arsumbris/au-avatar'

/** Reuses the projection's Umbra rig and behavior, including its window-level pointer input. */
export function LauncherAvatar() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    // The companion portals to body when following. Its existing scope marker travels
    // with that portal, so styling and native pointer targeting work in both locations.
    const style = document.createElement('style')
    style.textContent = `@scope ([data-au-scope="launcher-avatar"]) { ${AVATAR_STYLE} }`
    document.head.append(style)
    const avatar = createAvatar(element, {character: 'umbra'})
    return () => { avatar.dispose(); style.remove() }
  }, [])
  return <div className="au-launcher-avatar" data-au-scope="launcher-avatar" ref={ref} />
}
