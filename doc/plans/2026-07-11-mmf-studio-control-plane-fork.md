# MMF Studio Paperclip Fork — Implementation Plan

Date: 2026-07-11
Status: approved for implementation by user request

## Problem frame

Paperclip has the correct control-plane primitives for MMF Studio, but two upstream assumptions block the intended client-work flow:

1. A UI-created local folder is stored as `local_path`, so `hermes_local` expects Git metadata even when the project is private knowledge work.
2. Agent-authenticated hire requests cannot set protected instruction paths. This is a good security boundary, but it prevents the MMF Studio Director from instantiating pre-approved file-backed templates.

The fork must preserve Paperclip's company, approval, issue, audit, and runtime invariants while adding a trusted MMF template layer and a knowledge-work project path.

## Requirements trace

- Chris can create a private client project backed by a non-Git local folder without API repair.
- The MMF Studio Director can submit a hire using an approved `templateSlug` and project/source-issue context.
- The server—not the agent—resolves protected adapter/runtime/instruction configuration.
- Existing board approval remains mandatory and inspectable.
- Arbitrary agent-supplied instruction paths remain forbidden.
- The UI is clearly branded MMF Studio using Conversion Alchemy cream/navy/orange—not a generic reskin.
- Existing coding/Git project behavior remains available.
- Done means a locally running isolated fork plus a verified Director → template hire → pending board approval path.

## Scope boundaries

### In scope

- File-backed trusted template catalog configured by server environment.
- Catalog read endpoint for board/agent consumers within a company.
- Template-based extension to `POST /api/companies/:companyId/agent-hires`.
- Project/source-issue/reporting validation before template expansion.
- Explicit `non_git_path` creation for knowledge-work local folders.
- MMF Studio visual identity, product title, navigation wordmark, and creation copy.
- Targeted API/UI tests and one end-to-end smoke path.
- Isolated local instance with no mutation of the existing Paperclip default instance.

### Non-goals for v0

- Database-managed template editor or marketplace.
- Full replacement of every upstream Paperclip string in docs/CLI.
- Automatic creation of client folders from the Director.
- Removing Git/code support.
- Unattended approval or strategic/client-facing actions.
- Publishing a public hosted service.

## Architecture decision

Use a server-trusted registry file referenced by `MMF_AGENT_TEMPLATE_REGISTRY_PATH`.

The registry owns protected fields:

- template slug/name/status;
- role/title/icon/capabilities;
- adapter type and adapter config;
- runtime config;
- permissions;
- allowed parent template/role;
- project/workspace requirement;
- naming pattern.

A management agent may submit:

```json
{
  "templateSlug": "project-orchestrator",
  "projectId": "<uuid>",
  "name": "Findymail Project Orchestrator",
  "reportsTo": "<director-id>",
  "sourceIssueId": "<uuid>"
}
```

The route loads the trusted template, verifies the project/source issue/company/reporting relationship, resolves the project workspace, builds the protected hire payload, and continues through Paperclip's existing approval path.

If a caller supplies both `templateSlug` and protected adapter/instruction/runtime/permission overrides, reject with 422. Board users may continue using the legacy full configuration route without `templateSlug`.

## Implementation units

### U1 — Fork/bootstrap and baseline

Goal: create the GitHub fork, feature branch, isolated local instance, and baseline test record.

Expected files: no product files initially; `.paperclip/` remains ignored/local.

Verification:

```sh
pnpm install
pnpm test -- --runInBand # or repo-supported targeted baseline
pnpm paperclipai worktree init --no-seed
```

Risk: low.

### U2 — Trusted template catalog contract

Goal: define shared types/validators and server catalog loader.

Expected files:

- `packages/shared/src/validators/agent.ts`
- `packages/shared/src/types/agent.ts`
- `server/src/services/agent-template-catalog.ts`
- `server/src/__tests__/agent-template-catalog.test.ts`
- `config/mmf-agent-templates.example.json`

Requirements:

- strict schema;
- fail closed for missing/malformed registry;
- path must be server configured, never supplied by agent;
- catalog output redacts secrets;
- inactive/unknown templates rejected.

Verification: targeted Vitest tests plus shared/server typecheck.

Risk: medium; security-sensitive.

### U3 — Template-based hire route

Goal: allow permitted management agents to request a trusted template slug while preserving board approvals.

Expected files:

- `server/src/routes/agents.ts`
- `server/src/__tests__/agents-template-hires.test.ts`
- shared validators/types from U2.

Requirements:

- template expands before protected-config guard;
- source issue and project must be same company;
- project workspace required when template requires it;
- reporting manager must be in company and match allowed role;
- agent input cannot override trusted protected fields;
- existing non-template hire behavior unchanged;
- approval payload records `templateSlug`, project, source issue, and resolved configuration snapshot.

Verification: targeted route tests covering success, 403/404/409/422 cases, and legacy regression.

Risk: high; authorization/configuration boundary.

### U4 — Knowledge-work project creation

Goal: make local private workspaces work without Git repair.

Expected files:

- `ui/src/components/NewProjectDialog.tsx`
- `ui/src/components/NewProjectDialog.test.tsx` or nearest existing dialog tests
- project API/server tests only if server behavior changes.

Requirements:

- project form exposes `Knowledge workspace` vs `Git/code project`;
- knowledge workspace is default for MMF fork;
- local-only knowledge folder sends `sourceType: non_git_path`;
- Git repo sends `sourceType: git_repo`;
- local Git checkout remains available through code-project choice;
- copy explains private client workspace behavior.

Verification: component tests and browser creation smoke.

Risk: medium; regression in project creation.

### U5 — MMF Studio branding

Goal: create a restrained CA/MMF control-room identity.

Expected files:

- `ui/index.html`
- `ui/src/index.css`
- wordmark/logo/sidebar components identified during implementation
- `ui/public/` favicon/mark assets
- relevant component tests/snapshots.

Direction:

- cream working surface;
- dark navy navigation/frame;
- Conversion Alchemy orange for primary actions and active state;
- warm hard-edged cards/borders, restrained stamp character;
- product wordmark `MMF Studio` with small `by Conversion Alchemy` lockup;
- retain accessibility and dark mode support;
- no gradients, glassmorphism, fake metrics, or ornamental dashboard clutter.

Verification: built UI, desktop and 390px browser screenshots, contrast/overflow checks.

Risk: medium; broad visual regression if tokens are changed recklessly. Prefer token overrides and focused components.

### U6 — Isolated deployment and end-to-end proof

Goal: run the fork with isolated state and prove the first autonomous management action.

Expected local configuration:

- dedicated `PAPERCLIP_HOME` / instance ID;
- registry path points to the MMF Studio product registry;
- server on a non-default port;
- existing default Paperclip remains untouched.

Flow:

1. Create MMF Studio company with board approval required.
2. Create/approve Director from trusted config.
3. Create Findymail knowledge-work project through branded UI.
4. Assign minimal task to Director.
5. Director submits `project-orchestrator` template hire.
6. Verify pending approval includes resolved protected configuration.
7. Chris can open the app and approve/test further.

Verification: API assertions, run logs, browser screenshot, health endpoint, no partial duplicate agent.

Risk: high; integration/runtime.

## Test scenarios

### Programmatic

1. Registry loader accepts valid MMF registry and rejects malformed/unknown/inactive templates.
2. Agent with `canCreateAgents=true` can request approved template slug.
3. Same agent cannot provide `instructionsFilePath`, adapter/runtime overrides, or permissions with template slug.
4. Agent cannot use a template from an unconfigured registry.
5. Cross-company project/source issue/reportsTo references fail.
6. Missing required project workspace fails.
7. Valid request creates `pending_approval`, not active agent.
8. Approval payload records template slug and resolved config.
9. Knowledge-work UI sends `non_git_path`.
10. Git/code UI sends `git_repo`/existing behavior.
11. Existing full-config board hire path still passes.

### Browser

1. MMF Studio branding appears at initial load and in navigation.
2. New project defaults to Knowledge workspace.
3. Creating a local-folder project produces a working non-Git workspace.
4. Project/task/approval pages remain usable at desktop and 390px.
5. No horizontal overflow; buttons, labels, and focus states remain legible.

### Human acceptance

Chris can open the isolated URL, navigate projects/agents/approvals, create or inspect a knowledge project, and approve the Director-created orchestrator hire.

## Review lenses

- Security: protected config expansion, path trust, cross-company references, override rejection.
- Reliability: missing registry, malformed file, stale template, approval idempotency, duplicate hires.
- Data integrity: no partial agent on validation failure; existing approvals unchanged.
- Maintainability: small patch set, upstream-friendly service boundary, documented environment variables.
- UI/accessibility: contrast, keyboard focus, mobile width, error copy.

## Risks and mitigations

- **Upstream drift:** keep changes isolated in new service, validator fields, route branch, and focused UI components.
- **Absolute local paths:** registry may contain environment-specific values for local v0; document and validate them server-side. Future version can use path variables.
- **Agent escalation:** agents choose only approved slugs; server owns all protected fields; board approval remains.
- **Duplicate hires:** reject an active/pending same-template same-project identity where appropriate or return existing approval.
- **Branding blast radius:** avoid a wholesale component rewrite; use tokens and a small identity layer.
- **Long-running repair loop:** if integration failures recur, use a bounded looper with test/typecheck/browser gates, max iterations, no-progress stop, and no external mutation beyond this fork.

## Done criteria

- Fork and branch pushed to Chris's GitHub.
- Plan committed before implementation commits.
- Targeted tests, repo typecheck, test suite, and build pass or exact upstream failures are documented.
- Isolated custom instance is running and reachable.
- Browser-verified MMF Studio identity and knowledge-project creation work.
- Director can submit a trusted template hire without arbitrary instruction-path authority.
- Pending orchestrator approval is visible and correctly configured.
- Chris receives a working URL plus concise play instructions and rollback path.
