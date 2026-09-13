import { displayFilePath } from '@arsumbris/au-host-sdk'
// Diagnostics projection: the entry-wide `diagnostics` read as a filterable list.
// Plain DOM, no framework.
// - filter by severity (toggle chips) AND by code (the diagnostic kind) — client-side
//   over the streamed set, so the live subscription (which ignores those filters) keeps working.
// - PATH SCOPE (a file-tree badge click): the pane narrows to one file (`path`) or a subtree
//   (`path_prefix`) via an ENGINE-scoped read + subscription, so its counts reflect the scope. The
//   scope arrives on a `diagnostics-scope` viewState slice (retained + replayed, so a just-opened
//   pane picks up the latest); a "scoped: <label> ✕" chip clears it back to the whole entry.

// - cmd+hover a row → a source preview of the file at the diagnostic's line (host preview overlay).
// - copy-all → the FILTERED set as aligned text lines, to the clipboard.

import { defineProjection, type MountHost, type PreviewSurface, type ProjectionModule } from '@arsumbris/au-host-sdk'
import { readMembers, readDiagnostics, type WireDiagnostic, type WireDiagnosticSeverity, type WireDiagnosticsFilter, subscribeDiagnostics } from '@arsumbris/au-host-sdk/engine-reads'
import { makeHoverContent } from '@arsumbris/preview-content'
import { openIntent } from '@arsumbris/intent'
import { fileSelection } from '@arsumbris/selection'
import type { TextRange } from '@arsumbris/range'

// `engineReady` (readiness edge, re-subscribe when the daemon becomes reachable) is a MountHost
// contract capability now, read off `host` directly (optional; guard).

// Fixed display order; only severities present in the set get a chip.
const SEVERITY_ORDER: WireDiagnosticSeverity[] = ['error', 'warning', 'drift', 'hint']

const STYLE = `
.au-diagnostics { height:100%; min-height:0; min-width:0; box-sizing:border-box; color:var(--au-ink-2); font:var(--au-t-sm)/var(--au-lh-sm) var(--au-font-sans); display:flex; flex-direction:column; container:diagnostics / inline-size; }
.au-diagnostics-toolbar { display:flex; align-items:center; gap:var(--au-space-2); flex-wrap:wrap; flex:none; box-sizing:border-box; width:min(100%, 800px); margin-inline:auto; padding:var(--au-space-4) clamp(var(--au-space-4), 4cqi, var(--au-space-7)); border-bottom:1px solid var(--au-line-1); }
.au-diagnostics-toolbar > * { min-width:0; max-width:100%; }
.au-diagnostics-toolbar au-select { flex:1 1 16rem; }
.au-diagnostics-chips { display:flex; flex-wrap:wrap; gap:var(--au-space-1); flex:1 1 auto; }
.au-diagnostics-status { color:var(--au-ink-3); width:100%; font-size:var(--au-t-xs); }
.au-diagnostics-scroll { flex:1; min-height:0; }
.au-diagnostics-list { box-sizing:border-box; width:min(100%, 800px); margin-inline:auto; padding:var(--au-space-3) clamp(var(--au-space-4), 4cqi, var(--au-space-7)) var(--au-space-5); }
.au-diagnostics-group { padding-block:var(--au-space-2); border-bottom:1px solid var(--au-line-1); min-width:0; }
.au-diagnostics-group > au-section-header::part(header) { padding-inline:0; }
.au-diagnostics-group > au-section-header::part(label) { white-space:normal; overflow:visible; overflow-wrap:anywhere; }
.au-diagnostics-group > au-section-header::part(count) { white-space:nowrap; color:var(--au-ink-3); }
.au-diagnostics-occurrences { padding:var(--au-space-2) 0 var(--au-space-3) var(--au-space-3); }
.au-diagnostics-heading { flex:1; min-width:0; margin:0; font-size:var(--au-t-sm); font-weight:var(--au-w-strong); }
.au-diagnostics-toolbar au-input { flex-basis:100%; width:100%; }
.au-diagnostics-help { font-size:var(--au-t-xs); color:var(--au-ink-3); margin:0; padding:var(--au-space-2) 0; }
.au-diagnostics-notice:empty { display:none; }
.au-diagnostics-notice { color:var(--au-color-warn); flex-basis:100%; overflow-wrap:anywhere; }
.au-diagnostics-row { margin-block:var(--au-space-1); }
.au-diagnostics-path { display:block; color:var(--au-ink-3); font:var(--au-t-xs)/var(--au-lh-xs) var(--au-font-mono); overflow-wrap:anywhere; padding:0 var(--au-space-2) var(--au-space-2); }
.au-diagnostics-row { min-width:0; }
.au-diagnostics-row::part(primary), .au-diagnostics-row::part(secondary) { white-space:normal; overflow-wrap:anywhere; }
.au-diagnostics-row::part(secondary) { color:var(--au-ink-3); }
.au-diagnostics-row [slot=leading] { color:var(--au-ink-3); }
.au-diagnostics-row.severity-error [slot=leading] { color:var(--au-color-danger); }
.au-diagnostics-row.severity-warning [slot=leading] { color:var(--au-color-warn); }
`

// Vanilla-created <au-*> elements, typed STRUCTURALLY (set-independent — only the contract's property
// shape). au-button/au-toggle-chip/au-chip emit au-activate/au-toggle/au-remove (composed), so listen
// for those, not `click`.
type AuButtonEl = HTMLElement & { disabled: boolean }
type AuChipEl = HTMLElement & { label: string; removable: boolean }
type AuToggleChipEl = HTMLElement & { label: string; count: number; pressed: boolean; disabled: boolean }
type AuEmptyStateEl = HTMLElement & { label: string; hint: string }

/** A vanilla <au-button> sized for the dense toolbar. Emits au-activate; text via the default slot. */
function createAuButton(label: string): AuButtonEl {
  const el = document.createElement('au-button') as AuButtonEl
  el.setAttribute('size', 'sm')
  el.textContent = label
  return el
}

/** Severity → <au-toggle-chip> tone: error/warning are status hues; hint/drift default to ink. */
const CHIP_TONE: Partial<Record<WireDiagnosticSeverity, string>> = { error: 'danger', warning: 'warn' }

/** The diagnostic's 1-based start line, when the engine supplied line/col. */
function lineOf(d: WireDiagnostic): number | undefined {
  return d.span.line_col?.start.line
}

function mount(container: HTMLElement, host: MountHost): () => void {
  const root = document.createElement('div')
  root.className = 'au-diagnostics'

  const toolbar = document.createElement('div')
  toolbar.className = 'au-diagnostics-toolbar'

  const refreshButton = createAuButton('Refresh')
  const copyButton = createAuButton('Copy results')
  copyButton.title = 'Copy the filtered diagnostics as text'

  const chips = document.createElement('span')
  chips.className = 'au-diagnostics-chips'

  // The code filter is an `<au-select>`. Set-INDEPENDENT structural cast: only the contract's property
  // shape — the `options` model and the chosen `value`.
  const codeSelect = document.createElement('au-select') as HTMLElement & {
    value: string
    options: { value: string; label: string }[]
  }
  codeSelect.setAttribute('size', 'sm')
  codeSelect.setAttribute('label', 'Filter by diagnostic code')
  codeSelect.title = 'Filter by diagnostic code'

  const status = document.createElement('span')
  status.className = 'au-diagnostics-status'
  status.textContent = 'Loading diagnostics…'
  status.setAttribute('role', 'status')

  // Path-scope chip (shown only when a file-tree badge scoped the pane); its ✕ (au-remove) clears it.
  const scopeChip = document.createElement('au-chip') as AuChipEl
  scopeChip.setAttribute('variant', 'accent')
  scopeChip.removable = true
  scopeChip.style.display = 'none'
  scopeChip.title = 'Clear the path scope (show the whole workspace)'

  const heading = document.createElement('h2')
  heading.className = 'au-diagnostics-heading'
  heading.textContent = 'Workspace diagnostics'
  const search = document.createElement('au-input') as HTMLElement & { value: string }
  search.setAttribute('placeholder', 'Find a message, file or issue type…')
  search.setAttribute('label', 'Search diagnostics')
  const notice = document.createElement('div')
  notice.className = 'au-diagnostics-notice'
  notice.setAttribute('role', 'status')
  toolbar.append(heading, refreshButton, copyButton, status, scopeChip, search, chips, codeSelect, notice)
  search.addEventListener('au-input', () => update())

  const list = document.createElement('div')
  list.className = 'au-diagnostics-list'
  const scroll = document.createElement('au-scroll-area')
  scroll.className = 'au-diagnostics-scroll'
  scroll.setAttribute('axis', 'y')
  scroll.append(list)
  root.append(toolbar, scroll)
  container.appendChild(root)
  const disposeStyles = host.styles?.inject(STYLE, container)

  let alive = true
  let live = false
  let version: number | null = null

  // --- state --------------------------------------------------------------
  let all: WireDiagnostic[] = []
  const disabledSeverities = new Set<WireDiagnosticSeverity>() // empty = all enabled
  const disclosure = new Map<string, boolean>()
  let members: {repo:string; root:string}[] = []
  void readMembers(host.engine).then(outcome => {
    if (!alive || !('ready' in outcome) || !outcome.ready) return
    members = outcome.result.slice().sort((a,b) => b.root.length - a.root.length)
    if (hasData) update()
  }).catch(() => { /* Locations retain absolute paths when member metadata is unavailable. */ })
  let hasData = false
  let request = 0
  let activeCode: string | null = null // null = all codes

  // Path scope (a file-tree badge click): narrow the ENGINE read/subscription to one file or a
  // subtree. `null` = whole workspace. Carried on the `diagnostics-scope` viewState slice.
  interface PathScope {
    path?: string
    path_prefix?: string
    label?: string
  }
  let pathScope: PathScope | null = null

  /** The engine filter for the current scope (undefined = whole workspace). */
  function scopeFilter(): WireDiagnosticsFilter | undefined {
    // Unscoped, this pane is the workspace-wide Problems list — schema 17 made argless diagnostics
    // default to `own`, so pass an explicit `scope: 'all'` to keep showing every member's diagnostics.
    // A path / path_prefix pin is itself a location pin that flips the engine default to `all`.
    if (!pathScope) return { scope: 'all' }
    if (pathScope.path) return { path: pathScope.path }
    if (pathScope.path_prefix) return { path_prefix: pathScope.path_prefix }
    return { scope: 'all' }
  }

  function renderScopeChip(): void {
    if (!pathScope) {
      scopeChip.style.display = 'none'
      return
    }
    scopeChip.style.display = ''
    scopeChip.label = `${pathScope.label ?? pathScope.path ?? pathScope.path_prefix ?? 'scoped'}`
  }

  /** Apply a new path scope (or clear it): re-issue the engine-scoped read + subscription. */
  function applyScope(next: PathScope | null): void {
    request++
    all = []
    hasData = false
    pathScope = next && (next.path || next.path_prefix) ? next : null
    renderScopeChip()
    heading.textContent = pathScope ? 'Scoped diagnostics' : 'Workspace diagnostics'
    connect() // re-subscribe with the new scope (its initial-value repopulates `all`)
    void refresh() // and re-read immediately for responsiveness
  }

  scopeChip.addEventListener('au-remove', () => applyScope(null))

  function filtered(): WireDiagnostic[] {
    return all.filter(
      (d) => !disabledSeverities.has(d.severity) && (activeCode === null || d.code === activeCode) && `${d.message} ${d.span.file} ${d.code}`.toLowerCase().includes(search.value?.trim().toLowerCase() ?? ''),
    )
  }

  // --- open (row click → open the file; honors the diagnostic's span) -----
  const intent = host.intent
  function openPath(path: string, range?: TextRange): void {
    intent.fire(openIntent(fileSelection(path, range)))
  }
  function openDiagnostic(d: WireDiagnostic): void {
    const range: TextRange = { type: 'text-range', from: d.span.range.start, to: d.span.range.end }
    openPath(d.span.file, range)
  }

  // --- hover preview (host overlay; graceful no-op without it) ------------
  const hostPreview: PreviewSurface | undefined = host.preview
  const content = makeHoverContent(host.engine)
  let modHeld = false
  let hoverTimer: ReturnType<typeof setTimeout> | null = null
  let hovered: { key: string; file: string; line?: number; rect: () => DOMRect } | null = null

  function clearHoverTimer(): void {
    if (hoverTimer) clearTimeout(hoverTimer)
    hoverTimer = null
  }
  function showPreview(): void {
    if (!hostPreview || !modHeld || !hovered) return
    if (hostPreview.isShowing(hovered.key)) return
    clearHoverTimer()
    const h = hovered
    hoverTimer = setTimeout(() => {
      if (!alive || !hostPreview) return
      hostPreview.show(h.key, h.rect(), content.previewPath(h.file, h.line), (p) => content.previewPath(p), (p) => openPath(p))
    }, 200)
  }
  function maybeHide(x: number, y: number): void {
    if (hostPreview?.isOver(x, y)) return // sticky: pointer moved into the card
    clearHoverTimer()
    hostPreview?.hide()
  }
  const onMod = (e: KeyboardEvent): void => {
    if (e.key !== 'Meta' && e.key !== 'Control') return
    modHeld = e.metaKey || e.ctrlKey
    if (modHeld) showPreview()
  }
  const onBlur = (): void => {
    modHeld = false
    clearHoverTimer()
    hostPreview?.hide()
  }
  window.addEventListener('keydown', onMod)
  window.addEventListener('keyup', onMod)
  window.addEventListener('blur', onBlur)

  // --- controls (rebuilt off the full set so counts stay accurate) --------
  function renderControls(): void {
    const bySeverity = new Map<WireDiagnosticSeverity, number>()
    const byCode = new Map<string, number>()
    for (const d of all) {
      bySeverity.set(d.severity, (bySeverity.get(d.severity) ?? 0) + 1)
      byCode.set(d.code, (byCode.get(d.code) ?? 0) + 1)
    }

    chips.replaceChildren()
    for (const sev of SEVERITY_ORDER) {
      const count = bySeverity.get(sev)
      if (!count) continue
      // A multi-toggle facet filter: pressed = shown (not in disabledSeverities); the tone reads the
      // severity. The atom owns the chip chrome + on/off look + tone.
      const chip = document.createElement('au-toggle-chip') as AuToggleChipEl
      chip.label = sev
      chip.count = count
      const tone = CHIP_TONE[sev]
      if (tone) chip.setAttribute('tone', tone)
      const off = disabledSeverities.has(sev)
      chip.pressed = !off
      chip.title = off ? `show ${sev}` : `hide ${sev}`
      chip.addEventListener('au-toggle', () => {
        // The element flipped its own `pressed`; sync the filter to it (pressed = shown).
        if (chip.pressed) disabledSeverities.delete(sev)
        else disabledSeverities.add(sev)
        chip.title = chip.pressed ? `hide ${sev}` : `show ${sev}`
        update()
      })
      chips.appendChild(chip)
    }

    // Drop a stale code filter if that code is no longer present.
    if (activeCode !== null && !byCode.has(activeCode)) activeCode = null
    codeSelect.options = [
      { value: '', label: `All diagnostic codes (${all.length})` },
      ...[...byCode.keys()].sort().map((code) => ({ value: code, label: `${code} (${byCode.get(code)})` })),
    ]
    codeSelect.value = activeCode ?? ''
  }

  codeSelect.addEventListener('au-change', () => {
    activeCode = codeSelect.value || null
    update()
  })

  // --- rows ---------------------------------------------------------------
  function renderRows(diagnostics: WireDiagnostic[]): void {
    list.replaceChildren()
    if (diagnostics.length === 0) {
      const empty = document.createElement('au-empty-state') as AuEmptyStateEl
      if (all.length === 0) {
        empty.label = hasData ? 'No diagnostics' : notice.textContent ? 'Diagnostics unavailable' : 'Loading diagnostics…'
        empty.hint = hasData ? 'No issues were reported for this scope.' : notice.textContent ? 'Refresh to try again.' : 'Waiting for the workspace engine.'
      } else {
        empty.label = 'No matches'
        empty.hint = 'No diagnostics match the current filter.'
      }
      list.appendChild(empty)
      return
    }
    const groups = new Map<string, WireDiagnostic[]>()
    for (const d of diagnostics) {
      const key = `${d.severity}:${d.code}`
      const items = groups.get(key) ?? []
      items.push(d)
      groups.set(key, items)
    }
    const ordered = [...groups.entries()].sort(([,a],[,b]) => SEVERITY_ORDER.indexOf(a[0].severity) - SEVERITY_ORDER.indexOf(b[0].severity) || b.length - a.length || a[0].code.localeCompare(b[0].code))
    for (const [key, items] of ordered) {
      const first = items[0]
      const section = document.createElement('section')
      section.className = 'au-diagnostics-group'
      const groupHeading = document.createElement('au-section-header')
      const readable = first.code.replaceAll('-', ' ')
      const glyph = document.createElement('au-icon')
      glyph.setAttribute('name', first.severity === 'error' ? 'alert-circle' : first.severity === 'warning' ? 'warning' : 'info')
      glyph.setAttribute('size', 'sm')
      glyph.setAttribute('aria-hidden', 'true')
      glyph.style.color = first.severity === 'error' ? 'var(--au-color-danger)' : first.severity === 'warning' ? 'var(--au-color-warn)' : 'var(--au-ink-3)'
      glyph.style.marginInlineEnd = 'var(--au-space-2)'
      groupHeading.append(glyph, readable[0].toUpperCase() + readable.slice(1))
      groupHeading.title = `${first.severity} · ${first.code}`
      groupHeading.setAttribute('sans', '')
      groupHeading.setAttribute('collapsible', '')
      groupHeading.setAttribute('chevron-end', '')
      const fileCount = new Set(items.map(d => d.span.file)).size
      groupHeading.setAttribute('count', `${items.length} · ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`)
      const group = document.createElement('div')
      group.className = 'au-diagnostics-occurrences'
      const open = disclosure.get(key) ?? Boolean(activeCode || search.value?.trim() || (pathScope && diagnostics.length <= 10))
      groupHeading.toggleAttribute('open', open)
      group.hidden = !open
      groupHeading.addEventListener('au-toggle', () => {
        const next = !groupHeading.hasAttribute('open')
        groupHeading.toggleAttribute('open', next)
        group.hidden = !next
        disclosure.set(key, next)
      })
      const context = document.createElement('p')
      context.className = 'au-diagnostics-help'
      context.textContent = `${first.severity[0].toUpperCase() + first.severity.slice(1)} · ${first.code}`
      group.append(context)
      section.append(groupHeading, group)
      list.append(section)
      for (const d of items) {
      const row = document.createElement('au-list-row')
      row.className = `au-diagnostics-row severity-${d.severity}`
      row.setAttribute('interactive', '')
      row.setAttribute('primary', d.message)
      const source = displayFilePath(d.span.file, members.map(member => ({name: member.repo, root: member.root})))
      row.setAttribute('secondary', `${source}${lineOf(d) != null ? `:${lineOf(d)}` : ''}${d.fix?.description ? ` · ${d.fix.description}` : ''}`)
      row.title = source
      row.setAttribute('aria-label', `${d.severity}: ${d.message}. Open ${source}`)
      const icon = document.createElement('au-icon')
      icon.setAttribute('slot', 'leading')
      icon.setAttribute('name', d.severity === 'error' ? 'alert-circle' : d.severity === 'warning' ? 'warning' : 'info')
      icon.setAttribute('size', 'sm')
      icon.setAttribute('aria-hidden', 'true')
      row.append(icon)
      const line = lineOf(d)


      // Click → open the file at the diagnostic's span (transient tab).
      row.addEventListener('click', () => openDiagnostic(d))

      // Cmd+hover → preview the source at the diagnostic's line.
      if (hostPreview) {
        const key = `dx:${d.span.file}:${line ?? ''}`
        row.addEventListener('mouseenter', () => {
          hovered = { key, file: d.span.file, line, rect: () => row.getBoundingClientRect() }
          if (modHeld) showPreview()
        })
        row.addEventListener('mouseleave', (e) => {
          hovered = null
          maybeHide(e.clientX, e.clientY)
        })
      }

      group.appendChild(row)
      }
    }
  }

  function statusText(shown: number): string {
    const base = shown === all.length ? `${all.length} ${all.length === 1 ? 'diagnostic' : 'diagnostics'}` : `${shown} of ${all.length} diagnostics`
    return `${base}${live ? ' · Live' : ''}`
  }

  function update(): void {
    const f = filtered()
    renderRows(f)
    status.textContent = hasData ? statusText(f.length) : 'Loading diagnostics…'
    copyButton.disabled = !hasData || f.length === 0
    codeSelect.style.display = hasData ? '' : 'none'
    chips.style.display = hasData ? '' : 'none'
  }

  function setAll(diagnostics: WireDiagnostic[], v: number | null): void {
    hasData = true
    notice.textContent = ''
    all = diagnostics
    version = v
    status.title = version == null ? '' : `Engine version ${version}`
    renderControls()
    update()
  }

  // --- copy (honors the active filter) ------------------------------------
  copyButton.addEventListener('au-activate', () => {
    const f = filtered()
    if (f.length === 0) {
      copyButton.textContent = 'nothing to copy'
      setTimeout(() => alive && (copyButton.textContent = 'Copy results'), 1200)
      return
    }
    const sevW = Math.max(...f.map((d) => d.severity.length))
    const codeW = Math.max(...f.map((d) => d.code.length))
    const text = f
      .map((d) => {
        const line = lineOf(d)
        const loc = line != null ? `${d.span.file}:${line}` : d.span.file
        return `${d.severity.padEnd(sevW)}  ${d.code.padEnd(codeW)}  ${d.message}  ${loc}`
      })
      .join('\n')
    void navigator.clipboard.writeText(text).then(
      () => {
        if (!alive) return
        copyButton.textContent = `copied ${f.length}`
        setTimeout(() => alive && (copyButton.textContent = 'Copy results'), 1200)
      },
      () => {
        if (!alive) return
        copyButton.textContent = 'copy failed'
        setTimeout(() => alive && (copyButton.textContent = 'Copy results'), 1200)
      },
    )
  })

  // --- engine wiring ------------------------------------------------------
  async function refresh(): Promise<void> {
    const token = ++request
    let outcome
    try { outcome = await readDiagnostics(host.engine, scopeFilter()) }
    catch (error) {
      if (!alive || token !== request) return
      notice.textContent = `Could not load diagnostics: ${error instanceof Error ? error.message : String(error)}${hasData ? ' · Showing last received results.' : ''}`
      status.textContent = hasData ? statusText(filtered().length) : 'Diagnostics unavailable'
      renderRows(filtered())
      return
    }
    if (!alive || token !== request) return
    if ('ok' in outcome) {
      notice.textContent = `Could not refresh diagnostics: ${outcome.error}${hasData ? ' · Showing last received results.' : ''}`
      status.textContent = hasData ? statusText(filtered().length) : 'Diagnostics unavailable'
      renderRows(filtered())
      return
    }
    if (!outcome.ready) {
      notice.textContent = hasData ? 'Engine unavailable · Showing last received results.' : 'Waiting for the workspace engine.'
      status.textContent = hasData ? statusText(filtered().length) : 'Diagnostics unavailable'
      renderRows(filtered())
      return
    }
    setAll(outcome.result, outcome.version)
  }

  // Live updates: the typed initial value renders directly; change events are
  // notification-only, so they trigger a re-read.
  let unsubscribe: (() => void) | null = null
  let generation = 0
  function connect(): void {
    const current = ++generation
    unsubscribe?.()
    unsubscribe = subscribeDiagnostics(
      host.engine,
      (event) => {
        if (!alive || current !== generation) return
        if (event.kind === 'initial-value') {
          live = true
          setAll(event.result, event.atVersion)
        } else if (event.kind === 'change') {
          void refresh()
        } else {
          live = false
          notice.textContent = `Live updates unavailable${event.error ? `: ${event.error}` : ''}. Refresh to try again.`
          status.textContent = hasData ? statusText(filtered().length) : 'Waiting for diagnostics'
        }
      },
      scopeFilter(), // pre-scope the live feed so counts + updates honor the path scope
    )
  }

  update()
  connect()
  void refresh()

  // The scope arrives on a `diagnostics-scope` viewState slice (published by the file-tree badge).
  // watchAll replays the retained latest value on subscribe, so a JUST-OPENED pane picks it up.
  // Any publisher's latest wins (most-recent scope click). `undefined` = the publisher cleared it.
  const offScope = host.viewState.watchAll('diagnostics-scope', (_publisher, value) => {
    if (!alive) return
    applyScope((value as PathScope | undefined) ?? null)
  })

  // Recover when the daemon becomes reachable: a closed feed re-subscribes.
  const offReady = host.engineReady?.subscribe((ready) => {
    if (ready && alive) connect()
  })

  refreshButton.addEventListener('au-activate', () => void refresh())

  return () => {
    alive = false
    disposeStyles?.()
    offReady?.()
    offScope()
    unsubscribe?.()
    clearHoverTimer()
    hostPreview?.hide()
    window.removeEventListener('keydown', onMod)
    window.removeEventListener('keyup', onMod)
    window.removeEventListener('blur', onBlur)
    container.replaceChildren()
  }
}

// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
