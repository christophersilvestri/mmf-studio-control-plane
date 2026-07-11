import { describe, expect, it } from "vitest";
import { wouldOrphanPendingWakeInteraction } from "../services/issue-review-continuation.js";

describe("issue review continuation", () => {
  it("blocks clearing the agent while a wake interaction is pending", () => {
    expect(wouldOrphanPendingWakeInteraction({
      currentAssigneeAgentId: "orchestrator",
      requestedAssigneeAgentId: null,
      requestedAssigneeUserId: "local-board",
      hasPendingWakeInteraction: true,
    })).toBe(true);
  });

  it("blocks replacing the agent with a human-only assignment", () => {
    expect(wouldOrphanPendingWakeInteraction({
      currentAssigneeAgentId: "orchestrator",
      requestedAssigneeAgentId: undefined,
      requestedAssigneeUserId: "local-board",
      hasPendingWakeInteraction: true,
    })).toBe(true);
  });

  it("allows terminal human handoff when no wake interaction is pending", () => {
    expect(wouldOrphanPendingWakeInteraction({
      currentAssigneeAgentId: "orchestrator",
      requestedAssigneeAgentId: undefined,
      requestedAssigneeUserId: "local-board",
      hasPendingWakeInteraction: false,
    })).toBe(false);
  });
});
