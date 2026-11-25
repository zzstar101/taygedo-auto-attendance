import { TaygedoApi } from '../taygedo/api.js'
import { runAttendance, type RunnerDependencies } from '../runner.js'
import type { AccountStore } from '../stores/account-store.js'
import type { StateStore } from '../stores/state-store.js'

export interface AttendanceServiceOptions {
  accountStore: AccountStore
  stateStore?: StateStore
  api?: RunnerDependencies['api']
  accountPasswords?: Record<string, string>
  credentialKey?: string
  notificationUrls?: string[]
  maxRetries?: number
  accountConcurrency?: number
  forceRun?: boolean
  coinTasks?: boolean
  cloudDuration?: boolean
  sharePlatform?: string
}

export class AttendanceService {
  constructor(private readonly options: AttendanceServiceOptions) {}

  async run(): Promise<Awaited<ReturnType<typeof runAttendance>>> {
    const accountsSecret = await this.options.accountStore.readAccounts()
    const store = this.options.accountStore
    // 只读存储（TAYGEDO_ACCOUNTS 环境变量）：刷出来的 token 本来就没地方放，
    // 不能因为「保存失败」把整次签到判成失败——签到、云时长其实都已经做完了。
    const writable = store.writable !== false
    const result = await runAttendance({
      accountsSecret,
      api: this.options.api ?? new TaygedoApi(),
      accountPasswords: this.options.accountPasswords,
      credentialKey: this.options.credentialKey,
      notificationUrls: this.options.notificationUrls,
      maxRetries: this.options.maxRetries,
      accountConcurrency: this.options.accountConcurrency,
      stateStore: this.options.stateStore,
      forceRun: this.options.forceRun,
      coinTasks: this.options.coinTasks,
      cloudDuration: this.options.cloudDuration,
      sharePlatform: this.options.sharePlatform,
      secretWriter: writable ? payload => store.writeAccounts(payload) : undefined,
      // 优先让存储后端自己加锁完成「读 → 合并 → 写」；没有实现的后端退回读一次再写。
      secretUpdater: writable && store.updateAccounts
        ? build => store.updateAccounts!(build)
        : undefined,
      accountsReader: writable ? () => store.readAccounts() : undefined,
    })
    return result
  }
}
