// The application menu — installed once at startup so the host controls its native accelerators instead of
// inheriting Electron's default menu.
//
// WHY THIS EXISTS: the default menu binds ⌘W (Window →
// Close) and ⌘Q (App → Quit) as native accelerators that bypass the host's keybind/close lifecycle. This menu
// keeps every standard role EXCEPT those two accelerators:
//   - ⌘W is NOT bound anywhere, so it is purely the host keybind (bound → close the focused pane; unbound →
//     inert), and NEVER a native OS-window close. There is no "Close Window" menu item.
//   - Quit stays available (a real menu item, so the app is never unquittable) but carries NO ⌘Q accelerator,
//     so a fat-finger ⌘Q cannot silently discard unsaved work. Deliberate quit is a menu click.
// Whole-window close and quit do not run this per-pane consensus guard.
//
// The full standard Edit menu roles are KEPT so ⌘C/⌘V/⌘X/⌘A/⌘Z keep working in text inputs (CodeMirror, the
// palette field, rename fields) on macOS — those accelerators come from these menu roles, so dropping the menu
// would break copy/paste. Same reason the keybind gate never blanket-suppresses.

import { app, Menu, type MenuItemConstructorOptions } from 'electron'

/** Build + install the application menu. Call once, after `app.whenReady()`. */
export function installApplicationMenu(): void {
  const isMac = process.platform === 'darwin'

  // A Quit item WITHOUT the ⌘Q accelerator: quitting stays possible (never an unquittable app), but only as a
  // deliberate menu click, so ⌘Q cannot fat-finger-discard unsaved work. A custom click (not `role: 'quit'`)
  // so no default accelerator is attached.
  const quitItem: MenuItemConstructorOptions = { label: `Quit ${app.name}`, click: () => app.quit() }

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac
        ? ([{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }] as MenuItemConstructorOptions[])
        : ([{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }] as MenuItemConstructorOptions[])),
    ],
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  }

  // The Window menu deliberately has NO Close item — so ⌘W is never bound to an OS-window close and stays
  // free for the host keybind. Minimize / Zoom keep their standard accelerators.
  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac ? ([{ type: 'separator' }, { role: 'front' }] as MenuItemConstructorOptions[]) : []),
    ],
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            quitItem,
          ],
        }] as MenuItemConstructorOptions[])
      : []),
    editMenu,
    viewMenu,
    windowMenu,
    // On non-macOS there is no app menu, so Quit lives in a File menu (still no accelerator).
    ...(isMac ? [] : ([{ label: 'File', submenu: [quitItem] }] as MenuItemConstructorOptions[])),
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
