import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { sanitizeDbError } from '@/lib/security/safeError';
import { requireSession } from '@/lib/auth/requireSession';

const VALID_TABLES = ['privacy', 'data-security', 'driver-req', 'recording-consent'] as const;
type TableName = typeof VALID_TABLES[number];

function isValidTable(t: unknown): t is TableName {
  return typeof t === 'string' && (VALID_TABLES as readonly string[]).includes(t);
}

function isValidAbbr(a: unknown): a is string {
  return typeof a === 'string' && /^[A-Z]{2}$/.test(a);
}

function rowId(tableName: string, abbr: string) {
  return `${tableName}:${abbr}`;
}

export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
    const table = searchParams.get('table');
    if (table && !isValidTable(table)) {
      return NextResponse.json({ error: 'Invalid table' }, { status: 400 });
    }
    const supabase = createServerClient();
    let query = supabase.from('regulation_overrides').select('*');
    if (table) query = query.eq('table_name', table);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: sanitizeDbError(error) }, { status: 500 });
    return NextResponse.json({ overrides: data || [] });
  } catch (err: any) {
    console.error('[regulations/overrides GET]', err?.message);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const body = await req.json();
    const { table_name, abbr, patch, updated_by } = body || {};
    if (!isValidTable(table_name)) return NextResponse.json({ error: 'Invalid table_name' }, { status: 400 });
    if (!isValidAbbr(abbr)) return NextResponse.json({ error: 'Invalid abbr' }, { status: 400 });
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return NextResponse.json({ error: 'patch must be an object' }, { status: 400 });
    }

    const supabase = createServerClient();
    const id = rowId(table_name, abbr);

    const { data: existing, error: fetchError } = await supabase
      .from('regulation_overrides')
      .select('patch')
      .eq('id', id)
      .maybeSingle();
    if (fetchError) return NextResponse.json({ error: sanitizeDbError(fetchError) }, { status: 500 });

    const mergedPatch = { ...(existing?.patch || {}), ...patch };

    const { data, error } = await supabase
      .from('regulation_overrides')
      .upsert({
        id,
        table_name,
        abbr,
        patch: mergedPatch,
        updated_by: updated_by || null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: sanitizeDbError(error) }, { status: 500 });
    return NextResponse.json({ override: data });
  } catch (err: any) {
    console.error('[regulations/overrides PATCH]', err?.message);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
    let table_name = searchParams.get('table_name');
    let abbr = searchParams.get('abbr');

    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      table_name = table_name || body.table_name;
      abbr = abbr || body.abbr;
    }

    if (!isValidTable(table_name)) return NextResponse.json({ error: 'Invalid table_name' }, { status: 400 });
    if (!isValidAbbr(abbr)) return NextResponse.json({ error: 'Invalid abbr' }, { status: 400 });

    const supabase = createServerClient();
    const { error } = await supabase
      .from('regulation_overrides')
      .delete()
      .eq('id', rowId(table_name, abbr));
    if (error) return NextResponse.json({ error: sanitizeDbError(error) }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[regulations/overrides DELETE]', err?.message);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}
