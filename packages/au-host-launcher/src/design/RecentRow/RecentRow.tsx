import clsx from 'clsx'
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react'
import { StatusDot } from '../StatusDot/StatusDot'
import './RecentRow.css'

export type RecentRowStatus = 'none' | 'live' | 'stale'

export interface RecentRowProps extends Omit<ComponentPropsWithoutRef<'button'>, 'name'> {
  name: ReactNode
  /** Secondary mono line — path, timestamp, branch… */
  meta: ReactNode
  /** `live` = an ok dot with a pulsing glow, `stale` = a hollow ring. `lead` overrides it. */
  status?: RecentRowStatus
  /** Override the leading slot (an <Icon/> or bespoke marker) instead of the status dot. */
  lead?: ReactNode
  selected?: boolean
}

/* The same monochrome emphasis ladder as NavItem — surface lift on hover, surface-2 + hairline ring
 * when selected, NEVER a left accent bar. */
export function RecentRow({
  name,
  meta,
  status = 'none',
  lead,
  selected = false,
  type,
  className,
  ...rest
}: RecentRowProps): ReactElement {
  const marker =
    lead ??
    (status === 'live' ? (
      <StatusDot tone="ok" size="sm" glow pulse aria-label="Live" />
    ) : status === 'stale' ? (
      <StatusDot tone="ink" variant="ring" size="sm" aria-label="Stale" />
    ) : null)

  return (
    <button
      type={type ?? 'button'}
      className={clsx('au-recent-row', className)}
      data-selected={selected ? '' : undefined}
      aria-current={selected ? 'true' : undefined}
      {...rest}
    >
      {marker != null ? (
        <span className="au-recent-row__lead" aria-hidden={lead == null ? undefined : 'true'}>
          {marker}
        </span>
      ) : null}
      <span className="au-recent-row__body">
        <span className="au-recent-row__name">{name}</span>
        <span className="au-recent-row__meta">{meta}</span>
      </span>
    </button>
  )
}
