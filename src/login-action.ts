import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { TaygedoApi, type BindRoleResponse, type LoginWithCaptchaResponse, type UserCenterLoginResponse } from './taygedo/api.js'
import { parseAccountsSecret, type TaygedoAccount } from './config/accounts.js'

export interface LoginActionDependencies {
  env?: Record<string, string | undefined>
  api?: Pick<TaygedoApi, 'sendCaptcha' | 'loginWithCaptcha' | 'userCenterLogin' | 'getBindRole'>
  generateDeviceId?: () => string
}

export async function runLoginAction(deps: LoginActionDependencies = {}): Promise<void> {
  const env = deps.env ?? process.env
  const mode = requireEnv(env, 'TAYGEDO_LOGIN_MODE')
  const phone = requireEnv(env, 'TAYGEDO_LOGIN_PHONE')
  const api = deps.api ?? new TaygedoApi()
  const deviceId = optionalEnv(env, 'TAYGEDO_LOGIN_DEVICE_ID') ?? deps.generateDeviceId?.() ?? generateDeviceId()
  const accountsPath = env.TAYGEDO_LOGIN_UPDATED_ACCOUNTS_PATH ?? env.TAYGEDO_UPDATED_ACCOUNTS_PATH ?? 'updated-accounts.json'

  if (mode === 'send-code') {
    await api.sendCaptcha(phone, deviceId)
    const devicePath = env.TAYGEDO_LOGIN_DEVICE_ID_PATH
    if (devicePath) {
      await writeTextFile(devicePath, `${deviceId}\n`)
    }
    console.log(`验证码已发送，deviceId: ${deviceId}`)
    return
  }

  if (mode !== 'login') {
    throw new Error('TAYGEDO_LOGIN_MODE must be send-code or login')
  }

  const captcha = requireEnv(env, 'TAYGEDO_LOGIN_CAPTCHA')
  const accountId = requireEnv(env, 'TAYGEDO_LOGIN_ACCOUNT_ID')
  const accountName = optionalEnv(env, 'TAYGEDO_LOGIN_ACCOUNT_NAME') ?? accountId

  const loginResult = await api.loginWithCaptcha(phone, captcha, deviceId)
  const userCenter = await api.userCenterLogin(loginResult.token, loginResult.userId, deviceId)
  const role = await tryGetBindRole(api, userCenter.accessToken, userCenter.uid)

  const nextAccount: TaygedoAccount = {
    id: accountId,
    name: accountName,
    uid: userCenter.uid,
    deviceId,
    refreshToken: userCenter.refreshToken,
  }
  if (role.roleId) {
    nextAccount.roleId = role.roleId
  }
  if (role.roleName) {
    nextAccount.roleName = role.roleName
  }

  const currentAccounts = env.TAYGEDO_ACCOUNTS ? parseAccountsSecret(env.TAYGEDO_ACCOUNTS) : []
  const updatedAccounts = upsertAccount(currentAccounts, nextAccount)
  await writeTextFile(accountsPath, `${JSON.stringify(updatedAccounts, null, 2)}\n`)
  console.log(`账号已写入 ${accountsPath}`)
}

async function tryGetBindRole(api: Pick<TaygedoApi, 'getBindRole'>, accessToken: string, uid: string): Promise<BindRoleResponse> {
  try {
    return await api.getBindRole(accessToken, uid)
  }
  catch {
    return {}
  }
}

function upsertAccount(accounts: TaygedoAccount[], nextAccount: TaygedoAccount): TaygedoAccount[] {
  const index = accounts.findIndex(account => account.id === nextAccount.id)
  if (index === -1) {
    return [...accounts, nextAccount]
  }
  const copied = accounts.slice()
  copied[index] = nextAccount
  return copied
}

async function writeTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
}

function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]
  if (!value || value.trim() === '') {
    throw new Error(`Missing required env ${key}`)
  }
  return value
}

function optionalEnv(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]
  if (!value || value.trim() === '') {
    return undefined
  }
  return value
}

function generateDeviceId(): string {
  return randomBytes(16).toString('hex')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLoginAction().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
