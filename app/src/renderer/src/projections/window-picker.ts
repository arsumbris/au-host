// The "Move to other window" target picker. Shown in the window where the affordance was
// triggered (each window owns its chooser surface), so the user picks a target without the view jumping to
// another window. The window options carry NO spatial anchor, so the chooser renders its fallback LIST panel
// (see `chooser-surface.ts` — spatial mode is entered only when an option has an on-screen anchor).
//
// Shared by the authority (the main window's `moveToWindow`) and the mount agent (a surface's proxied
// `moveToWindow`), so both render the identical picker; only the ACT differs (the authority moves directly,
// the surface sends the pick UP as a `move-to-window` event).
import { getChooserSurface } from './chooser-surface'
import type { WindowSite } from '../../../shared/daemon-api'

/** Pick a target window from the OTHER open windows. A sole candidate auto-picks (like dock's sole leaf), so
 *  the common "move back to the one other window" is a single click. Returns the chosen window id, or null on
 *  an empty set or a cancelled pick. */
export async function pickTargetWindow(sites: readonly WindowSite[]): Promise<string | null> {
  if (sites.length === 0) return null
  if (sites.length === 1) return sites[0]!.id
  return getChooserSurface().choose({
    title: 'Move to which window?',
    options: sites.map((s) => ({ id: s.id, label: s.title })),
  })
}
