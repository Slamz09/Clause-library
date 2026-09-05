import type { PlaybookRule } from './checker';

export interface RulesEngineResult {
  rules_score: number;          // 1–10 deterministic pre-score
  red_flag_hits: string[];      // keywords that matched red_flags list
  green_signal_hits: string[];  // keywords that matched green_signals list
  criteria_hits: string[];      // rubric criteria whose preferred_outcome keywords were found
  auto_status: 'compliant' | 'non_compliant' | null; // set only when certain without AI
}

function containsAny(text: string, terms: string[]): string[] {
  const lower = text.toLowerCase();
  return terms.filter(t => lower.includes(t.toLowerCase()));
}

/**
 * Phase 1 deterministic rules check.
 * Scans clause text for red_flags, green_signals, and rubric criteria keywords.
 * Returns a pre-score and hit lists for the AI phase to reference.
 *
 * Score logic:
 *   - Start at 5 (neutral)
 *   - Each red_flag hit: -2 (floor 1)
 *   - Each green_signal hit: +1 (ceiling 9 before AI bonus)
 *   - Each rubric criterion whose preferred_outcome keywords are present: +0.5 per criterion
 *
 * auto_status:
 *   - 'non_compliant' when any red_flag matched
 *   - 'compliant' when ≥1 green_signal matched AND no red_flags AND rubric coverage ≥80%
 *   - null otherwise (send to AI)
 */
export function runRulesEngine(clauseText: string, rule: PlaybookRule): RulesEngineResult {
  const redFlags = rule.red_flags ?? [];
  const greenSignals = rule.green_signals ?? [];
  const rubric = rule.score_rubric ?? [];

  const red_flag_hits = containsAny(clauseText, redFlags);
  const green_signal_hits = containsAny(clauseText, greenSignals);

  // Rubric: check if preferred_outcome keywords appear in clause text
  const criteria_hits: string[] = [];
  for (const item of rubric) {
    // Split preferred_outcome into significant keywords (>3 chars, not stop words)
    const outcomeTokens = item.preferred_outcome
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w));
    if (outcomeTokens.length === 0) continue;
    const lower = clauseText.toLowerCase();
    const matchCount = outcomeTokens.filter(t => lower.includes(t)).length;
    // Criterion "hit" if ≥50% of outcome tokens found
    if (matchCount / outcomeTokens.length >= 0.5) {
      criteria_hits.push(item.criterion);
    }
  }

  // Compute rules_score
  let score = 5;
  score -= red_flag_hits.length * 2;
  score += green_signal_hits.length;
  score += criteria_hits.length * 0.5;
  score = Math.min(9, Math.max(1, Math.round(score)));

  // auto_status
  let auto_status: RulesEngineResult['auto_status'] = null;
  if (red_flag_hits.length > 0) {
    auto_status = 'non_compliant';
    score = Math.min(score, 3); // cap score when red flag hits
  } else if (
    green_signal_hits.length > 0 &&
    (rubric.length === 0 || criteria_hits.length / rubric.length >= 0.8)
  ) {
    auto_status = 'compliant';
    score = Math.max(score, 7); // floor score when clearly compliant
  }

  return { rules_score: score, red_flag_hits, green_signal_hits, criteria_hits, auto_status };
}

const STOP_WORDS = new Set([
  'the','a','an','of','in','to','and','or','for','with','that','this','shall',
  'will','may','any','all','such','as','at','by','be','is','are','from','on',
  'its','their','each','which','when','if','not','have','has','been','was',
  'were','both','other','also','under','over','into','during','before','after',
  'within','without','including','provided','pursuant','hereby','herein',
  'hereof','thereunder','party','parties','agreement','contract','either',
  'written','writing','date','term','terms','right','rights','obligation',
  'obligations','section','article','clause',
]);
