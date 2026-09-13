import { displayFilePath } from '@arsumbris/au-host-sdk'
// Backlinks (find-all-references) projection: the `backlinks` read as a clickable list of
// every reference INTO a file. It follows the container's SELECTION to know which file (a
// `file-selection`, e.g. a file-tree click bubbling up), and clicking a row FIRES an
// `open-intent` so the focused open-capable container opens the referencing source.
//
// Reuses both view-state channels: selection (input — which file) + intent (output — open a
// source). The line number rides on the wire (`WireReferenceIn.line_col`) — NO byte→line
// conversion and NO content read.

import { defineProjection, type ProjectionModule, type MountHost } from '@arsumbris/au-host-sdk'
import { readReferencesIn, type WireReferenceIn } from '@arsumbris/au-host-sdk/engine-reads'
import { fileSelection, isFileSelection, type Selection } from '@arsumbris/selection'
import { openIntent } from '@arsumbris/intent'
import { makeHoverContent } from '@arsumbris/preview-content'

// `intent` (command channel), `preview` (overlay surface), and `engineReady` (readiness edge) are
// all MountHost contract capabilities now, read off `host` directly (engineReady is optional; guard).

const STYLE = `
.au-backlinks { display: flex; flex-direction: column; height: 100%; min-width: 0; min-height: 0; color: var(--au-ink-2); font: var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans); }
.au-backlinks-header { flex: none; padding: var(--au-space-3) var(--au-space-4) var(--au-space-2); }
.au-backlinks-heading { margin: 0; font: inherit; font-weight: var(--au-w-strong); color: var(--au-ink-1); }
.au-backlinks-target { overflow-wrap: anywhere; margin-top: var(--au-space-1); }
.au-backlinks-status { color: var(--au-ink-3); font-size: var(--au-t-xs); }
.au-backlinks-scroll { flex: 1; min-height: 0; }
.au-backlinks-empty { max-width: 32rem; }
.au-backlinks ul { list-style: none; margin: 0; padding: 0 var(--au-space-2) var(--au-space-3); }
.au-backlinks-label { padding-block: var(--au-space-2); }
.au-backlinks-label::part(secondary) { color: var(--au-ink-3); }
.au-backlinks-empty::part(title) { font-size: var(--au-t-sm); line-height: var(--au-lh-base); }
.au-backlinks-empty::part(hint) { line-height: var(--au-lh-base); }
.au-backlinks-empty[data-error]::part(title) { color: var(--au-color-danger); }
.au-backlinks [hidden] { display: none; }
`

/** The last path segment, for a compact row label. */
function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  return i < 0 ? trimmed : trimmed.slice(i + 1)
}

function mount(container: HTMLElement, host: MountHost): () => void {
  const root = document.createElement('section')
  root.className = 'au-backlinks'
  root.setAttribute('aria-label', 'Backlinks')

  const header = document.createElement('header')
  header.className = 'au-backlinks-header'
  const heading = document.createElement('h2')
  heading.className = 'au-backlinks-heading'
  heading.textContent = 'Backlinks'
  const target = document.createElement('div')
  target.className = 'au-backlinks-target'
  target.hidden = true
  const status = document.createElement('div')
  status.className = 'au-backlinks-status'
  status.setAttribute('role', 'status')
  header.append(heading, target, status)

  const scroll = document.createElement('au-scroll-area')
  scroll.className = 'au-backlinks-scroll'
  scroll.setAttribute('axis', 'y')
  const empty = document.createElement('au-empty-state')
  empty.className = 'au-backlinks-empty'
  const spinner = document.createElement('au-spinner')
  spinner.slot = 'icon'
  spinner.setAttribute('size', 'sm')
  spinner.setAttribute('aria-hidden', 'true')
  const retry = document.createElement('au-button')
  retry.slot = 'action'
  retry.textContent = 'Retry references'
  retry.setAttribute('variant', 'outline')
  retry.setAttribute('size', 'sm')
  retry.addEventListener('au-activate', () => { if (alive && currentFile) void load(currentFile) })
  const list = document.createElement('ul')
  list.setAttribute('aria-label', 'Referencing sources')
  scroll.append(empty, list)
  root.append(header, scroll)
  container.appendChild(root)
  const disposeStyles = host.styles?.inject(STYLE, container)

  let alive = true
  const intent = host.intent
  let currentFile: string | null = null
  let loadGeneration = 0

  function showEmpty(label: string, hint: string, error = false): void {
    root.setAttribute('data-empty', '')
    scroll.setAttribute('content', 'center')
    empty.replaceChildren()
    if (error) empty.append(retry)
    list.replaceChildren()
    list.hidden = true
    empty.hidden = false
    empty.setAttribute('label', label)
    empty.setAttribute('hint', hint)
    empty.toggleAttribute('data-error', error)
  }
  showEmpty('Select a file', 'Choose a file to see which files reference it.')

  function render(links: readonly WireReferenceIn[]): void {
    list.replaceChildren()
    status.textContent = `${links.length} reference${links.length === 1 ? '' : 's'}`
    if (links.length === 0) {
      showEmpty('No references yet', 'No incoming references were found for this file.')
      return
    }
    empty.hidden = true
    root.removeAttribute('data-empty')
    scroll.setAttribute('content', 'flow')
    list.hidden = false
    for (const b of links) {
      const li = document.createElement('li')
      const label = document.createElement('au-list-row')
      label.className = 'au-backlinks-label'
      label.setAttribute('interactive', '')
      label.setAttribute('wrap', '')
      const line = b.line_col?.start.line
      const parts = b.source.split('/').filter(Boolean)
      const folder = parts.slice(0, -1).slice(-2).join('/')
      const context = [folder, b.slot].filter(Boolean).join(' · ')
      label.setAttribute('primary', basename(b.source))
      label.setAttribute('secondary', context)
      label.setAttribute('aria-label', `Open ${displayFilePath(b.source, host.workspace.members)}${line != null ? `, line ${line}` : ''}${b.slot ? `, field ${b.slot}` : ''}`)
      label.title = displayFilePath(b.source, host.workspace.members)
      label.dataset.src = b.source
      if (line != null) {
        label.dataset.line = String(line)
        const location = document.createElement('span')
        location.slot = 'meta'
        location.textContent = `:${line}`
        location.setAttribute('aria-hidden', 'true')
        label.appendChild(location)
      }
      const icon = document.createElement('au-icon')
      icon.setAttribute('name', 'file-text')
      icon.setAttribute('size', 'sm')
      icon.setAttribute('aria-hidden', 'true')
      icon.slot = 'leading'
      label.appendChild(icon)
      label.addEventListener('click', () => {
        const range = {type: 'text-range', from: b.span_start, to: b.span_end}
        intent?.fire(openIntent(fileSelection(b.source, range)))
      })
      li.appendChild(label)
      list.appendChild(li)
    }
  }

  async function load(file: string): Promise<void> {
    const generation = ++loadGeneration
    target.hidden = false
    target.textContent = basename(file)
    target.title = displayFilePath(file, host.workspace.members)
    status.textContent = 'Loading references…'
    root.setAttribute('aria-busy', 'true')
    showEmpty('Loading references…', 'Looking for files that reference this file.')
    empty.append(spinner)
    let outcome: Awaited<ReturnType<typeof readReferencesIn>>
    try {
      outcome = await readReferencesIn(host.engine, file)
    } catch (error) {
      if (!alive || generation !== loadGeneration) return
      root.removeAttribute('aria-busy')
      status.textContent = 'References unavailable'
      showEmpty('Couldn’t load references', error instanceof Error ? error.message : String(error), true)
      return
    }
    if (!alive || generation !== loadGeneration || currentFile !== file) return
    spinner.remove()
    root.removeAttribute('aria-busy')
    if ('ok' in outcome) {
      status.textContent = 'References unavailable'
      showEmpty('Couldn’t load references', outcome.error, true)
      return
    }
    if (!outcome.ready) {
      status.textContent = 'Waiting for workspace'
      showEmpty('Waiting for workspace', 'References will appear when the engine is ready.')
      return
    }
    render(outcome.result)
  }

  // Follow the enclosing container's selection. A `file-selection` (e.g. a file-tree
  // click bubbling up) sets the tracked file and re-reads its backlinks. Other selection
  // kinds are ignored.
  const offFollow = host.selection?.follow((value) => {
    if (!value || typeof value !== 'object') return
    const sel = value as Selection
    if (!isFileSelection(sel) || sel.path === currentFile) return
    currentFile = sel.path
    void load(sel.path)
  })

  // Recover when the daemon becomes reachable (a mount-time read may have failed).
  const offReady = host.engineReady?.subscribe((ready) => {
    if (ready && alive && currentFile) void load(currentFile)
  })

  // CMD+HOVER PREVIEW: cmd/ctrl-hover a backlinks row → the host's shared preview
  // overlay previews the SOURCE file at the referenced line. Same
  // dwell+sticky lifecycle as the editor/type-list; the surface's cones own dismissal.
  const preview = host.preview
  const content = preview ? makeHoverContent(host.engine) : null
  let modHeld = false
  let hoverTimer: ReturnType<typeof setTimeout> | undefined
  let lastPointer: { x: number; y: number } | null = null
  const clearHoverTimer = (): void => {
    if (hoverTimer) clearTimeout(hoverTimer)
    hoverTimer = undefined
  }
  function manageHover(x: number, y: number): void {
    if (!preview || !content) return
    if (preview.isOver(x, y)) return clearHoverTimer() // sticky: pointer is in the card
    const label = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('.au-backlinks-label') as HTMLElement | null
    const src = modHeld ? label?.dataset.src : undefined
    if (!src) return clearHoverTimer() // surface cones own dismissal — don't hide here
    const line = label!.dataset.line ? Number(label!.dataset.line) : undefined
    const key = `bl:${src}:${line ?? ''}`
    if (preview.isShowing(key)) return
    clearHoverTimer()
    hoverTimer = setTimeout(() => {
      if (alive)
        preview.show(
          key,
          label!.getBoundingClientRect(),
          content.previewPath(src, line),
          (p) => content.previewPath(p),
          (p) => intent?.fire(openIntent(fileSelection(p))),
        )
    }, 240)
  }
  const onMove = (e: MouseEvent): void => {
    // Read the modifier off the move event (authoritative) — a keyup can be missed when the
    // window loses focus while Cmd is held, which would otherwise leave `modHeld` stuck true and
    // pop the peek on a plain hover. This self-corrects on the next move.
    modHeld = e.metaKey || e.ctrlKey
    lastPointer = { x: e.clientX, y: e.clientY }
    manageHover(e.clientX, e.clientY)
  }
  const onModKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Meta' && e.key !== 'Control') return
    modHeld = e.metaKey || e.ctrlKey
    if (lastPointer) manageHover(lastPointer.x, lastPointer.y)
  }
  const onBlur = (): void => {
    // Losing focus can swallow the modifier keyup; clear so a returning plain hover can't peek.
    modHeld = false
    clearHoverTimer()
  }
  if (preview) {
    list.addEventListener('mousemove', onMove)
    window.addEventListener('keydown', onModKey)
    window.addEventListener('keyup', onModKey)
    window.addEventListener('blur', onBlur)
  }

  return () => {
    alive = false
    disposeStyles?.()
    offFollow?.()
    offReady?.()
    clearHoverTimer()
    if (preview) {
      list.removeEventListener('mousemove', onMove)
      window.removeEventListener('keydown', onModKey)
      window.removeEventListener('keyup', onModKey)
      window.removeEventListener('blur', onBlur)
      preview.hide()
    }
    container.replaceChildren()
  }
}

/** The mount export (the locator's `export`, default `mount`). */
// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
