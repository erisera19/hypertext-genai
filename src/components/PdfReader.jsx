import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TextLayer } from 'pdfjs-dist'
import { computeHighlightBoxesByPage, expandToWordBoundaries } from './pdfSelectionOverlay'
import { computeAnchorSegments, rangeForSegment } from './pdfAnchors'
import { offsetWithin } from './domOffsets'

/**
 * Renders a PDF as it actually looks.
 *
 * Each page is drawn to a canvas, which preserves the real layout - columns,
 * figures, equations, headings, spacing - and an invisible text layer is
 * positioned on top of it. The reader sees the page; the browser selects the
 * text layer.
 * Pages render as they scroll into view, so opening a long paper does not
 * block on drawing every page first.
 */

const SCALE = 1.4
const CONTEXT_CHARS = 1400
const NO_BOXES = []
const THUMB_WIDTH = 60

/**
 * One page of the navigator strip.
 *
 * Drawn from the same pdf.js document the reader is already holding, so a
 * thumbnail costs a small render and no network at all. Like the pages
 * themselves these render only once they are near the strip's viewport - a
 * three-hundred-page paper would otherwise rasterise three hundred canvases
 * to show the reader the first four.
 */
function Thumb({ pdf, pageNumber, current, onGo }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const renderedRef = useRef(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setVisible(true)),
      { rootMargin: '400px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || renderedRef.current) return
    let cancelled = false
    let renderTask = null

    ;(async () => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return

      const scale = THUMB_WIDTH / page.getViewport({ scale: 1 }).width
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      if (!canvas) return

      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

      renderTask = page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      })

      try {
        await renderTask.promise
      } catch (err) {
        if (err?.name === 'RenderingCancelledException') return
        throw err
      }
      if (!cancelled) renderedRef.current = true
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [visible, pdf, pageNumber])

  return (
    <button
      type="button"
      ref={wrapRef}
      className={`pagerail__item${current ? ' pagerail__item--current' : ''}`}
      onClick={() => onGo(pageNumber)}
      aria-label={`Page ${pageNumber}`}
      aria-current={current ? 'page' : undefined}
    >
      <canvas className="pagerail__thumb" ref={canvasRef} />
      <span className="pagerail__n">{pageNumber}</span>
    </button>
  )
}

function Page({
  pdf,
  pageNumber,
  onTextReady,
  highlightBoxes = NO_BOXES,
  savedBoxes = NO_BOXES,
  onRevealAnnotation,
}) {
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

  /*
   * Saved marks are hit-tested here rather than being clickable elements.
   * The overlay they live in is `pointer-events: none` and the text layer
   * sits above it (z-index: 1), so a click never reaches a box; and giving
   * them pointer events would mean stealing drags from text selection.
   * Comparing coordinates instead leaves selection untouched.
   */
  function handleClick(e) {
    if (!savedBoxes.length || !onRevealAnnotation) return

    // The mouseup ending a drag-select also fires a click - not a click on a mark.
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const hit = savedBoxes.find(
      (b) => x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height
    )
    if (hit) onRevealAnnotation(hit.annotationId)
  }

  return (
    <div
      className="page"
      ref={wrapRef}
      data-page={pageNumber}
      style={size ? { width: size.width, height: size.height } : undefined}
      onClick={handleClick}
    >
      <canvas className="page__canvas" ref={canvasRef} />
      <div className="page__highlight" aria-hidden="true">
        {savedBoxes.map((box, i) => (
          <div
            key={`saved-${i}`}
            className="page__highlight-box page__highlight-box--saved"
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          />
        ))}
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

export default function PdfReader({
  document: doc,
  onSelect,
  onClearSelection,
  savedAnnotations = [],
  onRevealAnnotation,
  currentPage = 1,
  onPageChange,
}) {
  const rootRef = useRef(null)
  const pageTextRef = useRef(new Map())
  const rafRef = useRef(null)
  const [highlightBoxes, setHighlightBoxes] = useState({})
  const [savedBoxes, setSavedBoxes] = useState({})

  // Only the anchored ones can be drawn; a note saved before anchoring
  // existed, or on a page whose text layer never resolved, still lives in
  // the rail - it just has no mark on the page.
  const anchored = useMemo(
    () => savedAnnotations.filter((a) => a.anchor?.segments?.length),
    [savedAnnotations]
  )

  /*
   * Redraws every saved mark from its stored character offsets. Like the
   * live overlay, this never caches pixels: a page finishing its render, a
   * resize or a zoom all just run it again.
   */
  const recomputeSaved = useCallback(() => {
    const root = rootRef.current
    if (!root) return

    const byPage = {}
    for (const annotation of anchored) {
      for (const segment of annotation.anchor.segments) {
        const pageEl = root.querySelector(`[data-page="${segment.page}"]`)
        if (!pageEl) continue

        const range = rangeForSegment(pageEl, segment.start, segment.end)
        if (!range) continue

        for (const [page, boxes] of Object.entries(computeHighlightBoxesByPage(range, root))) {
          byPage[page] ??= []
          for (const box of boxes) byPage[page].push({ ...box, annotationId: annotation.id })
        }
      }
    }
    setSavedBoxes(byPage)
  }, [anchored])

  const handleTextReady = useCallback(
    (pageNumber, text) => {
      pageTextRef.current.set(pageNumber, text)
      // This page's text layer now exists, so any saved marks on it can be drawn.
      recomputeSaved()
    },
    [recomputeSaved]
  )

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
      recomputeSaved()
    })
  }, [recomputeHighlights, recomputeSaved])

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
    const segments = computeAnchorSegments(range, root)

    onSelect({
      text,
      context,
      location: startNum === endNum ? `page ${startNum}` : `pages ${startNum}–${endNum}`,
      // Where to redraw this highlight if the note is saved and the document
      // is reopened later. Offsets into the page's text, never pixels.
      anchor: segments.length ? { kind: 'pdf', segments } : null,
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

  // Draw saved marks as soon as they arrive - restored when the document
  // opens, and again when a new note is saved onto it.
  useEffect(() => {
    recomputeSaved()
  }, [recomputeSaved])

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

  /*
   * Which page the reader is on, for the counter in the bar and the mark in
   * the navigator. The margins shrink the observed area to a band across the
   * middle of the scroller, so exactly one page is "current" - thresholds
   * alone would report two whenever a page boundary is on screen.
   */
  useEffect(() => {
    const scroller = rootRef.current
    if (!scroller || !onPageChange) return

    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting)
        if (hit) onPageChange(Number(hit.target.dataset.page))
      },
      { root: scroller, rootMargin: '-45% 0px -45% 0px' }
    )
    scroller.querySelectorAll('[data-page]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [onPageChange, doc])

  const goToPage = useCallback((n) => {
    rootRef.current
      ?.querySelector(`[data-page="${n}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  return (
    <div className="pdf">
      <nav className="pagerail" aria-label="Pages">
        {pages.map((n) => (
          <Thumb
            key={n}
            pdf={doc.pdf}
            pageNumber={n}
            current={n === currentPage}
            onGo={goToPage}
          />
        ))}
        <span className="pagerail__count">
          {currentPage} / {doc.pdf.numPages}
        </span>
      </nav>

      <div className="pdf__scroll" ref={rootRef}>
        {pages.map((n) => (
          <Page
            key={n}
            pdf={doc.pdf}
            pageNumber={n}
            onTextReady={handleTextReady}
            highlightBoxes={highlightBoxes[n] || NO_BOXES}
            savedBoxes={savedBoxes[n] || NO_BOXES}
            onRevealAnnotation={onRevealAnnotation}
          />
        ))}
      </div>
    </div>
  )
}
