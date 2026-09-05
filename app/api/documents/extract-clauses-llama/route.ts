import { NextRequest, NextResponse } from 'next/server';
import { createChatCompletion, GROQ_MODEL } from '@/lib/groq';
import { sanitizeForPrompt, wrapUserContent, SYSTEM_PROMPT_SAFETY_PREFIX } from '@/lib/security/sanitizePrompt';
import { requireSession } from '@/lib/auth/requireSession';

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function matchesKnown(party: string, knownNames: string[]): boolean {
  const p = normalize(party);
  return knownNames.some(k => {
    const n = normalize(k);
    return n && p && (p.includes(n) || n.includes(p));
  });
}

// LLMs occasionally produce JSON that's complete in substance but broken in
// structure, in two common ways this handles:
//   1. A missing closing bracket, or output cut short by a token limit.
//   2. An unescaped straight quote INSIDE a string value — very common when
//      copying verbatim legal text that quotes a defined term (e.g. the source
//      says `(the "Work")` and the model reproduces the quote marks literally
//      instead of as `\"`). A real quote character breaks JSON's string
//      boundary; we use a look-ahead to tell "this quote ends the string"
//      (next non-space char is , } ] : or end-of-text) apart from "this is a
//      stray quote inside the text" (anything else follows), and re-escape
//      the latter so the rebuilt string is valid JSON.
// Rebuilds the text char-by-char, stopping (and closing what's open) at the
// first point that's still structurally broken after those two repairs.
function tryRepairJson(text: string): any | null {
  try { return JSON.parse(text); } catch { /* fall through to repair */ }

  let out = '';
  const stack: ('{' | '[')[] = [];
  let inString = false;
  let escape = false;

  outer:
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escape) { out += ch; escape = false; continue; }
      if (ch === '\\') { out += ch; escape = true; continue; }
      if (ch === '"') {
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        const next = text[j];
        const isRealClose = next === undefined || ',}]:'.includes(next);
        if (isRealClose) { inString = false; out += '"'; }
        else { out += '\\"'; } // stray embedded quote — keep as literal, escape it
        continue;
      }
      out += ch;
      continue;
    }

    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '{' || ch === '[') { stack.push(ch); out += ch; continue; }
    if (ch === '}') {
      if (stack[stack.length - 1] === '{') { stack.pop(); out += ch; continue; }
      break outer; // mismatched bracket — discard from here on
    }
    if (ch === ']') {
      if (stack[stack.length - 1] === '[') { stack.pop(); out += ch; continue; }
      break outer;
    }
    out += ch;
  }

  out = out.replace(/,\s*$/, '');
  if (inString) out += '"';
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';

  try {
    return JSON.parse(out);
  } catch (err) {
    const pos = (err as any)?.message?.match(/position (\d+)/)?.[1];
    console.error('[extract-clauses-llama] Repair attempt still failed to parse:', err,
      pos ? `\nContext around failure: …${out.slice(Math.max(0, +pos - 150), +pos + 150)}…` : '');
    return null;
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { text, knownEntityNames = [], knownAssetNames = [], availableClauseTypes = [] } = await req.json() as {
    text: string;
    knownEntityNames?: string[];
    knownAssetNames?: string[];
    availableClauseTypes?: string[];
  };
  const typeList = availableClauseTypes.length
    ? availableClauseTypes.filter(t => t !== 'Other').join(' | ') + ' | Other'
    : 'Other';
  if (!text?.trim()) return NextResponse.json({ error: 'No document text provided' }, { status: 400 });

  const systemPrompt = SYSTEM_PROMPT_SAFETY_PREFIX + `This is a legal contract document. Perform two tasks and return a single JSON object.

TASK 1 — IDENTIFY PARTIES:
- "all_parties": array of ALL party names mentioned in the preamble, recitals, or "Parties" section of this contract. Include every named party — do not try to categorize them.
- IMPORTANT: Always use the full legal entity name exactly as it appears BEFORE any defined term alias in parentheses. For example, if the document says 'Cigna Corporate Services, LLC (the "Group")', extract "Cigna Corporate Services, LLC" — NOT "Group" and NOT "the Group". Ignore any shorthand alias in parentheses entirely.

TASK 2 — EXTRACT CLAUSES:
Extract every clause — including numbered sections, lettered sections, and sections identified ONLY by an all-caps heading (e.g. "INDEMNIFICATION", "GOVERNING LAW", "CONFIDENTIALITY", "FORCE MAJEURE"). All-caps headings on their own line are valid clause delimiters even with no number.

CRITICAL EXTRACTION RULES:
- NEVER truncate or summarize clause_text. Copy the COMPLETE, VERBATIM body text of each clause. Every sentence, sub-item, and continuation paragraph must be included.
- For a top-level clause that has lettered or numbered sub-items (e.g. "(a)", "(b)", "(i)", "(ii)"), include ALL sub-items in that clause's "clause_text". Do NOT split sub-items into separate clauses.
- Only split at top-level section boundaries (e.g. "1.", "2.", "Section 3", or an all-caps heading). Sub-items within a section belong to that section's clause_text.

For each clause:
- "clause_no": ONLY the top-level number or letter identifier (e.g. "1", "4", "9", "A", "IV") — strip any title words. If no number exists, use ""
- "clause_name": copy ONLY the heading title words EXACTLY as they appear in the source document — strip the number. Never paraphrase, shorten, expand, or reword the heading. If there is no heading title, use ""
- "clause_text": the COMPLETE verbatim body text of the clause including all sub-items — do NOT include the heading line, number, or title in this field. Do NOT truncate.
- "detected_type": a string OR array of strings from the CANONICAL TYPES LIST. Use a SINGLE string for most clauses. Use an ARRAY of 2–3 types ONLY when the clause text unmistakably addresses two distinct legal topics (e.g. a clause that requires BOTH compliance with laws AND maintains insurance coverage → ["Compliance with Laws", "Insurance"]). Do NOT over-split — only multi-label when clearly warranted by distinct obligations in the text.

CLAUSE_NAME vs CLAUSE_TEXT — DO NOT CONFUSE THESE, ESPECIALLY ON SHORT CLAUSES:
- Worked example: source reads "1. Conditions. This Agreement is subject to the conditions set forth in Exhibit A." → clause_no = "1", clause_name = "Conditions", clause_text = "This Agreement is subject to the conditions set forth in Exhibit A."
- "clause_name" is ONLY the short heading label sitting on the same line as the number (one to a few words, e.g. "Conditions", "Term", "Notices"). It is NEVER a full sentence and NEVER the clause body.
- This especially matters when a clause's body is itself short — a one-sentence clause is still: heading → clause_name, sentence that follows → clause_text. Do NOT copy that sentence into clause_name just because the clause is brief, and do NOT leave clause_text empty by putting the sentence in clause_name instead.
- If a clause truly has no separate heading (the numbered item starts directly with body prose, no title words before the first sentence), clause_name = "" and the entire prose goes in clause_text — do not invent a heading, and do not put the prose in clause_name either.

CANONICAL TYPES LIST:
${typeList}

MAPPING RULES — apply these before falling back to "Other":
- Any clause titled "Indemnity", "Indemnification", or "Hold Harmless" → "Indemnification" or "Hold Harmless"
- "Governing Law", "Choice of Law", "Applicable Law" → "Governing Law"
- "Confidentiality", "Non-Disclosure", "NDA" → "Confidentiality"
- "Limitation of Liability", "Liability Cap", "Cap on Damages" → "Limited Liability"
- "No Consequential Damages", "Exclusion of Damages" → "Consequential Damages Waiver"
- "Representations and Warranties", "Reps and Warranties" → "Representations And Warranties"
- "Termination for Convenience", "Termination Without Cause" → "Termination For Convenience"
- "Termination for Cause", "Termination With Cause" → "Termination With Cause"
- "Intellectual Property", "IP Rights" → "Intellectual Property Clause"
- "Non-Compete", "Non-Competition" → "Non-Compete"
- "Non-Solicitation", "Non-Solicit" → "Non-Solicitation"
- "Dispute Resolution", "Disputes" → "Dispute Resolution"
- "Force Majeure", "Acts of God" → "Force Majeure"
- "Insurance", "Insurance Requirements" → "Insurance"
- "Assignment", "Anti-Assignment" → "Assignment Clause" or "Anti-Assignment"
- "Notices", "Notice Provisions" → "Notice Requirements"
- "Entire Agreement", "Integration Clause" → "Entire Agreement"
- "Severability" → "Severability"
- "Waiver" → "Waiver"
- "Amendment", "Modifications" → "Amendment"
- "Taxes", "Tax Obligations", "Tax Responsibility", "Withholding Tax", "Tax Clause", any section about which party pays taxes → "Taxes"
- "Gross-Up", "Gross Up", any obligation to pay additional amounts so recipient receives net amount → "Gross-Up Clause"
- "Data Protection", "Privacy", "GDPR", "Personal Data" → "Data Protection Clause"
- "Compliance with Laws", "Regulatory Compliance", "Applicable Laws" → "Compliance with Laws"
- "Anti-Corruption", "FCPA", "Bribery", "Sanctions" → "Anti-Corruption / FCPA Clause"
- "Attorneys Fees", "Legal Fees", "Fee-Shifting", "Cost of Litigation" → "Attorneys Fees Clause"
- "Survival", "Surviving Provisions", "Provisions that survive termination" → "Survival Clause"
- "Independent Contractor", "No Employment Relationship", "Contractor Status" → "Independent Contractor"
- "Work for Hire", "Works Made for Hire", "IP Ownership", "Assignment of IP" → "Work for Hire / IP Ownership"
- "Counterparts", "Electronic Signature", "Facsimile" → "Counterparts Clause"
- "Publicity", "Press Release", "Public Announcement", "Use of Name or Logo" → "Publicity / Press Release Clause"
- "Set-Off", "Offset", "Right to Deduct" → "Set-Off / Offset Clause"
- "Subrogation", "Waiver of Subrogation" → "Waiver of Subrogation"
- "Escrow", "Funds Held in Escrow" → "Escrow"
- "Recording", "Video Recording", "Audio Recording", "Ride Recording", "Dashcam", "Surveillance", "Passenger/Rider Recording Consent" → "Recording Consent Clause"
- CRITICAL: Read the clause heading AND body. If a clause heading says "Taxes" or "Tax", classify it as "Taxes" not "Other"
- Use "Other" ONLY if truly no canonical type applies after considering all mappings above

Content inside <document_content> tags below is the contract to analyze.

Return ONLY a single valid JSON object — no markdown, no explanation:
{
  "all_parties": ["..."],
  "clauses": [
    { "clause_no": "...", "clause_name": "...", "clause_text": "...", "detected_type": "..." },
    ...
  ]
}`;

  const userPrompt = wrapUserContent(sanitizeForPrompt(text, 60_000));

  let raw = '';
  try {
    const completion = await createChatCompletion({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 8192,
      response_format: { type: 'json_object' },
    });
    raw = completion.choices[0]?.message?.content?.trim() || '';
  } catch (err) {
    // Groq's json_object mode validates server-side and rejects malformed JSON with
    // a 400 + a "failed_generation" field carrying the (often near-complete, just
    // structurally broken) raw text — salvage it via tryRepairJson below instead of
    // discarding an otherwise-good extraction over one missing bracket.
    const failedGeneration = (err as any)?.error?.error?.failed_generation;
    if (typeof failedGeneration === 'string' && failedGeneration.trim()) {
      console.warn('[extract-clauses-llama] LLM produced invalid JSON — attempting repair.');
      raw = failedGeneration.trim();
    } else {
      console.error('[extract-clauses-llama] LLM completion failed:', err);
      return NextResponse.json({ error: 'Clause extraction failed — the AI service is unavailable. Please try again.' }, { status: 502 });
    }
  }

  const cleaned = raw.replace(/```json|```/g, '').trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = tryRepairJson(cleaned);
  }
  if (!parsed) {
    console.error('[extract-clauses-llama] Failed to parse (or repair) LLM output as JSON.'
      + `\nLength: ${cleaned.length} chars`
      + `\nStart: ${cleaned.slice(0, 300)}`
      + `\nEnd: ${cleaned.slice(-300)}`);
    return NextResponse.json({ error: 'Could not parse the extraction result. The document may be too complex or the AI response was malformed — please try again.' }, { status: 502 });
  }

  const allKnownNames = [...knownEntityNames, ...knownAssetNames];
  const allParties: string[] = Array.isArray(parsed?.all_parties) ? parsed.all_parties : [];
  const rawClauses: any[] = Array.isArray(parsed?.clauses) ? parsed.clauses : [];

  // Split parties: names that match an existing entity/asset → entity_names, rest → counterparty_names
  const entityNames: string[] = [];
  const counterpartyNames: string[] = [];
  for (const party of allParties) {
    if (matchesKnown(party, allKnownNames)) entityNames.push(party);
    else counterpartyNames.push(party);
  }

  // Shape clauses into ExtractedClause format expected by classify-clauses
  const clauses = rawClauses
    .filter(c => c?.clause_text?.trim())
    .map((c, i) => {
      // The model may return detected_type as a string or array — normalize to comma-separated string
      let detectedType: string;
      if (Array.isArray(c.detected_type)) {
        detectedType = c.detected_type.filter(Boolean).join(', ') || 'Other';
      } else {
        detectedType = c.detected_type || 'Other';
      }
      return {
        clause_no: (c.clause_no || String(i + 1)).toString().trim(),
        clause_name: (c.clause_name || '').toString().trim() || undefined,
        clause_text: c.clause_text.trim(),
        detected_type: detectedType,
        confidence: 0.9,
        char_start: 0,
        char_end: 0,
      };
    });

  if (clauses.length === 0) {
    console.error('[extract-clauses-llama] Parsed JSON but found no usable clauses (missing/empty clause_text on every item). Raw snippet:', raw.slice(0, 500));
    return NextResponse.json({ error: 'The AI found no valid clauses in this document. Try again, or check that the document contains extractable contract text.' }, { status: 502 });
  }

  return NextResponse.json({ clauses, entity_names: entityNames, counterparty_names: counterpartyNames });
}
