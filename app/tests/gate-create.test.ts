import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createWorkspace, scaffoldEntry } from '../src/main/gate-create'

const git = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

describe('gate-create git init', () => {
  let home: string
  let root: string
  const prevHome = process.env.HOME

  beforeEach(() => {
    // Isolate the device-global repos.yaml write (registerLocations resolves via $HOME at call time),
    // so a test never touches the developer's real ~/.arsumbris.
    home = mkdtempSync(path.join(tmpdir(), 'au-home-'))
    root = mkdtempSync(path.join(tmpdir(), 'au-ws-'))
    process.env.HOME = home
  })
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    rmSync(home, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  it('createWorkspace inits a git repo with ONE commit and a CLEAN tree', () => {
    const dir = path.join(root, 'my-ws')
    mkdirSync(dir)
    const res = createWorkspace(dir, 'my-ws')
    expect(res.ok).toBe(true)
    expect(existsSync(path.join(dir, '.git'))).toBe(true)
    // Requirement A: no uncommitted changes after creation.
    expect(git(dir, ['status', '--porcelain'])).toBe('')
    // Exactly one initial commit, authored by the tool identity (no dependency on the user's git config).
    expect(git(dir, ['rev-list', '--count', 'HEAD'])).toBe('1')
    expect(git(dir, ['log', '-1', '--format=%an <%ae>'])).toBe('au-host <au-host@arsumbris.ai>')
    // The scaffold is tracked, not left untracked.
    expect(git(dir, ['ls-files']).split('\n')).toEqual(
      expect.arrayContaining(['.arsumbris/repo.yaml', '.arsumbris/workspace.yaml']),
    )
  })

  it('scaffoldEntry inits git for an existing folder and its content lands in the clean initial commit', () => {
    const dir = path.join(root, 'existing')
    mkdirSync(dir)
    writeFileSync(path.join(dir, 'notes.md'), 'hello\n')
    const res = scaffoldEntry(dir, 'existing')
    expect(res.ok).toBe(true)
    expect(existsSync(path.join(dir, '.git'))).toBe(true)
    expect(git(dir, ['status', '--porcelain'])).toBe('')
    expect(git(dir, ['ls-files']).split('\n')).toEqual(expect.arrayContaining(['notes.md', '.arsumbris/repo.yaml']))
  })

  it('leaves an ALREADY-git folder untouched — no re-init, no commit into its history', () => {
    const dir = path.join(root, 'already')
    mkdirSync(dir)
    git(dir, ['init'])
    git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'base'])
    const before = git(dir, ['rev-parse', 'HEAD'])
    const res = createWorkspace(dir, 'already')
    expect(res.ok).toBe(true)
    // We never inject a commit into a user's existing repo: HEAD is unchanged, and the scaffold we wrote
    // shows as their uncommitted change to deal with, not ours.
    expect(git(dir, ['rev-parse', 'HEAD'])).toBe(before)
    expect(git(dir, ['status', '--porcelain'])).toContain('.arsumbris/')
  })
})
