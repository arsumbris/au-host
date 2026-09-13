import { AVATAR_CHOICES } from './avatars'
import type { AvatarKind } from './avatar-config'

export const PICKER_STYLE = `
.avatar-picker { position:absolute; top:var(--au-space-1); right:var(--au-space-1); z-index:var(--au-z-raised); opacity:0; transition:opacity var(--au-m-fast) var(--au-e-std); }
*:hover > .avatar-picker, .avatar-picker:focus-within, .avatar-picker[open] { opacity:1; }
@media (hover:none) { .avatar-picker { opacity:1; } }
@media (prefers-reduced-motion:reduce) { .avatar-picker { transition:none; } }
`

/** The shared select owns popup placement, materials, rows, keyboard navigation and motion. */
export function createPicker(container: HTMLElement, character: AvatarKind, select: (kind: AvatarKind) => void): () => void {
  const menu = document.createElement('au-select') as HTMLElement & {options: typeof AVATAR_CHOICES; value: AvatarKind; label: string}
  menu.className = 'avatar-picker'
  menu.setAttribute('trigger-icon', 'edit')
  menu.setAttribute('size', 'sm')
  menu.label = 'Companion character'
  menu.options = AVATAR_CHOICES
  menu.value = character
  const change = (event: Event): void => {
    const value = (event as CustomEvent<{value: string}>).detail.value
    const choice = AVATAR_CHOICES.find(choice => choice.value === value)
    if (choice) select(choice.value)
  }
  menu.addEventListener('au-change', change)
  container.append(menu)
  return () => {menu.removeEventListener('au-change', change);menu.remove()}
}
