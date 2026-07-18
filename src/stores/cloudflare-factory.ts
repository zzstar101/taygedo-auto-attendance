import type { RuntimeConfig } from '../config/runtime.js'
import {
  CloudflareKvAccountStore,
  EnvAccountStore,
  type AccountStore,
  type KvNamespace,
  UpstashAccountStore,
} from './account-store.js'
import {
  CloudflareKvStateStore,
  MemoryStateStore,
  type StateStore,
  UpstashStateStore,
} from './state-store.js'

interface CloudflareStoreFactoryOptions {
  config: RuntimeConfig
  kv: KvNamespace
  fetch?: typeof globalThis.fetch
}

export function createCloudflareAccountStore(options: CloudflareStoreFactoryOptions): AccountStore {
  const { config } = options
  if (config.accountStore === 'env') {
    return new EnvAccountStore(config.accountsSecret)
  }
  if (config.accountStore === 'cloudflare-kv') {
    return new CloudflareKvAccountStore(options.kv, config.accountsKey, config.accountsSecret)
  }
  if (config.accountStore === 'upstash') {
    if (!config.upstashUrl || !config.upstashToken) {
      throw new Error('Upstash 账号存储需要配置 TAYGEDO_UPSTASH_REDIS_REST_URL 和 TAYGEDO_UPSTASH_REDIS_REST_TOKEN')
    }
    return new UpstashAccountStore(config.upstashUrl, config.upstashToken, config.accountsKey, options.fetch, config.accountsSecret)
  }
  throw new Error(`Cloudflare Worker 不支持账号存储：${config.accountStore}`)
}

export function createCloudflareStateStore(options: CloudflareStoreFactoryOptions): StateStore {
  const { config } = options
  if (config.stateStore === 'memory') {
    return new MemoryStateStore(config.statePrefix)
  }
  if (config.stateStore === 'cloudflare-kv') {
    return new CloudflareKvStateStore(options.kv, config.statePrefix)
  }
  if (config.stateStore === 'upstash') {
    if (!config.upstashUrl || !config.upstashToken) {
      throw new Error('Upstash 状态存储需要配置 TAYGEDO_UPSTASH_REDIS_REST_URL 和 TAYGEDO_UPSTASH_REDIS_REST_TOKEN')
    }
    return new UpstashStateStore(config.upstashUrl, config.upstashToken, config.statePrefix, options.fetch)
  }
  throw new Error(`Cloudflare Worker 不支持状态存储：${config.stateStore}`)
}
