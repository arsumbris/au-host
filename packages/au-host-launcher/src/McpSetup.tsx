// Guided first-run setup for the agent (MCP) tool paths.
//
// The host spawns the au-mcp daemon from per-machine tool locations in
// `~/.arsumbris/au-host/config/paths.yaml`. Rather than dead-ending on a "set it in
// paths.yaml" error, this walks the user through the au-mcp CLI path (the minimum to
// start the daemon): its current value, live existence validation, a native browse
// picker, and a dev-defaults prefill. Saving writes the file; the raw file stays
// editable via "open config file".
//
// Adapters are NOT configured here — they are DISCOVERED (`mcp.adapter` type-defs; their
// folders come from the type graph). The agent binary location, when it is
// not on PATH, is set per-adapter in the post-workspace runtime-settings pane (the
// `binaries` map), which can enumerate the discovered adapters. So this pre-workspace setup
// covers only the au-mcp CLI + node.
//
// Collapsible; expands by default until the au-mcp CLI is configured and found.

import { useCallback, useEffect, useState } from 'react'

import type { ToolPathsInfo } from '@arsumbris/au-host-app'

import type { LauncherHost } from './launcher-host'
import {DisclosureChevron} from './DisclosureChevron'

interface Draft {
  auMcp: string
  node: string
}

const EMPTY: Draft = { auMcp: '', node: '' }

export function McpSetup({ host }: { host: LauncherHost }): React.JSX.Element {
  const [info, setInfo] = useState<ToolPathsInfo | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [auMcpExists, setAuMcpExists] = useState(false)
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problem,setProblem] = useState('')

  const load = useCallback(async (): Promise<void> => {
    const i = await host.mcp.toolPaths()
    setInfo(i)
    // A default (`node`) shows as blank so the user sees "PATH", not a literal.
    setDraft({
      auMcp: i.paths.auMcp ?? '',
      node: i.paths.node === 'node' ? '' : i.paths.node,
    })
    // Expand until au-mcp is configured (the minimum to start the daemon).
    setOpen(!i.paths.auMcp)
  }, [])

  useEffect(() => {
    void load().catch(e=>setProblem(String(e)))
  }, [load])

  // Live existence validation for the au-mcp CLI path.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ok = draft.auMcp ? await host.mcp.pathExists(draft.auMcp).catch(()=>false) : false
      if (!cancelled) setAuMcpExists(ok)
    })()
    return () => {
      cancelled = true
    }
  }, [draft.auMcp])

  const set = (patch: Partial<Draft>): void => {
    setDraft((d) => ({ ...d, ...patch }))
    setSaved(false)
  }

  const browseAuMcp = async (): Promise<void> => {
    try {const picked = await host.dialog.pickPath('file'); if(picked)set({auMcp:picked})} catch(e) {setProblem(String(e))}
  }

  const useDefaults = (): void => {
    if (info) set({ auMcp: info.suggested.auMcp })
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setProblem('')
    try {
      await host.mcp.saveToolPaths({ auMcp: draft.auMcp, node: draft.node })
      setInfo(await host.mcp.toolPaths())
      setSaved(true)
    } catch(e) {setProblem(String(e))} finally {setSaving(false)}
  }

  const auMcpOk = Boolean(draft.auMcp) && auMcpExists
  const summary = auMcpOk ? 'configured ✓' : 'not set up'

  const checkClass = (has: boolean, ok: boolean): string => (!has ? 'muted' : ok ? 'ok' : 'bad')
  const checkText = (has: boolean, ok: boolean, need: string): string => (!has ? need : ok ? '✓ found' : '⚠ not found')

  return (
    <details className="mcp-setup gate-disclosure" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="mcp-setup-head">
        Agent tools (MCP)
        <span className={`mcp-setup-summary ${auMcpOk ? 'ok' : 'bad'}`}>{summary}</span>
        <DisclosureChevron />
      </summary>

      {(
        <div className="mcp-setup-body">
          <div className="projection-hint">
            where the au-mcp CLI lives on this machine — the host starts the mcp daemon from here. node
            defaults to your PATH. Adapters are discovered automatically; set a non-PATH agent binary in
            a workspace's runtime settings.
          </div>
          {(problem || info?.problem) && <div className="starter-feedback" role="alert">{problem || info?.problem}</div>}

          <div className="config">
            <label>
              <span>MCP executable · required for agent tools</span>
              <input
                value={draft.auMcp}
                onChange={(e) => set({ auMcp: e.target.value })}
                placeholder="…/arsumbris/au-mcp/src/cli.ts"
                spellCheck={false}
              />
              <button type="button" onClick={() => void browseAuMcp()}>Browse…</button>
              <span className={`mcp-check ${checkClass(Boolean(draft.auMcp), auMcpOk)}`}>
                {checkText(Boolean(draft.auMcp), auMcpOk, 'required')}
              </span>
            </label>

            <label>
              <span>Node executable · optional</span>
              <input
                value={draft.node}
                onChange={(e) => set({ node: e.target.value })}
                placeholder="node (on PATH)"
                spellCheck={false}
              />
              <span className="projection-hint">Leave empty to use Node from PATH.</span>
            </label>
          </div>

          <div className="mcp-setup-actions">
            <button type="button" onClick={useDefaults}>Use development paths</button>
            <button type="button" onClick={() => void host.mcp.openPathsFile()}>Open config file</button>
            <span className="spacer" />
            <button type="button" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save tool paths'}
            </button>
          </div>

          {info?.file && (
            <div className="projection-hint">
              config: <code>{info.file}</code>
            </div>
          )}
        </div>
      )}
    </details>
  )
}
