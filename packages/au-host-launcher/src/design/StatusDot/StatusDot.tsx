import clsx from 'clsx'
import type { ComponentPropsWithoutRef, ReactElement } from 'react'
import './StatusDot.css'

export type StatusDotTone = 'ink' | 'ok'
export type StatusDotVariant = 'filled' | 'ring'
export type StatusDotSize = 'sm' | 'md' | 'lg'

export interface StatusDotProps extends ComponentPropsWithoutRef<'span'> {
  tone?: StatusDotTone
  /** `filled` solid dot (default) or `ring` hollow stale-indicator. */
  variant?: StatusDotVariant
  /** Soft halo around the dot — the sync-pulse glow. */
  glow?: boolean
  /** Animate the glow as a pulse (collapses to static under reduced motion). */
  pulse?: boolean
  size?: StatusDotSize
}

export function StatusDot({
  tone = 'ink',
  variant = 'filled',
  glow = false,
  pulse = false,
  size = 'md',
  className,
  ...rest
}: StatusDotProps): ReactElement {
  // A dot is DECORATIVE beside text that already says the state (a tab, an accordion header), and it
  // IS the state when it is the only carrier (a tree row's dirty marker, a recent row's Live/Stale).
  // Hidden by default; a caller that names it is saying "this dot is the signal", so it keeps the
  // name and gets a role to hang it on. Same discipline as GripGlyph — the ARIA is the signal.
  const named = 'aria-label' in rest || 'aria-labelledby' in rest || 'role' in rest
  return (
    <span
      className={clsx('au-status-dot', className)}
      aria-hidden={named ? undefined : 'true'}
      role={named ? 'img' : undefined}
      data-tone={tone !== 'ink' ? tone : undefined}
      data-variant={variant !== 'filled' ? variant : undefined}
      data-size={size !== 'md' ? size : undefined}
      data-glow={glow ? '' : undefined}
      data-pulse={pulse ? '' : undefined}
      {...rest}
    />
  )
}
