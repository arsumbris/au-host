import { type Viewer, type ViewState } from './viewers'

const rates = [.5, .75, 1, 1.25, 1.5, 2]
const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value! : fallback

export function createVideoViewer(url: string, name: string, state: ViewState, save: (state: ViewState) => void, status: (message: string, failed?: boolean) => void): Viewer {
  const element = document.createElement('div'); element.className = 'mv-stage mv-video'; element.tabIndex = 0; element.setAttribute('aria-label', `${name} preview`)
  const media = document.createElement('video'); media.controls = true; media.playsInline = true; media.preload = 'metadata'; media.setAttribute('aria-label', name); element.append(media)
  const playback = document.createElement('div'); playback.className = 'mv-video-tools'; playback.setAttribute('role', 'group'); playback.setAttribute('aria-label', 'Playback')
  const label = document.createElement('span'); label.textContent = 'Speed'
  const speed = document.createElement('au-select') as HTMLElement & { value: string; options: {value: string; label: string}[] }
  speed.setAttribute('label', 'Playback speed'); speed.setAttribute('size', 'sm'); speed.setAttribute('disabled', '')
  speed.options = rates.map(rate => ({value: String(rate), label: `${rate}×`}))
  speed.value = String(rates.includes(state.rate ?? 1) ? state.rate ?? 1 : 1)
  playback.append(label, speed)
  let alive = true, ready = false
  const persist = () => { if (alive && ready) save({time: media.currentTime, volume: media.volume, rate: media.playbackRate}) }
  const fit = () => {
    if (!alive || !media.videoWidth || !media.videoHeight) return
    const style = getComputedStyle(element)
    const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const height = element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    if (width <= 0 || height <= 0) return
    const scale = Math.min(width / media.videoWidth, height / media.videoHeight)
    media.style.width = `${media.videoWidth * scale}px`; media.style.height = `${media.videoHeight * scale}px`
  }
  const observer = new ResizeObserver(fit); observer.observe(element)
  media.onloadedmetadata = () => {
    if (!alive) return
    media.volume = Math.max(0, Math.min(1, finite(state.volume, 1))); media.playbackRate = Number(speed.value)
    if (Number.isFinite(media.duration)) media.currentTime = Math.max(0, Math.min(finite(state.time, 0), media.duration))
    ready = true; speed.removeAttribute('disabled'); fit()
    status(`${media.videoWidth} × ${media.videoHeight} px · Space play/pause · ← / → seek 5 seconds`)
  }
  media.onresize = fit
  media.ontimeupdate = media.onvolumechange = media.onratechange = persist
  media.onerror = () => {
    if (!alive) return
    ready = false; speed.setAttribute('disabled', '')
    status('The video could not be loaded. Retry, or open it externally.', true)
  }
  speed.addEventListener('au-change', () => { if (ready && rates.includes(Number(speed.value))) media.playbackRate = Number(speed.value) })
  function togglePlayback(): void {
    if (!alive || !ready) return
    if (media.paused) void media.play().catch((error: unknown) => {
      // Pausing while play() is pending is a normal cancellation, not a playback failure.
      if (alive && !(media.paused && error instanceof DOMException && error.name === 'AbortError'))
        status('Playback could not start. Try the player controls.')
    })
    else media.pause()
  }
  element.onkeydown = event => {
    if (event.target !== element || !ready) return
    if (event.code === 'Space') {
      event.preventDefault(); togglePlayback()
    } else if (['ArrowLeft', 'ArrowRight'].includes(event.key) && Number.isFinite(media.duration)) {
      event.preventDefault(); media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + (event.key === 'ArrowRight' ? 5 : -5)))
    }
  }
  media.src = url
  return {element, controls: [playback], destroy: () => {
    if (!alive) return
    persist(); alive = false; observer.disconnect()
    media.onloadedmetadata = media.onresize = media.ontimeupdate = media.onvolumechange = media.onratechange = media.onerror = null
    media.pause(); media.removeAttribute('src'); media.load()
  }}
}
