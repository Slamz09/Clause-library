'use client';
import { createContext, useContext, useState, ReactNode } from 'react';
import {
  WorkspaceConfig,
  IndustryKey,
  loadWorkspaceConfig,
  PRESETS,
} from './workspace-config';

interface WorkspaceConfigCtx {
  config: WorkspaceConfig;
  setIndustry: (key: IndustryKey) => void;
}

const WorkspaceConfigContext = createContext<WorkspaceConfigCtx | null>(null);

export function WorkspaceConfigProvider({ children }: { children: ReactNode }) {
  // Lazy initializer — function ref avoids calling loadWorkspaceConfig on the server
  const [config, setConfig] = useState<WorkspaceConfig>(loadWorkspaceConfig);

  const setIndustry = (key: IndustryKey) => {
    const next = PRESETS[key];
    try {
      localStorage.setItem('consola_workspace_config', JSON.stringify({ industryKey: key }));
    } catch {}
    setConfig(next);
  };

  return (
    <WorkspaceConfigContext.Provider value={{ config, setIndustry }}>
      {children}
    </WorkspaceConfigContext.Provider>
  );
}

export function useWorkspaceConfig(): WorkspaceConfigCtx {
  const ctx = useContext(WorkspaceConfigContext);
  if (!ctx) throw new Error('useWorkspaceConfig must be used inside WorkspaceConfigProvider');
  return ctx;
}
