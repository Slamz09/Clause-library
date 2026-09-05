// ─── Clause form classification (Category + Modifiers + derived obligations) ──
// A focused, batched pass that runs on EVERY document's clauses, separate from
// the clause-TYPE classifier in app/api/documents/classify-clauses/route.ts.
// It answers three questions per clause, based on meaning and structure — not
// isolated keywords:
//
//   category  — what the source language IS as drafted (one or more of
//               obligation / rep_warranty / acknowledgment / statement /
//               definition). Multi-value only when the clause genuinely
//               contains multiple legal forms.
//   modifiers — condition / qualification / exception language present
//               (any combination, before / within / after the principal
//               language). NOT primary categories.
//   derived_obligations — for a clause whose Category is NOT 'obligation' but
//               whose language nonetheless produces a concrete operational
//               requirement ("Client opts out of recordings" -> Provider must
//               not record). The clause stays its own Category; each derived
//               obligation is a separate atomic requirement with an effect.
//
// The LLM call is best-effort; classifyClauseFormsDeterministic is the
// offline / rate-limited fallback and also seeds the prompt-free path.

import { createChatCompletion, GROQ_MODEL } from '@/lib/groq';
import { sanitizeForPrompt, SYSTEM_PROMPT_SAFETY_PREFIX } from '@/lib/security/sanitizePrompt';
import {
  CLAUSE_CATEGORY_VALUES,
  CLAUSE_MODIFIER_VALUES,
  REQUIREMENT_EFFECT_VALUES,
  normalizeCategoryList,
  normalizeModifierList,
  isRequirementEffect,
  type ClauseCategory,
  type ClauseModifier,
  type RequirementEffect,
} from './clauseCategories';

export interface DerivedObligationDraft {
  effect: RequirementEffect;        // never 'none' for a derived obligation that is actually created
  action_text: string;             // the concrete atomic requirement, e.g. "must not record services involving this Client"
  actor: string | null;            // duty bearer / responsible party
  beneficiary: string | null;      // who benefits, if applicable
  condition_text: string | null;
  source_excerpt: string | null;   // short verbatim quote pinpointing the language that produced it
  confidence: number;
}

export interface ClauseFormClassification {
  category: ClauseCategory[];
  modifiers: ClauseModifier[];
  derived_obligations: DerivedObligationDraft[];
  confidence: number;
}

export interface ClauseFormInput {
  clause_id: string;
  clause_text: string;
  clause_type?: string | null; // the already-classified subject-matter type, passed as a hint only
}

// ─── Deterministic classifier ───────────────────────────────────────────────
const DEFINITION_RE = /\b(?:means|shall mean|is defined as|refers to|has the meaning)\b/i;
const DEFINITION_LEAD_RE = /^\s*["“'‘(]?[A-Z][A-Za-z0-9 .,'"“”\-]{1,60}["”'’)]?\s+(?:means|shall mean|is defined as|refers to)\b/;
const REP_WARRANTY_RE = /\b(?:represents?(?:\s+and\s+warrants?)?|warrants?\s+(?:that|to)|makes?\s+the\s+following\s+representations?)\b/i;
const ACK_RE = /\b(?:acknowledges?|acknowledge\s+and\s+agrees?|recognizes?\s+that|understands?\s+and\s+agrees?)\b/i;
const OBLIGATION_RE = /\b(?:shall|must|will\b(?!\s+not\s+be\s+liable)|agrees?\s+to|is\s+required\s+to|are\s+required\s+to|undertakes?\s+to|is\s+obligated\s+to|covenants?\s+to)\b/i;
const PROHIBITION_RE = /\b(?:shall\s+not|must\s+not|may\s+not|will\s+not|is\s+prohibited\s+from|are\s+prohibited\s+from|agrees?\s+not\s+to|shall\s+refrain\s+from)\b/i;
const PERMISSION_RE = /\b(?:may\b|is\s+permitted\s+to|are\s+permitted\s+to|is\s+entitled\s+to|has\s+the\s+right\s+to|reserves?\s+the\s+right\s+to)\b/i;

const CONDITION_RE = /\b(?:if\b|in\s+the\s+event\s+(?:that|of)|provided\s+that|on\s+the\s+condition\s+that|subject\s+to\s+the\s+condition|so\s+long\s+as|contingent\s+(?:up)?on|conditioned\s+(?:up)?on|upon\s+the\s+occurrence)\b/i;
const QUALIFICATION_RE = /\b(?:subject\s+to\b|to\s+the\s+extent\s+(?:that|permitted)|notwithstanding\b|solely\s+for\s+the\s+purpose|only\s+if|limited\s+to\b|in\s+accordance\s+with\b|reasonable\b|commercially\s+reasonable|materiality)\b/i;
const EXCEPTION_RE = /\b(?:except\b|excluding\b|other\s+than\b|save\s+(?:as|for)|unless\b|but\s+not\b|with\s+the\s+exception\s+of|does\s+not\s+(?:apply|include))\b/i;

// "X opts out of Y" / "X waives" / "X consents to" style Statements that
// produce an operational requirement without using "shall".
const OPT_OUT_RE = /\bopt(?:s|ed|ing)?[\s-]?out\s+of\b/i;
const OPT_IN_RE = /\bopt(?:s|ed|ing)?[\s-]?in\s+to\b|\bconsents?\s+to\b/i;
const WAIVES_RE = /\bwaives?\b|\brelinquishes?\b|\bforgoes?\b/i;

// A party's optional power to protect its interest in the bargain — a right to
// terminate, suspend/adjust services, adjust costs/pricing, audit, set off, etc.
const RIGHT_RE = /\b(?:has\s+the\s+right\s+to|shall\s+have\s+the\s+right\s+to|reserves?\s+the\s+right\s+to|is\s+entitled\s+to|at\s+its\s+(?:sole\s+)?discretion\s+may|may\s+(?:elect\s+to\s+)?(?:terminate|suspend|cancel|adjust|modify|increase|reduce|audit|set\s*off|offset|withhold))\b/i;

export function classifyClauseFormsDeterministic(text: string): ClauseFormClassification {
  const t = (text || '').trim();
  const category = new Set<ClauseCategory>();
  const modifiers = new Set<ClauseModifier>();
  const derived: DerivedObligationDraft[] = [];

  if (DEFINITION_LEAD_RE.test(t) || (DEFINITION_RE.test(t) && t.length < 400)) category.add('definition');
  if (REP_WARRANTY_RE.test(t)) category.add('rep_warranty');
  if (ACK_RE.test(t)) category.add('acknowledgment');
  if (PROHIBITION_RE.test(t) || OBLIGATION_RE.test(t)) category.add('obligation');
  if (RIGHT_RE.test(t)) category.add('right');

  // Statement is the residual: declarative language that isn't a definition,
  // rep/warranty, acknowledgment, a direct shall/must obligation, or a right.
  if (category.size === 0) category.add('statement');

  if (CONDITION_RE.test(t)) modifiers.add('condition');
  if (EXCEPTION_RE.test(t)) modifiers.add('exception');
  if (QUALIFICATION_RE.test(t)) modifiers.add('qualification');

  // Derived obligation from a non-obligation Statement:
  if (!category.has('obligation')) {
    if (OPT_OUT_RE.test(t)) {
      derived.push({
        effect: 'prohibition',
        action_text: 'must not perform the opted-out activity with respect to the party that opted out',
        actor: null,
        beneficiary: null,
        condition_text: null,
        source_excerpt: firstMatch(t, OPT_OUT_RE),
        confidence: 0.55,
      });
    } else if (OPT_IN_RE.test(t)) {
      derived.push({
        effect: 'permission',
        action_text: 'is permitted to perform the consented-to activity with respect to the consenting party',
        actor: null,
        beneficiary: null,
        condition_text: null,
        source_excerpt: firstMatch(t, OPT_IN_RE),
        confidence: 0.5,
      });
    } else if (WAIVES_RE.test(t) && (category.has('statement') || category.has('acknowledgment'))) {
      derived.push({
        effect: 'none',
        action_text: 'relinquishes a right it would otherwise hold',
        actor: null,
        beneficiary: null,
        condition_text: null,
        source_excerpt: firstMatch(t, WAIVES_RE),
        confidence: 0.4,
      });
    }
  }

  return {
    category: [...category],
    modifiers: [...modifiers],
    derived_obligations: derived.filter(d => d.effect !== 'none'),
    confidence: 0.5,
  };
}

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  if (!m) return null;
  const idx = m.index ?? 0;
  return text.slice(Math.max(0, idx - 40), Math.min(text.length, idx + 80)).trim() || null;
}

// ─── LLM classifier ─────────────────────────────────────────────────────────
const BATCH_SIZE = 18;

function buildSystemPrompt(): string {
  return SYSTEM_PROMPT_SAFETY_PREFIX + `You classify the LEGAL FORM of contract / regulation clauses. For each clause decide, from meaning and structure (never isolated keywords):

CATEGORY (one or more) — what the source language IS as drafted:
- "obligation": imposes a duty or prohibition on a party ("Party shall pay all invoices", "Provider shall not record"). "agrees to pay" IS an obligation even though it says "agrees".
- "rep_warranty": a present-tense assertion of fact a party stands behind ("Party represents and warrants that it holds all licenses").
- "acknowledgment": a party states it is aware of / accepts a fact ("Party acknowledges that payment has been received"). NOT an obligation.
- "statement": a declarative provision that is none of the above ("Client opts out of recordings", "The parties intend...", findings, recitals).
- "definition": defines a term ("'Confidential Information' means...").
- "right": grants a party an action it MAY take to protect its interest in the bargain — a right to terminate, to suspend or adjust services, to adjust costs/pricing, to audit, to set off, a right of first refusal, etc. Use "right" (not "obligation") when the clause confers an optional power, not a duty. A clause may be both a "right" for one party and an "obligation" for the other.
Assign MORE THAN ONE only when the clause genuinely contains multiple legal forms or multiple atomic units (e.g. a representation AND a separate duty). Do NOT add a category for an indirect consequence.

MODIFIERS (zero or more) — attached condition / qualification / exception language, wherever it appears (before, within, after):
- "condition": a trigger/precondition that must be met for the clause to operate ("if", "in the event that", "provided that", "upon").
- "qualification": narrows how/when/to what standard ("subject to", "to the extent permitted", "commercially reasonable", "notwithstanding").
- "exception": a carve-out ("except", "other than", "unless", "excluding").
Condition / qualification / exception are NEVER primary categories.

DERIVED_OBLIGATIONS — ONLY for a clause whose CATEGORY is NOT "obligation" but whose language still produces a concrete operational requirement. Example: Statement "Client opts out of recordings" -> a derived {effect: "prohibition", action_text: "Provider must not record services involving this Client"}. Do NOT convert every Statement / Rep-Warranty / Acknowledgment into an obligation — create a derived entry ONLY when the language produces a concrete duty, prohibition, permission, or right. Return [] otherwise, and ALWAYS return [] when "obligation" is in the category array.
Each derived entry: { "effect": "duty"|"prohibition"|"permission"|"right", "action_text": "<the concrete atomic requirement>", "actor": "<duty bearer / responsible party or null>", "beneficiary": "<who benefits or null>", "condition_text": "<trigger/precondition or null>", "source_excerpt": "<short verbatim quote, under 160 chars>", "confidence": 0.0-1.0 }

Return ONLY valid JSON: {"results": [{"index": <int>, "category": [...], "modifiers": [...], "derived_obligations": [...], "confidence": 0.0-1.0}]}. No markdown.`;
}

export async function classifyClauseForms(
  clauses: ClauseFormInput[],
): Promise<Map<string, ClauseFormClassification>> {
  const out = new Map<string, ClauseFormClassification>();
  // Seed every clause with the deterministic result so a failed / partial LLM
  // batch still leaves every clause classified.
  for (const c of clauses) out.set(c.clause_id, classifyClauseFormsDeterministic(c.clause_text || ''));

  for (let i = 0; i < clauses.length; i += BATCH_SIZE) {
    const chunk = clauses.slice(i, i + BATCH_SIZE);
    const payload = chunk.map((c, j) => ({
      index: j,
      clause_type: c.clause_type || null,
      text: sanitizeForPrompt((c.clause_text || '').slice(0, 900), 900),
    }));
    let parsed: any = {};
    try {
      const completion = await createChatCompletion({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: `Classify these clauses:\n\n${JSON.stringify(payload, null, 2)}` },
        ],
        temperature: 0.1,
        max_tokens: 3500,
        response_format: { type: 'json_object' },
      });
      parsed = JSON.parse((completion.choices[0]?.message?.content || '{}').replace(/```json|```/g, '').trim());
    } catch (err: any) {
      console.warn(`[classifyClauseForms] batch ${i}-${i + chunk.length} failed (${err?.message}) — keeping deterministic results`);
      continue;
    }
    const results: any[] = Array.isArray(parsed.results) ? parsed.results : [];
    for (const r of results) {
      const local = typeof r.index === 'number' ? chunk[r.index] : undefined;
      if (!local) continue;
      const category = normalizeCategoryList(r.category);
      const modifiers = normalizeModifierList(r.modifiers);
      const derived = sanitizeDerived(r.derived_obligations, category);
      out.set(local.clause_id, {
        category: category.length ? category : ['statement'],
        modifiers,
        derived_obligations: derived,
        confidence: clampConfidence(r.confidence),
      });
    }
  }
  return out;
}

function clampConfidence(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.6;
}

function sanitizeDerived(raw: unknown, category: ClauseCategory[]): DerivedObligationDraft[] {
  if (category.includes('obligation')) return []; // never derive when the clause IS an obligation
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d: any): DerivedObligationDraft | null => {
      const effect = isRequirementEffect(d?.effect) ? d.effect : null;
      const action = typeof d?.action_text === 'string' ? d.action_text.trim() : '';
      if (!effect || effect === 'none' || !action) return null;
      return {
        effect,
        action_text: action.slice(0, 400),
        actor: nz(d?.actor),
        beneficiary: nz(d?.beneficiary),
        condition_text: nz(d?.condition_text),
        source_excerpt: nz(d?.source_excerpt)?.slice(0, 200) ?? null,
        confidence: clampConfidence(d?.confidence),
      };
    })
    .filter((d): d is DerivedObligationDraft => d !== null);
}

function nz(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// Re-exported so the API route and tests share one source of the vocab.
export { CLAUSE_CATEGORY_VALUES, CLAUSE_MODIFIER_VALUES, REQUIREMENT_EFFECT_VALUES };
