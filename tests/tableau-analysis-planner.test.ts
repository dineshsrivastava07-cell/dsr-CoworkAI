import { describe, expect, it } from 'vitest';
import type { TableauViewData, TableauViewInfo } from '../src/shared/tableau-types';
import {
  buildTableauCandidatePool,
  deriveTableauQuestionFilters,
  detectTableauDimensionCoverage,
  requestedTableauDimensions,
  selectTableauDatasetsForQuestion,
} from '../src/main/tableau/tableau-analysis-planner';

function view(id: string, name: string, workbookName?: string): TableauViewInfo {
  return { id, name, workbookName };
}

function data(tableauView: TableauViewInfo, rows: Record<string, string>[]): TableauViewData {
  return {
    view: tableauView,
    columns: rows[0] ? Object.keys(rows[0]) : [],
    rows,
    totalRows: rows.length,
    truncated: false,
  };
}

describe('Tableau autonomous analysis planner', () => {
  it('ranks question-relevant dashboards and keeps the selection bounded', () => {
    const views = [
      view('festive', 'Festive Performance'),
      view('business', 'Business Performance'),
      view('store', 'Store Sales Performance'),
      view('inventory', 'Inventory Ageing'),
    ];
    const pool = buildTableauCandidatePool(
      'Which stores have the weakest sales performance by region?',
      views,
      views,
      3
    );
    expect(pool).toHaveLength(3);
    expect(pool[0].id).toBe('store');
  });

  it('selects data that adds requested geographic coverage', () => {
    const selected = selectTableauDatasetsForQuestion(
      'Compare sales by State, Zone, Region and Store',
      [
        data(view('business', 'Business Performance'), [{ State_Name: 'UP', Sales: '100' }]),
        data(view('region', 'Regional Sales'), [{ Region: 'North', Zone: 'North', Sales: '90' }]),
        data(view('store', 'Store Sales'), [{ 'Store Name': 'Lucknow 1', Sales: '80' }]),
        data(view('other', 'Sales'), [{ Category: 'Men', Sales: '70' }]),
      ]
    );
    expect(selected.datasets.map((item) => item.view.id)).toEqual(
      expect.arrayContaining(['business', 'region', 'store'])
    );
    expect(selected.datasets).toHaveLength(3);
  });

  it('recognises Tableau captions and exact user-mentioned filter values', () => {
    const tableauData = data(view('geo', 'Geography Performance'), [
      {
        'ATTR(State Name)': 'Uttar Pradesh',
        Zone_Name: 'North',
        '[Region]': 'UP East',
        'Store Name': 'Lucknow One',
        Sales: '100',
      },
    ]);
    const coverage = detectTableauDimensionCoverage([tableauData]);
    expect(coverage.map((item) => [item.level, item.availability])).toEqual([
      ['state', 'observed'],
      ['zone', 'observed'],
      ['region', 'observed'],
      ['store', 'observed'],
    ]);
    expect(
      deriveTableauQuestionFilters(
        'Show Uttar Pradesh, North, UP East and Lucknow One performance',
        tableauData
      )
    ).toEqual(
      expect.arrayContaining([
        { field: 'ATTR(State Name)', values: ['Uttar Pradesh'] },
        { field: 'Zone_Name', values: ['North'] },
        { field: '[Region]', values: ['UP East'] },
        { field: 'Store Name', values: ['Lucknow One'] },
      ])
    );
  });

  it('reports governed filters as configured rather than unavailable when CSV omits them', () => {
    const coverage = detectTableauDimensionCoverage([
      data(view('festive', 'Festive Performance'), [{ Date: '2026-10-20', Sales: '100' }]),
    ]);
    expect(coverage.every((item) => item.available)).toBe(true);
    expect(coverage.every((item) => item.availability === 'configured')).toBe(true);
    expect(requestedTableauDimensions('State-wise and store-wise sales')).toEqual([
      'state',
      'store',
    ]);
  });
});
