import type { WireContributionValue } from '@arsumbris/au-host-sdk/engine-reads'

export class TupleValue {
  constructor(readonly items: unknown[], readonly brand?: string) {}
}
export class BrandedValue {
  constructor(readonly value: unknown, readonly brand: string) {}
}

/** Preserve resolved value distinctions without exposing transport discriminators as document fields. */
export function contributionValue(value: WireContributionValue): unknown {
  switch (value.kind) {
    case 'reference': {
      const block = value.block_id ? `${value.block_id.referent ? '^^' : '^'}${value.block_id.id}` : ''
      return `[[${value.target}${value.repo || value.commit ? `::${value.repo ?? ''}` : ''}${value.commit ? `@${value.commit}` : ''}${value.anchor ? `#${value.anchor}` : ''}${block}]]`
    }
    case 'scalar': return value.brand ? new BrandedValue(value.value, value.brand) : value.value
    case 'tuple': return new TupleValue(value.elements.map(element => element.brand ? new BrandedValue(contributionValue(element.value), element.brand) : contributionValue(element.value)), value.brand)
    case 'inline_record': return Object.fromEntries(value.fields.map(field => [field.field, field.values.map(contributionValue)]))
    case 'malformed_reference': case 'malformed_constructor': return value.raw
  }
}
