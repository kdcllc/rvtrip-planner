export type CacheEntry<T> = {
  value: T
  expiresAt: number
}

type SerializedCache<T> = {
  entries: Array<[string, CacheEntry<T>]>
}

export class LruTtlCache<T> {
  private map = new Map<string, CacheEntry<T>>()
  private readonly maxSize: number
  private readonly defaultTtlMs: number
  private readonly storageKey?: string

  constructor(
    maxSize: number,
    defaultTtlMs: number,
    storageKey?: string
  ) {
    this.maxSize = maxSize
    this.defaultTtlMs = defaultTtlMs
    this.storageKey = storageKey
    
    if (this.storageKey) {
      this.loadFromStorage()
    }
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key)
    if (!entry) {
      return undefined
    }

    if (Date.now() >= entry.expiresAt) {
      this.map.delete(key)
      this.persist()
      return undefined
    }

    this.map.delete(key)
    this.map.set(key, entry)

    return entry.value
  }

  set(key: string, value: T, ttlMs?: number) {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs)

    if (this.map.has(key)) {
      this.map.delete(key)
    } else if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value as string | undefined
      if (oldestKey) {
        this.map.delete(oldestKey)
      }
    }

    this.map.set(key, { value, expiresAt })
    this.persist()
  }

  clear() {
    this.map.clear()
    this.persist(true)
  }

  size() {
    return this.map.size
  }

  private loadFromStorage() {
    if (!this.storageKey) {
      return
    }

    try {
      const raw = localStorage.getItem(this.storageKey)
      if (!raw) {
        return
      }

      const parsed = JSON.parse(raw) as SerializedCache<T>
      if (!parsed.entries) {
        return
      }

      const now = Date.now()
      parsed.entries.forEach(([key, entry]) => {
        if (entry.expiresAt > now) {
          this.map.set(key, entry)
        }
      })
    } catch {
      // Ignore cache hydration errors.
    }
  }

  private persist(clear?: boolean) {
    if (!this.storageKey) {
      return
    }

    if (clear) {
      localStorage.removeItem(this.storageKey)
      return
    }

    try {
      const serialized: SerializedCache<T> = {
        entries: Array.from(this.map.entries()),
      }
      localStorage.setItem(this.storageKey, JSON.stringify(serialized))
    } catch {
      // Ignore storage failures (e.g., quota exceeded).
    }
  }
}
