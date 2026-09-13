import clsx from 'clsx'
import { createElement, useEffect, useRef, useState } from 'react'
import type { ComponentPropsWithoutRef, CSSProperties, ReactElement, ReactNode } from 'react'
import { createPortal } from 'react-dom'
// Side-effect import: registers the `<au-avatar-sphere>` custom element (the launcher mark's
// living form). The element is bespoke, framework-agnostic, and self-registers on import.
import '@arsumbris/au-avatar'
import { AU_HP_LOGO_DATA_URI } from './logo'
import { Button } from '../Button/Button'
import { EmptyState } from '../EmptyState/EmptyState'
import { Icon } from '../Icon/Icon'
import { Kbd } from '../Kbd/Kbd'
import { RecentRow } from '../RecentRow/RecentRow'
import { SectionHeader } from '../SectionHeader/SectionHeader'
import { StatusDot } from '../StatusDot/StatusDot'
import './Launcher.css'

export interface LauncherRecent {
  name: ReactNode
  path: string
  meta?: ReactNode
  live?: boolean
  needsSetup?: boolean
  layoutLabel?: string
}

export interface LauncherDaemon {
  live?: boolean
  detail?: ReactNode
}

export interface LauncherProps extends Omit<ComponentPropsWithoutRef<'div'>, 'onSelect'> {
  recents?: readonly LauncherRecent[]
  selectedPath?: string
  /* SELECT-THEN-LAUNCH: a click on a not-yet-selected row only highlights and arms the CTA, it does
   * NOT boot. Omit `onSelect` and every click reverts to one-click boot through `onOpen`. */
  onSelect?: (path: string) => void
  onOpen?: (path: string) => void
  onOpenFolder?: () => void
  onNew?: () => void
  onSetup?: () => void
  canLaunch?: boolean
  launchReason?: ReactNode
  showIdentity?: boolean
  brand?: ReactNode
  tagline?: ReactNode
  mark?: ReactNode
  status?: ReactNode
  daemon?: LauncherDaemon
}

function AuHpMark(): ReactElement {
  return (
    <img
      className="au-launcher__mark"
      src={AU_HP_LOGO_DATA_URI}
      alt=""
      draggable={false}
      aria-hidden="true"
    />
  )
}

/* A viewport-wide roamer: the sphere detaches from the mark and trails the cursor with an offset
 * and a little lag, its eye looking back at you. Portaled to <body> so the header's rise transform
 * doesn't trap the fixed positioning, and click-through so it never blocks the launcher. */
function RoamingSphere(): ReactElement {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const OFFX = 40
    const OFFY = 34
    let px = window.innerWidth / 2
    let py = window.innerHeight * 0.4
    let tx = px
    let ty = py
    const onMove = (e: PointerEvent): void => {
      tx = e.clientX + OFFX
      ty = e.clientY + OFFY
    }
    window.addEventListener('pointermove', onMove)
    let raf = 0
    const loop = (): void => {
      px += (tx - px) * 0.12 // trail with lag
      py += (ty - py) * 0.12
      el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])
  return (
    <span ref={ref} className="au-launcher__mark-roamer" aria-hidden="true">
      {createElement('au-avatar-sphere', { mode: '1', className: 'au-launcher__mark-sphere' })}
    </span>
  )
}

type MarkPhase = 'orb' | 'inplace' | 'roam'
const NEXT_PHASE: Record<MarkPhase, MarkPhase> = { orb: 'inplace', inplace: 'roam', roam: 'orb' }
const MARK_LABEL: Record<MarkPhase, string> = {
  orb: 'Wake the avatar',
  inplace: 'Let the avatar roam',
  roam: 'Settle the avatar',
}

/* The living mark, a three-step easter egg driven by clicking the slot:
 *   orb      the still pearl-umbra logo.
 *   inplace  the avatar sphere sits in the slot; its eye follows the cursor, a click bounces it.
 *   roam     the sphere detaches and trails the cursor across the whole page (a click-through
 *            overlay), the logo returning to the slot; the next click settles it back to the orb. */
function LauncherMark(): ReactElement {
  const [phase, setPhase] = useState<MarkPhase>('orb')
  return (
    <>
      <button
        type="button"
        className="au-launcher__mark-btn"
        onClick={() => setPhase((p) => NEXT_PHASE[p])}
        aria-label={MARK_LABEL[phase]}
      >
        {phase === 'inplace'
          ? createElement('au-avatar-sphere', { mode: '1', className: 'au-launcher__mark-sphere' })
          : <AuHpMark />}
      </button>
      {phase === 'roam' ? createPortal(<RoamingSphere />, document.body) : null}
    </>
  )
}

export type OrbState = 'idle' | 'starting' | 'ready'

export interface OrbProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  state?: OrbState
}

/* AuHpMark made LIVING. Motion is CSS-only and fully suppressed under `prefers-reduced-motion`; the
 * animation is the ONLY thing added, never a colour or a frame. */
export function Orb({ state = 'idle', className, ...rest }: OrbProps): ReactElement {
  return (
    <span className={clsx('au-orb', className)} data-state={state} aria-hidden="true" {...rest}>
      <img className="au-orb__img" src={AU_HP_LOGO_DATA_URI} alt="" draggable={false} />
    </span>
  )
}

function rise(i: number): CSSProperties {
  return { ['--au-rise-i' as string]: i } as CSSProperties
}

/* The start screen as a FULL-VIEWPORT product surface, NOT a boxed dialog. The ink1→ink3 value gap
 * IS the hierarchy, and emphasis is ink weight + surface lift + hairline — never a coloured bar. */
export function Launcher({
  recents = [],
  selectedPath,
  onSelect,
  onOpen,
  onOpenFolder,
  onNew,
  onSetup,
  showIdentity = true,
  brand = 'Ars Umbris',
  tagline = 'Open a workspace or create a new one.',
  mark,
  status,
  daemon,
  canLaunch,
  launchReason,
  className,
  ...rest
}: LauncherProps): ReactElement {
  const [workspaceQuery, setWorkspaceQuery] = useState('')
  const shownRecents = recents.filter(r => `${typeof r.name === 'string' ? r.name : ''} ${r.path}`.toLowerCase().includes(workspaceQuery.toLowerCase().trim()))
  const hasRecents = recents.length > 0
  const daemonLive = daemon?.live ?? false
  const daemonDetail = daemon?.detail ?? (daemonLive ? 'ready' : 'idle')

  // BRAND-ANCHORED, not a footline: the chip rides the baseline under the wordmark, where the eye
  // already is. Passing nothing leaves it simply ABSENT — silence is the resting state.
  const brandStatus =
    status ??
    (daemon != null ? (
      <p className="au-launcher__daemon">
        <StatusDot
          tone={daemonLive ? 'ok' : 'ink'}
          variant={daemonLive ? 'filled' : 'ring'}
          size="sm"
          glow={daemonLive}
          pulse={daemonLive}
        />
        <span className="au-launcher__daemon-label">daemon</span>
        <span className="au-launcher__daemon-detail">{daemonDetail}</span>
      </p>
    ) : null)

  const activate = (path: string): void => {
    if (onSelect && path !== selectedPath) onSelect(path)
    else onOpen?.(path)
  }
  const launchEnabled = canLaunch ?? selectedPath != null

  return (
    <div className={clsx('au-launcher', className)} {...rest}>
      <div className="au-launcher__column" aria-label="Launcher">
        {showIdentity && <header className="au-launcher__brand au-rise" style={rise(0)}>
          <span className="au-launcher__mark-slot">
            {mark ?? <LauncherMark />}
          </span>
          <h1 className="au-launcher__wordmark">{brand}</h1>
          <p className="au-launcher__tagline">{tagline}</p>
          {brandStatus != null ? <div className="au-launcher__brand-status">{brandStatus}</div> : null}
        </header>}
        {!showIdentity && brandStatus != null && <div className="au-launcher__brand-status">{brandStatus}</div>}

        <section className="au-launcher__recents au-rise" style={rise(1)}>
          {hasRecents ? (
            <div className="au-launcher__recents-surface">
              <SectionHeader
                sans
                title="Recent workspaces"
                count={recents.length}
                className="au-launcher__recents-head"
              />
              {recents.length > 4 && <input className="au-launcher__workspace-search" aria-label="Find a workspace" placeholder="Find a workspace…" value={workspaceQuery} onChange={e=>setWorkspaceQuery(e.target.value)} spellCheck={false} />}
              <div className="au-launcher__recents-list" onKeyDown={e=>{
                if (!['ArrowDown','ArrowUp','Home','End'].includes(e.key)) return
                const rows=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
                const at=rows.indexOf(document.activeElement as HTMLButtonElement)
                if(at<0||!rows.length)return
                e.preventDefault()
                const next=e.key==='Home'?0:e.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,at+(e.key==='ArrowDown'?1:-1)))
                rows[next]?.focus()
              }}>
                {shownRecents.length===0 && <p className="au-launcher__no-matches">No workspaces match this search.</p>}
                {shownRecents.map((r) => {
                  const selected = r.path === selectedPath
                  return (
                    <RecentRow
                      key={r.path}
                      name={r.name}
                      status="none"
                      lead={<span className="au-launcher__workspace-icon"><Icon name="folder-open" size="lg" /></span>}
                      selected={selected}
                      onClick={() => activate(r.path)}
                      aria-keyshortcuts={selected ? 'Enter' : undefined}
                      meta={
                        <span className="au-launcher__recent-meta">
                          <span className="au-launcher__recent-path" title={r.path}>{r.path}</span>
                          {r.layoutLabel && <span className="au-launcher__layout-label">Last layout · {r.layoutLabel}</span>}
                          {r.needsSetup && <span className="au-launcher__layout-label">Needs setup</span>}
                          {r.meta != null || r.live || selected ? (
                            <span className="au-launcher__recent-aside">
                              {r.meta != null ? (
                                <span className="au-launcher__recent-when">{r.meta}</span>
                              ) : null}
                              {/* Per-workspace status rides the row itself — never a separate block. */}
                              {r.live ? <span className="au-launcher__recent-serving">serving</span> : null}
                              {selected ? <Kbd className="au-launcher__recent-enter">⏎</Kbd> : null}
                            </span>
                          ) : null}
                        </span>
                      }
                    />
                  )
                })}
              </div>
            </div>
          ) : (
            <EmptyState
              className="au-launcher__empty"
              icon={<Icon name="folder-open" size="lg" />}
              title="Your first workspace"
              hint="Choose a starter to create your own workspace, or open a workspace folder you already have."
            />
          )}
        </section>

        <footer className="au-launcher__actions au-rise" style={rise(2)}>
          {hasRecents && <div className="au-launcher__launch-slot">
            <Button
              variant="cta"
              className="au-launcher__launch"
              onClick={() => (selectedPath != null ? onOpen?.(selectedPath) : undefined)}
              disabled={!launchEnabled}
              // The reason rides the CTA itself, NOT a visible line beneath it: a line that appears
              // only while disabled is a conditional element in normal flow, so selecting a workspace
              // would remove a block and RESNAP the whole column.
              title={!launchEnabled && typeof launchReason === 'string' ? launchReason : undefined}
              aria-label={
                !launchEnabled && typeof launchReason === 'string' ? `Launch — ${launchReason}` : undefined
              }
            >
              Launch
              <Icon name="chevron-right" size="sm" />
            </Button>
          </div>}

          <div className="au-launcher__actions-row">
            <Button variant="solid" className="au-launcher__action" onClick={onOpenFolder}>
              <Icon name="folder-open" size="sm" />
              Open folder…
            </Button>
            <Button variant={hasRecents?"ghost":"cta"} className="au-launcher__action" onClick={onNew}>
              <Icon name="plus" size="sm" />
              New workspace
            </Button>
          </div>
          {onSetup && <Button variant="ghost" className="au-launcher__setup-action" onClick={onSetup}>Setup</Button>}
        </footer>
      </div>
    </div>
  )
}
