// ─── Clause → structured atomic obligation ingestion ────────────────────────
// The single authoritative path from clause text to atomic obligations.
//
//   clauses.clause_text
//     → segmentAtomicUnits            → clause_units   (structural decomposition)
//     → requirement-bearing units      → canonical_obligations (derivation='explicit')
//     → DerivedObligationDraft (from classifyClauseForms, a Statement /
//        Rep-Warranty / Acknowledgment that produces a concrete effect)
//                                      → canonical_obligations (derivation='derived')
//     → canonical_obligation_sources   (clause_id + clause_unit_id provenance)
//     → resolveTopicForContractAgainstRegulation (existing comparison engine)
//
// canonical_obligations (+ _sources + _applicability) stays the ONE obligation
// model and the ONE comparison item. clause_units is decomposition scaffolding,
// not a competing store. The legacy `obligations` / `extracted_obligations`
// tables are untouched.

import { createServerClient } from '@/lib/supabaseServer';
import { segmentAtomicUnits } from '@/lib/clauses/segmentAtomicUnits';
import { computeReviewFlags, needsReview, reviewReason } from '@/lib/clauses/reviewFlags';
import { mapCanonicalTypeToTopicLabels } from '@/lib/clauseTypes';
import type { LLMClauseUnit } from '@/lib/legalUnitTypes';
import type { ClauseFormClassification } from '@/lib/clauses/classifyClauseForms';
import type { RequirementEffect } from '@/lib/clauses/clauseCategories';
import { resolveTopicForContractAgainstRegulation } from '@/lib/regulatory/canonicalObligations';

type SbClient = ReturnType<typeof createServerClient>;

export type ObligationSourceType = 'contract' | 'order_form' | 'insurance' | 'regulation' | 'policy' | 'other';

export interface IngestOptions {
  sourceType: ObligationSourceType;
  regulatorySourceId?: string | null;
  /** clause_id → form classification (Category / Modifiers / derived drafts). */
  formClassifications: Map<string, ClauseFormClassification>;
  /** Run the contract-vs-regulation comparison after ingest (contract sources only). */
  runComparison?: boolean;
}

export interface IngestResult {
  clauseUnits: number;
  explicitObligations: number;
  derivedObligations: number;
  compared: number;
  merged: number;
  skippedColumns: string[];
}

// Structural label -> requirement effect for the EXPLICIT path. Only these
// three labels create an explicit obligation; representation / warranty /
// acknowledgement / statement / definition units never do (they only produce
// obligations via a DerivedObligationDraft, and only when a concrete effect
// is present).
const EXPLICIT_EFFECT: Record<string, RequirementEffect> = {
  prohibition: 'prohibition',
  obligation: 'duty',
  permission: 'permission',
};

function explicitEffectFor(labels: string[]): RequirementEffect | null {
  if (labels.includes('prohibition')) return 'prohibition';
  if (labels.includes('obligation')) return 'duty';
  if (labels.includes('permission')) return 'permission';
  return null;
}

function unitRequirementTerms(u: LLMClauseUnit) {
  return {
    subject: u.actor ?? null,
    action: u.action_text ?? u.unit_text ?? null,
    object: u.object_text ?? null,
    beneficiary: u.beneficiary ?? null,
    condition: u.trigger_text ?? null,
    qualification: u.qualifier_text ?? null,
    exception: u.exception_text ?? null,
    frequency: u.frequency_text ?? null,
    deadline: u.deadline_text ?? null,
  };
}

// Insert one row, retrying without any column PostgREST reports as unknown
// (code 42703) — so the pipeline still works before
// scripts/2026-clause-library-obligations.sql has been applied.
async function insertRowWithColumnFallback(
  sb: SbClient,
  table: string,
  row: Record<string, unknown>,
  skipped: Set<string>,
): Promise<any | null> {
  const working = { ...row };
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await sb.from(table).insert(working).select().single();
    if (!error) return data;
    const m = /column "?([a-z_]+)"? of relation|Could not find the '([a-z_]+)' column/i.exec(error.message || '');
    const col = m?.[1] || m?.[2];
    if (col && col in working) {
      delete working[col];
      skipped.add(`${table}.${col}`);
      continue;
    }
    console.error(`[ingestClauseObligations] insert ${table} failed:`, error.message);
    return null;
  }
  return null;
}

export async function ingestClauseObligationsForDocument(
  sb: SbClient,
  documentId: string,
  opts: IngestOptions,
): Promise<IngestResult> {
  const skipped = new Set<string>();
  const result: IngestResult = { clauseUnits: 0, explicitObligations: 0, derivedObligations: 0, compared: 0, merged: 0, skippedColumns: [] };

  const { data: clauseRows, error: clErr } = await sb
    .from('clauses')
    .select('clause_id, clause_text, clause_type, obligation_type')
    .eq('document_id', documentId);
  if (clErr || !clauseRows?.length) {
    if (clErr) console.error('[ingestClauseObligations] clause fetch failed:', clErr.message);
    return result;
  }

  const clauseIds = clauseRows.map((c: any) => c.clause_id);

  // clause_id -> topic_id(s), from clause_obligation_topics (populated by
  // classifyProvisionTopics). Used to give each canonical obligation a topic
  // so the comparison engine can pair it.
  const topicByClause = new Map<string, string[]>();
  {
    const { data: links } = await sb.from('clause_obligation_topics').select('clause_id, topic_id').in('clause_id', clauseIds);
    for (const l of links || []) {
      const arr = topicByClause.get(l.clause_id) || [];
      arr.push(l.topic_id);
      topicByClause.set(l.clause_id, arr);
    }
  }

  // ─── Replace mode: re-extraction replaces, never accumulates ──────────────
  // Scope strictly to this document's own originating rows.
  {
    const { data: priorSources } = await sb
      .from('canonical_obligation_sources')
      .select('id, canonical_obligation_id')
      .eq('document_id', documentId)
      .eq('provenance_role', 'originating');
    const priorObIds = [...new Set((priorSources || []).map((s: any) => s.canonical_obligation_id))];
    if (priorSources?.length) {
      await sb.from('canonical_obligation_sources').delete().in('id', priorSources.map((s: any) => s.id));
    }
    // Drop canonical_obligations that now have zero sources left.
    for (const obId of priorObIds) {
      const { count } = await sb.from('canonical_obligation_sources').select('id', { count: 'exact', head: true }).eq('canonical_obligation_id', obId);
      if ((count ?? 0) === 0) {
        await sb.from('canonical_obligation_applicability').delete().eq('canonical_obligation_id', obId);
        await sb.from('canonical_obligations').delete().eq('id', obId);
      }
    }
    await sb.from('clause_units').delete().eq('document_id', documentId);
  }

  const isRegulation = opts.sourceType === 'regulation';
  const touchedTopics = new Set<string>();

  for (const clause of clauseRows as any[]) {
    const canonicalType: string | undefined = clause.obligation_type || clause.clause_type || undefined;
    let units: LLMClauseUnit[] = [];
    try {
      units = await segmentAtomicUnits(clause.clause_id, clause.clause_text || '', canonicalType);
    } catch (err: any) {
      console.error(`[ingestClauseObligations] segmentation failed for ${clause.clause_id}:`, err?.message);
    }

    // ─── clause_units ─────────────────────────────────────────────────────
    const topicLabelsFromType = canonicalType ? mapCanonicalTypeToTopicLabels(canonicalType) : [];
    const unitIdOf = (u: LLMClauseUnit) => `cu_${clause.clause_id}_${String(u.unit_index).padStart(2, '0')}`;
    if (units.length) {
      const unitRows = units.map((u) => {
        const flags = computeReviewFlags(u, canonicalType);
        return {
          clause_unit_id: unitIdOf(u),
          clause_id: clause.clause_id,
          document_id: documentId,
          unit_index: u.unit_index,
          parent_unit_id: null,
          unit_text: u.unit_text,
          unit_text_normalized: (u.unit_text || '').replace(/\s+/g, ' ').trim(),
          structural_labels: u.structural_labels,
          topic_labels: Array.from(new Set([...u.topic_labels, ...topicLabelsFromType])),
          actor: u.actor,
          beneficiary: u.beneficiary,
          defined_term: u.defined_term,
          definition_type: u.definition_type,
          trigger_text: u.trigger_text,
          action_text: u.action_text,
          object_text: u.object_text,
          qualifier_text: u.qualifier_text,
          exception_text: u.exception_text,
          deadline_text: u.deadline_text,
          frequency_text: u.frequency_text,
          source_page: null,
          char_start: null,
          char_end: null,
          extraction_method: 'llm',
          extraction_confidence: u.extraction_confidence,
          structure_confidence: null,
          topic_confidence: null,
          needs_review: needsReview(flags),
          review_reason: reviewReason(flags),
        };
      });
      const { error: unitErr } = await sb.from('clause_units').upsert(unitRows, { onConflict: 'clause_unit_id' });
      if (unitErr) console.error('[ingestClauseObligations] clause_units upsert:', unitErr.message);
      else result.clauseUnits += unitRows.length;
    }

    const clauseTopicIds = topicByClause.get(clause.clause_id) || [];
    const primaryTopicId = clauseTopicIds[0] ?? null;
    for (const t of clauseTopicIds) touchedTopics.add(t);

    const makeObligation = async (args: {
      effect: RequirementEffect;
      derivation: 'explicit' | 'derived';
      summary: string | null;
      terms: Record<string, unknown>;
      obligatedRole: string | null;
      confidence: number;
      clauseUnitId: string | null;
      sourceExcerpt: string | null;
    }) => {
      const ob = await insertRowWithColumnFallback(sb, 'canonical_obligations', {
        source_type: opts.sourceType,
        topic_id: primaryTopicId,
        requirement_summary: args.summary,
        requirement_terms: args.terms,
        obligated_role: args.obligatedRole,
        resolution_status: isRegulation ? 'resolved' : 'needs_review',
        confidence: args.confidence,
        parent_obligation_id: null,
        obligation_kind: 'primary',
        requirement_effect: args.effect,
        derivation: args.derivation,
      }, skipped);
      if (!ob) return false;
      const src = await insertRowWithColumnFallback(sb, 'canonical_obligation_sources', {
        canonical_obligation_id: ob.id,
        document_id: documentId,
        clause_id: clause.clause_id,
        clause_unit_id: args.clauseUnitId,
        regulatory_source_id: isRegulation ? (opts.regulatorySourceId || null) : null,
        provenance_role: 'originating',
        resolution_role: isRegulation ? 'controlling' : 'needs_review',
        resolution_basis: isRegulation ? 'mandatory_law_floor' : null,
        resolution_reason: isRegulation
          ? 'Legal requirement — controlling by default until compared against a contractual obligation on the same topic.'
          : (args.derivation === 'derived'
              ? 'Derived operational requirement — the source clause remains provenance; this atomic obligation is the comparison item.'
              : null),
        source_excerpt: args.sourceExcerpt,
        source_subsection: null,
      }, skipped);
      if (!src) {
        await sb.from('canonical_obligations').delete().eq('id', ob.id);
        return false;
      }
      return true;
    };

    // ─── Explicit obligations (from requirement-bearing units) ────────────
    for (const u of units) {
      const effect = explicitEffectFor(u.structural_labels);
      if (!effect) continue;
      const terms = unitRequirementTerms(u);
      const ok = await makeObligation({
        effect,
        derivation: 'explicit',
        summary: [terms.action, terms.condition].filter(Boolean).join(' — ') || u.unit_text || null,
        terms,
        obligatedRole: u.actor ?? null,
        confidence: typeof u.extraction_confidence === 'number' ? u.extraction_confidence : 0.6,
        clauseUnitId: unitIdOf(u),
        sourceExcerpt: (u.unit_text || '').slice(0, 200) || null,
      });
      if (ok) result.explicitObligations++;
    }

    // ─── Derived obligations (Statement / Rep-Warranty / Acknowledgment
    //     language that produces a concrete effect) ─────────────────────────
    const form = opts.formClassifications.get(clause.clause_id);
    for (const d of form?.derived_obligations || []) {
      const ok = await makeObligation({
        effect: d.effect,
        derivation: 'derived',
        summary: [d.action_text, d.condition_text].filter(Boolean).join(' — ') || d.action_text || null,
        terms: {
          subject: d.actor,
          action: d.action_text,
          beneficiary: d.beneficiary,
          condition: d.condition_text,
          qualification: null,
          exception: null,
          frequency: null,
          deadline: null,
        },
        obligatedRole: d.actor,
        confidence: d.confidence,
        clauseUnitId: null,
        sourceExcerpt: d.source_excerpt,
      });
      if (ok) result.derivedObligations++;
    }

    // ─── Clause rollup counts ────────────────────────────────────────────
    const explicitCount = units.filter(u => explicitEffectFor(u.structural_labels)).length;
    const derivedCount = form?.derived_obligations.length || 0;
    await sb.from('clauses').update({
      unit_count: units.length,
      obligation_count: explicitCount + derivedCount,
      has_units: units.length > 0 || derivedCount > 0,
      extraction_mode: 'deep',
    }).eq('clause_id', clause.clause_id);
  }

  await sb.from('documents')
    .update({ extraction_mode: 'deep', deep_extracted_at: new Date().toISOString() })
    .eq('document_id', documentId)
    .then(undefined, () => {});

  // ─── Comparison: reconcile contract atomic obligations against regulation
  //     obligations on the same topic (existing engine) ────────────────────
  if (opts.runComparison && opts.sourceType !== 'regulation' && touchedTopics.size) {
    // regulatory_source_id(s) that have canonical obligations on any touched topic.
    const { data: regSources } = await sb
      .from('canonical_obligation_sources')
      .select('regulatory_source_id, canonical_obligation_id')
      .not('regulatory_source_id', 'is', null);
    const regSourceIds = [...new Set((regSources || []).map((r: any) => r.regulatory_source_id).filter(Boolean))];
    for (const topicId of touchedTopics) {
      for (const regSourceId of regSourceIds) {
        try {
          const { compared, merged } = await resolveTopicForContractAgainstRegulation(sb, topicId, documentId, regSourceId);
          result.compared += compared;
          result.merged += merged;
        } catch (err: any) {
          console.error(`[ingestClauseObligations] comparison topic=${topicId} reg=${regSourceId} failed:`, err?.message);
        }
      }
    }
  }

  result.skippedColumns = [...skipped];
  if (result.skippedColumns.length) {
    console.warn('[ingestClauseObligations] missing columns (run scripts/2026-clause-library-obligations.sql):', result.skippedColumns.join(', '));
  }
  return result;
}
