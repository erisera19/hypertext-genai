/**
 * Turns a reader's selection into a prompt for the language model.
 *
 * This is the retrieval-augmented step. The model is not asked about the
 * selected text in isolation: it is given the surrounding passage and the
 * document's own details, so the response is about this text in this
 * document rather than a generic answer about the topic.
 *
 * Keeping this in one place means the prompting strategy can be revised,
 * compared, and written up without touching the interface.
 */

const MAX_CONTEXT_CHARS = 4000

function trimContext(text) {
  if (text.length <= MAX_CONTEXT_CHARS) return text
  return text.slice(0, MAX_CONTEXT_CHARS) + '\n[context truncated]'
}

const GROUNDING_RULES = [
  'Base your answer on the passage and its surrounding context above.',
  'If the context does not contain enough to answer well, say so plainly rather than filling the gap.',
  'Do not invent citations, figures, author names, or results.',
  'Write for someone who is reading this document right now and wants to keep reading.',
  'Use prose. Keep it short - a few sentences to a short paragraph unless the operation asks for a list.',
].join('\n')

export function buildPrompt({ operation, selection, context, document }) {
  const parts = []

  parts.push(
    'You are helping someone read a difficult document. They have selected a ' +
    'passage and asked for a specific kind of help with it.'
  )

  parts.push(`DOCUMENT: ${document.title} (${document.format.toUpperCase()})`)

  if (context && context !== selection) {
    parts.push(`SURROUNDING CONTEXT:\n"""\n${trimContext(context)}\n"""`)
  }

  parts.push(`SELECTED PASSAGE:\n"""\n${selection}\n"""`)

  parts.push(`WHAT THE READER ASKED FOR - ${operation.label}:\n${operation.instruction}`)

  parts.push(`RULES:\n${GROUNDING_RULES}`)

  return parts.join('\n\n')
}
