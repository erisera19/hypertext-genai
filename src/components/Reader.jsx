import { useCallback, useEffect, useMemo, useRef } from 'react'
import { offsetWithin } from './domOffsets'

/**
 * The reading surface.
 *
 * Renders the document's blocks as paragraphs and reports any selection the
 * reader makes, together with the passage around it. Context is gathered by
 * block index rather than by searching the text, so a phrase that appears
 * more than once in the document still resolves to the right place.
 *
 * Saved highlights are restored by wrapping the marked characters in <mark>
 * elements rather than by drawing boxes over the text, which is what the PDF
 * reader has to do. This surface owns its own markup and its paragraphs are
 * plain text, so splitting them is exact at any width or zoom - there is no
 * geometry to measure and nothing to recompute on resize.
 */

const CONTEXT_BLOCKS_BEFORE = 2
const CONTEXT_BLOCKS_AFTER = 2

/**
 * An endpoint's offset inside `blockEl`, falling back when the range ends on
 * an element instead of inside a text node - a triple-click selects a whole
 * paragraph that way, and its endpoints are the <p> itself.
 */
function endpointOffset(blockEl, node, offset, fallback) {
  const direct = offsetWithin(blockEl, node, offset)
  return direct === null ? fallback : direct
}

/**
 * Splits a block's text into marked and unmarked runs. Marks are applied in
 * start order and clipped against the previous one, so two answers on
 * overlapping passages produce adjacent runs rather than nested elements.
 */
function splitBlock(text, marks) {
  const pieces = []
  let at = 0

  for (const mark of [...marks].sort((a, b) => a.start - b.start)) {
    const start = Math.max(mark.start, at)
    const end = Math.min(mark.end, text.length)
    if (end <= start) continue
    if (start > at) pieces.push({ text: text.slice(at, start), annotationId: null })
    pieces.push({ text: text.slice(start, end), annotationId: mark.annotationId })
    at = end
  }
  if (at < text.length) pieces.push({ text: text.slice(at), annotationId: null })

  return pieces
}

export default function Reader({
  document: doc,
  onSelect,
  onClearSelection,
  savedAnnotations = [],
  onRevealAnnotation,
}) {
  const surfaceRef = useRef(null)

  const anchoredCount = useMemo(
    () =>
      savedAnnotations.filter((a) => a.anchor?.kind === 'blocks' && a.anchor.segments?.length)
        .length,
    [savedAnnotations]
  )

  const marksByBlock = useMemo(() => {
    const byBlock = new Map()
    for (const { id, anchor } of savedAnnotations) {
      if (anchor?.kind !== 'blocks') continue
      for (const segment of anchor.segments || []) {
        if (!byBlock.has(segment.block)) byBlock.set(segment.block, [])
        byBlock.get(segment.block).push({
          start: segment.start,
          end: segment.end,
          annotationId: id,
        })
      }
    }
    return byBlock
  }, [savedAnnotations])

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

    // Character offsets per block, so this highlight can be redrawn if the
    // note is saved and the document is opened again. Blocks between the
    // first and the last are covered whole.
    const segments = []
    for (let i = startIdx; i <= endIdx; i++) {
      const blockEl = surface.querySelector(`[data-block="${i}"]`)
      const total = blockEl?.textContent?.length || 0
      if (!total) continue

      const start =
        i === startIdx
          ? endpointOffset(blockEl, range.startContainer, range.startOffset, 0)
          : 0
      const end =
        i === endIdx
          ? endpointOffset(blockEl, range.endContainer, range.endOffset, total)
          : total

      if (end > start) segments.push({ block: i, start, end })
    }

    const rect = range.getBoundingClientRect()

    onSelect({
      text,
      context,
      // Blocks are indexed from zero; readers count paragraphs from one.
      location:
        startIdx === endIdx
          ? `paragraph ${startIdx + 1}`
          : `paragraphs ${startIdx + 1}–${endIdx + 1}`,
      anchor: segments.length ? { kind: 'blocks', segments } : null,
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
          {anchoredCount > 0 && ` · ${anchoredCount} saved highlight${anchoredCount === 1 ? '' : 's'}`}
        </p>
      </header>
      {doc.blocks.map((block, i) => {
        const marks = marksByBlock.get(i)
        return (
          <p className="reader__block" data-block={i} key={i}>
            {marks
              ? splitBlock(block, marks).map((piece, p) =>
                  piece.annotationId === null ? (
                    <span key={p}>{piece.text}</span>
                  ) : (
                    <mark
                      key={p}
                      className="reader__mark"
                      onClick={() => onRevealAnnotation?.(piece.annotationId)}
                      title="Show the answer for this passage"
                    >
                      {piece.text}
                    </mark>
                  )
                )
              : block}
          </p>
        )
      })}
    </article>
  )
}
