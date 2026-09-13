// The trace inspector pane: reads the host event substrate and answers "why did the UI do that" for TWO
// readers at once.
//   - BASIC: each cause is ONE plain-language HEADLINE centered on the SUBJECT (the file) + the outcome —
//     "open «report.md» → asked". A story, no ids, no jargon. The default (collapsed) view.
//   - POWER: click a headline to EXPAND into readable per-event lines (requests / considers / claims /
//     resolves / chose), each with resolved actor names; "copy Perfetto trace" hands the raw timeline
//     (ids + timing + fields) to ui.perfetto.dev.
// Order is CHRONOLOGICAL (oldest at top, newest scrolls in at the bottom — terminal-style). Prose is DERIVED
// here (the events stay structured records, the event contract). Reads the substrate; the ONLY thing it fires
// is a navigate-to-source open-intent when a chip for an off-screen actor is clicked. Plain DOM.
// An actor CHIP answers "what is this and where does it come from": hover shows the definition site
// (projection type · composition file · `^:` node id) resolved via `host.children.locate`, and OUTLINES the
// actor's box if it is on screen. Click ALWAYS opens where it's defined (a navigate-to-source open-intent at
// its composition file). The two gestures are uniform — hover=highlight, click=go-to-source — regardless of
// whether the actor is currently visible; a chip is muted only when it has no known source at all.


import {
  defineProjection,
  type ProjectionModule,
  type MountHost,
  type HostEvent,
  type NodeLocation,
  bareTypeName,
  read,
  readConditions,
  stats,
  clear,
  subscribe,
  toChromeTrace,
} from '@arsumbris/au-host-sdk'
import { openIntent } from '@arsumbris/intent'
import { fileSelection } from '@arsumbris/selection'

const STYLE = `
.au-trace { container-type: inline-size; box-sizing: border-box; height: 100%; min-width: 0; min-height: 0; overflow: hidden; padding: var(--au-space-4); background: transparent; color: var(--au-color-text); font: var(--au-t-xs)/var(--au-lh-xs) var(--au-font-sans); display: flex; flex-direction: column; gap: var(--au-space-2); }
/* Preserve full event content in the scroll flow; long identities may wrap. */
.au-trace > * { flex-shrink: 0; min-width: 0; }
.au-trace-head, .au-trace-line, .au-trace-cond { flex-wrap: wrap; }
.au-trace-lead, .au-trace-outcome, .au-trace-phrase, .au-trace-id, .au-trace-chip { min-width: 0; overflow-wrap: anywhere; }
.au-trace-phrase { flex: 1 1 8em; }
.au-trace-bar { flex: none; }
.au-trace > .au-trace-scroll { flex: 1; min-height: 0; }
.au-trace-body { display: flex; flex-direction: column; gap: var(--au-space-2); padding-bottom: var(--au-space-2); }
.au-trace-export-status { color: var(--au-color-muted); overflow-wrap: anywhere; }
.au-trace-stat { color: var(--au-color-muted); margin-left: auto; font-variant-numeric: tabular-nums; }
.au-trace-drop { color: var(--au-color-warn); }
.au-trace-title { font-size: var(--au-t-2xs); font-weight: var(--au-w-strong); text-transform: uppercase; letter-spacing: var(--au-ls-label); color: var(--au-color-muted); margin-top: var(--au-space-1); }
.au-trace-list { display: flex; flex-direction: column; gap: var(--au-space-1); }

.au-trace-card { border: 1px solid var(--au-color-border); border-radius: var(--au-radius-sm); overflow: hidden; }
.au-trace-head { width: 100%; border: 0; background: transparent; color: inherit; font: inherit; text-align: start; display: flex; align-items: baseline; gap: var(--au-space-1-5); padding: var(--au-space-1-5) var(--au-space-2); cursor: pointer; }
.au-trace button:focus-visible { outline: 2px solid var(--au-focus-outer); outline-offset: -2px; }
.au-trace-head:hover { background: var(--au-chrome-hover); }
.au-trace-caret { color: var(--au-color-muted); width: 1em; flex: none; }
.au-trace-lead { font-weight: var(--au-w-strong); }
.au-trace-arrow { color: var(--au-color-muted); }
.au-trace-outcome { color: var(--au-color-accent); font-weight: var(--au-w-strong); }
.au-trace-outcome[data-tone="warn"] { color: var(--au-color-warn); }
.au-trace-count { color: var(--au-color-muted); margin-left: auto; font-variant-numeric: tabular-nums; flex: none; }

.au-trace-detail { border-top: 1px solid var(--au-color-border); padding: var(--au-space-1-5) var(--au-space-2); display: flex; flex-direction: column; gap: var(--au-space-0-5); font: var(--au-t-2xs)/var(--au-lh-2xs) var(--au-font-mono,ui-monospace, "SF Mono", monospace); }
.au-trace-line { display: flex; gap: var(--au-space-1-5); align-items: baseline; }
.au-trace-seq { color: var(--au-color-muted); min-width: 2.5em; text-align: right; flex: none; }
.au-trace-cat { color: var(--au-color-muted); min-width: 5.5em; flex: none; }
.au-trace-phrase { color: var(--au-color-text); }
.au-trace-actors { display: flex; gap: var(--au-space-1); flex-wrap: wrap; margin-bottom: var(--au-space-1); }
.au-trace-chip { font: inherit; background: transparent; color: inherit; text-align: start; padding: 0 var(--au-space-1-5); border: 1px solid var(--au-color-border); border-radius: var(--au-radius-pill); cursor: pointer; }
.au-trace-chip:hover { border-color: var(--au-color-accent); color: var(--au-color-accent); }
/* unactionable (no known source AND not on screen — e.g. another window): inert. */
.au-trace-chip[data-state="dead"] { opacity: var(--au-opacity-disabled); cursor: default; }

.au-trace-cond { display: flex; gap: var(--au-space-1-5); align-items: baseline; padding: var(--au-space-0-5) var(--au-space-2); }
.au-trace-cond + .au-trace-cond { border-top: 1px solid var(--au-color-border); padding-top: var(--au-space-2); }
@container (max-width: 520px) {
  .au-trace-cond { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--au-space-1); padding-block: var(--au-space-2); }
  .au-trace-cond > * { min-width: 0; }
}
.au-trace-sev-error { color: var(--au-color-danger); font-weight: var(--au-w-strong); }
.au-trace-sev-warning { color: var(--au-color-warn); font-weight: var(--au-w-strong); }
.au-trace-sev-hint { color: var(--au-color-muted); }
.au-trace-id { color: var(--au-ink-4); }
.au-trace-empty { color: var(--au-color-muted); padding: var(--au-space-2) 0; }
`

type Fields = Record<string, unknown>
const f = (e: HostEvent): Fields => e.fields ?? {}
const str = (v: unknown, fallback = ''): string => (v == null ? fallback : String(v))
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : [])
const base = (p: string): string => p.split('/').pop() || p
/** A friendly actor name: the projection type, bared of its `::repo` qualifier. */
const actor = (label: unknown, id: unknown): string => (label == null ? str(id) : bareTypeName(String(label)) || str(label))
const fileTag = (p: unknown): string => (p == null || p === '' ? '' : `«${base(String(p))}»`)

/** A capable handler's ambient-exclusion reason, in plain words. */
function exclusionReason(r: string): string {
  const map: Record<string, string> = { 'aimed-only': 'opens only when aimed at it', 'reach-closed': 'closed to ambient opens', filtered: 'filtered by a routing rule' }
  return map[r] ?? r
}

function friendlyIntent(type: string): string {
  const t = type.replace(/-intent$/, '')
  const map: Record<string, string> = { open: 'open', 'open-pane': 'open a pane', reveal: 'reveal', 'reveal-if-exists': 'reveal', promote: 'promote', 'show-pane': 'show', 'ui-notification': 'notify', 'ui-intent-highlight': 'highlight' }
  return map[t] ?? t
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

/** One readable line per event, for the EXPANDED (power) view. */
function phraseFor(e: HostEvent): string {
  const x = f(e)
  const who = actor(x.fromLabel, x.from)
  const owner = actor(x.ownerLabel, x.owner)
  const subj = fileTag(x.subject)
  switch (`${e.category}:${e.name}`) {
    case 'intent:fire':
      return `${who} requests ${friendlyIntent(str(x.type))}${subj ? ` ${subj}` : ''}  (${str(x.kind)}, ${str(x.dispatch)})`
    case 'intent:candidates': {
      const os = (arr(x.ownerLabels).length ? arr(x.ownerLabels) : arr(x.owners)).map((s) => bareTypeName(s) || s)
      const ex = (Array.isArray(x.excluded) ? x.excluded : []) as Array<{ label?: unknown; reason?: unknown }>
      const skipped = ex.length
        ? `  ·  capable but skipped: ${ex.map((e) => `${bareTypeName(str(e.label)) || str(e.label)} (${exclusionReason(str(e.reason))})`).join(', ')}`
        : ''
      return `considers ${os.join(', ') || '— no eligible container'}${skipped}`
    }
    case 'intent:claim':
      return `${owner} handles it`
    case 'intent:decline':
      return `${owner} declines`
    case 'intent:declined':
      return `${bareTypeName(str(x.by)) || str(x.by)} declines — ${str(x.reason)}`
    case 'intent:unhandled':
      return str(x.reason) === 'no-capable-handler' ? 'no container could take it' : 'every candidate declined'
    case 'intent:broadcast':
      return `broadcast to ${str(x.delivered)} handler(s)`
    case 'intent:aimed':
      return `delivered ${subj || friendlyIntent(str(x.type))} straight to ${actor(x.toLabel, x.to)}`
    case 'viewer:resolved':
      return `viewer → ${bareTypeName(str(x.viewer)) || str(x.viewer)}  (${str(x.how)})`
    case 'viewer:must-pick':
      return `needs a viewer — options: ${arr(x.options).map((s) => bareTypeName(s) || s).join(' / ')}`
    case 'viewer:no-viewer':
      return `no viewer can open ${fileTag(x.file) || 'this file'}`
    case 'chooser:open':
      return `asked you to choose: ${arr(x.options).join(' / ')}`
    case 'chooser:pick':
      return `you chose ${str(x.label, str(x.picked))}`
    case 'chooser:cancel':
      return `you dismissed the chooser`
    case 'placement:fixed-refused':
      return `refused — the slot is fixed (${str(x.gesture)})`
    case 'placement:admits-refused':
      return `refused — the slot admits only [${arr(x.admits).map((s) => bareTypeName(s) || s).join(', ')}], not ${bareTypeName(str(x.incoming)) || str(x.incoming)}`
    case 'resync:re-seed':
      return `${bareTypeName(str(x.subject)) || str(x.subject)} re-synced from an external edit`
    default:
      return Object.entries(x)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join('  ')
  }
}

interface Headline {
  lead: string
  outcome: string
  tone: 'ok' | 'warn'
}

/** The distinct ACTORS (publisher id → friendly name) a pass involved, so each becomes a locatable chip. */
function actorsOf(events: HostEvent[]): Array<{ id: string; label: string }> {
  const m = new Map<string, string>()
  const add = (id: unknown, label: unknown): void => {
    if (typeof id === 'string' && id && !m.has(id)) m.set(id, actor(label, id))
  }
  for (const e of events) {
    const x = f(e)
    add(x.from, x.fromLabel)
    add(x.owner, x.ownerLabel)
    add(x.to, x.toLabel)
    const ids = arr(x.owners)
    const labels = arr(x.ownerLabels)
    ids.forEach((id, i) => add(id, labels[i]))
  }
  return [...m.entries()].map(([id, label]) => ({ id, label }))
}

/** The one-line plain-language summary of a cause group (or a single uncaused event). */
function headlineFor(events: HostEvent[]): Headline {
  const fire = events.find((e) => e.category === 'intent' && e.name === 'fire')
  if (fire) {
    const x = f(fire)
    const subj = fileTag(x.subject)
    const lead = subj ? `${friendlyIntent(str(x.type))} ${subj}` : `${actor(x.fromLabel, x.from)} · ${friendlyIntent(str(x.type))}`
    // Prefer the FINAL resolution: with the async-cause bridge, one gesture is fire → unhandled → chooser →
    // aimed, and the true outcome is where it eventually opened (your pick), not the transient "no pane took it".
    const aimed = events.find((e) => e.category === 'intent' && e.name === 'aimed')
    const pick = events.find((e) => e.category === 'chooser' && e.name === 'pick')
    const resolved = events.find((e) => e.category === 'viewer' && e.name === 'resolved')
    const claim = events.find((e) => e.category === 'intent' && e.name === 'claim')
    const mustPick = events.find((e) => e.category === 'viewer' && e.name === 'must-pick')
    const unhandled = events.find((e) => e.category === 'intent' && e.name === 'unhandled')
    if (aimed) return { lead, outcome: `opened in ${actor(f(aimed).toLabel, f(aimed).to)} (your choice)`, tone: 'ok' }
    if (resolved) return { lead, outcome: `opened in ${bareTypeName(str(f(resolved).viewer)) || str(f(resolved).viewer)}`, tone: 'ok' }
    if (claim) return { lead, outcome: `handled by ${actor(f(claim).ownerLabel, f(claim).owner)}`, tone: 'ok' }
    if (pick) return { lead, outcome: `chose ${str(f(pick).label, str(f(pick).picked))}`, tone: 'ok' }
    if (mustPick) return { lead, outcome: `asked (${arr(f(mustPick).options).map((s) => bareTypeName(s) || s).join(' / ')})`, tone: 'warn' }
    if (unhandled) return { lead, outcome: str(f(unhandled).reason) === 'no-capable-handler' ? 'no container took it' : 'no pane took it', tone: 'warn' }
    return { lead, outcome: '', tone: 'ok' }
  }

  // single-event / uncaused groups
  const lead0 = events[0]
  const x = f(lead0)
  switch (`${lead0.category}:${lead0.name}`) {
    case 'intent:aimed':
      return { lead: `deliver ${fileTag(x.subject) || friendlyIntent(str(x.type))}`, outcome: actor(x.toLabel, x.to), tone: 'ok' }
    case 'chooser:open':
      return { lead: 'chooser asked', outcome: arr(x.options).join(' / '), tone: 'warn' }
    case 'chooser:pick':
      return { lead: 'chooser', outcome: `chose ${str(x.label, str(x.picked))}`, tone: 'ok' }
    case 'chooser:cancel':
      return { lead: 'chooser', outcome: 'dismissed', tone: 'warn' }
    case 'viewer:must-pick':
      return { lead: `viewer ${fileTag(x.file)}`, outcome: `pick (${arr(x.options).map((s) => bareTypeName(s) || s).join(' / ')})`, tone: 'warn' }
    case 'viewer:resolved':
      return { lead: `viewer ${fileTag(x.file)}`, outcome: bareTypeName(str(x.viewer)) || str(x.viewer), tone: 'ok' }
    case 'viewer:no-viewer':
      return { lead: `viewer ${fileTag(x.file)}`, outcome: 'no viewer', tone: 'warn' }
    case 'placement:fixed-refused':
      return { lead: `${str(x.gesture, 'placement')} refused`, outcome: 'slot is fixed', tone: 'warn' }
    case 'placement:admits-refused':
      return { lead: `${str(x.gesture, 'placement')} refused`, outcome: 'slot admits other types', tone: 'warn' }
    case 'resync:re-seed':
      return { lead: `${bareTypeName(str(x.subject)) || 'a container'} re-synced`, outcome: 'external edit', tone: 'ok' }
    default:
      return { lead: `${lead0.category} · ${lead0.name}`, outcome: '', tone: 'ok' }
  }
}

function mount(container: HTMLElement, host: MountHost): () => void {
  const root = el('div', 'au-trace')
  root.dataset.surface = 'inherit'
  const scroll = el('au-scroll-area', 'au-trace-scroll') as HTMLElement & { scrollElement: HTMLElement | null; updateComplete: Promise<boolean> }
  scroll.setAttribute('axis', 'y')
  const body = el('div', 'au-trace-body')
  scroll.append(body)
  // Component CSS scoped to this pane by the host (`@scope`-wrapped, CSP-exempt), never a raw
  // `<style>` in the render frag. Injected once; the `data-au-scope` marker on `root` survives the
  // per-render `replaceChildren` (which replaces root's CHILDREN, not root).
  const disposeStyles = host.styles?.inject(STYLE, container)

  const hidden = new Set<string>()
  const expanded = new Set<string>()
  let expandAll = false
  const collapsed = new Set<string>()
  let exportState: 'idle' | 'pending' | 'success' | 'error' = 'idle'
  let alive = true

  // LOCATE AN ACTOR ON SCREEN by its STABLE `^:` node id. The portal marks each pane's slot with
  // `data-pane-id={^:}` — so a plain DOM outline frames it (the mount-child / layout-inspector pattern), no
  // overlay layer. We key on the `^:`, NOT the publisher: a publisher is minted per-mount and dies on
  // remount (a content-replace / re-derive remounts the pane under a NEW publisher while REUSING the `^:`),
  // so the trace's now-dead publisher would no longer resolve — but its `^:` still points at the live pane.
  const paneElByNode = (nodeId: string | undefined): HTMLElement | null =>
    nodeId ? document.querySelector<HTMLElement>(`[data-pane-id="${nodeId}"]`) : null
  // The `^:` for an actor: prefer the site's (retained past unmount, so it survives the publisher's death);
  // fall back to the live publisher→`^:` map when there is no site.
  const nodeIdFor = (publisherId: string, site: NodeLocation | undefined): string | undefined =>
    site?.nodeId || host.children?.nodeIdOf?.(publisherId) || undefined
  const outline = (elm: HTMLElement | null, on: boolean): void => {
    if (!elm) return
    elm.style.outline = on ? '2px solid var(--au-color-accent)' : ''
    elm.style.outlineOffset = on ? '-2px' : ''
  }
  // The definition-site tooltip: what the actor IS and where it comes from. Works for an off-screen actor
  // (the site is retained past unmount), unlike the on-screen outline.
  const siteTooltip = (label: string, site: NodeLocation | undefined): string => {
    if (!site) return `${label} — no known source (another window, or never mounted here)`
    const where = site.compositionFile ? `defined in ${base(site.compositionFile)}${site.nodeId ? ` at ^${site.nodeId}` : ''}` : 'no known source'
    const bareType = site.type ? bareTypeName(site.type) || site.type : label
    return `${bareType} — ${where}  ·  hover to highlight · click to open its source`
  }
  // NAVIGATE TO SOURCE: open the composition file this actor is authored in (the "go to where it's defined"
  // half). An ambient open-intent, the same verb the file-tree opens a file with; the focused viewer takes it.
  const openSource = (site: NodeLocation | undefined): void => {
    if (site?.compositionFile) host.intent?.fire(openIntent(fileSelection(site.compositionFile), 'permanent'))
  }
  const chipFor = (a: { id: string; label: string }): HTMLElement => {
    const c = el('button', 'au-trace-chip', a.label) as HTMLButtonElement
    c.type = 'button'
    c.dataset.focusKey = `actor:${a.id}`
    const site = host.children?.locate?.(a.id)
    const nodeId = nodeIdFor(a.id, site)
    const findEl = (): HTMLElement | null => paneElByNode(nodeId)
    c.title = siteTooltip(a.label, site)
    // Only structural availability controls this state; being off-screen does not mute a container.
    const actionable = site != null || findEl() != null
    c.dataset.state = actionable ? 'live' : 'dead'
    if (!actionable) { c.disabled = true; return c }
    // HOVER = highlight the actor's on-screen box (resolved by its `^:`, so a remount under a new publisher
    // still highlights the live pane). No-op when the actor is not currently visible.
    c.addEventListener('mouseenter', () => outline(findEl(), true))
    c.addEventListener('mouseleave', () => outline(findEl(), false))
    c.addEventListener('focus', () => outline(findEl(), true))
    c.addEventListener('blur', () => outline(findEl(), false))
    // CLICK = always go to where it's defined. Open the composition source if we know it; else (a host-owned
    // on-screen node with no authored source) fall back to scroll + flash so the click still does something.
    c.addEventListener('click', (e) => {
      e.stopPropagation()
      if (site?.compositionFile) {
        openSource(site)
      } else {
        const t = findEl()
        t?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        outline(t, true)
        setTimeout(() => outline(t, false), 900)
      }
    })
    return c
  }

  function render(): void {
    // keep the terminal-style pin: if the user is at the bottom, stay pinned as new events arrive.
    const focusKey = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.focusKey : undefined
    const viewport = scroll.scrollElement
    const pinned = !viewport || viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 40

    const events = read()
    const conditions = readConditions()
    const s = stats()
    const categories = [...new Set(events.map((e) => e.category))].sort()

    const frag = document.createDocumentFragment()

    const toolbarButton = (label: string): HTMLElement & { disabled: boolean } => {
      const button = el('au-button', undefined, label) as HTMLElement & { disabled: boolean }
      button.setAttribute('size', 'sm')
      return button
    }

    // toolbar
    const bar = el('au-toolbar', 'au-trace-bar')
    bar.setAttribute('overflow', 'wrap')
    bar.setAttribute('aria-label', 'Trace actions')
    for (const cat of categories) {
      const b = toolbarButton(cat)
      b.dataset.off = String(hidden.has(cat))
      b.dataset.focusKey = `category:${cat}`
      b.setAttribute('aria-pressed', String(!hidden.has(cat)))
      b.title = `show / hide ${cat} events`
      b.addEventListener('au-activate', () => {
        hidden.has(cat) ? hidden.delete(cat) : hidden.add(cat)
        render()
      })
      bar.appendChild(b)
    }
    const expandBtn = toolbarButton(expandAll ? 'Collapse all' : 'Expand all')
    expandBtn.dataset.focusKey = 'expand-all'
    expandBtn.setAttribute('aria-pressed', String(expandAll))
    expandBtn.addEventListener('au-activate', () => {
      expandAll = !expandAll
      expanded.clear()
      collapsed.clear()
      render()
    })
    bar.appendChild(expandBtn)
    const clearBtn = toolbarButton('Clear')
    clearBtn.dataset.focusKey = 'clear'
    clearBtn.title = 'empty the timeline (standing conditions are kept)'
    clearBtn.addEventListener('au-activate', () => {
      clear() // drops the trace ring; standing conditions survive. The coalesced notify re-renders.
      expanded.clear()
      collapsed.clear()
      expandAll = false
    })
    bar.appendChild(clearBtn)
    const exportBtn = toolbarButton(exportState === 'pending' ? 'Copying…' : exportState === 'error' ? 'Retry copy' : 'Copy Perfetto trace')
    exportBtn.dataset.focusKey = 'export'
    exportBtn.disabled = exportState === 'pending'
    exportBtn.addEventListener('au-activate', async () => {
      if (exportState === 'pending') return
      exportState = 'pending'
      render()
      try {
        if (!navigator.clipboard) throw new Error('Clipboard unavailable')
        await navigator.clipboard.writeText(JSON.stringify(toChromeTrace(read())))
        exportState = 'success'
      } catch {
        exportState = 'error'
      }
      if (alive) render()
    })
    bar.appendChild(exportBtn)
    const exportStatus = el('span', 'au-trace-export-status', exportState === 'success' ? 'Trace copied' : exportState === 'error' ? 'Copy failed. Retry to copy the trace.' : exportState === 'pending' ? 'Copying trace…' : '')
    exportStatus.setAttribute('role', 'status')
    bar.appendChild(exportStatus)
    const stat = el('span', 'au-trace-stat', `${s.size}/${s.capacity}`)
    if (s.dropped > 0) stat.appendChild(el('span', 'au-trace-drop', `  ${s.dropped} dropped`))
    bar.appendChild(stat)

    // standing conditions
    if (conditions.size > 0) {
      frag.appendChild(el('div', 'au-trace-title', `conditions (${conditions.size})`))
      const card = el('div', 'au-trace-card')
      for (const c of conditions.values()) {
        const row = el('div', 'au-trace-cond')
        row.appendChild(el('span', `au-trace-sev-${c.severity ?? 'hint'}`, c.severity ?? 'hint'))
        row.appendChild(el('span', 'au-trace-phrase', str((c.fields ?? {}).message, c.name)))
        if (c.subject) row.appendChild(el('span', 'au-trace-id', c.subject))
        card.appendChild(row)
      }
      frag.appendChild(card)
    }

    // timeline, CHRONOLOGICAL (oldest first). Caused events group by cause; an uncaused event is its own item.
    frag.appendChild(el('div', 'au-trace-title', 'timeline'))
    const shown = events.filter((e) => !hidden.has(e.category))
    if (shown.length === 0) {
      frag.appendChild(el('div', 'au-trace-empty', 'nothing recorded yet — interact with the app (open a file, close a pane, drag one).'))
    } else {
      const groups = new Map<string, HostEvent[]>()
      for (const e of shown) {
        const k = e.cause === undefined ? `·${e.seq}` : `c${e.cause}`
        const g = groups.get(k)
        g ? g.push(e) : groups.set(k, [e])
      }
      const ordered = [...groups.entries()].sort((a, b) => a[1][0].seq - b[1][0].seq) // oldest first
      const list = el('div', 'au-trace-list')
      for (const [key, evs] of ordered) {
        const h = headlineFor(evs)
        const isOpen = expandAll ? !collapsed.has(key) : expanded.has(key)
        const card = el('div', 'au-trace-card')

        const head = el('button', 'au-trace-head') as HTMLButtonElement
        head.type = 'button'
        head.dataset.focusKey = `group:${key}`
        head.setAttribute('aria-expanded', String(isOpen))
        head.appendChild(el('span', 'au-trace-caret', isOpen ? '▾' : '▸'))
        head.appendChild(el('span', 'au-trace-lead', h.lead))
        if (h.outcome) {
          head.appendChild(el('span', 'au-trace-arrow', '→'))
          const out = el('span', 'au-trace-outcome', h.outcome)
          out.dataset.tone = h.tone
          head.appendChild(out)
        }
        head.appendChild(el('span', 'au-trace-count', key.startsWith('c') ? `#${key.slice(1)} · ${evs.length}` : ''))
        head.addEventListener('click', () => {
          const overrides = expandAll ? collapsed : expanded
          overrides.has(key) ? overrides.delete(key) : overrides.add(key)
          render()
        })
        card.appendChild(head)

        if (isOpen) {
          const detail = el('div', 'au-trace-detail')
          const actors = actorsOf(evs)
          if (actors.length) {
            const arow = el('div', 'au-trace-actors')
            for (const a of actors) arow.appendChild(chipFor(a))
            detail.appendChild(arow)
          }
          for (const e of evs) {
            const line = el('div', 'au-trace-line')
            line.appendChild(el('span', 'au-trace-seq', String(e.seq)))
            line.appendChild(el('span', 'au-trace-cat', e.category))
            line.appendChild(el('span', 'au-trace-phrase', phraseFor(e)))
            detail.appendChild(line)
          }
          card.appendChild(detail)
        }
        list.appendChild(card)
      }
      frag.appendChild(list)
    }

    body.replaceChildren(frag)
    const previousBar = root.querySelector(':scope > .au-trace-bar')
    if (previousBar) previousBar.replaceWith(bar)
    else root.prepend(bar)
    if (scroll.parentElement !== root) root.append(scroll)
    if (focusKey) {
      const target = [...root.querySelectorAll<HTMLElement>('[data-focus-key]')].find((item) => item.dataset.focusKey === focusKey)
      requestAnimationFrame(() => {
        if (target?.isConnected && (document.activeElement === document.body || document.activeElement === root)) target.focus({ preventScroll: true })
      })
    }
    if (pinned) void scroll.updateComplete.then(() => {
      const viewport = scroll.scrollElement
      if (alive && viewport) viewport.scrollTop = viewport.scrollHeight
    })
  }

  const off = subscribe(() => render())
  render()
  container.appendChild(root)
  return () => {
    alive = false
    off()
    disposeStyles?.()
    container.replaceChildren()
  }
}

export default defineProjection<ProjectionModule>({ mount })
