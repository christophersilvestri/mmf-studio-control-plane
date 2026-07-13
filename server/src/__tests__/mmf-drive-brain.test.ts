import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { driveBrainImporter } from "../services/mmf-drive-brain.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(here, "../../scripts/mmf_drive_brain_import.py");
const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
});

async function fixtureSetup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-drive-brain-"));
  cleanups.push(root);
  const brainRoot = path.join(root, "brains");
  const templateRoot = path.join(root, "template");
  await fs.mkdir(path.join(templateRoot, "00_project-context"), { recursive: true });
  await fs.mkdir(path.join(templateRoot, "01_onboarding"), { recursive: true });
  await fs.writeFile(path.join(templateRoot, "00_project-context/brief.md"), "# Brief\n");
  const fixturePath = path.join(root, "drive.json");
  await fs.writeFile(fixturePath, JSON.stringify({
    folder: {
      id: "folder_1234567890", name: "Acme Sources",
      mimeType: "application/vnd.google-apps.folder",
      webViewLink: "https://drive.google.com/drive/folders/folder_1234567890",
    },
    items: [{
      id: "proposal_123456", name: "Project Proposal",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-07-01T00:00:00Z",
      webViewLink: "https://docs.google.com/document/d/proposal_123456/edit",
      path: "Acme Sources/Project Proposal", content: "The project scope.",
    }],
  }));
  return { root, brainRoot, templateRoot, fixturePath };
}

describe("driveBrainImporter", () => {
  it("runs a fixture-only dry run without writing a brain", async () => {
    const setup = await fixtureSetup();
    const importer = driveBrainImporter({
      scriptPath, pythonPath: "python3", brainRoot: setup.brainRoot,
      templateRoot: setup.templateRoot, fixturePath: setup.fixturePath,
    });
    const result = await importer.run({
      folderRef: "https://drive.google.com/drive/folders/folder_1234567890",
      projectName: "Acme Website", dryRun: true,
    });
    expect(result).toMatchObject({ ok: true, dryRun: true, inventoryCount: 1 });
    await expect(fs.stat(path.join(setup.brainRoot, "acme-website"))).rejects.toThrow();
  });

  it("creates and provenance-checks a project brain before rollback", async () => {
    const setup = await fixtureSetup();
    const importer = driveBrainImporter({
      scriptPath, pythonPath: "python3", brainRoot: setup.brainRoot,
      templateRoot: setup.templateRoot, fixturePath: setup.fixturePath,
    });
    const result = await importer.run({ folderRef: "folder_1234567890", projectName: "Acme Website" });
    expect(result).toMatchObject({ ok: true, dryRun: false, importedCount: 1, skippedCount: 0 });
    expect(await fs.readFile(path.join(result.targetPath, "01_onboarding/proposal.md"), "utf8")).toContain("The project scope.");
    await importer.rollback(result);
    await expect(fs.stat(result.targetPath)).rejects.toThrow();
  });

  it("refuses to overwrite an existing project brain", async () => {
    const setup = await fixtureSetup();
    const importer = driveBrainImporter({
      scriptPath, pythonPath: "python3", brainRoot: setup.brainRoot,
      templateRoot: setup.templateRoot, fixturePath: setup.fixturePath,
    });
    await importer.run({ folderRef: "folder_1234567890", projectName: "Acme Website" });
    await expect(importer.run({ folderRef: "folder_1234567890", projectName: "Acme Website" }))
      .rejects.toThrow("Project brain already exists");
  });
});
