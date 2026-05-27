import { createHash, randomBytes } from 'node:crypto'

export const TAYGEDO_BASE_URL = 'https://bbs-api.tajiduo.com'
export const TAYGEDO_APP_VER = '1.2.2'
export const TAYGEDO_DS_SECRET = 'pUds3dfMkl'
export const H5_ORIGIN = 'https://webstatic.tajiduo.com'

const NATIVE_USER_AGENT = 'Tajiduo/1.2.2 (iPhone; iOS 17.0; Scale/3.00)'
const H5_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Tajiduo/1.2.2'
const NONCE_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export interface MakeDsOptions {
  timestamp?: number
  nonce?: string
}

export interface ProtocolRequest {
  url: string
  init: RequestInit & {
    headers: Record<string, string>
  }
}

export interface NativeRequestOptions {
  accessToken: string
  uid: string
  deviceId: string
  method: 'GET' | 'POST'
  path: string
  query?: Record<string, string | number | undefined>
  body?: Record<string, string | number | undefined>
  now?: () => Date
  nonce?: () => string
}

export interface H5RequestOptions {
  accessToken: string
  method: 'GET' | 'POST'
  path: string
  query?: Record<string, string | number | undefined>
  body?: Record<string, string | number | undefined>
}

export function makeDs(options: MakeDsOptions = {}): string {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000)
  const nonce = options.nonce ?? makeNonce()
  const signature = createHash('md5')
    .update(`${timestamp}${nonce}${TAYGEDO_APP_VER}${TAYGEDO_DS_SECRET}`, 'utf8')
    .digest('hex')
  return `${timestamp},${nonce},${signature}`
}

export function buildNativeRequest(options: NativeRequestOptions): ProtocolRequest {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: options.accessToken,
    appversion: TAYGEDO_APP_VER,
    platform: 'ios',
    uid: options.uid,
    deviceid: options.deviceId,
    ds: makeDs({
      timestamp: Math.floor((options.now?.() ?? new Date()).getTime() / 1000),
      nonce: options.nonce?.(),
    }),
    'User-Agent': NATIVE_USER_AGENT,
  }

  const body = options.body ? formEncode(options.body) : undefined
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
  }

  return {
    url: buildUrl(options.path, options.query),
    init: {
      method: options.method,
      headers,
      ...(body ? { body } : {}),
    },
  }
}

export function buildH5Request(options: H5RequestOptions): ProtocolRequest {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: options.accessToken,
    Origin: H5_ORIGIN,
    Referer: `${H5_ORIGIN}/`,
    'User-Agent': H5_USER_AGENT,
  }

  const body = options.body ? formEncode(options.body) : undefined
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
  }

  return {
    url: buildUrl(options.path, options.query),
    init: {
      method: options.method,
      headers,
      ...(body ? { body } : {}),
    },
  }
}

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(path, TAYGEDO_BASE_URL)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

function formEncode(data: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      params.set(key, String(value))
    }
  }
  return params.toString()
}

function makeNonce(): string {
  let nonce = ''
  while (nonce.length < 8) {
    for (const byte of randomBytes(8)) {
      const index = nonceIndexFromByte(byte)
      if (index !== undefined) {
        nonce += NONCE_ALPHABET[index]
        if (nonce.length === 8) {
          break
        }
      }
    }
  }
  return nonce
}

export function nonceIndexFromByte(byte: number): number | undefined {
  const fairRange = Math.floor(256 / NONCE_ALPHABET.length) * NONCE_ALPHABET.length
  if (byte >= fairRange) {
    return undefined
  }
  return byte % NONCE_ALPHABET.length
}
