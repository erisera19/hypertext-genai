import { useEffect, useRef } from 'react'

/**
 * The margin rail.
 *
 * Every elaboration the reader has asked for, newest first, each still
 * attached to the passage that prompted it. Responses accumulate the way
 * marginalia builds up on a page - and for a signed-in reader they are saved,
 * so reopening the document brings them all back.
 *
 * `focusedId` is set when the reader clicks one of the restored highlights in
 * the document: that note scrolls into view and is briefly marked, which is
 * what connects a mark on the page to the answer it produced.
 *
 * An answer can also be read aloud. Only one note can speak at a time, so
 * `speakingId` is owned by `App` rather than by each note - see the speech
 * client for why that is a property of the browser and not a choice. When the
 * machine has no on-device voice, `canSpeak` is false and the control is
 * omitted entirely rather than shown failing.
 */
export default function ResponseRail({
  items,
  onDismiss,
  focusedId,
  canSpeak = false,
  speakingId = null,
  onSpeak,
  onStopSpeaking,
}) {
  const focusedRef = useRef(null)

  useEffect(() => {
    if (focusedId === null || focusedId === undefined) return
    focusedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusedId])

  if (!items.length) {
    return (
      <aside className="rail rail--empty">
        <p className="rail__hint">
          Select any passage in the document, then choose what you want to know
          about it. Answers appear here.
        </p>
      </aside>
    )
  }

  return (
    <aside className="rail" aria-live="polite">
      {items.map((item) => {
        const focused = item.savedId !== undefined && item.savedId === focusedId
        const speaking = item.id === speakingId
        const speakable = canSpeak && item.status === 'done'
        return (
          <section
            className={`note${focused ? ' note--focused' : ''}`}
            key={item.id}
            ref={focused ? focusedRef : null}
          >
            <header className="note__head">
              <span className="note__op">
                {item.operation.label}
                {item.location && <span className="note__where"> · {item.location}</span>}
              </span>
              <span className="note__tools">
                {speakable && (
                  <button
                    className={`note__speak${speaking ? ' note__speak--on' : ''}`}
                    onClick={() => (speaking ? onStopSpeaking() : onSpeak(item))}
                    aria-label={
                      speaking
                        ? `Stop reading the ${item.operation.label} answer`
                        : `Read the ${item.operation.label} answer aloud`
                    }
                    title={speaking ? 'Stop reading' : 'Read aloud'}
                  >
                    {speaking ? '◼' : '▶'}
                  </button>
                )}
                <button
                  className="note__dismiss"
                  onClick={() => onDismiss(item.id)}
                  aria-label={`Dismiss ${item.operation.label} note`}
                >
                  ×
                </button>
              </span>
            </header>

            <blockquote className="note__quote">{item.selection}</blockquote>

            {item.status === 'pending' && (
              <p className="note__pending">Reading the passage…</p>
            )}

            {item.status === 'error' && (
              <p className="note__error">{item.error}</p>
            )}

            {item.status === 'done' && (
              <div className="note__body">
                {item.response.split('\n').filter(Boolean).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </aside>
  )
}
