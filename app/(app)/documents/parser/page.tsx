'use client';
import PageHeader from '@/components/ui/PageHeader';
import { ClauseExplorerTab } from '../page';

// Own sidebar page — previously a tab inside /documents (Contracts
// Repository), moved out so it's reachable directly from the Documents nav
// group instead of being buried behind a pill on the Contracts page.
export default function DocumentParserPage() {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PageHeader
        title="Document Parser"
        subtitle="Upload or select a document and parse it with AI — clauses, obligations, and insurance policies"
      />
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <ClauseExplorerTab />
      </div>
    </div>
  );
}
