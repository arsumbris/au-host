// Shared OS-window framing for every host window (the main window AND every floated surface), so a
// subwindow is framed identically to the main one: on macOS the native title bar is hidden
// but the traffic lights stay, positioned into the shell's reserved top-left gap, so panes run the full
// window height and the shared `<au-pane-header>` shell owns the top chrome. Windows/Linux keep the
// native frame. ONE source for the traffic-light offset — both windows must agree, or their gaps drift.

import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'

export const TRAFFIC_LIGHT_POSITION = { x: 18, y: 11 } as const

/** The darwin frameless-with-traffic-lights options, empty off macOS. Spread into `new BrowserWindow({...})`. */
export function macFrameOptions(): BrowserWindowConstructorOptions {
  return process.platform === 'darwin'
    ? {
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: TRAFFIC_LIGHT_POSITION,
        // macOS supplies the sidebar material beneath the theme-controlled chrome; content paints its own
        // surface over it. Shared by the main window and every floated surface, so they read identically.
        vibrancy: 'sidebar',
        visualEffectState: 'followWindow',
      }
    : {}
}

/** Re-assert the traffic-light position after leave-full-screen — macOS snaps them back to the OS default
 *  corner otherwise (Electron #34507). Cheap; the symptom is baffling without it. */
export function reassertTrafficLights(win: BrowserWindow): void {
  if (process.platform !== 'darwin') return
  win.on('leave-full-screen', () => win.setWindowButtonPosition(TRAFFIC_LIGHT_POSITION))
}
