import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getTrustedAgentTemplate,
  loadTrustedAgentTemplateCatalog,
  resetTrustedAgentTemplateCatalogCacheForTests,
} from "../services/agent-template-catalog.js";

const previousRegistryPath = process.env.MMF_AGENT_TEMPLATE_REGISTRY_PATH;
const previousRepoRoot = process.env.MMF_STUDIO_REPO_ROOT;
const tempDirs: string[] = [];

async function writeRegistry(value: ReturnType<typeof validRegistry>, canonicalOverride?: unknown) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mmf-agent-registry-"));
  tempDirs.push(dir);
  const registryPath = path.join(dir, "trusted-registry.json");
  await writeFile(registryPath, JSON.stringify(value), "utf8");
  const canonicalPath = path.join(dir, "templates", "paperclip-agents", "registry.json");
  await mkdir(path.dirname(canonicalPath), { recursive: true });
  const canonical = canonicalOverride ?? {
    schemaVersion: 1,
    templates: value.templates.map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      status: "approved_v0",
      roleEnum: entry.role,
      defaultIcon: entry.icon,
      projectSpecific: true,
    })),
  };
  await writeFile(canonicalPath, JSON.stringify(canonical), "utf8");
  process.env.MMF_AGENT_TEMPLATE_REGISTRY_PATH = registryPath;
  process.env.MMF_STUDIO_REPO_ROOT = dir;
  resetTrustedAgentTemplateCatalogCacheForTests();
  return registryPath;
}

function validRegistry() {
  return {
    schemaVersion: 1,
    templates: [
      {
        slug: "project-orchestrator",
        name: "Project Orchestrator",
        status: "active",
        role: "pm",
        title: "Project Orchestrator",
        icon: "target",
        capabilities: "Runs one project",
        namePattern: "${PROJECT_NAME} Project Orchestrator",
        allowedParentRoles: ["ceo"],
        requiresProjectWorkspace: true,
        adapterType: "hermes_local",
        adapterConfig: {
          cwd: "${PROJECT_WORKSPACE}",
          instructionsFilePath: "${MMF_STUDIO_REPO_ROOT}/templates/project-orchestrator/agents.md",
        },
        runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true } },
        permissions: { canCreateAgents: false },
        budgetMonthlyCents: 0,
      },
    ],
  };
}

afterEach(async () => {
  resetTrustedAgentTemplateCatalogCacheForTests();
  if (previousRegistryPath === undefined) delete process.env.MMF_AGENT_TEMPLATE_REGISTRY_PATH;
  else process.env.MMF_AGENT_TEMPLATE_REGISTRY_PATH = previousRegistryPath;
  if (previousRepoRoot === undefined) delete process.env.MMF_STUDIO_REPO_ROOT;
  else process.env.MMF_STUDIO_REPO_ROOT = previousRepoRoot;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("trusted agent template catalog", () => {
  it("loads an active template and resolves only server-owned variables", async () => {
    await writeRegistry(validRegistry());

    const template = await getTrustedAgentTemplate("project-orchestrator");

    expect(template.adapterConfig.instructionsFilePath).toBe(
      path.join(process.env.MMF_STUDIO_REPO_ROOT!, "templates/project-orchestrator/agents.md"),
    );
    expect(template.adapterConfig.cwd).toBe("${PROJECT_WORKSPACE}");
    expect(template.namePattern).toBe("${PROJECT_NAME} Project Orchestrator");
  });

  it("fails closed when the registry is missing", async () => {
    process.env.MMF_AGENT_TEMPLATE_REGISTRY_PATH = "/definitely/missing/mmf-registry.json";
    resetTrustedAgentTemplateCatalogCacheForTests();

    await expect(loadTrustedAgentTemplateCatalog()).rejects.toMatchObject({ status: 422 });
  });

  it("rejects duplicate slugs", async () => {
    const registry = validRegistry();
    registry.templates.push({ ...registry.templates[0] });
    await writeRegistry(registry);

    await expect(loadTrustedAgentTemplateCatalog()).rejects.toMatchObject({ status: 422 });
  });

  it("fails closed when trusted role or icon drifts from the canonical registry", async () => {
    const trusted = validRegistry();
    const canonical = {
      schemaVersion: 1,
      templates: [{
        slug: "project-orchestrator",
        name: "Project Orchestrator",
        status: "approved_v0",
        roleEnum: "researcher",
        defaultIcon: "brain",
        projectSpecific: true,
      }],
    };
    await writeRegistry(trusted, canonical);

    await expect(loadTrustedAgentTemplateCatalog()).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("catalog drifted from canonical MMF registry"),
    });
  });

  it("rejects inactive and unknown templates", async () => {
    const registry = validRegistry();
    registry.templates[0].status = "inactive";
    await writeRegistry(registry);

    await expect(getTrustedAgentTemplate("project-orchestrator")).rejects.toMatchObject({ status: 422 });
    await expect(getTrustedAgentTemplate("missing-template")).rejects.toMatchObject({ status: 422 });
  });
});
