import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode,type CSSProperties} from 'react'
import {splitThemeOverrides,isWritableMember,type MountHost,type ThemeSelection} from '@arsumbris/au-host-sdk'
import {AuButton,AuField,AuIcon,AuIconButton,AuInput,AuListRow,AuTag} from '@arsumbris/au-component-catalog/react'
import {buildThemeCss,deleteTheme,discoverThemes,parseThemeCss,qualifiedThemeType,readThemeCss,resolveThemePaths,slug,writeTheme,type DiscoveredTheme} from './theme-config'
const monoVal = {fontFamily:'var(--au-font-mono)',fontSize:'var(--au-t-xs)',color:'var(--au-ink-3)'}
// Sentinel value for the "no named theme" segment — restores the crafted @property default. A NUL-prefix
// can never collide with a real theme `name`.
const BASE = '\0base'

export function ThemesBar({
  host,
  activeTheme: selection,
  previewing,
  onPreview,
  working,
  getCurrentWorking,
  setWorking,
  setSaved,
}: {
  host: MountHost
  activeTheme: ThemeSelection | null
  previewing: boolean
  onPreview: (theme: ThemeSelection | null) => void
  working: Record<string, string>
  getCurrentWorking: () => Record<string, string>
  setWorking: (v: Record<string, string>) => void
  setSaved: (v: Record<string, string>) => void
}): ReactNode {
  const [discovered, setDiscovered] = useState<DiscoveredTheme[]>([])
  const activeName = selection?.name ?? null
  const [authoring, setAuthoring] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [themeMaps, setThemeMaps] = useState<Record<string,Record<string,string>>>({})
  const [saveName, setSaveName] = useState('')
  const [note, setNote] = useState<{ text: string; err: boolean } | null>(null)

  const writableRoots = useMemo(() => host.workspace.members.filter(isWritableMember).map((m) => m.root.replace(/\/+$/, '')), [host])
  const isDeletable = useCallback((t: DiscoveredTheme): boolean => writableRoots.some((r) => t.path.startsWith(`${r}/`)), [writableRoots])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setLoading(true)
      setDiscovered(await discoverThemes(host.engine))
    } catch {
      setNote({text:'Could not load themes. Try again.',err:true})
    } finally { setLoading(false) }
  }, [host])

  useEffect(() => {
    void refresh()
  }, [refresh])


  useEffect(() => {
    let cancelled = false
    void Promise.all(discovered.map(async theme => {
      try { const result = await readThemeCss(host.files, theme); return [theme.path,parseThemeCss(result.css)] as const }
      catch { return [theme.path,{}] as const }
    })).then(entries => {if(!cancelled) setThemeMaps(Object.fromEntries(entries))})
    return () => {cancelled=true}
  },[discovered,host])

  const selectionRequest = useRef(0)
  useEffect(() => () => { selectionRequest.current++ }, [])
  const applyTheme = useCallback(
    (t: DiscoveredTheme | null): void => {
      const request = ++selectionRequest.current
      setBusy(true)
      void (async (): Promise<void> => {
        try {
          if (!host.theme) return
          const result = t ? await readThemeCss(host.files, t) : null
          if (request !== selectionRequest.current) return
          if (result?.refused.length) {
            setNote({ text: `Could not load the complete theme: ${result.refused.map(r => r.rel + ' (' + r.error + ')').join('; ')}`, err: true })
            return
          }
          onPreview(t && result ? { id: t.path, name: t.name, css: result.css } : null)
          setNote(null)
        } catch (error) {
          if (request === selectionRequest.current) setNote({ text: error instanceof Error ? error.message : 'Could not apply theme.', err: true })
        } finally { if(request===selectionRequest.current) setBusy(false) }
      })()
    },
    [host, onPreview],
  )

  const doSaveAs = useCallback((): void => {
    const name = saveName.trim()
    if (!name) {
      setNote({ text: 'name the theme first', err: true })
      return
    }
    const members = host.workspace.members.filter(isWritableMember)
    const target = members.find((m) => m.name === 'content') ?? members[0]
    if (!target) {
      setNote({ text: 'no writable workspace member to save into', err: true })
      return
    }
    const paths = resolveThemePaths(target.root, `themes/${slug(name)}`)
    if (!paths.ok) {
      setNote({ text: paths.error, err: true })
      return
    }
    const request = ++selectionRequest.current
    const activeCss = host.theme?.getActiveTheme()?.css
    const { appearance: overrides } = splitThemeOverrides({ ...(activeCss ? parseThemeCss(activeCss) : {}), ...working })
    const { device } = splitThemeOverrides(working)
    void (async (): Promise<void> => {
      // `slug` collapses case + punctuation, so several names land on the SAME files. Probe + confirm
      // through the host's ConfirmSurface (it claims host.overlay) before overwriting.
      if (await host.files.exists(paths.instancePath)) {
        const outcome = await host.confirm?.confirm({
          title: 'Overwrite theme',
          message: `“${name}” saves as “${slug(name)}”, which already exists — overwriting replaces its authored tokens.`,
          danger: true,
          affected: [paths.instancePath, paths.cssPath],
          confirmLabel: 'Overwrite',
        })
        if (!outcome?.confirmed) {
          setNote({ text: `“${slug(name)}” already exists — not overwritten`, err: true })
          return
        }
      }
      setNote({ text: 'saving…', err: false })
      const typeName = await qualifiedThemeType(host.engine)
      const res = await writeTheme(host.files, paths, name, overrides, typeName)
      if (!res.ok) {
        setNote({ text: res.error, err: true })
        return
      }
      if (request !== selectionRequest.current) return
      if (JSON.stringify(getCurrentWorking()) !== JSON.stringify(working) || host.theme?.getActiveTheme()?.css !== activeCss) {
        setNote({ text: 'Theme files saved. Newer appearance changes were kept; choose the saved theme when ready.', err: false })
        void refresh()
        return
      }
      try {
        host.theme?.setActiveTheme({ id: paths.instancePath, name, css: buildThemeCss(name, overrides) })
        host.theme?.save(device)
      } catch (error) {
        setNote({ text: `Theme files saved, but device preferences could not be updated: ${error instanceof Error ? error.message : 'storage unavailable'}`, err: true })
        void refresh()
        return
      }
      setWorking(device)
      setSaved(device)
      setSaveName('')
      setNote({ text: `saved ${res.instancePath.slice(res.instancePath.lastIndexOf('/') + 1)}`, err: false })
      void refresh()
    })()
  }, [saveName, host, working, getCurrentWorking, setWorking, setSaved, refresh])

  const doDelete = useCallback(
    (t: DiscoveredTheme): void => {
      void (async (): Promise<void> => {
        // Confirm through the host ConfirmSurface (host.overlay) — the blast radius is the instance + its styles.
        const outcome = await host.confirm?.confirm({
          title: 'Delete theme',
          message: `Remove “${t.name}” and its style file. This cannot be undone.`,
          danger: true,
          affected: [t.path],
          confirmLabel: 'Delete',
        })
        if (!outcome?.confirmed) return
        const res = await deleteTheme(host.files, t)
        if (!res.ok) {
          setNote({ text: res.error, err: true })
          return
        }
        if (activeName === t.name) host.theme?.setActiveTheme(null)
        setNote({ text: `deleted ${t.name}`, err: false })
        void refresh()
      })()
    },
    [host, activeName, refresh],
  )

  const activeTheme = discovered.find((t) => selection?.id ? t.path === selection.id : t.name === activeName) ?? null
  const activeBuiltIn = activeTheme != null && !isDeletable(activeTheme)

  const choices: (DiscoveredTheme | null)[] = [null,...discovered]
  return (
    <div>
      <div className="au-tp-section-intro"><h2>Choose a theme</h2><p>Preview a theme across the app, then save to keep it. Appearance adjustments belong to each theme; density and terminal text size belong to this device.</p></div>
      {loading && <p className="au-tp-feedback" role="status">Loading installed themes…</p>}
      <div className="au-tp-theme-list" aria-label="Installed themes">
        {choices.map(theme => {
          const name = theme?.name ?? 'Base'
          const key = theme?.path ?? BASE
          const active = theme ? activeTheme?.path===theme.path : activeName===null
          const map = themeMaps[key] ?? {}
          const colors = {'--mini-bg':map['--au-color-bg'] ?? '#13120f','--mini-pane':map['--au-color-surface-1'] ?? '#191813','--mini-ink':map['--au-ink-1'] ?? '#e2dfda'} as CSSProperties
          return <AuListRow key={key} className="au-tp-theme-choice" interactive selected={active} disabled={busy || !host.theme} primary={name} secondary={active ? previewing ? 'Previewing' : 'Current theme' : 'Preview theme'} aria-label={`Preview ${name} theme`} onClick={()=>{if(!busy && host.theme) applyTheme(theme)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' ') {e.preventDefault(); if(!busy && host.theme) applyTheme(theme)}}}>
            <div slot="leading" className="au-tp-theme-mini" style={colors} aria-hidden="true"><aside><i/><i/><i/></aside><article><strong>Field notes</strong><i/><i/><i style={{width:'62%'}}/></article></div>
          </AuListRow>
        })}
      </div>
      {busy && <p className="au-tp-feedback" role="status">Loading preview…</p>}
      {!loading && discovered.length===0 && <p className="au-tp-feedback">No named themes are available in this workspace.</p>}
      <AuButton variant="ghost" size="sm" onAuActivate={()=>void refresh()}>Refresh themes</AuButton>

      {activeBuiltIn && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--au-space-1)' }}>
          <AuTag muted>read-only</AuTag>
          <span style={{ ...monoVal, color: 'var(--au-ink-4)' }}>Save as to keep changes</span>
        </span>
      )}

      {host.theme && <div className="au-tp-authoring"><div className="au-tp-section-intro"><h2>Your own themes</h2><p>Save your current appearance as a named theme in the workspace.</p></div>
        <AuButton variant="outline" disabled={previewing} onAuActivate={()=>setAuthoring(v=>!v)}>{authoring ? 'Close theme form' : 'Save as theme…'}</AuButton></div>}
      {previewing && <p className="au-tp-feedback">Save or cancel the preview before creating or deleting a named theme.</p>}
      {host.theme && authoring && !previewing && (
        <div className="au-tp-theme-actions">
          <AuField label="Theme name" layout="stack"><AuInput value={saveName} placeholder="Save current as…" aria-label="New theme name" style={{ flex: '1 1 auto', minWidth: 0 }} onAuInput={(e: CustomEvent) => setSaveName((e.target as unknown as { value: string }).value)} /></AuField>
          <AuButton variant="cta" size="sm" disabled={!saveName.trim()} onAuActivate={doSaveAs}>Save as</AuButton>
          {activeTheme && (
            <>
              <AuButton variant="ghost" size="sm" onAuActivate={() => setSaveName(`${activeTheme.name} copy`)}>Name a copy</AuButton>
              {isDeletable(activeTheme) && (
                <AuIconButton size="sm" surface="panel" label={`Delete ${activeTheme.name}`} onAuActivate={() => doDelete(activeTheme)}>
                  <AuIcon name="trash" size="sm" />
                </AuIconButton>
              )}
            </>
          )}
        </div>
      )}

      {note && <span role={note.err ? 'alert' : 'status'} style={{ ...monoVal, whiteSpace: 'normal', overflowWrap: 'anywhere', color: note.err ? 'var(--au-color-danger)' : 'var(--au-ink-4)' }}>{note.text}</span>}
    </div>
  )
}
