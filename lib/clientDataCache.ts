'use client';

// Documents and clauses are fetched in bulk from several independent
// components (the app layout, Contracts, Document Parser, Insurance, and
// both Clause Library pages) — each used to fire its own full-table request
// on mount, so hopping between them repeated the same DB round trip several
// times in a row. These helpers coalesce concurrent/near-simultaneous reads
// into one shared, short-lived cache instead.
//
// A short TTL (rather than manual invalidation tracked at every write site)
// is the correctness mechanism: worst case a caller sees data that's up to
// TTL_MS stale, which is a non-issue for list views a user is casually
// browsing. Call sites that just wrote new data and need it back immediately
// call invalidate*() first so the very next read is guaranteed fresh.

const TTL_MS = 15_000;

let docsCache: { data: any[]; ts: number } | null = null;
let docsInflight: Promise<any[]> | null = null;

export function fetchDocumentsCached(): Promise<any[]> {
  const now = Date.now();
  if (docsCache && now - docsCache.ts < TTL_MS) return Promise.resolve(docsCache.data);
  if (docsInflight) return docsInflight;
  docsInflight = fetch('/api/documents')
    .then(r => r.json())
    .then(d => {
      const docs = d.documents || [];
      docsCache = { data: docs, ts: Date.now() };
      docsInflight = null;
      return docs;
    })
    .catch(err => { docsInflight = null; throw err; });
  return docsInflight;
}

export function invalidateDocumentsCache() {
  docsCache = null;
}

let clausesCache: { data: any[]; ts: number } | null = null;
let clausesInflight: Promise<any[]> | null = null;

export function fetchClausesCached(): Promise<any[]> {
  const now = Date.now();
  if (clausesCache && now - clausesCache.ts < TTL_MS) return Promise.resolve(clausesCache.data);
  if (clausesInflight) return clausesInflight;
  clausesInflight = fetch('/api/documents/clauses')
    .then(r => r.json())
    .then(d => {
      const clauses = d.clauses || [];
      clausesCache = { data: clauses, ts: Date.now() };
      clausesInflight = null;
      return clauses;
    })
    .catch(err => { clausesInflight = null; throw err; });
  return clausesInflight;
}

export function invalidateClausesCache() {
  clausesCache = null;
}
