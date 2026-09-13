// The hand-written runtime for the generated React wrappers (`./react`). `makeAuWrapper` turns a
// `<au-*>` TAG NAME into a React component WITHOUT ever importing a component-set element class — the
// whole point: a projection renders the tag, and whichever set the host registers under that tag in
// the global custom-element registry defines it (boot-swap). Swapping the set changes the class under
// the tag; this wrapper renders the SAME tag string and never references a class, so the swap is
// invisible to it.

// It fixes the two React↔custom-element frictions at the seam:
//  - declared FIELDS are set as PROPERTIES on the element (not JSX attributes), so a dashed-attribute
//    prop like `chevronEnd` reaches the element reliably (Lit reflects property → attribute internally).
//  - declared EVENTS are wired with addEventListener and exposed as typed `onAuXxx` props (React does
//    not auto-attach custom-element listeners).
// Everything else (className / style / id / tabIndex / role / data-* / aria-* / DOM event handlers /
// children) passes straight through to the element as ordinary React props.

import { createElement, forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import type { DetailedHTMLProps, ForwardRefExoticComponent, HTMLAttributes, PropsWithoutRef, RefAttributes } from 'react'

/** The standard host-element attributes every wrapper passes through (className / style / ref /
 *  children / id / tabIndex / role / data-* / aria-* / DOM event handlers). */
export type AuHostProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>

/** A custom-event handler prop (`onAuToggle`, `onAuActivate`, …). */
export type AuEventHandler = (event: CustomEvent) => void

type AnyRecord = Record<string, unknown>

/**
 * Build a set-independent React wrapper for one `<au-*>` tag.
 *
 * @param tag        the custom-element tag (`'au-section-header'`) — rendered as a STRING, resolved by
 *                   the global registry; never a class.
 * @param fieldNames the component's declared prop names — set as element PROPERTIES.
 * @param eventMap   handler-prop-name → event-name (`{ onAuToggle: 'au-toggle' }`) — wired via listeners.
 */
export function makeAuWrapper<P extends object>(
  tag: string,
  fieldNames: readonly string[],
  eventMap: Readonly<Record<string, string>>,
): ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<HTMLElement>> {
  const fieldSet = new Set<string>(fieldNames)

  const Wrapper = forwardRef<HTMLElement, P>(function AuWrapper(props, ref) {
    const elRef = useRef<HTMLElement | null>(null)
    useImperativeHandle(ref, () => elRef.current as HTMLElement, [])

    // Keep a live handle on the current props so listeners bound ONCE always call the latest handler.
    const propsRef = useRef(props)
    propsRef.current = props

    // Fields → element PROPERTIES, re-applied on every render (a property set reflects the change).
    // Upgrade-safe: if the tag is not yet defined, apply once it is (the host defines sets at boot
    // before projections mount, so this normally runs synchronously).
    useLayoutEffect(() => {
      const el = elRef.current
      if (!el) return
      const record = props as AnyRecord
      const target = el as unknown as AnyRecord
      const apply = (): void => {
        for (const name of fieldNames) if (name in record) target[name] = record[name]
      }
      if (customElements.get(tag)) apply()
      else void customElements.whenDefined(tag).then(() => {
        if (elRef.current) apply()
      })
    })

    // Events → addEventListener, bound ONCE; each listener reads the current handler off propsRef.
    useLayoutEffect(() => {
      const el = elRef.current
      if (!el) return
      const offs: Array<() => void> = []
      for (const [handlerName, eventName] of Object.entries(eventMap)) {
        const listener = (event: Event): void => {
          const handler = (propsRef.current as AnyRecord)[handlerName]
          if (typeof handler === 'function') (handler as AuEventHandler)(event as CustomEvent)
        }
        el.addEventListener(eventName, listener)
        offs.push(() => el.removeEventListener(eventName, listener))
      }
      return () => {
        for (const off of offs) off()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Everything that is NOT a declared field or event handler passes through to the element.
    const passthrough: AnyRecord = { ref: elRef }
    const record = props as AnyRecord
    for (const key in record) {
      if (fieldSet.has(key) || key in eventMap) continue
      passthrough[key] = record[key]
    }
    return createElement(tag, passthrough)
  })
  Wrapper.displayName = tag
  return Wrapper as ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<HTMLElement>>
}
