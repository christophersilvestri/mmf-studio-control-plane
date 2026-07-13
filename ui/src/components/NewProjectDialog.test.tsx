// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewProjectDialog } from "./NewProjectDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const closeNewProject = vi.fn();
const projectsApi = vi.hoisted(() => ({
  create: vi.fn(), createWorkspace: vi.fn(), previewDriveBrain: vi.fn(), createFromDrive: vi.fn(),
}));

vi.mock("../context/DialogContext", () => ({ useDialog: () => ({ newProjectOpen: true, closeNewProject }) }));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1", selectedCompany: { id: "company-1", name: "MMF Studio Lab" } }),
}));
vi.mock("../api/projects", () => ({ projectsApi }));
vi.mock("../api/access", () => ({ accessApi: { listUserDirectory: vi.fn().mockResolvedValue({ users: [] }) } }));
vi.mock("../api/agents", () => ({ agentsApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock("../api/goals", () => ({ goalsApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock("../api/assets", () => ({ assetsApi: { uploadImage: vi.fn() } }));
vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Description" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
vi.mock("./PathInstructionsModal", () => ({ ChoosePathButton: () => <button type="button">Choose path</button> }));
vi.mock("./StatusBadge", () => ({ StatusBadge: ({ status }: { status: string }) => <span>{status}</span> }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

let container: HTMLDivElement;
let root: Root;

function button(text: string) {
  const candidate = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.includes(text));
  if (!candidate) throw new Error(`Button not found: ${text}`);
  return candidate as HTMLButtonElement;
}

async function change(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function click(element: HTMLElement) {
  await act(async () => { element.click(); await Promise.resolve(); });
}

beforeEach(async () => {
  vi.clearAllMocks();
  projectsApi.previewDriveBrain.mockResolvedValue({
    ok: true, folderId: "folder_1234567890", folderName: "Acme Sources",
    targetPath: "/brains/acme", inventoryCount: 4, files: [],
  });
  projectsApi.createFromDrive.mockResolvedValue({
    project: { id: "project-1", name: "Acme Website" },
    brain: { targetPath: "/brains/acme", inventoryCount: 4, importedCount: 4, skippedCount: 0 },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => { root.render(<QueryClientProvider client={client}><NewProjectDialog /></QueryClientProvider>); });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("NewProjectDialog Google Drive brain", () => {
  it("requires validation and creates through the atomic Drive-brain endpoint", async () => {
    const nameInput = container.querySelector('input[placeholder="Project name"]') as HTMLInputElement;
    await change(nameInput, "Acme Website");
    await click(button("Google Drive"));
    const folderInput = container.querySelector('input[placeholder^="https://drive.google.com/drive/folders"]') as HTMLInputElement;
    await change(folderInput, "https://drive.google.com/drive/folders/folder_1234567890");
    expect(button("Create project").disabled).toBe(true);
    await click(button("Validate"));
    await vi.waitFor(() => expect(container.textContent).toContain("Ready: Acme Sources · 4 source files"));
    expect(projectsApi.previewDriveBrain).toHaveBeenCalledWith("company-1", expect.objectContaining({ name: "Acme Website" }));
    expect(button("Create project").disabled).toBe(false);
    await click(button("Create project"));
    await vi.waitFor(() => expect(projectsApi.createFromDrive).toHaveBeenCalledWith("company-1", expect.objectContaining({
      name: "Acme Website", driveFolderRef: "https://drive.google.com/drive/folders/folder_1234567890",
    })));
    expect(projectsApi.create).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(closeNewProject).toHaveBeenCalled());
  });

  it("invalidates validation when the folder link changes", async () => {
    await change(container.querySelector('input[placeholder="Project name"]') as HTMLInputElement, "Acme Website");
    await click(button("Google Drive"));
    const folderInput = container.querySelector('input[placeholder^="https://drive.google.com/drive/folders"]') as HTMLInputElement;
    await change(folderInput, "folder_1234567890");
    await click(button("Validate"));
    await vi.waitFor(() => expect(container.textContent).toContain("Ready: Acme Sources"));
    await change(folderInput, "folder_changed_12345");
    expect(button("Create project").disabled).toBe(true);
  });
});
