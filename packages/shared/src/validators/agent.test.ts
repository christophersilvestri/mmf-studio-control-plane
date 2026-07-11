import { describe, expect, it } from "vitest";
import { createAgentHireSchema } from "./agent.js";

describe("createAgentHireSchema", () => {
  it("preserves strict trusted-template intent instead of applying legacy defaults", () => {
    const payload = {
      templateSlug: "project-orchestrator",
      projectId: "a8a13a35-d40f-4c8a-b9bc-ef8c33869c0f",
      sourceIssueId: "af37855f-2e2c-4e36-81e2-732def1d4d37",
      name: "Findymail Project Orchestrator",
    };

    expect(createAgentHireSchema.parse(payload)).toEqual(payload);
  });

  it("rejects protected adapter configuration mixed into trusted-template intent", () => {
    const parsed = createAgentHireSchema.safeParse({
      templateSlug: "project-orchestrator",
      projectId: "a8a13a35-d40f-4c8a-b9bc-ef8c33869c0f",
      sourceIssueId: "af37855f-2e2c-4e36-81e2-732def1d4d37",
      adapterConfig: { instructionsFilePath: "/tmp/injected.md" },
    });

    expect(parsed.success).toBe(false);
  });
});
