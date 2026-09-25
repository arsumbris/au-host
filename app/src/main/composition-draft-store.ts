// MAIN-OWNED unsaved-composition draft store: one file per workspace,
// `~/.arsumbris/au-host/data/composition-drafts/<workspaceKey>.json`, bound to the workspace this instance has
// CLAIMED, so exactly one process writes it (see `local-store-file.ts` for the atomic write).
//
// A composition's working layout is edited in an EPHEMERAL buffer and only written to its file on an
// explicit save. Without this, a reload / reopen discards the unsaved layout. This keeps the last unsaved
// working buffer per composition path LOCAL and per-machine, so reopening the workspace
// restores the in-progress layout — the sibling of the view-state auto-store, same robustness contract.
//
// Each draft records, beside the working buffer:
//   - baselineKey: the file's NORMALIZED baseline key the draft is dirty AGAINST (what the renderer's dirty
//     check compares echoes to). Restored so the composition mounts already-dirty vs its file.
//   - fileRaw: the RAW `stableStringify` of the file composition at draft time. Compared to the file NOW to
//     detect that the saved file changed underneath the draft (git pull, edited elsewhere) — the staleness
//     the renderer resolves with an ask-dialog.
//
// BOUNDED LRU, debounced atomic flush, missing / corrupt = first-run, never errors. Per-machine, non-git, disposable.

import type { CompositionDraft } from '../shared/daemon-api'
import { workspaceStoreFile } from './device-paths'
import { LocalStoreFile } from './local-store-file'

export type { CompositionDraft }

interface Entry extends CompositionDraft {
  t: number // last-touched epoch ms — the LRU recency key.
}
// compPath -> Entry, for the ONE workspace this store is bound to.
type Store = Record<string, Entry>

const MAX_ENTRIES = 200

export class CompositionDraftStore {
  private file: LocalStoreFile<Store> | null = null

  /** Bind to the CLAIMED workspace's file. Rebinding flushes the previous one first. */
  open(entry: string): void {
    this.close()
    this.file = new LocalStoreFile<Store>(workspaceStoreFile('composition-drafts', entry), () => ({}))
  }

  /** Flush and unbind (the workspace closed, or the app quits). Unbound, reads are empty and writes drop. */
  close(): void {
    this.file?.flushNow()
    this.file = null
  }

  private evict(store: Store): void {
    const all = Object.entries(store).map(([comp, e]) => ({ comp, t: e.t }))
    if (all.length <= MAX_ENTRIES) return
    all.sort((a, b) => a.t - b.t)
    for (const e of all.slice(0, all.length - MAX_ENTRIES)) delete store[e.comp]
  }

  /** The stored draft for `comp`, or null. */
  get(comp: string): CompositionDraft | null {
    const e = this.file?.get()[comp]
    return e ? { working: e.working, baselineKey: e.baselineKey, fileRaw: e.fileRaw } : null
  }

  /** Write / replace the draft for `comp`. */
  set(comp: string, draft: CompositionDraft): void {
    if (!this.file) return
    const store = this.file.get()
    store[comp] = { ...draft, t: Date.now() }
    this.evict(store)
    this.file.touch()
  }

  /** Drop the draft for `comp` — saved, discarded, or deleted. */
  clear(comp: string): void {
    if (!this.file) return
    const store = this.file.get()
    if (!store[comp]) return
    delete store[comp]
    this.file.touch()
  }
}
