import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const projectService = vi.hoisted(() => ({
  create: vi.fn(), createWorkspace: vi.fn(), getById: vi.fn(), remove: vi.fn(),
  list: vi.fn(), update: vi.fn(), listWorkspaces: vi.fn(), updateWorkspace: vi.fn(),
  removeWorkspace: vi.fn(), resolveByReference: vi.fn(),
}));
const driveBrains = vi.hoisted(() => ({ run: vi.fn(), rollback: vi.fn() }));
const logActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/mmf-drive-brain.js", () => ({ driveBrainImporter: () => driveBrains }));
vi.mock("../telemetry.js", () => ({ getTelemetryClient: () => null }));
vi.mock("../services/index.js", () => ({
  accessService: () => ({ decide: vi.fn().mockResolvedValue({ allowed: true }) }),
  projectService: () => projectService,
  logActivity,
  workspaceOperationService: () => ({}),
}));
vi.mock("../services/environments.js", () => ({ environmentService: () => ({ getById: vi.fn() }) }));
vi.mock("../services/secrets.js", () => ({
  secretService: () => ({ normalizeEnvBindingsForPersistence: vi.fn(async (_companyId, env) => env) }),
}));
vi.mock("../services/workspace-runtime.js", () => ({
  startRuntimeServicesForWorkspaceControl: vi.fn(), stopRuntimeServicesForProjectWorkspace: vi.fn(),
}));

async function app(actor: Record<string, unknown> = {
  type: "board", userId: "board-user", companyIds: ["company-1"],
  source: "local_implicit", isInstanceAdmin: false,
}) {
  const [{ projectRoutes }, { errorHandler }] = await Promise.all([
    import("../routes/projects.js"), import("../middleware/index.js"),
  ]);
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  instance.use("/api", projectRoutes({} as any));
  instance.use(errorHandler);
  return instance;
}

const brainResult = {
  ok: true, dryRun: false, folderId: "folder_1234567890", folderName: "Acme Sources",
  folderUrl: "https://drive.google.com/drive/folders/folder_1234567890",
  targetPath: "/private/brains/acme", inventoryCount: 3, importedCount: 2, skippedCount: 1,
  manifestPath: "/private/brains/acme/00_project-context/drive-import-manifest.json",
};
const project = {
  id: "project-1", companyId: "company-1", name: "Acme", env: null, workspaces: [],
};

describe("Google Drive project brain routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectService.resolveByReference.mockResolvedValue({ ambiguous: false, project: null });
    projectService.remove.mockResolvedValue(project);
    driveBrains.rollback.mockResolvedValue(undefined);
  });

  it("blocks agents from probing Drive through the service account", async () => {
    const response = await request(await app({
      type: "agent", agentId: "agent-1", companyId: "company-1", source: "agent_key",
    }))
      .post("/api/companies/company-1/projects/drive-brain-preview")
      .send({ name: "Acme", status: "planned", driveFolderRef: brainResult.folderUrl });
    expect(response.status).toBe(403);
    expect(driveBrains.run).not.toHaveBeenCalled();
  });

  it("validates the Drive folder without creating a project", async () => {
    driveBrains.run.mockResolvedValue({ ...brainResult, dryRun: true });
    const response = await request(await app())
      .post("/api/companies/company-1/projects/drive-brain-preview")
      .send({ name: "Acme", status: "planned", driveFolderRef: brainResult.folderUrl });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, folderName: "Acme Sources", inventoryCount: 3 });
    expect(driveBrains.run).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(projectService.create).not.toHaveBeenCalled();
  });

  it("creates the project only after compiling and attaches a scoped local brain workspace", async () => {
    driveBrains.run.mockResolvedValue(brainResult);
    projectService.create.mockResolvedValue(project);
    projectService.createWorkspace.mockResolvedValue({ id: "workspace-1" });
    projectService.getById.mockResolvedValue({ ...project, primaryWorkspace: { id: "workspace-1" } });
    const response = await request(await app())
      .post("/api/companies/company-1/projects/from-drive")
      .send({ name: "Acme", status: "planned", driveFolderRef: brainResult.folderUrl });
    expect(response.status).toBe(201);
    expect(projectService.createWorkspace).toHaveBeenCalledWith("project-1", expect.objectContaining({
      sourceType: "non_git_path", cwd: brainResult.targetPath,
      remoteProvider: "google_drive", remoteWorkspaceRef: brainResult.folderId, isPrimary: true,
    }));
    expect(response.body.brain).toMatchObject({ importedCount: 2, skippedCount: 1 });
    expect(driveBrains.rollback).not.toHaveBeenCalled();
  });

  it("rolls back both project and brain when workspace attachment fails", async () => {
    driveBrains.run.mockResolvedValue(brainResult);
    projectService.create.mockResolvedValue(project);
    projectService.createWorkspace.mockResolvedValue(null);
    const response = await request(await app())
      .post("/api/companies/company-1/projects/from-drive")
      .send({ name: "Acme", status: "planned", driveFolderRef: brainResult.folderUrl });
    expect(response.status).toBe(422);
    expect(projectService.remove).toHaveBeenCalledWith("project-1");
    expect(driveBrains.rollback).toHaveBeenCalledWith(brainResult);
  });
});
