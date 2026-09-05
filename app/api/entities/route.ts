import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { requireSession } from '@/lib/auth/requireSession';
import { sanitizeDbError } from '@/lib/security/safeError';

// "Our" business entities — Company Settings (app/(app)/settings/company).
// This is the list automatic counterparty/relationship detection matches
// contract party names against (see lib/documents/classifyDocument.ts) —
// without it, bulk upload and Document Parser have no way to tell which
// party in a contract is "us" vs. the counterparty.

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const { data, error } = await supabase.from('entities').select('*').order('name', { ascending: true });
  // Standalone build: table may not exist. Degrade to empty rather than 500 —
  // classifyDocument() reads this only for company-name matching.
  if (error) {
    console.warn('[entities] query failed — returning empty:', error.message);
    return NextResponse.json({ entities: [] });
  }
  return NextResponse.json({ entities: data || [] });
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const { name, aliases, ein, address, state, contract_contact_name, contract_contact_email, notes } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const { data: existing } = await supabase.from('entities').select('entity_id');
  let maxNum = 0;
  for (const row of existing || []) {
    const match = (row.entity_id as string)?.match(/^ent_(\d+)$/);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  const entity_id = `ent_${String(maxNum + 1).padStart(3, '0')}`;

  const record: Record<string, unknown> = {
    entity_id,
    name: name.trim(),
    aliases: Array.isArray(aliases) ? aliases.filter(Boolean) : [],
  };
  if (ein) record.ein = ein;
  if (address) record.address = address;
  if (state) record.state = state;
  if (contract_contact_name) record.contract_contact_name = contract_contact_name;
  if (contract_contact_email) record.contract_contact_email = contract_contact_email;
  if (notes) record.notes = notes;

  const { data, error } = await supabase.from('entities').insert(record).select().single();
  if (error) return NextResponse.json({ error: sanitizeDbError(error) }, { status: 500 });
  return NextResponse.json({ entity: data });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const supabase = createServerClient();
  const body = await req.json();
  const { entity_id, ...updates } = body;
  if (!entity_id) return NextResponse.json({ error: 'entity_id required' }, { status: 400 });
  if (updates.aliases && !Array.isArray(updates.aliases)) delete updates.aliases;
  const { data, error } = await supabase.from('entities').update(updates).eq('entity_id', entity_id).select().single();
  if (error) return NextResponse.json({ error: sanitizeDbError(error) }, { status: 500 });
  return NextResponse.json({ entity: data });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const entity_id = searchParams.get('entity_id');
  if (!entity_id) return NextResponse.json({ error: 'entity_id required' }, { status: 400 });
  const supabase = createServerClient();
  const { error } = await supabase.from('entities').delete().eq('entity_id', entity_id);
  if (error) return NextResponse.json({ error: sanitizeDbError(error) }, { status: 500 });
  return NextResponse.json({ success: true });
}
