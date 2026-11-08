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


**If you get a "model not found" error**, the model name in `.env` is out of
date. check the current one in AI Studio and
update `GEMINI_MODEL`.



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



### Adding things

- **An operation**: add one entry to `src/core/operations.js`. Nothing else changes.
- **A format**: add a loader in `src/adapters/index.js` that returns typed blocks.
- **A provider**: add a function in `src/core/llmClient.js` and change the export.




