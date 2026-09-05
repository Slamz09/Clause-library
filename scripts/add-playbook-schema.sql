-- ─── Playbook Schema ──────────────────────────────────────────────────────────
-- Adds extraction_profiles, contract_playbooks, and compliance columns on clauses.
-- Seeds 13 extraction profiles and 5 contract playbooks for ski resort operations.
-- Safe to re-run — uses CREATE TABLE IF NOT EXISTS and ON CONFLICT throughout.

-- ─── 1. extraction_profiles ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.extraction_profiles (
  document_type    TEXT PRIMARY KEY,
  system_prompt    TEXT,
  priority_clauses TEXT[],
  display_label    TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.extraction_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.extraction_profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- profile_id may already exist as NOT NULL — give it a default so our INSERT can omit it
DO $$
BEGIN
  -- Try text default first; if the column is uuid type this will fail and we use uuid default
  BEGIN
    ALTER TABLE public.extraction_profiles ALTER COLUMN profile_id SET DEFAULT gen_random_uuid()::text;
  EXCEPTION WHEN others THEN
    ALTER TABLE public.extraction_profiles ALTER COLUMN profile_id SET DEFAULT gen_random_uuid();
  END;
END $$;

ALTER TABLE public.extraction_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'extraction_profiles' AND policyname = 'allow_all_extraction_profiles'
  ) THEN
    CREATE POLICY "allow_all_extraction_profiles"
      ON public.extraction_profiles FOR ALL TO anon, service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── 2. contract_playbooks ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contract_playbooks (
  id            TEXT PRIMARY KEY,
  document_type TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  groq_prompt   TEXT,
  rules         JSONB NOT NULL DEFAULT '[]'::jsonb,
  active        BOOLEAN NOT NULL DEFAULT true,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contract_playbooks_document_type ON public.contract_playbooks (document_type);

ALTER TABLE public.contract_playbooks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'contract_playbooks' AND policyname = 'allow_all_contract_playbooks'
  ) THEN
    CREATE POLICY "allow_all_contract_playbooks"
      ON public.contract_playbooks FOR ALL TO anon, service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── 3. clauses — compliance columns ─────────────────────────────────────────

ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS compliance_status TEXT DEFAULT 'unchecked';
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS compliance_notes  TEXT;
ALTER TABLE public.clauses ADD COLUMN IF NOT EXISTS playbook_id       TEXT;

CREATE INDEX IF NOT EXISTS clauses_compliance_status ON public.clauses (compliance_status);

-- ─── 4. Seed extraction_profiles ─────────────────────────────────────────────

INSERT INTO public.extraction_profiles (document_type, display_label, system_prompt, priority_clauses)
VALUES

('msa', 'MSA — Master Services Agreement',
 'You are a legal analyst extracting clauses from a Master Services Agreement for a ski resort company. Focus on provisions that govern the ongoing services relationship, including liability caps, SLA obligations, and change control. Flag clauses that expose the resort to uncapped liability or that restrict operational flexibility.',
 ARRAY['indemnity','limitation_of_liability','service_levels','change_control','termination','payment_terms','intellectual_property','confidentiality']),

('nda', 'NDA — Non-Disclosure Agreement',
 'You are a legal analyst extracting clauses from a Non-Disclosure Agreement protecting a ski resort company. Identify the scope of confidential information, disclosure carve-outs, and obligations on both parties. Pay close attention to duration, permitted disclosures, and remedies for breach.',
 ARRAY['definition_of_confidential_information','permitted_disclosures','duration','return_of_information','remedies','non_solicitation','governing_law']),

('service_agreement', 'Service Agreement',
 'You are a legal analyst extracting clauses from a Service Agreement for a ski resort operator. Concentrate on the scope of work, payment schedules, warranty provisions, and termination rights. Note any clauses that assign unusual risk to the resort or restrict the resort from engaging competing vendors.',
 ARRAY['scope_of_work','payment_terms','warranty','termination','indemnity','insurance','dispute_resolution','limitation_of_liability']),

('franchise_agreement', 'Franchise Agreement',
 'You are a legal analyst extracting clauses from a Franchise Agreement for a ski resort brand operator. Identify fee structures, territory rights, renewal and termination conditions, and brand-standards compliance obligations. Flag clauses that create aggressive audit rights or that allow unilateral changes to brand standards.',
 ARRAY['franchise_fee','territory','renewal_option','termination','brand_standards','audit_rights','non_compete','assignment']),

('loan_agreement', 'Loan Agreement',
 'You are a legal analyst extracting clauses from a Loan Agreement where a ski resort is the borrower. Focus on financial covenants, events of default, cure periods, prepayment provisions, and cross-default triggers. Highlight any covenant that could be triggered by seasonal revenue fluctuations typical in the ski industry.',
 ARRAY['financial_covenants','events_of_default','cross_default','prepayment','cure_period','reporting_requirements','collateral','interest_rate']),

('master_lease', 'Master Lease Agreement',
 'You are a legal analyst extracting clauses from a Master Lease Agreement under which a ski resort operator leases the ski area from a landowner. Prioritize indemnity allocation, insurance obligations, assignment and subletting rights, termination triggers, and land-use restrictions. Note clauses that could restrict capital improvements or that create liability for pre-existing environmental conditions.',
 ARRAY['indemnity','insurance','assignment','termination','rent_adjustment','capital_improvements','environmental','renewal_option']),

('general_contract', 'General Contract',
 'You are a legal analyst extracting clauses from a general commercial contract involving a ski resort company. Extract all material provisions covering obligations, risk allocation, payment, and dispute resolution. Flag any clause that departs significantly from standard commercial practice or that imposes asymmetric obligations on the resort.',
 ARRAY['indemnity','limitation_of_liability','payment_terms','termination','governing_law','dispute_resolution','force_majeure','assignment']),

('insurance_policy', 'Insurance Policy',
 'You are a legal analyst extracting coverage terms from an insurance policy held by a ski resort company. Identify coverage limits, exclusions, additional insured status, cancellation notice periods, and subrogation waivers. Highlight any exclusion that could deny coverage for ski area operations, including terrain park incidents or avalanche events.',
 ARRAY['coverage_limit','exclusions','additional_insured','cancellation_notice','waiver_of_subrogation','claims_made_vs_occurrence','deductible','aggregate_limit']),

('management_agreement', 'Management / Franchise Agreement',
 'You are a legal analyst extracting clauses from a Management Agreement governing third-party management of a ski resort. Focus on management fee structures, performance benchmarks, termination for cause and without cause, IP ownership, and non-compete restrictions. Flag provisions that allow the manager to retain brand assets upon termination.',
 ARRAY['management_fee','performance_standards','termination','ip_ownership','non_compete','reporting_requirements','budget_approval','indemnity']),

('loan_covenant', 'Loan / Debt Covenant',
 'You are a legal analyst extracting covenant provisions from a debt covenant document for a ski resort borrower. Identify all financial maintenance covenants, affirmative and negative covenants, reporting deadlines, and event-of-default definitions. Pay particular attention to any covenant that references EBITDA, DSCR, or seasonal adjustment mechanisms.',
 ARRAY['financial_covenants','affirmative_covenants','negative_covenants','reporting_requirements','events_of_default','cross_default','cure_period','waiver_rights']),

('operating_permit', 'Operating Permit / License',
 'You are a legal analyst extracting provisions from an operating permit or license issued to a ski resort. Identify conditions of operation, renewal requirements, revocation triggers, fee schedules, and environmental compliance obligations. Flag any provision that requires prior government approval before capital improvements or changes to ski terrain.',
 ARRAY['permit_conditions','renewal_deadline','revocation_trigger','fee_schedule','environmental_compliance','reporting_duty','capital_improvement_approval','insurance_requirement']),

('lease_agreement', 'Lease Agreement',
 'You are a legal analyst extracting clauses from a real property lease agreement involving a ski resort company. Focus on rent escalation, maintenance and repair obligations, permitted use restrictions, subletting rights, holdover provisions, and default cure periods. Note any clause that exposes the tenant to liability for structural defects or pre-existing conditions.',
 ARRAY['rent','rent_escalation','permitted_use','maintenance','subletting','holdover','default_cure','renewal_option']),

('general_review', 'General Review (no profile)',
 'You are a legal analyst performing a general review of a document submitted by a ski resort company. Extract all material clauses, obligations, deadlines, and risk-allocation provisions without a predefined extraction template. Flag anything that creates ongoing obligations, financial exposure, or operational restrictions for the resort.',
 ARRAY['obligations','deadlines','payment_terms','indemnity','termination','governing_law','dispute_resolution','notices'])

ON CONFLICT (document_type) DO UPDATE SET
  display_label    = EXCLUDED.display_label,
  system_prompt    = EXCLUDED.system_prompt,
  priority_clauses = EXCLUDED.priority_clauses,
  updated_at       = NOW();

-- ─── 5. Seed contract_playbooks ───────────────────────────────────────────────

INSERT INTO public.contract_playbooks (id, document_type, name, description, groq_prompt, rules, active)
VALUES

('pb_master_lease', 'master_lease', 'Ski Area Master Lease Playbook',
 'Reviews master lease clauses against preferred terms for a ski resort operator leasing terrain from a landowner.',
 'You are an experienced legal analyst specializing in ski area real property leases. Review a single extracted clause from a master lease agreement and assess whether it aligns with the interests of the ski resort operator (tenant). Use the rule provided — compare the actual clause text against the model clause_text and preferred_position. A compliant clause protects the operator from unlimited or one-sided liability, preserves operational flexibility, and matches or improves on the preferred_position. A non_compliant clause clearly disadvantages the operator relative to the preferred_position. A review_needed clause is ambiguous or could be read multiple ways. Return ONLY a JSON object: {"status": "compliant"|"non_compliant"|"review_needed", "notes": "concise explanation referencing the actual clause language", "risk_level": "low"|"medium"|"high"}.',
 $r$[
   {"clause_type":"indemnity","clause_name":"Indemnification","clause_text":"Each party shall indemnify, defend, and hold harmless the other party from and against any claims, losses, or liabilities arising out of or resulting from such party's own negligence or willful misconduct.","preferred_position":"Mutual indemnification — each party indemnifies only for its own negligence. Operator should not bear sole indemnity for landlord's acts.","party_role":"Tenant / Ski Area Operator"},
   {"clause_type":"insurance","clause_name":"Insurance Requirements","clause_text":"Operator shall maintain commercial general liability insurance of not less than 5000000 per occurrence and 10000000 aggregate, naming Landlord as additional insured, with a waiver of subrogation in favor of Landlord.","preferred_position":"Minimum 5M per occurrence / 10M aggregate. Landlord named as additional insured. Waiver of subrogation included. Any requirement below these thresholds is non-compliant.","party_role":"Tenant / Ski Area Operator"},
   {"clause_type":"assignment","clause_name":"Assignment and Subletting","clause_text":"Operator may assign this Agreement or sublease the premises, in whole or in part, to any wholly-owned subsidiary or affiliate of Operator without Landlord's prior written consent.","preferred_position":"Operator must be able to assign freely to affiliates and wholly-owned subsidiaries without landlord consent. Broader consent requirements are non-compliant.","party_role":"Tenant / Ski Area Operator"},
   {"clause_type":"termination","clause_name":"Termination and Cure","clause_text":"In the event of a material breach, the non-breaching party shall provide written notice of such breach and the breaching party shall have sixty (60) days to cure; if the breach is not cured within such period, the non-breaching party may terminate upon an additional thirty (30) days notice.","preferred_position":"60-day cure period minimum. Arbitration or dispute resolution required before termination becomes effective. Immediate termination rights are non-compliant.","party_role":"Tenant / Ski Area Operator"}
 ]$r$::jsonb,
 true),

('pb_management_agreement', 'management_agreement', 'Management Agreement Playbook',
 'Reviews management agreement clauses to ensure the resort company retains control, limits fee exposure, and preserves termination flexibility.',
 'You are an experienced legal analyst specializing in hospitality and ski resort management agreements. Review a single extracted clause from a management agreement and assess whether it protects the interests of the resort owner. Use the rule provided — compare the actual clause text against the model clause_text and preferred_position. A compliant clause preserves owner control, limits fees, and includes measurable performance standards. A non_compliant clause transfers excessive control to the manager or imposes unfavorable terms relative to the preferred_position. Return ONLY a JSON object: {"status": "compliant"|"non_compliant"|"review_needed", "notes": "concise explanation referencing the actual clause language", "risk_level": "low"|"medium"|"high"}.',
 $r$[
   {"clause_type":"management_fee","clause_name":"Management Fee","clause_text":"Manager shall receive a management fee equal to three percent (3%) of Gross Revenue, payable monthly in arrears. No additional incentive fee shall be payable unless Gross Revenue exceeds the Approved Budget by more than fifteen percent (15%), in which case an incentive fee of up to one percent (1%) of incremental Gross Revenue may be earned.","preferred_position":"Base fee capped at 3% of gross revenue. Incentive fee no more than 1% and only on outperformance. Total fee load above 4% of gross is non-compliant.","party_role":"Owner / Resort Company"},
   {"clause_type":"termination","clause_name":"Termination Without Cause","clause_text":"Owner may terminate this Agreement without cause upon ninety (90) days prior written notice to Manager, with no termination fee or liquidated damages payable by Owner.","preferred_position":"Owner must have unilateral right to terminate without cause on 90 days notice with no penalty. Termination fees or consent requirements are non-compliant.","party_role":"Owner / Resort Company"},
   {"clause_type":"performance_standards","clause_name":"Performance Standards","clause_text":"Manager shall achieve the following KPIs: (i) guest satisfaction score above 4.2 out of 5.0 on a trailing 12-month basis; (ii) EBITDA within 10% of Approved Budget; and (iii) occupancy rate within 5% of competitive set average. Failure to meet two or more KPIs for two consecutive measurement periods constitutes a curable Performance Default.","preferred_position":"All KPIs must have numeric thresholds. Failure must trigger a defined cure period then termination right. Vague KPI language with no numeric benchmarks is non-compliant.","party_role":"Owner / Resort Company"},
   {"clause_type":"ip_ownership","clause_name":"Intellectual Property Ownership","clause_text":"All trademarks, brand materials, guest data, customer lists, and proprietary systems developed or used in connection with the Resort shall remain the exclusive property of Owner. Manager shall have no ownership interest in any such materials and shall deliver all such materials to Owner upon termination.","preferred_position":"Owner retains 100% of brand assets, trademarks, and guest data. Any joint ownership or manager retention rights are non-compliant.","party_role":"Owner / Resort Company"}
 ]$r$::jsonb,
 true),

('pb_loan_agreement', 'loan_agreement', 'Loan Agreement Playbook',
 'Reviews loan agreement clauses for a ski resort borrower to identify aggressive covenants, cross-default triggers, and unfavorable prepayment terms.',
 'You are an experienced legal analyst specializing in commercial real estate and ski resort finance. Review a single extracted clause from a loan agreement where the ski resort is the borrower. Use the rule provided — compare the actual clause text against the model clause_text and preferred_position. A compliant clause accommodates the seasonal revenue profile of ski operations. A non_compliant clause exposes the borrower to technical default risk or unreasonable prepayment penalties relative to the preferred_position. Return ONLY a JSON object: {"status": "compliant"|"non_compliant"|"review_needed", "notes": "concise explanation referencing the actual clause language", "risk_level": "low"|"medium"|"high"}.',
 $r$[
   {"clause_type":"financial_covenants","clause_name":"Financial Covenants DSCR","clause_text":"Borrower shall maintain a Debt Service Coverage Ratio (DSCR) of not less than 1.25x, tested annually based on trailing twelve (12) months of Net Operating Income as of December 31 of each calendar year, with a seasonal adjustment mechanism permitting exclusion of the three lowest-revenue months.","preferred_position":"DSCR floor of 1.25x, tested annually not quarterly. Must include seasonal adjustment or trailing-12-month basis. Quarterly DSCR testing without seasonal carve-out is non-compliant.","party_role":"Borrower / Ski Resort"},
   {"clause_type":"cross_default","clause_name":"Cross-Default","clause_text":"An Event of Default shall occur if Borrower defaults on any other indebtedness or obligation in excess of 500000 after the expiration of any applicable grace or cure period.","preferred_position":"Cross-default threshold must be 500K or higher. No cross-default on immaterial obligations or affiliate debt without consent. Absence of a materiality threshold is non-compliant.","party_role":"Borrower / Ski Resort"},
   {"clause_type":"prepayment","clause_name":"Prepayment","clause_text":"Borrower may prepay the Loan in whole or in part at any time after the third (3rd) anniversary of the Closing Date without premium or penalty. Prior to the third anniversary, a step-down prepayment premium applies: 3% in year 1, 2% in year 2, 1% in year 3.","preferred_position":"No prepayment penalty after year 3. Step-down schedule in early years is acceptable. Flat prepayment penalty for life of loan or make-whole premium is non-compliant.","party_role":"Borrower / Ski Resort"},
   {"clause_type":"cure_period","clause_name":"Cure Period","clause_text":"Upon the occurrence of any Event of Default, Lender shall provide written notice to Borrower and Borrower shall have thirty (30) days to cure a financial covenant breach and sixty (60) days to cure a monetary default, prior to Lender exercising any remedies.","preferred_position":"30-day cure minimum for covenant breaches; 60-day cure for monetary defaults. Cure periods shorter than 15 days or absent entirely are non-compliant.","party_role":"Borrower / Ski Resort"}
 ]$r$::jsonb,
 true),

('pb_nda', 'nda', 'NDA Playbook',
 'Reviews NDA clauses to protect the company confidential information while ensuring reasonable mutual obligations and standard carve-outs.',
 'You are an experienced legal analyst specializing in commercial non-disclosure agreements. Review a single extracted clause from an NDA. Use the rule provided — compare the actual clause text against the model clause_text and preferred_position. A compliant clause reflects balanced, market-standard terms. A non_compliant clause is overly broad, perpetual, or one-sided relative to the preferred_position. Return ONLY a JSON object: {"status": "compliant"|"non_compliant"|"review_needed", "notes": "concise explanation referencing the actual clause language", "risk_level": "low"|"medium"|"high"}.',
 $r$[
   {"clause_type":"duration","clause_name":"Duration of Confidentiality Obligation","clause_text":"The obligations of confidentiality set forth herein shall survive for a period of three (3) years from the date of disclosure of the applicable Confidential Information.","preferred_position":"3-year sunset from date of disclosure. Perpetual confidentiality obligations or durations exceeding 5 years without business justification are non-compliant.","party_role":"Disclosing / Receiving Party"},
   {"clause_type":"scope","clause_name":"Definition of Confidential Information","clause_text":"Confidential Information means any information disclosed by one party to the other that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information, excluding information that: (i) is or becomes publicly available; (ii) was known to the receiving party prior to disclosure; (iii) is independently developed by the receiving party; or (iv) is received from a third party without restriction.","preferred_position":"Definition must include standard carve-outs: public domain, prior knowledge, independent development, third-party receipt. Absence of any carve-out is non-compliant.","party_role":"Both Parties"},
   {"clause_type":"mutuality","clause_name":"Mutual Obligations","clause_text":"Each party agrees to hold the other party's Confidential Information in strict confidence and to protect it with the same degree of care it uses to protect its own confidential information, but no less than reasonable care.","preferred_position":"Mutual obligations — both parties bear equal confidentiality duties. One-sided obligations on only the receiving party without justification is non-compliant.","party_role":"Both Parties"},
   {"clause_type":"remedies","clause_name":"Remedies for Breach","clause_text":"The parties acknowledge that breach of this Agreement may cause irreparable harm for which monetary damages would be an inadequate remedy, and that equitable relief, including injunction, shall be available. Monetary damages shall be limited to direct damages actually incurred.","preferred_position":"Equitable relief available but monetary damages capped at direct damages only. Unlimited damages, punitive damages, or consequential damages without cap are non-compliant.","party_role":"Both Parties"}
 ]$r$::jsonb,
 true),

('pb_insurance_policy', 'insurance_policy', 'Insurance Policy Review Playbook',
 'Reviews insurance policy clauses for coverage adequacy, proper additional insured status, and critical protections required for ski resort operations.',
 'You are an experienced legal analyst and insurance coverage specialist. Review a single extracted clause or coverage term from an insurance policy held by a ski resort company. Use the rule provided — compare the actual clause text against the model clause_text and preferred_position. A compliant clause meets minimum coverage standards for ski area operations. A non_compliant clause falls below the preferred_position thresholds. Return ONLY a JSON object: {"status": "compliant"|"non_compliant"|"review_needed", "notes": "concise explanation referencing the actual clause language", "risk_level": "low"|"medium"|"high"}.',
 $r$[
   {"clause_type":"gl_minimum","clause_name":"General Liability Limits","clause_text":"The Policy provides Commercial General Liability coverage with limits of not less than 5000000 per occurrence and 10000000 in the aggregate, including coverage for premises and operations, products and completed operations, and personal and advertising injury.","preferred_position":"5M per occurrence and 10M aggregate minimum. Coverage below these limits is non-compliant. No umbrella or excess layer specified when per-occurrence limit is below 5M is also non-compliant.","party_role":"Insured / Ski Resort Operator"},
   {"clause_type":"additional_insured","clause_name":"Additional Insured Status","clause_text":"The Policy is endorsed to include as Additional Insureds the Named Insured's parent company, all wholly-owned subsidiaries and affiliates, and such other parties as required by written contract, for liability arising out of the Named Insured's operations.","preferred_position":"All wholly-owned subsidiaries and affiliates must be additional insureds. Coverage limited to the named entity only, with no subsidiary coverage, is non-compliant.","party_role":"Insured / Ski Resort Operator"},
   {"clause_type":"cancellation_notice","clause_name":"Cancellation Notice","clause_text":"The insurer shall provide not less than thirty (30) days advance written notice to the Named Insured prior to any cancellation, non-renewal, or material reduction in coverage, except that ten (10) days notice is required for cancellation due to non-payment of premium.","preferred_position":"30-day advance written notice for cancellation or material change minimum. Less than 30 days, or notice only to broker and not the insured, is non-compliant.","party_role":"Insured / Ski Resort Operator"},
   {"clause_type":"waiver_of_subrogation","clause_name":"Waiver of Subrogation","clause_text":"The insurer waives all rights of subrogation against the Additional Insureds and against any party with whom the Named Insured has agreed in writing to waive such rights prior to the occurrence of any loss.","preferred_position":"Blanket waiver of subrogation in favor of additional insureds and contracting parties. No waiver, or waiver limited only to the named insured, is non-compliant.","party_role":"Insured / Ski Resort Operator"},
   {"clause_type":"claims_made_vs_occurrence","clause_name":"Coverage Trigger","clause_text":"Coverage under this Policy is provided on an occurrence basis, meaning coverage applies to bodily injury or property damage that occurs during the Policy period, regardless of when a claim is made.","preferred_position":"Occurrence-based trigger strongly preferred. Claims-made trigger without a minimum 5-year extended reporting period or adequate tail coverage is non-compliant.","party_role":"Insured / Ski Resort Operator"}
 ]$r$::jsonb,
 true)

ON CONFLICT (id) DO UPDATE SET
  document_type = EXCLUDED.document_type,
  name          = EXCLUDED.name,
  description   = EXCLUDED.description,
  groq_prompt   = EXCLUDED.groq_prompt,
  rules         = EXCLUDED.rules,
  active        = EXCLUDED.active,
  updated_at    = NOW();
