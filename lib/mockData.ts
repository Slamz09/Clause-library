// ─── Shared Mock Data — CONSOLA-V3 Rideshare Compliance Platform ─────────────
// Single source of truth. All new module pages import from here.
// Seed localStorage on first mount using the pattern:
//   if (!localStorage.getItem(LS_KEY)) localStorage.setItem(LS_KEY, JSON.stringify(EXPORT));

// ─── Types ────────────────────────────────────────────────────────────────────

import type { BgcTypeRequirement } from './bgcTypeOptions';

export interface Client {
  client_id: string;
  client_name: string;
  city?: string;
  state: string;
  region: string;
  contracts_active: number;
  contracts_expired: number;
  contracts_approaching: number;
  // Split into independent consent axes (app/in-app video, dash cam video,
  // audio recording, AI use) rather than one blanket "video consent" flag —
  // mirrors the per-technology granularity service_recipients.recording_consent
  // already has (RECORDING_TECHNOLOGIES below), since a contract can set a
  // different policy for the rider-facing in-app camera than for a
  // vehicle-mounted dash cam. null/undefined means "unknown", not opt-out:
  // it's set explicitly via 1) manual edit (Edit form), 2) CSV import (only
  // when the sheet includes that column), or 3) the clause extraction
  // pipeline detecting it in an uploaded contract (see
  // app/api/documents/classify-clauses's consent backfill) — never defaulted,
  // so an unreviewed client is never silently marked opt-out.
  video_consent_policy: 'opt-in' | 'opt-out' | null; // in-app/rider-facing video recording
  dash_cam_video_consent_policy?: 'opt-in' | 'opt-out' | null;
  audio_consent_policy?: 'opt-in' | 'opt-out' | null;
  ai_use_consent_policy?: 'opt-in' | 'opt-out' | null;
  total_service_engagements_count: number;
  incidents: number;
  complaints: number;
  driver_compliance_issues: number;
  insurance_policy_id: string;
  insurance_coverage: string;
  additional_insured: boolean;
  prohibition_on_data_sharing: boolean;
  compliance_flags: { insurance: boolean; privacy: boolean; driver: boolean };
  // Structured BGC screening-method requirement (Name Search / Fingerprinting,
  // each with State/Federal jurisdiction) — see lib/bgcTypeOptions.ts. Distinct
  // from Worker.bgc_type (free-text description of a screening actually performed).
  bgc_requirement_types?: BgcTypeRequirement[];
}

// Replaces the old `Driver` entity — generalized to any person performing
// work on behalf of a service provider (Driver, Nurse, Caregiver, Security
// Guard, Technician, Inspector, Interpreter, ...). The BGC/background-check
// fields below were merged in from the retired `drivers` table — they're
// only meaningful when worker_type === 'Driver' (or another screened role),
// left blank/undefined otherwise. See lib/bgcCompliance.ts for how the BGC
// fields drive the compliance-cadence engine.
export interface Worker {
  worker_id: string;
  service_provider_id?: string;
  legal_name: string;
  display_name?: string;
  worker_type: string; // 'Driver' | 'Nurse' | 'Caregiver' | 'Security Guard' | 'Technician' | 'Inspector' | 'Interpreter' | ... (open taxonomy)
  relationship_type: string; // 'Employee' | '1099 Contractor' | 'Volunteer' | 'Subcontractor' | 'Temporary Worker'
  status: 'Active' | 'Inactive' | 'Suspended';
  contact_email?: string;
  phone?: string;
  city?: string;
  state?: string;
  qualifications?: Record<string, unknown>;
  compliance_status?: 'Pending' | 'Compliant' | 'Expired' | 'Non-Compliant';
  notes?: string;
  created_at?: string;
  // ── Merged from the retired `drivers` table (only populated for worker_type === 'Driver') ──
  start_date?: string;
  bgc_status?: 'complete' | 'expiring_soon' | 'missing';
  bgc_type?: string;
  first_bgc_date?: string;
  last_bgc_date?: string;
  bgc_duration?: string;
  assigned_service_engagements_count?: number;
  linked_incidents?: string[];
  linked_complaints?: string[];
  client_id?: string;
  // Manual "Clients Serviced" links (client_id[] from public.clients) — a
  // supplement to the service-engagement-derived client list. Feeds
  // per-obligation worker applicability.
  clients_serviced?: string[];
  // Structured BGC screening-method requirement, including specific states —
  // the only table where the `states` field on each entry is populated.
  bgc_requirement_types?: BgcTypeRequirement[];
}

// Per-technology recording consent — a recipient can opt out of one
// recording technology while staying opted in to another (e.g. opt out of
// in-app video but remain opted in to dash cam video, which then may still
// legally record them even though in-app recording must stay disabled for
// them specifically).
export interface RecordingConsent {
  in_app_video: 'opt-in' | 'opt-out';
  in_app_audio: 'opt-in' | 'opt-out';
  dash_cam_video: 'opt-in' | 'opt-out';
}

export const RECORDING_TECHNOLOGIES: { key: keyof RecordingConsent; label: string }[] = [
  { key: 'in_app_video', label: 'In-App Video' },
  { key: 'in_app_audio', label: 'In-App Audio' },
  { key: 'dash_cam_video', label: 'Dash Cam (Video)' },
];

/** True if the recipient has opted out of at least one recording technology. */
export function hasAnyRecordingOptOut(consent: RecordingConsent): boolean {
  return RECORDING_TECHNOLOGIES.some(({ key }) => consent[key] === 'opt-out');
}

export interface ServiceRecipient {
  service_recipient_id: string;
  client_id: string;
  client_name: string;
  recipient_type: string; // 'Rider / Student' | 'Patient' | 'Patient / Member' | 'Building occupant / Visitor' | 'Customer / Resident' | 'Property owner' | 'Customer site contact' | ... (open taxonomy, varies by industry)
  first_name: string;
  last_name: string;
  jurisdiction?: string;
  privacy_preferences?: string;
  recording_consent: RecordingConsent;
  special_requirements?: string;
  linked_service_engagement_ids: string[];
}

// Replaces the old `Vendor` entity. tax_status was removed — relationship_type
// on Worker (Employee / 1099 Contractor / Volunteer / Subcontractor /
// Temporary Worker) supersedes it at the individual-worker level.
export interface ServiceProvider {
  service_provider_id: string;
  legal_name: string;
  display_name?: string;
  entity_type: string; // 'Organization' | 'Government Entity' | 'Nonprofit Organization' | 'Sole Proprietorship'
  provider_type?: string; // category:service_type slug — see lib/vendorTypes.ts
  status: 'active' | 'inactive';
  contact_name?: string;
  contact_email?: string;
  phone?: string;
  website?: string;
  state?: string;
  capabilities?: Record<string, unknown>;
  notes?: string;
  created_at?: string;
  // client_id[] this provider is manually linked to via the "Clients
  // Serviced" column — entered by picking from existing clients only, never
  // freeform (see components/ui/ClientMultiSelect.tsx).
  clients_serviced?: string[];
}

export interface ServiceEngagement {
  service_engagement_id: string;
  date: string;
  service_engagement_type: 'Single' | 'Pooled';
  worker_id: string;
  client_name: string;
  client_id: string;
  state: string;
  city: string;
  video_recorded: boolean;
  // Which specific recording technologies were actually active during this
  // engagement (subset of RecordingConsent keys — 'in_app_video' |
  // 'in_app_audio' | 'dash_cam_video'). Lets compliance checks respect a
  // recipient's per-technology consent instead of treating video_recorded
  // as one all-or-nothing flag. Empty/undefined on legacy rows — treated as
  // unknown technology, so compliance falls back to flagging on ANY opt-out.
  recording_technologies?: string[];
  linked_service_recipient_ids: string[];
  linked_safety_incidents: string[];
  linked_complaints: string[];
  vendor_id?: string;
  vendor_name?: string;
}

export interface Incident {
  incident_id: string;
  type: 'accident' | 'arrest' | 'other';
  severity: 'low' | 'medium' | 'high';
  date: string;
  street_address?: string;
  city: string;
  state: string;
  linked_worker_id: string;
  linked_service_recipient_ids: string[];
  linked_client_id: string;
  linked_service_engagement_id: string;
}

export interface Complaint {
  complaint_id: string;
  type: 'pre-litigation' | 'litigation';
  disputing_party: string[];
  state: string;
  city: string;
  client_ids: string[];
  linked_service_engagement_ids: string[];
  linked_worker_ids: string[];
  status: 'Active' | 'Resolved' | 'Pending';
}

export interface Contract {
  contract_id: string;
  governing_law: string;
  linked_client_id: string;
  linked_client_name?: string;
  paper_source: 'counter_party' | 'internal' | 'Company Paper' | 'Client Paper'; // legacy values kept for existing data
  effective_date: string;
  expiration_date: string;
  extracted_obligations: string;
  privacy_requirements: string;
  client_specific_bgc_requirements: string;
  bgc_interval_months: number | null;
  // Set by classify-clauses's contract-level backfill from this contract's
  // OWN extracted clauses (see RecordingRuleBadge in app/(app)/documents/page.tsx):
  // 'opt-in'/'opt-out' when a Recording Consent Clause with a determinable
  // policy was found, 'missing' when parsed but no such language was found,
  // null/undefined when not yet parsed.
  recording_rule?: 'opt-in' | 'opt-out' | 'missing' | null;
  contract_type?: string;
  document_id?: string;
  contract_facing?: 'client' | 'vendor';
  linked_vendor_id?: string;
  linked_vendor_name?: string;
  counterparty_type?: string;
  // Structured BGC screening-method requirement (Name Search / Fingerprinting,
  // each with State/Federal jurisdiction) — see lib/bgcTypeOptions.ts.
  bgc_requirement_types?: BgcTypeRequirement[];
}

export interface InsurancePolicy {
  policy_id: string;
  coverage_type: string;
  coverage_amount: string;
  additional_insureds: string;
  cancellation_notice: string;
  linked_clients: string[];
  linked_contracts: string[];
  claims_count: number;
  linked_workers: string[];
}

export interface Clause {
  clause_id: string;
  contract_id: string;
  type: string;
  summary: string;
  compliance_status: 'compliant' | 'non_compliant' | 'review_needed';
}

export interface RegulatoryEntry {
  state: string;
  privacy_laws: string;
  contractor_laws: string;
  transport_rules: string;
  ai_laws: string;
  bgc_requirements: string;
  permit_requirements: string;
}

// ─── Clients ────────────────────────────────────────────────────────────────

export const CLIENTS: Client[] = [
  {
    client_id: 'CLI-001',
    client_name: 'Riverdale Unified School District',
    city: 'Los Angeles',
    state: 'CA',
    region: 'West',
    contracts_active: 1,
    contracts_expired: 0,
    contracts_approaching: 0,
    video_consent_policy: 'opt-in',
    total_service_engagements_count: 3,
    incidents: 1,
    complaints: 1,
    driver_compliance_issues: 1,
    insurance_policy_id: 'INS-001',
    insurance_coverage: '$1M per occurrence / $3M aggregate',
    additional_insured: true,
    prohibition_on_data_sharing: true,
    compliance_flags: { insurance: false, privacy: true, driver: true },
  },
  {
    client_id: 'CLI-002',
    client_name: 'Metro Transit Authority',
    city: 'Houston',
    state: 'TX',
    region: 'South',
    contracts_active: 0,
    contracts_expired: 1,
    contracts_approaching: 0,
    video_consent_policy: 'opt-in',
    total_service_engagements_count: 2,
    incidents: 1,
    complaints: 1,
    driver_compliance_issues: 1,
    insurance_policy_id: 'INS-002',
    insurance_coverage: '$500K per occurrence / $1M aggregate',
    additional_insured: false,
    prohibition_on_data_sharing: false,
    compliance_flags: { insurance: true, privacy: true, driver: true },
  },
  {
    client_id: 'CLI-003',
    client_name: 'Lakewood Youth Services',
    city: 'Miami',
    state: 'FL',
    region: 'Southeast',
    contracts_active: 0,
    contracts_expired: 0,
    contracts_approaching: 1,
    video_consent_policy: 'opt-in',
    total_service_engagements_count: 1,
    incidents: 0,
    complaints: 0,
    driver_compliance_issues: 0,
    insurance_policy_id: 'INS-001',
    insurance_coverage: '$1M per occurrence / $3M aggregate',
    additional_insured: true,
    prohibition_on_data_sharing: true,
    compliance_flags: { insurance: false, privacy: false, driver: false },
  },
];

// ─── Workers ──────────────────────────────────────────────────────────────────
// Migrated from the retired `drivers` table — all worker_type: 'Driver' today
// since that was the only role tracked previously. relationship_type is
// mapped from the old tax_status field ('1099 IC' -> '1099 Contractor',
// 'Business' -> 'Subcontractor', 'Employee' -> 'Employee').

export const WORKERS: Worker[] = [
  {
    worker_id: 'W-001',
    legal_name: 'Worker W-001', // no name was tracked on the legacy drivers table
    worker_type: 'Driver',
    relationship_type: 'Employee',
    status: 'Active',
    start_date: '2022-03-15',
    bgc_status: 'complete',
    bgc_type: 'State Criminal + MVR',
    first_bgc_date: '2022-03-15',
    last_bgc_date: '2026-03-18',
    bgc_duration: 'Annual',
    assigned_service_engagements_count: 2,
    linked_incidents: ['INC-001'],
    linked_complaints: ['CMP-001'],
    client_id: 'CLI-001',
    state: 'CA',
  },
  {
    worker_id: 'W-002',
    legal_name: 'Worker W-002',
    worker_type: 'Driver',
    relationship_type: 'Employee',
    status: 'Active',
    start_date: '2021-07-01',
    bgc_status: 'missing',
    bgc_type: 'State Criminal + MVR',
    first_bgc_date: '2021-07-01',
    last_bgc_date: '2023-07-01',
    bgc_duration: 'Annual',
    assigned_service_engagements_count: 1,
    linked_incidents: [],
    linked_complaints: [],
    client_id: 'CLI-001',
    state: 'CA',
  },
  {
    worker_id: 'W-003',
    legal_name: 'Worker W-003',
    worker_type: 'Driver',
    relationship_type: 'Employee',
    status: 'Active',
    start_date: '2023-11-20',
    bgc_status: 'missing',
    bgc_type: '—',
    first_bgc_date: '—',
    last_bgc_date: '—',
    bgc_duration: '—',
    assigned_service_engagements_count: 2,
    linked_incidents: ['INC-002'],
    linked_complaints: ['CMP-002'],
    client_id: 'CLI-002',
    state: 'TX',
  },
  {
    worker_id: 'W-004',
    legal_name: 'Worker W-004',
    worker_type: 'Driver',
    relationship_type: 'Employee',
    status: 'Active',
    start_date: '2023-05-10',
    bgc_status: 'complete',
    bgc_type: 'State Criminal + MVR + Sex Offender',
    first_bgc_date: '2023-08-01',
    last_bgc_date: '2025-08-05',
    bgc_duration: 'Annual',
    assigned_service_engagements_count: 1,
    linked_incidents: [],
    linked_complaints: [],
    client_id: 'CLI-003',
    state: 'NY',
  },
  {
    worker_id: 'W-005',
    legal_name: 'Worker W-005',
    worker_type: 'Driver',
    relationship_type: 'Employee',
    status: 'Active',
    start_date: '2019-12-01',
    bgc_status: 'missing',
    bgc_type: 'Criminal + Sex Offender + MVR',
    first_bgc_date: '2020-01-01',
    last_bgc_date: '2020-01-01',
    bgc_duration: 'Annual',
    assigned_service_engagements_count: 1,
    linked_incidents: [],
    linked_complaints: [],
    client_id: 'CLI-003',
    state: 'FL',
  },
];

// ─── Service Providers ──────────────────────────────────────────────────────

export const SERVICE_PROVIDERS: ServiceProvider[] = [
  { service_provider_id: 'SP-001', legal_name: 'Sunbelt Fleet Partners', entity_type: 'Organization', state: 'TX', contact_name: 'Dana Ruiz', status: 'active' },
  { service_provider_id: 'SP-002', legal_name: 'Coastal Mobility Group', entity_type: 'Organization', state: 'FL', contact_name: 'Marcus Lee', status: 'active' },
];

// ─── Service Recipients ─────────────────────────────────────────────────────

export const SERVICE_RECIPIENTS: ServiceRecipient[] = [
  {
    service_recipient_id: 'SR-001',
    recording_consent: { in_app_video: 'opt-in', in_app_audio: 'opt-in', dash_cam_video: 'opt-in' },
    linked_service_engagement_ids: ['SE-001'],
    client_id: 'CLI-001',
    client_name: 'Riverdale Unified School District',
    recipient_type: 'Rider / Student',
    first_name: 'Ava',
    last_name: 'Martinez',
  },
  {
    service_recipient_id: 'SR-002',
    // Opted out of in-app video/audio, but still opted in to dash cam —
    // dash-cam-only recording of this recipient remains compliant even
    // though in-app recording must stay disabled for them specifically.
    recording_consent: { in_app_video: 'opt-out', in_app_audio: 'opt-out', dash_cam_video: 'opt-in' },
    linked_service_engagement_ids: ['SE-002'],
    client_id: 'CLI-001',
    client_name: 'Riverdale Unified School District',
    recipient_type: 'Rider / Student',
    first_name: 'Liam',
    last_name: 'Chen',
  },
  {
    service_recipient_id: 'SR-003',
    recording_consent: { in_app_video: 'opt-out', in_app_audio: 'opt-out', dash_cam_video: 'opt-out' },
    linked_service_engagement_ids: ['SE-003', 'SE-004'],
    client_id: 'CLI-002',
    client_name: 'Metro Transit Authority',
    recipient_type: 'Rider / Student',
    first_name: 'Noah',
    last_name: 'Patel',
  },
  {
    service_recipient_id: 'SR-004',
    recording_consent: { in_app_video: 'opt-in', in_app_audio: 'opt-in', dash_cam_video: 'opt-in' },
    linked_service_engagement_ids: ['SE-005'],
    client_id: 'CLI-003',
    client_name: 'Lakewood Youth Services',
    recipient_type: 'Rider / Student',
    first_name: 'Sophia',
    last_name: 'Nguyen',
  },
];

// ─── Service Engagements ────────────────────────────────────────────────────
// Privacy compliance is computed at render time — not stored.
// NON-COMPLIANT if:
//   (1) the service engagement's client has video_consent_policy === 'opt-out' && video_recorded === true
//   (2) video_recorded === true && any linked service recipient has consent_status === 'opt-out'

export const SERVICE_ENGAGEMENTS: ServiceEngagement[] = [
  {
    // COMPLIANT: client opted in, recorded=yes, service recipient SR-001 opted in
    service_engagement_id: 'SE-001',
    date: '2025-11-04',
    service_engagement_type: 'Single',
    worker_id: 'W-001',
    client_name: 'Riverdale Unified School District',
    client_id: 'CLI-001',
    state: 'CA',
    city: 'Los Angeles',
    video_recorded: true,
    linked_service_recipient_ids: ['SR-001'],
    linked_safety_incidents: ['INC-001'],
    linked_complaints: [],
  },
  {
    // NON-COMPLIANT: client opted out, recorded=yes (violation #1)
    service_engagement_id: 'SE-002',
    date: '2025-11-10',
    service_engagement_type: 'Single',
    worker_id: 'W-002',
    client_name: 'Riverdale Unified School District',
    client_id: 'CLI-001',
    state: 'CA',
    city: 'San Francisco',
    video_recorded: true,
    linked_service_recipient_ids: ['SR-002'],
    linked_safety_incidents: [],
    linked_complaints: ['CMP-001'],
  },
  {
    // NON-COMPLIANT: client opted in, recorded=yes, but SR-003 opted out (violation #2)
    service_engagement_id: 'SE-003',
    date: '2025-12-01',
    service_engagement_type: 'Pooled',
    worker_id: 'W-003',
    client_name: 'Metro Transit Authority',
    client_id: 'CLI-002',
    state: 'TX',
    city: 'Houston',
    video_recorded: true,
    linked_service_recipient_ids: ['SR-003'],
    linked_safety_incidents: ['INC-002'],
    linked_complaints: ['CMP-002'],
  },
  {
    // COMPLIANT: recorded=no
    service_engagement_id: 'SE-004',
    date: '2025-12-05',
    service_engagement_type: 'Single',
    worker_id: 'W-003',
    client_name: 'Metro Transit Authority',
    client_id: 'CLI-002',
    state: 'TX',
    city: 'Dallas',
    video_recorded: false,
    linked_service_recipient_ids: ['SR-003'],
    linked_safety_incidents: [],
    linked_complaints: [],
  },
  {
    // COMPLIANT: client opted in, recorded=yes, service recipient SR-004 opted in
    service_engagement_id: 'SE-005',
    date: '2026-01-15',
    service_engagement_type: 'Single',
    worker_id: 'W-004',
    client_name: 'Lakewood Youth Services',
    client_id: 'CLI-003',
    state: 'FL',
    city: 'Orlando',
    video_recorded: true,
    linked_service_recipient_ids: ['SR-004'],
    linked_safety_incidents: [],
    linked_complaints: [],
  },
  {
    // BGC GAP: W-005 last checked 2020-01-01 — overdue against both FL legal (5yr) and CNT-003 contract (12mo)
    service_engagement_id: 'SE-006',
    date: '2026-05-01',
    service_engagement_type: 'Single',
    worker_id: 'W-005',
    client_name: 'Lakewood Youth Services',
    client_id: 'CLI-003',
    state: 'FL',
    city: 'Orlando',
    video_recorded: true,
    linked_service_recipient_ids: ['SR-004'],
    linked_safety_incidents: [],
    linked_complaints: [],
  },
];

// ─── Incidents ────────────────────────────────────────────────────────────────

export const INCIDENTS: Incident[] = [
  {
    incident_id: 'INC-001',
    type: 'accident',
    severity: 'high',
    date: '2025-11-04',
    state: 'CA',
    city: 'Los Angeles',
    linked_worker_id: 'W-001',
    linked_service_recipient_ids: ['SR-001'],
    linked_client_id: 'CLI-001',
    linked_service_engagement_id: 'SE-001',
  },
  {
    incident_id: 'INC-002',
    type: 'arrest',
    severity: 'high',
    date: '2025-12-01',
    state: 'TX',
    city: 'Houston',
    linked_worker_id: 'W-003',
    linked_service_recipient_ids: ['SR-003'],
    linked_client_id: 'CLI-002',
    linked_service_engagement_id: 'SE-003',
  },
];

// ─── Complaints ───────────────────────────────────────────────────────────────

export const COMPLAINTS: Complaint[] = [
  {
    complaint_id: 'CMP-001',
    type: 'litigation',
    disputing_party: ['service recipient', 'service recipient legal guardian'],
    state: 'CA',
    city: 'Los Angeles',
    client_ids: ['CLI-001'],
    linked_service_engagement_ids: ['SE-002'],
    linked_worker_ids: ['W-002'],
    status: 'Active',
  },
  {
    complaint_id: 'CMP-002',
    type: 'pre-litigation',
    disputing_party: ['driver'],
    state: 'TX',
    city: 'Houston',
    client_ids: ['CLI-002'],
    linked_service_engagement_ids: ['SE-003'],
    linked_worker_ids: ['W-003'],
    status: 'Pending',
  },
];

// ─── Contracts ────────────────────────────────────────────────────────────────
// Status is computed from expiration_date at render time:
//   daysLeft < 0       → 'Expired'
//   daysLeft <= 90     → 'Approaching Expiration'
//   else               → 'Active'
// Today ≈ 2026-07-11; CNT-003 expires 2027-05-31 (~10.5mo) → Approaching Expiration

export const CONTRACTS: Contract[] = [
  {
    contract_id: 'CNT-001',
    governing_law: 'California',
    linked_client_id: 'CLI-001',
    paper_source: 'Company Paper',
    effective_date: '2023-01-01',
    expiration_date: '2026-12-31',
    extracted_obligations: 'Recording disclosure, BGC compliance, incident reporting within 24h',
    privacy_requirements: 'Video consent required; opt-out must be honored; no data sharing outside USA',
    client_specific_bgc_requirements: 'Annual State Criminal + MVR; fingerprint BGC per CPUC',
    bgc_interval_months: 12,
  },
  {
    contract_id: 'CNT-002',
    governing_law: 'Texas',
    linked_client_id: 'CLI-002',
    paper_source: 'Client Paper',
    effective_date: '2022-06-01',
    expiration_date: '2024-12-31',
    extracted_obligations: 'Permit compliance, safety reporting, insurance maintenance',
    privacy_requirements: 'TDPSA opt-out compliance; no biometric data collection',
    client_specific_bgc_requirements: 'Criminal BGC + MVR; annual refresh',
    bgc_interval_months: 12,
  },
  {
    contract_id: 'CNT-003',
    governing_law: 'Florida',
    linked_client_id: 'CLI-003',
    paper_source: 'Company Paper',
    effective_date: '2024-01-01',
    expiration_date: '2027-05-31',
    extracted_obligations: 'FDOT permit maintenance, incident reporting, insurance certificate',
    privacy_requirements: 'FDBR compliance; parental consent for minors; opt-out honored',
    client_specific_bgc_requirements: 'Criminal + sex offender check; annual MVR; 3-year lookback',
    bgc_interval_months: 12,
  },
];

// ─── Insurance Policies ───────────────────────────────────────────────────────

export const INSURANCE_POLICIES: InsurancePolicy[] = [
  {
    policy_id: 'INS-001',
    coverage_type: 'Commercial Auto',
    coverage_amount: '$1M per occurrence / $3M aggregate',
    additional_insureds: 'Riverdale USD, Lakewood Youth Services',
    cancellation_notice: '30 days written notice',
    linked_clients: ['CLI-001', 'CLI-003'],
    linked_contracts: ['CNT-001', 'CNT-003'],
    claims_count: 1,
    linked_workers: ['W-001', 'W-002', 'W-004'],
  },
  {
    policy_id: 'INS-002',
    coverage_type: 'Commercial Auto',
    coverage_amount: '$500K per occurrence / $1M aggregate',
    additional_insureds: '—',
    cancellation_notice: '30 days written notice',
    linked_clients: ['CLI-002'],
    linked_contracts: ['CNT-002'],
    claims_count: 0,
    linked_workers: ['W-003'],
  },
];

// ─── Clauses ──────────────────────────────────────────────────────────────────

export const CLAUSES: Clause[] = [
  {
    clause_id: 'CLS-001',
    contract_id: 'CNT-001',
    type: 'Privacy / Recording',
    summary: 'Video recording requires affirmative rider consent; opt-outs must be honored at ride initiation and system must disable recording accordingly.',
    compliance_status: 'non_compliant',
  },
  {
    clause_id: 'CLS-002',
    contract_id: 'CNT-001',
    type: 'BGC Requirements',
    summary: 'All drivers must have completed annual State Criminal + MVR background check and CPUC fingerprint BGC before first assignment.',
    compliance_status: 'non_compliant',
  },
  {
    clause_id: 'CLS-003',
    contract_id: 'CNT-002',
    type: 'Privacy / Data Use',
    summary: 'No biometric data may be collected or retained. TDPSA opt-out requests must be processed within 45 days.',
    compliance_status: 'review_needed',
  },
  {
    clause_id: 'CLS-004',
    contract_id: 'CNT-002',
    type: 'BGC Requirements',
    summary: 'Criminal background check and MVR required; annual refresh. Driver must not have DUI conviction in past 7 years.',
    compliance_status: 'non_compliant',
  },
  {
    clause_id: 'CLS-005',
    contract_id: 'CNT-003',
    type: 'Privacy / Minors',
    summary: 'Parental/guardian consent required for all riders under 18. Recordings involving minors require written consent prior to ride.',
    compliance_status: 'compliant',
  },
  {
    clause_id: 'CLS-006',
    contract_id: 'CNT-003',
    type: 'BGC Requirements',
    summary: 'Criminal background, sex offender registry check, and annual MVR required with 3-year lookback on all traffic violations.',
    compliance_status: 'compliant',
  },
];

// ─── Regulatory Matrix ────────────────────────────────────────────────────────
// Static reference data — not stored in localStorage.

export const REGULATORY_MATRIX: RegulatoryEntry[] = [
  {
    state: 'CA',
    privacy_laws: 'CCPA / CPRA — strong opt-out rights; video consent required; right to delete',
    contractor_laws: 'AB5 — strict driver classification; Prop 22 rideshare carve-out with conditions',
    transport_rules: 'CPUC Class P TNC Operating Permit required statewide',
    ai_laws: 'CCPA applies to AI profiling; SB-1047 AI safety act in force',
    bgc_requirements: 'Fingerprint BGC required by CPUC; annual MVR; 7-year lookback on criminal',
    permit_requirements: 'CPUC Class P TNC Permit; city permits vary (SF, LA)',
  },
  {
    state: 'TX',
    privacy_laws: 'Texas Data Privacy and Security Act (TDPSA) — opt-out model; 45-day response window',
    contractor_laws: 'IC-friendly; no AB5 equivalent; rideshare drivers are independent contractors',
    transport_rules: 'TxDMV permits required; city ordinances may apply in Austin, Houston',
    ai_laws: 'TDPSA covers automated decision-making; HB 4 AI transparency in consideration',
    bgc_requirements: 'Criminal BGC + MVR; no fingerprint requirement at state level; annual refresh',
    permit_requirements: 'TxDMV TNC Permit; city-level permits in Austin and Houston',
  },
  {
    state: 'FL',
    privacy_laws: 'Florida Digital Bill of Rights (FDBR) — opt-out for targeted ads; SB 262 automated profiling rules',
    contractor_laws: 'IC-friendly; 2017 rideshare law preempts local classification rules',
    transport_rules: 'FDOT TNC Registration; state law preempts local transport regulations',
    ai_laws: 'FDBR covers automated profiling; SB 262 applies to algorithmic decision systems',
    bgc_requirements: 'Criminal + sex offender registry check; annual MVR; 3-year lookback',
    permit_requirements: 'FDOT TNC Registration; no additional city-level permits required',
  },
];

// ─── Insurance Claims ────────────────────────────────────────────────────────

export interface Claim {
  id: string;
  policy_id: string;
  policy_type: string;
  incident_id: string | null;
  entity: string;
  amount: number;
  status: string;
  severity: string;
  state: string;
  filed_date: string;
}

export const MOCK_CLAIMS: Claim[] = [
  { id: 'CLM-2024-001', policy_id: 'POL-CGL-001',  policy_type: 'CGL',      incident_id: 'INC-003',  entity: 'Sunset Transit LLC',  amount: 125000, status: 'open',         severity: 'high',     state: 'CA', filed_date: '2024-10-12' },
  { id: 'CLM-2024-002', policy_id: 'POL-AUTO-001', policy_type: 'auto',     incident_id: 'INC-007',  entity: 'Metro Rides Inc',     amount: 38500,  status: 'under_review', severity: 'medium',   state: 'TX', filed_date: '2024-11-03' },
  { id: 'CLM-2024-003', policy_id: 'POL-CGL-001',  policy_type: 'CGL',      incident_id: null,       entity: 'CityLink Corp',       amount: 22000,  status: 'settled',      severity: 'low',      state: 'FL', filed_date: '2024-09-18' },
  { id: 'CLM-2024-004', policy_id: 'POL-PROP-001', policy_type: 'property', incident_id: 'INC-011',  entity: 'Bay Area Transit',    amount: 85000,  status: 'open',         severity: 'high',     state: 'CA', filed_date: '2024-12-01' },
  { id: 'CLM-2024-005', policy_id: 'POL-CYBER-001',policy_type: 'cyber',    incident_id: 'INC-015',  entity: 'DataMove LLC',        amount: 275000, status: 'denied',       severity: 'critical', state: 'NY', filed_date: '2024-08-22' },
  { id: 'CLM-2025-001', policy_id: 'POL-AUTO-001', policy_type: 'auto',     incident_id: 'INC-021',  entity: 'QuickShift Corp',     amount: 15000,  status: 'closed',       severity: 'low',      state: 'WA', filed_date: '2025-01-14' },
  { id: 'CLM-2025-002', policy_id: 'POL-CGL-002',  policy_type: 'CGL',      incident_id: 'INC-025',  entity: 'Rideline Inc',        amount: 330000, status: 'under_review', severity: 'critical', state: 'IL', filed_date: '2025-02-28' },
];

// ─── Utility: compute contract status ────────────────────────────────────────

export function contractStatus(contract: Contract): 'Active' | 'Expired' | 'Approaching Expiration' {
  const today = new Date();
  const exp = new Date(contract.expiration_date);
  const daysLeft = (exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  if (daysLeft < 0) return 'Expired';
  if (daysLeft <= 90) return 'Approaching Expiration';
  return 'Active';
}

// ─── Utility: split a worker's (possibly semicolon-joined) client_id field ──

export function workerClientIds(worker: Worker): string[] {
  return (worker.client_id || '').split(';').map(s => s.trim()).filter(Boolean);
}

// ─── Utility: derive a worker's clients from actual service engagement history ──
// The service engagement record is the ground truth of who a worker actually
// served — unlike worker.client_id (a manually-maintained field prone to
// drift), this is computed live from service engagements, so it can't
// silently go stale.
export function workerServiceEngagementClientIds(workerId: string, serviceEngagements: ServiceEngagement[]): string[] {
  return [...new Set(serviceEngagements.filter(r => r.worker_id === workerId && r.client_id).map(r => r.client_id))];
}

// A recipient only violates a given engagement's recording if they opted
// out of a technology that engagement actually used (e.g. opted out of
// in-app video but opted in to dash cam — a dash-cam-only engagement stays
// compliant for them). When the engagement doesn't say which technologies
// were active (recording_technologies unset — legacy data, or a caller that
// never set it), fall back to flagging on ANY opted-out technology, since
// we can't rule out that it was the one used.
export function recipientOptedOutOfEngagement(recipient: ServiceRecipient, technologies: string[] | undefined): boolean {
  if (!recipient.recording_consent) return false;
  const keys = (technologies && technologies.length
    ? technologies
    : Object.keys(recipient.recording_consent)) as (keyof RecordingConsent)[];
  return keys.some(k => recipient.recording_consent[k] === 'opt-out');
}

// ─── Utility: compute service engagement privacy compliance ──────────────────

export function serviceEngagementPrivacyStatus(engagement: ServiceEngagement, serviceRecipients: ServiceRecipient[], clients: Client[]): 'COMPLIANT' | 'NON-COMPLIANT' {
  if (!engagement.video_recorded) return 'COMPLIANT';

  // Opt-out wins from either source: the client's default consent policy
  // is a floor that a linked service recipient opting in cannot clear (client
  // opt-out → always non-compliant if recorded, regardless of service
  // recipient), and a specific service recipient opting out (of a
  // technology this engagement actually used) overrides an opt-in client
  // default. Only compliant when BOTH the client default and every linked
  // service recipient's relevant technology consent are opt-in.
  const client = clients.find(c => c.client_id === engagement.client_id);
  if (client?.video_consent_policy === 'opt-out') return 'NON-COMPLIANT';

  const linkedRecipients = serviceRecipients.filter(r => engagement.linked_service_recipient_ids.includes(r.service_recipient_id));
  return linkedRecipients.some(r => recipientOptedOutOfEngagement(r, engagement.recording_technologies)) ? 'NON-COMPLIANT' : 'COMPLIANT';
}

// ─── Utility: default recording rule for a service engagement ────────────────
// The client's video_consent_policy is the baseline, but a linked service
// recipient's own in-app-video consent always overrides it for THAT
// engagement — recipients can opt out (or back in) individually regardless
// of their client's default. With multiple linked recipients (Pooled
// engagements), any one opt-out wins: the engagement can't be presented as
// an unqualified "Opt-In" rule if even one rider aboard has opted out.
export function serviceEngagementRecordingRule(
  engagement: ServiceEngagement,
  serviceRecipients: ServiceRecipient[],
  clients: Client[],
): 'opt-in' | 'opt-out' | null {
  const linkedRecipients = serviceRecipients.filter(r => engagement.linked_service_recipient_ids.includes(r.service_recipient_id));
  if (linkedRecipients.length > 0) {
    return linkedRecipients.some(r => r.recording_consent.in_app_video === 'opt-out') ? 'opt-out' : 'opt-in';
  }
  const client = clients.find(c => c.client_id === engagement.client_id);
  return client?.video_consent_policy ?? null;
}

// ─── Utility: compute service recipient privacy compliance ───────────────────

export function serviceRecipientPrivacyStatus(recipient: ServiceRecipient, serviceEngagements: ServiceEngagement[]): 'COMPLIANT' | 'NON-COMPLIANT' {
  const appearsInViolatingEngagement = serviceEngagements.some(
    e => e.video_recorded && e.linked_service_recipient_ids.includes(recipient.service_recipient_id)
      && recipientOptedOutOfEngagement(recipient, e.recording_technologies)
  );
  return appearsInViolatingEngagement ? 'NON-COMPLIANT' : 'COMPLIANT';
}

// ─── Utility: compute BGC renewal due dates from cadence ──────────────────────
// Only 'Annual' cadence is currently supported — the due date is the exact
// month/day of the worker's first BGC, recurring every year.

function bgcAnniversaryInYear(first: Date, year: number): Date {
  return new Date(year, first.getMonth(), first.getDate());
}

// The most recent due date that has already occurred (on or before today).
function mostRecentBgcDueDate(first: Date, today: Date): Date {
  const thisYear = bgcAnniversaryInYear(first, today.getFullYear());
  return thisYear.getTime() <= today.getTime() ? thisYear : bgcAnniversaryInYear(first, today.getFullYear() - 1);
}

// The next due date still to come (strictly after today).
function nextBgcDueDate(first: Date, today: Date): Date {
  const thisYear = bgcAnniversaryInYear(first, today.getFullYear());
  return thisYear.getTime() > today.getTime() ? thisYear : bgcAnniversaryInYear(first, today.getFullYear() + 1);
}

// ─── Utility: compute effective BGC status (auto-flags approaching renewals) ──
// As soon as the most recent due date passes without a BGC on or after it, the
// worker is immediately "missing" — there is no grace window on that cutoff.
// If they're up to date, "expiring soon" kicks in within 30 days of the next
// due date; otherwise they're "complete". Only meaningful for worker_type
// 'Driver' (or other BGC-screened roles) — bgc_status/bgc_duration are
// undefined for other worker types and this just returns undefined then.

const BGC_EXPIRING_SOON_DAYS = 30;

export function effectiveBgcStatus(worker: Worker): Worker['bgc_status'] {
  if (!worker.first_bgc_date || !/annual/i.test(worker.bgc_duration || '')) return worker.bgc_status;
  const first = new Date(worker.first_bgc_date);
  if (isNaN(first.getTime())) return worker.bgc_status;

  const today = new Date();
  const mostRecentDue = mostRecentBgcDueDate(first, today);
  const last = worker.last_bgc_date ? new Date(worker.last_bgc_date) : null;
  const renewedForCurrentCycle = !!last && !isNaN(last.getTime()) && last.getTime() >= mostRecentDue.getTime();

  if (!renewedForCurrentCycle) return 'missing';

  const nextDue = nextBgcDueDate(first, today);
  const daysUntilNext = Math.ceil((nextDue.getTime() - today.getTime()) / 86400000);
  return daysUntilNext <= BGC_EXPIRING_SOON_DAYS ? 'expiring_soon' : 'complete';
}

// ─── Utility: compute worker BGC compliance status ────────────────────────────

export function workerComplianceStatus(worker: Worker): 'Compliant' | 'Non-Compliant' {
  const status = effectiveBgcStatus(worker);
  if (status === 'complete' || status === 'expiring_soon') return 'Compliant';
  return 'Non-Compliant';
}
