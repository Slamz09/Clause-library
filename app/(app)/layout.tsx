'use client';
import TopBar from '@/components/layout/TopBar';
import { WorkspaceConfigProvider } from '@/lib/workspace-config-context';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceConfigProvider>
      <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-hidden" style={{ background: 'var(--bg-primary)', position: 'relative' }}>
            {children}
          </main>
        </div>
      </div>
    </WorkspaceConfigProvider>
  );
}
