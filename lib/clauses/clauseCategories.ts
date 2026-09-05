// ─── Clause form taxonomy ────────────────────────────────────────────────────
// Category, Modifiers, Requirement Effect and Derivation are FOUR distinct
// axes. They are also distinct from Clause Type (lib/clauseTypes.ts's
// CANONICAL_CLAUSE_TYPES — the subject-matter taxonomy).
//
//   Category           — what the source language IS as drafted.
//   Modifiers          — condition / qualification / exception language
//                        attached to the principal clause. Not a Category.
//   Requirement Effect — the operational effect the language produces
//                        (lives on the derived atomic obligation, not the
//                        clause). A Statement can still produce a Prohibition.
//   Derivation         — whether that obligation is stated explicitly or is
//                        the operational consequence of Statement /
//                        Rep-Warranty / Acknowledgment language.
//
// Persisted as: clauses.category TEXT[], clauses.modifiers TEXT[],
// canonical_obligations.requirement_effect, canonical_obligations.derivation.

export const CLAUSE_CATEGORY_VALUES = [
  'obligation',
  'rep_warranty',
  'acknowledgment',
  'statement',
  'definition',
  'right',
] as const;
export type ClauseCategory = (typeof CLAUSE_CATEGORY_VALUES)[number];

export const CLAUSE_MODIFIER_VALUES = [
  'condition',
  'qualification',
  'exception',
] as const;
export type ClauseModifier = (typeof CLAUSE_MODIFIER_VALUES)[number];

export const REQUIREMENT_EFFECT_VALUES = [
  'duty',
  'prohibition',
  'permission',
  'right',
  'none',
] as const;
export type RequirementEffect = (typeof REQUIREMENT_EFFECT_VALUES)[number];

export const DERIVATION_VALUES = ['explicit', 'derived'] as const;
export type Derivation = (typeof DERIVATION_VALUES)[number];

export const CLAUSE_CATEGORY_LABELS: Record<ClauseCategory, string> = {
  obligation: 'Obligation',
  rep_warranty: 'Rep/Warranty',
  acknowledgment: 'Acknowledgment',
  statement: 'Statement',
  definition: 'Definition',
  right: 'Right',
};

export const CLAUSE_CATEGORY_DESCRIPTIONS: Record<ClauseCategory, string> = {
  obligation: 'What a party must or must not do.',
  rep_warranty: 'A present-tense assertion of fact a party stands behind.',
  acknowledgment: 'A party states it is aware of / accepts a fact. Not an obligation.',
  statement: 'A declarative provision that is none of the other forms (opt-outs, intent, recitals).',
  definition: 'Defines a term used elsewhere in the agreement.',
  right: 'What actions can the parties take to protect their interest in the bargain? Rights to terminate, adjust services or costs, etc.',
};

export const CLAUSE_MODIFIER_LABELS: Record<ClauseModifier, string> = {
  condition: 'Condition',
  qualification: 'Qualification',
  exception: 'Exception',
};

export const REQUIREMENT_EFFECT_LABELS: Record<RequirementEffect, string> = {
  duty: 'Duty',
  prohibition: 'Prohibition',
  permission: 'Permission',
  right: 'Right',
  none: 'None',
};

export const DERIVATION_LABELS: Record<Derivation, string> = {
  explicit: 'Explicit',
  derived: 'Derived',
};

// Badge colors — kept close to the palette already used across the Clause
// Library (purple accent family, amber for attention, slate for neutral).
export const CLAUSE_CATEGORY_COLORS: Record<ClauseCategory, string> = {
  obligation: '#a78bfa',
  rep_warranty: '#38bdf8',
  acknowledgment: '#34d399',
  statement: '#f59e0b',
  definition: '#94a3b8',
  right: '#f472b6',
};

export const CLAUSE_MODIFIER_COLORS: Record<ClauseModifier, string> = {
  condition: '#60a5fa',
  qualification: '#c084fc',
  exception: '#fb7185',
};

export function isClauseCategory(v: unknown): v is ClauseCategory {
  return typeof v === 'string' && (CLAUSE_CATEGORY_VALUES as readonly string[]).includes(v);
}
export function isClauseModifier(v: unknown): v is ClauseModifier {
  return typeof v === 'string' && (CLAUSE_MODIFIER_VALUES as readonly string[]).includes(v);
}
export function isRequirementEffect(v: unknown): v is RequirementEffect {
  return typeof v === 'string' && (REQUIREMENT_EFFECT_VALUES as readonly string[]).includes(v);
}
export function isDerivation(v: unknown): v is Derivation {
  return typeof v === 'string' && (DERIVATION_VALUES as readonly string[]).includes(v);
}

export function normalizeCategoryList(raw: unknown): ClauseCategory[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isClauseCategory))];
}
export function normalizeModifierList(raw: unknown): ClauseModifier[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isClauseModifier))];
}

// ─── "Creates Requirement" indicator ─────────────────────────────────────────
// A clause opens the structured-obligation panel when EITHER its Category
// includes 'obligation' OR it has one or more linked atomic obligations
// (including derived ones from a Statement / Rep-Warranty / Acknowledgment).
export function clauseHasStructuredObligations(clause: {
  category?: string[] | null;
  linked_obligation_count?: number | null;
}): boolean {
  const cat = clause.category || [];
  return cat.includes('obligation') || (clause.linked_obligation_count ?? 0) > 0;
}

// The row-level indicator shown for a NON-obligation clause that nonetheless
// produces a derived requirement — e.g. "Derived Prohibition", "Derived Duty",
// or the generic "Creates Requirement" when the effect isn't yet classified.
// Returns null when the clause's Category already includes 'obligation'
// (the plain Obligation badge covers it) or when nothing is derived.
export function derivedRequirementIndicator(clause: {
  category?: string[] | null;
  derived_effects?: (string | null)[] | null;
}): string | null {
  const cat = clause.category || [];
  if (cat.includes('obligation')) return null;
  const effects = (clause.derived_effects || []).filter(Boolean) as string[];
  if (effects.length === 0) return null;
  const distinct = [...new Set(effects)];
  if (distinct.length === 1 && isRequirementEffect(distinct[0]) && distinct[0] !== 'none') {
    return `Derived ${REQUIREMENT_EFFECT_LABELS[distinct[0]]}`;
  }
  return 'Creates Requirement';
}
