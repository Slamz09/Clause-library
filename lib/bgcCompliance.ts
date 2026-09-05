// ─── BGC Legal-Policy-Contract Compliance Engine ──────────────────────────────
// Cross-references a worker's actual background-check recency against three
// independent standards: the state legal minimum (lib/regulationData.ts), the
// company's internal policy standard (lib/companyPolicyData.ts), and the
// operating client's contract requirement (lib/mockData.ts Contract). A
// worker can be non-compliant with any, all, or none — this module keeps the
// three verdicts distinguishable rather than collapsing to one flag.
//
// Only meaningful for worker_type 'Driver' (or another BGC-screened role) —
// callers should gate on that before invoking this engine.

import { contractStatus, type Worker, type Contract } from '@/lib/mockData';
import { DRIVER_REQ_DATA } from '@/lib/regulationData';
import { findCompanyPolicy } from '@/lib/companyPolicyData';
import { mergeBgcRequirements, normalizeBgcRequirements, BGC_TYPES_WITH_JURISDICTION, type BgcTypeRequirement } from '@/lib/bgcTypeOptions';
import { mergeOverride } from '@/lib/regulationOverrides';
import type { ControllingStandard, RequirementRelationship } from '@/lib/ontology/types';

export type ComplianceLegStatus = 'compliant' | 'non-compliant' | 'not-applicable';

export interface BgcComplianceResult {
  legalIntervalMonths: number | null;
  legalDueDate: Date | null;
  legalStatus: ComplianceLegStatus;
  legalId: string | null;
  contractIntervalMonths: number | null;
  contractDueDate: Date | null;
  contractStatus: ComplianceLegStatus;
  contractId: string | null;
  policyIntervalMonths: number | null;
  policyDueDate: Date | null;
  policyStatus: ComplianceLegStatus;
  policyId: string | null;
  // Whether the worker's own bgc_requirement_types cover every method (and,
  // for Fingerprinting, every jurisdiction level) the client's contract(s)
  // require — cadence alone doesn't catch a worker who's current on a Name
  // Search but was never actually run through, say, the DCFS check the
  // contract also requires.
  requiredBgcTypes: BgcTypeRequirement[];
  missingBgcTypes: BgcTypeRequirement[];
  typeStatus: ComplianceLegStatus;
  overallStatus: 'compliant' | 'non-compliant';
  // Which of the three standards currently governs cadence: whichever of
  // legal/contract/policy has the smallest interval_months among those that
  // apply (null intervals — i.e. not-applicable legs — are excluded). Same
  // "strictest governs" rule effectiveWorkerBgcCadence already applies across
  // legal+contract, extended here to all three legs computed by this function.
  controllingStandard: ControllingStandard | null;
  // Cadence relationship between the legal minimum and the contract
  // requirement (the two authority sources most likely to diverge in
  // practice). null when either side has no applicable interval to compare.
  relationship: RequirementRelationship | null;
}

// ─── Interval parsing ──────────────────────────────────────────────────────────

export function fingerprintingIntervalToMonths(interval: string): number | null {
  if (!interval) return null;
  const yearMatch = interval.match(/(\d+)\s*year/i);
  if (yearMatch) return parseInt(yearMatch[1], 10) * 12;
  if (/annual/i.test(interval)) return 12;
  return null;
}

// ─── Standard lookups ──────────────────────────────────────────────────────────

// overridePatch (from regulation_overrides, table_name='driver-req') is
// applied via the same shallow last-write-wins merge used everywhere else
// overrides are consumed (see lib/regulationOverrides.ts) — a patched
// fingerprintingInterval/legal_id genuinely changes the legal leg's verdict,
// not just a display value.
export function legalBgcIntervalMonths(state: string, overridePatch?: Record<string, any>): number | null {
  const row = DRIVER_REQ_DATA.find(r => r.abbr === state);
  if (!row) return null;
  const merged = mergeOverride(row, overridePatch);
  return fingerprintingIntervalToMonths(merged.fingerprintingInterval);
}

export function legalBgcId(state: string, overridePatch?: Record<string, any>): string | null {
  const row = DRIVER_REQ_DATA.find(r => r.abbr === state);
  if (!row) return null;
  return mergeOverride(row, overridePatch).legal_id ?? null;
}

// Also tracks which contract produced the MIN interval, so callers can cite
// the specific contract_id a compliance verdict traces back to.
export function contractBgcInterval(clientId: string, contracts: Contract[]): { months: number | null; contractId: string | null } {
  const applicable = contracts.filter(c =>
    c.linked_client_id === clientId && contractStatus(c) !== 'Expired' && c.bgc_interval_months != null
  );
  if (applicable.length === 0) return { months: null, contractId: null };
  const min = applicable.reduce((a, b) => (a.bgc_interval_months! <= b.bgc_interval_months! ? a : b));
  return { months: min.bgc_interval_months, contractId: min.contract_id };
}

export function contractBgcIntervalMonths(clientId: string, contracts: Contract[]): number | null {
  return contractBgcInterval(clientId, contracts).months;
}

function policyBgcInterval(state: string): { months: number; policyId: string } {
  const row = findCompanyPolicy(state)!; // COMPANY_POLICY_DATA always has a 'global' fallback row
  return { months: row.intervalMonths, policyId: row.policy_id };
}

// ─── BGC type-coverage (Name Search / Fingerprinting / Sex Offender Registry
// / DCFS) ─────────────────────────────────────────────────────────────────
// Merges the required screening types across every active contract this
// client has on file — mirrors contractBgcInterval's "applicable contracts"
// filter (linked to this client, not expired).
export function contractBgcTypeRequirements(clientId: string, contracts: Contract[]): BgcTypeRequirement[] {
  const applicable = contracts.filter(c => c.linked_client_id === clientId && contractStatus(c) !== 'Expired');
  return mergeBgcRequirements(applicable.map(c => c.bgc_requirement_types));
}

// Required types the worker's own record doesn't cover — for Fingerprinting,
// also checks jurisdiction level (e.g. required State+Federal but the
// worker's record only has Federal on file still counts as missing State).
export function missingBgcTypes(required: BgcTypeRequirement[], have: BgcTypeRequirement[]): BgcTypeRequirement[] {
  const missing: BgcTypeRequirement[] = [];
  for (const req of required) {
    const match = have.find(h => h.type === req.type);
    if (!match) { missing.push(req); continue; }
    if (BGC_TYPES_WITH_JURISDICTION.includes(req.type) && req.jurisdiction.length) {
      const uncovered = req.jurisdiction.filter(j => !match.jurisdiction.includes(j));
      if (uncovered.length) missing.push({ ...req, jurisdiction: uncovered });
    }
  }
  return missing;
}

// ─── Interval-parameterized due-date math ─────────────────────────────────────
// Separate from lib/mockData.ts's annual-only bgcAnniversaryInYear/
// mostRecentBgcDueDate/nextBgcDueDate/effectiveBgcStatus (untouched — those
// keep serving the Workers tab exactly as before).

function anniversaryAfterCycles(first: Date, intervalMonths: number, cycles: number): Date {
  const d = new Date(first);
  d.setMonth(d.getMonth() + intervalMonths * cycles);
  return d;
}

export function mostRecentDueDate(first: Date, today: Date, intervalMonths: number): Date {
  const monthsElapsed =
    (today.getFullYear() * 12 + today.getMonth()) - (first.getFullYear() * 12 + first.getMonth());
  let cycles = Math.floor(monthsElapsed / intervalMonths);
  let candidate = anniversaryAfterCycles(first, intervalMonths, cycles);
  if (candidate.getTime() > today.getTime()) {
    cycles -= 1;
    candidate = anniversaryAfterCycles(first, intervalMonths, cycles);
  }
  return candidate;
}

export function nextDueDate(first: Date, today: Date, intervalMonths: number): Date {
  const recent = mostRecentDueDate(first, today, intervalMonths);
  return anniversaryAfterCycles(recent, intervalMonths, 1);
}

// ─── Combining evaluator ───────────────────────────────────────────────────────

function evaluateLeg(
  first: Date | null, last: Date | null, today: Date, intervalMonths: number | null
): { status: ComplianceLegStatus; due: Date | null } {
  if (intervalMonths == null || !first || isNaN(first.getTime())) {
    return { status: 'not-applicable', due: null };
  }
  const due = mostRecentDueDate(first, today, intervalMonths);
  const renewed = !!last && !isNaN(last.getTime()) && last.getTime() >= due.getTime();
  return { status: renewed ? 'compliant' : 'non-compliant', due };
}

export function evaluateBgcCompliance(
  worker: Worker,
  opts: { state: string; clientId: string; contracts: Contract[]; today?: Date; driverReqOverride?: Record<string, any> }
): BgcComplianceResult {
  const today = opts.today ?? new Date();
  const first = worker.first_bgc_date ? new Date(worker.first_bgc_date) : null;
  const last = worker.last_bgc_date ? new Date(worker.last_bgc_date) : null;

  const legalMonths = legalBgcIntervalMonths(opts.state, opts.driverReqOverride);
  const legalId = legalBgcId(opts.state, opts.driverReqOverride);
  const { months: contractMonths, contractId } = contractBgcInterval(opts.clientId, opts.contracts);
  const { months: policyMonths, policyId } = policyBgcInterval(opts.state);

  const legal = evaluateLeg(first, last, today, legalMonths);
  const contract = evaluateLeg(first, last, today, contractMonths);
  const policy = evaluateLeg(first, last, today, policyMonths);

  // Cadence (above) only checks WHEN the worker was last screened — this
  // separately checks WHAT they were screened for, against every BGC type
  // the client's contract(s) require (e.g. a worker current on a Name
  // Search is still non-compliant if the contract also requires a Sex
  // Offender Registry Check or DCFS Check they've never had).
  const requiredTypes = contractBgcTypeRequirements(opts.clientId, opts.contracts);
  const missingTypes = missingBgcTypes(requiredTypes, normalizeBgcRequirements(worker.bgc_requirement_types));
  const typeStatus: ComplianceLegStatus = requiredTypes.length === 0 ? 'not-applicable' : (missingTypes.length === 0 ? 'compliant' : 'non-compliant');

  // controllingStandard: strictest applicable interval among the three legs
  // (mirrors effectiveWorkerBgcCadence's legal-vs-contract rule, extended to
  // include policy since this function — unlike that one — already computes
  // a policy leg).
  const legs: { authority: ControllingStandard; months: number | null }[] = [
    { authority: 'legal', months: legalMonths },
    { authority: 'contract', months: contractMonths },
    { authority: 'policy', months: policyMonths },
  ];
  const controllingStandard = legs
    .filter((l): l is { authority: ControllingStandard; months: number } => l.months != null)
    .reduce<{ authority: ControllingStandard; months: number } | null>(
      (min, l) => (!min || l.months < min.months) ? l : min, null,
    )?.authority ?? null;

  // relationship: how the contract's cadence relates to the legal minimum —
  // the pairing most likely to diverge (policy is the company's own
  // baseline, not a separate external authority to reconcile against).
  let relationship: RequirementRelationship | null = null;
  if (contractMonths != null && legalMonths != null) {
    relationship = contractMonths === legalMonths ? 'satisfies' : 'moreRestrictiveThan';
  } else if (contractMonths != null || legalMonths != null) {
    relationship = 'supplements'; // one side has a requirement the other doesn't state at all
  }

  return {
    legalIntervalMonths: legalMonths,
    legalDueDate: legal.due,
    legalStatus: legal.status,
    legalId,
    contractIntervalMonths: contractMonths,
    contractDueDate: contract.due,
    contractStatus: contract.status,
    contractId,
    policyIntervalMonths: policyMonths,
    policyDueDate: policy.due,
    policyStatus: policy.status,
    policyId,
    requiredBgcTypes: requiredTypes,
    missingBgcTypes: missingTypes,
    typeStatus,
    overallStatus: (legal.status === 'non-compliant' || contract.status === 'non-compliant' || policy.status === 'non-compliant' || typeStatus === 'non-compliant')
      ? 'non-compliant'
      : 'compliant',
    controllingStandard,
    relationship,
  };
}

// ─── Worker-facing cadence & status (multi-client) ────────────────────────────
// Used by the Workers roster (Compliance Gaps + Accounts) and the Operations
// Service Engagements tab to auto-compute a worker's governing BGC
// requirement instead of asking a human to type a cadence/status. A worker
// may serve several clients, each with its own contract requirement — the
// governing value is whichever is strictest across all of them (client
// contract vs. the legal minimum for the worker's state).

export interface WorkerCadenceSource {
  clientId: string;
  intervalMonths: number | null;
  source: 'contract' | 'legal' | 'none';
  contractId: string | null;
}

export function effectiveWorkerBgcCadence(
  clientIds: string[], state: string, contracts: Contract[]
): { intervalMonths: number | null; governingSource: WorkerCadenceSource | null; perClient: WorkerCadenceSource[] } {
  const legalMonths = legalBgcIntervalMonths(state);
  const perClient: WorkerCadenceSource[] = clientIds.map(clientId => {
    const { months: contractMonths, contractId } = contractBgcInterval(clientId, contracts);
    const contractIsStricter = contractMonths != null && (legalMonths == null || contractMonths < legalMonths);
    if (contractIsStricter) return { clientId, intervalMonths: contractMonths, source: 'contract', contractId };
    if (legalMonths != null) return { clientId, intervalMonths: legalMonths, source: 'legal', contractId: null };
    return { clientId, intervalMonths: null, source: 'none', contractId: null };
  });

  // Strictest (fewest months) across all clients governs — the worker must satisfy all of them.
  const governingSource = perClient
    .filter(p => p.intervalMonths != null)
    .reduce<WorkerCadenceSource | null>((min, p) => (!min || p.intervalMonths! < min.intervalMonths!) ? p : min, null);

  return { intervalMonths: governingSource?.intervalMonths ?? null, governingSource, perClient };
}

// Mirrors lib/mockData.ts's effectiveBgcStatus due-date logic but driven by a
// real numeric interval instead of regex-matching "annual" cadence text.
// Intentionally separate from that module — see the module-level comment near
// evaluateLeg() for why the two systems are kept apart.
const WORKER_BGC_EXPIRING_SOON_DAYS = 30;

export function computeWorkerBgcStatus(
  firstBgcDate: string | null | undefined,
  lastBgcDate: string | null | undefined,
  intervalMonths: number | null,
  today: Date = new Date()
): 'complete' | 'expiring_soon' | 'missing' {
  if (intervalMonths == null) return 'complete'; // nothing on file to be non-compliant with
  if (!firstBgcDate) return 'missing';
  const first = new Date(firstBgcDate);
  if (isNaN(first.getTime())) return 'missing';

  const due = mostRecentDueDate(first, today, intervalMonths);
  const last = lastBgcDate ? new Date(lastBgcDate) : null;
  const renewed = !!last && !isNaN(last.getTime()) && last.getTime() >= due.getTime();
  if (!renewed) return 'missing';

  const next = nextDueDate(first, today, intervalMonths);
  const daysUntilNext = Math.ceil((next.getTime() - today.getTime()) / 86400000);
  return daysUntilNext <= WORKER_BGC_EXPIRING_SOON_DAYS ? 'expiring_soon' : 'complete';
}
