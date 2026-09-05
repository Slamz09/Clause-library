import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { requireSession } from '@/lib/auth/requireSession';

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('workers')
    .select('*')
    .order('worker_id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // The workers table still has this column as `customer_id` (pre-dates the
  // customers -> clients rename); the app-facing Worker type calls it
  // client_id everywhere else, so translate at this boundary.
  const workers = (data || []).map(({ customer_id, ...rest }) => ({ ...rest, client_id: customer_id }));
  return NextResponse.json({ workers });
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const {
    service_provider_id, legal_name, display_name, worker_type, relationship_type, status,
    contact_email, phone, city, state, qualifications, compliance_status, notes,
    start_date, bgc_status, bgc_type, first_bgc_date, last_bgc_date, bgc_duration,
    assigned_service_engagements_count, linked_incidents, linked_complaints, client_id,
    bgc_requirement_types,
  } = body;

  if (!legal_name) return NextResponse.json({ error: 'legal_name required' }, { status: 400 });

  // CSV import may supply its own worker_id (carried over from a prior
  // export); fall back to auto-generating the next sequential one.
  let worker_id: string = body.worker_id || '';
  if (!worker_id) {
    const { data: existing } = await supabase.from('workers').select('worker_id');
    let maxNum = 0;
    for (const row of existing || []) {
      const m = (row.worker_id as string)?.match(/^W-(\d+)$/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }
    worker_id = `W-${String(maxNum + 1).padStart(3, '0')}`;
  }

  const { data, error } = await supabase.from('workers').insert([{
    worker_id,
    service_provider_id: service_provider_id || null,
    legal_name,
    display_name: display_name || null,
    worker_type: worker_type || 'Driver',
    relationship_type: relationship_type || 'Employee',
    status: status || 'Active',
    contact_email: contact_email || null,
    phone: phone || null,
    city: city || null,
    state: state || null,
    qualifications: qualifications || null,
    compliance_status: compliance_status || null,
    notes: notes || null,
    start_date: start_date || '',
    bgc_status: bgc_status || 'missing',
    bgc_type: bgc_type || '',
    first_bgc_date: first_bgc_date || '',
    last_bgc_date: last_bgc_date || '',
    bgc_duration: bgc_duration || '',
    assigned_service_engagements_count: assigned_service_engagements_count ?? 0,
    linked_incidents: linked_incidents || [],
    linked_complaints: linked_complaints || [],
    bgc_requirement_types: Array.isArray(bgc_requirement_types) ? bgc_requirement_types : [],
    // See GET: this column is `customer_id` on the workers table itself.
    customer_id: client_id || '',
  }]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { customer_id, ...rest } = data;
  return NextResponse.json({ worker: { ...rest, client_id: customer_id } });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const { worker_id, client_id, ...updates } = body;
  if (!worker_id) return NextResponse.json({ error: 'worker_id required' }, { status: 400 });
  // See GET: this column is `customer_id` on the workers table itself.
  if (client_id !== undefined) updates.customer_id = client_id;
  let { data, error } = await supabase
    .from('workers').update(updates).eq('worker_id', worker_id).select().single();
  // Retry without clients_serviced if that column isn't there yet
  // (scripts/add-workers-clients-serviced-column.sql not applied).
  if (error?.code === '42703' && 'clients_serviced' in updates) {
    delete (updates as Record<string, unknown>).clients_serviced;
    ({ data, error } = await supabase.from('workers').update(updates).eq('worker_id', worker_id).select().single());
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { customer_id, ...rest } = data;
  return NextResponse.json({ worker: { ...rest, client_id: customer_id } });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const worker_id = searchParams.get('worker_id');
  if (!worker_id) return NextResponse.json({ error: 'worker_id required' }, { status: 400 });
  const supabase = createServerClient();
  const { error } = await supabase.from('workers').delete().eq('worker_id', worker_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
