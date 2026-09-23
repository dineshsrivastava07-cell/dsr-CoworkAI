# V-Coworker Phased Completion Backlog

Status date: 2026-09-23
Baseline: `agent/source-driven-office-artifacts` release candidate working tree
Scope: remaining engineering work required to move the current desktop agent, RPA, infrastructure, scheduling, remote-control, and agent-platform capabilities toward a production release.

## Planning assumptions

- Estimates are engineering effort, not calendar commitments. They assume two engineers with shared QA support.
- P0 blocks unattended or production use. P1 blocks release quality. P2 is planned product completion. P3 is strategic expansion.
- A backlog item is complete only when its acceptance criteria pass behaviorally. Source inspection or a mocked success response alone is not sufficient.
- Existing working-tree changes to the sandbox settings UI are treated as work in progress and must be preserved.
- APIs/files, browser DOM, and accessibility selectors are preferred over visual desktop automation. Vision remains a fallback for inaccessible interfaces.

## Current verified baseline

The following earlier findings are implemented in the current source and should not be reopened without a regression:

- Child sessions install permission hooks through `childSession.agent`, inherit the parent workspace, support the configured-model fallback, and receive the parent abort signal.
- Explicit permission denies override remembered session allows.
- Database diagnostics use conservative SQL screening plus database-enforced read-only transactions, bounded time, and bounded rows.
- Infrastructure fixes require an independently recorded, short-lived approval in addition to the proposal ID.
- Encrypted-store key rotation stages and verifies the replacement before atomically replacing the active file.
- MCP configuration changes invalidate cached tool definitions and cached agent sessions.
- Post-action visual verification requests a fresh screenshot instead of reusing the display cache.
- Manual context compaction, context usage, custom compaction instructions, HTTP/command watch tasks, and watch-task UI are implemented.

Focused verification on this baseline: 7 test files and 92 tests passed on 2026-09-18.

## Phase summary

| Phase | Objective                                  | Indicative duration | Exit gate                                                                                      |
| ----- | ------------------------------------------ | ------------------: | ---------------------------------------------------------------------------------------------- |
| 0     | Establish an accurate release baseline     |            3-5 days | Roadmaps, acceptance matrix, and test environments agree with current source                   |
| 1     | Close safety and security blockers         |           2-3 weeks | No known P0 bypass; mutation, desktop action, secrets, and CI boundaries pass behavioral tests |
| 2     | Make automation and scheduling reliable    |           2-3 weeks | Scheduled and desktop workflows report verified terminal outcomes across supported platforms   |
| 3     | Complete the agent-platform backlog        |           3-4 weeks | Headless, delegation, reactive checks, compaction, and skill lifecycle work end to end         |
| 4     | Harden product operations and distribution |           3-5 weeks | Maintainable modules, supported installers, observability, and controlled remote features      |
| 5     | Qualify and release                        |           1-2 weeks | Packaged-app E2E, migration, UAT, rollback, and release evidence are approved                  |

Phases are dependency ordered. Within a phase, independent items may run in parallel after their dependencies are satisfied.

## Phase 0 - Baseline and release definition

### BL-001 - Reconcile roadmap documents

- Priority: P1
- Estimate: 1-2 days
- Dependencies: none
- Work:
  - Update `ROADMAP.md` and `roadmap-agent-platform.md` so implemented capabilities are not listed as future work.
  - Resolve product/version inconsistencies between package metadata, roadmap versions, and release naming.
  - Link this backlog as the active execution plan and retain old designs only as historical context.
- Acceptance:
  - Computer use, scheduled tasks, subagents, headless mode, config tools, compaction, and reactive watch UI have accurate statuses.
  - Every open roadmap item maps to a backlog ID or is explicitly deferred/rejected.

### BL-002 - Define the supported runtime and test matrix

- Priority: P1
- Estimate: 1 day
- Dependencies: none
- Work:
  - Record supported macOS, Windows, and Linux versions; CPU architectures; Electron/Node ABI; sandbox backend; and packaging target.
  - Separate unit, Electron-native integration, packaged-app smoke, live desktop, and external-system tests.
- Acceptance:
  - Each CI or manual suite declares its environment and what it proves.
  - Native `better-sqlite3` tests run under the matching runtime and no ABI failure is classified as a product defect.

### BL-003 - Publish release acceptance and severity rules

- Priority: P1
- Estimate: 1 day
- Dependencies: BL-002
- Work:
  - Define P0-P3 severity, required evidence, supported/offline degradation, and release-blocking thresholds.
  - Define acceptance journeys for chat, tools, skills, MCP, sandbox, schedules, RPA, Infra RCA, memory, and remote access.
- Acceptance:
  - Every Phase 1-5 item has an owner, target release, test level, and evidence location before implementation starts.

## Phase 1 - Safety and security blockers

### SAFE-001 - Route all GUI mutations through one guarded dispatcher

- Priority: P0
- Estimate: 3-4 days
- Dependencies: BL-002
- Risk addressed: `gui_interact_vision` currently calls low-level actions directly, bypassing the ordinary click/type/drag guard path.
- Work:
  - Centralize emergency stop, cancellation, foreground denylist, irreversible-action approval, coordinate validation, and post-action verification.
  - Make ordinary tools, vision plans, and recipe replay use the same dispatcher.
  - Fail closed when the active application cannot be identified for a protected action.
- Acceptance:
  - Behavioral tests prove emergency stop and denylist protection for ordinary, vision, and replayed actions.
  - A cancelled vision plan cannot dispatch a later step.
  - Irreversible vision actions require the same explicit approval as direct clicks.

### SAFE-002 - Validate vision outputs before dispatch

- Priority: P0
- Estimate: 2-3 days
- Dependencies: SAFE-001
- Risk addressed: parsed boxes and confidence values are not fully validated for finite values, range, ordering, and display bounds.
- Work:
  - Reject non-numeric/NaN/infinite confidence or coordinates, inverted boxes, empty boxes, out-of-range normalized values, and invalid displays.
  - Use a configurable minimum confidence and require corroboration or user review for ambiguous targets.
  - Never silently clamp a model-generated unsafe target into a valid click.
- Acceptance:
  - Invalid or ambiguous model responses execute zero input actions.
  - Tests cover malformed JSON values, inverted/out-of-bounds boxes, multi-display scaling, and low confidence.

### SAFE-003 - Enforce executable business postconditions

- Priority: P0
- Estimate: 4-6 days
- Dependencies: SAFE-001
- Risk addressed: recipe replay can return `success: true` while `postconditionStatus` is `requires_agent_verification` or `unverified`.
- Work:
  - Define typed postconditions such as file exists/hash, record ID/status, row count/value, window state, and API response.
  - Separate `actions_completed` from `business_verified` in results and UI.
  - Prevent autonomous/scheduled runs from reporting completion until the postcondition passes.
- Acceptance:
  - Missing or failed postconditions produce a non-success terminal business status.
  - At least one file, browser/API, and desktop workflow has a failing and passing postcondition test.
  - Evidence links the asserted outcome to a fresh read-back, not only to action dispatch.

### SAFE-004 - Complete sandbox enablement and safe defaults

- Priority: P0
- Estimate: 3-5 days
- Dependencies: BL-002
- Status: in progress in the current working tree (`SettingsSandbox.tsx` and its test)
- Work:
  - Complete and review the settings toggle, rollback-on-save-error, readiness display, and runtime reload behavior.
  - Choose and document the first-run default. Prefer enabled when the platform backend is ready; otherwise make the degraded state explicit and approval-gated.
  - Add migration behavior for existing users and clear messaging for unsupported workspace paths.
- Acceptance:
  - A UI toggle changes the persisted setting and the next tool execution path, not only the displayed state.
  - Packaged macOS and Windows tests prove enabled containment and intentional disabled behavior.
  - No existing user setting is silently overwritten during upgrade.

### SAFE-005 - Replace application-wide hardcoded encryption keys

- Priority: P0
- Estimate: 5-8 days
- Dependencies: BL-002
- Work:
  - Use OS credential protection (Keychain/DPAPI/libsecret or an approved equivalent) for a per-install master key.
  - Migrate config, remote, Google tokens, RPA credentials, workflows, and Infra RCA stores without data loss.
  - Preserve atomic staging, verified replacement, backup, recovery, and rollback.
- Acceptance:
  - Copying an encrypted store to another installation does not make it decryptable with source-known constants.
  - Migration tests cover success, interruption, wrong key, rollback, and backup recovery.
  - Secrets never appear in logs, model prompts, exported safe config, or crash reports.

### SAFE-006 - Add behavioral execution-boundary tests

- Priority: P0
- Estimate: 5-7 days
- Dependencies: SAFE-001, SAFE-004
- Work:
  - Exercise the installed SDK path for parent and child permission denial/ask, tool interception, sandbox containment, cancellation, MCP abort, and trusted approvals.
  - Replace source-string assertions where they are currently the only protection.
- Acceptance:
  - Sentinel tools prove that denied or cancelled operations never reach the real implementation.
  - An MCP operation and a child session stop promptly after parent cancellation.
  - An infrastructure fix cannot execute with model-supplied confirmation alone.

### SAFE-007 - Make critical dependency failures fail CI

- Priority: P1
- Estimate: 1-3 days plus remediation time
- Dependencies: BL-002
- Work:
  - Remove `|| true` from the critical production dependency audit after triaging the current lockfile.
  - Add an exception mechanism requiring package, advisory, owner, expiry, and mitigation.
- Acceptance:
  - An unexcepted critical production advisory fails CI.
  - Approved exceptions are time-bound and visible in release evidence.

## Phase 2 - Automation and scheduling reliability

### REL-001 - Re-arm overlapping scheduled tasks

- Priority: P1
- Estimate: 2-3 days
- Dependencies: Phase 1 exit
- Risk addressed: when a timer fires while the same task is executing, `handleTrigger()` returns after deleting the timer and does not schedule the next occurrence.
- Work:
  - Define overlap policy: skip-and-rearm by default, with optional queue-one behavior.
  - Persist skipped/queued occurrence metadata for operator visibility.
- Acceptance:
  - Fake-timer tests prove a long-running recurring task continues to receive later schedules.
  - No task runs concurrently with itself unless explicitly configured.

### REL-002 - Record terminal scheduled-session outcomes

- Priority: P1
- Estimate: 4-6 days
- Dependencies: REL-001, SAFE-003
- Risk addressed: scheduler success currently records session creation, not the agent session's terminal result or business postcondition.
- Work:
  - Track queued, running, blocked, cancelled, failed, action-complete, business-verified, and timed-out states.
  - Link task runs to session completion and postcondition evidence.
  - Add maximum runtime and cancellation controls.
- Acceptance:
  - `lastRunAt`, status, error, session ID, and evidence reflect terminal completion.
  - App restart recovers or clearly marks interrupted runs.
  - Scheduled permission denial and timeout surface as failed/blocked, never successful.

### REL-003 - Add semantic desktop selector backends

- Priority: P1
- Estimate: 8-12 days
- Dependencies: SAFE-001
- Work:
  - Add general Windows UI Automation and macOS Accessibility selectors.
  - Define selector priority: API/file, browser DOM, desktop accessibility, OCR/image, vision.
  - Persist resilient selectors and use vision only when semantic targeting is unavailable.
- Acceptance:
  - Representative native Windows and macOS workflows replay after window movement and display scaling changes without vision.
  - Secure/inaccessible surfaces fail closed with a specific reason.

### REL-004 - Add image-model capability preflight

- Priority: P1
- Estimate: 2-3 days
- Dependencies: SAFE-002
- Work:
  - Validate the configured provider/model with a real image request before enabling vision workflows.
  - Report authentication, unsupported-model, payload, latency, and rate-limit failures separately.
- Acceptance:
  - Text-only connectivity cannot mark vision ready.
  - Settings show the last successful image preflight time and model identity.

### REL-005 - Build live desktop automation E2E coverage

- Priority: P1
- Estimate: 6-10 days
- Dependencies: REL-003, REL-004
- Work:
  - Run disposable, reversible workflows on packaged macOS and Windows builds; add Linux where supported.
  - Cover permissions, scaling, multiple displays, locked desktop, emergency stop, denylist, recovery, and fresh evidence.
- Acceptance:
  - Results distinguish mocked tests, live desktop tests, and production-system tests.
  - Failures leave the test target recoverable and produce screenshots/logs without secrets.

### REL-006 - Add run history and evidence retention controls

- Priority: P1
- Estimate: 4-5 days
- Dependencies: SAFE-003, REL-002
- Work:
  - Provide per-step timestamps, action/verification status, retries, screenshots, postconditions, and operator decisions.
  - Add retention limits, redaction, export, and deletion controls.
- Acceptance:
  - Operators can reconstruct why a run succeeded, failed, or was blocked.
  - Retention limits prevent unbounded screenshot/log growth.

## Phase 3 - Agent-platform completion

### PLAT-001 - Deliver a standalone Node headless package

- Priority: P2
- Estimate: 8-12 days
- Dependencies: Phase 1 exit, BL-002
- Work:
  - Extract the headless core from the Electron binary, provide production-safe path adapters, and build native dependencies for Node.
  - Preserve single-shot, JSONL, RPC, permission policy, cancellation, and exit-code semantics.
- Acceptance:
  - Runs in CI/container environments without a display server or Electron process.
  - CLI E2E covers allowed, denied, failed, cancelled, and successful tool runs.

### PLAT-002 - Complete subagent orchestration modes

- Priority: P2
- Estimate: 6-9 days
- Dependencies: SAFE-006
- Work:
  - Add bounded parallel and sequential/chain modes, aggregated usage, progress UI, and partial-failure policy.
  - Keep recursion disabled by default and retain non-interactive hard denies for protected mutations.
- Acceptance:
  - Concurrency limits, cancellation, tool restrictions, workspace inheritance, and partial failures pass integration tests.

### PLAT-003 - Add trusted agent definitions

- Priority: P2
- Estimate: 4-6 days
- Dependencies: PLAT-002
- Work:
  - Discover user and project agent definitions with schema validation.
  - Treat project-local prompts/config as untrusted and require review before first use or material change.
- Acceptance:
  - Invalid definitions cannot load.
  - Project definitions cannot expand tool or permission scope beyond the parent policy.

### PLAT-004 - Complete reactive watch types

- Priority: P2
- Estimate: 4-6 days
- Dependencies: REL-002, PLAT-002
- Work:
  - Add file checks and bounded agent-driven checks to the existing HTTP/command watch engine.
  - Add rate/cost budgets, backoff, deduplication, and structured change summaries.
- Acceptance:
  - Unchanged conditions do not start an action session.
  - Agent checks cannot mutate systems and cannot bypass scheduled-session permission rules.

### PLAT-005 - Complete compaction history and controls

- Priority: P2
- Estimate: 4-6 days
- Dependencies: none
- Work:
  - Store compaction history, summaries, token deltas, retained files, and effective instructions.
  - Add configurable thresholds/retention and a preview for manual compaction.
- Acceptance:
  - Users can inspect what was summarized and which context was retained.
  - Repeated compaction preserves decisions and recent tool-call/result pairs.

### PLAT-006 - Implement skill-managed MCP lifecycle

- Priority: P2
- Estimate: 4-6 days
- Dependencies: SAFE-006
- Risk addressed: `SkillsManager.startMcpServer()` and graceful shutdown are placeholders that log success without starting a process.
- Work:
  - Either implement supervised start/health/stop/restart or remove the nonfunctional lifecycle API and route all servers through `MCPManager`.
- Acceptance:
  - A reported running server has a live process/connection and usable tool call.
  - Crash, shutdown, duplicate start, environment sanitation, and secret handling are tested.

### PLAT-007 - Complete remote rich-input handling

- Priority: P2
- Estimate: 5-8 days
- Dependencies: SAFE-005
- Work:
  - Securely download/validate images and files, enforce size/type limits, scan or quarantine as required, and add approved voice transcription.
  - Preserve provenance and avoid fetching arbitrary untrusted URLs from the agent path.
- Acceptance:
  - Remote image/file content reaches the agent as validated content blocks.
  - Oversized, unsupported, expired, or malicious attachments fail safely.

## Phase 4 - Product operations and distribution

### OPS-001 - Reduce installer and first-run footprint

- Priority: P2
- Estimate: 8-12 days
- Dependencies: BL-002
- Work: lazy-load optional runtimes/SDKs, remove unused packaged files, and measure cold start and download impact.
- Acceptance: size and startup targets are agreed and measured on every supported installer; optional downloads are checksummed and recoverable.

### OPS-002 - Split high-risk god files

- Priority: P2
- Estimate: 8-12 days
- Dependencies: Phase 2 exit
- Work: extract coherent modules from `index.ts` and `gui-operate-server.ts` without changing public contracts.
- Acceptance: focused behavioral tests stay green; ownership boundaries and dependency directions are documented; no broad unrelated rewrite.

### OPS-003 - Provide first-class Linux packaging

- Priority: P2
- Estimate: 8-12 days
- Dependencies: BL-002, REL-005
- Work: package supported distributions, declare X11/Wayland limitations, and verify sandbox/desktop prerequisites.
- Acceptance: install, update, rollback, core chat/tool, and supported desktop tests pass on the declared Linux matrix.

### OPS-004 - Finish controlled remote-channel support

- Priority: P2
- Estimate: 6-10 days per channel
- Dependencies: SAFE-005, PLAT-007
- Work: implement channel-specific group policy and add only prioritized channels with pairing, revocation, audit, and rate limits.
- Acceptance: each channel has verified signature/auth handling, tenant/user isolation, permission prompts, and revocation tests.

### OPS-005 - Add opt-in remote tunnel support

- Priority: P3
- Estimate: 5-8 days
- Dependencies: OPS-004
- Work: define the threat model before choosing a tunnel provider; require explicit enablement, strong authentication, expiry, and visible exposure state.
- Acceptance: the gateway never becomes public by default; penetration and abuse-case tests cover replay, brute force, token leakage, and stale tunnels.

### OPS-006 - Complete plugin and workspace-template foundations

- Priority: P3
- Estimate: 10-15 days
- Dependencies: PLAT-006
- Work: signed/verified plugin metadata, capability declarations, scoped permissions, install/update/remove lifecycle, and versioned workspace templates.
- Acceptance: an untrusted plugin cannot gain undeclared filesystem, network, secret, or tool access; rollback works after a failed update.

### OPS-007 - Finish distribution polish

- Priority: P3
- Estimate: 2-4 days
- Dependencies: OPS-003
- Work: add the Windows tray icon, validate branding/version metadata, and remove inaccurate legacy naming from repository-owned product surfaces without changing external/protected tooling.
- Acceptance: packaged app names, icons, versions, update channels, and documentation agree on every supported platform.

## Phase 5 - Release qualification and rollout

### RELEASE-001 - Run the full quality gate

- Priority: P0
- Estimate: 3-5 days
- Dependencies: Phase 1 and Phase 2 exit; selected Phase 3/4 scope complete
- Acceptance:
  - Typecheck, lint, unit, Electron-native integration, packaged smoke, dependency audit, and migration suites pass.
  - Known warnings and skipped tests have owners, reasons, and expiry dates.

### RELEASE-002 - Verify upgrade, backup, and rollback

- Priority: P0
- Estimate: 2-3 days
- Dependencies: SAFE-005, RELEASE-001
- Acceptance:
  - Upgrade from the last supported release preserves config, credentials, sessions, memory, schedules, recipes, and connectors.
  - Failed migration and app rollback procedures are rehearsed with documented recovery points.

### RELEASE-003 - Execute representative UAT

- Priority: P0
- Estimate: 3-5 days
- Dependencies: RELEASE-001, RELEASE-002
- Work:
  - Run approved, reversible journeys for office artifacts, scheduled work, infrastructure diagnosis, and RPA.
  - For retail/business pilots, use reconciled data and human-reviewed exceptions; do not enable unattended ERP, stock, price, or infrastructure changes until target-specific acceptance passes.
- Acceptance:
  - Stakeholders record pass/fail against predefined outcomes and evidence.
  - UAT execution is distinguished from stakeholder acceptance and production authorization.

### RELEASE-004 - Stage release and post-release monitoring

- Priority: P0
- Estimate: 2-3 days plus observation window
- Dependencies: RELEASE-003
- Acceptance:
  - Signed artifacts, checksums, release notes, rollback package, and support runbook are available.
  - Canary/staged rollout monitors crashes, failed starts, tool errors, schedule failures, and migration recovery before broad promotion.

## Recommended first delivery slice

Start with this dependency path:

1. BL-001 to BL-003: establish the accurate baseline and evidence rules.
2. SAFE-001 to SAFE-004: close desktop-action, business-verification, and sandbox blockers.
3. SAFE-006 and SAFE-007: prove enforcement and make regressions release-blocking.
4. REL-001 and REL-002: make scheduled execution lifecycle trustworthy.
5. REL-003 to REL-005: move desktop automation from vision-first behavior to semantic-first, live-verified operation.
6. RELEASE-001 to RELEASE-004: qualify and stage the resulting release.

SAFE-005 can proceed in parallel after its migration and rollback design is approved. Phase 3 and Phase 4 should not delay the first safe release unless their features are included in that release's committed scope.

## Global definition of done

Every completed backlog item must include:

- implementation and narrowly scoped tests;
- behavioral evidence at the boundary being changed;
- updated user/admin documentation and migration notes where applicable;
- no secrets or personal data in logs, fixtures, screenshots, or evidence;
- explicit handling of cancellation, timeout, retry, partial failure, and restart where relevant;
- accessibility and localization review for user-facing UI;
- release note, rollback impact, and remaining-risk statement;
- final verification on the supported runtime, not only source inspection.
