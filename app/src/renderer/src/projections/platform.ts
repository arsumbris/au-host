// Renderer-side platform check, shared by every window (the main window and every floated surface), so
// each reserves the macOS traffic-light gap in its shared `<au-pane-header>` shell consistently. `platform`
// rides the preload bridge; the userAgent is the fallback if the bridge is not yet present.
export function isMacRenderer(): boolean {
  return window.main?.platform === 'darwin' || navigator.userAgent.includes('Macintosh')
}
