import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { createChatCompletion, GROQ_MODEL } from '@/lib/groq';
import type { ExtractedClause } from '@/lib/ruleBasedExtractor';
import { sanitizeForPrompt, SYSTEM_PROMPT_SAFETY_PREFIX } from '@/lib/security/sanitizePrompt';
import { CANONICAL_CLAUSE_TYPES, CLAUSE_TYPE_HINTS, CLAUSE_TYPE_SIGNATURES } from '@/lib/clauseTypes';
import { classifyClauseForms, type ClauseFormClassification } from '@/lib/clauses/classifyClauseForms';
import { ingestClauseObligationsForDocument, type ObligationSourceType } from '@/lib/obligations/ingestClauseObligations';
import { buildApplicabilityForDocument } from '@/lib/obligations/applicabilityBuilder';
import { requireSession } from '@/lib/auth/requireSession';

// Standalone build: everything after the clause upsert — obligation-topic
// mapping, structured atomic-obligation ingest (which fans out an LLM call per
// clause), applicability, and the per-clause compliance LLM check — targets
// parent-platform tables that don't exist here, and its LLM fan-out was
// OOM/timeout-ing constrained hosts (Render free tier → 502). Off by default;
// set ENABLE_OBLIGATION_PIPELINE=true to restore it.
const RUN_OBLIGATION_PIPELINE = process.env.ENABLE_OBLIGATION_PIPELINE === 'true';

// ─── Stop-word set for keyword-overlap matching ───────────────────────────────
const STOP_WORDS = new Set([
  'the','a','an','of','in','to','and','or','for','with','that','this','shall',
  'will','may','any','all','such','as','at','by','be','is','are','from','on',
  'its','their','each','which','when','if','not','no','have','has','been','was',
  'were','do','does','did','it','he','she','they','we','you','both','other',
  'more','also','under','over','through','between','into','during','before',
  'after','above','below','within','without','including','provided','pursuant',
  'hereby','herein','hereof','thereunder','thereof','hereto','party','parties',
  'agreement','contract','either','written','writing','date','term','terms',
  'right','rights','obligation','obligations','section','article','clause',
]);

// A bare-parenthetical subsection marker with nothing else — "(a)",
// "(b)(1)", "(a)(1)(A)" — as opposed to a real clause name like
// "Termination" or "Governing Law".
const BARE_SUBSECTION_MARKER = /^(\([a-zA-Z0-9]+\))+$/;

// Combines every subsection sharing the same clause_no (the parent
// section/statute number) into one clause, and replaces the bare-marker
// clause_name with a synthesized "Section <no>" so the Clause Name column
// shows something meaningful instead of a lone "(a)". A person reads
// "Section 39875" as one provision, not N unrelated fragments — matches how
// contract clauses already get one row per numbered section, not one per
// sub-bullet.
export function mergeStatuteSubsections(input: ExtractedClause[]): ExtractedClause[] {
  const result: ExtractedClause[] = [];
  const parentIndexByNo = new Map<string, number>();
  for (const clause of input) {
    const no = (clause.clause_no || '').trim();
    const name = (clause.clause_name || '').trim();
    if (no && BARE_SUBSECTION_MARKER.test(name)) {
      const existingIdx = parentIndexByNo.get(no);
      if (existingIdx !== undefined) {
        const parent = result[existingIdx];
        parent.clause_text = `${parent.clause_text}\n\n${name} ${clause.clause_text}`.trim();
        if (typeof parent.char_end === 'number' && typeof clause.char_end === 'number') {
          parent.char_end = Math.max(parent.char_end, clause.char_end);
        }
        continue;
      }
      parentIndexByNo.set(no, result.length);
      result.push({ ...clause, clause_name: `Section ${no}` });
      continue;
    }
    result.push(clause);
  }
  return result;
}

// ─── Obligation-topic mapping (Phase 2b Step 2) ─────────────────────────────
// Batched LLM calls per document, CHUNKED (chat 2026-08-24) — the original
// single-call-per-document design assumed "a regulation's provisions are few
// enough" and broke on a real 76-clause contract: max_tokens=2000 can't hold
// a mapping response for that many clauses, so the whole call silently
// produced zero mappings. Chunking keeps each call's output small regardless
// of document size. Classifies each provision against the source-neutral
// obligation_topic_definitions taxonomy — a provision may address more than
// one topic (SB-88's Section 1 covers both background-screening intent and
// TNC oversight, for instance).
const TOPIC_CLASSIFICATION_CHUNK_SIZE = 20;

export async function classifyProvisionTopics(supabase: any, clauseRows: { clause_id: string; clause_text: string }[]): Promise<void> {
  const { data: topics } = await supabase.from('obligation_topic_definitions').select('id, topic_key, label').eq('active', true);
  if (!topics || topics.length === 0) return; // taxonomy not seeded yet — nothing to map against
  const topicKeyToId = new Map<string, string>(topics.map((t: any) => [t.topic_key, t.id]));
  const topicList = topics.map((t: any) => `"${t.topic_key}" (${t.label})`).join(', ');

  const rows: { clause_id: string; topic_id: string }[] = [];
  for (let i = 0; i < clauseRows.length; i += TOPIC_CLASSIFICATION_CHUNK_SIZE) {
    const chunk = clauseRows.slice(i, i + TOPIC_CLASSIFICATION_CHUNK_SIZE);
    const provisionsList = chunk.map(c => `[${c.clause_id}] ${c.clause_text.slice(0, 600)}`).join('\n\n');

    let parsed: any = {};
    try {
      const completion = await createChatCompletion({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT_SAFETY_PREFIX + `You are a regulatory-compliance analyst. For each numbered legal provision below, identify which of these obligation topics it addresses (a provision may address more than one, or none):\n\nTopics: ${topicList}\n\nReturn ONLY valid JSON: {"mappings": [{"clause_id": "<id>", "topic_keys": ["<topic_key>", ...]}]}. Use the exact quoted topic_key values. Omit a clause entirely (don't include an empty array) if none apply.`,
          },
          { role: 'user', content: `Provisions:\n\n${provisionsList}` },
        ],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      });
      const raw = completion.choices[0]?.message?.content || '{}';
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch (err: any) {
      console.error(`[classify-clauses] obligation-topic mapping chunk ${i}-${i + chunk.length} failed:`, err?.message);
      continue; // one bad chunk doesn't lose the rest of the document
    }
    const mappings: { clause_id?: string; topic_keys?: string[] }[] = Array.isArray(parsed.mappings) ? parsed.mappings : [];
    for (const m of mappings) {
      if (!m.clause_id || !Array.isArray(m.topic_keys)) continue;
      for (const key of m.topic_keys) {
        const topicId = topicKeyToId.get(key);
        if (topicId) rows.push({ clause_id: m.clause_id, topic_id: topicId });
      }
    }
  }
  if (rows.length === 0) return;

  // Re-extraction replaces rather than accumulates, same as the clauses
  // table itself just above.
  const clauseIds = clauseRows.map(c => c.clause_id);
  await supabase.from('clause_obligation_topics').delete().in('clause_id', clauseIds);
  const { error } = await supabase.from('clause_obligation_topics').insert(rows);
  if (error) console.error('[classify-clauses] clause_obligation_topics insert error:', error.message);
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
  );
}

// ─── Signature-based fallback classifier (used when Groq is rate-limited) ────
// Scores each clause against CUAD-derived TF-IDF keyword signatures.
// No network calls required — fully static and offline-safe.
function classifyWithSignatures(
  clauses: ExtractedClause[],
  normalizeType: (t: string | undefined) => string,
): any[] {
  return clauses.map((c, i) => {
    // Score against the first 800 chars only — prevents a "Confidential Information" definition
    // buried deep in a Definitions section from dominating the Confidentiality signature score.
    const clauseTokens = tokenize(c.clause_text.substring(0, 800));
    let bestType = 'Other';
    let bestScore = 0;

    for (const [type, keywords] of Object.entries(CLAUSE_TYPE_SIGNATURES)) {
      let hits = 0;
      for (const kw of keywords) { if (clauseTokens.has(kw)) hits++; }
      const score = hits / keywords.length;
      if (score > bestScore) { bestScore = score; bestType = type; }
    }

    // Use signature match only when it clears the noise threshold (≥5%)
    const rawType = bestScore >= 0.05 ? bestType : (c.detected_type || 'Other');
    const canonicalType = normalizeType(rawType);

    return {
      index: i,
      obligation_type: canonicalType,
      ai_classification: canonicalType,
      affiliates_bound: [],
      confidence: bestScore >= 0.1 ? 0.7 : 0.5,
    };
  });
}

// ─── Deterministic recording-consent keyword fallback ────────────────────────
// The AI's video_consent_policy field can come back null even on a clause
// that clearly states a recording position — usually because the clause's
// primary topic got classified as something else. This regex backstop only
// runs when the AI didn't already return a value for a clause that mentions
// recording/cameras at all; it's a safety net for unambiguous phrasing, not
// a replacement for the AI's more nuanced reading. Follows this app's own
// "opt-out" definition (recording is NOT the default; consent is required
// before it may occur) — see the RECORDING CONSENT POLICY prompt section.
const OPT_OUT_RECORDING_PATTERNS: RegExp[] = [
  /\bopt(?:s|ed|ing)?[\s-]?out\s+of\s+(?:any\s+)?(?:camera\s+|video\s+|audio\s+)?record/i,
  /\b(?:shall not|will not|may not|is not (?:permitted|authorized) to|are not (?:permitted|authorized) to)\s+record/i,
  /\bprohibit(?:s|ed|ing)?\s+(?:any\s+)?(?:camera\s+|video\s+|audio\s+)?record/i,
  /\brecord(?:ing)?[^.]{0,80}\brequires?\s+(?:the\s+)?(?:prior\s+)?(?:written\s+)?consent/i,
  /\bwithout\s+(?:the\s+)?(?:prior\s+)?(?:written\s+)?consent[^.]{0,80}\brecord/i,
  /\bno\s+(?:camera\s+|video\s+|audio\s+)?recording\s+(?:shall|will|may)\s+(?:be\s+made|occur|take place)/i,
];
const OPT_IN_RECORDING_PATTERNS: RegExp[] = [
  /\bmay\s+decline\s+(?:to\s+be\s+)?record/i,
  /\bmay\s+opt[\s-]?out\s+of\s+(?:being\s+)?record/i,
];

function detectRecordingConsentFallback(text: string): 'opt-in' | 'opt-out' | null {
  if (!text || !/record|camera/i.test(text)) return null;
  if (OPT_OUT_RECORDING_PATTERNS.some(p => p.test(text))) return 'opt-out';
  if (OPT_IN_RECORDING_PATTERNS.some(p => p.test(text))) return 'opt-in';
  return null;
}

// Two valid callers: an authenticated browser (the Document Parser page —
// requireSession()), or an internal server-to-server call from
// processDocumentUpload() (bulk upload, and single-upload's own auto-extract
// step) which has no session cookie to present — same shared secret
// /api/documents/bulk-upload/process uses for the same reason. proxy.ts
// exempts this path from its blanket cookie gate so a request bearing the
// secret header can even reach this check.
async function checkAuth(req: NextRequest): Promise<NextResponse | null> {
  const secret = process.env.BULK_PROCESS_SECRET;
  if (secret && req.headers.get('x-internal-secret') === secret) return null;
  return requireSession();
}

export async function POST(req: NextRequest) {
  const denied = await checkAuth(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const { documentId, clauses: rawClauses, entityName, counterpartyName, insurerVendorId, documentText, documentType, availableClauseTypes, contractFamilyId, deepExtract, paperSource, regulatorySourceId } = body as {
      documentId: string;
      clauses: ExtractedClause[];
      entityName?: string;
      counterpartyName?: string;
      insurerVendorId?: string;
      documentText?: string;
      documentType?: string;
      availableClauseTypes?: string[];
      contractFamilyId?: string;
      deepExtract?: boolean;
      paperSource?: string;
      // Set by processDocumentUpload.ts when documentType === 'regulation'
      // (see resolveRegulatorySource.ts) — stamped onto every provision
      // clause below, then used to run the obligation-topic mapping pass
      // (clause_obligation_topics) after they're saved.
      regulatorySourceId?: string;
    };
    // Full type list: canonical + any custom types the client has stored
    const allClauseTypes: readonly string[] = availableClauseTypes?.length
      ? availableClauseTypes
      : CANONICAL_CLAUSE_TYPES;

    if (!documentId || !rawClauses || !Array.isArray(rawClauses)) {
      return NextResponse.json({ error: 'documentId and clauses array required' }, { status: 400 });
    }
    // Applied here (not per-extractor) so it's shared by every caller —
    // Document Parser's LLM extraction AND bulk/single upload's rule-based
    // extraction both funnel through this route as their final save step.
    // A statute/bill-style provision ("39875. (a) ... (b) ...") extracts
    // with the parent section number as clause_no and the bare subsection
    // marker ("(a)", "(b)(1)", "(a)(1)(A)") as clause_name — there's no
    // other descriptive title for text formatted that way. Confirmed live:
    // SB-88 (doc_0068) produced 49 fragment rows this way instead of ~9 real
    // sections, each named literally "(a)"/"(b)"/etc.
    const clauses = mergeStatuteSubsections(rawClauses);

    // Resolve paper_source and counterparty_id from linked contract
    let resolvedPaperSource: string | null = null;
    let resolvedCounterpartyId: string | null = null;
    let resolvedCounterpartyName: string | null = null;
    let linkedContractId: string | null = null;
    let linkedContractBgcIntervalMonths: number | null = null;
    if (paperSource) {
      resolvedPaperSource = paperSource.includes('Client') || paperSource.includes('counter') ? 'counter_party' : 'internal';
    }
    if (documentId && documentId !== 'tmp') {
      const supabase = createServerClient();
      // Contract metadata now lives ON the documents row (contracts merged into
      // documents — scripts/2026-merge-contracts-into-documents.sql). Fall back
      // to the legacy contracts table pre-migration.
      let contractRow: any = null;
      const { data: docRow, error: docRowErr } = await supabase
        .from('documents')
        .select('paper_source, contract_facing, linked_client_id, linked_vendor_id, linked_client_name, linked_vendor_name, bgc_interval_months')
        .eq('document_id', documentId)
        .maybeSingle();
      if (docRowErr?.code === '42703') {
        const legacy = await supabase
          .from('contracts')
          .select('paper_source, contract_facing, linked_client_id, linked_vendor_id, linked_client_name, linked_vendor_name, bgc_interval_months')
          .eq('document_id', documentId)
          .maybeSingle();
        contractRow = legacy.data;
      } else {
        contractRow = docRow;
      }
      if (contractRow) {
        if (!resolvedPaperSource && contractRow.paper_source) {
          const ps = contractRow.paper_source;
          resolvedPaperSource = (ps === 'counter_party' || ps === 'Client Paper' || ps.toLowerCase().includes('counter') || ps.toLowerCase().includes('client'))
            ? 'counter_party' : 'internal';
        }
        const facingVendor = contractRow.contract_facing === 'vendor';
        // Counterparty ID: SP-### or CLI-###
        resolvedCounterpartyId = facingVendor
          ? (contractRow.linked_vendor_id || null)
          : (contractRow.linked_client_id || null);
        resolvedCounterpartyName = facingVendor
          ? (contractRow.linked_vendor_name || null)
          : (contractRow.linked_client_name || null);
        linkedContractId = documentId; // the document IS the contract now
        linkedContractBgcIntervalMonths = contractRow.bgc_interval_months ?? null;
      }

      // Fall back to the entity tables when the contract row didn't carry the
      // name — the clauses table stores the FULL client / service-provider
      // name in counterparty_name, not the bare id.
      if (resolvedCounterpartyId && !resolvedCounterpartyName) {
        if (/^CLI-/i.test(resolvedCounterpartyId)) {
          const { data: cli } = await supabase.from('clients').select('client_name').eq('client_id', resolvedCounterpartyId).maybeSingle();
          resolvedCounterpartyName = cli?.client_name || null;
        } else if (/^SP-/i.test(resolvedCounterpartyId)) {
          const { data: sp } = await supabase.from('service_providers').select('legal_name, display_name').eq('service_provider_id', resolvedCounterpartyId).maybeSingle();
          resolvedCounterpartyName = sp?.legal_name || sp?.display_name || null;
        }
      }
    }

    // If the caller passed a bare id as counterpartyName (older parser save
    // path), resolve it to the full name too.
    if (!resolvedCounterpartyName && counterpartyName && /^(CLI|SP|CUST|VEND)-\d+$/i.test(counterpartyName.trim())) {
      const supabase = createServerClient();
      const cpId = counterpartyName.trim();
      if (/^CLI-|^CUST-/i.test(cpId)) {
        const { data: cli } = await supabase.from('clients').select('client_name').eq('client_id', cpId).maybeSingle();
        resolvedCounterpartyName = cli?.client_name || null;
      } else {
        const { data: sp } = await supabase.from('service_providers').select('legal_name, display_name').eq('service_provider_id', cpId).maybeSingle();
        resolvedCounterpartyName = sp?.legal_name || sp?.display_name || null;
      }
    }

    // Cap clause count to prevent token exhaustion
    if (clauses.length > 500) {
      return NextResponse.json({ error: 'Clause count exceeds maximum of 500' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Build the Groq prompt — sanitize user-supplied clause text to prevent injection
    const clauseSummaries = clauses.map((c, i) => ({
      index: i,
      clause_no: c.clause_no,
      text_preview: sanitizeForPrompt(c.clause_text.substring(0, 400), 400),
    }));

    const typeList = allClauseTypes.filter(t => t !== 'Other').join(' | ') + ' | Other';
    const hintLines = Object.entries(CLAUSE_TYPE_HINTS)
      .map(([type, hint]) => `  "${type}": ${hint}`)
      .join('\n');

    const systemPrompt = SYSTEM_PROMPT_SAFETY_PREFIX + `You are a legal contract analysis specialist. Classify each clause by its canonical type(s).

CANONICAL CLAUSE TYPES (use the exact string, case-sensitive):
${typeList}

CLASSIFICATION HINTS (key phrases that identify each type):
${hintLines}

RULES:
- For most clauses: pick the single best-matching canonical type.
- MULTI-LABEL when a clause clearly and unmistakably addresses two distinct legal topics in the same text. For example, a clause that (a) requires compliance with applicable laws AND (b) requires the party to maintain insurance → ["Compliance with Laws", "Insurance"]. Use at most 3 types.
- Do NOT over-split: most clauses have exactly one type. Only multi-label when two obligations are both fully present.
- "Limitation of liability / cap on liability" → Limited Liability
- "No consequential/special/indirect damages" → Consequential Damages Waiver
- "Non-transferable license restriction" → Non-Transferable License
- "Primary license grant (hereby grants a license to use/copy)" → License Grant
- "Sublicense to affiliates" → Affiliate License
- "Perpetual or irrevocable license" → Irrevocable Or Perpetual License
- Distinguish "No-Solicit Of Employees" vs "No-Solicit Of Customers" based on who is being solicited.
- "Termination for convenience / upon N days notice / without cause" → Termination For Convenience
- "Auto-renew / successive terms" → Renewal Term; "notice to prevent renewal" → Notice Period To Terminate Renewal
- "General notice provisions (how to send notices)" → Notice Requirements
- "Tax obligations, withholding tax, VAT, GST, income tax, responsibility for taxes" → Taxes
- "Gross-up / net-of-tax payment obligation" → Gross-Up Clause
- "Data protection, GDPR, privacy, personal data processing" → Data Protection Clause
- "Compliance with applicable laws/regulations" → Compliance with Laws
- "Anti-corruption, FCPA, bribery, sanctions" → Anti-Corruption / FCPA Clause
- "Attorneys fees, legal fees, cost-shifting" → Attorneys Fees Clause
- "Survival of obligations post-termination" → Survival Clause
- "Driver/employee background checks, criminal history screening, MVR, fingerprinting" → Background Check Requirement
- "Video/audio recording of rides, in-app or rider-facing camera, dash cam / dashcam / vehicle-mounted camera, in-vehicle audio, surveillance, passenger or rider recording consent" → Recording Consent Clause
- "Use of AI/automated or algorithmic decision-making, machine learning, biometric analysis (facial recognition, voice analysis), automated matching/routing/scoring, consent for AI processing of rider or passenger data" → AI Use Consent Clause

BACKGROUND CHECK CADENCE: whenever a clause is classified as Background Check
Requirement, also set "bgc_interval_months" to the required re-screen cadence
in months, inferred from the clause text: annual/annually/yearly → 12;
biennial/every 2 years → 24; every 3 years → 36; quarterly → 3;
semi-annual/every 6 months → 6; monthly → 1. If the clause requires only a
one-time/initial check with no stated recurring cadence, set it to null. For
every other clause type, "bgc_interval_months" must be null.

RECORDING CONSENT POLICY: check EVERY clause for camera/video/audio recording
consent language, regardless of what type you classify the clause as overall
— including a clause whose main topic is something else (e.g. confidentiality
of records) but that also states a recording opt-in/opt-out position in the
same paragraph. Do not skip this check just because "Recording Consent
Clause" isn't the clause's primary or only type. When such language is
present, separately determine the policy for each of THREE independent
recording technologies — IN-APP/RIDER-FACING VIDEO (a camera in the app or
mounted to face the rider/passenger), DASH CAM VIDEO (a vehicle-mounted
camera facing the road/exterior, sometimes also recording the cabin — look
for "dash cam", "dashcam", "dash camera", "vehicle-mounted camera",
"forward-facing camera"), and AUDIO recording. A clause may address only one
of these (e.g. "dash cam video only", "in-vehicle audio recording") or
several, and the policy CAN DIFFER between them — e.g. a contract may require
opt-in consent for the in-app camera while allowing dash cam recording by
default. Do not assume dash cam and in-app video share the same policy
unless the clause text says so explicitly or uses a general term like
"video recording" without distinguishing camera type (in that case, apply
the same policy to both "video_consent_policy" and
"dash_cam_video_consent_policy"). For each of "video_consent_policy"
(in-app/rider-facing video), "dash_cam_video_consent_policy", and
"audio_consent_policy" that the clause actually addresses, set it to:
  - "opt-out" if the clause requires affirmative rider/passenger consent BEFORE
    that kind of recording may occur — i.e. recording is NOT the default and
    riders must consent or "opt in" before being recorded, or the clause
    states riders are opted out of recording by default absent consent.
  - "opt-in" if the clause allows that kind of recording by default and merely
    lets riders/passengers decline or "opt out" if they don't want to be
    recorded.
  - null if that kind of recording isn't addressed by the clause, or the
    policy can't be determined from the text.
For every other clause type, "video_consent_policy", "dash_cam_video_consent_policy",
and "audio_consent_policy" must all be null.

AI USE CONSENT POLICY: this classification is specifically about CONSENT/
PERMISSION for AI or automated processing of rider/passenger data — not
about the mere existence of matching, routing, dispatch, or scoring
functionality. A clause describing how the service operates (e.g. "Provider
shall use its proprietary algorithm to match riders with available
drivers") is an ordinary operational clause, NOT an AI Use Consent Clause,
even though it mentions an algorithm — do not classify it as one just
because it references matching/routing/scoring. Only classify a clause as
AI Use Consent Clause if it explicitly discusses a rider/passenger's
consent, permission, opt-in, or opt-out rights in connection with AI/ML
processing, automated decision-making, or biometric analysis (facial
recognition, voice analysis) applied to their data or recordings.
When (and only when) a clause is correctly classified as AI Use Consent
Clause, set "ai_use_consent_policy" to:
  - "opt-out" if the clause requires affirmative rider/passenger consent BEFORE
    AI/automated processing of their data or recordings may occur.
  - "opt-in" if the clause allows AI/automated processing by default and
    merely lets riders/passengers decline or opt out.
  - null if the clause is classified as AI Use Consent Clause but doesn't
    clearly state which — do NOT default to "opt-in" when uncertain.
For every other clause type — including ordinary matching/routing/dispatch
clauses that don't address consent — "ai_use_consent_policy" must be null,
and the clause must NOT be classified as AI Use Consent Clause.

ADDITIONAL INSURED REQUIREMENT: whenever a clause is classified as Insurance,
also set "additional_insured_required" to true if the clause requires the
counterparty (customer) to be named, added, or endorsed as an "additional
insured" on any insurance policy — e.g. "shall name [Party] as an additional
insured", "additional insured endorsement", "naming [Party] as additional
insured on a primary and non-contributory basis". Otherwise set it to false.
For every other clause type, "additional_insured_required" must be false.
When "additional_insured_required" is true, the "ai_classification" summary
for that clause MUST explicitly call out the Additional Insured requirement
(e.g. "Requires Company to be named as an additional insured on Contractor's
general liability policy...") rather than only describing the insurance
requirement generically.

DATA SHARING PROHIBITION: whenever a clause is classified as Data Protection
Clause, also set "data_sharing_prohibited_outside_usa" to true if the clause
prohibits sharing, transferring, transmitting, or processing personal/rider
data outside the United States — e.g. "shall not transfer Personal Data
outside the United States", "data must remain within the USA", "no
cross-border data transfer without prior written consent". Otherwise set it
to false. For every other clause type, "data_sharing_prohibited_outside_usa"
must be false.

AI_CLASSIFICATION SUMMARY — what it must actually say: "ai_classification" is
read by risk/compliance staff to know what a clause DOES without opening the
document, so it must describe the substantive obligation(s) the clause
imposes, not restate the clause's topic or heading. "Privacy and record-
keeping" is not acceptable for a clause that requires confidentiality of
records AND prohibits recording rides absent consent — describe what is
actually required or prohibited: e.g. "Prohibits recording of rides unless
[Client] affirmatively consents (opt-out default), and requires
confidentiality of all [Client]-related records and information." If a
clause addresses multiple distinct obligations (e.g. a recording
restriction AND a confidentiality duty in the same clause), summarize each
one — do not drop any to save space.
Always name WHO the obligation binds when the clause states or implies it:
the primary party (e.g. "Contractor", "Company") and, when the clause
extends the duty to others — subcontractors, employees, agents, affiliates —
name them too (e.g. "...applies to Contractor and its subcontractors and
employees" rather than just "Contractor"). Do not add a "who" if the clause
doesn't specify one — don't invent scope that isn't there.

Return a JSON array. Each element:
{
  "index": number,
  "obligation_type": string OR string[] (one canonical type, or array of 2–3 when multi-topic clause),
  "ai_classification": string (see AI_CLASSIFICATION SUMMARY rule above — the actual obligation(s) and who they bind, not a topic label),
  "affiliates_bound": string[] (entity or affiliate names explicitly bound, empty array if none),
  "confidence": number 0.0-1.0,
  "bgc_interval_months": number OR null (see BACKGROUND CHECK CADENCE rule above),
  "video_consent_policy": "opt-in" OR "opt-out" OR null (in-app/rider-facing video — see RECORDING CONSENT POLICY rule above),
  "dash_cam_video_consent_policy": "opt-in" OR "opt-out" OR null (dash cam video — see RECORDING CONSENT POLICY rule above),
  "audio_consent_policy": "opt-in" OR "opt-out" OR null (see RECORDING CONSENT POLICY rule above),
  "ai_use_consent_policy": "opt-in" OR "opt-out" OR null (see AI USE CONSENT POLICY rule above),
  "additional_insured_required": boolean (see ADDITIONAL INSURED REQUIREMENT rule above),
  "data_sharing_prohibited_outside_usa": boolean (see DATA SHARING PROHIBITION rule above)
}

Return ONLY valid JSON array. No markdown, no explanation.`;

    const userPrompt = `Classify these contract clauses:\n\n${JSON.stringify(clauseSummaries, null, 2)}`;

    let classified: any[] = [];

    try {
      const completion = await createChatCompletion({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 6000,
      });

      const raw = completion.choices[0]?.message?.content || '[]';
      const cleaned = raw.replace(/```json|```/g, '').trim();
      try { classified = JSON.parse(cleaned); } catch { classified = []; }
    } catch (err: any) {
      const isRateLimit = err?.status === 429 || err?.statusCode === 429;
      console.warn(`Groq classification ${isRateLimit ? 'rate-limited' : 'error'} — using CUAD signature fallback`);
      const normLocal = (t: string | undefined) => {
        if (!t) return 'Other';
        const exact = CANONICAL_CLAUSE_TYPES.find(c => c.toLowerCase() === t.toLowerCase());
        return exact || 'Other';
      };
      classified = classifyWithSignatures(clauses, normLocal);
    }

    // Validate / fuzzy-match a type string to a canonical type.
    // Priority: exact → alias map → partial word match → 'Other'
    const TYPE_ALIASES: Record<string, string> = {
  'indemnity': 'Indemnification',
  'indemnification': 'Indemnification',
  'hold harmless': 'Hold Harmless',
  'governing law': 'Governing Law',
  'choice of law': 'Governing Law',
  'applicable law': 'Governing Law',
  'confidential': 'Confidentiality',
  'confidentiality': 'Confidentiality',
  'non-disclosure': 'Confidentiality',
  'non disclosure': 'Confidentiality',
  'nda': 'Confidentiality',
  'limitation of liability': 'Limited Liability',
  'liability cap': 'Limited Liability',
  'cap on damages': 'Limited Liability',
  'no consequential damages': 'Consequential Damages Waiver',
  'exclusion of damages': 'Consequential Damages Waiver',
  'reps and warranties': 'Representations And Warranties',
  'representations and warranties': 'Representations And Warranties',
  'termination for convenience': 'Termination For Convenience',
  'termination without cause': 'Termination Without Cause',
  'termination for cause': 'Termination With Cause',
  'termination with cause': 'Termination With Cause',
  'intellectual property': 'Intellectual Property Clause',
  'ip rights': 'Intellectual Property Clause',
  'non-compete': 'Non-Compete',
  'non compete': 'Non-Compete',
  'non-competition': 'Non-Compete',
  'non-solicitation': 'Non-Solicitation',
  'non solicitation': 'Non-Solicitation',
  'dispute resolution': 'Dispute Resolution',
  'disputes': 'Dispute Resolution',
  'force majeure': 'Force Majeure',
  'acts of god': 'Force Majeure',
  'insurance requirements': 'Insurance',
  'insurance': 'Insurance',
  'anti-assignment': 'Anti-Assignment',
  'notices': 'Notice Requirements',
  'notice provisions': 'Notice Requirements',
  'integration clause': 'Entire Agreement',
  'entire agreement': 'Entire Agreement',
  'waiver': 'Waiver',
  'amendment': 'Amendment',
  'modifications': 'Amendment',
  'assignment': 'Assignment Clause',
  'payment': 'Payment Terms',
  'payment terms': 'Payment Terms',
  'warranties': 'Warranties',
  'warranty': 'Warranties',
  'arbitration': 'Arbitration',
  'audit': 'Audit Rights',
  'audit rights': 'Audit Rights',
  'term': 'Term',
  'renewal': 'Renewal Clause',
  'termination': 'Termination For Convenience',
  'tax': 'Taxes',
  'taxes': 'Taxes',
  'taxation': 'Taxes',
  'tax obligations': 'Taxes',
  'tax clause': 'Taxes',
  'withholding tax': 'Taxes',
  'gross-up': 'Gross-Up Clause',
  'gross up': 'Gross-Up Clause',
  'data protection': 'Data Protection Clause',
  'privacy': 'Data Protection Clause',
  'gdpr': 'Data Protection Clause',
  'compliance with laws': 'Compliance with Laws',
  'anti-corruption': 'Anti-Corruption / FCPA Clause',
  'fcpa': 'Anti-Corruption / FCPA Clause',
  'attorneys fees': 'Attorneys Fees Clause',
  'legal fees': 'Attorneys Fees Clause',
  'survival': 'Survival Clause',
  'severability': 'Severability',
  'counterparts': 'Counterparts Clause',
  'independent contractor': 'Independent Contractor',
  'work for hire': 'Work for Hire / IP Ownership',
'publicity': 'Publicity / Press Release Clause',
};
const normalizeType = (t: string | undefined): string => {
      if (!t) return 'Other';
      // 1. Exact case-insensitive match (checks custom types too)
      const exact = allClauseTypes.find(c => c.toLowerCase() === t.toLowerCase());
      if (exact) return exact;
      // 2. Alias map
      const lower = t.toLowerCase().trim();
      if (TYPE_ALIASES[lower]) return TYPE_ALIASES[lower];
      // 3. Partial word match (min 6 chars)
      if (lower.length >= 6) {
        const partial = allClauseTypes.find(c => {
          const cl = c.toLowerCase();
          return cl.length >= 6 && (cl.includes(lower) || lower.includes(cl));
        });
        if (partial) return partial;
      }
      return 'Other';
    };

    // Summary-keyword fallback: when the LLM returns "Other", scan its own ai_classification
    // description for topic keywords to infer a better canonical type.
    const SUMMARY_KEYWORD_MAP: Array<{ keywords: string[]; type: string }> = [
      { keywords: ['tax','taxes','taxable','taxation','withholding','vat','gst','excise','sales tax','income tax','levy'], type: 'Taxes' },
      { keywords: ['gross-up','gross up','grossed up','net of tax','after-tax'], type: 'Gross-Up Clause' },
      { keywords: ['anti-corruption','fcpa','bribery','corrupt','sanctions'], type: 'Anti-Corruption / FCPA Clause' },
      { keywords: ['data protection','privacy','gdpr','personal data','data subject'], type: 'Data Protection Clause' },
      { keywords: ['compliance with law','comply with law','applicable law','regulatory'], type: 'Compliance with Laws' },
      { keywords: ['attorney','attorneys fees','legal fees','cost of litigation','court costs'], type: 'Attorneys Fees Clause' },
      { keywords: ['escrow','holdback','held in escrow'], type: 'Escrow' },
      { keywords: ['set-off','setoff','offset','right to offset','deduct amounts owed'], type: 'Set-Off / Offset Clause' },
      { keywords: ['subrogation','waiver of subrogation'], type: 'Waiver of Subrogation' },
      { keywords: ['survival','survives termination','survive expiration','survives this agreement'], type: 'Survival Clause' },
      { keywords: ['entire agreement','integration','supersedes all prior'], type: 'Entire Agreement' },
      { keywords: ['counterparts','electronic signature','facsimile'], type: 'Counterparts Clause' },
      { keywords: ['severability','severable','invalid provision'], type: 'Severability Clause' },
      { keywords: ['joint and several','jointly and severally'], type: 'Joint & Several Liability' },
      { keywords: ['publicity','press release','public announcement','use of name'], type: 'Publicity / Press Release Clause' },
      { keywords: ['independent contractor','not an employee','no employment relationship'], type: 'Independent Contractor Clause' },
      { keywords: ['work for hire','works made for hire','work product'], type: 'Work for Hire / IP Ownership' },
      { keywords: ['non-disparagement','disparage','negative statements about'], type: 'Non-Disparagement' },
      { keywords: ['step-in','step in right','right to step in'], type: 'Step-In Rights' },
      { keywords: ['scope of work','statement of work','deliverables','services to be performed'], type: 'Scope of Work' },
    ];

    function reclassifyFromSummary(summary: string): string {
      if (!summary) return 'Other';
      const lower = summary.toLowerCase();
      for (const { keywords, type } of SUMMARY_KEYWORD_MAP) {
        if (keywords.some(kw => lower.includes(kw))) return type;
      }
      // Try normalizeType on the summary itself — catches cases like "Tax Clause" → "Taxes"
      const fromNormalize = normalizeType(summary);
      if (fromNormalize !== 'Other') return fromNormalize;
      return 'Other';
    }

    // Merge AI results with original clauses.
    // IMPORTANT: detected_type is the user-facing label. Always preserve whatever
    // the client sent (c.detected_type) — the user may have manually edited it
    // between the initial auto-classify and the final save. AI output goes into
    // obligation_type and ai_classification only.
    const mergedClauses = clauses.map((c, i) => {
      const ai = classified.find((x: any) => x.index === i) || {};

      // LLM may return obligation_type as a string or string[] for multi-topic clauses
      const rawOblType = ai.obligation_type;
      const oblTypeArray: string[] = Array.isArray(rawOblType)
        ? rawOblType
        : typeof rawOblType === 'string' && rawOblType.includes(',')
          ? rawOblType.split(',').map((s: string) => s.trim())
          : [rawOblType || ''];

      // Normalize each type in the array
      let canonicalTypes = oblTypeArray.map(normalizeType).filter(t => t !== 'Other');
      const primaryType = canonicalTypes[0] || 'Other';

      // When primary is "Other", try to recover from the summary / clause text
      let finalPrimaryType = primaryType;
      if (finalPrimaryType === 'Other') {
        const summaryGuess = reclassifyFromSummary(ai.ai_classification || '');
        if (summaryGuess !== 'Other') finalPrimaryType = summaryGuess;
        else {
          const sigGuess = reclassifyFromSummary(c.clause_text?.substring(0, 200) || '');
          if (sigGuess !== 'Other') finalPrimaryType = sigGuess;
        }
        if (finalPrimaryType !== 'Other') canonicalTypes = [finalPrimaryType];
      }

      // Also check existing detected_type for additional types already found by LlamaParse
      const existingTypes = (c.detected_type && c.detected_type !== 'Other')
        ? c.detected_type.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];

      // Merge: LlamaParse types + Groq types, deduplicated, capped at 4
      const mergedTypes = [...new Set([...existingTypes, ...canonicalTypes])].filter(t => t !== 'Other').slice(0, 4);
      const finalTypes = mergedTypes.length > 0 ? mergedTypes : [finalPrimaryType];
      const finalDetectedType = finalTypes.join(', ');

      const aiConfidence = typeof ai.confidence === 'number' ? ai.confidence : 0.5;
      const bgcIntervalMonths = finalTypes.includes('Background Check Requirement') && Number.isFinite(ai.bgc_interval_months)
        ? Number(ai.bgc_interval_months)
        : null;
      // Trust the model's own per-field null-gating here (the prompt already
      // says "for every other clause type, video_consent_policy... must be
      // null") instead of re-gating on whether "Recording Consent Clause"
      // made it into THIS clause's own (possibly multi-label) primary type.
      // A clause whose primary topic got classified as something else — e.g.
      // a combined confidentiality + recording-opt-out clause classified
      // mainly as Confidentiality — can still carry a real recording policy
      // the app was silently discarding under the stricter gate, which is
      // why contracts.recording_rule was coming back "missing" despite
      // clear opt-out language actually being in the contract.
      const aiVideoConsentPolicy = (ai.video_consent_policy === 'opt-in' || ai.video_consent_policy === 'opt-out')
        ? ai.video_consent_policy as 'opt-in' | 'opt-out'
        : null;
      const aiDashCamVideoConsentPolicy = (ai.dash_cam_video_consent_policy === 'opt-in' || ai.dash_cam_video_consent_policy === 'opt-out')
        ? ai.dash_cam_video_consent_policy as 'opt-in' | 'opt-out'
        : null;
      const audioConsentPolicy = (ai.audio_consent_policy === 'opt-in' || ai.audio_consent_policy === 'opt-out')
        ? ai.audio_consent_policy as 'opt-in' | 'opt-out'
        : null;
      // Deterministic backstop — only fires when the AI returned nothing for
      // BOTH video fields, so it never overrides a real AI answer. Applied to
      // both video_consent_policy and dash_cam_video_consent_policy, mirroring
      // the prompt's own rule for clause text that doesn't distinguish camera
      // type (a bare regex match on "record"/"camera" can't distinguish it
      // either).
      const recordingKeywordFallback = (aiVideoConsentPolicy === null && aiDashCamVideoConsentPolicy === null)
        ? detectRecordingConsentFallback(c.clause_text || '')
        : null;
      const videoConsentPolicy = aiVideoConsentPolicy ?? recordingKeywordFallback;
      const dashCamVideoConsentPolicy = aiDashCamVideoConsentPolicy ?? recordingKeywordFallback;
      const aiUseConsentPolicy = finalTypes.includes('AI Use Consent Clause') && (ai.ai_use_consent_policy === 'opt-in' || ai.ai_use_consent_policy === 'opt-out')
        ? ai.ai_use_consent_policy as 'opt-in' | 'opt-out'
        : null;
      const additionalInsuredRequired = finalTypes.includes('Insurance') && ai.additional_insured_required === true;
      const dataSharingProhibited = finalTypes.includes('Data Protection Clause') && ai.data_sharing_prohibited_outside_usa === true;

      // Guarantee the requirement is called out in the summary even if the
      // LLM's free-text description didn't mention it despite flagging true.
      let aiClassification: string = ai.ai_classification || c.detected_type || finalTypes[0];
      if (additionalInsuredRequired && !/additional\s+insured/i.test(aiClassification)) {
        const sep = /[.!?]\s*$/.test(aiClassification.trim()) ? ' ' : '. ';
        aiClassification = `${aiClassification.trim()}${aiClassification.trim() ? sep : ''}Requires counterparty to be named as an Additional Insured.`;
      }

      return {
        ...c,
        obligation_type: finalTypes[0],  // primary type for DB column
        detected_type: finalDetectedType, // comma-separated multi-type for UI
        ai_classification: aiClassification,
        clause_name: c.clause_name || undefined,  // preserve document heading from extraction
        affiliates_bound: ai.affiliates_bound || [],
        ai_confidence: aiConfidence,
        bgcIntervalMonths, // transient — used below to backfill contracts.bgc_interval_months, not persisted on the clause row
        videoConsentPolicy, // transient — used below to backfill clients.video_consent_policy, not persisted on the clause row
        dashCamVideoConsentPolicy, // transient — used below to backfill clients.dash_cam_video_consent_policy, not persisted on the clause row
        audioConsentPolicy, // transient — used below to backfill clients.audio_consent_policy, not persisted on the clause row
        aiUseConsentPolicy, // transient — used below to backfill clients.ai_use_consent_policy, not persisted on the clause row
        additionalInsuredRequired, // transient — used below to backfill clients.additional_insured, not persisted on the clause row
        dataSharingProhibited, // transient — used below to backfill clients.prohibition_on_data_sharing, not persisted on the clause row
      };
    });

    // Computed early (normally derived later, alongside clauseRows) because
    // the BGC/recording-rule backfills below need it to record which clause
    // each value actually came from — see clauseIdFromIndex, used by both.
    const earlyDocNumMatch = documentId.match(/^doc_(\d+)$/);
    const earlyDocNum = earlyDocNumMatch ? earlyDocNumMatch[1] : documentId.replace(/\D/g, '').slice(-4).padStart(4, '0');
    const clauseIdFromIndex = (i: number) => `cl_${earlyDocNum}_${String(i + 1).padStart(2, '0')}`;

    // Backfill the linked contract's BGC renewal cadence from the first clause that
    // yielded one — never overwrites a value a reviewer already set (manually or from
    // a prior extraction run); clear it via the Edit form to force re-derivation.
    if (linkedContractId && linkedContractBgcIntervalMonths == null) {
      const detectedIntervalIdx = mergedClauses.findIndex(c => (c as any).bgcIntervalMonths != null);
      if (detectedIntervalIdx !== -1) {
        const detectedInterval = mergedClauses[detectedIntervalIdx] as (typeof mergedClauses[number] & { bgcIntervalMonths: number });
        try {
          const supabase = createServerClient();
          // Contract metadata lives on the documents row now.
          const payload = { bgc_interval_months: detectedInterval.bgcIntervalMonths, bgc_interval_clause_id: clauseIdFromIndex(detectedIntervalIdx) };
          const { error: backfillError } = await supabase.from('documents').update(payload).eq('document_id', linkedContractId);
          if (backfillError?.code === '42703') {
            await supabase.from('contracts').update(payload).eq('document_id', linkedContractId);
          } else if (backfillError) {
            console.error('BGC interval backfill failed:', backfillError.message);
          }
        } catch (err) {
          console.error('BGC interval backfill failed:', err);
        }
      }
    }

    // Backfill the linked contract's OWN recording rule (distinct from the
    // client-level rollup below) — this call always receives the document's
    // full clause set (capped at 500, never paginated), so "no clause here"
    // reliably means "this contract has no recording consent language" once
    // parsed, not just "not in this batch". 'missing' when the contract was
    // parsed but no Recording Consent Clause with a determinable in-app
    // video policy was found; otherwise whatever that clause states
    // ("client consents to the use of video recording…" → opt-in; "client
    // hereby opts out of all recordings…" / "recordings are prohibited
    // absent written consent…" → opt-out). Always recomputed on each
    // extraction run, mirroring the client consent backfill below.
    if (linkedContractId) {
      const recordingClauseIdx = mergedClauses.findIndex(c => (c as any).videoConsentPolicy != null);
      const recordingClause = recordingClauseIdx !== -1 ? mergedClauses[recordingClauseIdx] as (typeof mergedClauses[number] & { videoConsentPolicy: 'opt-in' | 'opt-out' }) : undefined;
      const recordingRule = recordingClause ? recordingClause.videoConsentPolicy : 'missing';
      try {
        const supabase = createServerClient();
        const payload = { recording_rule: recordingRule, recording_rule_clause_id: recordingClauseIdx !== -1 ? clauseIdFromIndex(recordingClauseIdx) : null };
        const { error: recordingRuleError } = await supabase.from('documents').update(payload).eq('document_id', linkedContractId);
        if (recordingRuleError?.code === '42703') {
          await supabase.from('contracts').update(payload).eq('document_id', linkedContractId);
        } else if (recordingRuleError) {
          console.error('Recording rule backfill failed:', recordingRuleError.message);
        }
      } catch (err) {
        console.error('Recording rule backfill failed:', err);
      }
    }

    // Set the linked client's video (in-app + dash cam)/audio/AI-use consent
    // policies from whatever a Recording Consent (video/dash cam/audio) or AI
    // Use Consent clause in this contract actually states — a service
    // engagement recorded against an opt-out policy is a compliance gap
    // (Operations → Service Engagements, Compliance → Recording Consent, and
    // All Gaps all key off clients.video_consent_policy). Bidirectional
    // (opt-in or opt-out, whichever the clause states) and independent per
    // axis — a contract that only addresses the in-app camera leaves dash
    // cam/audio/AI-use untouched, and vice versa. This is one of three ways
    // these fields get set (manual entry via the Edit form, CSV import, and
    // this extraction backfill — see app/(app)/customers/page.tsx); first
    // matching clause wins if multiple clauses in the same document disagree
    // on the same axis.
    if (resolvedCounterpartyId?.startsWith('CLI-')) {
      const videoClause = mergedClauses.find(c => (c as any).videoConsentPolicy != null);
      const dashCamClause = mergedClauses.find(c => (c as any).dashCamVideoConsentPolicy != null);
      const audioClause = mergedClauses.find(c => (c as any).audioConsentPolicy != null);
      const aiUseClause = mergedClauses.find(c => (c as any).aiUseConsentPolicy != null);
      const consentUpdates: Record<string, 'opt-in' | 'opt-out'> = {};
      if (videoClause) consentUpdates.video_consent_policy = (videoClause as any).videoConsentPolicy;
      if (dashCamClause) consentUpdates.dash_cam_video_consent_policy = (dashCamClause as any).dashCamVideoConsentPolicy;
      if (audioClause) consentUpdates.audio_consent_policy = (audioClause as any).audioConsentPolicy;
      if (aiUseClause) consentUpdates.ai_use_consent_policy = (aiUseClause as any).aiUseConsentPolicy;
      if (Object.keys(consentUpdates).length > 0) {
        try {
          const supabase = createServerClient();
          const { error: consentBackfillError } = await supabase
            .from('clients')
            .update(consentUpdates)
            .eq('client_id', resolvedCounterpartyId);
          if (consentBackfillError) console.error('Consent policy backfill failed:', consentBackfillError.message);
        } catch (err) {
          console.error('Consent policy backfill failed:', err);
        }
      }
    }

    // Auto-flip the linked client's data-sharing prohibition flag to true when a
    // Data Protection clause in this contract prohibits sharing data outside the
    // USA — mirrors the Additional Insured auto-backfill pattern below. Only ever
    // sets it to true; never clears an existing Yes.
    if (resolvedCounterpartyId?.startsWith('CLI-')) {
      const dataSharingClause = mergedClauses.find(c => (c as any).dataSharingProhibited === true);
      if (dataSharingClause) {
        try {
          const supabase = createServerClient();
          const { error: dataSharingBackfillError } = await supabase
            .from('clients')
            .update({ prohibition_on_data_sharing: true })
            .eq('client_id', resolvedCounterpartyId);
          if (dataSharingBackfillError) console.error('Data sharing prohibition backfill failed:', dataSharingBackfillError.message);
        } catch (err) {
          console.error('Data sharing prohibition backfill failed:', err);
        }
      }
    }

    // Auto-flip the linked client's Additional Insured flag to Yes when any
    // Insurance clause in this contract requires the client be named as an
    // additional insured — mirrors the BGC/recording-consent auto-backfill
    // pattern above. Only ever sets it to true; never clears an existing Yes.
    if (resolvedCounterpartyId?.startsWith('CLI-')) {
      const additionalInsuredClause = mergedClauses.find(c => (c as any).additionalInsuredRequired === true);
      if (additionalInsuredClause) {
        try {
          const supabase = createServerClient();
          const { error: additionalInsuredBackfillError } = await supabase
            .from('clients')
            .update({ additional_insured: true })
            .eq('client_id', resolvedCounterpartyId);
          if (additionalInsuredBackfillError) console.error('Additional Insured backfill failed:', additionalInsuredBackfillError.message);
        } catch (err) {
          console.error('Additional Insured backfill failed:', err);
        }
      }
    }

    // Derive clause IDs: cl_{doc4digits}_{seqNN} — e.g. cl_0001_01
    const docNumMatch = documentId.match(/^doc_(\d+)$/);
    const docNum = docNumMatch ? docNumMatch[1] : documentId.replace(/\D/g, '').slice(-4).padStart(4, '0');
    // Delete existing clauses for this document so re-extraction replaces rather than accumulates
    if (documentId !== 'tmp') {
      await supabase.from('clauses').delete().eq('document_id', documentId);
    }

    // ─── Category / Modifiers + derived-obligation drafts ───────────────────
    // Focused form-classification pass, run on every document, distinct from
    // the clause-TYPE classifier above. Persisted onto clauses.category /
    // clauses.modifiers; the derived drafts feed the structured-obligation
    // ingest below. Best-effort — classifyClauseForms always resolves (falls
    // back to a deterministic classifier per clause).
    const clauseIdFor = (i: number) => `cl_${docNum}_${String(i + 1).padStart(2, '0')}`;
    let formByClauseId = new Map<string, ClauseFormClassification>();
    try {
      formByClauseId = await classifyClauseForms(
        mergedClauses.map((c, i) => ({
          clause_id: clauseIdFor(i),
          clause_text: c.clause_text,
          clause_type: c.detected_type || c.obligation_type || null,
        })),
      );
    } catch (err: any) {
      console.error('[classify-clauses] form classification failed:', err?.message);
    }

    // Insert with sequential IDs starting from 1
    const clauseRows = mergedClauses.map((c, i) => ({
      clause_id: clauseIdFor(i),
      document_id: documentId,
      entity_name: entityName || null,
      // Store the FULL client / service-provider name, not the bare id.
      counterparty_name:
        resolvedCounterpartyName
        || (counterpartyName && !/^(CLI|SP|CUST|VEND)-\d+$/i.test(counterpartyName.trim()) ? counterpartyName.trim() : null)
        || resolvedCounterpartyId
        || null,
      insurer_vendor_id: insurerVendorId || null,
      clause_no: c.clause_no || null,
      clause_name: c.clause_name || null,
      // clause_type stores the canonical label — this is what the UI reads as detected_type
      clause_type: c.detected_type || c.obligation_type || null,
      clause_text: c.clause_text,
      obligation_type: c.obligation_type,
      ai_classification: c.ai_classification,
      ai_confidence: c.ai_confidence,
      affiliates_bound: c.affiliates_bound,
      review_status: 'pending',
      char_start: c.char_start,
      char_end: c.char_end,
      contract_family_id: contractFamilyId || null,
      paper_source: resolvedPaperSource || null,
      regulatory_source_id: regulatorySourceId || null,
      // Distinct from clause_type (subject matter) and from a derived
      // obligation's requirement_effect. Dropped automatically on upsert if
      // scripts/2026-clause-library-obligations.sql hasn't been applied yet.
      category: formByClauseId.get(clauseIdFor(i))?.category ?? [],
      modifiers: formByClauseId.get(clauseIdFor(i))?.modifiers ?? [],
    }));

    let complianceChecked = 0;
    if (clauseRows.length > 0) {
      const OPTIONAL_CLAUSE_COLS = ['entity_name', 'counterparty_name', 'insurer_vendor_id', 'clause_name', 'contract_family_id', 'paper_source', 'category', 'modifiers'];
      const insertData = clauseRows.map(r => ({ ...r }));
      let upsertError: any = null;
      { const { error } = await supabase.from('clauses').upsert(insertData, { onConflict: 'clause_id' }); upsertError = error ?? null; }
      while (upsertError) {
        const col = OPTIONAL_CLAUSE_COLS.find(c => upsertError!.message?.includes(c) && insertData[0]?.[c as keyof typeof insertData[0]] !== undefined);
        if (!col) break;
        insertData.forEach((r: any) => delete r[col]);
        const { error: retryErr } = await supabase.from('clauses').upsert(insertData, { onConflict: 'clause_id' });
        upsertError = retryErr ?? null;
      }
      if (upsertError) {
        console.error('Clauses upsert error:', upsertError);
      } else if (!RUN_OBLIGATION_PIPELINE) {
        // Standalone: clause save is done. Skip the obligation/compliance
        // pipeline (see RUN_OBLIGATION_PIPELINE note at top of file).
      } else {
        // Obligation-topic mapping (Phase 2b Step 2). Runs for EVERY
        // document's clauses, not only regulatory provisions (chat
        // 2026-08-24) — obligation_topic_definitions/clause_obligation_topics
        // was always designed as a source-neutral vocabulary (see
        // scripts/create-regulatory-sources.sql's header note: deliberately
        // NOT CANONICAL_CLAUSE_TYPES, which is contract-flavored and stays
        // that way for existing consumers). Contract/SOW clauses need the
        // same topic tags a regulation's provisions get so the canonical
        // obligation-comparison engine can pair a regulatory obligation and
        // a contractual obligation on the same topic — it matches by shared
        // topic_id, never by text similarity.
        if (documentId !== 'tmp' && clauseRows.length > 0) {
          try {
            await classifyProvisionTopics(supabase, clauseRows);
          } catch (err: any) {
            console.error('[classify-clauses] obligation-topic mapping error:', err?.message);
          }
        }

        // ─── Structured atomic obligations ──────────────────────────────────
        // clause_units (structural decomposition) → canonical_obligations
        // (+ _sources + _applicability), the single authoritative
        // atomic-obligation model and comparison item. Explicit obligations
        // come from requirement-bearing clause_units; derived obligations come
        // from Statement / Rep-Warranty / Acknowledgment language that
        // produces a concrete effect (formByClauseId drafts). See
        // lib/obligations/ingestClauseObligations.ts. Runs for
        // obligation-bearing source types by default; `deepExtract` forces it
        // for anything else.
        const OBLIGATION_SOURCE_TYPE_BY_DOC: Record<string, ObligationSourceType> = {
          regulation: 'regulation',
          insurance_policy: 'insurance',
          certificate_of_insurance: 'insurance',
          order_form: 'order_form',
        };
        const resolvedObligationSourceType: ObligationSourceType =
          OBLIGATION_SOURCE_TYPE_BY_DOC[documentType || ''] ?? 'contract';
        const runObligationIngest =
          documentId !== 'tmp' && (deepExtract || (documentType || '') !== 'entity_fact_document');
        if (runObligationIngest) {
          try {
            const ingest = await ingestClauseObligationsForDocument(supabase, documentId, {
              sourceType: resolvedObligationSourceType,
              regulatorySourceId: regulatorySourceId || null,
              formClassifications: formByClauseId,
              runComparison: resolvedObligationSourceType !== 'regulation',
            });
            await buildApplicabilityForDocument(supabase, documentId);
            console.log('[classify-clauses] obligation ingest:', JSON.stringify(ingest));
          } catch (ingestErr: any) {
            console.error('[classify-clauses] obligation ingest failed:', ingestErr?.message);
          }
        }

        // Synchronous compliance check — await so results are ready before the UI refreshes
        try {
          const { runDocumentCompliance } = await import('@/lib/compliance/checker');
          const result = await runDocumentCompliance({ documentId, supabase });
          complianceChecked = result.checked;
        } catch (err) {
          console.error('Compliance check error:', err);
        }
      }
    }

    // Surface Category / Modifiers (and the derived-obligation effects) on the
    // returned clauses so the Document Parser preview renders them immediately,
    // before save.
    const responseClauses = mergedClauses.map((c, i) => {
      const form = formByClauseId.get(clauseIdFor(i));
      return {
        ...c,
        category: form?.category ?? [],
        modifiers: form?.modifiers ?? [],
        derived_effects: (form?.derived_obligations ?? []).map(d => d.effect),
      };
    });

    return NextResponse.json({
      success: true,
      clauses: responseClauses,
      savedCount: clauseRows.length,
      complianceChecked,
      deepExtracted: deepExtract && documentId !== 'tmp',
    });
  } catch (err: any) {
    console.error('[classify-clauses]', err?.message);
    return NextResponse.json({ error: 'Classification failed' }, { status: 500 });
  }
}
