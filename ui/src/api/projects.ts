import type {
  Project,
  ProjectWorkspace,
  WorkspaceOperation,
  WorkspaceRuntimeControlTarget,
} from "@paperclipai/shared";
import { api } from "./client";
import { sanitizeWorkspaceRuntimeControlTarget } from "./workspace-runtime-control";

export interface DriveBrainPreview {
  ok: true;
  folderId: string;
  folderName?: string;
  targetPath: string;
  inventoryCount: number;
  files: Array<Record<string, unknown>>;
}

export interface DriveBrainProjectResult {
  project: Project;
  brain: {
    folderName?: string;
    folderUrl?: string;
    targetPath: string;
    inventoryCount: number;
    importedCount: number;
    skippedCount: number;
  };
}

function withCompanyScope(path: string, companyId?: string) {
  if (!companyId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}companyId=${encodeURIComponent(companyId)}`;
}

function projectPath(id: string, companyId?: string, suffix = "") {
  return withCompanyScope(`/projects/${encodeURIComponent(id)}${suffix}`, companyId);
}

export const projectsApi = {
  list: (companyId: string) => api.get<Project[]>(`/companies/${companyId}/projects`),
  get: (id: string, companyId?: string) => api.get<Project>(projectPath(id, companyId)),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Project>(`/companies/${companyId}/projects`, data),
  previewDriveBrain: (companyId: string, data: Record<string, unknown>) =>
    api.post<DriveBrainPreview>(`/companies/${companyId}/projects/drive-brain-preview`, data),
  createFromDrive: (companyId: string, data: Record<string, unknown>) =>
    api.post<DriveBrainProjectResult>(`/companies/${companyId}/projects/from-drive`, data),
  update: (id: string, data: Record<string, unknown>, companyId?: string) =>
    api.patch<Project>(projectPath(id, companyId), data),
  listWorkspaces: (projectId: string, companyId?: string) =>
    api.get<ProjectWorkspace[]>(projectPath(projectId, companyId, "/workspaces")),
  createWorkspace: (projectId: string, data: Record<string, unknown>, companyId?: string) =>
    api.post<ProjectWorkspace>(projectPath(projectId, companyId, "/workspaces"), data),
  updateWorkspace: (projectId: string, workspaceId: string, data: Record<string, unknown>, companyId?: string) =>
    api.patch<ProjectWorkspace>(
      projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}`),
      data,
    ),
  controlWorkspaceRuntimeServices: (
    projectId: string,
    workspaceId: string,
    action: "start" | "stop" | "restart",
    companyId?: string,
    target: WorkspaceRuntimeControlTarget = {},
  ) =>
    api.post<{ workspace: ProjectWorkspace; operation: WorkspaceOperation }>(
      projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}/runtime-services/${action}`),
      sanitizeWorkspaceRuntimeControlTarget(target),
    ),
  controlWorkspaceCommands: (
    projectId: string,
    workspaceId: string,
    action: "start" | "stop" | "restart" | "run",
    companyId?: string,
    target: WorkspaceRuntimeControlTarget = {},
  ) =>
    api.post<{ workspace: ProjectWorkspace; operation: WorkspaceOperation }>(
      projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}/runtime-commands/${action}`),
      sanitizeWorkspaceRuntimeControlTarget(target),
    ),
  removeWorkspace: (projectId: string, workspaceId: string, companyId?: string) =>
    api.delete<ProjectWorkspace>(projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}`)),
  remove: (id: string, companyId?: string) => api.delete<Project>(projectPath(id, companyId)),
  previewTeamClosure: (projectId: string, companyId?: string) =>
    api.get<ClosurePreview>(projectPath(projectId, companyId, "/team-closure/preview")),
  closeTeam: (projectId: string, options: CloseTeamOptions, companyId?: string) =>
    api.post<ClosureResult>(projectPath(projectId, companyId, "/team-closure/close"), options),
};

export interface ClosurePreview {
  projectId: string;
  projectName: string;
  included: { agentId: string; name: string; role: string | null; reason: string; pendingApprovalId: string | null }[];
  excluded: { agentId: string; name: string; role: string | null; reason: string; pendingApprovalId: string | null }[];
}

export interface ClosureResult extends ClosurePreview {
  terminatedCount: number;
  rejectedApprovalCount: number;
  cancelledRunCount: number;
  cancelledWakeupCount: number;
  archived: boolean;
  terminationOrder: string[];
}

export interface CloseTeamOptions {
  projectName: string;
  archiveAfterClose?: boolean;
}
