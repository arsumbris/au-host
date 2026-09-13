// aup-git-activity: a live cross-repo commit pulse. One reverse-chronological stream of change
// events merged across every mounted working tree, drawn as a connected multi-lane rail (one lane
// per repo, collapsible to one), so a user sees what is happening across their repos at a glance.
// Data comes solely from the engine's member-aware recent_commits subscription, never a renderer
// git shell-out. The stream is append-only: the client owns a bounded window, dedups by commit oid,
// and inserts a new commit by committer timestamp (not always at the head).

import { defineProjection, type ProjectionModule, type MountHost } from '@arsumbris/au-host-sdk'
import {
  subscribeRecentCommits,
  readRecentCommits,
  readCommitMeta,
  type WireRecentCommit,
  type WireChangedFile,
} from '@arsumbris/au-host-sdk/engine-reads'
import { fileSelection } from '@arsumbris/selection'
import { openIntent } from '@arsumbris/intent'

import { groupActivity, type ActivityEntry } from './lib/group.ts'

/** The most rows the client holds. New commits append, the oldest tail is trimmed past this. */
const WINDOW = 500
/** The seed page size, also the live channel's bound. */
const SEED_LIMIT = 100
/** How many older commits a "load older" page fetches. */
const PAGE = 100
/** The pixel width of one lane column in the rail gutter. */
const LANE_W = 14

const STYLE = `
.au-git-activity {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  font: var(--au-t-sm)/var(--au-lh-sm) var(--au-font-sans);
  color: var(--au-ink-2);
  background: var(--au-color-surface-1);
}
.au-git-activity-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--au-space-1);
  padding: var(--au-space-1) var(--au-space-2);
  color: var(--au-ink-4);
  font: var(--au-t-xs)/var(--au-lh-sm) var(--au-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.au-git-activity-title { flex: 1 1 auto; }
.au-git-activity-toggle {
  flex: 0 0 auto;
  padding: 0 var(--au-space-1);
  border: 1px solid var(--au-line-3);
  border-radius: var(--au-radius-chip);
  background: transparent;
  cursor: pointer;
  color: var(--au-ink-3);
  font: var(--au-t-xs)/1.6 var(--au-font-sans);
  letter-spacing: 0.04em;
}
.au-git-activity-toggle:hover { background: var(--au-chrome-hover); }
.au-git-activity-filter {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: var(--au-space-0-5);
  padding: 0 var(--au-space-2) var(--au-space-1);
}
.au-git-activity-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--au-space-0-5);
  padding: 0 var(--au-space-1);
  border: 1px solid var(--au-line-3);
  border-radius: var(--au-radius-pill);
  cursor: pointer;
  color: var(--au-ink-3);
  font: var(--au-t-xs)/1.6 var(--au-font-sans);
}
.au-git-activity-chip:hover { background: var(--au-chrome-hover); }
.au-git-activity-chip--off { opacity: 0.4; }
.au-git-activity-chip-dot {
  width: 0.5em;
  height: 0.5em;
  border-radius: 50%;
  background: var(--au-git-activity-tree, var(--au-ink-4));
}
.au-git-activity-list {
  flex: 1 1 auto;
  overflow-y: auto;
  padding-bottom: var(--au-space-2);
}
.au-git-activity-day {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: var(--au-space-1) var(--au-space-2) var(--au-space-0-5);
  background: var(--au-color-surface-1);
  color: var(--au-ink-4);
  font: var(--au-t-xs)/var(--au-lh-sm) var(--au-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.au-git-activity-row {
  display: flex;
  align-items: center;
  gap: var(--au-space-1);
  min-height: var(--au-row-h-dense);
  padding: 0 var(--au-space-2);
  cursor: pointer;
}
.au-git-activity-row:hover { background: var(--au-chrome-hover); }
.au-git-activity-row:hover .au-git-activity-subject { color: var(--au-ink-1); }
.au-git-activity-row--new .au-git-activity-subject { animation: au-git-activity-in 700ms ease; }
@keyframes au-git-activity-in {
  from { color: var(--au-color-accent); }
  to { color: var(--au-ink-2); }
}
.au-git-activity-rail {
  flex: 0 0 auto;
  position: relative;
  align-self: stretch;
}
.au-git-activity-rail-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-1px);
  opacity: 0.5;
}
.au-git-activity-dot {
  position: absolute;
  top: 50%;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: var(--au-git-activity-tree, var(--au-ink-3));
}
.au-git-activity-dot--hollow {
  background: var(--au-color-surface-1);
  border: 1.5px solid var(--au-git-activity-tree, var(--au-ink-3));
}
.au-git-activity-subject {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--au-ink-2);
}
.au-git-activity-meta {
  flex: 0 0 auto;
  color: var(--au-ink-4);
  font: var(--au-t-xs)/var(--au-lh-sm) var(--au-font-sans);
}
.au-git-activity-empty {
  padding: var(--au-space-3) var(--au-space-2);
  color: var(--au-ink-4);
  text-align: center;
}
.au-git-activity-panel {
  padding: var(--au-space-0-5) var(--au-space-2) var(--au-space-1) calc(var(--au-space-2) + 1em);
  color: var(--au-ink-2);
}
.au-git-activity-commit { padding: var(--au-space-0-5) 0; }
.au-git-activity-commit-head {
  display: flex;
  gap: var(--au-space-1);
  align-items: baseline;
  color: var(--au-ink-3);
  font: var(--au-t-xs)/var(--au-lh-sm) var(--au-font-mono, ui-monospace, "SF Mono", monospace);
}
.au-git-activity-body {
  margin: var(--au-space-0-5) 0;
  white-space: pre-wrap;
  color: var(--au-ink-2);
  font: var(--au-t-xs)/var(--au-lh-base) var(--au-font-sans);
}
.au-git-activity-file {
  display: flex;
  gap: var(--au-space-1);
  padding: 1px 0;
  cursor: pointer;
  font: var(--au-t-xs)/var(--au-lh-sm) var(--au-font-mono, ui-monospace, "SF Mono", monospace);
}
.au-git-activity-file:hover { color: var(--au-color-accent); }
.au-git-activity-file-status {
  flex: 0 0 1.2em;
  text-align: center;
  color: var(--au-ink-4);
}
.au-git-activity-trailers {
  margin-top: var(--au-space-0-5);
  color: var(--au-ink-4);
  font: var(--au-t-xs)/var(--au-lh-base) var(--au-font-mono, ui-monospace, "SF Mono", monospace);
}
`

/** The last path segment of a working-tree root, the compact repo label. */
function shortTree(treeRoot: string): string {
  const parts = treeRoot.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || treeRoot
}

/** A relative age for a unix-seconds timestamp, "3m" / "2h" / "5d", else a short date. */
function relTime(unixSeconds: number): string {
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds))
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** A stable local-day key, for grouping the stream under day headers. */
function dayKey(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** A human day label: "Today" / "Yesterday" / a weekday-and-date. */
function dayLabel(unixSeconds: number): string {
  const now = Math.floor(Date.now() / 1000)
  if (dayKey(unixSeconds) === dayKey(now)) return 'Today'
  if (dayKey(unixSeconds) === dayKey(now - 86_400)) return 'Yesterday'
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/** Assign each working tree a stable colour var from the token ramp, by first-seen order. */
function makeLaneColour(): (treeRoot: string) => string {
  const index = new Map<string, number>()
  return (treeRoot) => {
    let i = index.get(treeRoot)
    if (i === undefined) {
      i = index.size
      index.set(treeRoot, i)
    }
    return `var(--au-git-activity-tree-${(i % 6) + 1})`
  }
}

/** Newest-first, tie-broken by oid, a total deterministic order matching the read. */
function byRecency(a: WireRecentCommit, b: WireRecentCommit): number {
  if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp
  return a.commit < b.commit ? 1 : a.commit > b.commit ? -1 : 0
}

/** The one-glyph mark for a change status. */
function statusGlyph(status: WireChangedFile['status']): string {
  switch (status) {
    case 'added':
      return '+'
    case 'deleted':
      return '−'
    case 'renamed':
      return '→'
    default:
      return '~'
  }
}

/** Absolute path of a changed file: the owning tree root joined with the tree-relative path. */
function absolutePath(treeRoot: string, filePath: string): string {
  return `${treeRoot.replace(/\/+$/, '')}/${filePath}`
}

function mount(container: HTMLElement, host: MountHost): () => void {
  let alive = true

  const root = document.createElement('section')
  root.className = 'au-git-activity'
  container.appendChild(root)

  const head = document.createElement('div')
  head.className = 'au-git-activity-head'
  const title = document.createElement('span')
  title.className = 'au-git-activity-title'
  title.textContent = 'Activity'
  head.appendChild(title)
  const toggle = document.createElement('button')
  toggle.className = 'au-git-activity-toggle'
  toggle.hidden = true
  toggle.addEventListener('click', () => {
    collapsed = !collapsed
    render()
  })
  head.appendChild(toggle)
  root.appendChild(head)

  const filterBar = document.createElement('div')
  filterBar.className = 'au-git-activity-filter'
  filterBar.hidden = true
  root.appendChild(filterBar)

  const list = document.createElement('div')
  list.className = 'au-git-activity-list'
  root.appendChild(list)

  const disposeStyles = host.styles?.inject(STYLE, container)
  const laneColour = makeLaneColour()

  // The client-owned append-only window: an oid-keyed set for dedup, plus the ordered rows.
  const seen = new Set<string>()
  let commits: WireRecentCommit[] = []
  const justAdded = new Set<string>()

  // Expand-to-detail state: which entry ids have their panel open, plus a lazy cache of full commit
  // message bodies (the row carries only the subject; the body is a commit_meta join).
  const expanded = new Set<string>()
  const bodyCache = new Map<string, string>()
  const bodyPending = new Set<string>()

  // Controls state. `hiddenTrees` is a view filter (a user preference, survives a re-seed).
  // `collapsed` merges the per-repo lanes into one. `windowCap` grows as older history is paged.
  const hiddenTrees = new Set<string>()
  let collapsed = false
  let windowCap = WINDOW
  let exhausted = false
  let loadingMore = false

  // The visible lanes (working trees) in first-seen order, recomputed each render.
  let lanes: string[] = []

  function showEmpty(message: string): void {
    list.replaceChildren()
    const empty = document.createElement('div')
    empty.className = 'au-git-activity-empty'
    empty.textContent = message
    list.appendChild(empty)
  }

  /** Merge incoming commits into the window: dedup by oid, re-sort, trim the tail. */
  function merge(incoming: WireRecentCommit[], seeded: boolean): void {
    for (const c of incoming) {
      if (seen.has(c.commit)) continue
      seen.add(c.commit)
      commits.push(c)
      if (!seeded) justAdded.add(c.commit)
    }
    commits.sort(byRecency)
    if (commits.length > windowCap) {
      for (const c of commits.splice(windowCap)) seen.delete(c.commit)
    }
  }

  /** Page older history: raise the cap and re-read a larger newest-N window, merging the older tail. */
  async function loadMore(): Promise<void> {
    if (loadingMore || exhausted) return
    loadingMore = true
    render()
    const target = commits.length + PAGE
    windowCap = Math.max(windowCap, target + PAGE)
    try {
      const outcome = await readRecentCommits(host.engine, { limit: target })
      if (!alive) return
      if ('ready' in outcome && outcome.ready) {
        const before = commits.length
        merge(outcome.result, true)
        if (commits.length === before) exhausted = true
      }
    } catch {
      // leave exhausted false, the user can retry
    } finally {
      loadingMore = false
      if (alive) render()
    }
  }

  /** Lazily fetch a commit's full message body, cache it, re-render when it lands. */
  function ensureBody(commit: WireRecentCommit): void {
    if (bodyCache.has(commit.commit) || bodyPending.has(commit.commit)) return
    bodyPending.add(commit.commit)
    void readCommitMeta(host.engine, [{ commit: commit.commit, repo: commit.members[0] }])
      .then((outcome) => {
        if (!alive) return
        bodyPending.delete(commit.commit)
        const record = 'ready' in outcome && outcome.ready ? outcome.result[0] : undefined
        bodyCache.set(commit.commit, record?.message ?? commit.subject)
        render()
      })
      .catch(() => {
        if (!alive) return
        bodyPending.delete(commit.commit)
      })
  }

  /** True when any of an entry's constituent commits arrived on the last change event. */
  function isNewEntry(entry: ActivityEntry): boolean {
    for (const c of entry.commits) if (justAdded.has(c.commit)) return true
    return false
  }

  /** The rail gutter cell: continuous lane lines, plus a dot on each lane this entry touched. */
  function renderRail(entry: ActivityEntry): HTMLElement {
    const rail = document.createElement('span')
    rail.className = 'au-git-activity-rail'
    const cols = collapsed ? 1 : Math.max(lanes.length, 1)
    rail.style.width = `${cols * LANE_W}px`

    for (let i = 0; i < cols; i++) {
      const line = document.createElement('span')
      line.className = 'au-git-activity-rail-line'
      line.style.left = `${i * LANE_W + LANE_W / 2}px`
      line.style.background = collapsed ? 'var(--au-line-3)' : laneColour(lanes[i])
      rail.appendChild(line)
    }

    const dotTrees = collapsed
      ? entry.trees.slice(0, 1)
      : entry.trees.filter((t) => lanes.includes(t))
    for (const t of dotTrees) {
      const col = collapsed ? 0 : lanes.indexOf(t)
      const dot = document.createElement('span')
      dot.className = entry.outOfBand ? 'au-git-activity-dot au-git-activity-dot--hollow' : 'au-git-activity-dot'
      dot.style.left = `${col * LANE_W + LANE_W / 2}px`
      dot.style.setProperty('--au-git-activity-tree', laneColour(t))
      rail.appendChild(dot)
    }
    return rail
  }

  function renderEntry(entry: ActivityEntry): HTMLElement {
    const row = document.createElement('div')
    row.className = 'au-git-activity-row'
    if (isNewEntry(entry)) row.classList.add('au-git-activity-row--new')

    row.appendChild(renderRail(entry))

    const subject = document.createElement('span')
    subject.className = 'au-git-activity-subject'
    subject.textContent = entry.subject
    subject.title = entry.subject
    row.appendChild(subject)

    const meta = document.createElement('span')
    meta.className = 'au-git-activity-meta'
    const parts: string[] = []
    if (entry.changedFileCount > 0) {
      parts.push(`${entry.changedFileCount} file${entry.changedFileCount === 1 ? '' : 's'}`)
    }
    if (entry.commits.length > 1) parts.push(`${entry.commits.length} commits`)
    parts.push(relTime(entry.timestamp))
    meta.textContent = parts.join(' · ')
    row.appendChild(meta)

    // The row toggles its detail panel. The panel is a sibling, not nested, so a file-open click
    // inside it never bubbles into a toggle.
    row.addEventListener('click', () => {
      if (expanded.has(entry.id)) expanded.delete(entry.id)
      else expanded.add(entry.id)
      render()
    })

    const wrapper = document.createElement('div')
    wrapper.appendChild(row)
    if (expanded.has(entry.id)) wrapper.appendChild(renderPanel(entry))
    return wrapper
  }

  /** The expanded detail: each constituent commit's repo, full body, changed files, then trailers. */
  function renderPanel(entry: ActivityEntry): HTMLElement {
    const panel = document.createElement('div')
    panel.className = 'au-git-activity-panel'

    for (const c of entry.commits) {
      const commitEl = document.createElement('div')
      commitEl.className = 'au-git-activity-commit'

      const cHead = document.createElement('div')
      cHead.className = 'au-git-activity-commit-head'
      cHead.textContent = `${c.commit.slice(0, 7)}  ${shortTree(c.tree)}  ·  ${relTime(c.timestamp)}`
      commitEl.appendChild(cHead)

      ensureBody(c)
      const body = bodyCache.get(c.commit) ?? c.subject
      if (body.trim().length > 0) {
        const bodyEl = document.createElement('div')
        bodyEl.className = 'au-git-activity-body'
        bodyEl.textContent = body
        commitEl.appendChild(bodyEl)
      }

      for (const f of c.changed_files) {
        const fileEl = document.createElement('div')
        fileEl.className = 'au-git-activity-file'
        fileEl.title = `Open ${f.path}`

        const st = document.createElement('span')
        st.className = 'au-git-activity-file-status'
        st.textContent = statusGlyph(f.status)
        fileEl.appendChild(st)

        const name = document.createElement('span')
        name.textContent = f.status === 'renamed' && f.from ? `${f.from} → ${f.path}` : f.path
        fileEl.appendChild(name)

        // Secondary affordance: open the changed file in the focused editor via open-intent.
        fileEl.addEventListener('click', () => {
          host.intent?.fire(openIntent(fileSelection(absolutePath(c.tree, f.path))))
        })
        commitEl.appendChild(fileEl)
      }

      panel.appendChild(commitEl)
    }

    const trailers = entry.commits[0]?.trailers ?? []
    if (trailers.length > 0) {
      const tEl = document.createElement('div')
      tEl.className = 'au-git-activity-trailers'
      tEl.textContent = trailers.map((t) => `${t.key}: ${t.value}`).join('\n')
      panel.appendChild(tEl)
    }

    return panel
  }

  /** Rebuild the tree filter chips from the distinct trees in the window (first-seen order). */
  function renderFilter(allTrees: string[]): void {
    filterBar.hidden = allTrees.length < 2
    if (filterBar.hidden) return
    const frag = document.createDocumentFragment()
    for (const t of allTrees) {
      const chip = document.createElement('button')
      chip.className = 'au-git-activity-chip'
      if (hiddenTrees.has(t)) chip.classList.add('au-git-activity-chip--off')
      const dot = document.createElement('span')
      dot.className = 'au-git-activity-chip-dot'
      dot.style.setProperty('--au-git-activity-tree', laneColour(t))
      chip.appendChild(dot)
      chip.appendChild(document.createTextNode(shortTree(t)))
      chip.addEventListener('click', () => {
        if (hiddenTrees.has(t)) hiddenTrees.delete(t)
        else hiddenTrees.add(t)
        render()
      })
      frag.appendChild(chip)
    }
    filterBar.replaceChildren(frag)
  }

  /** Distinct trees across commits, in first-seen (newest-first) order. */
  function distinctTrees(rows: WireRecentCommit[]): string[] {
    const out: string[] = []
    const seenT = new Set<string>()
    for (const c of rows) {
      if (!seenT.has(c.tree)) {
        seenT.add(c.tree)
        out.push(c.tree)
      }
    }
    return out
  }

  function render(): void {
    const allTrees = distinctTrees(commits)
    renderFilter(allTrees)

    // The lane order is the visible (unhidden) trees; the collapse toggle only matters past one.
    lanes = allTrees.filter((t) => !hiddenTrees.has(t))
    toggle.hidden = lanes.length < 2
    toggle.textContent = collapsed ? 'lanes' : 'merge'

    if (commits.length === 0) {
      showEmpty('No recent activity across the mounted repos.')
      return
    }
    const shown = hiddenTrees.size === 0 ? commits : commits.filter((c) => !hiddenTrees.has(c.tree))
    const entries = groupActivity(shown)

    const frag = document.createDocumentFragment()
    let lastDay = ''
    for (const entry of entries) {
      const key = dayKey(entry.timestamp)
      if (key !== lastDay) {
        lastDay = key
        const day = document.createElement('div')
        day.className = 'au-git-activity-day'
        day.textContent = dayLabel(entry.timestamp)
        frag.appendChild(day)
      }
      frag.appendChild(renderEntry(entry))
    }
    if (entries.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'au-git-activity-empty'
      empty.textContent = 'No activity in the selected repos.'
      frag.appendChild(empty)
    }
    if (!exhausted) {
      const more = document.createElement('button')
      more.className = 'au-git-activity-toggle'
      more.style.margin = 'var(--au-space-1) var(--au-space-2)'
      more.textContent = loadingMore ? 'Loading…' : 'Load older'
      more.disabled = loadingMore
      more.addEventListener('click', () => void loadMore())
      frag.appendChild(more)
    }
    list.replaceChildren(frag)
    justAdded.clear()
  }

  // The live subscription. Torn down and re-opened on a daemon reconnect, so a fresh reflog
  // watcher arms over the CURRENT tree set. `subscribeRecentCommits` emits the seed page as
  // `initial-value`, then `commits-appeared` change events carrying new commits in `scopeHint`.
  let unsubscribe: (() => void) | undefined
  function open(): void {
    unsubscribe?.()
    seen.clear()
    commits = []
    justAdded.clear()
    windowCap = WINDOW
    exhausted = false
    loadingMore = false
    showEmpty('Loading activity…')
    unsubscribe = subscribeRecentCommits(
      host.engine,
      (event) => {
        if (!alive) return
        if (event.kind === 'initial-value') {
          merge(event.result, true)
          render()
        } else if (event.kind === 'change') {
          merge(event.scopeHint.commits, false)
          render()
        } else if (event.kind === 'closed') {
          if (commits.length === 0) showEmpty('Activity stream disconnected.')
        }
      },
      { limit: SEED_LIMIT },
    )
  }

  open()

  // Recover on a daemon reconnect: re-open the subscription so its reflog watcher re-arms over the
  // current member set. A member mounted mid-subscription without a reconnect is a known engine
  // limitation (the watcher does not re-arm), tracked upstream.
  const offReady = host.engineReady?.subscribe((ready) => {
    if (ready && alive) open()
  })

  return () => {
    alive = false
    offReady?.()
    unsubscribe?.()
    disposeStyles?.()
    container.replaceChildren()
  }
}

export default defineProjection<ProjectionModule>({ mount })
