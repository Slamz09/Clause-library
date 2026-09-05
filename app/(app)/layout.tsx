'use client';
import { useState, useEffect } from 'react';
import TopBar from '@/components/layout/TopBar';
import Sidebar from '@/components/nav/Sidebar';
import DocumentUploadModal from '@/components/upload/DocumentUploadModal';
import { WorkspaceConfigProvider } from '@/lib/workspace-config-context';
import { fetchDocumentsCached } from '@/lib/clientDataCache';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [entities, setEntities] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);

  useEffect(() => {
    fetchDocumentsCached().then(setDocs);
  }, []);

  return (
    <WorkspaceConfigProvider>
      <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
        <TopBar onUploadClick={() => setUploadOpen(true)} />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(c => !c)} />
          <main className="flex-1 overflow-hidden" style={{ background: 'var(--bg-primary)', position: 'relative' }}>
            {children}
          </main>
        </div>
        {uploadOpen && (
          <DocumentUploadModal
            open={uploadOpen}
            onClose={() => setUploadOpen(false)}
            entities={entities}
            assets={assets}
            docs={docs}
            onExtractionComplete={(uid, count) => {
              console.log(`${count} obligations extracted from ${uid}`);
              setUploadOpen(false);
            }}
          />
        )}
      </div>
    </WorkspaceConfigProvider>
  );
}
