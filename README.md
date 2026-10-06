# Dynamic Hypertext with Generative AI

A reading tool that replaces static, author-defined hyperlinks with dynamic,
reader-defined ones. The reader selects any passage of a document and chooses
what kind of elaboration they want; the response is generated on demand and
grounded in the surrounding text.

The point is the *menu*. Where comparable tools offer a single "explain this"
action, this one asks the reader what kind of help they want — and the choices
reach past definition and summary into decomposition, assumptions and
counter-argument. That bias is the project's argument, not a stylistic
preference.

MSc dissertation project, University of York Europe Campus.

## Running it

Needs **Node 24 or newer** — the server uses `node:sqlite`, which is unflagged
from Node 23.4.

```bash
npm install
cp .env.example .env
```

```bash
npm run dev
```

That starts two processes: Vite on **5173** and the accounts server on
**5175**. Open http://localhost:5173 and load a PDF, DOCX or TXT file.

**If `/api/...` calls start returning 404 or the page's own HTML**, the Vite
dev server has gone stale — usually after a branch switch. It is the proxy,
not your credentials. Restart it:

```bash
pkill -f "npm run dev" && npm run dev
```

**If you get a "model not found" error**, the model name in `.env` is out of
date. Free-tier model names change; check the current one in AI Studio and
update `GEMINI_MODEL`.


## How the key is handled

The API key is read by the Vite dev server (Node side) and attached to the
request there. The browser calls `/api/generate`, which the dev server proxies
to Gemini. The key is never bundled into client JavaScript, and nothing
prefixed `VITE_` is used for it — those end up in the client bundle.

`.env` is gitignored. Do not commit it.

**This only works in development.** The proxy lives in `vite.config.js`, so
`npm run build` produces a `dist/` with no backend and no way to answer a
question. Deploying would mean moving that proxy into the Express server that
already exists for accounts.

## How it works

```
 file upload
     ↓
 adapters/          text formats -> typed blocks[]; PDF -> the pdf.js document
     ↓
 Reader/PdfReader   a paper sheet, or real pages + text layer;
                    both capture the selection and its surrounding text
     ↓
 core/promptBuilder selection + context + document details -> prompt
     ↓
 core/llmClient     provider-agnostic; Gemini behind the interface
     ↓
 ResponseRail       answers in the margin, tied to the passage that made them
```


### Project layout

```
src/
├── core/                 host-independent logic
│   ├── operations.js     the menu of reader-chosen actions
│   ├── promptBuilder.js  how a selection becomes a prompt
│   ├── llmClient.js      provider-agnostic model client
│   └── api.js            client for the accounts server
├── adapters/             one loader per document format
├── components/           the reading interface
└── App.jsx               wiring

server/                   accounts, library and annotations (Express + SQLite)
public/fonts/             self-hosted, so the page calls no third party
```

`core/` deliberately knows nothing about React or the browser chrome. A
browser-extension version would reuse it unchanged and supply a different host
layer.

### Adding things

- **An operation**: add one entry to `src/core/operations.js`. Nothing else changes.
- **A format**: add a loader in `src/adapters/index.js` that returns typed blocks.
- **A provider**: add a function in `src/core/llmClient.js` and change the export.

## What is and isn't in this version

In:

- Read PDF, DOCX and TXT. PDFs render as real pages — layout, columns, figures
  and equations intact — with a selectable text layer on top. DOCX keeps its
  headings and tables as structure.
- Select any passage; six operations to choose from.
- Prompts grounded in the selected passage plus its surrounding context.
- **Optional accounts.** A library of what you have opened, and the highlights
  and answers you made on it, restored when you open the document again.
- A reopened document comes back marked up; clicking a mark opens the answer
  that passage produced.
- Guest mode works fully, with nothing saved.
- Visible notice that responses are AI-generated and may be wrong.


