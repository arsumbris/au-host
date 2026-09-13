import { describe, expect, it } from 'vitest'

import type { MountHost } from '../src/index.ts'
import type { WireReader } from '@arsumbris/au-engine-sdk/reads'
import type { TypedSubscriber } from '@arsumbris/au-engine-sdk/subscriptions'

// The host engine surface is compatible with au-engine-sdk's typed read and subscribe helpers,
// so projections can use those helpers with host.engine directly.
type _MountEngineIsReader = MountHost['engine'] extends WireReader ? true : never
type _MountEngineIsTyped = MountHost['engine'] extends TypedSubscriber ? true : never
const _readerOk: _MountEngineIsReader = true
const _typedOk: _MountEngineIsTyped = true
void _readerOk
void _typedOk

describe('mount contract compatibility with au-engine-sdk helpers', () => {
  it('keeps MountHost.engine structurally a WireReader and TypedSubscriber', () => {
    // The guarantee is the two type aliases above; this asserts they compiled.
    expect(_readerOk && _typedOk).toBe(true)
  })
})
