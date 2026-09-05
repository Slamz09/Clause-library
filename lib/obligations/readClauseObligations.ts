// ─── Read the structured atomic obligations linked to a clause ──────────────
// Shared by GET /api/clauses/[clause_id]/obligations (full detail, with
// applicability) and the clause-list enrichment in
// GET /api/documents/clauses (counts + effect summary only).

import { createServerClient } from '@/lib/supabaseServer';
import { resolveApplicabilityCounts, type ObligationApplicability } from './applicabilityBuilder';

type SbClient = ReturnType<typeof createServerClient>;

export interface AtomicObligationView {
  id: string;
  requirement_effect: string | null;
  derivation: string | null;
  obligation_kind: string | null;
  requirement_summary: string | null;
  requirement_terms: Record<string, unknown> | null;
  obligated_role: string | null;
  confidence: number | null;
  resolution_status: string | null;
  topic: { id: string; key: string | null; label: string | null } | null;
  source: {
    document_id: string | null;
    clause_id: string | null;
    clause_unit_id: string | null;
    source_excerpt: string | null;
    source_subsection: string | null;
    provenance_role: string | null;
    resolution_role: string | null;
    resolution_basis: string | null;
    resolution_reason: string | null;
  } | null;
  applicability?: ObligationApplicability;
}

export async function readObligationsForClause(
  sb: SbClient,
  clauseId: string,
  opts: { withApplicability?: boolean } = {},
): Promise<AtomicObligationView[]> {
  const { data: sources } = await sb
    .from('canonical_obligation_sources')
    .select('*')
    .eq('clause_id', clauseId);
  if (!sources?.length) return [];

  const obIds = [...new Set(sources.map((s: any) => s.canonical_obligation_id))];
  const { data: obs } = await sb.from('canonical_obligations').select('*').in('id', obIds);
  if (!obs?.length) return [];

  const topicIds = [...new Set(obs.map((o: any) => o.topic_id).filter(Boolean))];
  const topicById = new Map<string, any>();
  if (topicIds.length) {
    const { data: topics } = await sb.from('obligation_topic_definitions').select('id, topic_key, label').in('id', topicIds);
    for (const t of topics || []) topicById.set(t.id, t);
  }

  // Prefer the source row that actually belongs to this clause.
  const srcForOb = (obId: string) =>
    sources.find((s: any) => s.canonical_obligation_id === obId && s.clause_id === clauseId) ||
    sources.find((s: any) => s.canonical_obligation_id === obId) ||
    null;

  const views: AtomicObligationView[] = [];
  for (const o of obs as any[]) {
    const src = srcForOb(o.id);
    const topic = o.topic_id ? topicById.get(o.topic_id) : null;
    const view: AtomicObligationView = {
      id: o.id,
      requirement_effect: o.requirement_effect ?? null,
      derivation: o.derivation ?? null,
      obligation_kind: o.obligation_kind ?? null,
      requirement_summary: o.requirement_summary ?? null,
      requirement_terms: o.requirement_terms ?? null,
      obligated_role: o.obligated_role ?? null,
      confidence: typeof o.confidence === 'number' ? o.confidence : null,
      resolution_status: o.resolution_status ?? null,
      topic: topic ? { id: topic.id, key: topic.topic_key ?? null, label: topic.label ?? null } : null,
      source: src
        ? {
            document_id: src.document_id ?? null,
            clause_id: src.clause_id ?? null,
            clause_unit_id: src.clause_unit_id ?? null,
            source_excerpt: src.source_excerpt ?? null,
            source_subsection: src.source_subsection ?? null,
            provenance_role: src.provenance_role ?? null,
            resolution_role: src.resolution_role ?? null,
            resolution_basis: src.resolution_basis ?? null,
            resolution_reason: src.resolution_reason ?? null,
          }
        : null,
    };
    if (opts.withApplicability) {
      view.applicability = await resolveApplicabilityCounts(sb, o.id);
    }
    views.push(view);
  }
  // Explicit obligations first, then derived; stable within each by summary.
  views.sort((a, b) => {
    const da = a.derivation === 'derived' ? 1 : 0;
    const db = b.derivation === 'derived' ? 1 : 0;
    if (da !== db) return da - db;
    return (a.requirement_summary || '').localeCompare(b.requirement_summary || '');
  });
  return views;
}

// Lightweight per-clause summary for the clause-list table (no applicability
// resolution — just what the row badge / "open panel" decision needs).
export interface ClauseObligationSummary {
  count: number;
  effects: string[];        // distinct requirement_effect values across linked obligations
  has_derived: boolean;
  has_explicit: boolean;
}

export async function summarizeObligationsByClause(
  sb: SbClient,
  clauseIds: string[],
): Promise<Map<string, ClauseObligationSummary>> {
  const out = new Map<string, ClauseObligationSummary>();
  if (!clauseIds.length) return out;

  const { data: sources } = await sb
    .from('canonical_obligation_sources')
    .select('clause_id, canonical_obligation_id')
    .in('clause_id', clauseIds);
  if (!sources?.length) return out;

  const obIds = [...new Set(sources.map((s: any) => s.canonical_obligation_id))];
  // select('*') rather than named columns so this still works before
  // add-canonical-obligation-effect-derivation.sql adds requirement_effect /
  // derivation (a named select on a missing column errors out entirely).
  const { data: obs } = await sb
    .from('canonical_obligations')
    .select('*')
    .in('id', obIds);
  const obById = new Map<string, any>((obs || []).map((o: any) => [o.id, o]));

  for (const s of sources as any[]) {
    const ob = obById.get(s.canonical_obligation_id);
    if (!ob) continue;
    const cur = out.get(s.clause_id) || { count: 0, effects: [], has_derived: false, has_explicit: false };
    cur.count += 1;
    if (ob.requirement_effect && !cur.effects.includes(ob.requirement_effect)) cur.effects.push(ob.requirement_effect);
    if (ob.derivation === 'derived') cur.has_derived = true;
    else cur.has_explicit = true;
    out.set(s.clause_id, cur);
  }
  return out;
}
