export interface NotificationPayload {
  urls: string[]
  title: string
  content: string
  fetch?: typeof fetch
}

export interface NotificationSendError {
  url: string
  error: string
}

export async function sendNotification(payload: NotificationPayload): Promise<NotificationSendError[]> {
  const fetchImpl = payload.fetch ?? fetch
  const errors: NotificationSendError[] = []
  for (const url of payload.urls) {
    try {
      if (isServerChanUrl(url)) {
        await assertNotificationResponse(fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          },
          body: new URLSearchParams({
            title: payload.title,
            desp: payload.content,
          }).toString(),
        }))
        continue
      }

      await assertNotificationResponse(fetchImpl(url, createJsonRequest(payload)))
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`通知发送失败：${url}，原因：${message}`)
      errors.push({ url, error: message })
    }
  }
  return errors
}

async function assertNotificationResponse(responsePromise: Promise<Response>): Promise<void> {
  const response = await responsePromise
  if (!response.ok) {
    throw new Error(`HTTP 状态码 ${response.status}`)
  }
}

function isServerChanUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.hostname === 'sctapi.ftqq.com' && parsedUrl.pathname.endsWith('.send')
  }
  catch {
    return false
  }
}

function createJsonRequest(payload: NotificationPayload): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: payload.title,
      content: payload.content,
    }),
  }
}
