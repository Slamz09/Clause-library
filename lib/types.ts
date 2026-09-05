export interface Entity {
  entity_id: string;
  name: string;
  state?: string;
  parent_entity_id?: string;
  formation_date?: string;
  entity_subtype?: string;
  risk_score?: number;
  description?: string;
}

export interface Asset {
  asset_id: string;
  name: string;
  asset_type?: string;
  entity_id?: string;
  ownership_type?: string;
  risk_score?: number;
}

export interface Event {
  event_id: string;
  entity_id?: string;
  asset_id?: string;
  event_type: string;
  event_date?: string;
  status: 'open' | 'in_progress' | 'resolved' | 'dismissed';
  severity?: 'low' | 'medium' | 'high' | 'critical';
  notes?: string;
  created_at?: string;
  entity?: Entity;
  asset?: Asset;
}

export interface Obligation {
  obligation_id: string;
  document_id?: string;
  entity_id?: string;
  asset_id?: string;
  obligation_type?: string;
  normalized_summary?: string;
  trigger_type?: string;
  trigger_scope?: 'entity' | 'asset' | 'portfolio';
  due_date?: string;
  status?: string;
  severity?: string;
  confidence?: string;
  document_section_reference?: string;
}

export interface GoalImpact {
  portfolioGoal: string;
  entityGoal: string;
  mechanism: string;
}

export interface PropagationNode {
  id: string;
  name: string;
  type: 'entity' | 'asset';
  subtype: string;
  hopDepth: number;
  isTrigger: boolean;
  severity?: string;
  activeEvents: number;
  estimatedExposure: string | null;
  portfolioRisk: boolean;
  entityRisk: boolean;
  goalImpact: GoalImpact | null;
}

export interface PropagationEdge {
  id: string;
  source: string;
  target: string;
  edgeType: string;
  label: string;
  isActive: boolean;
}

export interface PropagationGraph {
  nodes: PropagationNode[];
  edges: PropagationEdge[];
}

export interface ImpactSummary {
  eventTitle: string;
  whatHappened: string;
  whyItMatters: string;
  recommendedActions: string[];
  directImpactCount: number;
  potentialImpactCount: number;
  propagationDepth: number;
  estimatedExposure: string;
  severity: string;
  status: string;
  matchedObligations: Obligation[];
  goalHierarchy: {
    portfolioGoal: string;
    entityGoal: string;
    propagationMechanism: string;
    portfolioExposureEstimate: string;
    entityExposureEstimate: string;
  } | null;
}

// ── Risk foundation types ──────────────────────────────────────────────────────

export type RiskObjectType = 'obligation' | 'entity' | 'asset';

export type RiskBand = 'low' | 'moderate' | 'high' | 'critical';

export interface RiskFactorContribution {
  id?: string;
  factor_key: string;
  factor_label: string;
  raw_value: number;
  weighted_value: number;
  severity: RiskBand;
  metadata: Record<string, any>;
}

export interface TriggerEventRecord {
  id: string;
  event_type: string;
  severity: RiskBand;
  status: 'active' | 'resolved';
  source_object_type: RiskObjectType;
  source_object_id: string;
  target_object_type: RiskObjectType;
  target_object_id: string;
  title: string;
  description: string;
  metadata: Record<string, any>;
  occurred_at: string;
  resolved_at?: string | null;
}

export interface LinkedRiskSource {
  object_type: RiskObjectType;
  object_id: string;
  label: string;
  relationship: string;
}

export interface DirectExposureObject {
  object_type: RiskObjectType;
  object_id: string;
  label: string;
  relationship: string;
  impact_level: 'direct' | 'downstream';
}

export interface RiskAssessmentRecord {
  id: string;
  object_type: RiskObjectType;
  object_id: string;
  score_total: number;
  score_band: RiskBand;
  score_version: string;
  explanation_summary: string;
  inputs_snapshot: Record<string, any>;
  assessed_at: string;
  factor_contributions?: RiskFactorContribution[];
  active_triggers?: TriggerEventRecord[];
  linked_risk_sources?: LinkedRiskSource[];
  direct_exposure_objects?: DirectExposureObject[];
  explanation_chain?: string[];
  propagated_impacts?: [];
  propagation_status?: 'not_enabled';
}

export interface PortfolioRiskSummary {
  portfolio_score: number;
  portfolio_band: RiskBand;
  score_version: string;
  assessed_at: string;
  band_distribution: { low: number; moderate: number; high: number; critical: number };
  top_entities: Array<{ entity_id: string; name: string; risk_score: number; risk_band: RiskBand }>;
  top_assets: Array<{ asset_id: string; name: string; risk_score: number; risk_band: RiskBand }>;
  active_source_count: number;
  impacted_entity_count: number;
  impacted_asset_count: number;
  active_trigger_count: number;
}
