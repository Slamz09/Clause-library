import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { requireSession } from '@/lib/auth/requireSession';
import { classifyDocument } from '@/lib/documents/classifyDocument';

// Thin wrapper around classifyDocument() (the same structural/semantic
// classifier bulk upload uses) for the interactive Document Parser flow —
// lets it auto-suggest a Source Type on file select instead of leaving
// newDocType stuck at its hardcoded 'general_contract' default, while still
// letting the user review/change the result before Save (this flow, unlike
// bulk upload, always has a human looking at it before anything is created).
export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const { text, fileName } = await req.json() as { text?: string; fileName?: string };
    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }
    const supabase = createServerClient();
    const classification = await classifyDocument({ supabase, text, fileName: fileName || '' });
    return NextResponse.json({ classification });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Classification failed' }, { status: 500 });
  }
}
