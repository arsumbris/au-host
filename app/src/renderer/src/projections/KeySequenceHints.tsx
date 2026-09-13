import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { bareTypeName, formatChord, type ActiveKeybind, type PendingKeySequence } from '@arsumbris/au-host-sdk'
import { AuKbd } from '@arsumbris/au-component-catalog/react'
import { getOverlaySite } from './overlay-site'
import type { CommandSets } from './command-registry'
import './key-sequence-hints.css'

/** A view of the authority's pending sequence. Never captures focus or resolves a key. */
export function KeySequenceHints({ pending, commands, onInspect, onChoose }: {
  pending: PendingKeySequence
  commands: CommandSets
  onInspect(paused: boolean): void
  onChoose(binding: ActiveKeybind): void
}): React.JSX.Element | null {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [pinned, setPinned] = useState(false)
  const hovered = useRef(false)
  const focused = useRef(false)
  const ring = useRef<SVGCircleElement>(null)
  useEffect(() => {
    const el = ring.current
    if (!el) return
    el.style.strokeDashoffset = '0'
    if (pending.deadline === null) return
    const remaining = Math.max(0, pending.deadline - Date.now())
    const start = 100 * (1 - remaining / pending.durationMs)
    const animation = el.animate([{ strokeDashoffset: `${start}` }, { strokeDashoffset: '100' }], {
      duration: remaining, fill: 'forwards', easing: 'linear',
    })
    return () => animation.cancel()
  }, [pending, container])
  useEffect(() => {
    const layer = getOverlaySite().claim({ level: 'popover', keyguard: false })
    setContainer(layer.el)
    return () => layer.release()
  }, [])
  const labels = new Map([...commands.unregistered, ...commands.commands].map(c => [c.id, c.label]))
  const unique = new Map(pending.bindings.map(binding => [
    `${formatChord(binding.chord)}:${binding.intent}`, binding,
  ]))
  return container ? createPortal(
    <section className="key-sequence-hints" role="status" aria-live="polite" aria-label="Shortcut continuations"
      onPointerEnter={() => { hovered.current = true; onInspect(true) }}
      onPointerLeave={() => { hovered.current = false; onInspect(pinned || focused.current) }}
      onFocus={() => { focused.current = true; onInspect(true) }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { focused.current = false; onInspect(pinned || hovered.current) } }}>

      <div className="key-sequence-hints__heading">
        <AuKbd keys={formatChord([...pending.prefix])} />
        <span>Waiting for the next key</span>
        <button className="key-sequence-hints__timer" type="button" aria-pressed={pinned}
          aria-label={pinned ? 'Resume shortcut countdown' : 'Keep shortcut hints open'}
          title={pinned ? 'Resume countdown' : 'Pause countdown'}
          onMouseDown={event => event.preventDefault()}
          onClick={() => { const next = !pinned; setPinned(next); onInspect(next || hovered.current || focused.current) }}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle className="key-sequence-hints__track" cx="12" cy="12" r="10" />
            <circle ref={ring} className="key-sequence-hints__remaining" cx="12" cy="12" r="10" pathLength="100" />
            {pinned || pending.paused ? <path d="M9 8v8M15 8v8" /> : <path d="M12 7v5l3 2" />}
          </svg>
        </button>
      </div>
      <ul>
        {[...unique.values()].map(binding => {
          const rest = binding.chord.slice(pending.prefix.length)
          return <li key={`${formatChord(binding.chord)}:${binding.intent}`}>
            <button type="button" className="key-sequence-hints__choice" onMouseDown={event => event.preventDefault()} onClick={() => onChoose(binding)}>
            <span>{labels.get(bareTypeName(binding.intent)) ?? bareTypeName(binding.intent)}</span>
            {rest.length ? <AuKbd keys={formatChord(rest)} /> : <span>On timeout</span>}
            </button>
          </li>
        })}
      </ul>
      <div className="key-sequence-hints__footer"><AuKbd keys="Esc" /> Cancel · {pending.paused ? 'Paused while inspecting' : pending.durationMs === 0 ? 'Stays open until dismissed' : 'Hover to pause'}</div>
    </section>, container,
  ) : null
}
