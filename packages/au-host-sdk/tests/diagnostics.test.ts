import { afterEach, describe, expect, it, vi } from 'vitest'

import { reportHostDiagnostic, setHostDiagnosticSink, type HostDiagnostic } from '../src/index.ts'

// A REPORT THAT NEVER ARRIVES IS THE BUG THIS SEAM EXISTS TO FIX.
//
// Four kernel sites report a framework-level problem through here (an invalid component-set meta,
// a missing notification-renderer export, a renderer that failed to load, a config emitting the
// wrong `type`). Every one of them is on an error path already, so if this seam silently dropped
// its input, nothing downstream would notice — which is precisely the "the code knew and had
// nowhere to say so" defect.
//
// So the properties worth pinning are the ones that fail INVISIBLY:
// - an installed sink actually receives the diagnostic.
// - with no sink, the console floor still fires, at a level matching severity.
// - a THROWING sink falls through to the floor instead of taking down the caller. A broken
//   surfacer must never swallow the diagnostic, and must never break the error path it sits on.

const diag = (over: Partial<HostDiagnostic> = {}): HostDiagnostic => ({
  code: 'test-code',
  severity: 'warning',
  message: 'something is off',
  ...over,
})

afterEach(() => {
  setHostDiagnosticSink(null)
  vi.restoreAllMocks()
})

describe('reportHostDiagnostic', () => {
  it('delivers to an installed sink', () => {
    const seen: HostDiagnostic[] = []
    setHostDiagnosticSink((d) => seen.push(d))

    reportHostDiagnostic(diag({ code: 'a-code', subject: 'my-type' }))

    expect(seen).toHaveLength(1)
    expect(seen[0].code).toBe('a-code')
    expect(seen[0].subject).toBe('my-type')
  })

  it('does not touch the console once a sink is installed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setHostDiagnosticSink(() => {})

    reportHostDiagnostic(diag())

    expect(warn).not.toHaveBeenCalled()
  })

  it('falls back to the console floor with no sink', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    reportHostDiagnostic(diag({ code: 'floor-code', subject: 'thing', message: 'boom' }))

    expect(warn).toHaveBeenCalledTimes(1)
    // The code is the CONTRACT, so it must survive into the floor's output — a reader greps it.
    expect(String(warn.mock.calls[0][0])).toContain('floor-code')
    expect(String(warn.mock.calls[0][0])).toContain('thing')
    expect(String(warn.mock.calls[0][0])).toContain('boom')
  })

  it('routes the floor by severity', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    reportHostDiagnostic(diag({ severity: 'error' }))
    reportHostDiagnostic(diag({ severity: 'warning' }))
    reportHostDiagnostic(diag({ severity: 'hint' }))

    expect(error).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledTimes(1)
  })

  it('survives a throwing sink, and still reports through the floor', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setHostDiagnosticSink(() => {
      throw new Error('surfacer is broken')
    })

    // The caller is already on an error path; a broken surfacer must not add a second failure.
    expect(() => reportHostDiagnostic(diag({ code: 'still-reported' }))).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('still-reported')
  })

  it('restores the floor when the sink is cleared', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const seen: HostDiagnostic[] = []
    setHostDiagnosticSink((d) => seen.push(d))
    reportHostDiagnostic(diag())
    expect(seen).toHaveLength(1)

    setHostDiagnosticSink(null)
    reportHostDiagnostic(diag())

    expect(seen).toHaveLength(1) // the cleared sink stops receiving
    expect(warn).toHaveBeenCalledTimes(1) // and the floor takes over
  })
})
