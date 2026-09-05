import type { LLMClauseUnit } from '@/lib/legalUnitTypes';

export interface ReviewFlag {
  reason: string;
  severity: 'error' | 'warning' | 'info';
}

// Patterns that suggest buried indemnity even without the word "indemnify"
const BURIED_INDEMNITY_PATTERNS = [
  /hold\s+harmless/i,
  /defend\s+against\s+(any\s+)?(claim|suit|action|liability)/i,
  /responsible\s+for\s+(all\s+)?(cost|damage|loss|liabilit)/i,
  /bear\s+(all\s+)?(risk|cost|loss)/i,
];

// Actor-missing: obligation/prohibition without an identifiable actor
function hasActorMissing(unit: LLMClauseUnit): boolean {
  const needsActor = unit.structural_labels.includes('obligation') ||
                     unit.structural_labels.includes('prohibition');
  return needsActor && !unit.actor;
}

// Mixed-function: has both obligation and condition labels — needs human review
function isMixedFunction(unit: LLMClauseUnit): boolean {
  return unit.structural_labels.includes('obligation') &&
         unit.structural_labels.includes('condition');
}

// Buried indemnity: text contains indemnity-like language but clause type doesn't indicate it
function hasBuriedIndemnity(unit: LLMClauseUnit, parentClauseType?: string): boolean {
  if (parentClauseType?.toLowerCase().includes('indemnif')) return false;
  return BURIED_INDEMNITY_PATTERNS.some(p => p.test(unit.unit_text));
}

// Definition missing definiens: defined_term set but action_text/object_text empty
function hasIncompletDefinition(unit: LLMClauseUnit): boolean {
  return unit.structural_labels.includes('definition') &&
         !!unit.defined_term &&
         !unit.action_text &&
         !unit.object_text;
}

// Conditional obligation with no trigger text
function hasMissingTrigger(unit: LLMClauseUnit): boolean {
  return unit.structural_labels.includes('condition') && !unit.trigger_text;
}

// Very short unit_text that may have been truncated
function isSuspiciouslyShort(unit: LLMClauseUnit): boolean {
  return unit.unit_text.trim().length < 20;
}

export function computeReviewFlags(
  unit: LLMClauseUnit,
  parentClauseType?: string,
): ReviewFlag[] {
  const flags: ReviewFlag[] = [];

  if (hasActorMissing(unit)) {
    flags.push({ reason: 'actor_missing', severity: 'warning' });
  }
  if (isMixedFunction(unit)) {
    flags.push({ reason: 'mixed_function', severity: 'info' });
  }
  if (hasBuriedIndemnity(unit, parentClauseType)) {
    flags.push({ reason: 'buried_indemnity', severity: 'warning' });
  }
  if (hasIncompletDefinition(unit)) {
    flags.push({ reason: 'incomplete_definition', severity: 'error' });
  }
  if (hasMissingTrigger(unit)) {
    flags.push({ reason: 'missing_trigger', severity: 'warning' });
  }
  if (isSuspiciouslyShort(unit)) {
    flags.push({ reason: 'short_unit', severity: 'info' });
  }

  return flags;
}

export function needsReview(flags: ReviewFlag[]): boolean {
  return flags.some(f => f.severity === 'error' || f.severity === 'warning');
}

export function reviewReason(flags: ReviewFlag[]): string | null {
  if (flags.length === 0) return null;
  return flags.map(f => f.reason).join('; ');
}
