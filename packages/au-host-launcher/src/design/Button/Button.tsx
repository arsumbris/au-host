import { forwardRef } from 'react'
import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react'
import clsx from 'clsx'
import './Button.css'

export type ButtonVariant = 'solid' | 'ghost' | 'outline' | 'cta'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  /** solid (quiet default) · ghost · outline · cta (the one off-white loud button). */
  variant?: ButtonVariant
  /** sm/md/lg = 28/32/40 tall (7/8/10 × the 4px base step). Default md. */
  size?: ButtonSize
  /** Shows a token-timed spinner, hides the label, and disables interaction. */
  loading?: boolean
  children?: ReactNode
}

/* Children ride in a `.au-btn__label` span so `loading` can hide the label under the spinner
 * without collapsing the button's rhythm. */
function ButtonImpl(
  {
    variant = 'solid',
    size = 'md',
    loading = false,
    className,
    type = 'button',
    disabled,
    children,
    ...rest
  }: ButtonProps,
  ref: Ref<HTMLButtonElement>,
): ReactNode {
  const isDisabled = disabled === true || loading
  return (
    <button
      ref={ref}
      type={type}
      className={clsx('au-btn', className)}
      data-variant={variant}
      disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      {...(size !== 'md' ? { 'data-size': size } : {})}
      {...(loading ? { 'data-loading': '' } : {})}
      {...rest}
    >
      <span className="au-btn__label">{children}</span>
    </button>
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(ButtonImpl)
Button.displayName = 'Button'
