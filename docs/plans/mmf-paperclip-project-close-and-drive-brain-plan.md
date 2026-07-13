# Plan: Native project-team closure and Google Drive project brains

## Context

Paperclip currently archives projects separately from terminating agents. Agent-to-project linkage for MMF hires is stored in agent metadata. New knowledge-work projects currently require a local absolute workspace path even though the project-workspace schema already supports remote providers and remote workspace references.

Google Drive must remain the human/client-facing source of truth. Each Paperclip project gets a private, project-scoped Markdown brain under `~/brain/clients/client-projects/<slug>/`, compiled from the selected Drive folder using the existing MMF project template. Agents work only in that scoped brain. Publishing approved outputs back to Drive is a later unit.

## Requirements trace

### R1 — Close project team

- Native Paperclip project action, not MMF Studio.
- Preview exact matched agents before mutation.
- Match only agents explicitly linked to the project.
- Exclude permanent/root agents, including the MMF Studio Director.
- Cancel active runs and queued wakeups.
- Resolve pending hire approvals correctly.
- Terminate specialists before the Project Orchestrator.
- Read back every target as terminated.
- Keep project archive as an explicit separate option.
- Idempotent repeat call.
- Board-only authorization and activity audit.

### R2 — Google Drive to project brain

- New-project UI offers Local folder, Git repository, or Google Drive folder.
- Accept a Drive folder URL or ID.
- Validate authenticated read access before creating the project.
- Recursively inventory supported files without modifying Drive.
- Compile supported Docs, Sheets, PDFs, DOCX, Markdown, text, and CSV into Markdown/readable local artifacts.
- Copy the existing `_template_mmf-studio-client-project` structure.
- Route proposal, intake, kickoff/transcript, and generic sources into deterministic project-brain locations.
- Preserve Drive ID, source path, URL, MIME type, modified time, and content hash in a manifest/source index.
- Use atomic staging → rename; private directory/file permissions.
- Refuse path traversal and existing non-empty project-brain collisions.
- Create a Paperclip project workspace pointing at the compiled brain with `remoteProvider=google_drive` and `remoteWorkspaceRef=<folder-id>`.
- Do not expose service-account credentials to the browser or logs.
- Do not grant project agents access to the global brain or other client projects.
- Do not publish or modify Drive in this version.

## Scope boundaries

### Included

- Project-team preview and closure endpoint/UI.
- Read-only Drive ingestion during project creation.
- Project-brain compilation and workspace registration.
- Provenance manifest, source index, dry-run and fixture testing.
- Honest provisioning/error UI.

### Explicitly deferred

- Bidirectional sync.
- Automatic publishing of approved outputs to Drive.
- Drive Picker browser OAuth; v1 accepts a shared folder URL/ID and uses server-side DWD.
- Automatic audio/video transcription.
- Global gbrain access from project agents.
- Scheduled unattended refresh.

## Implementation units

### U1 — Project-team closure service/API

Likely files:

- `server/src/services/project-team-closure.ts`
- `server/src/routes/projects.ts`
- `packages/shared/src/types/...`
- `server/src/__tests__/project-team-closure-routes.test.ts`

Behavior:

- GET preview and POST close routes.
- Exact metadata project linkage.
- Permanent-agent exclusion policy.
- run cancellation, ordered termination, approval resolution, read-back, audit.

### U2 — Project-team closure UI

Likely files:

- `ui/src/api/projects.ts`
- `ui/src/pages/ProjectDetail.tsx`
- `ui/src/pages/ProjectDetail.test.tsx`

Behavior:

- “Close project team…” button.
- Confirmation dialog lists included/excluded agents and explains order.
- Explicit typed project-name confirmation.
- Optional archive-after-close checkbox kept separate.
- Success/failure receipt.

### U3 — Drive brain compiler

Likely files:

- `server/scripts/mmf_drive_brain_import.py`
- `server/src/services/mmf-drive-brain.ts`
- fixture tests under `server/src/__tests__/fixtures/drive-brain/`
- Python unit tests or invocation tests

Behavior:

- URL/ID parsing, Drive DWD read-only adapter, recursive inventory, conversion, classification, manifest, atomic write, permissions, idempotent collision behavior.
- Test fixture mode must not call Google.

### U4 — Drive-backed project create API/UI

Likely files:

- `server/src/routes/projects.ts`
- `packages/shared/src/validators/project.ts`
- `ui/src/components/NewProjectDialog.tsx`
- `ui/src/api/projects.ts`
- corresponding route/component tests

Behavior:

- server-owned atomic create flow.
- workspace uses `sourceType=remote_managed`, `cwd=<compiled brain>`, `remoteProvider=google_drive`, `remoteWorkspaceRef=<folder-id>`.
- clear provisioning/errors; no project created on failed import.

### U5 — Integration, security, release

- typecheck and focused unit/route/UI tests.
- full relevant server/UI tests and production build.
- secret/path scan.
- mocked fixture import twice to verify collision/idempotency behavior.
- GET-only live Drive access probe to a user-selected folder only after UI is ready; no Drive writes.
- disposable project-team live test only after exact target preview confirms no permanent agents.
- independent review.
- deploy and verify the Paperclip Tailnet route.

## Risks

- Agent metadata may be missing or malformed. Fail closed; never infer by loose name matching for destructive closure.
- Terminating an orchestrator first can invalidate descendants. Enforce specialists-first ordering.
- Open hire approvals must be rejected rather than leaving stale inbox cards.
- Drive exports can vary byte-for-byte. Hash normalized extracted content, not export containers.
- Arbitrary Drive folder structures need deterministic routing plus a source index; do not pretend classification is perfect.
- Private client files must remain under the scoped project path with `0700` directories and `0600` files.
- Server process Python/runtime may differ. Probe dependencies at preflight and report unsupported converters per file rather than silently dropping content.

## Verification

- Closure preview never includes Director/permanent/root agents.
- Closure mutation requires board auth and exact project confirmation.
- Repeat closure is a clean no-op receipt.
- Two polling/read cycles do not alter closure candidates.
- Drive compiler fixture produces the expected MMF tree, manifest, and normalized hashes.
- Failed Drive access or conversion leaves no project and no partial brain.
- Browser test covers selecting Google Drive, pasting a link, provisioning, and opening the created project.
- Production build and relevant suites pass.
- Live verification reports exact project/folder IDs only in private server logs/receipts, not browser-visible raw credentials.
