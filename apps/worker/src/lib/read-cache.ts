type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

export class ReadCache {
  // ponytail: isolate-local cache; short TTL bounds stale data across Worker isolates.
  private readonly entries = new Map<string, CacheEntry>();
  private generation = 0;

  constructor(
    private readonly maxEntries = 64,
    private readonly now: () => number = Date.now
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 64) {
      throw new Error("Cache capacity must be an integer from 1 to 64");
    }
  }

  async get<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const now = this.now();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > now) return cached.value as T;
    if (cached) this.entries.delete(key);

    const generation = this.generation;
    const value = await loader();
    if (this.generation === generation) this.store(key, value, ttlMs);
    return value;
  }

  invalidate(): void {
    this.generation += 1;
    this.entries.clear();
  }

  private store(key: string, value: unknown, ttlMs: number): void {
    const now = this.now();
    for (const [storedKey, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(storedKey);
    }
    if (this.entries.has(key)) this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: now + Math.max(0, ttlMs) });
  }
}

const readCache = new ReadCache();

export function cachedRead<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  return readCache.get(key, ttlMs, loader);
}

export function invalidateReadCache(): void {
  readCache.invalidate();
}
