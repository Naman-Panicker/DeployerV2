export interface ProjectCacheEntry {
  projectId: string;
  currentDeploymentId: string | null;
  cachedAt: number;
}

export class ProjectCache {
  private cache: Map<string, ProjectCacheEntry>;
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number = 100, ttlMs: number = 60_000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Retrieves an active cache entry if it exists and is not expired.
   * Refreshes LRU position on access.
   */
  get(subdomain: string): ProjectCacheEntry | null {
    const entry = this.cache.get(subdomain);
    if (!entry) {
      return null;
    }

    // Lazy expiration
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(subdomain);
      return null;
    }

    // Refresh position in Map for LRU
    this.cache.delete(subdomain);
    this.cache.set(subdomain, entry);
    return entry;
  }

  /**
   * Stores an entry in the cache. Evicts LRU if capacity exceeded.
   */
  set(subdomain: string, entry: Omit<ProjectCacheEntry, 'cachedAt'>): void {
    if (this.cache.has(subdomain)) {
      this.cache.delete(subdomain);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest entry (first key in insertion order)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(subdomain, {
      ...entry,
      cachedAt: Date.now(),
    });
  }

  /**
   * Removes a specific subdomain from the cache.
   */
  invalidate(subdomain: string): void {
    this.cache.delete(subdomain);
  }

  /**
   * Clears the entire cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Returns current cache size.
   */
  size(): number {
    return this.cache.size;
  }
}
