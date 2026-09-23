# V-Coworker for V-Mart — Product and Engineering Roadmap

- Status date: 23 September 2026
- Repository: [dineshsrivastava07-cell/dsr-CoworkAI](https://github.com/dineshsrivastava07-cell/dsr-CoworkAI)
- Delivery branch: `agent/source-driven-office-artifacts`
- Detailed engineering backlog: [BACKLOG.md](./BACKLOG.md)

## Product charter

V-Coworker is V-Mart's branded AI coworker for retail, merchandising, planning, store operations, and IT support. It uses the approved V-Mart logo and the product name **V-Coworker** consistently across the application, installers, documentation, and support material.

The product should help V-Mart teams turn governed business data into decisions and complete approved knowledge-work tasks. It is not the system of record. Early releases keep Tableau, ERP, POS, inventory, HRMS, and finance access read-only or advisory. Any later mutation requires an approved API, explicit role permission, a human approval rule, an auditable transaction, and an independently verified business postcondition.

## Current baseline

### Verified now

- The rebuilt macOS Electron application is running locally as **V-Coworker** with the V-Mart logo and a valid ad-hoc code signature.
- The live UI provides chat, model switching, file attachment, conversation history, working-directory selection, and connector visibility.
- The packaged build exposes **V-Coworker AI Analytics** and runs the bundled Tableau MCP child alongside the existing connectors.
- Direct sign-in to the V-Mart Tableau Server succeeded on the status date and the Default site's Explore catalogue is accessible.
- The Tableau account exposes V-Mart project areas including Assortment Optimization, Business Review, Buying, Category Performance, Customer, FMCG, HR, Inventory, Inventory Fill, Live Sales, Operations, Sales, Sales Channel Performance, Space Productivity, and Store Audit.
- The repository contains headless execution, subagents, scheduled and reactive tasks, persistent memory, VM sandboxing, Office artifact generation, remote diagnostics, and RPA recipe support.
- The current working tree passes TypeScript checking and lint has zero errors (nine pre-existing warnings remain outside the Tableau change).
- The full test suite passes: 188 files and 1,413 tests. Tableau-focused verification passes 6 files and 25 tests, including a real stdio MCP-to-broker round-trip and model-packet compaction regression coverage.
- The packaged Tableau dashboard E2E passes against the live server: authenticated, 606 authorized views, an 8-row complete view export, all three role summaries ready, and four Retail highlights using `vmart-role-kpi-v1`. A separate packaged UI check loaded three selected live dashboards and disabled a fourth selection at the `3/3` limit.
- A packaged model-backed question invoked the autonomous Tableau tool, selected three complementary dashboards, performed source-specific drill-down, and returned source-linked findings and recommendations with explicit State/Zone/Region/Store coverage limits.
- GitHub is connected to `dineshsrivastava07-cell/dsr-CoworkAI`; `main` is the default branch. There are no open product issues and 11 open dependency-update pull requests as of the status date.

### Implemented in this branch; release acceptance remains

- Tableau includes Retail, Merchandiser, and Planner summaries; autonomous selection and manual checkbox selection of up to three dashboards; bounded multi-source CSV analysis; exact and compatible filters; geographic coverage; derived trend estimates; versioned source-labelled KPI calculations; and pre-built questions for 16 V-Mart decision domains.
- The MCP model packet is capped to a representative 60-row sample per selected view while preserving original coverage metadata; targeted drill-down remains available when the compact packet is insufficient.
- Provider/data-handling approval, least-privilege business UAT, KPI-owner approval, CI promotion, and a GitHub release artifact remain release gates.
- `BACKLOG.md` remains the detailed technical execution list.

## Gap summary

| Priority | Gap                                                                    | Why it matters                                                                                                                                                                        |
| -------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------- |
| P0       | Product identity is inconsistent                                       | The live UI says V-Coworker, while package and installer metadata still use `dsr-CoworkAI`; older `Open Cowork` labels remain. This causes support, upgrade, and user-trust problems. |
| P1       | Tableau code is packaged locally but not released or business-approved | Engineering E2E is proven; release promotion, model-provider data handling, least-privilege UAT, and KPI-owner approval remain.                                                       |
| P0       | Desktop vision bypasses the common GUI guard path                      | Emergency stop, protected-app checks, cancellation, and irreversible-action approval are not uniformly enforced.                                                                      |
| P0       | RPA can report action success without business success                 | Recipe replay returns success while the postcondition is still `unverified` or requires agent verification.                                                                           |
| P0       | Encrypted stores use source-known stable keys                          | Credentials need per-install OS-protected key material plus tested migration and rollback.                                                                                            |
| P1       | Recurring tasks can lose their next trigger during overlap             | A timer firing while the same task executes returns without re-arming the schedule.                                                                                                   |
| P1       | CI ignores critical dependency audit failures                          | `npm audit --audit-level=critical --omit=dev                                                                                                                                          |     | true` cannot act as a release gate. |
| P1       | Version and release naming disagree                                    | Package version `1.0.0`, roadmap `v3.x`, branch state, and installer naming do not describe one release train.                                                                        |
| P1       | Packaged Tableau smoke is proven, but broader V-Mart journeys are not  | The current evidence does not yet prove managed-device/VPN transitions, upgrades, model-provider approval, or business-owner read-back.                                               |

## Delivery roadmap

Durations are indicative engineering windows, not release promises. The sequence is dependency-based. Security and business-verification gates cannot be deferred to UAT.

### Phase 0 — Establish the V-Mart release baseline

- Target: Week 1
- Outcome: one product identity, one release definition, and one trusted evidence matrix.

- Standardize the visible name as **V-Coworker** and use the approved V-Mart logo in the live app, About screen, installer, application metadata, icons, documentation, and support bundle.
- Preserve the existing application ID and user-data migration path unless an explicit migration plan proves that changing them will not strand settings, credentials, schedules, or history.
- Replace obsolete user-facing `Open Cowork` references; retain compatibility-only names only where upgrade cleanup requires them.
- Choose one version train and align `package.json`, installer artifacts, About UI, release notes, and Git tags.
- Reconcile this roadmap, `BACKLOG.md`, and `roadmap-agent-platform.md`; historical designs must not be presented as open work.
- Define supported Windows and macOS versions, CPU architectures, VPN assumptions, Tableau version, and packaging targets.
- Create GitHub milestones and issues for the accepted roadmap items; the repository currently has no open product issues.

Exit gate:

- A packaged candidate displays V-Coworker and the V-Mart identity consistently.
- Every committed feature maps to an owner, milestone, acceptance journey, evidence location, and rollback path.
- Unit, integration, packaged-app, live-system, and business-UAT evidence are labelled separately.

### Phase 1 — Ship read-only V-Mart analytics

- Target: Weeks 2–3
- Outcome: Retail, Merchandiser, and Planner users can obtain governed, traceable insights from Tableau.

- Finish the Tableau working tree: resolve lint, review error handling, package the MCP server, and make the connector visible after restart.
- Map the observed Tableau projects to V-Coworker role journeys instead of relying only on keyword matching: Business Review/Sales/Live Sales for retail leadership, Assortment/Buying/Category Performance for merchandising, Inventory/Inventory Fill/Space Productivity for planning and allocation, Store Audit/Operations for field operations, and HR only under separately approved data handling.
- Validate the new multi-dashboard workspace with business owners: confirm comparable grains and KPI definitions, approve festival/calendar and weather sources, and tune the pre-built questions for Retail, Zone, RM, Store, Planning/SCM, Logistics, Finance, Omni, Marketing, VM, CRM, HR, Buying, Sourcing, and Loss Prevention.
- Externalize tenant defaults so server URL, site, API version, role mappings, and service account are deployment configuration rather than source-code assumptions.
- Use Tableau permissions as the first authorization boundary and add V-Coworker role entitlements for Retail, Merchandiser, Planner, and Admin surfaces.
- Agree a V-Mart KPI dictionary with business owners. Candidate measures include sales versus plan, like-for-like growth, sell-through, gross margin, ageing, stock cover, availability, markdown, inventory turns, OTB, and allocation; none becomes authoritative until its Tableau field and calculation owner are recorded.
- Show source workbook/view, filter context, data timestamp, row coverage, truncation, calculation method, and cached/live state with every insight.
- Keep trend projections explicitly labelled as derived estimates. Do not present them as causal forecasts or approved plans.
- Add exportable Excel/PPT management packs with source lineage and V-Mart branding.

Exit gate:

- The packaged app completes authentication, lists only authorized views, exports bounded data, refreshes all three role summaries, and answers a sourced question.
- VPN loss, expired credentials, insufficient permission, empty data, truncation, and stale-cache scenarios are visibly distinct.
- No Tableau credential reaches the renderer, child MCP request payload, model prompt, logs, or exported artifact.
- Named V-Mart Retail, Merchandising, and Planning users accept the KPI definitions and sample outputs.

### Phase 2 — Make automation safe and trustworthy

- Target: Weeks 3–6
- Outcome: scheduled and desktop workflows cannot claim completion without safe execution and verified results.

- Route click, type, drag, vision plans, and recipe replay through one guarded dispatcher.
- Enforce emergency stop, parent cancellation, active-application checks, protected-app policy, coordinate validation, confidence thresholds, and irreversible-action approval before dispatch.
- Prefer integration APIs and files, then browser DOM, Windows UI Automation/macOS Accessibility, OCR/image matching, and finally model vision.
- Replace free-text RPA success checks with executable postconditions such as record status, file hash, row/value read-back, window state, or approved API response.
- Separate `actions_completed` from `business_verified`; scheduled jobs succeed only when the required business postcondition passes.
- Re-arm skipped overlapping schedules and record queued, running, blocked, cancelled, failed, action-complete, verified, timed-out, and interrupted states.
- Move encrypted stores to a per-install master key protected by Keychain/DPAPI or an approved enterprise equivalent, with atomic migration and recovery tests.
- Make unexcepted critical production dependency advisories fail CI.

Exit gate:

- Behavioral tests prove that denial, cancellation, emergency stop, or low-confidence targeting dispatches no OS action.
- A long-running recurring job continues scheduling after an overlap.
- At least one file, browser/API, and native-desktop workflow demonstrates both passing and failing postconditions.
- Copying an encrypted credential store to another installation does not make it decryptable there.

### Phase 3 — Deliver V-Mart role workflows

- Target: Weeks 6–9
- Outcome: each pilot role receives repeatable workflows tied to a business decision, not a generic chatbot demo.

#### Retail and store operations

- Daily store/area/zonal performance brief with plan versus actual, exceptions, stock availability, ageing, and action owners.
- Store-manager question flow with source-linked answers and an escalation path when data is missing or stale.
- Approved morning brief from Tableau, email, calendar, and Drive with duplicate suppression and evidence of source freshness.

#### Merchandising and planning

- Category/style/article performance, sell-through, ageing, markdown, size/colour availability, and store-cluster comparison.
- Plan/forecast/OTB variance and allocation recommendations with assumptions, confidence, and human approval.
- Branded Excel and PowerPoint packs that retain source lineage and calculation notes.

#### IT operations

- Read-only health assessment for registered endpoints and infrastructure with explicit credential scope.
- Proposed remediation separated from execution; administrator approval and target-side postchecks are mandatory.
- Remote-support run history, redaction, retention, and incident export.

Exit gate:

- Each workflow has a named role owner, input system, decision, SLA, failure mode, postcondition, and measurable time/quality baseline.
- Recommendations cannot mutate POS, ERP, inventory, pricing, HRMS, finance, or Tableau without a separately approved integration design.
- Every management artifact can be traced back to the exact source view, filters, timestamp, and calculation.

### Phase 4 — Enterprise operations and distribution

- Target: Weeks 9–11
- Outcome: V-Coworker is supportable across a controlled V-Mart deployment.

- Integrate approved enterprise identity and role mapping; remove shared-account assumptions where platform support permits.
- Add structured audit events for sign-in, data access, prompts, tool calls, approvals, actions, verification, exports, and administrative changes.
- Define retention and redaction for chat, screenshots, logs, cached analytics, credentials, and generated artifacts.
- Add health telemetry for startup, connector availability, model latency, tool failures, schedule outcomes, cache freshness, and migration recovery without collecting business content by default.
- Reduce installer size and split high-risk modules such as `src/main/index.ts` and `gui-operate-server.ts` behind stable contracts.
- Qualify signed Windows and macOS packages, silent/managed deployment, updates, backup, restore, and rollback.
- Triage the 11 open Dependabot pull requests individually; major framework/runtime upgrades require dedicated compatibility testing.

Exit gate:

- IT can deploy, configure, update, roll back, diagnose, and recover V-Coworker using documented procedures.
- Support bundles redact secrets and business data by default.
- Upgrade testing preserves configuration, credentials, schedules, memory, and cached analytics or documents an approved migration.

### Phase 5 — Pilot, UAT, and staged rollout

- Target: Weeks 11–12
- Outcome: measurable pilot evidence supports a go/no-go decision.

- Start with a controlled cohort across Retail, Merchandising, Planning, and IT; avoid organization-wide enablement on the first release.
- Run packaged-app acceptance on V-Mart-managed endpoints and networks, including VPN/offline transitions and least-privilege accounts.
- Train users on source checking, cached-data labels, approval prompts, prohibited data, and escalation.
- Measure adoption, task completion, verified completion rate, manual time saved, answer-source coverage, forecast error where applicable, schedule reliability, connector failure rate, and safety blocks.
- Conduct security, privacy, business-owner, IT-support, and rollback sign-off.
- Promote through canary and staged rings with a defined stop/rollback threshold.

Exit gate:

- Zero unresolved P0 issues; accepted P1 exceptions have an owner, mitigation, and expiry.
- Representative V-Mart users complete the agreed journeys on packaged builds.
- Rollback is demonstrated, not only documented.
- Business owners approve KPI definitions and outputs; IT approves operability and recovery.

## Recommended first 10 working days

1. Freeze product naming and versioning decisions; keep the current app ID until migration is proven.
2. Review and commit the now lint-clean Tableau changes as a focused change set.
3. Promote the verified local package through CI and repeat the Tableau smoke on the release artifact.
4. Run sourced model-backed Q&A only after model-provider handling is approved, using a least-privilege V-Mart test account.
5. Capture the KPI dictionary workshop decisions for Retail, Merchandising, and Planning.
6. Implement the shared GUI action dispatcher and executable postcondition result model.
7. Fix recurring-task overlap and add terminal run-state history.
8. Replace source-known encryption keys with an OS-protected per-install key design and migration test plan.
9. Turn the accepted items into GitHub milestones/issues and assign owners.
10. Produce a signed pilot candidate and run the Phase 0/1 acceptance matrix.

## Pilot success measures

Targets must be agreed with V-Mart owners after a one-week baseline; values below are measurement categories, not invented commitments.

| Dimension      | Measure                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Business value | Median time saved per accepted workflow; reduction in manual report preparation; action closure time           |
| Trust          | Percentage of insights with source/view/filter/timestamp lineage; user-confirmed accuracy; stale-data rate     |
| Reliability    | Verified completion rate; recurring-task trigger success; connector availability; recovery time                |
| Safety         | Blocked unsafe actions; unverified-success count; credential/log leakage incidents; approval-policy violations |
| Adoption       | Weekly active users by role; repeat workflow use; accepted versus abandoned recommendations                    |
| Operations     | Crash-free sessions; startup success; update/rollback success; support tickets per active user                 |

## Global definition of done

A roadmap item is complete only when:

- implementation, migration, rollback, and focused tests are present;
- the changed boundary is verified behaviorally in its real target environment;
- mocked, local, packaged, live-system, and UAT evidence are clearly separated;
- security, privacy, accessibility, localization, logging, retention, timeout, retry, cancellation, and restart behavior are addressed where relevant;
- no credential, personal data, or V-Mart business data appears in logs, fixtures, screenshots, prompts, or evidence without explicit approved handling;
- user/admin documentation and release notes are updated;
- remaining risk and the accountable owner are recorded.

## Explicitly outside the current evidence

- The local packaged V-Coworker proves authenticated Tableau dashboard and model-tool operation, but no CI/GitHub release artifact has been accepted.
- The current evidence does not prove managed-device VPN transitions, expired/insufficient-permission journeys, approved model-provider data handling, upgrades, or V-Mart stakeholder acceptance.
- The versioned KPI registry is deterministic and source-labelled, but it is an engineering definition until V-Mart metric owners approve field aliases, aggregation rules, filters, and targets.
- No live ERP, POS, inventory, HRMS, pricing, payment, or finance mutation is authorized or claimed by this roadmap.
