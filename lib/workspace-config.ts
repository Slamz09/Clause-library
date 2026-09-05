// ── Workspace Configuration ────────────────────────────────────────────────────
// Industry-specific labels, KPI packs, and presets.
// The shell never touches industry strings directly — everything goes through here.

export type IndustryKey = 'GENERIC' | 'HOSPITALITY' | 'RETAIL' | 'HEALTHCARE' | 'RIDESHARE';

export interface LabelMap {
  parentLabel: string;      // e.g. "Portfolio" / "Enterprise"
  groupLabel: string;       // e.g. "Owner" / "Region"
  leafLabel: string;        // e.g. "Hotel" / "Store"
  leafLabelPlural: string;  // e.g. "Hotels" / "Stores"
}

export interface KpiData {
  events: any[];
  entities: any[];
  obligations: any[];
  assets: any[];
}

export interface KpiTileDefinition {
  id: string;
  label: string;
  getValue: (data: KpiData) => string | number;
  getSub?: (data: KpiData) => string | null;
  accentColor?: string;
}

export interface NodeConfig {
  primaryNodeType: 'state' | 'country';
  primaryNodeLabel: string;
  secondaryNodeType: 'client' | 'entity' | 'facility';
  secondaryNodeLabel: string;
  detailNodeType: 'driver' | 'incident' | 'contract';
  detailNodeLabel: string;
}

export interface WorkspaceConfig {
  industryKey: IndustryKey;
  labels: LabelMap;
  kpis: KpiTileDefinition[];
  nodeConfig: NodeConfig;
}

// ── Shared KPI definitions (same for all industries, data-driven) ──────────────

const GENERIC_KPIS: KpiTileDefinition[] = [
  {
    id: 'open_events',
    label: 'Open Risk Events',
    getValue: ({ events }) => events.filter(e => e.status === 'open').length,
    getSub: ({ events }) => {
      const crit = events.filter(e => e.severity === 'critical').length;
      return crit > 0 ? `${crit} critical` : null;
    },
  },
  {
    id: 'active_entities',
    label: 'Active Entities',
    getValue: ({ entities }) => entities.length,
    getSub: () => null,
  },
  {
    id: 'open_obligations',
    label: 'Open Obligations',
    getValue: ({ obligations }) => obligations.filter(o => o.status === 'open').length,
    getSub: ({ obligations }) => {
      const overdue = obligations.filter(
        o => o.due_date && new Date(o.due_date) < new Date() && o.status === 'open'
      ).length;
      return overdue > 0 ? `${overdue} overdue` : null;
    },
  },
  {
    id: 'portfolio_risk',
    label: 'Portfolio Risk',
    getValue: () => '7.4',
    getSub: () => 'High',
    accentColor: '#ef4444',
  },
];

// ── Industry presets ───────────────────────────────────────────────────────────

const GENERIC_NODE_CONFIG: NodeConfig = {
  primaryNodeType: 'state',
  primaryNodeLabel: 'State',
  secondaryNodeType: 'entity',
  secondaryNodeLabel: 'Entities',
  detailNodeType: 'contract',
  detailNodeLabel: 'Contracts',
};

export const GENERIC_PRESET: WorkspaceConfig = {
  industryKey: 'GENERIC',
  labels: {
    parentLabel: 'Portfolio',
    groupLabel: 'Group',
    leafLabel: 'Entity',
    leafLabelPlural: 'Entities',
  },
  kpis: GENERIC_KPIS,
  nodeConfig: GENERIC_NODE_CONFIG,
};

export const HOSPITALITY_PRESET: WorkspaceConfig = {
  industryKey: 'HOSPITALITY',
  labels: {
    parentLabel: 'Portfolio',
    groupLabel: 'Owner',
    leafLabel: 'Hotel',
    leafLabelPlural: 'Hotels',
  },
  kpis: GENERIC_KPIS,
  nodeConfig: { ...GENERIC_NODE_CONFIG, secondaryNodeType: 'facility', secondaryNodeLabel: 'Properties' },
};

export const RETAIL_PRESET: WorkspaceConfig = {
  industryKey: 'RETAIL',
  labels: {
    parentLabel: 'Enterprise',
    groupLabel: 'Region',
    leafLabel: 'Store',
    leafLabelPlural: 'Stores',
  },
  kpis: GENERIC_KPIS,
  nodeConfig: { ...GENERIC_NODE_CONFIG, secondaryNodeType: 'facility', secondaryNodeLabel: 'Stores' },
};

export const HEALTHCARE_PRESET: WorkspaceConfig = {
  industryKey: 'HEALTHCARE',
  labels: {
    parentLabel: 'System',
    groupLabel: 'Hospital Group',
    leafLabel: 'Facility',
    leafLabelPlural: 'Facilities',
  },
  kpis: GENERIC_KPIS,
  nodeConfig: { ...GENERIC_NODE_CONFIG, secondaryNodeType: 'facility', secondaryNodeLabel: 'Facilities' },
};

export const RIDESHARE_PRESET: WorkspaceConfig = {
  industryKey: 'RIDESHARE',
  labels: {
    parentLabel: 'Network',
    groupLabel: 'Region',
    leafLabel: 'Account',
    leafLabelPlural: 'Accounts',
  },
  kpis: GENERIC_KPIS,
  nodeConfig: {
    primaryNodeType: 'state',
    primaryNodeLabel: 'State',
    secondaryNodeType: 'client',
    secondaryNodeLabel: 'Accounts',
    detailNodeType: 'driver',
    detailNodeLabel: 'Drivers',
  },
};

export const PRESETS: Record<IndustryKey, WorkspaceConfig> = {
  GENERIC: GENERIC_PRESET,
  HOSPITALITY: HOSPITALITY_PRESET,
  RETAIL: RETAIL_PRESET,
  HEALTHCARE: HEALTHCARE_PRESET,
  RIDESHARE: RIDESHARE_PRESET,
};

// ── Config loader (reads localStorage, falls back to GENERIC) ──────────────────

export function loadWorkspaceConfig(): WorkspaceConfig {
  if (typeof window === 'undefined') return GENERIC_PRESET;
  try {
    const raw = localStorage.getItem('consola_workspace_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      const key = parsed?.industryKey as IndustryKey;
      if (key && PRESETS[key]) return PRESETS[key];
    }
  } catch {}
  return GENERIC_PRESET;
}
