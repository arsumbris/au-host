import { playButton } from './play-button'
import type { Viewer, ViewState } from './viewers'

const rates = [.5, .75, 1, 1.25, 1.5, 2]
const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value! : fallback

export function createAudioViewer(url: string, name: string, state: ViewState, save: (state: ViewState) => void, status: (message: string, failed?: boolean) => void): Viewer {
  const element = document.createElement('div'); element.className = 'mv-stage mv-audio'; element.tabIndex = 0; element.setAttribute('aria-label', `${name} preview`)
  const content = document.createElement('div'); content.className = 'mv-listening'
  const title = document.createElement('h2'); title.className = 'mv-audio-title'; title.textContent = name.split('::')[0]
  const waveform = document.createElement('div'); waveform.className = 'mv-waveform'
  const hint = document.createElement('p'); hint.className = 'mv-waveform-hint'; hint.textContent = 'Waiting for audio…'; hint.setAttribute('role', 'status')
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 1000 120'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Audio waveform'); svg.classList.add('mv-waveform-image'); svg.setAttribute('hidden', '')
  const signal = document.createElementNS(ns, 'path'); signal.classList.add('mv-waveform-signal')
  const cursor = document.createElementNS(ns, 'line'); cursor.classList.add('mv-waveform-cursor'); cursor.setAttribute('y1', '0'); cursor.setAttribute('y2', '120')
  svg.append(signal, cursor); waveform.append(svg, hint)
  const media = document.createElement('audio'); media.hidden = true; media.preload = 'metadata'; media.setAttribute('aria-label', name)
  const options = document.createElement('div'); options.className = 'mv-audio-options'
  const speed = document.createElement('au-select') as HTMLElement & { value: string; options: { value: string; label: string }[] }
  speed.setAttribute('label', 'Playback speed'); speed.setAttribute('size', 'sm'); speed.setAttribute('disabled', '')
  speed.options = rates.map(rate => ({ value: String(rate), label: `${rate}×` })); speed.value = String(rates.includes(state.rate ?? 1) ? state.rate ?? 1 : 1)
  const icon = (label: string, path: string, action: () => void) => {
    const control = document.createElement('au-icon-button'); control.setAttribute('label', label); control.setAttribute('size', 'lg')
    control.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${path}</svg>`
    control.addEventListener('au-activate', action); return control
  }
  const toggle = () => { if (!ready) return; if (media.paused) void media.play().catch(() => { if (alive) status('Playback could not start. Try again.') }); else media.pause() }
  const playbackButton = playButton(toggle); const play = playbackButton.element
  const seekBy = (seconds: number) => { if (ready && Number.isFinite(media.duration)) { media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + seconds)); position(); persist() } }
  const back = icon('Back 5 seconds', '<path d="M4 9a8 8 0 1 1 0 6M4 3v6h6"/><text x="12" y="16" text-anchor="middle" fill="currentColor" stroke="none" font-size="11">5</text>', () => seekBy(-5))
  const forward = icon('Forward 5 seconds', '<path d="M20 9a8 8 0 1 0 0 6m0-12v6h-6"/><text x="12" y="16" text-anchor="middle" fill="currentColor" stroke="none" font-size="11">5</text>', () => seekBy(5))
  const speaker = '<path d="M11 4 5 9H2v6h3l6 5V4Z"/>'
  const sound = '<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'
  const mute = icon('Mute', speaker + sound, () => { if (ready) media.muted = !media.muted })
  type Slider = HTMLElement & { value: number; max: number }
  const slider = (label: string, max: number, step: string) => { const el = document.createElement('au-slider') as Slider; el.setAttribute('label', label); el.setAttribute('min', '0'); el.max = max; el.setAttribute('step', step); return el }
  const seek = slider('Playback position', 1, '.01'), volume = slider('Volume', 1, '.01')
  volume.value = Math.max(0, Math.min(1, finite(state.volume, 1)))
  seek.addEventListener('au-input', () => { if (ready) { media.currentTime = seek.value; position(); persist() } })
  volume.addEventListener('au-input', () => { if (ready) { media.volume = volume.value; media.muted = false } })
  const elapsed = document.createElement('span'), duration = document.createElement('span'); elapsed.textContent = duration.textContent = '0:00'
  const timeline = document.createElement('div'); timeline.className = 'mv-audio-timeline'; timeline.append(elapsed, seek, duration)
  const transport = document.createElement('div'); transport.className = 'mv-audio-transport'; transport.setAttribute('role', 'group'); transport.setAttribute('aria-label', 'Playback'); transport.append(back, play, forward)
  const loudness = document.createElement('div'); loudness.className = 'mv-audio-volume'; loudness.append(mute, volume)
  const speedLabel = document.createElement('span'); speedLabel.textContent = 'Speed'
  const speedGroup = document.createElement('div'); speedGroup.className = 'mv-audio-speed'; speedGroup.append(speedLabel, speed)
  const controls = [play, back, forward, mute, seek, volume, speed]
  for (const control of controls) control.setAttribute('disabled', '')
  options.append(transport, loudness, speedGroup); content.append(title, waveform, timeline, options, media); element.append(content)
  const clock = (seconds: number) => { const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}` }

  let alive = true, ready = false, waveformReady = false, waveformRequested = false
  const abort = new AbortController()
  const persist = () => { if (alive && ready) save({ time: media.currentTime, volume: media.volume, rate: media.playbackRate }) }
  const position = () => {
    const x = Number.isFinite(media.duration) && media.duration > 0 ? media.currentTime / media.duration * 1000 : 0
    seek.value = Number.isFinite(media.currentTime) ? media.currentTime : 0; elapsed.textContent = clock(media.currentTime); duration.textContent = clock(media.duration)
    cursor.setAttribute('x1', String(x)); cursor.setAttribute('x2', String(x))
  }
  const draw = async () => {
    hint.textContent = 'Loading waveform…'
    try {
      // A preview must not decode an unbounded recording into renderer memory.
      if (!Number.isFinite(media.duration) || media.duration > 300) throw new Error('length')
      const response = await fetch(url, { signal: abort.signal })
      if (!response.ok || !response.body) throw new Error('asset')
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0
      try {
        while (true) {
          const { value, done } = await reader.read(); if (done) break
          length += value.byteLength
          if (length > 32 * 1024 * 1024) { await reader.cancel(); throw new Error('size') }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      const bytes = new Uint8Array(length); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      if (!alive) return
      const context = new OfflineAudioContext(1, 1, 48000)
      const buffer = await context.decodeAudioData(bytes.buffer)
      if (!alive) return
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel))
      const count = 500; const paths: string[] = []
      for (let bar = 0; bar < count; bar++) {
        const start = Math.floor(bar * buffer.length / count), end = Math.floor((bar + 1) * buffer.length / count)
        let peak = 0
        for (const channel of channels) for (let sample = start; sample < end; sample++) peak = Math.max(peak, Math.abs(channel[sample]))
        const amplitude = Math.min(1, peak) * 58
        paths.push(`M${bar * 2 + 1},${60 - amplitude}v${amplitude * 2}`)
      }
      signal.setAttribute('d', paths.join('')); svg.removeAttribute('hidden'); waveformReady = true; hint.hidden = true; position()
    } catch (error) {
      if (!alive) return
      hint.textContent = error instanceof Error && ['length', 'size'].includes(error.message)
        ? 'Waveform preview is limited to recordings up to 5 minutes and 32 MB. You can still use the player.'
        : 'Waveform unavailable. You can still use the player.'
    }
  }
  speed.addEventListener('au-change', () => { if (ready && rates.includes(Number(speed.value))) media.playbackRate = Number(speed.value) })
  media.onloadedmetadata = () => {
    if (!alive) return
    media.volume = Math.max(0, Math.min(1, finite(state.volume, 1))); media.playbackRate = Number(speed.value)
    if (Number.isFinite(media.duration)) media.currentTime = Math.max(0, Math.min(finite(state.time, 0), media.duration))
    ready = true; seek.max = Number.isFinite(media.duration) ? media.duration : 1; for (const control of controls) control.removeAttribute('disabled'); status('Space to play / pause · ← / → to seek 5 seconds'); position(); if (!waveformRequested) { waveformRequested = true; void draw() }
  }
  media.ontimeupdate = () => { position(); persist() }; media.onratechange = persist
  media.onvolumechange = () => { volume.value = media.muted ? 0 : media.volume; mute.setAttribute('label', media.muted ? 'Unmute' : 'Mute'); mute.querySelector('svg')!.innerHTML = speaker + (media.muted || media.volume === 0 ? '<path d="m16 9 6 6m0-6-6 6"/>' : sound); persist() }
  media.onplay = () => playbackButton.playing(true); media.onpause = media.onended = () => playbackButton.playing(false)
  media.onerror = () => {
    if (!alive) return
    ready = false; for (const control of controls) control.setAttribute('disabled', ''); abort.abort(); hint.textContent = 'Audio unavailable'
    status('The audio could not be loaded. Retry, or open it externally.', true)
  }
  svg.onclick = event => {
    if (!ready || !waveformReady || !Number.isFinite(media.duration)) return
    const rect = svg.getBoundingClientRect()
    if (rect.width > 0) media.currentTime = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * media.duration
    position(); persist()
  }
  element.onkeydown = event => {
    if (event.target !== element || !ready) return
    if (event.code === 'Space') { event.preventDefault(); if (media.paused) void media.play().catch(() => { if (alive) status('Playback could not start. Try the player controls.') }); else media.pause() }
    else if (['ArrowLeft', 'ArrowRight'].includes(event.key) && Number.isFinite(media.duration)) { event.preventDefault(); media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + (event.key === 'ArrowRight' ? 5 : -5))) }
  }
  media.src = url
  return { element, controls: [], destroy: () => {
    if (!alive) return
    persist(); alive = false; abort.abort()
    media.onloadedmetadata = media.ontimeupdate = media.onvolumechange = media.onratechange = media.onerror = media.onplay = media.onpause = media.onended = null
    media.pause(); media.removeAttribute('src'); media.load()
  } }
}
