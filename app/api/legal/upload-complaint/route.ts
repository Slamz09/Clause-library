import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { validateUpload } from '@/lib/security/validateUpload';
import { sanitizeDbError } from '@/lib/security/safeError';
import { requireSession } from '@/lib/auth/requireSession';

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const matterId = formData.get('matter_id') as string | null;

  if (!file || !matterId) {
    return NextResponse.json({ error: 'file and matter_id are required' }, { status: 400 });
  }

  // Validate matter_id format to prevent path traversal in storage key
  if (!/^[a-zA-Z0-9_-]+$/.test(matterId)) {
    return NextResponse.json({ error: 'Invalid matter_id format' }, { status: 400 });
  }

  // Size and extension check before reading the buffer
  const preCheck = validateUpload(file, 'complaint');
  if (!preCheck.valid) {
    return NextResponse.json({ error: preCheck.error }, { status: 400 });
  }

  // Magic bytes check
  const buffer = await file.arrayBuffer();
  const magicCheck = validateUpload(file, 'complaint', buffer);
  if (!magicCheck.valid) {
    return NextResponse.json({ error: magicCheck.error }, { status: 400 });
  }

  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
  const storagePath = `matter_complaint_${matterId}.${ext}`;

  const supabase = createServerClient();

  const { error } = await supabase.storage
    .from('documents')
    .upload(storagePath, file, {
      contentType: file.type || 'application/pdf',
      upsert: true,
    });

  if (error) {
    return NextResponse.json({ error: sanitizeDbError(error) }, { status: 500 });
  }

  const { data: { publicUrl } } = supabase.storage
    .from('documents')
    .getPublicUrl(storagePath);

  return NextResponse.json({ url: publicUrl });
}
