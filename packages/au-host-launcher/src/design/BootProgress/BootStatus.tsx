import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react'
import clsx from 'clsx'
import { StatusDot } from '../StatusDot/StatusDot'
import { BOOT_STATES, BOOT_STEPS, type BootState } from './BootProgress'
import './BootStatus.css'

export interface BootStatusProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** The current gate state. The status line CROSS-FADES between states — never a pop. */
  state: BootState
  /** Override the primary line for the active state. */
  label?: ReactNode
  /** Override the mono detail for the active state. */
  detail?: ReactNode
}

/** Is the engine actively working here? Drives the leading dot's "charged" (pulsing) tell. */
const WORKING: Record<BootState, boolean> = {
  idle: false,
  selected: false,
  starting: true,
  deriving: true,
  ready: false,
  entering: false,
}

/**
 * The startup flow carried as ATMOSPHERE, not chrome — the alternative to BootProgress. NO bar, NO
 * percentage, NO step counter: one quiet status line cross-fading between phases, led by a single
 * marker. The "something is happening" language lives in the MATERIAL around it, the orb's charge
 * and the mist's flow rising while the engine derives and settling when served (the launcher couples
 * those). The marker is a hollow ink ring at rest, a faint pulsing ring while the engine works, and
 * the one genuine hue — an `ok` dot with a soft glow — the instant the workspace is ready.
 */
export function BootStatus({ state, label, detail, className, ...rest }: BootStatusProps): ReactElement {
  const served = state === 'ready' || state === 'entering'
  const step = BOOT_STEPS[state]

  return (
    <div
      className={clsx('au-bootstatus', className)}
      data-state={state}
      data-served={served || undefined}
      role="status"
      aria-live="polite"
      aria-label={typeof label === 'string' ? label : step.label}
      {...rest}
    >
      <span className="au-bootstatus__marker" aria-hidden="true">
        {served ? (
          <StatusDot tone="ok" size="sm" glow pulse />
        ) : (
          <StatusDot
            tone="ink"
            variant="ring"
            size="sm"
            pulse={WORKING[state] || undefined}
            glow={WORKING[state] || undefined}
          />
        )}
      </span>

      {/* every line stacked in one cell; only the active one is opaque → a true cross-fade. */}
      <span className="au-bootstatus__lines">
        {BOOT_STATES.map((s) => {
          const active = s === state
          return (
            <span
              key={s}
              className="au-bootstatus__line"
              data-active={active || undefined}
              aria-hidden={active ? undefined : true}
            >
              <span className="au-bootstatus__label">
                {active && label != null ? label : BOOT_STEPS[s].label}
              </span>
              <span className="au-bootstatus__detail">
                {active && detail != null ? detail : BOOT_STEPS[s].detail}
              </span>
            </span>
          )
        })}
      </span>
    </div>
  )
}
