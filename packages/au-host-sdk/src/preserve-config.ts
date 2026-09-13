/**
 * Preserve config fields the container does not own.
 * A serializer supplies the names of its own fields and their current values. The remaining input
 * fields pass through unchanged, so layout edits preserve composition metadata.
 *
 * Subtract owned keys before merging the output: a serializer must be able to remove one of its
 * own fields, and spreading the entire input would restore a stale value.
 */

/**
 * Re-emit the fields of `input` that `owned` does not name, merged UNDER `output`.
 *
 * `owned` must list every key the container itself writes — including ones it only writes
 * conditionally (`leftCollapsed` when true, `sizes` when resized), because a conditional write is
 * exactly the case where the stale value must not come back.
 *
 * `type` is always treated as owned: the parent re-stamps it and a container never carries a foreign
 * one through.
 */
export function preserveUnowned<T extends object>(
  input: unknown,
  output: T,
  owned: readonly string[],
): T {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return output;
  const ownedSet = new Set<string>([...owned, 'type']);
  const carried: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!ownedSet.has(key)) carried[key] = value;
  }
  // `output` last: a field the container DOES own always wins over whatever arrived.
  return { ...carried, ...output };
}
