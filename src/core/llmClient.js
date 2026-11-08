/**
 * Language model client
 *
 * The request goes to /api/generate on this app's own server, which attaches
 * the API key. The key is never present in the browser.
 *
 * Transient failures are retried here rather than shown to the reader.

 */

const MAX_ATTEMPTS = 3

/* Upstream conditions worth repeating. 4xx that mean a bad key, an unknown
   model or a malformed request will fail identically every time. */
const RETRYABLE = new Set([429, 500, 502, 503, 504])


const MAX_SUGGESTED_WAIT_S = 10



export function retryDelayMs(attempt, suggestedSeconds = 0, jitter = Math.random()) {
  const backoff = 1000 * 2 ** (attempt - 1)
  return Math.round(Math.max(backoff, suggestedSeconds * 1000) + jitter * 250)
}

export function suggestedWaitSeconds(retryAfterHeader, payload) {
  const header = Number(retryAfterHeader)
  if (Number.isFinite(header) && header > 0) return header

  const detail = payload?.error?.details?.find((d) => d?.retryDelay)?.retryDelay
  const match = /^([\d.]+)s$/.exec(String(detail || ''))
  return match ? Number(match[1]) : 0
}

export function shouldRetry(status, payload) {
  if (!RETRYABLE.has(status)) return false
  if (typeof payload?.error === 'string') return false
  return true
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The reader-facing message for a response that will not be retried. */
function failureFor(status, payload, rawText) {
  const detail = typeof payload?.error === 'string'
    ? payload.error
    : payload?.error?.message || rawText || ''

  if (status === 400 && detail.includes('API key')) {
    return 'The API key was rejected. Check GEMINI_API_KEY on the server.'
  }
  if (status === 404) {
    return 'Model not found. Check GEMINI_MODEL against the current model names in AI Studio.'
  }
  if (status === 429) {
    // Our own limiter writes a usable sentence; a quota refusal does not.
    return typeof payload?.error === 'string'
      ? payload.error
      : 'Rate limit reached. Wait a moment and try again.'
  }
  if (status === 503) return 'The model is busy right now. Try that passage again in a moment.'
  if (status === 504) return 'The model did not answer in time. Try that passage again.'

  return `Request failed (${status}). ${String(detail).slice(0, 200)}`
}

async function generateWithGemini({ prompt, signal }) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,

      maxOutputTokens: 3000,
    },
  })

  let lastFailure = 'Could not reach the model.'

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res
    try {
      res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body,
      })
    } catch (err) {
      // The reader cancelled, or the component went away: not a failure.
      if (err.name === 'AbortError') throw err
      lastFailure = 'Could not reach the model. Is the server running?'
      if (attempt === MAX_ATTEMPTS) break
      await sleep(retryDelayMs(attempt))
      continue
    }

    if (res.ok) {
      const data = await res.json()

      const blocked = data?.promptFeedback?.blockReason
      if (blocked) throw new Error(`The model declined to answer this passage (${blocked}).`)

      const text = data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .filter(Boolean)
        .join('\n')
        .trim()

      if (!text) throw new Error('The model returned an empty response.')
      return text
    }

    const rawText = await res.text().catch(() => '')
    let payload = null
    try {
      payload = JSON.parse(rawText)
    } catch {
      // Not JSON - a proxy error page, most likely. Treated as opaque.
    }

    lastFailure = failureFor(res.status, payload, rawText)

    const wait = suggestedWaitSeconds(res.headers.get('retry-after'), payload)
    const worthRepeating =
      attempt < MAX_ATTEMPTS && shouldRetry(res.status, payload) && wait <= MAX_SUGGESTED_WAIT_S

    if (!worthRepeating) break
    await sleep(retryDelayMs(attempt, wait))
  }

  throw new Error(lastFailure)
}

export const generate = generateWithGemini
