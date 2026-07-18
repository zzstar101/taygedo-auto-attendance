import { describe, expect, it } from 'vitest'
import { loadRuntimeConfig } from '../src/config/runtime.js'
import { createCloudflareAccountStore, createCloudflareStateStore } from '../src/stores/cloudflare-factory.js'
import { createAccountStore, createStateStore } from '../src/stores/factory.js'
import { CloudflareKvAccountStore, EnvAccountStore, FileAccountStore, UpstashAccountStore } from '../src/stores/account-store.js'
import { CloudflareKvStateStore, FileStateStore, MemoryStateStore, UpstashStateStore } from '../src/stores/state-store.js'
import { chooseUnstorageDriver } from '../src/stores/unstorage-store.js'

describe('store factories', () => {
  it('creates default env and memory stores', () => {
    const config = loadRuntimeConfig({ TAYGEDO_ACCOUNTS: '[]' })

    expect(createAccountStore({ config })).toBeInstanceOf(EnvAccountStore)
    expect(createStateStore({ config })).toBeInstanceOf(MemoryStateStore)
  })

  it('creates file stores for local and docker runtimes', () => {
    const config = loadRuntimeConfig({
      TAYGEDO_ACCOUNT_STORE: 'file',
      TAYGEDO_STATE_STORE: 'file',
    })

    expect(createAccountStore({ config, accountsFile: 'accounts.json' })).toBeInstanceOf(FileAccountStore)
    expect(createStateStore({ config, stateDir: 'state' })).toBeInstanceOf(FileStateStore)
  })

  it('creates Upstash stores when REST credentials are configured', () => {
    const config = loadRuntimeConfig({
      TAYGEDO_ACCOUNT_STORE: 'upstash',
      TAYGEDO_STATE_STORE: 'upstash',
      TAYGEDO_UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
      TAYGEDO_UPSTASH_REDIS_REST_TOKEN: 'redis-token',
    })

    expect(createAccountStore({ config })).toBeInstanceOf(UpstashAccountStore)
    expect(createStateStore({ config })).toBeInstanceOf(UpstashStateStore)
  })

  it('creates unstorage-backed stores', async () => {
    const config = loadRuntimeConfig({
      TAYGEDO_ACCOUNT_STORE: 'unstorage',
      TAYGEDO_STATE_STORE: 'unstorage',
    })
    const accountStore = createAccountStore({ config })
    const stateStore = createStateStore({ config })

    await accountStore.writeAccounts('[]')
    await expect(accountStore.readAccounts()).resolves.toBe('[]')
    await stateStore.set('last', { ok: true })
    await expect(stateStore.get('last')).resolves.toEqual({ ok: true })
  })

  it('chooses unstorage drivers from env in priority order', () => {
    expect(chooseUnstorageDriver({
      REDIS_URL: 'redis://localhost:6379',
    }).name).toBe('redis')
    expect(chooseUnstorageDriver({
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_BUCKET: 'bucket',
    }).name).toBe('s3')
    expect(chooseUnstorageDriver({
      TAYGEDO_UPSTASH_REDIS_REST_URL: 'https://upstash.example.com',
      TAYGEDO_UPSTASH_REDIS_REST_TOKEN: 'token',
    }).name).toBe('upstash')
    expect(chooseUnstorageDriver({}).name).toBe('fs')
  })

  it('creates Cloudflare-compatible stores without loading unstorage drivers', () => {
    const config = loadRuntimeConfig({
      TAYGEDO_ACCOUNT_STORE: 'cloudflare-kv',
      TAYGEDO_STATE_STORE: 'cloudflare-kv',
    })
    const kv = {
      get: async () => null,
      put: async () => undefined,
    }

    expect(createCloudflareAccountStore({ config, kv })).toBeInstanceOf(CloudflareKvAccountStore)
    expect(createCloudflareStateStore({ config, kv })).toBeInstanceOf(CloudflareKvStateStore)
  })

  it('rejects Node-only stores in the Cloudflare factory', () => {
    const config = loadRuntimeConfig({
      TAYGEDO_ACCOUNT_STORE: 'unstorage',
      TAYGEDO_STATE_STORE: 'file',
    })
    const kv = {
      get: async () => null,
      put: async () => undefined,
    }

    expect(() => createCloudflareAccountStore({ config, kv })).toThrow('Cloudflare Worker 不支持账号存储：unstorage')
    expect(() => createCloudflareStateStore({ config, kv })).toThrow('Cloudflare Worker 不支持状态存储：file')
  })
})
