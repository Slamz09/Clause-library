import { NextRequest, NextResponse } from 'next/server';
import { createChatCompletion, GROQ_MODEL } from '@/lib/groq';
import { requireSession } from '@/lib/auth/requireSession';

const SCHEMA_OPTIONS = [
  { id: 'auto',              label: 'Auto-detect' },
  { id: 'numeric',           label: '1. 2. 3.' },
  { id: 'numeric-bare',      label: '1 2 3 (no period)' },
  { id: 'numeric-paren',     label: '1) 2) 3)' },
  { id: 'paren-numeric',     label: '(1) (2) (3)' },
  { id: 'decimal',           label: '1.1, 1.2, 2.1' },
  { id: 'decimal-zero',      label: '1.0, 2.0, 3.0' },
  { id: 'decimal-triple',    label: '1.1.1, 1.2.1' },
  { id: 'alpha-upper',       label: 'A. B. C.' },
  { id: 'alpha-lower',       label: 'a. b. c.' },
  { id: 'alpha-lower-paren', label: 'a) b) c)' },
  { id: 'paren-alpha',       label: '(a) (b) (c)' },
  { id: 'roman-upper',       label: 'I. II. III.' },
  { id: 'roman-lower',       label: 'i. ii. iii.' },
  { id: 'roman-upper-paren', label: 'I) II) III)' },
  { id: 'roman-lower-paren', label: 'i) ii) iii)' },
  { id: 'paren-roman-upper', label: '(I) (II) (III)' },
  { id: 'paren-roman-lower', label: '(i) (ii) (iii)' },
  { id: 'section',           label: 'Section 1., Section 2.' },
  { id: 'section-decimal',   label: 'Section 1. with 1.1 subs' },
  { id: 'article',           label: 'Article I., Article II.' },
];

// Simple rule-based schema detection — no external imports, safe for API route context.
function detectSchemaLocally(text: string): string {
  const patterns: { regex: RegExp; type: string }[] = [
    { regex: /\n\s*(I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XIV|XV|XVI{0,3}|XIX|XX[IVX]*)\.\s+[A-Z][A-Z\s]/g, type: 'roman-upper' },
    { regex: /\n\s*Section\s+(\d+)\./gi, type: 'section' },
    { regex: /\n\s*Article\s+(\d+)/gi, type: 'article' },
    { regex: /\n\s*ARTICLE\s+([IVX]+)/g, type: 'article' },
    { regex: /\n\s*(\d+\.\d+)\.\s+/g, type: 'decimal' },
    { regex: /\n\s*(\d+)\.\s+[A-Z][A-Z\s]{3,}/g, type: 'numeric' },
    { regex: /\n\s*\d+\.(?!\d)\s+[A-Z][a-z]/g, type: 'numeric' },
  ];
  let best = 'auto';
  let max = 0;
  for (const p of patterns) {
    const count = (text.match(p.regex) || []).length;
    if (count > max) { max = count; best = p.type; }
  }
  return best;
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  let text = '';
  try {
    const body = await req.json();
    text = body?.text || '';
  } catch {
    return NextResponse.json({ schemas: ['auto'], reason: 'invalid request body' });
  }

  if (!text || text.length < 30) {
    return NextResponse.json({ schemas: ['auto'], reason: 'insufficient text' });
  }

  const preview = text.substring(0, 3000);
  const schemaList = SCHEMA_OPTIONS.map(s => `"${s.id}" (${s.label})`).join(', ');

  try {
    const completion = await createChatCompletion({
      model: GROQ_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a legal document structure analyst. Detect the clause numbering scheme used in the document.',
        },
        {
          role: 'user',
          content: `Look at the start of this document and identify the primary clause numbering scheme(s) used.

Available schemas: ${schemaList}

Document text (first portion):
---
${preview}
---

Return ONLY valid JSON: {"schemas": ["schema_id", ...], "reason": "brief explanation"}
- List 1-2 schemas that best match what you see
- If the document uses roman numerals for main sections (like "I. Parties"), include "roman-upper" or "article"
- If it uses decimal notation like "1.1", include "decimal"
- Always include at most 2 schemas, ordered by primary then secondary
- If unclear, return ["auto"]`,
        },
      ],
      temperature: 0.1,
      max_tokens: 150,
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    const cleaned = raw.replace(/```json|```/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      const validSchemas = (parsed.schemas || []).filter((s: string) =>
        SCHEMA_OPTIONS.some(o => o.id === s)
      );
      return NextResponse.json({
        schemas: validSchemas.length > 0 ? validSchemas : ['auto'],
        reason: parsed.reason || '',
      });
    } catch {
      return NextResponse.json({ schemas: ['auto'], reason: 'parse error' });
    }
  } catch {
    // Groq unavailable — fall back to rule-based detection, always return 200
    const schema = detectSchemaLocally(text);
    return NextResponse.json({ schemas: [schema], reason: 'rule-based fallback (Groq unavailable)' });
  }
}
