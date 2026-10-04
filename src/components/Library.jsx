/**
 * The shelf a signed-in reader comes back to.
 *
 * Each document is drawn as a cover rather than a row, because a library is
 * recognised by sight before it is read: the reader is usually looking for
 * the paper they were in the middle of.
 * The yellow tabs down the edge of a cover are its saved notes, one each, so
 * a document that has been worked through looks worked through from here.
 */

const KIND = {
  pdf: 'PDF',
  docx: 'Word document',
  txt: 'Plain text',
  md: 'Markdown',
}

const MAX_TABS = 5

function whenReadable(iso) {
  const then = new Date(iso)
  const days = Math.floor((Date.now() - then.getTime()) / 86400000)
  if (days === 0) return 'Opened today'
  if (days === 1) return 'Opened yesterday'
  if (days < 7) return `Opened ${days} days ago`
  if (days < 14) return 'Opened last week'
  if (days < 31) return `Opened ${Math.floor(days / 7)} weeks ago`
  return `Opened ${then.toLocaleDateString()}`
}

export default function Library({ documents, onOpen, onRemove, onAdd, busyHash }) {
  return (
    <ul className="library">
      <li className="library__item">
        <button type="button" className="library__add" onClick={onAdd}>
          <svg
            width="32" height="32" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="library__addTitle">Open a document</span>
          <span className="library__addHint">PDF, Word or plain text</span>
        </button>
      </li>

      {documents.map((doc) => {
        const kind = KIND[doc.format] || doc.format.toUpperCase()
        const notes =
          doc.noteCount === 0
            ? 'no notes yet'
            : `${doc.noteCount} note${doc.noteCount === 1 ? '' : 's'}`

        return (
          <li className="library__item" key={doc.hash}>
            <button
              type="button"
              className="library__open"
              onClick={() => onOpen(doc)}
              disabled={busyHash === doc.hash}
            >
              <span className="library__cover">
                <span className="library__coverKind">{kind}</span>
                <span className="library__coverTitle">{doc.title}</span>
                <span className="library__coverRule" />
                <span className="library__coverFoot">
                  {busyHash === doc.hash ? 'Opening…' : notes}
                </span>
                {Array.from({ length: Math.min(doc.noteCount, MAX_TABS) }, (_, i) => (
                  <span className="library__tab" key={i} style={{ top: `${56 + i * 28}px` }} />
                ))}
              </span>

              <span className="library__meta">
                <span className="library__name">{doc.title}</span>
                <span className="library__sub">{kind}, {notes}</span>
                <span className="library__when">{whenReadable(doc.lastOpenedAt)}</span>
              </span>
            </button>

            <button
              type="button"
              className="library__remove"
              onClick={() => onRemove(doc)}
              aria-label={`Remove ${doc.title} and its notes`}
              title="Remove this document and its notes"
            >
              ×
            </button>
          </li>
        )
      })}
    </ul>
  )
}
