// A keymap's references, rewritten for the repo a copy of it lands in.
//
// A bare name resolves in the repo of the file it is written in; `name::repo` resolves in `repo`. So a
// file copied from repo `from` into repo `to` keeps its meaning only if each reference is rewritten for
// `to`: a bare name becomes `name::from` (it stays bare when `to` owns it), `name::to` becomes bare, and a
// third repo's qualifier is kept. A commit pin (`::repo@commit`) travels with its repo.

import { isScalar, isSeq, parseDocument, type Document } from 'yaml'
import type { MountHost } from '@arsumbris/au-host-sdk'

/** One reference target (`name`, `name::repo`, `name::repo@commit`, plus any `#` / `^` / `:` tail) as it
 *  must be written in a file of repo `to`, having been written in a file of repo `from`. */
export function requalifyTarget(target: string, from: string, to: string): string {
  const m = /^([^:#^]+)(?:::([^@#^:]*)(@[^#^:]*)?)?(.*)$/.exec(target.trim())
  if (!m) return target
  const [, name, repo, pin = '', tail] = m
  const owner = repo || from
  const written = owner === to ? '' : owner
  return `${name}${written || pin ? `::${written}${pin}` : ''}${tail}`
}

/** A reference VALUE: a whole `[[...]]` wikilink, or a bare type name (a `type:` claim). Anything else,
 *  including prose carrying a link, is not a reference position and is returned unchanged. */
function requalifyValue(value: string, from: string, to: string, allowBareName: boolean): string {
  const link = /^\s*\[\[([^\]]+)\]\]\s*$/.exec(value)
  if (link) return `[[${requalifyTarget(link[1], from, to)}]]`
  return allowBareName && /^[A-Za-z][\w.-]*(::[\w.@-]*)?$/.test(value.trim()) ? requalifyTarget(value, from, to) : value
}

/** Rewrite a scalar, or each scalar of a sequence, at `path` in place. Formatting and comments stay. */
function rewriteAt(doc: Document, path: (string | number)[], rewrite: (v: string) => string): void {
  const node = doc.getIn(path, true)
  const scalars = isSeq(node) ? node.items : [node]
  for (const item of scalars) if (isScalar(item) && typeof item.value === 'string') item.value = rewrite(item.value)
}

/**
 * Rewrite every reference position a keymap declares for a copy from repo `from` into repo `to`:
 * the `type:` claim, the keymap's `when:` scope, and each keybind's `intent` and `when`.
 */
export function requalifyKeymap(doc: Document, from: string, to: string): void {
  if (from === to) return
  rewriteAt(doc, ['type'], (v) => requalifyValue(v, from, to, true))
  rewriteAt(doc, ['when'], (v) => requalifyValue(v, from, to, false))
  const binds = doc.getIn(['keybinds'], true)
  if (!isSeq(binds)) return
  binds.items.forEach((_, i) => {
    rewriteAt(doc, ['keybinds', i, 'intent'], (v) => requalifyValue(v, from, to, false))
    rewriteAt(doc, ['keybinds', i, 'when'], (v) => requalifyValue(v, from, to, false))
  })
}

/**
 * Copy a keymap from repo `from` into a new file of repo `to`, its references rewritten so each names the
 * same type there. The caller picks a `dest` that does not exist yet.
 *
 * STANDIN [[message - 260923150517 - a copy verb that requalifies references across repos::au-engine]]:
 * the engine knows every reference position from its own parse and owns rewriting them; until its copy
 * verb exists this rewrites the positions a keymap declares. Swap the body for the engine copy.
 */
export async function copyIntoRepo(
  files: MountHost['files'],
  source: string,
  dest: string,
  from: string,
  to: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cur = await files.read(source)
  if (!cur.ok || typeof cur.content !== 'string') return { ok: false, error: 'Could not read the shared keymap to copy it.' }
  const doc = parseDocument(cur.content)
  if (doc.errors.length) return { ok: false, error: 'The shared keymap contains invalid YAML, so it cannot be copied.' }
  requalifyKeymap(doc, from, to)
  const res = await files.write(dest, doc.toString())
  return res.ok ? { ok: true } : { ok: false, error: `copy failed: ${res.error ?? 'unknown'}` }
}
