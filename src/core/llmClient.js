/**
 * Language model client.
 *
 * The rest of the application calls generate({ prompt }) and knows nothing
 * about which provider is behind it. Swapping Gemini for another provider
 * means writing one more function in this file and changing the export -
 * nothing else in the codebase changes.
 *
 * The request goes to /api/generate, which the Vite dev server proxies to
 * Gemini with the API key attached server-side. The key is never present
 * in the browser.
 */

async function generateWithGemini({ prompt, signal }) {
  let res
  try {
    res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 800,
        },
      }),
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error('Could not reach the model. Is the dev server running?')
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    if (res.status === 400 && detail.includes('API key')) {
      throw new Error('The API key was rejected. Check GEMINI_API_KEY in your .env file.')
    }
    if (res.status === 429) {
      throw new Error('Rate limit reached on the free tier. Wait a moment and try again.')
    }
    if (res.status === 404) {
      throw new Error(
        'Model not found. Check GEMINI_MODEL in .env against the current model names in AI Studio.'
      )
    }
    throw new Error(`Request failed (${res.status}). ${detail.slice(0, 200)}`)
  }

  const data = await res.json()

  const blocked = data?.promptFeedback?.blockReason
  if (blocked) {
    throw new Error(`The model declined to answer this passage (${blocked}).`)
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join('\n')
    .trim()

  if (!text) throw new Error('The model returned an empty response.')
  return text
}

export const generate = generateWithGemini
