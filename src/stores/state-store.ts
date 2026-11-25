import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { readTextFile } from '../utils/text.js'
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
      return JSON.parse(await readTextFile(this.pathFor(key))) as T
    }
    catch (error) {
      if (!isNotFoundError(error)) {
        throw error
      }
    }

    // 兼容旧版本写在未转义文件名下的状态（Linux/Docker 已有部署），
    // 命中后继续沿用，等下次 set 时再迁移到新文件名。
    const legacyPath = this.legacyPathFor(key)
    if (!legacyPath) {
      return undefined
    }
    try {
      return JSON.parse(await readTextFile(legacyPath)) as T
    }
    catch (error) {
      if (isNotFoundError(error)) {
        return undefined
      }
      throw error
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const path = this.pathFor(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(value), 'utf8')
    const legacyPath = this.legacyPathFor(key)
    if (legacyPath) {
      // 新文件名写成功后清掉旧文件，避免长期保留两份状态。
      await rm(legacyPath, { force: true }).catch(() => undefined)
    }
  }

  private pathFor(key: string): string {
    const safeParts = this.safePartsOf(key)
    const basePath = resolve(this.baseDir, this.prefix)
    // 业务 key 本身就带冒号（`attendance:<id>:<date>`），而冒号在 Windows 文件名里
    // 非法：写文件会报 ENOENT，或者被当成 NTFS 数据流。所以每个路径片段都要转义。
    const targetPath = resolve(basePath, ...safeParts.map(escapePathSegment)) + '.json'
    // 用 relative 判断越界，不能写死 `${basePath}/`：Windows 的分隔符是 `\`，
    // 写死 `/` 会把所有合法 key 都判成越界。
    if (!isInsideDirectory(basePath, targetPath) && targetPath !== `${basePath}.json`) {
      throw new Error('状态 key 包含非法路径片段')
    }
    return targetPath
  }

  /** 旧版本（未转义）的文件路径；不需要兼容或与当前路径相同时返回 undefined。 */
  private legacyPathFor(key: string): string | undefined {
    // Windows 上这种带冒号的文件名本来就创建不出来，不存在需要迁移的数据。
    if (process.platform === 'win32') {
      return undefined
    }
    const legacyPath = `${resolve(resolve(this.baseDir, this.prefix), ...this.safePartsOf(key))}.json`
    return legacyPath === this.pathFor(key) ? undefined : legacyPath
  }

  private safePartsOf(key: string): string[] {
    const safeParts = key.split('/').filter(Boolean)
    if (safeParts.some(part => part === '.' || part === '..')) {
      throw new Error('状态 key 包含非法路径片段')
    }
    return safeParts
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

// Windows 文件名禁用字符，外加控制字符。
const UNSAFE_FILENAME_CHARS = /[%<>:"/\\|?*\u0000-\u001F]/g
// Windows 保留设备名，`con.json` 这类名字同样无法创建。
const RESERVED_FILENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * 把状态 key 的片段转义成 Windows / POSIX 都能落盘的文件名。
 * 只在两个平台产生同一套名字，测试与线上行为才一致。
 */
function escapePathSegment(segment: string): string {
  const escaped = segment
    .replace(UNSAFE_FILENAME_CHARS, char => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
    // 片段结尾的点和空格在 Windows 上会被静默丢弃，导致不同 key 落到同一文件。
    .replace(/[. ]+$/, match => match.replace(/\./g, '%2E').replace(/ /g, '%20'))
  return RESERVED_FILENAME.test(escaped) ? `_${escaped}` : escaped
}

function isInsideDirectory(basePath: string, targetPath: string): boolean {
  const relativePath = relative(basePath, targetPath)
  if (relativePath === '' || isAbsolute(relativePath)) {
    // 空路径不是文件；跨盘符时 relative 返回绝对路径，同样视为越界。
    return false
  }
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`)
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
    await this.request(`set/${encodeURIComponent(this.fullKey(key))}${ttlQuery}`, {
      method: 'POST',
      body: JSON.stringify(value),
    })
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
      ...init,
      headers: {
        ...init.headers,
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
