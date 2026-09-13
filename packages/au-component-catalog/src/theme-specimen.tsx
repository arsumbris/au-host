import { useState, type CSSProperties, type ReactNode } from 'react'
import { AuButton, AuCodeBlock, AuCodeSample, AuField, AuInput, AuSelect, AuListRow, AuPopover } from './react'

export interface ThemeSpecimenProps {
  layout?: 'compact' | 'wide'
  context?: string
}

const stack: CSSProperties = { display: 'grid', gap: 'var(--au-space-3)', minWidth: 0 }
const caption: CSSProperties = { margin: 0, color: 'var(--au-ink-3)', fontSize: 'var(--au-t-xs)', fontWeight: 'var(--au-w-medium)' as CSSProperties['fontWeight'] }
const ansi = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

/** A local, interactive specimen that inherits its container's theme and registered component set. */
export function ThemeSpecimen({ layout = 'wide', context = 'Live · inherits the current theme' }: ThemeSpecimenProps): ReactNode {
  const [sample, setSample] = useState('Sample workspace')
  const [selected, setSelected] = useState('Overview')
  return (
    <section aria-label="Live theme specimen" style={{ ...stack, color: 'var(--au-ink-1)', fontFamily: 'var(--au-font-sans)', fontSize: 'var(--au-t-sm)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--au-space-2)', flexWrap: 'wrap' }}>
        <strong style={{ fontWeight: 'var(--au-w-strong)' as CSSProperties['fontWeight'] }}>Theme specimen</strong>
        <span style={caption}>{context}</span>
      </div>
      <div style={{ ...stack, gridTemplateColumns: layout === 'compact' ? 'minmax(0, 1fr)' : 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', alignItems: 'start' }}>
        <div style={stack}>
          <p style={caption}>Surfaces & text</p>
          <div style={{ background: 'var(--au-color-bg)', padding: 'var(--au-space-3)', ...stack }}>
            <strong style={{ fontWeight: 'var(--au-w-strong)' as CSSProperties['fontWeight'] }}>Primary text on canvas</strong>
            <span style={{ color: 'var(--au-ink-2)' }}>Secondary text carries the detail.</span>
            <span style={{ color: 'var(--au-ink-3)' }}>Supporting text stays quiet.</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              {[1, 2, 3].map(level => <div key={level} style={{ padding: 'var(--au-space-3)', background: `var(--au-color-surface-${level})`, color: 'var(--au-ink-2)' }}>Surface {level}</div>)}
            </div>
          </div>
          <p style={caption}>Controls · try typing, hovering & focusing</p>
          <AuField label="Sample name" hint="Preview only; edits stay in this specimen.">
            <AuInput aria-label="Sample name" value={sample} onAuInput={event => setSample((event.currentTarget as HTMLElement & { value: string }).value)} />
          </AuField>
          <AuField label="Validation example" error="Enter a sample value.">
            <AuInput aria-label="Validation example" error placeholder="Required value" />
          </AuField>
          <AuField label="Sample view" hint="Open to compare the floating menu with this specimen.">
            <AuSelect value={selected} options={['Overview', 'Details'].map(label => ({value:label,label}))}
              onAuChange={event => setSelected(event.detail.value)} />
          </AuField>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--au-space-2)' }}>
            <AuButton variant="cta" onAuActivate={() => setSample('Sample workspace')}>Reset sample</AuButton>
            <AuButton variant="outline" onAuActivate={() => setSelected(selected === 'Overview' ? 'Details' : 'Overview')}>Select next</AuButton>
            <AuButton disabled>Disabled</AuButton>
          </div>
          <div role="group" aria-label="Sample selection" style={{ ...stack, gap: 'var(--au-space-1)' }}>
            {['Overview', 'Details'].map(name => <AuListRow key={name} primary={name} secondary={name === selected ? 'Selected row' : 'Select to compare'} interactive selected={name === selected} role="button" aria-pressed={name === selected ? 'true' : 'false'} onClick={() => setSelected(name)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(name) } }} />)}
            <AuListRow primary="Unavailable" secondary="Disabled row" disabled />
          </div>
        </div>
        <div style={stack}>
          <p style={caption}>Editor syntax</p>
          <div style={{ minWidth: 0, overflowX: 'auto' }}><AuCodeSample /></div>
          <p style={caption}>Terminal · static ANSI sample</p>
          <AuCodeBlock language="ANSI" copy={false}>
            <div style={{ ...stack, padding: 'var(--au-space-3)', fontFamily: 'var(--au-font-mono)', fontSize: 'var(--au-t-xs)' }}>
              <div><span style={{ color: 'var(--au-terminal-green)' }}>✓ ready</span>{'  '}<span style={{ color: 'var(--au-terminal-yellow)' }}>! warning</span>{'  '}<span style={{ color: 'var(--au-terminal-red)' }}>× error</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 'var(--au-space-1)' }}>
                {['', 'bright-'].flatMap(tone => ansi.map(color => <span key={`${tone}${color}`} title={`${tone}${color}`} aria-label={`ANSI ${tone}${color}`} style={{ display: 'block', height: 'var(--au-space-4)', background: `var(--au-terminal-${tone}${color})` }} />))}
              </div>
              <span style={{ color: 'var(--au-ink-3)' }}>Normal and bright colors · no session</span>
            </div>
          </AuCodeBlock>
          <p style={caption}>Popover material</p>
          <div style={{ padding: 'var(--au-space-3)', background: 'var(--au-color-surface-1)' }}>
            <AuPopover arrow={false} heading="Floating surface">
              <span>Material, border and shadow follow this theme.</span>
              <span style={{ color: 'var(--au-ink-3)' }}>A static sample of the shared popover.</span>
            </AuPopover>
          </div>
        </div>
      </div>
    </section>
  )
}
