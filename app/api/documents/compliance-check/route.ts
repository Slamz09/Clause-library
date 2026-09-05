import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { runDocumentCompliance } from '@/lib/compliance/checker';
import { requireSession } from '@/lib/auth/requireSession';

async function handleComplianceCheck(document_id: string, partyPositionOverride?: string | null) {
  const supabase = createServerClient();
  const { checked, skipped, document_compliance_score, missing_required_clauses } = await runDocumentCompliance({
    documentId: document_id,
    supabase,
    partyPositionOverride,
  });
  return NextResponse.json({ checked, skipped, document_id, document_compliance_score, missing_required_clauses });
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const { document_id, party_position } = body as { document_id?: string; party_position?: string };

  if (!document_id) {
    return NextResponse.json({ error: 'document_id is required' }, { status: 400 });
  }

  return handleComplianceCheck(document_id, party_position ?? null);
}

export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const document_id = params.get('document_id');
  const party_position = params.get('party_position');

  if (!document_id) {
    return NextResponse.json({ error: 'document_id is required' }, { status: 400 });
  }

  return handleComplianceCheck(document_id, party_position);
}
