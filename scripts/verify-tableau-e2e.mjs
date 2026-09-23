const baseUrl = (process.env.V_COWORKER_NAV_URL || 'http://127.0.0.1:19888').replace(/\/$/, '');
const timeoutMs = Number(process.env.TABLEAU_E2E_TIMEOUT_MS || 180_000);

async function readJson(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: init?.signal || AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`);
  }
  return body;
}

async function waitForApp() {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'V-Coworker navigation server did not become ready.';
  while (Date.now() < deadline) {
    try {
      return await readJson('/status');
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(lastError);
}

async function waitForDashboard() {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'Dashboard did not report a state.';
  while (Date.now() < deadline) {
    try {
      const status = await readJson('/tableau-status');
      if (
        status.mounted &&
        status.configured &&
        status.authenticated &&
        status.viewCount > 0 &&
        status.selectedViewCount > 0 &&
        status.selectedViewCount <= 3 &&
        status.selectedViewId &&
        status.loadedRows > 0 &&
        status.roleSummaryStatus === 'ready' &&
        status.roleDefinitionVersion === 'vmart-role-kpi-v1'
      ) {
        return status;
      }
      lastError = `Dashboard not ready: ${JSON.stringify(status)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(lastError);
}

await waitForApp();
const refresh = await readJson('/tableau-refresh', { method: 'POST' });
for (const role of ['retail', 'merchandiser', 'planner']) {
  if (refresh.roles?.[role]?.definitionVersion !== 'vmart-role-kpi-v1') {
    throw new Error(`Tableau ${role} summary did not use vmart-role-kpi-v1.`);
  }
}
await readJson('/navigate?page=tableau');
const status = await waitForDashboard();
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      page: 'tableau',
      authenticated: status.authenticated,
      viewCount: status.viewCount,
      selectedViewCount: status.selectedViewCount,
      selectedViewIds: status.selectedViewIds,
      selectedViewId: status.selectedViewId,
      selectedViewName: status.selectedViewName,
      loadedRows: status.loadedRows,
      totalRows: status.totalRows,
      truncated: status.truncated,
      activeRole: status.activeRole,
      roleSummaryStatus: status.roleSummaryStatus,
      roleHighlightCount: status.roleHighlightCount,
      roleDefinitionVersion: status.roleDefinitionVersion,
    },
    null,
    2
  )}\n`
);
