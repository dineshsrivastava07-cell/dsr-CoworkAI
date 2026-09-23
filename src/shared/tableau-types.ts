export type TableauRole = 'retail' | 'merchandiser' | 'planner';

export interface TableauConfigPublic {
  baseUrl: string;
  username: string;
  siteContentUrl: string;
  apiVersion: string;
  hasPassword: boolean;
  configured: boolean;
}

export interface TableauConfigInput {
  baseUrl: string;
  username: string;
  /** Write-only. An empty value preserves the existing encrypted password. */
  password?: string;
  siteContentUrl?: string;
  apiVersion?: string;
}

export interface TableauConnectionStatus {
  configured: boolean;
  reachable: boolean;
  authenticated: boolean;
  serverVersion?: string;
  siteName?: string;
  checkedAt: number;
  error?: string;
  limitation?: string;
}

export interface TableauViewInfo {
  id: string;
  name: string;
  contentUrl?: string;
  workbookName?: string;
  projectName?: string;
  viewUrl?: string;
}

export interface TableauSummaryHighlight {
  label: string;
  value: string;
  sourceView?: string;
  sourceField?: string;
  calculation?: string;
  loadedRows?: number;
  totalRows?: number;
  truncated?: boolean;
}

export interface TableauRoleSummary {
  role: TableauRole;
  title: string;
  status: 'ready' | 'empty' | 'unavailable';
  summary: string;
  generatedAt: number | null;
  stale: boolean;
  matchedViews: TableauViewInfo[];
  highlights: TableauSummaryHighlight[];
  definitionVersion?: string;
  loadedRows?: number;
  totalRows?: number;
  error?: string;
}

export interface TableauDashboardState {
  connection: TableauConnectionStatus;
  summaries: Record<TableauRole, TableauRoleSummary>;
}

export interface TableauViewData {
  view: TableauViewInfo;
  columns: string[];
  rows: Record<string, string>[];
  totalRows: number;
  truncated: boolean;
}

export type TableauDimensionLevel = 'state' | 'zone' | 'region' | 'store';

export interface TableauViewFilter {
  field: string;
  values: string[];
}

export interface TableauDimensionFieldEvidence {
  viewId?: string;
  viewName?: string;
  field: string;
  sampleValues: string[];
  source: 'export' | 'governed-filter';
}

export interface TableauDimensionCoverage {
  level: TableauDimensionLevel;
  label: string;
  available: boolean;
  availability: 'observed' | 'configured' | 'absent';
  fields: TableauDimensionFieldEvidence[];
}

export interface TableauAnalysisPlan {
  question: string;
  role: TableauRole;
  domain: string;
  selectedViews: TableauViewInfo[];
  selectionReasons: Record<string, string[]>;
  datasets: TableauViewData[];
  appliedFilters: Record<string, TableauViewFilter[]>;
  dimensionCoverage: TableauDimensionCoverage[];
  warnings: string[];
  generatedAt: number;
}
