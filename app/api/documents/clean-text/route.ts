import { NextRequest, NextResponse } from 'next/server';
import { createChatCompletion, GROQ_MODEL } from '@/lib/groq';
import { requireSession } from '@/lib/auth/requireSession';

// ─── Rule-based local cleaner (no AI required) ────────────────────────────────
// Applied when Groq is unavailable or as a pre-pass before AI cleaning.
function cleanTextLocally(text: string): string {
  let t = text;

  // 1. Fix reversed PDF section headings: "PAYMENTS4." → "4. PAYMENTS"
  //    Matches 4+ letter ALL-CAPS word immediately followed by 1-2 digits and a period.
  t = t.replace(/\b([A-Z]{4,})(\d{1,2})\.\s*/g, '\n$2. $1\n');

  // 2. Promote inline Roman-numeral headings that lack a preceding newline.
  //    e.g. "...term. II. PAYMENTS..." → "...term.\nII. PAYMENTS..."
  t = t.replace(
    /([.:;!?])\s+((I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XIV|XV|XVI{0,3}|XIX|XX[IVX]*)\.\s+[A-Z][A-Za-z]{2,})/g,
    '$1\n$2',
  );

  // 3. Collapse multiple spaces between words to a single space (PDF extraction artifact).
  //    Only on lines that aren't pure whitespace; preserves leading indentation.
  t = t.split('\n').map(line => line.replace(/(\S) {2,}(\S)/g, '$1 $2')).join('\n');

  // 4. Remove stray lone page numbers (a line containing only digits, optionally spaced).
  t = t.replace(/^\s*\d{1,3}\s*$/gm, '');

  // 4. Remove "Page X of Y" / "- X -" header/footer lines.
  t = t.replace(/^\s*[Pp]age\s+\d+\s+of\s+\d+\s*$/gm, '');
  t = t.replace(/^\s*-\s*\d{1,3}\s*-\s*$/gm, '');
  t = t.replace(/^\s*\[\s*\d{1,3}\s*\]\s*$/gm, '');

  // 5. Collapse 3+ consecutive blank lines to 2.
  t = t.replace(/\n{3,}/g, '\n\n');

  return t.trim();
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { text } = await req.json();
  if (!text || text.length < 30) {
    return NextResponse.json({ error: 'text too short' }, { status: 400 });
  }

  // Always apply rule-based cleaning first (instant, no API required)
  const localCleaned = cleanTextLocally(text);

  // Process in chunks to avoid token limits
  const MAX_CHUNK = 7000;
  const chunks: string[] = [];
  for (let i = 0; i < localCleaned.length; i += MAX_CHUNK) {
    chunks.push(localCleaned.slice(i, i + MAX_CHUNK));
  }

  const SYSTEM_PROMPT = `You are a document text cleaner. Fix ONLY formatting noise — do not change any contract language:

1. Remove stray page numbers on their own line (e.g. "Page 5 of 20", "- 3 -", a lone "5").
2. Remove repeated document headers or footers.
3. Fix reversed PDF section headings: PDFs sometimes extract a section's title word BEFORE its number. If you see a pattern like "PAYMENTS4." or "OBLIGATIONS5." where an ALL-CAPS word is immediately followed by a digit and period, rewrite it as a normal numbered heading on its own line: "4. PAYMENTS" or "5. OBLIGATIONS". Only apply this when the all-caps word looks like a section title (not an acronym like "VAT" or "GDPR").
4. Fix other OCR artifacts (garbled characters, repeated symbols, obvious scan errors).
5. Collapse 3+ consecutive blank lines to 2.

Return only the cleaned text. No commentary.`;

  const results = await Promise.all(
    chunks.map(chunk =>
      createChatCompletion({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: chunk },
        ],
        temperature: 0.0,
        max_tokens: 4096,
      })
        .then(c => ({ text: c.choices[0]?.message?.content || chunk, failed: false }))
        .catch(() => ({ text: chunk, failed: true })),
    ),
  );

  const cleaned = results.map(r => r.text);
  const failedChunks = results.filter(r => r.failed).length;

  return NextResponse.json({
    text: cleaned.join('\n'),
    totalChunks: chunks.length,
    failedChunks,
    localOnly: failedChunks === chunks.length,
  });
}
