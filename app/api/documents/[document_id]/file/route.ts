import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { requireSession } from '@/lib/auth/requireSession';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ document_id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { document_id } = await params;
  if (!document_id) return NextResponse.json({ error: 'document_id required' }, { status: 400 });

  const supabase = createServerClient();

  const { data: files, error } = await supabase.storage
    .from('documents')
    .list('', { limit: 50, search: document_id });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const match = (files || []).find((f: any) => f.name.startsWith(`${document_id}.`));
  if (!match) return NextResponse.json({ error: 'File not found in storage' }, { status: 404 });

  const { data: { publicUrl } } = supabase.storage.from('documents').getPublicUrl(match.name);
  return NextResponse.json({ url: publicUrl, name: match.name });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ document_id: string }> },
) {
  const denied = await requireSession();
  if (denied) return denied;
  const { document_id } = await params;
  if (!document_id) return NextResponse.json({ error: 'document_id required' }, { status: 400 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });

  const supabase = createServerClient();

  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
  const storagePath = `${document_id}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from('documents')
    .upload(storagePath, file, { contentType: file.type || 'application/pdf', upsert: true });

  if (uploadErr) {
    console.error('[storage] upload error:', uploadErr.message);
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data: { publicUrl } } = supabase.storage.from('documents').getPublicUrl(storagePath);
  return NextResponse.json({ url: publicUrl });
}
