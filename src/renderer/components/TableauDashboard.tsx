import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Bot,
  CalendarRange,
  ChevronDown,
  ExternalLink,
  Filter,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Shirt,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  TableProperties,
  TrendingUp,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type {
  TableauConfigInput,
  TableauConfigPublic,
  TableauAnalysisPlan,
  TableauDashboardState,
  TableauRole,
  TableauViewData,
  TableauViewInfo,
} from '../../shared/tableau-types';
import { useIPC } from '../hooks/useIPC';
import { useAppStore } from '../store';
import {
  adaptTableauFiltersToColumns,
  aggregateTableauRows,
  buildTableauAnalysisPrompt,
  buildTableauForecast,
  calculateTableauMetric,
  createEmptyTableauFilters,
  detectTableauGeographyCoverage,
  filterTableauRows,
  profileTableauColumns,
  selectRetailDefaultViews,
  summarizeTableauFilters,
  toggleTableauViewSelection,
  MAX_TABLEAU_SELECTED_VIEWS,
  type TableauAggregatePoint,
  type TableauFilters,
  type TableauForecast,
} from '../utils/tableau-analytics';
import {
  getTableauDomainContext,
  TABLEAU_CROSS_DOMAIN_QUESTIONS,
  TABLEAU_DOMAIN_CONTEXTS,
  type TableauBusinessDomain,
} from '../utils/tableau-retail-context';
import { MessageMarkdown } from './MessageMarkdown';

const ROLE_META: Record<
  TableauRole,
  { label: string; description: string; icon: typeof ShoppingBag }
> = {
  retail: {
    label: 'Retail',
    description: 'Sales, stores, revenue, bills, footfall and margin views',
    icon: ShoppingBag,
  },
  merchandiser: {
    label: 'Merchandiser',
    description: 'Assortment, styles, sell-through, markdown and ageing views',
    icon: Shirt,
  },
  planner: {
    label: 'Planner',
    description: 'Plan, budget, forecast, OTB, cover and allocation views',
    icon: CalendarRange,
  },
};

const ROLES = Object.keys(ROLE_META) as TableauRole[];
interface DashboardChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

const inputClass =
  'mt-1 w-full rounded-lg border border-border-muted bg-background px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent disabled:opacity-50';

function formatTime(value: number | null): string {
  return value
    ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(value)
    : 'Not refreshed yet';
}

function formatMetric(value: number | null, column: string, semanticLabel = ''): string {
  if (value === null || !Number.isFinite(value)) return '—';
  // Tableau commonly exports heterogeneous metrics as `Measure Names` +
  // `Measure Values`. Format those values from the measure name rather than
  // treating every value in the generic numeric column as currency.
  const semantic = (semanticLabel || column).toLocaleLowerCase();
  if (/%|percent|percentage|rate|margin/.test(semantic)) {
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value) + '%';
  }
  if (
    /sales|revenue|amount|mrp|price|cost|budget|otb|gmv|turnover|\batv\b|\basp\b/.test(semantic)
  ) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
      notation: Math.abs(value) >= 10_000_000 ? 'compact' : 'standard',
    }).format(value);
  }
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2,
    notation: Math.abs(value) >= 10_000_000 ? 'compact' : 'standard',
  }).format(value);
}

function viewLabel(view: TableauViewInfo): string {
  return (view.workbookName ? view.workbookName + ' · ' : '') + view.name;
}

function EmptyAnalysis({ text }: { text: string }) {
  return (
    <div className="min-h-36 flex items-center justify-center rounded-xl border border-dashed border-border-muted bg-background/40 px-6 text-center text-xs text-text-muted">
      {text}
    </div>
  );
}

function KpiCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-background/70 p-3 min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted truncate">
        {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold text-text-primary truncate" title={value}>
        {value}
      </div>
      <div className="mt-1 text-[10px] text-text-muted truncate" title={note}>
        {note}
      </div>
    </div>
  );
}

function BarList({
  points,
  metricColumn,
}: {
  points: TableauAggregatePoint[];
  metricColumn: string;
}) {
  const maximum = Math.max(...points.map((point) => Math.abs(point.value)), 1);
  if (!points.length)
    return <EmptyAnalysis text="Choose a grouping field to compare categories." />;
  return (
    <div className="space-y-3" aria-label="Top category comparison">
      {points.map((point) => (
        <div
          key={point.label}
          className="grid grid-cols-[minmax(90px,0.8fr)_2fr_auto] gap-3 items-center"
        >
          <div className="text-xs text-text-secondary truncate" title={point.label}>
            {point.label}
          </div>
          <div className="h-2.5 rounded-full bg-background overflow-hidden">
            <div
              className={'h-full rounded-full ' + (point.value < 0 ? 'bg-danger' : 'bg-accent')}
              style={{ width: Math.max(2, (Math.abs(point.value) / maximum) * 100) + '%' }}
              title={point.label + ': ' + formatMetric(point.value, metricColumn, point.label)}
            />
          </div>
          <div className="text-xs tabular-nums text-text-primary text-right">
            {formatMetric(point.value, metricColumn, point.label)}
          </div>
        </div>
      ))}
      <p className="text-[10px] text-text-muted">
        Bar length shows absolute magnitude from zero; labels retain the signed value.
      </p>
    </div>
  );
}

function TrendChart({
  forecast,
  metricColumn,
}: {
  forecast: TableauForecast | null;
  metricColumn: string;
}) {
  if (!forecast) {
    return (
      <EmptyAnalysis text="Select a date and numeric metric with at least three observed dates." />
    );
  }
  const width = 640;
  const height = 210;
  const padding = 26;
  const values = forecast.points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const x = (index: number) =>
    padding + (index / Math.max(forecast.points.length - 1, 1)) * (width - padding * 2);
  const y = (value: number) =>
    height - padding - ((value - minimum) / range) * (height - padding * 2);
  const observed = forecast.points.slice(0, forecast.observedCount);
  const projected = forecast.points.slice(Math.max(0, forecast.observedCount - 1));
  const coordinates = (points: typeof forecast.points, offset: number) =>
    points.map((point, index) => x(index + offset) + ',' + y(point.value)).join(' ');
  return (
    <div>
      <svg
        viewBox={'0 0 ' + width + ' ' + height}
        role="img"
        aria-label={metricColumn + ' observed trend and three-period linear estimate'}
        className="w-full h-52"
      >
        <line
          x1={padding}
          y1={padding}
          x2={padding}
          y2={height - padding}
          className="stroke-border-muted"
        />
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          className="stroke-border-muted"
        />
        <polyline
          points={coordinates(observed, 0)}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-accent"
        />
        <polyline
          points={coordinates(projected, forecast.observedCount - 1)}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray="8 6"
          className="text-warning"
        />
        {forecast.points.map((point, index) => (
          <circle
            key={point.timestamp + '-' + point.kind}
            cx={x(index)}
            cy={y(point.value)}
            r="4"
            className={point.kind === 'forecast' ? 'fill-warning' : 'fill-accent'}
          >
            <title>
              {(point.kind === 'forecast' ? 'Estimated ' : 'Observed ') +
                point.label +
                ': ' +
                formatMetric(point.value, metricColumn)}
            </title>
          </circle>
        ))}
        <text x={padding} y="14" className="fill-text-muted text-[10px]">
          {formatMetric(maximum, metricColumn)}
        </text>
        <text x={padding} y={height - 5} className="fill-text-muted text-[10px]">
          {formatMetric(minimum, metricColumn)}
        </text>
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-text-muted">
        <span>
          <span className="text-accent">Solid: observed</span> ·{' '}
          <span className="text-warning">Dashed: derived estimate</span>
        </span>
        <span>{forecast.method}</span>
      </div>
    </div>
  );
}

export function TableauDashboard() {
  const { startSession, continueSession } = useIPC();
  const [config, setConfig] = useState<TableauConfigPublic | null>(null);
  const [form, setForm] = useState<TableauConfigInput>({
    baseUrl: 'http://10.0.0.55:8000',
    username: '',
    password: '',
    siteContentUrl: '',
    apiVersion: '3.27',
  });
  const [state, setState] = useState<TableauDashboardState | null>(null);
  const [views, setViews] = useState<TableauViewInfo[]>([]);
  const [viewSearch, setViewSearch] = useState('');
  const [activeRole, setActiveRole] = useState<TableauRole>('retail');
  const [selectedViewIds, setSelectedViewIds] = useState<string[]>([]);
  const [activeViewId, setActiveViewId] = useState('');
  const [viewDataSet, setViewDataSet] = useState<TableauViewData[]>([]);
  const [analysisDomain, setAnalysisDomain] = useState<TableauBusinessDomain>('retail');
  const [filters, setFilters] = useState<TableauFilters>(createEmptyTableauFilters);
  const [groupColumn, setGroupColumn] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewBusy, setViewBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [dashboardMessages, setDashboardMessages] = useState<DashboardChatMessage[]>([]);
  const [analysisPlan, setAnalysisPlan] = useState<TableauAnalysisPlan | null>(null);
  const seenAssistantIds = useRef(new Set<string>());

  const chatSessionState = useAppStore((store) =>
    chatSessionId ? store.sessionStates[chatSessionId] : undefined
  );
  const chatSession = useAppStore((store) =>
    chatSessionId ? store.sessions.find((session) => session.id === chatSessionId) : undefined
  );

  const configureActiveView = (data: TableauViewData) => {
    const profiles = profileTableauColumns(data.columns, data.rows);
    const numberColumn = profiles.find((profile) => profile.kind === 'number')?.name || '';
    const dateColumn = profiles.find((profile) => profile.kind === 'date')?.name || '';
    const dimensionColumn =
      profiles.find(
        (profile) =>
          profile.kind === 'text' && profile.distinctCount > 1 && profile.distinctCount <= 100
      )?.name ||
      profiles.find((profile) => profile.kind === 'text')?.name ||
      '';
    setVisibleColumns(data.columns.slice(0, 8));
    setFilters({
      ...createEmptyTableauFilters(),
      categoryColumn: dimensionColumn,
      metricColumn: numberColumn,
      dateColumn,
    });
    setGroupColumn(dimensionColumn);
  };

  const loadViews = async (viewIds: string[], preferredActiveViewId?: string) => {
    if (!viewIds.length) {
      setViewDataSet([]);
      setActiveViewId('');
      return;
    }
    setViewBusy(true);
    setMessage(null);
    try {
      const data = await window.electronAPI.tableau.getViewsData(viewIds, 1_000);
      const nextActiveId =
        (preferredActiveViewId && data.some((item) => item.view.id === preferredActiveViewId)
          ? preferredActiveViewId
          : data[0]?.view.id) || '';
      setViewDataSet(data);
      setActiveViewId(nextActiveId);
      const activeData = data.find((item) => item.view.id === nextActiveId);
      if (activeData) configureActiveView(activeData);
    } catch (error) {
      setViewDataSet([]);
      setMessage(error instanceof Error ? error.message : 'Could not load the Tableau view.');
    } finally {
      setViewBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.electronAPI.tableau.getConfig(),
      window.electronAPI.tableau.getDashboardState(false),
      window.electronAPI.tableau.listViews().catch(() => []),
    ]).then(([loadedConfig, loadedState, loadedViews]) => {
      if (cancelled) return;
      setConfig(loadedConfig);
      setForm({
        baseUrl: loadedConfig.baseUrl,
        username: loadedConfig.username,
        password: '',
        siteContentUrl: loadedConfig.siteContentUrl,
        apiVersion: loadedConfig.apiVersion,
      });
      setState(loadedState);
      setShowConfig(!loadedConfig.configured);
      const cachedViews = ROLES.flatMap((role) => loadedState.summaries[role].matchedViews);
      const availableViews = [
        ...new Map([...loadedViews, ...cachedViews].map((view) => [view.id, view])).values(),
      ];
      setViews(availableViews);
      const initialViews = selectRetailDefaultViews(
        availableViews,
        loadedState.summaries.retail.matchedViews
      );
      if (initialViews.length && loadedState.connection.authenticated) {
        const initialIds = initialViews.map((view) => view.id);
        setSelectedViewIds(initialIds);
        setActiveViewId(initialIds[0]);
        void loadViews(initialIds, initialIds[0]);
      }
    });
    return () => {
      cancelled = true;
    };
    // The initial load is intentionally mount-only; later view loads are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!chatSessionState) return;
    const additions: DashboardChatMessage[] = [];
    for (const item of chatSessionState.messages) {
      if (item.role !== 'assistant' || seenAssistantIds.current.has(item.id)) continue;
      const text = item.content
        .filter(
          (block): block is Extract<(typeof item.content)[number], { type: 'text' }> =>
            block.type === 'text'
        )
        .map((block) => block.text)
        .join('\n\n')
        .trim();
      if (text) additions.push({ id: item.id, role: 'assistant', text });
      seenAssistantIds.current.add(item.id);
    }
    if (additions.length) setDashboardMessages((current) => [...current, ...additions]);
  }, [chatSessionState]);

  const refresh = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await window.electronAPI.tableau.refreshSummaries();
      setState(next);
      if (next.connection.authenticated) setViews(await window.electronAPI.tableau.listViews());
      setMessage(
        next.connection.authenticated
          ? 'Tableau summaries and view catalogue refreshed.'
          : next.connection.error || 'Refresh failed.'
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Refresh failed.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.electronAPI.tableau.saveConfig(form);
      if (!result.success || !result.config) throw new Error(result.error || 'Save failed.');
      setConfig(result.config);
      setForm((current) => ({ ...current, password: '' }));
      const next = await window.electronAPI.tableau.getDashboardState(false);
      setState(next);
      setMessage(
        next.connection.authenticated
          ? 'Connection saved and verified.'
          : next.connection.error || 'Connection saved.'
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const selectRole = (role: TableauRole) => {
    setActiveRole(role);
    const matchedViews = state?.summaries[role].matchedViews || [];
    const recommendedViews =
      role === 'retail' ? selectRetailDefaultViews(views, matchedViews) : matchedViews.slice(0, 1);
    if (recommendedViews.length && state?.connection.authenticated) {
      const nextIds = [
        ...recommendedViews.map((view) => view.id),
        ...selectedViewIds.filter(
          (id) => !recommendedViews.some((recommended) => recommended.id === id)
        ),
      ].slice(0, MAX_TABLEAU_SELECTED_VIEWS);
      setSelectedViewIds(nextIds);
      void loadViews(nextIds, recommendedViews[0].id);
    }
  };

  const activeViewData =
    viewDataSet.find((item) => item.view.id === activeViewId) || viewDataSet[0] || null;

  const profiles = useMemo(
    () => profileTableauColumns(activeViewData?.columns || [], activeViewData?.rows || []),
    [activeViewData]
  );
  const numberColumns = profiles.filter((profile) => profile.kind === 'number');
  const dateColumns = profiles.filter((profile) => profile.kind === 'date');
  const dimensionColumns = profiles.filter((profile) => profile.kind === 'text');
  const categoryValues = useMemo(() => {
    if (!activeViewData || !filters.categoryColumn) return [];
    return [
      ...new Set(activeViewData.rows.map((row) => row[filters.categoryColumn]).filter(Boolean)),
    ]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 500);
  }, [activeViewData, filters.categoryColumn]);
  const filteredRows = useMemo(
    () => filterTableauRows(activeViewData?.rows || [], filters),
    [activeViewData, filters]
  );
  const metric = useMemo(
    () => calculateTableauMetric(filteredRows, filters.metricColumn),
    [filteredRows, filters.metricColumn]
  );
  const aggregates = useMemo(
    () => aggregateTableauRows(filteredRows, groupColumn, filters.metricColumn, 10),
    [filteredRows, groupColumn, filters.metricColumn]
  );
  const forecast = useMemo(
    () => buildTableauForecast(filteredRows, filters.dateColumn, filters.metricColumn, 3),
    [filteredRows, filters.dateColumn, filters.metricColumn]
  );
  const activeFilters = summarizeTableauFilters(filters);
  const summary = state?.summaries[activeRole];
  const connected = Boolean(state?.connection.authenticated);
  const filteredViews = views.filter((view) =>
    viewLabel(view).toLocaleLowerCase().includes(viewSearch.trim().toLocaleLowerCase())
  );
  const selectedViews = selectedViewIds
    .map((id) => views.find((view) => view.id === id))
    .filter((view): view is TableauViewInfo => Boolean(view));
  const selectedView = views.find((view) => view.id === activeViewId);
  const isChatRunning = chatSession?.status === 'running' || Boolean(chatSessionState?.activeTurn);
  const geographyCoverage =
    analysisPlan?.dimensionCoverage || detectTableauGeographyCoverage(viewDataSet);

  useEffect(() => {
    const target = window as unknown as {
      __getTableauDashboardStatus?: () => Record<string, unknown>;
    };
    target.__getTableauDashboardStatus = () => ({
      mounted: true,
      configured: Boolean(config?.configured),
      authenticated: Boolean(state?.connection.authenticated),
      viewCount: views.length,
      selectedViewCount: selectedViewIds.length,
      selectedViewIds,
      selectedViewId: activeViewId || null,
      selectedViewName: activeViewData?.view.name || selectedView?.name || null,
      loadedRows: activeViewData?.rows.length || 0,
      totalRows: activeViewData?.totalRows || 0,
      truncated: Boolean(activeViewData?.truncated),
      activeRole,
      analysisDomain,
      roleSummaryStatus: summary?.status || null,
      roleHighlightCount: summary?.highlights.length || 0,
      roleDefinitionVersion: summary?.definitionVersion || null,
      dimensionCoverage: geographyCoverage,
      autonomousSelection: Boolean(analysisPlan),
      chatSessionId,
      chatRunning: isChatRunning,
    });
    return () => {
      delete target.__getTableauDashboardStatus;
    };
  }, [
    activeRole,
    activeViewData,
    activeViewId,
    analysisDomain,
    chatSessionId,
    config?.configured,
    isChatRunning,
    selectedView,
    selectedViewIds,
    state?.connection.authenticated,
    summary,
    geographyCoverage,
    analysisPlan,
    views.length,
  ]);

  const askQuestion = async (requestedQuestion?: string) => {
    const text = (requestedQuestion || question).trim();
    if (!text || isChatRunning) return;
    setViewBusy(true);
    setMessage('V-Coworker is selecting and reading the most relevant Tableau dashboards…');
    let plan: TableauAnalysisPlan;
    try {
      plan = await window.electronAPI.tableau.analyzeQuestion({
        question: text,
        role: activeRole,
        domain: analysisDomain,
        maxRows: 1_000,
      });
      setAnalysisPlan(plan);
      setViews((current) => [
        ...new Map([...current, ...plan.selectedViews].map((view) => [view.id, view])).values(),
      ]);
      const selectedIds = plan.selectedViews.map((view) => view.id);
      setSelectedViewIds(selectedIds);
      setViewDataSet(plan.datasets);
      const nextActive = plan.datasets[0];
      if (!nextActive) throw new Error('No readable Tableau dashboard data was returned.');
      setActiveViewId(nextActive.view.id);
      configureActiveView(nextActive);
      setMessage(
        `Autonomously selected ${selectedIds.length} dashboard${selectedIds.length === 1 ? '' : 's'} and reconciled State, Zone, Region and Store coverage.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not prepare Tableau analysis.');
      return;
    } finally {
      setViewBusy(false);
    }
    const promptDatasets = plan.datasets.map((data) => {
      const sourceFilters = plan.appliedFilters[data.view.id] || [];
      const appliedFilters = adaptTableauFiltersToColumns(filters, data.columns);
      return {
        data,
        appliedFilters,
        sourceFilters,
        filteredRows: data.rows,
      };
    });
    const plannedActive = plan.datasets[0];
    const plannedProfiles = profileTableauColumns(plannedActive.columns, plannedActive.rows);
    const plannedMetricColumn =
      plannedProfiles.find((profile) => profile.kind === 'number')?.name || '';
    const plannedDateColumn =
      plannedProfiles.find((profile) => profile.kind === 'date')?.name || '';
    const plannedMetric = calculateTableauMetric(plannedActive.rows, plannedMetricColumn);
    const plannedForecast = buildTableauForecast(
      plannedActive.rows,
      plannedDateColumn,
      plannedMetricColumn,
      3
    );
    const prompt = buildTableauAnalysisPrompt({
      question: text,
      role: activeRole,
      domain: analysisDomain,
      datasets: promptDatasets,
      activeViewId: plannedActive.view.id,
      metric: plannedMetric,
      forecast: plannedForecast,
      dimensionCoverage: plan.dimensionCoverage,
      selectionReasons: plan.selectionReasons,
      warnings: plan.warnings,
    });
    setDashboardMessages((current) => [
      ...current,
      { id: 'dashboard-user-' + Date.now(), role: 'user', text },
    ]);
    setQuestion('');
    if (chatSessionId) {
      await continueSession(chatSessionId, prompt);
      return;
    }
    const session = await startSession(
      'Tableau analysis · ' + getTableauDomainContext(analysisDomain).label,
      prompt
    );
    if (session) setChatSessionId(session.id);
  };

  const resetFilters = () => {
    const dimensionColumn = dimensionColumns[0]?.name || '';
    setFilters({
      ...createEmptyTableauFilters(),
      categoryColumn: dimensionColumn,
      metricColumn: numberColumns[0]?.name || '',
      dateColumn: dateColumns[0]?.name || '',
    });
    setGroupColumn(dimensionColumn);
  };

  const toggleSelectedView = (viewId: string) => {
    const wasSelected = selectedViewIds.includes(viewId);
    const nextIds = toggleTableauViewSelection(selectedViewIds, viewId);
    if (!wasSelected && nextIds.length === selectedViewIds.length) {
      setMessage(`Select no more than ${MAX_TABLEAU_SELECTED_VIEWS} dashboards at a time.`);
      return;
    }
    setSelectedViewIds(nextIds);
    const preferredActiveId = wasSelected
      ? nextIds.includes(activeViewId)
        ? activeViewId
        : nextIds[0]
      : viewId;
    void loadViews(nextIds, preferredActiveId);
  };

  const activateView = (viewId: string) => {
    const data = viewDataSet.find((item) => item.view.id === viewId);
    if (!data) return;
    setActiveViewId(viewId);
    configureActiveView(data);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background">
      <div className="mx-auto max-w-[1500px] px-4 lg:px-6 py-6 space-y-4">
        <DashboardHeader
          busy={busy}
          configured={Boolean(config?.configured)}
          onToggleConfig={() => setShowConfig((value) => !value)}
          onRefresh={refresh}
        />
        <ConnectionBanner
          connected={connected}
          config={config}
          state={state}
          viewData={activeViewData}
          selectedCount={selectedViewIds.length}
        />
        {showConfig && (
          <ConnectionForm config={config} form={form} setForm={setForm} busy={busy} onSave={save} />
        )}
        {message && (
          <div className="rounded-xl border border-border-muted bg-surface/50 px-4 py-3 text-sm text-text-secondary">
            {message}
          </div>
        )}
        <RoleSelector state={state} activeRole={activeRole} onSelect={selectRole} />
        <ViewSelector
          connected={connected}
          busy={viewBusy}
          views={filteredViews}
          viewSearch={viewSearch}
          selectedViewIds={selectedViewIds}
          selectedViews={selectedViews}
          activeViewId={activeViewId}
          totalViewCount={views.length}
          summary={summary}
          onSearch={setViewSearch}
          onToggle={toggleSelectedView}
          onActivate={activateView}
        />
        <DimensionCoveragePanel coverage={geographyCoverage} autonomous={Boolean(analysisPlan)} />
        {viewBusy ? (
          <div className="min-h-72 rounded-2xl border border-border-muted bg-surface/50 flex items-center justify-center gap-3 text-sm text-text-secondary">
            <Loader2 className="w-5 h-5 animate-spin text-accent" /> Exporting bounded Tableau data…
          </div>
        ) : !activeViewData ? (
          <SummaryFallback summary={summary} role={activeRole} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px] items-start">
            <div className="space-y-4 min-w-0">
              <FilterPanel
                filters={filters}
                setFilters={setFilters}
                dimensionColumns={dimensionColumns.map((column) => column.name)}
                numberColumns={numberColumns.map((column) => column.name)}
                dateColumns={dateColumns.map((column) => column.name)}
                categoryValues={categoryValues}
                activeFilters={activeFilters}
                filteredCount={filteredRows.length}
                loadedCount={activeViewData.rows.length}
                onReset={resetFilters}
              />
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  label="Visible records"
                  value={metric.rowCount.toLocaleString('en-IN')}
                  note={
                    activeViewData.truncated
                      ? 'Loaded sample of ' +
                        activeViewData.totalRows.toLocaleString('en-IN') +
                        ' exported rows'
                      : 'Complete exported view'
                  }
                />
                <KpiCard
                  label={'Sum · ' + (filters.metricColumn || 'metric')}
                  value={formatMetric(metric.sum, filters.metricColumn)}
                  note={metric.validCount.toLocaleString('en-IN') + ' valid numeric values'}
                />
                <KpiCard
                  label={'Average · ' + (filters.metricColumn || 'metric')}
                  value={formatMetric(metric.average, filters.metricColumn)}
                  note="Arithmetic mean of visible numeric values"
                />
                <KpiCard
                  label={'Median · ' + (filters.metricColumn || 'metric')}
                  value={formatMetric(metric.median, filters.metricColumn)}
                  note={
                    'Range ' +
                    formatMetric(metric.minimum, filters.metricColumn) +
                    ' to ' +
                    formatMetric(metric.maximum, filters.metricColumn)
                  }
                />
              </section>
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-2xl border border-border-muted bg-surface/50 p-4 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-accent" />
                      <h2 className="text-sm font-semibold text-text-primary">
                        Category comparison
                      </h2>
                    </div>
                    <select
                      aria-label="Group chart by"
                      value={groupColumn}
                      onChange={(event) => setGroupColumn(event.target.value)}
                      className="max-w-[220px] rounded-lg border border-border-muted bg-background px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
                    >
                      <option value="">Choose grouping</option>
                      {dimensionColumns.map((column) => (
                        <option key={column.name} value={column.name}>
                          {column.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <BarList points={aggregates} metricColumn={filters.metricColumn} />
                </section>
                <section className="rounded-2xl border border-border-muted bg-surface/50 p-4 min-w-0">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-accent" />
                      <h2 className="text-sm font-semibold text-text-primary">
                        Observed trend + estimate
                      </h2>
                    </div>
                    {forecast && (
                      <span className="text-[10px] text-warning uppercase tracking-wider">
                        Derived forecast
                      </span>
                    )}
                  </div>
                  <TrendChart forecast={forecast} metricColumn={filters.metricColumn} />
                </section>
              </div>
              <RecordsTable
                data={activeViewData}
                rows={filteredRows}
                visibleColumns={visibleColumns}
                setVisibleColumns={setVisibleColumns}
              />
            </div>
            <ChatPanel
              question={question}
              setQuestion={setQuestion}
              messages={dashboardMessages}
              partialMessage={chatSessionState?.partialMessage || ''}
              busy={isChatRunning}
              onAsk={askQuestion}
              domain={analysisDomain}
              onDomainChange={setAnalysisDomain}
              selectedViews={selectedViews}
              sourceLabel={selectedView ? viewLabel(selectedView) : activeViewData.view.name}
              visibleCount={filteredRows.length}
              data={activeViewData}
              dataSet={viewDataSet}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function DimensionCoveragePanel({
  coverage,
  autonomous,
}: {
  coverage: TableauAnalysisPlan['dimensionCoverage'];
  autonomous: boolean;
}) {
  return (
    <section className="rounded-2xl border border-border-muted bg-surface/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Geographic analysis coverage</h2>
          <p className="mt-1 text-[11px] text-text-muted">
            State, Zone, Region and Store are governed Tableau filters. Exported fields are detected
            across every selected dashboard.
          </p>
        </div>
        {autonomous && (
          <span className="rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold text-accent">
            Autonomous selection active
          </span>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {coverage.map((item) => (
          <div
            key={item.level}
            className="rounded-xl border border-border-subtle bg-background/65 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-text-primary">{item.label}</span>
              <span className="text-[10px] font-semibold text-success">Available</span>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-text-muted">
              {item.availability === 'observed'
                ? `Observed in ${item.fields.length} selected dashboard field${item.fields.length === 1 ? '' : 's'}.`
                : 'Configured Tableau filter; the current CSV export did not emit the field.'}
            </p>
            {item.fields[0]?.sampleValues.length > 0 && (
              <p
                className="mt-1 text-[10px] text-text-secondary truncate"
                title={item.fields[0].sampleValues.join(', ')}
              >
                {item.fields[0].sampleValues.slice(0, 3).join(', ')}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function DashboardHeader({
  busy,
  configured,
  onToggleConfig,
  onRefresh,
}: {
  busy: boolean;
  configured: boolean;
  onToggleConfig: () => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 text-accent text-[11px] font-semibold uppercase tracking-[0.16em]">
          <Sparkles className="w-4 h-4" /> V-Coworker AI Analytics
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">
          Tableau analytical workspace
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Explore observed data, apply shared filters, calculate metrics, estimate trends and ask
          V-Coworker.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggleConfig}
          className="h-9 px-3 rounded-xl border border-border-muted text-[13px] text-text-secondary hover:bg-surface-hover flex items-center gap-2"
        >
          <SlidersHorizontal className="w-4 h-4" /> Connection
        </button>
        <button
          type="button"
          onClick={() => void window.electronAPI.tableau.open()}
          className="h-9 px-3 rounded-xl border border-border-muted text-[13px] text-text-secondary hover:bg-surface-hover flex items-center gap-2"
        >
          <ExternalLink className="w-4 h-4" /> Open Tableau
        </button>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={busy || !configured}
          className="h-9 px-3 rounded-xl bg-accent text-white text-[13px] font-medium disabled:opacity-50 flex items-center gap-2"
        >
          <RefreshCw className={'w-4 h-4 ' + (busy ? 'animate-spin' : '')} /> Refresh
        </button>
      </div>
    </header>
  );
}

function ConnectionBanner({
  connected,
  config,
  state,
  viewData,
  selectedCount,
}: {
  connected: boolean;
  config: TableauConfigPublic | null;
  state: TableauDashboardState | null;
  viewData: TableauViewData | null;
  selectedCount: number;
}) {
  return (
    <div
      className={
        'rounded-xl border px-4 py-3 flex items-center gap-3 ' +
        (connected ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5')
      }
    >
      {connected ? (
        <Wifi className="w-5 h-5 text-success" />
      ) : (
        <WifiOff className="w-5 h-5 text-warning" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-text-primary">
          {connected ? 'Live Tableau access available' : 'Cached summaries only'}
        </div>
        <div className="text-xs text-text-secondary truncate">
          {connected
            ? (config?.baseUrl || '') +
              (state?.connection.siteName ? ' · ' + state.connection.siteName : '')
            : state?.connection.error || 'Connect to the VPN/local Tableau network, then refresh.'}
        </div>
      </div>
      {viewData && (
        <div className="hidden md:block text-right text-[10px] text-text-muted">
          <div>
            {selectedCount} dashboard{selectedCount === 1 ? '' : 's'} selected ·{' '}
            {viewData.rows.length.toLocaleString('en-IN')} active rows
          </div>
          <div>
            {viewData.truncated
              ? 'of ' + viewData.totalRows.toLocaleString('en-IN') + ' exported'
              : 'complete export'}
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectionForm({
  config,
  form,
  setForm,
  busy,
  onSave,
}: {
  config: TableauConfigPublic | null;
  form: TableauConfigInput;
  setForm: (form: TableauConfigInput) => void;
  busy: boolean;
  onSave: () => Promise<void>;
}) {
  return (
    <section className="rounded-2xl border border-border-muted bg-surface/60 p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-xs text-text-secondary">
          Server URL
          <input
            value={form.baseUrl}
            onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
            className={inputClass}
          />
        </label>
        <label className="text-xs text-text-secondary">
          Username
          <input
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
            className={inputClass}
          />
        </label>
        <label className="text-xs text-text-secondary">
          Password {config?.hasPassword ? '(leave blank to keep saved password)' : ''}
          <input
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            className={inputClass}
          />
        </label>
        <label className="text-xs text-text-secondary">
          Site content URL (blank for Default)
          <input
            value={form.siteContentUrl || ''}
            onChange={(event) => setForm({ ...form, siteContentUrl: event.target.value })}
            className={inputClass}
          />
        </label>
      </div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-xs text-text-muted">
          Credentials remain encrypted in the main process and are never sent in chat prompts or MCP
          tool inputs.
        </p>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={busy}
          className="h-9 px-4 rounded-xl bg-text-primary text-background text-[13px] font-medium disabled:opacity-50 flex items-center gap-2"
        >
          <Save className="w-4 h-4" /> Save & test
        </button>
      </div>
    </section>
  );
}

function RoleSelector({
  state,
  activeRole,
  onSelect,
}: {
  state: TableauDashboardState | null;
  activeRole: TableauRole;
  onSelect: (role: TableauRole) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {ROLES.map((role) => {
        const meta = ROLE_META[role];
        const Icon = meta.icon;
        const item = state?.summaries[role];
        const statusClass = item?.stale
          ? 'text-warning'
          : item?.status === 'ready'
            ? 'text-success'
            : 'text-text-muted';
        return (
          <button
            key={role}
            type="button"
            onClick={() => onSelect(role)}
            className={
              'rounded-2xl border p-4 text-left transition-colors ' +
              (activeRole === role
                ? 'border-accent bg-accent-muted/10'
                : 'border-border-muted bg-surface/50 hover:bg-surface-hover')
            }
          >
            <div className="flex items-center justify-between">
              <Icon className="w-5 h-5 text-accent" />
              <span className={'text-[10px] uppercase tracking-wider ' + statusClass}>
                {item?.stale ? 'Cached' : item?.status || 'Waiting'}
              </span>
            </div>
            <div className="mt-3 text-sm font-semibold text-text-primary">{meta.label}</div>
            <div className="mt-1 text-xs leading-5 text-text-muted">{meta.description}</div>
          </button>
        );
      })}
    </div>
  );
}

function ViewSelector({
  connected,
  busy,
  views,
  viewSearch,
  selectedViewIds,
  selectedViews,
  activeViewId,
  totalViewCount,
  summary,
  onSearch,
  onToggle,
  onActivate,
}: {
  connected: boolean;
  busy: boolean;
  views: TableauViewInfo[];
  viewSearch: string;
  selectedViewIds: string[];
  selectedViews: TableauViewInfo[];
  activeViewId: string;
  totalViewCount: number;
  summary: TableauDashboardState['summaries'][TableauRole] | undefined;
  onSearch: (value: string) => void;
  onToggle: (value: string) => void;
  onActivate: (value: string) => void;
}) {
  const atLimit = selectedViewIds.length >= MAX_TABLEAU_SELECTED_VIEWS;
  return (
    <section className="rounded-2xl border border-border-muted bg-surface/50 p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[280px]">
          <label className="text-[11px] font-medium text-text-muted">
            Available views ({totalViewCount.toLocaleString('en-IN')}) · select up to{' '}
            {MAX_TABLEAU_SELECTED_VIEWS}
          </label>
          <input
            value={viewSearch}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search workbook or view…"
            className={inputClass}
          />
          <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-border-muted bg-background/60 divide-y divide-border-subtle">
            {views.map((view) => (
              <div
                key={view.id}
                className={
                  'flex items-center gap-2 px-3 py-2 text-xs ' +
                  (view.id === activeViewId ? 'bg-accent/10' : '')
                }
              >
                <input
                  type="checkbox"
                  checked={selectedViewIds.includes(view.id)}
                  disabled={!connected || busy || (atLimit && !selectedViewIds.includes(view.id))}
                  onChange={() => onToggle(view.id)}
                  aria-label={`Select ${viewLabel(view)} for V-Coworker`}
                  className="h-4 w-4 accent-accent"
                />
                <button
                  type="button"
                  disabled={!selectedViewIds.includes(view.id) || busy}
                  onClick={() => onActivate(view.id)}
                  className="min-w-0 flex-1 truncate text-left text-text-secondary disabled:opacity-60"
                  title={viewLabel(view)}
                >
                  {viewLabel(view)}
                </button>
                {view.id === activeViewId && (
                  <span className="text-[9px] uppercase tracking-wider text-accent">Active</span>
                )}
              </div>
            ))}
            {!views.length && (
              <div className="px-3 py-4 text-center text-xs text-text-muted">
                No views match this search.
              </div>
            )}
          </div>
        </div>
        <div className="min-w-[280px] flex-1">
          <div className="flex items-center justify-between text-[11px] text-text-muted">
            <span>Selected for V-Coworker</span>
            <span className={atLimit ? 'text-warning' : 'text-text-secondary'}>
              {selectedViewIds.length}/{MAX_TABLEAU_SELECTED_VIEWS}
            </span>
          </div>
          <div className="mt-2 min-h-12 space-y-2">
            {selectedViewIds.map((id) => {
              const view = selectedViews.find((candidate) => candidate.id === id);
              if (!view) return null;
              return (
                <div
                  key={id}
                  className="flex items-center gap-2 rounded-lg border border-border-subtle bg-background px-3 py-2 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => onActivate(id)}
                    className="min-w-0 flex-1 truncate text-left text-text-primary"
                    title={viewLabel(view)}
                  >
                    {viewLabel(view)}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onToggle(id)}
                    className="text-text-muted hover:text-danger disabled:opacity-50"
                    aria-label={`Remove ${viewLabel(view)}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {!selectedViewIds.length && (
              <div className="rounded-lg border border-dashed border-border-muted px-3 py-4 text-center text-xs text-text-muted">
                Tick one to three dashboards for analysis.
              </div>
            )}
          </div>
        </div>
        <div className="text-right text-[10px] text-text-muted pt-1">
          <div>{summary?.stale ? 'Role summary cached' : 'Role summary refreshed'}</div>
          <div className="text-text-secondary">{formatTime(summary?.generatedAt || null)}</div>
        </div>
      </div>
    </section>
  );
}

function SummaryFallback({
  summary,
  role,
}: {
  summary: TableauDashboardState['summaries'][TableauRole] | undefined;
  role: TableauRole;
}) {
  return (
    <section className="rounded-2xl border border-border-muted bg-surface/50 p-6">
      <div className="flex items-center gap-3 text-text-primary">
        <LayoutDashboard className="w-5 h-5 text-accent" />
        <h2 className="font-semibold">{summary?.title || ROLE_META[role].label}</h2>
      </div>
      <p className="mt-2 text-sm text-text-secondary">
        {summary?.summary || 'Choose a Tableau view while connected to start live analysis.'}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(summary?.highlights || []).map((highlight, index) => (
          <KpiCard
            key={highlight.label + '-' + index}
            label={highlight.label}
            value={highlight.value}
            note={[
              highlight.sourceView ? 'Source: ' + highlight.sourceView : 'Cached role summary',
              highlight.sourceField ? 'Field: ' + highlight.sourceField : '',
              highlight.calculation || '',
              highlight.loadedRows !== undefined && highlight.totalRows !== undefined
                ? `${highlight.loadedRows.toLocaleString('en-IN')} loaded / ${highlight.totalRows.toLocaleString('en-IN')} exported${highlight.truncated ? ' (truncated)' : ''}`
                : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        ))}
      </div>
    </section>
  );
}

function FilterPanel({
  filters,
  setFilters,
  dimensionColumns,
  numberColumns,
  dateColumns,
  categoryValues,
  activeFilters,
  filteredCount,
  loadedCount,
  onReset,
}: {
  filters: TableauFilters;
  setFilters: (filters: TableauFilters) => void;
  dimensionColumns: string[];
  numberColumns: string[];
  dateColumns: string[];
  categoryValues: string[];
  activeFilters: string[];
  filteredCount: number;
  loadedCount: number;
  onReset: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border-muted bg-surface/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-semibold text-text-primary">Shared analysis filters</h2>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="text-[10px] font-medium text-text-muted">
          Search all data points
          <input
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            placeholder="Contains…"
            className={inputClass}
          />
        </label>
        <label className="text-[10px] font-medium text-text-muted">
          Header / dimension
          <select
            value={filters.categoryColumn}
            onChange={(event) =>
              setFilters({ ...filters, categoryColumn: event.target.value, categoryValue: '' })
            }
            className={inputClass}
          >
            <option value="">No category filter</option>
            {dimensionColumns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-medium text-text-muted">
          Data point / value
          <select
            value={filters.categoryValue}
            disabled={!filters.categoryColumn}
            onChange={(event) => setFilters({ ...filters, categoryValue: event.target.value })}
            className={inputClass}
          >
            <option value="">All values</option>
            {categoryValues.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-medium text-text-muted">
          Metric header
          <select
            value={filters.metricColumn}
            onChange={(event) =>
              setFilters({
                ...filters,
                metricColumn: event.target.value,
                numericMin: '',
                numericMax: '',
              })
            }
            className={inputClass}
          >
            <option value="">No numeric metric</option>
            {numberColumns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-medium text-text-muted">
          Minimum
          <input
            inputMode="decimal"
            value={filters.numericMin}
            disabled={!filters.metricColumn}
            onChange={(event) => setFilters({ ...filters, numericMin: event.target.value })}
            className={inputClass}
          />
        </label>
        <label className="text-[10px] font-medium text-text-muted">
          Maximum
          <input
            inputMode="decimal"
            value={filters.numericMax}
            disabled={!filters.metricColumn}
            onChange={(event) => setFilters({ ...filters, numericMax: event.target.value })}
            className={inputClass}
          />
        </label>
        <label className="text-[10px] font-medium text-text-muted">
          Date header
          <select
            value={filters.dateColumn}
            onChange={(event) =>
              setFilters({ ...filters, dateColumn: event.target.value, dateFrom: '', dateTo: '' })
            }
            className={inputClass}
          >
            <option value="">No date filter</option>
            {dateColumns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] font-medium text-text-muted">
            From
            <input
              type="date"
              value={filters.dateFrom}
              disabled={!filters.dateColumn}
              onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })}
              className={inputClass + ' px-2 text-[10px]'}
            />
          </label>
          <label className="text-[10px] font-medium text-text-muted">
            To
            <input
              type="date"
              value={filters.dateTo}
              disabled={!filters.dateColumn}
              onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })}
              className={inputClass + ' px-2 text-[10px]'}
            />
          </label>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-text-muted">
        <span className="rounded-full bg-background border border-border-subtle px-2.5 py-1">
          {filteredCount.toLocaleString('en-IN')} visible / {loadedCount.toLocaleString('en-IN')}{' '}
          loaded
        </span>
        {activeFilters.map((filter) => (
          <span
            key={filter}
            className="rounded-full bg-accent-muted/10 border border-accent/20 px-2.5 py-1 text-accent"
          >
            {filter}
          </span>
        ))}
      </div>
    </section>
  );
}

function RecordsTable({
  data,
  rows,
  visibleColumns,
  setVisibleColumns,
}: {
  data: TableauViewData;
  rows: Record<string, string>[];
  visibleColumns: string[];
  setVisibleColumns: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  return (
    <section className="rounded-2xl border border-border-muted bg-surface/50 min-w-0 overflow-hidden">
      <div className="p-4 flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <TableProperties className="w-4 h-4 text-accent" />
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Supporting records</h2>
            <p className="text-[10px] text-text-muted mt-0.5">
              Exact values from the same filtered population as cards and charts
            </p>
          </div>
        </div>
        <details className="relative">
          <summary className="list-none cursor-pointer rounded-lg border border-border-muted bg-background px-3 py-2 text-xs text-text-secondary flex items-center gap-2">
            Headers ({visibleColumns.length}/{data.columns.length}){' '}
            <ChevronDown className="w-3.5 h-3.5" />
          </summary>
          <div className="absolute right-0 z-20 mt-2 w-72 max-h-72 overflow-auto rounded-xl border border-border-muted bg-surface p-3 shadow-xl">
            {data.columns.map((column) => (
              <label
                key={column}
                className="flex items-center gap-2 py-1.5 text-xs text-text-secondary"
              >
                <input
                  type="checkbox"
                  checked={visibleColumns.includes(column)}
                  onChange={(event) =>
                    setVisibleColumns((current) =>
                      event.target.checked
                        ? [...current, column]
                        : current.filter((item) => item !== column)
                    )
                  }
                  className="accent-accent"
                />
                <span className="truncate" title={column}>
                  {column}
                </span>
              </label>
            ))}
          </div>
        </details>
      </div>
      <div className="overflow-auto max-h-[420px]">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              {visibleColumns.map((column) => (
                <th
                  key={column}
                  className="whitespace-nowrap border-b border-border-muted px-3 py-2.5 font-semibold text-text-secondary"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-b border-border-subtle/60 hover:bg-surface-hover"
              >
                {visibleColumns.map((column) => (
                  <td
                    key={column}
                    className="max-w-64 whitespace-nowrap truncate px-3 py-2 text-text-secondary"
                    title={row[column] || ''}
                  >
                    {row[column] || <span className="text-text-muted">Blank</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="p-8 text-center text-sm text-text-muted">
            No records match the current filters. This is an empty selection, not a measured zero.
          </div>
        )}
      </div>
      {rows.length > 100 && (
        <div className="border-t border-border-subtle px-4 py-2 text-[10px] text-text-muted">
          Showing first 100 of {rows.length.toLocaleString('en-IN')} visible loaded records.
        </div>
      )}
    </section>
  );
}

function ChatPanel({
  question,
  setQuestion,
  messages,
  partialMessage,
  busy,
  onAsk,
  domain,
  onDomainChange,
  selectedViews,
  sourceLabel,
  visibleCount,
  data,
  dataSet,
}: {
  question: string;
  setQuestion: (question: string) => void;
  messages: DashboardChatMessage[];
  partialMessage: string;
  busy: boolean;
  onAsk: (question?: string) => Promise<void>;
  domain: TableauBusinessDomain;
  onDomainChange: (domain: TableauBusinessDomain) => void;
  selectedViews: TableauViewInfo[];
  sourceLabel: string;
  visibleCount: number;
  data: TableauViewData;
  dataSet: TableauViewData[];
}) {
  const domainContext = getTableauDomainContext(domain);
  const quickQuestions = [...domainContext.questions, ...TABLEAU_CROSS_DOMAIN_QUESTIONS];
  const totalLoadedRows = dataSet.reduce((sum, item) => sum + item.rows.length, 0);
  return (
    <aside className="rounded-2xl border border-border-muted bg-surface/70 xl:sticky xl:top-4 overflow-hidden">
      <div className="p-4 border-b border-border-subtle bg-gradient-to-br from-accent/10 to-transparent">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-accent" />
          <h2 className="text-sm font-semibold text-text-primary">Ask V-Coworker</h2>
        </div>
        <p className="mt-1.5 text-xs leading-5 text-text-muted">
          Ask across up to three selected dashboards. Compatible filters, bounded source rows,
          calculations and coverage travel with each question.
        </p>
      </div>
      <div className="h-[440px] overflow-y-auto p-4 space-y-3" aria-live="polite">
        {!messages.length && (
          <div className="rounded-xl border border-dashed border-border-muted bg-background/50 p-4 text-xs leading-5 text-text-muted">
            Questions are answered by the configured V-Coworker model. It can use the read-only
            Tableau MCP for more detail and must state coverage and limitations.
          </div>
        )}
        {messages.map((item) => (
          <div
            key={item.id}
            className={
              'rounded-xl px-3 py-2.5 text-xs leading-5 ' +
              (item.role === 'user'
                ? 'ml-7 bg-accent text-white'
                : 'mr-3 border border-border-subtle bg-background text-text-primary')
            }
          >
            {item.role === 'assistant' ? (
              <MessageMarkdown normalizedText={item.text} />
            ) : (
              <p className="whitespace-pre-wrap">{item.text}</p>
            )}
          </div>
        ))}
        {partialMessage && (
          <div className="mr-3 rounded-xl border border-border-subtle bg-background px-3 py-2.5 text-xs">
            <MessageMarkdown normalizedText={partialMessage} isStreaming />
          </div>
        )}
        {busy && !partialMessage && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analysing the current filtered
            population…
          </div>
        )}
      </div>
      <div className="p-4 border-t border-border-subtle space-y-3">
        <label className="block text-[10px] font-medium uppercase tracking-wider text-text-muted">
          Decision domain
          <select
            value={domain}
            disabled={busy}
            onChange={(event) => onDomainChange(event.target.value as TableauBusinessDomain)}
            className={inputClass}
          >
            {TABLEAU_DOMAIN_CONTEXTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {quickQuestions.map((item) => (
            <button
              key={item}
              type="button"
              disabled={busy}
              onClick={() => void onAsk(item)}
              className="rounded-full border border-border-muted px-2.5 py-1 text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-hover disabled:opacity-50"
            >
              {item.split(' ').slice(0, 5).join(' ')}…
            </button>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onAsk();
          }}
          className="flex items-end gap-2"
        >
          <label className="sr-only" htmlFor="tableau-question">
            Ask about this dashboard
          </label>
          <textarea
            id="tableau-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void onAsk();
              }
            }}
            rows={2}
            placeholder="Ask about any data point or calculation…"
            className="min-h-[62px] flex-1 resize-none rounded-xl border border-border-muted bg-background px-3 py-2 text-xs text-text-primary outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={!question.trim() || busy}
            className="h-10 w-10 shrink-0 rounded-xl bg-accent text-white flex items-center justify-center disabled:opacity-50"
            aria-label="Send dashboard question"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        <div className="text-[10px] text-text-muted">
          <span className="font-medium text-text-secondary">Active:</span> {sourceLabel} ·{' '}
          {visibleCount.toLocaleString('en-IN')} visible active rows
          {data.truncated ? ' of ' + data.totalRows.toLocaleString('en-IN') + ' exported' : ''}
          <div className="mt-1">
            {selectedViews.length} selected dashboard{selectedViews.length === 1 ? '' : 's'} ·{' '}
            {totalLoadedRows.toLocaleString('en-IN')} total loaded rows · {domainContext.label}
          </div>
        </div>
      </div>
    </aside>
  );
}
