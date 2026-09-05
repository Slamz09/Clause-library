import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { requireSession } from '@/lib/auth/requireSession';

// Every column except file_text (the extracted document text — can be tens
// of KB per row). List views only ever build id/title/type/etc lookup maps;
// components that actually need a document's text already have their own
// fallback (fetch by document_id below, or /api/documents/uploads) for when
// it's missing, since that's the same path legacy rows without cached text
// already took.
const LIST_COLUMNS = 'document_id, title, document_type, document_subtype, entity_id, asset_id, counterparty_name, effective_date, expiration_date, status, created_at, entity_name, parent_doc_id, doc_relation, doc_timeline, governing_state, party_position, compliance_score, extraction_mode, deep_extracted_at';

export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const { searchParams } = new URL(req.url);
  const documentId = searchParams.get('document_id');

  if (documentId) {
    const { data, error } = await supabase.from('documents').select('*').eq('document_id', documentId).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ documents: data ? [data] : [] });
  }

  const { data, error } = await supabase.from('documents').select(LIST_COLUMNS).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ documents: data || [] });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const { document_id, ...updates } = body;
  if (!document_id) return NextResponse.json({ error: 'document_id required' }, { status: 400 });
  const { data, error } = await supabase.from('documents').update(updates).eq('document_id', document_id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ document: data });
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const { title, document_type, entity_id, entity_name, counterparty_name, status, file_text, effective_date } = body;
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });

  const { data: existingDocs } = await supabase.from('documents').select('document_id');
  let maxDocNum = 0;
  for (const row of existingDocs || []) {
    const match = (row.document_id as string)?.match(/^doc_(\d+)$/);
    if (match) maxDocNum = Math.max(maxDocNum, parseInt(match[1], 10));
  }
  const doc_id = `doc_${String(maxDocNum + 1).padStart(4, '0')}`;
  const record: Record<string, unknown> = {
    document_id: doc_id,
    title,
    document_type: document_type || 'general_contract',
    status: status || 'active',
  };
  if (entity_id) record.entity_id = entity_id;
  if (entity_name) record.entity_name = entity_name;
  if (file_text) record.file_text = file_text;
  if (effective_date) record.effective_date = effective_date;

  // Try with counterparty_name first; fall back if column missing
  if (counterparty_name) {
    const { data, error } = await supabase.from('documents').insert([{ ...record, counterparty_name }]).select().single();
    if (!error) return NextResponse.json({ document: data });
  }

  const { data, error } = await supabase.from('documents').insert([record]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ document: data });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const document_id = searchParams.get('document_id');
  if (!document_id) return NextResponse.json({ error: 'document_id required' }, { status: 400 });
  const supabase = createServerClient();
  const { error } = await supabase.from('documents').delete().eq('document_id', document_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
