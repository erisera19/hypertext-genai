/**
 * Language model client.
 *
 * The rest of the application calls generate({ prompt }) and knows nothing
 * about which provider is behind it. Swapping Gemini for another provider
 * means writing one more function in this file and changing the export -
 * nothing else in the codebase changes.
 *
 * The request goes to /api/generate on this app's own server, which attaches
 * the API key. The key is never present in the browser.
 *
 * Transient failures are retried here rather than shown to the reader.
 * Gemini answers 503 "this model is currently experiencing high demand"
 * often enough that without this, a reader asking a question has a real
 * chance of getting a red error instead of an answer - two of three
 * requests failed that way in one measured run. Those are exactly the
 * conditions the provider expects a client to wait and repeat.
 */

const MAX_ATTEMPTS = 3

/* Upstream conditions worth repeating. 4xx that mean a bad key, an unknown
   model or a malformed request will fail identically every time. */
const RETRYABLE = new Set([429, 500, 502, 503, 504])

/* A wait longer than this is not a blip, it is a quota. Sitting silently for
   half a minute is worse for the reader than being told to try later. */
const MAX_SUGGESTED_WAIT_S = 10

/**
 * How long to wait before an attempt, in milliseconds.
 *
 * Exponential, but never shorter than a delay the provider itself asked for -
 * Gemini returns one on a quota refusal and it knows better than we do. The
 * jitter is injectable so this stays a pure function.
 */
export function retryDelayMs(attempt, suggestedSeconds = 0, jitter = Math.random()) {
  const backoff = 1000 * 2 ** (attempt - 1)
  return Math.round(Math.max(backoff, suggestedSeconds * 1000) + jitter * 250)
}

/**
 * A delay the provider asked for, in seconds, or 0 if it did not.
 *
 * Gemini puts one in a `RetryInfo` detail ("22.978635924s"); an HTTP
 * `Retry-After` header takes precedence when both are present.
 */
export function suggestedWaitSeconds(retryAfterHeader, payload) {
  const header = Number(retryAfterHeader)
  if (Number.isFinite(header) && header > 0) return header

  const detail = payload?.error?.details?.find((d) => d?.retryDelay)?.retryDelay
  const match = /^([\d.]+)s$/.exec(String(detail || ''))
  return match ? Number(match[1]) : 0
}

/**
 * Whether a failed response should be tried again.
 *
 * Our own server reports problems as `{ error: "a sentence" }` and Gemini as
 * `{ error: { code, message, status } }`. That difference is the test: a 429
 * from our rate limiter is a deliberate "you are going too fast" and repeating
 * it silently would hide the signal, while a 429 from Gemini is a quota that
 * clears on its own.
 */
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
      /*
       * Deliberately far above what an answer needs. The model reasons
       * before it writes, and those thinking tokens are charged against
       * this same budget - at 800 a short elaboration spent 764 of them
       * reasoning and had 32 left, so the answer arrived cut off
       * mid-sentence. The reasoning is worth keeping: with it the model
       * draws on the surrounding context rather than on general
       * knowledge. So the cap only has to be high enough that it never
       * binds; it is not a target length, and the prompt asks for
       * brevity separately.
       */
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
