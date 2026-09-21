import { useCallback, useEffect, useRef, useState } from 'react'
import { TextLayer } from 'pdfjs-dist'
import { computeHighlightBoxesByPage, expandToWordBoundaries } from './pdfSelectionOverlay'

/**
 * Renders a PDF as it actually looks.
 *
 * Each page is drawn to a canvas, which preserves the real layout - columns,
 * figures, equations, headings, spacing - and an invisible text layer is
 * positioned on top of it. The reader sees the page; the browser selects the
 * text layer.
 *
 * Native selection painting is off (see styles.css) because pdf.js's per-line
 * spans don't line up with the canvas glyphs mid-line. Instead, a highlight
 * overlay between the canvas and the text layer is redrawn from the live
 * Selection on every change - see pdfSelectionOverlay.js.
 *
 * Pages render as they scroll into view, so opening a long paper does not
 * block on drawing every page first.
 */

const SCALE = 1.4
const CONTEXT_CHARS = 1400
const NO_BOXES = []

/** Character offset of (node, offset) within a container's text. */
function offsetWithin(container, node, offset) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let total = 0
  let current
  while ((current = walker.nextNode())) {
    if (current === node) return total + offset
    total += current.textContent.length
  }
  return null
}

function Page({ pdf, pageNumber, onTextReady, highlightBoxes = NO_BOXES }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const textRef = useRef(null)
  const [size, setSize] = useState(null)
  const [visible, setVisible] = useState(false)
  const renderedRef = useRef(false)

  // Size the placeholder before the page is drawn, so scrolling is stable.
  useEffect(() => {
    let cancelled = false
    pdf.getPage(pageNumber).then((page) => {
      if (cancelled) return
      const vp = page.getViewport({ scale: SCALE })
      setSize({ width: vp.width, height: vp.height })
    })
    return () => { cancelled = true }
  }, [pdf, pageNumber])

  // Draw only once the page is near the viewport.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setVisible(true)),
      { rootMargin: '600px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || renderedRef.current || !size) return
    let cancelled = false
    let renderTask = null

    ;(async () => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return

      const viewport = page.getViewport({ scale: SCALE })
      const canvas = canvasRef.current
      const textDiv = textRef.current
      if (!canvas || !textDiv) return

      // Draw at device resolution so the page is not soft on retina screens.
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

      const ctx = canvas.getContext('2d')
      renderTask = page.render({
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      })

      try {
        await renderTask.promise
      } catch (err) {
        if (err?.name === 'RenderingCancelledException') return
        throw err
      }
      if (cancelled) return

      // The text layer needs the scale as a custom property in pdf.js v4.
      textDiv.style.setProperty('--scale-factor', String(viewport.scale))
      textDiv.replaceChildren()

      const textContent = await page.getTextContent()
      if (cancelled) return

      const layer = new TextLayer({
        textContentSource: textContent,
        container: textDiv,
        viewport,
      })
      await layer.render()
      if (cancelled) return

      renderedRef.current = true
      onTextReady(pageNumber, textDiv.textContent || '')
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [visible, size, pdf, pageNumber, onTextReady])

  return (
    <div
      className="page"
      ref={wrapRef}
      data-page={pageNumber}
      style={size ? { width: size.width, height: size.height } : undefined}
    >
      <canvas className="page__canvas" ref={canvasRef} />
      <div className="page__highlight" aria-hidden="true">
        {highlightBoxes.map((box, i) => (
          <div
            key={i}
            className="page__highlight-box"
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          />
        ))}
      </div>
      <div className="page__text textLayer" ref={textRef} />
      <span className="page__number" aria-hidden="true">{pageNumber}</span>
    </div>
  )
}

export default function PdfReader({ document: doc, onSelect, onClearSelection }) {
  const rootRef = useRef(null)
  const pageTextRef = useRef(new Map())
  const rafRef = useRef(null)
  const [highlightBoxes, setHighlightBoxes] = useState({})

  const handleTextReady = useCallback((pageNumber, text) => {
    pageTextRef.current.set(pageNumber, text)
  }, [])

  // Redraws the highlight overlay from whatever the live Selection is right
  // now. Never caches pixel boxes across calls - everything is measured
  // fresh each time, so a resize, a zoom change, or a page finishing its
  // render all self-correct the next time this runs.
  const recomputeHighlights = useCallback(() => {
    const root = rootRef.current
    if (!root) return

    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setHighlightBoxes({})
      return
    }

    const raw = sel.getRangeAt(0)
    if (!root.contains(raw.commonAncestorContainer)) return

    const range = expandToWordBoundaries(raw)
    setHighlightBoxes(computeHighlightBoxesByPage(range, root))
  }, [])

  const scheduleRecompute = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      recomputeHighlights()
    })
  }, [recomputeHighlights])

  const readSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) { onClearSelection(); return }

    const root = rootRef.current
    if (!root) return

    const raw = sel.getRangeAt(0)
    if (!root.contains(raw.commonAncestorContainer)) return

    // The action bar reads the same word-snapped range the overlay draws,
    // so the highlighted passage and the one sent to the model always match.
    const range = expandToWordBoundaries(raw)
    const text = range.toString().trim()
    if (text.length < 2) { onClearSelection(); return }

    const pageOf = (node) => {
      const el = node.nodeType === 1 ? node : node.parentElement
      return el?.closest('[data-page]') || null
    }

    const startPage = pageOf(range.startContainer)
    const endPage = pageOf(range.endContainer)
    if (!startPage) return

    const startNum = Number(startPage.dataset.page)
    const endNum = endPage ? Number(endPage.dataset.page) : startNum

    // Build context from the page's own text, centred on the selection.
    let context = text
    const layer = startPage.querySelector('.page__text')
    if (layer) {
      const pageText = layer.textContent || ''
      const from = offsetWithin(layer, range.startContainer, range.startOffset)
      if (from !== null) {
        const to = startNum === endNum
          ? (offsetWithin(layer, range.endContainer, range.endOffset) ?? from + text.length)
          : pageText.length
        context = pageText.slice(
          Math.max(0, from - CONTEXT_CHARS),
          Math.min(pageText.length, to + CONTEXT_CHARS)
        )
      } else {
        context = pageText.slice(0, CONTEXT_CHARS * 2)
      }
    }

    // A selection running onto the next page picks up the start of that page too.
    if (endNum !== startNum) {
      const tail = pageTextRef.current.get(endNum)
      if (tail) context += '\n' + tail.slice(0, CONTEXT_CHARS)
    }

    const rect = range.getBoundingClientRect()
    onSelect({
      text,
      context,
      location: startNum === endNum ? `page ${startNum}` : `pages ${startNum}–${endNum}`,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    })
  }, [onSelect, onClearSelection])

  useEffect(() => {
    const handleUp = () => window.setTimeout(readSelection, 0)
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        window.getSelection()?.removeAllRanges()
        onClearSelection()
      }
    }
    document.addEventListener('mouseup', handleUp)
    document.addEventListener('keyup', handleUp)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mouseup', handleUp)
      document.removeEventListener('keyup', handleUp)
      document.removeEventListener('keydown', handleKey)
    }
  }, [readSelection, onClearSelection])

  // Redraw as the selection itself changes (dragging, double/triple-click,
  // Escape, the app clearing the selection after an operation runs) and as
  // layout changes under a fixed selection (browser zoom, window resize).
  useEffect(() => {
    document.addEventListener('selectionchange', scheduleRecompute)
    window.addEventListener('resize', scheduleRecompute)
    return () => {
      document.removeEventListener('selectionchange', scheduleRecompute)
      window.removeEventListener('resize', scheduleRecompute)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [scheduleRecompute])

  // Each page's box is sized once its canvas and text layer are ready, so a
  // ResizeObserver on the page containers catches that first render too -
  // not just later reflows.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const ro = new ResizeObserver(scheduleRecompute)
    root.querySelectorAll('[data-page]').forEach((el) => ro.observe(el))
    return () => ro.disconnect()
  }, [scheduleRecompute, doc])

  const pages = Array.from({ length: doc.pdf.numPages }, (_, i) => i + 1)

  return (
    <div className="pdf" ref={rootRef}>
      <header className="pdf__head">
        <h1 className="reader__title">{doc.title}</h1>
        <p className="reader__meta">PDF · {doc.pdf.numPages} pages</p>
      </header>
      {pages.map((n) => (
        <Page
          key={n}
          pdf={doc.pdf}
          pageNumber={n}
          onTextReady={handleTextReady}
          highlightBoxes={highlightBoxes[n] || NO_BOXES}
        />
      ))}
    </div>
  )
}
