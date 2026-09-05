import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { requireSession } from '@/lib/auth/requireSession';
import { classifyClauseForms } from '@/lib/clauses/classifyClauseForms';
import {
  ingestClauseObligationsForDocument,
  type ObligationSourceType,
} from '@/lib/obligations/ingestClauseObligations';
import { buildApplicabilityForDocument } from '@/lib/obligations/applicabilityBuilder';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const SOURCE_TYPE_BY_DOC: Record<string, ObligationSourceType> = {
  regulation: 'regulation',
  insurance_policy: 'insurance',
  certificate_of_insurance: 'insurance',
  order_form: 'order_form',
};

// POST /api/documents/:document_id/extract-obligations
// Re-runs Category/Modifiers classification + structured atomic obligation
// ingestion (clause_units → canonical_obligations → applicability →
// contract-vs-regulation comparison) for a document whose clauses are already
// extracted. Idempotent: replaces this document's own originating obligation
// rows rather than accumulating.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ document_id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;

  const { document_id } = await params;
  if (!document_id || !ID_RE.test(document_id)) {
    return NextResponse.json({ error: 'valid document_id required' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: doc } = await supabase
    .from('documents')
    .select('document_id, document_type')
    .eq('document_id', document_id)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: 'document not found' }, { status: 404 });

  const { data: clauses, error: clErr } = await supabase
    .from('clauses')
    .select('clause_id, clause_text, clause_type, obligation_type, regulatory_source_id')
    .eq('document_id', document_id);
  if (clErr) return NextResponse.json({ error: clErr.message }, { status: 500 });
  if (!clauses?.length) {
    return NextResponse.json({ error: 'document has no extracted clauses to process' }, { status: 400 });
  }

  const sourceType: ObligationSourceType = SOURCE_TYPE_BY_DOC[doc.document_type || ''] ?? 'contract';
  const regulatorySourceId = (clauses.find((c: any) => c.regulatory_source_id)?.regulatory_source_id) || null;

  try {
    const forms = await classifyClauseForms(
      clauses.map((c: any) => ({
        clause_id: c.clause_id,
        clause_text: c.clause_text || '',
        clause_type: c.clause_type || c.obligation_type || null,
      })),
    );

    // Persist Category / Modifiers back onto the clause rows.
    let categoryColumnMissing = false;
    for (const c of clauses as any[]) {
      const f = forms.get(c.clause_id);
      if (!f) continue;
      const { error } = await supabase
        .from('clauses')
        .update({ category: f.category, modifiers: f.modifiers })
        .eq('clause_id', c.clause_id);
      if (error?.code === '42703') { categoryColumnMissing = true; break; }
    }

    const ingest = await ingestClauseObligationsForDocument(supabase, document_id, {
      sourceType,
      regulatorySourceId,
      formClassifications: forms,
      runComparison: sourceType !== 'regulation',
    });
    const applicability = await buildApplicabilityForDocument(supabase, document_id);

    return NextResponse.json({
      document_id,
      source_type: sourceType,
      clauses_processed: clauses.length,
      category_column_missing: categoryColumnMissing,
      ...ingest,
      applicability_rows: applicability.written,
    });
  } catch (err: any) {
    console.error('[documents/:id/extract-obligations]', err?.message);
    return NextResponse.json({ error: 'Extraction failed' }, { status: 500 });
  }
}
