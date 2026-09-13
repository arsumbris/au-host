import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { TerminalPromptPreset } from '@arsumbris/au-host-sdk'
import zshPrompt from './prompt.zsh?raw'
import bashPrompt from './prompt.bash?raw'

/** Private startup adapters preserve user configuration and only replace prompt presentation. */
export function promptLaunch(shell: string, preset: TerminalPromptPreset = 'clean', inherited: NodeJS.ProcessEnv = process.env, afterInit = '') {
  const env = { ...inherited }
  const kind = basename(shell)
  if ((preset === 'inherit' && !afterInit) || !['zsh', 'bash'].includes(kind)) return { args: [] as string[], env, dispose() {} }
  if (!['inherit', 'raw', 'minimal', 'compact-git', 'clean', 'context'].includes(preset)) throw new Error('Unknown terminal prompt preset')
  const directory = mkdtempSync(join(tmpdir(), 'au-terminal-'))
  const write = (file: string, text: string) => writeFileSync(join(directory, file), text, { mode: 0o600 })
  env.AU_PROMPT_PRESET = preset
  try {
    if (kind === 'zsh') {
      env.AU_PROMPT_USER_ZDOTDIR = env.ZDOTDIR ?? env.HOME ?? ''
      env.AU_PROMPT_DIRECTORY = directory
      env.ZDOTDIR = directory
      write('.zshenv', `ZDOTDIR=$AU_PROMPT_USER_ZDOTDIR
[[ -r $ZDOTDIR/.zshenv ]] && source "$ZDOTDIR/.zshenv"
AU_PROMPT_USER_ZDOTDIR=$ZDOTDIR
ZDOTDIR=$AU_PROMPT_DIRECTORY
`)
      write('.zshrc', `ZDOTDIR=$AU_PROMPT_USER_ZDOTDIR
[[ -r $ZDOTDIR/.zshrc ]] && source "$ZDOTDIR/.zshrc"
${preset === 'inherit' ? '' : 'source "$AU_PROMPT_DIRECTORY/prompt.zsh"'}
unset AU_PROMPT_USER_ZDOTDIR AU_PROMPT_DIRECTORY
${afterInit}
`)
      write('prompt.zsh', zshPrompt)
      return { args: ['-i'], env, dispose: () => rmSync(directory, { recursive: true, force: true }) }
    }
    write('init.bash', `[[ -r $HOME/.bashrc ]] && source "$HOME/.bashrc"\n${preset === 'inherit' ? '' : bashPrompt}\n${afterInit}\n`)
    return { args: ['--rcfile', join(directory, 'init.bash'), '-i'], env, dispose: () => rmSync(directory, { recursive: true, force: true }) }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}
