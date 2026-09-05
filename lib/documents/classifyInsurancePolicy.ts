import { createChatCompletion, GROQ_MODEL } from '@/lib/groq';
import { sanitizeForPrompt, SYSTEM_PROMPT_SAFETY_PREFIX } from '@/lib/security/sanitizePrompt';

// Extracted out of app/api/documents/classify-insurance/route.ts so
// processDocumentUpload() (bulk upload) can run the exact same whole-document
// policy-metadata extraction the interactive single-upload flow uses, instead
// of a second, drifted copy. The route stays the thin HTTP wrapper the
// existing single-upload UI calls before showing the user a confirmation
// step; this function is what actually does the work, callable directly
// (no fetch, no session-cookie gate) from server-side pipelines.
//
// Two distinct document types share this: insurance_policy (has an insurer
// and a "named insured" — the policyholder itself, never a covered client)
// and certificate_of_insurance / COI (additionally names which clients are
// covered — the only doc type where linked_client_ids gets populated).

export interface InsurancePolicyExtraction {
  policy_number: string;
  coverage_type: string;
  coverage_amount: string;
  effective_date: string;
  expiration_date: string;
  states: string[];
  insurance_company: string;
  named_insured: string[];
  linked_client_ids: string[];
  linked_client_names: string[];
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}
function matchesKnown(name: string, knownName: string): boolean {
  const a = normalize(name), b = normalize(knownName);
  return !!a && !!b && (a.includes(b) || b.includes(a));
}

export async function classifyInsurancePolicy(
  supabase: any,
  documentText: string,
  documentType: 'insurance_policy' | 'certificate_of_insurance',
): Promise<InsurancePolicyExtraction> {
  const isCoi = documentType === 'certificate_of_insurance';

  const systemPrompt = SYSTEM_PROMPT_SAFETY_PREFIX + `You are an insurance-document analyst. Extract every relevant field from this ${isCoi ? 'Certificate of Insurance (COI)' : 'insurance policy'} document.

Return ONLY a single valid JSON object, no markdown, no explanation, in this exact shape:
{
  "policy_number": string or null,
  "coverage_type": string or null (e.g. "Commercial General Liability", "Commercial Auto", "Umbrella"),
  "coverage_amount": string or null (see LIMITS rule below),
  "effective_date": string or null (as written in the document),
  "expiration_date": string or null (as written in the document),
  "states": string[] (2-letter US state codes this policy covers or applies to — infer from named insured addresses, endorsements, or an explicit state/territory list; empty array if none found),
  "insurance_company": string or null (the underwriter/carrier/insurer issuing the policy — e.g. "Sample Assurance Underwriters, Inc."),
  "named_insured": string[] (the policyholder's own company/companies named as the "Named Insured" on the policy — e.g. "Edutech, LLC", "EduRide Technologies, Inc." — this is who is BUYING the insurance, never a customer of theirs),
  "certificate_holder_names": string[] (ONLY relevant on a Certificate of Insurance: every additional insured / certificate holder / covered party named as being covered by this policy — these are typically the policyholder's OWN customers or contractual counterparties, distinct from the named insured; empty array if this is a policy document rather than a certificate, or if none are named)
}

LIMITS: "coverage_amount" must capture EVERY limit, sub-limit, and deductible line item found anywhere in the document — not just the top-line "each occurrence"/"aggregate" figures. Look for tables titled things like "Limits of Liability", "Schedule of Deductibles", "Coverage Summary", etc. and enumerate every row you find. Format as one "Label: Amount" per line, e.g.:
Each Occurrence: $2,000,000
General Aggregate: $3,000,000
Products & Completed Operations Aggregate: $2,000,000
Personal & Advertising Injury: $2,000,000
Fire Damage (Rented Premises), per fire: $100,000
Medical Payments, per person: $10,000
Pollution Liability (limit & aggregate): $1,000,000
Hired/Non-Owned Auto: $1,000,000
Bodily Injury, per occurrence (deductible): $250
Property Damage, per occurrence (deductible): $1,000
Do not summarize or truncate — include every distinct limit/deductible row even if there are a dozen or more.

NAMED INSURED vs COVERED CUSTOMER: do not confuse these. "Named Insured" is whoever the policy is issued TO (the policyholder itself, or its named affiliates). "certificate_holder_names" is only for parties a COI separately lists as covered/certificate holders — typically the policyholder's own downstream customers. A plain insurance policy document (not a COI) almost never has certificate holders; leave that array empty in that case.

Return ONLY valid JSON. No markdown, no explanation.`;

  const userPrompt = `Extract insurance details from this ${isCoi ? 'Certificate of Insurance' : 'insurance policy'} document:\n\n${sanitizeForPrompt(documentText.substring(0, 16000), 16000)}`;

  let result: any = {};
  const completion = await createChatCompletion({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.1,
    max_tokens: 3000,
  });
  const raw = completion.choices[0]?.message?.content || '{}';
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try { result = JSON.parse(cleaned); } catch { result = {}; }

  // Only a COI ever resolves/populates covered clients — a plain policy
  // document's named insured is the policyholder itself, not a client.
  let linkedClientIds: string[] = [];
  const certificateHolderNames: string[] = Array.isArray(result.certificate_holder_names) ? result.certificate_holder_names : [];
  if (isCoi && certificateHolderNames.length > 0) {
    const { data: clients } = await supabase.from('clients').select('client_id, client_name');
    for (const name of certificateHolderNames) {
      const match = (clients || []).find((c: any) => matchesKnown(name, c.client_name));
      if (match && !linkedClientIds.includes(match.client_id)) linkedClientIds.push(match.client_id);
    }
  }

  return {
    policy_number: result.policy_number || '',
    coverage_type: result.coverage_type || '',
    coverage_amount: result.coverage_amount || '',
    effective_date: result.effective_date || '',
    expiration_date: result.expiration_date || '',
    states: Array.isArray(result.states) ? result.states : [],
    insurance_company: result.insurance_company || '',
    named_insured: Array.isArray(result.named_insured) ? result.named_insured : [],
    linked_client_ids: linkedClientIds,
    linked_client_names: certificateHolderNames,
  };
}
