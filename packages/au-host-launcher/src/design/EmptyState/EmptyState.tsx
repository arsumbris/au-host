import clsx from 'clsx'
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react'
import './EmptyState.css'

export interface EmptyStateProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  icon?: ReactNode
  title: ReactNode
  hint?: ReactNode
  /** A call-to-action node. The kit ships `.au-empty-cta` for a caller's own <button> to wear. */
  action?: ReactNode
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
  ...rest
}: EmptyStateProps): ReactElement {
  return (
    <div className={clsx('au-empty', className)} {...rest}>
      {icon ? (
        <span className="au-empty-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className="au-empty-title">{title}</p>
      {hint ? <p className="au-empty-hint">{hint}</p> : null}
      {action}
    </div>
  )
}
