import type {
  TableauDimensionCoverage,
  TableauRole,
  TableauViewData,
  TableauViewFilter,
  TableauViewInfo,
} from '../../shared/tableau-types';
import { getTableauDomainContext, type TableauBusinessDomain } from './tableau-retail-context';

export const MAX_TABLEAU_SELECTED_VIEWS = 3;

export type TableauColumnKind = 'number' | 'date' | 'text';

export interface TableauColumnProfile {
  name: string;
  kind: TableauColumnKind;
  nonEmptyCount: number;
  numericCount: number;
  dateCount: number;
  distinctCount: number;
}

export interface TableauFilters {
  search: string;
  categoryColumn: string;
  categoryValue: string;
  metricColumn: string;
  numericMin: string;
  numericMax: string;
  dateColumn: string;
  dateFrom: string;
  dateTo: string;
}

export interface TableauMetricSummary {
  rowCount: number;
  validCount: number;
  sum: number | null;
  average: number | null;
  minimum: number | null;
  maximum: number | null;
  median: number | null;
}

export interface TableauAggregatePoint {
  label: string;
  value: number;
  rowCount: number;
}

export interface TableauForecastPoint {
  timestamp: number;
  label: string;
  value: number;
  kind: 'observed' | 'forecast';
}

export interface TableauForecast {
  points: TableauForecastPoint[];
  observedCount: number;
  horizon: number;
  intervalDays: number;
  method: string;
}

const EMPTY_FILTERS: TableauFilters = {
  search: '',
  categoryColumn: '',
  categoryValue: '',
  metricColumn: '',
  numericMin: '',
  numericMax: '',
  dateColumn: '',
  dateFrom: '',
  dateTo: '',
};

export function createEmptyTableauFilters(): TableauFilters {
  return { ...EMPTY_FILTERS };
}

export function toggleTableauViewSelection(
  selectedViewIds: readonly string[],
  viewId: string,
  maximum = MAX_TABLEAU_SELECTED_VIEWS
): string[] {
  const unique = [...new Set(selectedViewIds.filter(Boolean))];
  if (unique.includes(viewId)) return unique.filter((id) => id !== viewId);
  if (!viewId || unique.length >= maximum) return unique;
  return [...unique, viewId];
}

export function selectRetailDefaultViews(
  availableViews: readonly TableauViewInfo[],
  fallbackViews: readonly TableauViewInfo[] = []
): TableauViewInfo[] {
  const allViews = [
    ...new Map([...availableViews, ...fallbackViews].map((view) => [view.id, view])).values(),
  ];
  const searchableParts = (view: TableauViewInfo) =>
    [view.name, view.workbookName || '', view.projectName || ''].map((value) =>
      value.replace(/[-_/]+/g, ' ').toLocaleLowerCase()
    );
  const preferredMatchers = [
    (parts: string[]) =>
      parts.some((value) => /\b(festive|festival)\b/.test(value) && value.includes('performance')),
    (parts: string[]) =>
      parts.some((value) => value.includes('business') && value.includes('performance')),
  ];
  const selected: TableauViewInfo[] = [];
  for (const matches of preferredMatchers) {
    const match = allViews.find(
      (view) =>
        !selected.some((selectedView) => selectedView.id === view.id) &&
        matches(searchableParts(view))
    );
    if (match) selected.push(match);
  }
  for (const view of fallbackViews) {
    if (selected.length >= 2) break;
    if (!selected.some((selectedView) => selectedView.id === view.id)) selected.push(view);
  }
  if (!selected.length && allViews[0]) selected.push(allViews[0]);
  return selected.slice(0, 2);
}

export function adaptTableauFiltersToColumns(
  filters: TableauFilters,
  columns: readonly string[]
): TableauFilters {
  const available = new Set(columns);
  return {
    ...filters,
    categoryColumn: available.has(filters.categoryColumn) ? filters.categoryColumn : '',
    categoryValue: available.has(filters.categoryColumn) ? filters.categoryValue : '',
    metricColumn: available.has(filters.metricColumn) ? filters.metricColumn : '',
    numericMin: available.has(filters.metricColumn) ? filters.numericMin : '',
    numericMax: available.has(filters.metricColumn) ? filters.numericMax : '',
    dateColumn: available.has(filters.dateColumn) ? filters.dateColumn : '',
    dateFrom: available.has(filters.dateColumn) ? filters.dateFrom : '',
    dateTo: available.has(filters.dateColumn) ? filters.dateTo : '',
  };
}

export function parseTableauNumber(value: string | null | undefined): number | null {
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

export function parseTableauDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized || !(/[-/]/.test(normalized) || /[A-Za-z]{3,}/.test(normalized))) return null;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function profileTableauColumns(
  columns: string[],
  rows: Record<string, string>[]
): TableauColumnProfile[] {
  return columns.map((name) => {
    const values = rows.map((row) => row[name]?.trim()).filter((value): value is string => !!value);
    const numericCount = values.filter((value) => parseTableauNumber(value) !== null).length;
    const dateCount = values.filter((value) => parseTableauDate(value) !== null).length;
    const threshold = Math.max(1, Math.ceil(values.length * 0.8));
    const kind: TableauColumnKind =
      numericCount >= threshold ? 'number' : dateCount >= threshold ? 'date' : 'text';
    return {
      name,
      kind,
      nonEmptyCount: values.length,
      numericCount,
      dateCount,
      distinctCount: new Set(values).size,
    };
  });
}

export function filterTableauRows(
  rows: Record<string, string>[],
  filters: TableauFilters
): Record<string, string>[] {
  const query = filters.search.trim().toLocaleLowerCase();
  const min = parseTableauNumber(filters.numericMin);
  const max = parseTableauNumber(filters.numericMax);
  const from = filters.dateFrom ? Date.parse(`${filters.dateFrom}T00:00:00`) : null;
  const to = filters.dateTo ? Date.parse(`${filters.dateTo}T23:59:59.999`) : null;

  return rows.filter((row) => {
    if (query && !Object.values(row).some((value) => value.toLocaleLowerCase().includes(query))) {
      return false;
    }
    if (
      filters.categoryColumn &&
      filters.categoryValue &&
      row[filters.categoryColumn] !== filters.categoryValue
    ) {
      return false;
    }
    if (filters.metricColumn && (min !== null || max !== null)) {
      const value = parseTableauNumber(row[filters.metricColumn]);
      if (value === null || (min !== null && value < min) || (max !== null && value > max)) {
        return false;
      }
    }
    if (filters.dateColumn && (from !== null || to !== null)) {
      const value = parseTableauDate(row[filters.dateColumn]);
      if (value === null || (from !== null && value < from) || (to !== null && value > to)) {
        return false;
      }
    }
    return true;
  });
}

export function calculateTableauMetric(
  rows: Record<string, string>[],
  metricColumn: string
): TableauMetricSummary {
  const values = metricColumn
    ? rows
        .map((row) => parseTableauNumber(row[metricColumn]))
        .filter((value): value is number => value !== null)
    : [];
  if (!values.length) {
    return {
      rowCount: rows.length,
      validCount: 0,
      sum: null,
      average: null,
      minimum: null,
      maximum: null,
      median: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    rowCount: rows.length,
    validCount: values.length,
    sum,
    average: sum / values.length,
    minimum: sorted[0],
    maximum: sorted[sorted.length - 1],
    median: sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
  };
}

export function aggregateTableauRows(
  rows: Record<string, string>[],
  dimensionColumn: string,
  metricColumn: string,
  limit = 10
): TableauAggregatePoint[] {
  if (!dimensionColumn) return [];
  const groups = new Map<string, { value: number; rowCount: number }>();
  for (const row of rows) {
    const label = row[dimensionColumn]?.trim() || 'Blank';
    const current = groups.get(label) || { value: 0, rowCount: 0 };
    const metric = metricColumn ? parseTableauNumber(row[metricColumn]) : 1;
    current.rowCount += 1;
    if (metric !== null) current.value += metric;
    groups.set(label, current);
  }
  return [...groups.entries()]
    .map(([label, value]) => ({ label, ...value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, Math.max(1, limit));
}

function formatForecastDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  }).format(timestamp);
}

export function buildTableauForecast(
  rows: Record<string, string>[],
  dateColumn: string,
  metricColumn: string,
  horizon = 3
): TableauForecast | null {
  if (!dateColumn || !metricColumn) return null;
  const grouped = new Map<number, number>();
  for (const row of rows) {
    const timestamp = parseTableauDate(row[dateColumn]);
    const metric = parseTableauNumber(row[metricColumn]);
    if (timestamp === null || metric === null) continue;
    const day = new Date(timestamp);
    day.setHours(0, 0, 0, 0);
    grouped.set(day.getTime(), (grouped.get(day.getTime()) || 0) + metric);
  }
  const observed = [...grouped.entries()].sort((a, b) => a[0] - b[0]);
  if (observed.length < 3) return null;

  const intervals = observed.slice(1).map((point, index) => point[0] - observed[index][0]);
  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  const interval = sortedIntervals[Math.floor(sortedIntervals.length / 2)] || 86_400_000;
  const xMean = (observed.length - 1) / 2;
  const yMean = observed.reduce((total, point) => total + point[1], 0) / observed.length;
  const numerator = observed.reduce(
    (total, point, index) => total + (index - xMean) * (point[1] - yMean),
    0
  );
  const denominator = observed.reduce((total, _point, index) => total + (index - xMean) ** 2, 0);
  const slope = denominator ? numerator / denominator : 0;
  const intercept = yMean - slope * xMean;
  const safeHorizon = Math.min(Math.max(Math.floor(horizon), 1), 12);
  const lastTimestamp = observed[observed.length - 1][0];
  const points: TableauForecastPoint[] = observed.map(([timestamp, value]) => ({
    timestamp,
    label: formatForecastDate(timestamp),
    value,
    kind: 'observed',
  }));
  for (let index = 1; index <= safeHorizon; index += 1) {
    const timestamp = lastTimestamp + interval * index;
    points.push({
      timestamp,
      label: formatForecastDate(timestamp),
      value: intercept + slope * (observed.length - 1 + index),
      kind: 'forecast',
    });
  }
  return {
    points,
    observedCount: observed.length,
    horizon: safeHorizon,
    intervalDays: Math.max(1, Math.round(interval / 86_400_000)),
    method: 'Least-squares linear trend over date-level sums in the visible filtered rows',
  };
}

export function summarizeTableauFilters(filters: TableauFilters): string[] {
  const parts: string[] = [];
  if (filters.search.trim()) parts.push(`contains “${filters.search.trim()}”`);
  if (filters.categoryColumn && filters.categoryValue) {
    parts.push(`${filters.categoryColumn} = ${filters.categoryValue}`);
  }
  if (filters.metricColumn && (filters.numericMin || filters.numericMax)) {
    parts.push(
      `${filters.metricColumn} between ${filters.numericMin || '-∞'} and ${filters.numericMax || '+∞'}`
    );
  }
  if (filters.dateColumn && (filters.dateFrom || filters.dateTo)) {
    parts.push(
      `${filters.dateColumn} from ${filters.dateFrom || 'earliest'} to ${filters.dateTo || 'latest'}`
    );
  }
  return parts;
}

export interface TableauAnalysisDataset {
  data: TableauViewData;
  filteredRows: Record<string, string>[];
  appliedFilters: TableauFilters;
  sourceFilters?: TableauViewFilter[];
}

export function detectTableauGeographyCoverage(
  datasets: readonly TableauViewData[]
): TableauDimensionCoverage[] {
  const definitions = [
    { level: 'state' as const, label: 'State', aliases: /\bstate\b/i },
    { level: 'zone' as const, label: 'Zone', aliases: /\bzone\b/i },
    { level: 'region' as const, label: 'Region', aliases: /\bregion\b/i },
    { level: 'store' as const, label: 'Store', aliases: /\bstore\b/i },
  ];
  const normalize = (value: string) =>
    value
      .replace(/\b(?:attr|sum|avg|average|min|max|count|countd|agg)\s*\(([^)]+)\)/gi, '$1')
      .replace(/[()[\]{}_\-/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return definitions.map((definition) => {
    const fields = datasets.flatMap((data) =>
      data.columns
        .filter((column) => definition.aliases.test(normalize(column)))
        .map((field) => ({
          viewId: data.view.id,
          viewName: data.view.name,
          field,
          sampleValues: [
            ...new Set(data.rows.map((row) => row[field]?.trim()).filter(Boolean)),
          ].slice(0, 8),
          source: 'export' as const,
        }))
    );
    return fields.length
      ? {
          level: definition.level,
          label: definition.label,
          available: true,
          availability: 'observed' as const,
          fields,
        }
      : {
          level: definition.level,
          label: definition.label,
          available: true,
          availability: 'configured' as const,
          fields: [
            {
              field: definition.label,
              sampleValues: [],
              source: 'governed-filter' as const,
            },
          ],
        };
  });
}

export function buildTableauAnalysisPrompt(input: {
  question: string;
  role: TableauRole;
  domain: TableauBusinessDomain;
  datasets: TableauAnalysisDataset[];
  activeViewId: string;
  metric: TableauMetricSummary;
  forecast: TableauForecast | null;
  dimensionCoverage?: TableauDimensionCoverage[];
  selectionReasons?: Record<string, string[]>;
  warnings?: string[];
}): string {
  const {
    question,
    role,
    domain,
    datasets,
    activeViewId,
    metric,
    forecast,
    dimensionCoverage = detectTableauGeographyCoverage(datasets.map((item) => item.data)),
    selectionReasons = {},
    warnings = [],
  } = input;
  const selected = datasets.slice(0, MAX_TABLEAU_SELECTED_VIEWS);
  const domainContext = getTableauDomainContext(domain);
  const sources = selected.map(({ data, filteredRows, appliedFilters, sourceFilters }, index) => {
    const sampleColumns = data.columns.slice(0, 15);
    const sampleRows = filteredRows
      .slice(0, 12)
      .map((row) => Object.fromEntries(sampleColumns.map((column) => [column, row[column] ?? ''])));
    const filterSummary = [
      ...summarizeTableauFilters(appliedFilters),
      ...(sourceFilters || []).map((filter) => `${filter.field} = ${filter.values.join(', ')}`),
    ];
    return {
      sourceNumber: index + 1,
      activeWorkspace: data.view.id === activeViewId,
      viewId: data.view.id,
      source: `${data.view.workbookName ? `${data.view.workbookName} / ` : ''}${data.view.name}`,
      autonomousSelectionReasons: selectionReasons[data.view.id] || [],
      loadedRows: data.rows.length,
      exportRows: data.totalRows,
      truncated: data.truncated,
      visibleFilteredRows: filteredRows.length,
      appliedFilters: filterSummary.length ? filterSummary : ['none'],
      columnsIncluded: sampleColumns,
      sampleRows,
    };
  });
  return [
    'You are the V-Coworker AI analyst embedded in the Tableau analytics dashboard.',
    `Answer this ${role} user question for the ${domainContext.label} domain: ${question}`,
    '',
    'Decision context and constraints:',
    `- Domain focus: ${domainContext.focus}`,
    `- Selected Tableau dashboards: ${selected.length} (maximum ${MAX_TABLEAU_SELECTED_VIEWS})`,
    `- Active visual workspace view ID: ${activeViewId}`,
    `- Visible metric calculation: ${JSON.stringify(metric)}`,
    `- Forecast: ${forecast ? JSON.stringify({ method: forecast.method, horizon: forecast.horizon, intervalDays: forecast.intervalDays, points: forecast.points.filter((point) => point.kind === 'forecast') }) : 'unavailable'}`,
    `- State/Zone/Region/Store coverage: ${JSON.stringify(dimensionCoverage)}`,
    `- Planner warnings: ${warnings.length ? JSON.stringify(warnings) : 'none'}`,
    '',
    'Analysis protocol:',
    '- Use filters and relevant data points from every selected source. Compare or combine sources only when metric definitions, date ranges, dimensions, units and grain are compatible.',
    '- Analyse season and trend from observed date fields. Analyse festivals and festive durations only when exact event names/dates or a governed calendar are present; otherwise request that calendar.',
    '- Analyse weather only when dated and location-matched weather observations are present. Never infer weather conditions from geography or season alone.',
    '- Segment by available Indian state, zone, region, store, community and catchment fields. Treat coverage marked configured as a governed Tableau filter that was not emitted as an export column; do not call it unavailable.',
    '- Separate observed facts, calculations, hypotheses, recommendations and missing evidence. Do not imply causality from correlation.',
    '- Recommendations are advisory. Do not claim that ERP, pricing, stock, workforce or campaign actions were executed.',
    '- State dashboard provenance, exact filters, row coverage, truncation and confidence for each important finding. Never invent V-Mart definitions or internal processes.',
    '- Use the Tableau MCP read-only tools with the supplied view IDs if more source detail is needed.',
    '',
    'Selected source packets (bounded samples):',
    JSON.stringify(sources),
  ].join('\n');
}
