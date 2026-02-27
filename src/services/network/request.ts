export type BackoffConfig = {
  retries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  jitterRatio?: number
  retryOnStatuses?: number[]
  timeoutMs?: number
}

const DEFAULT_RETRY_STATUSES = [429, 500, 502, 503, 504]

const sleep = (ms: number) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })

const getRetryAfterMs = (value: string | null): number | undefined => {
  if (!value) {
    return undefined
  }

  const seconds = Number.parseInt(value, 10)
  if (!Number.isNaN(seconds)) {
    return seconds * 1000
  }

  const date = Date.parse(value)
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now())
  }

  return undefined
}

const withTimeout = async (input: RequestInfo, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    })
    return response
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export const fetchWithBackoff = async (
  input: RequestInfo,
  init: RequestInit = {},
  config: BackoffConfig = {}
): Promise<Response> => {
  const {
    retries = 2,
    baseDelayMs = 400,
    maxDelayMs = 4000,
    jitterRatio = 0.2,
    retryOnStatuses = DEFAULT_RETRY_STATUSES,
    timeoutMs = 12000,
  } = config

  let attempt = 0

  while (true) {
    try {
      const response = await withTimeout(input, init, timeoutMs)
      if (!retryOnStatuses.includes(response.status) || attempt >= retries) {
        return response
      }

      const retryAfter = getRetryAfterMs(response.headers.get('Retry-After'))
      const baseDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
      const jitter = baseDelay * jitterRatio * Math.random()
      const delay = retryAfter ?? baseDelay + jitter

      attempt += 1
      await sleep(delay)
      continue
    } catch (error) {
      if (attempt >= retries) {
        throw error
      }

      const baseDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
      const jitter = baseDelay * jitterRatio * Math.random()
      attempt += 1
      await sleep(baseDelay + jitter)
    }
  }
}
