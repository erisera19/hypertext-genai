import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * The margin rail.
 *
 * A saved answer belongs to the passage that produced it, so the passage is
 * how you get back to it: reopening a document marks the page but leaves the
 * rail quiet, and clicking a mark unfolds that answer. Listing every answer
 * on open made the rail a sidebar of results; this way the highlight is the
 * link, and following it is what retrieves the elaboration.
 *
 * Which section a note sits in is decided when the document opens and never
 * changes: answers asked for in this sitting stay at the top, and everything
 * restored waits under "Previous notes". A note that moved between sections
 * as you folded it would be impossible to keep track of.
 *
 * Folding is therefore the only thing the chevron changes, and it works the
 * same in both sections - which the earlier hide button did not, since a note
 * in "Previous notes" was already hidden and clicking it did nothing.
 *
 * Deleting is separate and deliberately unlike it: folding is reversible and
 * gets a chevron, deleting is not and gets the word.
 */

/** How many lines of the passage show before it is cut off. */
const QUOTE_LINES = { folded: 2, open: 3 }

function Note({ item, focused, innerRef, onToggle, onDismiss }) {
  const open = !!item.expanded
  const working = item.status !== 'done'

  /*
   * A long selection would otherwise fill the rail and push its own answer
   * off the bottom, so the passage is clamped and opens on request. Measured
   * rather than guessed from length: whether three lines is enough depends on
   * the rail's width and the words themselves.
   */
  const [showAll, setShowAll] = useState(false)
  const [clipped, setClipped] = useState(false)
  const quoteRef = useRef(null)

  useLayoutEffect(() => {
    const el = quoteRef.current
    if (!el || showAll) return
    setClipped(el.scrollHeight > el.clientHeight + 1)
  }, [item.selection, open, showAll])

  return (
    <section
      className={`note${focused ? ' note--focused' : ''}${open ? '' : ' note--folded'}`}
      ref={innerRef}
    >
      <blockquote
        className={`note__quote${showAll ? ' note__quote--full' : ''}`}
        ref={quoteRef}
        style={{ WebkitLineClamp: showAll ? 'unset' : QUOTE_LINES[open ? 'open' : 'folded'] }}
      >
        <mark>{item.selection}</mark>
      </blockquote>

      {/* Only offered on an open note: folded, the two lines are a label, not
          something anyone is trying to read. */}
      {open && (clipped || showAll) && (
        <button
          className="note__more"
          onClick={() => setShowAll((on) => !on)}
          aria-expanded={showAll}
        >
          {showAll ? 'Show less' : 'Show more'}
        </button>
      )}

      {/*
        The operation line is the fold control. Pending and failed answers
        have nothing to fold away, so they stay open and lose the affordance.
      */}
      <button
        className="note__toggle"
        onClick={() => onToggle(item.id)}
        aria-expanded={open}
        disabled={working}
      >
        <span className="note__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="note__op">
          {item.operation.label}
          {item.location && <span className="note__where"> · {item.location}</span>}
        </span>
      </button>

      {item.status === 'pending' && <p className="note__pending">Writing an answer…</p>}
      {item.status === 'error' && <p className="note__error">{item.error}</p>}

      {item.status === 'done' && open && (
        <>
          <div className="note__body">
            {item.response.split('\n').filter(Boolean).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
          <button
            className="note__delete"
            onClick={() => onDismiss(item.id)}
            title="Delete this note permanently"
          >
            Delete note
          </button>
        </>
      )}
    </section>
  )
}

export default function ResponseRail({
  items,
  onDismiss,
  onToggle,
  focusedId,
  signedIn = false,
  onSignIn,
}) {
  const focusedRef = useRef(null)
  const [showPrevious, setShowPrevious] = useState(false)

  const current = items.filter((it) => !it.previous)
  const previous = items.filter((it) => it.previous)

  // Following a mark into a note that is filed away opens the drawer first,
  // or the note would unfold out of sight.
  const focusedIsPrevious =
    focusedId !== null &&
    focusedId !== undefined &&
    previous.some((it) => it.savedId === focusedId)

  useEffect(() => {
    if (focusedIsPrevious) setShowPrevious(true)
  }, [focusedIsPrevious, focusedId])

  useEffect(() => {
    if (focusedId === null || focusedId === undefined) return
    focusedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusedId, showPrevious])

  const render = (item) => {
    const focused = item.savedId !== undefined && item.savedId === focusedId
    return (
      <Note
        key={item.id}
        item={item}
        focused={focused}
        innerRef={focused ? focusedRef : null}
        onToggle={onToggle}
        onDismiss={onDismiss}
      />
    )
  }

  const footer = signedIn ? (
    <p className="rail__foot">
      Your highlights and answers are saved, so this document comes back marked
      up the way you left it. Answers are generated by a language model and can
      be wrong.
    </p>
  ) : (
    <p className="rail__foot">
      Notes disappear when you close this tab.{' '}
      <button className="link" onClick={onSignIn}>Sign in</button> and this
      document joins your library with its notes attached. Answers are generated
      by a language model and can be wrong.
    </p>
  )

  return (
    <aside className="rail" aria-label="Notes" aria-live="polite">
      <h2 className="rail__title">Notes</h2>

      {!current.length && (
        <p className="rail__hint">
          {previous.length > 0
            ? 'Click a highlighted passage to open the answer it produced, or unfold one below.'
            : 'Select any passage in the document, then choose what you want to know about it. Answers appear here.'}
        </p>
      )}

      {current.map(render)}

      {previous.length > 0 && (
        <div className="rail__previous">
          <button
            className="rail__disclose"
            onClick={() => setShowPrevious((on) => !on)}
            aria-expanded={showPrevious}
          >
            <span className="rail__chevron" aria-hidden="true">{showPrevious ? '▾' : '▸'}</span>
            Previous notes ({previous.length})
          </button>
          {showPrevious && <div className="rail__previousList">{previous.map(render)}</div>}
        </div>
      )}

      {footer}
    </aside>
  )
}
