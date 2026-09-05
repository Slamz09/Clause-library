import { NextRequest, NextResponse } from 'next/server';
import { validateUpload } from '@/lib/security/validateUpload';
import { requireSession } from '@/lib/auth/requireSession';
import { processDocumentUpload } from '@/lib/documents/processDocumentUpload';

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const formData = await req.formData();
  const file          = formData.get('file') as File;
  const documentType  = formData.get('document_type') as string;
  const documentTypesRaw = formData.get('document_types') as string | null;
  const entityId        = formData.get('entity_id') as string | null;
  const assetId         = formData.get('asset_id') as string | null;
  const documentTitle   = formData.get('title') as string;
  const companyName     = formData.get('company_name') as string | null;
  const counterparty    = formData.get('counterparty') as string | null;
  const governingState  = formData.get('governing_state') as string | null;
  const parentDocId     = formData.get('parent_doc_id') as string | null;
  const docRelation     = formData.get('doc_relation') as string | null;
  const deepExtractFlag = formData.get('deep_extract') === 'true';

  // Support both single document_type (legacy) and document_types array (new multi-schema)
  let documentTypes: string[] = [];
  if (documentTypesRaw) {
    try { documentTypes = JSON.parse(documentTypesRaw); } catch { documentTypes = [documentType]; }
  } else {
    documentTypes = [documentType];
  }
  documentTypes = documentTypes.filter(Boolean);
  if (documentTypes.length === 0) {
    return NextResponse.json({ error: 'file and document_type are required' }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ error: 'file and document_type are required' }, { status: 400 });
  }

  // ── File validation (size, extension, magic bytes) ───────────────────────
  const earlyCheck = validateUpload(file, 'document');
  if (!earlyCheck.valid) {
    return NextResponse.json({ error: earlyCheck.error }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();

  // Magic bytes check now that we have the buffer
  const magicCheck = validateUpload(file, 'document', buffer);
  if (!magicCheck.valid) {
    return NextResponse.json({ error: magicCheck.error }, { status: 400 });
  }

  try {
    const result = await processDocumentUpload({
      buffer,
      fileName: file.name,
      fileType: file.type,
      documentTypes,
      documentTitle,
      entityId,
      assetId,
      companyName,
      counterparty,
      governingState,
      parentDocId,
      docRelation,
      deepExtractFlag,
    });

    return NextResponse.json({
      success: true,
      uploadId: result.uploadId,
      documentId: result.documentId,
      extractedCount: result.extractedCount,
      storage_upload_error: result.storageUploadError,
      auto_extracted_clause_count: result.extractedCount,
      ocr_used: result.ocrUsed,
    });
  } catch (e: any) {
    const message: string = e?.message || 'Document processing failed';
    const status = /^(Text extraction failed|Could not extract meaningful text)/.test(message) ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
