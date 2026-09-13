import { displayFilePath } from '@arsumbris/au-host-sdk'
import {bindDocumentToolbar} from '@arsumbris/style/document-scroll'
import { auHighlightStyle, auEditorTheme } from '@arsumbris/code-syntax/view'
// Editor projection over host files, saved file config, and the engine read channel.
// CodeMirror owns editing and commodity markdown/YAML syntax. The engine supplies
// semantic and type-aware information from disk; CodeMirror maps spans through edits.
// Navigation resolves a target and fires an open intent for a container to handle.

import { languageForPath } from '@arsumbris/code-syntax'
import { viewerSwitchSets, runViewerSwitch } from '@arsumbris/container-core'
import { foldEffect, foldedRanges, syntaxHighlighting, syntaxTree, unfoldEffect } from '@codemirror/language'
import { Annotation, Compartment, EditorSelection, type EditorState, type Text, Prec, RangeSet, RangeValue, StateEffect, StateField, Transaction } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from '@codemirror/view'
import { setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint'
import type { SyntaxNode } from '@lezer/common'
import { readSource, writeSource, preserveSourceText, loadSourceLayout, sourceByteToChar } from './source-text'
import { basicSetup } from 'codemirror'

import { defineProjection, type MountHost, type PreviewSurface, event, on } from '@arsumbris/au-host-sdk'
import { readDiagnostics, readReferencesIn, readInstancesOf, readResolveAnchor, readResolveBlockId, readResolveTarget, readSemanticTokens, readType, readTypes, type WireDiagnostic, type WireDiagnosticSeverity, type WireSemanticToken, subscribeChanges, subscribeDiagnostics } from '@arsumbris/au-host-sdk/engine-reads'
import { highlightIntent, openIntent, promoteIntent } from '@arsumbris/intent'
import { fileSelection, openContent } from '@arsumbris/selection'
import type { TextRange } from '@arsumbris/range'

import {
  type FieldKind,
  frontmatterRegion,
  makeHoverContent,
  naiveKind,
  shapeKind,
  tokenLabel,
} from '@arsumbris/preview-content'
import { createHoverCard, HOVER_CARD_CSS } from './hover-card'
import { findReplace } from './find-replace'
import { minimap } from './minimap'
import { performRename, type RenameContext, type RenameTarget } from './rename'
import { auCompletion } from './lib/completion'
import { yamlFieldContext, resolveYamlField, type YamlFieldContext } from './lib/yaml-field'
import { prepareRead } from './lib/prepare-read'
import { selectionPresentation } from './lib/selection-presentation'
import documentControlsCss from '@arsumbris/style/document-controls.css?inline'
// `sameFile` lives beside the reveal decision it gates: both answer "does this incoming path refer
// to the file I hold?", and the hint-vs-open-path suffix rule is the same rule in both.
import { decideReveal, sameFile } from './lib/reveal-arbitration'

/**
 * Engine severity → CodeMirror lint severity.
 *
 * `drift` has no CM counterpart: it is advisory like a warning but deliberately its own
 * high-attention tier (a borrowed copy diverged from upstream). It renders as a warning, which
 * loses the distinction — the `source` (the diagnostic CODE) still carries it in the tooltip.
 */
const CM_SEVERITY: Record<WireDiagnosticSeverity, CmDiagnostic['severity']> = {
  error: 'error',
  drift: 'warning',
  warning: 'warning',
  hint: 'hint',
}

// Host capabilities used by the editor: files, selection, saved config, view state,
// engine reads/subscriptions, and connection state. Local shapes describe optional
// host capabilities. The config's file field records the open document.
interface EditorConfig {
  file?: string
  // show the document minimap gutter. OPTIONAL (default OFF).
  // Mirrors the `minimap?: Boolean` field on editor-pane.type.yaml; a composition opts in.
  minimap?: boolean
}
// The host derives config ownership from the type graph and preserves unowned fields
// at saveConfig. This projection emits only the fields it understands.
interface EditorViewState {
  cursor?: number // selection main-head offset
  ranges?: { anchor: number; head: number }[] // full multi-selection (a single range restores an anchor..head)
  mainIndex?: number
  scroll?: number // scrollDOM.scrollTop
  scrollLeft?: number
  wrap?: boolean
  folds?: [number, number][] // folded ranges [from, to]
}

// Colors / fonts / radii come from the host's injected @arsumbris/style tokens
// (--au-*), inherited via the shared-DOM cascade. No hardcoded hex.
const STYLE = `
@keyframes au-editor-reveal-flash { from { box-shadow: inset 0 0 0 3px var(--au-color-accent); } to { box-shadow: inset 0 0 0 3px transparent; } }
.au-editor-reveal-flash { animation: au-editor-reveal-flash var(--au-m-cinema) var(--au-e-std); }
@media (prefers-reduced-motion: reduce) { .au-editor-reveal-flash { animation: none; } }
.au-editor { display: flex; flex-direction: column; height: 100%; min-width: 0; container-type: inline-size; color: var(--au-ink-2); background: transparent; box-sizing: border-box; padding: 0; font: var(--au-t-sm)/var(--au-lh-base) var(--au-font-mono); }
.au-editor-bar { display: flex; flex-wrap: nowrap; gap: var(--au-space-1); align-items: center; padding: var(--au-space-2) var(--au-space-4); min-height: var(--au-space-7); box-sizing: content-box; font-family: var(--au-font-sans); }
.au-editor-status { padding: var(--au-space-1) var(--au-space-3); color: var(--au-ink-3); font: var(--au-t-xs)/var(--au-lh-base) var(--au-font-sans); }
.au-editor-status.error { color: var(--au-color-danger); opacity: 1; }
.au-editor-status.dirty { color: var(--au-color-warn); }
.au-editor-debug { padding: var(--au-space-1) var(--au-space-2); font-size: var(--au-t-2xs); color: var(--au-color-muted); border-bottom: 1px solid var(--au-color-border); white-space: pre-wrap; word-break: break-word; }
.au-editor-debug .k { color: var(--au-color-accent); }
.au-editor-host { flex: 1; min-height: 0; overflow: hidden; }
.au-editor-host .cm-editor { height: 100%; }
.cm-content .au-tok-val-bool { color: var(--au-code-type); }
.cm-content .au-tok-val-number { color: var(--au-code-number); }
.cm-content .au-tok-val-string { color: var(--au-code-string); }
.cm-content .au-tok-val-ref { color: var(--au-color-accent); }
.cm-content .au-tok-builtin { color: var(--au-code-type); font-style: italic; }
.cm-content .au-tok-wikilink { color: var(--au-link-internal); text-decoration: none; }
.cm-content .au-tok-broken-wikilink { color: var(--au-color-danger); text-decoration: underline wavy var(--au-color-danger); }
.cm-content .au-tok-wikilink-brace { color: var(--au-color-muted); }
/* Inline reference count: a muted, clickable line above the file
   head / a referenced block-id. A block widget, so it sits on its own line above the target. */
.au-inline-references { font: var(--au-t-2xs)/var(--au-lh-2xs) var(--au-font-mono); color: var(--au-ink-4); cursor: pointer; padding: 0 0 1px 2px; width: max-content; }
.au-inline-references:hover { color: var(--au-color-accent); text-decoration: underline; }
.au-inline-references-inst { text-decoration: none; }
.au-inline-references-inst:hover { text-decoration: none; }
.au-inline-references-inst span[data-inst-type] { cursor: pointer; }
.au-inline-references-inst span[data-inst-type]:hover { color: var(--au-color-accent); text-decoration: underline; }
/* Cmd/Ctrl-hover over a wikilink: it's clickable (go-to-def). Brighter + a solid,
   thicker underline + a pointer cursor. The class is added to the WHOLE [[...]] span. */
.cm-content .au-tok-link-active, .cm-content .au-tok-link-active * { cursor: pointer; }
.cm-content .au-tok-link-active { cursor: pointer; }
.cm-content .au-tok-link-active .au-tok-wikilink, .cm-content .au-tok-wikilink.au-tok-link-active { color: var(--au-link-internal); text-decoration: none; }
/* The tooltip BOX (background/border) is themed via EditorView.theme (auEditorTheme) — a raw
   .cm-tooltip rule loses to CodeMirror's injected base theme. Here we only style the content. */
/* Hover tooltip content (engine token info). */
.au-editor-hover { font: var(--au-t-xs)/var(--au-lh-xs) var(--au-font-mono); padding: var(--au-space-1) var(--au-space-2); max-width: 380px; }
.au-editor-hover-head { font-weight: var(--au-w-strong); color: var(--au-color-accent); }
.au-editor-hover-doc { color: var(--au-ink-2); margin-top: var(--au-space-1); white-space: pre-wrap; }
.au-editor-hover-sub { color: var(--au-ink-4); margin-top: var(--au-space-1); }
/* Type go-to-def site picker (owner + vendored copies). Floating, fixed to the click point. */
.cm-content .au-tok-url { color: var(--au-link-external); text-decoration: underline; text-underline-offset: 3px; }
.cm-content .au-tok-contribution { color: var(--au-color-ok); }
.cm-content .au-tok-blockid { color: var(--au-color-anchor); }
.au-editor-location { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--au-ink-3); font-size: var(--au-t-xs); }
.au-document-view > .au-editor-bar.au-document-toolbar { padding-inline-end: var(--au-space-4); }
.au-editor-bar > :not(.au-editor-location) { flex: none; }
.au-editor-options { position: static; font-size: var(--au-t-xs); }
.au-editor-options > summary { list-style: none; padding: var(--au-space-2); cursor: pointer; color: var(--au-ink-3); border-radius: var(--au-radius-sm); }
.au-editor-options > summary:focus-visible { outline: 1px solid var(--au-control-focus, var(--au-focus-outer)); outline-offset: -1px; }
.au-editor-options > summary::-webkit-details-marker { display: none; }
.au-editor-options > summary:hover, .au-editor-options[open] > summary { color: var(--au-ink-1); background: var(--au-chrome-hover); }
.au-editor-options-panel { position: absolute; top: calc(var(--document-action-height) + var(--document-action-top) * 2); right: var(--document-action-end); z-index: var(--au-z-overlay); width: min(360px, calc(100% - var(--au-space-3) * 2)); max-height: calc(100% - var(--document-action-height) - var(--document-action-top) * 2 - var(--au-space-3)); }
.au-editor-options-panel::part(body) { overflow: hidden; }
.au-editor-options-scroll { min-height: 0; }
.au-editor-options-content { display: flex; flex-wrap: wrap; gap: var(--au-space-2); }
.au-editor-options-content au-input { flex-basis: 100% !important; }
.au-editor-options:not([open]) .au-editor-options-panel { display: none; }
.au-editor-status { min-height: var(--au-space-6); }

`

// Set-independent structural casts for the vanilla editor chrome creating <au-*> controls. au-button
// emits `au-activate`; au-input emits `au-input` (`.value` mirrors each keystroke).
type AuBtnEl = HTMLElement & { disabled: boolean }
type AuInputEl = HTMLElement & { value: string; disabled: boolean }
function auBtn(label: string): AuBtnEl {
  const b = document.createElement('au-button') as AuBtnEl
  b.setAttribute('size', 'sm')
  b.setAttribute('variant', 'ghost')
  b.textContent = label
  return b
}

// --- token decorations ------------------------------------------------------
// One DecorationSet, recomputed off-thread (wikilinks need engine round-trips)
// and swapped in via an effect. The field re-maps through edits so highlights
// track the text until the next recompute lands.

const wikilinkMark = Decoration.mark({ class: 'au-tok-wikilink' })
const brokenWikilinkMark = Decoration.mark({ class: 'au-tok-broken-wikilink' })
const wikilinkBraceMark = Decoration.mark({ class: 'au-tok-wikilink-brace' })
const urlMark = Decoration.mark({ class: 'au-tok-url' })
const contributionMark = Decoration.mark({ class: 'au-tok-contribution' })
const blockIdMark = Decoration.mark({ class: 'au-tok-blockid' })

// Type-aware frontmatter value marks from the engine-driven semantic overlay.
const valBoolMark = Decoration.mark({ class: 'au-tok-val-bool' })
const valNumberMark = Decoration.mark({ class: 'au-tok-val-number' })
const valStringMark = Decoration.mark({ class: 'au-tok-val-string' })
const valRefMark = Decoration.mark({ class: 'au-tok-val-ref' })
const builtinMark = Decoration.mark({ class: 'au-tok-builtin' }) // type-def shape builtins (String, Date, file, …)

function valueMarkFor(kind: FieldKind): Decoration {
  switch (kind) {
    case 'bool':
      return valBoolMark
    case 'number':
      return valNumberMark
    case 'ref':
      return valRefMark
    default: // string, enum
      return valStringMark
  }
}

/**
 * Push `mark` over [from, to) but skip any `excluded` spans (sorted by start), so a
 * frontmatter value's type color does not paint over a wikilink / url inside it.
 */
function paintExcluding(
  ranges: ReturnType<typeof valStringMark.range>[],
  mark: Decoration,
  from: number,
  to: number,
  excluded: Array<[number, number]>,
): void {
  let cursor = from
  for (const [ef, et] of excluded) {
    if (et <= cursor) continue
    if (ef >= to) break
    if (ef > cursor) ranges.push(mark.range(cursor, Math.min(ef, to)))
    cursor = Math.max(cursor, et)
    if (cursor >= to) return
  }
  if (cursor < to) ranges.push(mark.range(cursor, to))
}

// The LIVE layer: regex structure + the frontmatter type guess. Rebuilt on every
// edit, instant. Re-maps through edits between rebuilds.
const setTokens = StateEffect.define<DecorationSet>()
const tokenField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const effect of tr.effects) if (effect.is(setTokens)) value = effect.value
    return value
  },
  provide: (field) => EditorView.decorations.from(field),
})

// The ENGINE layer: authoritative tokens (broken-wikilink resolution) set on
// fetch and MAPPED through edits, so they follow the text and only refresh on
// save / changes. It overlaps the live layer; `.au-tok-broken-wikilink` is
// ordered after `.au-tok-wikilink` in STYLE, so the engine's danger wins.
const setEngineTokens = StateEffect.define<DecorationSet>()
const engineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const effect of tr.effects) if (effect.is(setEngineTokens)) value = effect.value
    return value
  },
  provide: (field) => EditorView.decorations.from(field),
})

// The CMD/CTRL-HOVER affordance: the single `[[…]]` under the cursor while a modifier is
// held, marked clickable (the `.au-tok-link-active` class adds the pointer cursor + a
// brighter, thicker underline). One range at a time, or none. Driven by mouse/key handlers.
const setActiveLink = StateEffect.define<{ from: number; to: number } | null>()
const activeLinkMark = Decoration.mark({ class: 'au-tok-link-active' })
const activeLinkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(setActiveLink)) {
        value = effect.value
          ? Decoration.set([activeLinkMark.range(effect.value.from, effect.value.to)])
          : Decoration.none
      }
    }
    return value
  },
  provide: (field) => EditorView.decorations.from(field),
})

// The engine's SEMANTIC TOKENS retained as data addressable by cursor position (NOT styling —
// that is engineField/tokenField). A `RangeSet` so CodeMirror maps the spans through edits for
// free; the cursor lookup powers hovers + type/field go-to-def.
class TokenValue extends RangeValue {
  constructor(readonly token: WireSemanticToken) {
    super()
  }
}
const setTokenData = StateEffect.define<RangeSet<TokenValue>>()
const tokenDataField = StateField.define<RangeSet<TokenValue>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const effect of tr.effects) if (effect.is(setTokenData)) value = effect.value
    return value
  },
})

// INLINE REFERENCE COUNTS: a "N references" line above the file head (whole-file refs) and above each
// referenced `^block-id` in the file. Count comes from one `backlinks(currentFile)` read,
// grouped by the backlink's TARGET `block_id`. CLICK or cmd+hover → a find-all-references PEEK
// (the references LIST in the host preview overlay). The widget carries its file + blockId as
// data attributes so the editor's hover can find it.
class InlineReferencesWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly file: string,
    readonly blockId: string | undefined,
    readonly onActivate: (rect: DOMRect, file: string, blockId?: string) => void,
  ) {
    super()
  }
  eq(other: InlineReferencesWidget): boolean {
    return other.label === this.label && other.file === this.file && other.blockId === this.blockId
  }
  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'au-inline-references'
    el.textContent = `⮌ ${this.label}`
    el.dataset.refsFile = this.file
    if (this.blockId) el.dataset.refsBlock = this.blockId
    // mousedown + preventDefault so the editor selection / focus is not disturbed.
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      this.onActivate(el.getBoundingClientRect(), this.file, this.blockId)
    })
    return el
  }
  ignoreEvent(): boolean {
    return false
  }
}
const setInlineReferences = StateEffect.define<DecorationSet>()
const inlineReferencesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const effect of tr.effects) if (effect.is(setInlineReferences)) value = effect.value
    return value
  },
  provide: (field) => EditorView.decorations.from(field),
})

// INLINE INSTANCE COUNTS: a "N instances" line above each `type:` CLAIM in
// an instance file, and above a type-def's own name (its file head). Count = `instances_of(type)`
// — a DIFFERENT read than `backlinks(file)`, so a separate widget + field. A line may
// carry several claims (`type: [person, quality]`), so the widget renders one clickable SEGMENT
// per type; click / cmd+hover a segment → a find-all-INSTANCES peek in the host preview overlay.
class InstancesLensWidget extends WidgetType {
  constructor(
    readonly segments: ReadonlyArray<{ type: string; count: number }>,
    readonly onActivate: (rect: DOMRect, type: string) => void,
  ) {
    super()
  }
  eq(other: InstancesLensWidget): boolean {
    return (
      other.segments.length === this.segments.length &&
      this.segments.every((s, i) => s.type === other.segments[i].type && s.count === other.segments[i].count)
    )
  }
  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'au-inline-references au-inline-references-inst'
    this.segments.forEach((s, i) => {
      if (i > 0) el.append(' · ')
      const seg = document.createElement('span')
      seg.textContent = `⊙ ${s.count} ${s.type}`
      seg.dataset.instType = s.type // cmd+hover detection + the activate target
      seg.addEventListener('mousedown', (e) => {
        e.preventDefault() // keep editor selection/focus
        this.onActivate(seg.getBoundingClientRect(), s.type)
      })
      el.append(seg)
    })
    return el
  }
  ignoreEvent(): boolean {
    return false
  }
}
const setInstancesLens = StateEffect.define<DecorationSet>()
const instancesLensField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const effect of tr.effects) if (effect.is(setInstancesLens)) value = effect.value
    return value
  },
  provide: (field) => EditorView.decorations.from(field),
})

/** The engine semantic token whose span contains `pos` (the first, if several), or null. */
function tokenAt(state: EditorState, pos: number): { token: WireSemanticToken; from: number; to: number } | null {
  let hit: { token: WireSemanticToken; from: number; to: number } | null = null
  state.field(tokenDataField).between(pos, pos, (from, to, value) => {
    hit = { token: value.token, from, to }
    return false // stop at the first
  })
  return hit
}

/** What a Mod-click / Mod-hover acts on at `pos`: a `[[wikilink]]`, a URL, a type-name, or a field. */
type ClickTarget =
  | { kind: 'wikilink'; from: number; to: number; link: WikilinkHit }
  | { kind: 'url'; from: number; to: number; url: string }
  | { kind: 'type'; from: number; to: number; name: string }
  | { kind: 'field'; from: number; to: number; field: string; context: YamlFieldContext }

/** An `https?://…` URL under `col` in `lineText` (line-relative span). Clickable in frontmatter
 *  values AND free-text body — mirrors the engine's `Url` primitive discriminator (`^https?://`).
 *  Trailing sentence punctuation is trimmed so `see https://x.com.` doesn't swallow the period. */
export function urlAt(lineText: string, col: number): { url: string; from: number; to: number } | null {
  const re = /https?:\/\/[^\s<>"'`\])}]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(lineText)) !== null) {
    let url = m[0]
    let to = m.index + url.length
    // Trim trailing punctuation that reads as prose, not part of the URL.
    while (url.length && '.,;:!?'.includes(url[url.length - 1])) {
      url = url.slice(0, -1)
      to -= 1
    }
    if (col >= m.index && col <= to) return { url, from: m.index, to }
  }
  return null
}

/** The frontmatter FIELD KEY at `pos` (the `myField` in `myField: value`), if the cursor is on the
 *  key itself and inside the `--- … ---` frontmatter block. Keys are NOT engine-tokenized, so this
 *  is a live-layer detection. The reserved `type` key is an identity claim, not a declared field. */
function frontmatterKeyAt(state: EditorState, pos: number): { name: string; from: number; to: number } | null {
  const line = state.doc.lineAt(pos)
  const m = /^(\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*:/.exec(line.text)
  if (!m) return null
  const from = m[1].length
  const to = from + m[2].length
  const col = pos - line.from
  if (col < from || col > to) return null // cursor is not on the key
  if (m[2] === 'type') return null // the `type:` identity claim is not a declared field; its VALUE jumps (type-claim token)
  // Confirm we're in the frontmatter block (a `key:` elsewhere is not a type field). Only reached
  // when the line already looks like a key, so the full-doc scan stays off the hot path.
  const fm = frontmatterRegion(state.doc.toString())
  if (!fm || pos < fm.start || pos >= fm.end) return null
  return { name: m[2], from, to }
}

function clickTargetAt(state: EditorState, pos: number, path: string | null): ClickTarget | null {
  const line = state.doc.lineAt(pos)
  const col = pos - line.from
  // A `[[wikilink]]` (parsed from the line text — the live layer, no engine dependency).
  const hit = wikilinkTargetAt(line.text, col)
  if (hit) return { kind: 'wikilink', from: line.from + hit.from, to: line.from + hit.to, link: hit }
  // A URL (live layer) — clickable in a frontmatter value or the body; opens externally.
  const url = urlAt(line.text, col)
  if (url) return { kind: 'url', from: line.from + url.from, to: line.from + url.to, url: url.url }
  // A frontmatter FIELD KEY → jump to the type-def that DECLARES the field. (The field VALUE is
  // inert: a plain value click does nothing; a wikilink/url value is handled above.)
  const source = state.doc.toString()
  const region = path && /\.ya?mls?$/.test(path) ? { start: 0, end: source.length } : frontmatterRegion(source)
  const key = region && pos >= region.start && pos < region.end ? yamlFieldContext(source.slice(region.start, region.end), pos - region.start) : null
  if (key && region) return { kind: 'field', from: region.start + key.from, to: region.start + key.to, field: key.steps[key.steps.length - 1]!.field, context: key }
  // An engine token: a `type:` claim value OR a `type-ref` (a navigable type-def name inside a
  // TYPE-DEF's shape / sealed branch / parent claim) — both jump to that type-def.
  const tok = tokenAt(state, pos)
  if (tok && (tok.token.kind === 'type-claim' || tok.token.kind === 'type-ref')) {
    return { kind: 'type', from: tok.from, to: tok.to, name: tok.token.name }
  }
  return null
}

/** Resolve a wikilink under `col` to its bare daemon target and full line-relative
 * span. Strip display aliases and fragments before `resolve_target`. This helper
 * resolves the file; it does not navigate to a fragment within that file. */
export interface WikilinkHit {
  /** The bare daemon target (empty for a file-local `[[^id]]` / `[[#head]]`). */
  target: string
  /** The `#heading` fragment, if any (jumps to that heading's span). */
  anchor?: string
  /** The `^block-id` fragment, if any (jumps to that block's span). */
  blockId?: string
  /** The full `[[…]]` range, line-relative, braces included (for the hover affordance). */
  from: number
  to: number
}

export function wikilinkTargetAt(lineText: string, col: number): WikilinkHit | null {
  const before = lineText.slice(0, col)
  const openIdx = before.lastIndexOf('[[')
  if (openIdx < 0) return null
  if (before.slice(openIdx + 2).includes(']]')) return null
  const after = lineText.slice(col)
  const closeIdx = after.indexOf(']]')
  if (closeIdx < 0) return null
  if (after.slice(0, closeIdx).includes('[[')) return null
  const inner = lineText.slice(openIdx + 2, col + closeIdx)
  // Fragment order: name #anchor ^block-id :field, plus a trailing |alias.
  let s = inner.split('|', 1)[0]
  let blockId: string | undefined
  let anchor: string | undefined
  const caret = s.indexOf('^')
  if (caret >= 0) {
    let frag = s.slice(caret + 1)
    s = s.slice(0, caret)
    const colon = frag.indexOf(':')
    if (colon >= 0) frag = frag.slice(0, colon) // drop the body-contribution :field
    blockId = frag.trim() || undefined
  }
  const hash = s.indexOf('#')
  if (hash >= 0) {
    anchor = s.slice(hash + 1).trim() || undefined
    s = s.slice(0, hash)
  }
  const target = s.trim()
  // A pure file-local form (`[[^id]]` / `[[#head]]`) has an empty target but a fragment.
  if (!target && !blockId && !anchor) return null
  return { target, anchor, blockId, from: openIdx, to: col + closeIdx + 2 }
}

// --- rename-symbol target detection ------------------------------------

/** A `^block-id` token under `col` (the `^id` definition OR a `[[…^id]]` fragment): the id span,
 *  line-relative, WITHOUT the caret. The cursor may sit anywhere on the `^id` token. */
function blockIdAt(lineText: string, col: number): { id: string; from: number; to: number } | null {
  const re = /\^([A-Za-z][A-Za-z0-9_-]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(lineText)) !== null) {
    const idFrom = m.index + 1 // after the caret
    const idTo = idFrom + m[1].length
    if (col >= m.index && col <= idTo) return { id: m[1], from: idFrom, to: idTo }
  }
  return null
}

/** A plain identifier (letters/digits/_/-) under `col`, line-relative. */
function wordAt(lineText: string, col: number): { word: string; from: number; to: number } | null {
  const re = /[A-Za-z_][A-Za-z0-9_-]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(lineText)) !== null) {
    const from = m.index
    const to = from + m[0].length
    if (col >= from && col <= to) return { word: m[0], from, to }
  }
  return null
}

/**
 * What F2 renames at `pos`: a wikilink TARGET (→ a FILE rename via the engine saga), a `^block-id`
 * (→ in-file, without cross-document reference updates), a frontmatter FIELD key, or a plain identifier
 * (both → in-file rename across the whole document). Null when nothing renamable sits at `pos`.
 */
function renameTargetAt(state: EditorState, pos: number): RenameTarget | null {
  const line = state.doc.lineAt(pos)
  const col = pos - line.from
  // A `[[wikilink]]` with a real target → rename that FILE (host.files.rename rewrites referrers).
  const link = wikilinkTargetAt(line.text, col)
  if (link && link.target) {
    return { kind: 'wikilink-file', text: link.target, from: line.from + link.from, to: line.from + link.to }
  }
  // A `^block-id` (incl. a file-local `[[^id]]`'s id) → in-file rename; cross-document references are not renamed.
  const block = blockIdAt(line.text, col) ?? (link?.blockId ? { id: link.blockId, from: -1, to: -1 } : null)
  if (block && block.id) {
    const located = block.to > block.from && block.from >= 0
    return {
      kind: 'blockid',
      text: block.id,
      from: located ? line.from + block.from : pos,
      to: located ? line.from + block.to : pos,
    }
  }
  // A frontmatter FIELD key → in-file rename (the key everywhere it appears in the doc).
  const key = frontmatterKeyAt(state, pos)
  if (key) return { kind: 'identifier', text: key.name, from: line.from + key.from, to: line.from + key.to }
  // A plain identifier under the cursor → in-file rename.
  const word = wordAt(line.text, col)
  if (word) return { kind: 'identifier', text: word.word, from: line.from + word.from, to: line.from + word.to }
  return null
}


function mount(container: HTMLElement, host: MountHost): () => void {
  const files = host.files
  const viewStore = host.viewStore
  // Intent channel (a required, host-totalized MountHost field): on the first real edit, fire a
  // `promote-intent` so the container promotes this (transient/preview) tab to permanent.
  const intent = host.intent

  const root = document.createElement('div')
  root.className = 'au-editor au-document-view'

  const bar = document.createElement('div')
  bar.className = 'au-editor-bar au-document-toolbar'
  const pathInput = document.createElement('au-input') as AuInputEl
  pathInput.setAttribute('size', 'sm')
  pathInput.setAttribute('aria-label', 'File path')
  pathInput.setAttribute('placeholder', 'entry-relative path, e.g. README.md')
  pathInput.style.flex = '1'
  pathInput.style.minWidth = '0'
  const openButton = auBtn('Open')
  const saveButton = auBtn('Save')
  saveButton.disabled = true
  const debugButton = auBtn('Tokens')
  debugButton.title = 'token inspector: show the syntax node, our decorations, and the engine token at the cursor'
  // Fires a BROADCAST ui-intent-highlight for the open file: every projection that handles it
  // lights up its own copy (the file-tree scrolls its row into view; this editor flashes its pane).
  const revealButton = auBtn('Reveal')
  revealButton.title = 'highlight this file across every view that shows it (scrolls the file-tree to it)'
  // a user-facing minimap toggle, so the gutter can be turned on/off without editing the config.
  // The state persists into the editor's own `minimap` config field (it round-trips into the saved
  // composition), reconfigured live via minimapCompartment.
  const minimapButton = auBtn('Minimap')
  const location = document.createElement('span')
  location.className = 'au-editor-location'
  // The shared switch occupies real toolbar space; available viewers come from declared metadata.
  const viewButton = document.createElement('au-viewer-switch') as HTMLElement & { primaryLabel?: string; hasMore?: boolean; disabled?: boolean }
  const otherOpeners = auBtn('Open with…')
  otherOpeners.hidden = true
  const options = document.createElement('details')
  options.className = 'au-editor-options'
  const optionsLabel = document.createElement('summary')
  optionsLabel.textContent = 'More'
  optionsLabel.setAttribute('aria-label', 'Editor options')
  const wrapButton = auBtn('Word wrap')
  wrapButton.title = 'Toggle wrapping long lines'
  wrapButton.setAttribute('aria-pressed', 'true')
  const optionsPanel = document.createElement('au-popover') as HTMLElement & { arrow: boolean }
  optionsPanel.arrow = false
  optionsPanel.setAttribute('heading', 'Editor options')
  optionsPanel.className = 'au-editor-options-panel'
  const optionsScroll = document.createElement('au-scroll-area')
  optionsScroll.className = 'au-editor-options-scroll'
  optionsScroll.setAttribute('axis', 'y')
  const optionsContent = document.createElement('div')
  optionsContent.className = 'au-editor-options-content'
  optionsContent.append(pathInput, openButton, revealButton, wrapButton, minimapButton, debugButton, otherOpeners)
  optionsScroll.append(optionsContent)
  optionsPanel.append(optionsScroll)
  options.append(optionsLabel, optionsPanel)
  options.addEventListener('keydown', event => {
    if (event.key === 'Escape') { options.open = false; optionsLabel.focus(); event.stopPropagation() }
  })
  bar.append(location, saveButton, viewButton)

  const status = document.createElement('div')
  status.className = 'au-editor-status'

  const debugLine = document.createElement('div')
  debugLine.className = 'au-editor-debug'
  debugLine.style.display = 'none'

  const editorHost = document.createElement('div')
  editorHost.className = 'au-editor-host'

  root.append(bar, debugLine, editorHost, status)
  container.appendChild(root)
  // ONE inject per root: the editor's chrome + the fallback hover-card's CSS, concatenated (a second
  // inject on `container` would overwrite the scope marker). The card mounts under `container`, so this
  // scopes it too — the `host.preview`-absent fallback path stays styled and CSP-clean.
  const disposeStyles = host.styles?.inject([STYLE, documentControlsCss, HOVER_CARD_CSS].join('\n'), container)

  let alive = true
  let currentPath: string | null = null
  let switching = false
  let dirty = false
  // The last `dirty || conflicted` value published on the view-state bus — so `render()` (which runs per
  // keystroke) publishes the dirty indicator only on a TRANSITION, not a per-keystroke rebroadcast of an
  // unchanged boolean. `undefined` until the first publish, so the initial state always publishes once.
  let lastPublishedDirty: boolean | undefined
  // an external write changed the open file while the buffer had unsaved edits.
  // We do NOT clobber the edits; this flag drives a sticky conflict status until the
  // user resolves it (save to overwrite, or reopen to discard). Cleared on open/save.
  let conflicted = false
  // True while our own save's write is in flight. The change event for our own write can
  // arrive before `save` re-baselines `lastHash`, which would otherwise read as an
  // external change — so the reload handler stands down until the save settles.
  let saving = false
  // The read-before-write guard baseline: the file's content hash as of the last
  // open or successful save. Carried back as the next save's `expectedHash` so a
  // save is rejected (not clobbered) when the file changed under us. `undefined`
  // = unguarded (the engine could not supply a hash); the save overwrites regardless.
  let lastHash: string | undefined
  // the on-disk content as the editor last KNEW it (set on open + successful
  // save). The reload check compares a re-read against THIS (not the live buffer, which
  // legitimately differs while dirty, and not the hash, which `resolve_target` leaves
  // undefined mid-derive). A re-read that differs is an external write; an identical
  // re-read (our own save's echo, or no real change) is skipped.
  let lastContent = ''
  let savedDoc: Text | null = null
  // True while restoring saved view-state on open, so the restore dispatches don't
  // echo back out as a view-state save.
  let restoring = false
  let viewStateTimer: ReturnType<typeof setTimeout> | undefined
  // Field -> kind map, learned from the engine's `field-value` tokens. The live
  // guess uses it to color frontmatter values by type, with a naive fallback for
  // fields the engine hasn't typed yet.
  let fieldKinds: Map<string, FieldKind> | null = null
  // Debug token inspector (off by default). `engineDebug` holds the last fetched
  // engine tokens, char-converted, for the cursor read-out.
  let debug = false
  let engineDebug: Array<{ from: number; to: number; label: string }> = []

  // Mark doc changes that come from a programmatic open, so they don't flag dirty.
  const loadEvent = Annotation.define<boolean>()
  const langCompartment = new Compartment()
  const wrapCompartment = new Compartment()
  let wrapOverride = true
  // the minimap rides its own compartment so the toggle button can reconfigure it live. Seeded
  // from the config's `minimap` field (default OFF).
  const minimapCompartment = new Compartment()
  let minimapOn = (host.config as EditorConfig | undefined)?.minimap === true

  let recomputeTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleRecompute(): void {
    if (recomputeTimer) clearTimeout(recomputeTimer)
    recomputeTimer = setTimeout(() => {
      recomputeTimer = null
      void recomputeTokens()
    }, 250)
  }

  // Fetch the engine's authoritative semantic tokens for the open file. They are
  // disk-state, so we convert their byte spans to editor positions against the
  // current buffer (exact while clean) and let CodeMirror map them through edits.
  // Two uses: learn the field -> kind map (for the live guess) and render the
  // resolution truth the live layer can't know (broken wikilinks).
  async function fetchSemanticTokens(): Promise<void> {
    if (!currentPath) return
    const path = currentPath
    // A *.yamls BUNDLE has NO tokens at its physical path — the engine serves them per VIRTUAL MEMBER
    // (`<bundle>/<member>.type.yaml`, each member's spans already rebased onto the physical file). So
    // enumerate the bundle's member type-defs (those whose `source.file` IS this bundle) and merge
    // their tokens. A normal file reads its tokens directly.
    let tokens: readonly WireSemanticToken[]
    if (path.endsWith('.yamls')) {
      const types = await readTypes(host.engine)
      if (!alive || currentPath !== path || 'ok' in types || !types.ready) return
      const members = types.result.filter((t) => t.source.file === path).map((t) => t.name)
      const perMember = await Promise.all(
        members.map((name) => readSemanticTokens(host.engine, `${path}/${name}.type.yaml`)),
      )
      // Merge; CM sorts on dispatch (Decoration.set/RangeSet.of with sort=true), so order across
      // members doesn't matter. Spans are pre-rebased onto this physical file, so `toChar` maps them.
      if (!alive || currentPath !== path) return
      tokens = perMember.flatMap((o) => ('ready' in o && o.ready && o.result ? o.result : []))
    } else {
      const outcome = await readSemanticTokens(host.engine, path)
      // Bail if the file changed under us during the read (else A's tokens land on B's doc).
      if (!alive || currentPath !== path || !('ready' in outcome) || !outcome.ready || !outcome.result) return
      tokens = outcome.result
    }
    const toChar = sourceByteToChar(view.state)
    const docLen = view.state.doc.length
    const kinds = new Map<string, FieldKind>()
    // Engine-authoritative color marks (laid as `engineField`, Prec.highest): broken wikilinks +
    // the TYPE-DEF-file kinds (the local pass can't know `decision*` is a type reference). A type-def
    // file thus highlights from the engine tokens; an instance still colors via the field-kind guess.
    const engineMarks: ReturnType<typeof brokenWikilinkMark.range>[] = []
    const debugTokens: Array<{ from: number; to: number; label: string }> = []
    const tokenRanges: ReturnType<TokenValue['range']>[] = []
    for (const token of tokens) {
      const from = Math.min(toChar(token.range.start), docLen)
      const to = Math.min(toChar(token.range.end), docLen)
      debugTokens.push({ from, to, label: tokenLabel(token) })
      if (from < to) tokenRanges.push(new TokenValue(token).range(from, to))
      if (token.kind === 'field-value') {
        kinds.set(token.field, shapeKind(token.value_type))
      } else if (from < to) {
        if (token.kind === 'wikilink-broken') engineMarks.push(brokenWikilinkMark.range(from, to))
        else if (token.kind === 'type-ref') engineMarks.push(valRefMark.range(from, to))
        // A `type:` claim is a type REFERENCE (same treatment as type-ref for hover/click at :421).
        // In an instance file its range usually coincides with a locally-colored wikilink, but in a
        // type-def /.yamls bundle nothing else colors it — so mark it as a ref so it isn't bare.
        else if (token.kind === 'type-claim') engineMarks.push(valRefMark.range(from, to))
        else if (token.kind === 'shape-builtin') engineMarks.push(builtinMark.range(from, to))
        else if (token.kind === 'enum-member') engineMarks.push(valStringMark.range(from, to))
      }
    }
    fieldKinds = kinds
    engineDebug = debugTokens
    view.dispatch({
      effects: [setEngineTokens.of(Decoration.set(engineMarks, true)), setTokenData.of(RangeSet.of(tokenRanges, true))],
    })
    scheduleRecompute() // re-run the live guess with the refreshed field-kind map
    void refreshInstancesLens() // "N instances" lenses key off the freshly-retained type-claim tokens
    if (debug) renderDebug()
  }

  // DIAGNOSTICS: the engine's diagnostics for the open file, rendered as squiggles with a
  // hover tooltip. The engine is the ONLY source — the editor computes none of its own,
  // following the highlighting ownership split: semantic and type-aware truth is engine-authoritative.
  //
  // Byte spans are disk-state, converted against the current buffer exactly like the semantic
  // tokens above; CodeMirror then maps them through edits, so a squiggle tracks its text until
  // the next engine rebuild corrects it.
  async function refreshDiagnostics(): Promise<void> {
    if (!currentPath) return
    const path = currentPath
    // A *.yamls BUNDLE carries diagnostics on its VIRTUAL members (`<bundle>/<member>.type.yaml`),
    // not on the physical path — the same split `fetchSemanticTokens` handles. `path_prefix`
    // matches on whole path components, so it catches the members; a normal file pins exactly.
    const outcome = path.endsWith('.yamls')
      ? await readDiagnostics(host.engine, { path_prefix: path })
      : await readDiagnostics(host.engine, { path })
    if (!alive || currentPath !== path) return // a newer open superseded this read
    if (!('ready' in outcome) || !outcome.ready || !outcome.result) {
      view.dispatch(setDiagnostics(view.state, []))
      return
    }
    const toChar = sourceByteToChar(view.state)
    const docLen = view.state.doc.length
    const cm: CmDiagnostic[] = []
    for (const d of outcome.result as WireDiagnostic[]) {
      // The prefix read can return a sibling under the same component path; keep only ours.
      if (d.span.file !== path && !d.span.file.startsWith(`${path}/`)) continue
      const from = Math.min(toChar(d.span.range.start), docLen)
      const to = Math.min(Math.max(toChar(d.span.range.end), from), docLen)
      cm.push({
        from,
        // A zero-width span would render nothing, so widen it by one to stay visible.
        to: to === from ? Math.min(from + 1, docLen) : to,
        severity: CM_SEVERITY[d.severity] ?? 'warning',
        message: d.fix ? `${d.message}\n\nFix: ${d.fix.description}` : d.message,
        source: d.code, // shown beside the message, and the stable thing to match on
      })
    }
    // CM requires diagnostics in document order; `setDiagnostics` does not sort for us.
    cm.sort((a, b) => a.from - b.from || a.to - b.to)
    view.dispatch(setDiagnostics(view.state, cm))
  }

  // INLINE REFERENCE COUNTS: fetch the file's incoming references once, group by the backlink's
  // TARGET `block_id`, and lay a "N references" lens above the file head (whole-file refs) and
  // above each referenced `^block-id` present in the buffer. Refreshed on open + on the engine
  // `changes` rebuild (a new reference elsewhere changes the count). The block-id POSITIONS come
  // from the same local regexes the live token pass uses; CM then maps the lens through edits.
  async function refreshBacklinks(): Promise<void> {
    if (!currentPath) return
    const path = currentPath
    const outcome = await readReferencesIn(host.engine, path)
    if (!alive || currentPath !== path) return // a newer open superseded this read
    if (!('ready' in outcome) || !outcome.ready) {
      view.dispatch({ effects: setInlineReferences.of(Decoration.none) })
      return
    }
    let whole = 0
    const byId = new Map<string, number>()
    for (const b of outcome.result) {
      // schema 7: a backlink's TARGET `block_id` is `{ id, referent }`; group by the id.
      if (b.block_id) byId.set(b.block_id.id, (byId.get(b.block_id.id) ?? 0) + 1)
      else whole += 1
    }
    // Locate each block-id in the current buffer. A body marker attaches trailing (the line's
    // last token, `prose. ^id`) OR own-line, for block-id syntax — so match a `^id` preceded
    // by line-start or whitespace at end-of-line (covers both; `word^id` glued to prose is not a
    // marker). Plus the inline-record `^: id`.
    const text = view.state.doc.toString()
    const idPos = new Map<string, number>()
    for (const m of text.matchAll(/(?:^|[ \t])\^([A-Za-z][A-Za-z0-9_-]*)[ \t]*$/gm)) idPos.set(m[1], m.index ?? 0)
    for (const m of text.matchAll(/^[ \t]*(?:-[ \t]+)?\^:[ \t]+(\S+)/gm)) idPos.set(m[1], m.index ?? 0)

    const docLen = view.state.doc.length
    // line-start pos -> { count, blockId? }. The whole-file lens (line 0) has no blockId; a
    // block-id lens carries its id so the peek scopes the references to that block.
    const lensAt = new Map<number, { count: number; blockId?: string }>()
    const place = (pos: number, count: number, blockId?: string): void => {
      const lineFrom = view.state.doc.lineAt(Math.min(pos, docLen)).from
      const e = lensAt.get(lineFrom)
      if (e) {
        e.count += count
        if (!e.blockId) e.blockId = blockId
      } else lensAt.set(lineFrom, { count, blockId })
    }
    if (whole > 0) place(0, whole)
    for (const [id, count] of byId) {
      const pos = idPos.get(id)
      if (pos != null) place(pos, count, id)
    }
    const decos = [...lensAt.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([from, e]) =>
        Decoration.widget({
          widget: new InlineReferencesWidget(`${e.count} reference${e.count === 1 ? '' : 's'}`, path, e.blockId, showReferences),
          block: true,
          side: -1,
        }).range(from),
      )
    view.dispatch({ effects: setInlineReferences.of(Decoration.set(decos, true)) })
  }

  // The find-all-references PEEK: show the references LIST for a file (optionally a block-id) in
  // the host preview overlay, anchored at `rect`. Driven by an inline reference click OR cmd+hover (the
  // reference widget carries its file/blockId). A row click opens the source; a row also nests on cmd+hover.
  function showReferences(rect: DOMRect, file: string, blockId?: string): void {
    const key = `refs:${file}:${blockId ?? ''}`
    card.show(
      key,
      rect,
      content.previewReferences(file, {
        blockId,
        onOpen: (p, _line, span) => { card.hide(); jumpTo(p, span) },
      }),
      (p) => content.previewPath(p),
    )
    activePreviewKey = key
  }

  // INLINE INSTANCE COUNTS: "N instances" above each `type:` claim (an instance file) and
  // above a type-def's own name (its file head). Count = `instances_of(type)`. The claim POSITIONS
  // come from the retained `type-claim` tokens; the type-def's own type comes from the filename
  // (`X.type.yaml` → `X`), since a type-def's `type-claim` token is its PARENT, not its own name.
  // Refreshed alongside the tokens (open + the engine `changes` rebuild). CM maps the lens through edits.
  async function refreshInstancesLens(): Promise<void> {
    if (!currentPath) return
    const path = currentPath
    const isTypeDef = path.endsWith('.type.yaml')
    // line-start pos → the set of types claimed on that line (a `type: [a, b]` line claims several).
    // Collected from a GIVEN state so we can recompute positions after the await (the user may have
    // edited during the reads — counts key by type, but line offsets must come from the live doc).
    const collect = (state: EditorState): Map<number, Set<string>> => {
      const byLine = new Map<number, Set<string>>()
      if (isTypeDef) {
        // The type this file DEFINES: the basename minus `.type.yaml` (the dotted filename IS the type
        // name). A `.yamls` BUNDLE is skipped (multiple defs, no single head type — a current limitation).
        const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.type\.yaml$/, '')
        if (base) byLine.set(0, new Set([base]))
      } else {
        // Instance file: every `type-claim` token is a claimed type → lens above its line.
        state.field(tokenDataField).between(0, state.doc.length, (from, _to, v) => {
          if (v.token.kind !== 'type-claim') return
          const lineFrom = state.doc.lineAt(from).from
          const set = byLine.get(lineFrom) ?? new Set<string>()
          set.add(v.token.name)
          byLine.set(lineFrom, set)
        })
      }
      return byLine
    }
    const before = collect(view.state)
    if (before.size === 0) {
      view.dispatch({ effects: setInstancesLens.of(Decoration.none) })
      return
    }
    // Count instances per DISTINCT type (one read each, deduped across lines).
    const distinct = [...new Set([...before.values()].flatMap((s) => [...s]))]
    // file-origin only — the inline widget counts instance FILES (schema-12 behaviour); schema 13's default
    // would also count nested + meta matches.
    const outcomes = await Promise.all(distinct.map((t) => readInstancesOf(host.engine, t, { origins: ['file'] })))
    if (!alive || currentPath !== path) return // a newer open superseded this
    // Recompute line positions from the CURRENT state (pre-await offsets may be stale).
    const typesByLine = collect(view.state)
    if (typesByLine.size === 0) {
      view.dispatch({ effects: setInstancesLens.of(Decoration.none) })
      return
    }
    const countOf = new Map<string, number>()
    distinct.forEach((t, i) => {
      const o = outcomes[i]
      // schema-6 `instances_of` returns MATCH RECORDS, so a bare-type query can repeat an instance
      // under several identity hashes. The lens shows an instance COUNT, so count distinct paths.
      if ('ready' in o && o.ready && o.result) countOf.set(t, new Set(o.result.map((r) => r.path)).size)
    })
    const decos = [...typesByLine.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([lineFrom, types]) => {
        const segments = [...types]
          .map((type) => ({ type, count: countOf.get(type) }))
          .filter((s): s is { type: string; count: number } => s.count != null)
        return { lineFrom, segments }
      })
      .filter((e) => e.segments.length > 0)
      .map((e) =>
        Decoration.widget({
          widget: new InstancesLensWidget(e.segments, showInstances),
          block: true,
          side: -1,
        }).range(e.lineFrom),
      )
    view.dispatch({ effects: setInstancesLens.of(Decoration.set(decos, true)) })
  }

  // The find-all-INSTANCES peek: the `instances_of(type)` list in the host preview overlay. A row
  // click opens the instance transient; a row nests a preview on cmd+hover.
  function showInstances(rect: DOMRect, type: string): void {
    const key = `inst:${type}`
    card.show(
      key,
      rect,
      content.previewInstances(type, { onOpen: (p) => openReference(fileSelection(p)) }),
      (p) => content.previewPath(p),
    )
    activePreviewKey = key
  }

  // reload the open file's CONTENT when it changes on disk externally, so the
  // editor never shows stale text after an agent / bento promote / another editor
  // writes it. The hash baseline (`lastHash`, the guard's) doubles as own-write
  // suppression: a save re-baselines it to the post-write hash, so our own change echoes
  // back to an UNCHANGED hash and is skipped. A clean buffer reloads silently; a dirty
  // buffer is never clobbered — it surfaces a conflict.
  async function reloadOnExternalChange(hint: {
    modified?: string[]
    added?: string[]
    removed?: string[]
  } | undefined): Promise<void> {
    if (!files || !currentPath || saving || !hint) return
    const path = currentPath
    if ((hint.removed ?? []).some((p) => sameFile(p, path))) {
      setError(`${path} was removed on disk — your buffer is kept; save to recreate it`)
      return
    }
    const touched = [...(hint.modified ?? []), ...(hint.added ?? [])]
    if (!touched.some((p) => sameFile(p, path))) return
    const result = await files.read(path)
    // Bail if the file changed under the async read. Compare CONTENT (not the flaky
    // hash): identical to what we last knew = our own write echo / no real change.
    if (!alive || currentPath !== path || !result.ok) return
    const next = result.content ?? ''
    if (next === lastContent) return
    if (dirty) {
      // Don't clobber unsaved edits. Re-baseline so "save to overwrite" works and a
      // later identical event doesn't re-warn; the sticky conflict status stays.
      conflicted = true
      lastContent = next
      lastHash = result.hash
      render()
      return
    }
    // Clean buffer: take the external version. `loadEvent` keeps it from flagging dirty.
    lastContent = next
    lastHash = result.hash
    const source = readSource(next)
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: source.doc },
      effects: loadSourceLayout.of(source.layout),
      annotations: [loadEvent.of(true), Transaction.addToHistory.of(false)],
    })
    savedDoc = view.state.doc
    render()
    void fetchSemanticTokens()
  }

  const view = new EditorView({
    parent: editorHost,
    // Pin CM's style root to the editor's ACTUAL tree root. Bento slots the pane content INTO
    // <au-pane-frame>'s shadow <slot>, so the editor is slotted light-DOM: CM's default `getRoot`
    // walks up via `assignedSlot` and lands in au-pane-frame's SHADOW root, adopting the baseTheme
    // (`.cm-scroller{display:flex}`) there — where it cannot style the slotted content, so the gutter
    // stacks ABOVE the text. `getRootNode()` does NOT follow `assignedSlot`: for slotted light-DOM it
    // returns `document`, so style-mod mounts the baseTheme where the editor can see it, every time.
    root: (editorHost.getRootNode() instanceof Document || editorHost.getRootNode() instanceof ShadowRoot)
      ? editorHost.getRootNode() as Document | ShadowRoot : editorHost.ownerDocument,
    extensions: [
      auEditorTheme,
      // Wrap long lines to the pane width instead of overflowing off-screen to the right.
      EditorView.contentAttributes.of({ 'aria-label': 'Document source' }),
      wrapCompartment.of(EditorView.lineWrapping),
      keymap.of([
        // ⌘S is NOT a CodeMirror binding: it rides `save-intent` (declared in handles-intent-meta), so the
        // keybind gate resolves it from the active keymap and the editor's `save-intent` handler runs save().
        // A hardcoded Mod-s here would be a hidden, shadowed layer (the gate consumes ⌘S before CodeMirror).
        // F2 renames the symbol under the cursor — a file (via the engine `rename` saga) for a
        // wikilink target, or an in-file identifier / field key / block-id otherwise. See doRename.
        { key: 'F2', run: doRename },
      ]),
      // Go-to-definition: Mod-click a `[[wikilink]]` to follow it. Resolve the target via the
      // engine, then fire an `open-intent` so it opens as a transient editor (see goToDefinition).
      // mousemove/mouseleave drive the Cmd-hover affordance (the link under the cursor lights up
      // as clickable while a modifier is held). Not a wikilink → fall through to normal handling.
      EditorView.domEventHandlers({
        mousedown(event, emv) {
          if (!(event.metaKey || event.ctrlKey)) return false
          const pos = emv.posAtCoords({ x: event.clientX, y: event.clientY })
          if (pos == null) return false
          const target = clickTargetAt(emv.state, pos, currentPath)
          if (!target) return false
          event.preventDefault()
          // Following a reference commits the interaction; its preview must not linger or
          // appear from a pending dwell. A fresh pointer move can start another preview.
          clearHoverTimer()
          hideOwnPreview()
          activePreviewKey = null
          lastPointer = null
          if (target.kind === 'wikilink') void goToDefinition(target.link)
          else if (target.kind === 'url') void host.shell?.openExternal(target.url)
          else if (target.kind === 'type') void goToType(target.name)
          else void goToField(target.field, target.context)
          return true
        },
        mousemove(event) {
          modHeld = event.metaKey || event.ctrlKey
          lastPointer = { x: event.clientX, y: event.clientY }
          refreshActiveLink(modHeld)
          manageHover(event.clientX, event.clientY)
          return false
        },
        mouseleave(event) {
          lastPointer = null
          refreshActiveLink(false)
          // Don't dismiss if the pointer left the editor INTO the card (sticky scroll).
          if (!card.isOver(event.clientX, event.clientY)) {
            clearHoverTimer()
            hideOwnPreview()
          }
          return false
        },
      }),
      basicSetup,
      preserveSourceText,
      selectionPresentation,
      // Find & replace: CM's search engine driven through a custom themed panel; keeps the
      // default search basicSetup binds (⌘F / Enter / ⇧Enter / ⌘⌥Enter) and adds ⌘⌥F / ⌘H to open with
      // the replace field focused. Must come AFTER basicSetup so its createPanel wins the search facet.
      findReplace(),
      // the document minimap gutter, in its own compartment so the toggle button reconfigures
      // it live. Seeded from the config's `minimap` field (default OFF).
      minimapCompartment.of(minimapOn ? [minimap()] : []),
      syntaxHighlighting(auHighlightStyle),
      langCompartment.of([]),
      // Ctrl+space completion. Must come AFTER basicSetup: it configures the same
      // autocompletion facet, and `override` has to win over basicSetup's default.
      auCompletion({ engine: host.engine, path: () => currentPath }),
      // Our semantic decorations must nest INSIDE the commodity syntax highlighter
      // so their color wins. Per CodeMirror, HIGHER precedence = inner DOM node =
      // wins; the syntax highlighter (treeHighlighter) is `Prec.high`, so our
      // tokens take `Prec.highest`. The two fields never overlap on a wikilink
      // (recompute skips the neutral mark where engineField has a broken one), so
      // their equal precedence is fine.
      Prec.highest(tokenField),
      Prec.highest(engineField),
      Prec.highest(activeLinkField),
      tokenDataField,
      inlineReferencesField,
      instancesLensField,
      // Hovers are our own custom card (see `manageHover` / hover-card.ts), NOT a CM tooltip.
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          if (!update.transactions.some((t) => t.annotation(loadEvent))) {
            const wasDirty = dirty
            dirty = conflicted || !savedDoc || !update.state.doc.eq(savedDoc)
            if (dirty !== wasDirty) render()
            // A clean-to-dirty edit promotes a preview tab to permanent.
            if (dirty && !wasDirty) intent.fire(promoteIntent())
          }
          scheduleRecompute()
        }
        // Cursor moves and fold toggles change restorable view-state. Both fold AND
        // unfold (else collapsing persists but re-expanding doesn't). Scroll is a DOM
        // event, listened for separately below.
        const foldChanged = update.transactions.some((t) =>
          t.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)),
        )
        if (update.selectionSet || foldChanged) scheduleViewStateSave()
        // Publish the cursor (Ln/Col) on a move OR on gaining focus, so a `cursor`-watching status
        // item (the editor's `status-item` view, multi-view) tracks the ACTIVE editor — it watchAll's
        // this slice and shows the most-recently-published one. Publishing on focus (not just move)
        // makes "most recent" track focus even when you switch editors without moving the caret.
        if (update.selectionSet || (update.focusChanged && update.view.hasFocus)) publishCursor()
        // When THIS editor gains focus, publish its file as the selection so selection-followers
        // (e.g. the backlinks panel) track the ACTIVE editor — not only the file-tree click. This
        // is what makes go-to-def / clicking an already-open editor update backlinks.
        if (update.focusChanged && update.view.hasFocus && currentPath) {
          host.selection?.publish(fileSelection(currentPath))
        }
        if (debug && (update.docChanged || update.selectionSet)) renderDebug()
      }),
    ],
  })

  // Publish the caret's Ln/Col on the `cursor` view-state slice for the `status-item` view (below)
  // to watchAll. Published once at mount (so a status item subscribing later shows the current
  // position) and on every move/focus (the updateListener above).
  function publishCursor(): void {
    // No file open → no cursor to advertise. Publishing {1,1} here would make a freshly-mounted
    // but unfocused editor transiently win the status item's most-recent-cursor race.
    if (!currentPath) return
    const head = view.state.selection.main.head
    const line = view.state.doc.lineAt(head)
    host.viewState.publish('cursor', { line: line.number, col: head - line.from + 1, path: currentPath })
  }
  publishCursor()

  // Persisting scroll: a DOM event, not a CM transaction. Scrolling the editor also dismisses
  // the preview card (its anchor has moved).
  const releaseToolbar = bindDocumentToolbar(root, view.scrollDOM)
  view.scrollDOM.addEventListener('scroll', () => {
    scheduleViewStateSave()
    clearHoverTimer()
    hideOwnPreview()
  })

  // Cmd/Ctrl-hover affordance: highlight the `[[…]]` under the pointer while a modifier is
  // held. The mousemove/mouseleave handlers (above) keep `lastPointer`; the window key
  // listeners (below) catch the modifier being pressed/released without the mouse moving.
  let lastPointer: { x: number; y: number } | null = null
  let activeRange: { from: number; to: number } | null = null
  let modHeld = false
  function refreshActiveLink(mod: boolean): void {
    let next: { from: number; to: number } | null = null
    if (lastPointer) {
      const pos = view.posAtCoords(lastPointer)
      if (pos != null) {
        const target = clickTargetAt(view.state, pos, currentPath)
        const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
        view.contentDOM.title = target
          ? target.kind === 'url' ? `${modifier} click to open external link`
            : `${modifier} hover to preview · ${modifier} click to ${target.kind === 'field' ? 'open field declaration' : target.kind === 'type' ? 'open type definition' : 'open reference'}`
          : ''
        if (mod && target) next = { from: target.from, to: target.to }
      }
    }
    if (!lastPointer) view.contentDOM.removeAttribute('title')
    if (next?.from === activeRange?.from && next?.to === activeRange?.to) return
    activeRange = next
    view.dispatch({ effects: setActiveLink.of(next) })
  }

  // Hover content comes from the shared preview-content builder. The host preview
  // surface owns placement, dismissal, and chrome; the editor supplies content.
  // A local hover card provides the fallback when the host capability is absent.
  const hostPreview = host.preview
  const ownCard = hostPreview ? null : createHoverCard({ root })
  const card: PreviewSurface = hostPreview ?? ownCard!
  const content = makeHoverContent(host.engine)
  let hoverTimer: ReturnType<typeof setTimeout> | undefined
  // The key of a currently-open cmd PREVIEW (vs the compact info). Once a preview is up, cmd is
  // no longer in charge — proximity (the surface cones) owns dismissal — so releasing cmd / moving
  // within the safety area must not downgrade it to the compact card.
  let activePreviewKey: string | null = null
  // Dismiss OUR preview without clobbering another consumer of the shared host singleton: only hide
  // the host surface if the editor's own card is the one showing. The private fallback card (when
  // there's no host surface) is ours alone, so it hides freely.
  function hideOwnPreview(): void {
    if (!hostPreview) return card.hide()
    if (activePreviewKey && card.isShowing(activePreviewKey)) card.hide()
  }
  const clearHoverTimer = (): void => {
    if (hoverTimer) clearTimeout(hoverTimer)
    hoverTimer = undefined
  }
  // The screen rect of a doc range (for anchoring the card under the token).
  function rangeRect(from: number, to: number): DOMRect {
    const a = view.coordsAtPos(from)
    const b = view.coordsAtPos(to) ?? a
    if (!a) return new DOMRect(lastPointer?.x ?? 0, lastPointer?.y ?? 0, 0, 0)
    return new DOMRect(a.left, a.top, (b?.right ?? a.right) - a.left, (b?.bottom ?? a.bottom) - a.top)
  }
  // Decide what (if anything) to show at a position. ONLY cmd+hover previews (a link target /
  // type-def); a plain hover shows nothing. Returns a dedup key, the anchor range, and the fill.
  function hoverPlan(pos: number): { key: string; from: number; to: number; fill: import('./hover-card').FillFn } | null {
    if (!modHeld) return null // plain hover shows no preview (previews are cmd-gated)
    const ct = clickTargetAt(view.state, pos, currentPath)
    if (ct?.kind === 'wikilink') {
      const link = { target: ct.link.target || currentPath || '', blockId: ct.link.blockId, anchor: ct.link.anchor, from: currentPath }
      return { key: `pv:${link.target}^${link.blockId ?? ''}#${link.anchor ?? ''}`, from: ct.from, to: ct.to, fill: content.previewLink(link) }
    }
    if (ct?.kind === 'type') return { key: `pv:type:${ct.name}`, from: ct.from, to: ct.to, fill: content.previewType(ct.name) }
    // cmd+hover a frontmatter FIELD name → its declaring type + shape + `#:` docstring.
    if (ct?.kind === 'field') return { key: `pv:field:${JSON.stringify(ct.context.steps)}`, from: ct.from, to: ct.to, fill: async (card, isCurrent) => {
      const path = currentPath, doc = view.state.doc
      if (!path) return
      const fields = await resolveYamlField(host.engine, path, ct.context)
      if (!isCurrent() || currentPath !== path || view.state.doc !== doc) return
      if (fields.length === 1) await content.previewField(ct.field, [`${fields[0]!.origin.name}::${fields[0]!.origin.repo}`])(card, isCurrent)
      else card.textContent = fields.length ? `Multiple declarations for ${ct.field}; Command-click to choose.` : `No declaration for ${ct.field}.`
    } }
    return null
  }
  function manageHover(x: number, y: number): void {
    if (card.isOver(x, y)) return clearHoverTimer() // sticky: pointer is in the card
    // cmd+hover an inline "N references" widget → the find-all-references PEEK (a DOM widget, not text,
    // so it's matched by element, before the token-based plan).
    const lensEl = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('.au-inline-references') as HTMLElement | null
    if (lensEl && modHeld && lensEl.dataset.refsFile) {
      const file = lensEl.dataset.refsFile
      const block = lensEl.dataset.refsBlock || undefined
      const key = `refs:${file}:${block ?? ''}`
      if (card.isShowing(key)) return
      clearHoverTimer()
      hoverTimer = setTimeout(() => {
        if (alive) showReferences(lensEl.getBoundingClientRect(), file, block)
      }, 240)
      return
    }
    // cmd+hover a "N instances" segment → the find-all-INSTANCES peek (a per-type clickable span).
    const instEl = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-inst-type]') as HTMLElement | null
    if (instEl && modHeld && instEl.dataset.instType) {
      const type = instEl.dataset.instType
      const key = `inst:${type}`
      if (card.isShowing(key)) return
      clearHoverTimer()
      hoverTimer = setTimeout(() => {
        if (alive) showInstances(instEl.getBoundingClientRect(), type)
      }, 240)
      return
    }
    const pos = view.posAtCoords({ x, y })
    const plan = pos == null ? null : hoverPlan(pos)
    // A preview is open and we're now without cmd (would compute a COMPACT plan): don't downgrade —
    // the surface's cones own dismissal until the pointer leaves the safety area. Once proximity has
    // dismissed it (no longer showing), the suppression lifts and compact resumes.
    if (!modHeld && activePreviewKey && card.isShowing(activePreviewKey)) return clearHoverTimer()
    if (!plan) {
      clearHoverTimer()
      // The host surface owns dismissal via its safety cones (so moving toward the card keeps it);
      // only the local fallback card hides on leave here.
      if (!hostPreview) card.hide()
      return
    }
    if (card.isShowing(plan.key)) return // already up for this target
    clearHoverTimer()
    const key = plan.key
    const wasPreview = modHeld
    hoverTimer = setTimeout(() => {
      if (!alive) return
      // `linkResolver` enables NESTING: a wikilink inside the preview, cmd+hovered, spawns a child.
      card.show(
        key,
        rangeRect(plan.from, plan.to),
        plan.fill,
        (path) => content.previewPath(path),
        (p) => openReference(fileSelection(p)),
      )
      activePreviewKey = wasPreview ? key : null
    }, 240)
  }

  // Modifier pressed/released globally (the editor need not be focused to hover a link). On a
  // change, re-evaluate at the last pointer so the preview/compact swap follows the modifier.
  const onModKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Meta' && e.key !== 'Control') return
    modHeld = e.metaKey || e.ctrlKey
    refreshActiveLink(modHeld)
    if (lastPointer) manageHover(lastPointer.x, lastPointer.y)
  }
  const onWindowBlur = (): void => {
    modHeld = false
    refreshActiveLink(false)
    clearHoverTimer()
    hideOwnPreview()
  }
  window.addEventListener('keydown', onModKey)
  window.addEventListener('keyup', onModKey)
  window.addEventListener('blur', onWindowBlur)

  function render(): void {
    const name = currentPath?.split(/[/\\]/).pop() ?? 'No document'
    location.textContent = currentPath ? displayFilePath(currentPath, host.workspace.members) : 'No document'
    location.title = currentPath ? displayFilePath(currentPath, host.workspace.members) : ''
    host.viewState.publish('pane-title', currentPath ? name : null)
    host.viewState.publish('open-file', currentPath)
    // Label the primary from eligible viewers and expose other consumers under More.
    if (currentPath) {
      const sets = viewerSwitchSets(host, currentPath)
      viewButton.primaryLabel = sets.viewers.length === 1 ? sets.viewers[0].label : 'Open with'
      otherOpeners.hidden = sets.openers.length === 0
      viewButton.hasMore = sets.viewers.length > 0 && sets.openers.length > 0
      viewButton.style.display = sets.viewers.length > 0 || sets.openers.length > 0 ? '' : 'none'
    } else {
      viewButton.style.display = 'none'
    }
    viewButton.disabled = saving || !currentPath
    viewButton.setAttribute('aria-busy', String(switching))
    otherOpeners.disabled = switching || saving || !currentPath
    saveButton.disabled = !currentPath || (!dirty && !conflicted)
    revealButton.disabled = !currentPath
    // Publish the STANDING dirty state on the view-state bus, so the container chrome can render a dirty
    // indicator (the tab dot). Distinct from the interactive close-guard below: this is discovery, the guard
    // is the decision. Publish only on a TRANSITION —
    // `render()` runs per keystroke, and the value is a boolean that rarely changes.
    const nextDirty = dirty || conflicted
    if (nextDirty !== lastPublishedDirty) {
      lastPublishedDirty = nextDirty
      host.viewState.publish('dirty', nextDirty)
    }
    if (!currentPath) {
      status.className = 'au-editor-status'
      status.textContent = files
        ? 'no file open — type an entry-relative path and open'
        : 'host exposes no files capability'
      return
    }
    if (conflicted) {
      status.className = 'au-editor-status error'
      status.textContent = `${currentPath} — changed on disk; your unsaved edits are kept. Save to overwrite, or reopen to discard.`
    } else if (dirty) {
      status.className = 'au-editor-status dirty'
      status.textContent = 'Unsaved changes'
    } else {
      status.className = 'au-editor-status'
      status.textContent = 'Saved'
    }
  }

  function setError(message: string): void {
    status.className = 'au-editor-status error'
    status.textContent = message
  }

  // RENAME SYMBOL (F2). The file half rides the engine `rename` saga (host.files.rename, which
  // rewrites inbound referrers) with a blast-radius preview through host.confirm; the in-file half is a
  // whole-document transaction through the same confirm surface. Status rides the editor's own status line.
  const renameCtx: RenameContext = {
    engine: host.engine,
    files: host.files,
    confirm: host.confirm,
    overlay: host.overlay,
    currentPath: () => currentPath,
    previewContent: (p) => content.previewPath(p),
    setStatus: (message, kind) => {
      if (kind === 'error') {
        setError(message)
      } else {
        status.className = 'au-editor-status'
        status.textContent = message
      }
    },
  }
  function doRename(v: EditorView): boolean {
    const target = renameTargetAt(v.state, v.state.selection.main.head)
    if (!target) return false
    void performRename(v, target, renameCtx)
    return true
  }

  /** Recompute the LIVE token DecorationSet over the current doc and swap it in. */
  function recomputeTokens(): void {
    const text = view.state.doc.toString()
    const ranges: ReturnType<typeof wikilinkMark.range>[] = []

    // `[:field]` contribution markers (anywhere, single-line by construction).
    for (const m of text.matchAll(/\[:[A-Za-z][A-Za-z0-9_\-.]*\]/g)) {
      const from = m.index ?? 0
      ranges.push(contributionMark.range(from, from + m[0].length))
    }
    // `^block-id` on its own line (markdown body marker).
    for (const m of text.matchAll(/^[ \t]*\^([A-Za-z][A-Za-z0-9_-]*)[ \t]*$/gm)) {
      const caret = (m.index ?? 0) + m[0].indexOf('^')
      ranges.push(blockIdMark.range(caret, caret + 1 + m[1].length))
    }
    // `^: <id>` inline-record block-id (yaml).
    for (const m of text.matchAll(/^([ \t]*(?:-[ \t]+)?)(\^:[ \t]+\S+)/gm)) {
      const from = (m.index ?? 0) + m[1].length
      ranges.push(blockIdMark.range(from, from + m[2].length))
    }
    // Links FIRST, collecting their spans so frontmatter value coloring paints
    // around them (a wikilink / url inside a string keeps its own color).
    const linkSpans: Array<[number, number]> = []
    // URLs (in frontmatter strings or the body) styled like wikilinks.
    for (const m of text.matchAll(/https?:\/\/[^\s)"'\]>]+/g)) {
      const from = m.index ?? 0
      const to = from + m[0].length
      ranges.push(urlMark.range(from, to))
      linkSpans.push([from, to])
    }
    // `[[wikilink]]` — rendered neutral live (muted braces + accent target), EXCEPT
    // where the engine layer already marks it broken (skip the neutral mark there so
    // the broken danger shows; the two equal-precedence fields never overlap).
    const brokenSet = view.state.field(engineField)
    const isBroken = (a: number, b: number): boolean => {
      let found = false
      brokenSet.between(a, b, () => {
        found = true
        return false
      })
      return found
    }
    for (const m of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
      if (m[0].includes('\n')) continue // semantic tokens are single-line
      const from = m.index ?? 0
      const to = from + m[0].length
      const innerFrom = from + 2
      const innerTo = to - 2
      ranges.push(wikilinkBraceMark.range(from, innerFrom))
      ranges.push(wikilinkBraceMark.range(innerTo, to))
      if (innerFrom < innerTo && !isBroken(innerFrom, innerTo)) {
        ranges.push(wikilinkMark.range(innerFrom, innerTo))
      }
      linkSpans.push([from, to])
    }
    // Type-aware frontmatter values: color each `key: value` by the field's engine
    // type (naive fallback), painted AROUND link spans so links keep their color.
    const fm = frontmatterRegion(text)
    if (fm) {
      linkSpans.sort((a, b) => a[0] - b[0])
      let pos = fm.start
      for (const line of text.slice(fm.start, fm.end).split('\n')) {
        const fmm = /^([ \t]*)([A-Za-z0-9_-]+)([ \t]*:[ \t]*)(.*\S)[ \t]*$/.exec(line)
        if (fmm) {
          const key = fmm[2]
          const valueFrom = pos + fmm[1].length + fmm[2].length + fmm[3].length
          const valueTo = valueFrom + fmm[4].length
          const kind: FieldKind =
            key === 'type' ? 'ref' : (fieldKinds?.get(key) ?? naiveKind(fmm[4]))
          paintExcluding(ranges, valueMarkFor(kind), valueFrom, valueTo, linkSpans)
        }
        pos += line.length + 1
      }
    }

    view.dispatch({ effects: setTokens.of(Decoration.set(ranges, true)) })
  }

  /** Token inspector: report the syntax node, our decoration classes, and the
   *  engine semantic token at the cursor. Pins down which layer owns a color. */
  function renderDebug(): void {
    const pos = view.state.selection.main.head
    const line = view.state.doc.lineAt(pos)

    const chain: string[] = []
    let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, -1)
    for (; node && chain.length < 4; node = node.parent) chain.push(node.name)

    const marks: string[] = []
    for (const field of [tokenField, engineField]) {
      view.state.field(field).between(Math.max(0, pos - 1), pos + 1, (from, to, deco) => {
        const cls = (deco.spec as { class?: string }).class
        if (cls && from <= pos && pos < to) marks.push(cls.replace('au-tok-', ''))
      })
    }

    const engine = engineDebug.find((d) => d.from <= pos && pos < d.to)
    debugLine.textContent =
      `pos ${pos} (L${line.number}:${pos - line.from})` +
      ` · syntax ${chain.join(' < ') || '—'}` +
      ` · marks ${marks.join(', ') || '—'}` +
      ` · engine ${engine ? engine.label : '—'}`
  }

  /** Read the current restorable view-state off the live editor. */
  function captureViewState(): EditorViewState {
    const folds: [number, number][] = []
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
      folds.push([from, to])
    })
    return {
      cursor: view.state.selection.main.head,
      ranges: view.state.selection.ranges.map(({ anchor, head }) => ({ anchor, head })),
      mainIndex: view.state.selection.mainIndex,
      scroll: view.scrollDOM.scrollTop,
      scrollLeft: view.scrollDOM.scrollLeft,
      wrap: view.lineWrapping,
      folds,
    }
  }

  /** Persist view-state into the host's auto-store (debounced), sub-keyed by the open
   *  file. NOT the config — so it never churns the git-tracked composition or flags it
   *  dirty. The host keys it by composition + this pane's stable id + the file. */
  function scheduleViewStateSave(): void {
    if (restoring || !currentPath) return
    clearTimeout(viewStateTimer)
    viewStateTimer = setTimeout(() => {
      viewStateTimer = undefined
      if (!alive || !currentPath) return
      viewStore?.set(captureViewState(), currentPath)
    }, 400)
  }

  /** Restore saved view-state after a config-driven open. Offsets are clamped to the
   *  loaded doc (the file may have changed since it was saved). */
  function restoreViewState(vs: EditorViewState | undefined): void {
    if (!vs) return
    restoring = true
    try {
      const len = view.state.doc.length
      const clamp = (n: number): number => Math.max(0, Math.min(n, len))
      const folds = (vs.folds ?? [])
        .map(([f, t]) => ({ from: clamp(f), to: clamp(t) }))
        .filter((r) => r.from < r.to)
      const ranges = vs.ranges?.map(({ anchor, head }) => EditorSelection.range(clamp(anchor), clamp(head)))
      if (vs.wrap !== undefined) wrapOverride = vs.wrap
      view.dispatch({
        selection: ranges?.length
          ? EditorSelection.create(ranges, Math.max(0, Math.min(vs.mainIndex ?? 0, ranges.length - 1)))
          : vs.cursor != null ? { anchor: clamp(vs.cursor) } : undefined,
        effects: [
          ...folds.map((r) => foldEffect.of(r)),
          wrapCompartment.reconfigure(wrapOverride ? EditorView.lineWrapping : []),
        ],
        annotations: [loadEvent.of(true), Transaction.addToHistory.of(false)],
      })
      wrapButton.setAttribute('aria-pressed', String(wrapOverride))
      // Scroll after layout settles (the doc was just set; scrollHeight isn't final yet).
      if (vs.scroll != null || vs.scrollLeft != null) {
        const path = currentPath
        requestAnimationFrame(() => {
          if (!alive || currentPath !== path) return
          if (vs.scroll != null) view.scrollDOM.scrollTop = vs.scroll
          if (vs.scrollLeft != null) view.scrollDOM.scrollLeft = vs.scrollLeft
        })
      }
    } finally {
      restoring = false
    }
  }

  async function open(rawPath: string): Promise<void> {
    if (!files) {
      setError('host exposes no files capability')
      return
    }
    const path = rawPath.trim()
    if (!path) return
    status.className = 'au-editor-status'
    status.textContent = `opening ${displayFilePath(path, host.workspace.members)}…`
    const result = await files.read(path)
    if (!alive) return
    if (!result.ok) {
      setError(`open failed: ${result.error ?? 'unknown error'}`)
      return
    }
    currentPath = path
    // Keep the path input in step with the open file. A self-initiated open persists via saveConfig,
    // but onOwnConfigChange only echoes EXTERNAL changes, so the input would otherwise go stale (it
    // kept the previous file's name after an open-intent "replace editor").
    pathInput.value = path
    dirty = false
    conflicted = false // a fresh read clears any prior external-change conflict
    lastHash = result.hash // guard baseline for the next save
    lastContent = result.content ?? '' // external-change baseline
    const source = readSource(lastContent)
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: source.doc },
      effects: [loadSourceLayout.of(source.layout), langCompartment.reconfigure(languageForPath(path) ?? []), wrapCompartment.reconfigure(wrapOverride ? EditorView.lineWrapping : [])],
      annotations: [loadEvent.of(true), Transaction.addToHistory.of(false)],
    })
    savedDoc = view.state.doc
    // Restore saved cursor/scroll/folds for THIS file from the auto-store (clamped to
    // the loaded doc). Keyed per-pane-per-file by the host; a file never opened in this
    // pane has none and starts fresh.
    restoreViewState(viewStore?.get(path) as EditorViewState | undefined)
    // Persist the open file into our config (the DURABLE field), so it round-trips into
    // the saved composition (the parent re-stamps `type`). the instance IS the
    // view. View-state is NOT here — it lives in the auto-store (see scheduleViewStateSave).
    // `portal` trace: the editor persists its own `file` here. This is a PLAIN save (mergeRecord), which
    // does NOT schedulePoolChange — so the portal's contentKey snapshot for this pane goes stale until an
    // unrelated re-derive, the mechanism behind the spurious remount-flash. The trace timestamps it.
    if (on('portal')) event('portal', 'editor-persist', { paneId: host.instanceId, file: path })
    ;host.saveConfig({ file: path, ...(minimapOn ? { minimap: true } : {}) } satisfies EditorConfig)
    render()
    // The open dispatch already schedules a recompute via the update listener.
    void fetchSemanticTokens() // engine tokens for the new file (types + resolution)
    void refreshBacklinks() // inline reference counts for the new file
    void refreshDiagnostics() // squiggles for the new file
    connectDiagnostics() // re-scope the live feed to the new file
    // Publish the opened file as the selection so followers (backlinks) track it — covers
    // go-to-def opening a NEW editor (whose CM view may not auto-focus on a whole-file jump, so
    // the focus-publish wouldn't fire). The followers dedup by path; an initial multi-editor
    // restore settles on the last and is corrected by the first focus/click.
    host.selection?.publish(fileSelection(path))
    // Declare this surface's open file into the host open-surfaces index (a file-tree "open editors"
    // section, a switcher, a command palette read it). The host dedupes by identity (the path), so a
    // cursor hop within this file never re-fires; existence auto-clears when the pane unmounts.
    host.openSurfaces?.setContent([openContent(fileSelection(path))])
  }

  // Select a byte span (engine UTF-8 offsets) in a view: convert to char offsets via the
  // doc text, move the cursor there, and scroll it to the center. Used for a same-file jump
  // (here) and a cross-file jump (the target editor's mount-reveal).
  function revealSpan(targetView: EditorView, byteStart: number, byteEnd: number): void {
    const toChar = sourceByteToChar(targetView.state)
    const len = targetView.state.doc.length
    const from = Math.min(toChar(byteStart), len)
    const to = Math.min(toChar(byteEnd), len)
    targetView.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    })
    targetView.focus()
  }

  // Go-to-definition for a `[[wikilink]]`. Resolve the target to a file (and, for a
  // `^block-id` / `#anchor` fragment, the exact block/heading SPAN) via the engine, then:
  //  - same file as this editor (incl. a file-local `[[^id]]` / `[[#head]]`) → reveal in place.
  //  - a different file → fire an `open-intent` carrying the span as a `range`, so the focused
  //    open-capable container opens it as a new transient editor that scrolls to the block.
  // A broken/ambiguous link surfaces a transient status. Mod-click is the trigger.
  async function goToDefinition(link: WikilinkHit): Promise<void> {
    const target = link.target || currentPath // file-local forms resolve against this file
    if (!target) return
    // `origin` (the open file) scopes resolution to its repo: a bare target resolves member-local,
    // a `::repo` target resolves cross-repo (the embedded `::repo` rides on `target` untouched).
    const origin = currentPath ?? undefined
    let path: string | undefined
    let span: { start: number; end: number } | undefined
    if (link.blockId) {
      const out = await readResolveBlockId(host.engine, target, link.blockId, origin)
      if (!alive) return
      if ('ready' in out && out.ready && out.result) ({ file_path: path } = out.result), (span = out.result.span)
    } else if (link.anchor) {
      const out = await readResolveAnchor(host.engine, target, link.anchor, origin)
      if (!alive) return
      if ('ready' in out && out.ready && out.result) ({ file_path: path } = out.result), (span = out.result.span)
    } else {
      const out = await readResolveTarget(host.engine, target, origin)
      if (!alive) return
      if ('ready' in out && out.ready && out.result) {
        // A TYPE-DEF target carries an openable CONTAINER + rebased span (`source`) — for a def in
        // a `.yamls` bundle the virtual `path` is the member while `source.file` is the physical
        // bundle, so we open that and reveal `source.span`. A non-type-def `source` is null and the
        // `path` is itself directly openable.
        if (out.result.source) {
          path = out.result.source.file
          span = { start: out.result.source.span.start, end: out.result.source.span.end }
        } else {
          path = out.result.path
        }
      }
    }
    if (!path) {
      const frag = link.blockId ? `^${link.blockId}` : link.anchor ? `#${link.anchor}` : ''
      status.className = 'au-editor-status'
      status.textContent = `no definition for [[${link.target}${frag}]]`
      return
    }
    jumpTo(path, span)
  }

  function openReference(target: ReturnType<typeof fileSelection>): void {
    intent.fire(promoteIntent())
    intent.fire(openIntent(target, 'permanent'))
  }

  // Open a resolved target at an optional span: same file (incl. self-refs) reveals in place;
  // a different file fires an `open-intent` carrying the span as a `range` so the opened editor
  // scrolls there. Shared by wikilink go-to-def and type go-to-def.
  function jumpTo(path: string, span?: { start: number; end: number }): void {
    if (currentPath != null && sameFile(path, currentPath)) {
      if (span) revealSpan(view, span.start, span.end)
      return
    }
    const range = span ? ({ type: 'text-range', from: span.start, to: span.end } satisfies TextRange) : undefined
    openReference(fileSelection(path, range))
  }

  // Resolve the field's owning type and jump to its source location through the
  // engine read surface, using the type's repository identity.
  async function goToType(name: string): Promise<void> {
    const out = await readType(host.engine, name)
    if (!alive) return
    if (!('ready' in out) || !out.ready || !out.result) {
      status.className = 'au-editor-status'
      status.textContent = `no type-def for ${name}`
      return
    }
    jumpTo(out.result.source.file, out.result.source.span)
  }

  // Field go-to-definition: jump to the type-def that DECLARES this field. The engine's `type_closure`
  // read (schema 17) returns each claimed type's EFFECTIVE fields — own + inherited — each tagged with
  // its declaring `origin` identity (engine-authoritative: mixin-collision + auto-unify a client
  // parent-walk can get subtly wrong). Find the field's origin, then read that type-def for its source
  // span to jump to. A bare claim is multi-fit (search all identities' fields); `name::repo` scopes.
  async function goToField(field: string, context: YamlFieldContext): Promise<void> {
    const path = currentPath, doc = view.state.doc
    if (!path) return
    const candidates = await resolveYamlField(host.engine, path, context)
    if (!alive || currentPath !== path || view.state.doc !== doc) return
    const options = candidates.map(candidate => ({ id: `${candidate.origin.name}::${candidate.origin.repo}`, label: `${field} — ${candidate.origin.name}::${candidate.origin.repo}` }))
    const origin = options.length === 1 ? options[0]!.id : options.length ? await host.chooser?.choose({ title: 'Field declaration', options }) : null
    if (!alive || currentPath !== path || view.state.doc !== doc) return
    if (origin) {
      const out = await readType(host.engine, origin)
      if (!alive || currentPath !== path || view.state.doc !== doc) return
      if ('ready' in out && out.ready && out.result) {
        jumpTo(out.result.source.file, out.result.fields.find(candidate => candidate.name === field)?.key_span ?? out.result.source.span)
        return
      }
    }
    if (!options.length) { status.className = 'au-editor-status'; status.textContent = `no declaration for field '${field}'` }
  }

  async function save(): Promise<void> {
    if (!files || !currentPath) return
    const path = currentPath
    status.className = 'au-editor-status'
    status.textContent = `saving ${displayFilePath(path, host.workspace.members)}…`
    saving = true // stand the external-change handler down for our own write's echo
    const writtenDoc = view.state.doc
    const written = writeSource(view.state)
    try {
      const result = await files.write(path, written, lastHash)
      if (!alive) return
      if (!result.ok) {
        // The guard rejected: the file changed under us. Keep the buffer dirty (no
        // clobber) and tell the user to reopen to merge. Re-baseline to the current
        // hash so a deliberate re-save (after reviewing) is no longer blocked.
        if (result.conflict) {
          lastHash = result.conflict.currentHash
          setError(`save blocked: ${path} changed on disk since you opened it — reopen to merge, or save again to overwrite`)
          return
        }
        setError(`save failed: ${result.error ?? 'unknown error'}`)
        return
      }
      lastHash = result.hash // re-baseline to the post-write hash
      lastContent = written // our write is now the on-disk baseline
      savedDoc = writtenDoc
      // If the user typed DURING the in-flight write, the buffer no longer matches what we
      // saved — keep it dirty rather than falsely marking it saved (no silent edit loss).
      dirty = !view.state.doc.eq(writtenDoc)
      conflicted = false // our write is now the on-disk truth; conflict resolved
      render()
    } finally {
      saving = false
      if (alive) render()
    }
  }

  revealButton.addEventListener('au-activate', () => {
    if (currentPath) intent.fire(highlightIntent(fileSelection(currentPath), 'reveal-if-exists'))
  })
  openButton.addEventListener('au-activate', () => void open(pathInput.value))
  pathInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void open(pathInput.value)
  })
  saveButton.addEventListener('au-activate', () => void save())

  // CLOSE-GUARD — participate in the host removal lifecycle. On a close, if a save is in flight, veto; if
  // clean, consent; else ask save / discard / cancel. Save runs the existing guarded write and consents
  // ONLY if it left the buffer clean (a conflict or a failure keeps it dirty, so the close is refused and
  // no edit is lost). Cancel, dismissal, and save-failure all veto — the host then HOLDS the reap, so this
  // pane is never unmounted and its buffer survives. Optional capability, guarded with `?.`.

  const disposeGuard = host.closeGuard?.register(async () => {
    if (saving) return false
    if (!dirty && !conflicted) return true
    const choice = await host.chooser?.choose({
      title: `${currentPath ? displayFilePath(currentPath, host.workspace.members) : 'This file'} has unsaved changes`,
      options: [
        { id: 'save', label: 'Save and close' },
        { id: 'discard', label: 'Discard changes and close' },
        { id: 'cancel', label: 'Keep editing' },
      ],
    })
    if (choice === 'save') {
      await save()
      return !dirty && !saving // a conflict / failure kept it dirty → refuse the close, keep the buffer.
    }
    return choice === 'discard'
  })
  wrapButton.addEventListener('au-activate', () => {
    wrapOverride = !view.lineWrapping
    view.dispatch({ effects: wrapCompartment.reconfigure(wrapOverride ? EditorView.lineWrapping : []) })
    wrapButton.setAttribute('aria-pressed', String(wrapOverride))
    scheduleViewStateSave()
  })

  // The switch moves to a rendering viewer; More exposes non-viewer file-consumers. Both save-guard first (leaving the editor), then hand off to the shared
  // helper, which resolves that group and swaps in place — this editor names no projection.
  const runSwitch = (group: 'viewers' | 'openers'): void => {
    if (switching) return
    switching = true
    render()
    void (async () => {
      if (!host.instanceId) return
      let source: string | null
      try {
        source = await prepareRead(
          () => ({ path: currentPath, dirty, saving, alive }),
          async () => (await host.chooser?.choose({ title: 'Save changes before switching?', options: [{ id: 'save', label: 'Save and switch' }, { id: 'stay', label: 'Keep editing' }] })) === 'save',
          save,
        )
      } catch (error) { setError(error instanceof Error ? error.message : String(error)); return }
      if (!source) return
      viewStore?.set(captureViewState(), source)
      const outcome = await runViewerSwitch(host, source, group)
      if (outcome.kind === 'none') setError(group === 'viewers' ? 'No other viewer is available for this file.' : 'No other way to open this file.')
      else if (outcome.kind === 'refused') setError('This pane cannot change its viewer.')
    })().catch((error: unknown) => { if (alive) setError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { switching = false; if (alive) render() })
  }
  viewButton.addEventListener('au-activate', () => runSwitch(currentPath && viewerSwitchSets(host, currentPath).viewers.length ? 'viewers' : 'openers'))
  viewButton.addEventListener('au-more', () => runSwitch('openers'))
  otherOpeners.addEventListener('au-activate', () => {
    options.open = false
    optionsLabel.focus()
    runSwitch('openers')
  })
  // the minimap toggle — reconfigure the compartment live + persist the choice into the config
  // (replace, so carry the file; omit `minimap` when off = default off, no composition bloat).
  function syncMinimapButton(): void {
    minimapButton.title = minimapOn ? 'Hide the minimap gutter' : 'Show the minimap gutter'
    minimapButton.setAttribute('variant', minimapOn ? 'outline' : 'ghost')
  }
  syncMinimapButton()
  minimapButton.addEventListener('au-activate', () => {
    minimapOn = !minimapOn
    view.dispatch({ effects: minimapCompartment.reconfigure(minimapOn ? [minimap()] : []) })
    syncMinimapButton()
    host.saveConfig({ ...(currentPath ? { file: currentPath } : {}), ...(minimapOn ? { minimap: true } : {}) } satisfies EditorConfig)
  })
  debugButton.addEventListener('au-activate', () => {
    debug = !debug
    debugButton.setAttribute('variant', debug ? 'outline' : 'ghost')
    debugLine.style.display = debug ? '' : 'none'
    if (debug) renderDebug()
  })

  // Refresh the engine tokens after each rebuild. `changes` fires when the engine
  // re-derives (e.g. after our save), the SDK's signal for "tokens may have moved".
  let unsubscribeChanges: (() => void) | null = null
  function connectChanges(): void {
    unsubscribeChanges?.()
    unsubscribeChanges = subscribeChanges(host.engine, (event) => {
      if (!alive || event.kind !== 'change') return
      void fetchSemanticTokens()
      void refreshBacklinks() // a reference added/removed elsewhere changes our counts
      void reloadOnExternalChange(event.scopeHint) // reload content on an external write
    })
  }
  connectChanges()

  // The diagnostics feed is scoped to the OPEN FILE, so it is re-opened on every open rather
  // than once at mount. A file-scoped channel means an unrelated file's errors never wake us.
  let unsubscribeDiagnostics: (() => void) | null = null
  function connectDiagnostics(): void {
    unsubscribeDiagnostics?.()
    unsubscribeDiagnostics = null
    if (!currentPath) return
    const path = currentPath
    unsubscribeDiagnostics = subscribeDiagnostics(
      host.engine,
      (event) => {
        if (!alive || event.kind !== 'change' || currentPath !== path) return
        void refreshDiagnostics()
      },
      path.endsWith('.yamls') ? { path_prefix: path } : { path },
    )
  }
  connectDiagnostics()

  // On the daemon-reachable edge: re-fetch tokens and revive a closed changes feed.
  const offReady = host.engineReady?.subscribe((ready) => {
    if (ready && alive) {
      void fetchSemanticTokens()
      void refreshBacklinks()
      void refreshDiagnostics()
      connectChanges()
      connectDiagnostics() // the feed closed with the daemon; re-open it
    }
  })

  // File opening belongs to containers. An editor restores its configured file;
  // it does not subscribe to selection as a command to replace its content.


  // Restore the open file from our config : a saved composition that recorded
  // a `file` reopens it on mount. `open` then restores its view-state from the auto-store.
  const initialFile = (host.config as EditorConfig | undefined)?.file
  // Deliver one-shot reveal commands through reveal-if-exists rather than saved config.
  // The payload identifies the target file and range; each matching editor reveals locally.
  // Keeping the command off config prevents stale byte ranges from being persisted.
  let awaitingRevealFor: string | null = null
  let pendingReveal: { from: number; to: number } | null = null
  if (initialFile) {
    pathInput.value = initialFile
    awaitingRevealFor = initialFile
    void open(initialFile).then(() => {
      const parked = pendingReveal
      awaitingRevealFor = null
      pendingReveal = null
      if (alive && parked && currentPath != null && sameFile(initialFile, currentPath)) {
        revealSpan(view, parked.from, parked.to)
      }
    })
  }

  // React to changes in this editor's file config without remounting. The switch is
  // idempotent for the current file and preserves per-file view state when it changes.
  const offConfigChange = host.onOwnConfigChange?.((config) => {
    if (!alive) return
    const f = (config as EditorConfig | undefined)?.file
    if (!f || (currentPath != null && sameFile(f, currentPath))) return // nothing new to reflect
    if (on('portal')) event('portal', 'editor-reflect', { paneId: host.instanceId, from: currentPath, to: f })
    pathInput.value = f
    void open(f)
  })

  render()

  // ui-intent-highlight (BROADCAST, typed capability): if THIS editor holds the target
  // file, flash its pane. `reveal-if-exists` WITH a span also JUMPS this editor's own viewport to
  // it (per-copy — no single winner) via the same `revealSpan` the editor's own nav uses: byte→char,
  // selection = the span, scroll-to-center, focus. A span carries `from`/`to` in BYTES.
  // No span → flash only.


  // A reveal command can target a newly mounted or existing editor. Arbitration
  // compares the current path and mount state so the range is applied to the right file.
  const offHighlight = intent.handle('ui-intent-highlight', {
    claim: () => true, // broadcast highlight — every editor highlights its own copy; claim ignored, always commit.
    commit: (i) => {
      const target = (i as { target?: { path?: string; range?: { from?: number; to?: number } } }).target
      const decision = decideReveal({ ...target, mode: (i as { mode?: string }).mode }, { currentPath, awaitingRevealFor })
      if (decision.kind === 'ignore') return
      if (decision.kind === 'park') {
        pendingReveal = decision.span
        return
      }
      root.classList.remove('au-editor-reveal-flash')
      void root.offsetWidth
      root.classList.add('au-editor-reveal-flash')
      if (decision.kind === 'reveal') revealSpan(view, decision.span.from, decision.span.to)
    },
  })

  // Ask the host chooser to save, discard, or cancel before an aimed open replaces a dirty buffer.
  async function confirmReplaceThenOpen(path: string): Promise<void> {
    const chooser = host.chooser
    if (!chooser) return // nothing to ask with → fail safe: keep the unsaved buffer, never clobber.
    const name = path.split('/').pop() ?? path
    const cur = currentPath ? (currentPath.split('/').pop() ?? currentPath) : 'This file'
    const pick = await chooser.choose({
      title: `${cur} has unsaved changes`,
      options: [
        { id: 'save', label: `Save, then open ${name}` },
        { id: 'discard', label: `Discard changes and open ${name}` },
      ],
    })
    if (pick === 'save') {
      await save()
      await open(path)
    } else if (pick === 'discard') {
      await open(path)
    }
    // Escape / any other outcome → cancel: keep the buffer, do nothing.
  }

  // Only explicitly targeted open intents replace this editor. It does not enter
  // the ambient candidate set, so file-tree opens continue to route to containers.
  // Use the host chooser before replacing a dirty buffer.
  const offOpen = intent.handle('open-intent', {
    // CLAIM (pure): a non-empty path. COMMIT: open it — a dirty buffer asks save/discard/cancel first.
    claim: (i) => {
      const path = (i as { target?: { path?: string } }).target?.path
      return typeof path === 'string' && path.length > 0
    },
    commit: (i) => {
      const path = (i as { target?: { path?: string } }).target?.path
      if (typeof path !== 'string' || path.length === 0) return
      if (dirty) {
        void confirmReplaceThenOpen(path) // unsaved edits → save / discard / cancel, never a silent clobber.
        return
      }
      void open(path)
    },
  })

  // save-intent (AMBIENT, `handles`): when this editor holds a file, save THAT file — the same guarded
  // write the Save button uses. Claims ONLY when a file is open, so an editor with no file declines and the
  // responder chain falls through to the host's composition save (the empty-focus fallback). MRU-focus
  // ordering routes a focused editor's ⌘S here; a clean buffer re-writes the same bytes (a harmless no-op).
  const offSave = intent.handle('save-intent', {
    claim: () => !!currentPath,
    commit: () => void save(),
  })

  return () => {
    // Capture once before disposing styles: removing the editor sizing expands its
    // scroller to content height and resets its DOM scroll position.
    if (currentPath) viewStore?.set(captureViewState(), currentPath)
    alive = false
    disposeGuard?.()
    disposeStyles?.()
    offConfigChange?.()
    offHighlight()
    offOpen()
    offSave()
    if (recomputeTimer) clearTimeout(recomputeTimer)
    clearTimeout(viewStateTimer)
    offReady?.()
    unsubscribeChanges?.()
    unsubscribeDiagnostics?.()
    window.removeEventListener('keydown', onModKey)
    window.removeEventListener('keyup', onModKey)
    window.removeEventListener('blur', onWindowBlur)
    clearHoverTimer()
    // Hide any preview this editor triggered; only DISPOSE the local fallback (the host owns
    // and reuses its shared surface across editors, so we must not tear it down here).
    card.hide()
    ownCard?.dispose()
    releaseToolbar()
    view.destroy()
    root.remove()
  }
}

// The editor's STATUS surface (editor-status, a `status-projection`): a compact "Ln L, Col C" for a
// status bar. It does NOT open an editor — it watchAll's the `cursor` slice the editor pane (the
// `mount` export) publishes, and shows the MOST-RECENTLY-published one (≈ the active editor). Mounted
// via the locator `export: status` (two surfaces, one module).
interface CursorSlice {
  line: number
  col: number
  path?: string
}
function mountStatusItem(container: HTMLElement, host: MountHost): () => void {
  const el = document.createElement('div')
  // LOGICAL box props so it renders identically when the container rotates us in a vertical bar
  // (writing-mode): `padding-inline` is start/end along the reading axis; `padding-block` +
  // `min-block-size` are the CROSS axis (bar thickness, matching status-bar's 20px). Physical
  // `padding`/`min-height` would inflate the thickness + drop the start/end pad when rotated.
  el.style.cssText =
    'font: var(--au-t-2xs)/var(--au-lh-2xs) var(--au-font-mono); display: flex; align-items: center; height: 100%; min-block-size: var(--au-status-h); min-inline-size: 0; max-inline-size: 100%; overflow: hidden; padding-block: 0; padding-inline: var(--au-space-2-5); box-sizing: border-box; color: var(--au-ink-3); white-space: nowrap;'
  const label = document.createElement('span')
  label.style.cssText = 'min-inline-size: 0; overflow: hidden; text-overflow: ellipsis;'
  el.appendChild(label)
  container.appendChild(el)

  // Track every editor's cursor; show the most-recently-published (the one being used).
  const cursors = new Map<string, CursorSlice>()
  let latest: string | null = null
  function render(): void {
    const c = latest ? cursors.get(latest) : undefined
    label.textContent = c ? `Ln ${c.line}, Col ${c.col}` : 'Ln —, Col —'
    el.title = c ? `${c.path ? `${displayFilePath(c.path, host.workspace.members)} — ` : ''}Line ${c.line}, column ${c.col}` : 'No editor cursor'
    el.setAttribute('aria-label', el.title)
  }
  render()

  const stop = host.viewState.watchAll('cursor', (publisher, value) => {
    if (value === undefined) {
      cursors.delete(publisher)
      if (latest === publisher) {
        latest = null
        for (const k of cursors.keys()) latest = k // fall back to any remaining editor
      }
    } else {
      cursors.set(publisher, value as CursorSlice)
      latest = publisher // most-recently-published = the active editor
    }
    render()
  })

  return () => {
    stop()
    el.remove()
  }
}

// Two surfaces sharing one module, composed on the branded
// default: `mount` is the editor pane (editor-pane); `status` is the compact Ln/Col status item
// (editor-status, a status-projection) following the active editor's cursor. Each type-def's locator
// `export` selects which key the host mounts.
export default defineProjection({ mount, status: mountStatusItem })
