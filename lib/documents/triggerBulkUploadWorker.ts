// Fires (and awaits) one call to the internal bulk-upload worker. The worker
// drains as many queued jobs as fit in its own time budget and returns —
// this just kicks that off; it is not the reliability guarantee. That's the
// job of the 1-minute Netlify scheduled function (netlify/functions/
// bulk-upload-poller.ts), which hits the same endpoint independently. This
// call is a pure latency optimization: if it throws or the worker times out
// mid-batch, the scheduled poller still finishes the job within a minute.
export async function triggerBulkUploadWorker(): Promise<void> {
  const secret = process.env.BULK_PROCESS_SECRET;
  if (!secret) {
    console.error('[triggerBulkUploadWorker] BULK_PROCESS_SECRET not set — relying on the scheduled poller only.');
    return;
  }
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
  try {
    const res = await fetch(`${baseUrl}/api/documents/bulk-upload/process`, {
      method: 'POST',
      headers: { 'x-bulk-secret': secret },
    });
    if (!res.ok) {
      console.error(`[triggerBulkUploadWorker] worker responded ${res.status}: ${await res.text().catch(() => '')}`);
    }
  } catch (err: any) {
    console.error('[triggerBulkUploadWorker] request failed:', err?.message);
  }
}
