/**
 * Rule-Based Clause Extractor
 * Ported from clause-lab/src/services/ruleBasedExtractor.ts
 * Google Sheets integration removed.
 */

export interface ExtractedClause {
  clause_no: string;
  clause_name?: string;   // heading title as it appears in the document, e.g. "Services"
  clause_text: string;
  detected_type: string;
  confidence: number;
  char_start: number;
  char_end: number;
}

export interface NumberingSchema {
  mainClause: string;
  subClause1: string;
  subClause2: string;
  subClause3?: string;
  subclauseMode?: 'combined' | 'separate';
  miscellaneousMode?: 'combined' | 'separate';
}

export const NUMBERING_SCHEMAS: Record<string, string> = {
  'numeric':               '1. 2. 3.',
  'numeric-bare':          '1 2 3 (no period)',
  'numeric-paren':         '1) 2) 3)',
  'paren-numeric':         '(1) (2) (3)',
  'decimal':               '1.1, 1.2, 2.1…',
  'decimal-period':        '1.1., 1.2., 1.3. (trailing period)',
  'decimal-zero':          '1.0, 2.0, 3.0…',
  'decimal-triple':        '1.1.1, 1.2.1…',
  'decimal-triple-period': '1.1.1., 1.1.2. (trailing period)',
  'alpha-upper':       'A. B. C.',
  'alpha-lower':       'a. b. c.',
  'alpha-lower-paren': 'a) b) c)',
  'paren-alpha':       '(a) (b) (c)',
  'roman-upper':       'I. II. III.',
  'roman-lower':       'i. ii. iii.',
  'roman-upper-paren': 'I) II) III)',
  'roman-lower-paren': 'i) ii) iii)',
  'paren-roman-upper': '(I) (II) (III)',
  'paren-roman-lower': '(i) (ii) (iii)',
  'section':           'Section 1., Section 2.',
  'section-decimal':   'Section 1. (with 1.1 subs)',
  'section-bare':      'Section 1 / Section I / Article 1 / Article I (no period)',
  'article':           'Article I., Article II.',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeText(text: string): string {
  if (!text) return text;
  let result = text
    .split('')
    .map(char => {
      const code = char.charCodeAt(0);
      if (
        (code >= 0x0009 && code <= 0x000D && code !== 0x000A && code !== 0x000D) ||
        code === 0x0020 ||
        code === 0x00A0 ||
        code === 0x1680 ||
        (code >= 0x2000 && code <= 0x200A) ||
        code === 0x202F ||
        code === 0x205F ||
        code === 0x3000 ||
        code === 0xFEFF
      ) {
        return ' ';
      }
      return char;
    })
    .join('');
  result = result.replace(/ +/g, ' ');
  result = result.split('\n').map(line => line.trim()).join('\n');
  return result.trim();
}

export function removePageNumbers(text: string): string {
  let cleaned = text;

  // ── DocuSign / e-signature artifacts ─────────────────────────────────────
  // "DocuSign Envelope ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" (entire line)
  cleaned = cleaned.replace(
    /\n[^\n]*DocuSign\s+Envelope\s+ID\s*:\s*[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}[^\n]*\n/gi,
    '\n',
  );
  // "Envelope ID: <guid>" (without DocuSign prefix)
  cleaned = cleaned.replace(
    /\n[^\n]*\bEnvelope\s+ID\s*:\s*[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}[^\n]*\n/gi,
    '\n',
  );
  // Standalone UUID line (DocuSign watermark repeated on every page)
  cleaned = cleaned.replace(
    /\n\s*[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\s*\n/g,
    '\n',
  );
  // Inline UUID remnants not caught above (e.g. at very start or end of text)
  cleaned = cleaned.replace(
    /^[^\n]*\bEnvelope\s+ID\s*:\s*[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}[^\n]*/gim,
    '',
  );

  // ── Stray page numbers ────────────────────────────────────────────────────
  cleaned = cleaned.replace(/\n\s*(\d{1,3})\s*\n/g, '\n\n');
  cleaned = cleaned.replace(/\n\s*Page\s+\d+(\s+of\s+\d+)?\s*\n/gi, '\n\n');
  // "Page N of M" inline (e.g. footer merged into paragraph by PDF extractor)
  cleaned = cleaned.replace(/\bPage\s+\d{1,3}\s+of\s+\d{1,3}\b/gi, '');
  cleaned = cleaned.replace(/\n\s*\d{1,3}\s+of\s+\d{1,3}\s*\n/g, '\n\n');
  cleaned = cleaned.replace(/\n\s*-\s*\d{1,3}\s*-\s*\n/g, '\n\n');
  cleaned = cleaned.replace(/\n\s*[\[\(]\d{1,3}[\]\)]\s*\n/g, '\n\n');
  // "N | Page" or "Page | N" footer style
  cleaned = cleaned.replace(/\n\s*\d{1,3}\s*\|\s*[Pp]age\s*\n/g, '\n\n');
  cleaned = cleaned.replace(/\n\s*[Pp]age\s*\|\s*\d{1,3}\s*\n/g, '\n\n');
  cleaned = cleaned.replace(/\.\s*\n\s*(\d{1,3})\s*\n/g, '.\n\n');
  cleaned = cleaned.replace(/\n\s*(\d{1,3})\s*\n\s*\n?\s*(THIS|WHEREAS|BETWEEN|PARTIES|RECITALS)/gi, '\n\n$2');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned;
}

function getSchemaRegex(schemaType: string): RegExp | null {
  const patterns: Record<string, RegExp> = {
    'numeric':           /^(\d+)\.\s+/,
    'numeric-paren':     /^(\d+)\)\s+/,
    'decimal':           /^(\d+\.\d+)\s+/,
    'alpha-upper':       /^([A-Z])\.\s+/,
    'alpha-lower':       /^([a-z])\.\s+/,
    'alpha-lower-paren': /^([a-z])\)\s+/,
    'roman-upper':       /^(I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XIV|XV|XVI{0,3}|XIX|XX[IVX]*)\.\s+/,
    'roman-lower':       /^(i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xv|xvi{0,3}|xix|xx[ivx]*)\.\s+/,
    'roman-upper-paren': /^(I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XIV|XV|XVI{0,3}|XIX|XX[IVX]*)\)\s+/,
    'roman-lower-paren': /^(i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xv|xvi{0,3}|xix|xx[ivx]*)\)\s+/,
    'paren-numeric':     /^\((\d+)\)\s+/,
    'paren-alpha':       /^\(([a-z])\)\s+/,
    'paren-roman-upper': /^\((I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XIV|XV|XVI{0,3}|XIX|XX[IVX]*)\)\s+/,
    'paren-roman-lower': /^\((i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xv|xvi{0,3}|xix|xx[ivx]*)\)\s+/,
    'section':           /^Section\s+(\d+)\./i,
    'section-decimal':   /^Section\s+(\d+)\.(?!\d)/i,
    'section-bare':      /^(?:Section|Article|ARTICLE)\s+([IVX]+|\d+)(?!\.)/i,
    'article':           /^(?:Article|ARTICLE)\s+([IVX]+|\d+)/i,
    'decimal-zero':          /^(\d+)\.0\s+/,
    'decimal-triple':        /^(\d+\.\d+\.\d+)\s+/,
    'decimal-period':        /^(\d+\.\d+)\.\s+/,
    'decimal-triple-period': /^(\d+\.\d+\.\d+)\.\s+/,
    'numeric-bare':          /^(\d+)\s+[A-Z]/,
  };
  return patterns[schemaType] || null;
}

function getSchemaSplitRegex(schemaType: string): RegExp | null {
  const patterns: Record<string, RegExp> = {
    'numeric':           /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=\d+\.\s+[A-Z])/g,
    'numeric-paren':     /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=\d+\)\s+[A-Z])/g,
    'decimal':           /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=\d+\.\d+\s+[A-Z])/g,
    'alpha-upper':       /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=[A-Z]\.\s+[A-Z])/g,
    'alpha-lower':       /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=[a-z]\.\s+[A-Z])/g,
    'alpha-lower-paren': /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=[a-z]\)\s+[A-Z])/g,
    'roman-upper':       /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=(I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XIV|XV|XVI{0,3}|XIX|XX[IVX]*)\.\s+[A-Z])/g,
    'roman-lower':       /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=(i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xv|xvi{0,3}|xix|xx[ivx]*)\.\s+)/g,
    'roman-upper-paren': /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=(I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XIV|XV|XVI{0,3}|XIX|XX[IVX]*)\)\s+[A-Z])/g,
    'roman-lower-paren': /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=(i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xv|xvi{0,3}|xix|xx[ivx]*)\)\s+)/g,
    'paren-numeric':     /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=\(\d+\)\s+)/g,
    'paren-alpha':       /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=\([a-z]\)\s+)/g,
    'paren-roman-upper': /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=\((I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XIV|XV|XVI{0,3}|XIX|XX[IVX]*)\)\s+)/g,
    'paren-roman-lower': /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=\((i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xv|xvi{0,3}|xix|xx[ivx]*)\)\s+)/g,
    'section':           /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3})|(?<=\s{2,}))(?=Section\s+\d+\.)/gi,
    'section-decimal':   /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3})|(?<=\s{2,}))(?=Section\s+\d+\.(?!\d))/gi,
    'section-bare':      /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3})|(?<=\s{2,}))(?=(?:Section|Article|ARTICLE)\s+(?:[IVX]+|\d+)(?!\.))/gi,
    'article':           /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=(?:Article|ARTICLE)\s+(?:[IVX]+|\d+))/g,
    'decimal-zero':          /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=\d+\.0\s+[A-Z])/g,
    'decimal-period':        /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=\d+\.\d+\.\s+)/g,
    'decimal-triple-period': /(?:\n\s*|(?<=\.\s{1,3})|(?<=;\s{1,3}))(?=\d+\.\d+\.\d+\.\s+)/g,
    'numeric-bare':          /\n\s*(?=\d+\s+[A-Z])/g,
  };
  return patterns[schemaType] || null;
}

// ─── Type detection ───────────────────────────────────────────────────────────

const commonClauseTypes = [
  'Document Name', 'Parties', 'Agreement Date', 'Effective Date', 'Expiration Date',
  'Renewal Term', 'Notice Period', 'Governing Law', 'Most Favored Nation',
  'Competitive Restriction', 'Non-Compete', 'Exclusivity', 'No-Solicit',
  'Non-Disparagement', 'Termination', 'Rofr/Rofo/Rofn', 'Change of Control',
  'Anti-Assignment', 'Revenue/Profit Sharing', 'Price Restrictions', 'Minimum Commitment',
  'Volume Restriction', 'Ip Ownership', 'License Grant', 'Source Code Escrow',
  'Post-Termination Services', 'Audit Rights', 'Liability Cap', 'Liquidated Damages',
  'Warranty Duration', 'Insurance', 'Covenant Not To Sue', 'Third Party Beneficiary',
  'Indemnification', 'Confidentiality', 'Force Majeure', 'Payment Terms',
  'Dispute Resolution', 'Severability', 'Amendment', 'Modification', 'Waiver',
  'Entire Agreement', 'Counterparts',
];

function isMiscellaneousOrGeneralSection(clauseNo: string): boolean {
  const lower = clauseNo.toLowerCase();
  return lower.includes('miscellaneous') || lower.includes('general');
}

function detectMiscellaneousSubclauseType(text: string): string | null {
  const lowerText = text.toLowerCase();
  if (lowerText.includes('governing law') ||
      (lowerText.includes('state') && lowerText.includes('laws')) ||
      (lowerText.includes('construed') && lowerText.includes('laws')) ||
      lowerText.includes('governed by the laws')) return 'Governing Law';
  if (lowerText.includes('counterpart')) return 'Counterparts';
  if (lowerText.includes('amended') || lowerText.includes('modified') ||
      lowerText.includes('amendment') || lowerText.includes('modification')) return 'Modification';
  if (lowerText.includes('entire agreement') || lowerText.includes('entire understanding') ||
      (lowerText.includes('constitutes the entire') && lowerText.includes('agreement'))) return 'Entire Agreement';
  if (lowerText.includes('severability') || lowerText.includes('severable') ||
      (lowerText.includes('invalid') && lowerText.includes('provision')) ||
      (lowerText.includes('unenforceable') && lowerText.includes('provision'))) return 'Severability';
  if (lowerText.includes('waiver') || lowerText.includes('waive')) return 'Waiver';
  if (lowerText.includes('notice') && (lowerText.includes('shall be') || lowerText.includes('given'))) return 'Notice Period';
  if (lowerText.includes('assignment') || lowerText.includes('assign')) return 'Anti-Assignment';
  if (lowerText.includes('successors') && lowerText.includes('assigns')) return 'Anti-Assignment';
  return null;
}

function detectClauseType(text: string): string | null {
  const lc = text.toLowerCase();
  const f200 = lc.substring(0, 200).trim();
  const f50  = lc.substring(0, 50);

  // Structural / parties
  if (f50.includes('between') && f50.includes('party')) return 'Parties';
  if (f50.includes('agreement') && (f50.includes('made') || f50.includes('dated'))) return 'Parties';

  // Most-specific patterns first to avoid false positives
  if (f200.includes('covenant not to sue')) return 'Covenant Not To Sue';
  if (f200.includes('liquidated damages')) return 'Liquidated Damages';
  if (f200.includes('third party beneficiary')) return 'Third Party Beneficiary';
  if (f200.includes('source code escrow') || (f200.includes('escrow') && f200.includes('source'))) return 'Source Code Escrow';
  if (f200.includes('force majeure')) return 'Force Majeure';
  if (f200.includes('most favored nation') || f200.includes('most-favored-nation')) return 'Most Favored Nation';
  if (f200.includes('right of first refusal') || f200.includes('first right of refusal') || f200.includes('rofr') || f200.includes('rofo') || f200.includes('rofn')) return 'ROFR/ROFO/ROFN';
  if (f200.includes('change of control')) return 'Change Of Control';
  if (f200.includes('revenue share') || f200.includes('profit share') || f200.includes('revenue/profit')) return 'Revenue/Profit Sharing';
  if (f200.includes('price restriction') || f200.includes('price ceiling') || f200.includes('price floor')) return 'Price Restrictions';
  if (f200.includes('minimum commitment') || f200.includes('minimum purchase') || f200.includes('commits to purchase')) return 'Minimum Commitment';
  if (f200.includes('volume restriction') || f200.includes('volume limit')) return 'Volume Restriction';
  if (f200.includes('non-disparage') || f200.includes('nondisparage') || f200.includes('not disparage')) return 'Non-Disparagement';
  if (f200.includes('non-compete') || f200.includes('noncompete') || f200.includes('not compete')) return 'Non-Compete';
  if (f200.includes('solicit') && f200.includes('employee')) return 'No-Solicit Of Employees';
  if (f200.includes('solicit') && f200.includes('customer')) return 'No-Solicit Of Customers';
  if (f200.includes('solicit')) return 'No-Solicit Of Employees';
  if (f200.includes('post-termination') || (f200.includes('terminat') && f200.includes('wind-down'))) return 'Post-Termination Services';
  if (f200.includes('notice') && (f200.includes('renew') || f200.includes('auto-renew') || f200.includes('automatic renewal'))) return 'Notice Period To Terminate Renewal';
  if (f200.includes('automatically renew') || f200.includes('auto-renew') || (f200.includes('renewal term') && f200.includes('successive'))) return 'Renewal Term';
  if (f200.includes('renewal term') || f200.includes('shall renew')) return 'Renewal Term';
  if (f200.includes('terminate for convenience') || f200.includes('termination for convenience') || f200.includes('terminate without cause')) return 'Termination For Convenience';
  if (f200.includes('effective date')) return 'Effective Date';
  if (f200.includes('expiration date') || f200.includes('expiry date')) return 'Expiration Date';
  if (f200.includes('perpetual') || f200.includes('irrevocable') && f200.includes('license')) return 'Irrevocable Or Perpetual License';
  if (f200.includes('non-transferable') || f200.includes('nontransferable')) return 'Non-Transferable License';
  if (f200.includes('sublicense') && f200.includes('affiliate')) return 'Affiliate License';
  if (f200.includes('joint') && (f200.includes('ownership') || f200.includes('own') ) && f200.includes('intellectual')) return 'Joint IP Ownership';
  if (f200.includes('work for hire') || (f200.includes('assign') && f200.includes('intellectual property'))) return 'IP Ownership Assignment';
  if (f200.includes('intellectual property') || f200.includes(' ipr ') || (f200.includes('ownership') && f200.includes('invention'))) return 'IP Ownership Assignment';
  if (f200.includes('unlimited license') || (f200.includes('license') && f200.includes('unlimited'))) return 'Unlimited License';
  if (f200.includes('audit') && (f200.includes('books') || f200.includes('records') || f200.includes('inspect'))) return 'Audit Rights';
  if (f200.includes('escrow')) return 'Source Code Escrow';
  if (f200.includes('indemnif') || f200.includes('hold harmless')) return 'Indemnification';
  if (f200.includes('consequential') || f200.includes('special damages') || f200.includes('indirect damages')) return 'Consequential Damages Waiver';
  if (f200.includes('limitation of liability') || f200.includes('liable for no more') || (f200.includes('liability') && f200.includes('shall not exceed'))) return 'Limited Liability';
  if (f200.includes('liability') || f200.includes('uncapped')) return 'Limited Liability';
  // Confidentiality: require strong/specific signals to avoid labeling every clause that
  // mentions "confidential" in passing (arbitration clauses, settlement clauses, etc.)
  if (f200.includes('shall not disclose') || f200.includes('non-disclosure') || f200.includes('obligation of confidentiality')) return 'Confidentiality';
  if (f200.includes('non-disparag')) { /* skip — handled above */ }
  { const hits = (f200.match(/\bconfidential/g) || []).length; if (hits >= 2 || (hits >= 1 && f200.includes('proprietary information'))) return 'Confidentiality'; }
  if (f200.includes('represent') && f200.includes('warrant')) return 'Representations And Warranties';
  if (f200.includes('warranty') || f200.includes('guarantee')) return 'Warranty Duration';
  if (f200.includes('terminat')) return 'Termination For Convenience';
  if (f200.includes('payment') || f200.includes('invoice') || f200.includes('royalt') || f200.includes('fee ')) return 'Payment Terms';
  if (f200.includes('insurance') || f200.includes('coverage') || f200.includes('certificate of insurance')) return 'Insurance';
  if (f200.includes('arbitration') || f200.includes('dispute') || f200.includes('mediation')) return 'Dispute Resolution';
  if (f200.includes('governing law') || f200.includes('laws of') || f200.includes('jurisdiction')) return 'Governing Law';
  if (f200.includes('shall not assign') || f200.includes('may not assign') || f200.includes('without prior written consent') && f200.includes('assign')) return 'Anti-Assignment';
  if (f200.includes('assignment') || f200.includes('transfer ')) return 'Anti-Assignment';
  if (f200.includes('exclusiv')) return 'Exclusivity';
  if (f200.includes('notice') && (f200.includes('shall be given') || f200.includes('shall be sent') || f200.includes('in writing'))) return 'Notice Requirements';
  if (f200.includes('notice')) return 'Notice Requirements';
  if (f200.includes('license') || f200.includes('hereby grant') || f200.includes('grants to')) return 'License Grant';
  if (f200.includes('term of this agreement') || f200.includes('initial term') || f200.includes('agreement shall continue')) return 'Term';
  if (text.length < 1500) {
    for (const type of commonClauseTypes) {
      if (lc.includes(type.toLowerCase())) return type;
    }
  }
  return null;
}

// Returns a canonical clause type if the heading maps to one, otherwise null.
// Returning null lets the caller fall back to content-based detection instead of
// using a raw heading string (like "PAYMENTS4") as the type label.
function cleanTitle(title: string): string | null {
  const trimmed = title.trim();
  // Very long strings are prose, not headings — no type match
  if (trimmed.length > 80) return null;
  const lower = trimmed.toLowerCase();
  // Ordered from most-specific to least-specific so short keys don't shadow longer ones
  const mappings: [string, string][] = [
    ['covenant not to sue',        'Covenant Not To Sue'],
    ['liquidated damages',         'Liquidated Damages'],
    ['third party beneficiar',     'Third Party Beneficiary'],
    ['source code escrow',         'Source Code Escrow'],
    ['force majeure',              'Force Majeure'],
    ['most favored nation',        'Most Favored Nation'],
    ['right of first refusal',     'ROFR/ROFO/ROFN'],
    ['first right of refusal',     'ROFR/ROFO/ROFN'],
    ['rofr', 'ROFR/ROFO/ROFN'], ['rofo', 'ROFR/ROFO/ROFN'], ['rofn', 'ROFR/ROFO/ROFN'],
    ['change of control',          'Change Of Control'],
    ['revenue/profit sharing',     'Revenue/Profit Sharing'],
    ['revenue share',              'Revenue/Profit Sharing'],
    ['profit share',               'Revenue/Profit Sharing'],
    ['price restriction',          'Price Restrictions'],
    ['minimum commitment',         'Minimum Commitment'],
    ['minimum purchase',           'Minimum Commitment'],
    ['volume restriction',         'Volume Restriction'],
    ['non-disparagement',          'Non-Disparagement'],
    ['non-compete',                'Non-Compete'],
    ['noncompete',                 'Non-Compete'],
    ['no-solicit of employees',    'No-Solicit Of Employees'],
    ['no-solicit of customers',    'No-Solicit Of Customers'],
    ['solicit employees',          'No-Solicit Of Employees'],
    ['solicit customers',          'No-Solicit Of Customers'],
    ['solicit',                    'No-Solicit Of Employees'],
    ['notice period to terminate', 'Notice Period To Terminate Renewal'],
    ['auto-renew',                 'Renewal Term'],
    ['renewal term',               'Renewal Term'],
    ['automatic renewal',         'Renewal Term'],
    ['termination for convenience','Termination For Convenience'],
    ['terminate for convenience',  'Termination For Convenience'],
    ['post-termination',           'Post-Termination Services'],
    ['effective date',             'Effective Date'],
    ['expiration date',            'Expiration Date'],
    ['irrevocable',                'Irrevocable Or Perpetual License'],
    ['perpetual license',          'Irrevocable Or Perpetual License'],
    ['non-transferable',           'Non-Transferable License'],
    ['nontransferable',            'Non-Transferable License'],
    ['affiliate license',          'Affiliate License'],
    ['sublicense',                 'Affiliate License'],
    ['joint ip',                   'Joint IP Ownership'],
    ['joint ownership',            'Joint IP Ownership'],
    ['ip ownership',               'IP Ownership Assignment'],
    ['intellectual property',      'IP Ownership Assignment'],
    ['work for hire',              'IP Ownership Assignment'],
    ['unlimited license',          'Unlimited License'],
    ['indemnif',                   'Indemnification'],
    ['hold harmless',              'Indemnification'],
    ['indemnity',                  'Indemnification'],
    ['consequential damages',      'Consequential Damages Waiver'],
    ['limitation of liability',    'Limited Liability'],
    ['cap on liability',           'Limited Liability'],
    ['liability cap',              'Limited Liability'],
    ['non-disclosure',             'Confidentiality'],
    ['confidential',               'Confidentiality'],
    ['represent',                  'Representations And Warranties'],
    ['warranty',                   'Warranty Duration'],
    ['guarantee',                  'Warranty Duration'],
    ['terminat',                   'Termination For Convenience'],
    ['payment',                    'Payment Terms'],
    ['invoice',                    'Payment Terms'],
    ['royalt',                     'Payment Terms'],
    ['insurance',                  'Insurance'],
    ['arbitration',                'Dispute Resolution'],
    ['dispute',                    'Dispute Resolution'],
    ['governing law',              'Governing Law'],
    ['jurisdiction',               'Governing Law'],
    ['assignment',                 'Anti-Assignment'],
    ['anti-assignment',            'Anti-Assignment'],
    ['exclusiv',                   'Exclusivity'],
    ['audit',                      'Audit Rights'],
    ['escrow',                     'Source Code Escrow'],
    ['notice',                     'Notice Requirements'],
    ['license',                    'License Grant'],
    ['grant',                      'License Grant'],
    ['term of',                    'Term'],
    ['initial term',               'Term'],
    ['data protection',            'Confidentiality'],
    ['privacy',                    'Confidentiality'],
    // Must come after all entries that contain 'term' as a substring
    ['term',                       'Term'],    // "TERM" alone, or "SERVICE TERM"
  ];
  for (const [key, value] of mappings) {
    if (lower.includes(key)) return value;
  }
  // No mapping found — return null so the caller can fall back to content detection
  return null;
}

function parseClauseNumber(block: string): { clause_no: string; body_text: string } {
  const trimmed = block.trim();

  // ── Early check: inline sub-clause on the same line as the heading ───────
  // Handles: "II. PAYMENTS (a) Standard payments..." or "6. TERM (a) Initial term..."
  // where "(a)" is on the SAME line as the heading — must not absorb it into clause_no.
  const nl0 = trimmed.indexOf('\n');
  const firstLine0 = nl0 > 0 ? trimmed.substring(0, nl0) : trimmed;
  const afterFirstLine0 = nl0 > 0 ? trimmed.substring(nl0 + 1).trim() : '';
  const inlineSub = firstLine0.match(
    /^((?:\d+|[IVX]+|[A-Z])\.\s*[A-Z][A-Za-z\s,\/\-]{0,60}?)\s+(\([a-z0-9]\)\s+[\s\S]+)$/
  );
  if (inlineSub) {
    const fullBody = afterFirstLine0
      ? inlineSub[2].trim() + '\n' + afterFirstLine0
      : inlineSub[2].trim();
    return { clause_no: inlineSub[1].trim(), body_text: fullBody };
  }

  // Handle decimal-period formats: 1.1. text, 1.1.1. text
  const decimalPeriodMatch = trimmed.match(/^(\d+(?:\.\d+)+)\.\s+([\s\S]+)$/);
  if (decimalPeriodMatch) {
    const clauseNo = decimalPeriodMatch[1];
    const rest = decimalPeriodMatch[2].trim();
    const firstLineEnd = rest.indexOf('\n');
    if (firstLineEnd > 0 && firstLineEnd < 120) {
      const firstLine = rest.substring(0, firstLineEnd).trim();
      const body = rest.substring(firstLineEnd).trim();
      if (firstLine.length < 100 && body.length > 0) {
        return { clause_no: `${clauseNo}. ${firstLine}`, body_text: body };
      }
    }
    return { clause_no: `${clauseNo}.`, body_text: rest };
  }
  const bareNumberMatch = trimmed.match(/^(\d+)\s+([A-Z][^\n]{0,80})\n\s*([\s\S]+)$/);
  if (bareNumberMatch) {
    return { clause_no: `${bareNumberMatch[1]} ${bareNumberMatch[2].trim()}`, body_text: bareNumberMatch[3].trim() };
  }
  const numberedWithTitleMatch = trimmed.match(/^((?:\d+|[IVX]+|[A-Z])\.\s*[^\n.]+?)(?:\.\s*|\n\s*)([\s\S]+)$/);
  if (numberedWithTitleMatch) {
    return { clause_no: numberedWithTitleMatch[1].trim(), body_text: numberedWithTitleMatch[2].trim() };
  }
  const sectionMatch = trimmed.match(/^((?:Section|Article|ARTICLE|Clause)\s+(?:\d+|[IVX]+)\.?\s*[^\n.]*?)(?:\.\s*|\n\s*)([\s\S]+)$/i);
  if (sectionMatch) {
    return { clause_no: sectionMatch[1].trim(), body_text: sectionMatch[2].trim() };
  }
  const simpleNumberMatch = trimmed.match(/^((?:\d+|[IVX]+|[A-Z])\.)\s*([\s\S]+)$/);
  if (simpleNumberMatch) {
    const firstLineEnd = simpleNumberMatch[2].indexOf('\n');
    if (firstLineEnd > 0 && firstLineEnd < 100) {
      const firstLine = simpleNumberMatch[2].substring(0, firstLineEnd).trim();
      const rest = simpleNumberMatch[2].substring(firstLineEnd).trim();
      if (firstLine.length < 80 && rest.length > 0) {
        return { clause_no: simpleNumberMatch[1] + ' ' + firstLine, body_text: rest };
      }
    }
    return { clause_no: simpleNumberMatch[1], body_text: simpleNumberMatch[2].trim() };
  }
  const allCapsMatch = trimmed.match(/^([A-Z][A-Z\s]{3,50})(?:\.\s*|\n\s*)([\s\S]+)$/);
  if (allCapsMatch) {
    return { clause_no: allCapsMatch[1].trim(), body_text: allCapsMatch[2].trim() };
  }
  return { clause_no: '', body_text: trimmed };
}

function parseHeader(block: string): { title: string | null; text: string } {
  const numberedHeaderMatch = block.match(/^([0-9]+|[A-Z]|[IVX]+)\.\s+([A-Z][A-Za-z\s,\/\(\)]{3,100})(?:\n|\.|\s{2,}|$|(?=\s+[0-9]+\.[0-9]+))/);
  if (numberedHeaderMatch) return { title: cleanTitle(numberedHeaderMatch[2]), text: block };
  const simpleNumberedMatch = block.match(/^([0-9]+|[A-Z]|[IVX]+)\.\s+([^\n.]+)(?:\n|\.|$)/);
  if (simpleNumberedMatch) {
    const potTitle = simpleNumberedMatch[2].trim();
    if (potTitle.length > 2 && potTitle.length < 100) return { title: cleanTitle(potTitle), text: block };
  }
  const sectionMatch = block.match(/^(?:Section|Article|Clause)\s+[0-9A-ZIVX]+\.?\s*([^\n.]+)?(?:\n|\.|$)/i);
  if (sectionMatch && sectionMatch[1]) {
    const potTitle = sectionMatch[1].trim();
    if (potTitle.length > 2 && potTitle.length < 100) return { title: cleanTitle(potTitle), text: block };
  }
  const allCapsMatch = block.match(/^([A-Z\s]{4,})(?:\n|$)/);
  if (allCapsMatch) return { title: cleanTitle(allCapsMatch[1]), text: block };
  return { title: null, text: block };
}

// ─── Numbering schema detection (public) ─────────────────────────────────────

export function detectNumberingSchema(text: string): string {
  const patterns = [
    { regex: /\n\s*(I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XIV|XV|XVI{0,3}|XIX|XX[IVX]*)\.\s+[A-Z][A-Z\s]/g, type: 'roman-upper' },
    { regex: /\n\s*Section\s+(\d+)\./gi, type: 'section' },
    { regex: /\n\s*Article\s+(\d+)/gi, type: 'article' },
    { regex: /\n\s*ARTICLE\s+([IVX]+)/g, type: 'article-roman' },
    { regex: /\n\s*(\d+\.\d+\.\d+)\.\s+/g, type: 'decimal-triple-period' },
    { regex: /\n\s*(\d+\.\d+)\.\s+/g, type: 'decimal-period' },
    { regex: /\n\s*(\d+)\.\s+[A-Z][A-Z\s]{3,}/g, type: 'numeric' },
    // Title-case numeric: "2. Definitions", "3. Services" (first letter upper, rest mixed)
    { regex: /\n\s*\d+\.(?!\d)\s+[A-Z][a-z]/g, type: 'numeric-title' },
    { regex: /\n\s*(\d+)\s+[A-Z]{2}[A-Z\s]{1,}/g, type: 'numeric-bare' },
  ];
  const counts: Record<string, number> = {};
  let bestType = 'roman-upper';
  let maxCount = 0;
  for (const p of patterns) {
    const matches = text.match(p.regex);
    const count = matches ? matches.length : 0;
    counts[p.type] = count;
    if (count > maxCount) { maxCount = count; bestType = p.type; }
  }
  // Hierarchical documents: if decimal sub-sections dominate but top-level numeric
  // sections (e.g. "2. Definitions", "3. Services") are also present, prefer the
  // top-level split for better semantic grouping.
  const topLevelCount = Math.max(counts['numeric'] || 0, counts['numeric-title'] || 0);
  if (bestType === 'decimal-period' && topLevelCount >= 3) {
    bestType = (counts['numeric-title'] || 0) >= (counts['numeric'] || 0) ? 'numeric-title' : 'numeric';
  }
  return bestType;
}

// ─── Miscellaneous subclause extraction ──────────────────────────────────────

interface InternalClause {
  clause_no: string;
  clause_text: string;
  clause_type: string;
}

function extractSubclausesFromMiscellaneous(parentClauseNo: string, blockText: string): InternalClause[] {
  const subclauses: InternalClause[] = [];
  const sectionDecimalRegex = /(?=(?:Section\s+)?\d+\.\d+[\s.:])/gi;
  let subBlocks: string[] = blockText.split(sectionDecimalRegex).filter(b => b.trim().length > 20);
  if (subBlocks.length < 2) {
    subBlocks = blockText.split(/(?=\([a-z0-9]\)\s+)/gi).filter(b => b.trim().length > 20);
  }
  if (subBlocks.length < 2) {
    subBlocks = blockText.split(/\n\s*\n/).filter(b => b.trim().length > 30);
  }
  for (const subBlock of subBlocks) {
    const trimmedSub = subBlock.trim();
    if (trimmedSub.length < 30) continue;
    const subclauseType = detectMiscellaneousSubclauseType(trimmedSub);
    if (subclauseType) {
      subclauses.push({ clause_type: subclauseType, clause_no: parentClauseNo, clause_text: normalizeText(trimmedSub) });
    }
  }
  return subclauses;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function extractClausesRuleBased(text: string, schema?: string, subclauseMode: 'combined' | 'separate' = 'combined'): ExtractedClause[] {
  // Pre-process: collapse multiple spaces between words (PDF extraction artifact).
  // Preserves newlines; only collapses runs of spaces between non-whitespace characters.
  let fixedText = text.split('\n').map(line => line.replace(/(\S) {2,}(\S)/g, '$1 $2')).join('\n');

  // Pre-process: fix reversed PDF section headings (e.g. "PAYMENTS4." → "\n4. PAYMENTS\n").
  // This is a common artifact when PDF parsers read text objects out of order.
  // Only applies to 4+ letter all-caps words immediately followed by 1-2 digits and a period.
  fixedText = fixedText.replace(/([A-Z]{4,})(\d{1,2})\.\s+/g, '\n$2. $1\n');

  // Pre-process: promote section headings that appear inline mid-paragraph.
  // PDFs often extract "...three years. II. PAYMENTS..." or "...term. 2. Services..." with no
  // newline before each section heading.  Insert a newline so the split regex can fire.
  // Roman numeral headings: require 3+ chars after the period so "e.g. I. e" doesn't trigger.
  fixedText = fixedText.replace(
    /([.:;!?])\s+((I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XIV|XV|XVI{0,3}|XIX|XX[IVX]*)\.\s+[A-Z][A-Za-z]{2,})/g,
    '$1\n$2',
  );
  // Arabic numeric headings: same rule — 3+ char heading word, avoid matching ordinals.
  fixedText = fixedText.replace(
    /([.:;!?])\s+((\d+)\.(?!\d)\s+[A-Z][A-Za-z]{2,})/g,
    '$1\n$2',
  );

  const cleanedText = removePageNumbers(fixedText);
  const results: ExtractedClause[] = [];

  let splitRegex: RegExp | null = null;
  let mainHeaderRegex: RegExp | null = null;
  let schemaType: string;

  if (schema && schema !== 'auto' && schema !== 'none') {
    splitRegex = getSchemaSplitRegex(schema);
    mainHeaderRegex = getSchemaRegex(schema);
    schemaType = schema;
  } else {
    schemaType = detectNumberingSchema(cleanedText);
    // Use the same robust lookbehind-enabled split as manual schema selection.
    // numeric-title behaves identically to numeric; article-roman maps to article.
    const normalizedSchema = schemaType === 'numeric-title' ? 'numeric'
      : schemaType === 'article-roman' ? 'article'
      : schemaType;
    splitRegex = getSchemaSplitRegex(normalizedSchema) || getSchemaSplitRegex('roman-upper');
    mainHeaderRegex = getSchemaRegex(normalizedSchema) || getSchemaRegex('roman-upper');
  }

  let initialBlocks: string[] = cleanedText.split(splitRegex || /\n\n+/);

  // Skip preamble
  if (initialBlocks.length > 1 && mainHeaderRegex) {
    const firstLine = initialBlocks[0].trim().split('\n')[0];
    if (!mainHeaderRegex.test(firstLine)) initialBlocks = initialBlocks.slice(1);
  }

  // Hybrid numbering: for roman-numeral schemas, also sub-split at Arabic section headers
  // (handles documents like RDU Airport Authority that use I. II. III. then "6. SECTION NAME")
  if (schemaType && schemaType.includes('roman')) {
    const arabicBlockRx = /\n(?=\d+\.(?!\d)\s+[A-Z])/g;
    const expanded = initialBlocks.flatMap(b => b.split(arabicBlockRx)).filter(b => b.trim().length > 0);
    if (expanded.length > initialBlocks.length) {
      initialBlocks = expanded;
      // Extend mainHeaderRegex to also match Arabic top-level sections
      if (mainHeaderRegex) {
        mainHeaderRegex = new RegExp(
          `${mainHeaderRegex.source}|^\\d+\\.(?!\\d)\\s+[A-Z]`,
          mainHeaderRegex.flags,
        );
      }
    }
  }

  // Fallback if too few blocks
  if (initialBlocks.length < 3) {
    const altPatterns = [
      /\n\s*(?=[IVX]+\.\s+[A-Z][A-Z])/g,
      /\n\s*(?=(?:Section|Article|ARTICLE)\s+\d+\.)/gi,
      /\n\s*(?=\d+\.(?!\d)\s+[A-Z][a-z])/g,   // title-case numeric: "2. Definitions"
      /\n\s*(?=\d+\.(?!\d)\s+[A-Z][A-Z])/g,   // all-caps numeric: "2. DEFINITIONS"
    ];
    for (const altRegex of altPatterns) {
      const altBlocks = cleanedText.split(altRegex);
      if (altBlocks.length >= 3) { initialBlocks = altBlocks; break; }
    }
  }

  if (!mainHeaderRegex) {
    mainHeaderRegex = /^(I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XIV|XV|XVI{0,3}|XIX|XX[IVX]*)\.\s+[A-Z]/;
  }

  // Merge sub-clause blocks back into their parent (only in 'combined' mode)
  const blocks: string[] = [];
  for (const block of initialBlocks) {
    const trimmed = block.trim();
    if (trimmed.length < 10) continue;
    const firstLine = trimmed.split('\n')[0];
    const isMainSection = (mainHeaderRegex as RegExp).test(firstLine);
    if (isMainSection || blocks.length === 0) {
      blocks.push(trimmed);
    } else if (subclauseMode === 'combined') {
      blocks[blocks.length - 1] += '\n\n' + trimmed;
    } else {
      blocks.push(trimmed);
    }
  }

  const seenTexts = new Set<string>();
  let charOffset = 0;

  for (const block of blocks) {
    const trimmedBlock = block.trim();
    if (trimmedBlock.length < 30 || seenTexts.has(trimmedBlock)) continue;
    const cleanedBlock = trimmedBlock.replace(/Agreement between.*Page\s+\d+\s+of\s+\d+.*\(01\/2021 v[^\)]*\)/gi, '').trim();
    if (cleanedBlock.length < 20) continue;

    const { clause_no, body_text } = parseClauseNumber(cleanedBlock);
    const { title } = parseHeader(cleanedBlock);
    // title is a canonical type (or null); detectClauseType is the content-based fallback.
    // Always extract the block — use 'Other' if neither produces a type, so sections like
    // "2. Definitions" and "3. Services" are not silently dropped.
    const detectedType = title || detectClauseType(cleanedBlock) || 'Other';

    // Check for miscellaneous section
    if (isMiscellaneousOrGeneralSection(clause_no)) {
      const subclauses = extractSubclausesFromMiscellaneous(clause_no, cleanedBlock);
      if (subclauses.length > 0) {
        for (const sub of subclauses) {
          const charStart = text.indexOf(sub.clause_text.substring(0, 40));
          results.push({
            clause_no: sub.clause_no,
            clause_text: sub.clause_text,
            detected_type: sub.clause_type,
            confidence: 0.75,
            char_start: charStart >= 0 ? charStart : charOffset,
            char_end: charStart >= 0 ? charStart + sub.clause_text.length : charOffset + sub.clause_text.length,
          });
        }
        seenTexts.add(trimmedBlock);
        charOffset += cleanedBlock.length + 2;
        continue;
      }
    }

    // Find char position in original text
    const snippet = body_text.substring(0, 40);
    const charStart = text.indexOf(snippet);
    const clauseTextNorm = normalizeText(body_text);

    results.push({
      clause_no,
      clause_text: clauseTextNorm,
      detected_type: detectedType,
      confidence: title ? 0.9 : 0.7,
      char_start: charStart >= 0 ? charStart : charOffset,
      char_end: charStart >= 0 ? charStart + clauseTextNorm.length : charOffset + clauseTextNorm.length,
    });
    seenTexts.add(trimmedBlock);
    charOffset += cleanedBlock.length + 2;
  }

  return results;
}
