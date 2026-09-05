// Netlify Scheduled Function — the reliability backbone for bulk contract
// uploads. Runs every minute and pokes the internal worker
// (app/api/documents/bulk-upload/process/route.ts), which drains whatever is
// still 'queued' in document_uploads. This is what guarantees a batch keeps
// processing after the browser tab that started it is gone: the enqueue
// route's own opportunistic trigger (lib/documents/triggerBulkUploadWorker.ts)
// is a latency optimization only, not something this depends on.
//
// Standalone on purpose — no imports from lib/ or app/ — so it bundles
// correctly under Netlify's separate Functions build, independent of the
// Next.js app build.
export default async () => {
  const secret = process.env.BULK_PROCESS_SECRET;
  const baseUrl = process.env.APP_BASE_URL || process.env.URL;
  if (!secret || !baseUrl) {
    console.error('[bulk-upload-poller] missing BULK_PROCESS_SECRET or APP_BASE_URL/URL — skipping tick');
    return new Response('missing config', { status: 200 });
  }
  try {
    const res = await fetch(`${baseUrl}/api/documents/bulk-upload/process`, {
      method: 'POST',
      headers: { 'x-bulk-secret': secret },
    });
    const body = await res.text();
    console.log('[bulk-upload-poller]', res.status, body);
  } catch (err) {
    console.error('[bulk-upload-poller] trigger failed:', err);
  }
  return new Response('ok', { status: 200 });
};

export const config = {
  schedule: '* * * * *',
};
