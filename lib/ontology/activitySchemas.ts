// ─── Activity Schema registry ──────────────────────────────────────────────
// The ontology's ActivitySchema concept (docs/ontology.md §2), Phase 1 form:
// a static lookup, not a rules table. Declares which requirement categories
// apply to a given service_engagement_type, so evaluateComplianceBatch
// (lib/compliance/evaluateServer.ts) consults a named registry instead of
// unconditionally running every check for every request.
//
// service_engagement_type today only distinguishes ride structure ('Single'
// vs 'Pooled') — the app doesn't yet have domain-differentiated activity
// types (e.g. "Student Transportation" vs "Home Health Visit"). Both existing
// values therefore require the same categories; this registry exists so that
// distinction is declared in one place and ready to diverge once the app
// models more than one activity domain, rather than requiring a second
// registry to be invented later. See docs/ontology.md §2 for the Phase 3
// successor (a declarative applicability_rules table conditioning on client
// type, recipient type, and jurisdiction too).
//
// 'insurance' is listed for completeness with docs/ontology.md's Requirement
// taxonomy, but no insurance-evaluation function exists yet in
// lib/compliance/ — only 'background_check' and 'recording_consent' are
// actually consulted by evaluateComplianceBatch today. Do not wire an insurance check
// against this category until lib/compliance/insuranceCompliance.ts (or
// equivalent) exists (Phase 2, docs/ontology-implementation-plan.md).

import type { ServiceEngagement } from '@/lib/mockData';

// 'background_check' (not the shorter 'bgc') to match the persisted
// requirement_category values in decision_traces (scripts/add-decision-traces.sql)
// and lib/compliance/evaluateServer.ts's DecisionTrace builders exactly.
export type RequirementCategory = 'background_check' | 'recording_consent' | 'insurance';

export type ServiceEngagementType = ServiceEngagement['service_engagement_type'];

export interface ActivitySchema {
  serviceEngagementType: ServiceEngagementType;
  requirementCategories: RequirementCategory[];
}

const ACTIVITY_SCHEMAS: Record<ServiceEngagementType, ActivitySchema> = {
  Single: { serviceEngagementType: 'Single', requirementCategories: ['background_check', 'recording_consent'] },
  Pooled: { serviceEngagementType: 'Pooled', requirementCategories: ['background_check', 'recording_consent'] },
};

// Any service_engagement_type not found above (legacy data, or a future
// domain-specific type not yet registered) falls back to the full set —
// fail open to "evaluate everything" rather than silently skipping a
// requirement category for an unrecognized activity type.
const DEFAULT_REQUIREMENT_CATEGORIES: RequirementCategory[] = ['background_check', 'recording_consent'];

export function getActivitySchema(serviceEngagementType: string | null | undefined): ActivitySchema | null {
  if (!serviceEngagementType) return null;
  return ACTIVITY_SCHEMAS[serviceEngagementType as ServiceEngagementType] ?? null;
}

export function getApplicableRequirementCategories(
  serviceEngagementType: string | null | undefined
): RequirementCategory[] {
  return getActivitySchema(serviceEngagementType)?.requirementCategories ?? DEFAULT_REQUIREMENT_CATEGORIES;
}
