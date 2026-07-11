# MMF Studio Control Plane

This fork customizes Paperclip for private, non-Git message-market-fit client work.

## What is custom

- MMF Studio / Conversion Alchemy visual identity
- knowledge-work project mode with `non_git_path` workspaces
- server-trusted agent template catalog
- slug-only management-agent hire requests
- board-gated activation with protected adapter/instruction resolution
- MMF Studio Director → Project Orchestrator hierarchy

## Live test instance

```text
Instance: mmf-studio-fork
Local URL: http://127.0.0.1:3110
Tailnet URL: https://christophers-mac-mini-1.tail102d0b.ts.net:3110
DB port: 54339
```

The Tailscale proxy is private to the tailnet.

## Start from this repo

```bash
cd /Users/christophersilvestri/Code/conversion-alchemy/mmf-studio-paperclip
MMF_AGENT_TEMPLATE_REGISTRY_PATH="$PWD/config/mmf-agent-templates.json" \
MMF_STUDIO_REPO_ROOT="/Users/christophersilvestri/Code/conversion-alchemy/mmf-studio" \
pnpm dev
```

Repo-local `.paperclip/config.json` and `.paperclip/.env` route this checkout to the isolated `mmf-studio-fork` instance.

## Stop

Stop the foreground/background `pnpm dev` process. To remove only the tailnet proxy:

```bash
tailscale serve --https=3110 off
```

## Trusted hire request

Management agents submit intent only:

```json
{
  "templateSlug": "project-orchestrator",
  "projectId": "<project-uuid>",
  "sourceIssueId": "<source-issue-uuid>"
}
```

Optional: `name`, `reportsTo`, or same-project `sourceIssueIds`.

The server resolves role, icon, Hermes adapter, private workspace, instruction path, runtime, permissions, and budget. Unknown/inactive templates, cross-project issues, invalid managers, and missing workspaces fail closed.

## Required server environment

```text
MMF_AGENT_TEMPLATE_REGISTRY_PATH
MMF_STUDIO_REPO_ROOT
```

If either protected source cannot resolve, the hire request fails with HTTP 422.

## Validation

```bash
pnpm typecheck
pnpm exec vitest run \
  packages/shared/src/validators/agent.test.ts \
  server/src/__tests__/agent-template-catalog.test.ts \
  ui/src/components/SidebarCompanyMenu.test.tsx \
  ui/src/components/Sidebar.test.tsx \
  --config vitest.config.ts
pnpm --filter @paperclipai/ui build
```

Live E2E acceptance:

1. create a project with a primary `non_git_path` workspace;
2. assign a minimal Project Orchestrator task to the Director;
3. Director submits a trusted-template hire;
4. inspect pending agent config;
5. board approves;
6. verify active `pm`, correct manager/workspace/instructions/runtime, and no agent/skill creation permissions.

## Current v0 limitation

The template catalog is server-owned JSON rather than database-managed. This is deliberate for v0: auditable, fail-closed, and small enough to keep the fork narrow. A future UI can edit versioned templates without changing the agent-facing request contract.
