import { createChatCompletion, GROQ_MODEL } from '@/lib/groq';
import type { LLMClauseUnit, StructuralLabel, TopicLabel } from '@/lib/legalUnitTypes';
import { STRUCTURAL_LABELS, TOPIC_LABELS } from '@/lib/legalUnitTypes';

const SEGMENT_SYSTEM_PROMPT = `You are a legal clause segmenter. Break the given clause text into atomic legal units — each unit should express exactly one legal idea (one obligation, one prohibition, one condition, one definition, etc.).

Return ONLY valid JSON: { "units": [...] }

Each unit object:
{
  "unit_index": integer (0-based),
  "unit_text": string (the verbatim or lightly cleaned sentence/phrase),
  "structural_labels": array of zero or more from: ${STRUCTURAL_LABELS.join(', ')},
  "topic_labels": array of zero or more from: ${TOPIC_LABELS.join(', ')},
  "actor": string or null (who must act),
  "beneficiary": string or null (who benefits),
  "defined_term": string or null (for definitions),
  "definition_type": "formal" | "inline" | null,
  "trigger_text": string or null (condition that activates this unit),
  "action_text": string or null (what must be done),
  "object_text": string or null (on what / to what),
  "qualifier_text": string or null (how, to what standard),
  "exception_text": string or null (carve-outs),
  "deadline_text": string or null,
  "frequency_text": string or null,
  "extraction_confidence": number 0.0-1.0
}

Rules:
- List items that share a grammatical stem from the parent sentence MUST inherit the stem as trigger_text.
- If a unit has no clear actor, leave actor as null — flag this for review.
- Definitions: set defined_term to the term being defined, structural_labels must include "definition".
- Prohibitions: structural_labels must include "prohibition"; actor is who is prohibited.
- Conditions: structural_labels must include "condition"; trigger_text captures the condition clause.
- Mixed-function sentences (obligation + condition) may have both "obligation" and "condition" labels.`;

export async function segmentAtomicUnits(
  clauseId: string,
  clauseText: string,
  clauseType?: string,
): Promise<LLMClauseUnit[]> {
  const context = clauseType ? `Clause type: ${clauseType}\n\n` : '';
  try {
    const completion = await createChatCompletion({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: SEGMENT_SYSTEM_PROMPT },
        { role: 'user', content: `${context}Clause:\n${clauseText}` },
      ],
      temperature: 0.1,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const units: LLMClauseUnit[] = (parsed.units || []).map((u: any, i: number) => ({
      unit_index: typeof u.unit_index === 'number' ? u.unit_index : i,
      unit_text: String(u.unit_text || '').trim(),
      structural_labels: filterLabels(u.structural_labels, STRUCTURAL_LABELS) as StructuralLabel[],
      topic_labels: filterLabels(u.topic_labels, TOPIC_LABELS) as TopicLabel[],
      actor: u.actor || null,
      beneficiary: u.beneficiary || null,
      defined_term: u.defined_term || null,
      definition_type: u.definition_type || null,
      trigger_text: u.trigger_text || null,
      action_text: u.action_text || null,
      object_text: u.object_text || null,
      qualifier_text: u.qualifier_text || null,
      exception_text: u.exception_text || null,
      deadline_text: u.deadline_text || null,
      frequency_text: u.frequency_text || null,
      extraction_confidence: typeof u.extraction_confidence === 'number' ? u.extraction_confidence : null,
    }));

    return applyListStemInheritance(units);
  } catch {
    return [];
  }
}

function filterLabels<T extends string>(raw: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is T => allowed.includes(v as T));
}

// If consecutive units look like list items (start with bullet, letter, number, or semicolon)
// and share no explicit trigger_text, inherit the preceding non-list-item's action_text as stem.
function applyListStemInheritance(units: LLMClauseUnit[]): LLMClauseUnit[] {
  const listItemPattern = /^[\s]*(?:[•\-–—*]|\([a-z0-9]\)|\d+[.)]\s|[a-z][.)]\s)/i;
  let lastStemText: string | null = null;

  return units.map((unit, idx) => {
    const isListItem = listItemPattern.test(unit.unit_text);

    if (!isListItem) {
      // This unit is a potential stem for following list items
      lastStemText = unit.action_text || unit.unit_text;
      return unit;
    }

    // It's a list item — inherit stem if no trigger_text already
    if (isListItem && !unit.trigger_text && lastStemText && idx > 0) {
      return { ...unit, trigger_text: lastStemText };
    }

    return unit;
  });
}

// Detect inline definitions: "X means Y" / "X shall mean Y" / "'X' is defined as Y"
export function detectInlineDefinition(text: string): { term: string; definition: string } | null {
  const patterns = [
    /^[""']([^""']+)[""']\s+(?:means|shall mean|is defined as|refers to)\s+(.+)$/i,
    /^"([^"]+)"\s+(?:means|shall mean|is defined as|refers to)\s+(.+)$/i,
    /^([A-Z][A-Za-z\s]{1,40})\s+(?:means|shall mean|is defined as|refers to)\s+(.+)$/,
  ];
  for (const p of patterns) {
    const m = text.trim().match(p);
    if (m) return { term: m[1].trim(), definition: m[2].trim() };
  }
  return null;
}

// Detect list stems: sentences ending in ":" or "including:" that are followed by list items
export function detectListStem(text: string): boolean {
  return /:\s*$/.test(text.trim());
}
