import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { requireSession } from '@/lib/auth/requireSession';
import { triggerBulkUploadWorker } from '@/lib/documents/triggerBulkUploadWorker';

// Resets one or more failed bulk-upload jobs back to 'queued' so the worker
// picks them up again. Only ever touches rows currently 'failed' — retrying
// a queued/processing/completed row is a no-op, not an error, so the UI can
// call this without first re-checking status.
export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const uploadIds: string[] = Array.isArray(body.uploadIds)
    ? body.uploadIds
    : body.uploadId ? [body.uploadId] : [];
  if (uploadIds.length === 0) {
    return NextResponse.json({ error: 'uploadId or uploadIds required' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data: failedRows, error: fetchErr } = await supabase
    .from('document_uploads')
    .select('upload_id, retry_count, batch_id')
    .in('upload_id', uploadIds)
    .eq('extraction_status', 'failed');
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!failedRows || failedRows.length === 0) {
    return NextResponse.json({ retried: 0 });
  }

  for (const row of failedRows) {
    await supabase.from('document_uploads').update({
      extraction_status: 'queued',
      error_message: null,
      started_at: null,
      finished_at: null,
      retry_count: (row.retry_count || 0) + 1,
    }).eq('upload_id', row.upload_id);
  }

  const batchIds = [...new Set(failedRows.map(r => r.batch_id).filter(Boolean))];
  if (batchIds.length > 0) {
    await supabase.from('document_batches').update({ status: 'processing', updated_at: new Date().toISOString() }).in('batch_id', batchIds);
  }

  void triggerBulkUploadWorker().catch(() => {});

  return NextResponse.json({ retried: failedRows.length });
}
