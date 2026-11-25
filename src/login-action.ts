import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { TaygedoApi, type BindRoleResponse, type LoginWithCaptchaResponse, type UserCenterLoginResponse } from './taygedo/api.js'
import { parseAccountsSecret, type TaygedoAccount } from './config/accounts.js'
import { encryptPassword, generateCredentialKey } from './config/credentials.js'
import { generateDeviceIdentity, type DeviceIdentity } from './taygedo/device.js'
import { shanghaiDateTime } from './utils/time.js'
import { isEntryModule } from './utils/entry.js'

export interface LoginActionDependencies {
  env?: Record<string, string | undefined>
  api?: Pick<TaygedoApi, 'sendCaptcha' | 'loginWithCaptcha' | 'userCenterLogin' | 'getBindRole'>
    & Partial<Pick<TaygedoApi, 'loginWithPassword'>>
  generateDeviceId?: () => string
  generateDeviceIdentity?: () => DeviceIdentity
  onStage?: (stage: LoginStage, details: LoginStageDetails) => void
  writeAccounts?: (payload: string) => Promise<void>
  writeCredentialKey?: (credentialKey: string) => Promise<void>
}

export type LoginStage = 'captcha-sent' | 'laohu-authenticated' | 'usercenter-authenticated' | 'account-written'
export type LoginStageDetails = Record<string, string | number | boolean>

export async function runLoginAction(deps: LoginActionDependencies = {}): Promise<void> {
  const env = deps.env ?? process.env
  const mode = requireEnv(env, 'TAYGEDO_LOGIN_MODE')
  const phone = requireEnv(env, 'TAYGEDO_LOGIN_PHONE')
  const api = deps.api ?? new TaygedoApi()
  const accountsPath = optionalEnv(env, 'TAYGEDO_LOGIN_UPDATED_ACCOUNTS_PATH') ?? optionalEnv(env, 'TAYGEDO_UPDATED_ACCOUNTS_PATH') ?? 'updated-accounts.json'

  if (mode === 'send-code') {
    const device = resolveDeviceIdentity(env, deps)
    await api.sendCaptcha(phone, device.deviceId)
    deps.onStage?.('captcha-sent', {
      deviceIdLength: device.deviceId.length,
    })
    const devicePath = optionalEnv(env, 'TAYGEDO_LOGIN_DEVICE_ID_PATH')
    if (devicePath) {
      await writeTextFile(devicePath, `${device.deviceId}\n`)
    }
    console.log('验证码已发送，请在当前登录页面继续输入验证码。')
    return
  }

  if (mode !== 'login' && mode !== 'password') {
    throw new Error('TAYGEDO_LOGIN_MODE 必须是 send-code、login 或 password')
  }

  const device = resolveDeviceIdentity(env, deps, { requireExistingDeviceId: mode !== 'password' })
  const accountId = requireEnv(env, 'TAYGEDO_LOGIN_ACCOUNT_ID')
  const accountName = optionalEnv(env, 'TAYGEDO_LOGIN_ACCOUNT_NAME') ?? accountId

  let loginResult: LoginWithCaptchaResponse
  const password = optionalEnv(env, 'TAYGEDO_LOGIN_PASSWORD')
  if (mode === 'password') {
    if (!api.loginWithPassword) {
      throw new Error('当前 API 客户端不支持密码登录')
    }
    loginResult = await api.loginWithPassword(phone, requireEnv(env, 'TAYGEDO_LOGIN_PASSWORD'), device.deviceId, {
      openudid: device.openudid,
      vendorid: device.vendorid,
    })
  }
  else {
    const captcha = requireEnv(env, 'TAYGEDO_LOGIN_CAPTCHA')
    loginResult = await api.loginWithCaptcha(phone, captcha, device.deviceId)
  }
  deps.onStage?.('laohu-authenticated', {
    tokenLength: loginResult.token.length,
    tokenHasWhitespace: /\s/.test(loginResult.token),
    userIdLength: loginResult.userId.length,
    userIdIsInteger: /^\d+$/.test(loginResult.userId),
  })
  const userCenter = await api.userCenterLogin(loginResult.token, loginResult.userId, device.deviceId)
  deps.onStage?.('usercenter-authenticated', {
    accessTokenLength: userCenter.accessToken.length,
    refreshTokenLength: userCenter.refreshToken.length,
    uidLength: userCenter.uid.length,
  })
  const role = await tryGetBindRole(api, userCenter.accessToken, userCenter.uid)
  const tokenUpdatedAt = shanghaiDateTime()

  const nextAccount: TaygedoAccount = {
    id: accountId,
    name: accountName,
    uid: userCenter.uid,
    deviceId: device.deviceId,
    openudid: device.openudid,
    vendorid: device.vendorid,
    accessToken: userCenter.accessToken,
    refreshToken: userCenter.refreshToken,
    laohuToken: loginResult.token,
    laohuUserId: loginResult.userId,
    tokenUpdatedAt,
  }
  if (mode === 'password') {
    nextAccount.phone = phone
    let credentialKey = optionalEnv(env, 'TAYGEDO_CREDENTIAL_KEY')
    if (!credentialKey && deps.writeCredentialKey) {
      credentialKey = generateCredentialKey()
      await deps.writeCredentialKey(credentialKey)
    }
    const credentialKeyPath = optionalEnv(env, 'TAYGEDO_CREDENTIAL_KEY_PATH')
    if (!credentialKey && credentialKeyPath) {
      credentialKey = generateCredentialKey()
      await writeTextFile(credentialKeyPath, `${credentialKey}\n`)
    }
    if (credentialKey && password) {
      nextAccount.encryptedPassword = encryptPassword(password, credentialKey)
    }
  }
  if (role.roleId) {
    nextAccount.roleId = role.roleId
  }
  if (role.roleName) {
    nextAccount.roleName = role.roleName
  }

  const currentAccountsSecret = optionalEnv(env, 'TAYGEDO_ACCOUNTS')
  const currentAccounts = currentAccountsSecret ? parseAccountsSecret(currentAccountsSecret) : []
  const updatedAccounts = upsertAccount(currentAccounts, nextAccount)
  const payload = JSON.stringify(updatedAccounts, null, 2)
  if (deps.writeAccounts) {
    await deps.writeAccounts(payload)
  }
  else {
    await writeTextFile(accountsPath, `${payload}\n`)
  }
  deps.onStage?.('account-written', {
    accountCount: updatedAccounts.length,
  })
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
  // accounts.json / credential-key 都是敏感文件，避免被同机其他用户读到（Windows 上 chmod 无副作用）。
  await writeFile(path, content, { encoding: 'utf8', mode: 0o600 })
  await chmod(path, 0o600).catch(() => undefined)
}

function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]
  if (!value || value.trim() === '') {
    throw new Error(`缺少必需环境变量 ${key}`)
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

function resolveDeviceIdentity(
  env: Record<string, string | undefined>,
  deps: Pick<LoginActionDependencies, 'generateDeviceId' | 'generateDeviceIdentity'>,
  options: { requireExistingDeviceId?: boolean } = {},
): DeviceIdentity {
  const forceNew = parseBoolean(optionalEnv(env, 'TAYGEDO_LOGIN_NEW_DEVICE'))
  if (!forceNew) {
    const existingDeviceId = optionalEnv(env, 'TAYGEDO_LOGIN_DEVICE_ID')
    if (existingDeviceId) {
      const generated = generatedIdentity(deps)
      return {
        deviceId: existingDeviceId,
        openudid: optionalEnv(env, 'TAYGEDO_LOGIN_OPENUDID') ?? generated.openudid,
        vendorid: optionalEnv(env, 'TAYGEDO_LOGIN_VENDORID') ?? generated.vendorid,
      }
    }
    if (options.requireExistingDeviceId) {
      requireEnv(env, 'TAYGEDO_LOGIN_DEVICE_ID')
    }
  }

  return generatedIdentity(deps)
}

function generatedIdentity(deps: Pick<LoginActionDependencies, 'generateDeviceId' | 'generateDeviceIdentity'>): DeviceIdentity {
  if (deps.generateDeviceIdentity) {
    return deps.generateDeviceIdentity()
  }
  const generated = generateDeviceIdentity()
  if (deps.generateDeviceId) {
    generated.deviceId = deps.generateDeviceId()
  }
  return generated
}

function parseBoolean(value: string | undefined): boolean {
  return value ? ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()) : false
}

if (isEntryModule(import.meta.url)) {
  runLoginAction().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
