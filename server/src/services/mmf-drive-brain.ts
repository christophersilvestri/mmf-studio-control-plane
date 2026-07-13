import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPT = path.resolve(here, "../../scripts/mmf_drive_brain_import.py");
const DEFAULT_BRAIN_ROOT = path.join(os.homedir(), "brain/clients/client-projects");
const DEFAULT_TEMPLATE_ROOT = path.join(DEFAULT_BRAIN_ROOT, "_template_mmf-studio-client-project");
const DEFAULT_SERVICE_ACCOUNT = path.join(os.homedir(), ".hermes/.secrets/gws-service-account.json");

export interface DriveBrainImportResult {
  ok: boolean;
  dryRun: boolean;
  folderId: string;
  folderName?: string;
  folderUrl?: string;
  targetPath: string;
  inventoryCount: number;
  importedCount?: number;
  skippedCount?: number;
  manifestPath?: string;
  records?: Array<Record<string, unknown>>;
  files?: Array<Record<string, unknown>>;
}

export interface DriveBrainImporterOptions {
  scriptPath?: string;
  pythonPath?: string;
  brainRoot?: string;
  templateRoot?: string;
  serviceAccountFile?: string;
  impersonateUser?: string;
  fixturePath?: string;
  timeoutMs?: number;
}

function parseJsonOutput(stdout: string): DriveBrainImportResult {
  const line = stdout.trim().split("\n").filter(Boolean).at(-1);
  if (!line) throw new Error("Drive brain importer returned no result");
  const result = JSON.parse(line) as DriveBrainImportResult & { error?: string };
  if (!result.ok) throw new Error(result.error || "Drive brain import failed");
  return result;
}

export function driveBrainImporter(options: DriveBrainImporterOptions = {}) {
  const scriptPath = options.scriptPath ?? process.env.PAPERCLIP_MMF_DRIVE_IMPORT_SCRIPT ?? DEFAULT_SCRIPT;
  const pythonPath = options.pythonPath ?? process.env.PAPERCLIP_MMF_PYTHON ?? path.join(os.homedir(), ".hermes/venv/bin/python3");
  const brainRoot = path.resolve(options.brainRoot ?? process.env.PAPERCLIP_MMF_BRAIN_ROOT ?? DEFAULT_BRAIN_ROOT);
  const templateRoot = path.resolve(options.templateRoot ?? process.env.PAPERCLIP_MMF_BRAIN_TEMPLATE ?? DEFAULT_TEMPLATE_ROOT);
  const serviceAccountFile = path.resolve(options.serviceAccountFile ?? process.env.PAPERCLIP_MMF_GOOGLE_SA_FILE ?? DEFAULT_SERVICE_ACCOUNT);
  const impersonateUser = options.impersonateUser ?? process.env.PAPERCLIP_MMF_GOOGLE_IMPERSONATE_USER ?? "chris@conversionalchemy.net";
  const timeoutMs = options.timeoutMs ?? 300_000;
  const fixturePath = options.fixturePath ?? (process.env.NODE_ENV === "test" ? process.env.PAPERCLIP_MMF_DRIVE_FIXTURE : undefined);

  async function run(input: { folderRef: string; projectName: string; projectSlug?: string; dryRun?: boolean }) {
    const args = [
      scriptPath,
      "--folder", input.folderRef,
      "--project-name", input.projectName,
      "--brain-root", brainRoot,
      "--template-root", templateRoot,
      "--service-account-file", serviceAccountFile,
      "--impersonate-user", impersonateUser,
    ];
    if (input.projectSlug) args.push("--project-slug", input.projectSlug);
    if (input.dryRun) args.push("--dry-run");
    if (fixturePath) args.push("--fixture", fixturePath);

    try {
      const { stdout } = await execFileAsync(pythonPath, args, {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
      return parseJsonOutput(stdout);
    } catch (error) {
      const candidate = error as { stdout?: string; stderr?: string; killed?: boolean };
      if (candidate.stdout) {
        try { return parseJsonOutput(candidate.stdout); } catch (parsedError) { throw parsedError; }
      }
      if (candidate.killed) throw new Error("Drive brain import timed out");
      throw new Error(candidate.stderr?.trim() || (error instanceof Error ? error.message : "Drive brain import failed"));
    }
  }

  async function rollback(result: DriveBrainImportResult) {
    if (result.dryRun) return;
    const target = path.resolve(result.targetPath);
    const [canonicalBrainRoot, canonicalTargetParent] = await Promise.all([
      fs.realpath(brainRoot),
      fs.realpath(path.dirname(target)),
    ]);
    if (canonicalTargetParent !== canonicalBrainRoot || path.basename(target).startsWith("_") || target === brainRoot) {
      throw new Error("Refusing to remove an unsafe project brain path");
    }
    const manifestPath = path.join(target, "00_project-context/drive-import-manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { folderId?: string };
    if (manifest.folderId !== result.folderId) throw new Error("Project brain rollback provenance mismatch");
    await fs.rm(target, { recursive: true, force: false });
  }

  return { run, rollback, brainRoot, templateRoot };
}
