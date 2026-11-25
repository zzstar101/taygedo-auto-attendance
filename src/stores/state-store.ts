import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { readTextFile } from '../utils/text.js'
import { writeFileAtomically } from '../utils/atomic-write.js'
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

/**
 * 新版状态文件名独占的子目录。
 *
 * 旧版直接把 key 当文件名（`attendance:main:2026-11-25.json`），新版是转义后的
 * 文件名（`k-attendance%3amain%3a2026-11-25.json`）。两者放在同一目录会互相干扰：
 * key `a%3Ab` 的旧文件名，正好等于 key `a:b` 的新文件名，清理「旧文件」时会把
 * 别的 key 的新数据删掉。分目录之后，旧路径的读写永远不会碰到新版数据。
 */
const CURRENT_LAYOUT_DIR = 'v2'
/** 单段文件名上限（常见文件系统 255 字节），超过就退化成定长哈希名。 */
const MAX_FILE_NAME_LENGTH = 150

export class FileStateStore implements StateStore {
  constructor(
    private readonly baseDir: string,
    private readonly prefix = 'taygedo',
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const currentPath = this.pathFor(key)
    const current = await this.readPath<T>(currentPath)
    if (current.found) {
      return current.value
    }

    // 兼容旧版本写在未转义文件名下的状态（Linux/Docker 已有部署）。
    const legacyPath = this.legacyPathFor(key)
    if (legacyPath) {
      const legacy = await this.readPath<T>(legacyPath)
      if (legacy.found && belongsToKey(legacy.value, key)) {
        return legacy.value
      }
      if (legacy.found) {
        // 大小写不敏感的卷上，key `main` 会读到旧版本为 `Main` 写的文件；
        // 直接拿来用会让 `main` 第一次签到就被判成「今天已签到」。
        console.warn(`旧版状态文件不属于这个 key，已忽略：${legacyPath}`)
      }
    }
    if (current.corrupt || legacyPath) {
      // 迁移竞态：刚读到「新文件不存在」，另一个进程可能已经把状态迁过去并删了旧文件。
      // 返回 undefined 会让调用方重复签到，所以这里再看一眼新文件。
      const retry = await this.readPath<T>(currentPath)
      if (retry.found) {
        return retry.value
      }
    }
    return undefined
  }

  async set<T>(key: string, value: T): Promise<void> {
    const payload = JSON.stringify(value)
    // preserveMode：已有状态文件是 0600 就保持 0600。`last-run.json` 里可能带着完整的
    // Webhook URL / SendKey，换成原子写之后不能因为 umask 把它放大成 0644。
    await writeFileAtomically(this.pathFor(key), payload, { preserveMode: true })
    await this.syncLegacyFile(key, payload)
  }

  private async readPath<T>(path: string): Promise<{ found: boolean, corrupt: boolean, value?: T }> {
    let text: string
    try {
      text = await readTextFile(path)
    }
    catch (error) {
      if (isMissingPathError(error)) {
        return { found: false, corrupt: false }
      }
      throw error
    }
    try {
      return { found: true, corrupt: false, value: JSON.parse(text) as T }
    }
    catch {
      // 半个文件（写入/迁移中途被打断）不该让整个运行失败：当成没读到，
      // 交给下面的旧文件回退。
      console.warn(`状态文件不是合法 JSON，已忽略：${path}`)
      return { found: false, corrupt: true }
    }
  }

  /**
   * 旧文件名还留在磁盘上的部署：把最新值同步一份过去。
   *
   * 只更新已存在的旧文件，不新建、也绝不删除——老版本进程只认旧文件名，
   * 删掉会让它读不到「今天已签到」标记而重复签到。
   */
  private async syncLegacyFile(key: string, payload: string): Promise<void> {
    const legacyPath = this.legacyPathFor(key)
    if (!legacyPath) {
      return
    }
    try {
      const existing = await readTextFile(legacyPath)
      if (existing !== payload) {
        await writeFileAtomically(legacyPath, payload, { preserveMode: true })
      }
    }
    catch (error) {
      if (isMissingPathError(error)) {
        return
      }
      console.warn(`旧版状态文件同步失败（不影响本次运行）：${legacyPath}`)
    }
  }

  private pathFor(key: string): string {
    const basePath = resolve(this.baseDir, this.prefix, CURRENT_LAYOUT_DIR)
    // key 里可能带冒号（`attendance:<id>:<date>`）、斜杠、非 ASCII 字符，全部按字节
    // 转义进单个文件名，不再拼目录层级：层级拼法会把 `a//b` 和 `a/b` 合并成同一个
    // 文件，长度也不再可控。
    const targetPath = resolve(basePath, stateFileName(key))
    if (!isInsideDirectory(basePath, targetPath)) {
      throw new Error('状态 key 包含非法路径片段')
    }
    return targetPath
  }

  /** 旧版本（未转义）的文件路径；不需要兼容或 Windows 上根本创建不出来时返回 undefined。 */
  private legacyPathFor(key: string): string | undefined {
    if (key.split('/').some(part => part === '.' || part === '..')) {
      return undefined
    }
    const segments = key.split('/').filter(Boolean)
    if (!segments.length || !segments.every(isLegacySegmentCreatable)) {
      return undefined
    }
    const basePath = resolve(this.baseDir, this.prefix)
    const legacyPath = `${resolve(basePath, ...segments)}.json`
    return isInsideDirectory(basePath, legacyPath) ? legacyPath : undefined
  }
}

function isMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) {
    return false
  }
  // ENAMETOOLONG：转义后的名字超长（老实现会直接抛出，连已有状态都读不到）。
  // ENOTDIR / EINVAL：名字里带分隔符之类的非法形态。
  return ['ENOENT', 'ENOTDIR', 'EINVAL', 'ENAMETOOLONG'].includes(String(error.code))
}

/** 转义结果字符表：小写字母、数字、`_`、`-`，其余字节写成 `%xx`（小写十六进制）。 */
function isSafeKeyByte(byte: number): boolean {
  return (byte >= 0x61 && byte <= 0x7a)
    || (byte >= 0x30 && byte <= 0x39)
    || byte === 0x5f
    || byte === 0x2d
}

/**
 * 把整个 key 编码成文件名，保证「不同 key → 不同文件名」，且在大小写不敏感的
 * 文件系统（Windows、macOS 默认）上也不会串。
 *
 * - 大写字母也转义（`A` → `%41`）：否则 `Main` 和 `main` 在 Windows 上是同一个
 *   文件，两个账号会共用签到记录。
 * - `%` 自己也被转义（`%25`），编码因此可逆、无歧义。
 * - 固定加 `k-` 前缀：`con`、`nul`、`con.txt` 这类 Windows 保留设备名永远不会命中。
 */
function encodeStateKey(key: string): string {
  let encoded = ''
  for (const byte of Buffer.from(key, 'utf8')) {
    encoded += isSafeKeyByte(byte) ? String.fromCharCode(byte) : `%${byte.toString(16).padStart(2, '0')}`
  }
  return `k-${encoded}`
}

function stateFileName(key: string): string {
  validateStateKey(key)
  const encoded = encodeStateKey(key)
  if (encoded.length <= MAX_FILE_NAME_LENGTH) {
    return `${encoded}.json`
  }
  // 转义会把名字撑大（`:` 变 3 倍、非 ASCII 最多 9 倍），超过文件系统上限就是
  // ENAMETOOLONG，签到会在读已有状态那一步直接终止。超长时退化成定长哈希名；
  // `~` 不在转义字符表里，不会和任何普通 key 的编码撞名。
  return `k-~${createHash('sha256').update(key, 'utf8').digest('hex')}.json`
}

function validateStateKey(key: string): void {
  if (key === '') {
    throw new Error('状态 key 不能为空')
  }
  if (key.includes('\u0000') || key.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('状态 key 包含非法路径片段')
  }
}

/** Windows 保留设备名（`con` / `nul` / `com1`…），带扩展名的 `con.txt` 同样不可用。 */
const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
// Windows 文件名禁用字符，外加控制字符。
const UNSAFE_LEGACY_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/

/**
 * 旧版实现到底能不能写出这个文件名 —— 写不出来的自然没有存量数据可迁移。
 *
 * 这里只排除「Windows 上确实创建不出来」的名字，不做长度预判：225 个字符的账号 id
 * 生成的旧文件名（252 字节）在多数文件系统上是能写的，主分支已经写过这种文件，
 * 预判成「不存在」会让升级当天的去重失效、重复签到。太长的名字读的时候会报
 * ENAMETOOLONG，按未命中处理即可。
 */
function isLegacySegmentCreatable(segment: string): boolean {
  if (segment === '') {
    return false
  }
  if (process.platform !== 'win32') {
    return true
  }
  return !UNSAFE_LEGACY_FILENAME_CHARS.test(segment)
    && !RESERVED_DEVICE_NAME.test(segment)
    && !/[. ]$/.test(segment)
}

/**
 * 旧文件里的记录是否属于当前 key。
 *
 * 只有大小写不敏感的文件系统才会「读到别人的文件」（`Main.json` 被 `main` 命中），
 * 所以这里按记录自带的 `accountId` / `date` 反查 key 是否匹配；没有这些字段的记录
 * （`last-run` / `last-summary`）原样信任。
 */
function belongsToKey(value: unknown, key: string): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return true
  }
  const record = value as Record<string, unknown>
  if (typeof record.accountId === 'string' && !key.includes(record.accountId)) {
    return false
  }
  if (typeof record.date === 'string' && !key.includes(record.date)) {
    return false
  }
  return true
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
