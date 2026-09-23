import { afterEach, describe, expect, it, vi } from 'vitest';
import { TableauClient, normalizeTableauBaseUrl } from '../src/main/tableau/tableau-client';

afterEach(() => vi.unstubAllGlobals());

describe('TableauClient', () => {
  it('normalizes dashboard URLs and rejects embedded credentials', () => {
    expect(normalizeTableauBaseUrl('http://example.test/#/signin?redirect=x')).toBe(
      'http://example.test'
    );
    expect(() => normalizeTableauBaseUrl('ftp://example.test')).toThrow('HTTP or HTTPS');
    expect(() => normalizeTableauBaseUrl('http://user:pass@example.test')).toThrow('credentials');
  });

  it('signs in, lists views, exports CSV data, and signs out without leaking credentials', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith('/auth/signin')) {
          return new Response(
            JSON.stringify({
              credentials: {
                token: 'session-token',
                site: { id: 'site-1', name: 'Default' },
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json', 'X-Tableau': 'Tableau Server' },
            }
          );
        }
        if (url.endsWith('/auth/signout')) return new Response(null, { status: 204 });
        if (url.includes('/sites/site-1/views?pageSize=1000')) {
          return new Response(
            JSON.stringify({
              views: {
                view: [
                  {
                    id: 'view-1',
                    name: 'Retail Sales',
                    contentUrl: 'Retail/Sales',
                    workbook: { name: 'Store Performance' },
                    project: { name: 'Retail' },
                  },
                ],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.endsWith('/sites/site-1/views/view-1/data')) {
          return new Response('Store,Sales\r\n"Delhi, CP","1,250"\r\nMumbai,980\r\n', {
            status: 200,
            headers: { 'Content-Type': 'text/csv' },
          });
        }
        return new Response(null, { status: 404 });
      })
    );

    const client = new TableauClient({
      baseUrl: 'http://tableau.test',
      username: 'tableau-user',
      password: 'sensitive-test-password',
      siteContentUrl: '',
      apiVersion: '3.27',
    });
    const views = await client.listViews();
    const data = await client.getViewData(views[0], 1);

    expect(views[0]).toEqual(
      expect.objectContaining({
        id: 'view-1',
        name: 'Retail Sales',
        workbookName: 'Store Performance',
      })
    );
    expect(data.columns).toEqual(['Store', 'Sales']);
    expect(data.rows).toEqual([{ Store: 'Delhi, CP', Sales: '1,250' }]);
    expect(data.totalRows).toBe(2);
    expect(data.truncated).toBe(true);
    expect(requests.filter((request) => request.url.endsWith('/auth/signout'))).toHaveLength(2);
    expect(
      requests.find((request) => request.url.includes('/views?pageSize'))?.init?.headers
    ).toEqual(expect.objectContaining({ 'X-Tableau-Auth': 'session-token' }));
    const dataHeaders = requests.find((request) => request.url.endsWith('/view-1/data'))?.init
      ?.headers as Record<string, string>;
    expect(dataHeaders.Accept).toBeUndefined();
    expect(
      JSON.stringify({ views, data, urls: requests.map((request) => request.url) })
    ).not.toContain('sensitive-test-password');
  });

  it('derives the workbook name from contentUrl when Tableau omits workbook metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/auth/signin')) {
          return new Response(JSON.stringify({ credentials: { token: 't', site: { id: 's' } } }), {
            status: 200,
          });
        }
        if (url.endsWith('/auth/signout')) return new Response(null, { status: 204 });
        return new Response(
          JSON.stringify({
            views: {
              view: [
                {
                  id: 'v',
                  name: 'OTB Summary',
                  contentUrl: 'OTBVsPO/sheets/OTBSummary',
                },
              ],
            },
          }),
          { status: 200 }
        );
      })
    );
    const client = new TableauClient({
      baseUrl: 'http://tableau.test',
      username: 'user',
      password: 'password',
      siteContentUrl: '',
      apiVersion: '3.27',
    });
    await expect(client.listViews()).resolves.toEqual([
      expect.objectContaining({ workbookName: 'OTBVsPO' }),
    ]);
  });

  it('passes exact Tableau vf_ filters to the read-only view data query', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        if (url.endsWith('/auth/signin')) {
          return new Response(JSON.stringify({ credentials: { token: 't', site: { id: 's' } } }), {
            status: 200,
          });
        }
        if (url.endsWith('/auth/signout')) return new Response(null, { status: 204 });
        if (url.includes('/views/view-1/data')) {
          return new Response('Store Name,State,Sales\nLucknow One,Uttar Pradesh,100\n', {
            status: 200,
          });
        }
        return new Response(null, { status: 404 });
      })
    );
    const client = new TableauClient({
      baseUrl: 'http://tableau.test',
      username: 'user',
      password: 'password',
      siteContentUrl: '',
      apiVersion: '3.27',
    });
    await client.getViewData({ id: 'view-1', name: 'Store Sales' }, 100, [
      { field: 'Store Name', values: ['Lucknow One'] },
      { field: 'State', values: ['Uttar Pradesh'] },
    ]);

    const dataUrl = new URL(urls.find((url) => url.includes('/views/view-1/data'))!);
    expect(dataUrl.searchParams.get('vf_Store Name')).toBe('Lucknow One');
    expect(dataUrl.searchParams.get('vf_State')).toBe('Uttar Pradesh');
  });
});
