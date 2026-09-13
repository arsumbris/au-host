// <au-stepper> — the default set's Lit SHADOW implementation of the `au-stepper` contract.
//
// Ordered position in a finite flow: where am I in this N-step ladder? Position reads as marker FILL
// + ink WEIGHT + a 1px hairline connector — NEVER a coloured rail and NEVER a left accent bar.
// Completed steps recede to ink-3, the current step is the brightest (ink-1, medium), upcoming are
// hollow hairline rings; hue (danger) appears only on a genuine `error` step.
//
// DATA-DRIVEN: `steps` is a au-step-item[] the consumer sets in JS (`.steps`); `current` is the 0-based
// index driving the derived complete/current/upcoming ladder. Three variants (dots / horizontal /
// vertical), optional numbered markers (a mono number → a check on completion), a hairline or chevron
// separator, and read-only / linear / free interaction (the interactive forms own roving focus).
// Composes au-icon for the check / minus / chevron glyphs. TOKEN-ONLY.
//
// Emits `au-step-select` (detail `{ id, index }`, composed + bubbling) when an enabled step activates.

import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { controlFocusStyle } from './focus-style'

/** One step: a stable id, an optional label, an optional sub-label, an explicit state, a live flag. */
export interface AuStepItem {
  id: string
  label?: string
  subLabel?: string
  state?: 'upcoming' | 'current' | 'complete' | 'disabled' | 'skipped' | 'error'
  live?: boolean
}

type StepState = NonNullable<AuStepItem['state']>
type Interactive = 'none' | 'linear' | 'free'

/** Resolve a step's visual state from its explicit `state` or the `current` index. */
function stateOf(item: AuStepItem, index: number, current: number): StepState {
  if (item.state !== undefined) return item.state
  if (index < current) return 'complete'
  if (index === current) return 'current'
  return 'upcoming'
}

/** The screen-reader status word a marker's number/glyph alone can't convey. */
function statusWord(state: StepState): string {
  switch (state) {
    case 'complete':
      return 'Completed'
    case 'current':
      return 'Current'
    case 'error':
      return 'Error'
    case 'disabled':
      return 'Disabled'
    case 'skipped':
      return 'Skipped'
    default:
      return 'Upcoming'
  }
}

/** Whether a step accepts a click under the given interaction policy. */
function stepEnabled(state: StepState, interactive: Interactive): boolean {
  if (interactive === 'none') return false
  if (state === 'disabled' || state === 'skipped') return false
  if (interactive === 'linear') return state === 'complete'
  return interactive === 'free'
}

export class AuStepperElement extends AuElement {
  static properties = {
    steps: { type: Array },
    current: { type: Number },
    variant: { type: String, reflect: true },
    numbered: { type: Boolean },
    separator: { type: String },
    interactive: { type: String, reflect: true },
    countLabel: { type: Boolean, attribute: 'count-label' },
    label: { type: String },
  }

  declare steps: AuStepItem[]
  declare current: number
  declare variant: 'horizontal' | 'vertical' | 'dots'
  declare numbered: boolean
  declare separator: 'line' | 'chevron'
  declare interactive: Interactive
  declare countLabel: boolean
  declare label?: string

  private _rover = 0

  constructor() {
    super()
    this.steps = []
    this.current = 0
    this.variant = 'horizontal'
    this.numbered = false
    this.separator = 'line'
    this.interactive = 'none'
    this.countLabel = false
  }

  static styles = css`
    :host {
      display: inline-block;
      min-width: 0;
      max-width: 100%;
    }
    .au-stepper-nav {
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-3, 12px);
      min-width: 0;
      max-width: 100%;
    }
    .au-stepper {
      /* local seeds — whole multiples of the 4px base step (StatusDot/Meter pattern). */
      --au-stepper-marker: var(--au-space-5, 20px); /* numbered disc / ring */
      --au-stepper-dot: var(--au-space-2, 8px); /* plain labelled dot */
      --au-stepper-pip: calc(var(--au-space-1, 4px) + var(--au-space-0-5, 2px)); /* 6px dots pip */
      --au-stepper-connector: var(--au-line-1, rgba(238, 240, 247, 0.055));
      list-style: none;
      margin: 0;
      padding: 0;
      min-width: 0;
      color: var(--au-ink-1, #e2dfda);
    }

    /* ═════ shared marker ═════ */
    .au-stepper-marker {
      position: relative;
      box-sizing: border-box;
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: var(--au-stepper-dot);
      height: var(--au-stepper-dot);
      border-radius: var(--au-radius-pill, 99px);
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-2xs, 11px);
      line-height: var(--au-lh-2xs, 16px);
      font-variant-numeric: tabular-nums;
      letter-spacing: var(--au-ls-mono, -0.005em);
      transition:
        background-color var(--au-m-base, 220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        box-shadow var(--au-m-base, 220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        color var(--au-m-base, 220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    /* plain (non-numbered) labelled dots — fill carries state, no glyph. */
    .au-stepper-marker[data-state='upcoming'] {
      box-shadow: inset 0 0 0 1px var(--au-line-2, rgba(238, 240, 247, 0.09));
    }
    .au-stepper-marker[data-state='current'] {
      background: var(--au-ink-1, #e2dfda);
    }
    .au-stepper-marker[data-state='complete'] {
      background: var(--au-ink-2, #d9d6cd);
    }
    .au-stepper-marker[data-state='disabled'],
    .au-stepper-marker[data-state='skipped'] {
      box-shadow: inset 0 0 0 1px var(--au-line-1, rgba(238, 240, 247, 0.055));
    }
    .au-stepper-marker[data-state='error'] {
      background: var(--au-color-danger, #fb817c);
    }

    /* ═════ numbered marker — disc/ring holding a mono number → check on completion ═════ */
    .au-stepper[data-numbered] .au-stepper-marker {
      width: var(--au-stepper-marker);
      height: var(--au-stepper-marker);
    }
    .au-stepper[data-numbered] .au-stepper-marker[data-state='upcoming'] {
      background: none;
      box-shadow: inset 0 0 0 1px var(--au-line-2, rgba(238, 240, 247, 0.09));
      color: var(--au-ink-4, #959083);
    }
    .au-stepper[data-numbered] .au-stepper-marker[data-state='current'] {
      background: none;
      box-shadow: inset 0 0 0 1px var(--au-ink-2, #d9d6cd);
      color: var(--au-ink-1, #e2dfda);
    }
    .au-stepper[data-numbered] .au-stepper-marker[data-state='complete'] {
      background: var(--au-ink-2, #d9d6cd);
      box-shadow: none;
      color: var(--au-color-bg, #16181d);
    }
    .au-stepper[data-numbered] .au-stepper-marker[data-state='disabled'],
    .au-stepper[data-numbered] .au-stepper-marker[data-state='skipped'] {
      background: none;
      box-shadow: inset 0 0 0 1px var(--au-line-1, rgba(238, 240, 247, 0.055));
      color: var(--au-ink-4, #959083);
    }
    .au-stepper[data-numbered] .au-stepper-marker[data-state='error'] {
      background: none;
      box-shadow: inset 0 0 0 1px var(--au-color-danger, #fb817c);
    }
    /* the only hue: a small danger pip centred in the danger ring (number is dropped). */
    .au-stepper[data-numbered] .au-stepper-marker[data-state='error']::before {
      content: '';
      width: var(--au-space-2, 8px);
      height: var(--au-space-2, 8px);
      border-radius: var(--au-radius-pill, 99px);
      background: var(--au-color-danger, #fb817c);
    }
    .au-stepper-num {
      display: block;
    }

    /* check-in: fades + scales in — a quiet settle, never a bounce. */
    .au-stepper-check {
      animation: au-stepper-check var(--au-m-fast, 160ms) var(--au-e-soft,cubic-bezier(0.22, 1, 0.36, 1));
    }
    @keyframes au-stepper-check {
      from {
        opacity: 0;
        transform: scale(0.8);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }

    /* ═════ live current pulse — mirrors StatusDot[data-pulse] ═════ */
    .au-stepper-marker[data-live]::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      box-shadow: 0 0 0 1px color-mix(in oklab, var(--au-ink-1, #e2dfda) 45%, transparent);
      transform-origin: center;
      pointer-events: none;
      animation: au-stepper-pulse var(--au-m-cinema, 780ms) var(--au-e-soft,cubic-bezier(0.22, 1, 0.36, 1)) infinite;
    }
    @keyframes au-stepper-pulse {
      0% {
        opacity: 0.55;
        transform: scale(1);
      }
      70%,
      100% {
        opacity: 0;
        transform: scale(2.4);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .au-stepper-marker[data-live]::after {
        animation: none;
        opacity: 0.5;
        transform: scale(1.35);
      }
    }

    /* ═════ hit target (span read-only · button interactive) ═════ */
    .au-stepper-hit {
      position: relative;
      display: flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
      min-width: 0;
    }
    button.au-stepper-hit {
      margin: 0;
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      color: inherit;
      text-align: inherit;
      cursor: pointer;
      border-radius: var(--au-radius-chip, 6px);
    }
    button.au-stepper-hit:focus-visible,
    button.au-stepper-hit[data-force-focus] {
      ${controlFocusStyle}
    }
    button.au-stepper-hit:hover .au-stepper-label,
    button.au-stepper-hit[data-force-hover] .au-stepper-label {
      color: var(--au-ink-1, #e2dfda);
    }
    button.au-stepper-hit:hover .au-stepper-marker[data-state='complete'],
    button.au-stepper-hit[data-force-hover] .au-stepper-marker[data-state='complete'] {
      background: var(--au-ink-1, #e2dfda);
    }

    /* ═════ label block ═════ */
    .au-stepper-label {
      min-width: 0;
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm, 16px);
      font-weight: var(--au-w-body, 400);
      letter-spacing: var(--au-ls-snug, -0.02em);
      color: var(--au-ink-4, #959083);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: color var(--au-m-base, 220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .au-stepper-step[data-state='current'] .au-stepper-label {
      color: var(--au-ink-1, #e2dfda);
      font-weight: var(--au-w-medium, 500);
    }
    .au-stepper-step[data-state='complete'] .au-stepper-label {
      color: var(--au-ink-3, #a09c92);
    }
    .au-stepper-step[data-state='error'] .au-stepper-label {
      color: var(--au-ink-2, #d9d6cd);
    }
    .au-stepper-step[data-state='disabled'] .au-stepper-label {
      color: var(--au-ink-5, #3f3c36);
    }
    .au-stepper-step[data-state='skipped'] .au-stepper-label {
      color: var(--au-ink-4, #959083);
    }
    .au-stepper-sublabel {
      margin-top: var(--au-space-0-5, 2px);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-2xs, 11px);
      line-height: var(--au-lh-2xs, 16px);
      color: var(--au-ink-4, #959083);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .au-stepper-sr {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }

    .au-stepper-count {
      flex: 0 0 auto;
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-xs, 12px);
      font-variant-numeric: tabular-nums;
      letter-spacing: var(--au-ls-mono, -0.005em);
      color: var(--au-ink-3, #a09c92);
    }

    /* ═════ HORIZONTAL ═════ */
    .au-stepper[data-variant='horizontal'] {
      display: flex;
      align-items: center;
    }
    .au-stepper[data-variant='horizontal'] .au-stepper-step {
      display: flex;
      align-items: center;
      flex: 1 1 auto;
      min-width: 0;
    }
    .au-stepper[data-variant='horizontal'] .au-stepper-step:last-child {
      flex: 0 0 auto;
    }
    .au-stepper-connector {
      flex: 1 1 var(--au-space-6, 24px);
      min-width: var(--au-space-6, 24px);
      height: 1px;
      background: var(--au-stepper-connector);
      margin-inline: var(--au-space-1, 4px);
      transition: background-color var(--au-m-base, 220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .au-stepper-connector[data-behind] {
      background: var(--au-line-2, rgba(238, 240, 247, 0.09));
    }

    /* chevron separator: a muted glyph instead of a line; steps stop stretching. */
    .au-stepper[data-separator='chevron'] {
      gap: var(--au-space-1, 4px);
    }
    .au-stepper[data-separator='chevron'] .au-stepper-step {
      flex: 0 1 auto;
    }
    .au-stepper-sep {
      display: inline-flex;
      align-items: center;
      margin-inline: var(--au-space-1, 4px);
      color: var(--au-ink-4, #959083);
    }

    /* ═════ VERTICAL ═════ */
    .au-stepper[data-variant='vertical'] {
      display: flex;
      flex-direction: column;
    }
    .au-stepper[data-variant='vertical'] .au-stepper-step {
      position: relative;
      padding-bottom: var(--au-space-4, 16px);
    }
    .au-stepper[data-variant='vertical'] .au-stepper-step:last-child {
      padding-bottom: 0;
    }
    .au-stepper[data-variant='vertical'] .au-stepper-hit {
      display: grid;
      grid-template-columns: var(--au-stepper-marker) 1fr;
      grid-template-rows: auto auto;
      column-gap: var(--au-space-2, 8px);
      align-items: start;
    }
    .au-stepper[data-variant='vertical'] .au-stepper-marker {
      grid-area: 1 / 1;
      align-self: center;
      justify-self: center;
    }
    .au-stepper[data-variant='vertical'] .au-stepper-label {
      grid-area: 1 / 2;
      align-self: center;
    }
    .au-stepper[data-variant='vertical'] .au-stepper-sublabel {
      grid-area: 2 / 2;
    }
    .au-stepper[data-variant='vertical'] .au-stepper-step:not(:last-child)::before {
      content: '';
      position: absolute;
      top: calc(var(--au-stepper-marker) + var(--au-space-1, 4px));
      bottom: var(--au-space-1, 4px);
      left: calc(var(--au-stepper-marker) / 2);
      transform: translateX(-50%);
      width: 1px;
      background: var(--au-stepper-connector);
      transition: background-color var(--au-m-base, 220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .au-stepper[data-variant='vertical'] .au-stepper-step[data-behind]::before {
      background: var(--au-line-2, rgba(238, 240, 247, 0.09));
    }

    /* ═════ DOTS — markers only; active = an elongated pill (the one sanctioned width morph) ═════ */
    .au-stepper[data-variant='dots'] {
      display: flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
    }
    .au-stepper[data-variant='dots'] .au-stepper-marker {
      width: var(--au-stepper-pip);
      height: var(--au-stepper-pip);
      background: var(--au-ink-5, #3f3c36);
      box-shadow: none;
    }
    .au-stepper[data-variant='dots'] .au-stepper-marker[data-state='complete'] {
      background: var(--au-ink-3, #a09c92);
    }
    .au-stepper[data-variant='dots'] .au-stepper-marker[data-state='current'] {
      width: var(--au-space-4, 16px);
      background: var(--au-ink-1, #e2dfda);
      transition:
        width var(--au-m-base, 220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        background-color var(--au-m-fast, 160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .au-stepper[data-variant='dots'] .au-stepper-marker[data-state='error'] {
      background: var(--au-color-danger, #fb817c);
    }
    .au-stepper[data-variant='dots'] .au-stepper-step {
      display: flex;
    }

    /* ═════ ENTER (mount) — a quiet fade + 2px settle, gently staggered down the list. ═════ */
    .au-stepper-step {
      animation: au-stepper-in var(--au-m-fast, 160ms) var(--au-e-soft,cubic-bezier(0.22, 1, 0.36, 1)) both;
      animation-delay: calc(var(--au-stepper-i, 0) * (var(--au-m-fast, 160ms) / 6));
    }
    @keyframes au-stepper-in {
      from {
        opacity: 0;
        transform: translateY(calc(var(--au-space-0-5, 2px) * -1));
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    au-icon {
      display: inline-flex;
    }
  `

  private get enabledFlags(): boolean[] {
    return this.steps.map((item, index) => stepEnabled(stateOf(item, index, this.current), this.interactive))
  }

  private activeRover(enabled: boolean[]): number {
    if (enabled[this._rover]) return this._rover
    if (enabled[this.current]) return this.current
    return enabled.findIndex(Boolean)
  }

  private focusStepAt(index: number): void {
    this.renderRoot.querySelector<HTMLButtonElement>(`button[data-step-index="${index}"]`)?.focus()
  }

  private select(item: AuStepItem, index: number): void {
    this._rover = index
    this.requestUpdate()
    this.dispatchEvent(
      new CustomEvent('au-step-select', { detail: { id: item.id, index }, bubbles: true, composed: true }),
    )
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.interactive === 'none') return
    const enabled = this.enabledFlags
    const forward = this.variant === 'vertical' ? 'ArrowDown' : 'ArrowRight'
    const back = this.variant === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
    const enabledIdx = enabled.flatMap((ok, i) => (ok ? [i] : []))
    if (enabledIdx.length === 0) return
    const pos = enabledIdx.indexOf(this.activeRover(enabled))
    let target: number | null = null
    if (e.key === forward) target = enabledIdx[(pos + 1) % enabledIdx.length] ?? null
    else if (e.key === back) target = enabledIdx[(pos - 1 + enabledIdx.length) % enabledIdx.length] ?? null
    else if (e.key === 'Home') target = enabledIdx[0] ?? null
    else if (e.key === 'End') target = enabledIdx[enabledIdx.length - 1] ?? null
    if (target === null) return
    e.preventDefault()
    this._rover = target
    this.requestUpdate()
    const t = target
    requestAnimationFrame(() => this.focusStepAt(t))
  }

  render() {
    const total = this.steps.length
    const isDots = this.variant === 'dots'
    const isNumbered = this.numbered && !isDots
    const isChevron = this.separator === 'chevron' && this.variant === 'horizontal'
    const enabled = this.enabledFlags
    const activeRover = this.activeRover(enabled)
    const countText = `${Math.min(this.current + 1, total)}/${total}`

    return html`
      <nav class="au-stepper-nav" aria-label=${this.label ?? 'Progress'}>
        <ol
          class="au-stepper"
          data-variant=${this.variant}
          data-numbered=${isNumbered ? '' : nothing}
          data-separator=${isChevron ? 'chevron' : nothing}
          data-interactive=${this.interactive !== 'none' ? this.interactive : nothing}
          @keydown=${this.onKeyDown}
        >
          ${this.steps.map((item, index) => {
            const state = stateOf(item, index, this.current)
            const behind = index < this.current
            const live = item.live === true && state === 'current'
            const isEnabled = enabled[index]
            const last = index === total - 1

            const glyph = isNumbered
              ? state === 'complete'
                ? html`<au-icon class="au-stepper-check" name="check" size="xs"></au-icon>`
                : state === 'skipped'
                  ? html`<au-icon name="minus" size="xs"></au-icon>`
                  : state !== 'error'
                    ? html`<span class="au-stepper-num">${index + 1}</span>`
                    : nothing
              : nothing

            const marker = html`<span
              class="au-stepper-marker"
              data-state=${state}
              data-live=${live ? '' : nothing}
              aria-hidden="true"
              >${glyph}</span
            >`

            const label =
              !isDots && item.label !== undefined
                ? html`<span class="au-stepper-label">${item.label}</span>`
                : nothing
            const subLabel =
              this.variant === 'vertical' && item.subLabel !== undefined
                ? html`<span class="au-stepper-sublabel">${item.subLabel}</span>`
                : nothing
            const sr = html`<span class="au-stepper-sr"
              >${statusWord(state)}, step ${index + 1} of ${total}${item.label !== undefined
                ? `: ${item.label}`
                : ''}</span
            >`
            const inner = html`${marker}${sr}${label}${subLabel}`

            const hit = isEnabled
              ? html`<button
                  type="button"
                  class="au-stepper-hit"
                  data-step-index=${index}
                  tabindex=${index === activeRover ? 0 : -1}
                  @click=${() => this.select(item, index)}
                  @focus=${() => {
                    this._rover = index
                  }}
                >
                  ${inner}
                </button>`
              : html`<span class="au-stepper-hit">${inner}</span>`

            return html`<li
              class="au-stepper-step"
              data-state=${state}
              data-behind=${behind ? '' : nothing}
              aria-current=${state === 'current' ? 'step' : nothing}
              aria-disabled=${state === 'disabled' || state === 'skipped' ? 'true' : nothing}
              style=${`--au-stepper-i: ${index}`}
            >
              ${hit}
              ${!isDots && !last
                ? isChevron
                  ? html`<span class="au-stepper-sep" aria-hidden="true"
                      ><au-icon name="chevron-right" size="sm"></au-icon
                    ></span>`
                  : html`<span
                      class="au-stepper-connector"
                      data-behind=${behind ? '' : nothing}
                      aria-hidden="true"
                    ></span>`
                : nothing}
            </li>`
          })}
        </ol>
        ${this.countLabel
          ? html`<span class="au-stepper-count" aria-hidden="true">${countText}</span>`
          : nothing}
      </nav>
    `
  }
}
