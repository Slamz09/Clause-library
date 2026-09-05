// ─── Server-Side Compliance Evaluation Orchestration ──────────────────────────
// Backing logic for POST /api/compliance/evaluate. Does NOT reimplement any
// compliance logic — calls the existing evaluateBgcCompliance (lib/bgcCompliance.ts)
// and serviceEngagementPrivacyStatus (lib/mockData.ts), the same functions
// app/(app)/operations/page.tsx already calls client-side, just fed with
// server-fetched data instead.

import { createServerClient } from '@/lib/supabaseServer';
import { evaluateBgcCompliance, type BgcComplianceResult } from '@/lib/bgcCompliance';
import {
  serviceEngagementPrivacyStatus,
  recipientOptedOutOfEngagement,
  type Worker,
  type Contract,
  type Client,
  type ServiceRecipient,
  type ServiceEngagement,
} from '@/lib/mockData';
import { sanitizeDbError } from '@/lib/security/safeError';
import { getApplicableRequirementCategories } from '@/lib/ontology/activitySchemas';
import type { DecisionTrace, DecisionTraceStandardResult } from '@/lib/ontology/types';

export interface EvaluateRequestItem {
  worker_id: string;
  client_id: string;
  state: string;
  service_engagement_id?: string;
}

export interface EvaluatePrivacyResult {
  status: 'COMPLIANT' | 'NON-COMPLIANT';
  controllingClientPolicy: 'opt-in' | 'opt-out' | null;
  nonCompliantServiceRecipientIds: string[];
}

export interface EvaluateResultItem {
  worker_id: string;
  client_id: string;
  state: string;
  service_engagement_id?: string;
  bgc: BgcComplianceResult | null;
  privacy: EvaluatePrivacyResult | null;
  // Audit trail: which driver-req regulation_overrides row (if any) fed the
  // legal leg of the BGC verdict above.
  regulationOverrideApplied: { table_name: 'driver-req'; abbr: string } | null;
  // Structured Decision Trace(s) for this item — see lib/ontology/types.ts.
  // Persisted to decision_traces by the route handler; kept on the response
  // too so a caller can show "why" without a second round trip.
  decisionTraces: DecisionTrace[];
  error?: string;
}

// ── Decision Trace builders ────────────────────────────────────────────────
// Reshape the verdicts evaluateBgcCompliance/serviceEngagementPrivacyStatus
// already compute into the ontology's DecisionTrace shape. Pure transforms —
// no new evaluation logic, no new data sources.

function buildBgcDecisionTrace(
  item: EvaluateRequestItem,
  bgc: BgcComplianceResult,
  evaluatedAt: string,
): DecisionTrace {
  const standards: DecisionTraceStandardResult[] = [
    { authority: 'legal', status: bgc.legalStatus, citation: bgc.legalId, interval_months: bgc.legalIntervalMonths, due_date: bgc.legalDueDate?.toISOString() ?? null },
    { authority: 'contract', status: bgc.contractStatus, citation: bgc.contractId, interval_months: bgc.contractIntervalMonths, due_date: bgc.contractDueDate?.toISOString() ?? null },
    { authority: 'policy', status: bgc.policyStatus, citation: bgc.policyId, interval_months: bgc.policyIntervalMonths, due_date: bgc.policyDueDate?.toISOString() ?? null },
  ];
  return {
    worker_id: item.worker_id,
    client_id: item.client_id,
    state: item.state,
    service_engagement_id: item.service_engagement_id ?? null,
    requirement_category: 'background_check',
    standards,
    controlling_standard: bgc.controllingStandard,
    relationship: bgc.relationship,
    result: bgc.overallStatus,
    evaluated_at: evaluatedAt,
  };
}

function buildPrivacyDecisionTrace(
  item: EvaluateRequestItem,
  privacy: EvaluatePrivacyResult,
  evaluatedAt: string,
): DecisionTrace {
  // Only one standard is actually consulted today — the client's own
  // video_consent_policy (set per-client, effectively a customer requirement
  // rather than state law or internal company policy — no legal
  // recording-consent standard is wired into this computation yet, so it is
  // NOT listed here; see docs/ontology-implementation-plan.md Phase 2).
  const standards: DecisionTraceStandardResult[] = privacy.controllingClientPolicy
    ? [{ authority: 'contract', status: privacy.status === 'COMPLIANT' ? 'compliant' : 'non-compliant', citation: item.client_id, interval_months: null, due_date: null }]
    : [];
  return {
    worker_id: item.worker_id,
    client_id: item.client_id,
    state: item.state,
    service_engagement_id: item.service_engagement_id ?? null,
    requirement_category: 'recording_consent',
    standards,
    controlling_standard: standards.length > 0 ? 'contract' : null,
    relationship: null,
    result: privacy.status === 'COMPLIANT' ? 'compliant' : 'non-compliant',
    evaluated_at: evaluatedAt,
  };
}

export async function evaluateComplianceBatch(items: EvaluateRequestItem[]): Promise<EvaluateResultItem[]> {
  const supabase = createServerClient();

  const workerIds = [...new Set(items.map((i) => i.worker_id))];
  const clientIds = [...new Set(items.map((i) => i.client_id))];
  const states = [...new Set(items.map((i) => i.state))];
  const engagementIds = [...new Set(items.filter((i) => i.service_engagement_id).map((i) => i.service_engagement_id as string))];

  const [workersRes, contractsRes, clientsRes, overridesRes] = await Promise.all([
    supabase.from('workers').select('*').in('worker_id', workerIds),
    supabase.from('contracts').select('*').in('linked_client_id', clientIds),
    supabase.from('clients').select('client_id, client_name, video_consent_policy').in('client_id', clientIds),
    supabase.from('regulation_overrides').select('*').eq('table_name', 'driver-req').in('abbr', states),
  ]);

  for (const res of [workersRes, contractsRes, clientsRes, overridesRes]) {
    if (res.error) throw new Error(sanitizeDbError(res.error));
  }

  // workers table still stores the client-linkage column as `customer_id`
  // (pre-dates the customers -> clients rename) — translate at this boundary,
  // same as app/api/workers/route.ts does.
  const workerMap = new Map<string, Worker>();
  for (const row of workersRes.data || []) {
    const { customer_id, ...rest } = row as Record<string, any>;
    workerMap.set(row.worker_id, { ...rest, client_id: customer_id } as Worker);
  }

  const contracts = (contractsRes.data || []) as Contract[];
  const clients = (clientsRes.data || []) as Client[];

  const overrideMap = new Map<string, Record<string, any>>();
  for (const row of overridesRes.data || []) {
    overrideMap.set(row.abbr, row.patch || {});
  }

  const recipientsById = new Map<string, ServiceRecipient>();
  const engagementsById = new Map<string, ServiceEngagement>();
  if (engagementIds.length > 0) {
    const [recipientsRes, engagementsRes] = await Promise.all([
      supabase.from('service_recipients').select('*'),
      supabase.from('service_engagements').select('*').in('service_engagement_id', engagementIds),
    ]);
    if (recipientsRes.error) throw new Error(sanitizeDbError(recipientsRes.error));
    if (engagementsRes.error) throw new Error(sanitizeDbError(engagementsRes.error));
    // Some rows predate the recording_consent column and read back null —
    // default them the same way app/api/service-recipients/route.ts does.
    for (const r of recipientsRes.data || []) {
      recipientsById.set(r.service_recipient_id, {
        ...r,
        recording_consent: r.recording_consent || { in_app_video: 'opt-in', in_app_audio: 'opt-in', dash_cam_video: 'opt-in' },
      } as ServiceRecipient);
    }
    for (const e of engagementsRes.data || []) {
      engagementsById.set(e.service_engagement_id, e as ServiceEngagement);
    }
  }

  const allRecipients = Array.from(recipientsById.values());
  const evaluatedAt = new Date().toISOString();

  return items.map((item): EvaluateResultItem => {
    const worker = workerMap.get(item.worker_id);
    if (!worker) {
      return {
        worker_id: item.worker_id,
        client_id: item.client_id,
        state: item.state,
        service_engagement_id: item.service_engagement_id,
        bgc: null,
        privacy: null,
        regulationOverrideApplied: null,
        decisionTraces: [],
        error: 'worker not found',
      };
    }

    // ActivitySchema lookup (lib/ontology/activitySchemas.ts): which
    // requirement categories actually apply to this item's activity type.
    // Only meaningful when a service_engagement_id was given — without one,
    // there's no activity instance to derive a schema from, so every
    // category applies (same behavior as before this registry existed).
    const engagement = item.service_engagement_id ? engagementsById.get(item.service_engagement_id) : undefined;
    const applicableCategories = getApplicableRequirementCategories(engagement?.service_engagement_type);

    const overridePatch = overrideMap.get(item.state);
    const bgc = applicableCategories.includes('background_check')
      ? evaluateBgcCompliance(worker, {
          state: item.state,
          clientId: item.client_id,
          contracts,
          driverReqOverride: overridePatch,
        })
      : null;

    let privacy: EvaluatePrivacyResult | null = null;
    if (engagement && applicableCategories.includes('recording_consent')) {
      const client = clients.find((c) => c.client_id === engagement.client_id);
      const linkedRecipients = engagement.linked_service_recipient_ids
        .map((id) => recipientsById.get(id))
        .filter((r): r is ServiceRecipient => !!r);
      const nonCompliantServiceRecipientIds = linkedRecipients
        .filter((r) => recipientOptedOutOfEngagement(r, engagement.recording_technologies))
        .map((r) => r.service_recipient_id);

      privacy = {
        status: serviceEngagementPrivacyStatus(engagement, allRecipients, clients),
        controllingClientPolicy: client?.video_consent_policy ?? null,
        nonCompliantServiceRecipientIds,
      };
    }

    const decisionTraces: DecisionTrace[] = [
      ...(bgc ? [buildBgcDecisionTrace(item, bgc, evaluatedAt)] : []),
      ...(privacy ? [buildPrivacyDecisionTrace(item, privacy, evaluatedAt)] : []),
    ];

    return {
      worker_id: item.worker_id,
      client_id: item.client_id,
      state: item.state,
      service_engagement_id: item.service_engagement_id,
      bgc,
      privacy,
      regulationOverrideApplied: overridePatch ? { table_name: 'driver-req', abbr: item.state } : null,
      decisionTraces,
    };
  });
}
