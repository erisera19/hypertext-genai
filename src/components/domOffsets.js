/**
 * Character offset of a DOM position within a container's text.
 *
 * Both readers describe a saved highlight as character offsets into a
 * container - a PDF page's text layer, or a paragraph block - because offsets
 * survive a reload, a resize and a re-render, where pixel geometry and live
 * DOM Ranges do not.
 *
 * Returns null when the position is not inside the container, or sits on an
 * element rather than in a text node; callers decide what that means for them
 * rather than getting a plausible-looking wrong number.
 */
export function offsetWithin(container, node, offset) {
  if (!container.contains(node)) return null
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let total = 0
  let current
  while ((current = walker.nextNode())) {
    if (current === node) return total + offset
    total += current.textContent.length
  }
  return null
}
