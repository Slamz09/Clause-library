import { createChatCompletion, GROQ_MODEL } from '@/lib/groq';
import { sanitizeForPrompt, SYSTEM_PROMPT_SAFETY_PREFIX } from '@/lib/security/sanitizePrompt';

// Extracts a regulation document's structured legal identity — the fields
// regulatory_sources actually has (scripts/create-regulatory-sources.sql) —
// not its provisions (those stay as `clauses`, linked via
// regulatory_source_id once resolveRegulatorySource.ts creates/finds the
// row). Same shape as classifyInsurancePolicy.ts: one whole-document
// extraction call, not per-clause.

export interface RegulatorySourceExtraction {
  jurisdiction: string | null;       // full name, e.g. "California" — matches governing_law's existing US_STATES convention
  jurisdiction_level: 'state' | 'federal' | 'county' | 'city';
  authority: string | null;          // issuing body, e.g. "California State Legislature" or an agency name
  citation: string | null;           // formal citation/bill number, e.g. "SB-88 (2023-2024)" or "Cal. Educ. Code § 39875"
  title: string | null;              // short title
  summary: string | null;
  effective_from: string | null;     // ISO YYYY-MM-DD, only when the document states one
}

export async function classifyRegulatorySource(documentText: string): Promise<RegulatorySourceExtraction> {
  const systemPrompt = SYSTEM_PROMPT_SAFETY_PREFIX + `You are a legal-research analyst. Extract the identifying metadata of this regulatory/legal-authority document (a statute, bill, ordinance, or agency rule) — NOT its individual provisions, just what the document IS.

Return ONLY a single valid JSON object, no markdown, no explanation, in this exact shape:
{
  "jurisdiction": string or null (the full state or country name this law belongs to, e.g. "California", "Colorado", "United States" — not an abbreviation),
  "jurisdiction_level": "state" | "federal" | "county" | "city",
  "authority": string or null (the issuing body — e.g. "California State Legislature", a named agency, or a city/county government),
  "citation": string or null (the formal citation or bill number as written, e.g. "SB-88 (2023-2024)", "Cal. Educ. Code § 39875", "34 CFR Part 99" — preserve the document's own citation format, don't invent one),
  "title": string or null (the law's short title, e.g. "Pupil transportation: driver qualifications"),
  "summary": string or null (1-2 sentences on what the law does, in your own words),
  "effective_from": string or null (ISO YYYY-MM-DD, ONLY if the document states an explicit effective/enactment date — do not guess)
}

Return ONLY valid JSON. No markdown, no explanation.`;

  const userPrompt = `Extract the regulatory identity metadata from this document:\n\n${sanitizeForPrompt(documentText.substring(0, 12000), 12000)}`;

  const completion = await createChatCompletion({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.1,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  });
  const raw = completion.choices[0]?.message?.content || '{}';
  const cleaned = raw.replace(/```json|```/g, '').trim();
  let result: any = {};
  try { result = JSON.parse(cleaned); } catch { result = {}; }

  const level = result.jurisdiction_level;
  return {
    jurisdiction: typeof result.jurisdiction === 'string' && result.jurisdiction.trim() ? result.jurisdiction.trim() : null,
    jurisdiction_level: (level === 'federal' || level === 'county' || level === 'city') ? level : 'state',
    authority: typeof result.authority === 'string' && result.authority.trim() ? result.authority.trim() : null,
    citation: typeof result.citation === 'string' && result.citation.trim() ? result.citation.trim() : null,
    title: typeof result.title === 'string' && result.title.trim() ? result.title.trim() : null,
    summary: typeof result.summary === 'string' && result.summary.trim() ? result.summary.trim() : null,
    effective_from: typeof result.effective_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(result.effective_from) ? result.effective_from : null,
  };
}
