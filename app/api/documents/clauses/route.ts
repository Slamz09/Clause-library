import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import type { ComplianceStatus } from '@/lib/compliance/checker';
import { requireSession } from '@/lib/auth/requireSession';
import { summarizeObligationsByClause, type ClauseObligationSummary } from '@/lib/obligations/readClauseObligations';

const VALID_COMPLIANCE_STATUSES: ComplianceStatus[] = ['compliant', 'non_compliant', 'review_needed', 'unchecked'];

export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
    const documentId = searchParams.get('documentId');
    const obligationType = searchParams.get('obligationType');
    const complianceStatus = searchParams.get('compliance_status');
    const includeUnits = searchParams.get('include_units') === 'true';
    const includeObligations = searchParams.get('include_obligations') === 'true';
    const structuralLabel = searchParams.get('structural_label');
    const topicLabel = searchParams.get('topic_label');
    const needsReview = searchParams.get('needs_review');
    const versionChain = searchParams.get('version_chain'); // clause_id to walk parent chain from

    const supabase = createServerClient();

    // Version chain: walk parent_clause_id links to return full history
    if (versionChain) {
      const chain: any[] = [];
      let cursor: string | null = versionChain;
      let safety = 0;
      while (cursor && safety < 20) {
        safety++;
        let clauseRow: any = null;
        try {
          const { data } = await supabase.from('clauses').select('*').eq('clause_id', cursor).single();
          clauseRow = data;
        } catch { clauseRow = null; }
        if (!clauseRow) break;
        chain.push(clauseRow);
        cursor = clauseRow.parent_clause_id || null;
      }
      return NextResponse.json({ clauses: chain });
    }

    let query = supabase
      .from('clauses')
      .select('*')
      .order('created_at', { ascending: false });

    if (documentId) query = query.eq('document_id', documentId);
    if (obligationType) query = query.eq('obligation_type', obligationType);
    if (complianceStatus) query = query.eq('compliance_status', complianceStatus);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const clauses = (data || []).map((row: any) => ({
      ...row,
      detected_type: row.detected_type || row.clause_type || '',
    }));

    // Optionally join clause_units
    let unitsByClause: Record<string, any[]> = {};
    if (includeUnits && documentId) {
      let unitQuery = supabase
        .from('clause_units')
        .select('*')
        .eq('document_id', documentId)
        .order('unit_index', { ascending: true });
      if (structuralLabel) unitQuery = unitQuery.contains('structural_labels', [structuralLabel]);
      if (topicLabel) unitQuery = unitQuery.contains('topic_labels', [topicLabel]);
      if (needsReview === 'true') unitQuery = unitQuery.eq('needs_review', true);
      const { data: units } = await unitQuery;
      for (const u of units || []) {
        if (!unitsByClause[u.clause_id]) unitsByClause[u.clause_id] = [];
        unitsByClause[u.clause_id].push(u);
      }
    }

    // Optionally join obligations
    let obligationsByClause: Record<string, any[]> = {};
    if (includeObligations && documentId) {
      let oblQuery = supabase
        .from('obligations')
        .select('*')
        .eq('document_id', documentId)
        .eq('status', 'active')
        .order('created_at', { ascending: true });
      if (needsReview === 'true') oblQuery = oblQuery.eq('needs_review', true);
      const { data: obls } = await oblQuery;
      for (const o of obls || []) {
        if (!obligationsByClause[o.clause_id]) obligationsByClause[o.clause_id] = [];
        obligationsByClause[o.clause_id].push(o);
      }
    }

    // Structured atomic obligation summary per clause (canonical_obligations,
    // the authoritative model) — drives the Category "Obligation" badge, the
    // "Derived <effect>" / "Creates Requirement" indicator, and whether a row
    // opens the structured-obligation side panel. Always computed; degrades to
    // empty if the canonical tables aren't reachable.
    let oblSummary = new Map<string, ClauseObligationSummary>();
    try {
      oblSummary = await summarizeObligationsByClause(supabase, clauses.map(c => c.clause_id));
    } catch (err: any) {
      console.error('[documents/clauses] obligation summary failed:', err?.message);
    }

    const enriched = clauses.map(c => {
      const s = oblSummary.get(c.clause_id);
      return {
        ...c,
        category: Array.isArray(c.category) ? c.category : [],
        modifiers: Array.isArray(c.modifiers) ? c.modifiers : [],
        linked_obligation_count: s?.count ?? 0,
        derived_effects: s?.effects ?? [],
        has_derived_obligation: s?.has_derived ?? false,
        has_explicit_obligation: s?.has_explicit ?? false,
        ...(includeUnits ? { clause_units: unitsByClause[c.clause_id] || [] } : {}),
        ...(includeObligations ? { obligations: obligationsByClause[c.clause_id] || [] } : {}),
      };
    });

    return NextResponse.json({ clauses: enriched });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const supabase = createServerClient();
    const body = await req.json();
    const ids: string[] = body.clause_ids || (body.clause_id ? [body.clause_id] : []);
    if (ids.length === 0) return NextResponse.json({ error: 'clause_id(s) required' }, { status: 400 });
    const { error } = await supabase.from('clauses').delete().in('clause_id', ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: ids.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const supabase = createServerClient();
    const body = await req.json();
    const { clause_id, obligation_id, clause_unit_id, ...updates } = body;

    // Patch a single obligation
    if (obligation_id && !clause_id) {
      const { data, error } = await supabase
        .from('obligations')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('obligation_id', obligation_id)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ obligation: data });
    }

    // Patch a single clause_unit
    if (clause_unit_id && !clause_id) {
      const { data, error } = await supabase
        .from('clause_units')
        .update(updates)
        .eq('clause_unit_id', clause_unit_id)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ clause_unit: data });
    }

    if (!clause_id) return NextResponse.json({ error: 'clause_id required' }, { status: 400 });
    if (updates.compliance_status !== undefined && !VALID_COMPLIANCE_STATUSES.includes(updates.compliance_status as ComplianceStatus)) {
      return NextResponse.json(
        { error: `compliance_status must be one of: ${VALID_COMPLIANCE_STATUSES.join(', ')}` },
        { status: 400 },
      );
    }
    // Mirror detected_type → clause_type so the DB column stays in sync
    if (updates.detected_type !== undefined) updates.clause_type = updates.detected_type;
    const { data, error } = await supabase.from('clauses').update(updates).eq('clause_id', clause_id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ clause: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
