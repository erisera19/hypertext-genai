# CLAUDE.md

Reader-driven hypertext tool. A reader selects any passage of a document and
chooses what kind of elaboration they want; a language model generates the
response, grounded in the surrounding text.

This is dissertation work (MSc, University of York Europe Campus). Design
decisions need to be defensible and documented, not just working.

## Commands

```bash
npm install          # first run
npm run dev          # runs Vite (5173) + persistence server (5175) together
npm run dev:client   # Vite only
npm run dev:server   # persistence server only
npm run build        # production build - run this before saying work is done
```

There is no test suite yet. Verify changes by running `npm run build` and by
loading a real document in the dev server. To check the persistence server on
its own, curl `/api/documents/lookup` and `/api/annotations` directly against
`http://localhost:5175` (see `server/index.js`).

## Architecture

```
src/
├── core/                 host-independent; no React, no DOM
│   ├── operations.js     the menu of reader-chosen actions
│   ├── promptBuilder.js  selection + context + metadata -> prompt
│   ├── llmClient.js      provider-agnostic model client
│   ├── hash.js           SHA-256 of a file's bytes (document identity)
│   ├── readerId.js       anonymous per-browser reader ID (localStorage)
│   └── persistence.js    fetch wrapper for the persistence API
├── adapters/index.js     file -> { kind: 'blocks' | 'pdf', ... }
├── components/
│   ├── Reader.jsx        TXT/DOCX: flowing paragraphs
│   ├── PdfReader.jsx     PDF: canvas pages + pdf.js text layer
│   ├── SelectionMenu.jsx floating operations menu
│   └── ResponseRail.jsx  margin notes
└── App.jsx               branches on doc.kind, owns state

server/                   standalone Express + node:sqlite process
├── index.js              routes; proxied by Vite at /api/documents, /api/annotations
└── db.js                 schema (documents, annotations) + queries
```

`core/` must stay free of React and browser-chrome concerns. A browser
extension is planned as a later host that reuses it unchanged. Do not import
React or reach for `window`/`document` inside `core/`. `src/core/persistence.js`
is the one exception that uses `fetch` and `localStorage` (via `readerId.js`) -
both are available in an extension content script too, so this still holds.

## Annotation persistence

A document is identified by the SHA-256 hash of its file bytes
(`src/core/hash.js`), not filename - re-uploading the same file matches its
saved record regardless of name. A reader is identified by a random ID
generated once into `localStorage` (`src/core/readerId.js`) - there are no
accounts; this only keeps two people's notes on the same paper from mixing.

Flow: `App.jsx` hashes the file on open, calls `lookupDocument()`, and seeds
`items` from what comes back (status `'done'`, `savedId` set from the row
id). Each successful `generate()` call is followed by `saveAnnotation()`,
which patches the item with its new `savedId`. `dismiss()` deletes both
locally and (if `savedId` is set) server-side.

**Persistence must never block the core flow.** Every persistence call is
wrapped so a failure (server down, network error) only `console.warn`s -
reading and prompting keep working without it. Do not let a persistence
error propagate into `loadError` or an item's `status: 'error'`.

`node:sqlite` (not `better-sqlite3`) - the native module fails to build
against current Node/V8. This raises the minimum Node version to 22.5+.

## Rules

**Never move the API key client-side.** It is read by the Vite dev server in
`vite.config.js` and attached to the proxied request. The browser calls
`/api/generate` and never sees the key. Do not use `VITE_` prefixed env vars
for it - those get bundled into client JS. Never commit `.env`.

**Two rendering paths are intentional. Do not unify them.** Text formats
collapse to paragraphs; PDFs keep their real layout because losing columns,
figures and equations made the tool unusable on actual papers. They also
extract context differently:

- `Reader.jsx` - walks up to `[data-block]`, takes neighbouring blocks
- `PdfReader.jsx` - walks text nodes to get a character offset in the page,
  takes a character window around it

**Check `=== null`, not falsiness, for block indices.** Block 0 is a valid
index. `if (!startIdx)` silently breaks every selection in a document's first
paragraph.

**Position the selection menu in `useLayoutEffect` only.** A passive
`useEffect` that also touches position state will run afterwards and undo it -
this exact bug made the menu permanently invisible once.

## Extending

- **New operation**: one entry in `src/core/operations.js`. Nothing else.
- **New text format**: one loader in `adapters/index.js` returning `blocks[]`.
- **New provider**: one function in `llmClient.js`, change the export.

Keep operations weighted toward analysis, comparison and example-generation
rather than only summary and definition - that bias is the project's argument,
not a stylistic choice.

## pdf.js notes

Version 4.x. `renderTextLayer` no longer exists; use the `TextLayer` class:
`new TextLayer({ textContentSource, container, viewport })` then `.render()`.
The container needs `--scale-factor` set to the viewport scale or the text
layer will be misaligned. Cancel in-flight `page.render()` tasks on cleanup -
React StrictMode double-invokes effects and concurrent renders on one canvas
will throw.

## Status

Working: three formats, six operations, context-grounded prompts, real PDF
page rendering with selection, response rail with cross-session persistence
(reopening a previously-seen file restores its saved notes).

Not built: voice output (text-to-speech), zoom control for PDF pages,
follow-up questions on a response, streaming responses, OCR for scanned PDFs,
any deployment story beyond the dev server (two local dev processes, SQLite
file on disk).

Voice output is a stretch objective - do not start it unless asked.