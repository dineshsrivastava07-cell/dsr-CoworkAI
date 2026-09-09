/**
 * Google Workspace MCP Server for V-Coworker
 *
 * Read-only access to the connected user's Gmail, Google Drive (Docs, Sheets,
 * Slides, PDFs), and Google Calendar. No send/write/delete on any product.
 *
 * This process has no Electron access (bare `node` child process) and holds
 * no credentials of its own — every tool call first asks the main process's
 * local token broker (see src/main/google/google-token-broker.ts) for a
 * live, auto-refreshed access token over a loopback HTTP call authenticated
 * with a per-launch bearer secret passed in via env vars.
 */

// Bootstrap logging - log as early as possible
import { writeMCPLog } from './mcp-logger.js';
import { type CallToolResult, type ListToolsResult, Server } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

writeMCPLog('=== Module Loading Started ===', 'Bootstrap');

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const GMAIL_CONCURRENCY = 10;

class NotConnectedError extends Error {}
class ReconnectRequiredError extends Error {
  accountEmail?: string;
  constructor(accountEmail?: string) {
    super(
      accountEmail
        ? `Google connection for ${accountEmail} needs to be re-authorized.`
        : 'Google connection needs to be re-authorized.'
    );
    this.accountEmail = accountEmail;
  }
}

function brokerConnectionInfo(): { port: number; secret: string } {
  const port = process.env.GOOGLE_TOKEN_BROKER_PORT;
  const secret = process.env.GOOGLE_TOKEN_BROKER_SECRET;
  if (!port || !secret) {
    throw new NotConnectedError(
      'Google account is not connected. Open Settings → Connectors → Google Workspace and click "Connect".'
    );
  }
  return { port: Number(port), secret };
}

async function getAccessToken(): Promise<string> {
  const { port, secret } = brokerConnectionInfo();
  const response = await fetch(`http://127.0.0.1:${port}/google/token`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  if (response.status === 404) {
    throw new NotConnectedError(
      'Google account is not connected. Open Settings → Connectors → Google Workspace and click "Connect".'
    );
  }
  if (response.status === 401) {
    const body = (await response.json().catch(() => ({}))) as { accountEmail?: string };
    throw new ReconnectRequiredError(body.accountEmail);
  }
  if (!response.ok) {
    throw new Error(`Token broker request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { accessToken: string };
  return data.accessToken;
}

async function callGoogleApi(url: string, retryOn401 = true): Promise<Response> {
  const accessToken = await getAccessToken();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 401 && retryOn401) {
    // The broker's clock-based freshness check can miss out-of-band
    // revocation — force a refresh and retry exactly once.
    const { port, secret } = brokerConnectionInfo();
    await fetch(`http://127.0.0.1:${port}/google/token/invalidate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    });
    return callGoogleApi(url, false);
  }

  return response;
}

async function callGoogleApiJson<T>(url: string): Promise<T> {
  const response = await callGoogleApi(url);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google API request failed: ${response.status} ${response.statusText} ${body}`);
  }
  return (await response.json()) as T;
}

// ── Gmail ────────────────────────────────────────────────────────────────

interface GmailMessageListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: {
    headers?: GmailHeader[];
    mimeType?: string;
    body?: { data?: string };
    parts?: GmailMessagePart[];
  };
}

function getHeader(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function gmailListMessages(args: {
  query?: string;
  max_results?: number;
  label_ids?: string[];
  page_token?: string;
}): Promise<string> {
  const maxResults = Math.min(Math.max(args.max_results ?? 20, 1), 50);
  const url = new URL(`${GMAIL_API}/messages`);
  url.searchParams.set('maxResults', String(maxResults));
  if (args.query) url.searchParams.set('q', args.query);
  if (args.label_ids?.length) {
    for (const label of args.label_ids) url.searchParams.append('labelIds', label);
  }
  if (args.page_token) url.searchParams.set('pageToken', args.page_token);

  const list = await callGoogleApiJson<GmailMessageListResponse>(url.toString());
  const messages = list.messages ?? [];
  if (messages.length === 0) {
    return 'No messages found.';
  }

  const details = await mapWithConcurrency(messages, GMAIL_CONCURRENCY, async (m) => {
    const detailUrl = new URL(`${GMAIL_API}/messages/${m.id}`);
    detailUrl.searchParams.set('format', 'metadata');
    detailUrl.searchParams.append('metadataHeaders', 'Subject');
    detailUrl.searchParams.append('metadataHeaders', 'From');
    detailUrl.searchParams.append('metadataHeaders', 'Date');
    const message = await callGoogleApiJson<GmailMessage>(detailUrl.toString());
    return {
      id: message.id,
      subject: getHeader(message.payload?.headers, 'Subject') || '(no subject)',
      from: getHeader(message.payload?.headers, 'From'),
      date: getHeader(message.payload?.headers, 'Date'),
      snippet: message.snippet ?? '',
    };
  });

  const lines = details.map(
    (d) => `- [${d.id}] ${d.subject}\n  From: ${d.from} | ${d.date}\n  ${d.snippet}`
  );
  const footer = list.nextPageToken
    ? `\n\n(more results available, page_token: ${list.nextPageToken})`
    : '';
  return `${lines.join('\n\n')}${footer}`;
}

function decodeGmailBodyPart(
  parts: GmailMessagePart[] | undefined,
  mimeType: string
): string | null {
  if (!parts) return null;
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) {
      return Buffer.from(part.body.data, 'base64url').toString('utf8');
    }
    if (part.parts) {
      const nested = decodeGmailBodyPart(part.parts, mimeType);
      if (nested) return nested;
    }
  }
  return null;
}

function listAttachments(parts: GmailMessagePart[] | undefined, out: string[] = []): string[] {
  if (!parts) return out;
  for (const part of parts) {
    if (part.filename) {
      out.push(
        `${part.filename} (${part.mimeType ?? 'unknown type'}, ${part.body?.size ?? 0} bytes)`
      );
    }
    if (part.parts) listAttachments(part.parts, out);
  }
  return out;
}

async function gmailGetMessage(args: { message_id: string }): Promise<string> {
  if (!args.message_id) {
    throw new Error('message_id is required');
  }
  const url = new URL(`${GMAIL_API}/messages/${args.message_id}`);
  url.searchParams.set('format', 'full');
  const message = await callGoogleApiJson<GmailMessage>(url.toString());

  const headers = message.payload?.headers;
  const subject = getHeader(headers, 'Subject') || '(no subject)';
  const from = getHeader(headers, 'From');
  const to = getHeader(headers, 'To');
  const date = getHeader(headers, 'Date');

  let body: string | null = null;
  if (message.payload?.body?.data) {
    body = Buffer.from(message.payload.body.data, 'base64url').toString('utf8');
  } else {
    body =
      decodeGmailBodyPart(message.payload?.parts, 'text/plain') ??
      decodeGmailBodyPart(message.payload?.parts, 'text/html') ??
      '(no readable body content)';
  }

  const attachments = listAttachments(message.payload?.parts);
  const attachmentsBlock = attachments.length
    ? `\n\nAttachments (not fetched, metadata only):\n${attachments.map((a) => `- ${a}`).join('\n')}`
    : '';

  return `Subject: ${subject}\nFrom: ${from}\nTo: ${to}\nDate: ${date}\n\n${body}${attachmentsBlock}`;
}

// ── Drive ────────────────────────────────────────────────────────────────

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
}

interface DriveFileListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
}

async function driveListFiles(args: {
  query?: string;
  max_results?: number;
  page_token?: string;
}): Promise<string> {
  const maxResults = Math.min(Math.max(args.max_results ?? 20, 1), 100);
  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set('q', args.query?.trim() || 'trashed = false');
  url.searchParams.set('pageSize', String(maxResults));
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set(
    'fields',
    'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,size)'
  );
  if (args.page_token) url.searchParams.set('pageToken', args.page_token);

  const list = await callGoogleApiJson<DriveFileListResponse>(url.toString());
  const files = list.files ?? [];
  if (files.length === 0) {
    return 'No files found.';
  }

  const lines = files.map(
    (f) =>
      `- [${f.id}] ${f.name} (${f.mimeType})${f.modifiedTime ? `, modified ${f.modifiedTime}` : ''}`
  );
  const footer = list.nextPageToken
    ? `\n\n(more results available, page_token: ${list.nextPageToken})`
    : '';
  return `${lines.join('\n')}${footer}`;
}

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation';
const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const PDF_MIME = 'application/pdf';

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[...truncated, ${text.length - maxChars} more characters]`;
}

async function exportDriveFile(fileId: string, exportMimeType: string): Promise<string> {
  const url = new URL(`${DRIVE_API}/files/${fileId}/export`);
  url.searchParams.set('mimeType', exportMimeType);
  const response = await callGoogleApi(url.toString());
  if (!response.ok) {
    throw new Error(`Drive export failed: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

async function driveReadFile(args: { file_id: string; max_chars?: number }): Promise<string> {
  if (!args.file_id) {
    throw new Error('file_id is required');
  }
  const maxChars = args.max_chars ?? 50000;

  const metaUrl = new URL(`${DRIVE_API}/files/${args.file_id}`);
  metaUrl.searchParams.set('fields', 'id,name,mimeType,size,webViewLink');
  const metadata = await callGoogleApiJson<DriveFile>(metaUrl.toString());

  const header = `File: ${metadata.name} (${metadata.mimeType})\n\n`;

  switch (metadata.mimeType) {
    case GOOGLE_DOC_MIME: {
      let text: string;
      try {
        text = await exportDriveFile(args.file_id, 'text/markdown');
      } catch {
        text = await exportDriveFile(args.file_id, 'text/plain');
      }
      return header + truncate(text, maxChars);
    }
    case GOOGLE_SHEET_MIME: {
      const csv = await exportDriveFile(args.file_id, 'text/csv');
      const note =
        "(Note: only the first sheet is exported by Drive's export API; other tabs are not included.)\n\n";
      return header + note + truncate(csv, maxChars);
    }
    case GOOGLE_SLIDES_MIME: {
      const text = await exportDriveFile(args.file_id, 'text/plain');
      return header + truncate(text, maxChars);
    }
    case GOOGLE_FOLDER_MIME: {
      return (
        header +
        `This is a folder. Call drive_list_files with query: "'${args.file_id}' in parents" to list its contents.`
      );
    }
    case PDF_MIME: {
      const sizeBytes = metadata.size ? Number(metadata.size) : undefined;
      if (sizeBytes && sizeBytes > MAX_PDF_BYTES) {
        return `${header}File is too large to extract text from (${sizeBytes} bytes, limit ${MAX_PDF_BYTES}). View it directly: ${metadata.webViewLink ?? '(no link)'}`;
      }
      const mediaUrl = new URL(`${DRIVE_API}/files/${args.file_id}`);
      mediaUrl.searchParams.set('alt', 'media');
      const response = await callGoogleApi(mediaUrl.toString());
      if (!response.ok) {
        throw new Error(`Failed to download PDF: ${response.status} ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      try {
        // Dynamic import: pdf-parse needs `extraExternals` bundling treatment
        // (see scripts/bundle-mcp.js), matching office-tools-server.ts's own
        // `await import('exceljs')` pattern for the same class of dependency.
        const pdfParse = (await import('pdf-parse')).default;
        const parsed = await pdfParse(buffer);
        return header + truncate(parsed.text, maxChars);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return `${header}Could not extract text from this PDF (${msg}). View it directly: ${metadata.webViewLink ?? '(no link)'}`;
      }
    }
    default: {
      return (
        header +
        `This file type isn't a readable text format. View it directly: ${metadata.webViewLink ?? '(no link)'}`
      );
    }
  }
}

// ── Calendar ─────────────────────────────────────────────────────────────

interface CalendarEvent {
  id: string;
  summary?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  location?: string;
  htmlLink?: string;
}

interface CalendarEventListResponse {
  items?: CalendarEvent[];
  nextPageToken?: string;
}

async function calendarListEvents(args: {
  calendar_id?: string;
  time_min?: string;
  time_max?: string;
  query?: string;
  max_results?: number;
}): Promise<string> {
  const calendarId = encodeURIComponent(args.calendar_id?.trim() || 'primary');
  const maxResults = Math.min(Math.max(args.max_results ?? 20, 1), 250);
  const url = new URL(`${CALENDAR_API}/calendars/${calendarId}/events`);
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('timeMin', args.time_min || new Date().toISOString());
  if (args.time_max) url.searchParams.set('timeMax', args.time_max);
  if (args.query) url.searchParams.set('q', args.query);

  const list = await callGoogleApiJson<CalendarEventListResponse>(url.toString());
  const events = list.items ?? [];
  if (events.length === 0) {
    return 'No events found.';
  }

  const lines = events.map((e) => {
    const start = e.start?.dateTime ?? e.start?.date ?? '?';
    const end = e.end?.dateTime ?? e.end?.date ?? '?';
    return `- [${e.id}] ${e.summary ?? '(no title)'}\n  ${start} → ${end}${e.location ? `\n  Location: ${e.location}` : ''}`;
  });
  return lines.join('\n\n');
}

// ── Connection status ────────────────────────────────────────────────────

async function googleConnectionStatus(): Promise<string> {
  try {
    await getAccessToken();
    return 'Google account is connected.';
  } catch (error) {
    if (error instanceof NotConnectedError || error instanceof ReconnectRequiredError) {
      return error.message;
    }
    throw error;
  }
}

// ── MCP server wiring ────────────────────────────────────────────────────

function createMcpServer() {
  const server = new Server(
    { name: 'google-workspace-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(
    'tools/list',
    async (): Promise<ListToolsResult> => ({
      tools: [
        {
          name: 'gmail_list_messages',
          description:
            'List/search Gmail messages (read-only). Returns id, subject, from, date, and a snippet for each. ' +
            'Use Gmail search syntax in "query", e.g. "from:someone@example.com is:unread".',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Gmail search query (optional).' },
              max_results: {
                type: 'number',
                description: 'Max messages to return (1-50). Default 20.',
              },
              label_ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by label IDs, e.g. ["INBOX", "UNREAD"] (optional).',
              },
              page_token: {
                type: 'string',
                description: 'Pagination token from a previous call (optional).',
              },
            },
          },
        },
        {
          name: 'gmail_get_message',
          description:
            'Read the full content of one Gmail message by id (read-only). Attachments are listed as metadata only, not fetched.',
          inputSchema: {
            type: 'object',
            properties: {
              message_id: {
                type: 'string',
                description: 'Gmail message id (from gmail_list_messages).',
              },
            },
            required: ['message_id'],
          },
        },
        {
          name: 'drive_list_files',
          description:
            'List/search Google Drive files (read-only). Use Drive query syntax in "query", ' +
            'e.g. "name contains \'report\'" or "\'<folderId>\' in parents".',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Drive v3 search query (optional, defaults to non-trashed files).',
              },
              max_results: {
                type: 'number',
                description: 'Max files to return (1-100). Default 20.',
              },
              page_token: {
                type: 'string',
                description: 'Pagination token from a previous call (optional).',
              },
            },
          },
        },
        {
          name: 'drive_read_file',
          description:
            'Read the text content of a Google Drive file by id (read-only). Handles Google Docs (as markdown), ' +
            'Google Sheets (first sheet as CSV), Google Slides (as plain text), and PDFs (text extraction). ' +
            'Other file types return metadata and a link instead of content.',
          inputSchema: {
            type: 'object',
            properties: {
              file_id: { type: 'string', description: 'Drive file id (from drive_list_files).' },
              max_chars: {
                type: 'number',
                description: 'Truncate content to this many characters. Default 50000.',
              },
            },
            required: ['file_id'],
          },
        },
        {
          name: 'calendar_list_events',
          description:
            'List Google Calendar events in a time range (read-only). Recurring events are expanded into individual instances.',
          inputSchema: {
            type: 'object',
            properties: {
              calendar_id: { type: 'string', description: 'Calendar id. Default "primary".' },
              time_min: { type: 'string', description: 'RFC3339 start of range. Default: now.' },
              time_max: { type: 'string', description: 'RFC3339 end of range (optional).' },
              query: { type: 'string', description: 'Free-text search within events (optional).' },
              max_results: {
                type: 'number',
                description: 'Max events to return (1-250). Default 20.',
              },
            },
          },
        },
        {
          name: 'google_connection_status',
          description:
            'Check whether a Google account is currently connected, before attempting Gmail/Drive/Calendar calls.',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    })
  );

  server.setRequestHandler('tools/call', async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;

    try {
      writeMCPLog(`[CallTool] name=${name}, args=${JSON.stringify(args ?? {})}`, 'Tool Call');

      let resultText: string;
      switch (name) {
        case 'gmail_list_messages':
          resultText = await gmailListMessages(
            (args ?? {}) as Parameters<typeof gmailListMessages>[0]
          );
          break;
        case 'gmail_get_message':
          resultText = await gmailGetMessage((args ?? {}) as Parameters<typeof gmailGetMessage>[0]);
          break;
        case 'drive_list_files':
          resultText = await driveListFiles((args ?? {}) as Parameters<typeof driveListFiles>[0]);
          break;
        case 'drive_read_file':
          resultText = await driveReadFile((args ?? {}) as Parameters<typeof driveReadFile>[0]);
          break;
        case 'calendar_list_events':
          resultText = await calendarListEvents(
            (args ?? {}) as Parameters<typeof calendarListEvents>[0]
          );
          break;
        case 'google_connection_status':
          resultText = await googleConnectionStatus();
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return { content: [{ type: 'text', text: resultText }] };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      writeMCPLog(`[CallTool] Error in ${name}: ${msg}`, 'Tool Call Error');
      return {
        content: [{ type: 'text', text: `❌ Error in ${name}: ${msg}` }],
        isError: true,
      };
    }
  });

  return server;
}

serveStdio(() => createMcpServer(), {
  onerror: (error: Error) => {
    process.stderr.write(`[google-workspace-server] Fatal: ${error}\n`);
  },
});
