import * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTableauBrokerRequestHandler } from '../src/main/tableau/tableau-broker';
import { tableauService } from '../src/main/tableau/tableau-service';

const SECRET = 'tableau-test-secret';
const AUTHORIZATION = { Authorization: `Bearer ${SECRET}` };

function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(createTableauBrokerRequestHandler(SECRET));
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('No broker address'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('Tableau broker', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    const started = await startServer();
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterEach(async () => {
    await closeServer(server);
    vi.restoreAllMocks();
  });

  it('rejects unauthenticated requests without reaching Tableau', async () => {
    const statusSpy = vi.spyOn(tableauService, 'getConnectionStatus');
    const response = await fetch(`${baseUrl}/tableau/status`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
    expect(statusSpy).not.toHaveBeenCalled();
  });

  it('forwards status, view listing, bounded view data, summaries, and refresh', async () => {
    const connection = {
      configured: true,
      reachable: true,
      authenticated: true,
      checkedAt: 1,
    };
    const view = { id: 'view-1', name: 'Live Sales' };
    const summary = {
      role: 'retail' as const,
      title: 'Retail dashboard summary',
      status: 'ready' as const,
      summary: 'One KPI',
      generatedAt: 1,
      stale: false,
      matchedViews: [view],
      highlights: [],
    };
    vi.spyOn(tableauService, 'getConnectionStatus').mockResolvedValue(connection);
    vi.spyOn(tableauService, 'listViews').mockResolvedValue([view]);
    const dataSpy = vi.spyOn(tableauService, 'getViewData').mockResolvedValue({
      view,
      columns: ['Net Sales'],
      rows: [{ 'Net Sales': '100' }],
      totalRows: 1,
      truncated: false,
    });
    vi.spyOn(tableauService, 'getDashboardState').mockResolvedValue({
      connection,
      summaries: { retail: summary, merchandiser: summary, planner: summary },
    });
    const refreshSpy = vi
      .spyOn(tableauService, 'refreshSummaries')
      .mockResolvedValue({ retail: summary, merchandiser: summary, planner: summary });
    const analysisSpy = vi.spyOn(tableauService, 'analyzeQuestion').mockResolvedValue({
      question: 'Compare store sales by state',
      role: 'retail',
      domain: 'retail',
      selectedViews: [view],
      selectionReasons: { 'view-1': ['matched'] },
      datasets: [],
      appliedFilters: {},
      dimensionCoverage: [],
      warnings: [],
      generatedAt: 1,
    });

    const statusResponse = await fetch(`${baseUrl}/tableau/status`, {
      headers: AUTHORIZATION,
    });
    const viewsResponse = await fetch(`${baseUrl}/tableau/views`, { headers: AUTHORIZATION });
    const dataResponse = await fetch(`${baseUrl}/tableau/view-data?view_id=view-1&max_rows=75`, {
      headers: AUTHORIZATION,
    });
    const summaryResponse = await fetch(`${baseUrl}/tableau/summary?role=retail`, {
      headers: AUTHORIZATION,
    });
    const refreshResponse = await fetch(`${baseUrl}/tableau/refresh`, {
      method: 'POST',
      headers: AUTHORIZATION,
    });
    const analysisResponse = await fetch(`${baseUrl}/tableau/analyze`, {
      method: 'POST',
      headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Compare store sales by state', role: 'retail' }),
    });

    expect(await statusResponse.json()).toEqual(connection);
    expect(await viewsResponse.json()).toEqual({ views: [view] });
    expect((await dataResponse.json()).rows).toHaveLength(1);
    expect(dataSpy).toHaveBeenCalledWith('view-1', 75);
    expect((await summaryResponse.json()).summary.role).toBe('retail');
    expect((await refreshResponse.json()).summaries.retail.status).toBe('ready');
    expect(refreshSpy).toHaveBeenCalledOnce();
    expect((await analysisResponse.json()).selectedViews).toEqual([view]);
    expect(analysisSpy).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'Compare store sales by state', role: 'retail' })
    );
  });

  it('validates required parameters and maps Tableau failures to 502', async () => {
    const missingView = await fetch(`${baseUrl}/tableau/view-data`, {
      headers: AUTHORIZATION,
    });
    const invalidRole = await fetch(`${baseUrl}/tableau/summary?role=admin`, {
      headers: AUTHORIZATION,
    });
    const invalidRows = await fetch(
      `${baseUrl}/tableau/view-data?view_id=view-1&max_rows=unbounded`,
      { headers: AUTHORIZATION }
    );
    const missingQuestion = await fetch(`${baseUrl}/tableau/analyze`, {
      method: 'POST',
      headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    vi.spyOn(tableauService, 'listViews').mockRejectedValue(new Error('Tableau unavailable'));
    const failed = await fetch(`${baseUrl}/tableau/views`, { headers: AUTHORIZATION });

    expect(missingView.status).toBe(400);
    expect(invalidRole.status).toBe(400);
    expect(invalidRows.status).toBe(400);
    expect(missingQuestion.status).toBe(400);
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toEqual({ error: 'Tableau unavailable' });
  });
});
