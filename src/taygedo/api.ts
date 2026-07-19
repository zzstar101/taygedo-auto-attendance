import { createCipheriv, createHash } from 'node:crypto'
import { buildH5Request, buildNativeRequest, makeDs, TAYGEDO_APP_VER, TAYGEDO_BASE_URL } from './protocol.js'
import type { DeviceIdentity } from './device.js'

const LAOHU_BASE_URL = 'https://user.laohu.com'
const LAOHU_SECRET = '89155cc4e8634ec5b1b6364013b23e3e'
const LAOHU_IOS_SECRET = '5fd254cc0c8740d7a57376415ce40ede'
const LAOHU_IOS_APP_ID = '10551'
const LAOHU_IOS_CHANNEL_ID = '2'
const LAOHU_IOS_VERSION = '1.2.4'
const LAOHU_IOS_SDK_VERSION = '4.317.0'
const LAOHU_IOS_USER_AGENT = 'okhttp/4.12.0'
const CLOUD_APP_ID = '10597'
const CLOUD_APP_KEY = 'f1b7f11fc3774f898e387368cce4da04'
const CLOUD_CHANNEL_ID = '9'
const CLOUD_BID = 'com.pwrd.cloud.yh.laohu'
const CLOUD_SDK_VERSION = '1.34.0'
const CLOUD_APP_VERSION = '1.1.0'

export interface RefreshTokenResponse {
  accessToken: string
  refreshToken: string
  uid?: string
}

export interface LoginWithCaptchaResponse {
  token: string
  userId: string
}

export interface UserCenterLoginResponse {
  accessToken: string
  refreshToken: string
  uid: string
}

export interface TaygedoApiOptions {
  fetch?: typeof fetch
}

export interface BindRoleResponse {
  roleId?: string
  roleName?: string
}

export interface GameRolesResponse {
  roles: Array<{ roleId: string, roleName?: string }>
}

export interface GameRecordCardResponse {
  cards: Array<{
    gameId: string
    gameName?: string
    roleId?: string
    roleName?: string
  }>
}

export interface CoinTask {
  code: string
  completeTimes: number
  limitTimes: number
}

export interface RecommendPost {
  postId: string
  selfOperation?: {
    liked?: boolean
  }
}

export interface CoinState {
  todayCoin?: number
  limitCoin?: number
  [key: string]: unknown
}

export interface CloudDurationResponse {
  gave: number
  remained?: number
}

export class TaygedoApi {
  private readonly fetchImpl: typeof fetch

  constructor(options: TaygedoApiOptions = {}) {
    // Workerd requires the platform fetch function to keep globalThis as its
    // receiver. Wrapping it avoids an "Illegal invocation" when this client
    // stores and later calls the function as a class field.
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  }

  async sendCaptcha(phone: string, deviceId: string): Promise<void> {
    const body = signedLaohuBody({
      ...laohuIosBaseParams(deviceId, {}, String(Math.floor(Date.now() / 1000))),
      areaCodeId: '1',
      cellphone: phone,
      type: '18',
    }, LAOHU_IOS_SECRET)

    const response = await this.fetchImpl(`${LAOHU_BASE_URL}/m/newApi/sendPhoneCaptchaWithOutLogin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': LAOHU_IOS_USER_AGENT,
      },
      body,
    })

    const data = await readJson(response, 'sendCaptcha') as {
      code?: number
      message?: string
      msg?: string
    }

    if (!response.ok || data.code !== 0) {
      throw apiResponseError('sendCaptcha', response, data, '发送短信验证码请求失败')
    }
  }

  async loginWithCaptcha(phone: string, captcha: string, deviceId: string): Promise<LoginWithCaptchaResponse> {
    const body = signedLaohuBody({
      ...laohuIosBaseParams(deviceId, {}, String(Date.now())),
      areaCodeId: '1',
      captcha: aesBase64Encode(captcha, LAOHU_IOS_SECRET),
      cellphone: aesBase64Encode(phone, LAOHU_IOS_SECRET),
      deviceModel: 'iPhone',
      deviceName: 'iPhone',
      deviceSys: '26.5',
      deviceType: 'iPhone17,4',
      idfa: '00000000-0000-0000-0000-000000000000',
      type: '18',
    }, LAOHU_IOS_SECRET)

    const response = await this.fetchImpl(`${LAOHU_BASE_URL}/openApi/sms/new/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': LAOHU_IOS_USER_AGENT,
      },
      body,
    })

    const data = await readJson(response, 'loginWithCaptcha') as {
      code?: number
      message?: string
      msg?: string
      result?: {
        token?: string
        userId?: string | number
      }
    }

    if (!response.ok || data.code !== 0 || !data.result?.token || data.result.userId === undefined) {
      throw apiResponseError('loginWithCaptcha', response, data, '短信验证码登录请求失败')
    }

    return {
      token: data.result.token,
      userId: String(data.result.userId),
    }
  }

  async loginWithPassword(
    phone: string,
    password: string,
    deviceId: string,
    device: Partial<Pick<DeviceIdentity, 'openudid' | 'vendorid'>> = {},
  ): Promise<LoginWithCaptchaResponse> {
    const openudid = device.openudid ?? stableUuid(`${deviceId}:openudid`)
    const vendorid = device.vendorid ?? stableUuid(`${deviceId}:vendorid`)
    const body = signedLaohuBody({
      ...laohuIosBaseParams(deviceId, { openudid, vendorid }, String(Date.now())),
      deviceModel: 'iPhone',
      deviceName: 'iPhone',
      deviceSys: '26.5',
      deviceType: 'iPhone17,4',
      idfa: '00000000-0000-0000-0000-000000000000',
      password: aesBase64Encode(password, LAOHU_IOS_SECRET),
      username: aesBase64Encode(phone, LAOHU_IOS_SECRET),
    }, LAOHU_IOS_SECRET)

    const response = await this.fetchImpl(`${LAOHU_BASE_URL}/openApi/secureLogin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': LAOHU_IOS_USER_AGENT,
      },
      body,
    })

    const data = await readJson(response, 'loginWithPassword') as {
      code?: number
      message?: string
      msg?: string
      result?: {
        token?: string
        userId?: string | number
      }
    }

    if (!response.ok || data.code !== 0 || !data.result?.token || data.result.userId === undefined) {
      throw apiResponseError('loginWithPassword', response, data, '账号密码登录请求失败')
    }

    return {
      token: data.result.token,
      userId: String(data.result.userId),
    }
  }

  async userCenterLogin(token: string, userId: string, deviceId: string): Promise<UserCenterLoginResponse> {
    const response = await this.fetchImpl(`${TAYGEDO_BASE_URL}/usercenter/api/login`, {
      method: 'POST',
      headers: {
        authorization: '',
        appversion: TAYGEDO_APP_VER,
        platform: 'ios',
        deviceid: deviceId,
        ds: makeDs(),
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': 'okhttp/4.12.0',
      },
      body: formEncode({
        token,
        userIdentity: userId,
        appId: LAOHU_IOS_APP_ID,
      }),
    })

    const data = await readJson(response, 'userCenterLogin') as {
      code?: number
      msg?: string
      data?: {
        accessToken?: string
        refreshToken?: string
        uid?: string | number
      }
    }

    if (!response.ok || data.code !== 0 || !data.data?.accessToken || !data.data.refreshToken || data.data.uid === undefined) {
      throw apiResponseError('userCenterLogin', response, data, '塔吉多用户中心登录请求失败')
    }

    return {
      accessToken: data.data.accessToken,
      refreshToken: data.data.refreshToken,
      uid: String(data.data.uid),
    }
  }

  async refreshToken(refreshToken: string, deviceId: string): Promise<RefreshTokenResponse> {
    const response = await this.fetchImpl(`${TAYGEDO_BASE_URL}/usercenter/api/refreshToken`, {
      method: 'POST',
      headers: {
        authorization: refreshToken,
        deviceid: deviceId,
        appversion: '1.1.0',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'okhttp/4.12.0',
      },
    })

    if (response.status === 402) {
      throw new Error('REFRESH_REJECTED_402: refreshToken 已失效，请重新登录')
    }

    const data = await readJson(response, 'refreshToken') as {
      code?: number
      msg?: string
      data?: {
        accessToken?: string
        refreshToken?: string
        uid?: string | number
      }
    }

    if (!response.ok || data.code !== 0 || !data.data?.accessToken || !data.data?.refreshToken) {
      throw apiResponseError('refreshToken', response, data, '刷新登录令牌请求失败')
    }

    return {
      accessToken: data.data.accessToken,
      refreshToken: data.data.refreshToken,
      uid: data.data.uid === undefined ? undefined : String(data.data.uid),
    }
  }

  async getBindRole(accessToken: string, uid: string, gameId = '1256'): Promise<BindRoleResponse> {
    const response = await this.fetchImpl(`${TAYGEDO_BASE_URL}/apihub/api/getGameBindRole?uid=${encodeURIComponent(uid)}&gameId=${encodeURIComponent(gameId)}`, {
      method: 'GET',
      headers: {
        Authorization: accessToken,
      },
    })

    const data = await readJson(response, 'getBindRole') as {
      code?: number
      msg?: string
      data?: BindRoleResponse
    }

    if (!response.ok || data.code !== 0 || !data.data) {
      throw apiResponseError('getBindRole', response, data, '获取绑定角色请求失败')
    }

    return data.data
  }

  async getGameRoles(accessToken: string, uid: string, deviceId: string, gameId = '1256'): Promise<GameRolesResponse> {
    const response = await this.fetchImpl(`${TAYGEDO_BASE_URL}/usercenter/api/v2/getGameRoles?gameId=${encodeURIComponent(gameId)}`, {
      method: 'GET',
      headers: {
        platform: 'android',
        authorization: accessToken,
        uid,
        deviceid: deviceId,
        appversion: '1.1.0',
        'User-Agent': 'okhttp/4.12.0',
      },
    })

    const data = await readJson(response, 'getGameRoles') as {
      code?: number
      msg?: string
      data?: {
        roles?: Array<{ roleId?: string | number, roleName?: string }>
      }
    }

    if (!response.ok || data.code !== 0 || !Array.isArray(data.data?.roles)) {
      throw apiResponseError('getGameRoles', response, data, '获取游戏角色请求失败')
    }

    return {
      roles: data.data.roles
        .filter(role => role.roleId !== undefined)
        .map(role => ({
          roleId: String(role.roleId),
          roleName: role.roleName,
        })),
    }
  }

  async getGameRecordCards(accessToken: string, uid: string, deviceId: string): Promise<GameRecordCardResponse> {
    const request = buildNativeRequest({
      accessToken,
      uid,
      deviceId,
      method: 'GET',
      path: '/apihub/api/getGameRecordCard',
      query: { uid },
    })
    const response = await this.fetchImpl(request.url, request.init)
    const data = await readJson(response, 'getGameRecordCards') as {
      code?: number
      msg?: string
      data?: unknown
    }
    if (!response.ok || data.code !== 0 || !Array.isArray(data.data)) {
      throw apiResponseError('getGameRecordCards', response, data, '获取游戏角色卡请求失败')
    }
    return {
      cards: data.data
        .filter(isRecord)
        .map(toGameRecordCard)
        .filter((card: GameRecordCardResponse['cards'][number] | undefined): card is GameRecordCardResponse['cards'][number] => card !== undefined),
    }
  }

  async appSignin(accessToken: string, uid: string, deviceId: string): Promise<{ exp: number, goldCoin: number }> {
    const response = await this.fetchImpl(`${TAYGEDO_BASE_URL}/apihub/api/signin`, {
      method: 'POST',
      headers: {
        authorization: accessToken,
        uid,
        deviceid: deviceId,
        appversion: '1.1.0',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'okhttp/4.12.0',
      },
      body: 'communityId=1',
    })

    const data = await readJson(response, 'appSignin') as {
      code?: number
      msg?: string
      data?: { exp?: number, goldCoin?: number }
    }

    if (
      !response.ok
      || data.code !== 0
      || typeof data.data?.exp !== 'number'
      || typeof data.data?.goldCoin !== 'number'
    ) {
      throw apiResponseError('appSignin', response, data, 'APP 签到请求失败')
    }

    return {
      exp: data.data.exp,
      goldCoin: data.data.goldCoin,
    }
  }

  async getSigninState(accessToken: string, gameId = '1256'): Promise<{ days: number }> {
    const request = buildH5Request({
      accessToken,
      method: 'GET',
      path: '/apihub/awapi/signin/state',
      query: { gameId },
    })
    const response = await this.fetchImpl(request.url, request.init)

    const data = await readJson(response, 'getSigninState') as {
      code?: number
      msg?: string
      data?: { days?: number }
    }

    if (!response.ok || data.code !== 0 || typeof data.data?.days !== 'number') {
      throw apiResponseError('getSigninState', response, data, '获取游戏签到状态请求失败')
    }

    return {
      days: data.data.days,
    }
  }

  async getSigninRewards(accessToken: string, gameId = '1256'): Promise<Array<{ name: string, num: number }>> {
    const request = buildH5Request({
      accessToken,
      method: 'GET',
      path: '/apihub/awapi/sign/rewards',
      query: { gameId },
    })
    const response = await this.fetchImpl(request.url, request.init)

    const data = await readJson(response, 'getSigninRewards') as {
      code?: number
      msg?: string
      data?: Array<{ name: string, num: number }>
    }

    if (!response.ok || data.code !== 0 || !Array.isArray(data.data)) {
      throw apiResponseError('getSigninRewards', response, data, '获取游戏签到奖励请求失败')
    }

    return data.data
  }

  async gameSignin(accessToken: string, roleId: string, gameId = '1256'): Promise<void> {
    const request = buildH5Request({
      accessToken,
      method: 'POST',
      path: '/apihub/awapi/sign',
      body: { roleId, gameId },
    })
    const response = await this.fetchImpl(request.url, request.init)

    const data = await readJson(response, 'gameSignin') as {
      code?: number
      msg?: string
    }

    if (!response.ok || data.code !== 0) {
      throw apiResponseError('gameSignin', response, data, '游戏签到请求失败')
    }
  }

  async getUserTasks(accessToken: string, uid: string, deviceId: string): Promise<CoinTask[]> {
    const request = buildNativeRequest({
      accessToken,
      uid,
      deviceId,
      method: 'GET',
      path: '/apihub/api/getUserTasks',
      query: { gid: 1 },
    })
    const response = await this.fetchImpl(request.url, request.init)
    const data = await readJson(response, 'getUserTasks') as {
      code?: number
      msg?: string
      data?: {
        task_list1?: unknown[]
      }
    }

    if (!response.ok || data.code !== 0 || !Array.isArray(data.data?.task_list1)) {
      throw apiResponseError('getUserTasks', response, data, '获取金币任务状态请求失败')
    }

    return data.data.task_list1
      .filter(isRecord)
      .map(task => ({
        code: String(task.code ?? task.taskKey ?? ''),
        completeTimes: toNumber(task.completeTimes),
        limitTimes: toNumber(task.limitTimes),
      }))
      .filter(task => task.code)
  }

  async bbsSignin(accessToken: string, uid: string, deviceId: string): Promise<void> {
    const request = buildNativeRequest({
      accessToken,
      uid,
      deviceId,
      method: 'POST',
      path: '/apihub/api/signin',
      body: { communityId: 2 },
    })
    const response = await this.fetchImpl(request.url, request.init)
    const data = await readJson(response, 'bbsSignin') as {
      code?: number
      msg?: string
    }
    if (!response.ok || data.code !== 0) {
      throw apiResponseError('bbsSignin', response, data, 'BBS 金币签到请求失败')
    }
  }

  async getRecommendPostList(accessToken: string, uid: string, deviceId: string, count = 20, page = 1): Promise<RecommendPost[]> {
    const request = buildNativeRequest({
      accessToken,
      uid,
      deviceId,
      method: 'GET',
      path: '/bbs/api/getRecommendPostList',
      query: { communityId: 2, count, page },
    })
    const response = await this.fetchImpl(request.url, request.init)
    const data = await readJson(response, 'getRecommendPostList') as {
      code?: number
      msg?: string
      data?: {
        list?: unknown[]
        posts?: unknown[]
      } | unknown[]
    }
    const rawList = Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.data?.list)
        ? data.data.list
        : Array.isArray(data.data?.posts)
          ? data.data.posts
          : undefined

    if (!response.ok || data.code !== 0 || !rawList) {
      throw apiResponseError('getRecommendPostList', response, data, '获取推荐帖子列表请求失败')
    }

    return rawList.filter(isRecord).map(toRecommendPost).filter((post: RecommendPost | undefined): post is RecommendPost => post !== undefined)
  }

  async getPostFull(accessToken: string, uid: string, deviceId: string, postId: string): Promise<RecommendPost> {
    const request = buildNativeRequest({
      accessToken,
      uid,
      deviceId,
      method: 'GET',
      path: '/bbs/api/getPostFull',
      query: { postId },
    })
    const response = await this.fetchImpl(request.url, request.init)
    const data = await readJson(response, 'getPostFull') as {
      code?: number
      msg?: string
      data?: unknown
    }
    const post = isRecord(data.data) ? toPostFull(data.data, postId) : undefined

    if (!response.ok || data.code !== 0 || !post) {
      throw apiResponseError('getPostFull', response, data, '获取帖子详情请求失败')
    }

    return post
  }

  async likePost(accessToken: string, uid: string, deviceId: string, postId: string): Promise<void> {
    const request = buildNativeRequest({
      accessToken,
      uid,
      deviceId,
      method: 'POST',
      path: '/bbs/api/post/like',
      body: { postId },
    })
    const response = await this.fetchImpl(request.url, request.init)
    const data = await readJson(response, 'likePost') as {
      code?: number
      msg?: string
    }
    if (!response.ok || data.code !== 0) {
      throw apiResponseError('likePost', response, data, '点赞帖子请求失败')
    }
  }

  async sharePost(accessToken: string, uid: string, deviceId: string, postId: string, platform: string): Promise<void> {
    const request = buildNativeRequest({
      accessToken,
      uid,
      deviceId,
      method: 'POST',
      path: '/bbs/api/post/share',
      body: { platform, postId },
    })
    const response = await this.fetchImpl(request.url, request.init)
    const data = await readJson(response, 'sharePost') as {
      code?: number
      msg?: string
    }
    if (!response.ok || data.code !== 0) {
      throw apiResponseError('sharePost', response, data, '分享帖子请求失败')
    }
  }

  async getUserCoinTaskState(accessToken: string): Promise<CoinState> {
    const request = buildH5Request({
      accessToken,
      method: 'GET',
      path: '/apihub/api/getUserCoinTaskState',
    })
    const response = await this.fetchImpl(request.url, request.init)
    const data = await readJson(response, 'getUserCoinTaskState') as {
      code?: number
      msg?: string
      data?: CoinState
    }
    if (!response.ok || data.code !== 0 || !isRecord(data.data)) {
      throw apiResponseError('getUserCoinTaskState', response, data, '获取金币状态请求失败')
    }
    return data.data
  }

  async cloudGetUserInfo(laohuToken: string, laohuUserId: string, deviceId: string): Promise<CloudDurationResponse> {
    const body = signedCloudBody({
      appId: CLOUD_APP_ID,
      deviceId,
      deviceType: 'Pixel 8',
      deviceName: 'Pixel 8',
      t: String(Math.floor(Date.now() / 1000)),
      channelId: CLOUD_CHANNEL_ID,
      deviceModel: 'Pixel 8',
      deviceSys: '14',
      version: CLOUD_APP_VERSION,
      sdkVersion: CLOUD_SDK_VERSION,
      network: 'wifi',
      bid: CLOUD_BID,
      provider: '0',
      idfa: '',
      userId: laohuUserId,
      token: laohuToken,
    })

    const response = await this.fetchImpl(`${LAOHU_BASE_URL}/cloud/game/getUserInfo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'okhttp/3.12.1',
        Host: 'user.laohu.com',
      },
      body,
    })

    const data = await readJson(response, 'cloudGetUserInfo') as {
      code?: number
      message?: string
      msg?: string
      result?: {
        perDayFirstLoginGiveDuration?: unknown
        remainedDuration?: unknown
      }
    }

    if (!response.ok || data.code !== 0 || !isRecord(data.result)) {
      throw apiResponseError('cloudGetUserInfo', response, data, '云异环时长请求失败')
    }

    const gave = toOptionalNumber(data.result.perDayFirstLoginGiveDuration) ?? 0
    const remained = toOptionalNumber(data.result.remainedDuration)
    return {
      gave,
      ...(remained === undefined ? {} : { remained }),
    }
  }
}

function signedLaohuBody(data: Record<string, string>, secret = LAOHU_SECRET): string {
  const withSign = {
    ...data,
    sign: laohuSign(data, secret),
  }
  return formEncode(withSign)
}

function laohuSign(data: Record<string, string>, secret = LAOHU_SECRET): string {
  const values = Object.keys(data).sort().map(key => data[key]).join('')
  return createHash('md5').update(`${values}${secret}`, 'utf8').digest('hex')
}

function signedCloudBody(data: Record<string, string>): string {
  const withSign = {
    ...data,
    sign: cloudSign(data),
  }
  return formEncode(withSign)
}

function cloudSign(data: Record<string, string>): string {
  const values = Object.keys(data).sort().map(key => data[key]).join('')
  return createHash('md5').update(`${values}${CLOUD_APP_KEY}`, 'utf8').digest('hex')
}

function aesBase64Encode(value: string, secret = LAOHU_SECRET): string {
  const key = Buffer.from(secret.slice(-16), 'utf8')
  // ECB does not use an IV. Workerd's node:crypto compatibility layer rejects
  // null here even though Node.js accepts it, while a zero-length buffer works
  // in both runtimes and still represents "no IV".
  const cipher = createCipheriv('aes-128-ecb', key, Buffer.alloc(0))
  cipher.setAutoPadding(true)
  return Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64')
}

function laohuIosBaseParams(
  deviceId: string,
  device: Partial<Pick<DeviceIdentity, 'openudid' | 'vendorid'>>,
  timestamp: string,
): Record<string, string> {
  const openudid = device.openudid ?? stableUuid(`${deviceId}:openudid`)
  const vendorid = device.vendorid ?? stableUuid(`${deviceId}:vendorid`)
  return {
    adid: deviceId,
    adm: '',
    appId: LAOHU_IOS_APP_ID,
    bid: 'com.pwrd.htassistant',
    channelId: LAOHU_IOS_CHANNEL_ID,
    deviceId,
    iOSAppOnMac: '0',
    idfv: vendorid,
    mac: deviceId,
    openudid,
    osType: '1',
    sdkVersion: LAOHU_IOS_SDK_VERSION,
    t: timestamp,
    vendorid,
    version: LAOHU_IOS_VERSION,
  }
}

function stableUuid(seed: string): string {
  const hex = createHash('md5').update(seed, 'utf8').digest('hex').toUpperCase()
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`
}

function formEncode(data: Record<string, string>): string {
  return new URLSearchParams(data).toString()
}

async function readJson(response: Response, endpointName: string): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) {
    throw new Error(`${endpointName} 返回了无效 JSON（HTTP ${response.status}，响应为空）`)
  }

  try {
    return JSON.parse(text) as unknown
  }
  catch {
    throw new Error(`${endpointName} 返回了无效 JSON（HTTP ${response.status}，响应：${summarizeResponse(text)}）`)
  }
}

function summarizeResponse(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized
}

function apiResponseError(
  endpointName: string,
  response: Response,
  data: { code?: number, msg?: string, message?: string },
  fallback: string,
): Error {
  const msg = (data.message ?? data.msg)?.trim()
  const code = data.code === undefined ? 'unknown' : String(data.code)
  if (msg && msg.toLowerCase() !== 'ok') {
    return new Error(`${endpointName}：${msg}（HTTP ${response.status}，code=${code}）`)
  }
  const msgText = msg ? `，msg=${msg}` : ''
  return new Error(`${endpointName} 请求失败（HTTP ${response.status}，code=${code}${msgText}，响应：${summarizeResponse(JSON.stringify(data))}）`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function toRecommendPost(value: Record<string, unknown>): RecommendPost | undefined {
  const postId = value.postId ?? value.id
  if (postId === undefined) {
    return undefined
  }
  const selfOperation = isRecord(value.selfOperation) ? value.selfOperation : undefined
  return {
    postId: String(postId),
    ...(selfOperation
      ? {
          selfOperation: {
            liked: typeof selfOperation.liked === 'boolean' ? selfOperation.liked : undefined,
          },
        }
      : {}),
  }
}

function toPostFull(value: Record<string, unknown>, fallbackPostId: string): RecommendPost | undefined {
  const directPost = toRecommendPost(value)
  if (directPost) {
    return directPost
  }

  if (!isRecord(value.post)) {
    return undefined
  }

  return toRecommendPost({
    postId: fallbackPostId,
    selfOperation: value.selfOperation,
    ...value.post,
  })
}

function toGameRecordCard(value: Record<string, unknown>): GameRecordCardResponse['cards'][number] | undefined {
  const gameId = value.gameId
  if (gameId === undefined) {
    return undefined
  }
  const bindRoleInfo = isRecord(value.bindRoleInfo) ? value.bindRoleInfo : undefined
  const roleId = bindRoleInfo?.roleId
  return {
    gameId: String(gameId),
    ...(typeof value.gameName === 'string' ? { gameName: value.gameName } : {}),
    ...(roleId !== undefined ? { roleId: String(roleId) } : {}),
    ...(typeof bindRoleInfo?.roleName === 'string' ? { roleName: bindRoleInfo.roleName } : {}),
  }
}
