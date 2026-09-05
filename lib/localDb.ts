/**
 * Local, file-backed stand-in for the Supabase server client.
 *
 * This standalone app must NOT read or write the parent project's shared
 * Supabase database. Instead every server-side `createServerClient()` call is
 * routed here, to a schemaless JSON store on disk plus a local file directory
 * for "storage" buckets:
 *
 *   .data/local-db.json      — one array per table
 *   .data/files/<bucket>/…   — uploaded document files
 *
 * Delete the `.data/` directory to start completely fresh.
 *
 * Only a subset of the PostgREST query-builder surface is implemented — the
 * parts the clause/parser pipeline actually uses (`select/insert/update/
 * delete/upsert`, `eq/neq/in/is/not/gt/gte/lt/lte/like/ilike/contains/
 * overlaps/or`, `order/limit/range`, `single/maybeSingle`). Tables that aren't
 * in PERSISTED_TABLES (parent-project tables like `contracts`, `clients`,
 * `service_providers`, the canonical-obligation tables, …) resolve to an
 * empty, non-persisted array so the routes that touch them degrade to "no
 * data" instead of erroring.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- schemaless local store: rows and query values are intentionally dynamic */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'local-db.json');
const FILES_DIR = path.join(DATA_DIR, 'files');

// Tables whose rows are written back to disk. Everything else is ephemeral.
const PERSISTED_TABLES = new Set([
  'documents',
  'clauses',
  'saved_obligations',
  'document_uploads',
]);

type Row = Record<string, any>;
type DB = Record<string, Row[]>;

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
}

function loadDB(): DB {
  ensureDirs();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveDB(db: DB) {
  ensureDirs();
  const persisted: DB = {};
  for (const t of PERSISTED_TABLES) if (db[t]) persisted[t] = db[t];
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(persisted, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ── filter predicates ───────────────────────────────────────────────────────
type Pred = (row: Row) => boolean;

function looseEq(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  return String(a) === String(b);
}

function likeToRegex(pattern: string, flags: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, flags);
}

function cmp(a: any, b: any): number {
  const na = Number(a); const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

function opPred(col: string, op: string, value: any): Pred {
  switch (op) {
    case 'eq': return (r) => looseEq(r[col], value);
    case 'neq': return (r) => !looseEq(r[col], value);
    case 'is': {
      const v = value === 'null' || value === null ? null : value === 'true' ? true : value === 'false' ? false : value;
      return (r) => (v === null ? r[col] == null : r[col] === v);
    }
    case 'in': {
      const arr = Array.isArray(value)
        ? value
        : String(value).replace(/^\(/, '').replace(/\)$/, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      return (r) => arr.some((v: any) => looseEq(r[col], v));
    }
    case 'gt': return (r) => cmp(r[col], value) > 0;
    case 'gte': return (r) => cmp(r[col], value) >= 0;
    case 'lt': return (r) => cmp(r[col], value) < 0;
    case 'lte': return (r) => cmp(r[col], value) <= 0;
    case 'like': return (r) => r[col] != null && likeToRegex(String(value), '').test(String(r[col]));
    case 'ilike': return (r) => r[col] != null && likeToRegex(String(value), 'i').test(String(r[col]));
    case 'contains': {
      const arr = Array.isArray(value) ? value : [value];
      return (r) => Array.isArray(r[col]) && arr.every((v: any) => r[col].includes(v));
    }
    case 'overlaps': {
      const arr = Array.isArray(value) ? value : [value];
      return (r) => Array.isArray(r[col]) && arr.some((v: any) => r[col].includes(v));
    }
    default: return () => true;
  }
}

function parseOr(filterString: string): Pred {
  // "a.eq.1,b.eq.2" → OR of each. No nested and()/or() support (unused here).
  const parts = filterString.split(',').map((s) => s.trim()).filter(Boolean);
  const preds = parts.map((part) => {
    const [col, op, ...rest] = part.split('.');
    return opPred(col, op, rest.join('.'));
  });
  return (r) => preds.some((p) => p(r));
}

// ── query builder ───────────────────────────────────────────────────────────
class QueryBuilder implements PromiseLike<{ data: any; error: any }> {
  private preds: Pred[] = [];
  private orderSpec: { col: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private rangeSpec: { from: number; to: number } | null = null;
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private payload: Row[] = [];
  private onConflict: string[] = ['id'];
  private returnRows = false;
  private singleMode: 'single' | 'maybe' | null = null;
  private headMode = false;
  private wantCount = false;

  constructor(private table: string) {}

  private isPersisted() { return PERSISTED_TABLES.has(this.table); }

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === 'select') { /* initiator */ } else { this.returnRows = true; }
    if (opts?.head) this.headMode = true;
    if (opts?.count) this.wantCount = true;
    return this;
  }
  insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch: Row) { this.op = 'update'; this.payload = [patch]; return this; }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }) {
    this.op = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    if (opts?.onConflict) this.onConflict = opts.onConflict.split(',').map((s) => s.trim());
    return this;
  }
  delete() { this.op = 'delete'; return this; }

  eq(col: string, val: any) { this.preds.push(opPred(col, 'eq', val)); return this; }
  neq(col: string, val: any) { this.preds.push(opPred(col, 'neq', val)); return this; }
  is(col: string, val: any) { this.preds.push(opPred(col, 'is', val)); return this; }
  in(col: string, arr: any[]) { this.preds.push(opPred(col, 'in', arr)); return this; }
  gt(col: string, val: any) { this.preds.push(opPred(col, 'gt', val)); return this; }
  gte(col: string, val: any) { this.preds.push(opPred(col, 'gte', val)); return this; }
  lt(col: string, val: any) { this.preds.push(opPred(col, 'lt', val)); return this; }
  lte(col: string, val: any) { this.preds.push(opPred(col, 'lte', val)); return this; }
  like(col: string, val: any) { this.preds.push(opPred(col, 'like', val)); return this; }
  ilike(col: string, val: any) { this.preds.push(opPred(col, 'ilike', val)); return this; }
  contains(col: string, val: any) { this.preds.push(opPred(col, 'contains', val)); return this; }
  overlaps(col: string, val: any) { this.preds.push(opPred(col, 'overlaps', val)); return this; }
  not(col: string, op: string, val: any) { const p = opPred(col, op, val); this.preds.push((r) => !p(r)); return this; }
  or(filterString: string) { this.preds.push(parseOr(filterString)); return this; }
  filter(col: string, op: string, val: any) { this.preds.push(opPred(col, op, val)); return this; }
  match(obj: Row) { for (const [k, v] of Object.entries(obj)) this.preds.push(opPred(k, 'eq', v)); return this; }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orderSpec = { col, ascending: opts?.ascending !== false };
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  range(from: number, to: number) { this.rangeSpec = { from, to }; return this; }
  single() { this.singleMode = 'single'; return this; }
  maybeSingle() { this.singleMode = 'maybe'; return this; }

  private matched(db: DB): Row[] {
    const rows = db[this.table] || [];
    return rows.filter((r) => this.preds.every((p) => p(r)));
  }

  private shape(rows: Row[]): { data: any; error: any } {
    let out = rows;
    if (this.orderSpec) {
      const { col, ascending } = this.orderSpec;
      out = [...out].sort((a, b) => (ascending ? 1 : -1) * cmp(a[col], b[col]));
    }
    if (this.rangeSpec) out = out.slice(this.rangeSpec.from, this.rangeSpec.to + 1);
    if (this.limitN != null) out = out.slice(0, this.limitN);

    if (this.singleMode === 'single') {
      if (out.length === 1) return { data: out[0], error: null };
      return {
        data: null,
        error: { code: 'PGRST116', message: `Expected exactly one row, got ${out.length}`, details: null, hint: null },
      };
    }
    if (this.singleMode === 'maybe') {
      if (out.length <= 1) return { data: out[0] ?? null, error: null };
      return {
        data: null,
        error: { code: 'PGRST116', message: `Expected at most one row, got ${out.length}`, details: null, hint: null },
      };
    }
    if (this.headMode) return { data: null, error: null, ...(this.wantCount ? { count: out.length } : {}) } as any;
    return { data: out, error: null, ...(this.wantCount ? { count: out.length } : {}) } as any;
  }

  private run(): { data: any; error: any } {
    const db = loadDB();
    if (!db[this.table]) db[this.table] = [];
    const nowIso = new Date().toISOString();

    if (this.op === 'select') return this.shape(this.matched(db));

    if (this.op === 'insert') {
      const inserted = this.payload.map((r) => ({ created_at: nowIso, ...r }));
      db[this.table].push(...inserted);
      if (this.isPersisted()) saveDB(db);
      return this.returnRows ? this.shape(inserted) : { data: null, error: null };
    }

    if (this.op === 'upsert') {
      const affected: Row[] = [];
      for (const r of this.payload) {
        const idx = db[this.table].findIndex((existing) =>
          this.onConflict.every((k) => looseEq(existing[k], r[k])),
        );
        if (idx >= 0) {
          db[this.table][idx] = { ...db[this.table][idx], ...r, updated_at: r.updated_at ?? nowIso };
          affected.push(db[this.table][idx]);
        } else {
          const row = { created_at: nowIso, ...r };
          db[this.table].push(row);
          affected.push(row);
        }
      }
      if (this.isPersisted()) saveDB(db);
      return this.returnRows ? this.shape(affected) : { data: null, error: null };
    }

    if (this.op === 'update') {
      const patch = this.payload[0] || {};
      const hits = this.matched(db);
      for (const row of hits) Object.assign(row, patch);
      if (this.isPersisted()) saveDB(db);
      return this.returnRows ? this.shape(hits) : { data: null, error: null };
    }

    if (this.op === 'delete') {
      const hits = new Set(this.matched(db));
      const removed = db[this.table].filter((r) => hits.has(r));
      db[this.table] = db[this.table].filter((r) => !hits.has(r));
      if (this.isPersisted()) saveDB(db);
      return this.returnRows ? this.shape(removed) : { data: null, error: null };
    }

    return { data: null, error: null };
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    let result: { data: any; error: any };
    try {
      result = this.run();
    } catch (e: any) {
      result = { data: null, error: { message: e?.message || 'local-db error', code: 'LOCAL_DB_ERR' } };
    }
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

// ── storage shim ────────────────────────────────────────────────────────────
async function toBuffer(body: any): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof body?.arrayBuffer === 'function') return Buffer.from(new Uint8Array(await body.arrayBuffer()));
  if (typeof body === 'string') return Buffer.from(body);
  return Buffer.from(String(body ?? ''));
}

function storageBucket(bucket: string) {
  const dir = path.join(FILES_DIR, bucket);
  return {
    async upload(objectPath: string, body: any, _opts?: any) {
      try {
        ensureDirs();
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, objectPath.replace(/^\/+/, ''));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, await toBuffer(body));
        return { data: { path: objectPath, id: objectPath, fullPath: `${bucket}/${objectPath}` }, error: null };
      } catch (e: any) {
        return { data: null, error: { message: e?.message || 'upload failed' } };
      }
    },
    async list(prefix?: string, opts?: { limit?: number; search?: string }) {
      try {
        if (!fs.existsSync(dir)) return { data: [], error: null };
        let names = fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile());
        if (prefix) names = names.filter((n) => n.startsWith(prefix));
        if (opts?.search) names = names.filter((n) => n.includes(opts.search!));
        if (opts?.limit) names = names.slice(0, opts.limit);
        const data = names.map((name) => {
          const st = fs.statSync(path.join(dir, name));
          return {
            name,
            id: name,
            updated_at: st.mtime.toISOString(),
            created_at: st.birthtime.toISOString(),
            last_accessed_at: st.atime.toISOString(),
            metadata: { size: st.size },
          };
        });
        return { data, error: null };
      } catch (e: any) {
        return { data: null, error: { message: e?.message || 'list failed' } };
      }
    },
    getPublicUrl(objectPath: string) {
      return { data: { publicUrl: `/api/local-storage/${bucket}/${objectPath.replace(/^\/+/, '')}` } };
    },
    async createSignedUrl(objectPath: string) {
      return { data: { signedUrl: `/api/local-storage/${bucket}/${objectPath.replace(/^\/+/, '')}` }, error: null };
    },
    async download(objectPath: string) {
      try {
        const buf = fs.readFileSync(path.join(dir, objectPath.replace(/^\/+/, '')));
        return { data: new Blob([buf]), error: null };
      } catch (e: any) {
        return { data: null, error: { message: e?.message || 'not found' } };
      }
    },
    async remove(paths: string[]) {
      const removed: any[] = [];
      for (const p of paths) {
        try { fs.unlinkSync(path.join(dir, p.replace(/^\/+/, ''))); removed.push({ name: p }); } catch { /* ignore */ }
      }
      return { data: removed, error: null };
    },
  };
}

// ── client ──────────────────────────────────────────────────────────────────
export interface LocalClient {
  from(table: string): QueryBuilder;
  rpc(name: string, args?: any): PromiseLike<{ data: any; error: any }>;
  storage: { from(bucket: string): ReturnType<typeof storageBucket> };
  auth: {
    getUser(): Promise<{ data: { user: any }; error: any }>;
    getSession(): Promise<{ data: { session: any }; error: any }>;
  };
}

export function createServerClient(): LocalClient {
  return {
    from: (table: string) => new QueryBuilder(table),
    rpc: (_name: string, _args?: any) =>
      Promise.resolve({ data: null, error: { message: 'rpc not supported in local mode', code: 'LOCAL_NO_RPC' } }),
    storage: { from: storageBucket },
    auth: {
      getUser: async () => ({ data: { user: { id: 'local-user', email: 'local@localhost' } }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: 'local-user' } } }, error: null }),
    },
  };
}

export { DATA_DIR, DB_FILE, FILES_DIR };
