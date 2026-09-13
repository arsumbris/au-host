import * as fs from 'node:fs'
import * as path from 'node:path'
import { hostConfigDir } from './device-paths'
import type { TerminalPreferences } from '@arsumbris/au-host-app'

export const terminalDefaults: TerminalPreferences = {
  shell: '',
  prompt: 'clean',
  scrollback: 10000,
  cursorStyle: 'bar',
  cursorBlink: true,
}
const file = () => path.join(hostConfigDir(), 'terminal.json')
export function validateTerminalPreferences(
  value: unknown,
): TerminalPreferences {
  if (!value || typeof value !== 'object')
    throw Error('Terminal settings must be an object')
  const p = value as TerminalPreferences
  if (typeof p.shell !== 'string' || p.shell.includes('\0'))
    throw Error('Invalid shell path')
  if (
    !['inherit', 'raw', 'minimal', 'compact-git', 'clean', 'context'].includes(
      p.prompt,
    )
  )
    throw Error('Invalid prompt preset')
  if (
    !Number.isInteger(p.scrollback) ||
    p.scrollback < 0 ||
    p.scrollback > 100000
  )
    throw Error('Scrollback must be between 0 and 100000 lines')
  if (
    !['bar', 'block', 'underline'].includes(p.cursorStyle) ||
    typeof p.cursorBlink !== 'boolean'
  )
    throw Error('Invalid cursor settings')
  return {
    shell: p.shell.trim(),
    prompt: p.prompt,
    scrollback: p.scrollback,
    cursorStyle: p.cursorStyle,
    cursorBlink: p.cursorBlink,
  }
}
export function readTerminalPreferences(): TerminalPreferences {
  try {
    return validateTerminalPreferences(
      JSON.parse(fs.readFileSync(file(), 'utf8')),
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { ...terminalDefaults }
    throw error
  }
}
export function saveTerminalPreferences(value: unknown): TerminalPreferences {
  const next = validateTerminalPreferences(value)
  if (next.shell) {
    if (!path.isAbsolute(next.shell))
      throw Error('Use an absolute shell executable path')
    fs.accessSync(next.shell, fs.constants.X_OK)
    if (!fs.statSync(next.shell).isFile())
      throw Error('Shell must be an executable file')
  }
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  const temp = file() + '.tmp'
  fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(temp, file())
  return next
}
