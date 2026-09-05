import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { requireSession } from '@/lib/auth/requireSession';

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('service_engagements')
    .select('*')
    .order('service_engagement_id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ service_engagements: data || [] });
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const {
    date, service_engagement_type, worker_id, client_name, client_id, state, city,
    video_recorded, recording_technologies, linked_service_recipient_ids, linked_safety_incidents, linked_complaints,
    vendor_id, vendor_name,
  } = body;

  // CSV import may supply its own service_engagement_id (carried over from a
  // prior export); fall back to auto-generating the next sequential one.
  let service_engagement_id: string = body.service_engagement_id || '';
  if (!service_engagement_id) {
    const { data: existing } = await supabase.from('service_engagements').select('service_engagement_id');
    let maxNum = 0;
    for (const row of existing || []) {
      const m = (row.service_engagement_id as string)?.match(/^SE-(\d+)$/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }
    service_engagement_id = `SE-${String(maxNum + 1).padStart(3, '0')}`;
  }

  const { data, error } = await supabase.from('service_engagements').insert([{
    service_engagement_id,
    // These map to non-optional `string` fields on the ServiceEngagement type
    // (only vendor_id/vendor_name are optional) — default to '' rather than
    // null so downstream code that assumes a real string never chokes on a
    // null read back from the database.
    date: date || '',
    service_engagement_type: service_engagement_type || 'Single',
    worker_id: worker_id || '',
    client_name: client_name || '',
    client_id: client_id || '',
    state: state || '',
    city: city || '',
    video_recorded: video_recorded ?? false,
    recording_technologies: recording_technologies || [],
    linked_service_recipient_ids: linked_service_recipient_ids || [],
    linked_safety_incidents: linked_safety_incidents || [],
    linked_complaints: linked_complaints || [],
    vendor_id: vendor_id || null,
    vendor_name: vendor_name || null,
  }]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ service_engagement: data });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const { service_engagement_id, ...updates } = body;
  if (!service_engagement_id) return NextResponse.json({ error: 'service_engagement_id required' }, { status: 400 });
  const { data, error } = await supabase
    .from('service_engagements').update(updates).eq('service_engagement_id', service_engagement_id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ service_engagement: data });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const service_engagement_id = searchParams.get('service_engagement_id');
  if (!service_engagement_id) return NextResponse.json({ error: 'service_engagement_id required' }, { status: 400 });
  const supabase = createServerClient();
  const { error } = await supabase.from('service_engagements').delete().eq('service_engagement_id', service_engagement_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
