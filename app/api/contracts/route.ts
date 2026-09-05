import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { requireSession } from '@/lib/auth/requireSession';
import { resolveCompanyEntity } from '@/lib/documents/resolveCompanyEntity';
import { extractOperationalFacts, writeOperationalFacts } from '@/lib/documents/extractOperationalFacts';

// ─── Contracts are Documents ────────────────────────────────────────────────
// A contract is no longer a separate row with its own CNT-### id — it IS the
// `documents` row. This route is a compatibility surface: it reads and writes
// the contract-relationship columns on `documents` and returns them in the
// legacy `Contract` shape (contract_id === the document_id, or the preserved
// legacy_contract_id for the handful of pre-merge rows), so ContractsTab,
// ObligationDetailPanel, bgcCompliance, etc. keep working unchanged.
//
// scripts/2026-merge-contracts-into-documents.sql adds those columns and
// backfills them from the old contracts table (kept in place, read-only
// fallback only).

const CONTRACT_COLUMNS = [
  'document_id', 'title', 'document_type', 'status', 'created_at',
  'contract_facing', 'linked_client_id', 'linked_client_name',
  'linked_vendor_id', 'linked_vendor_name', 'governing_law', 'paper_source',
  'counterparty_type', 'contract_type', 'company_entity_id',
  'effective_date', 'expiration_date', 'extracted_obligations',
  'privacy_requirements', 'client_specific_bgc_requirements',
  'recording_rule', 'recording_rule_clause_id',
  'bgc_interval_months', 'bgc_interval_clause_id', 'bgc_requirement_types',
  'governing_law_clause_id', 'effective_date_clause_id', 'expiration_date_clause_id',
  'legacy_contract_id',
].join(', ');

// Non-contract document families that must never appear in the contracts list.
const NON_CONTRACT_TYPES = new Set([
  'insurance_policy', 'certificate_of_insurance', 'regulation', 'entity_fact_document',
]);

function shapeContract(d: any) {
  return {
    contract_id: d.legacy_contract_id || d.document_id,
    document_id: d.document_id,
    governing_law: d.governing_law || '',
    linked_client_id: d.linked_client_id || '',
    linked_client_name: d.linked_client_name || '',
    linked_vendor_id: d.linked_vendor_id || '',
    linked_vendor_name: d.linked_vendor_name || '',
    paper_source: d.paper_source || 'internal',
    contract_facing: d.contract_facing || 'client',
    counterparty_type: d.counterparty_type || '',
    contract_type: d.contract_type || d.document_type || '',
    company_entity_id: d.company_entity_id || null,
    effective_date: d.effective_date || '',
    expiration_date: d.expiration_date || '',
    extracted_obligations: d.extracted_obligations || '',
    privacy_requirements: d.privacy_requirements || '',
    client_specific_bgc_requirements: d.client_specific_bgc_requirements || '',
    recording_rule: d.recording_rule ?? null,
    recording_rule_clause_id: d.recording_rule_clause_id ?? null,
    bgc_interval_months: d.bgc_interval_months ?? null,
    bgc_interval_clause_id: d.bgc_interval_clause_id ?? null,
    bgc_requirement_types: d.bgc_requirement_types ?? [],
    governing_law_clause_id: d.governing_law_clause_id ?? null,
    effective_date_clause_id: d.effective_date_clause_id ?? null,
    expiration_date_clause_id: d.expiration_date_clause_id ?? null,
    status: d.status || 'active',
    title: d.title || d.document_id,
  };
}

// A document is treated as a contract when it carries any
// contract-relationship signal.
function isContractDoc(d: any): boolean {
  if (NON_CONTRACT_TYPES.has(d.document_type)) return false;
  return !!(d.legacy_contract_id || d.contract_facing || d.linked_client_id || d.linked_vendor_id);
}

async function resolveDocId(supabase: any, contractId: string): Promise<string | null> {
  if (/^CNT-/i.test(contractId)) {
    const { data } = await supabase.from('documents').select('document_id').eq('legacy_contract_id', contractId).maybeSingle();
    return data?.document_id ?? null;
  }
  return contractId;
}

export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '2000', 10) || 2000, 1), 5000);

  let { data, error } = await supabase
    .from('documents')
    .select(CONTRACT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);

  // Pre-migration fallback: contract columns don't exist yet -> serve the
  // legacy contracts table so nothing breaks before the SQL is run.
  if (error?.code === '42703') {
    const legacy = await supabase.from('contracts').select('*').order('created_at', { ascending: false }).limit(limit);
    return NextResponse.json({ contracts: legacy.data || [] });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const contracts = (data || []).filter(isContractDoc).map(shapeContract);
  return NextResponse.json({ contracts });
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const {
    governing_law, linked_client_id, linked_client_name, paper_source,
    effective_date, expiration_date, extracted_obligations,
    privacy_requirements, client_specific_bgc_requirements, document_id,
    contract_facing, linked_vendor_id, linked_vendor_name, contract_type,
    bgc_interval_months, counterparty_type, bgc_requirement_types,
  } = body;

  if (!document_id) {
    return NextResponse.json({ error: 'document_id is required — a contract is a Document' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    contract_facing: contract_facing || 'client',
  };
  if (governing_law !== undefined) updates.governing_law = governing_law || '';
  if (paper_source !== undefined) updates.paper_source = paper_source || 'internal';
  if (effective_date) updates.effective_date = effective_date;
  if (expiration_date) updates.expiration_date = expiration_date;
  if (extracted_obligations !== undefined) updates.extracted_obligations = extracted_obligations || '';
  if (privacy_requirements !== undefined) updates.privacy_requirements = privacy_requirements || '';
  if (client_specific_bgc_requirements !== undefined) updates.client_specific_bgc_requirements = client_specific_bgc_requirements || '';
  if (contract_type) updates.contract_type = contract_type;
  if (counterparty_type) updates.counterparty_type = counterparty_type;
  if (bgc_interval_months != null && bgc_interval_months !== '') updates.bgc_interval_months = Number(bgc_interval_months);
  if (Array.isArray(bgc_requirement_types)) updates.bgc_requirement_types = bgc_requirement_types;
  if ((contract_facing || 'client') === 'vendor') {
    updates.linked_vendor_id = linked_vendor_id || '';
    updates.linked_vendor_name = linked_vendor_name || '';
    updates.linked_client_id = '';
    updates.linked_client_name = '';
  } else {
    updates.linked_client_id = linked_client_id || '';
    updates.linked_client_name = linked_client_name || '';
  }

  // Company entity — deterministic, never guessed (resolveCompanyEntity).
  let docText: string | null = null;
  try {
    const { data: doc } = await supabase.from('documents').select('file_text').eq('document_id', document_id).single();
    if (doc?.file_text) {
      docText = doc.file_text;
      const resolution = await resolveCompanyEntity(supabase, doc.file_text);
      if (resolution.status === 'resolved') updates.company_entity_id = resolution.match!.entityId;
    }
  } catch { /* best-effort */ }

  let { data, error } = await supabase.from('documents').update(updates).eq('document_id', document_id).select(CONTRACT_COLUMNS).single();
  if (error?.code === '42703') {
    return NextResponse.json({ error: 'Run scripts/2026-merge-contracts-into-documents.sql first — the documents table has no contract columns yet.' }, { status: 500 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Document-derived canonical operational facts about the client this
  // agreement governs (client_is_lea, activity_type, jurisdiction).
  if (docText && (updates.contract_facing !== 'vendor') && linked_client_id) {
    try {
      const opFacts = await extractOperationalFacts(docText);
      const { written } = await writeOperationalFacts(supabase, document_id, linked_client_id, document_id, opFacts);
      if (written.length) console.info(`[contracts POST] wrote operational facts [${written.join(', ')}] (client=${linked_client_id}, doc=${document_id})`);
    } catch (err: any) {
      console.error('[contracts POST] operational fact extraction error:', err?.message);
    }
  }

  return NextResponse.json({ contract: shapeContract(data) });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const { contract_id, document_id: bodyDocId, ...rawUpdates } = body;
  const key = bodyDocId || contract_id;
  if (!key) return NextResponse.json({ error: 'contract_id (or document_id) required' }, { status: 400 });

  const docId = await resolveDocId(supabase, key);
  if (!docId) return NextResponse.json({ error: 'contract not found' }, { status: 404 });

  // Only allow contract-relationship columns through — never let a contract
  // PATCH rewrite arbitrary document fields.
  const ALLOWED = new Set([
    'contract_facing', 'linked_client_id', 'linked_client_name', 'linked_vendor_id',
    'linked_vendor_name', 'governing_law', 'paper_source', 'counterparty_type',
    'contract_type', 'effective_date', 'expiration_date', 'extracted_obligations',
    'privacy_requirements', 'client_specific_bgc_requirements', 'recording_rule',
    'recording_rule_clause_id', 'bgc_interval_months', 'bgc_interval_clause_id',
    'bgc_requirement_types', 'governing_law_clause_id', 'effective_date_clause_id',
    'expiration_date_clause_id', 'company_entity_id', 'status',
  ]);
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawUpdates)) if (ALLOWED.has(k)) updates[k] = v;
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'no updatable contract fields' }, { status: 400 });

  const { data, error } = await supabase.from('documents').update(updates).eq('document_id', docId).select(CONTRACT_COLUMNS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contract: shapeContract(data) });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const contract_id = searchParams.get('contract_id');
  if (!contract_id) return NextResponse.json({ error: 'contract_id required' }, { status: 400 });
  const supabase = createServerClient();

  const docId = await resolveDocId(supabase, contract_id);
  // "Delete contract" = this Document is no longer tracked as a contract. The
  // Document itself (and its clauses) stays.
  if (docId) {
    await supabase.from('documents').update({
      contract_facing: null, linked_client_id: null, linked_client_name: null,
      linked_vendor_id: null, linked_vendor_name: null, legacy_contract_id: null,
    }).eq('document_id', docId);
  }
  // Drop any legacy contracts row too.
  await supabase.from('contracts').delete().eq('contract_id', contract_id).then(undefined, () => {});
  return NextResponse.json({ success: true });
}
