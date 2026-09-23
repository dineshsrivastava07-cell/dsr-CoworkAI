import type {
  TableauAnalysisPlan,
  TableauConnectionStatus,
  TableauDashboardState,
  TableauRole,
  TableauRoleSummary,
  TableauViewData,
  TableauViewInfo,
} from '../../shared/tableau-types';
import { TableauClient } from './tableau-client';
import {
  buildTableauCandidatePool,
  deriveTableauQuestionFilters,
  detectTableauDimensionCoverage,
  requestedTableauDimensions,
  selectTableauDatasetsForQuestion,
} from './tableau-analysis-planner';
import { tableauStore } from './tableau-store';

const ROLES: TableauRole[] = ['retail', 'merchandiser', 'planner'];
const ROLE_LABELS: Record<TableauRole, string> = {
  retail: 'Retail',
  merchandiser: 'Merchandiser',
  planner: 'Planner',
};
const ROLE_KEYWORDS: Record<TableauRole, string[]> = {
  retail: ['retail', 'sales', 'store', 'revenue', 'footfall', 'bill', 'margin', 'growth'],
  merchandiser: [
    'merchandiser',
    'marchandiser',
    'merchandise',
    'assortment',
    'style',
    'article',
    'sell through',
    'markdown',
    'aging',
  ],
  planner: [
    'planner',
    'planning',
    'plan',
    'budget',
    'forecast',
    'otb',
    'weeks cover',
    'allocation',
  ],
};
const ROLE_PRIORITY: Record<TableauRole, string[]> = {
  retail: [
    'festive performance',
    'business performance',
    'live sales',
    'retail performance',
    'store-dept performance',
    'weekly sales',
    'plan vs performance',
    'store audit',
  ],
  merchandiser: [
    'weekly category scorecard',
    'sell thru',
    'stock ageing',
    'assortment',
    'non selling',
    'option performance',
    'article performance',
    'vendor sell',
  ],
  planner: [
    'otb',
    'plan vs performance',
    'forecast',
    'monthly inventory',
    'days cover',
    'allocation',
    'potential oos',
    'weekly sales',
  ],
};

type TableauMetricAggregation = 'sum' | 'average';
type TableauMetricFormat = 'currency' | 'number' | 'percent' | 'days';

interface TableauRoleMetricDefinition {
  id: string;
  label: string;
  fields: RegExp;
  aggregation: TableauMetricAggregation;
  format: TableauMetricFormat;
}

const KPI_DEFINITION_VERSION = 'vmart-role-kpi-v1';
const ROLE_SUMMARY_VIEW_LIMIT = 4;
export const MAX_TABLEAU_ANALYSIS_VIEWS = 3;

export function validateTableauViewIds(viewIds: readonly string[]): string[] {
  const normalized = [...new Set(viewIds.map((id) => id.trim()).filter(Boolean))];
  if (!normalized.length) throw new Error('Select at least one Tableau dashboard.');
  if (normalized.length > MAX_TABLEAU_ANALYSIS_VIEWS) {
    throw new Error(`Select no more than ${MAX_TABLEAU_ANALYSIS_VIEWS} Tableau dashboards.`);
  }
  return normalized;
}

/**
 * Deterministic, reviewable role metrics. A calculation is emitted only when
 * an exported Tableau field matches one of these explicit aliases. This avoids
 * treating an arbitrary numeric column as a governed business KPI.
 */
const ROLE_METRICS: Record<TableauRole, TableauRoleMetricDefinition[]> = {
  retail: [
    {
      id: 'retail.net_sales',
      label: 'Net sales',
      fields: /^(net sales|sales value|net revenue|revenue)$/i,
      aggregation: 'sum',
      format: 'currency',
    },
    {
      id: 'retail.bills',
      label: 'Bills',
      fields: /^(bill count|bills|number of bills)$/i,
      aggregation: 'sum',
      format: 'number',
    },
    {
      id: 'retail.footfall',
      label: 'Footfall',
      fields: /^(footfall|customer footfall)$/i,
      aggregation: 'sum',
      format: 'number',
    },
    {
      id: 'retail.margin_percent',
      label: 'Margin',
      fields: /^(gross margin %|margin %|gm %)$/i,
      aggregation: 'average',
      format: 'percent',
    },
  ],
  merchandiser: [
    {
      id: 'merch.sell_through_percent',
      label: 'Sell-through',
      fields: /^(sell through %|sell-through %|sell thru %|str %)$/i,
      aggregation: 'average',
      format: 'percent',
    },
    {
      id: 'merch.stock_age_days',
      label: 'Stock age',
      fields: /^(stock age|stock ageing days|stock aging days|ageing days|aging days)$/i,
      aggregation: 'average',
      format: 'days',
    },
    {
      id: 'merch.markdown_percent',
      label: 'Markdown',
      fields: /^(markdown %|markdown percent|discount %)$/i,
      aggregation: 'average',
      format: 'percent',
    },
    {
      id: 'merch.stock_quantity',
      label: 'Stock quantity',
      fields: /^(stock qty|stock quantity|inventory qty|inventory quantity)$/i,
      aggregation: 'sum',
      format: 'number',
    },
  ],
  planner: [
    {
      id: 'plan.otb_value',
      label: 'Open to buy',
      fields: /^(otb value|open to buy|open-to-buy)$/i,
      aggregation: 'sum',
      format: 'currency',
    },
    {
      id: 'plan.plan_value',
      label: 'Plan value',
      fields: /^(plan value|sales plan|budget value|sales budget)$/i,
      aggregation: 'sum',
      format: 'currency',
    },
    {
      id: 'plan.forecast_value',
      label: 'Forecast value',
      fields: /^(forecast value|sales forecast)$/i,
      aggregation: 'sum',
      format: 'currency',
    },
    {
      id: 'plan.inventory_value',
      label: 'Inventory value',
      fields: /^(inventory value|stock value)$/i,
      aggregation: 'sum',
      format: 'currency',
    },
    {
      id: 'plan.cover',
      label: 'Stock cover',
      fields: /^(weeks cover|weeks of cover|days cover|days of cover)$/i,
      aggregation: 'average',
      format: 'days',
    },
  ],
};

function parseMetricNumber(value: string | undefined): number | null {
  if (value == null) return null;
  let normalized = value.trim();
  if (!normalized || /^(null|n\/a|na|--?)$/i.test(normalized)) return null;
  const negative = /^\(.*\)$/.test(normalized);
  normalized = normalized
    .replace(/^\((.*)\)$/, '$1')
    .replace(/[₹$€£,%]/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function formatMetric(value: number, format: TableauMetricFormat): string {
  if (format === 'currency') {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (format === 'percent') {
    return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)}%`;
  }
  if (format === 'days') {
    return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(value)} days`;
  }
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
}

function calculateDefinedHighlights(
  role: TableauRole,
  data: TableauViewData[]
): TableauRoleSummary['highlights'] {
  const highlights: TableauRoleSummary['highlights'] = [];
  const seen = new Set<string>();
  for (const item of data) {
    for (const definition of ROLE_METRICS[role]) {
      const field = item.columns.find((column) => definition.fields.test(column.trim()));
      if (!field) continue;
      const key = `${definition.id}:${item.view.id}`;
      if (seen.has(key)) continue;
      const values = item.rows
        .map((row) => parseMetricNumber(row[field]))
        .filter((value): value is number => value !== null);
      if (!values.length) continue;
      const sum = values.reduce((total, value) => total + value, 0);
      const calculated = definition.aggregation === 'sum' ? sum : sum / values.length;
      highlights.push({
        label: definition.label,
        value: formatMetric(calculated, definition.format),
        sourceView: item.view.name,
        sourceField: field,
        calculation:
          definition.aggregation === 'sum'
            ? `Sum of ${values.length.toLocaleString('en-IN')} numeric loaded rows`
            : `Mean of ${values.length.toLocaleString('en-IN')} numeric loaded rows`,
        loadedRows: item.rows.length,
        totalRows: item.totalRows,
        truncated: item.truncated,
      });
      seen.add(key);
      if (highlights.length >= 6) return highlights;
    }
  }
  return highlights;
}

function emptySummary(role: TableauRole): TableauRoleSummary {
  return {
    role,
    title: `${ROLE_LABELS[role]} dashboard summary`,
    status: 'empty',
    summary: 'No matching Tableau dashboard data has been cached yet.',
    generatedAt: null,
    stale: false,
    matchedViews: [],
    highlights: [],
  };
}

export function matchTableauViewsForRole(
  role: TableauRole,
  views: TableauViewInfo[]
): TableauViewInfo[] {
  const keywords = ROLE_KEYWORDS[role];
  const priorities = ROLE_PRIORITY[role];
  return views
    .map((view) => {
      const haystack =
        `${view.name} ${view.workbookName || ''} ${view.projectName || ''} ${view.contentUrl || ''}`
          .replace(/[-_/]+/g, ' ')
          .toLowerCase();
      const keywordHits = keywords.filter((keyword) => haystack.includes(keyword)).length;
      const priorityIndex = priorities.findIndex((phrase) => haystack.includes(phrase));
      return {
        view,
        score:
          keywordHits * 10 + (priorityIndex >= 0 ? (priorities.length - priorityIndex) * 100 : 0),
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) => right.score - left.score || left.view.name.localeCompare(right.view.name)
    )
    .map((candidate) => candidate.view);
}

export function buildTableauRoleSummary(
  role: TableauRole,
  data: TableauViewData[]
): TableauRoleSummary {
  const generatedAt = Date.now();
  if (data.length === 0) {
    return {
      ...emptySummary(role),
      generatedAt,
      summary: `No Tableau views matched the ${ROLE_LABELS[role]} role keywords. Configure dashboard names or query a view directly through V-Coworker.`,
    };
  }
  const totalRows = data.reduce((sum, item) => sum + item.totalRows, 0);
  const loadedRows = data.reduce((sum, item) => sum + item.rows.length, 0);
  const calculatedHighlights = calculateDefinedHighlights(role, data);
  const highlights = calculatedHighlights.length
    ? calculatedHighlights
    : data.slice(0, 6).map((item) => ({
        label: item.view.name,
        value: `${item.rows.length.toLocaleString('en-IN')} loaded rows`,
        sourceView: item.view.name,
        calculation: 'Coverage only; no configured KPI field matched this export',
        loadedRows: item.rows.length,
        totalRows: item.totalRows,
        truncated: item.truncated,
      }));
  return {
    role,
    title: `${ROLE_LABELS[role]} dashboard summary`,
    status: 'ready',
    summary: calculatedHighlights.length
      ? `${calculatedHighlights.length} configured KPI calculation${calculatedHighlights.length === 1 ? '' : 's'} across ${data.length} matching view${data.length === 1 ? '' : 's'}, using ${loadedRows.toLocaleString('en-IN')} loaded rows from ${totalRows.toLocaleString('en-IN')} exported rows.`
      : `${data.length} matching view${data.length === 1 ? '' : 's'} profiled across ${loadedRows.toLocaleString('en-IN')} loaded rows; no ${KPI_DEFINITION_VERSION} field alias matched, so no business KPI was inferred.`,
    generatedAt,
    stale: false,
    matchedViews: data.map((item) => item.view),
    highlights,
    definitionVersion: KPI_DEFINITION_VERSION,
    loadedRows,
    totalRows,
  };
}

class TableauService {
  private client(): TableauClient {
    const credentials = tableauStore.getCredentials();
    if (!credentials)
      throw new Error('Tableau is not configured. Save the connection password first.');
    return new TableauClient(credentials);
  }

  async getConnectionStatus(): Promise<TableauConnectionStatus> {
    const configured = tableauStore.getPublicConfig().configured;
    if (!configured) {
      return {
        configured: false,
        reachable: false,
        authenticated: false,
        checkedAt: Date.now(),
        error: 'Tableau is not configured.',
        limitation: 'Save the credentials while connected to the Tableau network or VPN.',
      };
    }
    return this.client().testConnection();
  }

  async listViews(): Promise<TableauViewInfo[]> {
    return this.client().listViews();
  }

  async getViewData(viewId: string, maxRows = 200): Promise<TableauViewData> {
    const view = (await this.listViews()).find((candidate) => candidate.id === viewId);
    if (!view) throw new Error('Tableau view not found. Refresh the available view list.');
    return this.client().getViewData(view, maxRows);
  }

  async getViewsData(viewIds: readonly string[], maxRows = 200): Promise<TableauViewData[]> {
    const normalizedIds = validateTableauViewIds(viewIds);
    const client = this.client();
    const availableViews = await client.listViews();
    const byId = new Map(availableViews.map((view) => [view.id, view]));
    const selectedViews = normalizedIds.map((id) => byId.get(id));
    const missingIds = normalizedIds.filter((_, index) => !selectedViews[index]);
    if (missingIds.length) {
      throw new Error(
        'One or more Tableau dashboards are no longer available. Refresh the view list.'
      );
    }
    return client.getViewsData(
      selectedViews.filter((view): view is TableauViewInfo => Boolean(view)),
      maxRows
    );
  }

  async analyzeQuestion(input: {
    question: string;
    role?: TableauRole;
    domain?: string;
    maxRows?: number;
  }): Promise<TableauAnalysisPlan> {
    const question = input.question?.trim();
    if (!question) throw new Error('An analytical question is required.');
    if (question.length > 4_000) throw new Error('The analytical question is too long.');
    const role = ROLES.includes(input.role || 'retail') ? input.role || 'retail' : 'retail';
    const domain = input.domain?.trim().slice(0, 80) || 'retail';
    const maxRows = Math.min(Math.max(Math.floor(input.maxRows || 500), 25), 1_000);
    const client = this.client();
    const views = await client.listViews();
    const roleMatches = matchTableauViewsForRole(role, views);
    const candidates = buildTableauCandidatePool(question, views, roleMatches, 8);
    if (!candidates.length) {
      throw new Error('No Tableau dashboards matched the analytical question.');
    }

    const discoveryData = await client.getViewsData(candidates, Math.min(maxRows, 500));
    const selection = selectTableauDatasetsForQuestion(
      question,
      discoveryData,
      MAX_TABLEAU_ANALYSIS_VIEWS
    );
    if (!selection.datasets.length) {
      throw new Error('The matched Tableau dashboards did not return readable data.');
    }
    const filtersByView = Object.fromEntries(
      selection.datasets.map((data) => [data.view.id, deriveTableauQuestionFilters(question, data)])
    );
    const hasFilters = Object.values(filtersByView).some((filters) => filters.length > 0);
    const datasets = hasFilters
      ? await client.getViewsData(
          selection.datasets.map((data) => data.view),
          maxRows,
          filtersByView
        )
      : selection.datasets.map((data) => ({
          ...data,
          rows: data.rows.slice(0, maxRows),
          truncated: data.truncated || data.rows.length > maxRows,
        }));
    const dimensionCoverage = detectTableauDimensionCoverage(datasets);
    const requested = requestedTableauDimensions(question);
    const warnings: string[] = [];
    for (const level of requested) {
      const coverage = dimensionCoverage.find((item) => item.level === level);
      if (coverage?.availability === 'configured') {
        warnings.push(
          `${coverage.label} is a governed Tableau filter, but it was not emitted as a column in the selected CSV exports.`
        );
      }
    }
    if (datasets.some((data) => data.truncated)) {
      warnings.push(
        'One or more Tableau exports were truncated to the configured analysis row limit.'
      );
    }
    return {
      question,
      role,
      domain,
      selectedViews: datasets.map((data) => data.view),
      selectionReasons: selection.reasons,
      datasets,
      appliedFilters: filtersByView,
      dimensionCoverage,
      warnings,
      generatedAt: Date.now(),
    };
  }

  async refreshSummaries(): Promise<Record<TableauRole, TableauRoleSummary>> {
    const client = this.client();
    const views = await client.listViews();
    const roleViews = Object.fromEntries(
      ROLES.map((role) => [
        role,
        matchTableauViewsForRole(role, views).slice(0, ROLE_SUMMARY_VIEW_LIMIT),
      ])
    ) as Record<TableauRole, TableauViewInfo[]>;
    const uniqueViews = [
      ...new Map(ROLES.flatMap((role) => roleViews[role]).map((view) => [view.id, view])).values(),
    ];
    const allData = await client.getViewsData(uniqueViews, 500);
    const dataByViewId = new Map(allData.map((item) => [item.view.id, item]));
    const entries = ROLES.map(
      (role) =>
        [
          role,
          buildTableauRoleSummary(
            role,
            roleViews[role].map((view) => dataByViewId.get(view.id)!).filter(Boolean)
          ),
        ] as const
    );
    const summaries = Object.fromEntries(entries) as Record<TableauRole, TableauRoleSummary>;
    tableauStore.saveSummaries(summaries);
    return summaries;
  }

  async getDashboardState(refresh = false): Promise<TableauDashboardState> {
    let connection = await this.getConnectionStatus();
    const cached = tableauStore.getSummaries();
    let summaries: Record<TableauRole, TableauRoleSummary> = Object.fromEntries(
      ROLES.map((role) => [role, cached[role] || emptySummary(role)])
    ) as Record<TableauRole, TableauRoleSummary>;
    if (refresh && connection.authenticated) {
      try {
        summaries = await this.refreshSummaries();
      } catch (error) {
        connection = {
          ...connection,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    if (!connection.authenticated) {
      summaries = Object.fromEntries(
        ROLES.map((role) => [
          role,
          {
            ...summaries[role],
            stale: summaries[role].generatedAt !== null,
            status: summaries[role].generatedAt ? summaries[role].status : 'unavailable',
            error: connection.error,
          },
        ])
      ) as Record<TableauRole, TableauRoleSummary>;
    }
    return { connection, summaries };
  }
}

export const tableauService = new TableauService();
