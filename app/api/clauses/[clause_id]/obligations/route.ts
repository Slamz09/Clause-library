import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { requireSession } from '@/lib/auth/requireSession';
import { readObligationsForClause } from '@/lib/obligations/readClauseObligations';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// GET /api/clauses/:clause_id/obligations
// Every structured atomic obligation linked to this source clause — explicit
// AND derived (from a Statement / Rep-Warranty / Acknowledgment) — each with
// its full structured detail, provenance, and per-entity applicability
// (Clients / Workers / Service Providers) with the four distinct states.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clause_id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { clause_id } = await params;
  if (!clause_id || !ID_RE.test(clause_id)) {
    return NextResponse.json({ error: 'valid clause_id required' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: clause, error: clErr } = await supabase
    .from('clauses')
    .select('clause_id, document_id, clause_no, clause_name, clause_text, clause_type, obligation_type')
    .eq('clause_id', clause_id)
    .maybeSingle();
  if (clErr) {
    return NextResponse.json({ error: clErr.message }, { status: 500 });
  }
  if (!clause) return NextResponse.json({ error: 'clause not found' }, { status: 404 });

  try {
    const obligations = await readObligationsForClause(supabase, clause_id, { withApplicability: true });
    return NextResponse.json({ clause, obligations });
  } catch (err: any) {
    console.error('[clauses/:id/obligations]', err?.message);
    return NextResponse.json({ error: 'Failed to load obligations' }, { status: 500 });
  }
}
