/**
 * The model proxy.
 *
 * The browser posts a request body to /api/generate and the key is attached
 * here, server-side, so it is never in client JavaScript.
 
 *
 * That leaves the real problem: on a public URL this is a billed API key
 * anyone with the link can spend. Two limits bound it instead of a login.
 *
 *   per identity   a signed-in account, or a guest's IP address, gets a
 *                  fixed number of questions a minute. Stops one person,
 *                  or one loop, monopolising the key.
 *   overall        a ceiling on requests per day across everyone. Caps the
 *                  worst case in money rather than in politeness, which is
 *                  what matters if a link is shared further than intended.
 *
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

const PER_MINUTE = Number(process.env.GENERATE_PER_MINUTE || 10)
const PER_DAY = Number(process.env.GENERATE_PER_DAY || 400)
const WINDOW_MS = 60_000
const DAY_MS = 86_400_000

/* Recent request times per caller, in memory. Lost on restart, which is the
   right trade for a single process: the point is to bound spending, not to
   meter usage precisely. */
const recent = new Map()
let dayStarted = Date.now()
let today = 0

function checkRate(who) {
  const now = Date.now()

  if (now - dayStarted > DAY_MS) {
    dayStarted = now
    today = 0
  }
  if (today >= PER_DAY) {
    return { ok: false, status: 503, message: 'This copy has reached its daily limit for questions. Try again tomorrow.' }
  }

  const times = (recent.get(who) || []).filter((t) => now - t < WINDOW_MS)
  if (times.length >= PER_MINUTE) {
    recent.set(who, times)
    const retryAfter = Math.ceil((WINDOW_MS - (now - times[0])) / 1000)
    return {
      ok: false,
      status: 429,
      retryAfter,
      message: `That is more than ${PER_MINUTE} questions a minute. Try again in ${retryAfter}s.`,
    }
  }

  times.push(now)
  recent.set(who, times)
  today += 1
  return { ok: true }
}

// Callers who stopped reading should not be remembered forever.
setInterval(() => {
  const now = Date.now()
  for (const [who, times] of recent) {
    const live = times.filter((t) => now - t < WINDOW_MS)
    if (live.length) recent.set(who, live)
    else recent.delete(who)
  }
}, WINDOW_MS).unref()

export function mountGenerate(app) {
  const key = process.env.GEMINI_API_KEY || ''
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest'

  if (!key) {
    console.warn(
      '[server] GEMINI_API_KEY is not set. Copy .env.example to .env and add ' +
      'your key, or /api/generate will answer 503.'
    )
  }

  app.post('/api/generate', async (req, res) => {
    if (!key) {
      res.status(503).json({ error: 'The server has no API key configured.' })
      return
    }

    // `req.ip` is the forwarded client address, because the app trusts the proxy.
    const who = req.user ? `user:${req.user.id}` : `ip:${req.ip}`
    const rate = checkRate(who)
    if (!rate.ok) {
      if (rate.retryAfter) res.set('Retry-After', String(rate.retryAfter))
      res.status(rate.status).json({ error: rate.message })
      return
    }

    let upstream
    try {
      upstream = await fetch(`${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
        signal: AbortSignal.timeout(60_000),
      })
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
      res.status(504).json({
        error: timedOut ? 'The model did not answer in time.' : 'Could not reach the model.',
      })
      return
    }

    // Passed through as-is: the client already reads Gemini's own status codes
    // and error shapes, and rewriting them here would lose detail it uses.
    const body = await upstream.text()
    res.status(upstream.status).type('application/json').send(body)
  })
}
