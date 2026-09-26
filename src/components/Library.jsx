/**
 * Recently opened documents.
 *
 * The shelf a signed-in reader comes back to. Each entry reopens the stored
 * file and restores the notes made on it, so returning to a paper is picking
 * up a marked-up copy rather than starting over.
 */

function whenReadable(iso) {
  const then = new Date(iso)
  const days = Math.floor((Date.now() - then.getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return then.toLocaleDateString()
}

export default function Library({ documents, onOpen, onRemove, busyHash }) {
  if (!documents.length) {
    return (
      <p className="library__empty">
        Nothing here yet. Open a document and the highlights you make on it will
        be waiting the next time you come back.
      </p>
    )
  }

  return (
    <ul className="library">
      {documents.map((doc) => (
        <li className="library__item" key={doc.hash}>
          <button
            className="library__open"
            onClick={() => onOpen(doc)}
            disabled={busyHash === doc.hash}
          >
            <span className="library__title">{doc.title}</span>
            <span className="library__meta">
              {doc.format.toUpperCase()}
              {' · '}
              {doc.noteCount} {doc.noteCount === 1 ? 'note' : 'notes'}
              {' · '}
              opened {whenReadable(doc.lastOpenedAt)}
              {busyHash === doc.hash && ' · opening…'}
            </span>
          </button>
          <button
            className="library__remove"
            onClick={() => onRemove(doc)}
            aria-label={`Remove ${doc.title} and its notes`}
            title="Remove this document and its notes"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}
