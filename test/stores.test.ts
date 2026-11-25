import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
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

  it('replaces the account file atomically instead of rewriting it in place', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-store-atomic-'))
    const path = join(dir, 'accounts.json')
    const store = new FileAccountStore(path)

    try {
      await writeFile(path, '[]\n', { mode: 0o666 })
      await store.writeAccounts('[{"id":"main"}]')

      expect(await readFile(path, 'utf8')).toBe('[{"id":"main"}]\n')
      // 临时文件不能在目录里残留
      expect(await readdir(dir)).toEqual(['accounts.json'])

      // 原子替换后拿到的是新文件的权限，不会被旧文件的 0666 带过去
      if (process.platform !== 'win32') {
        expect((await stat(path)).mode & 0o777).toBe(0o600)
      }
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
      expect(await readFile(path, 'utf8')).toBe('{"ok":true}\n')

      // Windows 不对 POSIX 权限位建模（chmod 只能切换只读标记），mode 断言只在类 Unix 平台有意义。
      if (process.platform !== 'win32') {
        expect((await stat(path)).mode & 0o777).toBe(0o600)

        // 覆盖已有文件时也要收紧到 0600，而不只是新建时。
        await writeFile(path, '{"ok":false}\n', { mode: 0o644 })
        await store.writeAccounts('{"ok":true}')
        expect((await stat(path)).mode & 0o777).toBe(0o600)
      }
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

  it('seeds Upstash accounts from an initial payload when the key is missing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 'OK' }), { status: 200 }))
    const store = new UpstashAccountStore('https://redis.example.com', 'redis-token', 'accounts', fetchMock, '[{"id":"main"}]')

    await expect(store.readAccounts()).resolves.toBe('[{"id":"main"}]')

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
        body: '[{"id":"main"}]',
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

  it('stores keys containing characters Windows forbids in file names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-state-colon-'))
    const store = new FileStateStore(dir, 'prod')

    try {
      // 真实业务 key 形如 attendance:<accountId>:<YYYY-MM-DD>，冒号在 Windows 文件名里非法
      await store.set('attendance:main:2026-11-25', { status: 'success' })
      await store.set('attendance:alt:2026-11-25', { status: 'alt' })
      await store.set('trailing.', { trailing: true })

      await expect(store.get('attendance:main:2026-11-25')).resolves.toEqual({ status: 'success' })
      await expect(store.get('attendance:alt:2026-11-25')).resolves.toEqual({ status: 'alt' })
      await expect(store.get('trailing.')).resolves.toEqual({ trailing: true })

      const files = await readdir(join(dir, 'prod', 'v2'))
      expect(files).toContain('k-attendance%3amain%3a2026-11-25.json')
      expect(files).toContain('k-attendance%3aalt%3a2026-11-25.json')
      expect(files).toContain('k-trailing%2e.json')
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps distinct keys in distinct files on case-insensitive filesystems', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-state-case-'))
    const store = new FileStateStore(dir, 'prod')

    try {
      // 大写字母也转义，Windows / macOS 默认卷不会把 Main 和 main 当成同一个文件
      await store.set('attendance:Main:2026-11-25', { account: 'Main' })
      await store.set('attendance:main:2026-11-25', { account: 'main' })

      await expect(store.get('attendance:Main:2026-11-25')).resolves.toEqual({ account: 'Main' })
      await expect(store.get('attendance:main:2026-11-25')).resolves.toEqual({ account: 'main' })

      // key 里带 `%` 也不例外：它自己会被转义成 %25，不会和别的 key 的编码撞上
      await store.set('a:b', { key: 'a:b' })
      await store.set('a%3ab', { key: 'a%3ab' })
      await expect(store.get('a:b')).resolves.toEqual({ key: 'a:b' })
      await expect(store.get('a%3ab')).resolves.toEqual({ key: 'a%3ab' })
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not let Windows reserved device names share a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-state-reserved-'))
    const store = new FileStateStore(dir, 'prod')

    try {
      // `con` 不能简单加成 `_con`：那样会和真的叫 `_con` 的账号撞名。
      // 带扩展名的 `con.txt` 同样是 Windows 保留名。
      await store.set('con', { key: 'con' })
      await store.set('_con', { key: '_con' })
      await store.set('con.txt', { key: 'con.txt' })
      await store.set('NUL', { key: 'NUL' })

      await expect(store.get('con')).resolves.toEqual({ key: 'con' })
      await expect(store.get('_con')).resolves.toEqual({ key: '_con' })
      await expect(store.get('con.txt')).resolves.toEqual({ key: 'con.txt' })
      await expect(store.get('NUL')).resolves.toEqual({ key: 'NUL' })

      expect(await readdir(join(dir, 'prod', 'v2'))).toHaveLength(4)
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to a fixed-length file name for very long keys', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-state-long-'))
    const store = new FileStateStore(dir, 'prod')
    // 225 个字符的账号 id + 两个冒号，转义后会超过单段 255 字节上限
    const longKey = `attendance:${'a'.repeat(225)}:2026-11-25`

    try {
      await store.set(longKey, { status: 'success' })
      await expect(store.get(longKey)).resolves.toEqual({ status: 'success' })
      const [fileName] = await readdir(join(dir, 'prod', 'v2'))
      expect(fileName).toMatch(/^k-~[0-9a-f]{64}\.json$/)
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // 旧版本直接把 key 当文件名（`attendance:main:...`），只有类 Unix 平台存在这种存量文件。
  it.skipIf(process.platform === 'win32')('reads state written by older versions and keeps the legacy file for older runners', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-state-legacy-'))
    const legacyPath = join(dir, 'prod', 'attendance:main:2026-11-25.json')
    const store = new FileStateStore(dir, 'prod')

    try {
      await mkdir(join(dir, 'prod'), { recursive: true })
      await writeFile(legacyPath, JSON.stringify({ status: 'success' }), 'utf8')

      await expect(store.get('attendance:main:2026-11-25')).resolves.toEqual({ status: 'success' })

      await store.set('attendance:main:2026-11-25', { status: 'success', updated: true })
      await expect(store.get('attendance:main:2026-11-25')).resolves.toEqual({ status: 'success', updated: true })

      // 旧文件留着并同步成最新值：还没升级的进程只认旧文件名，删掉它就会当天重复签到。
      expect(JSON.parse(await readFile(legacyPath, 'utf8'))).toEqual({ status: 'success', updated: true })
      expect(await readdir(join(dir, 'prod', 'v2'))).toEqual(['k-attendance%3amain%3a2026-11-25.json'])
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('never touches another key\'s file in the legacy directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-state-isolation-'))
    const store = new FileStateStore(dir, 'prod')

    try {
      // 旧文件名 `a:b.json` 正好等于 key `a%3Ab` 的「转义名」。分目录之后两者互不影响。
      await store.set('a:b', 1)
      await expect(store.get('a%3Ab')).resolves.toBeUndefined()

      await store.set('a%3Ab', 2)
      await expect(store.get('a:b')).resolves.toBe(1)
      await expect(store.get('a%3Ab')).resolves.toBe(2)
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('reads legacy files for keys that only became escaped now', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-state-legacy-percent-'))
    const legacyPath = join(dir, 'prod', 'foo%bar.json')
    const store = new FileStateStore(dir, 'prod')

    try {
      await mkdir(join(dir, 'prod'), { recursive: true })
      await writeFile(legacyPath, JSON.stringify({ ok: 1 }), 'utf8')

      // `%` 现在会被转义，但旧版本就能写出这个名字，状态不能读着读着就没了
      await expect(store.get('foo%bar')).resolves.toEqual({ ok: 1 })
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('falls back to the legacy file when the new file is corrupt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-state-corrupt-'))
    const store = new FileStateStore(dir, 'prod')

    try {
      await mkdir(join(dir, 'prod'), { recursive: true })
      await writeFile(join(dir, 'prod', 'attendance:main:2026-11-25.json'), JSON.stringify({ status: 'success' }), 'utf8')
      await mkdir(join(dir, 'prod', 'v2'), { recursive: true })
      // 迁移写到一半被打断留下的半个文件
      await writeFile(join(dir, 'prod', 'v2', 'k-attendance%3amain%3a2026-11-25.json'), '{"status":', 'utf8')

      await expect(store.get('attendance:main:2026-11-25')).resolves.toEqual({ status: 'success' })
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('leaves no temporary files behind when writing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-state-tmp-'))
    const store = new FileStateStore(dir, 'prod')

    try {
      await store.set('attendance:main:2026-11-25', { status: 'success' })
      const files = await readdir(join(dir, 'prod', 'v2'))
      expect(files.filter(name => name.endsWith('.tmp'))).toEqual([])
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

describe('AccountStore concurrency and file handling', () => {
  const accountRecord = (id: string, token: string) => ({ id, name: id, uid: id, deviceId: `device-${id}`, refreshToken: token })

  it('serializes concurrent updates so both tokens survive', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-account-lock-'))
    const path = join(dir, 'accounts.json')
    await writeFile(path, JSON.stringify([accountRecord('a', 'old-a'), accountRecord('b', 'old-b')]), 'utf8')

    // 两个实例（两个 store 对象）各自刷新一个账号：B 立刻拿到锁，A 在 build 里等待，
    // 说明锁覆盖了「读 → 合并 → 写」全过程，A 必须读到 B 刚写好的内容。
    const storeA = new FileAccountStore(path)
    const storeB = new FileAccountStore(path)
    const patchToken = (latest: string, id: string, token: string) => {
      const list = JSON.parse(latest) as Array<Record<string, unknown>>
      const target = list.find(item => item.id === id)
      if (!target) {
        throw new Error(`缺少账号 ${id}`)
      }
      target.refreshToken = token
      return JSON.stringify(list)
    }

    try {
      await Promise.all([
        storeB.updateAccounts(latest => patchToken(latest, 'b', 'new-b')),
        storeA.updateAccounts(async (latest) => {
          await new Promise(resolve => setTimeout(resolve, 30))
          return patchToken(latest, 'a', 'new-a')
        }),
      ])

      const final = JSON.parse(await readFile(path, 'utf8')) as Array<Record<string, unknown>>
      expect(final.map(item => item.refreshToken)).toEqual(['new-a', 'new-b'])
      // 锁文件用完要清掉，不能留在账号文件旁边
      expect(await readdir(dir)).toEqual(['accounts.json'])
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('requires the caller to read the latest content inside the lock', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-account-skip-'))
    const path = join(dir, 'accounts.json')
    await writeFile(path, JSON.stringify([accountRecord('a', 'old-a')]), 'utf8')
    const store = new FileAccountStore(path)

    try {
      await store.updateAccounts(() => undefined)
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([accountRecord('a', 'old-a')])
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('updates the symlink target instead of replacing the link', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-account-symlink-'))
    const target = join(dir, 'shared-accounts.json')
    const link = join(dir, 'accounts.json')
    await writeFile(target, JSON.stringify([accountRecord('a', 'old-a')]), { encoding: 'utf8', mode: 0o600 })
    await symlink(target, link)

    const store = new FileAccountStore(link)

    try {
      await store.writeAccounts(JSON.stringify([accountRecord('a', 'new-a')]))

      // 链接还是链接，共享目标里已经是新内容
      expect((await lstat(link)).isSymbolicLink()).toBe(true)
      expect(JSON.parse(await readFile(target, 'utf8'))).toEqual([accountRecord('a', 'new-a')])
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('tightens an already world-readable account file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-account-mode-'))
    const path = join(dir, 'accounts.json')
    await writeFile(path, '[]\n', 'utf8')
    // 先真的放宽到 0644：直接 writeFile({mode}) 覆写已有文件不会改权限，测不出问题
    await chmod(path, 0o644)

    const store = new FileAccountStore(path)

    try {
      await store.writeAccounts(JSON.stringify([accountRecord('a', 'new-a')]))
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('FileStateStore legacy compatibility', () => {
  it.skipIf(process.platform === 'win32')('reads legacy markers whose file name is near the length limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-state-legacy-long-'))
    const longId = 'a'.repeat(225)
    const key = `attendance:${longId}:2026-11-25`
    const legacyPath = join(dir, 'prod', `${key}.json`)
    const store = new FileStateStore(dir, 'prod')

    try {
      await mkdir(join(dir, 'prod'), { recursive: true })
      await writeFile(legacyPath, JSON.stringify({ status: 'success', accountId: longId, date: '2026-11-25' }), 'utf8')

      // 旧版能写出来的名字（252 字节）不能因为长度预判就跳过，否则升级当天重复签到
      await expect(store.get(key)).resolves.toEqual({
        status: 'success',
        accountId: longId,
        date: '2026-11-25',
      })
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('ignores a legacy marker that belongs to another account', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-state-legacy-owner-'))
    const store = new FileStateStore(dir, 'prod')

    try {
      await mkdir(join(dir, 'prod'), { recursive: true })
      // 大小写不敏感卷上，key `main` 会命中旧版本为 `Main` 写的文件
      await writeFile(
        join(dir, 'prod', 'attendance:main:2026-11-25.json'),
        JSON.stringify({ status: 'success', accountId: 'Main', date: '2026-11-25' }),
        'utf8',
      )

      await expect(store.get('attendance:main:2026-11-25')).resolves.toBeUndefined()
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('keeps the permission bits of an existing state file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taygedo-state-mode-'))
    const store = new FileStateStore(dir, 'prod')

    try {
      await store.set('last-run', { ok: true })
      const [fileName] = await readdir(join(dir, 'prod', 'v2'))
      const filePath = join(dir, 'prod', 'v2', fileName as string)
      // 老部署里这个文件可能是 0600（里面有 Webhook URL / SendKey）
      await chmod(filePath, 0o600)

      await store.set('last-run', { ok: false })
      expect((await stat(filePath)).mode & 0o777).toBe(0o600)
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
