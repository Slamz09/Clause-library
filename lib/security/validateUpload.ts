// ─── File Upload Validation ───────────────────────────────────────────────────
// Validates file uploads by checking size, extension, MIME type, and magic bytes.
// All four checks must pass — MIME type alone is client-supplied and trivially spoofed.

export type UploadContext = 'document' | 'article' | 'complaint' | 'excel';

// Size limits per upload context
const SIZE_LIMITS: Record<UploadContext, number> = {
  document:  50 * 1024 * 1024, // 50 MB  (legal PDFs / DOCX)
  article:   25 * 1024 * 1024, // 25 MB
  complaint: 25 * 1024 * 1024, // 25 MB
  excel:     10 * 1024 * 1024, // 10 MB
};

// Allowed file extensions (last segment only — prevents "file.pdf.exe" attacks)
const ALLOWED_EXTENSIONS: Record<UploadContext, ReadonlySet<string>> = {
  document:  new Set(['pdf', 'docx', 'doc', 'txt']),
  article:   new Set(['pdf', 'docx', 'doc', 'txt']),
  complaint: new Set(['pdf', 'docx', 'doc', 'txt']),
  excel:     new Set(['xlsx', 'xls']),
};

// Allowed server-side MIME types per context.
// Client-supplied MIME is a secondary check — magic bytes are the primary gate.
const ALLOWED_MIME: Record<UploadContext, ReadonlySet<string>> = {
  document: new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain',
  ]),
  article: new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain',
  ]),
  complaint: new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain',
  ]),
  excel: new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream', // some browsers send this for .xlsx
  ]),
};

// Magic byte signatures for allowed binary formats.
// Text files (.txt) are exempt — they have no fixed signature.
const MAGIC_SIGNATURES: Array<{ sig: number[]; label: string }> = [
  { sig: [0x25, 0x50, 0x44, 0x46], label: 'PDF'       }, // %PDF
  { sig: [0x50, 0x4B, 0x03, 0x04], label: 'DOCX/XLSX' }, // PK.. (ZIP container)
  { sig: [0x50, 0x4B, 0x05, 0x06], label: 'DOCX/XLSX' }, // PK empty archive
  { sig: [0xD0, 0xCF, 0x11, 0xE0], label: 'DOC/XLS'   }, // OLE compound document
];

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

function hasMagicBytes(bytes: Uint8Array): boolean {
  return MAGIC_SIGNATURES.some(({ sig }) =>
    sig.every((b, i) => bytes[i] === b),
  );
}

/**
 * Validates an uploaded file. Pass `buffer` for magic-byte checking (recommended).
 * Without the buffer only size, extension, and MIME are checked.
 */
export function validateUpload(
  file: File,
  context: UploadContext,
  buffer?: ArrayBuffer,
): ValidationResult {
  // 1. Size check (use file.size — no need to read the buffer for this)
  const limit = SIZE_LIMITS[context];
  if (file.size > limit) {
    const mb = Math.round(limit / 1024 / 1024);
    return { valid: false, error: `File exceeds the ${mb} MB size limit` };
  }

  if (file.size === 0) {
    return { valid: false, error: 'File is empty' };
  }

  // 2. Extension check — only allow the last extension segment
  const ext = getExtension(file.name);
  if (!ext || !ALLOWED_EXTENSIONS[context].has(ext)) {
    const allowed = [...ALLOWED_EXTENSIONS[context]].join(', ');
    return { valid: false, error: `File type not allowed. Accepted: ${allowed}` };
  }

  // 3. MIME type check (secondary — client-supplied but still useful as a layer)
  if (file.type) {
    const allowedMime = ALLOWED_MIME[context];
    if (!allowedMime.has(file.type)) {
      // Text-type variants are acceptable for .txt uploads
      const isTextVariant = ext === 'txt' && file.type.startsWith('text/');
      if (!isTextVariant) {
        return { valid: false, error: 'File MIME type is not permitted' };
      }
    }
  }

  // 4. Magic bytes check — validates actual binary content, not just metadata
  if (buffer) {
    // Plain text files don't have a fixed signature — skip magic check for .txt
    if (ext !== 'txt') {
      const bytes = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
      if (!hasMagicBytes(bytes)) {
        return { valid: false, error: 'File content does not match the expected format' };
      }
    }
  }

  return { valid: true };
}
