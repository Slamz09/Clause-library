import { createChatCompletion, GROQ_MODEL } from '@/lib/groq';
import { SupabaseClient } from '@supabase/supabase-js';
import { runRulesEngine } from './rulesEngine';

export type ComplianceStatus = 'compliant' | 'non_compliant' | 'review_needed' | 'unchecked';

export interface ScoreRubricCriterion {
  criterion: string;        // e.g. "Is indemnification mutual?"
  weight: number;           // 0–1; all weights in a rule should sum to ~1
  preferred_outcome: string; // e.g. "Both parties indemnify each other for own negligence"
}

export interface PlaybookRule {
  clause_type: string;
  clause_name: string;
  clause_text: string;           // model / standard language
  preferred_position: string;    // company's preferred negotiating position
  party_role: string;            // human-readable label for display
  required_clause?: boolean;     // if true, flag as missing when not found in a contract
  // NEW v2 fields
  applies_to_positions?: string[]; // e.g. ['tenant','borrower'] — empty/absent = applies to all
  clause_weight?: number;          // 1–5 importance for doc-level score weighting; default 3
  red_flags?: string[];            // keywords that auto-trigger non_compliant
  green_signals?: string[];        // keywords confirming preferred posture
  score_rubric?: ScoreRubricCriterion[];
  // legacy backward-compat fields
  preferred?: string;
  notes?: string;
}

export interface ClauseComplianceResult {
  clause_id: string;
  status: ComplianceStatus;
  notes: string;
  risk_level: 'low' | 'medium' | 'high';
  score: number | null;    // 1–10: 10 = identical to preferred, 1 = completely divergent
  rules_score: number | null;
  red_flag_hits: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeClauseKey(s: string): string {
  return s.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

// Clause name synonym groups — any two terms in the same group are treated as equivalent.
// Used for fuzzy rule matching so "indemnity" resolves to an "indemnification" playbook rule, etc.
const CLAUSE_SYNONYM_GROUPS: string[][] = [
  ['indemnification', 'indemnity', 'hold harmless', 'indemnify'],
  ['limitation of liability', 'limited liability', 'liability cap', 'cap on damages', 'liability limitation'],
  ['confidentiality', 'non disclosure', 'nondisclosure', 'confidential information'],
  ['termination for cause', 'termination with cause'],
  ['termination for convenience', 'termination without cause'],
  ['governing law', 'choice of law', 'applicable law'],
  ['dispute resolution', 'arbitration', 'mediation', 'disputes'],
  ['force majeure'],
  ['assignment', 'assignment clause', 'anti assignment'],
  ['intellectual property', 'ip rights', 'intellectual property clause'],
  ['non compete', 'non competition', 'noncompete'],
  ['non solicitation', 'nonsolicitation'],
  ['representations and warranties', 'reps and warranties', 'representations warranties'],
  ['notice', 'notices', 'notice requirements', 'notice provisions'],
  ['entire agreement', 'integration clause', 'merger clause'],
  ['insurance', 'insurance requirements', 'insurance coverage'],
  ['payment', 'payment terms', 'fees', 'compensation'],
  ['warranty', 'warranties', 'product warranty'],
];

function isSynonymMatch(a: string, b: string): boolean {
  const normA = normalizeClauseKey(a);
  const normB = normalizeClauseKey(b);
  for (const group of CLAUSE_SYNONYM_GROUPS) {
    const inA = group.some(s => { const n = normalizeClauseKey(s); return normA === n || normA.includes(n) || n.includes(normA); });
    const inB = group.some(s => { const n = normalizeClauseKey(s); return normB === n || normB.includes(n) || n.includes(normB); });
    if (inA && inB) return true;
  }
  return false;
}

function resolveRuleForClause(
  clause: { clause_type: string | null; obligation_type: string | null; ai_classification: string | null },
  rules: PlaybookRule[],
  partyPosition?: string | null,
): PlaybookRule | null {
  // Filter to rules that apply to this party position (if specified)
  const eligible = partyPosition
    ? rules.filter(r =>
        !r.applies_to_positions ||
        r.applies_to_positions.length === 0 ||
        r.applies_to_positions.some(p => p.toLowerCase() === partyPosition.toLowerCase())
      )
    : rules;

  const candidates = [clause.clause_type, clause.obligation_type, clause.ai_classification]
    .filter(Boolean) as string[];
  const normalizedCandidates = candidates.map(normalizeClauseKey);
  const normalizedRuleKeys = eligible.map(r => normalizeClauseKey(r.clause_type));

  // 1. Exact match (normalized)
  for (const norm of normalizedCandidates) {
    const idx = normalizedRuleKeys.findIndex(k => k === norm);
    if (idx !== -1) return eligible[idx];
  }
  // 2. Substring match (normalized)
  for (const norm of normalizedCandidates) {
    const idx = normalizedRuleKeys.findIndex(k => norm.includes(k) || k.includes(norm));
    if (idx !== -1) return eligible[idx];
  }
  // 3. Synonym/alias group match (e.g. "indemnity" → "indemnification")
  for (const norm of normalizedCandidates) {
    const idx = normalizedRuleKeys.findIndex(k => isSynonymMatch(norm, k));
    if (idx !== -1) return eligible[idx];
  }
  return null;
}

async function runInBatches<T>(
  tasks: (() => Promise<T>)[],
  batchSize = 5,
  delayMs = 200,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(t => t()));
    results.push(...batchResults);
    if (i + batchSize < tasks.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return results;
}

// ─── Related-clause clusters ──────────────────────────────────────────────────
// Clauses in the same cluster are passed as context when analysing any member.
// This prevents the AI penalising an indemnification clause for "lacking a
// liability cap" when the cap lives in a separate clause of the same contract.
const RELATED_CLAUSE_CLUSTERS: string[][] = [
  // Liability cluster — must be evaluated as a whole
  [
    'indemnification', 'indemnity', 'hold harmless',
    'limited liability', 'liability cap', 'limitation of liability', 'liability limitation',
    'consequential damages waiver', 'consequential damages', 'damages exclusion',
  ],
  // Termination cluster
  [
    'termination for convenience', 'termination without cause',
    'termination with cause', 'termination for cause',
    'notice period to terminate renewal', 'renewal term', 'term',
  ],
  // IP / license cluster
  ['intellectual property', 'license grant', 'ip ownership', 'work for hire', 'affiliate license'],
  // Data / privacy cluster
  ['confidentiality', 'non disclosure', 'data privacy', 'cybersecurity', 'breach notification'],
  // Non-compete cluster
  ['non compete', 'non solicitation', 'non disparagement'],
];

function findRelatedClauses(
  targetClauseId: string,
  targetType: string,
  allClauses: { clause_id: string; clause_type: string | null; obligation_type: string | null; clause_text: string }[],
): { clause_type: string; clause_text: string }[] {
  const norm = normalizeClauseKey(targetType);
  const cluster = RELATED_CLAUSE_CLUSTERS.find(group =>
    group.some(t => {
      const nt = normalizeClauseKey(t);
      return norm === nt || norm.includes(nt) || nt.includes(norm);
    })
  );
  if (!cluster) return [];

  return allClauses
    .filter(c => {
      if (c.clause_id === targetClauseId) return false;
      const ct = normalizeClauseKey(c.clause_type || c.obligation_type || '');
      return cluster.some(t => {
        const nt = normalizeClauseKey(t);
        return ct === nt || ct.includes(nt) || nt.includes(ct);
      });
    })
    .slice(0, 3) // cap at 3 related clauses to keep prompt size reasonable
    .map(c => ({ clause_type: c.clause_type || c.obligation_type || 'Related', clause_text: c.clause_text }));
}

// ─── Per-clause check ─────────────────────────────────────────────────────────

export async function checkClauseCompliance(params: {
  clause_id: string;
  clause_text: string;
  clause_type: string | null;
  obligation_type: string | null;
  ai_classification: string | null;
  playbook_id: string;
  groq_prompt: string;
  rules: PlaybookRule[];
  party_position?: string | null;
  contract_type?: string | null;
  related_clauses?: { clause_type: string; clause_text: string }[];  // sibling clauses for context
}): Promise<ClauseComplianceResult> {
  const {
    clause_id, clause_text, clause_type, obligation_type, ai_classification,
    groq_prompt, rules, party_position, contract_type, related_clauses,
  } = params;

  const matchingRule = resolveRuleForClause(
    { clause_type, obligation_type, ai_classification },
    rules,
    party_position,
  );

  if (!matchingRule) {
    return {
      clause_id,
      status: 'review_needed',
      notes: 'No specific playbook rule for this clause type — manual review recommended.',
      risk_level: 'low',
      score: null,
      rules_score: null,
      red_flag_hits: [],
    };
  }

  // ── Phase 1: Rules engine (deterministic, instant) ────────────────────────
  const rulesResult = runRulesEngine(clause_text, matchingRule);

  // Short-circuit: if a red flag matched, we already know the verdict
  if (rulesResult.auto_status === 'non_compliant') {
    return {
      clause_id,
      status: 'non_compliant',
      notes: `Red flag language detected: "${rulesResult.red_flag_hits.join('", "')}". This clause deviates from the preferred position.`,
      risk_level: 'high',
      score: rulesResult.rules_score,
      rules_score: rulesResult.rules_score,
      red_flag_hits: rulesResult.red_flag_hits,
    };
  }

  // ── Phase 2: AI augmentation (Groq) ──────────────────────────────────────
  const rubricContext = matchingRule.score_rubric && matchingRule.score_rubric.length > 0
    ? '\n\nEvaluate each rubric criterion:\n' +
      matchingRule.score_rubric
        .map((c, i) => `${i + 1}. ${c.criterion} (preferred: ${c.preferred_outcome})`)
        .join('\n')
    : '';

  const preAnalysis = [
    rulesResult.green_signal_hits.length > 0
      ? `Fall-back language found: ${rulesResult.green_signal_hits.join(', ')}.`
      : null,
    rulesResult.criteria_hits.length > 0
      ? `Rubric criteria confirmed by keywords: ${rulesResult.criteria_hits.join('; ')}.`
      : null,
  ].filter(Boolean).join(' ');

  const userPayload = JSON.stringify({
    contract_type: contract_type ?? 'general',
    party_position: party_position ?? matchingRule.party_role,
    extracted_clause_text: clause_text,
    clause_type: clause_type || obligation_type || ai_classification,
    playbook_rule: {
      clause_name: matchingRule.clause_name,
      clause_text: matchingRule.clause_text,
      preferred_position: matchingRule.preferred_position,
      party_role: matchingRule.party_role,
    },
    rules_engine_pre_analysis: preAnalysis || null,
  });

  // Provide sibling clauses so the AI doesn't penalise an indemnification
  // clause for "lacking a liability cap" when the cap is in a separate clause.
  const relatedClauseContext = related_clauses && related_clauses.length > 0
    ? '\n\nOTHER RELATED CLAUSES IN THIS SAME CONTRACT (read these as additional context — ' +
      'do NOT penalise the clause under review for provisions already covered by these):\n' +
      related_clauses
        .map(rc => `--- [${rc.clause_type}] ---\n${rc.clause_text.substring(0, 700)}`)
        .join('\n')
    : '';

  const userMessage =
    userPayload +
    relatedClauseContext +
    rubricContext +
    '\n\nCompare the extracted_clause_text against the playbook_rule preferred_position, ' +
    'considering the party_position, contract_type, and any related clauses provided above. ' +
    'If a required provision is addressed in a related clause rather than this specific clause, ' +
    'note that in your analysis and do not penalise for it being absent from this clause alone. ' +
    'Return ONLY a JSON object — no markdown, no explanation:\n' +
    '{"status":"compliant"|"non_compliant"|"review_needed",' +
    '"notes":"1-2 sentence explanation: cite specific clause language and how it aligns or deviates from the preferred position",' +
    '"risk_level":"low"|"medium"|"high",' +
    '"score":integer 1-10}' +
    '\n\nScoring guide — 10=clause language matches preferred position exactly or nearly; ' +
    '8-9=substantially aligns with only minor gaps; 6-7=partially aligns but notable differences exist; ' +
    '4-5=significant deviation yet some overlap with preferred language; ' +
    '2-3=mostly contrary to preferred position; 1=completely deviates or is directly opposed to preferred position.';

  try {
    const completion = await createChatCompletion({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: groq_prompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 600,
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    const cleaned = raw.replace(/```json|```/g, '').trim();

    let parsed: { status?: ComplianceStatus; notes?: string; risk_level?: 'low' | 'medium' | 'high'; score?: number };
    try { parsed = JSON.parse(cleaned); } catch { parsed = {}; }

    const aiScore = typeof parsed.score === 'number'
      ? Math.min(10, Math.max(1, Math.round(parsed.score)))
      : null;

    // Merge rules + AI scores (35% rules, 65% AI)
    const finalScore = aiScore !== null
      ? Math.min(10, Math.max(1, Math.round(rulesResult.rules_score * 0.35 + aiScore * 0.65)))
      : rulesResult.rules_score;

    // If AI says compliant but rules engine is very low confidence, keep review_needed
    let finalStatus = parsed.status ?? 'review_needed';
    if (finalStatus === 'compliant' && finalScore < 5) finalStatus = 'review_needed';

    return {
      clause_id,
      status: finalStatus,
      notes: parsed.notes ?? '',
      risk_level: parsed.risk_level ?? 'medium',
      score: finalScore,
      rules_score: rulesResult.rules_score,
      red_flag_hits: rulesResult.red_flag_hits,
    };
  } catch (err) {
    console.error('checkClauseCompliance error:', err);
    // Groq unavailable — fall back to rules engine result alone
    const fallbackStatus = rulesResult.auto_status
      ?? (rulesResult.rules_score >= 7 ? 'compliant' : rulesResult.rules_score >= 4 ? 'review_needed' : 'non_compliant');
    return {
      clause_id,
      status: fallbackStatus,
      notes: `Rules-engine analysis only (AI unavailable). ${
        rulesResult.green_signal_hits.length > 0
          ? `Fall-back language found: ${rulesResult.green_signal_hits.join(', ')}.`
          : 'No fall-back language detected.'
      }`,
      risk_level: rulesResult.rules_score < 4 ? 'high' : rulesResult.rules_score < 7 ? 'medium' : 'low',
      score: rulesResult.rules_score,
      rules_score: rulesResult.rules_score,
      red_flag_hits: rulesResult.red_flag_hits,
    };
  }
}

// ─── Full-document compliance run ─────────────────────────────────────────────

export async function runDocumentCompliance(params: {
  documentId: string;
  supabase: SupabaseClient;
  partyPositionOverride?: string | null; // optional: override what's on the document record
}): Promise<{ checked: number; skipped: number; document_compliance_score: number | null; missing_required_clauses: string[] }> {
  const { documentId, supabase, partyPositionOverride } = params;

  // Fetch document type AND party_position
  const { data: doc } = await supabase
    .from('documents')
    .select('document_type, party_position')
    .eq('document_id', documentId)
    .maybeSingle();

  if (!doc?.document_type) {
    return { checked: 0, skipped: 0, document_compliance_score: null, missing_required_clauses: [] };
  }

  const partyPosition = partyPositionOverride ?? doc.party_position ?? null;

  // Fetch active playbook for this document type
  const { data: playbook } = await supabase
    .from('contract_playbooks')
    .select('id, groq_prompt, rules')
    .eq('document_type', doc.document_type)
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  // Fetch clauses
  const { data: clauses } = await supabase
    .from('clauses')
    .select('clause_id, clause_text, clause_type, obligation_type, ai_classification')
    .eq('document_id', documentId);

  if (!playbook || !clauses || clauses.length === 0) {
    return { checked: 0, skipped: 0, document_compliance_score: null, missing_required_clauses: [] };
  }

  const rules = playbook.rules as PlaybookRule[];

  const tasks = clauses.map(
    (clause: {
      clause_id: string;
      clause_text: string;
      clause_type: string | null;
      obligation_type: string | null;
      ai_classification: string | null;
    }) =>
      () => {
        const relatedClauses = findRelatedClauses(
          clause.clause_id,
          clause.clause_type || clause.obligation_type || '',
          clauses,
        );
        return checkClauseCompliance({
          clause_id: clause.clause_id,
          clause_text: clause.clause_text,
          clause_type: clause.clause_type,
          obligation_type: clause.obligation_type,
          ai_classification: clause.ai_classification,
          playbook_id: playbook.id,
          groq_prompt: playbook.groq_prompt,
          rules,
          party_position: partyPosition,
          contract_type: doc.document_type,
          related_clauses: relatedClauses,
        });
      }
  );

  const results = await runInBatches(tasks, 10, 50);

  const fulfilled = results.filter(
    (r): r is PromiseFulfilledResult<ClauseComplianceResult> => r.status === 'fulfilled',
  );
  const skipped = results.length - fulfilled.length;

  // Write per-clause results back to clauses table (now includes risk_level + rules_score + red_flag_hits)
  await Promise.all(
    fulfilled.map(({ value: { clause_id, status, notes, score, risk_level, rules_score, red_flag_hits } }) =>
      supabase
        .from('clauses')
        .update({
          compliance_status: status,
          compliance_notes: notes,
          compliance_score: score,
          playbook_id: playbook.id,
          risk_level,
          rules_score,
          red_flag_hits,
        })
        .eq('clause_id', clause_id)
    )
  );

  // ── Document-level weighted compliance score ──────────────────────────────
  // Only include clauses that actually had a matching rule (score != null)
  const scored = fulfilled
    .map(r => r.value)
    .filter(v => v.score !== null);

  let document_compliance_score: number | null = null;
  if (scored.length > 0) {
    const rulesByType = Object.fromEntries(rules.map(r => [normalizeClauseKey(r.clause_type), r]));
    let weightedSum = 0;
    let totalWeight = 0;
    for (const result of scored) {
      const clauseData = clauses.find(c => c.clause_id === result.clause_id);
      const clauseKey = normalizeClauseKey(
        clauseData?.clause_type || clauseData?.obligation_type || ''
      );
      const rule = rulesByType[clauseKey]
        ?? Object.values(rulesByType).find(r =>
            clauseKey.includes(normalizeClauseKey(r.clause_type)) ||
            normalizeClauseKey(r.clause_type).includes(clauseKey)
          );
      const weight = rule?.clause_weight ?? 3;
      weightedSum += (result.score as number) * weight;
      totalWeight += weight;
    }
    document_compliance_score = totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 10) / 10
      : null;

    // Persist aggregate score on documents table
    await supabase
      .from('documents')
      .update({ compliance_score: document_compliance_score })
      .eq('document_id', documentId);
  }

  // ── Missing required clauses ──────────────────────────────────────────────
  // For every rule marked required_clause=true, check whether at least one
  // extracted clause resolved to that rule. If not, the clause is missing.
  const requiredRules = rules.filter(r => r.required_clause === true);
  const missing_required_clauses: string[] = [];

  for (const requiredRule of requiredRules) {
    const hasMatch = clauses.some(clause =>
      resolveRuleForClause(
        {
          clause_type: clause.clause_type ?? null,
          obligation_type: clause.obligation_type ?? null,
          ai_classification: clause.ai_classification ?? null,
        },
        [requiredRule],
        partyPosition,
      ) !== null,
    );
    if (!hasMatch) {
      missing_required_clauses.push(requiredRule.clause_name || requiredRule.clause_type);
    }
  }

  return { checked: fulfilled.length, skipped, document_compliance_score, missing_required_clauses };
}
