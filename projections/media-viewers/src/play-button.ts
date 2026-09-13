/** Shared media composition affordance; the component owns focus, tooltip and activation. */
export function playButton(activate: () => void): { element: HTMLElement; playing: (value: boolean) => void } {
  const element = document.createElement('au-icon-button')
  element.setAttribute('size', 'lg'); element.className = 'mv-play-button'
  const playing = (value: boolean) => {
    element.setAttribute('label', value ? 'Pause' : 'Play')
    element.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">${value ? '<path d="M6 4h4v16H6zm8 0h4v16h-4z"/>' : '<path d="M7 3.5v17L21 12z"/>'}</svg>`
  }
  element.addEventListener('au-activate', activate); playing(false)
  return { element, playing }
}
