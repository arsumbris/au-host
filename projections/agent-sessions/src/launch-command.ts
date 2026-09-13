import type {AgentProfileData, HostApp} from '@arsumbris/au-host-app'
import {resolveLaunch} from './model'

/** Both in-app and external launch use the adapter's existing preparation contract. */
export async function prepareProfileTerminal(host: HostApp, profile: AgentProfileData, adapter?: string): Promise<unknown> {
  const engine = await host.daemon.status()
  if (!engine.running) {
    const result = await host.daemon.start()
    if (!result.ok) throw Error(result.error ?? 'Engine could not start')
  }
  const mcp = await host.mcp.status()
  if (!mcp.running) {
    const result = await host.mcp.start()
    if (!result.ok) throw Error(result.error ?? 'MCP could not start')
  }
  if (!host.mcp.launchAgentSession) throw Error('Agent launch is unavailable in this window')
  const [skills, injects] = await Promise.all([host.mcp.skillManifest(adapter), host.mcp.injectManifest(adapter)])
  const result = await host.mcp.launchAgentSession({...await resolveLaunch(profile, skills, injects, host.engine), adapter})
  if (!result.ok || !result.pane) throw Error(result.error ?? 'No terminal was prepared')
  return result.pane
}

export async function copyTerminalCommand(pane: unknown): Promise<void> {
  const terminal = pane as {command?: unknown; cwd?: unknown}
  if (typeof terminal?.command !== 'string' || typeof terminal.cwd !== 'string')
    throw Error('This adapter did not provide an external terminal command')
  const cwd = "'" + terminal.cwd.replace(/'/g, "'\"'\"'") + "'"
  await navigator.clipboard.writeText(`cd ${cwd} && ${terminal.command}`)
}
