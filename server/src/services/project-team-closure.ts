import { and, eq, ne } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents } from "@paperclipai/db";
import { conflict, notFound } from "../errors.js";
import { logActivity } from "./activity-log.js";
import { agentService } from "./agents.js";
import { approvalService } from "./approvals.js";
import { heartbeatService } from "./heartbeat.js";
import { projectService } from "./projects.js";
import {
  projectTaskArchivalService,
  type ProjectTaskArchivePreview,
  type ProjectTaskArchiveResult,
} from "./project-task-archival.js";

type AgentCandidate = {
  id: string;
  name: string | null;
  role: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
};

export function isPermanentAgent(agent: Pick<AgentCandidate, "role" | "name" | "metadata">): boolean {
  return agent.role === "ceo"
    || agent.metadata?.permanent === true
    || agent.metadata?.lifecycle === "permanent"
    || agent.name === "MMF Studio Director";
}

export function isActiveAgent(agent: { status?: string | null }): boolean {
  return agent.status !== "terminated";
}

export function isOrchestratorRole(agent: Pick<AgentCandidate, "role" | "metadata">): boolean {
  const templateSlug = typeof agent.metadata?.templateSlug === "string"
    ? agent.metadata.templateSlug.toLowerCase()
    : "";
  const projectRole = typeof agent.metadata?.projectRole === "string"
    ? agent.metadata.projectRole.toLowerCase()
    : "";
  const role = agent.role?.toLowerCase() ?? "";
  return templateSlug === "project-orchestrator"
    || projectRole === "orchestrator"
    || ["orchestrator", "manager", "director", "coordinator"].includes(role);
}

export function isProjectLinkedAgent(
  agent: Pick<AgentCandidate, "metadata">,
  projectId: string,
  projectSlug?: string | null,
): boolean {
  const metadata = agent.metadata;
  if (!metadata) return false;
  if (metadata.projectId === projectId) return true;
  return Boolean(projectSlug && metadata.projectSlug === projectSlug);
}

export interface ClosureAgentTarget {
  agentId: string;
  name: string;
  role: string | null;
  reason: string;
  pendingApprovalId: string | null;
}

export interface ClosurePreview {
  projectId: string;
  projectName: string;
  included: ClosureAgentTarget[];
  excluded: ClosureAgentTarget[];
  tasks: ProjectTaskArchivePreview;
}

export interface ClosureResult extends ClosurePreview {
  /** Total included agents verified as terminated; rejectedApprovalCount is a subset of this total. */
  terminatedCount: number;
  /** Included pending hires resolved by rejecting their open hire approval. */
  rejectedApprovalCount: number;
  cancelledRunCount: number;
  cancelledWakeupCount: number;
  archived: boolean;
  terminationOrder: string[];
  taskArchive: ProjectTaskArchiveResult;
}

export interface TeamClosureActor {
  actorType: "user";
  actorId: string;
  agentId: null;
}

export function projectTeamClosureService(db: Db) {
  const agentsSvc = agentService(db);
  const approvalsSvc = approvalService(db);
  const heartbeatsSvc = heartbeatService(db);
  const projectsSvc = projectService(db);
  const projectTasks = projectTaskArchivalService(db);

  async function preview(projectId: string): Promise<ClosurePreview> {
    const project = await projectsSvc.getById(projectId);
    if (!project) throw notFound("Project not found");

    const activeCompanyAgents = await db
      .select({
        id: agents.id,
        name: agents.name,
        role: agents.role,
        status: agents.status,
        metadata: agents.metadata,
      })
      .from(agents)
      .where(and(eq(agents.companyId, project.companyId), ne(agents.status, "terminated")));

    const linked = (activeCompanyAgents as AgentCandidate[])
      .filter((agent) => isProjectLinkedAgent(agent, projectId, project.urlKey ?? null));
    const included: ClosureAgentTarget[] = [];
    const excluded: ClosureAgentTarget[] = [];

    for (const agent of linked) {
      const pendingApproval = agent.status === "pending_approval"
        ? await approvalsSvc.findOpenHireApprovalForAgent(project.companyId, agent.id)
        : null;
      const target: ClosureAgentTarget = {
        agentId: agent.id,
        name: agent.name ?? "Unknown Agent",
        role: agent.role,
        reason: isPermanentAgent(agent) ? "Permanent agent protected by lifecycle policy" : "Active project agent",
        pendingApprovalId: pendingApproval?.id ?? null,
      };
      if (isPermanentAgent(agent)) excluded.push(target);
      else included.push(target);
    }

    included.sort((left, right) => {
      const leftAgent = linked.find((agent) => agent.id === left.agentId)!;
      const rightAgent = linked.find((agent) => agent.id === right.agentId)!;
      return Number(isOrchestratorRole(leftAgent)) - Number(isOrchestratorRole(rightAgent));
    });

    const tasks = await projectTasks.preview(project.id, project.companyId);
    return { projectId, projectName: project.name, included, excluded, tasks };
  }

  async function close(
    projectId: string,
    confirmedProjectName: string,
    archiveAfterClose: boolean,
    actor: TeamClosureActor,
  ): Promise<ClosureResult> {
    const project = await projectsSvc.getById(projectId);
    if (!project) throw notFound("Project not found");
    if (project.name !== confirmedProjectName) {
      throw conflict(`Project name must match exactly. Expected "${project.name}".`);
    }

    const closurePreview = await preview(projectId);
    const targetIds = closurePreview.included.map((target) => target.agentId);
    const cancellation = targetIds.length > 0
      ? await heartbeatsSvc.cancelInvocationsForAgents(targetIds, `Project team closed: ${project.name}`)
      : { runsCancelled: 0, wakeupsCancelled: 0 };

    let rejectedApprovalCount = 0;
    for (const target of closurePreview.included) {
      if (target.pendingApprovalId) {
        const result = await approvalsSvc.reject(
          target.pendingApprovalId,
          actor.actorId,
          `Project team closed: ${project.name}`,
        );
        if (result.applied) rejectedApprovalCount += 1;
      } else {
        await agentsSvc.terminate(target.agentId);
      }
    }

    for (const target of closurePreview.included) {
      const readback = await agentsSvc.getById(target.agentId);
      if (!readback || readback.status !== "terminated") {
        throw conflict(`Project team closure verification failed for ${target.name}`);
      }
    }

    const taskArchive = await projectTasks.archive(project.id, project.companyId);

    let archived = Boolean(project.archivedAt);
    if (archiveAfterClose && !archived) {
      const updated = await projectsSvc.update(projectId, { archivedAt: new Date() });
      archived = Boolean(updated?.archivedAt);
      if (!archived) throw conflict("Project team closed, but project archival verification failed");
    }

    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.team_closed",
      entityType: "project",
      entityId: projectId,
      details: {
        projectName: project.name,
        targetCount: closurePreview.included.length,
        excludedCount: closurePreview.excluded.length,
        rejectedApprovalCount,
        cancelledRunCount: cancellation.runsCancelled,
        cancelledWakeupCount: cancellation.wakeupsCancelled,
        terminationOrder: targetIds,
        archived,
        taskArchive,
      },
    });

    return {
      ...closurePreview,
      terminatedCount: closurePreview.included.length,
      rejectedApprovalCount,
      cancelledRunCount: cancellation.runsCancelled,
      cancelledWakeupCount: cancellation.wakeupsCancelled,
      archived,
      terminationOrder: targetIds,
      taskArchive,
    };
  }

  return { preview, close };
}
