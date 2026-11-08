
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
