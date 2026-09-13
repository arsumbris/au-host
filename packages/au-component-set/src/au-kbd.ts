// au-kbd is a non-interactive keyboard-shortcut chip with monospace text and a soft inset hairline.
// The keys prop uses the shared shortcut formatter, including platform-specific Mod rendering.
// Alternatively, supply literal text through the default slot.

import { css, html } from 'lit'
import { AuElement } from './au-element'

function isMac(): boolean {
  if (typeof navigator === 'undefined') return true
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '')
}

function formatSegment(segment: string, mac: boolean): string {
  const lower = segment.toLowerCase()
  if (lower === 'mod') return mac ? '⌘' : 'Ctrl'
  if (lower === 'cmd' || lower === 'meta') return '⌘'
  if (lower === 'ctrl') return 'Ctrl'
  if (lower === 'shift') return mac ? '⇧' : 'Shift'
  if (lower === 'alt' || lower === 'option') return mac ? '⌥' : 'Alt'
  if (lower === 'arrowleft') return '←'
  if (lower === 'arrowright') return '→'
  if (lower === 'arrowup') return '↑'
  if (lower === 'arrowdown') return '↓'
  if (lower === 'escape' || lower === 'esc') return 'Esc'
  if (lower === 'tab') return 'Tab'
  if (lower === 'enter' || lower === 'return') return mac ? '⏎' : 'Enter'
  if (segment.length === 1) return segment.toUpperCase()
  return segment
}

function shortcutSegments(shortcut: string): string[] {
  if (shortcut === '-') return ['-']
  if (shortcut.endsWith('--')) return [...shortcut.slice(0, -2).split('-'), '-']
  return shortcut.split('-')
}

export function formatShortcut(shortcut: string, mac: boolean): string {
  return shortcutSegments(shortcut).map(segment => formatSegment(segment, mac)).join(mac ? '' : '+')
}

export class AuKbdElement extends AuElement {
  static properties = {
    keys: { type: String },
    mac: { type: Boolean },
  }

  declare keys?: string
  declare mac?: boolean

  static styles = css`
    :host {
      display: inline-flex;
      flex: none;
      vertical-align: middle;
    }
    .kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--au-space-0-5, 2px);
      box-sizing: border-box;
      min-inline-size: var(--au-lh-base, 20px);
      min-block-size: var(--au-lh-base, 20px);
      padding: var(--au-space-0-5, 2px) var(--au-space-1-5, 6px);
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
      letter-spacing: var(--au-ls-mono,-0.005em);
      font-variant-numeric: tabular-nums;
      font-weight: var(--au-w-medium, 500);
      color: var(--au-ink-3, #9a9a9a);
      background: var(--au-color-surface-1, #191b20);
      border-radius: var(--au-radius-sm,5px);
      /* the 1px inset hairline is the sanctioned raw exception. */
      box-shadow: inset 0 0 0 1px var(--au-line-2, rgba(255, 255, 255, 0.09));
      white-space: nowrap;
    }
  `

  render() {
    const content = this.keys != null
      ? shortcutSegments(this.keys).map((segment, index) => html`${index && !(this.mac ?? isMac()) ? '+' : ''}<span>${formatSegment(segment, this.mac ?? isMac())}</span>`)
      : html`<slot></slot>`
    return html`<kbd class="kbd" part="kbd">${content}</kbd>`
  }
}
