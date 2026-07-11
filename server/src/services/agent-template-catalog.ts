import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { unprocessable } from "../errors.js";

const templateSchema = z.object({
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1),
  status: z.enum(["active", "inactive"]).default("active"),
  role: z.string().trim().min(1),
  title: z.string().trim().min(1).nullable().optional(),
  icon: z.string().trim().min(1).nullable().optional(),
  capabilities: z.string().trim().min(1).nullable().optional(),
  namePattern: z.string().trim().min(1),
  allowedParentRoles: z.array(z.string().trim().min(1)).min(1),
  requiresProjectWorkspace: z.boolean().default(true),
  adapterType: z.string().trim().min(1),
  adapterConfig: z.record(z.string(), z.unknown()).default({}),
  runtimeConfig: z.record(z.string(), z.unknown()).default({}),
  permissions: z.record(z.string(), z.unknown()).default({}),
  budgetMonthlyCents: z.number().int().nonnegative().default(0),
}).strict();

const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  templates: z.array(templateSchema).min(1),
}).strict().superRefine((catalog, ctx) => {
  const seen = new Set<string>();
  for (const [index, template] of catalog.templates.entries()) {
    if (seen.has(template.slug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate template slug: ${template.slug}`,
        path: ["templates", index, "slug"],
      });
    }
    seen.add(template.slug);
  }
});

export type TrustedAgentTemplate = z.infer<typeof templateSchema>;
export type TrustedAgentTemplateCatalog = z.infer<typeof catalogSchema>;

let cachedCatalog: { sourcePath: string; value: TrustedAgentTemplateCatalog } | null = null;

function catalogPath() {
  const configured = process.env.MMF_AGENT_TEMPLATE_REGISTRY_PATH?.trim();
  if (!configured) {
    throw unprocessable(
      "Trusted agent templates are not configured. Set MMF_AGENT_TEMPLATE_REGISTRY_PATH on the Paperclip server.",
    );
  }
  return path.resolve(configured);
}

function substitutionValues() {
  return {
    MMF_STUDIO_REPO_ROOT: process.env.MMF_STUDIO_REPO_ROOT?.trim() ?? "",
  } as const;
}

function substituteString(value: string) {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (match, rawKey: string) => {
    if (rawKey === "PROJECT_NAME" || rawKey === "PROJECT_WORKSPACE") return match;
    const key = rawKey as keyof ReturnType<typeof substitutionValues>;
    const replacement = substitutionValues()[key];
    if (replacement === undefined) {
      throw unprocessable(`Trusted agent template references unsupported variable ${match}`);
    }
    if (!replacement) {
      throw unprocessable(`Trusted agent template requires server variable ${rawKey}`);
    }
    return replacement;
  });
}

function substituteValue(value: unknown): unknown {
  if (typeof value === "string") return substituteString(value);
  if (Array.isArray(value)) return value.map(substituteValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, substituteValue(entry)]),
    );
  }
  return value;
}

export async function loadTrustedAgentTemplateCatalog(options: { forceReload?: boolean } = {}) {
  const sourcePath = catalogPath();
  if (!options.forceReload && cachedCatalog?.sourcePath === sourcePath) return cachedCatalog.value;

  let raw: string;
  try {
    raw = await readFile(sourcePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw unprocessable(`Unable to read trusted agent template registry at ${sourcePath}: ${message}`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw unprocessable(`Trusted agent template registry is not valid JSON: ${message}`);
  }

  const expanded = substituteValue(parsedJson);
  const parsed = catalogSchema.safeParse(expanded);
  if (!parsed.success) {
    throw unprocessable(`Trusted agent template registry is invalid: ${parsed.error.message}`);
  }

  cachedCatalog = { sourcePath, value: parsed.data };
  return parsed.data;
}

export async function getTrustedAgentTemplate(slug: string) {
  const catalog = await loadTrustedAgentTemplateCatalog();
  const template = catalog.templates.find((entry) => entry.slug === slug);
  if (!template) throw unprocessable(`Unknown trusted agent template: ${slug}`);
  if (template.status !== "active") throw unprocessable(`Trusted agent template is inactive: ${slug}`);
  return template;
}

export function resetTrustedAgentTemplateCatalogCacheForTests() {
  cachedCatalog = null;
}
