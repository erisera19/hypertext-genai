import { useCallback, useEffect, useMemo, useRef } from 'react'
import { offsetWithin } from './domOffsets'
import { BLOCK_MODEL, blockPromptText } from '../adapters'

/**
 * The reading surface.
 *
 * Renders the document's blocks and reports any selection the reader makes,
 * together with the passage around it. Context is gathered by block index
 * rather than by searching the text, so a phrase that appears more than once
 * in the document still resolves to the right place.
 *
 * Blocks are typed - paragraph, heading, table - and each renders as the
 * element it actually is. A table in particular has to stay a table: read as
 * a run of separate paragraphs, a results grid loses which number sat under
 * which heading, which is exactly the relationship a reader selects it to
 * ask about.
 *
 * Saved highlights are restored by wrapping the marked characters in <mark>
 * elements rather than by drawing boxes over the text, which is what the PDF
 * reader has to do. This surface owns its own markup and its text is plain,
 * so splitting it is exact at any width or zoom - there is no geometry to
 * measure and nothing to recompute on resize.
 *
 * Offsets are measured against the block element's own `textContent`, so a
 * table's cells are one continuous run of characters with no separators. That
 * is why the prompt gets `blockPromptText` instead: the model should see
 * " | " between cells, while a highlight has to land on the exact characters
 * the reader dragged over.
 */

const CONTEXT_BLOCKS_BEFORE = 2
const CONTEXT_BLOCKS_AFTER = 2

/**
 * Whether a saved anchor still describes this document's blocks.
 *
 * Offsets only mean anything within the block model they were measured in.
 * DOCX changed model when tables and headings stopped being flattened into
 * paragraphs, so a DOCX anchor written before that points at different blocks
 * entirely - it keeps its answer in the rail and loses its mark, rather than
 * highlighting the wrong words. TXT and MD split exactly as they always did,
 * so their older anchors are still good.
 */
function anchorMatchesModel(anchor, format) {
  if (anchor?.kind !== 'blocks' || !anchor.segments?.length) return false
  return (anchor.model ?? 1) === BLOCK_MODEL || format !== 'docx'
}

/**
 * An endpoint's offset inside `blockEl`, falling back when the range ends on
 * an element instead of inside a text node - a triple-click selects a whole
 * paragraph that way, and its endpoints are the element itself.
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

/**
 * A table's cells with each block-level mark translated into the cell it
 * falls in. Cells are numbered as one continuous run of characters, matching
 * the table element's `textContent`, so a highlight dragged across several
 * cells reappears in every cell it touched.
 */
function tableCells(rows, marks = []) {
  let at = 0
  return rows.map((row) =>
    row.map((text) => {
      const cellStart = at
      at += text.length

      const local = []
      for (const mark of marks) {
        const start = Math.max(mark.start - cellStart, 0)
        const end = Math.min(mark.end - cellStart, text.length)
        if (end > start) local.push({ start, end, annotationId: mark.annotationId })
      }
      return { text, marks: local }
    })
  )
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
    () => savedAnnotations.filter((a) => anchorMatchesModel(a.anchor, doc.format)).length,
    [savedAnnotations, doc.format]
  )

  const marksByBlock = useMemo(() => {
    const byBlock = new Map()
    for (const { id, anchor } of savedAnnotations) {
      if (!anchorMatchesModel(anchor, doc.format)) continue
      for (const segment of anchor.segments) {
        if (!byBlock.has(segment.block)) byBlock.set(segment.block, [])
        byBlock.get(segment.block).push({
          start: segment.start,
          end: segment.end,
          annotationId: id,
        })
      }
    }
    return byBlock
  }, [savedAnnotations, doc.format])

  /** What each block is called in a note's "where", counted per type. */
  const labels = useMemo(() => {
    const seen = { paragraph: 0, heading: 0, table: 0 }
    return doc.blocks.map((block) => {
      seen[block.type] += 1
      return `${block.type} ${seen[block.type]}`
    })
  }, [doc.blocks])

  const structure = useMemo(() => {
    const seen = {}
    for (const block of doc.blocks) seen[block.type] = (seen[block.type] || 0) + 1
    return ['paragraph', 'heading', 'table']
      .filter((type) => seen[type])
      .map((type) => `${seen[type]} ${type}${seen[type] === 1 ? '' : 's'}`)
      .join(' · ')
  }, [doc.blocks])

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
    const context = doc.blocks.slice(from, to).map(blockPromptText).join('\n\n')

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
      location: startIdx === endIdx ? labels[startIdx] : `${labels[startIdx]} to ${labels[endIdx]}`,
      anchor: segments.length ? { kind: 'blocks', model: BLOCK_MODEL, segments } : null,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    })
  }, [doc, labels, onSelect, onClearSelection])

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

  const marked = (text, marks) => {
    if (!marks?.length) return text
    return splitBlock(text, marks).map((piece, p) =>
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
  }

  return (
    <div className="reader" ref={surfaceRef}>
      <article className="reader__sheet">
      <header className="reader__head">
        <h1 className="reader__title">{doc.title}</h1>
        <p className="reader__meta">
          {doc.format.toUpperCase()} · {structure}
          {anchoredCount > 0 && ` · ${anchoredCount} saved highlight${anchoredCount === 1 ? '' : 's'}`}
        </p>
      </header>

      {doc.blocks.map((block, i) => {
        const marks = marksByBlock.get(i)

        if (block.type === 'heading') {
          const Heading = block.level === 2 ? 'h2' : 'h3'
          return (
            <Heading className={`reader__heading reader__heading--${block.level}`} data-block={i} key={i}>
              {marked(block.text, marks)}
            </Heading>
          )
        }

        if (block.type === 'table') {
          const [head, ...body] = tableCells(block.rows, marks)
          return (
            <div className="reader__table-wrap" key={i}>
              <table className="reader__table" data-block={i}>
                <thead>
                  <tr>
                    {head.map((cell, c) => (
                      <th key={c}>{marked(cell.text, cell.marks)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td key={c}>{marked(cell.text, cell.marks)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }

        return (
          <p className="reader__block" data-block={i} key={i}>
            {marked(block.text, marks)}
          </p>
        )
      })}
      </article>
    </div>
  )
}
