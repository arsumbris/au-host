// Reading a local file this process may later rewrite. Three answers, never collapsed:
//  - FOUND: it exists and parsed.
//  - ABSENT: it does not exist (`ENOENT`), the only case that may read as a first run.
//  - FAILED: it exists but could not be read, or its content does not parse into the expected shape.
// A writer that read FAILED must not write as if it had read nothing: that would overwrite data it could
// not see. It either refuses, or moves the file aside first.

import * as fs from 'node:fs'

export type LocalRead<T> = { state: 'found'; value: T } | { state: 'absent' } | { state: 'failed'; cause: string }

/** Read `file` and `parse` its text. `parse` throws for content that is not the expected shape. */
export function readLocalFile<T>(file: string, parse: (text: string) => T): LocalRead<T> {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' }
    return { state: 'failed', cause: String(err) }
  }
  try {
    return { state: 'found', value: parse(text) }
  } catch (err) {
    return { state: 'failed', cause: String(err) }
  }
}

/** Move an unusable file aside to `<file>.corrupt-<ms>`. Returns the new path, or undefined if it will not move. */
export function moveAside(file: string): string | undefined {
  const aside = `${file}.corrupt-${Date.now()}`
  try {
    fs.renameSync(file, aside)
    return aside
  } catch {
    return undefined
  }
}
