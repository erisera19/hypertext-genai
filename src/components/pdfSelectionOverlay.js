/**
 * Selection-highlight geometry for the PDF reader.
 *
 * pdf.js's text layer draws one absolutely-positioned span per line, each
 * scaled horizontally (`transform: scaleX(...)`) so the line's total width
 * matches the painted line beneath it. That scale is an average over the
 * whole line, so native `::selection` painting only lines up with the
 * canvas at the very start and end of a line - mid-line it drifts off the
 * glyphs, and `line-height: 1` on the text layer clips descenders.
 *
 * Rather than fight pdf.js's metrics, native selection painting is turned
 * off (`.textLayer ::selection { background: transparent }`) and this
 * module computes highlight boxes to draw instead: one box per visual
 * line, snapped outward to whole words (the drift only matters mid-word),
 * padded so descenders sit inside the bar, split per page for a selection
 * that crosses a page boundary.
 *
 * The live DOM Selection/Range is never mutated here - only clones - so
 * copy-to-clipboard keeps returning exactly what the reader dragged over.
 */

const WHITESPACE = /[\s ]/

/**
 * A clone of `range`, expanded outward to the nearest word boundaries.
 * Only walks within the start/end text node - pdf.js gives each visual
 * line its own span, so a selection never needs to cross a span boundary
 * to reach a word's edge.
 */
export function expandToWordBoundaries(range) {
  const expanded = range.cloneRange()

  const { startContainer, startOffset } = expanded
  if (startContainer.nodeType === Node.TEXT_NODE) {
    const text = startContainer.textContent
    let i = startOffset
    while (i > 0 && !WHITESPACE.test(text[i - 1])) i--
    expanded.setStart(startContainer, i)
  }

  const { endContainer, endOffset } = expanded
  if (endContainer.nodeType === Node.TEXT_NODE) {
    const text = endContainer.textContent
    let i = endOffset
    while (i < text.length && !WHITESPACE.test(text[i])) i++
    expanded.setEnd(endContainer, i)
  }

  return expanded
}

/**
 * Merges client rects that belong to the same visual line - same top
 * within ~2px, horizontally touching or overlapping - into one padded,
 * rounded box per line.
 */
function mergeRectsByLine(rects, padY = 3) {
  const lines = []
  for (const r of rects) {
    if (r.right <= r.left || r.bottom <= r.top) continue
    const line = lines.find(
      (l) => Math.abs(l.top - r.top) < 2 && r.left <= l.right + 2 && r.right >= l.left - 2
    )
    if (line) {
      line.left = Math.min(line.left, r.left)
      line.right = Math.max(line.right, r.right)
      line.top = Math.min(line.top, r.top)
      line.bottom = Math.max(line.bottom, r.bottom)
    } else {
      lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
    }
  }
  return lines.map((l) => ({
    left: l.left,
    top: l.top - padY,
    width: l.right - l.left,
    height: l.bottom - l.top + padY * 2,
  }))
}

/**
 * Splits `range` across every `[data-page]` element it touches and
 * returns highlight boxes for each, keyed by that page's `data-page`
 * value and positioned relative to the page's own box (matching the
 * `position: absolute; inset: 0` overlay each page renders).
 */
export function computeHighlightBoxesByPage(range, root) {
  const byPage = {}

  for (const pageEl of root.querySelectorAll('[data-page]')) {
    if (!range.intersectsNode(pageEl)) continue
    const textLayer = pageEl.querySelector('.page__text')
    if (!textLayer) continue

    const sub = document.createRange()
    if (pageEl.contains(range.startContainer)) {
      sub.setStart(range.startContainer, range.startOffset)
    } else {
      sub.setStart(textLayer, 0)
    }
    if (pageEl.contains(range.endContainer)) {
      sub.setEnd(range.endContainer, range.endOffset)
    } else {
      sub.setEnd(textLayer, textLayer.childNodes.length)
    }

    const rects = Array.from(sub.getClientRects())
    if (!rects.length) continue

    const pageRect = pageEl.getBoundingClientRect()
    const relative = rects.map((r) => ({
      left: r.left - pageRect.left,
      top: r.top - pageRect.top,
      right: r.right - pageRect.left,
      bottom: r.bottom - pageRect.top,
    }))

    const boxes = mergeRectsByLine(relative)
    if (boxes.length) byPage[pageEl.dataset.page] = boxes
  }

  return byPage
}
