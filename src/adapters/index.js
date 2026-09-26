/**
 * Document adapters.
 *
 * Text formats (TXT, DOCX) collapse to an ordered list of blocks and are
 * read as flowing paragraphs:
 *
 *   { kind: 'blocks', title, format, blocks: string[] }
 *
 * PDF keeps its own pdf.js document instead of being flattened to text.
 * Flattening loses columns, figures, tables and equations - the layout is
 * part of what the reader is looking at, not just the words - so PDF pages
 * are drawn to canvas and read through a real pdf.js document:
 *
 *   { kind: 'pdf', title, format, pdf: PDFDocumentProxy }
 *
 * `App.jsx` branches on `kind` to choose `Reader` or `PdfReader`. Adding a
 * text-like format (HTML, Markdown) means adding one more `kind: 'blocks'`
 * loader here; a format that needs its own layout would get its own `kind`,
 * the way PDF did.
 */

import mammoth from 'mammoth/mammoth.browser'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

function toBlocks(raw) {
  return raw
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .filter((b) => b.length > 0)
}

function loadTxt(arrayBuffer) {
  return toBlocks(new TextDecoder().decode(arrayBuffer))
}

async function loadDocx(arrayBuffer) {
  const { value } = await mammoth.extractRawText({ arrayBuffer })
  // mammoth separates paragraphs with single newlines
  return value
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
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
