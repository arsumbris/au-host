import type { ComponentPropsWithoutRef, ReactElement } from 'react'
import clsx from 'clsx'
import './Chevron.css'

export interface ChevronProps extends ComponentPropsWithoutRef<'button'> {
  /** Disclosure state — `true` rotates the glyph from pointing-right to pointing-down. */
  open?: boolean
  /** Accessible label; defaults to Collapse/Expand based on `open`. */
  label?: string
}

/* The 16-box chevron, in ONE place: the Select and Combobox triggers, an Accordion header and the
 * Table sort caret all render THIS, so retuning the shape is one edit and not six. Deliberately NOT
 * `Icon` — Icon's alphabet is a 24 box on a 1.75 stroke scaled by the TYPE RAMP, while control chrome
 * sits in a fixed 16 box at 1.5, sized by its control's own CSS. */
export function ChevronGlyph({ className, ...rest }: ComponentPropsWithoutRef<'svg'>): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden="true"
      {...rest}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  )
}

/* A CHEVRON encodes disclosure state; a panel icon encodes panel visibility. Do not swap them. */
export function Chevron({
  open = false,
  label,
  className,
  type,
  ...rest
}: ChevronProps): ReactElement {
  return (
    <button
      type={type ?? 'button'}
      className={clsx('au-chevron', className)}
      data-open={open ? '' : undefined}
      aria-expanded={open}
      aria-label={label ?? (open ? 'Collapse' : 'Expand')}
      {...rest}
    >
      <ChevronGlyph className="au-chevron-icon" />
    </button>
  )
}
