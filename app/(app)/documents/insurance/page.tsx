'use client';
import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Insurance is no longer a separate sidebar page — it's a Source Type filter
// within Contracts & Documents (see documents/page.tsx's ContractsTab). This
// route stays only so old links/bookmarks keep working.
function RedirectInner() {
  const router = useRouter();
  useEffect(() => { router.replace('/documents?sourceType=insurance'); }, [router]);
  return null;
}

export default function InsurancePage() {
  return (
    <Suspense fallback={null}>
      <RedirectInner />
    </Suspense>
  );
}
