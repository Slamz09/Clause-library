'use client';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// Insurance Clause Library is no longer a separate sidebar page — it's the
// same Clause Library tab (documents/page.tsx), switched to the insurance
// family via ?family=insurance. This route stays only so old links/bookmarks
// (including ?insurer=/?policy= deep links) keep working.
function RedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const params = new URLSearchParams({ tab: 'clause-table', family: 'insurance' });
    const insurer = searchParams.get('insurer');
    const policy = searchParams.get('policy');
    if (insurer) params.set('insurer', insurer);
    if (policy) params.set('policy', policy);
    router.replace(`/documents?${params.toString()}`);
  }, [router, searchParams]);
  return null;
}

export default function InsuranceClauseLibraryPage() {
  return (
    <Suspense fallback={null}>
      <RedirectInner />
    </Suspense>
  );
}
