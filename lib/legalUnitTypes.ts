export const STRUCTURAL_LABELS = [
  'obligation',
  'prohibition',
  'condition',
  'exception',
  'qualifier',
  'representation',
  'warranty',
  'acknowledgement',
  'definition',
  'statement',
  'remedy',
  'permission',
  'list_item',
] as const;

export const TOPIC_LABELS = [
  'payment',
  'confidentiality',
  'privacy',
  'security',
  'indemnity',
  'limitation_of_liability',
  'warranty',
  'audit',
  'insurance',
  'term_termination',
  'notices',
  'ip',
  'assignment',
  'subcontracting',
  'compliance_with_laws',
  'records_retention',
  'data_return_deletion',
  'background_check',
] as const;

export const OBLIGATION_KINDS = [
  'duty',
  'prohibition',
  'right',
  'condition',
  'definition',
  'representation',
  'warranty',
] as const;

export type StructuralLabel = (typeof STRUCTURAL_LABELS)[number];
export type TopicLabel = (typeof TOPIC_LABELS)[number];
export type ObligationKind = (typeof OBLIGATION_KINDS)[number];

export interface ClauseUnitRecord {
  clause_unit_id: string;
  clause_id: string;
  document_id: string;
  unit_index: number;
  parent_unit_id: string | null;
  unit_text: string;
  unit_text_normalized: string | null;
  structural_labels: StructuralLabel[];
  topic_labels: TopicLabel[];
  actor: string | null;
  beneficiary: string | null;
  defined_term: string | null;
  definition_type: string | null;
  trigger_text: string | null;
  action_text: string | null;
  object_text: string | null;
  qualifier_text: string | null;
  exception_text: string | null;
  deadline_text: string | null;
  frequency_text: string | null;
  source_page: number | null;
  char_start: number | null;
  char_end: number | null;
  extraction_method: string;
  extraction_confidence: number | null;
  structure_confidence: number | null;
  topic_confidence: number | null;
  needs_review: boolean;
  review_reason: string | null;
  created_at: string;
}

export interface ObligationRecord {
  obligation_id: string;
  clause_unit_id: string | null;
  clause_id: string;
  document_id: string;
  obligation_kind: ObligationKind;
  actor: string | null;
  beneficiary: string | null;
  action_text: string;
  object_text: string | null;
  trigger_text: string | null;
  deadline_text: string | null;
  frequency_text: string | null;
  qualifier_text: string | null;
  exception_text: string | null;
  topic_labels: TopicLabel[];
  canonical_clause_type: string | null;
  is_conditional: boolean;
  condition_text: string | null;
  monetary_amount: number | null;
  monetary_currency: string;
  time_period_days: number | null;
  evidence_hint: string | null;
  monitor_flag: boolean;
  needs_review: boolean;
  review_reason: string | null;
  status: 'active' | 'superseded' | 'waived';
  created_at: string;
  updated_at: string;
}

export interface LLMClauseUnit {
  unit_index: number;
  unit_text: string;
  structural_labels: StructuralLabel[];
  topic_labels: TopicLabel[];
  actor: string | null;
  beneficiary: string | null;
  defined_term: string | null;
  definition_type: string | null;
  trigger_text: string | null;
  action_text: string | null;
  object_text: string | null;
  qualifier_text: string | null;
  exception_text: string | null;
  deadline_text: string | null;
  frequency_text: string | null;
  extraction_confidence: number | null;
}
