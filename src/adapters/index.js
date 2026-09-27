/**
 * Document adapters.
 *
 * Text formats (TXT, DOCX) become an ordered list of typed blocks:
 *
 * PDF keeps its own pdf.js document instead of being flattened to text.
 *
 * `App.jsx` branches on `kind` to choose `Reader` or `PdfReader`. Adding a
 * text-like format (HTML, Markdown) means producing the same blocks here; a
 * format that needs its own layout would get its own `kind`, the way PDF did.
 */

import mammoth from 'mammoth/mammoth.browser'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

export const BLOCK_MODEL = 2

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()

/**
 * How a block reads when it is handed to the model as context. A table's
 * cells are joined with " | " and its rows with newlines, so the model sees
 * a grid rather than a run of unrelated words.
 */
export function blockPromptText(block) {
  if (block.type === 'table') {
    return block.rows.map((row) => row.join(' | ')).join('\n')
  }
  return block.text
}

/**
 * The characters a block contributes to the page, in document order - which
 * is what a saved highlight's offsets are measured against.
 */
export function blockPlainText(block) {
  return block.type === 'table' ? block.rows.flat().join('') : block.text
}

function toParagraphs(raw) {
  return raw
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((text) => ({ type: 'paragraph', text: clean(text) }))
    .filter((block) => block.text.length > 0)
}

function loadTxt(arrayBuffer) {
  return toParagraphs(new TextDecoder().decode(arrayBuffer))
}


const DOCX_STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Chapter Title'] => h1:fresh",
  "p[style-name='Section Heading'] => h2:fresh",
  "p[style-name='Subsection Heading'] => h3:fresh",
  "p[style-name='Caption'] => p:fresh",
  "p[style-name='Quote'] => p:fresh",
  "p[style-name='Intense Quote'] => p:fresh",
]

/**
 * A table's cells, row by row. Cells spanning columns are read as one cell -
 * the grid is slightly narrower than the original there, which costs nothing
 * for reading and keeps rows as flat arrays.
 */
function tableBlock(tableEl) {
  const rows = []
  for (const tr of tableEl.querySelectorAll('tr')) {
    const cells = Array.from(tr.querySelectorAll('th, td'), (cell) => clean(cell.textContent))
    if (cells.some((cell) => cell.length > 0)) rows.push(cells)
  }
  // One row is a layout device, not data worth drawing a grid for.
  return rows.length > 1 ? { type: 'table', rows } : null
}


function htmlToBlocks(root) {
  const blocks = []

  const visit = (el) => {
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase()
      const heading = /^h([1-6])$/.exec(tag)

      if (heading) {
        const text = clean(child.textContent)
        if (text) {
          blocks.push({ type: 'heading', level: Number(heading[1]) === 1 ? 2 : 3, text })
        }
        continue
      }

      if (tag === 'table') {
        const block = tableBlock(child)
        if (block) {
          blocks.push(block)
        } else {
          const text = clean(child.textContent)
          if (text) blocks.push({ type: 'paragraph', text })
        }
        continue
      }

      if (tag === 'ul' || tag === 'ol') {
        for (const li of child.querySelectorAll('li')) {
          const text = clean(li.textContent)
          if (text) blocks.push({ type: 'paragraph', text })
        }
        continue
      }

      if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'blockquote') {
        visit(child)
        continue
      }

      const text = clean(child.textContent)
      if (text) blocks.push({ type: 'paragraph', text })
    }
  }

  visit(root)
  return blocks
}

async function loadDocx(arrayBuffer) {
  const { value: html } = await mammoth.convertToHtml(
    { arrayBuffer },
    { styleMap: DOCX_STYLE_MAP }
  )
  return htmlToBlocks(new DOMParser().parseFromString(html, 'text/html').body)
}

/**
 * A scanned page has no text items at all (or only whitespace) - pdf.js can
 * still draw its bitmap, but there is nothing for a text layer to sit on,
 * so selection would silently do nothing. Check before handing the document
 * to the reader rather than let that fail quietly. Most real papers have
 * text from page one, so this returns as soon as a page has any.
 */
async function hasSelectableText(pdf) {
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()
    if (content.items.some((item) => item.str && item.str.trim().length > 0)) {
      return true
    }
  }
  return false
}

async function loadPdf(arrayBuffer) {
  // pdf.js transfers the buffer it is given to its worker, which detaches it.
  // The caller still needs these bytes (to upload, or to hash), so hand over
  // a copy rather than the original.
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise

  if (!(await hasSelectableText(pdf))) {
    throw new Error(
      'No selectable text found in this PDF. It is probably a scanned image, ' +
      'which would need OCR to read.'
    )
  }

  return pdf
}

/**
 * Loads a document from raw bytes. Used both for a file the reader picked
 * from disk and for one fetched back out of their library, so a stored
 * document renders through exactly the same path it did the first time -
 * which is what keeps saved highlight offsets valid.
 */
export async function loadFromBytes({ arrayBuffer, title, format }) {
  if (format === 'pdf') {
    const pdf = await loadPdf(arrayBuffer)
    return { kind: 'pdf', title, format, pdf }
  }

  let blocks
  if (format === 'txt' || format === 'md') blocks = loadTxt(arrayBuffer)
  else if (format === 'docx') blocks = await loadDocx(arrayBuffer)
  else throw new Error(`Unsupported file type: .${format}. Use PDF, DOCX or TXT.`)

  if (!blocks.length) throw new Error('That file appears to be empty.')

  return { kind: 'blocks', title, format, blocks }
}

export async function loadDocument(file) {
  const name = file.name || 'Untitled'
  const format = name.split('.').pop().toLowerCase()
  const title = name.replace(/\.[^.]+$/, '')
  const arrayBuffer = await file.arrayBuffer()

  return { document: await loadFromBytes({ arrayBuffer, title, format }), arrayBuffer }
}

export const ACCEPTED = '.pdf,.docx,.txt,.md'