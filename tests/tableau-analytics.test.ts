import { describe, expect, it } from 'vitest';
import type { TableauViewData } from '../src/shared/tableau-types';
import {
  adaptTableauFiltersToColumns,
  aggregateTableauRows,
  buildTableauAnalysisPrompt,
  buildTableauForecast,
  calculateTableauMetric,
  createEmptyTableauFilters,
  filterTableauRows,
  parseTableauNumber,
  profileTableauColumns,
  selectRetailDefaultViews,
  toggleTableauViewSelection,
} from '../src/renderer/utils/tableau-analytics';
import { TABLEAU_DOMAIN_CONTEXTS } from '../src/renderer/utils/tableau-retail-context';

const rows = [
  { Date: '2026-01-01', Region: 'North', Sales: '₹1,000', Margin: '10%' },
  { Date: '2026-01-02', Region: 'South', Sales: '2,000', Margin: '20%' },
  { Date: '2026-01-03', Region: 'North', Sales: '3,000', Margin: '30%' },
];

describe('Tableau analytics helpers', () => {
  it('parses Indian-formatted, percentage and accounting numeric values safely', () => {
    expect(parseTableauNumber('₹1,23,456.50')).toBe(123456.5);
    expect(parseTableauNumber('(2,500)')).toBe(-2500);
    expect(parseTableauNumber('18.5%')).toBe(18.5);
    expect(parseTableauNumber('INV-123')).toBeNull();
  });

  it('classifies columns and applies header, value and numeric filters consistently', () => {
    expect(profileTableauColumns(Object.keys(rows[0]), rows)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Date', kind: 'date' }),
        expect.objectContaining({ name: 'Region', kind: 'text' }),
        expect.objectContaining({ name: 'Sales', kind: 'number' }),
      ])
    );
    const filters = {
      ...createEmptyTableauFilters(),
      categoryColumn: 'Region',
      categoryValue: 'North',
      metricColumn: 'Sales',
      numericMin: '1500',
    };
    expect(filterTableauRows(rows, filters)).toEqual([rows[2]]);
  });

  it('recomputes KPIs and category totals from the visible population', () => {
    const summary = calculateTableauMetric(rows, 'Sales');
    expect(summary).toMatchObject({
      rowCount: 3,
      validCount: 3,
      sum: 6000,
      average: 2000,
      median: 2000,
      minimum: 1000,
      maximum: 3000,
    });
    expect(aggregateTableauRows(rows, 'Region', 'Sales')).toEqual([
      { label: 'North', value: 4000, rowCount: 2 },
      { label: 'South', value: 2000, rowCount: 1 },
    ]);
  });

  it('labels a transparent linear estimate separately from observations', () => {
    const forecast = buildTableauForecast(rows, 'Date', 'Sales', 3);
    expect(forecast?.observedCount).toBe(3);
    expect(
      forecast?.points.filter((point) => point.kind === 'forecast').map((point) => point.value)
    ).toEqual([4000, 5000, 6000]);
    expect(forecast?.method).toContain('Least-squares linear trend');
  });

  it('builds a bounded, source-labelled dashboard chat prompt without credentials', () => {
    const data: TableauViewData = {
      view: { id: 'view-1', name: 'Daily Sales', workbookName: 'Retail MIS' },
      columns: Object.keys(rows[0]),
      rows,
      totalRows: 10_000,
      truncated: true,
    };
    const filters = { ...createEmptyTableauFilters(), metricColumn: 'Sales' };
    const inventoryData: TableauViewData = {
      view: { id: 'view-2', name: 'Store Inventory', workbookName: 'Inventory MIS' },
      columns: ['Store', 'Stock'],
      rows: [{ Store: 'Delhi', Stock: '250' }],
      totalRows: 1,
      truncated: false,
    };
    const prompt = buildTableauAnalysisPrompt({
      question: 'What changed?',
      role: 'retail',
      domain: 'planning_scm',
      datasets: [
        { data, filteredRows: rows, appliedFilters: filters },
        {
          data: inventoryData,
          filteredRows: inventoryData.rows,
          appliedFilters: adaptTableauFiltersToColumns(filters, inventoryData.columns),
        },
      ],
      activeViewId: 'view-1',
      metric: calculateTableauMetric(rows, 'Sales'),
      forecast: buildTableauForecast(rows, 'Date', 'Sales'),
    });
    expect(prompt).toContain('"viewId":"view-1"');
    expect(prompt).toContain('"viewId":"view-2"');
    expect(prompt).toContain('Selected Tableau dashboards: 2 (maximum 3)');
    expect(prompt).toContain('"loadedRows":3');
    expect(prompt).toContain('"exportRows":10000');
    expect(prompt).toContain('Planning & SCM');
    expect(prompt).toContain('festivals and festive durations only when exact event names/dates');
    expect(prompt).toContain('Analyse weather only when dated and location-matched');
    expect(prompt).toContain('Do not imply causality from correlation');
    expect(prompt).not.toMatch(/password|username|credential/i);
  });

  it('caps dashboard selection at three and allows a selected dashboard to be removed', () => {
    let selected: string[] = [];
    for (const id of ['one', 'two', 'three', 'four']) {
      selected = toggleTableauViewSelection(selected, id);
    }
    expect(selected).toEqual(['one', 'two', 'three']);
    expect(toggleTableauViewSelection(selected, 'two')).toEqual(['one', 'three']);
  });

  it('keeps Festive Performance and Business Performance as the Retail defaults', () => {
    const defaults = selectRetailDefaultViews(
      [
        { id: 'sales', name: 'Live Sales' },
        {
          id: 'cross-field-decoy',
          name: 'Plan Vs Performance',
          workbookName: 'FMCG Business Review',
        },
        { id: 'business', name: 'Business Performance' },
        { id: 'festive', name: 'Festive- Dept Performance' },
      ],
      [{ id: 'sales', name: 'Live Sales' }]
    );
    expect(defaults.map((view) => view.id)).toEqual(['festive', 'business']);
  });

  it('applies shared filters only where the selected dashboard contains compatible fields', () => {
    const filters = {
      ...createEmptyTableauFilters(),
      search: 'north',
      categoryColumn: 'Region',
      categoryValue: 'North',
      metricColumn: 'Sales',
      numericMin: '1000',
      dateColumn: 'Date',
      dateFrom: '2026-01-01',
    };
    expect(adaptTableauFiltersToColumns(filters, ['Store', 'Sales'])).toMatchObject({
      search: 'north',
      categoryColumn: '',
      categoryValue: '',
      metricColumn: 'Sales',
      numericMin: '1000',
      dateColumn: '',
      dateFrom: '',
    });
  });

  it('provides governed pre-built questions for every requested V-Mart business domain', () => {
    expect(TABLEAU_DOMAIN_CONTEXTS).toHaveLength(16);
    expect(TABLEAU_DOMAIN_CONTEXTS.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'retail',
        'zone',
        'regional_manager',
        'store_manager',
        'planning_scm',
        'warehouse_logistics',
        'finance',
        'digital_omni',
        'marketing',
        'visual_merchandising',
        'crm',
        'hr',
        'buying_merchandising',
        'sourcing',
        'loss_prevention',
      ])
    );
    expect(TABLEAU_DOMAIN_CONTEXTS.every((item) => item.questions.length === 3)).toBe(true);
  });
});
