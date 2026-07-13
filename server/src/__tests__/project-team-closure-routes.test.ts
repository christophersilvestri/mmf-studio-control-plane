import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const projectService = vi.hoisted(() => ({
  getById: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  createWorkspace: vi.fn(), listWorkspaces: vi.fn(), updateWorkspace: vi.fn(),
  removeWorkspace: vi.fn(), resolveByReference: vi.fn(),
}));
const closureService = vi.hoisted(() => ({ preview: vi.fn(), close: vi.fn() }));
const projectTasks = vi.hoisted(() => ({ preview: vi.fn(), archive: vi.fn() }));

vi.mock("../services/project-team-closure.js", () => ({ projectTeamClosureService: () => closureService }));
vi.mock("../services/project-task-archival.js", () => ({ projectTaskArchivalService: () => projectTasks }));
vi.mock("../telemetry.js", () => ({ getTelemetryClient: () => null }));
vi.mock("../services/index.js", () => ({
  accessService: () => ({ decide: vi.fn().mockResolvedValue({ allowed: true }) }),
  projectService: () => projectService,
  logActivity: vi.fn(),
  workspaceOperationService: () => ({}),
}));
vi.mock("../services/environments.js", () => ({ environmentService: () => ({ getById: vi.fn() }) }));
vi.mock("../services/secrets.js", () => ({
  secretService: () => ({ normalizeEnvBindingsForPersistence: vi.fn(async (_companyId, env) => env) }),
}));
vi.mock("../services/workspace-runtime.js", () => ({
  startRuntimeServicesForWorkspaceControl: vi.fn(), stopRuntimeServicesForProjectWorkspace: vi.fn(),
}));

async function makeApp(actor: Record<string, unknown>) {
  const [{ projectRoutes }, { errorHandler }] = await Promise.all([
    import("../routes/projects.js"), import("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).actor = actor; next(); });
  app.use("/api", projectRoutes({} as any));
  app.use(errorHandler);
  return app;
}

const project = { id: "project-1", companyId: "company-1", name: "Acme", urlKey: "acme", archivedAt: null };
const board = {
  type: "board", userId: "board-user", companyIds: ["company-1"],
  source: "local_implicit", isInstanceAdmin: false,
};

describe("project team closure routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectService.getById.mockResolvedValue(project);
    projectService.update.mockImplementation(async (_id, patch) => ({ ...project, ...patch }));
    projectService.resolveByReference.mockResolvedValue({ ambiguous: false, project: null });
    closureService.preview.mockResolvedValue({ projectId: "project-1", projectName: "Acme", included: [], excluded: [] });
    closureService.close.mockResolvedValue({ projectId: "project-1", projectName: "Acme", included: [], excluded: [], terminatedCount: 0 });
    projectTasks.archive.mockResolvedValue({ projectId: "project-1", totalCount: 3, newlyCancelledCount: 2, newlyHiddenCount: 3 });
  });

  it("returns a non-destructive preview to an authorized board user", async () => {
    const response = await request(await makeApp(board)).get("/api/projects/project-1/team-closure/preview");
    expect(response.status).toBe(200);
    expect(closureService.preview).toHaveBeenCalledWith("project-1");
  });

  it("blocks agents from the destructive close endpoint", async () => {
    const response = await request(await makeApp({
      type: "agent", agentId: "agent-1", companyId: "company-1", source: "agent_key",
    })).post("/api/projects/project-1/team-closure/close").send({ projectName: "Acme" });
    expect({ status: response.status, body: response.body }).toEqual({ status: 403, body: { error: "Board access required" } });
    expect(closureService.close).not.toHaveBeenCalled();
  });

  it("passes the authenticated board user into the closure audit trail", async () => {
    const response = await request(await makeApp(board))
      .post("/api/projects/project-1/team-closure/close")
      .send({ projectName: "Acme", archiveAfterClose: true });
    expect(response.status).toBe(200);
    expect(closureService.close).toHaveBeenCalledWith(
      "project-1", "Acme", true,
      { actorType: "user", actorId: "board-user", agentId: null },
    );
  });

  it("archives project tasks when a board user archives the project", async () => {
    const response = await request(await makeApp(board))
      .patch("/api/projects/project-1")
      .send({ archivedAt: "2026-07-13T17:00:00.000Z" });
    expect(response.status).toBe(200);
    expect(projectTasks.archive).toHaveBeenCalledWith("project-1", "company-1");
  });

  it("blocks agents from project archival now that it archives tasks", async () => {
    const response = await request(await makeApp({
      type: "agent", agentId: "agent-1", companyId: "company-1", source: "agent_key",
    })).patch("/api/projects/project-1").send({ archivedAt: "2026-07-13T17:00:00.000Z" });
    expect(response.status).toBe(403);
    expect(projectTasks.archive).not.toHaveBeenCalled();
  });
});
