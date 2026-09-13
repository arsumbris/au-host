import type { DaemonConfig } from '../../shared/daemon-api'

const STORAGE_KEY = 'au-host.daemon-config'

// A fresh profile has no selected workspace or machine-specific executable.
// Explicit launch entries and saved user configuration supply these values.
export const DEFAULT_CONFIG: DaemonConfig = {
  binaryPath: '',
  entryPath: '',
}

export function loadConfig(): DaemonConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<DaemonConfig>) }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_CONFIG
}

export function saveConfig(config: DaemonConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}
