import { NextRequest, NextResponse } from 'next/server';
import { createChatCompletion, GROQ_MODEL } from '@/lib/groq';
import { extractTextFromFile } from '@/lib/extractText';
import { requireSession } from '@/lib/auth/requireSession';

// Terms that are never useful as party identifiers in a playbook context
const GENERIC = new Set([
  'party', 'parties', 'both parties', 'the parties', 'each party',
  'either party', 'all parties', 'the party', 'a party', 'each a party',
  'you', 'your', 'user', 'person', 'individual', 'organization',
  'entity', 'company', 'corporation', 'business',
]);

function isGeneric(s: string): boolean {
  return GENERIC.has(s.toLowerCase().trim());
}

/**
 * Regex-based extraction from the opening "Parties" section of a contract.
 * Finds role labels defined via parenthetical notation like:
 *   HopSkipDrive, Inc., a Delaware Corporation (the "Contractor")
 *   the entity placing an order (the "Customer", "Organization", or "you")
 * Returns role labels (e.g. "Contractor", "Customer") AND full legal names
 * (e.g. "HopSkipDrive, Inc."), filtering out generic terms.
 */
function extractPartiesRegex(text: string): string[] {
  // Only look at the first ~5000 chars — party definitions are in the opening paragraph
  const preview = text.slice(0, 5000);
  const found = new Set<string>();

  // Pattern A: parenthetical defined terms — (the "Contractor"), ("Customer"), (the "Landlord" or "Tenant")
  // Uses both straight quotes and curly quotes
  const definePattern = /\(\s*(?:the\s+|each\s+(?:a\s+)?|collectively\s+the\s+)?["\u201c\u201d]([A-Z][A-Za-z\s\-]+?)["\u201c\u201d]/g;
  let m: RegExpExecArray | null;
  while ((m = definePattern.exec(preview)) !== null) {
    const term = m[1].trim();
    if (term.length >= 3 && !isGeneric(term)) found.add(term);
  }

  // Pattern B: legal entity names ending with a recognisable suffix
  const entityPattern = /([A-Z][A-Za-z0-9\s\.,'&\-]{2,60}(?:LLC|Corp\.?|Inc\.?|Ltd\.?|L\.P\.|LLP|Corporation|Company|Co\.))/g;
  while ((m = entityPattern.exec(preview)) !== null) {
    const name = m[1].trim().replace(/,\s*$/, '').replace(/\s{2,}/g, ' ');
    if (name.length >= 4 && name.length <= 90 && !isGeneric(name)) found.add(name);
  }

  return [...found];
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });

  const buffer = await file.arrayBuffer();
  let text: string;
  try {
    text = await extractTextFromFile(buffer, file.name, file.type || '');
  } catch (e: any) {
    return NextResponse.json({ error: `Text extraction failed: ${e.message}` }, { status: 422 });
  }

  const preview = text.slice(0, 5000).trim();
  if (preview.length < 30) return NextResponse.json({ parties: [] });

  // ── Step 1: regex extraction (fast, no API call) ──────────────────────────
  const regexParties = extractPartiesRegex(text);

  // ── Step 2: Groq enhancement (adds any names the regex missed) ───────────
  let groqParties: string[] = [];
  try {
    const completion = await createChatCompletion({
      model: GROQ_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a legal document analyst. Identify the named parties in a contract.',
        },
        {
          role: 'user',
          content: `Look at the opening "Parties" section of this contract. \
List every distinct party identifier: defined role labels (like "Contractor", "Customer", "Landlord") \
AND full legal entity names (like "HopSkipDrive, Inc.").

Do NOT include: "Party", "Parties", "Organization", "you", "person", "user", or any other generic term. \
Only include names or labels that uniquely identify one of the two (or more) contracting parties.

Return ONLY a JSON array of strings — no markdown, no explanation.

Document opening:
---
${preview.slice(0, 3000)}
---`,
        },
      ],
      temperature: 0.1,
      max_tokens: 200,
    });

    const raw = completion.choices[0]?.message?.content || '[]';
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const arrStart = cleaned.indexOf('[');
    const arrEnd = cleaned.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd !== -1) {
      try {
        const parsed = JSON.parse(cleaned.slice(arrStart, arrEnd + 1));
        if (Array.isArray(parsed)) {
          groqParties = parsed
            .filter((p: any) => typeof p === 'string' && p.trim().length >= 3)
            .map((p: string) => p.trim())
            .filter(p => !isGeneric(p));
        }
      } catch { /* ignore */ }
    }
  } catch (e: any) {
    console.warn('[extract-parties] Groq unavailable:', e.message);
  }

  // ── Merge: regex results first, then Groq additions, deduplicate ──────────
  const merged: string[] = [...regexParties];
  for (const p of groqParties) {
    const already = merged.some(x => x.toLowerCase() === p.toLowerCase());
    if (!already) merged.push(p);
  }

  // Role labels (short, no spaces) before full legal names
  const parties = merged.sort((a, b) => {
    const aIsRole = !a.includes(' ') || a.split(' ').length <= 2;
    const bIsRole = !b.includes(' ') || b.split(' ').length <= 2;
    if (aIsRole && !bIsRole) return -1;
    if (!aIsRole && bIsRole) return 1;
    return 0;
  });

  return NextResponse.json({ parties });
}
