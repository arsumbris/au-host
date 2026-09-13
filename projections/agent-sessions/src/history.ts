import type { HostApp, DiscoveredAdapter } from '@arsumbris/au-host-app'
import { button, text } from './controls'

function compactSessionId(id: string, sessionIds: string[]): string {
  const suffixLength = 4
  let prefixLength = Math.min(8, id.length)
  while (
    prefixLength < id.length - suffixLength
    && sessionIds.some(candidate => candidate !== id && candidate.slice(0, prefixLength) === id.slice(0, prefixLength))
  ) prefixLength += 1
  return id.length > prefixLength + suffixLength
    ? `${id.slice(0, prefixLength)}…${id.slice(-suffixLength)}`
    : id
}

export function mountHistory(host: HostApp, container: HTMLElement, adapters: DiscoveredAdapter[], resume: (id: string) => Promise<void>, back: () => void) {
  let alive = true
    const panel = text('section', '', 'sessions-history-panel')
    panel.setAttribute('aria-label', 'Session history')
    const status = text('p', 'Loading sessions…', 'sessions-hint')
    status.setAttribute('role', 'status')
    const spinner = document.createElement('au-spinner'); spinner.setAttribute('size', 'sm')
    const list = document.createElement('au-scroll-area')
    list.className = 'sessions-history-list'
    list.setAttribute('axis', 'y')
    const refresh = button('Refresh', () => void load(), 'ghost')
    const heading = text('header', '', 'sessions-history-heading')
    heading.append(text('h3', 'Session history'), refresh)
    const backButton = button('', back, 'ghost')
    backButton.className = 'sessions-history-back'
    backButton.setAttribute('aria-label', 'Back to new session')
    const backIcon = document.createElement('au-icon')
    backIcon.setAttribute('name', 'chevron-left')
    backIcon.setAttribute('size', 'sm')
    backIcon.setAttribute('aria-hidden', 'true')
    backButton.append(backIcon, text('span', 'New session'))
    panel.append(heading, text('p', 'Resume a closed session with its original profile.', 'sessions-hint'), spinner, status, list, backButton)
    container.append(panel)
    const focusFrame = requestAnimationFrame(() => {
      if (alive && backButton.isConnected) backButton.focus({ preventScroll: true })
    })
    let generation = 0
    async function load() {
      const request = ++generation
      refresh.disabled = true; spinner.hidden = false; list.replaceChildren(); status.textContent = 'Loading sessions…'
      try {
        const result = await host.mcp.listDormant()
        if (!alive || request !== generation) return
        if (!result.ok) throw Error(result.error)
        status.textContent = result.sessions.length ? `${result.sessions.length} closed session${result.sessions.length === 1 ? '' : 's'}` : 'No closed sessions yet.'
        const sessions = [...result.sessions].sort((a,b) => b.lastActiveMs-a.lastActiveMs)
        const sessionIds = sessions.map(session => session.id)
        for (const session of sessions) {
          const adapter = adapters.find(a => a.name === session.harness)
          const row = text('section', '', 'sessions-history-item')
          const summary = text('div', '', 'sessions-history-summary')
          const identity = text('div', '', 'sessions-history-identity')
          const date = new Date(session.lastActiveMs)
          const stamp = date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          const profileLabel = session.profile?.split(/[\\/]/).pop()?.replace(/\.(yaml|yml)$/i, '')
          const shortId = compactSessionId(session.id, sessionIds)
          identity.append(text('strong', `${profileLabel || adapter?.label || 'Session'} · ${shortId}`), text('span', `${stamp} · Run ${session.run}`, 'sessions-hint'))
          if (profileLabel && adapter) identity.append(text('span', adapter.label, 'sessions-hint'))
          summary.append(identity)
          row.append(summary)
          const details = text('details', '', 'sessions-history-details')
          details.append(text('summary', 'Session details'), text('span', 'Session ID', 'sessions-hint'), text('code', session.id))
          if (session.profile) details.append(text('span', `Profile: ${session.profile}`, 'sessions-hint'))
          if (session.harness) details.append(text('span', `Adapter: ${session.harness}`, 'sessions-hint'))
          details.append(text('span', `Stored data: ${new Intl.NumberFormat().format(session.sizeBytes)} bytes`, 'sessions-hint'))
          const action = button('Resume', async () => {
            action.disabled = true; action.loading = true
            try { await resume(session.id) }
            catch (error) { if (!alive) return; status.textContent = error instanceof Error ? error.message : String(error); action.disabled = false }
            finally { if (alive) { action.loading = false; action.disabled = false } }
          })
          action.disabled = !session.resumeRef || !adapter
          if (action.disabled) {
            summary.append(text('span', 'Unavailable', 'sessions-hint'))
            row.append(text('p', !session.resumeRef ? 'This session has no saved launch details.' : 'Its adapter is not available in this workspace.', 'sessions-hint'))
          } else summary.append(action)
          row.append(details)
          list.append(row)
        }
      } catch(error) { if(alive) status.textContent = error instanceof Error ? error.message : String(error) }
      finally { if(alive && request === generation) { spinner.hidden = true; refresh.disabled = false } }
    }
    void load()
  return () => { alive = false; cancelAnimationFrame(focusFrame); panel.remove() }
}
