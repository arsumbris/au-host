import type { McpControl } from '@arsumbris/au-host-app'

type Input = HTMLElement & {value:string; disabled:boolean}
type Button = HTMLElement & {disabled:boolean; loading:boolean}

/** Device-scoped CLI location, edited through the host's existing partial-patch capability. */
export function mountMcpConfiguration(container: HTMLElement, mcp: McpControl): {dispose:()=>void; missingPath:()=>boolean; refresh:()=>Promise<void>} {
  let alive = true, busy = false, loaded = false, saved = '', suggested = ''
  const explanation = document.createElement('p')
  explanation.className = 'au-daemon-hint'
  explanation.textContent = 'The MCP CLI entry file is a device setting shared by all workspaces. Changes apply on the next MCP start.'
  const field = document.createElement('au-field')
  field.setAttribute('label', 'MCP CLI entry file')
  field.setAttribute('hint', 'Enter the installed CLI script path. Saving does not start the service.')
  const input = document.createElement('au-input') as Input
  input.setAttribute('label', 'MCP CLI entry file')
  input.setAttribute('placeholder', 'Path to the MCP CLI entry file…')
  input.setAttribute('spellcheck', 'false')
  input.disabled = true
  field.append(input)
  const actions = document.createElement('div')
  actions.className = 'au-daemon-config-actions'
  function button(label: string, variant='outline'): Button {
    const el = document.createElement('au-button') as Button
    el.textContent = label
    el.setAttribute('variant', variant)
    el.setAttribute('size', 'sm')
    actions.append(el)
    return el
  }
  const save = button('Save path')
  const cancel = button('Cancel', 'ghost')
  const useSuggested = button('Use suggested path', 'ghost')
  useSuggested.hidden = true
  const retry = button('Retry loading', 'ghost')
  retry.hidden = true
  retry.addEventListener('au-activate', () => void load())
  const feedback = document.createElement('p')
  feedback.className = 'au-daemon-config-feedback'
  feedback.setAttribute('role', 'status')
  const source = document.createElement('p')
  source.className = 'au-daemon-config-source'
  container.append(explanation, field, actions, feedback, source)
  function controls(): void {
    input.disabled = busy || !loaded
    save.disabled = busy || !loaded || input.value.trim() === saved
    cancel.disabled = busy || !loaded || input.value === saved
    useSuggested.disabled = busy || !loaded
  }
  function clearFeedback(): void { feedback.textContent = ''; feedback.removeAttribute('data-error'); input.removeAttribute('error') }
  input.addEventListener('au-input', () => { clearFeedback(); controls() })
  cancel.addEventListener('au-activate', () => { input.value = saved; clearFeedback(); feedback.textContent = 'Unsaved changes discarded.'; controls() })
  useSuggested.addEventListener('au-activate', () => { input.value = suggested; clearFeedback(); feedback.textContent = 'Suggested path filled. Save to apply it.'; controls() })
  save.addEventListener('au-activate', () => void persist())
  async function persist(): Promise<void> {
    if (busy || !loaded || !mcp.saveToolPaths) return
    const value = input.value.trim()
    busy = true; save.loading = true; clearFeedback(); controls()
    try {
      if (value && mcp.pathExists && !await mcp.pathExists(value)) {
        input.setAttribute('error', '')
        throw new Error('This path does not exist. Check the CLI entry file location.')
      }
      await mcp.saveToolPaths({auMcp:value})
      if (!alive) return
      saved = value; input.value = value
      feedback.textContent = value ? 'MCP path saved. Start the service when ready.' : 'MCP path cleared. Set a path before starting the service.'
    } catch (error) {
      if (alive) { feedback.setAttribute('data-error', ''); feedback.textContent = error instanceof Error ? error.message : String(error) }
    } finally {
      busy = false
      if (alive) { save.loading = false; controls() }
    }
  }
  async function load(): Promise<void> {
    if (busy) return
    busy = true; retry.hidden = true; clearFeedback(); controls()
    feedback.textContent = 'Loading MCP configuration…'
    try {
      if (!mcp.toolPaths || !mcp.saveToolPaths) throw new Error('This host does not expose MCP path settings.')
      const info = await mcp.toolPaths()
      if (!alive) return
      saved = info.paths.auMcp ?? ''; suggested = info.suggested.auMcp
      input.value = saved; source.textContent = info.file
      useSuggested.hidden = !suggested
      loaded = true
      feedback.textContent = info.problem ?? (saved ? '' : 'No MCP CLI path is configured.')
    } catch (error) {
      if (alive) { feedback.setAttribute('data-error', ''); feedback.textContent = error instanceof Error ? error.message : String(error) }
    } finally { busy = false; if (alive) { retry.hidden = loaded; controls() } }
  }
  controls(); void load()
  return {
    dispose:()=>{alive=false},
    missingPath:()=>loaded&&!saved,
    refresh:async()=>{
      if (busy || (loaded && input.value !== saved)) return
      await load()
    },
  }
}
