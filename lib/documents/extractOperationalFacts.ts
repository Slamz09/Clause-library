import { createChatCompletion, GROQ_MODEL } from '@/lib/groq';
import { sanitizeForPrompt, SYSTEM_PROMPT_SAFETY_PREFIX } from '@/lib/security/sanitizePrompt';

// ─── Document-derived canonical facts ───────────────────────────────────────
// A CONTRACT/SOW/order form is a potential evidence source for canonical
// applicability facts the same way a regulation is evidence for a legal
// requirement — deliberately a SEPARATE operation from regulatory
// applicability itself (chat 2026-08-24):
//
//   agreement → extracted facts → canonical facts → regulatory applicability
//
// This module is the first arrow only: agreement text → normalized values in
// the SAME canonical vocabulary factResolvers.ts / fact_definitions already
// use, so the SB-88 (or any other) applicability engine can consume them
// without ever knowing a document was involved. It does NOT write to
// entity_facts itself (see writeOperationalFacts below) and does NOT touch
// regulatory_applicability_* — those stay separate operations, called
// explicitly by whatever ingestion path wants them, not chained implicitly.
//
// Scope correction (chat 2026-08-24): client_is_lea genuinely describes the
// CLIENT itself — it stays a client-level fact. activity_type and
// serviceJurisdiction do NOT — they describe what ONE agreement establishes
// about the work performed under it, not a permanent property of the client.
// A client can have multiple contracts/engagements covering different
// activities or locations; a single pupil-transportation SOW must never make
// every future engagement for that client inherit
// activity_type=school_related_pupil_transportation. See writeOperationalFacts
// below and lib/regulatory/factResolvers.ts's resolveContractEntityFact for
// how these are scoped to the specific contract/engagement instead.
//
// serviceJurisdiction is also deliberately distinct from a contract's
// governing-law clause — a California choice-of-law clause alone is not
// evidence the underlying activity is actually performed in California; only
// extract it when the text describes where the service/activity itself takes
// place.

export interface OperationalFactExtraction {
  client_is_lea: boolean | null;
  activity_type: 'school_related_pupil_transportation' | 'other' | null;
  serviceJurisdiction: string | null; // full state/country name where the CONTRACTED SERVICE is performed — not the governing-law clause
  confidence: number; // one confidence for the whole extraction pass — per-fact confidence would need per-fact quotes, deferred
  supportingExcerpt: string | null; // short verbatim quote used as source_location provenance — NOT the full clause text
}

export async function extractOperationalFacts(documentText: string): Promise<OperationalFactExtraction> {
  const systemPrompt = SYSTEM_PROMPT_SAFETY_PREFIX + `You are a contracts analyst extracting OPERATIONAL FACTS about a client relationship from a contract, statement of work, or order form — not the contract's obligations, just what kind of relationship and service this document establishes.

Return ONLY a single valid JSON object, no markdown, no explanation, in this exact shape:
{
  "client_is_lea": true | false | null (is the counterparty/client a Local Educational Agency — a public school district, county office of education, or similar K-12 public education governing body? null if the document gives no basis to tell),
  "activity_type": "school_related_pupil_transportation" | "other" | null (does this agreement establish that the service being provided is transporting K-12 pupils/students to or from school or school-related activities? "other" if the agreement is for something else; null if unclear),
  "serviceJurisdiction": string or null (the state or country where the CONTRACTED SERVICE/ACTIVITY ITSELF is physically performed, e.g. "California" — full name, not an abbreviation. Do NOT infer this from a governing-law/choice-of-law clause alone — a contract can be governed by one state's law while the service is performed in another. Only answer if the text describes where the actual work takes place, e.g. the district's location, delivery addresses, service area language.),
  "confidence": 0.0-1.0 (your overall confidence in these three answers together),
  "supportingExcerpt": string or null (the single shortest verbatim quote from the document that best supports client_is_lea and/or activity_type — under 200 characters, or null if none of the three fields resolved)
}

Return ONLY valid JSON. No markdown, no explanation.`;

  const userPrompt = `Extract operational facts from this document:\n\n${sanitizeForPrompt(documentText.substring(0, 12000), 12000)}`;

  const completion = await createChatCompletion({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.1,
    max_tokens: 1200,
    response_format: { type: 'json_object' },
  });
  const raw = completion.choices[0]?.message?.content || '{}';
  let result: any = {};
  try { result = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch { result = {}; }

  return {
    client_is_lea: typeof result.client_is_lea === 'boolean' ? result.client_is_lea : null,
    activity_type: result.activity_type === 'school_related_pupil_transportation' || result.activity_type === 'other' ? result.activity_type : null,
    serviceJurisdiction: typeof result.serviceJurisdiction === 'string' && result.serviceJurisdiction.trim() ? result.serviceJurisdiction.trim() : null,
    confidence: typeof result.confidence === 'number' ? Math.max(0, Math.min(1, result.confidence)) : 0.5,
    supportingExcerpt: typeof result.supportingExcerpt === 'string' && result.supportingExcerpt.trim() ? result.supportingExcerpt.trim().slice(0, 300) : null,
  };
}

// Writes the extraction as entity_facts, split by what each fact actually
// describes (chat 2026-08-24 scope correction):
//   client_is_lea       → entity_type='client', entity_id=clientId — a real
//                          property of the client itself, stable across every
//                          contract/engagement that client ever has.
//   activity_type,
//   serviceJurisdiction → entity_type='contract', entity_id=contractId — what
//                          THIS agreement establishes, not the client. Read
//                          back only through resolveContractEntityFact()'s
//                          worker→engagement→controlling-contract resolution
//                          in factResolvers.ts, never merged onto the client
//                          the way client_is_lea is — a client with two
//                          concurrent contracts for different activities must
//                          not have either contract's facts bleed into the
//                          other's engagements.
// Provenance (source_document_id/source_location/source_system/
// extraction_confidence) traces every fact straight back to the document and
// the exact excerpt that supported it — verification_status is
// 'machine_extracted', never 'human_confirmed', since nothing reviewed this.
export async function writeOperationalFacts(
  supabase: any,
  documentId: string,
  clientId: string,
  contractId: string,
  extraction: OperationalFactExtraction,
): Promise<{ written: string[] }> {
  const { data: factDefs } = await supabase.from('fact_definitions').select('id, fact_key').in('fact_key', ['client_is_lea', 'activity_type', 'service_jurisdiction']);
  const idByKey = Object.fromEntries((factDefs || []).map((f: any) => [f.fact_key, f.id]));

  const rows: any[] = [];
  const written: string[] = [];
  const provenance = {
    source_document_id: documentId, source_location: extraction.supportingExcerpt,
    source_system: 'document_extraction', extraction_confidence: extraction.confidence,
    verification_status: 'machine_extracted',
  };
  if (extraction.client_is_lea !== null && idByKey.client_is_lea) {
    rows.push({ ...provenance, entity_type: 'client', entity_id: clientId, fact_definition_id: idByKey.client_is_lea, value: extraction.client_is_lea });
    written.push('client_is_lea');
  }
  if (extraction.activity_type !== null && idByKey.activity_type) {
    rows.push({ ...provenance, entity_type: 'contract', entity_id: contractId, fact_definition_id: idByKey.activity_type, value: extraction.activity_type });
    written.push('activity_type');
  }
  if (extraction.serviceJurisdiction !== null && idByKey.service_jurisdiction) {
    rows.push({ ...provenance, entity_type: 'contract', entity_id: contractId, fact_definition_id: idByKey.service_jurisdiction, value: extraction.serviceJurisdiction });
    written.push('service_jurisdiction');
  }
  if (rows.length === 0) return { written: [] };

  const { error } = await supabase.from('entity_facts').insert(rows);
  if (error) throw error;
  return { written };
}
