/**
 * The margin rail.
 *
 * Every elaboration the reader has asked for, newest first, each still
 * attached to the passage that prompted it. Responses accumulate over a
 * session so the reader can look back at what they have already worked
 * through, the way marginalia builds up on a page.
 *
 * Note: this rail holds the current session only. Keeping annotations
 * across sessions is a separate piece of work.
 */
export default function ResponseRail({ items, onDismiss }) {
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
      {items.map((item) => (
        <section className="note" key={item.id}>
          <header className="note__head">
            <span className="note__op">{item.operation.label}</span>
            <button
              className="note__dismiss"
              onClick={() => onDismiss(item.id)}
              aria-label={`Dismiss ${item.operation.label} note`}
            >
              ×
            </button>
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
      ))}
    </aside>
  )
}
