# Dynamic Hypertext with Generative AI

A reading tool that replaces static, author-defined hyperlinks with dynamic,
reader-defined ones. The reader selects any passage of a document and chooses
what kind of elaboration they want; the response is generated on demand and
grounded in the surrounding text.

This is version 0.1 — the core interaction working end to end on the three
target formats.

## Running it

You need Node 22.5 or newer (the persistence server uses Node's built-in
`node:sqlite`, which needs that version).

```bash
npm install
cp .env.example .env
```

Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey)
and paste it into `.env` as `GEMINI_API_KEY`. Then:

```bash
npm run dev
```

This starts two processes together: the Vite dev server (port 5173) and the
persistence server (port 5175, storing to `data/app.db`). Open
http://localhost:5173 and load a PDF, DOCX, or TXT file.

To run them separately: `npm run dev:client` and `npm run dev:server`.

**If you get a "model not found" error**, the model name in `.env` is out of
date. Free-tier model names change; check the current one in AI Studio and
update `GEMINI_MODEL`.

## How the key is handled

The API key is read by the Vite dev server (Node side) and attached to the
request there. The browser calls `/api/generate`, which the dev server
proxies to Gemini. The key is never bundled into client JavaScript.

`.env` is gitignored. Do not commit it.

This arrangement works for local development. A deployed version would need
a small backend doing the same job — the persistence server (below) already
is one, so the two could merge at deploy time.

## Annotation persistence

Highlights and their AI responses are saved so a document you open again is
restored the way you left it — no accounts, no login:

- **Document identity** is the SHA-256 hash of the file's bytes, computed in
  the browser. Reopening the same file, even renamed, matches its saved
  record; a different file never collides with it.
- **Reader identity** is a random ID generated once and kept in
  `localStorage` (`src/core/readerId.js`). It scopes annotations so two
  people opening the same paper don't see each other's notes.
- The **persistence server** (`server/`) is a small standalone Express +
  `node:sqlite` process, separate from Vite, proxied at `/api/documents` and
  `/api/annotations` (see `vite.config.js`). Data lives in `data/app.db`
  (gitignored).
- If the persistence server is down, reading and prompting still work — it's
  a stretch feature layered on top, not a dependency of the core flow. Saves
  and lookups fail silently to the console in that case.

## How it works

```
 file upload
     ↓
 adapters/          text formats -> blocks[]; PDF -> the pdf.js document
     ↓
 Reader/PdfReader   flowing text, or real pages + text layer;
                    both capture the selection and its surrounding text
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
│   ├── llmClient.js      provider-agnostic model client
│   ├── hash.js           SHA-256 of a file's bytes (document identity)
│   ├── readerId.js       anonymous per-browser reader ID
│   └── persistence.js    client for the persistence API
├── adapters/             one loader per document format
├── components/           the reading interface
└── App.jsx               wiring

server/                   standalone persistence server (Express + node:sqlite)
├── index.js               /api/documents/lookup, /api/annotations routes
└── db.js                  schema + queries
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
- PDFs render as real pages - original layout, columns, figures and equations
  intact - with a selectable text layer on top
- Select any passage; six operations to choose from
- Prompts grounded in the selected passage plus surrounding paragraphs
- Responses accumulate in a margin rail, saved as they're generated
- Reopening a previously-seen document restores its saved highlights/responses
- Visible notice that responses are AI-generated and may be wrong

Not yet:

- **Voice output.** Text only for now.
- **Scanned PDFs.** These have no text layer and would need OCR. The app
  detects this when the file is opened and says so rather than failing silently.

## Known rough edges

- DOCX loading uses raw text extraction, so tables and complex formatting are
  flattened. Only PDFs keep their original layout.
- PDF pages render at a fixed zoom. There is no zoom control yet.
- Free-tier rate limits will bite if you fire many operations quickly. The
  app surfaces a clear message when that happens.
