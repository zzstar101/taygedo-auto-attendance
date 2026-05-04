import { createCipheriv, createHash } from 'node:crypto'

const TAYGEDO_BASE_URL = 'https://bbs-api.tajiduo.com'
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

    const data = await response.json() as {
      code?: number
      message?: string
      msg?: string
    }

    if (!response.ok || data.code !== 0) {
      throw new Error(data.message ?? data.msg ?? 'sendCaptcha request failed')
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

    const data = await response.json() as {
      code?: number
      message?: string
      msg?: string
      result?: {
        token?: string
        userId?: string | number
      }
    }

    if (!response.ok || data.code !== 0 || !data.result?.token || data.result.userId === undefined) {
      throw new Error(data.message ?? data.msg ?? 'loginWithCaptcha request failed')
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

    const data = await response.json() as {
      code?: number
      msg?: string
      data?: {
        accessToken?: string
        refreshToken?: string
        uid?: string | number
      }
    }

    if (!response.ok || data.code !== 0 || !data.data?.accessToken || !data.data.refreshToken || data.data.uid === undefined) {
      throw new Error(data.msg ?? 'userCenterLogin request failed')
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

    const data = await response.json() as {
      code?: number
      msg?: string
      data?: {
        accessToken?: string
        refreshToken?: string
        uid?: string | number
      }
    }

    if (!response.ok || data.code !== 0 || !data.data?.accessToken || !data.data?.refreshToken) {
      throw new Error(data.msg ?? 'refreshToken request failed')
    }

    return {
      accessToken: data.data.accessToken,
      refreshToken: data.data.refreshToken,
      uid: data.data.uid === undefined ? undefined : String(data.data.uid),
    }
  }

  async getBindRole(accessToken: string, uid: string): Promise<BindRoleResponse> {
    const response = await this.fetchImpl(`${TAYGEDO_BASE_URL}/apihub/api/getGameBindRole?uid=${encodeURIComponent(uid)}&gameId=1256`, {
      method: 'GET',
      headers: {
        Authorization: accessToken,
      },
    })

    const data = await response.json() as {
      code?: number
      msg?: string
      data?: BindRoleResponse
    }

    if (!response.ok || data.code !== 0 || !data.data) {
      throw new Error(data.msg ?? 'getBindRole request failed')
    }

    return data.data
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

    const data = await response.json() as {
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
      throw new Error(data.msg ?? 'appSignin request failed')
    }

    return {
      exp: data.data.exp,
      goldCoin: data.data.goldCoin,
    }
  }

  async getSigninState(accessToken: string): Promise<{ days: number }> {
    const response = await this.fetchImpl(`${TAYGEDO_BASE_URL}/apihub/awapi/signin/state?gameId=1256`, {
      method: 'GET',
      headers: {
        Authorization: accessToken,
      },
    })

    const data = await response.json() as {
      code?: number
      msg?: string
      data?: { days?: number }
    }

    if (!response.ok || data.code !== 0 || typeof data.data?.days !== 'number') {
      throw new Error(data.msg ?? 'getSigninState request failed')
    }

    return {
      days: data.data.days,
    }
  }

  async getSigninRewards(accessToken: string): Promise<Array<{ name: string, num: number }>> {
    const response = await this.fetchImpl(`${TAYGEDO_BASE_URL}/apihub/awapi/sign/rewards?gameId=1256`, {
      method: 'GET',
      headers: {
        Authorization: accessToken,
      },
    })

    const data = await response.json() as {
      code?: number
      msg?: string
      data?: Array<{ name: string, num: number }>
    }

    if (!response.ok || data.code !== 0 || !Array.isArray(data.data)) {
      throw new Error(data.msg ?? 'getSigninRewards request failed')
    }

    return data.data
  }

  async gameSignin(accessToken: string, roleId: string): Promise<void> {
    const response = await this.fetchImpl(`${TAYGEDO_BASE_URL}/apihub/awapi/sign`, {
      method: 'POST',
      headers: {
        authorization: accessToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `roleId=${encodeURIComponent(roleId)}&gameId=1256`,
    })

    const data = await response.json() as {
      code?: number
      msg?: string
    }

    if (!response.ok || data.code !== 0) {
      throw new Error(data.msg ?? 'gameSignin request failed')
    }
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
