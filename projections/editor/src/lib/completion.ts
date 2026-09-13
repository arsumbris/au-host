/**
 * Ctrl+space completion: one source that dispatches on the caret context.
 *
 * Every candidate list comes from an ENGINE read. Where the engine cannot answer — a cold
 * daemon, an unresolved claim, a primitive-shaped field — the source returns no
 * candidates rather than inventing any.
 *
 * ONE source, not N racing: the context decides the branch, so two sources can
 * never both claim a position.
 */

import {
  autocompletion,
  startCompletion,
  type Completion,
  type CompletionContext as CmContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import {
  readAnchors,
  readBlockIds,
  readFiles,
  readInstancesOf,
  readMembers,
  readResolveMember,
  readSubtypes,
  readTypeClosure,
  readTypes,
  type WireClosureField,
  type WireReader,
  type WireShape,
} from '@arsumbris/au-host-sdk/engine-reads'

import { completionContext, type FrontmatterContext, type WikilinkContext } from './completion-context'

/** What the source needs from the mount: the engine, and which file is open. */
export interface CompletionDeps {
  engine: WireReader
  /** The open path, or null before a file is opened. */
  path: () => string | null
}

/**
 * A type-def file's top-level keys are the engine's reserved set, NOT a claimed
 * type's fields. Offering instance fields here would be actively wrong, so the
 * two branch on the path.
 */
function isTypeDefPath(path: string): boolean {
  return /\.type\.ya?ml$/.test(path) || path.endsWith('.yamls') || /(^|\/)type\//.test(path)
}

/** The reserved type-def keys, with the engine's own one-line meaning. */
const TYPE_DEF_KEYS: Completion[] = [
  { label: 'type', type: 'property', detail: 'parent claim', info: 'The parent type-def(s) this type extends. Width-only: a subtype only adds.' },
  { label: 'fields', type: 'property', detail: 'own declarations', info: 'This type\'s own field declarations. A type with no fields is a tag.' },
  { label: 'sealed', type: 'property', detail: 'closed branch set', info: 'The permitted branches. Makes this a sealed parent: non-claimable, closed.' },
  { label: 'abstract', type: 'property', detail: 'non-claimable marker', info: 'true marks the type non-claimable but open to any subtype.' },
  { label: 'meta', type: 'property', detail: 'type-level metadata', info: 'Type-level metadata. Never flows into an instance. [] suppresses inheritance.' },
  { label: 'body', type: 'property', detail: 'prose template', info: 'An ordered authoring template for instance prose. Forces .md instances.' },
]

/**
 * Field names for the claimed type: its EFFECTIVE fields, own plus inherited.
 *
 * The engine's `type_closure` read is authoritative here — a client-side parent
 * walk gets mixin-collision and auto-unify subtly wrong, and the closure read is
 * the same walk the validator runs.
 */
async function frontmatterKeys(deps: CompletionDeps, ctx: FrontmatterContext): Promise<Completion[]> {
  if (ctx.claim.length === 0) return [] // unclaimed: no shape to offer against
  const used = new Set(ctx.usedKeys)
  const seen = new Map<string, WireClosureField>()

  // A claim is MULTI-FIT: a bare name can match one identity per mounted repo, so
  // the read answers an array. Every identity's fields are legitimate candidates.
  for (const claim of ctx.claim) {
    const closure = await readTypeClosure(deps.engine, claim)
    if (!('ready' in closure) || !closure.ready) continue
    for (const entry of closure.result) {
      for (const field of entry.fields) {
        if (used.has(field.name) || seen.has(field.name)) continue
        seen.set(field.name, field)
      }
    }
  }

  return [...seen.values()].map((f) => ({
    label: f.name,
    type: 'property',
    // The shape is what the author needs next, so it leads. A required-but-absent
    // field is the highest-value suggestion, so it says so and sorts first.
    detail: f.required ? `${f.shape} · required` : f.shape,
    info: f.doc,
    boost: f.required ? 1 : 0,
    // The key is being typed, so complete it with its colon and a space.
    apply: `${f.name}: `,
  }))
}

/**
 * An inert row carrying a reason, rendered where the candidates would be.
 *
 * The menu's own status line: `apply` is a no-op, so Enter dismisses without
 * inserting, and `type` marks it for the theme. Used wherever "no candidates"
 * would otherwise be misread — an unresolved target must not look like a file
 * with no headings, and a dead keybinding must not look like an empty slot.
 */
function statusRow(reason: string): Completion {
  return { label: reason, type: 'au-status', apply: () => {}, boost: -99 }
}

/** The stem a wikilink resolves by: the basename minus one extension. */
function stemOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/**
 * Wrap a wikilink for a YAML value position.
 *
 * A reference value is conventionally quoted (`"[[target]]"`) — bare `[[x]]` is a
 * YAML flow sequence. `quoted` reports that the author already opened one, so the
 * completion does not double it.
 */
function asValueLink(target: string, quoted: boolean): string {
  return quoted ? `[[${target}]]` : `"[[${target}]]"`
}

/** Instances of a type, offered as wikilinks. The engine resolves by stem. */
async function instanceLinks(deps: CompletionDeps, type: string, quoted: boolean): Promise<Completion[]> {
  const out = await readInstancesOf(deps.engine, type, { origins: ['file'] })
  if (!('ready' in out) || !out.ready) return []
  return out.result.map((m) => ({
    label: stemOf(m.path),
    type: 'variable',
    // The path disambiguates two files sharing a stem, which is exactly the
    // `reference-target-ambiguous` case the author would otherwise author into.
    detail: m.path,
    apply: asValueLink(stemOf(m.path), quoted),
  }))
}

/** Type-defs under a bound, for a `type<T>*` def-ref slot. */
async function defLinks(deps: CompletionDeps, bound: string, quoted: boolean): Promise<Completion[]> {
  const out = await readSubtypes(deps.engine, bound)
  if (!('ready' in out) || !out.ready) return []
  return out.result.subtypes.map((t) => ({
    label: t.name,
    type: 'type',
    detail: t.repo,
    apply: asValueLink(t.name, quoted),
  }))
}

/**
 * Candidates for a slot, by its parsed shape.
 *
 * The shape decides what can be offered at all. Where it does not close over a
 * candidate set — a String, a bare `any`, an inline record — the honest answer is
 * nothing. Inventing values is worse than an empty menu.
 */
async function shapeValues(deps: CompletionDeps, shape: WireShape, quoted: boolean): Promise<Completion[]> {
  switch (shape.kind) {
    case 'enum':
      // Exact, closed, the best case.
      return shape.members.map((m) => ({ label: m, type: 'enum', apply: m }))

    case 'primitive':
      // A primitive does not close over a value set, so nothing is offerable —
      // except Boolean, whose set is exactly two.
      return shape.name === 'Boolean'
        ? [{ label: 'true', type: 'keyword' }, { label: 'false', type: 'keyword' }]
        : []

    case 'reference':
    case 'inline-or-reference':
      // `file` and `any` are the built-in no-closure targets: they admit every
      // file / node, so there is no type to enumerate instances of.
      return shape.name === 'file' || shape.name === 'any' ? [] : instanceLinks(deps, shape.name, quoted)

    case 'compound-reference':
      return (await Promise.all(shape.branches.map((b) => instanceLinks(deps, b, quoted)))).flat()

    case 'def-reference':
      if (shape.bound === undefined) return [] // unconstrained `type*`: every def, no ceiling to read from
      return shape.bound.kind === 'single'
        ? defLinks(deps, shape.bound.name, quoted)
        : (await Promise.all(shape.bound.branches.map((b) => defLinks(deps, b, quoted)))).flat()

    // Both wrappers pass through to what they wrap: a list element and a pinned
    // value are still values of the inner shape.
    case 'list':
    case 'pinned':
      return shapeValues(deps, shape.inner, quoted)

    case 'union':
    case 'intersection':
      return (await Promise.all(shape.branches.map((b) => shapeValues(deps, b, quoted)))).flat()

    // `record` takes an inline record, not a scalar; `any` interprets nothing. `refined`
    // (`Base{predicate}`, schema 27) closes over no offerable set like its primitive base —
    // and the engine never refines Boolean, the one primitive that would have one.
    case 'record':
    case 'any':
    case 'refined':
      return []

    default:
      // Any other shape kind closes over no offerable value set — the honest answer is nothing
      // (inventing values is worse than an empty menu), and this keeps the function total.
      return []
  }
}

/** The declared shape of one field of the claimed type, or null. */
async function fieldShape(deps: CompletionDeps, claims: string[], field: string): Promise<WireShape | null> {
  for (const claim of claims) {
    const closure = await readTypeClosure(deps.engine, claim)
    if (!('ready' in closure) || !closure.ready) continue
    for (const entry of closure.result) {
      const f = entry.fields.find((x) => x.name === field)
      if (f?.shape_ast) return f.shape_ast
    }
  }
  return null
}

/** Values for the field being filled. */
async function frontmatterValues(deps: CompletionDeps, ctx: FrontmatterContext): Promise<Completion[]> {
  if (ctx.claim.length === 0) return []
  const shape = await fieldShape(deps, ctx.claim, ctx.field)
  // No shape means the field is an extra, or the claim did not resolve. Both are
  // legitimate open-world states, and neither closes over a candidate set.
  return shape === null ? [] : shapeValues(deps, shape, ctx.quoted)
}

/**
 * The type claim itself.
 *
 * Two gates decide the candidate SET, and both exist to stop completion writing a
 * diagnostic for you.
 *
 * THE PEER GATE. Crossing a peer's type needs that repo declared as a `dep`. A
 * member merely mounted for `discover` is NOT crossable: naming it fires
 * `type-repo-not-a-dependency`. So qualifying is not what makes a peer claim
 * legal — being a dep is. A non-dep member is left out of the menu entirely.
 *
 * NON-CLAIMABLE TYPES. On an INSTANCE a sealed parent fires `sealed-parent-claimed`
 * and an abstract type fires `abstract-type-claimed`, so neither is offered. On a
 * type-DEF the same `type:` key is a PARENT claim, where both are not just legal
 * but the point, so there the filter lifts.
 */
async function typeClaims(
  deps: CompletionDeps,
  ctx: FrontmatterContext,
  path: string | null,
): Promise<Completion[]> {
  const [types, members, owner] = await Promise.all([
    readTypes(deps.engine),
    readMembers(deps.engine),
    path === null ? null : readResolveMember(deps.engine, path),
  ])
  if (!('ready' in types) || !types.ready) return []

  const ownRepo = owner !== null && 'ready' in owner && owner.ready ? owner.result?.repo : undefined
  // An unknown owner must not silently filter everything out. Nothing is own-repo,
  // so the dep gate would drop every entry and edit type and leave an empty menu
  // that reads as "no types exist". The file is simply outside the served
  // workspace, which is worth saying.
  if (ownRepo === undefined) {
    return [statusRow(path === null ? 'no file open' : 'this file is not in the served workspace')]
  }
  const crossable = new Set(
    'ready' in members && members.ready ? members.result.filter((m) => m.role === 'dep').map((m) => m.repo) : [],
  )
  const parentPosition = path !== null && isTypeDefPath(path)
  const claimed = new Set(ctx.claim)

  const out: Completion[] = []
  for (const t of types.result) {
    if (!parentPosition && (t.abstract || t.sealed !== null)) continue
    const own = t.repo === ownRepo
    if (!own && !crossable.has(t.repo)) continue
    // Bare is canonical in your own repo; a peer's type must carry its `::repo`.
    const label = own ? t.name : `${t.name}::${t.repo}`
    if (claimed.has(label)) continue // a repeated claim is `duplicate-claim`
    out.push({ label, type: 'type', detail: own ? undefined : t.repo, info: t.doc, apply: label })
  }
  return out
}

/** Offer wikilink candidates through the engine listing corresponding to each
 * fragment's resolve operation, keeping offered and validated values consistent. */
async function wikilinkLinks(
  deps: CompletionDeps,
  ctx: WikilinkContext,
  path: string | null,
): Promise<Completion[]> {
  const origin = path ?? undefined

  if (ctx.slot === 'target') {
    // The catalogue IS the resolvable set. `scope` defaults to `all` here, which
    // inverts the actionability reads: a wikilink into a dependency is legal, so
    // narrowing to `own` would hide targets the validator accepts.
    const out = await readFiles(deps.engine)
    if (!('ready' in out) || !out.ready) return []
    return out.result.map((f) => ({
      label: f.stem,
      type: f.kind === 'asset' ? 'variable' : 'file',
      // A stem is NOT unique. Two files sharing one are an ambiguous bare target,
      // exactly `reference-target-ambiguous`, so the path is shown to disambiguate.
      detail: f.path,
      apply: f.stem,
    }))
  }

  if (ctx.slot === 'repo') {
    // A plain VALUE link is NOT peer-gated: any workspace member is reachable.
    // Only a TYPE crossing needs a declared dep, which is why this set is wider
    // than the one `typeClaims` offers.
    const out = await readMembers(deps.engine)
    if (!('ready' in out) || !out.ready) return []
    return out.result.map((m) => ({ label: m.repo, type: 'namespace', detail: m.role, apply: m.repo }))
  }

  // Both listings key off the wikilink TARGET, not a path — the same address space
  // the resolve verbs take, which is what the caret context already hands us.
  const target = ctx.parts.target

  if (ctx.slot === 'anchor') {
    const out = await readAnchors(deps.engine, target, origin)
    if (!('ready' in out) || !out.ready) return []
    // NULL and EMPTY are different answers. Null is an unresolved target (a typo,
    // or mid-word); empty is a file that resolved and has no headings. Showing the
    // same blank menu for both would teach "this file has no headings" for a typo.
    if (out.result === null) return [statusRow(`no file resolves to "${target}"`)]
    return out.result.map((a) => ({
      label: a.text,
      type: 'text',
      detail: '#'.repeat(a.level),
      // `text` already excludes a trailing `^id` marker, so it inserts as-is.
      apply: a.text,
    }))
  }

  if (ctx.slot === 'block') {
    const out = await readBlockIds(deps.engine, target, origin)
    if (!('ready' in out) || !out.ready) return []
    if (out.result === null) return [statusRow(`no file resolves to "${target}"`)]
    // A `^^` block-referent demands a TYPED value, satisfied by `record` and
    // `typed_block` but never by `marker`, which is navigational only. Typedness
    // rides `kind`; a bare `^` filters nothing.
    const usable = ctx.referent ? out.result.filter((b) => b.kind !== 'marker') : out.result
    // The read lists every OCCURRENCE, duplicates included, so that a duplicate id
    // stays visible as `block-id-duplicate` reports it. One menu row per id, though.
    const seen = new Set<string>()
    return usable.flatMap((b) =>
      seen.has(b.id)
        ? []
        : (seen.add(b.id),
          [
            {
              label: b.id,
              type: 'variable',
              // The block's own claim is what a `^^` reference is checked against,
              // so it is the useful detail. A mixin claims several.
              detail: b.type_claim?.length ? b.type_claim.join(', ') : b.kind,
              apply: b.id,
            },
          ]),
    )
  }

  return []
}

/**
 * The dispatch: caret context to candidates. Exported so it is testable without
 * a CodeMirror view — the editor half is only the range and the trigger.
 *
 * An empty array means "nothing meaningful here", which is a normal answer, not
 * a failure: prose, a primitive-shaped field, a cold daemon, an unresolved claim.
 */
export async function completionsFor(
  deps: CompletionDeps,
  before: string,
  path: string | null,
): Promise<Completion[]> {
  const ctx = completionContext(before)
  if (ctx === null) return []

  if (ctx.kind === 'frontmatter') {
    if (ctx.slot === 'nested') return [] // an inline record's fields are its own type's, not the claim's
    if (ctx.slot === 'key') {
      return path !== null && isTypeDefPath(path) ? TYPE_DEF_KEYS : frontmatterKeys(deps, ctx)
    }
    if (ctx.slot === 'value') return frontmatterValues(deps, ctx)
    if (ctx.slot === 'type') return typeClaims(deps, ctx, path)
    return []
  }
  return wikilinkLinks(deps, ctx, path)
}

/** What the caret was recognised as, for a reason the user can act on. */
function describeSlot(ctx: NonNullable<ReturnType<typeof completionContext>>): string {
  if (ctx.kind === 'wikilink') {
    return ctx.slot === 'target' ? 'file' : ctx.slot === 'block' ? 'block-id' : ctx.slot
  }
  return ctx.slot === 'key' ? 'field' : ctx.slot === 'type' ? 'type' : `${ctx.field} value`
}

/**
 * Why an explicit invocation found nothing.
 *
 * A cold daemon and a genuinely empty slot look identical from the caret, and the
 * user cannot tell them apart from an empty menu — so one cheap read separates
 * them before blaming the content.
 */
async function explainEmpty(
  deps: CompletionDeps,
  ctx: ReturnType<typeof completionContext>,
): Promise<string> {
  // The probe is itself a read, so it throws on a dead socket like any other.
  // Guarded here rather than at the call site: a failure to explain must never
  // become the error the explanation exists to prevent.
  try {
    const probe = await readMembers(deps.engine)
    if (!('ready' in probe) || !probe.ready) return 'engine not connected'
  } catch {
    return 'engine not connected'
  }
  if (ctx === null) return 'nothing to complete here'
  return `no ${describeSlot(ctx)} suggestions here`
}

/** Explicit completion always returns an answer, because an empty response would
 * look like an inactive keybinding. Automatic frontmatter completion stays quiet
 * when no useful candidates are available. */
export function makeSource(deps: CompletionDeps) {
  return async function auCompletionSource(cm: CmContext): Promise<CompletionResult | null> {
    const before = cm.state.doc.sliceString(0, cm.pos)
    const ctx = completionContext(before)

    let options: Completion[] = []
    try {
      if (ctx !== null) options = await completionsFor(deps, before, deps.path())
    } catch {
      // A dead socket throws rather than answering. Never surface it as an error
      // popup over the buffer; an explicit invocation gets the reason row below.
      options = []
    }

    const from = cm.pos - (ctx?.query.length ?? 0)
    if (options.length > 0) {
      // The query is ours to filter on; CM re-filters as the user keeps typing.
      return { from, options, validFor: /^[^\s\]]*$/ }
    }
    if (!cm.explicit) return null
    // No validFor: the reason must be recomputed on the next keystroke, not cached.
    return { from, options: [statusRow(await explainEmpty(deps, ctx))] }
  }
}

/**
 * Auto-open inside the `---` block only.
 *
 * The frontmatter block is a structured form, so offering the field list unasked
 * helps. The body is prose, where a menu appearing mid-sentence is noise, so it
 * stays explicit ctrl+space.
 */
const autoOpenInFrontmatter = EditorView.updateListener.of((update) => {
  if (!update.docChanged || update.state.selection.main.empty === false) return
  const pos = update.state.selection.main.head
  const before = update.state.doc.sliceString(0, pos)
  const ctx = completionContext(before)
  if (ctx === null || ctx.kind !== 'frontmatter') return
  startCompletion(update.view)
})

/**
 * The completion extension.
 *
 * `override` makes ours the only source, so nothing races it. `activateOnTyping`
 * is off globally; the frontmatter listener opts that region back in.
 */
export function auCompletion(deps: CompletionDeps): Extension {
  return [
    autocompletion({
      override: [makeSource(deps)],
      activateOnTyping: false,
      icons: false,
      // A status row is a reason, not a candidate. CM exposes no attribute for a
      // completion's `type` on the row, so the class is how the theme finds it.
      optionClass: (c) => (c.type === 'au-status' ? 'au-completion-status' : ''),
    }),
    autoOpenInFrontmatter,
  ]
}
