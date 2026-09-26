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
  const fileInput = useRef(null)

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

  /* ---------- opening documents ---------- */

  async function openFile(file) {
    if (!file) return
    setLoading(true)
    setLoadError(null)
    setSelection(null)
    setNotice(null)
    setFocusedAnnotationId(null)

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

  const revealAnnotation = useCallback((annotationId) => {
    setFocusedAnnotationId(annotationId)
  }, [])

  return (
    <div className="app">
      <nav className="bar">
        <button className="bar__mark" onClick={closeDocument}>Reader</button>

        <div className="bar__actions">
          {doc && <span className="bar__file">{doc.title}</span>}
          {doc && (
            <button className="btn btn--quiet" onClick={closeDocument}>
              {signedIn ? 'Library' : 'Close'}
            </button>
          )}
          <button className="btn" onClick={() => fileInput.current?.click()}>
            {doc ? 'Open another' : 'Open a document'}
          </button>
          {signedIn ? (
            <>
              <span className="bar__user" title={user.email}>{user.email}</span>
              <button className="btn btn--quiet" onClick={handleSignOut}>Sign out</button>
            </>
          ) : (
            <button className="btn btn--quiet" onClick={() => setAuthOpen(true)}>Sign in</button>
          )}
        </div>

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
      </nav>

      {notice && (
        <p className="notice">
          {notice}
          <button className="notice__close" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      )}

      <main className="main">
        {!doc && (
          <div className="start">
            <h1 className="start__title">Read with questions</h1>
            <p className="start__lede">
              Open a paper, report, or any dense piece of writing. Select any passage
              and ask what you actually want to know about it — what it means, what it
              assumes, how it could be argued differently.
            </p>
            <button
              className="btn btn--lg"
              onClick={() => fileInput.current?.click()}
              disabled={loading}
            >
              {loading ? 'Opening…' : 'Open a document'}
            </button>
            <p className="start__formats">PDF, DOCX, or plain text</p>
            {loadError && <p className="start__error">{loadError}</p>}

            <section className="start__library">
              <h2 className="start__shelf">Recently opened</h2>
              {signedIn ? (
                <Library
                  documents={library}
                  onOpen={openFromLibrary}
                  onRemove={removeDocument}
                  busyHash={openingHash}
                />
              ) : (
                <p className="library__empty">
                  <button className="link" onClick={() => setAuthOpen(true)}>Sign in</button>{' '}
                  to keep your documents here, with the passages you highlighted and the
                  answers you were given.
                </p>
              )}
            </section>
          </div>
        )}

        {doc && (
          <div className={`workspace${doc.kind === 'pdf' ? ' workspace--pdf' : ''}`}>
            {doc.kind === 'pdf' ? (
              <PdfReader
                document={doc}
                onSelect={setSelection}
                onClearSelection={clearSelection}
                savedAnnotations={savedAnnotations}
                onRevealAnnotation={revealAnnotation}
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
            <ResponseRail items={items} onDismiss={dismiss} focusedId={focusedAnnotationId} />
          </div>
        )}
      </main>

      <SelectionMenu selection={selection} onRun={runOperation} />

      {authOpen && <AuthPanel onClose={() => setAuthOpen(false)} onSignedIn={handleSignedIn} />}

      {doc && (
        <p className="disclaimer">
          Answers are generated by a language model and can be wrong. Check anything
          that matters against the document itself.
        </p>
      )}
    </div>
  )
}
