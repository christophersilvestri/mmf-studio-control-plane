export function wouldOrphanPendingWakeInteraction(input: {
  currentAssigneeAgentId: string | null;
  requestedAssigneeAgentId: string | null | undefined;
  requestedAssigneeUserId: string | null | undefined;
  hasPendingWakeInteraction: boolean;
}) {
  if (!input.hasPendingWakeInteraction || !input.currentAssigneeAgentId) return false;
  if (input.requestedAssigneeAgentId === null) return true;
  return input.requestedAssigneeAgentId === undefined && typeof input.requestedAssigneeUserId === "string";
}
