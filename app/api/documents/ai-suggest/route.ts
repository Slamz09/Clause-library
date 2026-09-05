import { NextRequest, NextResponse } from 'next/server';
import { createChatCompletion, GROQ_MODEL } from '@/lib/groq';
import { sanitizeForPrompt, wrapUserContent, SYSTEM_PROMPT_SAFETY_PREFIX } from '@/lib/security/sanitizePrompt';
import { requireSession } from '@/lib/auth/requireSession';

// Hard cap on request payload to prevent LLM token exhaustion attacks
const MAX_TEXT_LENGTH = 30_000;

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const body = await req.json();
  const { text, document_types, entities } = body as {
    text?: string;
    document_types?: string[];
    entities?: Array<{ entity_id: string; name: string }>;
  };

  if (!text || typeof text !== 'string' || text.length < 50) {
    return NextResponse.json({ error: 'text too short' }, { status: 400 });
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: 'text exceeds maximum allowed length' }, { status: 400 });
  }

  // Sanitize entity names (user-supplied) before embedding in prompt
  const entityList = (entities || [])
    .slice(0, 200) // cap entity list size
    .map((e) => `${sanitizeForPrompt(String(e.entity_id), 50)}: ${sanitizeForPrompt(String(e.name), 100)}`)
    .join('\n');
  const docTypes = (document_types || []).slice(0, 20).join(', ');

  // Sanitize the document text and wrap it in a safe delimiter
  const safePreview = wrapUserContent(sanitizeForPrompt(text, 6000));

  try {
    const completion = await createChatCompletion({
      model: GROQ_MODEL,
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT_SAFETY_PREFIX + 'You are a legal document analyst. Extract key metadata from document text. Return only valid JSON.',
        },
        {
          role: 'user',
          content: `Analyze this ${docTypes || 'legal'} document and return a JSON object with exactly these fields:
- "title": A clear, descriptive document title (e.g. "Commercial Lease Agreement - 123 Main St 2024" or "D&O Insurance Policy - Acme Holdings")
- "entity_id": The entity_id from the list below that is the primary internal/insured/borrowing party (null if no match)
- "counterparty": The name of the other party (insurer, lender, landlord, management company, counterparty — NOT from our entity list)

Available internal entities:
${entityList || '(none)'}

Document text:
${safePreview}

Return ONLY valid JSON: {"title": "...", "entity_id": "..." or null, "counterparty": "..."}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 200,
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    const cleaned = raw.replace(/```json|```/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      return NextResponse.json({
        title: parsed.title || '',
        entity_id: parsed.entity_id || null,
        counterparty: parsed.counterparty || '',
      });
    } catch {
      return NextResponse.json({ title: '', entity_id: null, counterparty: '' });
    }
  } catch (e: any) {
    console.error('[ai-suggest]', e?.message);
    return NextResponse.json({ error: 'Suggestion failed' }, { status: 500 });
  }
}
