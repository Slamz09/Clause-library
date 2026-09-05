// ─── Ontology type aliases ──────────────────────────────────────────────────
// Documents which real domain type implements each concept in docs/ontology.md.
// Pure aliases — no new runtime behavior. This file exists so future work
// names the semantic relationships Consola already operates on instead of
// re-deriving (or worse, re-inventing) them per call site. See docs/ontology.md
// for the full concept-to-code mapping, including the concepts with no
// implementation yet (Evidence, Credential, Jurisdiction as a shared type,
// Decision/DecisionTrace as structured rows).
//
// Deliberately NOT a parallel type system: every alias here points at a type
// already exported from lib/mockData.ts or lib/db (the live domain layer),
// the way lib/db/types.ts's unwired workspace/UUID model does not.

import type {
  Client,
  Worker,
  ServiceRecipient,
  ServiceProvider,
  ServiceEngagement,
  Contract,
} from '@/lib/mockData';

// ── Entity ───────────────────────────────────────────────────────────────
export type OrganizationClient = Client;
export type OrganizationServiceProvider = ServiceProvider;
export type PersonWorker = Worker;
export type PersonServiceRecipient = ServiceRecipient;
export type DocumentContract = Contract;

// ── Activity ─────────────────────────────────────────────────────────────
// service_engagements already IS the ontology's ActivityInstance — this
// alias makes that explicit rather than leaving it implicit.
export type ActivityInstance = ServiceEngagement;

// ActivitySchema has no live table yet — see lib/ontology/activitySchemas.ts
// for the Phase 1 static registry that stands in for it.
export type ActivitySchemaId = ServiceEngagement['service_engagement_type'];

// ── Requirement ──────────────────────────────────────────────────────────
// LegalRequirement and PolicyRequirement are PARTIAL (static data modules,
// not typed domain objects) — see docs/ontology.md §1/§3. ContractualObligation
// exists today as structured fields on Contract (bgc_interval_months,
// bgc_requirement_types, recording_rule) rather than as its own type; the
// full ContractualObligation shape (sourceDocument/sourceDocumentType/
// sourceSystem/imposedBy/appliesTo) described in docs/ontology.md §3 is
// Phase 2 work, pending the `obligations` table audit.
export type ContractualObligationSource = Pick<
  Contract,
  'contract_id' | 'bgc_interval_months' | 'bgc_requirement_types' | 'recording_rule'
>;

// ── Rule / Standard ──────────────────────────────────────────────────────
// Which authority governs a given verdict. Used by lib/bgcCompliance.ts
// (BgcComplianceResult.controllingStandard) and persisted on decision_traces
// (scripts/add-decision-traces.sql).
export type ControllingStandard = 'legal' | 'contract' | 'policy';

// How two requirements from different authorities relate to each other —
// the ontology's RequirementRelationship (docs/ontology.md §1). Only the
// values lib/bgcCompliance.ts's evaluateBgcCompliance actually derives today
// are included; 'duplicates' / 'incompatibleWith' etc. from the original
// spec aren't computed anywhere yet and are intentionally left out rather
// than declared unused.
export type RequirementRelationship = 'satisfies' | 'supplements' | 'moreRestrictiveThan' | 'conflicts';

// ── Decision / DecisionTrace ─────────────────────────────────────────────
// Structured companion to compliance_evaluation_log's opaque results JSONB
// (docs/ontology.md §5). One DecisionTrace per requirement category
// evaluated for one worker×client×state(+engagement) item; persisted to
// decision_traces by app/api/compliance/evaluate/route.ts.
export interface DecisionTraceStandardResult {
  authority: ControllingStandard;
  status: 'compliant' | 'non-compliant' | 'not-applicable';
  citation: string | null;
  interval_months: number | null;
  due_date: string | null;
}

export interface DecisionTrace {
  worker_id: string;
  client_id: string;
  state: string;
  service_engagement_id: string | null;
  requirement_category: 'background_check' | 'recording_consent' | 'insurance';
  standards: DecisionTraceStandardResult[];
  controlling_standard: ControllingStandard | null;
  relationship: RequirementRelationship | null;
  result: 'compliant' | 'non-compliant';
  evaluated_at: string;
}
