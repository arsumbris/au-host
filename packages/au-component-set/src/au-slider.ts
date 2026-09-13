// <au-slider> — the default set's Lit SHADOW implementation of the `au-slider` contract.
//
// A native <input type=range>, premium-restyled: a thin token track, an ink-2 (monochrome, NOT accent)
// fill on the traversed portion, and a 14px lifted thumb. The native input keeps keyboard + AT
// semantics; track / fill / thumb are painted on the vendor pseudo-elements. The fill is a two-stop
// gradient driven by `--_fill` (a 0..100 percent the element sets inline), so the seam lands exactly
// under the thumb at every value and self-aligns at both ends. The hover / drag cue is a scale, never a
// hue. TOKEN-ONLY.
//
// FORM-ASSOCIATED: `static formAssociated = true` + `attachInternals()`, so the
// value crosses the shadow boundary into a native <form> and honours reset. Emits `au-input` (live, on
// drag/arrow) + `au-change` (commit). `label` is the accessible name.

import { css, html } from 'lit'
import { AuElement } from './au-element'
import { reducedControlMotion } from './control-motion'

export class AuSliderElement extends AuElement {
  override focus(options?: FocusOptions): void {
    this.renderRoot.querySelector<HTMLElement>('input')?.focus(options)
  }

  static formAssociated = true

  static properties = {
    _formDisabled: { state: true },
    value: { type: Number },
    min: { type: Number },
    max: { type: Number },
    step: { type: Number },
    disabled: { type: Boolean, reflect: true },
    label: { type: String },
  }

  declare value: number
  declare min: number
  declare max: number
  declare step: number
  declare disabled: boolean
  declare label?: string

  declare private _formDisabled: boolean

  private internals: ElementInternals

  constructor() {
    super()
    this.value = 0
    this.min = 0
    this.max = 100
    this.step = 1
    this.disabled = false
    this._formDisabled = false
    this.internals = this.attachInternals()
  }

  formResetCallback(): void {
    this.value = this.min
    this.syncForm()
  }
  formDisabledCallback(disabled: boolean): void {
    this._formDisabled = disabled
    this.toggleAttribute('data-form-disabled', disabled)
  }

  private syncForm(): void {
    this.internals.setFormValue(String(this.value))
  }

  private get fill(): number {
    const span = this.max - this.min
    return span > 0 ? Math.max(0, Math.min(100, ((this.value - this.min) / span) * 100)) : 0
  }

  private onInput(e: Event): void {
    const next = Number((e.target as HTMLInputElement).value)
    if (Number.isNaN(next)) return
    this.value = next
    this.syncForm()
    this.dispatchEvent(new CustomEvent('au-input', { detail: { value: next }, bubbles: true, composed: true }))
  }

  private onChange(e: Event): void {
    const next = Number((e.target as HTMLInputElement).value)
    if (Number.isNaN(next)) return
    this.value = next
    this.syncForm()
    this.dispatchEvent(new CustomEvent('au-change', { detail: { value: next }, bubbles: true, composed: true }))
  }

  updated(): void {
    const input = this.renderRoot.querySelector<HTMLInputElement>('input')
    // The native range owns clamping and step rounding; expose the same value it displays.
    if (input) this.value = input.valueAsNumber
    this.syncForm()
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: block;
      width: 100%;
    }
    input {
      /* The fill vars live on the input (not :host): a custom property that nests var(--_fill)
         substitutes at the element where it is DECLARED, so the gradient and the per-value --_fill
         (set inline below) must share one element. */
      --_track-h: var(--au-space-1, 4px);
      --_thumb: calc(var(--au-space-1, 4px) * 3.5);
      --_fill: 0;
      --_track-fill: linear-gradient(
        90deg,
        var(--au-ink-2, #d9d6cd) 0 calc(var(--_fill) * 1%),
        var(--au-line-control) calc(var(--_fill) * 1%) 100%
      );
      box-sizing: border-box;
      width: 100%;
      /* one step of headroom over the thumb: no clip on scale/shadow, roomier hit target. */
      height: calc(var(--_thumb) + var(--au-space-2, 8px));
      margin: 0;
      appearance: none;
      -webkit-appearance: none;
      background: none;
      cursor: pointer;
    }
    /* WebKit / Blink (Electron). */
    input::-webkit-slider-runnable-track {
      height: var(--_track-h);
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-slider-track-paint, var(--_track-fill));
    }
    input::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: var(--_thumb);
      height: var(--_thumb);
      margin-top: calc((var(--_track-h) - var(--_thumb)) / 2);
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-ink-1, #e2dfda);
      border: 1px solid var(--au-line-2, rgba(255, 255, 255, 0.09));
      box-shadow: var(--au-sh-lift,0 1px 2px rgba(5, 4, 3, 0.25));
      transition:
        transform var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        border-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    input:enabled:hover::-webkit-slider-thumb,
    :host([data-force-hover]) input::-webkit-slider-thumb {
      border-color: var(--au-line-3, rgba(255, 255, 255, 0.14));
      transform: scale(1.08);
    }
    input:enabled:active::-webkit-slider-thumb,
    :host([data-force-active]) input::-webkit-slider-thumb {
      border-color: var(--au-line-3, rgba(255, 255, 255, 0.14));
      transform: scale(1.16);
    }
    input:focus-visible {
      outline: none;
    }
    input:focus-visible::-webkit-slider-thumb,
    :host([data-force-focus]) input::-webkit-slider-thumb {
      outline: 2px solid var(--au-focus-outer, #3b82f6);
      outline-offset: 2px;
    }
    /* Firefox. */
    input::-moz-range-track {
      height: var(--_track-h);
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-slider-track-paint, var(--au-line-control));
    }
    input::-moz-range-progress {
      height: var(--_track-h);
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-slider-progress-paint, var(--au-ink-2, #d9d6cd));
    }
    input::-moz-range-thumb {
      width: var(--_thumb);
      height: var(--_thumb);
      border-radius: var(--au-radius-pill,99px);
      background: var(--au-ink-1, #e2dfda);
      border: 1px solid var(--au-line-2, rgba(255, 255, 255, 0.09));
      box-shadow: var(--au-sh-lift,0 1px 2px rgba(5, 4, 3, 0.25));
      transition:
        transform var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        border-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    input:enabled:hover::-moz-range-thumb {
      border-color: var(--au-line-3, rgba(255, 255, 255, 0.14));
      transform: scale(1.08);
    }
    input:enabled:active::-moz-range-thumb {
      border-color: var(--au-line-3, rgba(255, 255, 255, 0.14));
      transform: scale(1.16);
    }
    input:focus-visible::-moz-range-thumb {
      outline: 2px solid var(--au-focus-outer, #3b82f6);
      outline-offset: 2px;
    }
    @media (forced-colors: active) {
      input::-webkit-slider-runnable-track {
        border: 1px solid CanvasText;
        box-sizing: border-box;
      }
      input::-moz-range-track {
        border: 1px solid CanvasText;
        box-sizing: border-box;
      }
    }
    :host([disabled]) input,
    :host([data-form-disabled]) input,
    :host([data-force-disabled]) input {
      opacity: var(--au-opacity-disabled, 0.5);
      cursor: not-allowed;
    }
  `

  render() {
    return html`
      <input
        type="range"
        part="input"
        style="--_fill:${this.fill}"
        aria-label=${this.label ?? ''}
        min=${this.min}
        max=${this.max}
        step=${this.step}
        .value=${String(this.value)}
        ?disabled=${this.disabled || this._formDisabled}
        @input=${this.onInput}
        @change=${this.onChange}
      />
    `
  }
}
