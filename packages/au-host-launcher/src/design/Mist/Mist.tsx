import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { CSSProperties, ReactElement, Ref } from 'react'
import clsx from 'clsx'
import { mountMist, type MistHandle, type MistParams, type DissolveOptions, type SetParamsOptions } from './mistEngine'
import './Mist.css'

export type { MistHandle, MistParams, DissolveOptions, SetParamsOptions } from './mistEngine'
export { DEFAULT_MIST_PARAMS } from './mistEngine'

export interface MistProps {
  /** Read at MOUNT only, merged over DEFAULT_MIST_PARAMS. Live changes go through the ref's setParams. */
  params?: Partial<MistParams>
  /** Element to read the palette off. Default: document.documentElement. */
  root?: HTMLElement
  /** Re-read the palette on theme change. Default true. */
  watchTheme?: boolean
  className?: string
  style?: CSSProperties
}

/* Framework-agnostic engine, framework-thin shell: this owns the canvas element and the engine
 * lifecycle and NOTHING else — no per-frame React state, so animation never re-renders. The canvas is
 * `aria-hidden` because it is pure atmosphere. */
export const Mist = forwardRef(function Mist(
  { params, root, watchTheme, className, style }: MistProps,
  ref: Ref<MistHandle>,
): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const handleRef = useRef<MistHandle | null>(null)

  // Mount once. params/root/watchTheme are read at mount; live param changes go through the ref.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      handleRef.current = mountMist(canvas, { params, root, watchTheme })
    } catch (err) {
      // A shader compile/link failure throws with a clear message — surface it loudly, don't crash.
      console.error(err)
      handleRef.current = null
    }
    return () => {
      handleRef.current?.destroy()
      handleRef.current = null
    }
  }, [])

  useImperativeHandle(
    ref,
    (): MistHandle => ({
      setD: (d) => handleRef.current?.setD(d),
      getD: () => handleRef.current?.getD() ?? 0,
      dissolve: (o?: DissolveOptions) => handleRef.current?.dissolve(o) ?? Promise.resolve(),
      setParams: (p, o?: SetParamsOptions) => handleRef.current?.setParams(p, o),
      destroy: () => handleRef.current?.destroy(),
    }),
    [],
  )

  return <canvas ref={canvasRef} className={clsx('au-mist', className)} style={style} aria-hidden="true" />
})
