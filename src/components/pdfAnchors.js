

import { offsetWithin } from './domOffsets'

/**
 * Where `range` sits, as character offsets into each page's text layer.
 * Pages the range crosses entirely are recorded whole; a page whose text
 * layer has not rendered yet contributes nothing rather than a bogus span.
 */
export function computeAnchorSegments(range, root) {
  const segments = []

  for (const pageEl of root.querySelectorAll('[data-page]')) {
    if (!range.intersectsNode(pageEl)) continue

    const layer = pageEl.querySelector('.page__text')
    const total = layer?.textContent?.length || 0
    if (!total) continue

    let start = 0
    let end = total

    if (pageEl.contains(range.startContainer)) {
      const from = offsetWithin(layer, range.startContainer, range.startOffset)
      if (from === null) continue
      start = from
    }
    if (pageEl.contains(range.endContainer)) {
      const to = offsetWithin(layer, range.endContainer, range.endOffset)
      if (to === null) continue
      end = to
    }

    if (end > start) segments.push({ page: Number(pageEl.dataset.page), start, end })
  }

  return segments
}

/**
 * Rebuilds a DOM Range from offsets into a page's text layer. Returns null if
 * the page has not rendered, or if the offsets fall outside its text 
 */
export function rangeForSegment(pageEl, start, end) {
  const layer = pageEl.querySelector('.page__text')
  if (!layer || !layer.textContent) return null

  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let startNode = null
  let startOffset = 0
  let endNode = null
  let endOffset = 0
  let node

  while ((node = walker.nextNode())) {
    const length = node.textContent.length
    if (!startNode && consumed + length >= start) {
      startNode = node
      startOffset = start - consumed
    }
    if (startNode && consumed + length >= end) {
      endNode = node
      endOffset = end - consumed
      break
    }
    consumed += length
  }

  if (!startNode || !endNode) return null

  const range = document.createRange()
  range.setStart(startNode, Math.min(startOffset, startNode.textContent.length))
  range.setEnd(endNode, Math.min(endOffset, endNode.textContent.length))
  return range
}
