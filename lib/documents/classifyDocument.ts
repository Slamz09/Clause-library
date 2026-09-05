import type { SupabaseClient } from '@supabase/supabase-js';
import { createChatCompletion, GROQ_MODEL } from '@/lib/groq';
import { sanitizeForPrompt, wrapUserContent, SYSTEM_PROMPT_SAFETY_PREFIX } from '@/lib/security/sanitizePrompt';
import { CONTRACT_TYPE_OPTIONS } from '@/lib/documentProfiles';
import { US_STATES } from '@/lib/geoOptions';
import type { BgcTypeRequirement, BgcJurisdictionLevel, BgcScreeningType } from '@/lib/bgcTypeOptions';

// ─── Automatic document-type classification ────────────────────────────────
// Used only by bulk upload, where the user can't be asked to pick one
// Document Type per file up front. Reuses the existing configurable
// taxonomy (lib/documentProfiles.ts CONTRACT_TYPE_CATEGORIES) rather than a
// parallel list, and the existing Groq chat-completion infra (same as
// detect-schema / classify-clauses / extract-clauses-llama) for the semantic
// tier — no new LLM provider wiring.
//
// Layered priority, each tier only runs if the previous one didn't produce a
// confident-enough result:
//   1. Structural  — deterministic keyword/title scan (filename + the
//                     document's opening text), cheap and fast.
//   2. Semantic    — Groq LLM classification against the full taxonomy.
//   3. Unknown     — nothing above cleared the review threshold.
//
// There is no "template match" tier: this app has no repository of known,
// versioned contract templates to fingerprint a new upload against.
// contract_playbooks (negotiation-position clause sets per document_type,
// used by the old Playbooks page) is a different, unrelated concept and is
// deliberately NOT queried here — matchedTemplate* stays null throughout
// until a real template corpus exists to check against.

export type ClassificationMethod = 'structural' | 'semantic' | 'manual' | 'unknown';

export interface DocumentClassification {
  documentType: string;
  confidence: number; // 0-1
  method: ClassificationMethod;
  reviewRecommended: boolean;
  paperSourceGuess: 'internal' | 'counter_party' | null;
  paperSourceConfidence: number | null;
  matchedTemplateId: string | null;
  matchedTemplateName: string | null;
  matchedTemplateConfidence: number | null;
  counterpartyNameGuess: string | null;
  governingLawGuess: string | null;
  /** 'client' if the uploading company appears to be the service provider/vendor in this agreement (the counterparty is their client); 'vendor' if the uploading company appears to be the customer (the counterparty is their vendor/supplier). */
  contractFacingGuess: 'client' | 'vendor' | null;
  effectiveDateGuess: string | null; // ISO YYYY-MM-DD
  expirationDateGuess: string | null; // ISO YYYY-MM-DD
  /**
   * Character offsets of where each deterministic guess was found in the
   * raw document text (null when a field came from the AI instead, or
   * wasn't found at all) — processDocumentUpload.ts uses these to look up
   * which extracted clause contains that offset and persist a clause_id
   * reference on the contract, powering the Contracts Repository's
   * click-a-cell-to-see-the-source-clause feature.
   */
  governingLawCharIndex: number | null;
  effectiveDateCharIndex: number | null;
  expirationDateCharIndex: number | null;
  /** Deterministically-detected BGC screening method(s) this contract requires — see tryDeterministicBgcTypes(). */
  bgcTypesGuess: BgcTypeRequirement[];
}

// Configurable per the spec ("make thresholds configurable") — env-driven,
// consistent with how the rest of this app configures optional behavior.
const AUTO_THRESHOLD = Number(process.env.DOC_TYPE_AUTO_THRESHOLD ?? 0.90);
const REVIEW_THRESHOLD = Number(process.env.DOC_TYPE_REVIEW_THRESHOLD ?? 0.75);

const VALID_TYPES = new Set(CONTRACT_TYPE_OPTIONS.map(o => o.value));
const TAXONOMY_LIST = CONTRACT_TYPE_OPTIONS.map(o => `"${o.value}" (${o.label})`).join(', ');

// Not bilateral agreements — see lib/documentProfiles.ts's
// "Regulatory & Entity-Fact Documents" category. Every other type in the
// taxonomy is an agreement between two identifiable parties (paper source,
// counterparty, relationship role all mean something for those); these two
// don't have a counterparty at all, so both the deterministic structural
// tier and the semantic prompt below treat them as their own path rather
// than forcing them through the bilateral role-detection questions.
export const NON_BILATERAL_DOCUMENT_TYPES = new Set(['regulation', 'entity_fact_document']);

function normalizeToTaxonomy(value: string | undefined | null): string | null {
  if (!value) return null;
  const exact = CONTRACT_TYPE_OPTIONS.find(o => o.value === value || o.label.toLowerCase() === value.toLowerCase());
  if (exact) return exact.value;
  const lower = value.toLowerCase();
  const partial = CONTRACT_TYPE_OPTIONS.find(o => lower.includes(o.value) || o.value.includes(lower));
  return partial ? partial.value : null;
}

// Backstop for counterparty_name_guess regardless of what the LLM actually
// returns (the prompt asks it not to append a parenthetical alias, but
// models don't always follow that) — strips a trailing "(...)" so a value
// like "Aspen Creek School District (Aspen Creek)" is stored and matched as
// just "Aspen Creek School District".
function stripTrailingAlias(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const stripped = value.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return stripped || null;
}

// ─── Tier 1: structural / metadata heuristics ───────────────────────────────
const STRUCTURAL_SIGNALS: Array<{ type: string; patterns: RegExp[] }> = [
  { type: 'msa', patterns: [/master\s+services?\s+agreement/i] },
  { type: 'statement_of_work', patterns: [/statement\s+of\s+work/i, /\bsow\b/i] },
  { type: 'order_form', patterns: [/order\s+form/i] },
  { type: 'amendment', patterns: [/^\s*amendment/im, /\bamendment\s+(no\.?|number|#)\s*\d+/i] },
  { type: 'addendum', patterns: [/^\s*addendum/im] },
  { type: 'nda', patterns: [/non-?disclosure\s+agreement/i, /confidentiality\s+agreement/i, /\bnda\b/i] },
  { type: 'data_processing_agreement', patterns: [/data\s+processing\s+agreement/i, /\bdpa\b/i] },
  { type: 'supplier_agreement', patterns: [/supplier\s+agreement/i] },
  { type: 'vendor_agreement', patterns: [/vendor\s+agreement/i] },
  { type: 'subcontractor_agreement', patterns: [/subcontractor\s+agreement/i] },
  { type: 'professional_services_agreement', patterns: [/professional\s+services\s+agreement/i] },
  { type: 'partnership_agreement', patterns: [/partnership\s+agreement/i] },
  { type: 'license_agreement', patterns: [/license\s+agreement/i, /licensing\s+agreement/i] },
  { type: 'transportation_services_agreement', patterns: [/transportation\s+services\s+agreement/i] },
  { type: 'service_agreement', patterns: [/services?\s+agreement/i] },
  { type: 'lease_agreement', patterns: [/lease\s+agreement/i] },
  { type: 'insurance_policy', patterns: [/insurance\s+policy/i, /declarations?\s+page/i] },
  { type: 'certificate_of_insurance', patterns: [/certificate\s+of\s+insurance/i] },
  { type: 'employment_agreement', patterns: [/employment\s+agreement/i] },
  // Non-bilateral — see NON_BILATERAL_DOCUMENT_TYPES above.
  { type: 'regulation', patterns: [
    /\bpublic\s+law\s+\d/i, /\ban\s+act\s+to\b/i, /\bstatute[s]?\b/i, /\bordinance\b/i,
    /code\s+of\s+federal\s+regulations/i, /\b\d+\s*C\.?\s?F\.?\s?R\.?\s*(§|section|part)/i,
    /\b\d+\s*U\.?\s?S\.?\s?C\.?\s*(§|section)/i, /\bsenate\s+bill\s+\d/i, /\bhouse\s+bill\s+\d/i,
    /\badministrative\s+code\b/i, /\bshall\s+be\s+unlawful\b/i, /\bgeneral\s+assembly\b/i,
  ] },
  { type: 'entity_fact_document', patterns: [
    /certificate\s+of\s+good\s+standing/i, /articles\s+of\s+incorporation/i,
    /\bform\s+w-?9\b/i, /employer\s+identification\s+number/i,
    /certificate\s+of\s+formation/i, /certificate\s+of\s+organization/i,
    /statement\s+of\s+financial\s+(?:position|condition)/i, /balance\s+sheet/i,
  ] },
];

function tryStructuralMatch(text: string, fileName: string): DocumentClassification | null {
  const haystack = `${fileName}\n${text.substring(0, 1500)}`;
  const hits = STRUCTURAL_SIGNALS.filter(s => s.patterns.some(p => p.test(haystack)));
  if (hits.length !== 1) return null; // 0 = no signal, >1 = ambiguous — let semantic tier decide
  const confidence = 0.82; // deterministic title match, but no semantic confirmation — lands in "review recommended" by default
  return {
    documentType: hits[0].type,
    confidence,
    method: 'structural',
    reviewRecommended: confidence < AUTO_THRESHOLD,
    paperSourceGuess: null,
    paperSourceConfidence: null,
    matchedTemplateId: null,
    matchedTemplateName: null,
    matchedTemplateConfidence: null,
    counterpartyNameGuess: null,
    governingLawGuess: null,
    contractFacingGuess: null,
    effectiveDateGuess: null,
    expirationDateGuess: null,
    governingLawCharIndex: null,
    effectiveDateCharIndex: null,
    expirationDateCharIndex: null,
    bgcTypesGuess: [],
  };
}

// ─── Tier 2: semantic (LLM) classification ──────────────────────────────────
// Relationship-role detection (contract_facing / counterparty name): matches
// the document's parties against the user's registered entities (Company
// Settings — app/(app)/settings/company, entities table) rather than a bare
// company-name string, so it can find OUR party even when the document
// refers to us by a defined-term label ("Contractor", "Vendor"...) or an
// alias/DBA rather than our exact legal name — see the role-detection
// instructions built below for the exact label → role mapping, including the
// generic-label fallback (checking the OTHER party's label when ours is a
// non-indicative term like "Organization").
interface KnownEntity { name: string; aliases: string[] }

function buildEntityInstructions(entities: KnownEntity[], companyName?: string | null): string {
  const lines: string[] = [];
  if (entities.length > 0) {
    const list = entities.map(e => e.aliases.length ? `"${e.name}" (also known as: ${e.aliases.join(', ')})` : `"${e.name}"`).join('; ');
    lines.push(`Our company is one of these registered entities: ${list}. Search the document for any of these names (exact or close variants) to find which defined party is us.`);
  } else if (companyName) {
    lines.push(`Our company is "${sanitizeForPrompt(companyName, 200)}". Search the document for this name (or close variants) to find which defined party is us.`);
  } else {
    lines.push(`No registered company name was provided — infer which party is "us" only if the document itself makes it obvious; otherwise leave the role fields null.`);
  }
  lines.push(
    `Once you find our party, identify the defined-term label the document gives it (e.g. the word in quotes/parentheses right after our name, like ("Contractor"), ("Vendor"), ("Service Provider"), ("Consultant"), ("Supplier"), ("Client"), ("Customer"), ("Organization"), ("Company"), ("Party"), etc.).`,
    `Map that label to a role: "Contractor", "Vendor", "Service Provider", "Consultant", "Supplier", or "Subcontractor" → we are delivering services/goods, so contract_facing = "client" (the counterparty is our client/customer). "Client", "Customer", "Purchaser", or "Buyer" → we are receiving services/goods, so contract_facing = "vendor" (the counterparty is our vendor/supplier).`,
    `If our own label is generic and doesn't indicate a role (e.g. "Organization", "Company", "Party", "Recipient", or no label at all), do NOT guess from it — instead find the label given to the OTHER (counterparty) party and use its complementary role: if the counterparty is labeled Contractor/Vendor/Service Provider/Consultant/Supplier, they are delivering services to us, so contract_facing = "vendor". If the counterparty is labeled Client/Customer/Purchaser/Buyer, they are receiving services from us, so contract_facing = "client".`,
    `counterparty_name_guess is always the OTHER party's actual name (not their label, not our name). Return ONLY the legal name itself — do not append a parenthetical short-form/defined-term alias after it (e.g. return "Aspen Creek School District", never "Aspen Creek School District (Aspen Creek)" or "Aspen Creek School District (the \\"District\\")").`,
  );
  return lines.join('\n');
}

const MONTH_NAMES = 'January|February|March|April|May|June|July|August|September|October|November|December';

// ─── Deterministic party/role extraction — no AI ────────────────────────────
// Regex scan for the standard legal defined-party pattern "Full Name
// ("Label")" (optionally "the "Label"" / "hereinafter "Label""). When it
// finds at least two such definitions and can tell which one is us
// (matched against registered entities) and which is the counterparty, it
// derives counterparty_name_guess and contract_facing_guess with zero LLM
// involvement — same label→role mapping given to the AI in
// buildEntityInstructions(), just applied in code. Only overrides the AI's
// answer for these two fields when it succeeds; everything else (document
// type, paper source, governing law) still comes from the tiers above.
// Name capture allows up to 200 chars (not just a bare name) because real
// contracts routinely inline the party's address before the defined-term
// parenthetical — e.g. 'Fox River School District, with its principal
// office located at 42 W Madison Street, Chicago, IL 60601 ("Client")'.
const PARTY_DEFINITION_PATTERN =
  /([A-Z][A-Za-z0-9&,.\-'’\s]{2,200}?)\s*\(\s*(?:hereinafter\s+)?(?:referred\s+to\s+as\s+)?(?:the\s+)?["“']([A-Za-z][A-Za-z\s/]{1,40}?)["”']\s*\)/g;

const PROVIDER_LABELS = ['contractor', 'vendor', 'service provider', 'consultant', 'supplier', 'subcontractor'];
const RECIPIENT_LABELS = ['client', 'customer', 'purchaser', 'buyer'];
// Contracts routinely open with their own self-reference defined the exact
// same way a party is — e.g. '...SERVICES AGREEMENT (the "Agreement")' —
// which the pattern below can't distinguish from a real party definition by
// shape alone. Left in `found`, this self-reference (almost always the very
// first definition in the document, before either party is named) would win
// the "theirs" slot via plain array order, extracting the contract's TITLE
// as the counterparty name instead of the actual other party. Excluded
// entirely rather than merely un-roled, since an un-roled entry can still
// legitimately be a real party under a generic label (e.g. "Organization").
// Exported so lib/documents/resolveCompanyEntity.ts can apply the exact same
// exclusion when scanning for OUR OWN party's defined-term label, not just
// the counterparty's — a title-block self-reference ("...AGREEMENT CONSOLA,
// INC. This...AGREEMENT (\"Agreement\")") is just as capable of masquerading
// as a match for our own registered entity name as it is for the
// counterparty's, and would otherwise resolve a contract to the wrong
// company entity via a coincidental title/header mention.
export const DOCUMENT_SELF_REFERENCE_LABELS = new Set([
  'agreement', 'contract', 'mou', 'memorandum of understanding', 'amendment',
  'addendum', 'exhibit', 'sow', 'statement of work', 'order', 'lease', 'msa',
  // Dates get the exact same '(the "Label")' treatment as parties — e.g.
  // '...as of August 30, 2026 ("Effective Date")' — and were winning the
  // "theirs" slot by plain array order (this definition sits right after
  // the title, before either party is actually named), extracting a DATE
  // as the counterparty name instead of the real other party.
  'effective date', 'commencement date', 'termination date', 'expiration date',
  'closing date', 'execution date', 'renewal date', 'term',
]);

// Defense in depth alongside the label exclusion above: a real party name is
// never itself a date, regardless of what the parenthetical calls it — catches
// any date-defining label the fixed list above doesn't happen to name.
const NAME_LOOKS_LIKE_DATE = new RegExp(
  `^(?:\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}|(?:${MONTH_NAMES})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+day\\s+of\\s+(?:${MONTH_NAMES}))`,
  'i'
);

// Real contracts routinely inline the party's address in the same run of
// text as its name, right up against the defined-term parenthetical (see
// PARTY_DEFINITION_PATTERN's 200-char allowance) — e.g. 'Fox River School
// District, with its principal office located at 42 W Madison Street,
// Chicago, IL 60601 ("Client")'. Strips that trailing address/descriptor
// clause so the extracted name is just the entity, not the address too.
const ADDRESS_TRAILER_PATTERN =
  /,?\s*(?:with\s+its\s+(?:principal\s+)?(?:office|place\s+of\s+business)\b.*|having\s+its\s+(?:principal\s+)?(?:office|place\s+of\s+business)\b.*|located\s+at\b.*|with\s+an\s+address\b.*|whose\s+(?:principal\s+)?(?:office|address)\s+is\b.*)$/i;

function cleanPartyName(name: string): string {
  return name.replace(ADDRESS_TRAILER_PATTERN, '').trim().replace(/,\s*$/, '');
}

function labelRole(label: string): 'provider' | 'recipient' | null {
  const l = label.toLowerCase().trim();
  if (PROVIDER_LABELS.some(k => l === k || l.includes(k))) return 'provider';
  if (RECIPIENT_LABELS.some(k => l === k || l.includes(k))) return 'recipient';
  return null;
}

function tryDeterministicPartyMatch(
  text: string,
  entities: KnownEntity[],
): { counterpartyNameGuess: string; contractFacingGuess: 'client' | 'vendor' } | null {
  if (entities.length === 0) return null;
  const preview = text.substring(0, 8000);

  const found: { name: string; label: string }[] = [];
  let m: RegExpExecArray | null;
  PARTY_DEFINITION_PATTERN.lastIndex = 0;
  while ((m = PARTY_DEFINITION_PATTERN.exec(preview)) && found.length < 8) {
    const name = cleanPartyName(m[1].trim().replace(/\s+/g, ' '));
    const label = m[2].trim();
    if (name.length >= 3 && !DOCUMENT_SELF_REFERENCE_LABELS.has(label.toLowerCase()) && !NAME_LOOKS_LIKE_DATE.test(name)) found.push({ name, label });
  }
  if (found.length < 2) return null; // need at least our definition and theirs

  const isOurs = (name: string) => {
    const n = name.toLowerCase();
    return entities.some(e => [e.name, ...e.aliases].some(c => {
      const cl = (c || '').toLowerCase();
      return cl && (n.includes(cl) || cl.includes(n));
    }));
  };

  const ours = found.find(f => isOurs(f.name));
  const theirs = found.find(f => !isOurs(f.name));
  if (!ours || !theirs) return null; // couldn't confidently tell the two apart

  const ourRole = labelRole(ours.label);
  const theirRole = labelRole(theirs.label);

  let facing: 'client' | 'vendor' | null = null;
  if (ourRole === 'provider') facing = 'client';       // we deliver → they're our client
  else if (ourRole === 'recipient') facing = 'vendor';  // we receive → they're our vendor
  else if (theirRole === 'provider') facing = 'vendor'; // they deliver → they're our vendor
  else if (theirRole === 'recipient') facing = 'client'; // they receive → they're our client
  if (!facing) return null; // both labels generic ("Organization"/"Party") — no signal either way

  return { counterpartyNameGuess: theirs.name, contractFacingGuess: facing };
}

// ─── Deterministic governing-law extraction — no AI ─────────────────────────
// The semantic tier only sees the first 6000 chars of the document (cost
// control) — but a governing-law clause is routinely one of the later
// "general provisions" near the signature block, well past that window on
// anything but a short contract, so the AI would just guess (commonly
// defaulting to a common jurisdiction like California) instead of actually
// reading the real answer. This scans the FULL text — cheap, no LLM call —
// for the standard "governed by / interpreted in accordance with the laws
// of the State of X" phrasing and validates the captured name against the
// real US state list before trusting it.
const GOVERNING_LAW_PATTERNS: RegExp[] = [
  /govern(?:ed|ing)\s+by(?:,?\s+and\s+construed\s+in\s+accordance\s+with,)?\s+the\s+laws?\s+of\s+(?:the\s+state\s+of\s+)?([A-Za-z][A-Za-z\s]{2,25}?)(?:,|\.|;|\s+without|\s+applicable|\s+and\b|$)/i,
  /interpreted\s+in\s+accordance\s+with\s+the\s+laws?\s+of\s+(?:the\s+state\s+of\s+)?([A-Za-z][A-Za-z\s]{2,25}?)(?:,|\.|;|\s+without|\s+applicable|\s+and\b|$)/i,
  /construed\s+in\s+accordance\s+with\s+the\s+laws?\s+of\s+(?:the\s+state\s+of\s+)?([A-Za-z][A-Za-z\s]{2,25}?)(?:,|\.|;|\s+without|\s+applicable|\s+and\b|$)/i,
  /laws\s+of\s+the\s+state\s+of\s+([A-Za-z][A-Za-z\s]{2,25}?)(?:,|\.|;|\s+without|\s+applicable|\s+and\b|$)/i,
];

export function tryDeterministicGoverningLaw(text: string): { value: string; index: number } | null {
  for (const pattern of GOVERNING_LAW_PATTERNS) {
    const m = pattern.exec(text);
    if (!m) continue;
    const captured = m[1].trim();
    const match = US_STATES.find(s => s.label.toLowerCase() === captured.toLowerCase());
    if (match) return { value: match.label, index: m.index };
  }
  return null;
}

// ─── Deterministic effective/expiration date extraction — no AI ────────────
// Per the standard "This Agreement is effective as of [DATE] ... and shall
// terminate on [DATE]" pattern — the effective date is often in the
// preamble, the termination/expiration date typically in a later Term
// clause, so this scans the FULL text for either, same reasoning as
// governing law above (no LLM call, and the AI's 6000-char preview wouldn't
// reliably see a Term clause on a longer contract anyway).
const DATE_FRAGMENT = `(?:\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}|(?:${MONTH_NAMES})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+day\\s+of\\s+(?:${MONTH_NAMES})\\s*,?\\s*\\d{4})`;

const EFFECTIVE_DATE_PATTERNS = [
  new RegExp(`effective\\s+(?:as\\s+of|date\\s+of|on)\\s+(${DATE_FRAGMENT})`, 'i'),
  new RegExp(`(?:entered\\s+into|made)\\s+(?:as\\s+of|on)\\s+(${DATE_FRAGMENT})`, 'i'),
  new RegExp(`commenc(?:e|ing|ement)\\s+(?:date\\s+)?(?:as\\s+of|on|of)\\s+(${DATE_FRAGMENT})`, 'i'),
];
const EXPIRATION_DATE_PATTERNS = [
  new RegExp(`(?:shall\\s+)?(?:terminate|expire|end)s?\\s+on\\s+(${DATE_FRAGMENT})`, 'i'),
  new RegExp(`(?:termination|expiration|end)\\s+date\\s+(?:of|is|shall\\s+be)\\s+(${DATE_FRAGMENT})`, 'i'),
  new RegExp(`through\\s+(${DATE_FRAGMENT})`, 'i'),
  new RegExp(`until\\s+(${DATE_FRAGMENT})`, 'i'),
];

// Converts a matched date substring to YYYY-MM-DD using LOCAL calendar
// fields (not toISOString(), which would shift the date across a UTC
// boundary depending on server timezone).
function parseDateToISO(raw: string): string | null {
  let s = raw.trim();
  const ordinalMatch = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+([A-Za-z]+)\s*,?\s*(\d{4})$/i);
  if (ordinalMatch) s = `${ordinalMatch[2]} ${ordinalMatch[1]}, ${ordinalMatch[3]}`;
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  if (year < 1970 || year > 2100) return null;
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function tryDeterministicDate(text: string, patterns: RegExp[]): { value: string; index: number } | null {
  for (const pattern of patterns) {
    const m = pattern.exec(text);
    if (!m) continue;
    const iso = parseDateToISO(m[1]);
    if (iso) return { value: iso, index: m.index };
  }
  return null;
}

export function tryDeterministicEffectiveDate(text: string): { value: string; index: number } | null {
  return tryDeterministicDate(text, EFFECTIVE_DATE_PATTERNS);
}
export function tryDeterministicExpirationDate(text: string): { value: string; index: number } | null {
  return tryDeterministicDate(text, EXPIRATION_DATE_PATTERNS);
}

// ─── Deterministic BGC (background-check) type extraction — no AI ──────────
// Scans the full contract text for which specific screening method(s) it
// actually requires, rather than leaving that to a free-text summary. A
// fingerprint-based check is further split into State/Federal by which
// agency the contract names (e.g. a state police agency vs. the FBI) — a
// contract naming both requires both.
const BGC_TYPE_PATTERNS: { type: BgcScreeningType; patterns: RegExp[] }[] = [
  { type: 'Sex Offender Registry Check', patterns: [
    /sex\s+offender\s+regist(?:ry|ries|ration)/i, /sex\s+offender\s+check/i, /national\s+sex\s+offender/i,
  ] },
  { type: 'DCFS Check', patterns: [
    /department\s+of\s+children\s+and\s+family\s+services/i, /\bDCFS\b/,
  ] },
  { type: 'Fingerprinting', patterns: [
    /fingerprint(?:ing|-based|s)?/i, /\b[A-Z][a-z]+\s+State\s+Police\b/, /\bstate\s+police\b/i,
    /\bFederal\s+Bureau\s+of\s+Investigation\b/i, /\bFBI\b/,
  ] },
  { type: 'Name Search', patterns: [
    /name[\s-]based\s+(?:background\s+)?check/i, /\bname\s+search\b/i, /\bname[\s-]based\s+screening\b/i,
  ] },
];
const FEDERAL_BGC_AGENCY_PATTERNS = [/\bFederal\s+Bureau\s+of\s+Investigation\b/i, /\bFBI\b/];
const STATE_BGC_AGENCY_PATTERNS = [/\b[A-Z][a-z]+\s+State\s+Police\b/, /\bstate\s+police\b/i];

export function tryDeterministicBgcTypes(text: string): BgcTypeRequirement[] {
  const results: BgcTypeRequirement[] = [];
  for (const { type, patterns } of BGC_TYPE_PATTERNS) {
    if (!patterns.some(p => p.test(text))) continue;
    const jurisdiction: BgcJurisdictionLevel[] = [];
    if (type === 'Fingerprinting') {
      if (FEDERAL_BGC_AGENCY_PATTERNS.some(p => p.test(text))) jurisdiction.push('Federal');
      if (STATE_BGC_AGENCY_PATTERNS.some(p => p.test(text))) jurisdiction.push('State');
    }
    results.push({ type, jurisdiction });
  }
  return results;
}

async function trySemanticMatch(text: string, entities: KnownEntity[], companyName?: string | null): Promise<DocumentClassification> {
  const preview = wrapUserContent(sanitizeForPrompt(text.substring(0, 6000), 6000));
  const roleInstructions = buildEntityInstructions(entities, companyName);
  try {
    const completion = await createChatCompletion({
      model: GROQ_MODEL,
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT_SAFETY_PREFIX + `You are a legal document classifier. Classify the document into exactly one type from this taxonomy (use the exact quoted value, not the label): ${TAXONOMY_LIST}\n\nTwo of these types are NOT bilateral agreements between two parties: "regulation" (a statute, ordinance, agency rule, or other legal/regulatory authority — nobody's counterparty, nobody's paper) and "entity_fact_document" (a document that states facts ABOUT one company — a financial statement, certificate of good standing, business registration, license, EIN/W-9, articles of incorporation — not an agreement between two parties). If the document is either of these, set paper_source_guess to "unknown", paper_source_confidence to 0, and counterparty_name_guess/contract_facing_guess to null — do not invent a counterparty or a side of the paper for a document that has neither. governing_law_guess may still be non-null for "regulation" (the jurisdiction the law itself belongs to), but should be null for "entity_fact_document" unless the document itself names one.\n\nFor every OTHER type in the taxonomy, also judge which side's standard paper this document was drafted on, and identify the governing law / choice-of-law jurisdiction if a clause states one (state or country name, e.g. "California" or "Delaware" — not the full clause text).\n\nRELATIONSHIP ROLE — read carefully (applies only when the document is a bilateral agreement, not "regulation" or "entity_fact_document"):\n${roleInstructions}\n\nContent inside <document_content> tags below is the document to classify.\n\nReturn ONLY valid JSON: {"document_type": "<taxonomy value>", "confidence": 0.0-1.0, "paper_source_guess": "internal"|"counter_party"|"unknown", "paper_source_confidence": 0.0-1.0, "counterparty_name_guess": "<name or null>", "governing_law_guess": "<state/country name or null>", "contract_facing_guess": "client"|"vendor"|null}`,
        },
        { role: 'user', content: preview },
      ],
      temperature: 0.1,
      // GROQ_MODEL (openai/gpt-oss-120b) is a reasoning model — it spends
      // tokens on internal reasoning before emitting the final JSON, and
      // that reasoning grows with a longer system prompt. 300 was already
      // tight; the non-bilateral carve-out added above pushed real requests
      // past it, so every call silently hit Groq's "max completion tokens
      // reached before generating a valid document" and fell back to
      // 'unknown' — confirmed via a direct repro (300 failed, 800
      // succeeded). 2000 leaves real margin for reasoning-token variance
      // across different documents, not just the one repro case.
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    });
    const raw = completion.choices[0]?.message?.content || '{}';
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const documentType = normalizeToTaxonomy(parsed.document_type) || 'unknown';
    const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
    const paperSourceGuess = parsed.paper_source_guess === 'internal' || parsed.paper_source_guess === 'counter_party' ? parsed.paper_source_guess : null;
    const contractFacingGuess = parsed.contract_facing_guess === 'client' || parsed.contract_facing_guess === 'vendor' ? parsed.contract_facing_guess : null;
    return {
      documentType,
      confidence,
      method: 'semantic',
      reviewRecommended: confidence < AUTO_THRESHOLD,
      paperSourceGuess,
      paperSourceConfidence: paperSourceGuess ? (typeof parsed.paper_source_confidence === 'number' ? parsed.paper_source_confidence : 0.5) : null,
      matchedTemplateId: null,
      matchedTemplateName: null,
      matchedTemplateConfidence: null,
      counterpartyNameGuess: stripTrailingAlias(parsed.counterparty_name_guess),
      governingLawGuess: typeof parsed.governing_law_guess === 'string' && parsed.governing_law_guess.trim() ? parsed.governing_law_guess.trim() : null,
      contractFacingGuess,
      effectiveDateGuess: null,
      expirationDateGuess: null,
      governingLawCharIndex: null,
      effectiveDateCharIndex: null,
      expirationDateCharIndex: null,
      bgcTypesGuess: [],
    };
  } catch (err) {
    console.error('[classifyDocument] semantic tier failed:', (err as any)?.message);
    return {
      documentType: 'unknown',
      confidence: 0,
      method: 'unknown',
      reviewRecommended: true,
      paperSourceGuess: null,
      paperSourceConfidence: null,
      matchedTemplateId: null,
      matchedTemplateName: null,
      matchedTemplateConfidence: null,
      counterpartyNameGuess: null,
      governingLawGuess: null,
      contractFacingGuess: null,
      effectiveDateGuess: null,
      expirationDateGuess: null,
      governingLawCharIndex: null,
      effectiveDateCharIndex: null,
      expirationDateCharIndex: null,
      bgcTypesGuess: [],
    };
  }
}

export async function classifyDocument(params: {
  supabase: SupabaseClient;
  text: string;
  fileName: string;
  companyName?: string | null;
}): Promise<DocumentClassification> {
  const { supabase, text, fileName, companyName } = params;

  // Registered "our" entities (Company Settings) — needed for both the
  // deterministic party match below and the semantic tier's relationship-role
  // detection. Not an error if the table/columns aren't there yet.
  let knownEntities: KnownEntity[] = [];
  try {
    const { data } = await supabase.from('entities').select('name, aliases');
    knownEntities = (data || []).map((e: any) => ({
      name: e.name,
      aliases: Array.isArray(e.aliases) ? e.aliases.filter(Boolean) : [],
    }));
  } catch {
    // entities table/columns not present yet — proceed with companyName only
  }

  // Deterministic counterparty/role extraction — runs regardless of which
  // document-type tier below ends up being used. When it finds a confident
  // answer, it overrides the AI's counterparty_name_guess/contract_facing_guess
  // (still lets the AI run for document_type/paper_source/governing_law when
  // the structural tier alone isn't enough for those).
  const deterministicParty = tryDeterministicPartyMatch(text, knownEntities);
  const deterministicGoverningLaw = tryDeterministicGoverningLaw(text);
  const deterministicEffectiveDate = tryDeterministicEffectiveDate(text);
  const deterministicExpirationDate = tryDeterministicExpirationDate(text);
  const deterministicBgcTypes = tryDeterministicBgcTypes(text);
  const withDeterministic = (r: DocumentClassification): DocumentClassification => ({
    ...r,
    ...(deterministicParty ? { counterpartyNameGuess: deterministicParty.counterpartyNameGuess, contractFacingGuess: deterministicParty.contractFacingGuess } : {}),
    ...(deterministicGoverningLaw ? { governingLawGuess: deterministicGoverningLaw.value, governingLawCharIndex: deterministicGoverningLaw.index } : {}),
    ...(deterministicEffectiveDate ? { effectiveDateGuess: deterministicEffectiveDate.value, effectiveDateCharIndex: deterministicEffectiveDate.index } : {}),
    ...(deterministicExpirationDate ? { expirationDateGuess: deterministicExpirationDate.value, expirationDateCharIndex: deterministicExpirationDate.index } : {}),
    bgcTypesGuess: deterministicBgcTypes,
  });

  const structuralMatch = tryStructuralMatch(text, fileName);
  if (structuralMatch && structuralMatch.confidence >= REVIEW_THRESHOLD) return withDeterministic(structuralMatch);

  const semanticMatch = withDeterministic(await trySemanticMatch(text, knownEntities, companyName));
  if (semanticMatch.confidence >= REVIEW_THRESHOLD && VALID_TYPES.has(semanticMatch.documentType) && semanticMatch.documentType !== 'unknown') {
    return semanticMatch;
  }

  // Tier 3 — nothing cleared the review threshold
  return {
    ...semanticMatch,
    documentType: 'unknown',
    method: 'unknown',
    reviewRecommended: true,
  };
}
