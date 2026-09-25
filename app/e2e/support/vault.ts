// Per-test vaults, each its own git repository.
//
// The engine commits every write (commit-per-mutation) into the git repository enclosing the file. The
// authored fixture (`app/e2e/vault`) sits inside au-host's working tree, so a spec that saves through the
// engine would commit into au-host. Every launch therefore opens a COPY: a fresh folder under the run root,
// `git init`-ed with the fixture as its one commit. Engine writes land in that throwaway repository, and no
// test sees state another test left behind.
//
// The copies sit beside the run's local members (see local-members.ts), so the vault's deps resolve to this
// checkout's packages as co-present siblings.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { VAULT } from './paths'

/** The environment variable carrying the run root from global-setup to the test workers. */
export const RUN_ROOT_ENV = 'AU_E2E_RUN_ROOT'

/** The run root global-setup created: the parent of every per-test vault and of the local members. */
export function runRoot(): string {
  const root = process.env[RUN_ROOT_ENV]
  if (!root) throw new Error(`${RUN_ROOT_ENV} is unset; the e2e global-setup creates the run root`)
  return root
}

/** The engine's in-repo runtime state (`.arsumbris/au-engine/`), never part of the fixture. */
function isEngineRuntime(path: string): boolean {
  const rel = relative(VAULT, path).split(sep)
  return rel[0] === '.arsumbris' && rel[1] === 'au-engine'
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr || result.error?.message}`)
}

/** Copy the authored vault into a fresh folder under the run root and commit it as the repository's root
 *  commit, so the engine's clean-at-HEAD gate accepts writes and commits them there. */
export function freshVault(): string {
  const dir = mkdtempSync(join(runRoot(), 'vault-'))
  cpSync(VAULT, dir, { recursive: true, filter: (source) => !isEngineRuntime(source) })
  git(dir, ['init', '--quiet', '--initial-branch=main'])
  // A repository-local identity, so the engine's commits work where no global one is configured (CI).
  git(dir, ['config', 'user.name', 'au-host e2e'])
  git(dir, ['config', 'user.email', 'e2e@au-host.invalid'])
  git(dir, ['add', '--all'])
  git(dir, ['commit', '--quiet', '--message', 'e2e vault fixture'])
  return dir
}

/** Remove a per-test vault. */
export function removeVault(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
