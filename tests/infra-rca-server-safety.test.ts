import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// infra-rca-server.ts calls serveStdio() at module load time (like
// office-tools-server.ts and gui-operates-server.ts), so it cannot be
// directly imported in a test without starting a live MCP stdio server.
// Following the same established convention as
// tests/office-tools-source-driven.test.ts, this asserts on the source text
// itself to verify the safety-critical properties: infra_execute_fix must
// never run without both an explicit confirm_fix and a matching proposal_id
// from a real infra_propose_fix call, independent of Autonomous Mode.
const serverPath = path.resolve(process.cwd(), 'src/main/mcp/infra-rca-server.ts');
const source = readFileSync(serverPath, 'utf8');

describe('infra-rca-server safety properties', () => {
  it('never executes a fix from infra_propose_fix — it only registers a proposal', () => {
    const proposeCaseMatch = source.match(
      /case 'infra_propose_fix': \{([\s\S]*?)\n {8}\}\n\n {8}case/
    );
    expect(proposeCaseMatch).not.toBeNull();
    const proposeBody = proposeCaseMatch![1];
    expect(proposeBody).not.toContain('executeFixCommand');
    expect(proposeBody).not.toContain('sshExec');
    expect(proposeBody).not.toContain('winrmExec');
    expect(proposeBody).not.toContain('dbExecuteFix');
  });

  it('refuses infra_execute_fix unless confirm_fix is exactly true', () => {
    expect(source).toContain('if (confirm_fix !== true) {');
    expect(source).toContain('Refused: confirm_fix must be exactly true');
  });

  it('refuses infra_execute_fix unless proposal_id matches a real prior proposal for that target', () => {
    expect(source).toContain('const proposal = pendingProposals.get(proposal_id);');
    expect(source).toContain('if (!proposal || proposal.targetName !== target_name)');
    expect(source).toContain('Refused: no matching unexpired proposal');
  });

  it('expires proposals instead of keeping them valid forever', () => {
    expect(source).toContain('PROPOSAL_TTL_MS');
    expect(source).toContain('pruneExpiredProposals');
  });

  it('executes only the exact previously-proposed command, not a freshly-supplied one', () => {
    // infra_execute_fix's schema must not accept an arbitrary "command" field —
    // only proposal_id, so the model cannot substitute a different command at
    // execution time than what was actually shown to the user for approval.
    const executeToolSchemaMatch = source.match(
      /name: 'infra_execute_fix',[\s\S]*?required: \[(.*?)\]/
    );
    expect(executeToolSchemaMatch).not.toBeNull();
    expect(executeToolSchemaMatch![1]).not.toContain('command');
    expect(source).toContain('const output = await executeFixCommand(target, proposal.command);');
  });

  it('never passes credentials through the model — resolves targets by name via the broker only', () => {
    expect(source).toContain('INFRA_RCA_BROKER_PORT');
    expect(source).toContain('INFRA_RCA_BROKER_SECRET');
    expect(source).not.toContain('password');
    expect(source).not.toContain('secret:');
  });

  it('documents that Autonomous Mode cannot bypass this refusal', () => {
    expect(source.toLowerCase()).toContain('autonomous mode');
  });

  it('auto re-diagnoses after executing a fix when the proposal carries a category', () => {
    const executeCaseMatch = source.match(
      /case 'infra_execute_fix': \{([\s\S]*?)\n {8}\}\n\n {8}default:/
    );
    expect(executeCaseMatch).not.toBeNull();
    const executeBody = executeCaseMatch![1];
    expect(executeBody).toContain('if (proposal.category) {');
    expect(executeBody).toContain('diagnose(target, proposal.category)');
    expect(executeBody).toContain('Post-fix verification');
    // category is optional — behavior for proposals without one is unchanged.
    expect(source).toContain('category?: DiagnosticCategory;');
  });

  it('only allows read-only queries through infra_query_db, never through the propose/execute path', () => {
    expect(source).toContain(
      "import { diagnoseDb, dbExecuteFix, dbQuery } from './infra-drivers/db-driver';"
    );
    const queryCaseMatch = source.match(/case 'infra_query_db': \{([\s\S]*?)\n {8}\}\n\n {8}case/);
    expect(queryCaseMatch).not.toBeNull();
    expect(queryCaseMatch![1]).toContain('await dbQuery(target, sql)');
  });
});
