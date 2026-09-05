import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { requireSession } from '@/lib/auth/requireSession';

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('service_providers')
    .select('*')
    .order('legal_name');
  // Standalone build: this parent-platform table may not exist. Degrade to an
  // empty list rather than 500 — the parser/clause-library UI only uses it to
  // populate an optional counterparty dropdown.
  if (error) {
    console.warn('[vendors] service_providers query failed — returning empty:', error.message);
    return NextResponse.json({ service_providers: [] });
  }
  return NextResponse.json({ service_providers: data || [] });
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const { legal_name, display_name, entity_type, provider_type, contact_name, contact_email, website, notes, capabilities, state, clients_serviced } = body;
  if (!legal_name?.trim()) return NextResponse.json({ error: 'legal_name required' }, { status: 400 });

  const { data: existing } = await supabase.from('service_providers').select('service_provider_id');
  let maxNum = 0;
  for (const row of existing || []) {
    const m = (row.service_provider_id as string)?.match(/^SP-(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  const service_provider_id = `SP-${String(maxNum + 1).padStart(3, '0')}`;

  const { data, error } = await supabase.from('service_providers').insert([{
    service_provider_id,
    legal_name: legal_name.trim(),
    display_name: display_name || null,
    entity_type: entity_type || 'Organization',
    provider_type: provider_type || null,
    contact_name: contact_name || null,
    contact_email: contact_email || null,
    website: website || null,
    notes: notes || null,
    capabilities: capabilities && Object.keys(capabilities).length ? capabilities : null,
    state: state || null,
    clients_serviced: Array.isArray(clients_serviced) ? clients_serviced : [],
  }]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ service_provider: data });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const { service_provider_id, ...updates } = body;
  if (!service_provider_id) return NextResponse.json({ error: 'service_provider_id required' }, { status: 400 });
  const { data, error } = await supabase
    .from('service_providers').update(updates).eq('service_provider_id', service_provider_id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ service_provider: data });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const service_provider_id = searchParams.get('service_provider_id');
  if (!service_provider_id) return NextResponse.json({ error: 'service_provider_id required' }, { status: 400 });
  const supabase = createServerClient();
  const { error } = await supabase.from('service_providers').delete().eq('service_provider_id', service_provider_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
