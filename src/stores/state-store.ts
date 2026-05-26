import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { KvNamespace } from './account-store.js'

export interface StateStore {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T, options?: { ttlSeconds?: number }): Promise<void>
}

export class MemoryStateStore implements StateStore {
  private readonly values = new Map<string, string>()

  constructor(private readonly prefix = 'taygedo') {}

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.values.get(this.fullKey(key))
    return value ? JSON.parse(value) as T : undefined
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(this.fullKey(key), JSON.stringify(value))
  }

  private fullKey(key: string): string {
    return `${this.prefix}:${key}`
  }
}

export class FileStateStore implements StateStore {
  constructor(
    private readonly baseDir: string,
    private readonly prefix = 'taygedo',
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(this.pathFor(key), 'utf8')) as T
    }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return undefined
      }
      throw error
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const path = this.pathFor(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(value), 'utf8')
  }

  private pathFor(key: string): string {
    const safeParts = key.split('/').filter(Boolean)
    return join(this.baseDir, this.prefix, ...safeParts) + '.json'
  }
}

export class CloudflareKvStateStore implements StateStore {
  constructor(
    private readonly kv: KvNamespace,
    private readonly prefix = 'taygedo',
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const value = await this.kv.get(this.fullKey(key))
    return value ? JSON.parse(value) as T : undefined
  }

  async set<T>(key: string, value: T, options?: { ttlSeconds?: number }): Promise<void> {
    await this.kv.put(this.fullKey(key), JSON.stringify(value), options?.ttlSeconds ? { expirationTtl: options.ttlSeconds } : undefined)
  }

  private fullKey(key: string): string {
    return `${this.prefix}:${key}`
  }
}

export class UpstashStateStore implements StateStore {
  private readonly baseUrl: string

  constructor(
    url: string,
    private readonly token: string,
    private readonly prefix = 'taygedo',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = url.replace(/\/+$/, '')
  }

  async get<T>(key: string): Promise<T | undefined> {
    const data = await this.request<{ result?: string | null }>(`get/${encodeURIComponent(this.fullKey(key))}`)
    return data.result ? JSON.parse(data.result) as T : undefined
  }

  async set<T>(key: string, value: T, options?: { ttlSeconds?: number }): Promise<void> {
    const ttlQuery = options?.ttlSeconds ? `?EX=${encodeURIComponent(String(options.ttlSeconds))}` : ''
    await this.request(`set/${encodeURIComponent(this.fullKey(key))}/${encodeURIComponent(JSON.stringify(value))}${ttlQuery}`)
  }

  private async request<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    })
    if (!response.ok) {
      throw new Error(`Upstash 状态存储请求失败：HTTP ${response.status}`)
    }
    return await response.json() as T
  }

  private fullKey(key: string): string {
    return `${this.prefix}:${key}`
  }
}
