// First-party `intent` COMMAND + UI vocabulary package.
//
// The intent MECHANISM (the abstract `Intent` base, the routing-config types, the
// host-relied metas) is owned by `@arsumbris/au-host-sdk`; this package owns the concrete
// COMMANDS (`OpenIntent` / `PromoteIntent` / …) and UI intents, each extending
// `intent::au-host-sdk`. The dependency is one-way, `intent -> host-sdk`.
//
// `OpenIntent` / `PromoteIntent` etc. are generated from `./type/*.type.yaml`
// (`pnpm gen:types`); the guards + constructors are authored. An intent is a COMMAND
// fired into a scope and handled once by a capable container. The host never interprets
// the payload — intents ride the payload-opaque channel, routed by the `type`
// discriminant + the `dispatch` tag.
//
// `dispatch` (ambient / firer-relative) is ROUTING metadata, not semantic payload, so it
// is stamped by the constructors here (and typed on `IntentPayload` in au-host-sdk),
// not a generated type-definition field.

import type { Selection } from '@arsumbris/selection'

// The intent base is host-sdk-owned; the guards below narrow it to this package's commands.
import type { Intent } from '@arsumbris/au-host-sdk/generated'

import type {
  OpenIntent,
  OpenPaneIntent,
  PromoteIntent,
  ShowPaneIntent,
  RevealPaneIntent,
  UiIntentHighlight,
  UiNotification,
  UiNotificationAction,
} from './generated'

// Routing constants are codegen'd from each intent's `intent-routing-meta` block,
// so the fired payload's kind/dispatch is SINGLE-SOURCED from the type-def declaration.
import {
  OPEN_INTENT_ROUTING,
  OPEN_PANE_INTENT_ROUTING,
  PROMOTE_INTENT_ROUTING,
  REVEAL_PANE_INTENT_ROUTING,
  SHOW_PANE_INTENT_ROUTING,
  UI_INTENT_HIGHLIGHT_ROUTING,
  UI_NOTIFICATION_ROUTING,
} from './generated'

// This package exports concrete intent vocabulary. Import the intent mechanism and routing
// contracts from @arsumbris/au-host-sdk.
export type {
  OpenIntent,
  OpenPaneIntent,
  PromoteIntent,
  RevealPaneIntent,
  ShowPaneIntent,
  UiIntentHighlight,
  UiNotification,
  UiNotificationAction,
  IntentAgentMeta,
} from './generated'

export {
  OPEN_INTENT_ROUTING,
  OPEN_PANE_INTENT_ROUTING,
  PROMOTE_INTENT_ROUTING,
  REVEAL_PANE_INTENT_ROUTING,
  SHOW_PANE_INTENT_ROUTING,
  UI_INTENT_HIGHLIGHT_ROUTING,
  UI_NOTIFICATION_ROUTING,
} from './generated'

/**
 * How the host DISPATCHES a routed intent (mirrors `IntentDispatch` in au-host-sdk):
 * - `ambient` — the ACTIVE container (MRU-focus-first + tree-proximity + root backstop).
 * - `firer-relative` — the firer's OWN container (the firer's-ancestors walk).
 */
export type IntentDispatch = 'ambient' | 'firer-relative'

/** routed (claim-once) or broadcast (fan-out), mirrors `IntentKind` in au-host-sdk. */
export type IntentKind = 'routed' | 'broadcast'

// OpenPaneIntent and ShowPaneIntent are generated from their type definitions.
// open-pane-intent carries an opaque pane config, so the agent gate treats it as privileged.
// show-pane-intent carries a bare type name and is agent-firable. Constructors spread the generated
// routing constants so dispatch behavior shares the type definition as its source.

export function isOpenIntent(intent: Intent): intent is OpenIntent {
  return intent.type === 'open-intent'
}

export function isPromoteIntent(intent: Intent): intent is PromoteIntent {
  return intent.type === 'promote-intent'
}

export function isOpenPaneIntent(intent: Intent): intent is OpenPaneIntent {
  return intent.type === 'open-pane-intent'
}

export function isRevealPaneIntent(intent: Intent): intent is RevealPaneIntent {
  return intent.type === 'reveal-pane-intent'
}

export function isShowPaneIntent(intent: Intent): intent is ShowPaneIntent {
  return intent.type === 'show-pane-intent'
}

export function isHighlightIntent(intent: Intent): intent is UiIntentHighlight {
  return intent.type === 'ui-intent-highlight'
}

export function isNotificationIntent(intent: Intent): intent is UiNotification {
  return intent.type === 'ui-notification'
}

/**
 * Construct an open-intent (ambient — opens in the focused container).
 *
 * `mode` is OPTIONAL, and OMITTING IT IS THE NORMAL CASE. Pass one only when a GESTURE
 * was explicit; otherwise say nothing and let the container decide, which is where
 * realization lives (`tabs` owns preview, `bento` cannot preview at all).
 * - omitted       — no opinion. The container applies its own default, which a
 *   composition may author per instance.
 * - `transient`   — a preview, reused + replaced in place.
 * - `permanent`   — a persistent tab (double-click / edit).
 * - `preview-pin` — pin the container's CURRENT preview, then open this as a NEW preview
 *   (cmd/ctrl+click: keep what you were previewing, peek the next file).
 *
 *
 */
export function openIntent(
  target: Selection,
  mode?: OpenIntent['mode'],
  viewer?: string,
): OpenIntent & typeof OPEN_INTENT_ROUTING {
  // The key is OMITTED when there is no mode, never set to `undefined`. A handler tests
  // presence, and the payload crosses the window relay where an explicit `undefined` and
  // an absent key do not survive as the same thing.
  //
  // `viewer` is a bare viewer type name (an "Open with X" pick); it rides as `with` in the DEF-REF
  // wikilink form so the value stays verifiable against the type graph. Absent = the container resolves
  // the viewer through the ladder (composition viewer-default, sole eligible, else a picker).
  return {
    type: 'open-intent',
    target,
    ...(mode ? { mode } : {}),
    ...(viewer ? { with: `[[${viewer}]]` as OpenIntent['with'] } : {}),
    ...OPEN_INTENT_ROUTING,
  }
}

/**
 * The bare viewer type name an open-intent explicitly chose (`with`), or `undefined` for none.
 * Strips the def-ref wikilink form and any `::repo`, so a container gets a plain type name to
 * instantiate. The container honours this FIRST in the viewer ladder (before the composition default).
 */
export function openIntentViewer(intent: OpenIntent): string | undefined {
  const w = intent.with
  if (typeof w !== 'string' || !w) return undefined
  const inner = w.replace(/^\[\[|\]\]$/g, '').split(/[|#]/)[0]?.split('::')[0]?.trim()
  return inner || undefined
}

/** Construct a promote-intent (firer-relative — the FIRER's container promotes the firer's tab/node). */
export function promoteIntent(): PromoteIntent & typeof PROMOTE_INTENT_ROUTING {
  return { type: 'promote-intent', ...PROMOTE_INTENT_ROUTING }
}

/**
 * Construct a ui-intent-highlight (BROADCAST — every projection that handles it highlights ITS
 * OWN copy of `target`). `show-if-visible` marks only where already on-screen; `reveal-if-exists`
 * scrolls each holder's own viewport to it (per-copy, no single-winner).
 */
export function highlightIntent(
  target: Selection,
  mode: UiIntentHighlight['mode'],
): UiIntentHighlight & typeof UI_INTENT_HIGHLIGHT_ROUTING {
  return { type: 'ui-intent-highlight', target, mode, ...UI_INTENT_HIGHLIGHT_ROUTING }
}

/**
 * Construct a ui-notification (BROADCAST — every mounted surfacer that handles it shows it
 * ITS OWN way, no focus / routing / claim-decline). `severity` tags it (info / warn / error);
 * `actions` are optional labeled follow-ups the surfacer renders + fires. The canonical firer
 * is the session (the agent, over the bridge), but any node may fire one.
 */
export function notificationIntent(
  severity: UiNotification['severity'],
  message: string,
  actions?: UiNotificationAction[],
): UiNotification & typeof UI_NOTIFICATION_ROUTING {
  return { type: 'ui-notification', severity, message, ...(actions ? { actions } : {}), ...UI_NOTIFICATION_ROUTING }
}

/** Construct an open-pane-intent (ambient — a container opens `pane` at the focused location). */
export function openPaneIntent(pane: unknown): OpenPaneIntent & typeof OPEN_PANE_INTENT_ROUTING {
  return { type: 'open-pane-intent', pane, ...OPEN_PANE_INTENT_ROUTING }
}

/**
 * Construct a show-pane-intent — "make a pane of this kind visible", reveal-or-create. Fire and
 * forget: the container that takes it decides whether that means activating an existing pane or
 * placing a new one. No caller-side sequencing, and no caller-built config.
 */
export function showPaneIntent(paneType: string): ShowPaneIntent & typeof SHOW_PANE_INTENT_ROUTING {
  return { type: 'show-pane-intent', paneType, ...SHOW_PANE_INTENT_ROUTING }
}

/**
 * Construct a reveal-pane-intent — "focus the pane with this id." Routed + ambient: the container
 * that HOLDS the pane claims it and activates it (a tabs group brings that tab forward; a split
 * focuses / expands the pane); every other container declines. `paneId` is a surface id from the
 * open-surfaces index (a pane's stable `^:`).
 */
export function revealPaneIntent(paneId: string): RevealPaneIntent & typeof REVEAL_PANE_INTENT_ROUTING {
  return { type: 'reveal-pane-intent', paneId, ...REVEAL_PANE_INTENT_ROUTING }
}
