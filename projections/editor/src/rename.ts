// Rename the symbol under F2. Wikilink targets use the engine file-rename operation,
// which updates references across workspace members. Block IDs, frontmatter keys,
// and plain identifiers are renamed within this document only. Cross-document
// symbol or block-id references are not updated; the UI reports the local scope.

import { EditorView } from '@codemirror/view'
import { readResolveTarget, readReferencesIn } from '@arsumbris/au-host-sdk/engine-reads'
import type { LinkResolver, MountHost } from '@arsumbris/au-host-sdk'

/** What F2 acts on at the cursor. Computed by the editor (it owns the token detection). */
export interface RenameTarget {
  /** `wikilink-file` → rename the target file (engine saga); the others → in-file text rename. */
  kind: 'wikilink-file' | 'blockid' | 'identifier'
  /** The current name: the wikilink target, the block-id (no `^`), or the identifier text. */
  text: string
  /** The doc span of the editable token (for anchoring the inline box). */
  from: number
  to: number
}

export interface RenameContext {
  engine: MountHost['engine']
  files: MountHost['files']
  confirm?: MountHost['confirm']
  /** The host overlay site — the inline-rename box (the no-confirm fallback) claims a layer here
   *  instead of reaching `document.body` (the sanctioned above-composition route). */
  overlay?: MountHost['overlay']
  /** The open file path, read live (it changes as the editor re-opens). */
  currentPath: () => string | null
  /** Peek builder for an affected-referrer row in the confirm dialog (the editor's `previewPath`). */
  previewContent?: LinkResolver
  /** Surface a transient message on the editor's status line. */
  setStatus: (message: string, kind?: 'error' | 'info') => void
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function basename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}
function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i < 0 ? '' : path.slice(0, i)
}

/** Entry point: dispatch the two halves. */
export async function performRename(view: EditorView, target: RenameTarget, ctx: RenameContext): Promise<void> {
  if (target.kind === 'wikilink-file') {
    await renameFile(view, target, ctx)
  } else {
    await renameInFile(view, target, ctx)
  }
}

// --- the FILE-rename half (real: engine `rename` saga via host.files.rename) -------------------
async function renameFile(view: EditorView, target: RenameTarget, ctx: RenameContext): Promise<void> {
  const origin = ctx.currentPath() ?? undefined
  const out = await readResolveTarget(ctx.engine, target.text, origin)
  if (!('ready' in out) || !out.ready || !out.result) {
    ctx.setStatus(`cannot rename [[${target.text}]] — no file resolves for it`, 'error')
    return
  }
  // A type-def target carries an openable physical `source.file`; otherwise `path` is the file.
  const path = out.result.source ? out.result.source.file : out.result.path
  if (!path) {
    ctx.setStatus(`cannot rename [[${target.text}]] — target is not a file`, 'error')
    return
  }
  // Blast radius: the file's inbound referrers (distinct source files), for the confirm preview.
  const refsOut = await readReferencesIn(ctx.engine, path)
  const affected =
    'ready' in refsOut && refsOut.ready && refsOut.result
      ? [...new Set(refsOut.result.map((r) => r.source))].sort()
      : []

  const base = basename(path)
  const dir = dirname(path)
  const newBase = await promptNewName(view, target, ctx, {
    title: 'Rename file',
    message: `Renaming ${base} will update ${affected.length} reference${affected.length === 1 ? '' : 's'}.`,
    affected,
    peek: ctx.previewContent,
    initial: base,
    confirmLabel: 'Rename',
  })
  if (newBase == null) return
  const trimmed = newBase.trim()
  if (!trimmed || trimmed === base) return
  const newPath = dir ? `${dir}/${trimmed}` : trimmed

  const res = await ctx.files.rename(path, newPath)
  if (res.ok) {
    ctx.setStatus(`renamed ${base} → ${trimmed}${affected.length ? ` (updated ${affected.length} reference${affected.length === 1 ? '' : 's'})` : ''}`, 'info')
  } else if (res.conflict) {
    ctx.setStatus(`rename blocked: ${base} changed on disk — reopen and retry`, 'error')
  } else {
    ctx.setStatus(`rename failed: ${res.error ?? 'unknown error'}`, 'error')
  }
}

/** New name via the host confirm surface (blast-radius preview) when present, else the inline box. */
async function promptNewName(
  view: EditorView,
  target: RenameTarget,
  ctx: RenameContext,
  // `peek` is passed only when the `affected` rows are FILE paths. The in-file half's rows are line
  // numbers in this document, and wiring a file resolver to them would advertise a peek that resolves
  // nothing (the surface renders its ⌘-hover hint off this field alone).
  opts: { title: string; message: string; affected: string[]; peek?: LinkResolver; initial: string; confirmLabel: string },
): Promise<string | null> {
  if (ctx.confirm) {
    const outcome = await ctx.confirm.confirm({
      title: opts.title,
      message: opts.message,
      affected: opts.affected,
      previewContent: opts.peek,
      input: { value: opts.initial },
      confirmLabel: opts.confirmLabel,
    })
    return outcome.confirmed ? (outcome.value ?? opts.initial) : null
  }
  // Fallback: the inline box (no blast-radius preview without the confirm surface). It draws into a
  // host.overlay layer, never document.body — so with neither surface present, rename cannot prompt.
  if (!ctx.overlay) {
    ctx.setStatus('rename needs the host confirm or overlay surface, which is unavailable', 'error')
    return null
  }
  const overlay = ctx.overlay
  return new Promise((resolve) => {
    inlineRenameBox(view, target.from, opts.initial, overlay, (v) => resolve(v), () => resolve(null))
  })
}

// --- the IN-FILE-rename half (identifier / field key / block-id, whole-document) ---------------
async function renameInFile(view: EditorView, target: RenameTarget, ctx: RenameContext): Promise<void> {
  const label = target.kind === 'blockid' ? `^${target.text}` : target.text
  // Blast radius BEFORE the prompt, exactly as the file half reads its referrers first. The spans
  // depend only on the OLD name, so they are computable before the new one is typed.
  const spans = matchSpans(view, target)
  if (spans.length === 0) {
    // When the token is no longer present, report that no replacements were applied.
    ctx.setStatus(`nothing renamed — no whole-token match for ${label} in this file`, 'error')
    return
  }
  const lines = [...new Set(spans.map((s) => view.state.doc.lineAt(s.from).number))]
  const next = await promptNewName(view, target, ctx, {
    title: 'Rename in file',
    message: `Renaming ${label} will rewrite ${spans.length} occurrence${spans.length === 1 ? '' : 's'} on ${lines.length} line${lines.length === 1 ? '' : 's'} of this file — including matches in strings and comments.`,
    affected: lines.map((n) => `line ${n}`),
    initial: target.text,
    confirmLabel: 'Rename',
  })
  if (next == null) return
  const trimmed = next.trim()
  if (!trimmed || trimmed === target.text) return
  const count = applyInFileRename(view, target, trimmed)
  const where = `in this file (${count} occurrence${count === 1 ? '' : 's'})`
  if (target.kind === 'blockid') {
    // Cross-document symbol and block-id renaming is not supported.
    ctx.setStatus(
      `renamed ^${target.text} → ^${trimmed} ${where}. References in other files are not updated.`,
      'info',
    )
  } else {
    ctx.setStatus(`renamed ${target.text} → ${trimmed} ${where}`, 'info')
  }
}

/** Every whole-token occurrence in the document. The previewed blast radius and the applied edit
 *  read the SAME function, so the confirm can never state a count the transaction does not make. */
function matchSpans(view: EditorView, target: RenameTarget): { from: number; to: number }[] {
  const text = view.state.doc.toString()
  const re =
    target.kind === 'blockid'
      // `^id` — the definition line AND every `[[…^id]]` fragment in this file. Boundary after the id.
      ? new RegExp(`\\^${escapeRegExp(target.text)}(?![\\w-])`, 'g')
      // A plain identifier / frontmatter field key: whole-token matches only (not substrings).
      : new RegExp(`(?<![\\w-])${escapeRegExp(target.text)}(?![\\w-])`, 'g')
  const spans: { from: number; to: number }[] = []
  for (const m of text.matchAll(re)) {
    const from = m.index ?? 0
    spans.push({ from, to: from + m[0].length })
  }
  return spans
}

/** Replace every whole-token occurrence in ONE transaction. Returns the count actually applied —
 *  re-matched here, so a doc that changed while the confirm was open reports what it really did. */
function applyInFileRename(view: EditorView, target: RenameTarget, next: string): number {
  const spans = matchSpans(view, target)
  if (spans.length === 0) return 0
  const insert = target.kind === 'blockid' ? `^${next}` : next
  view.dispatch({ changes: spans.map((s) => ({ from: s.from, to: s.to, insert })) })
  return spans.length
}

// --- the inline rename box (anchored at the caret) -------------------------------
// A floating token-themed input over the caret. Drawn into a host.overlay layer (the sanctioned
// above-composition site) so the editor's overflow never clips it — NEVER document.body. Fixed-
// positioned at the caret rect; tokens only, NO left-edge accent bar. Enter commits, Esc / blur cancels.
function inlineRenameBox(
  view: EditorView,
  at: number,
  initial: string,
  overlay: NonNullable<MountHost['overlay']>,
  onCommit: (value: string) => void,
  onCancel: () => void,
): void {
  const coords = view.coordsAtPos(at)
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'au-rename-box'
  input.spellcheck = false
  input.setAttribute('autocomplete', 'off')
  input.setAttribute('aria-label', 'Rename')
  input.value = initial
  input.style.cssText = [
    'position: fixed',
    `left: ${Math.round(coords?.left ?? 0)}px`,
    `top: ${Math.round((coords?.bottom ?? 0) + 2)}px`,
    'z-index: 2147483000',
    'min-width: 140px',
    'font: var(--au-t-sm)/var(--au-lh-sm) var(--au-font-mono,ui-monospace, "SF Mono", monospace)',
    'padding: var(--au-space-0-5) var(--au-space-2)',
    'background: var(--au-color-surface, var(--au-color-bg))',
    'color: var(--au-ink-1)',
    'border: 1px solid var(--au-color-accent)',
    // The literal fallback MUST equal --au-radius-sm (5px), so an unresolved token degrades to the
    // same radius rather than a hair tighter.
    'border-radius: var(--au-radius-sm, 5px)',
    'box-shadow: var(--au-sh-pop)',
    'outline: none',
  ].join(';')
  // A press inside the box belongs to the box, never an ancestor layout-drag slot.
  input.dataset.auPressHold = 'off'
  // Claim a host overlay layer (the sanctioned above-composition route) and draw into it.
  const layer = overlay.claim({ level: 'popover' })
  layer.el.appendChild(input)
  input.focus()
  input.select()

  let done = false
  const finish = (commit: boolean): void => {
    if (done) return
    done = true
    const value = input.value
    layer.release()
    view.focus()
    if (commit) onCommit(value)
    else onCancel()
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      finish(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      finish(false)
    }
    e.stopPropagation()
  })
  input.addEventListener('blur', () => finish(false))
}
