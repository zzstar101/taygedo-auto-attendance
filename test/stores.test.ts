import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CloudflareKvAccountStore, EnvAccountStore, FileAccountStore, UpstashAccountStore } from '../src/stores/account-store.js'
import { CloudflareKvStateStore, FileStateStore, MemoryStateStore, UpstashStateStore } from '../src/stores/state-store.js'
import { UnstorageAccountStore, UnstorageStateStore } from '../src/stores/unstorage-store.js'

describe('AccountStore implementations', () => {
  it('reads accounts from env and refuses writes', async () => {
    const store = new EnvAccountStore('accounts-json')
    await expect(store.readAccounts()).resolves.toBe('accounts-json')
    await expect(store.writeAccounts()).rejects.toThrow('环境变量账号存储是只读的')
  })

  it('reads and writes accounts from a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-store-'))
    const path = join(dir, 'nested', 'accounts.json')
    const store = new FileAccountStore(path)

    try {
      await store.writeAccounts('{"ok":true}')
      await expect(store.readAccounts()).resolves.toBe('{"ok":true}')
      expect(await readFile(path, 'utf8')).toBe('{"ok":true}\n')
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writes account files with owner-only permissions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-store-mode-'))
    const path = join(dir, 'nested', 'accounts.json')
    const store = new FileAccountStore(path)

    try {
      await store.writeAccounts('{"ok":true}')

      expect((await stat(path)).mode & 0o777).toBe(0o600)
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reads, initializes, and writes accounts from Cloudflare KV', async () => {
    const kv = new Map<string, string>()
    const store = new CloudflareKvAccountStore({
      get: vi.fn(async key => kv.get(key) ?? null),
      put: vi.fn(async (key, value) => { kv.set(key, value) }),
    }, 'accounts', 'initial-json')

    await expect(store.readAccounts()).resolves.toBe('initial-json')
    expect(kv.get('accounts')).toBe('initial-json')
    await store.writeAccounts('next-json')
    await expect(store.readAccounts()).resolves.toBe('next-json')
  })

  it('reads and writes accounts through the Upstash REST API', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: JSON.stringify([{ id: 'main' }]) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 'OK' }), { status: 200 }))
    const store = new UpstashAccountStore('https://redis.example.com', 'redis-token', 'accounts', fetchMock)

    await expect(store.readAccounts()).resolves.toBe('[{"id":"main"}]')
    await store.writeAccounts('[{"id":"alt"}]')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://redis.example.com/get/accounts',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer redis-token' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://redis.example.com/set/accounts',
      expect.objectContaining({
        method: 'POST',
        body: '[{"id":"alt"}]',
      }),
    )
  })

  it('reads and writes accounts through unstorage', async () => {
    const storage = new Map<string, unknown>()
    const store = new UnstorageAccountStore({
      getItem: async <T>(key: string) => storage.get(key) as T ?? null,
      setItem: async (key, value) => { storage.set(key, value) },
    }, 'accounts')

    await store.writeAccounts('[{"id":"main"}]')
    await expect(store.readAccounts()).resolves.toBe('[{"id":"main"}]')
  })
})

describe('StateStore implementations', () => {
  it('stores values in memory', async () => {
    const store = new MemoryStateStore('test')
    await expect(store.get('last')).resolves.toBeUndefined()
    await store.set('last', { ok: true })
    await expect(store.get('last')).resolves.toEqual({ ok: true })
  })

  it('stores values in files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-state-'))
    const store = new FileStateStore(dir, 'prod')

    try {
      await store.set('last/result', { ok: true })
      await expect(store.get('last/result')).resolves.toEqual({ ok: true })
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects file state keys that escape the base directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-state-traversal-'))
    const store = new FileStateStore(dir, 'prod')

    try {
      await expect(store.set('../outside', { ok: false })).rejects.toThrow('状态 key 包含非法路径片段')
      await expect(store.get('../outside')).rejects.toThrow('状态 key 包含非法路径片段')
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('stores values in Cloudflare KV with a prefix', async () => {
    const kv = new Map<string, string>()
    const put = vi.fn(async (key: string, value: string) => { kv.set(key, value) })
    const store = new CloudflareKvStateStore({
      get: vi.fn(async key => kv.get(key) ?? null),
      put,
    }, 'prod')

    await store.set('last', { ok: true }, { ttlSeconds: 60 })
    expect(kv.has('prod:last')).toBe(true)
    expect(put).toHaveBeenCalledWith('prod:last', JSON.stringify({ ok: true }), { expirationTtl: 60 })
    await expect(store.get('last')).resolves.toEqual({ ok: true })
  })

  it('stores values through the Upstash REST API', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 'OK' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: JSON.stringify({ ok: true }) }), { status: 200 }))
    const store = new UpstashStateStore('https://redis.example.com', 'redis-token', 'prod', fetchMock)

    await store.set('last', { ok: true }, { ttlSeconds: 60 })
    await expect(store.get('last')).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://redis.example.com/set/prod%3Alast?EX=60',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer redis-token' }),
        body: JSON.stringify({ ok: true }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://redis.example.com/get/prod%3Alast',
      expect.any(Object),
    )
  })

  it('stores state through unstorage with ttl when supported', async () => {
    const storage = new Map<string, unknown>()
    const options: unknown[] = []
    const store = new UnstorageStateStore({
      getItem: async <T>(key: string) => storage.get(key) as T ?? null,
      setItem: async (key, value, option) => {
        storage.set(key, value)
        options.push(option)
      },
    }, 'prod')

    await store.set('last', { ok: true }, { ttlSeconds: 60 })
    await expect(store.get('last')).resolves.toEqual({ ok: true })
    expect(options[0]).toEqual({ ttl: 60 })
  })
})
