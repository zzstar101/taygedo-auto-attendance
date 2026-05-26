import { loadRuntimeConfig } from '../config/runtime.js'
import { AttendanceService } from '../services/attendance-service.js'
import { LoginService } from '../services/login-service.js'
import { createAccountStore, createStateStore } from '../stores/factory.js'
import { TaygedoApi } from '../taygedo/api.js'
import type { LoginActionDependencies } from '../login-action.js'

type ScheduledController = Record<string, unknown>
type ExecutionContext = Record<string, unknown>

interface CloudflareEnv extends Record<string, unknown> {
  KV: {
    get(key: string): Promise<string | null>
    put(key: string, value: string): Promise<void>
  }
  TAYGEDO_TEST_API?: ConstructorParameters<typeof AttendanceService>[0]['api']
  TAYGEDO_TEST_LOGIN_API?: LoginActionDependencies['api']
}

const worker = {
  async scheduled(_event: ScheduledController, env: CloudflareEnv, _ctx: ExecutionContext): Promise<void> {
    await runCloudflareAttendance(env)
  },

  async fetch(request: Request, env: CloudflareEnv, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/') {
      return htmlResponse(renderManagementPage())
    }
    if (url.pathname === '/health') {
      return Response.json({ ok: true })
    }
    if (url.pathname !== '/run' && url.pathname !== '/login') {
      return Response.json({ error: '未找到' }, { status: 404 })
    }

    const config = loadRuntimeConfig(envToStrings(env))
    if (config.adminToken && request.headers.get('Authorization') !== `Bearer ${config.adminToken}`) {
      return Response.json({ error: '未授权' }, { status: 401 })
    }

    try {
      if (url.pathname === '/login') {
        const result = await runCloudflareLogin(request, env)
        return Response.json({ ok: true, ...result })
      }
    }
    catch (error) {
      if (error instanceof HttpError) {
        return Response.json({ error: error.message }, { status: error.status })
      }
      throw error
    }

    if (url.pathname === '/run') {
      const result = await runCloudflareAttendance(env, isForceRunRequest(url))
      return Response.json({ ok: true, summary: result.summary, forceRun: result.forceRun })
    }

    return Response.json({ error: '未找到' }, { status: 404 })
  },
}

export default worker

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function renderManagementPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>塔吉多登录</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f4;
      --panel: #ffffff;
      --ink: #17211b;
      --muted: #647067;
      --line: #d9ded8;
      --accent: #16735f;
      --accent-dark: #0f5b4b;
      --danger: #a43b3b;
      --ok: #1f7a45;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--ink);
      font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(760px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 40px;
    }
    header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }
    h1 { margin: 0; font-size: clamp(24px, 4vw, 34px); letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0; }
    p { margin: 6px 0 0; color: var(--muted); }
    button, input, textarea {
      font: inherit;
      border-radius: 7px;
      border: 1px solid var(--line);
    }
    button {
      min-height: 38px;
      padding: 0 13px;
      border-color: var(--accent);
      background: var(--accent);
      color: white;
      cursor: pointer;
    }
    button.secondary { background: white; color: var(--accent-dark); border-color: var(--line); }
    button:disabled { opacity: .55; cursor: not-allowed; }
    input, select {
      width: 100%;
      background: white;
      color: var(--ink);
      padding: 9px 10px;
    }
    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 13px;
    }
    label span { color: var(--muted); }
    .fields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    section {
      margin-top: 20px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
    }
    .toolbar {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      margin-top: 14px;
    }
    .stack { display: grid; gap: 14px; }
    .result {
      min-height: 54px;
      margin-top: 14px;
      padding: 10px 12px;
      border-radius: 7px;
      background: #f0f4f1;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      color: var(--muted);
    }
    .ok { color: var(--ok); }
    .error { color: var(--danger); }
    .hidden { display: none; }
    @media (max-width: 820px) {
      main { width: min(100% - 20px, 640px); padding-top: 18px; }
      header { align-items: start; flex-direction: column; }
      .fields { grid-template-columns: 1fr; }
      section { padding: 14px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>塔吉多登录</h1>
        <p>Cloudflare Worker 专用登录页，用于把账号写入 KV。</p>
      </div>
    </header>

    <section>
      <form id="login-form" class="stack">
        <div class="fields">
          <label><span>管理员 Token</span><input id="token" type="password" autocomplete="current-password" required></label>
          <label><span>登录模式</span>
            <select id="mode" name="mode">
              <option value="password">账号密码登录</option>
              <option value="send-code">发送短信验证码</option>
              <option value="login">短信验证码登录</option>
            </select>
          </label>
          <label><span>手机号</span><input id="phone" name="phone" inputmode="tel" autocomplete="tel" required></label>
          <label class="password-field"><span>密码</span><input id="password" name="password" type="password" autocomplete="current-password"></label>
          <label class="captcha-field hidden"><span>短信验证码</span><input id="captcha" name="captcha" inputmode="numeric" autocomplete="one-time-code"></label>
          <label><span>账号 ID</span><input id="account-id" name="accountId" value="main"></label>
          <label><span>账号名称</span><input id="account-name" name="accountName" value="主账号"></label>
          <label><span>设备 ID</span><input id="device-id" name="deviceId" placeholder="留空自动生成"></label>
          <label><span>生成新设备</span><input id="new-device" name="newDevice" type="checkbox"></label>
        </div>
        <div class="toolbar">
          <button id="submit" type="submit">提交登录</button>
          <button id="remember" class="secondary" type="button">记住 Token</button>
        </div>
      </form>
      <div id="result" class="result">请选择登录模式后提交。</div>
    </section>
  </main>

  <script>
    const form = document.querySelector('#login-form')
    const modeInput = document.querySelector('#mode')
    const tokenInput = document.querySelector('#token')
    const result = document.querySelector('#result')
    tokenInput.value = localStorage.getItem('taygedoAdminToken') || ''

    function syncMode() {
      const mode = modeInput.value
      document.querySelector('.password-field').classList.toggle('hidden', mode !== 'password')
      document.querySelector('.captcha-field').classList.toggle('hidden', mode !== 'login')
      document.querySelector('#password').required = mode === 'password'
      document.querySelector('#captcha').required = mode === 'login'
    }

    function payloadFromForm() {
      const data = new FormData(form)
      const payload = {
        mode: data.get('mode'),
        phone: String(data.get('phone') || '').trim(),
        accountId: String(data.get('accountId') || 'main').trim() || 'main',
        accountName: String(data.get('accountName') || '').trim() || '主账号',
        deviceId: String(data.get('deviceId') || '').trim() || undefined,
        newDevice: data.get('newDevice') === 'on',
      }
      const password = String(data.get('password') || '')
      const captcha = String(data.get('captcha') || '').trim()
      if (payload.mode === 'password') payload.password = password
      if (payload.mode === 'login') payload.captcha = captcha
      return payload
    }

    async function submitLogin(event) {
      event.preventDefault()
      result.className = 'result'
      result.textContent = '正在提交...'
      const button = document.querySelector('#submit')
      button.disabled = true
      try {
        const response = await fetch('/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: 'Bearer ' + tokenInput.value.trim(),
          },
          body: JSON.stringify(payloadFromForm()),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'HTTP 状态码 ' + response.status)
        result.className = 'result ok'
        result.textContent = modeInput.value === 'send-code'
          ? '验证码已发送，请切换到短信验证码登录。'
          : '登录成功，账号已写入 KV。'
      } catch (error) {
        result.className = 'result error'
        result.textContent = error.message
      } finally {
        button.disabled = false
      }
    }

    document.querySelector('#remember').addEventListener('click', () => {
      localStorage.setItem('taygedoAdminToken', tokenInput.value)
      result.className = 'result ok'
      result.textContent = 'Token 已保存在当前浏览器。'
    })
    modeInput.addEventListener('change', syncMode)
    form.addEventListener('submit', submitLogin)
    syncMode()
  </script>
</body>
</html>`
}

async function runCloudflareAttendance(env: CloudflareEnv, forceRun?: boolean) {
  const config = loadRuntimeConfig(envToStrings(env))
  const service = new AttendanceService({
    accountStore: createAccountStore({ config, kv: env.KV }),
    stateStore: createStateStore({ config, kv: env.KV }),
    api: env.TAYGEDO_TEST_API ?? new TaygedoApi(),
    accountPasswords: config.accountPasswords,
    credentialKey: config.credentialKey,
    notificationUrls: config.notificationUrls,
    maxRetries: config.maxRetries,
    forceRun: forceRun ?? config.forceRun,
    coinTasks: config.coinTasks,
    sharePlatform: config.sharePlatform,
  })
  return await service.run()
}

function isForceRunRequest(url: URL): boolean {
  const value = url.searchParams.get('force')
  return value === '1' || value === 'true'
}

async function runCloudflareLogin(request: Request, env: CloudflareEnv) {
  const config = loadRuntimeConfig(envToStrings(env))
  const body = await readLoginBody(request)
  const mode = body.mode ?? 'password'
  if (mode === 'password' && body.password && !config.credentialKey) {
    throw new HttpError(400, '缺少 TAYGEDO_CREDENTIAL_KEY，请先在 Cloudflare 中添加 Secret。')
  }
  const currentAccounts = await tryReadCloudflareAccounts(env, config.accountsKey, config.accountsSecret)
  const service = new LoginService({ api: env.TAYGEDO_TEST_LOGIN_API ?? new TaygedoApi() })
  await service.runLogin({
    mode,
    phone: body.phone,
    password: body.password,
    captcha: body.captcha,
    deviceId: body.deviceId,
    newDevice: body.newDevice,
    accountId: body.accountId ?? 'main',
    accountName: body.accountName ?? body.accountId ?? '主账号',
    accountsFile: undefined,
    accountsSecret: currentAccounts,
    credentialKey: config.credentialKey,
    writeAccounts: payload => env.KV.put(config.accountsKey, payload),
  })
  return { accountId: body.accountId ?? 'main' }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

interface LoginRequestBody {
  mode?: string
  phone: string
  password?: string
  captcha?: string
  deviceId?: string
  newDevice?: boolean
  accountId?: string
  accountName?: string
}

async function readLoginBody(request: Request): Promise<LoginRequestBody> {
  if (request.method !== 'POST') {
    throw new Error('Cloudflare 登录接口必须使用 POST')
  }
  const body = await request.json() as Partial<LoginRequestBody>
  if (!body.phone) {
    throw new Error('缺少登录手机号')
  }
  return body as LoginRequestBody
}

async function tryReadCloudflareAccounts(env: CloudflareEnv, key: string, fallback?: string): Promise<string | undefined> {
  return await env.KV.get(key) ?? fallback
}

function envToStrings(env: CloudflareEnv): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {
    TAYGEDO_ACCOUNT_STORE: 'cloudflare-kv',
    TAYGEDO_STATE_STORE: 'cloudflare-kv',
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      values[key] = value
    }
  }
  return values
}
