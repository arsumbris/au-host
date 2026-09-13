import { useCallback, useRef, useState } from 'react'

/** Width below which an independently embedded sidebar uses its icon rail. */
const NARROW_THRESHOLD_PX = 140

export function useSidebarNarrowing() {
  // Geometry handles ordinary embedding; a containing region's target sizing starts the fade
  // before its first animation frame. Width decreases alone never imply a collapse.
  const [narrowed, setNarrowed] = useState(false)
  const [collapsing, setCollapsing] = useState(false)
  const cleanupMeasureRef = useRef<(() => void) | null>(null)
  const measureRef = useCallback((el: Element | null): void => {
    cleanupMeasureRef.current?.()
    cleanupMeasureRef.current = null
    if (!el || typeof ResizeObserver === 'undefined') return
    const region = el.closest<HTMLElement>('.au-sw-left, .au-sw-right')
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timer: ReturnType<typeof setTimeout> | undefined
    let frame = 0
    let revealFrame = 0
    let mini: boolean | undefined
    const cancel = (): void => {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      cancelAnimationFrame(revealFrame)
    }
    const update = (): void => {
      const resizing = region?.hasAttribute('data-resizing') ?? false
      const sizing = region?.getAttribute('data-sizing')
      const next = sizing && !resizing ? sizing !== 'free' : el.getBoundingClientRect().width <= NARROW_THRESHOLD_PX
      if (next === mini) return
      cancel()
      const immediate = mini === undefined || resizing || motion.matches
      mini = next
      if (immediate) {
        setNarrowed(next)
        setCollapsing(next)
      } else if (next) {
        setCollapsing(true)
        const token = getComputedStyle(el).getPropertyValue('--au-m-base').trim()
        const duration = Number.parseFloat(token) * (token.endsWith('ms') ? 1 : 1000)
        timer = setTimeout(() => setNarrowed(true), Number.isFinite(duration) ? duration : 220)
      } else {
        setNarrowed(false)
        frame = requestAnimationFrame(() => {
          revealFrame = requestAnimationFrame(() => setCollapsing(false))
        })
      }
    }
    const resize = new ResizeObserver(update)
    resize.observe(el)
    const mutation = new MutationObserver(update)
    if (region) mutation.observe(region, { attributes: true, attributeFilter: ['data-sizing', 'data-resizing'] })
    const onMotionChange = (): void => { mini = undefined; update() }
    motion.addEventListener('change', onMotionChange)
    update()
    cleanupMeasureRef.current = () => {
      cancel()
      resize.disconnect()
      mutation.disconnect()
      motion.removeEventListener('change', onMotionChange)
    }
  }, [])

  return { narrowed, collapsing, measureRef }
}
