import clsx from 'clsx'
import type { ComponentPropsWithoutRef, ReactElement } from 'react'
import './Kbd.css'

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return true
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '')
}

export function formatShortcut(shortcut: string, mac: boolean = isMacPlatform()): string {
  return shortcut
    .split('-')
    .map((segment) => formatShortcutSegment(segment, mac))
    .join('')
}

function formatShortcutSegment(segment: string, mac: boolean): string {
  const lower = segment.toLowerCase()
  if (lower === 'mod') return mac ? '⌘' : 'Ctrl'
  if (lower === 'cmd' || lower === 'meta') return '⌘'
  if (lower === 'ctrl') return 'Ctrl'
  if (lower === 'shift') return '⇧'
  if (lower === 'alt' || lower === 'option') return mac ? '⌥' : 'Alt'
  if (lower === 'arrowleft') return '←'
  if (lower === 'arrowright') return '→'
  if (lower === 'arrowup') return '↑'
  if (lower === 'arrowdown') return '↓'
  if (lower === 'escape' || lower === 'esc') return 'Esc'
  if (lower === 'tab') return 'Tab'
  if (lower === 'enter' || lower === 'return') return '⏎'
  if (segment.length === 1) return segment.toUpperCase()
  return segment
}

export interface KbdProps extends ComponentPropsWithoutRef<'kbd'> {
  /** A keymap string (`Mod-Shift-t`) — rendered through `formatShortcut`. */
  keys?: string
  /** Force macOS glyphs (defaults to platform detection). */
  mac?: boolean
}

/* `keys` for a formatted keymap string, `children` for literal content. */
export function Kbd({ keys, mac, className, children, ...rest }: KbdProps): ReactElement {
  const content = keys != null ? formatShortcut(keys, mac) : children
  return (
    <kbd className={clsx('au-kbd', className)} {...rest}>
      {content}
    </kbd>
  )
}
