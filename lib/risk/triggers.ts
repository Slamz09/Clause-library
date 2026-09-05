import type { SupabaseClient } from '@supabase/supabase-js';
import type { RiskBand, RiskAssessmentRecord, TriggerEventRecord } from '../types';
import { nowIso, makeTriggerEventId } from './utils';

// ── Helpers ────────────────────────────────────────────────────────────────────

export async function upsertActiveTrigger(
  supabase: SupabaseClient,
  trigger: {
    event_type: string;
    severity: RiskBand;
    source_object_type: string;
    source_object_id: string;
    target_object_type: string;
    target_object_id: string;
    title: string;
    description: string;
    metadata: Record<string, any>;
  },
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('trigger_event')
    .select('id')
    .eq('event_type',          trigger.event_type)
    .eq('source_object_type',  trigger.source_object_type)
    .eq('source_object_id',    trigger.source_object_id)
    .eq('target_object_type',  trigger.target_object_type)
    .eq('target_object_id',    trigger.target_object_id)
    .eq('status', 'active')
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from('trigger_event')
      .update({ title: trigger.title, description: trigger.description, metadata: trigger.metadata, severity: trigger.severity, updated_at: nowIso() })
      .eq('id', existing.id);
    return existing.id;
  }

  const row = {
    id:                 makeTriggerEventId(),
    event_type:         trigger.event_type,
    severity:           trigger.severity,
    status:             'active',
    source_object_type: trigger.source_object_type,
    source_object_id:   trigger.source_object_id,
    target_object_type: trigger.target_object_type,
    target_object_id:   trigger.target_object_id,
    title:              trigger.title,
    description:        trigger.description,
    metadata:           trigger.metadata,
    occurred_at:        nowIso(),
    created_at:         nowIso(),
    updated_at:         nowIso(),
  };
  const { data } = await supabase.from('trigger_event').insert(row).select('id').single();
  return data?.id ?? null;
}

export async function resolveInactiveTriggersForSource(
  supabase: SupabaseClient,
  eventType: string,
  sourceObjectType: string,
  sourceObjectId: string,
  targetObjectType: string,
  targetObjectId: string,
): Promise<void> {
  await supabase
    .from('trigger_event')
    .update({ status: 'resolved', resolved_at: nowIso(), updated_at: nowIso() })
    .eq('event_type',         eventType)
    .eq('source_object_type', sourceObjectType)
    .eq('source_object_id',   sourceObjectId)
    .eq('target_object_type', targetObjectType)
    .eq('target_object_id',   targetObjectId)
    .eq('status', 'active');
}

// ── Obligation triggers ────────────────────────────────────────────────────────

export async function generateObligationTriggers(
  supabase: SupabaseClient,
  obligation: {
    obligation_id: string;
    status?: string;
    due_date?: string;
    obligation_type?: string;
    trigger_event_type?: string;
    related_entity_id?: string;
    entity_id?: string;
    related_asset_id?: string;
    asset_id?: string;
    [key: string]: any;
  },
  obligationAssessment: { id: string; score_total: number; score_band: RiskBand },
): Promise<void> {
  const entityId = obligation.related_entity_id || obligation.entity_id;
  const assetId  = obligation.related_asset_id  || obligation.asset_id;
  const targetType = entityId ? 'entity' : assetId ? 'asset' : null;
  const targetId   = entityId || assetId;
  if (!targetType || !targetId) return;

  const today   = new Date();
  today.setHours(0, 0, 0, 0);
  const status  = (obligation.status || '').toLowerCase();
  const isResolved = ['resolved', 'complete', 'closed'].includes(status);

  let dueDate: Date | null = null;
  if (obligation.due_date) {
    const d = new Date(obligation.due_date);
    if (!isNaN(d.getTime())) dueDate = d;
  }
  const isOverdue    = dueDate != null && dueDate < today && !isResolved;
  const daysToDeadline = dueDate ? Math.floor((dueDate.getTime() - today.getTime()) / 86_400_000) : null;
  const withinThirty = daysToDeadline != null && daysToDeadline >= 0 && daysToDeadline <= 30;

  const baseMeta = {
    obligation_id:        obligation.obligation_id,
    linked_assessment_id: obligationAssessment.id,
    due_date:             obligation.due_date ?? null,
    days_to_deadline:     daysToDeadline,
    obligation_status:    status,
    obligation_type:      obligation.obligation_type ?? null,
  };

  // obligation_overdue
  if (isOverdue) {
    await upsertActiveTrigger(supabase, {
      event_type:         'obligation_overdue',
      severity:           'high',
      source_object_type: 'obligation',
      source_object_id:   obligation.obligation_id,
      target_object_type: targetType,
      target_object_id:   targetId,
      title:              'Obligation overdue',
      description:        `Obligation ${obligation.obligation_id} is past its due date.`,
      metadata:           baseMeta,
    });
  } else {
    await resolveInactiveTriggersForSource(supabase, 'obligation_overdue', 'obligation', obligation.obligation_id, targetType, targetId);
  }

  // obligation_breached
  if (status === 'breached') {
    await upsertActiveTrigger(supabase, {
      event_type:         'obligation_breached',
      severity:           'critical',
      source_object_type: 'obligation',
      source_object_id:   obligation.obligation_id,
      target_object_type: targetType,
      target_object_id:   targetId,
      title:              'Obligation breached',
      description:        `Obligation ${obligation.obligation_id} has been breached.`,
      metadata:           baseMeta,
    });
  } else {
    await resolveInactiveTriggersForSource(supabase, 'obligation_breached', 'obligation', obligation.obligation_id, targetType, targetId);
  }

  // filing_deadline_warning — within 30 days and not yet overdue
  if (withinThirty && !isOverdue && !isResolved) {
    await upsertActiveTrigger(supabase, {
      event_type:         'filing_deadline_warning',
      severity:           daysToDeadline! <= 7 ? 'high' : 'moderate',
      source_object_type: 'obligation',
      source_object_id:   obligation.obligation_id,
      target_object_type: targetType,
      target_object_id:   targetId,
      title:              `Filing deadline in ${daysToDeadline} day(s)`,
      description:        `Obligation ${obligation.obligation_id} deadline approaching.`,
      metadata:           baseMeta,
    });
  } else {
    await resolveInactiveTriggersForSource(supabase, 'filing_deadline_warning', 'obligation', obligation.obligation_id, targetType, targetId);
  }

  // renewal_deadline_warning — check renewal_date field if present
  const renewalDate = obligation.renewal_date
    ? (() => { const d = new Date(obligation.renewal_date); return isNaN(d.getTime()) ? null : d; })()
    : null;
  const renewalDays = renewalDate ? Math.floor((renewalDate.getTime() - today.getTime()) / 86_400_000) : null;
  if (renewalDays != null && renewalDays >= 0 && renewalDays <= 30) {
    await upsertActiveTrigger(supabase, {
      event_type:         'renewal_deadline_warning',
      severity:           renewalDays <= 7 ? 'high' : 'moderate',
      source_object_type: 'obligation',
      source_object_id:   obligation.obligation_id,
      target_object_type: targetType,
      target_object_id:   targetId,
      title:              `Renewal deadline in ${renewalDays} day(s)`,
      description:        `Obligation ${obligation.obligation_id} renewal approaching.`,
      metadata:           { ...baseMeta, renewal_date: obligation.renewal_date, days_to_renewal: renewalDays },
    });
  } else {
    await resolveInactiveTriggersForSource(supabase, 'renewal_deadline_warning', 'obligation', obligation.obligation_id, targetType, targetId);
  }

  // insurance_expiry_warning — insurance obligation type + due_date within 30 days
  const oblType = (obligation.obligation_type || '').toLowerCase();
  const trigType = (obligation.trigger_event_type || '').toLowerCase();
  const isInsuranceRelated = oblType.includes('insurance') || oblType.includes('coverage') || trigType.includes('insurance');
  if (isInsuranceRelated && withinThirty && !isOverdue && !isResolved) {
    await upsertActiveTrigger(supabase, {
      event_type:         'insurance_expiry_warning',
      severity:           daysToDeadline! <= 7 ? 'critical' : 'high',
      source_object_type: 'obligation',
      source_object_id:   obligation.obligation_id,
      target_object_type: targetType,
      target_object_id:   targetId,
      title:              `Insurance expiry warning — ${daysToDeadline} day(s)`,
      description:        `Insurance-related obligation ${obligation.obligation_id} expiry approaching.`,
      metadata:           baseMeta,
    });
  } else {
    await resolveInactiveTriggersForSource(supabase, 'insurance_expiry_warning', 'obligation', obligation.obligation_id, targetType, targetId);
  }
}

// ── Entity triggers ────────────────────────────────────────────────────────────

export async function generateEntityTriggers(
  supabase: SupabaseClient,
  entity: { entity_id: string; name?: string },
  entityAssessment: { id: string; score_total: number; score_band: RiskBand },
  childAssessments: RiskAssessmentRecord[],
  childTriggers: TriggerEventRecord[],
  coverageContext: { hasMissingCoverage: boolean; coverageGapCount: number },
  governanceContext?: {
    goodStanding: boolean | null;
    annualReportDueDate: string | null;
    expiredPermitCount: number;
    suspendedOrRevokedCount: number;
    criticalPermitExpired: boolean;
  },
): Promise<void> {
  const src     = 'entity';
  const srcId   = entity.entity_id;
  const tgtType = 'entity';
  const tgtId   = entity.entity_id;

  const highCriticalCount  = childAssessments.filter(a => a.score_band === 'high' || a.score_band === 'critical').length;
  const activeTriggerCount = childTriggers.filter(t => t.status === 'active').length;

  const baseMeta = {
    entity_id:                 entity.entity_id,
    linked_assessment_id:      entityAssessment.id,
    score_total:               entityAssessment.score_total,
    score_band:                entityAssessment.score_band,
    high_child_count:          highCriticalCount,
    active_child_trigger_count: activeTriggerCount,
    coverage_gap_count:        coverageContext.coverageGapCount,
  };

  // entity_score_high
  if (entityAssessment.score_band === 'high') {
    await upsertActiveTrigger(supabase, {
      event_type: 'entity_score_high', severity: 'high',
      source_object_type: src, source_object_id: srcId,
      target_object_type: tgtType, target_object_id: tgtId,
      title: `Entity risk elevated — score ${entityAssessment.score_total}`,
      description: `${entity.name || entity.entity_id} has reached high risk level.`,
      metadata: baseMeta,
    });
  } else {
    await resolveInactiveTriggersForSource(supabase, 'entity_score_high', src, srcId, tgtType, tgtId);
  }

  // entity_score_critical
  if (entityAssessment.score_band === 'critical') {
    await upsertActiveTrigger(supabase, {
      event_type: 'entity_score_critical', severity: 'critical',
      source_object_type: src, source_object_id: srcId,
      target_object_type: tgtType, target_object_id: tgtId,
      title: `Entity risk critical — score ${entityAssessment.score_total}`,
      description: `${entity.name || entity.entity_id} has reached critical risk level.`,
      metadata: baseMeta,
    });
  } else {
    await resolveInactiveTriggersForSource(supabase, 'entity_score_critical', src, srcId, tgtType, tgtId);
  }

  // missing_required_coverage
  if (coverageContext.hasMissingCoverage) {
    await upsertActiveTrigger(supabase, {
      event_type: 'missing_required_coverage', severity: 'critical',
      source_object_type: src, source_object_id: srcId,
      target_object_type: tgtType, target_object_id: tgtId,
      title: 'Missing required insurance coverage',
      description: `${entity.name || entity.entity_id} has ${coverageContext.coverageGapCount} unmet coverage requirement(s).`,
      metadata: baseMeta,
    });
  } else {
    await resolveInactiveTriggersForSource(supabase, 'missing_required_coverage', src, srcId, tgtType, tgtId);
  }

  // child_obligation_material_exposure
  if (highCriticalCount >= 2) {
    await upsertActiveTrigger(supabase, {
      event_type: 'child_obligation_material_exposure', severity: highCriticalCount >= 4 ? 'critical' : 'high',
      source_object_type: src, source_object_id: srcId,
      target_object_type: tgtType, target_object_id: tgtId,
      title: `Material obligation exposure — ${highCriticalCount} high/critical`,
      description: `${entity.name || entity.entity_id} has ${highCriticalCount} high or critical obligation assessments.`,
      metadata: baseMeta,
    });
  } else {
    await resolveInactiveTriggersForSource(supabase, 'child_obligation_material_exposure', src, srcId, tgtType, tgtId);
  }

  // child_trigger_concentration
  if (activeTriggerCount >= 3) {
    await upsertActiveTrigger(supabase, {
      event_type: 'child_trigger_concentration', severity: activeTriggerCount >= 5 ? 'critical' : 'high',
      source_object_type: src, source_object_id: srcId,
      target_object_type: tgtType, target_object_id: tgtId,
      title: `Trigger concentration — ${activeTriggerCount} active`,
      description: `${entity.name || entity.entity_id} has concentrated active triggers.`,
      metadata: baseMeta,
    });
  } else {
    await resolveInactiveTriggersForSource(supabase, 'child_trigger_concentration', src, srcId, tgtType, tgtId);
  }

  // ── Governance triggers ──────────────────────────────────────────────────
  if (governanceContext) {
    const gov = governanceContext;
    const govMeta = { ...baseMeta, ...gov };

    // not_in_good_standing
    if (gov.goodStanding === false) {
      await upsertActiveTrigger(supabase, {
        event_type: 'not_in_good_standing', severity: 'critical',
        source_object_type: src, source_object_id: srcId,
        target_object_type: tgtType, target_object_id: tgtId,
        title: 'Entity not in good standing',
        description: `${entity.name || entity.entity_id} is not in good standing with its registered jurisdiction.`,
        metadata: govMeta,
      });
    } else {
      await resolveInactiveTriggersForSource(supabase, 'not_in_good_standing', src, srcId, tgtType, tgtId);
    }

    // annual_report_overdue
    if (gov.annualReportDueDate) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const due = new Date(gov.annualReportDueDate);
      if (!isNaN(due.getTime()) && due < today) {
        await upsertActiveTrigger(supabase, {
          event_type: 'annual_report_overdue', severity: 'high',
          source_object_type: src, source_object_id: srcId,
          target_object_type: tgtType, target_object_id: tgtId,
          title: 'Annual report overdue',
          description: `${entity.name || entity.entity_id} annual report was due ${gov.annualReportDueDate}.`,
          metadata: { ...govMeta, annual_report_due_date: gov.annualReportDueDate },
        });
      } else {
        await resolveInactiveTriggersForSource(supabase, 'annual_report_overdue', src, srcId, tgtType, tgtId);
      }
    } else {
      await resolveInactiveTriggersForSource(supabase, 'annual_report_overdue', src, srcId, tgtType, tgtId);
    }

    // permit_critical_expired (liquor license or ski area permit expired)
    if (gov.criticalPermitExpired) {
      await upsertActiveTrigger(supabase, {
        event_type: 'permit_critical_expired', severity: gov.expiredPermitCount >= 2 ? 'critical' : 'high',
        source_object_type: src, source_object_id: srcId,
        target_object_type: tgtType, target_object_id: tgtId,
        title: `Critical permit expired (${gov.expiredPermitCount} total)`,
        description: `${entity.name || entity.entity_id} has an expired critical operating permit.`,
        metadata: { ...govMeta, expired_permit_count: gov.expiredPermitCount },
      });
    } else {
      await resolveInactiveTriggersForSource(supabase, 'permit_critical_expired', src, srcId, tgtType, tgtId);
    }
  }
}
