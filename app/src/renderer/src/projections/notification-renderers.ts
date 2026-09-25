// Discovers the type-keyed CONTENT RENDERERS for the host notification surface.
//
// A `ui-notification` SUBTYPE declares its content renderer via a `notification-content-meta`
// locator (entry + export). This mirrors projection discovery/loading: a `subtypes('ui-notification')`
// pass collects each subtype's locator, then the renderer module is loaded (reusing `loadProjection`)
// and its export cached, keyed by the subtype's type name. The host surface selects a renderer by
// the fired notification's type; the base `ui-notification` uses the host default.


import { readSubtypes, type WireReader, type WireSubtype } from '@arsumbris/au-host-sdk/engine-reads'
import { codeMetaBlock, reportHostDiagnostic } from '@arsumbris/au-host-sdk'
import { NOTIFICATION_CONTENT_META } from '@arsumbris/intent'
import type { ProjectionSource } from '@arsumbris/au-host-sdk'

import { loadProjection, sourceKey, sourceLocation } from './loader'
import { packageRootOf } from '../../../shared/package-root'
import type { NotificationContentRenderer } from './notification-surface'

/** The base notification type whose subtypes may ship content renderers. */
const BASE_TYPE = 'ui-notification'
/** The default export name when a locator omits `export`. */
const DEFAULT_EXPORT = 'render'

/**
 * Discover + eager-load the content renderers of every `ui-notification` subtype that declares a
 * `notification-content-meta` locator. Returns a map keyed by subtype type name. A subtype without
 * a locator (or whose module fails to load) is simply absent, so its type falls to the host default.
 */
export async function discoverNotificationRenderers(
  reader: WireReader,
): Promise<Map<string, NotificationContentRenderer>> {
  const out = new Map<string, NotificationContentRenderer>()
  const result = await readSubtypes(reader, BASE_TYPE)
  if (!('ready' in result) || !result.ready || !result.result) return out
  const subs = result.result.subtypes as WireSubtype[]

  for (const def of subs) {
    if (def.abstract) continue
    // The renderer locator is the type's OWN block, never an ancestor's: a type loads only code it declares.
    const code = codeMetaBlock(def, NOTIFICATION_CONTENT_META)
    if (code.kind === 'absent') continue
    if (code.kind === 'not-own') {
      reportHostDiagnostic({ code: 'notification-renderer-not-own', severity: 'warning', subject: def.name, message: `declares no loadable content renderer: ${code.reason}` })
      continue
    }
    const block = code.block
    const entry = block.body.find((f) => f.name === 'entry')?.value
    if (typeof entry !== 'string') continue
    const exp = block.body.find((f) => f.name === 'export')?.value
    const exportName = typeof exp === 'string' ? exp : DEFAULT_EXPORT

    const source: ProjectionSource = { mode: 'esm', path: packageRootOf(def.source.file) }
    const registration = { key: sourceKey(sourceLocation(source)), source, entry, export: exportName }
    try {
      const loaded = await loadProjection(registration)
      const fn = (loaded.module as unknown as Record<string, unknown>)[exportName]
      if (typeof fn === 'function') {
        out.set(def.name, fn as NotificationContentRenderer)
      } else {
        reportHostDiagnostic({
          code: 'notification-renderer-export-missing',
          severity: 'warning',
          subject: def.name,
          message: `declares a content renderer but its module has no "${exportName}" export`,
          detail: { entry, export: exportName },
        })
      }
    } catch (err) {
      reportHostDiagnostic({
        code: 'notification-renderer-load-failed',
        severity: 'warning',
        subject: def.name,
        message: err instanceof Error ? err.message : String(err),
        detail: { entry, export: exportName },
      })
    }
  }
  return out
}
