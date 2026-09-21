# Dynamic Hypertext with Generative AI

A reading tool that replaces static, author-defined hyperlinks with dynamic,
reader-defined ones. The reader selects any passage of a document and chooses
what kind of elaboration they want; the response is generated on demand and
grounded in the surrounding text.

This is version 0.1 — the core interaction working end to end on the three
target formats.

## Running it

You need Node 18 or newer.

```bash
npm install
cp .env.example .env
```

Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey)
and paste it into `.env` as `GEMINI_API_KEY`. Then:

```bash
npm run dev
```

Open http://localhost:5173 and load a PDF, DOCX, or TXT file.

**If you get a "model not found" error**, the model name in `.env` is out of
date. Free-tier model names change; check the current one in AI Studio and
update `GEMINI_MODEL`.

## How the key is handled

The API key is read by the Vite dev server (Node side) and attached to the
request there. The browser calls `/api/generate`, which the dev server
proxies to Gemini. The key is never bundled into client JavaScript.

`.env` is gitignored. Do not commit it.

This arrangement works for local development. A deployed version would need
a small backend doing the same job.

## How it works

```
 file upload
     ↓
 adapters/          one per format; all produce { title, format, blocks[] }
     ↓
 Reader             renders blocks, captures selection + surrounding blocks
     ↓
 core/promptBuilder selection + context + document details → prompt
     ↓
 core/llmClient     provider-agnostic; Gemini behind the interface
     ↓
 ResponseRail       responses accumulate in the margin
```

### Project layout

```
src/
├── core/                 host-independent logic
│   ├── operations.js     the menu of reader-chosen actions
│   ├── promptBuilder.js  how a selection becomes a prompt
│   └── llmClient.js      provider-agnostic model client
├── adapters/             one loader per document format
├── components/           the reading interface
└── App.jsx               wiring
```

`core/` deliberately knows nothing about React or the browser chrome. A
browser-extension version would reuse it unchanged and supply a different
host layer.

### Adding things

- **An operation**: add one entry to `src/core/operations.js`. Nothing else changes.
- **A format**: add a loader in `src/adapters/index.js` that returns `blocks[]`.
- **A provider**: add a function in `src/core/llmClient.js` and change the export.

## What is and isn't in this version

In:

- Upload and read PDF, DOCX, TXT
- Select any passage; six operations to choose from
- Prompts grounded in the selected passage plus surrounding paragraphs
- Responses accumulate in a margin rail for the session
- Visible notice that responses are AI-generated and may be wrong

Not yet:

- **Annotation persistence across sessions.** The rail is session-only.
- **Voice output.** Text only for now.
- **True PDF text-layer rendering.** PDFs are currently read by extracting
  their text and re-rendering it as paragraphs, so the original page layout,
  figures, and columns are not preserved. Position-accurate highlighting on a
  rendered PDF page is a larger piece of work.
- **Scanned PDFs.** These have no text layer and would need OCR. The app
  detects this and says so rather than failing silently.

## Known rough edges

- Paragraph reconstruction from PDFs is heuristic. Multi-column papers and
  heavy mathematical notation will come out imperfectly.
- DOCX loading uses raw text extraction, so tables and complex formatting are
  flattened.
- Free-tier rate limits will bite if you fire many operations quickly. The
  app surfaces a clear message when that happens.
