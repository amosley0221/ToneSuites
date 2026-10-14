// Row/column axis geometry with sparse size overrides — O(log n) position ↔ index lookups,
// so the grid stays fast with 10k+ rows, custom heights and filter-hidden rows.

export class Axis {
  private keys: number[];
  private cum: number[];
  private sizes: Map<number, number>;

  constructor(public def: number, public count: number, overrides: Map<number, number>, hidden?: Set<number>, public zoom = 1) {
    this.sizes = new Map(overrides);
    if (hidden) for (const h of hidden) this.sizes.set(h, 0);
    this.keys = [...this.sizes.keys()].filter((k) => k >= 0).sort((a, b) => a - b);
    let acc = 0;
    this.cum = this.keys.map((k) => (acc += (this.sizes.get(k) as number) - def));
  }

  /** Sum of (size - default) for overridden indexes < i. */
  private deltaBefore(i: number): number {
    let lo = 0;
    let hi = this.keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.keys[mid] < i) lo = mid + 1; else hi = mid;
    }
    return lo ? this.cum[lo - 1] : 0;
  }

  size(i: number): number { return (this.sizes.get(i) ?? this.def) * this.zoom; }
  pos(i: number): number { return (i * this.def + this.deltaBefore(i)) * this.zoom; }
  get total(): number { return this.pos(this.count); }
  isHidden(i: number): boolean { return this.sizes.get(i) === 0; }

  /** Largest index whose start position is ≤ p (clamped to [0, count-1]). */
  index(p: number): number {
    if (p <= 0) return 0;
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.pos(mid) <= p) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /** Next index in direction d that is not hidden (or i itself if none). */
  step(i: number, d: number, limit = this.count - 1): number {
    let j = i + d;
    while (j >= 0 && j <= limit && this.isHidden(j)) j += d;
    return j < 0 || j > limit ? i : j;
  }
}
