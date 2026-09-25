// A writer that could not read its file never rewrites it from nothing. Only a MISSING file reads as a
// first run; one that exists but cannot be read (here: a directory at its path, EISDIR) or does not parse
// is refused (the device registry, paths.yaml) or moved aside first (recents).

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { scaffoldEntry } from '../src/main/gate-create'
import { readLocalFile } from '../src/main/local-file-read'
import { pathsFile, saveToolPaths } from '../src/main/tool-paths'
import { listWorkspaces, recentsFile, touchWorkspace } from '../src/main/host-recents'

let home: string
let hostDir: string
const prev = { home: process.env.HOME, hostDir: process.env.AU_HOST_DEVICE_DIR }
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'au-home-'))
  hostDir = mkdtempSync(path.join(tmpdir(), 'au-hostdir-'))
  process.env.HOME = home
  process.env.AU_HOST_DEVICE_DIR = hostDir
})
afterEach(() => {
  for (const [key, value] of [['HOME', prev.home], ['AU_HOST_DEVICE_DIR', prev.hostDir]] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(home, { recursive: true, force: true })
  rmSync(hostDir, { recursive: true, force: true })
})

const registry = (): string => path.join(home, '.arsumbris', 'au-engine', 'config', 'repos.yaml')
const put = (file: string, text: string): void => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}

describe('readLocalFile', () => {
  it('tells absent, found and failed apart', () => {
    const file = path.join(home, 'x.yaml')
    expect(readLocalFile(file, (t) => t).state).toBe('absent')
    put(file, 'ok')
    expect(readLocalFile(file, (t) => t)).toEqual({ state: 'found', value: 'ok' })
    expect(readLocalFile(file, () => { throw new Error('bad shape') }).state).toBe('failed')
    rmSync(file)
    mkdirSync(file)
    expect(readLocalFile(file, (t) => t).state).toBe('failed')
  })
})

describe('the device registry', () => {
  it('an unparsable registry is left untouched and the registration fails with the reason', () => {
    put(registry(), 'repos: {not: a list}\n')
    const dir = path.join(home, 'ws')
    mkdirSync(dir)
    const res = scaffoldEntry(dir, 'ws')
    expect(res.ok).toBe(false)
    expect(res.ok ? '' : res.error).toContain('left untouched')
    expect(readFileSync(registry(), 'utf8')).toBe('repos: {not: a list}\n')
  })

  it('a readable registry keeps its other entries and keys', () => {
    put(registry(), 'type: au.engine.repos::au-engine\nrepos:\n  - name: lib\n    path: /somewhere/lib\n')
    const dir = path.join(home, 'ws')
    mkdirSync(dir)
    expect(scaffoldEntry(dir, 'ws').ok).toBe(true)
    const text = readFileSync(registry(), 'utf8')
    expect(text).toContain('type: au.engine.repos::au-engine')
    expect(text).toContain('name: lib')
    expect(text).toContain('name: ws')
  })
})

describe('paths.yaml', () => {
  it('an unreadable file refuses the save and stays as it was', () => {
    put(pathsFile(), '- a list, not a mapping\n')
    expect(() => saveToolPaths({ au: '/bin/au' })).toThrow(/left untouched/)
    expect(readFileSync(pathsFile(), 'utf8')).toBe('- a list, not a mapping\n')
  })

  it('a missing file saves fresh', () => {
    saveToolPaths({ au: '/bin/au' })
    expect(readFileSync(pathsFile(), 'utf8')).toContain('au: /bin/au')
  })
})

describe('recents', () => {
  it('an unreadable file is moved aside before the next write', () => {
    mkdirSync(recentsFile(), { recursive: true })
    writeFileSync(path.join(recentsFile(), 'marker'), 'kept')
    expect(listWorkspaces()).toEqual([])
    const aside = readdirSync(path.dirname(recentsFile())).find((n) => n.startsWith(`${path.basename(recentsFile())}.corrupt-`))
    expect(aside).toBeDefined()
    expect(readFileSync(path.join(path.dirname(recentsFile()), aside!, 'marker'), 'utf8')).toBe('kept')
    touchWorkspace({ root: '/w' })
    expect(existsSync(recentsFile())).toBe(true)
  })

  it('an empty file is simply no recents', () => {
    put(recentsFile(), '')
    expect(listWorkspaces()).toEqual([])
    expect(readdirSync(path.dirname(recentsFile())).some((n) => n.includes('.corrupt-'))).toBe(false)
  })
})
