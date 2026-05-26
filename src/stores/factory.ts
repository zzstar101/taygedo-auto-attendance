import type { RuntimeConfig } from '../config/runtime.js'
import {
  CloudflareKvAccountStore,
  EnvAccountStore,
  FileAccountStore,
  type AccountStore,
  type KvNamespace,
  UpstashAccountStore,
} from './account-store.js'
import {
  CloudflareKvStateStore,
  FileStateStore,
  MemoryStateStore,
  type StateStore,
  UpstashStateStore,
} from './state-store.js'
import { createUnstorageFromEnv, UnstorageAccountStore, UnstorageStateStore } from './unstorage-store.js'

interface StoreFactoryOptions {
  config: RuntimeConfig
  accountsFile?: string
  stateDir?: string
  kv?: KvNamespace
  fetch?: typeof globalThis.fetch
}

export function createAccountStore(options: StoreFactoryOptions): AccountStore {
  const { config } = options
  if (config.accountStore === 'env') {
    return new EnvAccountStore(config.accountsSecret)
  }
  if (config.accountStore === 'file') {
    return new FileAccountStore(options.accountsFile ?? config.updatedAccountsPath)
  }
  if (config.accountStore === 'cloudflare-kv') {
    if (!options.kv) {
      throw new Error('Cloudflare KV 账号存储需要绑定 KV')
    }
    return new CloudflareKvAccountStore(options.kv, config.accountsKey, config.accountsSecret)
  }
  if (config.accountStore === 'unstorage') {
    return new LazyAccountStore(async () => new UnstorageAccountStore(await createUnstorageFromEnv(), config.accountsKey))
  }
  if (!config.upstashUrl || !config.upstashToken) {
    throw new Error('Upstash 账号存储需要配置 TAYGEDO_UPSTASH_REDIS_REST_URL 和 TAYGEDO_UPSTASH_REDIS_REST_TOKEN')
  }
  return new UpstashAccountStore(config.upstashUrl, config.upstashToken, config.accountsKey, options.fetch)
}

export function createStateStore(options: StoreFactoryOptions): StateStore {
  const { config } = options
  if (config.stateStore === 'memory') {
    return new MemoryStateStore(config.statePrefix)
  }
  if (config.stateStore === 'file') {
    return new FileStateStore(options.stateDir ?? '.data/state', config.statePrefix)
  }
  if (config.stateStore === 'cloudflare-kv') {
    if (!options.kv) {
      throw new Error('Cloudflare KV 状态存储需要绑定 KV')
    }
    return new CloudflareKvStateStore(options.kv, config.statePrefix)
  }
  if (config.stateStore === 'unstorage') {
    return new LazyStateStore(async () => new UnstorageStateStore(await createUnstorageFromEnv(), config.statePrefix))
  }
  if (!config.upstashUrl || !config.upstashToken) {
    throw new Error('Upstash 状态存储需要配置 TAYGEDO_UPSTASH_REDIS_REST_URL 和 TAYGEDO_UPSTASH_REDIS_REST_TOKEN')
  }
  return new UpstashStateStore(config.upstashUrl, config.upstashToken, config.statePrefix, options.fetch)
}

class LazyAccountStore implements AccountStore {
  private store?: AccountStore

  constructor(private readonly create: () => Promise<AccountStore>) {}

  async readAccounts(): Promise<string> {
    return await (await this.get()).readAccounts()
  }

  async writeAccounts(payload: string): Promise<void> {
    await (await this.get()).writeAccounts(payload)
  }

  private async get(): Promise<AccountStore> {
    this.store ??= await this.create()
    return this.store
  }
}

class LazyStateStore implements StateStore {
  private store?: StateStore

  constructor(private readonly create: () => Promise<StateStore>) {}

  async get<T>(key: string): Promise<T | undefined> {
    return await (await this.getStore()).get<T>(key)
  }

  async set<T>(key: string, value: T, options?: { ttlSeconds?: number }): Promise<void> {
    await (await this.getStore()).set(key, value, options)
  }

  private async getStore(): Promise<StateStore> {
    this.store ??= await this.create()
    return this.store
  }
}
