/**
 * The menu of operations a reader can invoke on a selected passage.
 *
 * This list is the heart of the project: where most existing tools offer a
 * single "explain" action, the reader here chooses what kind of elaboration
 * they want. The set deliberately reaches past definition and summary into
 * operations that ask the reader to engage with the passage rather than
 * skip past it.
 *
 * Each operation carries the instruction that will be handed to the model.
 * Adding an operation means adding one entry here - nothing else changes.
 */

export const OPERATIONS = [
  {
    id: 'explain',
    label: 'Explain',
    hint: 'Plain-language explanation, in context',
    instruction:
      'Explain what this passage is saying, in plain language. Assume the reader ' +
      'is capable but unfamiliar with this subfield. Keep it to a short paragraph.',
  },
  {
    id: 'define',
    label: 'Define',
    hint: 'The key term, briefly',
    instruction:
      'Identify the key technical term in this passage and define it in one or two ' +
      'sentences, as it is being used here specifically rather than in general.',
  },
  {
    id: 'breakdown',
    label: 'Break down',
    hint: 'Split the idea into its parts',
    instruction:
      'Break this passage into its component ideas and present them as a short list. ' +
      'Show how the parts relate to one another, so the structure of the argument is visible.',
  },
  {
    id: 'example',
    label: 'Give an example',
    hint: 'A concrete case',
    instruction:
      'Give one concrete, worked example that illustrates what this passage describes. ' +
      'Prefer a specific case over an abstract restatement.',
  },
  {
    id: 'assumptions',
    label: 'Assumptions',
    hint: 'What it takes for granted',
    instruction:
      'Identify what this passage assumes without stating - the premises it takes for ' +
      'granted. List them briefly and note any that a careful reader might question.',
  },
  {
    id: 'compare',
    label: 'Compare views',
    hint: 'How others might see it',
    instruction:
      'Describe how someone might reasonably disagree with or complicate the position in ' +
      'this passage. Present the alternative view fairly, without arguing for either side.',
  },
]

export function getOperation(id) {
  return OPERATIONS.find((op) => op.id === id) || null
}
