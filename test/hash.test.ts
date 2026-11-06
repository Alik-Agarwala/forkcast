import { describe, expect, it } from 'vitest';
import { BUCKETS, bucketOf, murmur3 } from '../src/core/hash';

describe('murmur3', () => {
  it('matches the reference MurmurHash3 x86_32 test vectors', () => {
    expect(murmur3('')).toBe(0);
    expect(murmur3('hello')).toBe(0x248bfa47);
    expect(murmur3('Hello, world!')).toBe(0xc0363e43);
    expect(murmur3('The quick brown fox jumps over the lazy dog')).toBe(0x2e4ff723);
  });

  it('hashes multi-byte characters via UTF-8', () => {
    expect(murmur3('naïve 🚀')).toBe(murmur3('naïve 🚀'));
    expect(murmur3('naïve')).not.toBe(murmur3('naive'));
  });
});

describe('bucketOf', () => {
  it('pins known buckets (changing these re-randomises every live experiment)', () => {
    expect(bucketOf('new-checkout:traffic', 'user-1')).toMatchInlineSnapshot(`9827`);
    expect(bucketOf('new-checkout:variant', 'user-1')).toMatchInlineSnapshot(`1367`);
  });

  it('is deterministic and in range', () => {
    for (let i = 0; i < 1000; i++) {
      const b = bucketOf('exp', `u${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(BUCKETS);
      expect(bucketOf('exp', `u${i}`)).toBe(b);
    }
  });

  it('distributes users uniformly across 10 deciles', () => {
    const counts = new Array(10).fill(0);
    const n = 50_000;
    for (let i = 0; i < n; i++) counts[Math.floor(bucketOf('uniform', `user-${i}`) / 1000)]++;
    for (const c of counts) expect(Math.abs(c - n / 10) / (n / 10)).toBeLessThan(0.05);
  });
});
