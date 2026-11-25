import { loadRuntimeConfig } from '../config/runtime.js'
import { AttendanceService } from '../services/attendance-service.js'
import { LoginService, type LoginServiceRunOptions } from '../services/login-service.js'
import { createAccountStore, createStateStore } from '../stores/factory.js'
import { FileAccountStore } from '../stores/account-store.js'
import { loadOrCreateCredentialKey } from '../config/credentials.js'
import { ensureAccountDevice } from '../taygedo/device.js'
import { parseAccountsSecret } from '../config/accounts.js'
import { runWithOptionalLoop } from './loop.js'
import { isEntryModule } from '../utils/entry.js'
import { readTextFile } from '../utils/text.js'

interface LocalCliDependencies {
  service?: LocalCliService
}

interface LocalCliService {
  runAttendance(options: { accountsFile: string, stateDir?: string, forceRun?: boolean }): Promise<unknown>
  runLogin(options: LoginServiceRunOptions): Promise<unknown>
  sendLoginCode(options: LoginServiceRunOptions): Promise<unknown>
  updateDevices(options: { accountsFile: string, accountId?: string, force?: boolean, print?: boolean }): Promise<unknown>
}

export async function runLocalCli(argv = process.argv.slice(2), deps: LocalCliDependencies = {}): Promise<void> {
  const command = argv[0]
  const options = parseArgs(argv.slice(1))
  const service: LocalCliService = deps.service ?? createDefaultService()

  if (command === 'attendance') {
    const accountsFile = options['accounts-file']
    // 常驻/定时开关只在本地 CLI 生效，统一走运行时配置解析，避免两处解析行为不一致。
    const config = loadRuntimeConfig(process.env)
    await runWithOptionalLoop({
      loopSeconds: config.loopSeconds,
      dailyAt: config.dailyAt,
      runOnce: async () => {
        await service.runAttendance({
          accountsFile: accountsFile ?? '',
          stateDir: options['state-dir'],
          forceRun: options.force === 'true' || options.force === '1' || options.force === '',
        })
      },
    })
    return
  }

  if (command === 'login') {
    const accountsFile = requireOption(options, 'accounts-file')
    await service.runLogin({
      mode: requireOption(options, 'mode'),
      phone: requireOption(options, 'phone'),
      password: optionalValue(options.password) ?? optionalValue(process.env.TAYGEDO_LOGIN_PASSWORD) ?? optionalValue(process.env.TAYGEDO_PASSWORD),
      captcha: options.captcha,
      deviceId: options['device-id'],
      newDevice: options['new-device'] === 'true' || options['new-device'] === '1' || options['new-device'] === '',
      accountId: options['account-id'],
      accountName: options['account-name'],
      accountsFile,
      credentialKey: options['credential-key'],
      credentialKeyPath: options['credential-key-file'],
    })
    return
  }

  if (command === 'device') {
    await service.updateDevices({
      accountsFile: requireOption(options, 'accounts-file'),
      accountId: options['account-id'],
      force: options.force === 'true' || options.force === '1' || options.force === '',
      print: options.print === 'true' || options.print === '1' || options.print === '',
    })
    return
  }

  throw new Error('用法：local-cli attendance|login|device --accounts-file <path>')
}

function createDefaultService(): LocalCliService {
  return {
    async runAttendance(options) {
      const config = loadRuntimeConfig({
        ...process.env,
        TAYGEDO_ACCOUNT_STORE: process.env.TAYGEDO_ACCOUNT_STORE ?? 'file',
        TAYGEDO_STATE_STORE: process.env.TAYGEDO_STATE_STORE ?? 'file',
      })
      // 少了这个参数只会读到空路径，报 `ENOENT: open ''`，完全看不出是哪个参数漏了。
      if (config.accountStore === 'file' && !options.accountsFile) {
        throw new Error('缺少必需参数 --accounts-file（TAYGEDO_ACCOUNT_STORE=file 需要账号文件路径）')
      }
      const credentialKey = config.credentialKey ?? (config.credentialKeyPath
        ? await loadOrCreateCredentialKey(config.credentialKeyPath)
        : undefined)
      await new AttendanceService({
        accountStore: createAccountStore({ config, accountsFile: options.accountsFile }),
        stateStore: createStateStore({ config, stateDir: options.stateDir }),
        accountPasswords: config.accountPasswords,
        credentialKey,
        notificationUrls: config.notificationUrls,
        maxRetries: config.maxRetries,
        accountConcurrency: config.accountConcurrency,
        forceRun: options.forceRun ?? config.forceRun,
        coinTasks: config.coinTasks,
        cloudDuration: config.cloudDuration,
        sharePlatform: config.sharePlatform,
      }).run()
    },
    async runLogin(options) {
      const credentialKeyPath = optionalValue(options.credentialKeyPath) ?? optionalValue(process.env.TAYGEDO_CREDENTIAL_KEY_PATH)
      const generatedCredentialKey = optionalValue(options.credentialKey) ?? optionalValue(process.env.TAYGEDO_CREDENTIAL_KEY) ?? (credentialKeyPath
        ? await loadOrCreateCredentialKey(credentialKeyPath)
        : undefined)
      await new LoginService().runLogin({
        ...options,
        credentialKey: generatedCredentialKey,
      })
    },
    async sendLoginCode(options) {
      await new LoginService().sendLoginCode(options)
    },
    async updateDevices(options) {
      const payload = await readTextFile(options.accountsFile)
      const accounts = parseAccountsSecret(payload)
      const updatedAccounts = accounts.map(account => {
        if (options.accountId && account.id !== options.accountId) {
          return account
        }
        return ensureAccountDevice(account, { force: options.force })
      })
      const nextPayload = JSON.stringify(updatedAccounts, null, 2)
      console.log(nextPayload.trim())
      if (!options.print) {
        // 走 FileAccountStore，账号文件才会带上 0600 权限（Windows 上 IDE 才不会提示明文凭据）。
        await new FileAccountStore(options.accountsFile).writeAccounts(nextPayload)
      }
    },
  }
}

function parseArgs(args: string[]): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {}
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg?.startsWith('--')) {
      continue
    }
    const next = args[index + 1]
    if (!next || next.startsWith('--')) {
      parsed[arg.slice(2)] = ''
      continue
    }
    parsed[arg.slice(2)] = next
    index++
  }
  return parsed
}

function requireOption(options: Record<string, string | undefined>, key: string): string {
  const value = options[key]
  if (!value) {
    throw new Error(`缺少必需参数 --${key}`)
  }
  return value
}

function optionalValue(value: string | undefined): string | undefined {
  if (!value || value.trim() === '') {
    return undefined
  }
  return value
}

if (isEntryModule(import.meta.url)) {
  runLocalCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
