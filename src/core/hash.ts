/**
 * Deterministic hashing used for bucketing.
 *
 * INVARIANT: never change this algorithm or the bucket count. Doing so would
 * silently move every user of every running experiment to a different
 * treatment. Tests in `test/hash.test.ts` pin known outputs.
 */

/** Number of buckets. 10,000 buckets = 0.01% allocation granularity. */
export const BUCKETS = 10_000;

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : undefined;

function utf8(input: string): Uint8Array {
  if (encoder) return encoder.encode(input);
  // Fallback for exotic runtimes without TextEncoder.
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let c = input.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < input.length) {
      c = 0x10000 + ((c & 0x3ff) << 10) + (input.charCodeAt(++i) & 0x3ff);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

/** MurmurHash3 (x86, 32-bit) over the UTF-8 bytes of `input`. */
export function murmur3(input: string, seed = 0): number {
  const bytes = utf8(input);
  const len = bytes.length;
  const nblocks = len >> 2;
  let h = seed >>> 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  for (let i = 0; i < nblocks; i++) {
    const o = i << 2;
    let k = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24);
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }

  let k = 0;
  const tail = nblocks << 2;
  switch (len & 3) {
    case 3:
      k ^= bytes[tail + 2] << 16;
    // falls through
    case 2:
      k ^= bytes[tail + 1] << 8;
    // falls through
    case 1:
      k ^= bytes[tail];
      k = Math.imul(k, c1);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, c2);
      h ^= k;
  }

  h ^= len;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Map `(namespace, userId)` to a stable bucket in `[0, BUCKETS)`. */
export function bucketOf(namespace: string, userId: string): number {
  return murmur3(`${namespace}:${userId}`) % BUCKETS;
}
