/** JSON.stringify with all object keys sorted recursively — makes the serialization depend only
 *  on content, never on property insertion order, so two structurally-identical objects always
 *  produce the same string (arrays keep their order, since order is meaningful there).
 *
 *  Guards against hash collisions and crashes from JavaScript type quirks:
 *    - `undefined` → `null` (was colliding with the string "undefined")
 *    - `Date` → ISO string (was silently becoming `{}`)
 *    - `BigInt` → `null` (was throwing TypeError)
 *    - `Symbol` → `null` (was throwing TypeError)
 *    - `Map`/`Set` → insertion-order-independent sorted array (a `Map`/`Set` has no enumerable
 *      own keys, so without this they'd silently serialize as `{}` and drop their contents from
 *      any hash computed over them; sorted so two Maps/Sets with the same elements in different
 *      insertion order still hash identically, same guarantee `Object.keys(...).sort()` below
 *      gives plain objects) */
export function stableStringify(value: unknown): string {
  if (value === undefined) return JSON.stringify(null);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'bigint' || typeof value === 'symbol') return JSON.stringify(null);
  if (value instanceof Map) {
    const entries = [...value.entries()].sort((a, b) => stableStringify(a[0]).localeCompare(stableStringify(b[0])));
    return stableStringify(entries);
  }
  if (value instanceof Set) {
    const items = [...value.values()].sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
    return stableStringify(items);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
