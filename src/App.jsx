import { useCallback, useRef, useState } from 'react'
import { loadDocument, ACCEPTED } from './adapters'
import { buildPrompt } from './core/promptBuilder'
import { generate } from './core/llmClient'
import { getOperation } from './core/operations'
import { sha256Hex } from './core/hash'
import { lookupDocument, saveAnnotation, deleteSavedAnnotation } from './core/persistence'
import Reader from './components/Reader'
import PdfReader from './components/PdfReader'
import SelectionMenu from './components/SelectionMenu'
import ResponseRail from './components/ResponseRail'

let nextId = 1

function restoredItem(row) {
  return {
    id: nextId++,
    savedId: row.id,
    operation: getOperation(row.operationId),
    selection: row.selection,
    location: row.location,
    status: 'done',
    response: row.response,
    error: null,
  }
}

export default function App() {
  const [doc, setDoc] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selection, setSelection] = useState(null)
  const [items, setItems] = useState([])
  const [restoreNotice, setRestoreNotice] = useState(null)
  const fileInput = useRef(null)

  async function openFile(file) {
    if (!file) return
    setLoading(true)
    setLoadError(null)
    setSelection(null)
    setRestoreNotice(null)
    try {
      const loaded = await loadDocument(file)
      const hash = await sha256Hex(await file.arrayBuffer())
      setDoc({ ...loaded, hash })
      setItems([])

      try {
        const rows = await lookupDocument({ hash, title: loaded.title, format: loaded.format })
        if (rows.length) {
          setItems(rows.map(restoredItem))
          setRestoreNotice(`Restored ${rows.length} saved note${rows.length === 1 ? '' : 's'} from a previous visit.`)
        }
      } catch (err) {
        // Persistence is a stretch feature: if the server is unreachable,
        // reading and prompting must still work without it.
        console.warn('Could not reach the persistence server:', err.message)
      }
    } catch (err) {
      setLoadError(err.message)
      setDoc(null)
    } finally {
      setLoading(false)
    }
  }

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

      try {
        const saved = await saveAnnotation({
          documentHash: doc.hash,
          operationId: operation.id,
          selection: snapshot.text,
          location: snapshot.location || null,
          response,
        })
        setItems((prev) =>
          prev.map((it) => (it.id === id ? { ...it, savedId: saved.id } : it))
        )
      } catch (err) {
        console.warn('Could not save this note:', err.message)
      }
    } catch (err) {
      setItems((prev) =>
        prev.map((it) =>
          it.id === id ? { ...it, status: 'error', error: err.message } : it
        )
      )
    }
  }

  function dismiss(id) {
    const item = items.find((it) => it.id === id)
    setItems((prev) => prev.filter((it) => it.id !== id))
    if (item?.savedId) {
      deleteSavedAnnotation(item.savedId).catch((err) =>
        console.warn('Could not delete this saved note:', err.message)
      )
    }
  }

  return (
    <div className="app">
      <nav className="bar">
        <span className="bar__mark">Reader</span>
        <div className="bar__actions">
          {doc && (
            <span className="bar__file">{doc.title}</span>
          )}
          {restoreNotice && (
            <span className="bar__restore">{restoreNotice}</span>
          )}
          <button className="btn" onClick={() => fileInput.current?.click()}>
            {doc ? 'Open another' : 'Open a document'}
          </button>
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
          </div>
        )}

        {doc && (
          <div className={`workspace${doc.kind === 'pdf' ? ' workspace--pdf' : ''}`}>
            {doc.kind === 'pdf' ? (
              <PdfReader
                document={doc}
                onSelect={setSelection}
                onClearSelection={clearSelection}
              />
            ) : (
              <Reader
                document={doc}
                onSelect={setSelection}
                onClearSelection={clearSelection}
              />
            )}
            <ResponseRail items={items} onDismiss={dismiss} />
          </div>
        )}
      </main>

      <SelectionMenu selection={selection} onRun={runOperation} />

      {doc && (
        <p className="disclaimer">
          Answers are generated by a language model and can be wrong. Check anything
          that matters against the document itself.
        </p>
      )}
    </div>
  )
}
