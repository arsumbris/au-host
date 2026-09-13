// Shared AU find panel; writable views also expose replace.
//
// It extends CodeMirror's `@codemirror/search` by supplying a custom `createPanel`, so the
// query ENGINE (match highlighting, case/word/regex, cursors, wrap-around) is entirely CM's —
// we only own the panel DOM to match the app's design and to add the two features CM's default
// panel lacks: a live "N of M" match count and a fully themed replace/toggle surface.
//
// The panel reuses CM's `.cm-searchMatch(-selected)` / `.cm-selectionMatch` decorations, which
// the editor already themes in `auEditorTheme`. All chrome here is `var(--au-…)` tokens — no
// hardcoded color or colored left-edge accent bars. Active
// toggles read via a surface fill + accent text, not a bar.

import { Prec, type Text } from '@codemirror/state'
import { type Command, EditorView, keymap, type Panel, type ViewUpdate } from '@codemirror/view'
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchPanelOpen,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search'

// The panel instance per view, so the "open with replace focused" command can reach the live
// panel and focus its replace field after opening (mount runs synchronously inside the open
// dispatch, so the instance is registered by the time the command's follow-up runs).
const panels = new WeakMap<EditorView, AuFindReplacePanel>()

// Set-independent structural casts — the find panel's fields are <au-input> (`.value`; emits `au-input`;
// `error` reflects the no-match state; delegatesFocus lets CM focus the `[main-field]` on open) and its
// controls are <au-button> (emit `au-activate`; the toggle on-state is a variant swap).
type AuBtnEl = HTMLElement & { disabled: boolean }
type AuInputEl = HTMLElement & { value: string; select(): void }
function fbtn(label: string): AuBtnEl {
  const b = document.createElement('au-button') as AuBtnEl
  b.setAttribute('size', 'sm')
  b.setAttribute('variant', 'ghost')
  b.textContent = label
  return b
}

// Iterating every match on each keystroke is what makes "N of M" feel live; cap the scan so a
// pathological query on a huge buffer can't stall the UI. Beyond the cap the count reads "M+".
const COUNT_CAP = 10000

interface MatchSpan {
  from: number
  to: number
}

/** Every match of `query`, ascending, capped at COUNT_CAP. O(doc) — run once per (query, doc). */
function scanMatches(view: EditorView, query: SearchQuery): { spans: MatchSpan[]; capped: boolean } {
  const spans: MatchSpan[] = []
  const cursor = query.getCursor(view.state) as Iterator<MatchSpan>
  for (let it = cursor.next(); !it.done; it = cursor.next()) {
    spans.push({ from: it.value.from, to: it.value.to })
    if (spans.length >= COUNT_CAP) return { spans, capped: true }
  }
  return { spans, capped: false }
}

/** 1-based index of the match the caret sits on, else the one findNext would land on, else a wrap
 *  to the first. Binary search over the ascending spans: a caret move must not cost a doc scan.
 *  (A match whose span IS the selection is by construction the first with `from >= caret`, so the
 *  single lower-bound covers both the on-a-match and the between-matches case.) */
function currentIndex(spans: MatchSpan[], caret: number): number {
  let lo = 0
  let hi = spans.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (spans[mid].from < caret) lo = mid + 1
    else hi = mid
  }
  return lo < spans.length ? lo + 1 : 1
}

type ToggleKey = 'caseSensitive' | 'wholeWord' | 'regexp'

class AuFindReplacePanel implements Panel {
  readonly dom: HTMLElement
  readonly top = true

  private readonly findInput: AuInputEl
  private readonly replaceInput: AuInputEl
  private readonly count: HTMLElement
  private readonly toggles = new Map<ToggleKey, AuBtnEl>()
  // Guards syncFromQuery against re-dispatching while it mirrors an incoming query into the DOM.
  private syncing = false
  // The scanned match set, keyed by the (query, document) it was scanned from — see `matchSpans`.
  private scan: { spans: MatchSpan[]; capped: boolean } = { spans: [], capped: false }
  private scanQuery: SearchQuery | null = null
  private scanDoc: Text | null = null

  constructor(private readonly view: EditorView) {
    const q = getSearchQuery(view.state)

    this.dom = document.createElement('div')
    // CM adds `cm-panel`; `au-find` scopes our theme without colliding with the default `cm-search`.
    this.dom.className = 'cm-panel au-find'
    this.dom.setAttribute('role', 'search')
    this.dom.setAttribute('aria-label', view.state.readOnly ? 'Find in source' : 'Find and replace')

    // --- find row ---------------------------------------------------------
    const findRow = row()
    this.findInput = textField('Find')
    // CM focuses the field tagged `main-field` when the panel opens.
    this.findInput.setAttribute('main-field', 'true')
    this.findInput.setAttribute('aria-label', 'Find')

    const toggleGroup = document.createElement('div')
    toggleGroup.className = 'au-find-toggles'
    this.toggles.set('caseSensitive', this.makeToggle('caseSensitive', 'Aa', 'Match case', 'Alt+C'))
    this.toggles.set('wholeWord', this.makeToggle('wholeWord', 'ab', 'Match whole word', 'Alt+W'))
    this.toggles.set('regexp', this.makeToggle('regexp', '.*', 'Use regular expression', 'Alt+R'))
    for (const b of this.toggles.values()) toggleGroup.append(b)

    this.count = document.createElement('span')
    this.count.className = 'au-find-count'
    this.count.setAttribute('aria-live', 'polite')

    const findNav = document.createElement('div')
    findNav.className = 'au-find-nav'
    findNav.append(
      this.iconButton('↑', 'Previous match', 'Shift+Enter', () => findPrevious(this.view)),
      this.iconButton('↓', 'Next match', 'Enter', () => findNext(this.view)),
      this.iconButton('✕', 'Close', 'Esc', () => this.close()),
    )
    findRow.append(this.findInput, toggleGroup, this.count, findNav)

    // --- replace row ------------------------------------------------------
    const replaceRow = row()
    replaceRow.classList.add('au-find-replace-row')
    this.replaceInput = textField('Replace')
    this.replaceInput.setAttribute('aria-label', 'Replace')
    const replaceNav = document.createElement('div')
    replaceNav.className = 'au-find-nav'
    replaceNav.append(
      this.textButton('Replace', 'Replace next match', 'Enter', () => {
        this.commit()
        replaceNext(this.view)
      }),
      this.textButton('All', 'Replace all matches', 'Cmd+Alt+Enter', () => {
        this.commit()
        replaceAll(this.view)
      }),
    )
    replaceRow.append(this.replaceInput, replaceNav)

    this.dom.append(findRow)
    if (!view.state.readOnly) this.dom.append(replaceRow)

    // Seed the fields from the persisted query; if empty, seed find from a single-line selection
    // (search the selected word).
    this.findInput.value = q.search
    this.replaceInput.value = q.replace
    this.setToggle('caseSensitive', q.caseSensitive)
    this.setToggle('wholeWord', q.wholeWord)
    this.setToggle('regexp', q.regexp)
    if (!q.search) {
      const sel = view.state.selection.main
      if (!sel.empty) {
        const picked = view.state.sliceDoc(sel.from, sel.to)
        if (picked && !picked.includes('\n')) this.findInput.value = picked
      }
    }

    // Live re-query as the user types in either field.
    this.findInput.addEventListener('au-input', () => this.commit())
    this.replaceInput.addEventListener('au-input', () => this.commit())
    // Keyboard: Enter/Shift-Enter navigate, Cmd-Alt-Enter replaces all, Esc closes, Alt-C/W/R toggle.
    this.dom.addEventListener('keydown', (e) => this.onKeydown(e))
    // A press inside the panel belongs to the panel, never an ancestor layout-drag slot.
    this.dom.dataset.auPressHold = 'off'
  }

  mount(): void {
    panels.set(this.view, this)
    // `mount` runs INSIDE the panel-open dispatch, and dispatching during an update is illegal —
    // so defer pushing the seeded query (match highlighting + count) to just after the update.
    queueMicrotask(() => {
      if (panels.get(this.view) !== this) return // panel already closed
      this.commit()
      this.renderCount()
    })
  }

  update(update: ViewUpdate): void {
    const queryChanged = update.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)))
    if (queryChanged) this.syncFromQuery(getSearchQuery(update.state))
    // The count depends on the query, the doc, and the caret — refresh on any of them.
    if (queryChanged || update.docChanged || update.selectionSet) this.renderCount()
  }

  destroy(): void {
    if (panels.get(this.view) === this) panels.delete(this.view)
  }

  /** Focus (and select) the replace field — used by the "open with replace" command. */
  focusReplace(): void {
    this.replaceInput.focus()
    this.replaceInput.select()
  }

  // --- internals ----------------------------------------------------------

  /** Build the SearchQuery from the live DOM and push it into the editor's search state. */
  private commit(): void {
    if (this.syncing) return
    const query = new SearchQuery({
      search: this.findInput.value,
      replace: this.replaceInput.value,
      caseSensitive: this.isOn('caseSensitive'),
      wholeWord: this.isOn('wholeWord'),
      regexp: this.isOn('regexp'),
    })
    this.view.dispatch({ effects: setSearchQuery.of(query) })
  }

  /** Mirror an externally-changed query into the DOM without triggering another commit. */
  private syncFromQuery(q: SearchQuery): void {
    this.syncing = true
    try {
      // Only write a field when it differs, so we never reset the caret while the user types.
      if (this.findInput.value !== q.search) this.findInput.value = q.search
      if (this.replaceInput.value !== q.replace) this.replaceInput.value = q.replace
      this.setToggle('caseSensitive', q.caseSensitive)
      this.setToggle('wholeWord', q.wholeWord)
      this.setToggle('regexp', q.regexp)
    } finally {
      this.syncing = false
    }
  }

  private renderCount(): void {
    const q = getSearchQuery(this.view.state)
    if (!q.search) {
      this.count.textContent = ''
      this.findInput.removeAttribute('error')
      return
    }
    if (!q.valid) {
      // A syntactically-broken regex: no engine matches to count.
      this.count.textContent = 'Invalid regex'
      this.findInput.setAttribute('error', '')
      return
    }
    const { spans, capped } = this.matchSpans(q)
    if (spans.length === 0) {
      this.count.textContent = 'No results'
      this.findInput.setAttribute('error', '')
      return
    }
    this.findInput.removeAttribute('error')
    const total = capped ? `${spans.length}+` : `${spans.length}`
    this.count.textContent = `${currentIndex(spans, this.view.state.selection.main.from)} of ${total}`
  }

  /**
 * Cache matches for q until query or document identity changes; both are immutable.
 * Selection-only updates can reuse the count. COUNT_CAP limits matched results, not bytes scanned.
 */
  private matchSpans(q: SearchQuery): { spans: MatchSpan[]; capped: boolean } {
    const doc = this.view.state.doc
    if (this.scanQuery !== q || this.scanDoc !== doc) {
      this.scan = scanMatches(this.view, q)
      this.scanQuery = q
      this.scanDoc = doc
    }
    return this.scan
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      this.close()
      return
    }
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'Enter') {
      e.preventDefault()
      if (mod && e.altKey && !this.view.state.readOnly) {
        this.commit()
        replaceAll(this.view)
      } else if (e.target === this.replaceInput) {
        this.commit()
        replaceNext(this.view)
      } else if (e.shiftKey) {
        findPrevious(this.view)
      } else {
        findNext(this.view)
      }
      return
    }
    // Alt+C / Alt+W / Alt+R toggle the modes (existing editor bindings), without disturbing the field.
    // On `e.code`, NOT `e.key`: macOS composes Option+C into 'ç' (Option+W '∑', Option+R '®'), so a
    // key-based match never fired on the only platform this ships on — and, never reaching
    // preventDefault, typed the glyph into the query instead.
    if (e.altKey && !mod) {
      const which: ToggleKey | null =
        e.code === 'KeyC' ? 'caseSensitive' : e.code === 'KeyW' ? 'wholeWord' : e.code === 'KeyR' ? 'regexp' : null
      if (which) {
        e.preventDefault()
        this.flipToggle(which)
      }
    }
  }

  private close(): void {
    closeSearchPanel(this.view)
    this.view.focus()
  }

  private makeToggle(key: ToggleKey, label: string, title: string, shortcut: string): AuBtnEl {
    const b = fbtn(label)
    b.classList.add('au-find-toggle')
    b.title = `${title} (${shortcut})`
    b.setAttribute('aria-label', title)
    b.setAttribute('aria-pressed', 'false')
    b.addEventListener('au-activate', () => this.flipToggle(key))
    return b
  }

  private flipToggle(key: ToggleKey): void {
    this.setToggle(key, !this.isOn(key))
    this.commit()
  }

  private isOn(key: ToggleKey): boolean {
    return this.toggles.get(key)?.getAttribute('aria-pressed') === 'true'
  }

  private setToggle(key: ToggleKey, on: boolean): void {
    const b = this.toggles.get(key)
    if (!b) return
    b.setAttribute('aria-pressed', on ? 'true' : 'false')
    b.setAttribute('variant', on ? 'outline' : 'ghost') // pressed = outline
  }

  private iconButton(glyph: string, title: string, shortcut: string, run: () => void): AuBtnEl {
    return this.makeButton(glyph, title, shortcut, run, 'au-find-icon')
  }

  private textButton(label: string, title: string, shortcut: string, run: () => void): AuBtnEl {
    return this.makeButton(label, title, shortcut, run, 'au-find-action')
  }

  private makeButton(label: string, title: string, shortcut: string, run: () => void, cls: string): AuBtnEl {
    const b = fbtn(label)
    b.classList.add(cls)
    b.title = `${title} (${shortcut})`
    b.setAttribute('aria-label', title)
    // mousedown+preventDefault keeps focus in the active field so navigation is repeatable.
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('au-activate', () => run())
    return b
  }
}

function row(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'au-find-row'
  return el
}

function textField(placeholder: string): AuInputEl {
  const el = document.createElement('au-input') as AuInputEl
  el.setAttribute('size', 'sm')
  el.setAttribute('placeholder', placeholder)
  el.classList.add('au-find-input')
  return el
}

// Open the plain find panel (⌘F is bound by `basicSetup`'s searchKeymap; re-exported here so the
// editor can wire it to a CDP test seam alongside `__auView`).
export const openFind: Command = openSearchPanel

// Open the search panel with the REPLACE field focused (Cmd-Alt-F / Cmd-H). The panel's `mount`
// runs synchronously inside the open dispatch, so the instance is registered by the time we focus.
export const openWithReplace: Command = (view) => {
  if (view.state.readOnly) return openSearchPanel(view)
  const already = searchPanelOpen(view.state)
  openSearchPanel(view)
  const focus = (): void => panels.get(view)?.focusReplace()
  if (already) focus()
  else requestAnimationFrame(focus) // brand-new panel: let the open dispatch settle first
  return true
}

// The panel LAYOUT only — the field + control LOOK now belong to <au-input> / <au-button> (their own
// shadow chrome). The container surface/border comes from `.cm-panels` in `auEditorTheme`. Active toggle
// state is an au-button variant swap (see setToggle); the no-match state is au-input's `error`.
const findReplaceTheme = EditorView.theme({
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--au-line-2, var(--au-color-border))', borderTop: 'none' },
  '.au-find': { padding: 'var(--au-space-1-5) var(--au-space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--au-space-1-5)' },
  '.au-find-row': { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--au-space-1-5)' },
  '.au-find-input': { flex: '1 1 160px', minWidth: '0' },
  '.au-find-toggles': { display: 'flex', gap: 'var(--au-space-0-5)', flex: '0 0 auto' },
  '.au-find-count': {
    flex: '0 0 auto',
    minWidth: '58px',
    textAlign: 'right',
    fontSize: 'var(--au-t-2xs)',
    color: 'var(--au-ink-4)',
    fontVariantNumeric: 'tabular-nums',
  },
  '.au-find-nav': { display: 'flex', gap: 'var(--au-space-0-5)', flex: '0 0 auto', alignItems: 'center' },
  '.au-find-replace-row .au-find-input': { flex: '1' },
})

/**
 * The full find & replace extension bundle: CM's search engine wired to our custom panel (top,
 * replace + toggles + live count), the panel theme, and the "open with replace focused" keys
 * (⌘⌥F / ⌘H). ⌘F (open find), Enter/⇧Enter (next/prev), ⌘⌥Enter (replace all) and Esc are handled
 * by CM's `searchKeymap` (from `basicSetup`) + the panel's own keydown. High precedence so the
 * open-with-replace bindings win over any editor default.
 */
export function findReplace() {
  return [
    search({ top: true, createPanel: (view) => new AuFindReplacePanel(view) }),
    findReplaceTheme,
    Prec.high(
      keymap.of([
        { key: 'Mod-Alt-f', run: openWithReplace },
        { key: 'Mod-h', run: openWithReplace },
      ]),
    ),
  ]
}
