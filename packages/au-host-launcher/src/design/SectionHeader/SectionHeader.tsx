import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react'
import clsx from 'clsx'
import { Chevron } from '../Chevron/Chevron'
import './SectionHeader.css'

export interface SectionHeaderProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  title: ReactNode
  count?: ReactNode
  actions?: ReactNode
  /** Render a leading disclosure chevron; makes the header a collapse control. */
  collapsible?: boolean
  open?: boolean
  onToggle?: () => void
  /** Structure-locked group: no reorder/collapse; label reads quieter. */
  locked?: boolean
  /** Step the label up to the sans reading face (`--au-t-sm` / `--au-ink-2`) for a NAMED panel
   *  section; off, it is the quiet mono group-header that recedes in a sidebar. FACE ONLY — weight,
   *  caps and tracking are their own axes. */
  sans?: boolean
  /** Opt IN to the mono uppercase eyebrow. Default `false`: a section header names a group and reads
   *  in sentence case. `true` ONLY where the label is genuinely machine-ish (a status / enum group). */
  caps?: boolean
}

/* Stateless — the container owns collapse state. */
export function SectionHeader({
  title,
  count,
  actions,
  collapsible,
  open = true,
  onToggle,
  locked,
  sans,
  caps = false,
  className,
  ...rest
}: SectionHeaderProps): ReactElement {
  const interactive = collapsible && !locked
  return (
    <div
      className={clsx('au-section-header', className)}
      data-collapsible={interactive ? '' : undefined}
      data-locked={locked ? '' : undefined}
      data-sans={sans ? '' : undefined}
      data-caps={caps ? 'on' : undefined}
      onClick={interactive ? onToggle : undefined}
      {...rest}
    >
      {collapsible ? (
        <Chevron
          open={open}
          disabled={locked}
          label={open ? 'Collapse section' : 'Expand section'}
          onClick={(e) => {
            e.stopPropagation()
            onToggle?.()
          }}
        />
      ) : null}
      <span className="au-section-header-label">{title}</span>
      {count != null ? <span className="au-section-header-count">{count}</span> : null}
      {actions != null ? <div className="au-section-header-actions">{actions}</div> : null}
    </div>
  )
}
