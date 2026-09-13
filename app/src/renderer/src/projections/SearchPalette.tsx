import { AuCommandPalette } from '@arsumbris/au-component-catalog/react'

export interface PaletteOption { id: string; label: string; detail?: string; group?: string; icon?: string; shortcut?: string }

/** Search owns text and ordinary result navigation; dispatch stays with the authority. */
export function SearchPalette({items, placeholder, loading, onRun}: {
  items: PaletteOption[]
  placeholder: string
  loading?: boolean
  onRun(id:string): void
}): React.JSX.Element {
  return <AuCommandPalette className="cmd-palette-el" items={items} placeholder={placeholder} loading={loading} onAuRun={event=>onRun(String((event.detail as {id:string}).id))} />
}
