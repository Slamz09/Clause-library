import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { requireSession } from '@/lib/auth/requireSession';

// Blank/unrecognized stays null ("unknown") — never silently defaulted to
// opt-out. Only an explicit 'opt-in'/'opt-out' (Edit form, CSV import, or
// the clause extraction pipeline) ever sets one of these.
function consentValue(v: unknown): 'opt-in' | 'opt-out' | null {
  return v === 'opt-in' || v === 'opt-out' ? v : null;
}

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('clients')
    .select('client_id, client_name, city, state, region, video_consent_policy, dash_cam_video_consent_policy, audio_consent_policy, ai_use_consent_policy, insurance_policy_id, insurance_coverage, additional_insured, prohibition_on_data_sharing, total_service_engagements_count, incidents, complaints, driver_compliance_issues, contracts_active, contracts_expired, contracts_approaching, compliance_flags, bgc_requirement_types')
    .order('client_name');
  // Standalone build: this parent-platform table may not exist. Degrade to an
  // empty list rather than 500.
  if (error) {
    console.warn('[customers] clients query failed — returning empty:', error.message);
    return NextResponse.json({ clients: [] });
  }
  // Deduplicate by client_id in case of duplicate rows in the database
  const deduped = Array.from(new Map((data || []).map(c => [c.client_id, c])).values());
  return NextResponse.json({ clients: deduped });
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const {
    client_name, city, state, region, video_consent_policy, dash_cam_video_consent_policy, audio_consent_policy, ai_use_consent_policy,
    insurance_policy_id, insurance_coverage, additional_insured,
    prohibition_on_data_sharing,
  } = body;
  if (!client_name) return NextResponse.json({ error: 'client_name required' }, { status: 400 });

  const base = {
    client_name,
    city: city || '',
    state: state || '',
    region: region || '',
    video_consent_policy: consentValue(video_consent_policy),
    dash_cam_video_consent_policy: consentValue(dash_cam_video_consent_policy),
    audio_consent_policy: consentValue(audio_consent_policy),
    ai_use_consent_policy: consentValue(ai_use_consent_policy),
    insurance_policy_id: insurance_policy_id || '',
    insurance_coverage: insurance_coverage || '',
    additional_insured: additional_insured ?? false,
    prohibition_on_data_sharing: prohibition_on_data_sharing ?? false,
    total_service_engagements_count: 0,
    incidents: 0,
    complaints: 0,
    driver_compliance_issues: 0,
    contracts_active: 0,
    contracts_expired: 0,
    contracts_approaching: 0,
    compliance_flags: { insurance: false, privacy: false, driver: false },
  };

  // Generating "next CLI-###" from a SELECT-then-INSERT is inherently racy
  // under concurrent imports (two requests can both read the same max before
  // either commits) — client_id is a real primary key, so a collision fails
  // the insert with a unique-violation (23505) rather than creating a
  // duplicate row. Retry with a freshly-read id on that specific error.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing } = await supabase.from('clients').select('client_id');
    let maxNum = 0;
    for (const row of existing || []) {
      const match = (row.client_id as string)?.match(/^CLI-(\d+)$/);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
    const client_id = `CLI-${String(maxNum + 1).padStart(3, '0')}`;

    const { data, error } = await supabase.from('clients').insert([{ client_id, ...base }]).select().single();
    if (!error) return NextResponse.json({ client: data });
    if (error.code !== '23505') return NextResponse.json({ error: error.message }, { status: 500 });
    // else: id collision — loop and retry with a fresh id
  }
  return NextResponse.json({ error: 'Could not generate a unique client_id after several attempts' }, { status: 500 });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const { client_id, ...updates } = body;
  if (!client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 });
  for (const key of ['video_consent_policy', 'dash_cam_video_consent_policy', 'audio_consent_policy', 'ai_use_consent_policy'] as const) {
    if (key in updates) updates[key] = consentValue(updates[key]);
  }
  const { data, error } = await supabase
    .from('clients')
    .update(updates)
    .eq('client_id', client_id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ client: data });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get('client_id');
  if (!client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 });
  const supabase = createServerClient();
  const { error } = await supabase.from('clients').delete().eq('client_id', client_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
