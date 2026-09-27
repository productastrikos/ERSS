/**
 * Deterministic pseudo-random number generation.
 *
 * The seeded history must be REPRODUCIBLE: the same SEED_RNG produces byte-identical
 * data every run. Without that, a demo rehearsed on Tuesday shows different numbers on
 * Wednesday, `seed:verify` cannot assert anything, and no bug in the generator is ever
 * reproducible.
 *
 * Math.random() is never used anywhere in the seed.
 */

/** xmur3 string → 32-bit seed. */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/** mulberry32 — fast, good enough distribution, tiny state. */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seedString) {
  const next = mulberry32(xmur3(String(seedString))());

  const rng = {
    /** [0, 1) */
    next,

    /** [min, max) */
    float: (min, max) => min + next() * (max - min),

    /** Integer in [min, max] inclusive. */
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),

    /** True with probability p. */
    bool: (p = 0.5) => next() < p,

    pick: (arr) => arr[Math.floor(next() * arr.length)],

    /** Pick by weight. `items` is [{ weight, ...}] or a [value, weight] map. */
    weighted(items, weightOf = (x) => x.weight) {
      const total = items.reduce((s, i) => s + weightOf(i), 0);
      let r = next() * total;
      for (const item of items) {
        r -= weightOf(item);
        if (r <= 0) return item;
      }
      return items[items.length - 1];
    },

    shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },

    /** Box–Muller. Used for measurement noise. */
    normal(mean = 0, sd = 1) {
      let u = 0, v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },

    /**
     * Log-normal. THE distribution for response and stage times.
     *
     * Dubai's published mean response is 6.59 min while the median for critical calls
     * is ≈9.0 min — a strongly right-skewed shape that a normal distribution cannot
     * produce. Rapid urban first-responder arrivals pull the mean below the median of
     * the critical subset; a long tail to remote zones pulls it back.
     *
     * @param median  the 50th percentile, in the same unit as the result
     * @param sigma   shape; larger = heavier tail. 0.45–0.65 fits EMS data well.
     */
    logNormal(median, sigma = 0.55) {
      return median * Math.exp(sigma * rng.normal(0, 1));
    },

    /** Poisson (Knuth). For arrival counts per bucket. */
    poisson(lambda) {
      if (lambda <= 0) return 0;
      if (lambda > 30) {
        // Normal approximation — Knuth's loop is too slow above ~30.
        return Math.max(0, Math.round(rng.normal(lambda, Math.sqrt(lambda))));
      }
      const L = Math.exp(-lambda);
      let k = 0, p = 1;
      do { k++; p *= next(); } while (p > L);
      return k - 1;
    },

    /** Exponential, for inter-arrival gaps. */
    exponential: (rate) => -Math.log(1 - next()) / rate,

    /** A child generator with an independent, still-deterministic stream. */
    fork: (label) => createRng(`${seedString}:${label}`),
  };

  return rng;
}
