import type { SupabaseClient } from '@supabase/supabase-js';
import type { RiskAssessmentRecord, RiskFactorContribution, RiskObjectType, TriggerEventRecord } from '../types';
import { computeObligationRisk, computeEntityRisk, computeAssetRisk } from './scoring';
import { generateObligationTriggers, generateEntityTriggers } from './triggers';
import { buildObligationExposureLinks, buildEntityExposureLinks, buildAssetExposureLinks } from './exposure';
import { makeRiskAssessmentId, makeRiskFactorId, nowIso, SCORE_VERSION } from './utils';

// ── Persistence helpers ────────────────────────────────────────────────────────

export async function getLatestRiskAssessment(
  supabase: SupabaseClient,
  objectType: RiskObjectType,
  objectId: string,
): Promise<RiskAssessmentRecord | null> {
  const { data } = await supabase
    .from('risk_assessment')
    .select('*')
    .eq('object_type', objectType)
    .eq('object_id',   objectId)
    .maybeSingle();
  return data ?? null;
}

export async function upsertRiskAssessment(
  supabase: SupabaseClient,
  payload: Omit<RiskAssessmentRecord, 'factor_contributions' | 'active_triggers' | 'linked_risk_sources' | 'direct_exposure_objects' | 'explanation_chain' | 'propagated_impacts' | 'propagation_status'>,
): Promise<RiskAssessmentRecord> {
  const row = {
    ...payload,
    updated_at: nowIso(),
  };
  const { data, error } = await supabase
    .from('risk_assessment')
    .upsert(row, { onConflict: 'object_type,object_id' })
    .select()
    .single();
  if (error) throw new Error(`upsertRiskAssessment: ${error.message}`);
  return data as RiskAssessmentRecord;
}

export async function replaceFactorContributions(
  supabase: SupabaseClient,
  assessmentId: string,
  factors: RiskFactorContribution[],
): Promise<void> {
  await supabase.from('risk_factor_contribution').delete().eq('risk_assessment_id', assessmentId);
  if (factors.length === 0) return;
  const rows = factors.map(f => ({
    id:                 makeRiskFactorId(),
    risk_assessment_id: assessmentId,
    factor_key:         f.factor_key,
    factor_label:       f.factor_label,
    raw_value:          f.raw_value,
    weighted_value:     f.weighted_value,
    severity:           f.severity,
    metadata:           f.metadata ?? {},
    created_at:         nowIso(),
  }));
  await supabase.from('risk_factor_contribution').insert(rows);
}

// ── Obligation recompute ───────────────────────────────────────────────────────

export async function recomputeObligationRisk(
  supabase: SupabaseClient,
  obligationId: string,
): Promise<RiskAssessmentRecord> {
  const { data: obl, error } = await supabase
    .from('saved_obligations')
    .select('*')
    .eq('obligation_id', obligationId)
    .single();
  if (error || !obl) throw new Error(`Obligation ${obligationId} not found`);

  const scoring = computeObligationRisk(obl);
  const assessmentId = makeRiskAssessmentId();

  const existing = await getLatestRiskAssessment(supabase, 'obligation', obligationId);
  const id = existing?.id ?? assessmentId;

  const assessment = await upsertRiskAssessment(supabase, {
    id,
    object_type:         'obligation',
    object_id:           obligationId,
    score_total:         scoring.score_total,
    score_band:          scoring.score_band,
    score_version:       SCORE_VERSION,
    explanation_summary: scoring.explanation_summary,
    inputs_snapshot:     scoring.inputs_snapshot,
    assessed_at:         nowIso(),
  });

  await replaceFactorContributions(supabase, assessment.id, scoring.factors);
  await generateObligationTriggers(supabase, obl, { id: assessment.id, score_total: assessment.score_total, score_band: assessment.score_band });

  const { linked_risk_sources, direct_exposure_objects, explanation_chain } = buildObligationExposureLinks(obl);

  // Load active triggers for this obligation's entity/asset
  const entityId = obl.related_entity_id || obl.entity_id;
  const assetId  = obl.related_asset_id  || obl.asset_id;

  const { data: activeTriggers } = await supabase
    .from('trigger_event')
    .select('*')
    .eq('source_object_id', obligationId)
    .eq('source_object_type', 'obligation')
    .eq('status', 'active');

  // Cascade to entity/asset
  if (entityId) {
    try { await recomputeEntityRisk(supabase, entityId); } catch { /* non-blocking */ }
  }
  if (assetId) {
    try { await recomputeAssetRisk(supabase, assetId); } catch { /* non-blocking */ }
  }

  return {
    ...assessment,
    factor_contributions:   scoring.factors,
    active_triggers:        (activeTriggers ?? []) as TriggerEventRecord[],
    linked_risk_sources,
    direct_exposure_objects,
    explanation_chain,
    propagated_impacts:     [],
    propagation_status:     'not_enabled',
  };
}

// ── Entity recompute ───────────────────────────────────────────────────────────

export async function recomputeEntityRisk(
  supabase: SupabaseClient,
  entityId: string,
): Promise<RiskAssessmentRecord> {
  const { data: entity, error } = await supabase
    .from('entities')
    .select('*')
    .eq('entity_id', entityId)
    .single();
  if (error || !entity) throw new Error(`Entity ${entityId} not found`);

  // Load obligations
  const { data: obligations } = await supabase
    .from('saved_obligations')
    .select('*')
    .or(`entity_id.eq.${entityId},related_entity_id.eq.${entityId}`);
  const oblList = obligations ?? [];

  // Load child assessments
  const oblIds = oblList.map((o: any) => o.obligation_id).filter(Boolean);
  let childAssessments: RiskAssessmentRecord[] = [];
  if (oblIds.length > 0) {
    const { data: assessments } = await supabase
      .from('risk_assessment')
      .select('*')
      .eq('object_type', 'obligation')
      .in('object_id', oblIds);
    childAssessments = (assessments ?? []) as RiskAssessmentRecord[];
  }

  // Load active triggers targeting entity
  const { data: triggerRows } = await supabase
    .from('trigger_event')
    .select('*')
    .eq('target_object_type', 'entity')
    .eq('target_object_id', entityId)
    .eq('status', 'active');
  const childTriggers = (triggerRows ?? []) as TriggerEventRecord[];

  // Load coverage context
  const { data: requiredInsuredRows } = await supabase
    .from('contract_required_insureds')
    .select('insurance_requirement_id')
    .eq('entity_id', entityId);
  const reqIds = (requiredInsuredRows ?? []).map((r: any) => r.insurance_requirement_id).filter(Boolean);
  let hasMissingCoverage = false;
  let coverageGapCount = 0;
  if (reqIds.length > 0) {
    const { data: satRows } = await supabase
      .from('insurance_requirement_satisfaction')
      .select('status')
      .in('contract_requirement_id', reqIds)
      .in('status', ['not_met', 'partially_met']);
    coverageGapCount = (satRows ?? []).length;
    hasMissingCoverage = coverageGapCount > 0;
  }

  // Load governance data
  const { data: govRow } = await supabase
    .from('entity_governance')
    .select('good_standing, annual_report_due_date')
    .eq('entity_id', entityId)
    .maybeSingle();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in60Days = new Date(today.getTime() + 60 * 86_400_000);

  const { data: permitRows } = await supabase
    .from('entity_permits')
    .select('status, expiration_date')
    .eq('entity_id', entityId);
  const permits = permitRows ?? [];

  const expiredPermitCount      = permits.filter((p: any) => p.status === 'expired' || (p.expiration_date && new Date(p.expiration_date) < today && p.status === 'active')).length;
  const soonExpiringPermitCount = permits.filter((p: any) => {
    if (!p.expiration_date || p.status !== 'active') return false;
    const exp = new Date(p.expiration_date);
    return exp >= today && exp <= in60Days;
  }).length;
  const suspendedOrRevokedCount = permits.filter((p: any) => p.status === 'suspended' || p.status === 'revoked').length;

  const scoring = computeEntityRisk(entity, {
    childObligations: oblList,
    childAssessments,
    childTriggers,
    coverageContext: { hasMissingCoverage },
    governanceContext: {
      goodStanding:           govRow?.good_standing ?? null,
      annualReportDueDate:    govRow?.annual_report_due_date ?? null,
      expiredPermitCount,
      soonExpiringPermitCount,
      suspendedOrRevokedCount,
    },
  });

  const existing = await getLatestRiskAssessment(supabase, 'entity', entityId);
  const assessmentId = existing?.id ?? makeRiskAssessmentId();

  const assessment = await upsertRiskAssessment(supabase, {
    id:                  assessmentId,
    object_type:         'entity',
    object_id:           entityId,
    score_total:         scoring.score_total,
    score_band:          scoring.score_band,
    score_version:       SCORE_VERSION,
    explanation_summary: scoring.explanation_summary,
    inputs_snapshot:     scoring.inputs_snapshot,
    assessed_at:         nowIso(),
  });

  await replaceFactorContributions(supabase, assessment.id, scoring.factors);

  const criticalPermitExpired = permits.some((p: any) => {
    const type = (p.permit_type || '').toLowerCase();
    const isCritical = type.includes('liquor') || type.includes('ski') || type.includes('business');
    const isExpired = p.status === 'expired' || (p.expiration_date && new Date(p.expiration_date) < today && p.status === 'active');
    return isCritical && isExpired;
  });

  await generateEntityTriggers(supabase, entity, assessment, childAssessments, childTriggers, { hasMissingCoverage, coverageGapCount }, {
    goodStanding:           govRow?.good_standing ?? null,
    annualReportDueDate:    govRow?.annual_report_due_date ?? null,
    expiredPermitCount,
    suspendedOrRevokedCount,
    criticalPermitExpired,
  });

  // Update entity risk_score
  await supabase.from('entities').update({ risk_score: scoring.score_total }).eq('entity_id', entityId);

  // Load parent entity + assets for exposure links
  const { data: parentEntity } = entity.parent_entity_id
    ? await supabase.from('entities').select('entity_id, name').eq('entity_id', entity.parent_entity_id).maybeSingle()
    : { data: null };
  const { data: assetRows } = await supabase.from('assets').select('asset_id, name').eq('entity_id', entityId);
  const linkedAssets = assetRows ?? [];

  const { linked_risk_sources, direct_exposure_objects, explanation_chain } = buildEntityExposureLinks(
    entity,
    oblList.map((o: any) => ({ ...o, score_band: childAssessments.find((a: any) => a.object_id === o.obligation_id)?.score_band })),
    parentEntity ?? null,
    linkedAssets,
  );

  // Recompute linked assets
  for (const asset of linkedAssets) {
    try { await recomputeAssetRisk(supabase, asset.asset_id); } catch { /* non-blocking */ }
  }

  return {
    ...assessment,
    factor_contributions:   scoring.factors,
    active_triggers:        childTriggers,
    linked_risk_sources,
    direct_exposure_objects,
    explanation_chain,
    propagated_impacts:     [],
    propagation_status:     'not_enabled',
  };
}

// ── Asset recompute ────────────────────────────────────────────────────────────

export async function recomputeAssetRisk(
  supabase: SupabaseClient,
  assetId: string,
): Promise<RiskAssessmentRecord> {
  const { data: asset, error } = await supabase
    .from('assets')
    .select('*')
    .eq('asset_id', assetId)
    .single();
  if (error || !asset) throw new Error(`Asset ${assetId} not found`);

  // Linked entity assessment
  let linkedEntityAssessment: RiskAssessmentRecord | null = null;
  let linkedEntity: any = null;
  if (asset.entity_id) {
    linkedEntityAssessment = await getLatestRiskAssessment(supabase, 'entity', asset.entity_id);
    const { data: ent } = await supabase.from('entities').select('entity_id, name').eq('entity_id', asset.entity_id).maybeSingle();
    linkedEntity = ent ?? null;
  }

  // Linked obligations
  const { data: oblRows } = await supabase
    .from('saved_obligations')
    .select('obligation_id, obligation_type')
    .or(`asset_id.eq.${assetId},related_asset_id.eq.${assetId}`);
  const linkedObligations = oblRows ?? [];

  // Coverage: check insurance_covered_objects
  const { data: covObjects } = await supabase
    .from('insurance_covered_objects')
    .select('id')
    .eq('covered_object_type', 'asset')
    .eq('covered_object_id', assetId)
    .limit(1);
  const hasCoveragePresent = (covObjects ?? []).length > 0;

  // Coverage gap: check via contract_insurance_requirements for asset
  const { data: assetReqs } = await supabase
    .from('contract_insurance_requirements')
    .select('id')
    .eq('required_subject_type', 'asset')
    .eq('required_subject_id', assetId);
  const assetReqIds = (assetReqs ?? []).map((r: any) => r.id).filter(Boolean);
  let hasCoverageGap = false;
  if (assetReqIds.length > 0) {
    const { data: satRows } = await supabase
      .from('insurance_requirement_satisfaction')
      .select('status')
      .in('contract_requirement_id', assetReqIds)
      .in('status', ['not_met', 'partially_met']);
    hasCoverageGap = (satRows ?? []).length > 0;
  }

  const scoring = computeAssetRisk(asset, {
    linkedEntityAssessment,
    obligationCount:    linkedObligations.length,
    hasCoverageGap,
    hasCoveragePresent,
  });

  const existing = await getLatestRiskAssessment(supabase, 'asset', assetId);
  const assessmentId = existing?.id ?? makeRiskAssessmentId();

  const assessment = await upsertRiskAssessment(supabase, {
    id:                  assessmentId,
    object_type:         'asset',
    object_id:           assetId,
    score_total:         scoring.score_total,
    score_band:          scoring.score_band,
    score_version:       SCORE_VERSION,
    explanation_summary: scoring.explanation_summary,
    inputs_snapshot:     scoring.inputs_snapshot,
    assessed_at:         nowIso(),
  });

  await replaceFactorContributions(supabase, assessment.id, scoring.factors);

  // Update asset risk_score
  await supabase.from('assets').update({ risk_score: scoring.score_total }).eq('asset_id', assetId);

  const { linked_risk_sources, direct_exposure_objects, explanation_chain } = buildAssetExposureLinks(
    asset,
    linkedEntity,
    linkedObligations,
  );

  return {
    ...assessment,
    factor_contributions:   scoring.factors,
    active_triggers:        [],
    linked_risk_sources,
    direct_exposure_objects,
    explanation_chain,
    propagated_impacts:     [],
    propagation_status:     'not_enabled',
  };
}
