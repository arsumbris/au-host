import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { resolveOnPath, resolveDaemonBinary } from '../src/main/tool-paths'

// Resolution of the `au` engine binary: PATH-first discovery, with an explicit paths.yaml `au:`
// override winning. The macOS login-shell PATH
// tier is not exercised here (it spawns a real shell); these cover the PATH + override tiers, which
// are what an install-to-PATH and an install-script-seeded paths.yaml rely on.

const saved = { PATH: process.env.PATH, HOME: process.env.HOME }
const tmps: string[] = []
afterEach(() => {
  process.env.PATH = saved.PATH
  process.env.HOME = saved.HOME
  for (const dir of tmps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-bin-'))
  tmps.push(dir)
  return dir
}

function fakeExecutable(dir: string, name: string): string {
  const file = path.join(dir, name)
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n')
  fs.chmodSync(file, 0o755)
  return file
}

describe('resolveOnPath', () => {
  it('finds an executable on process.env.PATH and returns its absolute path', () => {
    const dir = tmpDir()
    const au = fakeExecutable(dir, 'au')
    process.env.PATH = `${dir}${path.delimiter}${saved.PATH ?? ''}`
    expect(resolveOnPath('au')).toBe(au)
  })

  it('does not treat a non-executable file as a match', () => {
    const dir = tmpDir()
    const name = `non-executable-${path.basename(dir)}`
    const plain = path.join(dir, name)
    fs.writeFileSync(plain, 'not executable')
    fs.chmodSync(plain, 0o644)
    process.env.PATH = dir
    expect(resolveOnPath(name)).toBeUndefined()
  })

  it('treats a name containing a slash as a direct path (no PATH scan)', () => {
    const dir = tmpDir()
    const au = fakeExecutable(dir, 'au')
    expect(resolveOnPath(au)).toBe(au)
    expect(resolveOnPath(path.join(dir, 'missing'))).toBeUndefined()
  })
})

describe('resolveDaemonBinary', () => {
  it('returns the explicit paths.yaml `au:` override verbatim, even when it is not on PATH', () => {
    const home = tmpDir()
    process.env.HOME = home
    const cfg = path.join(home, '.arsumbris', 'au-host', 'config')
    fs.mkdirSync(cfg, { recursive: true })
    fs.writeFileSync(path.join(cfg, 'paths.yaml'), 'au: /opt/custom/bin/au\n')
    process.env.PATH = '' // nothing discoverable — the override must still win
    expect(resolveDaemonBinary()).toBe('/opt/custom/bin/au')
  })

  it('falls back to PATH discovery when no override is set', () => {
    const home = tmpDir()
    process.env.HOME = home // an empty config dir — no paths.yaml, no override
    const binDir = tmpDir()
    const au = fakeExecutable(binDir, 'au')
    process.env.PATH = binDir
    expect(resolveDaemonBinary()).toBe(au)
  })
})
