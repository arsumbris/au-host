export type Button = HTMLElement & { disabled: boolean; loading: boolean }
export type Select = HTMLElement & {
  value: string
  options: Array<{ value: string; label: string }>
}
export type Input = HTMLElement & { value: string }
export function button(
  text: string,
  action: () => void,
  variant = 'outline',
): Button {
  const el = document.createElement('au-button') as Button
  el.textContent = text
  el.setAttribute('size', 'sm')
  el.setAttribute('variant', variant)
  el.addEventListener('au-activate', action)
  return el
}
export function select(
  label: string,
  options: Select['options'],
  value: string,
  onChange: (value: string) => void,
): Select {
  const el = document.createElement('au-select') as Select
  el.setAttribute('label', label)
  el.setAttribute('size', 'sm')
  el.options = options
  el.value = value
  el.addEventListener('au-change', () => onChange(el.value))
  return el
}
export function text(
  tag: string,
  content: string,
  className = '',
): HTMLElement {
  const el = document.createElement(tag)
  el.textContent = content
  el.className = className
  return el
}
