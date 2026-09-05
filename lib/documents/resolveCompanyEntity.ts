import { DOCUMENT_SELF_REFERENCE_LABELS } from '@/lib/documents/classifyDocument';

// ─── Deterministic Company-entity resolution ────────────────────────────────
// Answers "which registered `entities` row is OUR company in this contract's
// own text?" — feeds contracts.company_entity_id. Deliberately deterministic
// (regex/string matching against registered legal name + aliases + EIN), not
// an LLM guess: this decides which contracts count as evidence for a legal
// entity's regulatory applicability, so a hallucinated match would corrupt
// compliance determinations downstream, not just display wrong. Per-signal
// reliability, highest first: EIN exact match > registered legal name/alias
// found as a defined contract party. A contract whose own text never
// mentions the entity by name (e.g. test/fixture data for a different
// fictional company) must resolve to 'unresolved', never assigned by
// elimination just because only one entities row exists.

export interface CompanyEntityMatch {
  entityId: string;
  entityName: string;
  matchedText: string;         // the literal candidate string (name or alias) that matched
  method: 'ein' | 'legal_name' | 'alias';
  label: string | null;        // the defined-term role label found next to it, e.g. "Vendor"/"Provider" — null for an EIN-only match
  ein: string | null;          // the EIN found in the document text near/with this match, if any
}

export interface CompanyEntityResolution {
  status: 'resolved' | 'unresolved' | 'ambiguous';
  match: CompanyEntityMatch | null;
  candidates: CompanyEntityMatch[]; // >1 distinct entity ids here is exactly what makes status 'ambiguous'
  reason: string;
}

interface EntityRow {
  entity_id: string;
  name: string;
  aliases?: string[] | null;
  ein?: string | null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Builds a name matcher tolerant of the punctuation drift real contracts
// exhibit around corporate suffixes — the same legal name shows up as
// "Consola, Inc." in one document and "Consola, Inc," (comma, no period) in
// another. Splitting on commas/periods and rejoining with a flexible
// separator matches both without needing a punctuation-normalization pass
// over the whole document (which would break char-offset provenance).
function buildFlexibleNameRegex(name: string): string {
  const tokens = name.replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  return tokens.map(escapeRegex).join('[,.\\s]+') + '[,.]?';
}

const EIN_PATTERN = /\b(\d{2}-\d{7})\b/;

// Finds the FIRST occurrence of `candidateText` in `text` that is structured
// as a defined contract party — i.e. immediately followed (within a short,
// bounded window, tolerating an address/descriptor clause in between) by a
// "(...'Label')" defined-term parenthetical — while skipping any occurrence
// whose label is a document self-reference (title/heading mentions, dates)
// rather than a real party definition. Scans ALL occurrences via a global
// regex specifically so a false hit earlier in the document (e.g. the
// entity's name appearing in the title block) doesn't shadow a real party
// definition further down.
function findEntityPartyMention(text: string, candidateText: string): { label: string; matchStart: number } | null {
  const namePattern = buildFlexibleNameRegex(candidateText);
  const re = new RegExp(
    namePattern + '[^()]{0,150}?\\(\\s*(?:hereinafter\\s+)?(?:referred\\s+to\\s+as\\s+)?(?:the\\s+)?["“\']([A-Za-z][A-Za-z\\s/]{0,40}?)\\.?["”\']\\s*\\)',
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const label = m[1].trim();
    if (DOCUMENT_SELF_REFERENCE_LABELS.has(label.toLowerCase())) continue;
    return { label, matchStart: m.index };
  }
  return null;
}

export async function resolveCompanyEntity(supabase: any, documentText: string): Promise<CompanyEntityResolution> {
  const { data } = await supabase.from('entities').select('entity_id, name, aliases, ein');
  const entities: EntityRow[] = data || [];
  if (entities.length === 0) {
    return { status: 'unresolved', match: null, candidates: [], reason: 'No entities are registered (Settings → Company) to resolve against.' };
  }

  const einInDoc = EIN_PATTERN.exec(documentText)?.[1] || null;

  const matchesByEntity: CompanyEntityMatch[] = [];
  for (const entity of entities) {
    // EIN is checked first and independently of the name-scan below — an
    // exact EIN match is the single strongest signal available (a legal
    // name can coincidentally match a subsidiary/affiliate; an EIN can't).
    if (entity.ein && einInDoc && entity.ein.replace(/\D/g, '') === einInDoc.replace(/\D/g, '')) {
      matchesByEntity.push({
        entityId: entity.entity_id, entityName: entity.name, matchedText: einInDoc,
        method: 'ein', label: null, ein: einInDoc,
      });
      continue; // EIN match is conclusive for this entity; no need to also name-scan it
    }

    const candidates: { value: string; source: 'legal_name' | 'alias' }[] = [
      { value: entity.name, source: 'legal_name' },
      ...(entity.aliases || []).filter(Boolean).map(a => ({ value: a, source: 'alias' as const })),
    ];
    for (const cand of candidates) {
      const found = findEntityPartyMention(documentText, cand.value);
      if (found) {
        matchesByEntity.push({
          entityId: entity.entity_id, entityName: entity.name, matchedText: cand.value,
          method: cand.source, label: found.label, ein: einInDoc,
        });
        break; // first successful candidate for this entity is enough; move to next entity
      }
    }
  }

  const distinctEntityIds = new Set(matchesByEntity.map(m => m.entityId));

  if (distinctEntityIds.size === 0) {
    return {
      status: 'unresolved', match: null, candidates: [],
      reason: 'No registered entity\'s legal name, alias, or EIN was found as a defined party in this document.',
    };
  }
  if (distinctEntityIds.size > 1) {
    return {
      status: 'ambiguous', match: null, candidates: matchesByEntity,
      reason: `${distinctEntityIds.size} different registered entities each matched a defined party in this document — cannot determine which one this contract is with automatically.`,
    };
  }
  // Prefer an EIN match over a name/alias match if both happened to be collected for the one matched entity.
  const best = matchesByEntity.find(m => m.method === 'ein') || matchesByEntity[0];
  return {
    status: 'resolved', match: best, candidates: matchesByEntity,
    reason: best.method === 'ein'
      ? `Matched by EIN ${best.ein} against registered entity "${best.entityName}".`
      : `Matched "${best.matchedText}" as the defined party labeled "${best.label}", against registered entity "${best.entityName}" (${best.method === 'alias' ? 'via alias' : 'legal name'}).`,
  };
}
