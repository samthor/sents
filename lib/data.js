
/**
 * @template K
 * @template V
 */
export class MultiMap {

  /** @type {Map<K, Set<V>>} */
  #raw = new Map();

  /**
   * @param {K} k
   * @param {V} v
   * @return {boolean} if there was a change
   */
  set(k, v) {
    const prev = this.#raw.get(k);
    if (prev === undefined) {
      this.#raw.set(k, new Set([v]));
      return true;
    }

    if (prev.has(v)) {
      return false;
    }
    prev.add(v);
    return true;
  }

  /**
   * @param {K} k
   * @return {V[]}
   */
  all(k) {
    const prev = this.#raw.get(k);
    if (prev === undefined) {
      return [];
    }
    return [...prev];
  }

  /**
   * @param {K} k
   * @param {V} v
   * @return {boolean} if there was a change
   */
  remove(k, v) {
    const prev = this.#raw.get(k);
    if (prev === undefined || !prev.has(v)) {
      return false;
    }

    prev.delete(v);
    if (prev.size === 0) {
      this.#raw.delete(k);
    }
    return true;
  }
}