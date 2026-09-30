/**
 * Speech client.
 *
 * The rest of the application calls speak({ text }) and knows nothing about
 * how the audio is produced. 
 *
 * Synthesis happens in the reader's own browser, so voice output costs the
 * server nothing.
 *
 * Only on-device voices are used. A `localService` voice is synthesised by
 * software already installed on the machine, so the answer's text is never
 * transmitted in order to be spoken. 
 */

/* ---------- preparing the text (pure) ---------- */

/**
 * A response as it should be spoken. Responses arrive as paragraphs split by
 * newlines and occasionally carry list markers from the model; read literally
 * those become run-on sentences and spoken asterisks.
 */
export function toSpeechText(response) {
  return String(response || '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*•]\s+/, '').trim())
    .filter(Boolean)
    // A full stop between paragraphs gives the synthesiser a reason to pause.
    .map((line) => (/[.!?:;]$/.test(line) ? line : `${line}.`))
    .join(' ')
}

const MAX_CHUNK = 180

/**
 * Splits speakable text into utterance-sized pieces, breaking at sentence
 * ends where possible.
 *
 * Chrome stops speaking a long utterance after roughly fifteen seconds, and a
 * full answer is minutes of speech, so one utterance per response would be cut
 * off mid-sentence. Queueing several short ones avoids that, and has the side
 * benefit that stopping takes effect at the next chunk rather than running to
 * the end of a paragraph.
 */
export function chunkForSpeech(text, max = MAX_CHUNK) {
  const sentences = String(text || '')
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)

  const chunks = []
  let current = ''

  for (const sentence of sentences) {
    // A sentence longer than the limit goes out on its own rather than being
    // cut mid-clause; the cap is a guide, not a hard truncation.
    if (current && `${current} ${sentence}`.length > max) {
      chunks.push(current)
      current = sentence
    } else {
      current = current ? `${current} ${sentence}` : sentence
    }
  }
  if (current) chunks.push(current)

  return chunks
}

/* ---------- the Web Speech provider ---------- */

const synth = () => (typeof window === 'undefined' ? null : window.speechSynthesis)

/** Voices synthesised on this machine; never the network-backed ones. */
export function localVoices() {
  return (synth()?.getVoices() ?? []).filter((voice) => voice.localService)
}

/**
 * Resolves once the browser has populated its voice list.
 *
 * `getVoices()` returns an empty array on the first call in Chrome and fills
 * in asynchronously, so a availability check made too early would wrongly
 * conclude the machine has no voices. The timeout keeps a browser that never
 * fires the event from leaving this pending forever.
 */
export function whenVoicesReady({ timeout = 2000 } = {}) {
  const speech = synth()
  if (!speech) return Promise.resolve([])
  if (speech.getVoices().length) return Promise.resolve(localVoices())

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      speech.removeEventListener('voiceschanged', done)
      resolve(localVoices())
    }
    const timer = setTimeout(done, timeout)
    speech.addEventListener('voiceschanged', done)
  })
}

/**
 * Which voice to read with: the browser's default when it is on-device,
 * otherwise the first on-device voice matching the page's language, otherwise
 * any on-device voice at all.
 */
function pickVoice() {
  const voices = localVoices()
  if (!voices.length) return null

  const language = (typeof navigator === 'undefined' ? 'en' : navigator.language || 'en')
  return (
    voices.find((voice) => voice.default) ||
    voices.find((voice) => voice.lang?.startsWith(language.slice(0, 2))) ||
    voices[0]
  )
}

/*
 * Every speak() and cancel() takes the next session number. Callbacks from a
 * previous session check it and do nothing, because cancelling fires `onend`
 * on whatever was mid-sentence - without this, starting note B would
 * immediately clear the playing state that note B had just set.
 */
let session = 0

export function cancel() {
  session += 1
  synth()?.cancel()
}

function speakWithWebSpeech({ text, onEnd, onError }) {
  const speech = synth()
  if (!speech) {
    onError?.(new Error('This browser cannot speak text.'))
    return
  }

  const voice = pickVoice()
  if (!voice) {
    onError?.(new Error('No on-device voice is installed on this machine.'))
    return
  }

  cancel()
  const mine = session

  const chunks = chunkForSpeech(toSpeechText(text))
  if (!chunks.length) {
    onEnd?.()
    return
  }

  chunks.forEach((chunk, i) => {
    const utterance = new SpeechSynthesisUtterance(chunk)
    utterance.voice = voice
    utterance.lang = voice.lang

    if (i === chunks.length - 1) {
      utterance.onend = () => {
        if (mine === session) onEnd?.()
      }
    }
    utterance.onerror = (event) => {
      // Cancelling is not a failure - it is how stopping is implemented.
      if (mine !== session || event.error === 'canceled' || event.error === 'interrupted') return
      cancel()
      onError?.(new Error('The voice stopped unexpectedly.'))
    }

    speech.speak(utterance)
  })
}

export const speak = speakWithWebSpeech
