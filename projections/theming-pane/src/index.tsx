// theming-pane — a projection that discovers every themeable `--au-*` token by walking the CSSOM and
// lets the user edit each one live, then save it. No manifest, no codegen: the CSS `@property`
// declarations ARE the registry.
//
// A React root composes the framework-neutral `<au-*>` custom elements (via the set-independent React
// wrappers) — fields, theme choices, token controls and draft actions —
// pointed at `:root` via edit()/host.theme. React never crosses the `mount()` seam.
//
// Base tokens (from packages/style) and every in-scope projection's own tokens (eager-loaded by the host
// via customTokenEntry) both appear here, because both are registered `@property` rules in the document.
// Editing a token updates the shared host draft; its preview re-themes the app through the cascade.
//
// Live edits are an unsaved preview. The host stores appearance by theme and device preferences
// separately; Save persists the current selection and adjustments for restoration on boot.
// `Revert` drops unsaved edits back to the saved set. A named, shareable theme (a CSS file + a thin
// `theme` instance) is the Save-as path, with duplicate + delete.

import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { defineProjection, type MountHost, type ProjectionModule, type ThemeDraftSession, type ThemeSelection } from '@arsumbris/au-host-sdk'
import {
  AuButton,
  AuColorPicker,
  AuField,
  AuInput,
  AuSectionHeader,
  AuSegmentedControl,
  AuTag,
} from '@arsumbris/au-component-catalog/react'
import { ThemesBar } from './themes'

import { discoverTokens, type Token } from './token-discovery'

const EXPAND: Record<string, string> = { bg: 'Background', fg: 'Foreground', sm: 'Small', md: 'Medium', lg: 'Large', pill: 'Pill' }
const title = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1)

/**
 * Auto-derive a group + label from the token name.
 *
 * `owners` is the DISCOVERED projection set (`host.listProjections()`), so a token named
 * `--au-<projection>-*` groups under that projection because it EXISTS, not because a hardcoded list
 * remembered it. A name matching no owner keeps its first segment as the group.
 */
function derive(name: string, owners: readonly string[]): { group: string; label: string } {
  const segs = name.replace(/^--au-/, '').split('-')
  let projection: string | null = null
  if (owners.includes(segs[0])) projection = segs.shift() ?? null
  else if (segs.length >= 2 && owners.includes(`${segs[0]}-${segs[1]}`)) projection = `${segs.shift()}-${segs.shift()}`
  let group: string
  let label: string
  if (segs.length >= 2) {
    group = title(segs[0])
    label = segs.slice(1).map((s) => EXPAND[s] ?? title(s)).join(' ')
  } else {
    group = 'General'
    label = EXPAND[segs[0]] ?? title(segs[0])
  }
  return { group: projection ? `${title(projection)} / ${group}` : group, label }
}

/** Control kind from the `@property` syntax. */
function controlFor(syntax: string): 'color' | 'length' | 'number' | 'text' {
  if (syntax === '<color>') return 'color'
  if (syntax === '<length>' || syntax === '<length-percentage>') return 'length'
  if (syntax === '<number>') return 'number'
  return 'text'
}

const root = document.documentElement
const currentValue = (t: Token): string => {
  const set = getComputedStyle(root).getPropertyValue(t.name).trim()
  return set || t.initialValue
}

/**
 * CURATED — the handful of tokens most people theme: the accent (everything derives from it), the ink,
 * the hairline. Each still substring-filtered. A curated name absent from the registry is simply
 * omitted (`.filter`), never a broken row. The full `@property` registry is one "All tokens" toggle away.
 */
const CURATED: readonly string[] = [
  '--au-color-surface-1', '--au-color-surface-2', '--au-color-surface-3',
  '--au-ink-1', '--au-ink-3', '--au-accent-signal',
  '--au-color-chrome', '--au-chrome-opacity', '--au-surface-alpha', '--au-material-blur',
  '--au-density', '--au-radius-panel', '--au-radius-row',
  '--au-m-fast', '--au-m-base',
]
const CUSTOMIZE_GROUPS = [
  {title:'Surfaces & material',hint:'The backgrounds and floating surfaces around your work.',tokens:['--au-color-surface-1','--au-color-surface-2','--au-color-surface-3','--au-color-chrome','--au-chrome-opacity','--au-surface-alpha','--au-material-blur']},
  {title:'Text & emphasis',hint:'Keep content readable and important details distinct.',tokens:['--au-ink-1','--au-ink-3','--au-accent-signal']},
  {title:'Shape & spacing',hint:'The spacing and corners of interface elements.',tokens:['--au-density','--au-radius-panel','--au-radius-row']},
  {title:'Motion',hint:'The duration of interface transitions.',tokens:['--au-m-fast','--au-m-base']},
]
const TOKEN_HINTS: Record<string,string> = {
  '--au-color-surface-1':'Background of content panes', '--au-color-surface-2':'Recessed interface areas', '--au-color-surface-3':'Raised interface areas',
  '--au-ink-1':'Main labels and reading text', '--au-ink-3':'Supporting labels and descriptions', '--au-accent-signal':'Emphasis and interactive accents',
  '--au-color-chrome':'Window chrome tint', '--au-chrome-opacity':'Opacity of native window chrome', '--au-surface-alpha':'Tint strength of floating surfaces', '--au-material-blur':'Blur behind floating surfaces',
  '--au-density':'Spacing scale for shared controls', '--au-radius-panel':'Rounding of pane corners', '--au-radius-row':'Rounding of interface rows', '--au-m-fast':'Short state transitions', '--au-m-base':'Standard layout transitions',
}
const LABEL_OVERRIDE: Record<string, string> = {
  '--au-accent-signal': 'Accent', '--au-color-surface-1': 'Pane surface',
  '--au-color-surface-2': 'Recessed surface', '--au-color-surface-3': 'Raised surface',
  '--au-ink-1': 'Primary text', '--au-ink-3': 'Secondary text',
  '--au-color-chrome': 'Chrome colour', '--au-chrome-opacity': 'Chrome opacity', '--au-surface-alpha': 'Floating surface opacity',
  '--au-material-blur': 'Backdrop blur', '--au-density': 'Interface density',
  '--au-radius-panel': 'Panel corners', '--au-radius-row': 'Row corners',
  '--au-m-fast': 'Quick transitions', '--au-m-base': 'Layout transitions',
}

/* Token label with an explicit shared reset action. */
function RowLabel({ text, token, overridden, onReset }: { text: string; token: string; overridden: boolean; onReset: () => void }): ReactNode {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 'var(--au-space-0-5)', minWidth: 0, maxWidth: '100%' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--au-space-1)', minWidth: 0 }}>
        <span style={{ overflowWrap: 'anywhere' }}>{text}</span>
        {overridden && <AuButton variant="ghost" size="sm" aria-label={`Reset ${text}`} onAuActivate={onReset}>Reset</AuButton>}
      </span>
      <span
        style={{
          fontFamily: 'var(--au-font-mono)',
          fontSize: 'var(--au-t-2xs)',
          color: 'var(--au-ink-3)',
          letterSpacing: 'var(--au-ls-mono)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {token}
      </span>
    </span>
  )
}

/* ── Token row — one Field(inline); ColorPicker for <color>, mono Input otherwise ───────────────── */
function TokenRow({
  token,
  owners,
  value,
  overridden,
  onEdit,
  onReset,
  simple = false,
}: {
  simple?: boolean
  token: Token
  owners: readonly string[]
  value: string
  overridden: boolean
  onEdit: (v: string) => void
  onReset: () => void
}): ReactNode {
  const label = LABEL_OVERRIDE[token.name] ?? derive(token.name, owners).label
  const kind = controlFor(token.syntax)
  if (token.expression !== undefined) return (
    <div className="au-tp-token-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--au-space-1)' }}>
      <span style={{ color: 'var(--au-ink-2)' }}>{label} <AuTag muted>Cascade</AuTag></span>
      <code style={{ fontSize: 'var(--au-t-xs)', overflowWrap: 'anywhere' }}>{token.name}</code>
      <span style={{ color: 'var(--au-ink-3)', fontSize: 'var(--au-t-xs)', overflowWrap: 'anywhere' }}>Source: {token.expression}</span>
      <code style={{ fontSize: 'var(--au-t-xs)', overflowWrap: 'anywhere' }}>Computed: {value}</code>
    </div>
  )
  return (
    <AuField className="au-tp-token-row" layout="inline">
      <span slot="label">
        <RowLabel text={label} token={simple ? (TOKEN_HINTS[token.name] ?? '') : token.name} overridden={overridden} onReset={onReset} />
      </span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--au-space-2)', minWidth: 0 }}>
        {kind === 'color' && (
          <AuColorPicker value={value} alpha size="md" label={label} onAuChange={(e: CustomEvent) => onEdit(e.detail.value)} />
        )}
        <AuInput
          value={value}
          aria-label={`${label} value`}
          style={{ width: 'min(12rem, 100%)', minWidth: 0, flex: '1 1 9rem', fontFamily: 'var(--au-font-mono)', fontSize: 'var(--au-t-xs)', letterSpacing: 'var(--au-ls-mono)' }}
          onAuInput={(e: CustomEvent) => onEdit((e.target as unknown as { value: string }).value)}
        />
      </div>
    </AuField>
  )
}

/* ── Collapsible family group ────────────────────────────────────────────────────────────────────── */
function Group({ title: gTitle, count, open, onToggle, first, children }: { title: string; count: number; open: boolean; onToggle: () => void; first?: boolean; children: ReactNode }): ReactNode {
  return (
    <section style={{ borderTop: first ? undefined : '1px solid var(--au-line-1)', paddingTop: first ? 0 : 'var(--au-space-3)' }}>
      <AuSectionHeader count={String(count)} collapsible open={open} onAuToggle={onToggle}>
        {gTitle}
      </AuSectionHeader>
      {open ? <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--au-space-3)', paddingTop: 'var(--au-space-2)' }}>{children}</div> : null}
    </section>
  )
}

/* ── Broken tokens — declared in a stylesheet, refused by the browser, absent from every other list. ─
 *    The host is the one place holding both a sheet's source text and the browser's verdict, so this
 *    is a RENDER of `host.tokens`. Shown ABOVE the grid (a correctness report) and REMOVED when clean. */
function BrokenTokens({ host }: { host: MountHost }): ReactNode {
  const [, force] = useState(0)
  useEffect(() => host.tokens?.subscribe(() => force((n) => n + 1)), [host])
  const rejected = host.tokens?.rejected() ?? []
  if (rejected.length === 0) return null
  const missed = host.tokens?.unreadableSheets() ?? 0
  return (
    <div className="au-tp-broken">
      <h3>{rejected.length} broken token{rejected.length > 1 ? 's' : ''}</h3>
      {rejected.map((r) => (
        <div key={r.name} className="au-tp-broken-row">
          <span className="au-tp-broken-name">{r.name}</span>
          <span className="au-tp-broken-src">{r.source}</span>
        </div>
      ))}
      <div className="au-tp-note err">
        Declared but REFUSED by the browser, so the token does not exist and every var() on it silently
        falls back. An @property initial-value must be computationally independent (no var(), no relative
        unit) unless its syntax is &ldquo;*&rdquo;.
      </div>
      {missed > 0 && (
        <div className="au-tp-note">{missed} stylesheet{missed > 1 ? 's' : ''} could not be read, so their tokens were not checked.</div>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * The pane — real tokens, real :root edits, real persistence + save-as + delete.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
function ThemingPane({ host }: { host: MountHost }): ReactNode {
  const tokens = useMemo(discoverTokens, [])
  const owners = useMemo(() => host.listProjections?.() ?? [], [host])
  const hasTheme = !!host.theme?.openDraft

  const [saved, setSaved] = useState<Record<string, string>>(() => host.theme?.getOverrides() ?? {})
  const [working, setWorking] = useState<Record<string, string>>(() => ({ ...(host.theme?.getOverrides() ?? {}) }))
  const [activeTheme, setActiveTheme] = useState<ThemeSelection | null>(() => host.theme?.getActiveTheme() ?? null)
  const [previewing, setPreviewing] = useState(false)
  const draftSession = useRef<ThemeDraftSession | null>(null)
  useEffect(() => {
    const session = host.theme?.openDraft?.()
    if (!session) return
    draftSession.current = session
    const sync = () => {
      const state = session.snapshot()
      setWorking(state.overrides)
      setSaved(state.saved)
      setActiveTheme(state.activeTheme)
      setPreviewing(state.previewing ?? false)
    }
    const unsubscribe = session.subscribe(sync)
    sync()
    return () => { unsubscribe(); session.dispose(); draftSession.current = null }
  }, [host])
  const [filter, setFilter] = useState('')
  const [feedback, setFeedback] = useState('')

  const dirty = useMemo(() => {
    const a = Object.keys(working)
    const b = Object.keys(saved)
    if (a.length !== b.length) return true
    return a.some((k) => working[k] !== saved[k])
  }, [host, working, saved])

  const previewTheme = useCallback((theme: ThemeSelection | null): void => {
    const session = draftSession.current
    if (!session?.previewTheme) throw new Error('Theme preview is unavailable in this host.')
    session.previewTheme(theme)
    setFeedback('')
  }, [])

  const cancelPreview = useCallback((): void => {
    draftSession.current?.cancelThemePreview?.()
    setFeedback('Returned to your saved theme. Unsaved adjustments are retained.')
  }, [])

  const displayValue = useCallback((t: Token): string => working[t.name] ?? currentValue(t), [working])

  const edit = useCallback((t: Token, v: string): void => {
    if (!draftSession.current) { setFeedback('This host does not support shared theme drafts.'); return }
    draftSession.current.setToken(t.name, v)
    setFeedback('')
  }, [])

  const resetToken = useCallback((t: Token): void => {
    draftSession.current?.setToken(t.name, null)
    setFeedback('Override cleared. Save to keep this change.')
  }, [])

  const doSave = useCallback((): void => {
    try {
      if (!draftSession.current) return
      draftSession.current.save()
      setFeedback('Changes saved on this device.')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not save changes. Your preview is still unsaved.')
    }
  }, [])

  const doRevert = useCallback((): void => {
    draftSession.current?.discard()
    setFeedback('Restored saved values.')
  }, [])

  const doResetAll = useCallback((): void => {
    draftSession.current?.reset()
    setFeedback('Overrides cleared. Save to keep this change.')
  }, [])

  const matchesFilter = useCallback(
    (t: Token): boolean => {
      const q = filter.trim().toLowerCase()
      if (!q) return true
      const { group, label } = derive(t.name, owners)
      return t.name.toLowerCase().includes(q) || (LABEL_OVERRIDE[t.name] ?? '').toLowerCase().includes(q) || label.toLowerCase().includes(q) || group.toLowerCase().includes(q)
    },
    [filter, owners],
  )

  const curatedTokens = useMemo(
    () => CURATED.map((name) => tokens.find((t) => t.name === name)).filter((t): t is Token => !!t && matchesFilter(t)),
    [tokens, matchesFilter],
  )

  const groups = useMemo(() => {
    const map = new Map<string, Token[]>()
    for (const t of tokens) {
      if (!matchesFilter(t)) continue
      const { group } = derive(t.name, owners)
      ;(map.get(group) ?? map.set(group, []).get(group)!).push(t)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [tokens, matchesFilter, owners])

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [section, setSection] = useState<'themes' | 'adjust' | 'tokens'>('themes')
  const showAll = section === 'tokens'
  const overrideCount = Object.keys(working).length

  return (
    <div className="au-tp">
      <au-scroll-area axis="y" className="au-tp-scroll">
      <header className="au-tp-head">
        <div><h1>Appearance</h1><p className="au-tp-intro">Themes, surfaces and the details of your interface.</p></div>
        <AuTag muted>This device</AuTag>
      </header>
      <AuSegmentedControl className="au-tp-sections" label="Appearance sections" value={section}
        items={[{value:'themes',label:'Themes'},{value:'adjust',label:'Customize'},{value:'tokens',label:'Advanced'}]}
        onAuChange={(e: CustomEvent) => {setSection(e.detail.value); setFilter('')}} />
      <div className="au-tp-content">
        <BrokenTokens host={host} />
        <div hidden={section !== 'themes'}>
          <ThemesBar activeTheme={activeTheme} previewing={previewing} onPreview={previewTheme} host={host} working={working} getCurrentWorking={() => draftSession.current?.snapshot().overrides ?? working} setWorking={setWorking} setSaved={setSaved} />
        </div>
        <div hidden={section === 'themes'} className="au-tp-adjust">
          <div className="au-tp-section-intro"><h2>{showAll ? 'Advanced tokens' : 'Customize appearance'}</h2>
            <p>{showAll ? 'Inspect and adjust the registered theme tokens. Changes are shown across the app.' : 'Adjust your appearance and see the changes across the app. Save when it feels right.'}</p></div>
          <AuInput value={filter} placeholder={showAll ? 'Find a token…' : 'Find an adjustment…'} aria-label={showAll ? 'Search tokens' : 'Search adjustments'} onAuInput={(e: CustomEvent) => setFilter((e.target as unknown as {value:string}).value)} />
          {showAll ? (groups.length === 0 ? <p className="au-tp-feedback">No tokens match your search.</p> : groups.map(([group, groupTokens], gi) => (
            <Group key={group} title={group} count={groupTokens.length} open={!!filter || !collapsed[group]} onToggle={() => setCollapsed(c => ({...c,[group]:!c[group]}))} first={gi===0}>
              {groupTokens.map(t => <TokenRow key={t.name} token={t} owners={owners} value={displayValue(t)} overridden={t.name in working} onEdit={v=>edit(t,v)} onReset={()=>resetToken(t)} />)}
            </Group>
          ))) : curatedTokens.length === 0 ? <p className="au-tp-feedback">No adjustments match your search.</p> : CUSTOMIZE_GROUPS.map(group => {
            const entries = curatedTokens.filter(t=>group.tokens.includes(t.name))
            return entries.length > 0 ? <section key={group.title} className="au-tp-custom-group"><h3>{group.title}</h3><p className="au-tp-feedback">{group.hint}</p>
              {entries.map(t=><TokenRow key={t.name} token={t} owners={owners} value={displayValue(t)} overridden={t.name in working} onEdit={v=>edit(t,v)} onReset={()=>resetToken(t)} simple />)}
            </section> : null
          })}
        </div>
      </div>
      </au-scroll-area>
      <footer className="au-tp-footer">
        <div><span className="au-tp-save-state">{previewing ? `Previewing ${activeTheme?.name ?? 'Base'}` : dirty ? 'Unsaved appearance changes' : overrideCount ? `${overrideCount} saved adjustments` : 'Using theme defaults'}</span><p className="au-tp-feedback" role="status">{feedback || (!hasTheme ? 'Appearance editing is unavailable in this host.' : previewing ? 'Preview is visible across the app. Save to keep this theme.' : dirty ? 'Changes are visible across the app.' : 'Preferences are saved on this device.')}</p></div>
        <div className="au-tp-actions" key={previewing || dirty ? 'draft' : 'saved'}>{previewing ? <><AuButton variant="ghost" onAuActivate={cancelPreview}>Cancel preview</AuButton><AuButton variant="cta" onAuActivate={doSave}>Save changes</AuButton></> : dirty ? <><AuButton variant="ghost" onAuActivate={doRevert}>Discard changes</AuButton><AuButton variant="cta" onAuActivate={doSave}>Save changes</AuButton></> : <AuButton variant="ghost" disabled={!hasTheme || overrideCount===0} onAuActivate={doResetAll}>Reset adjustments</AuButton>}</div>
      </footer>
    </div>
  )
}

/* ── Named themes: discover, apply, duplicate/save-as, delete (built-in tag on read-only themes) ──── */

/* ── the pane's own LAYOUT css — injected through host.styles.inject (CSP-safe, @scope-confined to the
 *    pane's subtree). The `<au-*>` components self-style in shadow; this is only the grid + preview. ── */
import { LAYOUT_CSS } from './layout'

export function mount(container: HTMLElement, host: MountHost): () => void {
  const disposeStyles = host.styles?.inject(LAYOUT_CSS, container)
  const el = document.createElement('div')
  el.style.height = '100%'
  el.style.minHeight = '0'
  el.style.color = 'var(--au-ink-1)'
  container.appendChild(el)

  const reactRoot = createRoot(el)
  reactRoot.render(<ThemingPane host={host} />)

  return () => {
    reactRoot.unmount()
    disposeStyles?.()
    el.remove()
  }
}

// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount })
