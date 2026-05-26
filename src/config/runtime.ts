export type AccountStoreKind = 'env' | 'file' | 'cloudflare-kv' | 'upstash' | 'unstorage'
export type StateStoreKind = 'memory' | 'file' | 'cloudflare-kv' | 'upstash' | 'unstorage'

export interface RuntimeConfig {
  accountsSecret?: string
  accountPasswords: Record<string, string>
  credentialKey?: string
  credentialKeyPath?: string
  notificationUrls: string[]
  maxRetries: number
  updatedAccountsPath: string
  accountStore: AccountStoreKind
  stateStore: StateStoreKind
  accountsKey: string
  statePrefix: string
  forceRun: boolean
  coinTasks: boolean
  sharePlatform: string
  loopSeconds?: number
  adminToken?: string
  upstashUrl?: string
  upstashToken?: string
}

export function loadRuntimeConfig(env: Record<string, string | undefined>): RuntimeConfig {
  return {
    accountsSecret: optionalEnv(env, 'TAYGEDO_ACCOUNTS'),
    accountPasswords: parseAccountPasswords(env),
    credentialKey: optionalEnv(env, 'TAYGEDO_CREDENTIAL_KEY'),
    credentialKeyPath: optionalEnv(env, 'TAYGEDO_CREDENTIAL_KEY_PATH'),
    notificationUrls: [
      ...splitComma(env.TAYGEDO_NOTIFICATION_URLS),
      ...serverChanUrls(env.TAYGEDO_SERVERCHAN_SENDKEY),
    ],
    maxRetries: parsePositiveInteger(env.TAYGEDO_MAX_RETRIES ?? '3', 'TAYGEDO_MAX_RETRIES'),
    updatedAccountsPath: optionalEnv(env, 'TAYGEDO_UPDATED_ACCOUNTS_PATH') ?? 'updated-accounts.json',
    accountStore: parseAccountStore(optionalEnv(env, 'TAYGEDO_ACCOUNT_STORE') ?? 'env'),
    stateStore: parseStateStore(optionalEnv(env, 'TAYGEDO_STATE_STORE') ?? 'memory'),
    accountsKey: optionalEnv(env, 'TAYGEDO_ACCOUNTS_KEY') ?? 'TAYGEDO_ACCOUNTS',
    statePrefix: optionalEnv(env, 'TAYGEDO_STATE_PREFIX') ?? 'taygedo',
    forceRun: parseBoolean(optionalEnv(env, 'TAYGEDO_FORCE_RUN')),
    coinTasks: parseBoolean(optionalEnv(env, 'TAYGEDO_COIN_TASKS') ?? 'true'),
    sharePlatform: optionalEnv(env, 'TAYGEDO_SHARE_PLATFORM') ?? 'qq',
    loopSeconds: parseOptionalPositiveInteger(optionalEnv(env, 'TAYGEDO_LOOP_SECONDS'), 'TAYGEDO_LOOP_SECONDS'),
    adminToken: optionalEnv(env, 'TAYGEDO_ADMIN_TOKEN'),
    upstashUrl: optionalEnv(env, 'TAYGEDO_UPSTASH_REDIS_REST_URL') ?? optionalEnv(env, 'UPSTASH_REDIS_REST_URL'),
    upstashToken: optionalEnv(env, 'TAYGEDO_UPSTASH_REDIS_REST_TOKEN') ?? optionalEnv(env, 'UPSTASH_REDIS_REST_TOKEN'),
  }
}

function parseAccountPasswords(env: Record<string, string | undefined>): Record<string, string> {
  const passwords: Record<string, string> = {}
  const rawMap = optionalEnv(env, 'TAYGEDO_PASSWORDS')
  if (rawMap) {
    const parsed = JSON.parse(rawMap) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('TAYGEDO_PASSWORDS 必须是 JSON 对象')
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error('TAYGEDO_PASSWORDS 的值必须是非空字符串')
      }
      passwords[key] = value
    }
  }

  const defaultPassword = optionalEnv(env, 'TAYGEDO_LOGIN_PASSWORD') ?? optionalEnv(env, 'TAYGEDO_PASSWORD')
  if (defaultPassword) {
    passwords.default = defaultPassword
    const defaultAccountId = optionalEnv(env, 'TAYGEDO_LOGIN_ACCOUNT_ID') ?? optionalEnv(env, 'TAYGEDO_ACCOUNT_ID')
    if (defaultAccountId) {
      passwords[defaultAccountId] = defaultPassword
    }
  }

  return passwords
}

export function splitComma(value: string | undefined): string[] {
  if (!value) {
    return []
  }
  return value.split(',').map(item => item.trim()).filter(Boolean)
}

export function serverChanUrls(sendkey: string | undefined): string[] {
  const trimmedSendkey = sendkey?.trim()
  return trimmedSendkey ? [`https://sctapi.ftqq.com/${trimmedSendkey}.send`] : []
}

function parsePositiveInteger(value: string, key: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} 必须是正整数`)
  }
  return parsed
}

function parseOptionalPositiveInteger(value: string | undefined, key: string): number | undefined {
  if (!value) {
    return undefined
  }
  return parsePositiveInteger(value, key)
}

function parseAccountStore(value: string): AccountStoreKind {
  if (value === 'env' || value === 'file' || value === 'cloudflare-kv' || value === 'upstash' || value === 'unstorage') {
    return value
  }
  throw new Error(`不支持的 TAYGEDO_ACCOUNT_STORE：${value}`)
}

function parseStateStore(value: string): StateStoreKind {
  if (value === 'memory' || value === 'file' || value === 'cloudflare-kv' || value === 'upstash' || value === 'unstorage') {
    return value
  }
  throw new Error(`不支持的 TAYGEDO_STATE_STORE：${value}`)
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function optionalEnv(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]
  if (!value || value.trim() === '') {
    return undefined
  }
  return value.trim()
}
