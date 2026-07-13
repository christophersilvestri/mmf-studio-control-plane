# MMF Studio Full-Lifecycle Acceptance Harness — Runbook

## Overview

This harness verifies the complete Paperclip project lifecycle contract (`docs/specs/paperclip-project-lifecycle-contract.md`) through 14 deterministic phases, using synthetic workspaces only, and repeating up to 3 independent project runs.

**Key properties:**
- `--dry-run` mode: deterministic fake simulation with isolated in-memory state
- `--live` mode: real Lab-only execution behind exact loopback/company/allowlist, acknowledgement, environment, arm, and repeat-count gates
- `--preflight` mode: GET-only checks against an explicit Paperclip URL/company; mutation routes are schema-verified only
- Synthetic workspaces only (never touches real client data)
- Board hire-approval and bounded-decision simulation (via polling)
- Fail-closed on unexpected gates and capability blockers
- One complete Director → Orchestrator → specialists → manager review → Board decision → closure/offboarding lifecycle
- repeat=3 independent projects
- Machine-readable receipts for all 14 phases
- Dry-run receipts assert zero active runs/pending gates and the required termination order
- Real-Lab closure is certified by three consecutive 14-phase disposable projects (`live-20260713132718`)
- History never deleted

---

## Quick Start

```bash
cd /Users/christophersilvestri/Code/conversion-alchemy/mmf-studio-paperclip

# Dry-run (default — safe, no mutations, always works)
pnpm acceptance:mmf-lifecycle:dry-run

# Three independent project runs
pnpm acceptance:mmf-lifecycle:repeat3

# Run GET-only route preflight against the isolated Lab
pnpm acceptance:mmf-lifecycle:preflight

# Unarmed live execution fails before mutation
pnpm acceptance:mmf-lifecycle:live

# Show help
pnpm exec tsx scripts/mmf-lifecycle/run-full-lifecycle-acceptance.ts --help
```

---

## Modes

### `--dry-run` (default simulation mode)

Runs the full 14-phase lifecycle using `FakePaperclip` — a pure in-memory, deterministic simulation. No network, no filesystem, no real Paperclip.

- Same inputs → same outputs every time
- Isolated per run
- Fast (~seconds)
- Full 14-phase contract exercised
- Machine-readable receipts produced

### `--live` (explicit Lab-only acceptance)

Live execution requires every gate: exact `http://127.0.0.1:3111`, exact company and sole allowlist entry `MMF Studio Lab`, `--safety-acknowledgement`, `--arm-full-lifecycle`, `--repeat=3`, and `LIVECLI_ORCHESTRATOR_ENABLED=true`. Any missing or mismatched gate exits before mutation.

The live path is independently reviewed and certified against three consecutive disposable 14-phase projects. It uses real Board decision endpoints under the same Lab-only safety gate and never injects fake statuses.

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
├── RealLifecycleOrchestrator.ts  # Approved Paperclip-backed live orchestrator
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
- Real Board auto-decisions are available only when the explicit synthetic Lab gate is enabled; statuses are always read back from Paperclip
- Never issues DELETE on projects

#### `RealLifecycleOrchestrator.ts`
- Paperclip-backed 14-phase orchestrator, independently reviewed and live-certified
- Uses `PaperclipLifecycleAdapter` for all live operations
- Constructor gate: `LIVECLI_ORCHESTRATOR_ENABLED=true` plus a `dryRun: false` adapter
- CLI requires the constructor gate plus all explicit Lab-only arming gates
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
# Then run the exact Lab-only three-project command:
LIVECLI_ORCHESTRATOR_ENABLED=true pnpm acceptance:mmf-lifecycle:live
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
cd /Users/christophersilvestri/Code/conversion-alchemy/mmf-studio-paperclip

# Run lifecycle unit tests (136 tests)
pnpm acceptance:mmf-lifecycle:test

# Dry-run acceptance harness (3 projects)
pnpm acceptance:mmf-lifecycle:repeat3

# Single dry-run
pnpm acceptance:mmf-lifecycle:dry-run

# Live-mode preflight (GET-only route inventory)
pnpm acceptance:mmf-lifecycle:preflight

# Unarmed live attempts fail closed; the package script omits the required env gate
pnpm acceptance:mmf-lifecycle:live
# Expected: exits 1 before mutation
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

## Live Certification

The real Lab path was independently reviewed and exercised against `MMF Studio Lab` on 2026-07-13.

- Certification run: `live-20260713132718`
- Three consecutive disposable projects completed all 14 phases
- Projects archived non-destructively; audit history preserved
- Temporary specialists terminated before each orchestrator
- Permanent `MMF Studio Director` retained and restored to `idle`
- Watchdogs removed
- Late heartbeat runs cancelled and polled terminal
- Three consecutive terminal-state snapshots required at closure
- Zero active runs, pending approvals, pending interactions, or non-terminal project issues after delayed API verification

Live execution remains intentionally awkward. Do not set `LIVECLI_ORCHESTRATOR_ENABLED=true` in CI or routine automation; it is a deliberate human-reviewed gate for disposable Lab acceptance only.
