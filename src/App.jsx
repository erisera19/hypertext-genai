import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadDocument, loadFromBytes, ACCEPTED } from './adapters'
import { buildPrompt } from './core/promptBuilder'
import { generate } from './core/llmClient'
import { getOperation } from './core/operations'
import {
  NotSignedIn,
  currentUser,
  logout,
  fetchLibrary,
  removeFromLibrary,
  uploadDocument,
  openStoredDocument,
  fetchDocumentBytes,
  saveAnnotation,
  deleteSavedAnnotation,
} from './core/api'
import Reader from './components/Reader'
import PdfReader from './components/PdfReader'
import SelectionMenu from './components/SelectionMenu'
import ResponseRail from './components/ResponseRail'
import AuthPanel from './components/AuthPanel'
import Library from './components/Library'

let nextId = 1

/**
 * A saved row from the server, as a rail item.
 *
 * Restored folded shut (`expanded: false`) and filed under "Previous notes":
 * its mark goes back on the page, but the answer waits until the reader
 * clicks the passage that produced it, or unfolds it from the list.
 *
 * Notes outlive edits to the operations menu: an id that is no longer in it
 * falls back to showing itself as the label, so a renamed or retired
 * operation loses its heading rather than the answer underneath it.
 */
function restoredItem(row) {
  return {
    id: nextId++,
    savedId: row.id,
    operation: getOperation(row.operationId) || { id: row.operationId, label: row.operationId },
    selection: row.selection,
    location: row.location,
    anchor: row.anchor,
    status: 'done',
    response: row.response,
    error: null,
    expanded: false,
    // Which half of the rail it belongs to. Fixed when the document opens, so
    // a note never jumps between sections under the reader.
    previous: true,
  }
}

export default function App() {
  const [user, setUser] = useState(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [library, setLibrary] = useState([])
  const [openingHash, setOpeningHash] = useState(null)

  const [doc, setDoc] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selection, setSelection] = useState(null)
  const [items, setItems] = useState([])
  const [notice, setNotice] = useState(null)
  const [focusedAnnotationId, setFocusedAnnotationId] = useState(null)
  const [query, setQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [accountOpen, setAccountOpen] = useState(false)
  const fileInput = useRef(null)
  const accountRef = useRef(null)

  const signedIn = !!user

  const refreshLibrary = useCallback(async () => {
    try {
      setLibrary(await fetchLibrary())
    } catch {
      setLibrary([])
    }
  }, [])

  /** A session can expire while the app is open; drop to guest rather than break. */
  const handleApiError = useCallback((err) => {
    if (err instanceof NotSignedIn) {
      setUser(null)
      setLibrary([])
      setNotice('Your session expired. Sign in again to keep saving notes.')
      return true
    }
    return false
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const existing = await currentUser()
        if (existing) {
          setUser(existing)
          setLibrary(await fetchLibrary())
        }
      } catch {
        // Server not running: the reader still works, just without an account.
      }
    })()
  }, [])

  // The account menu closes on a click anywhere else, as a menu should.
  useEffect(() => {
    if (!accountOpen) return
    const close = (e) => {
      if (!accountRef.current?.contains(e.target)) setAccountOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [accountOpen])

  /* ---------- opening documents ---------- */

  async function openFile(file) {
    if (!file) return
    setLoading(true)
    setLoadError(null)
    setSelection(null)
    setNotice(null)
    setFocusedAnnotationId(null)
    setCurrentPage(1)

    try {
      const { document: loaded, arrayBuffer } = await loadDocument(file)

      // A guest reads the same way; there is just nowhere to keep the notes.
      if (!signedIn) {
        setDoc(loaded)
        setItems([])
        return
      }

      try {
        const { document: stored, annotations } = await uploadDocument({
          arrayBuffer,
          title: loaded.title,
          format: loaded.format,
        })
        setDoc({ ...loaded, hash: stored.hash })
        setItems(annotations.map(restoredItem))
        if (annotations.length) {
          setNotice(
            `Restored ${annotations.length} note${annotations.length === 1 ? '' : 's'} from the last time you read this.`
          )
        }
        refreshLibrary()
      } catch (err) {
        if (!handleApiError(err)) setNotice(`Opened without saving: ${err.message}`)
        setDoc(loaded)
        setItems([])
      }
    } catch (err) {
      setLoadError(err.message)
      setDoc(null)
    } finally {
      setLoading(false)
    }
  }

  async function openFromLibrary(entry) {
    setOpeningHash(entry.hash)
    setLoadError(null)
    setSelection(null)
    setNotice(null)
    setFocusedAnnotationId(null)
    setCurrentPage(1)

    try {
      const [arrayBuffer, { annotations }] = await Promise.all([
        fetchDocumentBytes(entry.hash),
        openStoredDocument(entry.hash),
      ])
      const loaded = await loadFromBytes({
        arrayBuffer,
        title: entry.title,
        format: entry.format,
      })

      setDoc({ ...loaded, hash: entry.hash })
      setItems(annotations.map(restoredItem))
      refreshLibrary()
    } catch (err) {
      if (!handleApiError(err)) setLoadError(err.message)
    } finally {
      setOpeningHash(null)
    }
  }

  async function removeDocument(entry) {
    try {
      await removeFromLibrary(entry.hash)
      if (doc?.hash === entry.hash) {
        setDoc(null)
        setItems([])
      }
      refreshLibrary()
    } catch (err) {
      if (!handleApiError(err)) setNotice(err.message)
    }
  }

  function closeDocument() {
    setDoc(null)
    setItems([])
    setSelection(null)
    setNotice(null)
    setFocusedAnnotationId(null)
    setCurrentPage(1)
  }

  /* ---------- accounts ---------- */

  function handleSignedIn(signedInUser) {
    setUser(signedInUser)
    setAuthOpen(false)
    refreshLibrary()
    if (doc) {
      setNotice('Signed in. Open this document again to start saving notes on it.')
    }
  }

  async function handleSignOut() {
    try {
      await logout()
    } catch {
      // Already gone server-side; the local state below is what matters.
    }
    setUser(null)
    setLibrary([])
    // Saved marks and their ids belong to the account, not the browser.
    setItems((prev) => prev.map(({ savedId, anchor, ...rest }) => rest))
    setNotice('Signed out. Notes from here on are not saved.')
  }

  /* ---------- operations ---------- */

  const clearSelection = useCallback(() => setSelection(null), [])

  async function runOperation(operation) {
    if (!selection || !doc) return

    const id = nextId++
    const snapshot = selection
    setItems((prev) => [
      {
        id,
        operation,
        selection: snapshot.text,
        location: snapshot.location || null,
        anchor: snapshot.anchor || null,
        status: 'pending',
        response: '',
        error: null,
        // Asked for just now, so it arrives open.
        expanded: true,
      },
      ...prev,
    ])
    setSelection(null)
    window.getSelection()?.removeAllRanges()

    const prompt = buildPrompt({
      operation,
      selection: snapshot.text,
      context: snapshot.context,
      document: doc,
    })

    try {
      const response = await generate({ prompt })
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, status: 'done', response } : it))
      )

      if (!signedIn || !doc.hash) return

      try {
        const saved = await saveAnnotation({
          documentHash: doc.hash,
          operationId: operation.id,
          selection: snapshot.text,
          location: snapshot.location || null,
          response,
          anchor: snapshot.anchor || null,
        })
        // Gaining a savedId is what puts the mark on the page, so the
        // highlight appears as soon as the note is stored.
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, savedId: saved.id } : it)))
        refreshLibrary()
      } catch (err) {
        if (!handleApiError(err)) setNotice(`That answer was not saved: ${err.message}`)
      }
    } catch (err) {
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, status: 'error', error: err.message } : it))
      )
    }
  }

  function dismiss(id) {
    const item = items.find((it) => it.id === id)
    setItems((prev) => prev.filter((it) => it.id !== id))
    if (item?.savedId) {
      deleteSavedAnnotation(item.savedId).catch((err) => {
        if (!handleApiError(err)) setNotice(`Could not delete that note: ${err.message}`)
      })
    }
  }

  // Only stored notes can be drawn on the page - an id is what a mark points at.
  const savedAnnotations = useMemo(
    () =>
      items
        .filter((it) => it.savedId !== undefined && it.anchor)
        .map((it) => ({ id: it.savedId, anchor: it.anchor })),
    [items]
  )

  /** Following a mark on the page unfolds the answer it produced. */
  const revealAnnotation = useCallback((annotationId) => {
    setItems((prev) =>
      prev.map((it) => (it.savedId === annotationId ? { ...it, expanded: true } : it))
    )
    setFocusedAnnotationId(annotationId)
  }, [])

  /*
   * Folding a note shut is not deleting it: the answer stays, the mark stays
   * on the page, and either the chevron or the passage opens it again. The
   * focus is dropped as well, so clicking the same highlight afterwards still
   * scrolls to it rather than being a no-op.
   */
  const toggleNote = useCallback(
    (id) => {
      const item = items.find((it) => it.id === id)
      if (item?.expanded && item.savedId !== undefined && item.savedId === focusedAnnotationId) {
        setFocusedAnnotationId(null)
      }
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, expanded: !it.expanded } : it))
      )
    },
    [items, focusedAnnotationId]
  )

  const openPicker = useCallback(() => fileInput.current?.click(), [])

  const shelf = useMemo(() => {
    const term = query.trim().toLowerCase()
    return term ? library.filter((d) => d.title.toLowerCase().includes(term)) : library
  }, [library, query])

  const totalNotes = useMemo(
    () => library.reduce((sum, d) => sum + d.noteCount, 0),
    [library]
  )

  const picker = (
    <input
      ref={fileInput}
      type="file"
      accept={ACCEPTED}
      hidden
      onChange={(e) => {
        openFile(e.target.files?.[0])
        e.target.value = ''
      }}
    />
  )

  const account = signedIn && (
    <div className="account" ref={accountRef}>
      <span className="account__email" title={user.email}>{user.email}</span>
      <button
        className="account__avatar"
        onClick={() => setAccountOpen((open) => !open)}
        aria-label="Account menu"
        aria-expanded={accountOpen}
      >
        {user.email.slice(0, 1)}
      </button>
      {accountOpen && (
        <div className="account__menu" role="menu">
          <button className="account__item" role="menuitem" onClick={() => { setAccountOpen(false); closeDocument() }}>
            Your library
          </button>
          <button className="account__item" role="menuitem" onClick={() => { setAccountOpen(false); handleSignOut() }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )

  /* ---------- reading ---------- */

  if (doc) {
    return (
      <div className="app app--reading">
        <nav className="bar bar--reading">
          <div className="bar__left">
            <button className="bar__mark" onClick={closeDocument}>Hypertext with GenAI</button>
            <span className="bar__divider" />
            <span className="bar__file" title={doc.title}>{doc.title}</span>
            {doc.kind === 'pdf' && (
              <span className="bar__status">Page {currentPage} of {doc.pdf.numPages}</span>
            )}
          </div>

          <div className="bar__actions">
            {!signedIn && (
              <span className="bar__status">
                Guest: {items.length} note{items.length === 1 ? '' : 's'}, not saved
              </span>
            )}
            {signedIn && (
              <button className="btn btn--quiet" onClick={closeDocument}>Library</button>
            )}
            <button className="btn btn--quiet" onClick={openPicker}>Open another</button>
            {signedIn
              ? account
              : <button className="btn" onClick={() => setAuthOpen(true)}>Sign in to keep notes</button>}
          </div>
          {picker}
        </nav>

        {notice && (
          <p className="notice">
            {notice}
            <button className="notice__close" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
          </p>
        )}

        <div className="reading">
          {doc.kind === 'pdf' ? (
            <PdfReader
              document={doc}
              onSelect={setSelection}
              onClearSelection={clearSelection}
              savedAnnotations={savedAnnotations}
              onRevealAnnotation={revealAnnotation}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
            />
          ) : (
            <Reader
              document={doc}
              onSelect={setSelection}
              onClearSelection={clearSelection}
              savedAnnotations={savedAnnotations}
              onRevealAnnotation={revealAnnotation}
            />
          )}
          <ResponseRail
            items={items}
            onDismiss={dismiss}
            onToggle={toggleNote}
            focusedId={focusedAnnotationId}
            signedIn={signedIn}
            onSignIn={() => setAuthOpen(true)}
          />
        </div>

        <SelectionMenu selection={selection} onRun={runOperation} />
        {authOpen && <AuthPanel onClose={() => setAuthOpen(false)} onSignedIn={handleSignedIn} />}
      </div>
    )
  }

  /* ---------- the library, for a reader with an account ---------- */

  if (signedIn) {
    return (
      <div className="app">
        <nav className="bar">
          <button className="bar__mark" onClick={closeDocument}>Hypertext with GenAI</button>
          <div className="bar__actions">{account}</div>
          {picker}
        </nav>

        {notice && (
          <p className="notice">
            {notice}
            <button className="notice__close" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
          </p>
        )}

        <main className="main library-view">
          <div className="library__head">
            <div>
              <h1 className="library__title">Your library</h1>
              <p className="library__count">
                {library.length === 0
                  ? 'Nothing here yet'
                  : `${library.length} document${library.length === 1 ? '' : 's'} with ${totalNotes} note${totalNotes === 1 ? '' : 's'} between them`}
              </p>
            </div>
            <div className="library__tools">
              <label className="library__search">
                Search titles
                <input
                  type="search"
                  value={query}
                  placeholder="e.g. retrieval, ethics"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <button className="btn" onClick={openPicker} disabled={loading}>
                {loading ? 'Opening…' : 'Open a document'}
              </button>
            </div>
          </div>

          {loadError && <p className="landing__error">{loadError}</p>}

          <Library
            documents={shelf}
            onOpen={openFromLibrary}
            onRemove={removeDocument}
            onAdd={openPicker}
            busyHash={openingHash}
          />

          {query && !shelf.length && (
            <p className="library__empty">No document in your library matches “{query}”.</p>
          )}
        </main>

        {authOpen && <AuthPanel onClose={() => setAuthOpen(false)} onSignedIn={handleSignedIn} />}
      </div>
    )
  }

  /* ---------- the landing page, for a guest ---------- */

  return (
    <div className="app">
      <nav className="bar">
        <button className="bar__mark" onClick={closeDocument}>Hypertext with GenAI</button>
        <div className="bar__actions">
          <span className="bar__status">Reading as a guest</span>
          <button className="btn btn--outline" onClick={() => setAuthOpen(true)}>Sign in</button>
        </div>
        {picker}
      </nav>

      {notice && (
        <p className="notice">
          {notice}
          <button className="notice__close" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </p>
      )}

      <main className="main landing">
        <section>
          <h1 className="landing__title">Ask a document what it means.</h1>
          <p className="landing__lede">
            Open a paper, report or chapter. Highlight any passage, then choose what
            you want to know: what it means, what it takes for granted, or how
            someone could argue it differently.
          </p>

          <div className="landing__drop">
            <div className="landing__dropTitle">Open a document to start reading</div>
            <div className="landing__formats">PDF, Word (.docx) or plain text</div>
            <button className="btn btn--lg" onClick={openPicker} disabled={loading}>
              {loading ? 'Opening…' : 'Choose a file'}
            </button>
          </div>

          {loadError && <p className="landing__error">{loadError}</p>}

          <p className="landing__foot">
            No account needed. As a guest, your highlights and answers last until you
            close the tab.{' '}
            <button className="link" onClick={() => setAuthOpen(true)}>Sign in</button>{' '}
            to keep them in your library.
          </p>
        </section>

        {/* A still of the tool in use, rather than a list of features. */}
        <section className="demo" aria-hidden="true">
          <div className="demo__page">
            <div className="demo__label">4.2 Reading medium and recall</div>
            <p>
              Participants who read the article on a screen were, on average, less able
              to reconstruct the order of its argument a day later.{' '}
              <span className="demo__mark">
                The gap closed almost entirely when screen readers were asked to write
                short notes in the margin as they went
              </span>
              , which suggests the medium matters less than what readers do with it.
            </p>
            <p>
              We treat recall of structure, rather than recall of detail, as the more
              useful measure, since it is what a reader needs in order to disagree with
              a text.
            </p>
            <p>Two limitations follow from the design of the study. The sample was drawn from a single</p>
          </div>

          <div className="demo__menu">
            <div className="demo__item">Explain</div>
            <div className="demo__item demo__item--on">Assumptions</div>
            <div className="demo__item">Compare views</div>
            <div className="demo__item">Give an example</div>
          </div>

          <div className="demo__note">
            <div className="demo__noteOp">Assumptions</div>
            <p className="demo__noteBody">
              That margin notes caused the gap to close. Readers who agree to annotate
              may already read more carefully, so the study shows an association, not a
              cause.
            </p>
          </div>
        </section>
      </main>

      <SelectionMenu selection={selection} onRun={runOperation} />
      {authOpen && <AuthPanel onClose={() => setAuthOpen(false)} onSignedIn={handleSignedIn} />}
    </div>
  )
}
