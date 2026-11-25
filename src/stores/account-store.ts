import { readTextFile } from '../utils/text.js'
import { writeSecretFile } from '../utils/atomic-write.js'
import { withFileLock } from '../utils/file-lock.js'

export interface AccountStore {
  readAccounts(): Promise<string>
  writeAccounts(payload: string): Promise<void>
  /** 只读存储（例如环境变量）为 false；默认视为可写。 */
  readonly writable?: boolean
  /**
   * 原子地「读 → 合并 → 写」。
   *
   * 支持的后端用跨进程锁或条件写入覆盖整个过程：两个实例并发刷新不同账号时，
   * 后写的一方必须读到前一方刚写好的内容，否则会把对方的新 token 覆盖回旧值。
   * 没实现的后端退化成「读一次 + 写一次」，并发时仍有覆盖窗口。
   */
  updateAccounts?(build: (latest: string) => string | undefined | Promise<string | undefined>): Promise<void>
}

export interface KvNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export class EnvAccountStore implements AccountStore {
  readonly writable = false

  constructor(private readonly accountsSecret: string | undefined) {}

  async readAccounts(): Promise<string> {
    if (!this.accountsSecret) {
      throw new Error('缺少必需环境变量 TAYGEDO_ACCOUNTS')
    }
    return this.accountsSecret
  }

  async writeAccounts(): Promise<void> {
    throw new Error('环境变量账号存储是只读的')
  }
}

export class FileAccountStore implements AccountStore {
  readonly writable = true

  constructor(private readonly path: string) {}

  async readAccounts(): Promise<string> {
    // Windows 上用记事本 / PowerShell 保存的账号文件可能带 BOM 或干脆是 UTF-16。
    return (await readTextFile(this.path)).trim()
  }

  async writeAccounts(payload: string): Promise<void> {
    // 先写 0600 的临时文件再原子替换：`writeFile` 的 mode 只在新建文件时生效，
    // 覆盖已有文件不会收紧权限，而「写完再 chmod」的窗口期里新凭据已经可被其他
    // 用户读到（已有文件属于别人且是 0666 时，chmod 还会直接 EPERM）。
    await writeSecretFile(this.path, `${payload}\n`)
  }

  async updateAccounts(
    build: (latest: string) => string | undefined | Promise<string | undefined>,
  ): Promise<void> {
    // 「读 → 合并 → 写」整体放进跨进程锁：只靠原子写仍会丢更新——两个实例可能都
    // 读到同一份旧内容，后写的一方把对方刚刷新的 token 覆盖回去。
    await withFileLock(`${this.path}.lock`, async () => {
      const latest = await this.readAccounts()
      const next = await build(latest)
      if (next === undefined) {
        return
      }
      await this.writeAccounts(next)
    })
  }
}

export class GitHubFileAccountStore extends FileAccountStore {}

export class CloudflareKvAccountStore implements AccountStore {
  constructor(
    private readonly kv: KvNamespace,
    private readonly key: string,
    private readonly initialAccounts?: string,
  ) {}

  async readAccounts(): Promise<string> {
    const stored = await this.kv.get(this.key)
    if (stored) {
      return stored
    }
    if (!this.initialAccounts) {
      throw new Error(`Cloudflare KV 中缺少账号配置，key：${this.key}`)
    }
    await this.kv.put(this.key, this.initialAccounts)
    return this.initialAccounts
  }

  async writeAccounts(payload: string): Promise<void> {
    await this.kv.put(this.key, payload)
  }
}

export class UpstashAccountStore implements AccountStore {
  private readonly baseUrl: string

  constructor(
    url: string,
    private readonly token: string,
    private readonly key = 'TAYGEDO_ACCOUNTS',
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly initialAccounts?: string,
  ) {
    this.baseUrl = url.replace(/\/+$/, '')
  }

  async readAccounts(): Promise<string> {
    const data = await this.request<{ result?: string | null }>(`get/${encodeURIComponent(this.key)}`)
    if (!data.result) {
      if (this.initialAccounts) {
        await this.writeAccounts(this.initialAccounts)
        return this.initialAccounts
      }
      throw new Error(`Upstash 中缺少账号配置，key：${this.key}`)
    }
    return data.result
  }

  async writeAccounts(payload: string): Promise<void> {
    await this.request(`set/${encodeURIComponent(this.key)}`, {
      method: 'POST',
      body: payload,
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
      throw new Error(`Upstash 账号存储请求失败：HTTP ${response.status}`)
    }
    return await response.json() as T
  }
}
