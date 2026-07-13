import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";

const projects = vi.hoisted(() => ({ getById: vi.fn(), update: vi.fn() }));
const agentServiceMock = vi.hoisted(() => ({ terminate: vi.fn(), getById: vi.fn() }));
const approvals = vi.hoisted(() => ({ findOpenHireApprovalForAgent: vi.fn(), reject: vi.fn() }));
const heartbeats = vi.hoisted(() => ({ cancelInvocationsForAgents: vi.fn() }));
const logActivity = vi.hoisted(() => vi.fn());

vi.mock("./projects.js", () => ({ projectService: () => projects }));
vi.mock("./agents.js", () => ({ agentService: () => agentServiceMock }));
vi.mock("./approvals.js", () => ({ approvalService: () => approvals }));
vi.mock("./heartbeat.js", () => ({ heartbeatService: () => heartbeats }));
vi.mock("./activity-log.js", () => ({ logActivity }));

import {
  isActiveAgent,
  isOrchestratorRole,
  isPermanentAgent,
  isProjectLinkedAgent,
  projectTeamClosureService,
} from "./project-team-closure.js";

type Candidate = {
  id: string; name: string; role: string; status: string; metadata: Record<string, unknown> | null;
};
let rows: Candidate[] = [];
const statuses = new Map<string, string>();
const fakeDb = {
  select: () => ({ from: () => ({ where: async () => rows }) }),
} as unknown as Db;
const project = {
  id: "project-1", companyId: "company-1", name: "Acme", urlKey: "acme", archivedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  statuses.clear();
  projects.getById.mockResolvedValue(project);
  projects.update.mockImplementation(async (_id, patch) => ({ ...project, ...patch }));
  approvals.findOpenHireApprovalForAgent.mockResolvedValue(null);
  approvals.reject.mockImplementation(async (approvalId: string) => {
    const target = rows.find((row) => row.metadata?.approvalId === approvalId);
    if (target) statuses.set(target.id, "terminated");
    return { applied: true };
  });
  heartbeats.cancelInvocationsForAgents.mockResolvedValue({ runsCancelled: 2, wakeupsCancelled: 1 });
  agentServiceMock.terminate.mockImplementation(async (id: string) => {
    statuses.set(id, "terminated");
    return { id, status: "terminated" };
  });
  agentServiceMock.getById.mockImplementation(async (id: string) => ({ id, status: statuses.get(id) ?? "idle" }));
});

describe("project team closure policies", () => {
  it("uses exact linkage and permanent-agent protection", () => {
    expect(isProjectLinkedAgent({ metadata: { projectId: "project-1" } }, "project-1", "acme")).toBe(true);
    expect(isProjectLinkedAgent({ metadata: { projectSlug: "acme" } }, "project-1", "acme")).toBe(true);
    expect(isProjectLinkedAgent({ metadata: { projectId: "project-10" } }, "project-1", "acme")).toBe(false);
    expect(isPermanentAgent({ role: "ceo", name: "Root", metadata: null })).toBe(true);
    expect(isPermanentAgent({ role: "worker", name: "MMF Studio Director", metadata: null })).toBe(true);
    expect(isPermanentAgent({ role: "worker", name: "A", metadata: { permanent: true } })).toBe(true);
    expect(isActiveAgent({ status: "terminated" })).toBe(false);
    expect(isOrchestratorRole({ role: "worker", metadata: { templateSlug: "project-orchestrator" } })).toBe(true);
  });

  it("previews only explicitly linked agents, protects permanent agents, and orders orchestrator last", async () => {
    rows = [
      { id: "orchestrator", name: "Acme Orchestrator", role: "manager", status: "idle", metadata: { projectId: "project-1" } },
      { id: "specialist", name: "Researcher", role: "researcher", status: "idle", metadata: { projectId: "project-1" } },
      { id: "protected", name: "Protected", role: "worker", status: "idle", metadata: { projectId: "project-1", permanent: true } },
      { id: "unrelated", name: "Other Client", role: "worker", status: "idle", metadata: { projectId: "project-2" } },
    ];
    const preview = await projectTeamClosureService(fakeDb).preview("project-1");
    expect(preview.included.map((agent) => agent.agentId)).toEqual(["specialist", "orchestrator"]);
    expect(preview.excluded.map((agent) => agent.agentId)).toEqual(["protected"]);
    expect(JSON.stringify(preview)).not.toContain("unrelated");
  });

  it("cancels work, rejects pending hires with the board user, terminates in order, verifies, then archives", async () => {
    rows = [
      { id: "orchestrator", name: "Acme Orchestrator", role: "manager", status: "idle", metadata: { projectId: "project-1" } },
      { id: "pending", name: "Pending Specialist", role: "researcher", status: "pending_approval", metadata: { projectId: "project-1", approvalId: "approval-1" } },
      { id: "specialist", name: "Writer", role: "writer", status: "idle", metadata: { projectId: "project-1" } },
    ];
    approvals.findOpenHireApprovalForAgent.mockImplementation(async (_companyId: string, agentId: string) =>
      agentId === "pending" ? { id: "approval-1" } : null);

    const result = await projectTeamClosureService(fakeDb).close(
      "project-1", "Acme", true,
      { actorType: "user", actorId: "board-user", agentId: null },
    );

    expect(result.terminationOrder).toEqual(["pending", "specialist", "orchestrator"]);
    expect(heartbeats.cancelInvocationsForAgents).toHaveBeenCalledWith(result.terminationOrder, expect.any(String));
    expect(approvals.reject).toHaveBeenCalledWith("approval-1", "board-user", expect.any(String));
    expect(agentServiceMock.terminate.mock.calls.map(([id]) => id)).toEqual(["specialist", "orchestrator"]);
    expect(result).toMatchObject({ terminatedCount: 3, rejectedApprovalCount: 1, archived: true });
    expect(projects.update).toHaveBeenCalledWith("project-1", { archivedAt: expect.any(Date) });
    expect(logActivity).toHaveBeenCalledWith(fakeDb, expect.objectContaining({
      actorType: "user", actorId: "board-user", action: "project.team_closed",
    }));
  });

  it("is idempotent when no active linked agents remain and still honors archiveAfterClose", async () => {
    rows = [{ id: "other", name: "Other", role: "worker", status: "idle", metadata: { projectId: "project-2" } }];
    const result = await projectTeamClosureService(fakeDb).close(
      "project-1", "Acme", true,
      { actorType: "user", actorId: "board-user", agentId: null },
    );
    expect(result.terminatedCount).toBe(0);
    expect(heartbeats.cancelInvocationsForAgents).not.toHaveBeenCalled();
    expect(projects.update).toHaveBeenCalled();
  });

  it("blocks a mismatched confirmation before any destructive action", async () => {
    await expect(projectTeamClosureService(fakeDb).close(
      "project-1", "acme", false,
      { actorType: "user", actorId: "board-user", agentId: null },
    )).rejects.toThrow("must match exactly");
    expect(heartbeats.cancelInvocationsForAgents).not.toHaveBeenCalled();
    expect(agentServiceMock.terminate).not.toHaveBeenCalled();
  });
});
