import { loadRuntimeConfig } from './config/runtime.js'
import { TaygedoApi } from './taygedo/api.js'
import { runAttendance, type RunnerDependencies } from './runner.js'
import { GitHubFileAccountStore } from './stores/account-store.js'
import { MemoryStateStore } from './stores/state-store.js'
import { AttendanceService } from './services/attendance-service.js'

interface ActionOptions {
  env?: Record<string, string | undefined>
  api?: RunnerDependencies['api']
}

export async function runAction(options: ActionOptions = {}): Promise<void> {
  const env = options.env ?? process.env
  const config = loadRuntimeConfig(env)
  let accountsWritten = false
  console.log(`运行配置：金币任务=${config.coinTasks ? '开启' : '关闭'}，云异环=${config.cloudDuration ? '开启' : '关闭'}，分享平台=${config.sharePlatform}，强制重跑=${config.forceRun ? '是' : '否'}，账号并发=${config.accountConcurrency}`)
  const service = new AttendanceService({
    accountStore: {
      readAccounts: async () => {
        if (!config.accountsSecret) {
          throw new Error('缺少必需环境变量 TAYGEDO_ACCOUNTS')
        }
        return config.accountsSecret
      },
      writeAccounts: async (payload) => {
        await new GitHubFileAccountStore(config.updatedAccountsPath).writeAccounts(payload)
        accountsWritten = true
      },
    },
    stateStore: new MemoryStateStore(config.statePrefix),
    api: options.api ?? new TaygedoApi(),
    accountPasswords: config.accountPasswords,
    credentialKey: config.credentialKey,
    notificationUrls: config.notificationUrls,
    maxRetries: config.maxRetries,
    accountConcurrency: config.accountConcurrency,
    forceRun: config.forceRun,
    coinTasks: config.coinTasks,
    cloudDuration: config.cloudDuration,
    sharePlatform: config.sharePlatform,
  })
  const result = await service.run()

  if (accountsWritten) {
    console.log(`已写入更新后的账号文件：${config.updatedAccountsPath}`)
  }
  else {
    console.log(`账号凭据无变化，未生成更新文件：${config.updatedAccountsPath}`)
  }

  if (result.failedCount > 0) {
    throw new Error(`签到存在失败账号：失败账号数：${result.failedCount}，总账号数：${result.accounts.length}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAction().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
