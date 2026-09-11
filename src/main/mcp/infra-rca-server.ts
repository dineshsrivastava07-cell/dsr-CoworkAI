/**
 * Infra RCA MCP Server for V-Coworker
 *
 * Root-cause diagnostics for remote infrastructure (Linux/Unix via SSH,
 * Windows via WinRM/PowerShell, network gear/printers/UPS via SNMP,
 * Postgres/MySQL via direct connection). Deliberately NEVER auto-executes a
 * fix: infra_propose_fix only registers a proposal, and infra_execute_fix
 * refuses unless the caller supplies confirm_fix=true AND the exact
 * proposal_id previously issued for that command — this mirrors
 * gui-operate-server.ts's confirm_irreversible pattern, checked inside the
 * tool's own execute() so it survives Autonomous Mode (which only bypasses
 * the separate permission-rules 'ask' dialog, never a tool's own refusal).
 *
 * Credentials never pass through the model: this process has no direct
 * access to infra-rca-store.ts's encrypted file. It resolves a target by
 * name via infra-rca-broker.ts, a loopback HTTP endpoint running in the
 * main process, authenticated with a per-launch secret injected only via
 * env vars (INFRA_RCA_BROKER_PORT / INFRA_RCA_BROKER_SECRET).
 */

import { type CallToolResult, type ListToolsResult, Server } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as http from 'node:http';
import * as net from 'node:net';
import { randomUUID } from 'node:crypto';
import type { DiagnosticCategory, TargetCredentials } from './infra-drivers/types';
import { diagnoseSsh, sshExec } from './infra-drivers/ssh-driver';
import { diagnoseWinrm, winrmExec } from './infra-drivers/winrm-driver';
import { diagnoseSnmp } from './infra-drivers/snmp-driver';
import { diagnoseDb, dbExecuteFix } from './infra-drivers/db-driver';
import { diagnoseOnvif } from './infra-drivers/onvif-driver';

const BROKER_PORT = process.env.INFRA_RCA_BROKER_PORT;
const BROKER_SECRET = process.env.INFRA_RCA_BROKER_SECRET;

const CATEGORY_ENUM: DiagnosticCategory[] = [
  'os_health',
  'disk_health',
  'ram_health',
  'network_health',
  'db_health',
  'printer_health',
  'power_health',
  'file_health',
];

interface BrokerTargetResponse {
  target?: TargetCredentials;
  error?: string;
}

function brokerRequest<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!BROKER_PORT || !BROKER_SECRET) {
      reject(
        new Error(
          'Infra RCA broker connection info not available (INFRA_RCA_BROKER_PORT/SECRET unset)'
        )
      );
      return;
    }
    const req = http.request(
      {
        host: '127.0.0.1',
        port: Number(BROKER_PORT),
        path,
        method: 'GET',
        headers: { Authorization: `Bearer ${BROKER_SECRET}` },
        timeout: 8000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body) as T);
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Infra RCA broker request timed out'));
    });
    req.end();
  });
}

async function resolveTarget(name: string): Promise<TargetCredentials> {
  const response = await brokerRequest<BrokerTargetResponse>(
    `/infra-rca/target?name=${encodeURIComponent(name)}`
  );
  if (!response.target) {
    throw new Error(
      `Unknown target "${name}" (error: ${response.error || 'not found'}). Call infra_list_targets first.`
    );
  }
  return response.target;
}

async function listTargetNames(): Promise<{ name: string; protocol: string; host: string }[]> {
  const response = await brokerRequest<{
    targets?: { name: string; protocol: string; host: string }[];
  }>('/infra-rca/targets');
  return response.targets || [];
}

async function diagnose(target: TargetCredentials, category: DiagnosticCategory) {
  switch (target.protocol) {
    case 'ssh':
      return diagnoseSsh(target, category);
    case 'winrm':
      return diagnoseWinrm(target, category);
    case 'snmp':
      return diagnoseSnmp(target, category);
    case 'db':
      return diagnoseDb(target, category);
    default:
      return diagnoseOnvif(target, category);
  }
}

// In-memory only — proposals are never persisted and expire quickly. Binding
// execution to a specific proposal_id prevents the model from substituting a
// different command than the one actually shown to the user for approval.
interface PendingProposal {
  targetName: string;
  command: string;
  explanation: string;
  riskLevel: 'low' | 'medium' | 'high';
  createdAt: number;
}
const PROPOSAL_TTL_MS = 15 * 60 * 1000;
const pendingProposals = new Map<string, PendingProposal>();

function pruneExpiredProposals(): void {
  const now = Date.now();
  for (const [id, p] of pendingProposals) {
    if (now - p.createdAt > PROPOSAL_TTL_MS) {
      pendingProposals.delete(id);
    }
  }
}

async function pingCheck(
  target: TargetCredentials
): Promise<{ reachable: boolean; latencyMs?: number; error?: string }> {
  const port =
    target.port ||
    (target.protocol === 'ssh'
      ? 22
      : target.protocol === 'winrm'
        ? 5985
        : target.protocol === 'db'
          ? target.dbEngine === 'mysql'
            ? 3306
            : 5432
          : 161);
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ reachable: false, error: 'timeout' });
    }, 5000);
    socket
      .connect(port, target.host, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve({ reachable: true, latencyMs: Date.now() - start });
      })
      .on('error', (err) => {
        clearTimeout(timer);
        resolve({ reachable: false, error: err.message });
      });
  });
}

async function executeFixCommand(target: TargetCredentials, command: string): Promise<string> {
  switch (target.protocol) {
    case 'ssh': {
      const result = await sshExec(target, command, 30000);
      return `exit code: ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
    }
    case 'winrm':
      return winrmExec(target, command);
    case 'db':
      return dbExecuteFix(target, command);
    default:
      throw new Error(
        `infra_execute_fix is not supported for protocol "${target.protocol}" — SNMP/ONVIF targets are read-only diagnostics only.`
      );
  }
}

function createMcpServer() {
  const server = new Server(
    { name: 'infra-rca-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(
    'tools/list',
    async (): Promise<ListToolsResult> => ({
      tools: [
        {
          name: 'infra_list_targets',
          description:
            'List configured infrastructure targets (name, protocol, host only — no credentials). Call this first to see what you can diagnose.',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'infra_diagnose',
          description:
            'Run read-only health diagnostics against a configured target over its native protocol (SSH for Linux/Unix, WinRM/PowerShell for Windows [best-effort], SNMP for network gear/printers/UPS via standard MIBs, direct connection for Postgres/MySQL). Returns structured metrics with status (ok/warning/critical) and a plain-language root-cause hypothesis when something is unhealthy. Never modifies anything.',
          inputSchema: {
            type: 'object',
            properties: {
              target_name: {
                type: 'string',
                description: 'Name of a target from infra_list_targets',
              },
              category: {
                type: 'string',
                enum: CATEGORY_ENUM,
                description: 'Which aspect of health to check',
              },
            },
            required: ['target_name', 'category'],
          },
        },
        {
          name: 'infra_ping_check',
          description:
            'Cheap TCP reachability/latency check for a target — use before a full diagnose, or as a lightweight scheduled watch condition.',
          inputSchema: {
            type: 'object',
            properties: { target_name: { type: 'string' } },
            required: ['target_name'],
          },
        },
        {
          name: 'infra_propose_fix',
          description:
            'Register a proposed remediation command for a target WITHOUT executing it. Use this after infra_diagnose to record the exact command you want to run, your reasoning, and a risk level. You MUST show the returned proposal (command + explanation + risk level) to the user and get their explicit go-ahead in the conversation before ever calling infra_execute_fix — never call infra_execute_fix on your own judgment alone.',
          inputSchema: {
            type: 'object',
            properties: {
              target_name: { type: 'string' },
              command: {
                type: 'string',
                description:
                  'The exact shell command (ssh/winrm targets) or SQL statement (db targets) you would run to fix the issue.',
              },
              explanation: {
                type: 'string',
                description: 'Why this command fixes the diagnosed root cause.',
              },
              risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
            },
            required: ['target_name', 'command', 'explanation', 'risk_level'],
          },
        },
        {
          name: 'infra_execute_fix',
          description:
            'Execute a PREVIOUSLY PROPOSED fix. Refuses unless proposal_id matches an unexpired proposal from infra_propose_fix for this exact target and confirm_fix is true. This tool will NOT run a different command than the one already shown to the user — if you need to change the command, call infra_propose_fix again first. Only call this after the user has explicitly approved the proposal in the conversation.',
          inputSchema: {
            type: 'object',
            properties: {
              target_name: { type: 'string' },
              proposal_id: {
                type: 'string',
                description: 'The proposal_id returned by infra_propose_fix',
              },
              confirm_fix: {
                type: 'boolean',
                description: 'Must be true — set only after the user has explicitly approved.',
              },
            },
            required: ['target_name', 'proposal_id', 'confirm_fix'],
          },
        },
      ],
    })
  );

  server.setRequestHandler('tools/call', async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params as {
      name: string;
      arguments?: Record<string, unknown>;
    };
    try {
      switch (name) {
        case 'infra_list_targets': {
          const targets = await listTargetNames();
          return { content: [{ type: 'text', text: JSON.stringify(targets, null, 2) }] };
        }

        case 'infra_diagnose': {
          const { target_name, category } = args as {
            target_name: string;
            category: DiagnosticCategory;
          };
          const target = await resolveTarget(target_name);
          const result = await diagnose(target, category);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'infra_ping_check': {
          const { target_name } = args as { target_name: string };
          const target = await resolveTarget(target_name);
          const result = await pingCheck(target);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'infra_propose_fix': {
          const { target_name, command, explanation, risk_level } = args as {
            target_name: string;
            command: string;
            explanation: string;
            risk_level: 'low' | 'medium' | 'high';
          };
          pruneExpiredProposals();
          // Confirm the target actually exists before registering a proposal against it.
          await resolveTarget(target_name);
          const proposalId = randomUUID();
          pendingProposals.set(proposalId, {
            targetName: target_name,
            command,
            explanation,
            riskLevel: risk_level,
            createdAt: Date.now(),
          });
          return {
            content: [
              {
                type: 'text',
                text: `Proposed fix registered (proposal_id: ${proposalId}, expires in 15 minutes).\n\nTarget: ${target_name}\nRisk: ${risk_level}\nCommand: ${command}\nExplanation: ${explanation}\n\nShow this to the user and get explicit approval before calling infra_execute_fix with this proposal_id.`,
              },
            ],
          };
        }

        case 'infra_execute_fix': {
          const { target_name, proposal_id, confirm_fix } = args as {
            target_name: string;
            proposal_id: string;
            confirm_fix: boolean;
          };
          pruneExpiredProposals();
          if (confirm_fix !== true) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: 'Refused: confirm_fix must be exactly true, and only after the user has explicitly approved the proposal in the conversation. Not executing anything.',
                },
              ],
            };
          }
          const proposal = pendingProposals.get(proposal_id);
          if (!proposal || proposal.targetName !== target_name) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `Refused: no matching unexpired proposal "${proposal_id}" for target "${target_name}". Call infra_propose_fix again and use the proposal_id it returns — this tool will not execute a command that was not explicitly proposed and shown to the user first.`,
                },
              ],
            };
          }
          const target = await resolveTarget(target_name);
          const output = await executeFixCommand(target, proposal.command);
          pendingProposals.delete(proposal_id);
          return {
            content: [
              {
                type: 'text',
                text: `Executed fix on "${target_name}":\n${proposal.command}\n\nOutput:\n${output}`,
              },
            ],
          };
        }

        default:
          return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: 'text', text: `❌ Error in ${name}: ${msg}` }] };
    }
  });

  return server;
}

serveStdio(() => createMcpServer(), {
  onerror: (error: Error) => {
    process.stderr.write(`[infra-rca-server] Fatal: ${error}\n`);
  },
});
