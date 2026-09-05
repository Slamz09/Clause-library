import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { requireSession } from '@/lib/auth/requireSession';
import { classifyInsurancePolicy } from '@/lib/documents/classifyInsurancePolicy';

// Thin HTTP wrapper — the actual extraction lives in
// lib/documents/classifyInsurancePolicy.ts so processDocumentUpload()'s bulk
// upload pipeline can call it directly server-side (no fetch, no
// session-cookie gate) instead of duplicating this prompt/logic.
export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const { documentText, documentType } = await req.json() as { documentText?: string; documentType?: string };
    if (!documentText || !documentText.trim()) {
      return NextResponse.json({ error: 'documentText required' }, { status: 400 });
    }
    const supabase = createServerClient();
    const policy = await classifyInsurancePolicy(
      supabase,
      documentText,
      documentType === 'certificate_of_insurance' ? 'certificate_of_insurance' : 'insurance_policy',
    );
    return NextResponse.json({ policy });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Insurance extraction failed — please try again.' }, { status: 502 });
  }
}
