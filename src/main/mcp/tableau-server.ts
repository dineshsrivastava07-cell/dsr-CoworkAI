import { writeMCPLog } from './mcp-logger.js';
import { type CallToolResult, type ListToolsResult, Server } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

const port = process.env.TABLEAU_BROKER_PORT;
const secret = process.env.TABLEAU_BROKER_SECRET;
const MAX_MODEL_ANALYSIS_ROWS_PER_VIEW = 60;
const MAX_MODEL_ANALYSIS_COLUMNS = 24;

async function brokerRequest(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>
): Promise<unknown> {
  if (!port || !secret) throw new Error('Tableau broker is unavailable. Restart V-Coworker.');
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `Tableau broker failed (${response.status}).`);
  return payload;
}

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/**
 * Keep the model-facing packet small enough for responsive chat. The main
 * process and analytical workspace retain the complete bounded datasets; the
 * MCP response carries a representative evidence sample plus the original row
 * coverage so the agent can request one targeted drill-down when necessary.
 */
function compactAnalysisResult(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const plan = value as Record<string, unknown>;
  if (!Array.isArray(plan.datasets)) return value;
  return {
    ...plan,
    datasets: plan.datasets.map((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
      const data = candidate as Record<string, unknown>;
      const columns = Array.isArray(data.columns)
        ? data.columns
            .filter((column): column is string => typeof column === 'string')
            .slice(0, MAX_MODEL_ANALYSIS_COLUMNS)
        : [];
      const sourceRows = Array.isArray(data.rows) ? data.rows : [];
      const rows = sourceRows.slice(0, MAX_MODEL_ANALYSIS_ROWS_PER_VIEW).map((candidateRow) => {
        if (!candidateRow || typeof candidateRow !== 'object' || Array.isArray(candidateRow)) {
          return candidateRow;
        }
        const source = candidateRow as Record<string, unknown>;
        return Object.fromEntries(columns.map((column) => [column, source[column]]));
      });
      return {
        ...data,
        columns,
        rows,
        analysisRowsLoaded: sourceRows.length,
        modelRowsReturned: rows.length,
        modelSampleTruncated: sourceRows.length > rows.length,
      };
    }),
    modelPacket: {
      rowsPerViewLimit: MAX_MODEL_ANALYSIS_ROWS_PER_VIEW,
      columnsPerViewLimit: MAX_MODEL_ANALYSIS_COLUMNS,
      note: 'Use tableau_get_view_data only when this sample is insufficient for a specific drill-down; do not refetch the same view without a narrower question or larger required scope.',
    },
  };
}

function createMcpServer() {
  const server = new Server(
    { name: 'tableau-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(
    'tools/list',
    async (): Promise<ListToolsResult> => ({
      tools: [
        {
          name: 'tableau_analyze_question',
          description:
            'Autonomously select up to three relevant Tableau dashboards, export bounded data, apply exact filters found in the question, and return a compact source-labelled evidence sample plus State/Zone/Region/Store coverage. Use this first for sales, product, dashboard, store, zone, region, state, trend, festive, KPI, insight, performance, or recommendation questions. Do not refetch the same views unless a specific drill-down is still unsupported. Read-only.',
          inputSchema: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'The user analytical question, including requested filters and scope.',
              },
              role: { type: 'string', enum: ['retail', 'merchandiser', 'planner'] },
              domain: {
                type: 'string',
                description:
                  'Optional V-Mart business domain such as retail, zone, store_manager, planning_scm, or finance.',
              },
              max_rows: {
                type: 'number',
                minimum: 25,
                maximum: 500,
                description:
                  'Maximum rows used by the planner per selected dashboard (default 200). The model receives a compact evidence sample with coverage metadata.',
              },
            },
            required: ['question'],
          },
        },
        {
          name: 'tableau_connection_status',
          description:
            'Check whether the configured Tableau Server is reachable and authenticated. Use this before analysis when VPN or local-network availability is uncertain.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'tableau_list_views',
          description:
            'List Tableau views available to the configured account, including workbook and project names. Read-only.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'tableau_get_view_data',
          description:
            'Export read-only CSV data for a Tableau view so V-Coworker can answer grounded analytical questions. Get the view_id from tableau_list_views.',
          inputSchema: {
            type: 'object',
            properties: {
              view_id: {
                type: 'string',
                description: 'Tableau view LUID from tableau_list_views.',
              },
              max_rows: {
                type: 'number',
                description: 'Maximum rows to return (1-500, default 100).',
                minimum: 1,
                maximum: 500,
              },
            },
            required: ['view_id'],
          },
        },
        {
          name: 'tableau_get_role_summary',
          description:
            'Get the cached, source-labelled Tableau summary for Retail, Merchandiser, or Planner. Indicates when cached data is stale because VPN/local network is unavailable.',
          inputSchema: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['retail', 'merchandiser', 'planner'] },
            },
            required: ['role'],
          },
        },
        {
          name: 'tableau_refresh_role_summaries',
          description:
            'Refresh all three read-only role summaries from Tableau. Requires VPN or local Tableau network access.',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    })
  );

  server.setRequestHandler('tools/call', async (request): Promise<CallToolResult> => {
    const { name, arguments: args = {} } = request.params;
    try {
      writeMCPLog(`[Tableau] ${name}`, 'Tool Call');
      if (name === 'tableau_analyze_question') {
        const {
          question,
          role = 'retail',
          domain = 'retail',
          max_rows = 200,
        } = args as {
          question?: string;
          role?: string;
          domain?: string;
          max_rows?: number;
        };
        if (!question?.trim()) throw new Error('question is required.');
        if (!['retail', 'merchandiser', 'planner'].includes(role)) {
          throw new Error('role must be retail, merchandiser, or planner.');
        }
        if (!Number.isFinite(max_rows) || max_rows < 25 || max_rows > 500) {
          throw new Error('max_rows must be a number from 25 to 500.');
        }
        return textResult(
          compactAnalysisResult(
            await brokerRequest('/tableau/analyze', 'POST', {
              question: question.trim(),
              role,
              domain,
              max_rows,
            })
          )
        );
      }
      if (name === 'tableau_connection_status') {
        return textResult(await brokerRequest('/tableau/status'));
      }
      if (name === 'tableau_list_views') {
        return textResult(await brokerRequest('/tableau/views'));
      }
      if (name === 'tableau_get_view_data') {
        const { view_id, max_rows = 100 } = args as { view_id?: string; max_rows?: number };
        if (!view_id?.trim()) throw new Error('view_id is required.');
        if (!Number.isFinite(max_rows) || max_rows < 1 || max_rows > 500) {
          throw new Error('max_rows must be a number from 1 to 500.');
        }
        const query = new URLSearchParams({
          view_id: view_id.trim(),
          max_rows: String(max_rows),
        });
        return textResult(await brokerRequest(`/tableau/view-data?${query}`));
      }
      if (name === 'tableau_get_role_summary') {
        const { role } = args as { role?: string };
        if (!['retail', 'merchandiser', 'planner'].includes(role || '')) {
          throw new Error('role must be retail, merchandiser, or planner.');
        }
        return textResult(await brokerRequest(`/tableau/summary?role=${role}`));
      }
      if (name === 'tableau_refresh_role_summaries') {
        return textResult(await brokerRequest('/tableau/refresh', 'POST'));
      }
      throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Tableau error: ${message}` }], isError: true };
    }
  });
  return server;
}

serveStdio(() => createMcpServer(), {
  onerror: (error: Error) => process.stderr.write(`[tableau-server] Fatal: ${error}\n`),
});
