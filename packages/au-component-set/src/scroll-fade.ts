import { css } from 'lit'

/** Fade content into the actual surface without painting an elevation or guessed background. */
export const horizontalScrollFade = css`
  mask-image: linear-gradient(to right, transparent, black var(--_fade-left, 0px),
    black calc(100% - var(--_fade-right, 0px)), transparent), linear-gradient(black, black);
  mask-size: 100% 100%, 100% var(--_scrollbar-height, 0px);
  mask-position: left top, left bottom;
  mask-repeat: no-repeat;
`

/** Chromium RTL scrolling is zero at the right edge and negative toward the left. */
export function measureHorizontalFade(el: HTMLElement): void {
  const max = Math.max(0, el.scrollWidth - el.clientWidth)
  const rtl = getComputedStyle(el).direction === 'rtl'
  const left = Math.max(0, Math.min(max, rtl ? max + el.scrollLeft : el.scrollLeft))
  const right = Math.max(0, max - left)
  for (const [edge, distance] of [['left', left], ['right', right]] as const) {
    el.style.setProperty(`--_fade-${edge}`, `min(var(--au-scroll-fade-size, var(--au-space-2, 8px)), ${distance < 1 ? 0 : distance}px)`)
  }
  el.style.setProperty('--_scrollbar-height', `${Math.max(0, el.offsetHeight - el.clientHeight)}px`)
}
