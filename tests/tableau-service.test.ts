import { describe, expect, it } from 'vitest';
import {
  buildTableauRoleSummary,
  MAX_TABLEAU_ANALYSIS_VIEWS,
  matchTableauViewsForRole,
  validateTableauViewIds,
} from '../src/main/tableau/tableau-service';
import type { TableauViewData, TableauViewInfo } from '../src/shared/tableau-types';

function view(id: string, name: string, projectName?: string): TableauViewInfo {
  return { id, name, projectName };
}

function data(
  tableauView: TableauViewInfo,
  rows: Array<Record<string, string>>,
  totalRows = rows.length
): TableauViewData {
  return {
    view: tableauView,
    columns: rows.length ? Object.keys(rows[0]) : [],
    rows,
    totalRows,
    truncated: rows.length < totalRows,
  };
}

describe('Tableau role summaries', () => {
  it('validates and deduplicates the bounded multi-dashboard selection', () => {
    expect(MAX_TABLEAU_ANALYSIS_VIEWS).toBe(3);
    expect(validateTableauViewIds([' a ', 'b', 'a'])).toEqual(['a', 'b']);
    expect(() => validateTableauViewIds([])).toThrow('at least one');
    expect(() => validateTableauViewIds(['a', 'b', 'c', 'd'])).toThrow('no more than 3');
  });

  it('calculates only explicitly defined Retail KPIs and records provenance', () => {
    const summary = buildTableauRoleSummary('retail', [
      data(
        view('sales', 'Live Sales'),
        [
          { Store: 'Delhi', 'Net Sales': '₹1,250', 'Bill Count': '10', 'Margin %': '20%' },
          { Store: 'Mumbai', 'Net Sales': '2,750', 'Bill Count': '15', 'Margin %': '30%' },
        ],
        10
      ),
    ]);

    expect(summary).toMatchObject({
      status: 'ready',
      definitionVersion: 'vmart-role-kpi-v1',
      loadedRows: 2,
      totalRows: 10,
    });
    expect(summary.highlights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Net sales',
          value: '₹4,000',
          sourceView: 'Live Sales',
          sourceField: 'Net Sales',
          calculation: 'Sum of 2 numeric loaded rows',
          loadedRows: 2,
          totalRows: 10,
          truncated: true,
        }),
        expect.objectContaining({ label: 'Bills', value: '25' }),
        expect.objectContaining({ label: 'Margin', value: '25%' }),
      ])
    );
  });

  it('uses role-specific aliases for Merchandiser and Planner summaries', () => {
    const merchandiser = buildTableauRoleSummary('merchandiser', [
      data(view('sell-through', 'Weekly Category Scorecard'), [
        { 'Sell Through %': '40%', 'Stock Ageing Days': '60' },
        { 'Sell Through %': '50%', 'Stock Ageing Days': '90' },
      ]),
    ]);
    const planner = buildTableauRoleSummary('planner', [
      data(view('otb', 'OTB'), [
        { 'OTB Value': '1,00,000', 'Weeks Cover': '4' },
        { 'OTB Value': '50,000', 'Weeks Cover': '6' },
      ]),
    ]);

    expect(merchandiser.highlights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Sell-through', value: '45%' }),
        expect.objectContaining({ label: 'Stock age', value: '75 days' }),
      ])
    );
    expect(planner.highlights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Open to buy', value: '₹1,50,000' }),
        expect.objectContaining({ label: 'Stock cover', value: '5 days' }),
      ])
    );
  });

  it('reports coverage without inventing a KPI when no configured alias matches', () => {
    const summary = buildTableauRoleSummary('retail', [
      data(view('unknown', 'Retail Detail'), [{ Region: 'North', Mystery: '999' }], 25),
    ]);

    expect(summary.summary).toContain('no vmart-role-kpi-v1 field alias matched');
    expect(summary.highlights).toEqual([
      expect.objectContaining({
        label: 'Retail Detail',
        value: '1 loaded rows',
        calculation: 'Coverage only; no configured KPI field matched this export',
        totalRows: 25,
        truncated: true,
      }),
    ]);
  });

  it('orders role-matched views by configured priority and excludes unrelated views', () => {
    const views = [
      view('generic', 'Retail Sales'),
      view('priority', 'Live Sales'),
      view('business', 'Business Performance'),
      view('festive', 'Festive Performance'),
      view('unrelated', 'HR Attendance'),
    ];

    expect(matchTableauViewsForRole('retail', views).map((item) => item.id)).toEqual([
      'festive',
      'business',
      'priority',
      'generic',
    ]);
  });
});
