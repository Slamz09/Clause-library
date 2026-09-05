import { NextRequest, NextResponse } from 'next/server';
import { extractTextWithOCRFallback } from '@/lib/extractText';
import { requireSession } from '@/lib/auth/requireSession';

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const formData = await req.formData();
  const file = formData.get('file') as File;
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });

  try {
    const buffer = await file.arrayBuffer();
    const llamaKey = process.env.LLAMA_CLOUD_API_KEY;
    const { text, ocrUsed, ocrError } = await extractTextWithOCRFallback(buffer, file.name, file.type, llamaKey);
    return NextResponse.json({ text: text.substring(0, 200000), ocr_used: ocrUsed, ocr_error: ocrError ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 422 });
  }
}
