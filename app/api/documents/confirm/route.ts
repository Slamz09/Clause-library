import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { CLAUSE_TO_OBLIGATION_TYPE } from '@/lib/documentProfiles';
import { requireSession } from '@/lib/auth/requireSession';

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { uploadId, confirmedIds, rejectedIds } = await req.json();
  const supabase = createServerClient();

  if (rejectedIds?.length) {
    await supabase
      .from('extracted_obligations')
      .update({ review_status: 'rejected' })
      .in('extracted_id', rejectedIds);
  }

  if (!confirmedIds?.length) return NextResponse.json({ promoted: 0 });

  const { data: items, error } = await supabase
    .from('extracted_obligations')
    .select('*')
    .in('extracted_id', confirmedIds);

  if (error || !items?.length) {
    return NextResponse.json({ error: 'No items found to confirm' }, { status: 400 });
  }

  // Fetch clauses for all documents so we can link source_clause_id
  const docIds = [...new Set(items.map((item: any) => item.document_id).filter(Boolean))];
  const clausesByDoc = new Map<string, any[]>();
  if (docIds.length > 0) {
    const { data: clauseRows } = await supabase
      .from('clauses')
      .select('clause_id, document_id, clause_no, clause_text')
      .in('document_id', docIds);
    for (const c of (clauseRows ?? [])) {
      if (!clausesByDoc.has(c.document_id)) clausesByDoc.set(c.document_id, []);
      clausesByDoc.get(c.document_id)!.push(c);
    }
  }

  function matchClauseId(item: any): string | null {
    const clauses = clausesByDoc.get(item.document_id) ?? [];
    if (!clauses.length) return null;
    const ref   = (item.clause_reference  || '').toLowerCase();
    const quote = (item.supporting_quote  || '').toLowerCase();
    // Match clause_no appearing in the clause_reference string (e.g. "3.2" in "Section 3.2 Insurance")
    const byNo = clauses.find(c => c.clause_no && ref.includes(c.clause_no.toLowerCase()));
    if (byNo) return byNo.clause_id;
    // Fallback: supporting_quote substring in clause_text
    const snippet = quote.slice(0, 60);
    if (snippet.length > 15) {
      const byText = clauses.find(c => c.clause_text && c.clause_text.toLowerCase().includes(snippet));
      if (byText) return byText.clause_id;
    }
    return null;
  }

  const obligationRows = items.map((item: any) => ({
    document_id:                item.document_id,
    entity_id:                  null,
    obligation_type:            CLAUSE_TO_OBLIGATION_TYPE[item.clause_type] || 'other',
    normalized_summary:         [
      item.trigger_condition,
      item.deadline ? `Deadline: ${item.deadline}.` : '',
      item.consequence ? `Consequence: ${item.consequence}.` : '',
    ].filter(Boolean).join(' '),
    trigger_type:               item.mapped_trigger_type || null,
    trigger_scope:              'entity',
    severity:                   item.confidence >= 0.85 ? 'high' : item.confidence >= 0.6 ? 'medium' : 'low',
    status:                     'open',
    confidence:                 item.confidence >= 0.85 ? 'confirmed' : 'ai_extracted',
    document_section_reference: item.clause_reference,
    source_clause_id:           matchClauseId(item),
  }));

  let inserted: any[] | null = null;
  let insertErr: any = null;

  ({ data: inserted, error: insertErr } = await supabase
    .from('obligations')
    .insert(obligationRows)
    .select('obligation_id'));

  // If source_clause_id column doesn't exist yet, retry without it
  if (insertErr?.message?.includes('source_clause_id')) {
    const rowsWithout = obligationRows.map(({ source_clause_id: _, ...rest }) => rest);
    ({ data: inserted, error: insertErr } = await supabase
      .from('obligations')
      .insert(rowsWithout)
      .select('obligation_id'));
  }

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  for (let i = 0; i < confirmedIds.length; i++) {
    await supabase
      .from('extracted_obligations')
      .update({
        review_status:        'confirmed',
        mapped_obligation_id: inserted?.[i]?.obligation_id,
      })
      .eq('extracted_id', confirmedIds[i]);
  }

  return NextResponse.json({ promoted: inserted?.length || 0 });
}
