import type { RiskBand } from '../types';

export const SCORE_VERSION = 'risk-v1';

/** Clamp score to [0, 10] and round to 2 decimal places. */
export function clampRiskScore(value: number): number {
  return Math.round(Math.max(0, Math.min(10, value)) * 100) / 100;
}

/** Map a clamped score to a RiskBand. */
export function scoreToBand(score: number): RiskBand {
  if (score >= 8.0) return 'critical';
  if (score >= 6.0) return 'high';
  if (score >= 3.0) return 'moderate';
  return 'low';
}

/** Current UTC time as ISO string. */
export function nowIso(): string {
  return new Date().toISOString();
}

export function makeRiskAssessmentId(): string {
  return `ra_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeRiskFactorId(): string {
  return `rf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeTriggerEventId(): string {
  return `te_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
