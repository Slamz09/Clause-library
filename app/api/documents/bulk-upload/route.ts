import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabaseServer';
import { validateUpload } from '@/lib/security/validateUpload';
import { requireSession } from '@/lib/auth/requireSession';
import { sanitizeDbError } from '@/lib/security/safeError';
import { triggerBulkUploadWorker } from '@/lib/documents/triggerBulkUploadWorker';

// document_uploads.extraction_status briefly passes through internal values
// ('extracting', 'review') that belong to processDocumentUpload()'s shared
// single-upload heritage, before this route's worker overwrites it with the
// final 'completed'/'failed'. The bulk UI only knows queued/processing/
// completed/failed — collapse anything else to 'processing' here so a poll
// landing mid-flight never hands the client a status it doesn't recognize.
type BulkStatus = 'queued' | 'processing' | 'completed' | 'failed';
const KNOWN_STATUSES = new Set(['queued', 'processing', 'completed', 'failed']);
function normalizeStatus(status: string | null | undefined): BulkStatus {
  return status && KNOWN_STATUSES.has(status) ? (status as BulkStatus) : 'processing';
}

// ─── POST — stage N files, create one queued job per file, kick the worker ──
// Mirrors the single-upload route's validation, but does none of the actual
// extraction here: each file is staged in the same "documents" Storage
// bucket the single-upload flow uses (same key convention, ${document_id}.
// ${ext}), and a 'queued' document_uploads row records the job. The real
// extraction happens later in /api/documents/bulk-upload/process, which
// calls the exact same processDocumentUpload() the single-upload route uses.
export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const formData = await req.formData();
  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  const documentType = formData.get('document_type') as string | null;
  const documentTypesRaw = formData.get('document_types') as string | null;
  const entityId = formData.get('entity_id') as string | null;
  const assetId = formData.get('asset_id') as string | null;
  const companyName = formData.get('company_name') as string | null;
  const counterparty = formData.get('counterparty') as string | null;
  const governingState = formData.get('governing_state') as string | null;
  const parentDocId = formData.get('parent_doc_id') as string | null;
  const docRelation = formData.get('doc_relation') as string | null;
  const deepExtractFlag = formData.get('deep_extract') === 'true';

  // Document type is intentionally NOT defaulted here. Leaving it empty means
  // each file gets auto-classified independently by processDocumentUpload()
  // (see lib/documents/classifyDocument.ts) instead of every file in the
  // batch being forced into one type just because they were uploaded
  // together. The UI no longer offers a batch-wide type selector; these
  // params only exist for a rare deliberate override.
  let documentTypes: string[] = [];
  if (documentTypesRaw) {
    try { documentTypes = JSON.parse(documentTypesRaw); } catch { documentTypes = documentType ? [documentType] : []; }
  } else if (documentType) {
    documentTypes = [documentType];
  }
  documentTypes = documentTypes.filter(Boolean);

  if (files.length === 0) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 });
  }
  if (files.length > 100) {
    return NextResponse.json({ error: 'A batch is limited to 100 files' }, { status: 400 });
  }

  const supabase = createServerClient();
  const batchId = 'batch_' + Math.random().toString(36).substring(2, 10);

  const jobs: Array<{ document_id: string; upload_id: string; file_name: string; status: string }> = [];
  const rejected: Array<{ file_name: string; error: string }> = [];

  for (const file of files) {
    const earlyCheck = validateUpload(file, 'document');
    if (!earlyCheck.valid) {
      rejected.push({ file_name: file.name, error: earlyCheck.error || 'Invalid file' });
      continue;
    }
    const buffer = await file.arrayBuffer();
    const magicCheck = validateUpload(file, 'document', buffer);
    if (!magicCheck.valid) {
      rejected.push({ file_name: file.name, error: magicCheck.error || 'Invalid file' });
      continue;
    }

    const docId = 'doc_' + Math.random().toString(36).substring(2, 10);
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
    const storagePath = `${docId}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, buffer, { contentType: file.type || 'application/pdf', upsert: true });
    if (uploadErr) {
      console.error('[bulk-upload] storage upload error:', uploadErr.message);
      rejected.push({ file_name: file.name, error: sanitizeDbError(uploadErr, 'Storage upload failed') });
      continue;
    }

    const uploadId = 'upl_' + Math.random().toString(36).substring(2, 10);
    const uploadMeta = {
      documentTypes,
      documentTitle: file.name.replace(/\.[^.]+$/, ''),
      entityId: entityId || null,
      assetId: assetId || null,
      companyName: companyName || null,
      counterparty: counterparty || null,
      governingState: governingState || null,
      parentDocId: parentDocId || null,
      docRelation: docRelation || null,
      deepExtractFlag,
      fileType: file.type || 'application/pdf',
    };

    const { error: insertErr } = await supabase.from('document_uploads').insert({
      upload_id: uploadId,
      document_id: docId,
      batch_id: batchId,
      file_name: file.name,
      file_type: ext,
      document_type: documentTypes[0] || null,
      extraction_status: 'queued',
      upload_meta: uploadMeta,
    });
    if (insertErr) {
      console.error('[bulk-upload] document_uploads insert error:', insertErr.message);
      rejected.push({ file_name: file.name, error: sanitizeDbError(insertErr) });
      continue;
    }

    jobs.push({ document_id: docId, upload_id: uploadId, file_name: file.name, status: 'queued' });
  }

  if (jobs.length === 0) {
    return NextResponse.json({ error: 'No valid files to upload', rejected }, { status: 400 });
  }

  const { error: batchInsertErr } = await supabase.from('document_batches').insert({
    batch_id: batchId,
    total_count: jobs.length,
    status: 'processing',
  });
  if (batchInsertErr) {
    console.error('[bulk-upload] document_batches insert error:', batchInsertErr.message);
    return NextResponse.json({ error: sanitizeDbError(batchInsertErr, 'Failed to create batch — has scripts/add-bulk-upload-schema.sql been applied?') }, { status: 500 });
  }

  // Opportunistic kick — NOT awaited. Firing this without blocking the
  // response means the client sees the queued-jobs table immediately instead
  // of the whole batch staying frozen behind up to 45s of worker processing.
  // Purely a latency optimization either way: if it fails, never fires, or
  // the process dies before it completes, the 1-minute scheduled poller
  // (netlify/functions/bulk-upload-poller.ts) still drains the queue.
  void triggerBulkUploadWorker().catch(() => {});

  return NextResponse.json({ batchId, jobs, rejected });
}

// ─── GET — batch + per-job status for the UI to poll ────────────────────────
// Without ?batchId, lists recent batches with per-status job counts — this is
// what the global "N processing" indicator (TopBar) polls, so a batch never
// silently disappears into a "black hole" once its upload modal is closed:
// it stays visible from anywhere in the app until it finishes.
export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get('batchId');
  const supabase = createServerClient();

  if (!batchId) {
    const { data: batches, error: batchesErr } = await supabase
      .from('document_batches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    if (batchesErr) return NextResponse.json({ error: batchesErr.message }, { status: 500 });

    const batchIds = (batches || []).map(b => b.batch_id);
    const counts = new Map<string, { queued: number; processing: number; completed: number; failed: number }>();
    if (batchIds.length > 0) {
      const { data: rows } = await supabase
        .from('document_uploads')
        .select('batch_id, extraction_status')
        .in('batch_id', batchIds);
      for (const r of rows || []) {
        if (!counts.has(r.batch_id)) counts.set(r.batch_id, { queued: 0, processing: 0, completed: 0, failed: 0 });
        const c = counts.get(r.batch_id)!;
        c[normalizeStatus(r.extraction_status)]++;
      }
    }
    const enrichedBatches = (batches || []).map(b => ({
      ...b,
      counts: counts.get(b.batch_id) || { queued: 0, processing: 0, completed: 0, failed: 0 },
    }));
    return NextResponse.json({ batches: enrichedBatches });
  }

  const [{ data: batch, error: batchErr }, { data: jobs, error: jobsErr }] = await Promise.all([
    supabase.from('document_batches').select('*').eq('batch_id', batchId).maybeSingle(),
    supabase.from('document_uploads')
      .select('upload_id, document_id, file_name, extraction_status, extracted_count, error_message, retry_count, created_at')
      .eq('batch_id', batchId)
      .order('created_at', { ascending: true }),
  ]);
  if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });
  if (jobsErr) return NextResponse.json({ error: jobsErr.message }, { status: 500 });
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 });

  // Classification lives on `documents` (set by processDocumentUpload once a
  // job actually runs) — merge it in so the UI can show type/confidence/
  // paper-source/template per file without a second round trip.
  const docIds = (jobs || []).map(j => j.document_id).filter(Boolean);
  let docsById = new Map<string, any>();
  if (docIds.length > 0) {
    const { data: docs } = await supabase
      .from('documents')
      .select('document_id, document_type, document_type_confidence, document_type_classification_method, document_type_override, paper_source_guess, paper_source_confidence, matched_template_name, matched_template_confidence, governing_state, entity_name, counterparty_name')
      .in('document_id', docIds);
    docsById = new Map((docs || []).map((d: any) => [d.document_id, d]));
  }
  const enrichedJobs = (jobs || []).map(j => ({
    ...j,
    extraction_status: normalizeStatus(j.extraction_status),
    document: docsById.get(j.document_id) || null,
  }));

  return NextResponse.json({ batch, jobs: enrichedJobs });
}
