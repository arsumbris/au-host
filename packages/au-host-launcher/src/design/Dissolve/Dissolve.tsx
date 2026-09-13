import type { CSSProperties, ReactElement, ReactNode } from 'react'
import clsx from 'clsx'
import type { DissolvePhase } from './useDissolveEnter'
import './Dissolve.css'

export interface DissolveProps {
  phase: DissolvePhase
  /** Tween length (ms) — SHARED with the mist so CSS and shader run on one clock. */
  duration?: number
  stagger?: number
  launcher: ReactNode
  app: ReactNode
  className?: string
  style?: CSSProperties
}

/* `launcher` stacked over `app` in one positioned box, transform+opacity only. The mist dissolve is
 * driven SEPARATELY by useDissolveEnter on the same duration, so the smoke blows off exactly as the
 * launcher clears. */
export function Dissolve({
  phase,
  duration = 800,
  stagger = 70,
  launcher,
  app,
  className,
  style,
}: DissolveProps): ReactElement {
  const vars = {
    '--au-dissolve-dur': `${duration}ms`,
    '--au-dissolve-stagger': `${stagger}ms`,
  } as CSSProperties

  return (
    <div className={clsx('au-dissolve', className)} data-phase={phase} style={{ ...vars, ...style }}>
      <div className="au-dissolve__layer au-dissolve__app" inert={phase !== 'done'} aria-hidden={phase === 'idle' ? true : undefined}>
        {app}
      </div>
      <div className="au-dissolve__layer au-dissolve__launcher" inert={phase !== 'idle'} aria-hidden={phase !== 'idle' ? true : undefined}>
        {launcher}
      </div>
    </div>
  )
}
