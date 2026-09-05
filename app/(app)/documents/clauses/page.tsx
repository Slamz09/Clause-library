'use client';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// The standalone Clause Library at /documents/clauses has been retired — the
// canonical Clause Library is the tab at /documents?tab=clause-table
// (components: ObligationsTab in app/(app)/documents/page.tsx). This route
// stays only so old links/bookmarks keep working, forwarding a document deep
// link to the equivalent filter on the unified table.
function RedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const params = new URLSearchParams({ tab: 'clause-table' });
    const docId = searchParams.get('documentId');
    const clause = searchParams.get('clause');
    if (docId) params.set('contract', docId);
    if (clause) params.set('clause', clause);
    router.replace(`/documents?${params.toString()}`);
  }, [router, searchParams]);
  return null;
}

export default function RetiredClauseLibraryPage() {
  return (
    <Suspense fallback={null}>
      <RedirectInner />
    </Suspense>
  );
}
