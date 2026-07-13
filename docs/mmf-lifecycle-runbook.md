# MMF Studio Full-Lifecycle Acceptance Harness — Runbook

## Overview

This harness verifies the complete Paperclip project lifecycle contract (`docs/specs/paperclip-project-lifecycle-contract.md`) through 14 deterministic phases, using synthetic workspaces only, and repeating up to 3 independent project runs.

**Key properties:**
- `--dry-run` mode: deterministic fake simulation with isolated in-memory state
- `--live` mode: **always fails closed** in the CLI, regardless of environment flags
- `--preflight` mode: GET-only checks against an explicit Paperclip URL/company; mutation routes are schema-verified only
- Synthetic workspaces only (never touches real client data)
- Board hire-approval and bounded-decision simulation (via polling)
- Fail-closed on unexpected gates and capability blockers
- One complete Director → Orchestrator → specialists → manager review → Board decision → closure/offboarding lifecycle
- repeat=3 independent projects
- Machine-readable receipts for all 14 phases
- Dry-run receipts assert zero active runs/pending gates and the required termination order
- Equivalent real-Lab closure invariants are targets, not yet live-certified
- History never deleted

---

## Quick Start

```bash
cd /tmp/mmf-lifecycle-harness-approved/apps/studio-web

# Dry-run (default — safe, no mutations, always works)
npm run acceptance:lifecycle:dry-run

# Three independent project runs
npm run acceptance:lifecycle:repeat3

# Run GET-only route preflight against the isolated Lab
npm run acceptance:lifecycle:preflight

# Prove live mode fails closed before any mutation
node scripts/run-full-lifecycle-acceptance.ts --live

# Show help
node scripts/run-full-lifecycle-acceptance.ts --help
```

---

## Modes

### `--dry-run` (default and only working mode for simulation)

Runs the full 14-phase lifecycle using `FakePaperclip` — a pure in-memory, deterministic simulation. No network, no filesystem, no real Paperclip.

- Same inputs → same outputs every time
- Isolated per run
- Fast (~seconds)
- Full 14-phase contract exercised
- Machine-readable receipts produced

### `--live` (unconditionally disabled)

The CLI exits non-zero before constructing an adapter or orchestrator. Setting `LIVECLI_ORCHESTRATOR_ENABLED=true` does not bypass this block.

`RealLifecycleOrchestrator` has a separate constructor activation gate and requires a `dryRun: false` adapter as defense in depth, but it is not wired to the CLI and is not release-approved. Enabling it requires an explicit code change after independent review—not an environment variable alone.

The `RealLifecycleOrchestrator` uses the `PaperclipLifecycleAdapter` for all live operations:
- Project creation, issue creation, status updates, comments
- Agent hire via `trustedTemplateHire`
- Board approval creation and polling (bounded, max 60 × 5s = 5 minutes)
- Board interaction creation and polling (bounded, same limits)
- Agent termination (specialists first, orchestrator last)
- Watchdog deletion
- Project archival via PATCH `{ archivedAt }` (no DELETE)

### `--preflight` (GET-only route inventory)

Probes the Paperclip server with GET-only requests. Produces a capability matrix showing which routes are schema-verified (in OpenAPI) vs. unsupported (absent). Exits 0 on success.

---

## Architecture

```
run-full-lifecycle-acceptance.ts
├── lifecycle-contract.ts           # Phase definitions + machine-readable receipt schema
├── fake-adapter.ts               # Deterministic isolated Paperclip adapter (fake only)
├── paperclipAdapter.ts           # Route-accurate Paperclip API adapter (dryRun-aware)
├── paperclipAdapter.test.ts      # Exact method/path/body + safety/read-back contract tests
├── RealLifecycleOrchestrator.ts  # Paperclip-backed candidate; not CLI-wired or approved
└── RealLifecycleOrchestrator.test.ts  # Mock-HTTP orchestrator tests
```

### Components

#### `lifecycle-contract.ts`
- Defines all 14 lifecycle phases (from paperclip-project-lifecycle-contract.md)
- Phase receipt schema (machine-readable JSON)
- Exit gate predicates
- Termination order rules
- Invariant checkers

#### `fake-adapter.ts`
- Deterministic, pure in-memory Paperclip simulation
- Simulates Director, Project Orchestrator, Specialists
- Simulates Board approvals (auto-approve for synthetic)
- Simulates issue state transitions
- No network calls, no file system changes
- Always starts from a clean isolated state

#### `paperclipAdapter.ts`
- Route-accurate Paperclip API adapter
- All routes verified against `/tmp/paperclip-openapi.json`
- `dryRun` mode: returns synthetic responses without HTTP calls
- Route-specific read-back helpers; the orchestrator must still verify every phase exit authoritatively
- Safety gates at construction: `safetyAcknowledgement` required, company allowlist enforced
- **Does NOT**: auto-approve, simulate Board decisions, or issue DELETE on projects

#### `RealLifecycleOrchestrator.ts`
- Paperclip-backed 14-phase candidate under review
- Uses `PaperclipLifecycleAdapter` for all live operations
- Constructor gate: `LIVECLI_ORCHESTRATOR_ENABLED=true` plus a `dryRun: false` adapter
- CLI remains unconditionally blocked even when that environment variable is set
- Requires `PaperclipLifecycleAdapter` with `dryRun: false`
- Bounded Board polling: 60 attempts × 5s = 5 minutes max per approval/interaction gate
- **CAPABILITY_BLOCKER**: phases 3, 6, and 11 fail with precise blockers if Board doesn't respond in time
- Best-effort cleanup attempts specialists → orchestrator → archive; cleanup success must not be assumed without read-back
- Director is NEVER terminated
- No DELETE /api/projects — always PATCH `{ archivedAt }`

---

## The 14 Lifecycle Phases

| # | Phase | Owner | Entry trigger | Exit condition | Real API calls | Capability Blocker |
|---|---|---|---|---|---|---|
| 1 | Intake | Director | Brief received | Bootstrap issue is `todo` under Director | `POST /issues`, `GET /issues` | — |
| 2 | Workspace + project bootstrap | Director | Bootstrap plan valid | Project created and read-back matches | `POST /projects`, `GET /projects` | — |
| 3 | Project Orchestrator hire | Director | Project workspace exists | Board approves `hire_agent` approval | `POST /approvals`, `GET /approvals`, `POST /agent-hires`, `GET /agents` | **Board approval timeout** |
| 4 | Project setup | Project Orchestrator | Director moves setup issue to `todo` | Setup documents created | `POST /issues`, `PATCH /issues`, `POST /issues/{id}/comments` | — |
| 5 | Specialist request | Project Orchestrator | Scoped activity requires specialist | Director-review child issues are `todo` + parent blocked | `POST /issues`, `PATCH /issues` | — |
| 6 | Specialist validation + hire | Director | Director-review child wakes | Board approves each `hire_agent` approval | `POST /approvals`, `GET /approvals`, `POST /agent-hires`, `GET /agents` | **Board approval timeout** |
| 7 | Activation handoff | Director + Paperclip | Hire approval accepted | Specialists active; Director children marked done | `PATCH /issues` | — |
| 8 | First assignment | Project Orchestrator | Verified activation | Specialist assigned to activity | `POST /issues` | — |
| 9 | Specialist production | Specialist | Assigned `todo` | Artifact produced; issue `in_review` | `PATCH /issues`, `POST /issues/{id}/comments` | — |
| 10 | Orchestrator review | Project Orchestrator | Specialist handoff | Internal quality gate passes | `GET /issues`, `PATCH /issues` | — |
| 11 | Chris review | Project Orchestrator | Human gate reached | Board responds to interaction | `POST /issues`, `POST /issues/{id}/interactions`, `GET /issues/{id}/interactions`, `PATCH /issues` | **Board interaction timeout** |
| 12 | Revision or next-activity | Orchestrator + Specialist | Review accepted or changes requested | Revised artifact OR next activity starts | (no new calls) | — |
| 13 | Final handoff | Project Orchestrator | All approvals accepted | Final artifact verified | `POST /issues/{id}/comments` | — |
| 14 | Project closure | Project Orchestrator | All activities complete | Specialists terminated (first); orchestrator terminated (last); project archived | `DELETE /watchdog`, `POST /agents/{id}/terminate` × N, `PATCH /projects` | — |

---

## Receipt Format

Each phase emits a receipt:

```json
{
  "kind": "mmf-lifecycle-phase-receipt",
  "version": "1.0",
  "projectId": "mmf-acceptance-20260713-run1",
  "projectIndex": 1,
  "phase": 3,
  "phaseName": "project-orchestrator-hire",
  "status": "passed",
  "owner": "Director",
  "agentId": "director-raw-id",
  "issueId": "bootstrap-issue-id",
  "runId": "run-id",
  "receipts": {
    "approval": { "type": "hire_agent", "id": "approval-id", "status": "approved" },
    "issue": { "id": "issue-id", "status": "todo" },
    "agent": { "id": "agent-id", "status": "active" }
  },
  "gates": [
    { "name": "approval_submitted", "status": "passed" }
  ],
  "invariantViolations": [],
  "startedAt": "2026-07-13T00:00:00.000Z",
  "finishedAt": "2026-07-13T00:00:01.000Z",
  "deterministic": false
}
```

Final project receipt:

```json
{
  "kind": "mmf-lifecycle-project-receipt",
  "version": "1.0",
  "projectId": "mmf-acceptance-20260713-run1",
  "projectIndex": 1,
  "status": "completed",
  "phases": [/* 14 phase receipts */],
  "terminationOrder": ["specialist-001", "specialist-002", "orchestrator"],
  "permanentAgentsRetained": ["director"],
  "watchdogRemoved": true,
  "activeRunsAtClose": 0,
  "pendingApprovalsAtClose": 0,
  "pendingInteractionsAtClose": 0,
  "recoveryActionsAtClose": 0,
  "invariantViolations": [],
  "startedAt": "2026-07-13T00:00:00.000Z",
  "finishedAt": "2026-07-13T00:10:00.000Z"
}
```

---

## Exit Gate Predicates (Phase 14 — Closure)

The project is cleanly closed when ALL are true:

1. `scopedActivityComplete` — all scoped activities are `done`, `cancelled`, or `deferred`
2. `noPendingHireApproval` — no pending `hire_agent` approval exists
3. `noPendingReviewInteraction` — no pending `ask_user_questions` interaction exists
4. `noActiveRuns` — no queued or running heartbeat runs for project-scoped agents
5. `noUnexplainedBlockedIssues` — no `blocked` issues without a named unblock owner
6. `watchdogRemoved` — the project watchdog has been explicitly removed via DELETE
7. `specialistsTerminated` — all project specialists are `terminated`
8. `orchestratorTerminatedLast` — Project Orchestrator is `terminated`
9. `directorRetained` — Director remains `active` / not terminated
10. `historyPreserved` — no records were deleted (history is append-only)

---

## Board Simulation Rules (--dry-run only)

For synthetic projects:

1. **Hire approvals**: Always auto-approved after a deterministic delay (1 tick)
2. **Decision simulation**: When Orchestrator requests a Board decision, the harness auto-selects `move_forward_with_limits` after a deterministic delay
3. **No real notifications sent**: All Board interactions are simulated in-memory

**For --live mode**: The orchestrator polls the real Paperclip API. Board approvals and interactions are handled by a human operator or external system. The orchestrator waits up to 5 minutes (60 × 5s polling) before declaring a `CAPABILITY_BLOCKER`.

---

## Fail-Closed Behavior

If an unexpected gate is encountered (a phase expects X but observes Y):

1. The harness records the invariant violation
2. The phase transitions to `failed` status
3. The run aborts (does not continue to next phase)
4. Best-effort cleanup runs (terminates specialists, then orchestrator, archives project)
5. The receipt is marked with the violation details
6. Final report includes all violations

### Capability Blockers

When Board governance semantics make a phase impossible (no human-in-loop route), the orchestrator fails with a precise `CAPABILITY_BLOCKER` rather than simulating:

| Phase | Blocker | Reason |
|-------|---------|--------|
| 3 | `CAPABILITY_BLOCKER: board_timeout` | Board did not approve orchestrator hire within 60 × 5s polling |
| 6 | `CAPABILITY_BLOCKER: board_timeout` | Board did not approve specialist hire(s) within 60 × 5s polling |
| 11 | `CAPABILITY_BLOCKER: board_interaction_timeout` | Board did not respond to review interaction within 60 × 5s polling |

---

## Fake Adapter Behavior

The fake adapter (`fake-adapter.ts`) provides:

- `FakePaperclip` — in-memory Paperclip simulation
- `FakeBoard` — simulated Board approvals
- `FakeAgentRegistry` — tracks agent creation / termination state
- `FakeIssueGraph` — tracks issue hierarchy and state transitions
- `FakeRunEngine` — deterministic run simulation

All fake adapters are:
- **Deterministic**: Same inputs → same outputs, every time
- **Isolated**: No shared state between runs
- **Fast**: No real network or file I/O
- **Inspectable**: Full state visible in memory for assertions

---

## RealLifecycleOrchestrator

The `RealLifecycleOrchestrator` uses `PaperclipLifecycleAdapter` for live Paperclip operations. It is the production-grade engine for running the 14-phase lifecycle against a real Paperclip company (MMF Studio Lab).

### Activation Gate

The orchestrator is **fail-closed** by default. To enable live execution:

```bash
# BEFORE running, set in parent environment:
export LIVECLI_ORCHESTRATOR_ENABLED=true

# Then run with --live (requires --safety-acknowledgement and valid --paperclip-url):
node scripts/run-full-lifecycle-acceptance.ts --live \
  --paperclip-url=http://127.0.0.1:3111 \
  --safety-acknowledgement
```

The `LIVE_ACTIVATION_GATE` constant is checked at **construction time**, before any HTTP call is made. This prevents `--live` from ever reaching the network without explicit parent enablement.

### Polling

Board approval and interaction gates are polled with bounded retries:
- **Polling interval**: 5 seconds
- **Max attempts**: 60 (5 minutes total)
- After max attempts: `CAPABILITY_BLOCKER` is recorded and phase fails

### Cleanup on Failure

If a phase fails mid-execution, `bestEffortCleanup()` runs:
1. Terminates all specialists (in any order)
2. Terminates the orchestrator
3. Removes the watchdog
4. Archives the project via `PATCH { archivedAt }`

Director is **never** terminated. Cleanup failures are logged but do not throw.

### No DELETE /api/projects

Project cleanup always uses `PATCH /api/projects/{id}` with `{ archivedAt: <timestamp> }`. The DELETE /api/projects route does not exist in Paperclip OpenAPI and is never called.

---

## Testing

```bash
cd /tmp/mmf-lifecycle-harness-approved/apps/studio-web

# Run lifecycle unit tests (vitest)
npx vitest run scripts/lifecycle/lifecycle.test.ts
npx vitest run scripts/lifecycle/paperclipAdapter.test.ts
npx vitest run scripts/lifecycle/RealLifecycleOrchestrator.test.ts

# Dry-run acceptance harness (3 projects)
npm run acceptance:lifecycle:repeat3

# Single dry-run
npm run acceptance:lifecycle:dry-run

# Live-mode preflight (GET-only route inventory)
npm run acceptance:lifecycle:preflight

# Prove --live fails closed
node scripts/run-full-lifecycle-acceptance.ts --live
# Expected: exits 1, no mutations attempted
```

---

## Invariant Violations That Cause Fail-Closed

- Unexpected issue status transition
- Missing required child issue
- Orphaned run without assigned issue
- Pending approval after closure
- Pending interaction after closure
- Active watchdog at closure
- Specialist still active after closure
- Orchestrator not terminated last
- Director terminated (permanent agent) — **CRITICAL**
- History record deleted
- Board governance timeout (`CAPABILITY_BLOCKER`)

---

## Artifacts Produced

After each run:

- `artifacts/lifecycle/<run-id>/phases-001-014.json` — all phase receipts
- `artifacts/lifecycle/<run-id>/project-receipt.json` — final project receipt
- `artifacts/lifecycle/<run-id>/run-summary.json` — run summary
- `artifacts/lifecycle/<run-id>/run-summary.md` — human-readable summary

---

## Relationship to `accept-project.ts`

- `accept-project.ts` — validates **bootstrap only** (phases 1–3, entry into phase 4)
- `run-full-lifecycle-acceptance.ts` — validates **all 14 phases** including closure

The bootstrap acceptance is a subset. Full lifecycle promotion requires 3 consecutive successful full-lifecycle runs.

---

## What Remains Before a Live Lab Run

The `RealLifecycleOrchestrator` is implemented but **not yet verified in a live Lab context**. The following must be completed before `--live` can be safely executed against `MMF Studio Lab`:

### Known Blockers

1. **Board approval polling semantics**: The orchestrator polls `GET /api/approvals/{id}` until status is `approved`. If the Board uses a different status field (e.g., `state` instead of `status`), polling will never see `approved` and always timeout with `CAPABILITY_BLOCKER: board_timeout`. **Real Lab testing required.**

2. **Board interaction polling semantics**: The orchestrator polls `GET /api/issues/{id}/interactions` for status=`completed`. If interaction completion uses a different field or mechanism, polling will never resolve. **Real Lab testing required.**

3. **trustedTemplateHire response shape**: The `createAgentHire` call returns an object with `id`. The orchestrator reads `agent.id` as the new agent ID, then calls `getAgent(agentId)` to verify. If the response shape differs (e.g., `agentId` vs `id`), the agent ID will be empty and verification will fail. **Schema verification required.**

4. **Director agent resolution**: Phase 1 resolves the Director by listing agents and finding one with `role === 'director'` or name containing 'director'. If MMF Studio Lab uses a different naming convention, this will fail. **Lab-specific configuration may be needed.**

5. **Watchdog issue ID tracking**: The orchestrator tracks `ctx.watchdogIssueId` but never actually sets it from any API response. In Phase 14, `deleteWatchdog` is called with a null issue ID if no watchdog was tracked. **Watchdog creation/retrieval not yet wired to a real API call.**

6. **Idempotency key per phase**: The orchestrator generates a disposable project name but does not yet store/comparison-check completed phases per project name for re-run recovery. If a run is interrupted, re-running may create duplicate entities. **Idempotency implementation incomplete.**

7. **Real heartbeat invocation**: The orchestrator never calls `POST /api/agents/{id}/heartbeat/invoke` during the lifecycle. If agents need heartbeat invocations to stay alive during the lifecycle, they may go idle/stale. **Heartbeat integration not yet implemented.**

8. **Three-independent-project without board plumbing**: The orchestrator is designed for 3 independent projects but each project needs its own Board approval cycle. If Board approval requires manual human action, 3 projects = 3 manual approvals. **No automated parallel approval flow exists yet.**

### To Enable Live Mode

1. Resolve all Known Blockers above with real API testing
2. Set `LIVECLI_ORCHESTRATOR_ENABLED=true` in the parent environment
3. Verify preflight passes for MMF Studio Lab
4. Run a single dry-run first to confirm the adapter works
5. Run `--live` with `--paperclip-url` pointing to the real Lab
6. Monitor for `CAPABILITY_BLOCKER` and resolve any Board API discrepancies

**Do not set `LIVECLI_ORCHESTRATOR_ENABLED=true` in CI or automated test pipelines.** That env var is a deliberate, human-reviewed gate.
