import { createChatCompletion, GROQ_MODEL } from '@/lib/groq';
import { sanitizeForPrompt, SYSTEM_PROMPT_SAFETY_PREFIX } from '@/lib/security/sanitizePrompt';

// ─── Canonical obligation extraction + comparison (chat 2026-08-24) ───────
// Two source-agnostic operations, kept explicitly separate:
//   1. ingestObligationsForDocument — contract/SOW clauses AND regulation
//      provisions each decompose into their ATOMIC obligation terms (not one
//      term per clause — a single clause routinely bundles many
//      independently satisfiable/violable requirements; SB-88 §39877 alone
//      has ~14). Written into canonical_obligations/canonical_obligation_
//      sources. Neither source knows about the other at this stage.
//   2. resolveTopicForContractAgainstRegulation — the comparison engine.
//      Pairs a contract obligation and a regulation obligation ONLY when a
//      structured judgment call determines they govern the same underlying
//      subject/action/condition (never text similarity, never a scalar
//      strictness score) — then determines coexistence: does the contract
//      meet/exceed the legal floor, fall short of it, conflict with it, or
//      independently address a different facet of the topic.
//
// Hierarchy (chat 2026-08-24, second pass): a required COMPONENT of a
// broader duty (e.g. "fingerprint clearance" as part of "pass a criminal
// background check" — not independently satisfiable on its own) is NOT the
// same as a genuinely independent sibling requirement (a criminal history
// check, a sex-offender registry check, and a DCFS check ARE each
// independently satisfiable/violable, even stated in one clause).
// canonical_obligations.parent_obligation_id/obligation_kind (additive
// migration scripts/add-canonical-obligation-atomic-hierarchy.sql) preserves
// exactly that distinction — a 'required_component' row's parent points at
// the broader duty; independent siblings are separate 'primary' rows with no
// parent. Every atomic term is still its own row (independently citable —
// "does the contract's check include fingerprint clearance specifically" is
// itself a valid future comparison), but a component's parent context is
// passed into compareObligationPair below so the comparator can recognize,
// e.g., that SB-88's "fingerprint clearance" (a child) and a contract's
// standalone "fingerprint-based criminal history check" describe the same
// facet even though one is nested and the other isn't.
//
// canonical_obligation_sources.resolution_role ('controlling'|'supplemental'|
// 'superseded'|'conflicting'|'satisfied_by'|'needs_review') already supports
// multiple simultaneous 'controlling' rows for the cumulative case — no
// schema change needed there. resolution_basis (additive migration
// scripts/add-canonical-obligation-resolution-basis.sql) adds the
// machine-readable WHY a role was assigned, since 'controlling' alone can't
// distinguish "law controls because the contract fell short" from "contract
// controls because it validly exceeds the floor."

export interface AtomicObligationTerm {
  localId: string; // scoped to ONE extraction call only — used to express parent/child links in the raw response, not persisted verbatim
  parentLocalId: string | null; // localId of another term in THIS SAME extraction if this term is a REQUIRED COMPONENT of a broader duty (not independently satisfiable on its own) — null if standalone
  topicKey: string | null; // which obligation_topic_definitions.topic_key this SPECIFIC atomic term addresses — never inherited from the clause as a whole
  subject: string | null;
  action: string | null;
  condition: string | null;
  frequency: string | null;
  deadline: string | null;
  subsectionLabel: string | null; // e.g. "(a)(3)" when the source text has an identifiable subsection marker
  sourceExcerpt: string | null; // short verbatim quote pinpointing this specific atomic term within the clause
  confidence: number;
}

// Decomposes ONE provision into its atomic obligations. Deliberately NOT
// "one atomic unit per sentence/numbered item" — some numbered items are
// wording for a single requirement (a required component), others bundle
// multiple genuinely separate duties in one sentence. The model is asked to
// make that judgment explicitly, not to mechanically split text.
export async function extractAtomicObligations(
  clauseText: string,
  topics: { topic_key: string; label: string }[],
): Promise<AtomicObligationTerm[]> {
  const topicList = topics.map(t => `"${t.topic_key}" (${t.label})`).join(', ');
  const systemPrompt = SYSTEM_PROMPT_SAFETY_PREFIX + `You decompose ONE legal/contractual provision into its ATOMIC obligations — each one an independently satisfiable or violable requirement — for comparing this provision's requirements against requirements from other sources.

Do NOT mechanically split by sentence or numbered item. Judge each case:
- If a requirement has a REQUIRED COMPONENT that only makes sense as PART of a broader duty and could not be satisfied on its own (e.g. "pass a criminal background check, including fingerprint clearance" — fingerprint clearance is HOW the check must be done, not a separate duty), extract the broader duty as one term, and the component as a SEPARATE term whose "parentLocalId" points back to the broader duty's "localId".
- If requirements are genuinely INDEPENDENT of each other — each could be separately satisfied or violated on its own, even if listed in the same sentence or clause (e.g. "perform a criminal history check", "perform a sex-offender registry check", "perform a DCFS check") — extract them as SEPARATE STANDALONE terms with "parentLocalId": null.
- If the text imposes no requirement at all (definitions, recitals, findings/purpose statements, penalty/damages schedules), return an empty "terms" array.

For each atomic term, also decide which ONE of these topics it addresses (or null if none fit — do not force a fit):
${topicList}

Return ONLY valid JSON:
{"terms": [{"localId": "1", "parentLocalId": null, "topicKey": "<topic_key or null>", "subject": "<who must act>", "action": "<the specific required act>", "condition": "<trigger/precondition, or null>", "frequency": "<or null>", "deadline": "<or null>", "subsectionLabel": "<e.g. (a)(3), or null>", "sourceExcerpt": "<short verbatim quote, under 200 chars>", "confidence": 0.0-1.0}, ...]}

Keep every field concise. Return ONLY valid JSON. No markdown, no explanation.`;

  const completion = await createChatCompletion({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Provision:\n\n${sanitizeForPrompt(clauseText.slice(0, 4000), 4000)}` },
    ],
    temperature: 0.1,
    max_tokens: 2500,
    response_format: { type: 'json_object' },
  });
  const raw = completion.choices[0]?.message?.content || '{}';
  let result: any = {};
  try { result = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch { result = {}; }
  const rawTerms: any[] = Array.isArray(result.terms) ? result.terms : [];

  return rawTerms
    .filter(t => t && typeof t.localId === 'string')
    .map(t => ({
      localId: t.localId,
      parentLocalId: typeof t.parentLocalId === 'string' && t.parentLocalId.trim() ? t.parentLocalId.trim() : null,
      topicKey: typeof t.topicKey === 'string' && t.topicKey.trim() ? t.topicKey.trim() : null,
      subject: typeof t.subject === 'string' && t.subject.trim() ? t.subject.trim() : null,
      action: typeof t.action === 'string' && t.action.trim() ? t.action.trim() : null,
      condition: typeof t.condition === 'string' && t.condition.trim() ? t.condition.trim() : null,
      frequency: typeof t.frequency === 'string' && t.frequency.trim() ? t.frequency.trim() : null,
      deadline: typeof t.deadline === 'string' && t.deadline.trim() ? t.deadline.trim() : null,
      subsectionLabel: typeof t.subsectionLabel === 'string' && t.subsectionLabel.trim() ? t.subsectionLabel.trim() : null,
      sourceExcerpt: typeof t.sourceExcerpt === 'string' && t.sourceExcerpt.trim() ? t.sourceExcerpt.trim().slice(0, 300) : null,
      confidence: typeof t.confidence === 'number' ? Math.max(0, Math.min(1, t.confidence)) : 0.5,
    }));
}

// Extracts every obligation-bearing, topic-relevant clause in a document
// into one canonical_obligations row PER ATOMIC TERM (not per clause, and
// not duplicated per clause-level topic tag — each atomic term carries its
// OWN topicKey from the decomposition itself). clause_obligation_topics
// (classifyProvisionTopics) is used only as a cheap pre-filter — "does this
// clause address ANY tracked topic at all" — to avoid running atomic
// extraction over every boilerplate clause in a document; the actual topic
// assignment per obligation comes from extractAtomicObligations, not from
// that clause-level tag. Idempotent: skips a clause_id that already has a
// canonical_obligation_sources row for this document.
//
// Regulation-sourced obligations get an immediate default of
// resolution_role='controlling'/resolution_basis='mandatory_law_floor' — a
// legal requirement is presumed controlling on its own until a contract
// pairing (resolveTopicForContractAgainstRegulation, below) revises it.
// Contract-sourced obligations start 'needs_review'/null — a contract term
// alone, with no regulatory context yet, can't be classified until compared.
export async function ingestObligationsForDocument(
  supabase: any,
  documentId: string,
  sourceType: 'contract' | 'regulation',
  regulatorySourceId?: string | null,
): Promise<{ created: number; skipped: number }> {
  const { data: topicDefs } = await supabase.from('obligation_topic_definitions').select('id, topic_key, label').eq('active', true);
  const topics: { topic_key: string; label: string }[] = topicDefs || [];
  const topicIdByKey = new Map<string, string>(topics.map((t: any) => [t.topic_key, t.id]));
  if (topics.length === 0) return { created: 0, skipped: 0 };

  const { data: clauses } = await supabase.from('clauses').select('clause_id, clause_text').eq('document_id', documentId);
  const clauseRows: { clause_id: string; clause_text: string }[] = clauses || [];
  if (clauseRows.length === 0) return { created: 0, skipped: 0 };

  const clauseIds = clauseRows.map(c => c.clause_id);
  const { data: topicLinks } = await supabase.from('clause_obligation_topics').select('clause_id').in('clause_id', clauseIds);
  const clausesWithAnyTopic = new Set((topicLinks || []).map((l: any) => l.clause_id));

  const { data: existingSources } = await supabase.from('canonical_obligation_sources').select('clause_id').eq('document_id', documentId);
  const alreadyIngested = new Set((existingSources || []).map((s: any) => s.clause_id));

  const isRegulation = sourceType === 'regulation';
  let created = 0, skipped = 0;

  for (const clause of clauseRows) {
    if (!clausesWithAnyTopic.has(clause.clause_id)) continue; // no tracked-topic relevance — skip the extraction call entirely
    if (alreadyIngested.has(clause.clause_id)) { skipped++; continue; }

    let atomicTerms: AtomicObligationTerm[];
    try {
      atomicTerms = await extractAtomicObligations(clause.clause_text, topics);
    } catch (err: any) {
      console.error(`[canonicalObligations] extraction failed for ${clause.clause_id}:`, err?.message);
      continue; // one bad clause doesn't lose the rest of the document
    }
    if (atomicTerms.length === 0) continue;

    // Parents before children — a child needs its parent's real DB id for parent_obligation_id.
    const parents = atomicTerms.filter(t => !t.parentLocalId);
    const children = atomicTerms.filter(t => t.parentLocalId);
    const dbIdByLocalId = new Map<string, string>();

    const insertOne = async (term: AtomicObligationTerm, parentObligationId: string | null): Promise<string | null> => {
      const topicId = term.topicKey ? topicIdByKey.get(term.topicKey) : null;
      if (!topicId) return null; // couldn't resolve to a known topic — nothing to compare it against
      const { data: obligation, error: obErr } = await supabase.from('canonical_obligations').insert({
        source_type: sourceType,
        topic_id: topicId,
        requirement_summary: [term.action, term.condition].filter(Boolean).join(' — ') || null,
        requirement_terms: { subject: term.subject, action: term.action, condition: term.condition, frequency: term.frequency, deadline: term.deadline },
        obligated_role: term.subject,
        resolution_status: isRegulation ? 'resolved' : 'needs_review',
        confidence: term.confidence,
        parent_obligation_id: parentObligationId,
        obligation_kind: parentObligationId ? 'required_component' : 'primary',
      }).select().single();
      if (obErr || !obligation) { console.error('[canonicalObligations] insert error:', obErr?.message); return null; }

      const { error: srcErr } = await supabase.from('canonical_obligation_sources').insert({
        canonical_obligation_id: obligation.id,
        document_id: documentId,
        clause_id: clause.clause_id,
        regulatory_source_id: isRegulation ? (regulatorySourceId || null) : null,
        source_excerpt: term.sourceExcerpt,
        source_subsection: term.subsectionLabel,
        provenance_role: 'originating',
        resolution_role: isRegulation ? 'controlling' : 'needs_review',
        resolution_basis: isRegulation ? 'mandatory_law_floor' : null,
        resolution_reason: isRegulation ? 'Legal requirement — controlling by default until compared against a contractual obligation on the same topic.' : null,
      });
      if (srcErr) { console.error('[canonicalObligations] source insert error:', srcErr.message); return null; }
      created++;
      return obligation.id;
    };

    for (const term of parents) {
      const id = await insertOne(term, null);
      if (id) dbIdByLocalId.set(term.localId, id);
    }
    for (const term of children) {
      const parentDbId = term.parentLocalId ? dbIdByLocalId.get(term.parentLocalId) || null : null;
      const id = await insertOne(term, parentDbId);
      if (id) dbIdByLocalId.set(term.localId, id);
    }
  }
  return { created, skipped };
}

type ResolutionBasis = 'mandatory_law_floor' | 'contract_stricter_compatible' | 'cumulative_independent' | 'direct_conflict_law_controls' | 'satisfied_by_other_obligation' | 'requires_legal_review';
type ResolutionRole = 'controlling' | 'supplemental' | 'conflicting' | 'satisfied_by' | 'needs_review';

interface ComparisonVerdict {
  sameFacet: boolean; // do these two terms govern the same underlying subject/action/condition, or a different facet of the topic?
  resolutionBasis: ResolutionBasis;
  regulationRole: ResolutionRole;
  contractRole: ResolutionRole;
  reasoning: string;
}

interface ObligationForComparison {
  subject: string | null; action: string | null; condition: string | null; frequency: string | null; deadline: string | null;
}

async function compareObligationPair(
  regTerms: ObligationForComparison, contractTerms: ObligationForComparison,
  regParentAction: string | null, contractParentAction: string | null,
): Promise<ComparisonVerdict> {
  const systemPrompt = SYSTEM_PROMPT_SAFETY_PREFIX + `You compare a REGULATORY obligation and a CONTRACTUAL obligation on the same compliance topic to determine whether they can both be validly followed, and which one governs.

Either obligation may be a REQUIRED COMPONENT of a broader duty rather than a standalone requirement — if so, its parent duty's text is given as context. Judge the component in light of its parent (e.g. a component "fingerprint clearance" whose parent is "pass a criminal background check" should be compared as part of that background-check requirement, not in isolation).

First decide: do these two obligations govern the SAME underlying subject/action/condition (the same specific requirement, even if worded differently), or does each independently address a DIFFERENT facet of the topic (e.g. one covers screening frequency, the other covers a different screening component)?

Then classify using exactly one of these machine-readable bases:
- "mandatory_law_floor": same facet; the contract's terms do not fully meet or exceed every element the regulation requires (falls short in scope, frequency, or coverage) — the law is a mandatory minimum the contract must not undercut. Law is "controlling", contract is "needs_review".
- "contract_stricter_compatible": same facet; the contract's terms are a strict superset of the legal requirement (meets every element the law requires and adds more, or is materially equal) — nothing the law requires is relaxed. Contract is "controlling", law is "satisfied_by".
- "direct_conflict_law_controls": same facet, but the two genuinely cannot both be followed as written (a true incompatibility, not just a difference in detail) — the mandatory law controls to the extent required. Law is "controlling", contract is "conflicting".
- "cumulative_independent": different facets of the same topic — both can be followed simultaneously, neither overrides the other. Both are "controlling".
- "requires_legal_review": the two obligations don't decompose into a form that can be compared with confidence. Both are "needs_review".
(satisfied_by_other_obligation is not produced by this comparison — it only applies when a separate evidence record discharges a requirement, not during obligation-vs-obligation comparison.)

Return ONLY valid JSON:
{"sameFacet": true|false, "resolutionBasis": "<one of the six keys above>", "regulationRole": "controlling"|"supplemental"|"conflicting"|"satisfied_by"|"needs_review", "contractRole": "controlling"|"supplemental"|"conflicting"|"satisfied_by"|"needs_review", "reasoning": "<one or two sentences citing the specific terms that drove this>"}`;

  const userPrompt = `REGULATORY obligation${regParentAction ? ` (required component of: "${regParentAction}")` : ''}:\n${JSON.stringify(regTerms, null, 2)}\n\nCONTRACTUAL obligation${contractParentAction ? ` (required component of: "${contractParentAction}")` : ''}:\n${JSON.stringify(contractTerms, null, 2)}`;

  const completion = await createChatCompletion({
    model: GROQ_MODEL,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    temperature: 0.1,
    // 500 was too tight — verbose/reasoning models hit the cap mid-JSON and
    // Groq rejects it as json_validate_failed, losing the comparison. The
    // actual verdict object is small; the headroom is for the model's
    // pre-JSON tokens.
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  });
  const raw = completion.choices[0]?.message?.content || '{}';
  let result: any = {};
  try { result = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch { result = {}; }

  const validBasis: ResolutionBasis[] = ['mandatory_law_floor', 'contract_stricter_compatible', 'cumulative_independent', 'direct_conflict_law_controls', 'satisfied_by_other_obligation', 'requires_legal_review'];
  const validRole: ResolutionRole[] = ['controlling', 'supplemental', 'conflicting', 'satisfied_by', 'needs_review'];
  return {
    sameFacet: result.sameFacet === true,
    resolutionBasis: validBasis.includes(result.resolutionBasis) ? result.resolutionBasis : 'requires_legal_review',
    regulationRole: validRole.includes(result.regulationRole) ? result.regulationRole : 'needs_review',
    contractRole: validRole.includes(result.contractRole) ? result.contractRole : 'needs_review',
    reasoning: typeof result.reasoning === 'string' ? result.reasoning : 'No reasoning returned.',
  };
}

// The comparison engine. For every not-yet-compared contract obligation on
// `topicId` from `contractDocumentId` — primary AND required_component
// alike, since a component (e.g. "fingerprint clearance") may be exactly
// what pairs against a standalone term on the other side — pairs it against
// every regulation obligation on the same topic via compareObligationPair,
// with parent-duty context attached when either side is a component. Never
// text similarity, never a scalar score.
//
// On a same-facet match, the contract's canonical_obligation_sources row is
// REPARENTED onto the regulation's canonical_obligations row (schema intent:
// one resolved requirement, multiple citable sources) and the now-redundant
// standalone contract canonical_obligations row is marked superseded, not
// deleted. On no match against anything in the topic, the contract
// obligation stays its own canonical_obligations row, marked
// cumulative_independent/controlling only if it was actually compared
// against at least one regulation obligation and judged a different facet —
// never assigned merely for lack of anything to compare against.
export async function resolveTopicForContractAgainstRegulation(
  supabase: any,
  topicId: string,
  contractDocumentId: string,
  regulatorySourceId: string,
): Promise<{ compared: number; merged: number }> {
  const { data: contractSourceRows } = await supabase.from('canonical_obligation_sources')
    .select('id, canonical_obligation_id').eq('document_id', contractDocumentId).is('resolution_basis', null);
  const { data: regSourceRows } = await supabase.from('canonical_obligation_sources')
    .select('id, canonical_obligation_id').eq('regulatory_source_id', regulatorySourceId);

  const contractObligationIds = (contractSourceRows || []).map((r: any) => r.canonical_obligation_id);
  const regObligationIds = (regSourceRows || []).map((r: any) => r.canonical_obligation_id);
  if (contractObligationIds.length === 0 || regObligationIds.length === 0) return { compared: 0, merged: 0 };

  const { data: contractObligations } = await supabase.from('canonical_obligations').select('id, topic_id, requirement_terms, parent_obligation_id').in('id', contractObligationIds).eq('topic_id', topicId);
  const { data: regObligations } = await supabase.from('canonical_obligations').select('id, topic_id, requirement_terms, parent_obligation_id').in('id', regObligationIds).eq('topic_id', topicId);
  if (!contractObligations?.length || !regObligations?.length) return { compared: 0, merged: 0 };

  const parentIds = [...contractObligations, ...regObligations].map((o: any) => o.parent_obligation_id).filter(Boolean);
  const parentActionById = new Map<string, string | null>();
  if (parentIds.length > 0) {
    const { data: parentRows } = await supabase.from('canonical_obligations').select('id, requirement_terms').in('id', parentIds);
    for (const p of parentRows || []) parentActionById.set(p.id, p.requirement_terms?.action || null);
  }
  const parentActionOf = (ob: any): string | null => ob.parent_obligation_id ? (parentActionById.get(ob.parent_obligation_id) || null) : null;

  let compared = 0, merged = 0;
  for (const contractOb of contractObligations) {
    const contractSourceRow = (contractSourceRows || []).find((r: any) => r.canonical_obligation_id === contractOb.id);
    let matched = false;
    for (const regOb of regObligations) {
      let verdict: ComparisonVerdict;
      try {
        verdict = await compareObligationPair(regOb.requirement_terms, contractOb.requirement_terms, parentActionOf(regOb), parentActionOf(contractOb));
      } catch (err: any) {
        console.error(`[canonicalObligations] comparison failed for obligation ${contractOb.id}/${regOb.id}:`, err?.message);
        continue; // one bad pair doesn't block comparing against the rest
      }
      compared++;
      if (!verdict.sameFacet) continue;
      matched = true;

      // Reparent the contract's source onto the regulation's canonical_obligation
      // (same resolved requirement, two citable sources) and mark the now-
      // orphaned standalone contract obligation row superseded.
      await supabase.from('canonical_obligation_sources').update({
        canonical_obligation_id: regOb.id,
        resolution_role: verdict.contractRole,
        resolution_basis: verdict.resolutionBasis,
        resolution_reason: verdict.reasoning,
      }).eq('id', contractSourceRow.id);

      const regSourceRow = (regSourceRows || []).find((r: any) => r.canonical_obligation_id === regOb.id);
      await supabase.from('canonical_obligation_sources').update({
        resolution_role: verdict.regulationRole,
        resolution_basis: verdict.resolutionBasis,
        resolution_reason: verdict.reasoning,
      }).eq('id', regSourceRow.id);

      await supabase.from('canonical_obligations').update({ resolution_status: 'superseded', superseded_by: regOb.id }).eq('id', contractOb.id);
      await supabase.from('canonical_obligations').update({ resolution_status: 'resolved' }).eq('id', regOb.id);
      merged++;
      break; // one match is enough — don't also pair this contract term against a second, unrelated regulatory term
    }
    if (!matched) {
      // Compared against every regulation obligation in this topic and none
      // shared a facet — a genuine additional, independent requirement.
      await supabase.from('canonical_obligation_sources').update({
        resolution_role: 'controlling', resolution_basis: 'cumulative_independent',
        resolution_reason: 'No regulatory obligation on this topic addresses the same subject/action/condition — this is an independent contractual requirement that coexists alongside the applicable regulation.',
      }).eq('id', contractSourceRow.id);
      await supabase.from('canonical_obligations').update({ resolution_status: 'resolved' }).eq('id', contractOb.id);
    }
  }
  return { compared, merged };
}
