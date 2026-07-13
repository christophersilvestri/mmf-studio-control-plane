// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Project } from "@paperclipai/shared";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectDetail } from "./ProjectDetail";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockProjectsApi = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  previewTeamClosure: vi.fn(),
  closeTeam: vi.fn(),
}));
const mockIssuesApi = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
}));
const mockAgentsApi = vi.hoisted(() => ({ list: vi.fn() }));
const mockHeartbeatsApi = vi.hoisted(() => ({ liveRunsForCompany: vi.fn() }));
const mockBudgetsApi = vi.hoisted(() => ({ overview: vi.fn(), upsertPolicy: vi.fn() }));
const mockExecutionWorkspacesApi = vi.hoisted(() => ({ list: vi.fn() }));
const mockInstanceSettingsApi = vi.hoisted(() => ({ getExperimental: vi.fn() }));
const mockAssetsApi = vi.hoisted(() => ({ uploadImage: vi.fn() }));
const mockResourceMembershipsApi = vi.hoisted(() => ({
  listMine: vi.fn(),
  updateProject: vi.fn(),
}));
const mockNavigate = vi.hoisted(() => vi.fn());
const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());
const mockIssuesList = vi.hoisted(() => vi.fn());

vi.mock("../api/projects", () => ({ projectsApi: mockProjectsApi }));
vi.mock("../api/issues", () => ({ issuesApi: mockIssuesApi }));
vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("../api/heartbeats", () => ({ heartbeatsApi: mockHeartbeatsApi }));
vi.mock("../api/budgets", () => ({ budgetsApi: mockBudgetsApi }));
vi.mock("../api/execution-workspaces", () => ({ executionWorkspacesApi: mockExecutionWorkspacesApi }));
vi.mock("../api/instanceSettings", () => ({ instanceSettingsApi: mockInstanceSettingsApi }));
vi.mock("../api/assets", () => ({ assetsApi: mockAssetsApi }));
vi.mock("../api/resourceMemberships", () => ({ resourceMembershipsApi: mockResourceMembershipsApi }));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to: string }) => <a href={to}>{children}</a>,
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
  useLocation: () => ({ pathname: "/projects/project-1/plugin-operations", search: "", hash: "", state: null }),
  useNavigate: () => mockNavigate,
  useParams: () => ({ projectId: "project-1" }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [{ id: "company-1", issuePrefix: "PAP" }],
    selectedCompanyId: "company-1",
    setSelectedCompanyId: vi.fn(),
  }),
}));
vi.mock("../context/PanelContext", () => ({ usePanel: () => ({ closePanel: vi.fn() }) }));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast: vi.fn() }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mockSetBreadcrumbs }) }));
vi.mock("@/plugins/slots", () => ({
  PluginSlotMount: () => null,
  PluginSlotOutlet: () => null,
  usePluginSlots: () => ({ slots: [], isLoading: false }),
}));
vi.mock("@/plugins/launchers", () => ({ PluginLauncherOutlet: () => null }));
vi.mock("../components/ProjectProperties", () => ({
  ProjectProperties: () => <div data-testid="project-properties" />,
}));
vi.mock("../components/BudgetPolicyCard", () => ({
  BudgetPolicyCard: () => <div data-testid="budget-policy-card" />,
}));
vi.mock("../components/InlineEditor", () => ({
  InlineEditor: ({ value, placeholder }: { value?: string; placeholder?: string }) => (
    <span>{value || placeholder || null}</span>
  ),
}));
vi.mock("../components/ProjectWorkspacesContent", () => ({
  ProjectWorkspacesContent: () => <div data-testid="project-workspaces" />,
}));
vi.mock("../components/PageTabBar", () => ({
  PageTabBar: ({ items }: { items: Array<{ value: string; label: string }> }) => (
    <div>{items.map((item) => <button key={item.value}>{item.label}</button>)}</div>
  ),
}));
vi.mock("../components/IssuesList", () => ({
  IssuesList: (props: unknown) => {
    mockIssuesList(props);
    return <div data-testid="issues-list" />;
  },
}));

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

function project(overrides: Partial<Project> = {}): Project {
  const now = new Date("2026-05-01T00:00:00Z");
  return {
    id: "project-1",
    companyId: "company-1",
    urlKey: "project-1",
    goalId: null,
    goalIds: [],
    goals: [],
    name: "Managed Project",
    description: null,
    status: "in_progress",
    leadAgentId: null,
    targetDate: null,
    color: "#14b8a6",
    icon: null,
    env: null,
    pauseReason: null,
    pausedAt: null,
    executionWorkspacePolicy: null,
    codebase: {
      workspaceId: null,
      repoUrl: null,
      repoRef: null,
      defaultRef: null,
      repoName: null,
      localFolder: null,
      managedFolder: "/tmp/project-1",
      effectiveLocalFolder: "/tmp/project-1",
      origin: "managed_checkout",
    },
    workspaces: [],
    primaryWorkspace: null,
    managedByPlugin: {
      id: "managed-1",
      pluginId: "plugin-1",
      pluginKey: "paperclip.missions",
      pluginDisplayName: "Missions",
      resourceKind: "project",
      resourceKey: "operations",
      defaultsJson: {},
      createdAt: now,
      updatedAt: now,
    },
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("ProjectDetail", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockProjectsApi.get.mockResolvedValue(project());
    mockProjectsApi.list.mockResolvedValue([project()]);
    mockProjectsApi.previewTeamClosure.mockResolvedValue({
      projectId: "project-1",
      projectName: "Managed Project",
      included: [
        { agentId: "specialist-1", name: "Researcher", role: "researcher", reason: "Active project agent", pendingApprovalId: null },
        { agentId: "orchestrator-1", name: "Orchestrator", role: "manager", reason: "Active project agent", pendingApprovalId: null },
      ],
      excluded: [
        { agentId: "director-1", name: "MMF Studio Director", role: "ceo", reason: "Permanent agent protected by lifecycle policy", pendingApprovalId: null },
      ],
    });
    mockProjectsApi.closeTeam.mockResolvedValue({
      projectId: "project-1", projectName: "Managed Project", included: [], excluded: [],
      terminatedCount: 2, rejectedApprovalCount: 0, cancelledRunCount: 1,
      cancelledWakeupCount: 0, archived: false, terminationOrder: ["specialist-1", "orchestrator-1"],
    });
    mockIssuesApi.list.mockResolvedValue([]);
    mockAgentsApi.list.mockResolvedValue([]);
    mockHeartbeatsApi.liveRunsForCompany.mockResolvedValue([]);
    mockBudgetsApi.overview.mockResolvedValue({ policies: [] });
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: false });
    mockExecutionWorkspacesApi.list.mockResolvedValue([]);
    mockResourceMembershipsApi.listMine.mockResolvedValue({
      projectMemberships: {},
      agentMemberships: {},
      updatedAt: null,
    });
    mockResourceMembershipsApi.updateProject.mockResolvedValue({
      resourceType: "project",
      resourceId: "project-1",
      state: "left",
      updatedAt: new Date("2026-05-01T00:00:00Z"),
    });
  });

  afterEach(async () => {
    await act(() => root?.unmount());
    root = null;
    container.remove();
    vi.clearAllMocks();
  });

  it("shows managed plugin affordances and filters the operations tab by plugin origin", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      root = createRoot(container);
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProjectDetail />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("Managed by Missions");
    expect(container.textContent).toContain("Plugin operations");
    expect(mockIssuesApi.list).toHaveBeenCalledWith("company-1", {
      projectId: "project-1",
      originKindPrefix: "plugin:paperclip.missions",
    });
  });

  it("previews the exact project team and requires typed confirmation before closure", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    await act(async () => {
      root = createRoot(container);
      root.render(<QueryClientProvider client={queryClient}><ProjectDetail /></QueryClientProvider>);
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Close project team…"));
    const trigger = Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.trim() === "Close project team…") as HTMLButtonElement;
    await act(async () => { trigger.click(); });
    await vi.waitFor(() => expect(mockProjectsApi.previewTeamClosure).toHaveBeenCalled());
    await vi.waitFor(() => expect(document.body.textContent).toContain("Researcher"));
    expect(document.body.textContent).toContain("MMF Studio Director — Permanent agent protected by lifecycle policy");

    const input = document.body.querySelector('input[placeholder="Managed Project"]') as HTMLInputElement;
    const confirm = Array.from(document.body.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.trim() === "Close project team") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Managed Project");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(confirm.disabled).toBe(false);
    await act(async () => { confirm.click(); });
    await vi.waitFor(() => expect(mockProjectsApi.closeTeam).toHaveBeenCalledWith(
      "project-1",
      { projectName: "Managed Project", archiveAfterClose: false },
      "company-1",
    ));
  });
});
