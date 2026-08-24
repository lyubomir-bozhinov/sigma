// Decoder for React Router v7's single-fetch (`/<path>.data`) turbo-stream payload.
//
// RRv7 serves the `.data` twin of a document route as a flat, de-duplicated value table (its
// vendored `turbo-stream` encoding): a JSON array where index 0 is the root value and every nested
// value is referenced by its index in the array. Objects are encoded as `{ "_<keyIndex>": valueIndex }`,
// arrays as `[index, …]`, primitives (string / number / boolean / literal `null`) inline, and a
// handful of NEGATIVE indices are sentinels for the JS values that JSON can't carry
// (`undefined` / `NaN` / `±Infinity`) plus `null`.
//
// This decoder reconstructs the object graph so integration tests can assert on the real
// client-visible loader data — the same bytes a browser turns back into `loaderData` on a
// client-side navigation — instead of grepping the opaque flat array. It is intentionally minimal:
// it collapses every negative sentinel to `null`, which is all the privacy assertions need (a
// masked `eik` is `null`; an unmasked one is a non-empty string — the two never collide). If a
// future test needs to distinguish `undefined` from `null` or read a `NaN`, extend the sentinel
// handling then.
//
// The `cache` (index → built value) both memoises shared references and terminates the cyclic
// graphs RRv7 can emit (a value that refers back to an ancestor index).
export function decodeSingleFetch(text: string): Record<string, { data: unknown }> {
  const arr = JSON.parse(text) as unknown[];
  const cache = new Map<number, unknown>();

  function build(ref: unknown): unknown {
    if (typeof ref !== 'number') return ref;
    if (ref < 0) return null; // turbo-stream sentinel (undefined / null / NaN / ±Infinity) → nullish
    if (cache.has(ref)) return cache.get(ref);

    const value = arr[ref];
    if (value === null || typeof value !== 'object') {
      cache.set(ref, value);
      return value;
    }
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      cache.set(ref, out);
      for (const item of value) out.push(build(item));
      return out;
    }
    const out: Record<string, unknown> = {};
    cache.set(ref, out);
    for (const [encodedKey, valueRef] of Object.entries(value)) {
      // Object keys are `_<keyIndex>` — the property name itself lives in the value table.
      const key = build(Number(encodedKey.slice(1)));
      out[String(key)] = build(valueRef);
    }
    return out;
  }

  return build(0) as Record<string, { data: unknown }>;
}

/** Read one route's decoded loader `data` from a decoded single-fetch payload. */
export function routeData<T = unknown>(
  decoded: Record<string, { data: unknown }>,
  routeId: string,
): T {
  const entry = decoded[routeId];
  if (!entry) {
    throw new Error(
      `[single-fetch] route "${routeId}" not present in payload; got routes: ${Object.keys(decoded).join(', ')}`,
    );
  }
  return entry.data as T;
}
