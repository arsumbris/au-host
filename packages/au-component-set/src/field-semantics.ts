import type { ReactiveController, ReactiveControllerHost } from 'lit'
import { updateFieldAssociation, type FieldAssociation, type FieldContext } from '@arsumbris/component-contract'

type Host = HTMLElement & ReactiveControllerHost

/** Control-owned adapter. The field contributes plain semantics; the control retains its native node.
 * Authored references resolve at the public host and are forwarded as ancestor-scope element references.
 */
export class FieldSemantics implements ReactiveController {
  #association: FieldAssociation | null = null
  #description: HTMLSpanElement | null = null
  #observer: MutationObserver | null = null

  constructor(
    private host: Host,
    private target: () => HTMLElement | null,
    private own: () => { label?: string; invalid?: boolean; supportsRequired?: boolean } = () => ({}),
  ) { host.addController(this) }

  setContext(owner: object, context: FieldContext | null): void {
    const next = updateFieldAssociation(this.#association, owner, context)
    if (next === this.#association) return
    this.#association = next
    this.host.requestUpdate()
  }

  hostConnected(): void {
    this.#observer = new MutationObserver(() => this.host.requestUpdate())
    this.#observer.observe(this.host, { attributes: true, attributeFilter: [
      'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-description', 'aria-invalid', 'aria-required',
    ] })
    this.host.requestUpdate()
  }

  hostDisconnected(): void {
    this.#observer?.disconnect()
    this.#observer = null
    this.#description?.remove()
    this.#description = null
    this.#association = null
  }

  hostUpdated(): void {
    const target = this.target()
    if (!target) {
      this.#description?.remove()
      this.#description = null
      return
    }
    const context = this.#association?.context
    const own = this.own()
    target.ariaLabelledByElements = this.host.ariaLabelledByElements ?? []
    const label = this.host.getAttribute('aria-label') ?? own.label ?? context?.label
    if (label === undefined) target.removeAttribute('aria-label')
    else target.setAttribute('aria-label', label)

    const references = [...(this.host.ariaDescribedByElements ?? [])]
    const text = [references.length ? undefined : this.host.getAttribute('aria-description'), context?.description]
      .filter((value): value is string => !!value).join('\n')
    if (text) {
      const root = target.getRootNode() as Document | ShadowRoot
      if (!this.#description || this.#description.getRootNode() !== root) {
        this.#description?.remove()
        this.#description = target.ownerDocument.createElement('span')
        this.#description.hidden = true
        if (root instanceof Document) target.parentElement?.append(this.#description)
        else root.append(this.#description)
      }
      this.#description.textContent = text
      references.push(this.#description)
    } else {
      this.#description?.remove()
      this.#description = null
    }
    target.ariaDescribedByElements = [...new Set(references)]
    target.setAttribute('aria-invalid', own.invalid || context?.invalid ? 'true' : this.host.getAttribute('aria-invalid') ?? 'false')
    const required = context?.required || this.host.getAttribute('aria-required') === 'true'
    if (required && own.supportsRequired !== false) target.setAttribute('aria-required', 'true')
    else target.removeAttribute('aria-required')
    // Never assign native required: field semantics must not silently change form validation.
  }
}
