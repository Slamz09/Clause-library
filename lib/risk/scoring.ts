import type { RiskBand, RiskFactorContribution, RiskAssessmentRecord, TriggerEventRecord } from '../types';
import { clampRiskScore, scoreToBand } from './utils';

// ── Shared result shape ────────────────────────────────────────────────────────

export interface ScoringResult {
  score_total: number;
  score_band: RiskBand;
  explanation_summary: string;
  factors: RiskFactorContribution[];
  inputs_snapshot: Record<string, any>;
}

// ── Obligation ─────────────────────────────────────────────────────────────────

export interface ObligationInput {
  obligation_id: string;
  status?: string;
  due_date?: string;
  severity?: string;
  obligation_type?: string;
  source_document_id?: string;
  document_id?: string;
  related_entity_id?: string;
  entity_id?: string;
  related_asset_id?: string;
  asset_id?: string;
  confidence?: string | number;
  trigger_event_type?: string;
  deadline_text?: string;
  action_text?: string;
  [key: string]: any;
}

export function computeObligationRisk(
  obligation: ObligationInput,
  _relatedContext?: Record<string, any>,
): ScoringResult {
  const factors: RiskFactorContribution[] = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const docId    = obligation.source_document_id || obligation.document_id;
  const entityId = obligation.related_entity_id  || obligation.entity_id;
  const assetId  = obligation.related_asset_id   || obligation.asset_id;
  const status   = (obligation.status   || '').toLowerCase();
  const severity = (obligation.severity || '').toLowerCase();
  const isResolved = ['resolved', 'complete', 'closed'].includes(status);

  let dueDate: Date | null = null;
  if (obligation.due_date) {
    const d = new Date(obligation.due_date);
    if (!isNaN(d.getTime())) dueDate = d;
  }
  const isOverdue = dueDate != null && dueDate < today && !isResolved;

  // timeliness_overdue
  if (isOverdue) {
    const daysOverdue = Math.floor((today.getTime() - dueDate!.getTime()) / 86_400_000);
    factors.push({
      factor_key: 'timeliness_overdue',
      factor_label: 'Obligation overdue',
      raw_value: 1.0,
      weighted_value: 3.0,
      severity: 'high',
      metadata: { due_date: obligation.due_date, days_overdue: daysOverdue },
    });
  }

  // status_open
  if (['open', 'active', 'breached'].includes(status)) {
    const sev: RiskBand = status === 'breached' ? 'critical' : 'moderate';
    factors.push({
      factor_key: 'status_open',
      factor_label: `Obligation status: ${status}`,
      raw_value: 1.0,
      weighted_value: 1.5,
      severity: sev,
      metadata: { status },
    });
  }

  // severity_level
  const sevWeightMap: Record<string, number> = {
    critical: 2.5,
    high: 2.0,
    medium: 1.0,
    moderate: 1.0,
    low: 0.5,
  };
  const sevWeight = sevWeightMap[severity] ?? 0;
  if (sevWeight > 0) {
    const sevBand: RiskBand =
      severity === 'critical' ? 'critical'
      : severity === 'high'    ? 'high'
      : severity === 'low'     ? 'low'
      : 'moderate';
    factors.push({
      factor_key: 'severity_level',
      factor_label: `Severity: ${severity}`,
      raw_value: 1.0,
      weighted_value: sevWeight,
      severity: sevBand,
      metadata: { obligation_severity: severity },
    });
  }

  // deadline_present
  if (dueDate || obligation.deadline_text) {
    factors.push({
      factor_key: 'deadline_present',
      factor_label: 'Deadline defined',
      raw_value: 1.0,
      weighted_value: 0.5,
      severity: 'low',
      metadata: { has_due_date: !!dueDate, has_deadline_text: !!obligation.deadline_text },
    });
  }

  // document_linked
  if (docId) {
    factors.push({
      factor_key: 'document_linked',
      factor_label: 'Document linked',
      raw_value: 1.0,
      weighted_value: 0.5,
      severity: 'low',
      metadata: { document_id: docId },
    });
  }

  // entity_linked
  if (entityId) {
    factors.push({
      factor_key: 'entity_linked',
      factor_label: 'Entity linked',
      raw_value: 1.0,
      weighted_value: 1.0,
      severity: 'low',
      metadata: { entity_id: entityId },
    });
  }

  // asset_linked
  if (assetId) {
    factors.push({
      factor_key: 'asset_linked',
      factor_label: 'Asset linked',
      raw_value: 1.0,
      weighted_value: 0.5,
      severity: 'low',
      metadata: { asset_id: assetId },
    });
  }

  const scoreTotal = clampRiskScore(factors.reduce((s, f) => s + f.weighted_value, 0));
  const scoreBand  = scoreToBand(scoreTotal);

  const parts: string[] = [];
  if (isOverdue) parts.push('overdue');
  if (status === 'breached') parts.push('breached');
  if (sevWeight >= 2.0) parts.push(`${severity} severity`);
  const explanationSummary = parts.length > 0
    ? `Obligation is ${parts.join(', ')}.`
    : `Obligation risk score ${scoreTotal} (${scoreBand}).`;

  return {
    score_total: scoreTotal,
    score_band: scoreBand,
    explanation_summary: explanationSummary,
    factors,
    inputs_snapshot: {
      obligation_id: obligation.obligation_id,
      status,
      due_date:   obligation.due_date  ?? null,
      severity:   obligation.severity  ?? null,
      is_overdue: isOverdue,
      document_id: docId    ?? null,
      entity_id:   entityId ?? null,
      asset_id:    assetId  ?? null,
    },
  };
}

// ── Entity ─────────────────────────────────────────────────────────────────────

export interface EntityRiskContext {
  childObligations: any[];
  childAssessments: RiskAssessmentRecord[];
  childTriggers: TriggerEventRecord[];
  coverageContext: {
    hasActivePolicy?: boolean;
    hasMissingCoverage?: boolean;
  };
  governanceContext?: {
    goodStanding: boolean | null;
    annualReportDueDate: string | null;
    expiredPermitCount: number;
    soonExpiringPermitCount: number;  // within 60 days
    suspendedOrRevokedCount: number;
  };
}

export function computeEntityRisk(
  entity: { entity_id: string; name?: string },
  ctx: EntityRiskContext,
): ScoringResult {
  const factors: RiskFactorContribution[] = [];

  const oblCount          = ctx.childObligations.length;
  const highCriticalCount = ctx.childAssessments.filter(
    a => a.score_band === 'high' || a.score_band === 'critical',
  ).length;
  const activeTriggerCount = ctx.childTriggers.filter(t => t.status === 'active').length;

  // child_obligation_exposure
  if (oblCount > 0) {
    factors.push({
      factor_key:     'child_obligation_exposure',
      factor_label:   'Has linked obligations',
      raw_value:      oblCount,
      weighted_value: 1.0,
      severity:       'low',
      metadata:       { obligation_count: oblCount },
    });
  }

  // high_child_obligations — 0.75 per high/critical, cap 3.0
  if (highCriticalCount > 0) {
    const weighted = Math.min(highCriticalCount * 0.75, 3.0);
    factors.push({
      factor_key:     'high_child_obligations',
      factor_label:   'High/critical obligation assessments',
      raw_value:      highCriticalCount,
      weighted_value: weighted,
      severity:       highCriticalCount >= 4 ? 'critical' : 'high',
      metadata:       { high_critical_count: highCriticalCount },
    });
  }

  // active_trigger_severity — 0.5 per trigger, cap 2.0
  if (activeTriggerCount > 0) {
    const weighted = Math.min(activeTriggerCount * 0.5, 2.0);
    factors.push({
      factor_key:     'active_trigger_severity',
      factor_label:   'Active triggers targeting entity',
      raw_value:      activeTriggerCount,
      weighted_value: weighted,
      severity:       weighted >= 1.5 ? 'high' : 'moderate',
      metadata:       { trigger_count: activeTriggerCount },
    });
  }

  // missing_coverage
  if (ctx.coverageContext?.hasMissingCoverage) {
    factors.push({
      factor_key:     'missing_coverage',
      factor_label:   'Missing required insurance coverage',
      raw_value:      1.0,
      weighted_value: 2.5,
      severity:       'critical',
      metadata:       { coverage_gap: true },
    });
  }

  // concentration
  const concentrationWeight =
    oblCount >= 6 ? 1.5
    : oblCount >= 3 ? 1.0
    : oblCount >= 1 ? 0.5
    : 0;
  if (concentrationWeight > 0) {
    factors.push({
      factor_key:     'concentration',
      factor_label:   'Obligation concentration',
      raw_value:      oblCount,
      weighted_value: concentrationWeight,
      severity:       concentrationWeight >= 1.5 ? 'high' : concentrationWeight >= 1.0 ? 'moderate' : 'low',
      metadata:       { obligation_count: oblCount, tier: oblCount >= 6 ? 'high' : oblCount >= 3 ? 'moderate' : 'low' },
    });
  }

  // ── Governance factors ──────────────────────────────────────────────────────
  const gov = ctx.governanceContext;
  if (gov) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // not_in_good_standing
    if (gov.goodStanding === false) {
      factors.push({
        factor_key:     'not_in_good_standing',
        factor_label:   'Entity not in good standing',
        raw_value:      1.0,
        weighted_value: 2.5,
        severity:       'critical',
        metadata:       { good_standing: false },
      });
    }

    // annual_report_overdue / annual_report_due_soon
    if (gov.annualReportDueDate) {
      const due = new Date(gov.annualReportDueDate);
      if (!isNaN(due.getTime())) {
        const daysUntil = Math.floor((due.getTime() - today.getTime()) / 86_400_000);
        if (daysUntil < 0) {
          factors.push({
            factor_key:     'annual_report_overdue',
            factor_label:   'Annual report overdue',
            raw_value:      1.0,
            weighted_value: 1.5,
            severity:       'high',
            metadata:       { annual_report_due_date: gov.annualReportDueDate, days_overdue: Math.abs(daysUntil) },
          });
        } else if (daysUntil <= 30) {
          factors.push({
            factor_key:     'annual_report_due_soon',
            factor_label:   'Annual report due within 30 days',
            raw_value:      1.0,
            weighted_value: 0.5,
            severity:       'moderate',
            metadata:       { annual_report_due_date: gov.annualReportDueDate, days_until: daysUntil },
          });
        }
      }
    }

    // permits_expired
    if (gov.expiredPermitCount > 0) {
      factors.push({
        factor_key:     'permits_expired',
        factor_label:   'Expired permit(s)',
        raw_value:      gov.expiredPermitCount,
        weighted_value: Math.min(gov.expiredPermitCount * 1.5, 3.0),
        severity:       'high',
        metadata:       { expired_permit_count: gov.expiredPermitCount },
      });
    }

    // permits_expiring_soon
    if (gov.soonExpiringPermitCount > 0) {
      factors.push({
        factor_key:     'permits_expiring_soon',
        factor_label:   'Permit(s) expiring within 60 days',
        raw_value:      gov.soonExpiringPermitCount,
        weighted_value: Math.min(gov.soonExpiringPermitCount * 0.5, 1.5),
        severity:       'moderate',
        metadata:       { soon_expiring_count: gov.soonExpiringPermitCount },
      });
    }

    // permits_suspended_revoked
    if (gov.suspendedOrRevokedCount > 0) {
      factors.push({
        factor_key:     'permits_suspended_revoked',
        factor_label:   'Suspended or revoked permit(s)',
        raw_value:      gov.suspendedOrRevokedCount,
        weighted_value: 2.0,
        severity:       'critical',
        metadata:       { suspended_revoked_count: gov.suspendedOrRevokedCount },
      });
    }
  }

  const scoreTotal = clampRiskScore(factors.reduce((s, f) => s + f.weighted_value, 0));
  const scoreBand  = scoreToBand(scoreTotal);

  const parts: string[] = [];
  if (highCriticalCount > 0)                   parts.push(`${highCriticalCount} high/critical obligation(s)`);
  if (activeTriggerCount > 0)                  parts.push(`${activeTriggerCount} active trigger(s)`);
  if (ctx.coverageContext?.hasMissingCoverage) parts.push('missing required coverage');
  if (gov?.goodStanding === false)             parts.push('not in good standing');
  if (gov?.expiredPermitCount)                 parts.push(`${gov.expiredPermitCount} expired permit(s)`);
  if (gov?.suspendedOrRevokedCount)            parts.push(`${gov.suspendedOrRevokedCount} suspended/revoked permit(s)`);
  const explanationSummary = parts.length > 0
    ? `Entity has ${parts.join(', ')}.`
    : `Entity risk score ${scoreTotal} (${scoreBand}).`;

  return {
    score_total: scoreTotal,
    score_band: scoreBand,
    explanation_summary: explanationSummary,
    factors,
    inputs_snapshot: {
      entity_id:                      entity.entity_id,
      obligation_count:               oblCount,
      high_critical_assessment_count: highCriticalCount,
      active_trigger_count:           activeTriggerCount,
      has_missing_coverage:           !!ctx.coverageContext?.hasMissingCoverage,
      good_standing:                  gov?.goodStanding ?? null,
      annual_report_due_date:         gov?.annualReportDueDate ?? null,
      expired_permit_count:           gov?.expiredPermitCount ?? 0,
      soon_expiring_permit_count:     gov?.soonExpiringPermitCount ?? 0,
      suspended_revoked_count:        gov?.suspendedOrRevokedCount ?? 0,
    },
  };
}

// ── Asset ──────────────────────────────────────────────────────────────────────

export interface AssetRiskContext {
  linkedEntityAssessment: RiskAssessmentRecord | null;
  obligationCount: number;
  hasCoverageGap: boolean;
  hasCoveragePresent: boolean;
}

export function computeAssetRisk(
  asset: { asset_id: string; name?: string },
  ctx: AssetRiskContext,
): ScoringResult {
  const factors: RiskFactorContribution[] = [];

  const entityScore = ctx.linkedEntityAssessment?.score_total ?? 0;
  const entityBand  = ctx.linkedEntityAssessment?.score_band  ?? null;

  // linked_entity_exposure
  const entityWeight =
    entityScore >= 8 ? 3.0
    : entityScore >= 6 ? 2.0
    : entityScore >= 3 ? 1.0
    : 0.5;
  const entitySeverity: RiskBand =
    entityWeight >= 3.0 ? 'critical'
    : entityWeight >= 2.0 ? 'high'
    : entityWeight >= 1.0 ? 'moderate'
    : 'low';
  factors.push({
    factor_key:     'linked_entity_exposure',
    factor_label:   'Linked entity risk score',
    raw_value:      entityScore,
    weighted_value: entityWeight,
    severity:       entitySeverity,
    metadata:       { entity_score: entityScore, entity_band: entityBand },
  });

  // obligation_attachment
  if (ctx.obligationCount > 0) {
    factors.push({
      factor_key:     'obligation_attachment',
      factor_label:   'Asset referenced by obligations',
      raw_value:      ctx.obligationCount,
      weighted_value: 1.5,
      severity:       'moderate',
      metadata:       { obligation_count: ctx.obligationCount },
    });
  }

  // coverage_gap
  if (ctx.hasCoverageGap) {
    factors.push({
      factor_key:     'coverage_gap',
      factor_label:   'Insurance coverage gap',
      raw_value:      1.0,
      weighted_value: 2.5,
      severity:       'critical',
      metadata:       { coverage_gap: true },
    });
  }

  // asset_coverage_present — reduces score by 0.75; clamp applied after sum
  if (ctx.hasCoveragePresent) {
    factors.push({
      factor_key:     'asset_coverage_present',
      factor_label:   'Active insurance coverage present',
      raw_value:      1.0,
      weighted_value: -0.75,
      severity:       'low',
      metadata:       { coverage_present: true },
    });
  }

  const scoreTotal = clampRiskScore(factors.reduce((s, f) => s + f.weighted_value, 0));
  const scoreBand  = scoreToBand(scoreTotal);

  const parts: string[] = [];
  if (entityWeight >= 2.0)    parts.push(`high entity exposure (${entityScore})`);
  if (ctx.hasCoverageGap)     parts.push('coverage gap');
  if (ctx.obligationCount > 0) parts.push(`${ctx.obligationCount} obligation(s)`);
  const explanationSummary = parts.length > 0
    ? `Asset exposure: ${parts.join(', ')}.`
    : `Asset risk score ${scoreTotal} (${scoreBand}).`;

  return {
    score_total: scoreTotal,
    score_band: scoreBand,
    explanation_summary: explanationSummary,
    factors,
    inputs_snapshot: {
      asset_id:             asset.asset_id,
      entity_score:         entityScore,
      entity_band:          entityBand,
      obligation_count:     ctx.obligationCount,
      has_coverage_gap:     ctx.hasCoverageGap,
      has_coverage_present: ctx.hasCoveragePresent,
    },
  };
}
