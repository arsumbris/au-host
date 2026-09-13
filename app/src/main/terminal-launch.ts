import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { TerminalPromptPreset } from '@arsumbris/au-host-sdk'
import { promptLaunch } from './terminal-prompts/launch'

/** Startup commands are scripts, never terminal input. The shell reads its interactive
 * configuration before executing the script. zsh/bash retain the interactive shell
 * after the command, including when the command uses exec or exit. */
export function terminalLaunch(shell: string, prompt?: TerminalPromptPreset, command?: string, inherited = process.env) {
  let startup = promptLaunch(shell, prompt, inherited)
  if (!command) return startup
  let directory: string | undefined
  try {
    const kind = basename(shell).toLowerCase().replace(/\.exe$/, '')
    const powershell = kind === 'powershell' || kind === 'pwsh'
    if (!powershell && !['zsh', 'bash', 'sh', 'dash', 'ksh', 'fish'].includes(kind)) {
      throw new Error(`Startup commands are not supported for shell "${kind}"`)
    }
    directory = mkdtempSync(join(tmpdir(), 'au-terminal-command-'))
    const file = join(directory, powershell ? 'launch.ps1' : 'launch.sh')
    writeFileSync(file, command + '\n', { mode: 0o600 })
    if (kind === 'zsh' || kind === 'bash') {
      startup.dispose()
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
      // A subshell isolates exec/exit without re-running interactive configuration.
      startup = promptLaunch(shell, prompt, inherited, `( source ${quote(file)} )`)
    }
    const args = powershell
      ? [...startup.args, '-NoExit', '-File', file]
      : kind === 'zsh' || kind === 'bash'
        ? startup.args
        : [...startup.args, ...(startup.args.includes('-i') ? [] : ['-i']), file]
    const ownedDirectory = directory
    return { args, env: startup.env, dispose() {
      startup.dispose()
      rmSync(ownedDirectory, { recursive: true, force: true })
    } }
  } catch (error) {
    startup.dispose()
    if (directory) rmSync(directory, { recursive: true, force: true })
    throw error
  }
}
