// State-level legal regulation data for Consumer Privacy, Data Security, and Background Checks.

export type LawStatus = 'active' | 'pending' | 'none';
export type BTBScope = 'none' | 'public' | 'public-private';

// ── Consumer Privacy ───────────────────────────────────────────────────────────
export interface PrivacyRow {
  abbr: string;
  state: string;
  status: LawStatus;
  lawName: string;
  effectiveDate: string;
  coveredEntities: string;
  rightsCount: number;
  privateRightOfAction: boolean;
  penalties: string;
}

// ── Data Security / Breach Notification ───────────────────────────────────────
export interface DataSecurityRow {
  abbr: string;
  state: string;
  statute: string;
  deadline: string;
  deadlineDays: number; // 0 = "most expedient"
  agNotice: boolean;
  agNoticeDays: string;
  creditMonitoring: boolean;
  encryptionExemption: boolean;
  privateRightOfAction: boolean;
}

// ── Background Checks ──────────────────────────────────────────────────────────
export interface BackgroundCheckRow {
  abbr: string;
  state: string;
  banTheBox: BTBScope;
  effectiveDate: string;
  salaryHistoryBan: boolean;
  creditCheckLimit: boolean;
  notes: string;
}

// ── Consumer Privacy data (all 50 states + DC) ────────────────────────────────
export const PRIVACY_DATA: PrivacyRow[] = [
  { abbr:'AL', state:'Alabama',       status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'AK', state:'Alaska',        status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'AZ', state:'Arizona',       status:'pending', lawName:'HB 2677 (2024)',  effectiveDate:'Pending',  coveredEntities:'TBD',                   rightsCount:4, privateRightOfAction:false, penalties:'TBD' },
  { abbr:'AR', state:'Arkansas',      status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'CA', state:'California',    status:'active',  lawName:'CCPA / CPRA',     effectiveDate:'Jan 2020 / Jan 2023', coveredEntities:'For-profit businesses meeting thresholds', rightsCount:6, privateRightOfAction:true, penalties:'Up to $7,500/intentional violation' },
  { abbr:'CO', state:'Colorado',      status:'active',  lawName:'CPA',             effectiveDate:'Jul 1, 2023', coveredEntities:'100K+ consumers or 25K+ + 25% revenue from data', rightsCount:5, privateRightOfAction:false, penalties:'Up to $20,000/violation' },
  { abbr:'CT', state:'Connecticut',   status:'active',  lawName:'CTDPA',           effectiveDate:'Jul 1, 2023', coveredEntities:'100K+ consumers or 25K+ + 25% revenue from data', rightsCount:5, privateRightOfAction:false, penalties:'Up to $5,000/violation' },
  { abbr:'DE', state:'Delaware',      status:'active',  lawName:'DPDPA',           effectiveDate:'Jan 1, 2025', coveredEntities:'35K+ consumers or 10K+ + 20% revenue from data', rightsCount:5, privateRightOfAction:false, penalties:'Up to $10,000/violation' },
  { abbr:'FL', state:'Florida',       status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'GA', state:'Georgia',       status:'pending', lawName:'SB 473 (2024)',   effectiveDate:'Pending',  coveredEntities:'TBD',                   rightsCount:3, privateRightOfAction:false, penalties:'TBD' },
  { abbr:'HI', state:'Hawaii',        status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'ID', state:'Idaho',         status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'IL', state:'Illinois',      status:'none',    lawName:'BIPA (biometric only)', effectiveDate:'Oct 2008', coveredEntities:'Biometric data processors', rightsCount:2, privateRightOfAction:true, penalties:'$1K–$5K/violation' },
  { abbr:'IN', state:'Indiana',       status:'active',  lawName:'IDPA',            effectiveDate:'Jan 1, 2026', coveredEntities:'100K+ consumers or 25K+ + 25% revenue from data', rightsCount:5, privateRightOfAction:false, penalties:'Up to $7,500/violation' },
  { abbr:'IA', state:'Iowa',          status:'active',  lawName:'ICDPA',           effectiveDate:'Jan 1, 2025', coveredEntities:'100K+ consumers or 25K+ + 50% revenue from data', rightsCount:4, privateRightOfAction:false, penalties:'Up to $7,500/violation' },
  { abbr:'KS', state:'Kansas',        status:'pending', lawName:'SB 494 (2024)',   effectiveDate:'Pending',  coveredEntities:'TBD',                   rightsCount:4, privateRightOfAction:false, penalties:'TBD' },
  { abbr:'KY', state:'Kentucky',      status:'pending', lawName:'SB 15 (2024)',    effectiveDate:'Pending',  coveredEntities:'TBD',                   rightsCount:4, privateRightOfAction:false, penalties:'TBD' },
  { abbr:'LA', state:'Louisiana',     status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'ME', state:'Maine',         status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'MD', state:'Maryland',      status:'active',  lawName:'MODPA',           effectiveDate:'Oct 1, 2025', coveredEntities:'35K+ consumers or 10K+ + 20% revenue from data', rightsCount:6, privateRightOfAction:false, penalties:'Up to $10,000/violation' },
  { abbr:'MA', state:'Massachusetts', status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'MI', state:'Michigan',      status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'MN', state:'Minnesota',     status:'active',  lawName:'MNDPA',           effectiveDate:'Jul 31, 2025', coveredEntities:'100K+ consumers or 25K+ + 25% revenue from data', rightsCount:6, privateRightOfAction:false, penalties:'Up to $7,500/violation' },
  { abbr:'MS', state:'Mississippi',   status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'MO', state:'Missouri',      status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'MT', state:'Montana',       status:'active',  lawName:'MCDPA',           effectiveDate:'Oct 1, 2024', coveredEntities:'50K+ consumers or 25K+ + 25% revenue from data', rightsCount:5, privateRightOfAction:false, penalties:'Up to $7,500/violation' },
  { abbr:'NE', state:'Nebraska',      status:'active',  lawName:'NDPA',            effectiveDate:'Jan 1, 2025', coveredEntities:'100K+ consumers or 25K+ + 25% revenue from data', rightsCount:5, privateRightOfAction:false, penalties:'Up to $7,500/violation' },
  { abbr:'NV', state:'Nevada',        status:'none',    lawName:'SB 370 (opt-out only)', effectiveDate:'Oct 2021', coveredEntities:'Operators of websites/online services', rightsCount:1, privateRightOfAction:false, penalties:'Up to $5,000/violation' },
  { abbr:'NH', state:'New Hampshire', status:'active',  lawName:'NHPDPA',          effectiveDate:'Jan 1, 2025', coveredEntities:'100K+ consumers or 25K+ + 25% revenue from data', rightsCount:5, privateRightOfAction:false, penalties:'Up to $10,000/violation' },
  { abbr:'NJ', state:'New Jersey',    status:'active',  lawName:'NJDPA',           effectiveDate:'Jan 15, 2025', coveredEntities:'100K+ consumers or 25K+ + 25% revenue from data', rightsCount:5, privateRightOfAction:false, penalties:'Up to $10,000/violation' },
  { abbr:'NM', state:'New Mexico',    status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'NY', state:'New York',      status:'pending', lawName:'SHIELD Act (breach only) / NYSPA pending', effectiveDate:'Breach: 2020', coveredEntities:'Data processors', rightsCount:2, privateRightOfAction:false, penalties:'Up to $5,000/violation (breach)' },
  { abbr:'NC', state:'North Carolina',status:'pending', lawName:'HB 973 (2024)',   effectiveDate:'Pending',  coveredEntities:'TBD',                   rightsCount:4, privateRightOfAction:false, penalties:'TBD' },
  { abbr:'ND', state:'North Dakota',  status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'OH', state:'Ohio',          status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'OK', state:'Oklahoma',      status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'OR', state:'Oregon',        status:'active',  lawName:'OCPA',            effectiveDate:'Jul 1, 2024', coveredEntities:'100K+ consumers or 25K+ + 25% revenue from data', rightsCount:6, privateRightOfAction:false, penalties:'Up to $7,500/violation' },
  { abbr:'PA', state:'Pennsylvania',  status:'pending', lawName:'HB 1842 (2024)',  effectiveDate:'Pending',  coveredEntities:'TBD',                   rightsCount:5, privateRightOfAction:false, penalties:'TBD' },
  { abbr:'RI', state:'Rhode Island',  status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'SC', state:'South Carolina',status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'SD', state:'South Dakota',  status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'TN', state:'Tennessee',     status:'active',  lawName:'TIPA',            effectiveDate:'Jul 1, 2025', coveredEntities:'100K+ consumers or 25K+ + 50% revenue from data', rightsCount:4, privateRightOfAction:false, penalties:'Up to $15,000/violation' },
  { abbr:'TX', state:'Texas',         status:'active',  lawName:'TDPSA',           effectiveDate:'Jul 1, 2024', coveredEntities:'Businesses except small businesses', rightsCount:5, privateRightOfAction:false, penalties:'Up to $7,500/violation' },
  { abbr:'UT', state:'Utah',          status:'active',  lawName:'UCPA',            effectiveDate:'Dec 31, 2023', coveredEntities:'100K+ consumers or 25K+ + 50% revenue from data', rightsCount:4, privateRightOfAction:false, penalties:'Up to $7,500/violation' },
  { abbr:'VT', state:'Vermont',       status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'VA', state:'Virginia',      status:'active',  lawName:'CDPA',            effectiveDate:'Jan 1, 2023', coveredEntities:'100K+ consumers or 25K+ + 50% revenue from data', rightsCount:5, privateRightOfAction:false, penalties:'Up to $7,500/violation' },
  { abbr:'WA', state:'Washington',    status:'none',    lawName:'My Health MY Data Act (health only)', effectiveDate:'Mar 2024', coveredEntities:'Health data processors', rightsCount:3, privateRightOfAction:true, penalties:'Up to $7,500/violation' },
  { abbr:'WV', state:'West Virginia', status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'WI', state:'Wisconsin',     status:'pending', lawName:'SB 279 (2024)',   effectiveDate:'Pending',  coveredEntities:'TBD',                   rightsCount:4, privateRightOfAction:false, penalties:'TBD' },
  { abbr:'WY', state:'Wyoming',       status:'none',    lawName:'—',               effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
  { abbr:'DC', state:'District of Columbia', status:'none', lawName:'—',          effectiveDate:'—',        coveredEntities:'—',                    rightsCount:0, privateRightOfAction:false, penalties:'—' },
];

// ── Data Security / Breach Notification data (all 50 states + DC) ─────────────
export const DATA_SECURITY_DATA: DataSecurityRow[] = [
  { abbr:'AL', state:'Alabama',        statute:'Ala. Code § 8-38-1 et seq.',        deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'AK', state:'Alaska',         statute:'Alaska Stat. § 45.48.010',           deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'AZ', state:'Arizona',        statute:'Ariz. Rev. Stat. § 18-551',          deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'AR', state:'Arkansas',       statute:'Ark. Code § 4-110-101 et seq.',      deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'CA', state:'California',     statute:'Cal. Civ. Code § 1798.29',           deadline:'Expedient',   deadlineDays:0,  agNotice:true,  agNoticeDays:'15 days (500+ CA residents)', creditMonitoring:true,  encryptionExemption:true,  privateRightOfAction:true },
  { abbr:'CO', state:'Colorado',       statute:'Colo. Rev. Stat. § 6-1-716',         deadline:'30 days',     deadlineDays:30, agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'CT', state:'Connecticut',    statute:'Conn. Gen. Stat. § 36a-701b',        deadline:'60 days',     deadlineDays:60, agNotice:true,  agNoticeDays:'simultaneous',creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'DE', state:'Delaware',       statute:'Del. Code tit. 6, § 12B-101',        deadline:'60 days',     deadlineDays:60, agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'FL', state:'Florida',        statute:'Fla. Stat. § 501.171',               deadline:'30 days',     deadlineDays:30, agNotice:true,  agNoticeDays:'30 days',      creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'GA', state:'Georgia',        statute:'Ga. Code § 10-1-910 et seq.',        deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'HI', state:'Hawaii',         statute:'Haw. Rev. Stat. § 487N-1 et seq.',   deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:false, privateRightOfAction:false },
  { abbr:'ID', state:'Idaho',          statute:'Idaho Code § 28-51-104',             deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'IL', state:'Illinois',       statute:'815 ILCS 530/1 et seq.',             deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'IN', state:'Indiana',        statute:'Ind. Code § 24-4.9-1-1 et seq.',     deadline:'Expedient',   deadlineDays:0,  agNotice:true,  agNoticeDays:'Simultaneous',creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'IA', state:'Iowa',           statute:'Iowa Code § 715C.1 et seq.',         deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'KS', state:'Kansas',         statute:'Kan. Stat. § 50-7a01 et seq.',       deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'KY', state:'Kentucky',       statute:'Ky. Rev. Stat. § 365.732',           deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'LA', state:'Louisiana',      statute:'La. Rev. Stat. § 51:3071 et seq.',   deadline:'60 days',     deadlineDays:60, agNotice:true,  agNoticeDays:'10 days',      creditMonitoring:false, encryptionExemption:false, privateRightOfAction:false },
  { abbr:'ME', state:'Maine',          statute:'Me. Rev. Stat. tit. 10, § 1347',     deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:false, privateRightOfAction:false },
  { abbr:'MD', state:'Maryland',       statute:'Md. Code, Com. Law § 14-3501',       deadline:'45 days',     deadlineDays:45, agNotice:true,  agNoticeDays:'45 days',      creditMonitoring:true,  encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'MA', state:'Massachusetts',  statute:'Mass. Gen. Laws ch. 93H',            deadline:'Expedient',   deadlineDays:0,  agNotice:true,  agNoticeDays:'Expedient',    creditMonitoring:false, encryptionExemption:false, privateRightOfAction:false },
  { abbr:'MI', state:'Michigan',       statute:'Mich. Comp. Laws § 445.72',          deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'MN', state:'Minnesota',      statute:'Minn. Stat. § 325E.61',              deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:false, privateRightOfAction:false },
  { abbr:'MS', state:'Mississippi',    statute:'Miss. Code § 75-24-29',              deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'MO', state:'Missouri',       statute:'Mo. Rev. Stat. § 407.1500',          deadline:'60 days',     deadlineDays:60, agNotice:true,  agNoticeDays:'Expedient',    creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'MT', state:'Montana',        statute:'Mont. Code § 30-14-1701 et seq.',    deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'NE', state:'Nebraska',       statute:'Neb. Rev. Stat. § 87-801 et seq.',   deadline:'60 days',     deadlineDays:60, agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'NV', state:'Nevada',         statute:'Nev. Rev. Stat. § 603A.010 et seq.', deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'NH', state:'New Hampshire',  statute:'N.H. Rev. Stat. § 359-C:19',         deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:false, privateRightOfAction:false },
  { abbr:'NJ', state:'New Jersey',     statute:'N.J. Stat. § 56:8-163',              deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'NM', state:'New Mexico',     statute:'N.M. Stat. § 57-12C-1 et seq.',      deadline:'45 days',     deadlineDays:45, agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:false, privateRightOfAction:false },
  { abbr:'NY', state:'New York',       statute:'N.Y. Gen. Bus. Law § 899-aa',        deadline:'Expedient',   deadlineDays:0,  agNotice:true,  agNoticeDays:'Expedient',    creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'NC', state:'North Carolina', statute:'N.C. Gen. Stat. § 75-61 et seq.',    deadline:'30 days',     deadlineDays:30, agNotice:true,  agNoticeDays:'Expedient',    creditMonitoring:false, encryptionExemption:false, privateRightOfAction:false },
  { abbr:'ND', state:'North Dakota',   statute:'N.D. Cent. Code § 51-30-01 et seq.', deadline:'30 days',     deadlineDays:30, agNotice:true,  agNoticeDays:'30 days',      creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'OH', state:'Ohio',           statute:'Ohio Rev. Code § 1349.19 et seq.',   deadline:'45 days',     deadlineDays:45, agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'OK', state:'Oklahoma',       statute:'Okla. Stat. tit. 74, § 3113.1',      deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'OR', state:'Oregon',         statute:'Or. Rev. Stat. § 646A.600 et seq.',  deadline:'45 days',     deadlineDays:45, agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:false, privateRightOfAction:false },
  { abbr:'PA', state:'Pennsylvania',   statute:'73 Pa. Cons. Stat. § 2301 et seq.',  deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'RI', state:'Rhode Island',   statute:'R.I. Gen. Laws § 11-49.3-1 et seq.', deadline:'45 days',     deadlineDays:45, agNotice:true,  agNoticeDays:'Expedient',    creditMonitoring:false, encryptionExemption:false, privateRightOfAction:false },
  { abbr:'SC', state:'South Carolina', statute:'S.C. Code § 39-1-90',                deadline:'60 days',     deadlineDays:60, agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'SD', state:'South Dakota',   statute:'S.D. Codified Laws § 22-40-26 et seq.', deadline:'60 days', deadlineDays:60, agNotice:true,  agNoticeDays:'60 days',      creditMonitoring:false, encryptionExemption:false, privateRightOfAction:false },
  { abbr:'TN', state:'Tennessee',      statute:'Tenn. Code § 47-18-2107',             deadline:'45 days',     deadlineDays:45, agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'TX', state:'Texas',          statute:'Tex. Bus. & Com. Code § 521.002',     deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'UT', state:'Utah',           statute:'Utah Code § 13-44-101 et seq.',       deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'VT', state:'Vermont',        statute:'Vt. Stat. tit. 9, § 2435',           deadline:'45 days',     deadlineDays:45, agNotice:true,  agNoticeDays:'45 days',      creditMonitoring:false, encryptionExemption:false, privateRightOfAction:false },
  { abbr:'VA', state:'Virginia',       statute:'Va. Code § 18.2-186.6',              deadline:'60 days',     deadlineDays:60, agNotice:true,  agNoticeDays:'60 days',      creditMonitoring:false, encryptionExemption:false, privateRightOfAction:false },
  { abbr:'WA', state:'Washington',     statute:'Wash. Rev. Code § 19.255.010',        deadline:'30 days',     deadlineDays:30, agNotice:true,  agNoticeDays:'Expedient',    creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'WV', state:'West Virginia',  statute:'W. Va. Code § 46A-2A-101 et seq.',   deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'WI', state:'Wisconsin',      statute:'Wis. Stat. § 134.98',                deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'WY', state:'Wyoming',        statute:'Wyo. Stat. § 40-12-501 et seq.',     deadline:'Expedient',   deadlineDays:0,  agNotice:false, agNoticeDays:'—',           creditMonitoring:false, encryptionExemption:true,  privateRightOfAction:false },
  { abbr:'DC', state:'District of Columbia', statute:'D.C. Code § 28-3851 et seq.', deadline:'Expedient',   deadlineDays:0,  agNotice:true,  agNoticeDays:'Expedient',    creditMonitoring:false, encryptionExemption:false, privateRightOfAction:false },
];

// ── Background Checks / Ban-the-Box data (all 50 states + DC) ─────────────────
export const BACKGROUND_CHECK_DATA: BackgroundCheckRow[] = [
  { abbr:'AL', state:'Alabama',        banTheBox:'none',           effectiveDate:'—',        salaryHistoryBan:false, creditCheckLimit:false, notes:'No statewide ban-the-box law' },
  { abbr:'AK', state:'Alaska',         banTheBox:'public',         effectiveDate:'Jan 2016', salaryHistoryBan:false, creditCheckLimit:false, notes:'Applies to state agencies only' },
  { abbr:'AZ', state:'Arizona',        banTheBox:'public',         effectiveDate:'Jan 2017', salaryHistoryBan:false, creditCheckLimit:false, notes:'State and local government employers' },
  { abbr:'AR', state:'Arkansas',       banTheBox:'none',           effectiveDate:'—',        salaryHistoryBan:false, creditCheckLimit:false, notes:'No statewide ban-the-box law' },
  { abbr:'CA', state:'California',     banTheBox:'public-private', effectiveDate:'Jan 2018', salaryHistoryBan:true,  creditCheckLimit:true,  notes:'Fair Chance Act; salary history ban effective Jan 2018' },
  { abbr:'CO', state:'Colorado',       banTheBox:'public-private', effectiveDate:'Sep 2019', salaryHistoryBan:true,  creditCheckLimit:false, notes:'HELP Act covers most employers; salary history ban effective Jan 2021' },
  { abbr:'CT', state:'Connecticut',    banTheBox:'public-private', effectiveDate:'Jan 2017', salaryHistoryBan:true,  creditCheckLimit:false, notes:'Covers employers with 1+ employees' },
  { abbr:'DE', state:'Delaware',       banTheBox:'public-private', effectiveDate:'Dec 2014', salaryHistoryBan:false, creditCheckLimit:false, notes:'Covers employers with 10+ employees (enforcement varies by county)' },
  { abbr:'FL', state:'Florida',        banTheBox:'none',           effectiveDate:'—',        salaryHistoryBan:false, creditCheckLimit:false, notes:'No statewide law; Miami-Dade has local ordinance' },
  { abbr:'GA', state:'Georgia',        banTheBox:'public',         effectiveDate:'Feb 2015', salaryHistoryBan:false, creditCheckLimit:false, notes:'Executive order for state agencies; no private employer coverage' },
  { abbr:'HI', state:'Hawaii',         banTheBox:'public-private', effectiveDate:'Jan 1999', salaryHistoryBan:true,  creditCheckLimit:true,  notes:'First state to pass ban-the-box; broad credit check restrictions' },
  { abbr:'ID', state:'Idaho',          banTheBox:'none',           effectiveDate:'—',        salaryHistoryBan:false, creditCheckLimit:false, notes:'No statewide ban-the-box law' },
  { abbr:'IL', state:'Illinois',       banTheBox:'public-private', effectiveDate:'Jan 2015', salaryHistoryBan:true,  creditCheckLimit:true,  notes:'Job Opportunities for Qualified Applicants Act; broad employer coverage' },
  { abbr:'IN', state:'Indiana',        banTheBox:'public',         effectiveDate:'May 2017', salaryHistoryBan:false, creditCheckLimit:false, notes:'Executive order for state agencies only' },
  { abbr:'IA', state:'Iowa',           banTheBox:'none',           effectiveDate:'—',        salaryHistoryBan:false, creditCheckLimit:false, notes:'No statewide law; Des Moines has local ordinance' },
  { abbr:'KS', state:'Kansas',         banTheBox:'public',         effectiveDate:'Dec 2014', salaryHistoryBan:false, creditCheckLimit:false, notes:'State employment only' },
  { abbr:'KY', state:'Kentucky',       banTheBox:'public',         effectiveDate:'Mar 2017', salaryHistoryBan:false, creditCheckLimit:false, notes:'State employment; executive order' },
  { abbr:'LA', state:'Louisiana',      banTheBox:'public',         effectiveDate:'Sep 2017', salaryHistoryBan:false, creditCheckLimit:false, notes:'State agencies only; executive order' },
  { abbr:'ME', state:'Maine',          banTheBox:'public-private', effectiveDate:'Oct 2021', salaryHistoryBan:false, creditCheckLimit:false, notes:'Covers employers with 5+ employees' },
  { abbr:'MD', state:'Maryland',       banTheBox:'public-private', effectiveDate:'Feb 2020', salaryHistoryBan:true,  creditCheckLimit:false, notes:'FAIR Act covers employers with 15+ employees' },
  { abbr:'MA', state:'Massachusetts',  banTheBox:'public-private', effectiveDate:'Aug 2010', salaryHistoryBan:true,  creditCheckLimit:true,  notes:'CORI Reform Act; one of earliest and strongest ban-the-box laws' },
  { abbr:'MI', state:'Michigan',       banTheBox:'public',         effectiveDate:'Dec 2018', salaryHistoryBan:false, creditCheckLimit:false, notes:'Executive order for state employment' },
  { abbr:'MN', state:'Minnesota',      banTheBox:'public-private', effectiveDate:'Jan 2014', salaryHistoryBan:false, creditCheckLimit:false, notes:'Covers employers with 10+ employees (Twin Cities: 1+ employees)' },
  { abbr:'MS', state:'Mississippi',    banTheBox:'none',           effectiveDate:'—',        salaryHistoryBan:false, creditCheckLimit:false, notes:'No statewide ban-the-box law' },
  { abbr:'MO', state:'Missouri',       banTheBox:'public',         effectiveDate:'Jun 2016', salaryHistoryBan:false, creditCheckLimit:false, notes:'State agencies and executive departments' },
  { abbr:'MT', state:'Montana',        banTheBox:'public',         effectiveDate:'Jan 2007', salaryHistoryBan:false, creditCheckLimit:false, notes:'State employment; limited scope' },
  { abbr:'NE', state:'Nebraska',       banTheBox:'public',         effectiveDate:'Mar 2014', salaryHistoryBan:false, creditCheckLimit:false, notes:'Executive order for state agencies' },
  { abbr:'NV', state:'Nevada',         banTheBox:'public-private', effectiveDate:'Jan 2017', salaryHistoryBan:false, creditCheckLimit:false, notes:'Employers with 15+ employees after conditional offer' },
  { abbr:'NH', state:'New Hampshire',  banTheBox:'public',         effectiveDate:'Sep 2010', salaryHistoryBan:false, creditCheckLimit:false, notes:'State employment only' },
  { abbr:'NJ', state:'New Jersey',     banTheBox:'public-private', effectiveDate:'Mar 2015', salaryHistoryBan:true,  creditCheckLimit:false, notes:'Opportunity to Compete Act; covers employers with 15+ employees' },
  { abbr:'NM', state:'New Mexico',     banTheBox:'public-private', effectiveDate:'Jun 2010', salaryHistoryBan:false, creditCheckLimit:false, notes:'Covers state agencies and contractors; some private employers' },
  { abbr:'NY', state:'New York',       banTheBox:'public-private', effectiveDate:'Jul 2015', salaryHistoryBan:true,  creditCheckLimit:true,  notes:'Article 23-A; salary history ban effective Jan 2020' },
  { abbr:'NC', state:'North Carolina', banTheBox:'none',           effectiveDate:'—',        salaryHistoryBan:false, creditCheckLimit:false, notes:'No statewide law; Charlotte has local ordinance' },
  { abbr:'ND', state:'North Dakota',   banTheBox:'none',           effectiveDate:'—',        salaryHistoryBan:false, creditCheckLimit:false, notes:'No statewide ban-the-box law' },
  { abbr:'OH', state:'Ohio',           banTheBox:'public',         effectiveDate:'Oct 2016', salaryHistoryBan:false, creditCheckLimit:false, notes:'State agencies; executive order' },
  { abbr:'OK', state:'Oklahoma',       banTheBox:'public',         effectiveDate:'Jan 2016', salaryHistoryBan:false, creditCheckLimit:false, notes:'State agencies; executive order' },
  { abbr:'OR', state:'Oregon',         banTheBox:'public-private', effectiveDate:'Jan 2016', salaryHistoryBan:true,  creditCheckLimit:false, notes:'Covers employers with 6+ employees; salary history ban effective Oct 2017' },
  { abbr:'PA', state:'Pennsylvania',   banTheBox:'public',         effectiveDate:'Apr 2012', salaryHistoryBan:false, creditCheckLimit:false, notes:'Philadelphia has private employer ordinance; statewide is public only' },
  { abbr:'RI', state:'Rhode Island',   banTheBox:'public-private', effectiveDate:'Jan 2013', salaryHistoryBan:false, creditCheckLimit:false, notes:'Covers employers with 4+ employees' },
  { abbr:'SC', state:'South Carolina', banTheBox:'none',           effectiveDate:'—',        salaryHistoryBan:false, creditCheckLimit:false, notes:'No statewide ban-the-box law' },
  { abbr:'SD', state:'South Dakota',   banTheBox:'none',           effectiveDate:'—',        salaryHistoryBan:false, creditCheckLimit:false, notes:'No statewide ban-the-box law' },
  { abbr:'TN', state:'Tennessee',      banTheBox:'public',         effectiveDate:'Jul 2016', salaryHistoryBan:false, creditCheckLimit:false, notes:'State agencies only' },
  { abbr:'TX', state:'Texas',          banTheBox:'public',         effectiveDate:'Sep 2015', salaryHistoryBan:false, creditCheckLimit:false, notes:'State agencies and contractors; executive order' },
  { abbr:'UT', state:'Utah',           banTheBox:'public',         effectiveDate:'Mar 2017', salaryHistoryBan:false, creditCheckLimit:false, notes:'State employment only' },
  { abbr:'VT', state:'Vermont',        banTheBox:'public-private', effectiveDate:'Jul 2016', salaryHistoryBan:true,  creditCheckLimit:false, notes:'Covers employers with 5+ employees; salary history ban effective Jul 2018' },
  { abbr:'VA', state:'Virginia',       banTheBox:'public-private', effectiveDate:'Jul 2020', salaryHistoryBan:true,  creditCheckLimit:false, notes:'Virginia Values Act; salary history ban effective Jul 2020' },
  { abbr:'WA', state:'Washington',     banTheBox:'public-private', effectiveDate:'Jun 2018', salaryHistoryBan:true,  creditCheckLimit:false, notes:'Fair Chance Act; covers most employers; salary history ban Jan 2023' },
  { abbr:'WV', state:'West Virginia',  banTheBox:'none',           effectiveDate:'—',        salaryHistoryBan:false, creditCheckLimit:false, notes:'No statewide ban-the-box law' },
  { abbr:'WI', state:'Wisconsin',      banTheBox:'public',         effectiveDate:'Dec 2015', salaryHistoryBan:false, creditCheckLimit:false, notes:'State agencies; executive order' },
  { abbr:'WY', state:'Wyoming',        banTheBox:'none',           effectiveDate:'—',        salaryHistoryBan:false, creditCheckLimit:false, notes:'No statewide ban-the-box law' },
  { abbr:'DC', state:'District of Columbia', banTheBox:'public-private', effectiveDate:'Dec 2014', salaryHistoryBan:true, creditCheckLimit:true, notes:'Fair Criminal Record Screening Amendment Act; very broad protections' },
];

// ── Driver Requirements (Legal Reqs sheet) ────────────────────────────────────
export type ReqStatus = 'required' | 'not required' | 'conditional' | 'available but not required' | 'none';

export interface DriverReqRow {
  abbr: string;
  state: string;
  legal_id: string;   // stable per-row id, e.g. 'CA-001' (one row per state, no sub-rule granularity yet)
  fingerprinting: ReqStatus;
  fingerprintingLaw: string;
  fingerprintingAgency: string;
  fingerprintingInterval: string;
  minAge: string;
  cans: ReqStatus;
  drugAlcohol: ReqStatus;
  medicalClearance: ReqStatus;
  training: ReqStatus;
  vehicleRequirement: ReqStatus;
  additionalRequirement: ReqStatus;
  requirementsCount: number;
  summary?: string;
}

export const DRIVER_REQ_DATA: DriverReqRow[] = [
  { abbr:'AZ', state:'Arizona',              legal_id:'AZ-001', fingerprinting:'required', fingerprintingLaw:'Arizona IVP Card Requirement (A.R.S. § 15-512)',          fingerprintingAgency:'Arizona DPS',                         fingerprintingInterval:'6 years',                       minAge:'23 years', cans:'required',                    drugAlcohol:'not required', medicalClearance:'none',     training:'none',     vehicleRequirement:'required', additionalRequirement:'none',     requirementsCount:2 },
  { abbr:'CA', state:'California',           legal_id:'CA-001', fingerprinting:'required', fingerprintingLaw:'California TrustLine Registry / CDSS Regulation',         fingerprintingAgency:'TrustLine / CDSS',                    fingerprintingInterval:'',                              minAge:'23 years', cans:'required',                    drugAlcohol:'required',     medicalClearance:'required', training:'required', vehicleRequirement:'required', additionalRequirement:'none',     requirementsCount:5 },
  { abbr:'CO', state:'Colorado',             legal_id:'CO-001', fingerprinting:'required', fingerprintingLaw:'Colorado CBI Fingerprinting Requirement',                  fingerprintingAgency:'Colorado Bureau of Investigation',    fingerprintingInterval:'',                              minAge:'23 years', cans:'required',                    drugAlcohol:'not required', medicalClearance:'required', training:'required', vehicleRequirement:'required', additionalRequirement:'none',     requirementsCount:4 },
  { abbr:'DC', state:'District of Columbia', legal_id:'DC-001', fingerprinting:'required', fingerprintingLaw:'DC Background Check Requirement',                          fingerprintingAgency:'',                                    fingerprintingInterval:'',                              minAge:'23 years', cans:'required',                    drugAlcohol:'conditional',  medicalClearance:'none',     training:'none',     vehicleRequirement:'required', additionalRequirement:'required', requirementsCount:2 },
  { abbr:'FL', state:'Florida',              legal_id:'FL-001', fingerprinting:'required', fingerprintingLaw:'Florida Jessica Lunsford Act / Level 2 Screening',         fingerprintingAgency:'',                                    fingerprintingInterval:'5 years',                       minAge:'23 years', cans:'not required',                drugAlcohol:'none',         medicalClearance:'none',     training:'none',     vehicleRequirement:'required', additionalRequirement:'required', requirementsCount:1 },
  { abbr:'GA', state:'Georgia',              legal_id:'GA-001', fingerprinting:'required', fingerprintingLaw:'Georgia Background Check Requirement',                     fingerprintingAgency:'',                                    fingerprintingInterval:'5 years',                       minAge:'23 years', cans:'none',                        drugAlcohol:'required',     medicalClearance:'required', training:'none',     vehicleRequirement:'required', additionalRequirement:'none',     requirementsCount:3 },
  { abbr:'IN', state:'Indiana',              legal_id:'IN-001', fingerprinting:'required', fingerprintingLaw:'Indiana Background Check Requirement',                     fingerprintingAgency:'',                                    fingerprintingInterval:'5 years',                       minAge:'23 years', cans:'required',                    drugAlcohol:'not required', medicalClearance:'none',     training:'none',     vehicleRequirement:'required', additionalRequirement:'none',     requirementsCount:2 },
  { abbr:'KS', state:'Kansas',               legal_id:'KS-001', fingerprinting:'required', fingerprintingLaw:'Kansas Bureau of Investigation Background Check',          fingerprintingAgency:'Kansas Bureau of Investigation',      fingerprintingInterval:'',                              minAge:'23 years', cans:'available but not required',  drugAlcohol:'not required', medicalClearance:'none',     training:'none',     vehicleRequirement:'required', additionalRequirement:'none',     requirementsCount:1 },
  { abbr:'MI', state:'Michigan',             legal_id:'MI-001', fingerprinting:'required', fingerprintingLaw:'Michigan Background Check Requirement',                    fingerprintingAgency:'',                                    fingerprintingInterval:'5 years',                       minAge:'23 years', cans:'required',                    drugAlcohol:'not required', medicalClearance:'none',     training:'none',     vehicleRequirement:'required', additionalRequirement:'none',     requirementsCount:2 },
  { abbr:'MN', state:'Minnesota',            legal_id:'MN-001', fingerprinting:'required', fingerprintingLaw:'Minnesota Background Check Statute (§ 245C)',              fingerprintingAgency:'',                                    fingerprintingInterval:'',                              minAge:'23 years', cans:'available but not required',  drugAlcohol:'required',     medicalClearance:'required', training:'none',     vehicleRequirement:'required', additionalRequirement:'none',     requirementsCount:3 },
  { abbr:'MO', state:'Missouri',             legal_id:'MO-001', fingerprinting:'required', fingerprintingLaw:'Missouri Background Check Requirement',                    fingerprintingAgency:'',                                    fingerprintingInterval:'5 years',                       minAge:'23 years', cans:'required',                    drugAlcohol:'not required', medicalClearance:'none',     training:'none',     vehicleRequirement:'required', additionalRequirement:'none',     requirementsCount:2 },
  { abbr:'NV', state:'Nevada',               legal_id:'NV-001', fingerprinting:'required', fingerprintingLaw:'Nevada DPS Fingerprinting Requirement',                    fingerprintingAgency:'Nevada DPS',                          fingerprintingInterval:'5 years',                       minAge:'23 years', cans:'required',                    drugAlcohol:'not required', medicalClearance:'none',     training:'none',     vehicleRequirement:'required', additionalRequirement:'none',     requirementsCount:2 },
  { abbr:'PA', state:'Pennsylvania',         legal_id:'PA-001', fingerprinting:'required', fingerprintingLaw:'Pennsylvania Child Protective Services Law (CPSL)',        fingerprintingAgency:'',                                    fingerprintingInterval:'Every 5 years for clearance renewal', minAge:'23 years', cans:'required',             drugAlcohol:'not required', medicalClearance:'none',     training:'none',     vehicleRequirement:'required', additionalRequirement:'required', requirementsCount:2 },
  { abbr:'TN', state:'Tennessee',            legal_id:'TN-001', fingerprinting:'required', fingerprintingLaw:'Tennessee Background Check Requirement',                   fingerprintingAgency:'',                                    fingerprintingInterval:'5 years',                       minAge:'23 years', cans:'required',                    drugAlcohol:'not required', medicalClearance:'none',     training:'none',     vehicleRequirement:'required', additionalRequirement:'none',     requirementsCount:2 },
  { abbr:'TX', state:'Texas',                legal_id:'TX-001', fingerprinting:'required', fingerprintingLaw:'Texas Education Code § 22.0834 (TxDPS)',                   fingerprintingAgency:'Texas DPS',                           fingerprintingInterval:'',                              minAge:'23 years', cans:'not required',                drugAlcohol:'not required', medicalClearance:'none',     training:'none',     vehicleRequirement:'required', additionalRequirement:'required', requirementsCount:1 },
  { abbr:'VA', state:'Virginia',             legal_id:'VA-001', fingerprinting:'required', fingerprintingLaw:'Virginia Background Check Requirement',                    fingerprintingAgency:'',                                    fingerprintingInterval:'',                              minAge:'23 years', cans:'required',                    drugAlcohol:'not required', medicalClearance:'required', training:'required', vehicleRequirement:'required', additionalRequirement:'none',     requirementsCount:4 },
  { abbr:'WA', state:'Washington',           legal_id:'WA-001', fingerprinting:'required', fingerprintingLaw:'Washington State Patrol Background Check Requirement',     fingerprintingAgency:'Washington State Patrol',             fingerprintingInterval:'',                              minAge:'23 years', cans:'required',                    drugAlcohol:'not required', medicalClearance:'none',     training:'none',     vehicleRequirement:'required', additionalRequirement:'none',     requirementsCount:2 },
  { abbr:'WI', state:'Wisconsin',            legal_id:'WI-001', fingerprinting:'required', fingerprintingLaw:'Wisconsin Caregiver Background Check (Ch. 50)',            fingerprintingAgency:'',                                    fingerprintingInterval:'4 years',                       minAge:'23 years', cans:'required',                    drugAlcohol:'not required', medicalClearance:'none',     training:'none',     vehicleRequirement:'required', additionalRequirement:'none',     requirementsCount:2 },
];

// ── Recording Consent / State Jurisdiction ────────────────────────────────────

// Three explicit, independent legal pillars per state (plus a plain-language
// compliance note) — deliberately NOT collapsed into one "enforcement level"
// field, since a ride can be non-compliant under any one of the three
// independently of the other two.
export interface RecordingConsentRow {
  abbr: string;
  state: string;
  comprehensivePrivacyLaw: string;   // general consumer data law, or 'N/A (Common Law Only)'
  wiretapCitation: string;           // criminal cabin-audio statute citation
  wiretapStandard: string;           // 'One-Party' | 'All-Party' | 'Mixed (...)' | 'One-Party (Judicial Rule)'
  biometricLaw: string;              // facial/voiceprint statute citation, or 'N/A (Common Law Only)'
  biometricStatus: string;           // 'Opt-In Required' | 'Written Opt-In Required' | 'Recording Excluded' | 'No Code'
  complianceTrap: string;            // plain-language override / compliance-trap note
}

export const RECORDING_CONSENT_DATA: RecordingConsentRow[] = [
  { abbr: 'AL', state: 'Alabama', comprehensivePrivacyLaw: 'Alabama Consumer Privacy Act', wiretapCitation: 'Ala. Code § 13A-11-30(1)', wiretapStandard: 'One-Party', biometricLaw: 'Ala. Code § 8-38A-2', biometricStatus: 'Opt-In Required', complianceTrap: "Standard wiretap is One-Party, but the Consumer Privacy Act enforces a strict opt-in loop for processing minors' sensitive facial records." },
  { abbr: 'AK', state: 'Alaska', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'AS § 42.20.300(a)', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'No standalone biometric or data act; general common law civil invasion of privacy / seclusion tort boundaries apply.' },
  { abbr: 'AZ', state: 'Arizona', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'A.R.S. § 13-3012(9)', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Passive dashcam audio tracking is protected by the one-party rule if the active driver initializes the digital feed.' },
  { abbr: 'AR', state: 'Arkansas', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'Ark. Code Ann. § 5-60-120', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Passenger audio collection is safe under the single-party wiretap baseline; common law governs video frame exposures.' },
  { abbr: 'CA', state: 'California', comprehensivePrivacyLaw: 'CCPA / CPRA', wiretapCitation: 'Cal. Penal Code § 632', wiretapStandard: 'All-Party', biometricLaw: 'Cal. Civ. Code § 1798.140(ae)', biometricStatus: 'Opt-In Required', complianceTrap: 'Double-jeopardy zone. Both laws mandate direct consent. Completely kill camera streams and mute audio if any user profile lacks opt-in.' },
  { abbr: 'CO', state: 'Colorado', comprehensivePrivacyLaw: 'Colorado Privacy Act (CPA)', wiretapCitation: 'C.R.S. § 18-9-303', wiretapStandard: 'One-Party', biometricLaw: 'C.R.S. § 6-1-1303(24)(b)', biometricStatus: 'Opt-In Required', complianceTrap: 'The general wiretap code is One-Party, but the CPA forces biometric opt-ins. School routes trigger strict SDTSA contract rules.' },
  { abbr: 'CT', state: 'Connecticut', comprehensivePrivacyLaw: 'CT Data Privacy Act (CTDPA)', wiretapCitation: 'C.G.S.A. § 52-570d', wiretapStandard: 'Mixed (All-Party Phone)', biometricLaw: 'C.G.S.A. § 42-515(45)', biometricStatus: 'Opt-In Required', complianceTrap: 'Phone-line route alerts trigger all-party civil standards; consumer data codes mandate direct opt-in for unique face sweeps.' },
  { abbr: 'DE', state: 'Delaware', comprehensivePrivacyLaw: 'Delaware Personal Data Privacy Act', wiretapCitation: '11 Del. C. § 2402', wiretapStandard: 'All-Party', biometricLaw: '6 Del. C. § 12D-102(3)', biometricStatus: 'Opt-In Required', complianceTrap: "Criminal intercept charges apply to secret audio; separate consumer privacy text locks down minors' sensitive biometric markers." },
  { abbr: 'DC', state: 'District of Columbia', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'D.C. Code § 23-542(b)', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Follows federal baseline. Driver participation permits clear local recording loops with low operational wiretap liability.' },
  { abbr: 'FL', state: 'Florida', comprehensivePrivacyLaw: 'Florida Digital Bill of Rights (FDBR)', wiretapCitation: 'Fla. Stat. § 934.03', wiretapStandard: 'All-Party', biometricLaw: 'Fla. Stat. § 501.702(31)', biometricStatus: 'Opt-In Required', complianceTrap: 'Strict all-party audio rules operate alongside massive digital tracking blocks for commercial tech platforms using user feeds.' },
  { abbr: 'GA', state: 'Georgia', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'O.C.G.A. § 16-11-66', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'One-party wiretap baseline shields fleet platforms unless a specific criminal or tortious intent is logged in the backend.' },
  { abbr: 'HI', state: 'Hawaii', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'H.R.S. § 803-42', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Standard active participant verification handles automated cloud archiving pathways cleanly under local rules.' },
  { abbr: 'ID', state: 'Idaho', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'Idaho Code § 18-6702', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'In-car recording arrays are safe from criminal interception charges if the commercial operator remains an open participant.' },
  { abbr: 'IL', state: 'Illinois', comprehensivePrivacyLaw: 'N/A (Governed by BIPA)', wiretapCitation: '720 ILCS 5/14-2', wiretapStandard: 'All-Party', biometricLaw: '740 ILCS 14/15(b)', biometricStatus: 'Written Opt-In Required', complianceTrap: 'Major threat vector. Audio wiretapping requires all-party consent, and BIPA facial/voice processing triggers severe civil class actions.' },
  { abbr: 'IN', state: 'Indiana', comprehensivePrivacyLaw: 'Indiana Consumer Data Protection Act', wiretapCitation: 'Ind. Code § 35-31.5-2', wiretapStandard: 'One-Party', biometricLaw: 'Ind. Code § 24-15-2-26', biometricStatus: 'Opt-In Required', complianceTrap: 'Traditional audio is clear via driver consent, but sensitive data codes enforce an immediate opt-in check box for face geometry.' },
  { abbr: 'IA', state: 'Iowa', comprehensivePrivacyLaw: 'Iowa Consumer Data Protection Act', wiretapCitation: 'Iowa Code § 808B.2', wiretapStandard: 'One-Party', biometricLaw: 'Iowa Code § 715D.1(27)', biometricStatus: 'Opt-In Required', complianceTrap: 'General consumer profiles follow default opt-outs, but the biometric tracking pipeline requires an explicit, active opt-in loop.' },
  { abbr: 'KS', state: 'Kansas', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'K.S.A. § 21-6101', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'No standalone or sensitive data codes exist; driver hardware activation clears local eavesdropping text.' },
  { abbr: 'KY', state: 'Kentucky', comprehensivePrivacyLaw: 'Kentucky Consumer Data Protection Act', wiretapCitation: 'K.R.S. § 526.020', wiretapStandard: 'One-Party', biometricLaw: 'K.R.S. § 367.3611', biometricStatus: 'Opt-In Required', complianceTrap: 'Direct opt-in framework mandates immediate backend data segmentation to screen out non-consenting minor route streams.' },
  { abbr: 'LA', state: 'Louisiana', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'La. R.S. § 15:1303', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Electronic Surveillance rules isolate third-party taps; active driver presence covers automated video platform sweeps.' },
  { abbr: 'ME', state: 'Maine', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: '15 M.R.S. § 710', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Single-user device awareness insulates fleet dashboard deployments within private or commercial route spaces.' },
  { abbr: 'MD', state: 'Maryland', comprehensivePrivacyLaw: 'Maryland Online Data Privacy Act (MODPA)', wiretapCitation: 'Md. Code, Cts. & Jud. Proc. § 10-402', wiretapStandard: 'All-Party', biometricLaw: 'MODPA 2024 ch. 455', biometricStatus: 'Opt-In Required', complianceTrap: 'Highly restrictive. Wiretap laws demand total audio consent, and modern MODPA codes completely ban minor biometric profiling.' },
  { abbr: 'MA', state: 'Massachusetts', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'Mass. Gen. Laws ch. 272 § 99', wiretapStandard: 'All-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'No unique geometric data codes, but secret audio recording is a severe felony; app must broadcast active verbal or visual alerts.' },
  { abbr: 'MI', state: 'Michigan', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'M.C.L. § 750.539c', wiretapStandard: 'One-Party (Judicial Rule)', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Appellate rulings shield active recording participants from wiretapping charges; general common law tort covers video file leaks.' },
  { abbr: 'MN', state: 'Minnesota', comprehensivePrivacyLaw: 'Minnesota Consumer Data Privacy Act', wiretapCitation: 'Minn. Stat. § 626A.02', wiretapStandard: 'One-Party', biometricLaw: 'Minn. Stat. § 325O.02', biometricStatus: 'Opt-In Required', complianceTrap: 'Modern MCDPA sensitive data codes prohibit vehicles or public systems from executing unconsented facial analysis streams.' },
  { abbr: 'MS', state: 'Mississippi', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'Miss. Code § 41-29-531', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Simple telecommunication authorization blocks ensure baseline in-car application logging is clear from local barriers.' },
  { abbr: 'MO', state: 'Missouri', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'V.A.M.S. § 542.402', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Traditional single-user validation rules allow basic telemetry data compile scripts and local vehicle tracking.' },
  { abbr: 'MT', state: 'Montana', comprehensivePrivacyLaw: 'Montana Consumer Data Privacy Act', wiretapCitation: 'Mont. Code § 45-8-213', wiretapStandard: 'All-Party', biometricLaw: 'Mont. Code § 30-14-2801', biometricStatus: 'Opt-In Required', complianceTrap: 'Wiretap text demands total notice for audio loops; sensitive data codes enforce immediate file deletion if a parent revokes consent.' },
  { abbr: 'NE', state: 'Nebraska', comprehensivePrivacyLaw: 'Nebraska Data Privacy Act (NDPA)', wiretapCitation: 'Neb. Rev. Stat. § 86-290', wiretapStandard: 'One-Party', biometricLaw: 'NDPA 2024 Sec. 2', biometricStatus: 'Opt-In Required', complianceTrap: 'Consumer privacy text locks down biometric fields to restrict corporate data profiling of minor dashboard metrics.' },
  { abbr: 'NV', state: 'Nevada', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'N.R.S. § 200.620', wiretapStandard: 'Mixed (All-Party Phone)', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'In-person audio loops fall under one-party consent, but the State Supreme Court enforces strict all-party parameters for active phone wiretaps.' },
  { abbr: 'NH', state: 'New Hampshire', comprehensivePrivacyLaw: 'NH Privacy Act (NHPA)', wiretapCitation: 'N.H. Rev. Stat. § 570-A:2', wiretapStandard: 'All-Party', biometricLaw: 'NHPA 2024 Sec. 3', biometricStatus: 'Opt-In Required', complianceTrap: 'Audio features require total consensus; sensitive data rules demand an active digital check box before running camera sweeps.' },
  { abbr: 'NJ', state: 'New Jersey', comprehensivePrivacyLaw: 'New Jersey Privacy Act (NJPA)', wiretapCitation: 'N.J.S.A. § 2A:156A-4', wiretapStandard: 'One-Party', biometricLaw: 'NJPA 2024 Sec. 4', biometricStatus: 'Opt-In Required', complianceTrap: 'Strict sensitive profiling criteria; cloud syncing unauthorized minor facial files triggers immediate corporate breach liabilities.' },
  { abbr: 'NM', state: 'New Mexico', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'N.M. Stat. § 30-12-1', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Simple communication safe harbors protect internal tracking pipelines if the operator is an active participant.' },
  { abbr: 'NY', state: 'New York', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'N.Y. Penal Law § 250.00', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Explicit single-party audio wiretap baseline ensures commercial transit applications face minimal criminal exposure.' },
  { abbr: 'NC', state: 'North Carolina', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'N.C. Gen. Stat. § 15A-287', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Device logs and simple cabin audio clips are fully insulated under standard single-user system permissions.' },
  { abbr: 'ND', state: 'North Dakota', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'N.D. Cent. Code § 12.1-15-02', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Safe from local interception targets unless an explicit intent to execute an independent fraud or civil injury is verified.' },
  { abbr: 'OH', state: 'Ohio', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'R.C. § 2933.52', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Voice storage and hardware line checks remain unencumbered if at least one in-car party acknowledges the feed.' },
  { abbr: 'OK', state: 'Oklahoma', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: '13 O.S. § 176.4', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Regulated under state Security of Communications code; mirrors federal rules for participant-driven apps.' },
  { abbr: 'OR', state: 'Oregon', comprehensivePrivacyLaw: 'Oregon Consumer Privacy Act (OCPA)', wiretapCitation: 'O.R.S. § 165.540', wiretapStandard: 'Mixed (All-Party In-Person)', biometricLaw: 'OCPA 2023 Sec. 1', biometricStatus: 'Opt-In Required', complianceTrap: 'Wiretap act requires explicit notice for in-person chat; separate OCPA codes enforce strict biometric opt-in structures.' },
  { abbr: 'PA', state: 'Pennsylvania', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: '18 Pa.C.S. § 5702', wiretapStandard: 'All-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Severe criminal audio intercept rules. High risk if smart arrays capture voice channels without unanimous occupant permission.' },
  { abbr: 'RI', state: 'Rhode Island', comprehensivePrivacyLaw: 'Rhode Island Data Transparency Act', wiretapCitation: 'R.I. Gen. Laws § 11-35-21', wiretapStandard: 'One-Party', biometricLaw: 'RIDTA 2024 Sec. 2', biometricStatus: 'Opt-In Required', complianceTrap: 'General audio wiretapping uses a single-party rule, but the data act mandates plain-language warnings for facial sweeps.' },
  { abbr: 'SC', state: 'South Carolina', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'S.C. Code § 17-30-30', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Insulates internal processing nodes if initialized and approved directly by an active company agent or driver.' },
  { abbr: 'SD', state: 'South Dakota', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'SDCL § 23A-35A-20', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Core database log pathways remain secure from state wiretap challenges under basic single-user authorization rules.' },
  { abbr: 'TN', state: 'Tennessee', comprehensivePrivacyLaw: 'TN Information Protection Act (TIPA)', wiretapCitation: 'Tenn. Code § 39-13-601', wiretapStandard: 'One-Party', biometricLaw: 'TIPA 2023 Sec. 3', biometricStatus: 'Opt-In Required', complianceTrap: 'Sensitive processing metrics require explicit corporate risk assessment logs to validate geometric collection pathways.' },
  { abbr: 'TX', state: 'Texas', comprehensivePrivacyLaw: 'Texas Data Privacy and Security Act', wiretapCitation: 'Tex. Penal Code § 16.02', wiretapStandard: 'One-Party', biometricLaw: 'Tex. Bus. & Com. Code § 503.001(b)', biometricStatus: 'Opt-In Required', complianceTrap: 'Massive split-state trap. Audio wiretapping is completely clear via One-Party consent, but CUBI mandates strict direct opt-ins for facial geometry.' },
  { abbr: 'UT', state: 'Utah', comprehensivePrivacyLaw: 'Utah Consumer Privacy Act (UCPA)', wiretapCitation: 'Utah Code § 77-23a-4', wiretapStandard: 'One-Party', biometricLaw: 'Utah Code § 13-61-101(6)(c)', biometricStatus: 'Recording Excluded', complianceTrap: 'SAFE ZONE. The statute explicitly excludes raw video and audio recordings from biometric rules. Wiretap driver-consent fully covers operations.' },
  { abbr: 'VT', state: 'Vermont', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'N/A (Case Law Controlled)', wiretapStandard: 'Mixed (Location-Based)', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'No text codes; case law insulates open commercial transport environments but strictly bars recordings inside private domains.' },
  { abbr: 'VA', state: 'Virginia', comprehensivePrivacyLaw: 'VA Consumer Data Protection Act', wiretapCitation: 'Va. Code § 19.2-62', wiretapStandard: 'One-Party', biometricLaw: 'Va. Code Ann. § 59.1-571', biometricStatus: 'Recording Excluded', complianceTrap: 'SAFE ZONE. Similar to Utah, Virginia explicitly carves physical photographs and video out of biometric definitions. Driver wiretap consent covers the route.' },
  { abbr: 'WA', state: 'Washington', comprehensivePrivacyLaw: 'N/A (Governed by HB 1493)', wiretapCitation: 'RCW 9.73.030', wiretapStandard: 'All-Party', biometricLaw: 'RCW 19.375.020', biometricStatus: 'Opt-In Required', complianceTrap: 'Severe double-layer risk. The wiretap law mandates all-party audio consent, and HB 1493 enforces strict biometric data blocks.' },
  { abbr: 'WV', state: 'West Virginia', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'W. Va. Code § 62-1D-3', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Internal data structures remain safe if at least one active user establishes the baseline recording authorization block.' },
  { abbr: 'WI', state: 'Wisconsin', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'Wis. Stat. § 968.31', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Criminally legal under the single-party wiretap baseline, but civil courts block voice records unless physical notice signs are active.' },
  { abbr: 'WY', state: 'Wyoming', comprehensivePrivacyLaw: 'N/A (Common Law Only)', wiretapCitation: 'Wyo. Stat. § 7-3-702', wiretapStandard: 'One-Party', biometricLaw: 'N/A (Common Law Only)', biometricStatus: 'No Code', complianceTrap: 'Standard federal layout rules protect participant-driven audio capture arrays from local interception disputes.' },
];

export function isAllPartyWiretap(row: RecordingConsentRow): boolean {
  return row.wiretapStandard.includes('All-Party');
}

export function requiresBiometricOptIn(row: RecordingConsentRow): boolean {
  return row.biometricStatus.includes('Opt-In');
}

export function hasRecordingExclusion(row: RecordingConsentRow): boolean {
  return row.biometricStatus === 'Recording Excluded';
}

export function hasComprehensivePrivacyLaw(row: RecordingConsentRow): boolean {
  return !row.comprehensivePrivacyLaw.startsWith('N/A');
}

// ── State centroid coordinates for map markers ─────────────────────────────────
export const STATE_COORDS_REG: Record<string, [number, number]> = {
  AL:[32.8,-86.8], AK:[64.2,-153.4], AZ:[34.3,-111.6], AR:[34.8,-92.2], CA:[36.8,-119.4],
  CO:[39.0,-105.5], CT:[41.6,-72.7], DE:[39.0,-75.5], FL:[28.7,-82.5], GA:[32.7,-83.2],
  HI:[20.9,-156.4], ID:[44.1,-114.5], IL:[40.0,-89.2], IN:[39.8,-86.2], IA:[42.0,-93.5],
  KS:[38.5,-98.4], KY:[37.5,-85.3], LA:[31.1,-91.9], ME:[44.6,-69.4], MD:[38.8,-76.6],
  MA:[42.2,-71.5], MI:[44.4,-85.4], MN:[46.4,-93.1], MS:[32.7,-89.7], MO:[38.5,-92.3],
  MT:[46.9,-110.5], NE:[41.1,-98.3], NV:[38.3,-117.1], NH:[43.5,-71.6], NJ:[40.1,-74.4],
  NM:[34.3,-106.0], NY:[42.9,-75.5], NC:[35.5,-79.4], ND:[47.4,-100.5], OH:[40.4,-82.8],
  OK:[35.6,-96.9], OR:[44.1,-120.5], PA:[40.9,-77.8], RI:[41.7,-71.5], SC:[33.8,-80.9],
  SD:[44.3,-100.2], TN:[35.7,-86.6], TX:[31.0,-97.6], UT:[39.3,-111.1], VT:[44.1,-72.7],
  VA:[37.4,-78.9], WA:[47.4,-120.7], WV:[38.6,-80.4], WI:[44.4,-89.8], WY:[43.0,-107.6],
  DC:[38.9,-77.0],
};
