import type { RegulatorySourceExtraction } from '@/lib/documents/classifyRegulatorySource';

// ─── Deterministic regulatory-source identity/dedup ─────────────────────────
// Answers "is this the SAME law as one we already have, a NEW VERSION of one
// we have, a POSSIBLE duplicate that needs a human to confirm, or a genuinely
// new regulatory source?" — deterministic string comparison, not an LLM
// judgment call, for the same reason resolveCompanyEntity.ts is: a wrong
// auto-merge here corrupts which provisions/applicability rules apply to
// which law, not just a display label. Never auto-merges a fuzzy match.

export interface RegulatorySourceResolution {
  regulatorySourceId: string;
  status: 'reused' | 'created' | 'created_needs_review' | 'created_new_version';
  reason: string;
}

function normalize(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Token-overlap similarity for the fuzzy-duplicate check — same spirit as
// classify-clauses.ts's keyword-overlap fallback classifier: cheap, no LLM
// call, good enough to flag "these titles are suspiciously similar" without
// claiming to prove identity (that's exactly why a fuzzy hit only ever
// creates a flagged row, never merges).
function titleOverlap(a: string, b: string): number {
  const tokenize = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const ta = tokenize(a), tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits++;
  return hits / Math.min(ta.size, tb.size);
}

async function linkDocument(supabase: any, regulatorySourceId: string, documentId: string) {
  await supabase.from('regulatory_source_documents').upsert(
    { regulatory_source_id: regulatorySourceId, document_id: documentId, document_role: 'primary' },
    { onConflict: 'regulatory_source_id,document_id' },
  );
}

async function createNew(
  supabase: any, extraction: RegulatorySourceExtraction, documentId: string,
  status: 'active' | 'needs_review', potentialDuplicateOf: string | null,
) {
  const { data, error } = await supabase.from('regulatory_sources').insert({
    jurisdiction: extraction.jurisdiction,
    jurisdiction_level: extraction.jurisdiction_level,
    authority: extraction.authority,
    citation: extraction.citation,
    title: extraction.title,
    summary: extraction.summary,
    effective_from: extraction.effective_from,
    primary_source_document_id: documentId,
    status,
    potential_duplicate_of: potentialDuplicateOf,
    extraction_confidence: null,
  }).select().single();
  if (error) throw error;
  await linkDocument(supabase, data.id, documentId);
  return data;
}

export async function resolveRegulatorySource(
  supabase: any,
  extraction: RegulatorySourceExtraction,
  documentId: string,
): Promise<RegulatorySourceResolution> {
  const { data: existing } = await supabase.from('regulatory_sources').select('*').eq('status', 'active');
  const candidates: any[] = existing || [];

  const normCitation = normalize(extraction.citation);
  const normJurisdiction = normalize(extraction.jurisdiction);

  // Tier 1 — exact/normalized citation + jurisdiction match: the same law.
  if (normCitation) {
    const exact = candidates.find(c => normalize(c.citation) === normCitation && normalize(c.jurisdiction) === normJurisdiction);
    if (exact) {
      // A stated effective date strictly later than the existing row's is a
      // genuine amendment (new version), not the same document re-uploaded —
      // link via supersedes_id rather than silently reusing the old row's
      // (now-superseded) provisions as if they were still current.
      if (extraction.effective_from && exact.effective_from && extraction.effective_from > exact.effective_from) {
        const created = await createNew(supabase, extraction, documentId, 'active', null);
        await supabase.from('regulatory_sources').update({ supersedes_id: exact.id }).eq('id', created.id);
        await supabase.from('regulatory_sources').update({ superseded_by_id: created.id, status: 'superseded' }).eq('id', exact.id);
        return {
          regulatorySourceId: created.id, status: 'created_new_version',
          reason: `New effective date (${extraction.effective_from}) supersedes previous version (${exact.effective_from}).`,
        };
      }
      await linkDocument(supabase, exact.id, documentId);
      return { regulatorySourceId: exact.id, status: 'reused', reason: `Matched existing citation "${exact.citation}".` };
    }
  }

  // Tier 2 — same jurisdiction, suspiciously similar title, but not an exact
  // citation match. Never auto-merged: creates its own row, flagged via
  // potential_duplicate_of + status='needs_review' for a human to confirm.
  if (normJurisdiction && extraction.title) {
    const fuzzy = candidates.find(c =>
      normalize(c.jurisdiction) === normJurisdiction && c.title && titleOverlap(c.title, extraction.title!) >= 0.6,
    );
    if (fuzzy) {
      const created = await createNew(supabase, extraction, documentId, 'needs_review', fuzzy.id);
      return {
        regulatorySourceId: created.id, status: 'created_needs_review',
        reason: `Possible duplicate of existing "${fuzzy.title}" (${fuzzy.citation || fuzzy.id}) — flagged for review, not auto-merged.`,
      };
    }
  }

  // No match at all — genuinely new regulatory source.
  const created = await createNew(supabase, extraction, documentId, 'active', null);
  return { regulatorySourceId: created.id, status: 'created', reason: 'No existing regulatory source matched — created new.' };
}
