import { createCipheriv, createHash } from 'node:crypto'
import { buildH5Request, buildNativeRequest, TAYGEDO_BASE_URL } from './protocol.js'

const LAOHU_BASE_URL = 'https://user.laohu.com'
const LAOHU_SECRET = '89155cc4e8634ec5b1b6364013b23e3e'

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

export class TaygedoApi {
  private readonly fetchImpl: typeof fetch

  constructor(options: TaygedoApiOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch
  }

  async sendCaptcha(phone: string, deviceId: string): Promise<void> {
    const body = signedLaohuBody({
      deviceType: 'LGE-AN10',
      type: '16',
      deviceId,
      deviceName: 'LGE-AN10',
      versionCode: '1',
      t: String(Math.floor(Date.now() / 1000)),
      areaCodeId: '1',
      appId: '10550',
      deviceSys: '12',
      cellphone: phone,
      deviceModel: 'LGE-AN10',
      sdkVersion: '4.129.0',
      bid: 'com.pwrd.htassistant',
      channelId: '1',
    })

    const response = await this.fetchImpl(`${LAOHU_BASE_URL}/m/newApi/sendPhoneCaptchaWithOutLogin`, {
      method: 'POST',
      headers: {
        platform: 'android',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })

    const data = await readJson(response, 'sendCaptcha') as {
      code?: number
      message?: string
      msg?: string
    }

    if (!response.ok || data.code !== 0) {
      throw new Error(data.message ?? data.msg ?? '发送短信验证码请求失败')
    }
  }

  async checkCaptcha(phone: string, captcha: string, deviceId: string): Promise<void> {
    const body = signedLaohuBody({
      deviceType: 'LGE-AN10',
      deviceId,
      deviceName: 'LGE-AN10',
      t: String(Math.floor(Date.now() / 1000)),
      areaCodeId: '1',
      appId: '10550',
      deviceSys: '12',
      cellphone: phone,
      captcha,
      deviceModel: 'LGE-AN10',
      sdkVersion: '4.129.0',
      bid: 'com.pwrd.htassistant',
      channelId: '1',
    })

    const response = await this.fetchImpl(`${LAOHU_BASE_URL}/m/newApi/checkPhoneCaptchaWithOutLogin`, {
      method: 'POST',
      headers: {
        platform: 'android',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })

    const data = await readJson(response, 'checkCaptcha') as {
      code?: number
      message?: string
      msg?: string
    }

    if (!response.ok || data.code !== 0) {
      throw new Error(data.message ?? data.msg ?? '校验短信验证码请求失败')
    }
  }

  async loginWithCaptcha(phone: string, captcha: string, deviceId: string): Promise<LoginWithCaptchaResponse> {
    const body = signedLaohuBody({
      deviceType: 'LGE-AN10',
      idfa: '',
      sign: '',
      adm: '',
      type: '16',
      deviceId,
      version: '1',
      deviceName: 'LGE-AN10',
      mac: '',
      t: String(Date.now()),
      areaCodeId: '1',
      captcha: aesBase64Encode(captcha),
      appId: '10550',
      deviceSys: '12',
      cellphone: aesBase64Encode(phone),
      deviceModel: 'LGE-AN10',
      sdkVersion: '4.129.0',
      bid: 'com.pwrd.htassistant',
      channelId: '1',
    })

    const response = await this.fetchImpl(`${LAOHU_BASE_URL}/openApi/sms/new/login`, {
      method: 'POST',
      headers: {
        platform: 'android',
        'Content-Type': 'application/x-www-form-urlencoded',
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
      throw new Error(data.message ?? data.msg ?? '短信验证码登录请求失败')
    }

    return {
      token: data.result.token,
      userId: String(data.result.userId),
    }
  }

  async loginWithPassword(phone: string, password: string, deviceId: string): Promise<LoginWithCaptchaResponse> {
    const body = signedLaohuBody({
      deviceType: 'LGE-AN10',
      idfa: '',
      sign: '',
      adm: '',
      deviceId,
      version: '1',
      deviceName: 'LGE-AN10',
      mac: '',
      t: String(Date.now()),
      appId: '10550',
      deviceSys: '12',
      username: aesBase64Encode(phone),
      password: aesBase64Encode(password),
      deviceModel: 'LGE-AN10',
      sdkVersion: '4.129.0',
      bid: 'com.pwrd.htassistant',
      channelId: '1',
    })

    const response = await this.fetchImpl(`${LAOHU_BASE_URL}/openApi/secureLogin`, {
      method: 'POST',
      headers: {
        platform: 'android',
        'Content-Type': 'application/x-www-form-urlencoded',
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
      throw new Error(data.message ?? data.msg ?? '账号密码登录请求失败')
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
        platform: 'android',
        deviceid: deviceId,
        authorization: '',
        appversion: '1.1.0',
        uid: '10000000',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'okhttp/4.12.0',
      },
      body: formEncode({
        token,
        userIdentity: userId,
        appId: '10551',
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
      throw new Error(data.msg ?? '塔吉多用户中心登录请求失败')
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
      throw new Error(data.msg ?? '刷新登录令牌请求失败')
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
      throw new Error(data.msg ?? '获取绑定角色请求失败')
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
      throw new Error(data.msg ?? '获取游戏角色请求失败')
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
      throw new Error(data.msg ?? 'APP 签到请求失败')
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
      throw new Error(data.msg ?? '获取游戏签到状态请求失败')
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
      throw new Error(data.msg ?? '获取游戏签到奖励请求失败')
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
      throw new Error(data.msg ?? '游戏签到请求失败')
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
      throw new Error(data.msg ?? '获取金币任务状态请求失败')
    }

    return data.data.task_list1
      .filter(isRecord)
      .map(task => ({
        code: String(task.code ?? ''),
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
      throw new Error(data.msg ?? 'BBS 金币签到请求失败')
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
      } | unknown[]
    }
    const rawList = Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.data?.list)
        ? data.data.list
        : undefined

    if (!response.ok || data.code !== 0 || !rawList) {
      throw new Error(data.msg ?? '获取推荐帖子列表请求失败')
    }

    return rawList.filter(isRecord).map(toRecommendPost).filter((post): post is RecommendPost => post !== undefined)
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
    const post = isRecord(data.data) ? toRecommendPost(data.data) : undefined

    if (!response.ok || data.code !== 0 || !post) {
      throw new Error(data.msg ?? '获取帖子详情请求失败')
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
      throw new Error(data.msg ?? '点赞帖子请求失败')
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
      throw new Error(data.msg ?? '分享帖子请求失败')
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
      throw new Error(data.msg ?? '获取金币状态请求失败')
    }
    return data.data
  }
}

function signedLaohuBody(data: Record<string, string>): string {
  const withSign = {
    ...data,
    sign: laohuSign(data),
  }
  return formEncode(withSign)
}

function laohuSign(data: Record<string, string>): string {
  const values = Object.keys(data).sort().map(key => data[key]).join('')
  return createHash('md5').update(`${values}${LAOHU_SECRET}`, 'utf8').digest('hex')
}

function aesBase64Encode(value: string): string {
  const key = Buffer.from(LAOHU_SECRET.slice(-16), 'utf8')
  const cipher = createCipheriv('aes-128-ecb', key, null)
  cipher.setAutoPadding(true)
  return Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64')
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
