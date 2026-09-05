// ─── Saved Obligations CRUD ────────────────────────────────────────────────
// Backs the manual "save clause as obligation" flow and Obligations list UI
// in app/(app)/documents/page.tsx (autoSaveObligations, ObligationsTab).
// Targets `saved_obligations` — the SavedObligation shape (docs/ontology.md
// §3), a deliberately separate table from `obligations` (the
// ObligationExtraction shape written by the deep-extraction pipeline). The
// HTTP surface (/api/obligations) is unchanged; only the underlying table
// moved, so no frontend call site needed to change. Neither table existed in
// the live database before 2026-08-23 — see scripts/create-saved-obligations-table.sql.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { recomputeObligationRisk } from '@/lib/risk/recompute';
import { sanitizeDbError } from '@/lib/security/safeError';
import { requireSession } from '@/lib/auth/requireSession';

// Allow only alphanumeric, underscore, and hyphen in IDs
// Prevents injection into Supabase .or() / .eq() filter strings
function isValidId(id: string | null): boolean {
  if (!id) return false;
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

function genId() {
  return `obl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
    const documentId = searchParams.get('documentId');
    const clauseId   = searchParams.get('clauseId');
    const oblType    = searchParams.get('type');
    const status     = searchParams.get('status');
    const entityId   = searchParams.get('entityId');
    const assetId    = searchParams.get('assetId');
    const eventId    = searchParams.get('eventId');
    const supabase   = createServerClient();

    if (eventId) {
      const { data: impacts, error: impErr } = await supabase
        .from('event_obligation_impacts')
        .select('obligation_id, impact_type')
        .eq('event_id', eventId);
      if (impErr) return NextResponse.json({ error: sanitizeDbError(impErr) }, { status: 500 });
      const ids = (impacts || []).map((r: any) => r.obligation_id).filter(Boolean);
      if (!ids.length) return NextResponse.json({ obligations: [] });
      const impactMap = Object.fromEntries((impacts || []).map((r: any) => [r.obligation_id, r.impact_type]));
      const { data, error } = await supabase.from('saved_obligations').select('*').in('obligation_id', ids);
      if (error) return NextResponse.json({ error: sanitizeDbError(error) }, { status: 500 });
      const enriched = (data || []).map((o: any) => ({ ...o, impact_type: impactMap[o.obligation_id] }));
      return NextResponse.json({ obligations: enriched });
    }

    // Validate IDs before use — prevents injection into PostgREST filter strings
    if (documentId && !isValidId(documentId)) return NextResponse.json({ error: 'Invalid documentId' }, { status: 400 });
    if (entityId   && !isValidId(entityId))   return NextResponse.json({ error: 'Invalid entityId' },   { status: 400 });
    if (assetId    && !isValidId(assetId))    return NextResponse.json({ error: 'Invalid assetId' },    { status: 400 });
    if (clauseId   && !isValidId(clauseId))   return NextResponse.json({ error: 'Invalid clauseId' },   { status: 400 });

    let query = supabase.from('saved_obligations').select('*').order('created_at', { ascending: false });

    // Use separate .eq() calls instead of interpolated .or() strings
    if (documentId) {
      query = query.or(`source_document_id.eq.${documentId},document_id.eq.${documentId}`);
    }
    if (clauseId) query = query.eq('source_clause_id', clauseId);
    if (oblType)  query = query.eq('obligation_type', oblType);
    if (status)   query = query.eq('status', status);
    if (entityId) {
      query = query.or(`related_entity_id.eq.${entityId},entity_id.eq.${entityId}`);
    }
    if (assetId) {
      query = query.or(`related_asset_id.eq.${assetId},asset_id.eq.${assetId}`);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: sanitizeDbError(error) }, { status: 500 });
    return NextResponse.json({ obligations: data || [] });
  } catch (err: any) {
    console.error('[obligations GET]', err?.message);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const supabase = createServerClient();
    const body = await req.json();

    if (Array.isArray(body)) {
      const rows = body.map(b => ({
        obligation_id:      genId(),
        status:             'active',
        ...b,
        entity_id:          b.entity_id       || b.related_entity_id || null,
        asset_id:           b.asset_id        || b.related_asset_id  || null,
        document_id:        b.document_id     || b.source_document_id || null,
        source_document_id: b.source_document_id || b.document_id || null,
        source_text:        b.source_text     || null,
      }));
      const { data, error } = await supabase.from('saved_obligations').insert(rows).select();
      if (error) return NextResponse.json({ error: sanitizeDbError(error) }, { status: 500 });
      const inserted = data ?? [];
      const risks: any[] = [];
      for (const obl of inserted) {
        try {
          const risk = await recomputeObligationRisk(supabase, obl.obligation_id);
          risks.push(risk);
        } catch { risks.push(null); }
      }
      return NextResponse.json({ obligations: inserted, risks });
    }

    const row = {
      obligation_id:      genId(),
      status:             'active',
      ...body,
      entity_id:          body.entity_id       || body.related_entity_id || null,
      asset_id:           body.asset_id        || body.related_asset_id  || null,
      document_id:        body.document_id     || body.source_document_id || null,
      source_document_id: body.source_document_id || body.document_id || null,
      source_text:        body.source_text     || null,
    };
    const { data, error } = await supabase.from('saved_obligations').insert(row).select().single();
    if (error) return NextResponse.json({ error: sanitizeDbError(error) }, { status: 500 });
    let risk = null;
    try { risk = await recomputeObligationRisk(supabase, data.obligation_id); } catch { /* non-blocking */ }
    return NextResponse.json({ obligation: data, risk });
  } catch (err: any) {
    console.error('[obligations POST]', err?.message);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const supabase = createServerClient();
    const { id, obligation_id, ...updates } = await req.json();
    const key = id || obligation_id;
    if (!key) return NextResponse.json({ error: 'id required' }, { status: 400 });
    if (!isValidId(key)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const { data, error } = await supabase
      .from('saved_obligations')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('obligation_id', key)
      .select()
      .single();
    if (error) return NextResponse.json({ error: sanitizeDbError(error) }, { status: 500 });
    let risk = null;
    try { risk = await recomputeObligationRisk(supabase, key); } catch { /* non-blocking */ }
    return NextResponse.json({ obligation: data, risk });
  } catch (err: any) {
    console.error('[obligations PATCH]', err?.message);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
    const idParam    = searchParams.get('id');
    const documentId = searchParams.get('documentId');
    const supabase   = createServerClient();

    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await req.json();
      const ids: string[] = body.ids || (body.id ? [body.id] : []);
      if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 });
      // Validate all IDs before passing to DB
      if (ids.some((id) => !isValidId(id))) {
        return NextResponse.json({ error: 'Invalid id format' }, { status: 400 });
      }
      const { error } = await supabase.from('saved_obligations').delete().in('obligation_id', ids);
      if (error) return NextResponse.json({ error: sanitizeDbError(error) }, { status: 500 });
      return NextResponse.json({ deleted: ids.length });
    }

    if (!idParam && !documentId) return NextResponse.json({ error: 'id or documentId required' }, { status: 400 });
    if (idParam    && !isValidId(idParam))    return NextResponse.json({ error: 'Invalid id' },         { status: 400 });
    if (documentId && !isValidId(documentId)) return NextResponse.json({ error: 'Invalid documentId' }, { status: 400 });

    let query = supabase.from('saved_obligations').delete();
    if (idParam)    query = (query as any).eq('obligation_id', idParam);
    if (documentId) query = (query as any).or(`source_document_id.eq.${documentId},document_id.eq.${documentId}`);
    const { error } = await query;
    if (error) return NextResponse.json({ error: sanitizeDbError(error) }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[obligations DELETE]', err?.message);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}
