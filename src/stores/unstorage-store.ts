import { createStorage, type Storage, type StorageValue } from 'unstorage'
import type { AccountStore } from './account-store.js'
import type { StateStore } from './state-store.js'

export type UnstorageDriverName = 'redis' | 's3' | 'upstash' | 'fs'

export interface UnstorageDriverChoice {
  name: UnstorageDriverName
  options: Record<string, string>
}

export interface MinimalStorage {
  getItem<T = StorageValue>(key: string): Promise<T | null>
  setItem<T = StorageValue>(key: string, value: T, options?: Record<string, unknown>): Promise<void>
}

export class UnstorageAccountStore implements AccountStore {
  constructor(
    private readonly storage: MinimalStorage,
    private readonly key = 'TAYGEDO_ACCOUNTS',
  ) {}

  async readAccounts(): Promise<string> {
    const value = await this.storage.getItem<string | unknown>(this.key)
    if (!value) {
      throw new Error(`unstorage 中缺少账号配置，key：${this.key}`)
    }
    return typeof value === 'string' ? value : JSON.stringify(value)
  }

  async writeAccounts(payload: string): Promise<void> {
    await this.storage.setItem(this.key, payload)
  }
}

export class UnstorageStateStore implements StateStore {
  constructor(
    private readonly storage: MinimalStorage,
    private readonly prefix = 'taygedo',
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const value = await this.storage.getItem<string | T>(this.fullKey(key))
    if (!value) {
      return undefined
    }
    return typeof value === 'string' ? JSON.parse(value) as T : value as T
  }

  async set<T>(key: string, value: T, options?: { ttlSeconds?: number }): Promise<void> {
    await this.storage.setItem(this.fullKey(key), JSON.stringify(value), options?.ttlSeconds ? { ttl: options.ttlSeconds } : undefined)
  }

  private fullKey(key: string): string {
    return `${this.prefix}:${key}`
  }
}

export async function createUnstorageFromEnv(env: Record<string, string | undefined> = process.env): Promise<Storage<StorageValue>> {
  const choice = chooseUnstorageDriver(env)
  if (choice.name === 'redis') {
    const { default: redisDriver } = await import('unstorage/drivers/redis')
    return createStorage({ driver: redisDriver(choice.options) })
  }
  if (choice.name === 's3') {
    const { default: s3Driver } = await import('unstorage/drivers/s3')
    return createStorage({
      driver: s3Driver({
        accessKeyId: choice.options.accessKeyId,
        secretAccessKey: choice.options.secretAccessKey,
        bucket: choice.options.bucket,
        region: choice.options.region,
        endpoint: choice.options.endpoint,
      }),
    })
  }
  if (choice.name === 'upstash') {
    const { default: upstashDriver } = await import('unstorage/drivers/upstash')
    return createStorage({
      driver: upstashDriver({
        url: choice.options.url,
        token: choice.options.token,
      } as Parameters<typeof upstashDriver>[0]),
    })
  }
  const { default: fsDriver } = await import('unstorage/drivers/fs-lite')
  return createStorage({ driver: fsDriver({ base: choice.options.base }) })
}

export function chooseUnstorageDriver(env: Record<string, string | undefined>): UnstorageDriverChoice {
  const redisUrl = optionalEnv(env, 'REDIS_URL') ?? redisKvUrl(env)
  if (redisUrl) {
    return { name: 'redis', options: { url: redisUrl } }
  }

  const s3AccessKeyId = optionalEnv(env, 'S3_ACCESS_KEY_ID')
  const s3SecretAccessKey = optionalEnv(env, 'S3_SECRET_ACCESS_KEY')
  const s3Bucket = optionalEnv(env, 'S3_BUCKET')
  if (s3AccessKeyId && s3SecretAccessKey && s3Bucket) {
    return {
      name: 's3',
      options: {
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey,
        bucket: s3Bucket,
        region: optionalEnv(env, 'S3_REGION') ?? 'auto',
        endpoint: optionalEnv(env, 'S3_ENDPOINT') ?? '',
      },
    }
  }

  const upstashUrl = optionalEnv(env, 'TAYGEDO_UPSTASH_REDIS_REST_URL') ?? optionalEnv(env, 'UPSTASH_REDIS_REST_URL')
  const upstashToken = optionalEnv(env, 'TAYGEDO_UPSTASH_REDIS_REST_TOKEN') ?? optionalEnv(env, 'UPSTASH_REDIS_REST_TOKEN')
  if (upstashUrl && upstashToken) {
    return { name: 'upstash', options: { url: upstashUrl, token: upstashToken } }
  }

  return { name: 'fs', options: { base: optionalEnv(env, 'TAYGEDO_UNSTORAGE_DIR') ?? '.data/kv' } }
}

function redisKvUrl(env: Record<string, string | undefined>): string | undefined {
  const kvUrl = optionalEnv(env, 'KV_URL')
  if (!kvUrl || (!kvUrl.startsWith('redis://') && !kvUrl.startsWith('rediss://'))) {
    return undefined
  }
  return kvUrl
}

function optionalEnv(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]
  if (!value || value.trim() === '') {
    return undefined
  }
  return value.trim()
}
