import { useCallback, useEffect, useRef } from 'react'

/**
 * The reading surface.
 *
 * Renders the document's blocks as paragraphs and reports any selection the
 * reader makes, together with the passage around it. Context is gathered by
 * block index rather than by searching the text, so a phrase that appears
 * more than once in the document still resolves to the right place.
 */

const CONTEXT_BLOCKS_BEFORE = 2
const CONTEXT_BLOCKS_AFTER = 2

export default function Reader({ document: doc, onSelect, onClearSelection }) {
  const surfaceRef = useRef(null)

  const readSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      onClearSelection()
      return
    }

    const text = sel.toString().trim()
    if (text.length < 2) {
      onClearSelection()
      return
    }

    const surface = surfaceRef.current
    if (!surface) return

    const range = sel.getRangeAt(0)
    if (!surface.contains(range.commonAncestorContainer)) return

    const blockOf = (node) => {
      const el = node.nodeType === 1 ? node : node.parentElement
      const block = el?.closest('[data-block]')
      return block ? Number(block.dataset.block) : null
    }

    const startIdx = blockOf(range.startContainer)
    const endIdx = blockOf(range.endContainer)
    if (startIdx === null || endIdx === null) return

    const from = Math.max(0, startIdx - CONTEXT_BLOCKS_BEFORE)
    const to = Math.min(doc.blocks.length, endIdx + CONTEXT_BLOCKS_AFTER + 1)
    const context = doc.blocks.slice(from, to).join('\n\n')

    const rect = range.getBoundingClientRect()

    onSelect({
      text,
      context,
      blockRange: [startIdx, endIdx],
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    })
  }, [doc, onSelect, onClearSelection])

  useEffect(() => {
    const handleUp = () => window.setTimeout(readSelection, 0)
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        window.getSelection()?.removeAllRanges()
        onClearSelection()
      }
    }
    window.document.addEventListener('mouseup', handleUp)
    window.document.addEventListener('keyup', handleUp)
    window.document.addEventListener('keydown', handleKey)
    return () => {
      window.document.removeEventListener('mouseup', handleUp)
      window.document.removeEventListener('keyup', handleUp)
      window.document.removeEventListener('keydown', handleKey)
    }
  }, [readSelection, onClearSelection])

  return (
    <article className="reader" ref={surfaceRef}>
      <header className="reader__head">
        <h1 className="reader__title">{doc.title}</h1>
        <p className="reader__meta">
          {doc.format.toUpperCase()} · {doc.blocks.length} paragraphs
        </p>
      </header>
      {doc.blocks.map((block, i) => (
        <p className="reader__block" data-block={i} key={i}>
          {block}
        </p>
      ))}
    </article>
  )
}
