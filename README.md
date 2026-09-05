# Clause Repository & Extraction Pipeline

Full-stack clause repository that transforms uploaded contracts into structured,
searchable provisions through **deterministic rule-based segmentation** and
**LLM-powered classification and summarization**. Supports difficult-to-read
scanned PDFs through LlamaParse OCR and includes a dual-mode viewer connecting
each extracted clause to its highlighted location in the original file.

> Extracted as a standalone module from a larger legal-tech compliance platform.
> The document-parsing and clause-repository surface is preserved here verbatim,
> together with every server route and library it depends on.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS 4 |
| Database | PostgreSQL (via Supabase) |
| Structural extraction | Deterministic rule-based segmenter (`lib/ruleBasedExtractor.ts`) + LlamaParse (LlamaIndex Cloud) OCR for scanned PDFs |
| Classification / summarization | Groq (`llama-3.3-70b-versatile`), Mistral failover, CUAD signature-based fallback when the LLM is rate-limited or offline |
| File parsing | `unpdf` (PDF), `mammoth` (DOCX), `xlsx` (spreadsheets) |

---

## What it does

1. **Upload & text extraction** — PDF / DOCX / TXT is uploaded through
   `DocumentUploadModal`. Raw text is pulled for a live preview; an AI-suggest
   step pre-fills title / entity / counterparty.
2. **Structural clause segmentation** — a deterministic extractor splits the
   document at top-level section boundaries using a catalog of ~22 numbering
   schemas (`1.`, `1.1`, `(a)`, `Article I`, all-caps headings, …). Scanned or
   image-only PDFs are routed through **LlamaParse OCR** first.
3. **LLM classification & summarization** — each clause is classified into one
   of ~155 canonical clause types (CUAD-derived taxonomy) with a per-instance
   description, bound affiliates, and a confidence score. On a `429` or any
   error the pipeline falls back to a TF-IDF keyword-signature classifier so
   extraction never hard-fails.
4. **Persistence** — clauses are written to PostgreSQL with deterministic IDs;
   re-extraction replaces rather than accumulates. Optional columns are stripped
   and retried on schema mismatch so a missing migration never breaks the insert.
5. **Obligation extraction** — clauses are further decomposed into atomic
   obligation units (`lib/obligations/*`).
6. **Clause Explorer / Document Parser UI** — browse, filter, and review every
   extracted clause across all documents; a dual-mode viewer links each clause
   back to its highlighted span in the source file.

A full technical walkthrough is in [`CLAUSE-EXTRACTOR-OVERVIEW.txt`](./CLAUSE-EXTRACTOR-OVERVIEW.txt).

---

## Key source files

| Path | Role |
|---|---|
| `lib/ruleBasedExtractor.ts` | Deterministic clause segmentation, numbering-schema catalog, text normalization |
| `lib/clauses/segmentAtomicUnits.ts` | Splits a clause into atomic sub-units |
| `lib/clauseTypes.ts` | 155-type canonical taxonomy, TF-IDF fallback signatures, LLM classification hints |
| `lib/clauses/classifyClauseForms.ts` | Clause-form classification |
| `lib/groq.ts` | Groq client + Mistral failover wrapper |
| `lib/documents/processDocumentUpload.ts` | End-to-end upload → extract → classify orchestration |
| `lib/obligations/*` | Clause → obligation-unit decomposition and read/ingest |
| `lib/extractText.ts` | PDF / DOCX / TXT text extraction |
| `app/api/documents/extract/route.ts` | Upload file, persist document, trigger pipeline |
| `app/api/documents/extract-clauses-llama/route.ts` | LlamaParse OCR + structural extraction |
| `app/api/documents/classify-clauses/route.ts` | Groq / CUAD classification, persist to `clauses` |
| `app/api/documents/clauses/route.ts` | CRUD for the `clauses` table |
| `app/api/documents/[document_id]/extract-obligations/route.ts` | Obligation extraction |
| `app/(app)/documents/page.tsx` | Clause Explorer + Document Parser UI (`ClauseExplorerTab`, `ObligationsTab`) |
| `app/(app)/documents/parser/page.tsx` | Standalone Document Parser route |
| `components/upload/DocumentUploadModal.tsx` | Upload + metadata form |
| `scripts/*.sql` | PostgreSQL schema and migrations |

---

## Getting started

### Prerequisites

- Node.js 18+
- A PostgreSQL database (a Supabase project is the intended setup)
- A Groq API key and a Mistral API key (both required at boot)
- A LlamaIndex Cloud key (optional — only the scanned-PDF OCR path needs it)

### Setup

```bash
npm install
cp .env.example .env.local   # then fill in the values
```

Required in `.env.local` (validated at server startup by `lib/env.ts`):

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GROQ_API_KEY=
MISTRAL_API_KEY=
# optional
LLAMA_CLOUD_API_KEY=
BULK_PROCESS_SECRET=      # required for server-to-server clause classification
```

### Database

Apply the SQL in `scripts/` to your database, starting with `schema.sql` and the
`add-clauses-table.sql` / `add-obligations-*.sql` / `add-compliance-*.sql`
migrations. The clause/obligation-relevant scripts are prefixed `add-clause*`,
`add-obligation*`, `create-*obligation*`, and `add-canonical-obligation-*`.

### Run

```bash
npm run dev
```

Open <http://localhost:3000/documents/parser> (Document Parser) or
<http://localhost:3000/documents?tab=clause-table> (Clause Library).

---

## Notes on the extraction

- **Deterministic first.** Clause boundaries are found by rule, not by the LLM —
  the model only classifies and summarizes text that has already been segmented.
- **The LLM is never load-bearing for availability.** Every LLM call has a
  deterministic fallback (CUAD keyword signatures, `detected_type` preserved from
  the rule-based pass).
- **User edits win.** A manually corrected clause type is never overwritten by a
  later classification run.

---

## Provenance

Copied verbatim from the parent codebase — no implementation code was modified in
the extraction. Sidebar navigation contains links to sibling modules
(clients, workers, playbooks, …) that are not part of this repository; those
routes 404 by design. The root route redirects to `/home`, which is likewise not
included — use the URLs above.
