import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { processDocumentUpload } from '@/lib/documents/processDocumentUpload';

export const maxDuration = 60;

// ─── Internal worker — no browser session ────────────────────────────────
// Called two ways, both server-to-server, neither carrying a user cookie:
//   1. Opportunistically, once, right after POST /api/documents/bulk-upload
//      enqueues a batch (lib/documents/triggerBulkUploadWorker.ts).
//   2. Every minute by netlify/functions/bulk-upload-poller.ts, which is the
//      reliability backbone — it guarantees a stalled or partially-drained
//      batch keeps moving even if (1) never fired or timed out mid-batch.
// Gated by a shared secret header instead of requireSession() for that reason.
//
// Each invocation claims and processes queued jobs one at a time (via the
// atomic claim_next_bulk_upload_job() Postgres function, so the opportunistic
// call and the scheduled poller never race on the same row) until either the
// queue is empty or a wall-clock budget is used up, then returns — it does
// not self-chain, so it never depends on a fire-and-forget request surviving
// after the response is sent.
const TIME_BUDGET_MS = 45_000;

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function POST(req: NextRequest) {
  const secret = process.env.BULK_PROCESS_SECRET;
  if (!secret || req.headers.get('x-bulk-secret') !== secret) return unauthorized();

  const supabase = createServerClient();
  const start = Date.now();
  const touchedBatchIds = new Set<string>();
  let processedCount = 0;
  let failedCount = 0;

  while (Date.now() - start < TIME_BUDGET_MS) {
    const { data: claimed, error: claimErr } = await supabase.rpc('claim_next_bulk_upload_job');
    if (claimErr) {
      console.error('[bulk-upload/process] claim error:', claimErr.message);
      break;
    }
    const job = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!job) break; // queue empty

    if (job.batch_id) touchedBatchIds.add(job.batch_id);

    try {
      const meta = job.upload_meta || {};
      const ext = job.file_type || 'pdf';
      const storagePath = `${job.document_id}.${ext}`;
      const { data: fileBlob, error: downloadErr } = await supabase.storage.from('documents').download(storagePath);
      if (downloadErr || !fileBlob) {
        throw new Error(downloadErr?.message || `Staged file not found in storage: ${storagePath}`);
      }
      const buffer = await fileBlob.arrayBuffer();

      const result = await processDocumentUpload({
        buffer,
        fileName: job.file_name,
        fileType: meta.fileType || 'application/pdf',
        // Empty/omitted → processDocumentUpload() auto-classifies (see
        // lib/documents/classifyDocument.ts). Do not fall back to a default
        // type here — that would silently defeat automatic classification.
        documentTypes: meta.documentTypes?.length ? meta.documentTypes : undefined,
        documentTitle: meta.documentTitle,
        entityId: meta.entityId,
        assetId: meta.assetId,
        companyName: meta.companyName,
        counterparty: meta.counterparty,
        governingState: meta.governingState,
        parentDocId: meta.parentDocId,
        docRelation: meta.docRelation,
        deepExtractFlag: meta.deepExtractFlag,
        documentId: job.document_id,
        uploadId: job.upload_id,
        // Bulk upload's entry point lives on the Contracts & Documents page —
        // processed documents need a linked record (contracts, or
        // insurance_policies for insurance-family types — see
        // processDocumentUpload's own branch on this flag) to actually show
        // up there; that page lists those tables, not `documents` directly.
        createContractRecord: true,
      });

      await supabase.from('document_uploads').update({
        extraction_status: 'completed',
        extracted_count: result.extractedCount,
        error_message: null,
        finished_at: new Date().toISOString(),
      }).eq('upload_id', job.upload_id);
      processedCount++;
    } catch (err: any) {
      console.error(`[bulk-upload/process] job ${job.upload_id} failed:`, err?.message);
      await supabase.from('document_uploads').update({
        extraction_status: 'failed',
        error_message: err?.message || 'Processing failed',
        finished_at: new Date().toISOString(),
      }).eq('upload_id', job.upload_id);
      failedCount++;
    }
  }

  // Close out any batch that no longer has queued/processing jobs.
  for (const batchId of touchedBatchIds) {
    const { data: remaining } = await supabase
      .from('document_uploads')
      .select('extraction_status')
      .eq('batch_id', batchId)
      .in('extraction_status', ['queued', 'processing']);
    if (remaining && remaining.length > 0) continue;

    const { data: failedRows } = await supabase
      .from('document_uploads')
      .select('upload_id')
      .eq('batch_id', batchId)
      .eq('extraction_status', 'failed');

    await supabase.from('document_batches').update({
      status: (failedRows && failedRows.length > 0) ? 'completed_with_errors' : 'completed',
      updated_at: new Date().toISOString(),
    }).eq('batch_id', batchId);
  }

  return NextResponse.json({ processed: processedCount, failed: failedCount, touchedBatches: [...touchedBatchIds] });
}
