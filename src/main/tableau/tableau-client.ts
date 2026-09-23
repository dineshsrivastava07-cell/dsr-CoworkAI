import type {
  TableauConnectionStatus,
  TableauViewData,
  TableauViewFilter,
  TableauViewInfo,
} from '../../shared/tableau-types';

export interface TableauCredentials {
  baseUrl: string;
  username: string;
  password: string;
  siteContentUrl: string;
  apiVersion: string;
}

interface TableauSession {
  token: string;
  siteId: string;
  siteName?: string;
  serverVersion?: string;
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CSV_BYTES = 10 * 1024 * 1024;

export function normalizeTableauBaseUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Tableau URL must use HTTP or HTTPS.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Do not include credentials in the Tableau URL.');
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort/i.test(message))
    return 'Tableau request timed out. Connect to the VPN or local network and try again.';
  if (/fetch failed|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT/i.test(message)) {
    return 'Tableau is unreachable. Connect to the VPN or local Tableau network and try again.';
  }
  return message.replace(/X-Tableau-Auth[^\s,]*/gi, 'authentication token');
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new Error(
        'Tableau view export exceeded the 10 MB analysis limit. Narrow the view filters and retry.'
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export class TableauClient {
  private readonly credentials: TableauCredentials;

  constructor(credentials: TableauCredentials) {
    this.credentials = { ...credentials, baseUrl: normalizeTableauBaseUrl(credentials.baseUrl) };
  }

  private apiUrl(path: string): string {
    return `${this.credentials.baseUrl}/api/${this.credentials.apiVersion}${path}`;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      throw new Error(safeErrorMessage(error));
    } finally {
      clearTimeout(timer);
    }
  }

  private async signIn(): Promise<TableauSession> {
    const response = await this.request(this.apiUrl('/auth/signin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        credentials: {
          name: this.credentials.username,
          password: this.credentials.password,
          site: { contentUrl: this.credentials.siteContentUrl },
        },
      }),
    });
    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? 'Tableau authentication failed. Check the username, password, and site content URL.'
          : `Tableau sign-in failed (${response.status}).`
      );
    }
    const payload = (await response.json()) as {
      credentials?: {
        token?: string;
        site?: { id?: string; name?: string; contentUrl?: string };
        estimatedTimeToExpiration?: string;
      };
    };
    const token = payload.credentials?.token;
    const siteId = payload.credentials?.site?.id;
    if (!token || !siteId) throw new Error('Tableau sign-in returned an incomplete session.');
    return {
      token,
      siteId,
      siteName: payload.credentials?.site?.name || payload.credentials?.site?.contentUrl,
      serverVersion: response.headers.get('x-tableau') || undefined,
    };
  }

  private async signOut(session: TableauSession): Promise<void> {
    await this.request(this.apiUrl('/auth/signout'), {
      method: 'POST',
      headers: { 'X-Tableau-Auth': session.token },
    }).catch(() => undefined);
  }

  private async withSession<T>(operation: (session: TableauSession) => Promise<T>): Promise<T> {
    const session = await this.signIn();
    try {
      return await operation(session);
    } finally {
      await this.signOut(session);
    }
  }

  async testConnection(): Promise<TableauConnectionStatus> {
    const checkedAt = Date.now();
    try {
      const session = await this.signIn();
      await this.signOut(session);
      return {
        configured: true,
        reachable: true,
        authenticated: true,
        serverVersion: session.serverVersion,
        siteName: session.siteName,
        checkedAt,
      };
    } catch (error) {
      const message = safeErrorMessage(error);
      return {
        configured: true,
        reachable: !/unreachable|timed out|VPN/i.test(message),
        authenticated: false,
        checkedAt,
        error: message,
        limitation: 'This Tableau server is available only on its local network or through VPN.',
      };
    }
  }

  async listViews(): Promise<TableauViewInfo[]> {
    return this.withSession(async (session) => {
      const url = new URL(this.apiUrl(`/sites/${encodeURIComponent(session.siteId)}/views`));
      url.searchParams.set('pageSize', '1000');
      const response = await this.request(url.toString(), {
        headers: { 'X-Tableau-Auth': session.token, Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Tableau view listing failed (${response.status}).`);
      const payload = (await response.json()) as {
        views?: {
          view?: Array<{
            id?: string;
            name?: string;
            contentUrl?: string;
            workbook?: { name?: string };
            project?: { name?: string };
          }>;
        };
      };
      return (payload.views?.view || [])
        .filter((view) => Boolean(view.id && view.name))
        .map((view) => {
          // Some Tableau Server installations omit workbook/project details from
          // Query Views even though the workbook slug is present in contentUrl.
          const workbookFromContentUrl = view.contentUrl?.split('/sheets/')[0] || undefined;
          return {
            id: view.id!,
            name: view.name!,
            contentUrl: view.contentUrl,
            workbookName: view.workbook?.name || workbookFromContentUrl,
            projectName: view.project?.name,
            viewUrl: view.contentUrl
              ? `${this.credentials.baseUrl}/views/${view.contentUrl}`
              : undefined,
          };
        });
    });
  }

  private async getViewDataInSession(
    session: TableauSession,
    view: TableauViewInfo,
    maxRows = 200,
    filters: readonly TableauViewFilter[] = []
  ): Promise<TableauViewData> {
    const safeMaxRows = Math.min(Math.max(Math.floor(maxRows), 1), 2_000);
    const url = new URL(
      this.apiUrl(
        `/sites/${encodeURIComponent(session.siteId)}/views/${encodeURIComponent(view.id)}/data`
      )
    );
    for (const filter of filters.slice(0, 8)) {
      const field = filter.field.trim();
      const values = filter.values
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 20);
      if (field && field.length <= 200 && values.length) {
        url.searchParams.set(`vf_${field}`, values.join(','));
      }
    }
    const response = await this.request(
      url.toString(),
      // Do not send Accept: text/csv. Tableau Server 2025.3 can return 406 for
      // that header even though this endpoint successfully responds with CSV.
      { headers: { 'X-Tableau-Auth': session.token } }
    );
    if (!response.ok) throw new Error(`Tableau view data query failed (${response.status}).`);
    const parsed = parseCsv(await readTextLimited(response, MAX_CSV_BYTES));
    const columns = parsed[0] || [];
    const dataRows = parsed.slice(1);
    const rows = dataRows
      .slice(0, safeMaxRows)
      .map((values) =>
        Object.fromEntries(columns.map((column, index) => [column, values[index] ?? '']))
      );
    return {
      view,
      columns,
      rows,
      totalRows: dataRows.length,
      truncated: dataRows.length > safeMaxRows,
    };
  }

  async getViewData(
    view: TableauViewInfo,
    maxRows = 200,
    filters: readonly TableauViewFilter[] = []
  ): Promise<TableauViewData> {
    return this.withSession((session) =>
      this.getViewDataInSession(session, view, maxRows, filters)
    );
  }

  async getViewsData(
    views: TableauViewInfo[],
    maxRows = 200,
    filtersByView: Readonly<Record<string, readonly TableauViewFilter[]>> = {}
  ): Promise<TableauViewData[]> {
    return this.withSession(async (session) => {
      const results: TableauViewData[] = [];
      for (const view of views) {
        try {
          results.push(
            await this.getViewDataInSession(session, view, maxRows, filtersByView[view.id] || [])
          );
        } catch {
          results.push({ view, columns: [], rows: [], totalRows: 0, truncated: false });
        }
      }
      return results;
    });
  }
}
