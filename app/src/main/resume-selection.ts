import type { DormantSession } from '../shared/daemon-api'

/** Only a current kernel record determines the producing adapter and restored profile. */
export function resumeSelection(sessions: DormantSession[], id: string) {
  const session = sessions.find(s => s.id === id)
  if (!session?.harness || !session.resumeRef) throw new Error('This session is no longer dormant or has no adapter resume recipe.')
  return { adapter: session.harness, options: { resumeRef: session.resumeRef, profile: session.profile } }
}
