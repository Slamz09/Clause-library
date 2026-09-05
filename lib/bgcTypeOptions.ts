// ─── BGC screening-method taxonomy ─────────────────────────────────────────
// Distinct from the free-text `bgc_type` description already on workers
// (e.g. "State Criminal + MVR") — this is the structured, multi-select
// screening-method requirement shared across contracts, clients, and
// workers: which method(s) apply, and for the two identity-verification
// methods (Name Search / Fingerprinting), which jurisdiction level(s) it's
// required at (State, Federal, or both) — e.g. fingerprint-based checks run
// through a state police agency (state) vs. the FBI (federal). Sex Offender
// Registry and DCFS checks are standalone registry/agency checks with no
// State/Federal split of their own. The specific state list is only
// meaningful at the worker level (a contract/client requirement is
// jurisdiction-level only; which states a given worker was actually
// screened in is worker-specific).

export const BGC_SCREENING_TYPES = ['Name Search', 'Fingerprinting', 'Sex Offender Registry Check', 'DCFS Check'] as const;
export type BgcScreeningType = typeof BGC_SCREENING_TYPES[number];

export const BGC_JURISDICTION_LEVELS = ['State', 'Federal'] as const;
export type BgcJurisdictionLevel = typeof BGC_JURISDICTION_LEVELS[number];

// Only these two methods have a meaningful State/Federal split (e.g. run
// through a state police agency vs. the FBI) — Sex Offender Registry and
// DCFS checks are standalone agency/registry checks with no such split.
export const BGC_TYPES_WITH_JURISDICTION: readonly BgcScreeningType[] = ['Name Search', 'Fingerprinting'];

export const BGC_ALL_STATES = 'All';

export interface BgcTypeRequirement {
  type: BgcScreeningType;
  jurisdiction: BgcJurisdictionLevel[];
  // Worker-table only. State abbreviations, or ['All'].
  states?: string[];
  // Optional and currently informational only (no evaluation logic reads
  // these yet — see docs/ontology-implementation-plan.md Phase 2). Distinct
  // per the ontology's ScreeningRequirement model: submissionAuthority is WHO
  // the check is submitted to (e.g. "Arizona DPS", "FBI"); submissionChannel
  // is HOW (e.g. "state portal", "approved fingerprint vendor"). A check can
  // be the right modality/jurisdiction but still fail a contract's procedure
  // requirement if it wasn't submitted through the required channel.
  submissionAuthority?: string;
  submissionChannel?: string;
}

// Merges BGC requirement lists from multiple contracts (e.g. all contracts
// linked to one client) into one summary: each type appears once, with the
// union of jurisdiction levels and states named across every contract that
// mentioned it.
export function mergeBgcRequirements(lists: (BgcTypeRequirement[] | undefined)[]): BgcTypeRequirement[] {
  const byType = new Map<BgcScreeningType, BgcTypeRequirement>();
  for (const list of lists) {
    for (const req of normalizeBgcRequirements(list)) {
      const existing = byType.get(req.type);
      if (!existing) { byType.set(req.type, { ...req, jurisdiction: [...req.jurisdiction], states: req.states ? [...req.states] : undefined }); continue; }
      existing.jurisdiction = Array.from(new Set([...existing.jurisdiction, ...req.jurisdiction]));
      if (req.states?.length) existing.states = Array.from(new Set([...(existing.states || []), ...req.states]));
    }
  }
  return Array.from(byType.values());
}

export function normalizeBgcRequirements(value: unknown): BgcTypeRequirement[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r): r is BgcTypeRequirement => !!r && typeof r === 'object' && BGC_SCREENING_TYPES.includes(r.type))
    .map(r => ({
      type: r.type,
      jurisdiction: Array.isArray(r.jurisdiction) ? r.jurisdiction.filter((j: string) => BGC_JURISDICTION_LEVELS.includes(j as BgcJurisdictionLevel)) : [],
      states: Array.isArray(r.states) ? r.states : undefined,
      submissionAuthority: typeof r.submissionAuthority === 'string' ? r.submissionAuthority : undefined,
      submissionChannel: typeof r.submissionChannel === 'string' ? r.submissionChannel : undefined,
    }));
}
