import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { requireSession } from '@/lib/auth/requireSession';

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('service_recipients')
    .select('*')
    .order('service_recipient_id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Some rows predate the recording_consent column (or were inserted before
  // its NOT NULL constraint existed) and read back as null — default them
  // the same way POST does so every consumer can assume the field is set.
  const service_recipients = (data || []).map(r => ({
    ...r,
    recording_consent: r.recording_consent || { in_app_video: 'opt-in', in_app_audio: 'opt-in', dash_cam_video: 'opt-in' },
  }));
  return NextResponse.json({ service_recipients });
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const {
    recording_consent, linked_service_engagement_ids, client_id, client_name,
    recipient_type, first_name, last_name, jurisdiction, privacy_preferences, special_requirements,
  } = body;

  // CSV import may supply its own service_recipient_id (carried over from a
  // prior export); fall back to auto-generating the next sequential one.
  let service_recipient_id: string = body.service_recipient_id || '';
  if (!service_recipient_id) {
    const { data: existing } = await supabase.from('service_recipients').select('service_recipient_id');
    let maxNum = 0;
    for (const row of existing || []) {
      const m = (row.service_recipient_id as string)?.match(/^SR-(\d+)$/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }
    service_recipient_id = `SR-${String(maxNum + 1).padStart(3, '0')}`;
  }

  const { data, error } = await supabase.from('service_recipients').insert([{
    service_recipient_id,
    // client_id/client_name/first_name/last_name/recipient_type are
    // non-optional `string` fields on the ServiceRecipient type — default
    // to '' rather than null so downstream code that assumes a real string
    // never chokes on a null read back from the database.
    recording_consent: recording_consent || { in_app_video: 'opt-in', in_app_audio: 'opt-in', dash_cam_video: 'opt-in' },
    linked_service_engagement_ids: linked_service_engagement_ids || [],
    client_id: client_id || '',
    client_name: client_name || '',
    recipient_type: recipient_type || 'Rider / Student',
    first_name: first_name || '',
    last_name: last_name || '',
    jurisdiction: jurisdiction || null,
    privacy_preferences: privacy_preferences || null,
    special_requirements: special_requirements || null,
  }]).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ service_recipient: data });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const { service_recipient_id, ...updates } = body;
  if (!service_recipient_id) return NextResponse.json({ error: 'service_recipient_id required' }, { status: 400 });
  const { data, error } = await supabase
    .from('service_recipients').update(updates).eq('service_recipient_id', service_recipient_id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ service_recipient: data });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const service_recipient_id = searchParams.get('service_recipient_id');
  if (!service_recipient_id) return NextResponse.json({ error: 'service_recipient_id required' }, { status: 400 });
  const supabase = createServerClient();
  const { error } = await supabase.from('service_recipients').delete().eq('service_recipient_id', service_recipient_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
