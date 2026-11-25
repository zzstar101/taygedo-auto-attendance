import type { LoginActionDependencies } from '../login-action.js'
import { runLoginAction } from '../login-action.js'
import { readTextFile } from '../utils/text.js'

export interface LoginServiceRunOptions {
  mode: string
  phone: string
  password?: string
  captcha?: string
  deviceId?: string
  accountId?: string
  accountName?: string
  accountsFile?: string
  accountsSecret?: string
  credentialKey?: string
  credentialKeyPath?: string
  writeCredentialKey?: (credentialKey: string) => Promise<void>
  writeAccounts?: (payload: string) => Promise<void>
  newDevice?: boolean
}

export class LoginService {
  constructor(private readonly deps: Omit<LoginActionDependencies, 'env'> = {}) {}

  async sendLoginCode(options: LoginServiceRunOptions): Promise<void> {
    await this.runLogin({ ...options, mode: 'send-code' })
  }

  async runLogin(options: LoginServiceRunOptions): Promise<void> {
    const accountsSecret = options.accountsSecret ?? (options.accountsFile ? await tryReadFile(options.accountsFile) : undefined)
    await runLoginAction({
      ...this.deps,
      env: {
        TAYGEDO_LOGIN_MODE: options.mode,
        TAYGEDO_LOGIN_PHONE: options.phone,
        TAYGEDO_LOGIN_PASSWORD: options.password,
        TAYGEDO_LOGIN_CAPTCHA: options.captcha,
        TAYGEDO_LOGIN_DEVICE_ID: options.deviceId,
        TAYGEDO_LOGIN_NEW_DEVICE: options.newDevice ? 'true' : undefined,
        TAYGEDO_LOGIN_ACCOUNT_ID: options.accountId,
        TAYGEDO_LOGIN_ACCOUNT_NAME: options.accountName,
        TAYGEDO_CREDENTIAL_KEY: options.credentialKey,
        TAYGEDO_LOGIN_UPDATED_ACCOUNTS_PATH: options.writeAccounts ? undefined : options.accountsFile,
        TAYGEDO_ACCOUNTS: accountsSecret,
      },
      writeAccounts: options.writeAccounts,
      writeCredentialKey: options.writeCredentialKey,
    })
  }
}

async function tryReadFile(path: string): Promise<string | undefined> {
  try {
    return await readTextFile(path)
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}
