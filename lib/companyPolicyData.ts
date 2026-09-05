// ─── Company Policy Data ───────────────────────────────────────────────────────
// Company-wide internal screening/BGC policy standards — the third, independent
// compliance axis alongside state law (lib/regulationData.ts) and client
// contract terms (lib/mockData.ts Contract). See lib/bgcCompliance.ts for how
// this is combined with the other two axes.
//
// Resolution order for a given state (see findCompanyPolicy): a state-scoped
// override row, else the single global row. Only a global row exists today —
// a state's *legal* interval can still be stricter than this global policy
// (see WI in lib/regulationData.ts, which requires re-screening every 4 years
// against a 5-year policy default); bgcCompliance.ts takes the strictest of
// the applicable axes.

export type PolicyScope = 'global' | 'state';

export interface CompanyPolicyRow {
  policy_id: string;        // e.g. 'POL-012'
  scope: PolicyScope;
  abbr?: string;              // required when scope === 'state'
  title: string;
  category: 'bgc';            // extensible; only 'bgc' is consumed by the engine today
  intervalMonths: number;
  description: string;        // shown verbatim in ObligationDetailPanel's Policy section
  effectiveDate: string;      // ISO date the policy version took effect
}

export const COMPANY_POLICY_DATA: CompanyPolicyRow[] = [
  {
    policy_id: 'POL-012',
    scope: 'global',
    title: 'Annual Driver Screening Required',
    category: 'bgc',
    intervalMonths: 60,
    description:
      'All Consola drivers, regardless of operating state, must complete a criminal ' +
      'background re-screen at least once every 5 years, per Trust & Safety Standard TS-04. ' +
      'This is a company-wide floor; it does not override a stricter state legal minimum ' +
      'or a stricter client contract requirement.',
    effectiveDate: '2021-01-01',
  },
];

export function findCompanyPolicy(state: string): CompanyPolicyRow | undefined {
  return (
    COMPANY_POLICY_DATA.find(r => r.scope === 'state' && r.abbr === state) ??
    COMPANY_POLICY_DATA.find(r => r.scope === 'global')
  );
}
