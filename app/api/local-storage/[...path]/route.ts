import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { FILES_DIR } from '@/lib/localDb';

// Serves files written by the local storage shim (lib/localDb.ts →
// storage.from(bucket).upload(...)). Replaces Supabase Storage public URLs
// for this standalone build.
const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json',
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: parts } = await params;
  if (!parts?.length || parts.some((p) => p === '..' || p.includes('/') || p.includes('\\'))) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  const filePath = path.join(FILES_DIR, ...parts);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(FILES_DIR))) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  let buf: Buffer;
  try {
    buf = fs.readFileSync(resolved);
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
      'Content-Length': String(buf.length),
      'Cache-Control': 'private, max-age=60',
    },
  });
}
