export async function extractTextFromFile(
  buffer: ArrayBuffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const ext = fileName.split('.').pop()?.toLowerCase();

  if (ext === 'txt' || mimeType === 'text/plain') {
    return new TextDecoder().decode(buffer);
  }

  if (ext === 'pdf' || mimeType === 'application/pdf') {
    const { extractText } = await import('unpdf');
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
    return text;
  }

  if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    return result.value;
  }

  throw new Error(`Unsupported file type: ${ext}. Supported: pdf, docx, txt`);
}

/**
 * Sends a PDF binary to LlamaParse and returns the OCR'd markdown text.
 * Used as a fallback when unpdf returns too little text (image-based / scanned PDF).
 */
async function ocrPDFWithLlamaParse(
  buffer: ArrayBuffer,
  fileName: string,
  apiKey: string
): Promise<string> {
  const LLAMAPARSE_BASE = 'https://api.cloud.llamaindex.ai/api/parsing';

  const blob = new Blob([buffer], { type: 'application/pdf' });
  const fd = new FormData();
  fd.append('file', blob, fileName);

  const uploadRes = await fetch(`${LLAMAPARSE_BASE}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });

  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    console.error(`[LlamaParse OCR] upload failed — HTTP ${uploadRes.status}: ${body}`);
    throw new Error(`LlamaParse OCR upload failed (HTTP ${uploadRes.status}): ${body}`);
  }

  const uploadJson = await uploadRes.json();
  const jobId = uploadJson.id;
  console.log('[LlamaParse OCR] job started:', jobId);
  if (!jobId) throw new Error('LlamaParse OCR returned no job id');

  // Poll up to 90 seconds
  let succeeded = false;
  for (let i = 0; i < 45; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const statusRes = await fetch(`${LLAMAPARSE_BASE}/job/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const statusJson = await statusRes.json();
    console.log(`[LlamaParse OCR] poll ${i + 1}: ${statusJson.status}`);
    if (statusJson.status === 'SUCCESS') { succeeded = true; break; }
    if (statusJson.status === 'ERROR') throw new Error('LlamaParse OCR job failed');
  }
  if (!succeeded) throw new Error('LlamaParse OCR timed out after 90 seconds');

  // Prefer the plain-text result — it yields more complete body content for scanned PDFs.
  // Fall back to markdown only if text is empty.
  let extracted = '';

  const textRes = await fetch(`${LLAMAPARSE_BASE}/job/${jobId}/result/text`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (textRes.ok) {
    const textJson = await textRes.json();
    // LlamaParse may return { text: "..." } or { pages: [{ text: "..." }] }
    const pageTexts: string[] = Array.isArray(textJson.pages)
      ? textJson.pages.map((p: any) => (p.text ?? p.md ?? '').trim()).filter(Boolean)
      : [];
    extracted = pageTexts.length > 0
      ? pageTexts.join('\n\n')
      : (textJson.text ?? '').trim();
  }

  if (!extracted) {
    const mdRes = await fetch(`${LLAMAPARSE_BASE}/job/${jobId}/result/markdown`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!mdRes.ok) throw new Error('LlamaParse OCR result fetch failed');
    const mdJson = await mdRes.json();
    const pageTexts: string[] = Array.isArray(mdJson.pages)
      ? mdJson.pages.map((p: any) => (p.md ?? '').trim()).filter(Boolean)
      : [];
    extracted = pageTexts.length > 0
      ? pageTexts.join('\n\n')
      : (mdJson.markdown ?? '').trim();
  }

  return extracted;
}

/**
 * Sends a PDF to Claude via the Anthropic API and returns the extracted text.
 * Claude's vision handles angled, skewed, and low-quality scans far better than
 * traditional OCR engines.
 */
async function ocrPDFWithClaude(buffer: ArrayBuffer, apiKey: string): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey });

  const base64 = Buffer.from(buffer).toString('base64');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          } as any,
          {
            type: 'text',
            text: 'Extract ALL text from this legal document exactly as written. Output every numbered section with its complete header and full body text verbatim — do not summarize, skip, or paraphrase anything. Preserve paragraph breaks.',
          },
        ],
      },
    ],
  });

  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}

/**
 * Extracts text from a file, automatically falling back to Claude vision OCR when
 * a PDF appears to be image-based (unpdf returns fewer than 100 characters).
 *
 * Priority: Claude (ANTHROPIC_API_KEY) → LlamaParse (LLAMA_CLOUD_API_KEY) → empty.
 * OCR failures are non-fatal so callers are never hard-blocked.
 */
export async function extractTextWithOCRFallback(
  buffer: ArrayBuffer,
  fileName: string,
  mimeType: string,
  llamaApiKey?: string
): Promise<{ text: string; ocrUsed: boolean; ocrError?: string }> {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const isPDF = ext === 'pdf' || mimeType === 'application/pdf';

  // unpdf transfers (detaches) the ArrayBuffer when processing a PDF.
  // Copy it before extraction so we still have the raw bytes for OCR if needed.
  const pdfBufferCopy = isPDF ? buffer.slice(0) : null;

  const text = await extractTextFromFile(buffer, fileName, mimeType);

  // If text is meaningful, return it as-is
  if (text.trim().length >= 100) {
    return { text, ocrUsed: false };
  }

  if (!isPDF || !pdfBufferCopy) return { text, ocrUsed: false };

  // 1. Try Claude vision first — handles angled/skewed scans perfectly
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    console.log('[extractText] unpdf returned < 100 chars — attempting Claude vision OCR');
    try {
      const ocrText = await ocrPDFWithClaude(pdfBufferCopy, anthropicKey);
      console.log(`[extractText] Claude OCR succeeded — extracted ${ocrText.trim().length} chars`);
      if (ocrText.trim().length >= 100) return { text: ocrText, ocrUsed: true };
    } catch (err: any) {
      console.error('[extractText] Claude OCR failed:', err.message);
    }
  }

  // 2. Fall back to LlamaParse if Claude is unavailable
  if (llamaApiKey) {
    console.log('[extractText] Falling back to LlamaParse OCR');
    try {
      const ocrText = await ocrPDFWithLlamaParse(pdfBufferCopy, fileName, llamaApiKey);
      console.log(`[extractText] LlamaParse OCR succeeded — extracted ${ocrText.trim().length} chars`);
      return { text: ocrText, ocrUsed: true };
    } catch (err: any) {
      console.error('[extractText] LlamaParse OCR failed:', err.message);
      return { text, ocrUsed: false, ocrError: err.message };
    }
  }

  return { text, ocrUsed: false };
}

export function chunkText(text: string, maxChars = 12000): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxChars;
    const breakPoint = text.lastIndexOf('\n\n', end);
    if (breakPoint > start + maxChars * 0.7) end = breakPoint;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}
