// The `notifications` surfacer projection: the status-bar BELL (`notification-status`).

// It handles the `ui-notification` BROADCAST typed capability — the host fans every fired
// notification out to every mounted surfacer (intent-channel.ts). The bell is an INDEPENDENT
// surfacer: a persistent status-bar indicator + unread-count badge, orthogonal to the host-owned
// toast frame. The unread count is surfacer-OWNED display
// state derived from the observed broadcasts, never persisted. Plain DOM, no framework.


import { defineProjection, type MountHost } from '@arsumbris/au-host-sdk'
import type { UiNotification } from '@arsumbris/intent'

type Severity = UiNotification['severity']

// A distinct glyph per severity, for the brief severity tint below.
const GLYPH: Record<Severity, string> = { info: 'ℹ', warn: '▲', error: '⨯' }

// A monochrome bell, drawn with currentColor so it inherits the theme text color.
const BELL_SVG =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">' +
  '<path d="M8 1.6a1 1 0 0 1 1 1v.35a3.75 3.75 0 0 1 2.75 3.6v1.9l.86 1.72a.55.55 0 0 1-.49.8H3.88a.55.55 0 0 1-.49-.8l.86-1.72v-1.9A3.75 3.75 0 0 1 7 2.95V2.6a1 1 0 0 1 1-1Z"/>' +
  '<path d="M6.4 12.4a1.6 1.6 0 0 0 3.2 0Z"/></svg>'

const STATUS_STYLE = `
.au-notif-bell {
  position: relative; cursor: pointer; background: none; border: none; padding: 0 var(--au-space-1);
  display: inline-flex; align-items: center; gap: var(--au-space-1); height: 100%;
  color: var(--au-ink-3); line-height: 1;
  transition: color var(--au-m-fast) var(--au-e-std);
}
.au-notif-bell:focus-visible { outline: 1px solid var(--au-focus-outer); outline-offset: -1px; border-radius: var(--au-radius-sm); }
@media (forced-colors: active) { .au-notif-bell:focus-visible { outline-color: Highlight; } }
.au-notif-bell:hover { color: var(--au-ink-1); }
.au-notif-bell.recent.info  { color: var(--au-color-accent); }
.au-notif-bell.recent.warn  { color: var(--au-color-warn); }
.au-notif-bell.recent.error { color: var(--au-color-danger); }
.au-notif-badge { flex: none; }
.au-notif-badge[hidden] { display: none; }
@media (prefers-reduced-motion: reduce) { .au-notif-bell { transition: none; animation: none; } }

`

function mountStatus(container: HTMLElement, host: MountHost): () => void {
  // Bell chrome scoped to this pane by the host (`@scope`-wrapped, CSP-exempt), not a raw `<style>`.
  const disposeStyles = host.styles?.inject(STATUS_STYLE, container)
  const bell = document.createElement('button')
  bell.className = 'au-notif-bell'
  bell.type = 'button'
  bell.title = 'No unseen notifications'
  bell.setAttribute('aria-label', bell.title)
  bell.innerHTML = BELL_SVG
  const badge = document.createElement('au-badge')
  badge.setAttribute('variant', 'count')
  badge.setAttribute('tone', 'danger')
  badge.className = 'au-notif-badge'
  badge.hidden = true
  bell.appendChild(badge)
  container.append(bell)

  let unseen = 0
  let recentTimer = 0
  function renderBadge(): void {
    if (unseen > 0) {
      badge.textContent = unseen > 99 ? '99+' : String(unseen)
      badge.hidden = false
      bell.title = `${unseen} unseen notification${unseen === 1 ? '' : 's'} — mark all seen`
    } else {
      badge.hidden = true
      bell.title = 'No unseen notifications'
    }
    bell.setAttribute('aria-label', bell.title)
  }

  const off = host.intent.handle('ui-notification', {
    claim: () => true, // broadcast observer — claim is ignored for a broadcast fan-out; always commit.
    commit: (intent) => {
    const n = intent as unknown as UiNotification
    unseen += 1
    renderBadge()
    // Briefly tint the bell by the latest severity, so a new notification is noticeable
    // even at a glance (the badge alone is small).
    const sev: Severity = GLYPH[n.severity] ? n.severity : 'info'
    bell.className = `au-notif-bell recent ${sev}`
    window.clearTimeout(recentTimer)
    recentTimer = window.setTimeout(() => {
      bell.className = 'au-notif-bell'
    }, 2500)
    },
  })

  // Click the bell to mark everything seen.
  bell.addEventListener('click', () => {
    unseen = 0
    renderBadge()
  })

  return () => {
    off()
    window.clearTimeout(recentTimer)
    disposeStyles?.()
    container.replaceChildren()
  }
}

// --- a sample notification CONTENT RENDERER (ui-notification-progress) ------
//
// Proves the type-keyed content slot: the host loads this via the subtype's `notification-content-meta`
// locator and calls it to draw the CONTENT into the host-owned toast frame (the frame + lifecycle stay
// the host's). It reads the subtype's extra `percent` field and draws a progress bar. Signature matches
// the host's NotificationContentRenderer `(notification, element, fireAction) => void`.

interface ProgressNotification {
  message?: string
  percent?: number
}

function renderProgress(n: ProgressNotification, el: HTMLElement): void {
  const pct = Math.max(0, Math.min(100, Math.round(n.percent ?? 0)))
  const toast = document.createElement('au-toast')
  const meter = document.createElement('au-meter')
  meter.setAttribute('value', String(pct / 100))
  meter.setAttribute('label', n.message || 'Progress')
  meter.setAttribute('value-label', `${pct}%`)
  toast.append(meter)
  el.append(toast)
}

// The `status` surface (the bell) rides the branded default, resolved by the `export: status` locator.
// `renderProgress` stays a RAW named export: it is a notification-content renderer, not a projection
// surface, and the host's content-renderer loader reads it off the raw module (see the module-contract
// generic module-loader contract).
export { renderProgress }
export default defineProjection({ status: mountStatus })
