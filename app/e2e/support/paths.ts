// Shared absolute paths for the E2E harness. Resolved from this file's location so the harness is
// portable across machines (only the au binary path is machine-derived).
import { resolve } from 'node:path'

// Playwright transpiles the e2e TS to CommonJS, so `__dirname` is available (`import.meta` is not).
const here = __dirname // app/e2e/support

/** The `app/` package root. */
export const APP_ROOT = resolve(here, '..', '..')
/** The repo root (au-host). */
export const REPO_ROOT = resolve(APP_ROOT, '..')
/** The built Electron main entry Playwright launches. */
export const MAIN_ENTRY = resolve(APP_ROOT, 'out', 'main', 'index.js')
/** The E2E test vault (a folder-repo) the app opens via AU_ENTRY. */
export const VAULT = resolve(APP_ROOT, 'e2e', 'vault')
/** The `au` daemon binary (debug build in the sibling engine repo). */
export const AU_BINARY = resolve(REPO_ROOT, '..', 'au-engine', 'target', 'debug', 'au')
/** The event categories the harness turns on (the assertion spine). */
export const EVENT_CATEGORIES = 'intent,placement,viewer,resync,chooser,lifecycle,dock,move,focus,selection,keybind'
