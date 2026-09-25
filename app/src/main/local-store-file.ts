// ONE JSON file a main-owned local store keeps for ONE workspace: loaded lazily, flushed debounced, written
// atomically. The host's local stores (composition drafts, view-state) each hold one of these, bound to the
// workspace entry this instance has CLAIMED, so exactly one process ever writes a given file.
//
// Atomic and durable: a flush writes `<file>.tmp-<pid>` beside the target, fsyncs it, then renames it over
// the target, so a reader never parses a half-written file and a crash never leaves an empty one.
//
// Only a MISSING file reads as empty (first run). A file that exists but cannot be read, does not parse, or
// is not a JSON object reads as empty too, but is first moved aside (`<file>.corrupt-<ms>`) so the next flush
// never overwrites data this process could not see. If it cannot be moved aside, the store stays read-only
// for this session rather than overwrite it.
//
// Best-effort: a failed read or write never throws into the host; the in-memory value stays the truth
// between flushes.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { moveAside, readLocalFile } from './local-file-read'

const FLUSH_DEBOUNCE_MS = 400

export class LocalStoreFile<T extends object> {
  private value: T | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  /** Set when an unreadable file could not be moved aside: flushing would destroy it, so nothing is written. */
  private readOnly = false

  constructor(
    readonly file: string,
    private readonly empty: () => T,
  ) {}

  /** The in-memory value, loaded from disk on first access. */
  get(): T {
    if (this.value) return this.value
    const read = readLocalFile(this.file, (text) => {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('the store is not a JSON object')
      return parsed as T
    })
    if (read.state === 'failed') return this.unreadable(read.cause)
    this.value = read.state === 'found' ? read.value : this.empty() // absent → first run.
    return this.value
  }

  /** Move an existing-but-unusable file aside and start empty; if it will not move, never overwrite it. */
  private unreadable(cause: string): T {
    const aside = moveAside(this.file)
    if (aside) {
      console.error(`[local-store] ${this.file} was unusable (${cause}); moved aside to ${aside}`)
    } else {
      this.readOnly = true
      console.error(`[local-store] ${this.file} is unusable (${cause}) and could not be moved aside; not writing it this session`)
    }
    this.value = this.empty()
    return this.value
  }

  /** Schedule a debounced flush; frequent changes coalesce into one write. */
  touch(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushNow()
    }, FLUSH_DEBOUNCE_MS)
  }

  /** Write the in-memory value now: temp file, then rename over the target. */
  flushNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (!this.value || this.readOnly) return
    const tmp = `${this.file}.tmp-${process.pid}`
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const fd = fs.openSync(tmp, 'w', 0o600)
      try {
        fs.writeSync(fd, JSON.stringify(this.value))
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      fs.renameSync(tmp, this.file)
    } catch {
      try {
        fs.unlinkSync(tmp)
      } catch {
        // Nothing was written.
      }
    }
  }
}
