import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { requireSession } from '@/lib/auth/requireSession';

function makePlaybookId(): string {
  return `pb_${Math.random().toString(36).substring(2, 10)}`;
}

export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const document_type = searchParams.get('document_type');
  const supabase = createServerClient();

  if (id) {
    const { data, error } = await supabase
      .from('contract_playbooks')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ playbook: data });
  }

  if (document_type) {
    const { data, error } = await supabase
      .from('contract_playbooks')
      .select('*')
      .eq('document_type', document_type)
      .order('name', { ascending: true });
    if (error) {
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        return NextResponse.json({ playbooks: [] });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ playbooks: data ?? [] });
  }

  const all = searchParams.get('all') === '1';
  let query = supabase
    .from('contract_playbooks')
    .select('*')
    .order('document_type', { ascending: true });
  if (!all) query = query.eq('active', true);
  const { data, error } = await query;
  // Table not yet created → return empty list instead of 500
  if (error) {
    if (error.message?.includes('does not exist') || error.code === '42P01') {
      return NextResponse.json({ playbooks: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ playbooks: data ?? [] });
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const body = await req.json();
  const { document_type, name, ...rest } = body;
  if (!document_type) return NextResponse.json({ error: 'document_type required' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('contract_playbooks')
    .insert({ id: makePlaybookId(), document_type, name, ...rest, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ playbook: data });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('contract_playbooks')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ playbook: data });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = createServerClient();
  const { error } = await supabase.from('contract_playbooks').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
