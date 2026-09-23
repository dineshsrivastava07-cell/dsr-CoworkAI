# Tableau integration

V-Coworker includes a built-in, read-only Tableau MCP connector and an AI analytical workspace for Retail, Merchandiser, and Planner users.

## Connection

1. Connect the computer to the Tableau premises network or VPN.
2. Open **AI Analytics** from the V-Coworker sidebar.
3. Select **Connection**.
4. Enter the Tableau Server URL, username, password, and site content URL. Leave the site content URL blank for Tableau's Default site.
5. Select **Save & test**, then **Refresh**.

The configured server defaults to `http://10.0.0.55:8000` and REST API version `3.27`, which corresponds to Tableau Server 2025.3. The password is write-only in the UI: after saving it is held in the encrypted Electron main-process store and is never returned to the renderer or exposed in an MCP tool call.

## V-Coworker tools

The built-in `Tableau` MCP server exposes these read-only tools:

- `tableau_analyze_question`: autonomously selects up to three question-relevant dashboards, reads bounded data, derives exact filters, and reports State/Zone/Region/Store coverage.
- `tableau_connection_status`: verifies network reachability and authentication.
- `tableau_list_views`: lists accessible Tableau views, workbooks, and projects.
- `tableau_get_view_data`: exports bounded, optionally filtered CSV data from a selected view for grounded analysis.
- `tableau_get_role_summary`: returns the saved summary for Retail, Merchandiser, or Planner.
- `tableau_refresh_role_summaries`: refreshes all role summaries from Tableau.

The MCP child process does not receive the Tableau username or password. It talks to the Electron main process through a loopback-only HTTP broker protected by a random bearer secret generated on every V-Coworker launch.

## Role summaries

Dashboard and workbook names are matched to role-specific business terms:

- **Retail:** sales, store, revenue, footfall, bills, margin, and growth.
- **Merchandiser:** assortment, styles/articles, sell-through, markdown, and ageing.
- **Planner:** plan, budget, forecast, OTB, weeks of cover, and allocation.

Role summaries use the versioned `vmart-role-kpi-v1` definition registry. A KPI is calculated only when an exported field matches an explicit, role-specific alias; each card shows the source view, source field, aggregation, loaded rows, exported rows, and truncation state. If no alias matches, the UI shows coverage only and does not infer a business KPI. When VPN or local access is unavailable, V-Coworker shows the last successful cached result as **Cached** and reports the connection limitation.

## AI analytical workspace

When the Tableau network is available, V-Coworker handles dashboard selection autonomously for each question. It ranks the authorized catalogue using the question, role/domain, dashboard metadata, readable data, and complementary State/Zone/Region/Store coverage, then selects at most three dashboards. Retail starts with **Festive Performance** and **Business Performance** as its default views. Users can still override the selection with the checkboxes in **Available views**, capped at three. One dashboard is the active visual workspace; all selected dashboards are included as separate, source-labelled packets. The workspace provides:

- Exact Tableau REST `vf_<field>` filters when the question contains a value observed in the exported data. The implementation follows Tableau's [Filtering and Sorting REST guidance](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm).
- Search and interactive field/value filters that apply to every KPI, chart, table, forecast, and chat question. For the other selected dashboards, only filters whose named fields exist in that export are applied; incompatible filters are explicitly omitted instead of producing a false empty population.
- Automatic numeric, date, and dimension detection from the selected Tableau export.
- A **Geographic analysis coverage** panel for State, Zone, Region, and Store. Tableau captions such as `ATTR(State Name)`, `Zone_Name`, `[Region]`, and `Store Name` are normalized. A governed filter that exists in Tableau but is not emitted in the selected CSV is shown as **Configured**, not **Not available**.
- Recomputed visible-row count, sum, average, median, minimum, and maximum for the selected metric.
- A top-category comparison and supporting record table with selectable headers.
- A three-period least-squares linear trend estimate when the filtered data contains at least three dates and a numeric metric. Forecast points are labelled as derived estimates, not observed actuals or causal predictions.
- An embedded **Ask V-Coworker** panel. Each question first calls the autonomous planner and then includes the selected view IDs, selection reasons, exact and interactive filters, geographic coverage, row coverage, current calculations, forecast method, and bounded samples. The prompt requires V-Coworker to compare sources only when definitions, periods, units, dimensions, and grain are compatible.
- Normal-chat grounding. Questions about analytics, dashboards, KPIs, sales, product, State, Zone, Region, Store, festive/business performance, or recommendations instruct the agent to call `tableau_analyze_question` before answering. When files are attached, the answer distinguishes file evidence from Tableau evidence and reconciles period, grain, unit, and definition differences.
- A decision-domain selector and pre-built questions for Retail, Zone, RM, Store Manager, Store Operations, Planning & SCM, Warehouse & Logistics, Finance, Digital/Omni, Marketing, Visual Merchandising, CRM, HR, Buying & Merchandising, Sourcing, and Loss Prevention.
- Governed Indian value-retail analysis guidance for season, festival windows, trends, weather, state, zone, region, store, community, and catchment. Festival/calendar and weather conclusions are made only when the required dated source fields are present; recommendations remain advisory and source-labelled.

The UI loads at most 1,000 records per selected dashboard for interactive exploration and always shows whether each Tableau export was truncated. Chat prompts contain no Tableau credentials. A model-backed chat may transmit the displayed bounded samples to the model provider configured in V-Coworker, subject to that provider's deployment and data policy.

## Operational notes

- Restart V-Coworker after installing or upgrading this integration so the built-in MCP server is loaded into new agent sessions.
- Tableau view permissions still apply. V-Coworker can analyze only views visible to the configured account.
- Dashboard calculations are based on the loaded, filtered export population. Treat results as sampled when the coverage label says the export is truncated.
- The connector performs no workbook, datasource, permission, or Tableau Server mutations.
- Use **Open Tableau** to launch the original Tableau Explore page in the default browser.

## Verification layers

- `npm run typecheck` and `npm run lint` validate the current TypeScript and renderer/main-process wiring.
- Tableau unit tests validate REST parsing, analytics, and the deterministic role KPI registry.
- The broker integration test binds a temporary loopback server and validates bearer authentication, routes, input bounds, and error mapping.
- The MCP integration test launches the bundled Tableau MCP over real stdio and executes all six tools through a temporary authenticated broker.
- `npm run verify:tableau:e2e` targets a running V-Coworker instance. It waits for packaged startup, refreshes summaries through the Electron main-process Tableau service, navigates to AI Analytics, waits for a live authenticated view export, and checks the sanitized dashboard state. It returns no Tableau credentials or row values.

## Live verification snapshot

Verified on 23 September 2026 while connected to the Tableau network:

- Authentication to the **Default** Tableau site succeeded.
- The configured account could list **606** authorized views.
- Read-only CSV export succeeded for representative Retail, Merchandiser, and Planner views.
- The bundled MCP negotiated protocol `2026-07-28`, exposed all six Tableau tools, authenticated through the loopback broker, and returned the 606-view catalogue.
- Initial encrypted summaries were saved for both the development and packaged V-Coworker profiles. The cached refresh covered 81,560 Retail rows, 35,835 Merchandiser rows, and 9,716 Planner rows across four prioritized views per role.
- The rebuilt, ad-hoc-signed macOS app passed the automated dashboard journey: authenticated, 606 views, an 8-row complete export, all three role summaries ready, and four Retail highlights using `vmart-role-kpi-v1`.
- The packaged checkbox journey selected and loaded three live dashboards (`Retail Performance-FMCG`, `OTB Summary`, and `System OTB Vs PO Detail`); the UI showed `3/3` and disabled additional unchecked dashboards.
- A packaged model-backed question requested comparison by State, Zone, Region, and Store. `tableau_analyze_question` autonomously selected `KPI-Store Performance`, `Ops Compliance- Zone/Region`, and `Retail Performance-FMCG`; the agent then called `tableau_get_view_data` for drill-down and returned source-linked findings, limitations, and evidence-based store recommendations.
- The live packet observed Zone, Region, and Store fields and values. State was correctly reported as a configured governed Tableau filter that the current CSV did not emit, rather than being falsely labelled unavailable.
- The complete local suite passed 188 files and 1,413 tests. Tableau-focused verification passed six files and 25 tests. TypeScript passed; lint reported zero errors and nine pre-existing warnings outside this integration.
- The rebuilt macOS application passed pre-build checks and deep signature verification. The 615 MB ULMO/LZMA disk image passed `hdiutil verify`.

This snapshot proves the connection and configured-account access at the stated time. Tableau permissions, dashboard contents, and network availability can change later.

## Troubleshooting

- **Unreachable or timed out:** connect to the approved VPN/local network and retry.
- **Authentication failed:** verify the username, password, and Tableau site content URL.
- **No matching views:** confirm view/workbook names contain relevant role terms, or ask V-Coworker to list views and analyze a specific view directly.
- **Cached badge:** the screen is showing the last successful refresh, not current Tableau data.
