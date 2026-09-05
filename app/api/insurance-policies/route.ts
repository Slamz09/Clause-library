import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { requireSession } from '@/lib/auth/requireSession';

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('insurance_policies')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ policies: data || [] });
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const {
    document_id, source_document_type, linked_client_ids, coverage_type, coverage_amount,
    effective_date, expiration_date, states, policy_number, insurance_company, named_insured,
  } = body;

  const { data: existing } = await supabase.from('insurance_policies').select('policy_id');
  let maxNum = 0;
  for (const row of existing || []) {
    const m = (row.policy_id as string)?.match(/^INS-(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  const policy_id = `INS-${String(maxNum + 1).padStart(3, '0')}`;

  const { data, error } = await supabase.from('insurance_policies').insert([{
    policy_id,
    document_id: document_id || null,
    source_document_type: source_document_type || null,
    policy_number: policy_number || '',
    insurance_company: insurance_company || '',
    named_insured: named_insured || [],
    linked_client_ids: linked_client_ids || [],
    coverage_type: coverage_type || '',
    coverage_amount: coverage_amount || '',
    effective_date: effective_date || '',
    expiration_date: expiration_date || '',
    states: states || [],
  }]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ policy: data });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const { policy_id, ...updates } = body;
  if (!policy_id) return NextResponse.json({ error: 'policy_id required' }, { status: 400 });
  const { data, error } = await supabase
    .from('insurance_policies').update(updates).eq('policy_id', policy_id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ policy: data });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const policy_id = searchParams.get('policy_id');
  if (!policy_id) return NextResponse.json({ error: 'policy_id required' }, { status: 400 });
  const supabase = createServerClient();
  const { error } = await supabase.from('insurance_policies').delete().eq('policy_id', policy_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
