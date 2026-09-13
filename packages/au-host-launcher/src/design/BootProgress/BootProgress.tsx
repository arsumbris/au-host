import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react'
import clsx from 'clsx'
import './BootProgress.css'

/* Mirrors the real au-host gate lifecycle, in order. */
export type BootState = 'idle' | 'selected' | 'starting' | 'deriving' | 'ready' | 'entering'

/* Canonical order — the progress fraction and the cross-fade stack both read it. */
export const BOOT_STATES: readonly BootState[] = [
  'idle',
  'selected',
  'starting',
  'deriving',
  'ready',
  'entering',
]

interface BootStep {
  label: string
  detail: string
  progress: number
  /** The engine is actively working here → the indeterminate sweep rides the fill. */
  busy: boolean
}

/* Progress is MONOTONIC across the table; busy states carry the moving sweep. */
export const BOOT_STEPS: Record<BootState, BootStep> = {
  idle: { label: 'Ready when you are', detail: 'no workspace selected', progress: 0.04, busy: false },
  selected: { label: 'Workspace selected', detail: 'preparing to start', progress: 0.12, busy: false },
  starting: { label: 'Starting the engine', detail: 'Connecting to your workspace engine', progress: 0.36, busy: true },
  deriving: { label: 'Preparing your workspace', detail: 'Loading content and available tools', progress: 0.68, busy: true },
  ready: { label: 'Workspace ready', detail: 'Ready to open your layout', progress: 1, busy: false },
  entering: { label: 'Opening workspace', detail: 'Loading your views', progress: 1, busy: false },
}

export interface BootProgressProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  state: BootState
  /* A KNOWN progress (0..1) for the busy steps. Omitted, a busy step shows its own fraction plus an
   * indeterminate sweep — real movement while the length is unknown. */
  progress?: number
  label?: ReactNode
  detail?: ReactNode
}

/* All motion rides `--au-m-*` / `--au-e-*`; nothing is a hardcoded ms. Monochrome — the fill is ink
 * and the sweep a hairline sheen; the ONE hue is the live status dot at `ready`. */
export function BootProgress({
  state,
  progress,
  label,
  detail,
  className,
  ...rest
}: BootProgressProps): ReactElement {
  const step = BOOT_STEPS[state]
  const busy = step.busy
  const fill = progress ?? step.progress
  const pct = Math.max(0, Math.min(1, fill)) * 100
  const index = BOOT_STATES.indexOf(state)
  const done = state === 'ready' || state === 'entering'

  return (
    <div
      className={clsx('au-boot', className)}
      data-state={state}
      data-busy={busy || undefined}
      data-done={done || undefined}
      role="status"
      aria-live="polite"
      aria-label={typeof label === 'string' ? label : step.label}
      {...rest}
    >
      <div className="au-boot__track" aria-hidden="true">
        <div className="au-boot__fill" style={{ inlineSize: `${pct}%` }} />
        {busy ? <div className="au-boot__sweep" /> : null}
      </div>

      {/* ALL step labels stacked with only the active one shown, so the change is a true cross-fade. */}
      <div className="au-boot__status">
        <div className="au-boot__lines">
          {BOOT_STATES.map((s) => {
            const active = s === state
            const isLabelOverride = active && label != null
            const isDetailOverride = active && detail != null
            return (
              <div
                key={s}
                className="au-boot__line"
                data-active={active || undefined}
                aria-hidden={active ? undefined : true}
              >
                <span className="au-boot__label">{isLabelOverride ? label : BOOT_STEPS[s].label}</span>
                <span className="au-boot__detail">{isDetailOverride ? detail : BOOT_STEPS[s].detail}</span>
              </div>
            )
          })}
        </div>
        {/* Tabular, so the counter does not jitter as it advances. */}
        <span className="au-boot__count">
          {String(index + 1).padStart(2, '0')}
          <span className="au-boot__count-sep"> / </span>
          {String(BOOT_STATES.length).padStart(2, '0')}
        </span>
      </div>
    </div>
  )
}
