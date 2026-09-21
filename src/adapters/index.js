/**
 * Document adapters.
 *
 * Each supported format has one small adapter, and all of them produce the
 * same shape:
 *
 *   { title, format, blocks: string[] }
 *
 * Because every format collapses to an ordered list of text blocks, the
 * reading surface, the selection handling, and everything downstream are
 * written once and work for all three. Adding a format (HTML, EPUB, Markdown)
 * means adding one adapter here.
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

async function loadTxt(file) {
  const raw = await file.text()
  return toBlocks(raw)
}

async function loadDocx(file) {
  const arrayBuffer = await file.arrayBuffer()
  const { value } = await mammoth.extractRawText({ arrayBuffer })
  // mammoth separates paragraphs with single newlines
  return value
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
}

async function loadPdf(file) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const pageTexts = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()

    // Rebuild lines from positioned text items, then join lines into
    // paragraphs. PDF text has no paragraph structure of its own, so this
    // is a reconstruction rather than a faithful reading of the layout.
    let line = ''
    const lines = []
    let lastY = null

    for (const item of content.items) {
      const y = item.transform[5]
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        if (line.trim()) lines.push(line.trim())
        line = ''
      }
      line += item.str
      if (item.hasEOL) line += ' '
      lastY = y
    }
    if (line.trim()) lines.push(line.trim())

    pageTexts.push(lines.join('\n'))
  }

  const joined = pageTexts.join('\n\n')
  if (!joined.trim()) {
    throw new Error(
      'No selectable text found in this PDF. It is probably a scanned image, ' +
      'which would need OCR to read.'
    )
  }

  // Merge lines into paragraphs: a line that does not end a sentence is
  // treated as continuing the one before it.
  const blocks = []
  let current = ''
  for (const ln of joined.split('\n')) {
    const t = ln.trim()
    if (!t) {
      if (current) { blocks.push(current.trim()); current = '' }
      continue
    }
    current += (current ? ' ' : '') + t
    if (/[.!?:;]["')\]]?$/.test(t) && current.length > 120) {
      blocks.push(current.trim())
      current = ''
    }
  }
  if (current.trim()) blocks.push(current.trim())

  return blocks.filter((b) => b.length > 0)
}

export async function loadDocument(file) {
  const name = file.name || 'Untitled'
  const ext = name.split('.').pop().toLowerCase()

  let blocks
  if (ext === 'txt' || ext === 'md') blocks = await loadTxt(file)
  else if (ext === 'docx') blocks = await loadDocx(file)
  else if (ext === 'pdf') blocks = await loadPdf(file)
  else throw new Error(`Unsupported file type: .${ext}. Use PDF, DOCX or TXT.`)

  if (!blocks.length) throw new Error('That file appears to be empty.')

  return {
    title: name.replace(/\.[^.]+$/, ''),
    format: ext,
    blocks,
  }
}

export const ACCEPTED = '.pdf,.docx,.txt,.md'
