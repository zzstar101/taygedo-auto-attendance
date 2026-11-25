import { parseAccountsSecret, type TaygedoAccount } from './config/accounts.js'
import { isLaohuSessionExpiredError, TaygedoApi, type CloudDurationResponse } from './taygedo/api.js'
import { sendNotification } from './notify.js'
import { withRetries } from './utils/retry.js'
import { TAYGEDO_GAME_IDS } from './taygedo/games.js'
import { decryptPassword } from './config/credentials.js'
import type { StateStore } from './stores/state-store.js'
import { shanghaiDateTime } from './utils/time.js'
import { stripBom } from './utils/text.js'

export interface RunnerDependencies {
  accountsSecret: string
  api?: AttendanceApi
  accountPasswords?: Record<string, string>
  credentialKey?: string
  notificationUrls?: string[]
  notificationFetch?: typeof fetch
  maxRetries?: number
  accountConcurrency?: number
  secretWriter?: (payload: string) => Promise<void>
  /**
   * 原子写回：把「读最新内容 → 合并 → 写」交给存储后端完成。
   * 支持的后端会加跨进程锁，避免两个实例并发刷新时互相覆盖 token。
   */
  secretUpdater?: (build: (latestSecret: string) => string) => Promise<void>
  /** 重新读一次账号配置；仅在没有 `secretUpdater` 时使用。 */
  accountsReader?: () => Promise<string>
  stateStore?: StateStore
  forceRun?: boolean
  coinTasks?: boolean
  cloudDuration?: boolean
  sharePlatform?: string
  delay?: (ms: number) => Promise<void>
  now?: Date
}

type AttendanceApi = Pick<TaygedoApi, 'refreshToken' | 'getGameRoles' | 'appSignin' | 'getSigninState' | 'getSigninRewards' | 'gameSignin'>
  & Partial<Pick<TaygedoApi,
    | 'loginWithPassword'
    | 'userCenterLogin'
    | 'getGameRecordCards'
    | 'getUserTasks'
    | 'bbsSignin'
    | 'getRecommendPostList'
    | 'getPostFull'
    | 'likePost'
    | 'sharePost'
    | 'getUserCoinTaskState'
    | 'cloudGetUserInfo'
    | 'cloudLoginWithPassword'
    | 'cloudQueryWhetherSetPassword'
  >>

export interface RunAttendanceResult {
  updatedAccounts: TaygedoAccount[]
  summary: string
  startedAt: string
  finishedAt: string
  forceRun: boolean
  accounts: AccountRunSummary[]
  successCount: number
  failedCount: number
  skippedCount: number
  notificationErrors: NotificationError[]
}

export interface CoinTaskSummary {
  bbsSignin?: boolean
  browse: {
    done: number
    target: number
  }
  like: {
    done: number
    target: number
  }
  share: {
    done: number
    target: number
    platform: string
  }
  coinState?: Record<string, unknown>
  error?: string
}

export interface AccountRunSummary {
  id: string
  name: string
  status: 'success' | 'failed' | 'skipped'
  success: boolean
  appSignin?: {
    alreadySigned?: boolean
    exp?: number
    goldCoin?: number
  }
  gameSignins: Array<{
    gameId: string
    roleName: string
    days?: number
    reward?: {
      name: string
      num: number
    }
    alreadySigned?: boolean
    success: boolean
  }>
  coinTasks?: CoinTaskSummary
  cloudDuration?: CloudDurationSummary
  error?: string
  skippedReason?: string
}

export interface CloudDurationSummary {
  status: 'success' | 'skipped' | 'failed'
  gave?: number
  remained?: number
  error?: string
  skippedReason?: string
}

export interface NotificationError {
  url: string
  error: string
}

export async function runAttendance(deps: RunnerDependencies): Promise<RunAttendanceResult> {
  const startedAtDate = deps.now ?? new Date()
  const startedAt = startedAtDate.toISOString()
  const runDate = shanghaiDate(startedAtDate)
  const forceRun = deps.forceRun ?? false
  const accounts = parseAccountsSecret(deps.accountsSecret)
  const api = deps.api ?? new TaygedoApi()
  const accountResults = await mapWithConcurrency(accounts, deps.accountConcurrency ?? 1, async (account): Promise<AccountResult> => {
    const stateKey = attendanceStateKey(account.id, runDate)
    try {
      if (!forceRun && await deps.stateStore?.get(stateKey)) {
        return {
          updatedAccount: { ...account },
          shouldUpdateSecret: false,
          summary: {
            id: account.id,
            name: account.name,
            status: 'skipped',
            success: false,
            gameSignins: [],
            skippedReason: '今天已成功签到',
          } satisfies AccountRunSummary,
        }
      }

      const accountRun = await withRetries(async () => {
        return await runAccount(api, account, deps.accountPasswords ?? {}, deps.credentialKey, {
          coinTasks: deps.coinTasks ?? true,
          cloudDuration: deps.cloudDuration ?? true,
          sharePlatform: deps.sharePlatform ?? 'qq',
          delay: deps.delay ?? sleep,
        })
      }, deps.maxRetries ?? 3)

      // 「今天已签到」标记要等账号配置写回成功后再落盘，否则写回失败时下次运行会
      // 直接跳过该账号，新 token 永远存不下来。
      // 但「不需要写回凭据」的账号没有这个依赖，当场就记，别被别的账号的写回失败牵连。
      const marker: AttendanceMarker = {
        key: stateKey,
        value: {
          status: 'success',
          accountId: account.id,
          accountName: account.name,
          date: runDate,
          updatedAt: new Date().toISOString(),
        },
      }
      if (accountRun.shouldUpdateSecret) {
        return { ...accountRun, attendanceMarker: marker }
      }
      await recordAttendanceMarker(deps.stateStore, marker)
      return { ...accountRun, attendanceMarker: undefined }
    }
    catch (error) {
      return {
        updatedAccount: { ...account },
        shouldUpdateSecret: false,
        summary: {
          id: account.id,
          name: account.name,
          status: 'failed',
          success: false,
          gameSignins: [],
          error: error instanceof Error ? error.message : String(error),
        } satisfies AccountRunSummary,
      }
    }
  })

  const updatedAccounts = accountResults.map(result => result.updatedAccount)
  const secretUpdateCount = accountResults.filter(result => result.shouldUpdateSecret).length
  const accountSummaries = accountResults.map(result => result.summary)

  if (secretUpdateCount > 0) {
    await persistUpdatedAccounts(deps, accounts, updatedAccounts)
  }

  await recordAttendanceMarkers(deps.stateStore, accountResults)

  const summary = buildSummary(accountSummaries)
  console.log(summary)

  const notificationErrors: NotificationError[] = []
  if (deps.notificationUrls?.length) {
    notificationErrors.push(...await sendNotification({
      urls: deps.notificationUrls,
      title: '塔吉多每日签到',
      content: summary,
      fetch: deps.notificationFetch,
    }))
  }

  const successCount = accountSummaries.filter(account => account.status === 'success').length
  const failedCount = accountSummaries.filter(account => account.status === 'failed').length
  const skippedCount = accountSummaries.filter(account => account.status === 'skipped').length
  const finishedAt = new Date().toISOString()
  const result: RunAttendanceResult = {
    updatedAccounts,
    summary,
    startedAt,
    finishedAt,
    forceRun,
    accounts: accountSummaries,
    successCount,
    failedCount,
    skippedCount,
    notificationErrors,
  }
  await deps.stateStore?.set('last-summary', summary)
  await deps.stateStore?.set('last-run', {
    startedAt,
    finishedAt,
    forceRun,
    totalCount: accounts.length,
    successCount,
    failedCount,
    skippedCount,
    accounts: accountSummaries,
    notificationErrors,
  })
  return result
}

interface AttendanceMarker {
  key: string
  value: Record<string, unknown>
}

/** 把「今天已签到」标记落到状态存储。失败只影响当天的去重，不该影响这次的结果。 */
async function recordAttendanceMarker(stateStore: StateStore | undefined, marker: AttendanceMarker): Promise<void> {
  try {
    await stateStore?.set(marker.key, marker.value, { ttlSeconds: 60 * 60 * 36 })
  }
  catch (error) {
    console.warn(`写入签到状态失败（今天可能重复签到）：${errorMessage(error)}`)
  }
}

async function recordAttendanceMarkers(
  stateStore: StateStore | undefined,
  results: AccountResult[],
): Promise<void> {
  for (const result of results) {
    if (result.attendanceMarker) {
      await recordAttendanceMarker(stateStore, result.attendanceMarker)
    }
  }
}

/**
 * 把本次刷新的凭据写回账号配置。
 *
 * 优先后端自己的 `updateAccounts`（文件后端会用跨进程锁把「读 → 合并 → 写」整体
 * 包住）；没有的话退化成「读一次 + 合并 + 写一次」，并发时仍有覆盖窗口。
 *
 * 读最新内容失败时直接抛出、不动原文件：退化成启动快照会把运行期间新增的账号写没。
 */
async function persistUpdatedAccounts(
  deps: RunnerDependencies,
  accounts: TaygedoAccount[],
  updatedAccounts: TaygedoAccount[],
): Promise<void> {
  const build = (latestSecret: string) => buildUpdatedAccountsSecret({
    originalSecret: deps.accountsSecret,
    latestSecret,
    accounts,
    updatedAccounts,
  })

  if (deps.secretUpdater) {
    await deps.secretUpdater(build)
    return
  }
  if (!deps.secretWriter) {
    console.warn('账号存储是只读的，本次刷新出的 token 只在本次运行内有效；如需持久化请改用可写存储')
    return
  }
  const latestSecret = deps.accountsReader ? await deps.accountsReader() : deps.accountsSecret
  await deps.secretWriter(build(latestSecret))
}

/** 写回账号配置时可以变动的字段（其余字段不是用户数据就是本次运行不会碰的）。 */
const MUTABLE_ACCOUNT_FIELDS = [
  'name',
  'uid',
  'deviceId',
  'openudid',
  'vendorid',
  'refreshToken',
  'accessToken',
  'laohuToken',
  'laohuUserId',
  'tokenUpdatedAt',
  'phone',
  'encryptedPassword',
  'roleId',
  'roleName',
] as const satisfies ReadonlyArray<keyof TaygedoAccount>

/**
 * 旧版本写过、现在只应该被清掉的明文密码字段。
 *
 * README 承诺「旧配置里的 password / passwordUpdatedAt 读取后丢弃、下次写回自然清理」，
 * 所以写回时对所有记录都要摘掉它们（包括本次没刷新的账号），不能原样带回去。
 */
const LEGACY_SECRET_FIELDS = ['password', 'passwordUpdatedAt'] as const

/**
 * 生成要写回的账号配置 JSON。
 *
 * 以「最新内容」为底稿、只覆盖本次运行真正改过的字段，因此：
 * - 并发实例各自刷新不同账号时，后写的一方不会用旧快照覆盖对方的新 token；
 * - 账号 JSON 里本程序不认识的字段（自定义备注等）原样保留；
 * - 旧明文密码字段被清掉。
 */
export function buildUpdatedAccountsSecret(options: {
  originalSecret: string
  latestSecret?: string
  accounts: TaygedoAccount[]
  updatedAccounts: TaygedoAccount[]
}): string {
  const baseAccounts = resolveBaseAccounts(options)

  const originals = new Map(options.accounts.map(account => [account.id, account]))
  const patches = new Map<string, Record<string, unknown>>()
  for (const updated of options.updatedAccounts) {
    const original = originals.get(updated.id)
    if (!original) {
      continue
    }
    const patch = diffAccountFields(original, updated)
    if (Object.keys(patch).length > 0) {
      patches.set(updated.id, patch)
    }
  }

  if (patches.size === 0) {
    // 没有任何字段需要更新，保持底稿原样（连带保住不认识的字段，但清掉旧明文密码）。
    return JSON.stringify(
      baseAccounts.length > 0 ? baseAccounts.map(stripLegacySecretFields) : options.updatedAccounts,
      null,
      2,
    )
  }

  const applied = new Set<string>()
  const merged = baseAccounts.map((raw) => {
    if (!isPlainObject(raw) || typeof raw.id !== 'string') {
      return stripLegacySecretFields(raw)
    }
    const original = originals.get(raw.id)
    const patch = patches.get(raw.id)
    if (!original || !patch) {
      return stripLegacySecretFields(raw)
    }
    if (!isSameAccountIdentity(original, raw)) {
      // id 只是配置名（`main` 可以随时改成另一个用户）：身份对不上就不能把旧 token
      // 贴到新用户的记录上，否则会写出「新 uid + 旧 token」的坏组合。
      console.warn(`账号 ${raw.id} 在运行期间被替换为其他用户，丢弃本次写回`)
      return stripLegacySecretFields(raw)
    }
    applied.add(raw.id)
    return stripLegacySecretFields({ ...raw, ...patch })
  })

  for (const id of patches.keys()) {
    if (!applied.has(id)) {
      // 最新内容里已经没有这个账号（并发运行删掉了它）：不强行写回去。
      console.warn(`账号 ${id} 已不在账号配置中，跳过写回`)
    }
  }

  return JSON.stringify(merged, null, 2)
}

function resolveBaseAccounts(options: {
  originalSecret: string
  latestSecret?: string
  updatedAccounts: TaygedoAccount[]
}): unknown[] {
  if (options.latestSecret === undefined) {
    return parseRawAccounts(options.originalSecret) ?? options.updatedAccounts
  }
  const latest = parseRawAccounts(options.latestSecret)
  if (latest === undefined) {
    // 调用方已经能读到最新内容，说明就该以它为准；解析不了还硬写回去等于拿旧快照覆盖。
    throw new Error('最新账号配置不是合法 JSON，已跳过写回以免覆盖运行期间新增的账号')
  }
  return latest
}

/** 账号身份是否还是启动时那个用户（uid / deviceId 是用户身份，id 只是配置名）。 */
function isSameAccountIdentity(original: TaygedoAccount, raw: Record<string, unknown>): boolean {
  if (typeof raw.uid === 'string' && raw.uid !== original.uid) {
    return false
  }
  if (typeof raw.deviceId === 'string' && raw.deviceId !== original.deviceId) {
    return false
  }
  return true
}

function stripLegacySecretFields(raw: unknown): unknown {
  if (!isPlainObject(raw)) {
    return raw
  }
  let stripped: Record<string, unknown> | undefined
  for (const field of LEGACY_SECRET_FIELDS) {
    if (field in raw) {
      stripped ??= { ...raw }
      delete stripped[field]
    }
  }
  return stripped ?? raw
}

function diffAccountFields(original: TaygedoAccount, updated: TaygedoAccount): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const field of MUTABLE_ACCOUNT_FIELDS) {
    const next = updated[field]
    if (next === undefined) {
      // 不给「删除字段」留口子：只增改，永不抹掉原有值。
      continue
    }
    if (JSON.stringify(original[field]) !== JSON.stringify(next)) {
      patch[field] = next
    }
  }
  return patch
}

function parseRawAccounts(secret: string | undefined): unknown[] | undefined {
  if (secret === undefined) {
    return undefined
  }
  try {
    const parsed = JSON.parse(stripBom(secret).trim()) as unknown
    return Array.isArray(parsed) ? parsed : undefined
  }
  catch {
    return undefined
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface AccountRunResult {
  updatedAccount: TaygedoAccount
  shouldUpdateSecret: boolean
  summary: AccountRunSummary
}

interface AccountResult extends AccountRunResult {
  /** 本次运行成功时待落盘的「今天已签到」标记。 */
  attendanceMarker?: AttendanceMarker
}

async function runAccount(
  api: AttendanceApi,
  account: TaygedoAccount,
  accountPasswords: Record<string, string>,
  credentialKey?: string,
  options: AccountRunOptions = {},
): Promise<AccountRunResult> {
  if (account.accessToken) {
    return await signWithRecoverableSession(api, account, account.accessToken, accountPasswords, credentialKey, false, options)
  }

  const session = await refreshOrRebuildSession(api, account, accountPasswords, credentialKey)
  return await signWithRecoverableSession(api, session.account, session.accessToken, accountPasswords, credentialKey, true, options)
}

interface AccountRunOptions {
  coinTasks?: boolean
  cloudDuration?: boolean
  sharePlatform?: string
  delay?: (ms: number) => Promise<void>
}

async function refreshOrRebuildSession(
  api: Pick<TaygedoApi, 'refreshToken'> & Partial<Pick<TaygedoApi, 'loginWithPassword' | 'userCenterLogin'>>,
  account: TaygedoAccount,
  accountPasswords: Record<string, string>,
  credentialKey?: string,
): Promise<{ account: TaygedoAccount, accessToken: string }> {
  const resolved = resolveAccountPassword(account, accountPasswords, credentialKey)
  if (account.phone && resolved && api.loginWithPassword && api.userCenterLogin) {
    try {
      const login = await api.loginWithPassword(account.phone, resolved.password, account.deviceId, {
        openudid: account.openudid,
        vendorid: account.vendorid,
      })
      const rebuilt = await api.userCenterLogin(login.token, login.userId, account.deviceId)
      const updatedAccount = withSession(account, {
        accessToken: rebuilt.accessToken,
        refreshToken: rebuilt.refreshToken,
        uid: rebuilt.uid,
        laohuToken: login.token,
        laohuUserId: login.userId,
      })
      return {
        account: updatedAccount,
        accessToken: rebuilt.accessToken,
      }
    }
    catch {
      // Fall back to refreshToken / stored laohu credentials below.
    }
  }

  try {
    const refreshed = await api.refreshToken(account.refreshToken, account.deviceId, account.uid)
    const updatedAccount = withSession(account, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      uid: refreshed.uid,
    })
    return {
      account: updatedAccount,
      accessToken: refreshed.accessToken,
    }
  }
  catch (error) {
    if (!isRefreshRejected(error) || !account.laohuToken || !account.laohuUserId || !api.userCenterLogin) {
      throw error
    }
  }

  const rebuilt = await api.userCenterLogin(account.laohuToken, account.laohuUserId, account.deviceId)
  const updatedAccount = withSession(account, {
    accessToken: rebuilt.accessToken,
    refreshToken: rebuilt.refreshToken,
    uid: rebuilt.uid,
  })
  return {
    account: updatedAccount,
    accessToken: rebuilt.accessToken,
  }
}

interface ResolvedPassword {
  password: string
  /** 密码来源，只用于错误提示（不包含密码本身），多账号时能看出是不是用错了账号的密码。 */
  source: string
}

function resolveAccountPassword(
  account: TaygedoAccount,
  accountPasswords: Record<string, string>,
  credentialKey?: string,
): ResolvedPassword | undefined {
  const byId = accountPasswords[account.id]
  if (byId) {
    return { password: byId, source: `TAYGEDO_PASSWORDS["${account.id}"]` }
  }
  const byPhone = account.phone ? accountPasswords[account.phone] : undefined
  if (byPhone) {
    return { password: byPhone, source: 'TAYGEDO_PASSWORDS[手机号]' }
  }
  if (accountPasswords.default) {
    return { password: accountPasswords.default, source: 'TAYGEDO_PASSWORDS.default（或 TAYGEDO_LOGIN_PASSWORD）' }
  }
  if (account.encryptedPassword && credentialKey) {
    return { password: decryptPassword(account.encryptedPassword, credentialKey), source: 'encryptedPassword' }
  }
  return undefined
}

async function signWithSession(
  api: Pick<TaygedoApi, 'getGameRoles' | 'appSignin' | 'getSigninState' | 'getSigninRewards' | 'gameSignin'>,
  account: TaygedoAccount,
  accessToken: string,
  accountPasswords: Record<string, string>,
  credentialKey: string | undefined,
  shouldUpdateSecret: boolean,
  options: AccountRunOptions = {},
): Promise<AccountRunResult> {
  const gameRoles = await getAllGameRoles(api, accessToken, account.uid, account.deviceId)
  const firstRole = gameRoles[0]
  const roleId = firstRole?.roleId ?? account.roleId

  const appSignin = await signAppIdempotently(api, accessToken, account)
  const gameSignins: AccountRunSummary['gameSignins'] = await Promise.all(gameRoles.map(async (role) => {
    const gameSignin = await signGameIdempotently(api, accessToken, role.roleId, role.gameId)
    const [signinState, signinRewards] = await Promise.all([
      api.getSigninState(accessToken, role.gameId),
      api.getSigninRewards(accessToken, role.gameId),
    ])
    return {
      gameId: role.gameId,
      roleName: role.roleName ?? role.roleId,
      days: signinState.days,
      reward: signinRewards[signinState.days - 1],
      alreadySigned: gameSignin.alreadySigned,
      success: true,
    }
  }))

  const updatedAccount = {
    ...account,
  }
  if (roleId) {
    updatedAccount.roleId = roleId
  }
  if (firstRole?.roleName ?? account.roleName) {
    updatedAccount.roleName = firstRole?.roleName ?? account.roleName
  }
  const coinTasks = options.coinTasks === false
    ? undefined
    : await runCoinTasks(api as AttendanceApi, account, accessToken, options)
  const cloudDurationResult = options.cloudDuration === false
    ? undefined
    : await runCloudDuration(api as AttendanceApi, updatedAccount, accountPasswords, credentialKey)
  if (cloudDurationResult?.updatedAccount) {
    Object.assign(updatedAccount, cloudDurationResult.updatedAccount)
  }

  return {
    updatedAccount,
    shouldUpdateSecret: shouldUpdateSecret || Boolean(cloudDurationResult?.shouldUpdateSecret),
    summary: {
      id: account.id,
      name: account.name,
      status: 'success',
      success: true,
      appSignin,
      gameSignins,
      ...(coinTasks ? { coinTasks } : {}),
      ...(cloudDurationResult ? { cloudDuration: cloudDurationResult.summary } : {}),
    },
  }
}

async function signAppIdempotently(
  api: Pick<TaygedoApi, 'appSignin'>,
  accessToken: string,
  account: TaygedoAccount,
): Promise<NonNullable<AccountRunSummary['appSignin']>> {
  try {
    return await api.appSignin(accessToken, account.uid, account.deviceId)
  }
  catch (error) {
    if (!isAlreadySignedError(error)) {
      throw error
    }
    return { alreadySigned: true }
  }
}

async function signGameIdempotently(
  api: Pick<TaygedoApi, 'gameSignin'>,
  accessToken: string,
  roleId: string,
  gameId: string,
): Promise<{ alreadySigned?: boolean }> {
  try {
    await api.gameSignin(accessToken, roleId, gameId)
    return {}
  }
  catch (error) {
    if (!isAlreadySignedError(error)) {
      throw error
    }
    return { alreadySigned: true }
  }
}

function isAlreadySignedError(error: unknown): boolean {
  return error instanceof Error && /已.*签到|签到.*过|重复签到|already.*sign/i.test(error.message)
}

async function signWithRecoverableSession(
  api: AttendanceApi,
  account: TaygedoAccount,
  accessToken: string,
  accountPasswords: Record<string, string>,
  credentialKey: string | undefined,
  shouldUpdateSecret: boolean,
  options: AccountRunOptions = {},
): Promise<AccountRunResult> {
  try {
    return await signWithSession(api, account, accessToken, accountPasswords, credentialKey, shouldUpdateSecret, options)
  }
  catch (error) {
    if (!isAuthError(error)) {
      throw error
    }
    const session = await refreshOrRebuildSession(api, account, accountPasswords, credentialKey)
    return await signWithSession(api, session.account, session.accessToken, accountPasswords, credentialKey, true, options)
  }
}

async function runCoinTasks(
  api: AttendanceApi,
  account: TaygedoAccount,
  accessToken: string,
  options: AccountRunOptions,
): Promise<CoinTaskSummary | undefined> {
  if (
    !api.getUserTasks
    || !api.bbsSignin
    || !api.getRecommendPostList
    || !api.getPostFull
    || !api.likePost
    || !api.sharePost
    || !api.getUserCoinTaskState
  ) {
    return undefined
  }
  const coinTaskApi = api as AttendanceApi & {
    bbsSignin: NonNullable<AttendanceApi['bbsSignin']>
  }

  const delay = options.delay ?? sleep
  const sharePlatform = options.sharePlatform ?? 'qq'
  const tasks = await api.getUserTasks(accessToken, account.uid, account.deviceId)
  const bbsTarget = remainingTaskCount(tasks, 'signin_c', 1)
  const browseTarget = remainingTaskCount(tasks, 'browse_post_c', 5)
  const likeTarget = remainingTaskCount(tasks, 'like_post_c', 5)
  const shareTarget = remainingTaskCount(tasks, 'share', 1)
  const summary: CoinTaskSummary = {
    bbsSignin: bbsTarget <= 0 ? true : undefined,
    browse: { done: 0, target: browseTarget },
    like: { done: 0, target: likeTarget },
    share: { done: 0, target: shareTarget, platform: sharePlatform },
  }
  const errors: string[] = []

  if (bbsTarget > 0) {
    await signBbsIdempotently(coinTaskApi, accessToken, account)
    summary.bbsSignin = true
  }

  const posts = browseTarget > 0 || likeTarget > 0 || shareTarget > 0
    ? await api.getRecommendPostList(accessToken, account.uid, account.deviceId, 20, 1)
    : []
  const browsedPosts: Array<{ postId: string, selfOperation?: { liked?: boolean } }> = []

  for (const post of posts) {
    if (summary.browse.done >= browseTarget) {
      break
    }
    await delay(randomDelay(700, 1500))
    try {
      const fullPost = await api.getPostFull(accessToken, account.uid, account.deviceId, post.postId)
      browsedPosts.push(fullPost)
      summary.browse.done++
    }
    catch (error) {
      errors.push(`浏览帖子 ${post.postId} 失败：${errorMessage(error)}`)
    }
  }

  const likeCandidates = [...browsedPosts, ...posts]
  const seenPostIds = new Set<string>()
  for (const post of likeCandidates) {
    if (summary.like.done >= likeTarget) {
      break
    }
    if (seenPostIds.has(post.postId)) {
      continue
    }
    seenPostIds.add(post.postId)
    if (post.selfOperation?.liked) {
      continue
    }
    await delay(randomDelay(500, 1000))
    try {
      await api.likePost(accessToken, account.uid, account.deviceId, post.postId)
      summary.like.done++
    }
    catch (error) {
      errors.push(`点赞帖子 ${post.postId} 失败：${errorMessage(error)}`)
    }
  }

  const sharePost = browsedPosts[0] ?? posts[0]
  if (shareTarget > 0 && sharePost) {
    try {
      await api.sharePost(accessToken, account.uid, account.deviceId, sharePost.postId, sharePlatform)
      summary.share.done = 1
    }
    catch (error) {
      errors.push(`分享帖子 ${sharePost.postId} 失败：${errorMessage(error)}`)
    }
  }

  summary.coinState = await api.getUserCoinTaskState(accessToken)
  if (errors.length) {
    summary.error = errors.join('；')
  }
  return summary
}

async function runCloudDuration(
  api: AttendanceApi,
  account: TaygedoAccount,
  accountPasswords: Record<string, string>,
  credentialKey: string | undefined,
): Promise<{ summary: CloudDurationSummary, updatedAccount?: TaygedoAccount, shouldUpdateSecret?: boolean } | undefined> {
  if (!api.cloudGetUserInfo) {
    return undefined
  }
  // 必须绑回 api：这两个方法内部读 `this.fetchImpl`，把方法摘下来单独存成变量
  // 再调用会让 `this` 变成 undefined，真实 TaygedoApi 实例上直接 TypeError。
  const cloudGetUserInfo = api.cloudGetUserInfo.bind(api)
  const loginWithPassword = api.loginWithPassword?.bind(api)
  const cloudLoginWithPassword = api.cloudLoginWithPassword?.bind(api)
  let updatedAccount: TaygedoAccount | undefined

  const respond = (summary: CloudDurationSummary) => ({
    summary,
    ...(updatedAccount ? { updatedAccount, shouldUpdateSecret: true } : {}),
  })

  const resolved = resolveAccountPassword(account, accountPasswords, credentialKey)

  // 云异环只认老虎体系 token，refreshToken 续不了：token 过期（code=10004）时只能用
  // 手机号 + 密码重新登录。先复用塔吉多 App 的登录（laohuToken），被拒再退到云异环
  // 自己的 App 身份（cloudToken）——老虎各 App 的密码状态是独立的。
  const reloginLaohu = async (): Promise<LaohuCredentials | undefined> => {
    const phone = account.phone
    if (!phone || !resolved || !loginWithPassword) {
      return undefined
    }
    const login = await loginWithPassword(phone, resolved.password, account.deviceId, {
      openudid: account.openudid,
      vendorid: account.vendorid,
    })
    updatedAccount = {
      ...account,
      laohuToken: login.token,
      laohuUserId: login.userId,
      tokenUpdatedAt: shanghaiDateTime(),
    }
    return { token: login.token, userId: login.userId }
  }

  const reloginCloud = async (): Promise<LaohuCredentials | undefined> => {
    const phone = account.phone
    if (!phone || !resolved || !cloudLoginWithPassword) {
      return undefined
    }
    const login = await cloudLoginWithPassword(phone, resolved.password, account.deviceId)
    // 云异环 token 单独存：塔吉多登录态（laohuToken）还要给 userCenterLogin 用，
    // 两个 App 的 token 不能混。
    updatedAccount = {
      ...account,
      cloudToken: login.token,
      cloudUserId: login.userId,
    }
    return { token: login.token, userId: login.userId }
  }

  const tryRelogin = async (): Promise<CloudRefreshResult> => {
    const errors: unknown[] = []
    for (const attempt of [reloginLaohu, reloginCloud]) {
      try {
        const result = await attempt()
        if (result) {
          return { credentials: result }
        }
      }
      catch (error) {
        errors.push(error)
      }
    }
    // 两个入口都没配置（没手机号 / 没密码）时 errors 为空，交给调用方判成 skipped
    return { loginError: errors[0] }
  }

  // 云异环 token 优先（它才是 cloud/game 接口认的），没有再退回塔吉多登录的 laohuToken。
  let credentials: LaohuCredentials | undefined = account.cloudToken && account.cloudUserId
    ? { token: account.cloudToken, userId: account.cloudUserId }
    : account.laohuToken && account.laohuUserId
      ? { token: account.laohuToken, userId: account.laohuUserId }
      : undefined

  if (!credentials) {
    const attempt = await tryRelogin()
    if (attempt.credentials) {
      credentials = attempt.credentials
    }
    else if (attempt.loginError) {
      return respond({
        status: 'failed',
        error: await describeLaohuLoginFailure(api, account, attempt.loginError, resolved?.source),
      })
    }
    else {
      return respond({
        status: 'skipped',
        skippedReason: '账号缺少 laohuToken/laohuUserId',
      })
    }
  }

  try {
    return respond(toCloudDurationSummary(await cloudGetUserInfo(credentials.token, credentials.userId, account.deviceId)))
  }
  catch (error) {
    if (!isLaohuSessionExpiredError(error)) {
      return respond({
        status: 'failed',
        error: errorMessage(error),
      })
    }

    const attempt = await tryRelogin()
    if (attempt.loginError) {
      return respond({
        status: 'failed',
        error: await describeLaohuLoginFailure(api, account, attempt.loginError, resolved?.source),
      })
    }
    if (!attempt.credentials) {
      return respond({
        status: 'failed',
        error: `${errorMessage(error)}；laohuToken 已过期，请重新执行登录流程（或手动更新 laohuToken/laohuUserId、cloudToken/cloudUserId），也可以补充手机号和密码以便之后自动重新登录`,
      })
    }

    try {
      return respond(toCloudDurationSummary(await cloudGetUserInfo(attempt.credentials.token, attempt.credentials.userId, account.deviceId)))
    }
    catch (retryError) {
      return respond({
        status: 'failed',
        error: errorMessage(retryError),
      })
    }
  }
}

interface LaohuCredentials {
  token: string
  userId: string
}

interface CloudRefreshResult {
  credentials?: LaohuCredentials
  loginError?: unknown
}

/**
 * 老虎 token 过期后密码登录失败时，补一次「是否设置过密码」的诊断。
 *
 * 老虎各 App 的密码状态是分开的，`用户名或密码错误` 既可能是密码写错，也可能是这个号
 * 从来没用密码登录过（只走过短信验证码）——两种情况用户要做的事完全不同。
 */
async function describeLaohuLoginFailure(
  api: AttendanceApi,
  account: TaygedoAccount,
  error: unknown,
  passwordSource?: string,
): Promise<string> {
  const base = `老虎登录失败：${errorMessage(error)}`
  const reloginHint = '请重新执行一次登录流程（短信验证码）刷新 token'
  // 多账号时最常见的原因是「拿 A 账号的密码去登 B」，把来源标出来能一眼看出来。
  const sourceHint = passwordSource ? `（本次使用的是 ${passwordSource} 里的密码）` : ''
  const phone = account.phone
  if (!phone || !api.cloudQueryWhetherSetPassword) {
    return `${base}${sourceHint}；laohuToken 已过期，${reloginHint}`
  }

  try {
    const state = await api.cloudQueryWhetherSetPassword(phone, account.deviceId)
    if (state.havePwd === false) {
      return `${base}${sourceHint}；laohuToken 已过期，且该手机号在老虎平台没有设置密码，无法自动重新登录：${reloginHint}，或先在老虎平台设置密码并把密码配置到 TAYGEDO_PASSWORDS`
    }
    if (state.havePwd === true) {
      return `${base}${sourceHint}；laohuToken 已过期，该账号有老虎密码但当前密码被拒绝（可能已修改，或本次登录触发风控）：请更新 TAYGEDO_PASSWORDS，或${reloginHint}`
    }
  }
  catch {
    // 诊断失败不影响原始错误信息
  }

  return `${base}${sourceHint}；laohuToken 已过期，${reloginHint}`
}

function toCloudDurationSummary(result: CloudDurationResponse): CloudDurationSummary {
  return {
    status: 'success',
    gave: result.gave,
    ...(result.remained === undefined ? {} : { remained: result.remained }),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function signBbsIdempotently(
  api: AttendanceApi & { bbsSignin: NonNullable<AttendanceApi['bbsSignin']> },
  accessToken: string,
  account: TaygedoAccount,
): Promise<void> {
  try {
    await api.bbsSignin(accessToken, account.uid, account.deviceId)
  }
  catch (error) {
    if (!isAlreadySignedError(error)) {
      throw error
    }
  }
}

function remainingTaskCount(tasks: Array<{ code: string, completeTimes: number, limitTimes: number }>, code: string, fallback: number): number {
  const task = tasks.find(item => item.code === code)
  if (!task) {
    return fallback
  }
  return Math.max(0, task.limitTimes - task.completeTimes)
}

function withSession(
  account: TaygedoAccount,
  session: { accessToken: string, refreshToken: string, uid?: string, laohuToken?: string, laohuUserId?: string },
): TaygedoAccount {
  const updatedAccount: TaygedoAccount = {
    ...account,
    uid: session.uid ?? account.uid,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    tokenUpdatedAt: shanghaiDateTime(),
  }
  if (session.laohuToken) {
    updatedAccount.laohuToken = session.laohuToken
  }
  if (session.laohuUserId) {
    updatedAccount.laohuUserId = session.laohuUserId
  }
  return updatedAccount
}

function isRefreshRejected(error: unknown): boolean {
  return error instanceof Error && error.message.includes('REFRESH_REJECTED_402')
}

function isAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return /AUTH_EXPIRED|HTTP 40[123]|登录|token|未授权|请先|过期|失效|invalid_token/i.test(error.message)
}

async function getAllGameRoles(
  api: Pick<TaygedoApi, 'getGameRoles'> & Partial<Pick<TaygedoApi, 'getGameRecordCards'>>,
  accessToken: string,
  uid: string,
  deviceId: string,
): Promise<Array<{ gameId: string, roleId: string, roleName?: string }>> {
  const roles: Array<{ gameId: string, roleId: string, roleName?: string }> = []
  const seenRoleIds = new Set<string>()

  const gameRoleLists = await Promise.all(TAYGEDO_GAME_IDS.map(async (gameId) => {
    const gameRoleList = await api.getGameRoles(accessToken, uid, deviceId, gameId)
    return { gameId, roles: gameRoleList.roles }
  }))

  for (const gameRoleList of gameRoleLists) {
    for (const role of gameRoleList.roles) {
      if (!role.roleId || seenRoleIds.has(role.roleId)) {
        continue
      }
      seenRoleIds.add(role.roleId)
      roles.push({
        gameId: gameRoleList.gameId,
        roleId: role.roleId,
        roleName: role.roleName,
      })
    }
  }

  if (roles.length === 0 && api.getGameRecordCards) {
    const cards = await api.getGameRecordCards(accessToken, uid, deviceId)
    for (const card of cards.cards) {
      if (!card.roleId || seenRoleIds.has(card.roleId)) {
        continue
      }
      seenRoleIds.add(card.roleId)
      roles.push({
        gameId: card.gameId,
        roleId: card.roleId,
        roleName: card.roleName ?? card.gameName,
      })
    }
  }

  return roles
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return []
  }
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)))
  const results = new Array<R>(items.length)
  let nextIndex = 0

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index] as T, index)
    }
  }))

  return results
}

function buildSummary(accounts: AccountRunSummary[]): string {
  const successCount = accounts.filter(account => account.status === 'success').length
  const failedCount = accounts.filter(account => account.status === 'failed').length
  const skippedCount = accounts.filter(account => account.status === 'skipped').length
  const lines = [
    '塔吉多每日签到结果',
    `总账号：${accounts.length}，成功：${successCount}，失败：${failedCount}，跳过：${skippedCount}`,
    '',
  ]

  for (const account of accounts) {
    lines.push(`${account.name}（${account.id}）：${statusLabel(account.status)}`)
    if (account.appSignin) {
      if (account.appSignin.alreadySigned) {
        lines.push('- APP 签到：今日已签到')
      }
      else {
        lines.push(`- APP 签到：获得 ${account.appSignin.goldCoin} 金币，${account.appSignin.exp} 经验`)
      }
    }
    for (const gameSignin of account.gameSignins) {
      const reward = gameSignin.reward ? `，奖励 ${gameSignin.reward.name} x${gameSignin.reward.num}` : ''
      const days = gameSignin.days === undefined ? '' : `，本月第 ${gameSignin.days} 天`
      const signinStatus = gameSignin.alreadySigned ? '今日已签到' : '签到成功'
      lines.push(`- 游戏 ${gameSignin.gameId} / ${gameSignin.roleName}：${signinStatus}${days}${reward}`)
    }
    if (account.coinTasks) {
      lines.push(`- ${formatCoinTasks(account.coinTasks)}`)
    }
    if (account.cloudDuration) {
      lines.push(`- ${formatCloudDuration(account.cloudDuration)}`)
    }
    if (account.error) {
      lines.push(`- 失败原因：${account.error}`)
    }
    if (account.skippedReason) {
      lines.push(`- 跳过原因：${account.skippedReason}`)
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}

function formatCloudDuration(cloudDuration: CloudDurationSummary): string {
  if (cloudDuration.status === 'skipped') {
    return `云异环时长：跳过（${cloudDuration.skippedReason ?? '未执行'}）`
  }
  if (cloudDuration.status === 'failed') {
    return `云异环时长：失败（${cloudDuration.error ?? '未知错误'}）`
  }
  const gave = cloudDuration.gave ?? 0
  const remained = cloudDuration.remained === undefined ? '' : `，剩余 ${cloudDuration.remained} 分钟`
  return gave > 0
    ? `云异环时长：+${gave} 分钟${remained}`
    : `云异环时长：今日已领${remained}`
}

function formatCoinTasks(coinTasks: CoinTaskSummary): string {
  const bbsSignin = coinTasks.bbsSignin ? '✓' : '×'
  const share = coinTasks.share.done >= coinTasks.share.target ? '✓' : `${coinTasks.share.done}/${coinTasks.share.target}`
  const todayCoin = typeof coinTasks.coinState?.todayCoin === 'number' ? coinTasks.coinState.todayCoin : undefined
  const limitCoin = typeof coinTasks.coinState?.limitCoin === 'number' ? coinTasks.coinState.limitCoin : undefined
  const coinText = todayCoin === undefined || limitCoin === undefined
    ? ''
    : ` 今日金币${todayCoin}/${limitCoin}`
  return `金币任务：签到${bbsSignin} 浏览${coinTasks.browse.done}/${coinTasks.browse.target} 点赞${coinTasks.like.done}/${coinTasks.like.target} 分享${share}${coinText}`
}

function statusLabel(status: AccountRunSummary['status']): string {
  if (status === 'success') {
    return '成功'
  }
  if (status === 'skipped') {
    return '跳过'
  }
  return '失败'
}

function attendanceStateKey(accountId: string, date: string): string {
  return `attendance:${accountId}:${date}`
}

function shanghaiDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function randomDelay(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
