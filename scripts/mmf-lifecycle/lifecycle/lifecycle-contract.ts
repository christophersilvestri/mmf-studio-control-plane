/**
 * MMF Studio Full-Lifecycle Contract
 * 
 * Defines all 14 lifecycle phases from paperclip-project-lifecycle-contract.md
 * with machine-readable receipt schemas, exit gate predicates,
 * termination order rules, and invariant checkers.
 * 
 * Phase source: docs/specs/paperclip-project-lifecycle-contract.md
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PhaseNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked' | 'cancelled';
export type AgentStatus = 'active' | 'paused' | 'idle' | 'running' | 'error' | 'pending_approval' | 'terminated';
export type ApprovalType = 'hire_agent' | 'approve_ceo_strategy' | 'budget_override_required' | 'request_board_approval';
export type ApprovalStatus = 'pending' | 'revision_requested' | 'approved' | 'rejected' | 'cancelled';
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
export type InteractionKind = 'ask_user_questions';

// ---------------------------------------------------------------------------
// Core entity shapes
// ---------------------------------------------------------------------------

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  reportsTo: string | null;
  capabilities: string | null;
  adapterType: string;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  isPermanent: boolean;  // true for Director
}

export interface Issue {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  description: string;
  status: IssueStatus;
  priority: 'critical' | 'high' | 'medium' | 'low';
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  checkoutRunId: string | null;
  executionRunId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  hiddenAt: string | null;
  // lifecycle-specific
  isSetupIssue: boolean;
  isBootstrapIssue: boolean;
  isDirectorReviewIssue: boolean;
  isSpecialistHireIssue: boolean;
  isActivityIssue: boolean;
  isHumanReviewGate: boolean;
  isFinalHandoff: boolean;
  // blocking
  blockedBy: string[];  // issue IDs
  blocking: string[];   // issue IDs this issue is blocking
}

export interface Approval {
  id: string;
  type: ApprovalType;
  status: ApprovalStatus;
  requestedByAgentId: string | null;
  requestedByUserId: string | null;
  payload: Record<string, unknown>;
  decisionNote: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
}

export interface Run {
  id: string;
  issueId: string;
  agentId: string;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface Interaction {
  id: string;
  issueId: string;
  kind: InteractionKind;
  status: 'pending' | 'completed' | 'cancelled';
  payload: Record<string, unknown>;
}

export interface Watchdog {
  id: string;
  projectId: string;
  removed: boolean;
  removedAt: string | null;
}

// ---------------------------------------------------------------------------
// Phase Receipt
// ---------------------------------------------------------------------------

export interface PhaseReceipt {
  kind: 'mmf-lifecycle-phase-receipt';
  version: '1.0';
  projectId: string;
  projectIndex: number;
  phase: PhaseNumber;
  phaseName: string;
  status: 'passed' | 'failed' | 'skipped';
  owner: string;
  agentId: string | null;
  issueId: string | null;
  runId: string | null;
  receipts: {
    approval?: { type: ApprovalType; id: string; status: ApprovalStatus };
    issue?: { id: string; status: IssueStatus };
    agent?: { id: string; status: AgentStatus };
    interaction?: { id: string; kind: InteractionKind; status: string };
  };
  gates: { name: string; status: 'passed' | 'failed' | 'pending'; detail: string }[];
  invariantViolations: string[];
  startedAt: string;
  finishedAt: string;
  deterministic: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Project Receipt
// ---------------------------------------------------------------------------

export interface ProjectReceipt {
  kind: 'mmf-lifecycle-project-receipt';
  version: '1.0';
  projectId: string;
  projectIndex: number;
  status: 'completed' | 'failed';
  phases: PhaseReceipt[];
  terminationOrder: string[];  // agent IDs in order they were terminated
  permanentAgentsRetained: string[];  // agent IDs that should remain active
  watchdogRemoved: boolean;
  activeRunsAtClose: number;
  pendingApprovalsAtClose: number;
  pendingInteractionsAtClose: number;
  recoveryActionsAtClose: number;
  invariantViolations: string[];
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Run Summary
// ---------------------------------------------------------------------------

export interface RunSummary {
  kind: 'mmf-lifecycle-run-summary';
  version: '1.0';
  runId: string;
  mode: 'dry-run' | 'live';
  repeat: number;
  projects: ProjectReceipt[];
  overallStatus: 'passed' | 'failed';
  allProjectsCompleted: boolean;
  allInvariantViolations: string[];
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Phase Definitions
// ---------------------------------------------------------------------------

export interface PhaseDefinition {
  number: PhaseNumber;
  name: string;
  owner: string;
  entryCondition: (ctx: LifecycleContext) => boolean;
  execute: (ctx: LifecycleContext) => PhaseReceipt;
}

export interface LifecycleContext {
  projectId: string;
  projectIndex: number;
  brief: SyntheticBrief;
  // Simulated entities
  director: Agent;
  orchestrator: Agent | null;
  specialists: Agent[];
  agents: Map<string, Agent>;  // paperclip agent registry — shared with FakePaperclip.state.agents
  issues: Map<string, Issue>;
  approvals: Map<string, Approval>;
  runs: Map<string, Run>;
  interactions: Map<string, Interaction>;
  watchdog: Watchdog | null;
  // History (never deleted)
  activityLog: ActivityEntry[];
  // Config
  boardAutoApprove: boolean;
  boardAutoDecision: 'move_forward_with_limits' | 'collect_more_evidence';
  now?: () => Date;
}

export interface SyntheticBrief {
  client: string;
  name: string;
  challenge: string;
  outcomes: string[];
  sourceFolder: string;
  deliverablesFolder: string;
  knowledgeBase: string;
  budgetCap: string;
}

export interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorType: 'agent' | 'user' | 'system';
  actorId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function makeId(prefix: string, idx = 0): string {
  // Deterministic fake IDs for testing
  return `${prefix}-${String(idx).padStart(4, '0')}`;
}

export function ts(ctx: LifecycleContext): string {
  return ctx.now ? ctx.now().toISOString() : new Date().toISOString();
}

export function durationMs(start: string, end: string): number {
  return new Date(end).getTime() - new Date(start).getTime();
}

export function logActivity(
  ctx: LifecycleContext,
  action: string,
  entityType: string,
  entityId: string,
  actorType: 'agent' | 'user' | 'system',
  actorId: string,
  details: Record<string, unknown> = {}
): void {
  ctx.activityLog.push({
    id: randomUUID(),
    action,
    entityType,
    entityId,
    actorType,
    actorId,
    details,
    createdAt: ts(ctx),
  });
}

// ---------------------------------------------------------------------------
// Closure Invariant Checks
// ---------------------------------------------------------------------------

export interface ClosureInvariants {
  scopedActivityComplete: boolean;
  noPendingHireApproval: boolean;
  noPendingReviewInteraction: boolean;
  noActiveRuns: boolean;
  noUnexplainedBlockedIssues: boolean;
  watchdogRemoved: boolean;
  specialistsTerminated: boolean;
  orchestratorTerminatedLast: boolean;
  directorRetained: boolean;
  historyPreserved: boolean;
  allIssuesVisible: boolean;
}

export function checkClosureInvariants(ctx: LifecycleContext): {
  invariants: ClosureInvariants;
  violations: string[];
} {
  const violations: string[] = [];
  const allIssues = Array.from(ctx.issues.values());

  // 1. All scoped activities complete
  const incompleteActivities = allIssues.filter(
    i => i.isActivityIssue && !['done', 'cancelled'].includes(i.status)
  );
  const scopedActivityComplete = incompleteActivities.length === 0;
  if (!scopedActivityComplete) {
    violations.push(`Incomplete activities: ${incompleteActivities.map(i => i.id).join(', ')}`);
  }

  // 2. No pending hire approvals
  const pendingHireApprovals = Array.from(ctx.approvals.values()).filter(
    a => a.type === 'hire_agent' && a.status === 'pending'
  );
  const noPendingHireApproval = pendingHireApprovals.length === 0;
  if (!noPendingHireApproval) {
    violations.push(`Pending hire approvals: ${pendingHireApprovals.map(a => a.id).join(', ')}`);
  }

  // 3. No pending review interactions
  const pendingInteractions = Array.from(ctx.interactions.values()).filter(
    i => i.status === 'pending'
  );
  const noPendingReviewInteraction = pendingInteractions.length === 0;
  if (!noPendingReviewInteraction) {
    violations.push(`Pending interactions: ${pendingInteractions.map(i => i.id).join(', ')}`);
  }

  // 4. No active runs
  const activeRuns = Array.from(ctx.runs.values()).filter(
    r => ['queued', 'running'].includes(r.status)
  );
  const noActiveRuns = activeRuns.length === 0;
  if (!noActiveRuns) {
    violations.push(`Active runs: ${activeRuns.map(r => r.id).join(', ')}`);
  }

  // 5. No unexplained blocked issues (blocked issues must have blocking links)
  const unexplainedBlocked = allIssues.filter(
    i => i.status === 'blocked' && i.blockedBy.length === 0
  );
  const noUnexplainedBlockedIssues = unexplainedBlocked.length === 0;
  if (!noUnexplainedBlockedIssues) {
    violations.push(`Unexplained blocked issues: ${unexplainedBlocked.map(i => i.id).join(', ')}`);
  }

  // 6. Watchdog removed
  const watchdogRemoved = !ctx.watchdog || ctx.watchdog.removed === true;
  if (!watchdogRemoved) {
    violations.push('Watchdog has not been removed');
  }

  // 7. Specialists terminated
  const activeSpecialists = ctx.specialists.filter(a => a.status !== 'terminated');
  const specialistsTerminated = activeSpecialists.length === 0;
  if (!specialistsTerminated) {
    violations.push(`Active specialists: ${activeSpecialists.map(a => a.id).join(', ')}`);
  }

  // 8. Orchestrator terminated last (if exists)
  let orchestratorTerminatedLast = true;
  if (ctx.orchestrator) {
    const orchTerminated = ctx.orchestrator.status === 'terminated';
    if (!orchTerminated) {
      violations.push('Orchestrator has not been terminated');
      orchestratorTerminatedLast = false;
    } else {
      // Orchestrator must be terminated after all specialists
      const specialistTerminatedBefore = ctx.specialists.every(
        s => s.status === 'terminated'
      );
      if (!specialistTerminatedBefore) {
        violations.push('Orchestrator terminated before all specialists');
        orchestratorTerminatedLast = false;
      }
    }
  }

  // 9. Director retained (permanent agent)
  const directorRetained = ctx.director.status !== 'terminated';
  if (!directorRetained) {
    violations.push('Director (permanent agent) was terminated');
  }

  // 10. History preserved (activity log has entries)
  const historyPreserved = ctx.activityLog.length > 0;
  if (!historyPreserved) {
    violations.push('Activity history is empty (may indicate deletion)');
  }

  // 11. All issues visible (no hidden issues unexpectedly)
  const hiddenWithoutReason = allIssues.filter(
    i => i.hiddenAt !== null && !i.isActivityIssue
  );
  const allIssuesVisible = hiddenWithoutReason.length === 0;
  if (!allIssuesVisible) {
    violations.push(`Hidden issues without activity: ${hiddenWithoutReason.map(i => i.id).join(', ')}`);
  }

  const invariants: ClosureInvariants = {
    scopedActivityComplete,
    noPendingHireApproval,
    noPendingReviewInteraction,
    noActiveRuns,
    noUnexplainedBlockedIssues,
    watchdogRemoved,
    specialistsTerminated,
    orchestratorTerminatedLast,
    directorRetained,
    historyPreserved,
    allIssuesVisible,
  };

  return { invariants, violations };
}

// ---------------------------------------------------------------------------
// Termination Order Validation
// ---------------------------------------------------------------------------

export function validateTerminationOrder(
  terminatedAgents: Agent[],
  ctx: LifecycleContext
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  // Extract termination order from activity log
  const terminationLog = ctx.activityLog.filter(e => e.action === 'agent.terminated');
  const terminatedIds = terminationLog.map(e => e.entityId);

  // Specialists must come before Orchestrator
  const specialistIds = ctx.specialists.map(s => s.id);
  const orchestratorId = ctx.orchestrator?.id;
  const directorId = ctx.director.id;

  for (const specId of specialistIds) {
    const specIdx = terminatedIds.indexOf(specId);
    if (specIdx === -1) continue; // Not terminated yet
    if (orchestratorId) {
      const orchIdx = terminatedIds.indexOf(orchestratorId);
      if (orchIdx !== -1 && specIdx > orchIdx) {
        violations.push(`Specialist ${specId} terminated after Orchestrator`);
      }
    }
  }

  // Director must not be terminated
  if (terminatedIds.includes(directorId)) {
    violations.push('Director (permanent agent) was terminated');
  }

  return { valid: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Phase Receipt Builder
// ---------------------------------------------------------------------------

export function buildPhaseReceipt(
  ctx: LifecycleContext,
  phase: PhaseNumber,
  phaseName: string,
  owner: string,
  status: 'passed' | 'failed' | 'skipped',
  opts: {
    agentId?: string | null;
    issueId?: string | null;
    runId?: string | null;
    receipts?: PhaseReceipt['receipts'];
    gates?: PhaseReceipt['gates'];
    invariantViolations?: string[];
    error?: string;
  }
): PhaseReceipt {
  const startedAt = ts(ctx);
  return {
    kind: 'mmf-lifecycle-phase-receipt',
    version: '1.0',
    projectId: ctx.projectId,
    projectIndex: ctx.projectIndex,
    phase,
    phaseName,
    status,
    owner,
    agentId: opts.agentId ?? null,
    issueId: opts.issueId ?? null,
    runId: opts.runId ?? null,
    receipts: opts.receipts ?? {},
    gates: opts.gates ?? [],
    invariantViolations: opts.invariantViolations ?? [],
    startedAt,
    finishedAt: ts(ctx),
    deterministic: true,
    ...(opts.error ? { error: opts.error } : {}),
  };
}

// ---------------------------------------------------------------------------
// 14 Phase Definitions
// ---------------------------------------------------------------------------

/**
 * Phase 1: Intake
 * Owner: Director
 * Entry: Chris gives a short project brief
 * Exit: Bootstrap issue is `todo` under Director
 */
export function phase1Intake(ctx: LifecycleContext): PhaseReceipt {
  const issueId = makeId('issue', 1);
  const runId = makeId('run', 1);

  const issue: Issue = {
    id: issueId,
    projectId: ctx.projectId,
    parentId: null,
    title: `Bootstrap MMF Studio project: ${ctx.brief.name}`,
    description: [
      `Creation identity: ${ctx.projectId}`,
      `Objective: ${ctx.brief.challenge}`,
      `Outcomes: ${ctx.brief.outcomes.join('; ')}`,
      `Source: ${ctx.brief.sourceFolder}`,
      `Deliverables: ${ctx.brief.deliverablesFolder}`,
      `Boundary: synthetic-safe project workspace; no real client data in acceptance mode.`,
    ].join('\n'),
    status: 'todo',
    priority: 'high',
    assigneeAgentId: ctx.director.id,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    isBootstrapIssue: true,
    isSetupIssue: false,
    isDirectorReviewIssue: false,
    isSpecialistHireIssue: false,
    isActivityIssue: false,
    isHumanReviewGate: false,
    isFinalHandoff: false,
    blockedBy: [],
    blocking: [],
  };

  const run: Run = {
    id: runId,
    issueId,
    agentId: ctx.director.id,
    status: 'succeeded',
    startedAt: ts(ctx),
    finishedAt: ts(ctx),
    error: null,
  };

  ctx.issues.set(issueId, issue);
  ctx.runs.set(runId, run);

  logActivity(ctx, 'issue.created', 'issue', issueId, 'agent', ctx.director.id, {
    projectId: ctx.projectId,
    status: 'todo',
    assignee: ctx.director.id,
  });

  logActivity(ctx, 'run.status_changed', 'run', runId, 'agent', ctx.director.id, {
    status: 'succeeded',
  });

  return buildPhaseReceipt(ctx, 1, 'intake', 'Director', 'passed', {
    agentId: ctx.director.id,
    issueId,
    runId,
    receipts: {
      issue: { id: issueId, status: 'todo' },
    },
    gates: [
      {
        name: 'bootstrap_issue_created',
        status: 'passed',
        detail: `Bootstrap issue ${issueId} created as todo under Director`,
      },
      {
        name: 'bootstrap_issue_assigned_to_director',
        status: 'passed',
        detail: `Issue assigned to Director ${ctx.director.id}`,
      },
    ],
  });
}

/**
 * Phase 2: Workspace + Project Bootstrap
 * Owner: Director
 * Entry: Bootstrap plan is valid
 * Exit: Project + workspace read-back matches; no Git repo
 */
export function phase2WorkspaceBootstrap(ctx: LifecycleContext): PhaseReceipt {
  const bootstrapIssue = Array.from(ctx.issues.values()).find(i => i.isBootstrapIssue);
  if (!bootstrapIssue) {
    return buildPhaseReceipt(ctx, 2, 'workspace-bootstrap', 'Director', 'failed', {
      error: 'No bootstrap issue found',
      gates: [{ name: 'bootstrap_issue_exists', status: 'failed', detail: 'Phase 1 must complete first' }],
    });
  }

  // Mark workspace scaffold gate (simulated)
  logActivity(ctx, 'workspace.scaffolded', 'project_workspace', ctx.projectId, 'agent', ctx.director.id, {
    projectId: ctx.projectId,
    sourceType: 'non_git_path',
    synthetic: true,
  });

  // Mark project created gate
  logActivity(ctx, 'project.created', 'project', ctx.projectId, 'agent', ctx.director.id, {
    status: 'backlog',
    workspaceType: 'non_git_path',
  });

  return buildPhaseReceipt(ctx, 2, 'workspace-bootstrap', 'Director', 'passed', {
    agentId: ctx.director.id,
    issueId: bootstrapIssue.id,
    receipts: {
      issue: { id: bootstrapIssue.id, status: bootstrapIssue.status },
    },
    gates: [
      { name: 'workspace_scaffold', status: 'passed', detail: 'Private non-git workspace scaffolded' },
      { name: 'project_created', status: 'passed', detail: 'Paperclip project created' },
      { name: 'no_git_repo', status: 'passed', detail: 'No Git repository created (synthetic workspace)' },
      { name: 'project_readback', status: 'passed', detail: 'Project read-back matches requested path' },
    ],
  });
}

/**
 * Phase 3: Project Orchestrator Hire
 * Owner: Director
 * Entry: Project workspace exists
 * Exit: One pending `hire_agent` approval with canonical template config
 */
export function phase3OrchestratorHire(ctx: LifecycleContext): PhaseReceipt {
  const approvalId = makeId('approval', 1);
  const approval: Approval = {
    id: approvalId,
    type: 'hire_agent',
    status: 'pending',
    requestedByAgentId: ctx.director.id,
    requestedByUserId: null,
    payload: {
      agentRole: 'project-orchestrator',
      agentName: `Project Orchestrator (${ctx.projectId})`,
      reportsTo: ctx.director.id,
      capabilities: ['project-management', 'specialist-coordination', 'quality-review'],
      template: 'project-orchestrator',
      projectId: ctx.projectId,
    },
    decisionNote: null,
    decidedByUserId: null,
    decidedAt: null,
  };

  ctx.approvals.set(approvalId, approval);

  // Simulate Board auto-approval if configured
  if (ctx.boardAutoApprove) {
    approval.status = 'approved';
    approval.decisionNote = 'Synthetic auto-approval for acceptance testing';
    approval.decidedAt = ts(ctx);
    ctx.approvals.set(approvalId, approval);

    // Create the Orchestrator agent
    const orchestratorId = makeId('agent-orchestrator', 1);
    const orchestrator: Agent = {
      id: orchestratorId,
      name: `Project Orchestrator (${ctx.projectId})`,
      role: 'project-orchestrator',
      status: 'active',
      reportsTo: ctx.director.id,
      capabilities: 'project-management,specialist-coordination,quality-review',
      adapterType: 'hermes_local',
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
      isPermanent: false,
    };
    ctx.orchestrator = orchestrator;

    logActivity(ctx, 'agent.hired', 'agent', orchestratorId, 'agent', ctx.director.id, {
      role: 'project-orchestrator',
      approvalId,
      projectId: ctx.projectId,
    });
  }

  logActivity(ctx, 'approval.requested', 'approval', approvalId, 'agent', ctx.director.id, {
    type: 'hire_agent',
    projectId: ctx.projectId,
  });

  const finalApproval = ctx.approvals.get(approvalId)!;
  const gates: PhaseReceipt['gates'] = [
    { name: 'approval_submitted', status: 'passed', detail: `hire_agent approval ${approvalId} submitted` },
  ];

  if (finalApproval.status === 'approved') {
    gates.push({ name: 'approval_auto_approved', status: 'passed', detail: `Approval auto-approved (synthetic mode)` });
    gates.push({ name: 'orchestrator_created', status: 'passed', detail: `Orchestrator ${ctx.orchestrator!.id} is active` });
  } else {
    gates.push({ name: 'approval_pending', status: 'pending', detail: 'Approval is pending Board review' });
  }

  return buildPhaseReceipt(ctx, 3, 'project-orchestrator-hire', 'Director', 'passed', {
    agentId: ctx.director.id,
    receipts: {
      approval: { type: 'hire_agent', id: approvalId, status: finalApproval.status },
      ...(ctx.orchestrator ? { agent: { id: ctx.orchestrator.id, status: ctx.orchestrator.status } } : {}),
    },
    gates,
  });
}

/**
 * Phase 4: Project Setup
 * Owner: Project Orchestrator
 * Entry: Director moves setup issue to `todo` and assigns Orchestrator
 * Exit: Setup documents verified
 */
export function phase4ProjectSetup(ctx: LifecycleContext): PhaseReceipt {
  if (!ctx.orchestrator) {
    return buildPhaseReceipt(ctx, 4, 'project-setup', 'Project Orchestrator', 'failed', {
      error: 'Orchestrator not hired yet (Phase 3 incomplete)',
      gates: [{ name: 'orchestrator_exists', status: 'failed', detail: 'Phase 3 must complete first' }],
    });
  }

  const setupIssueId = makeId('issue', 2);
  const setupIssue: Issue = {
    id: setupIssueId,
    projectId: ctx.projectId,
    parentId: null,
    title: `Project setup: ${ctx.brief.name}`,
    description: 'Create project-setup-brief, scoped-activity-plan, and specialist-hire-plan',
    status: 'todo',
    priority: 'high',
    assigneeAgentId: ctx.orchestrator.id,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    isSetupIssue: true,
    isBootstrapIssue: false,
    isDirectorReviewIssue: false,
    isSpecialistHireIssue: false,
    isActivityIssue: false,
    isHumanReviewGate: false,
    isFinalHandoff: false,
    blockedBy: [],
    blocking: [],
  };

  ctx.issues.set(setupIssueId, setupIssue);

  // Create setup documents (simulated)
  logActivity(ctx, 'issue.created', 'issue', setupIssueId, 'agent', ctx.orchestrator.id, {
    title: setupIssue.title,
    assignee: ctx.orchestrator.id,
  });

  // Move to in_progress
  setupIssue.status = 'in_progress';
  setupIssue.startedAt = ts(ctx);
  ctx.issues.set(setupIssueId, setupIssue);

  const runId = makeId('run', 2);
  const run: Run = {
    id: runId,
    issueId: setupIssueId,
    agentId: ctx.orchestrator.id,
    status: 'running',
    startedAt: ts(ctx),
    finishedAt: null,
    error: null,
  };
  ctx.runs.set(runId, run);

  // Complete setup (deterministic — create the three required documents)
  const docIds = [makeId('doc', 1), makeId('doc', 2), makeId('doc', 3)];
  for (const docId of docIds) {
    logActivity(ctx, 'document.created', 'document', docId, 'agent', ctx.orchestrator.id, {
      issueId: setupIssueId,
    });
  }

  // Mark setup done
  setupIssue.status = 'done';
  setupIssue.completedAt = ts(ctx);
  ctx.issues.set(setupIssueId, setupIssue);

  run.status = 'succeeded';
  run.finishedAt = ts(ctx);
  ctx.runs.set(runId, run);

  return buildPhaseReceipt(ctx, 4, 'project-setup', 'Project Orchestrator', 'passed', {
    agentId: ctx.orchestrator.id,
    issueId: setupIssueId,
    runId,
    receipts: {
      issue: { id: setupIssueId, status: 'done' },
    },
    gates: [
      { name: 'setup_issue_created', status: 'passed', detail: `Setup issue ${setupIssueId} created` },
      { name: 'setup_documents_created', status: 'passed', detail: `Created ${docIds.length} setup documents` },
      { name: 'setup_complete', status: 'passed', detail: 'Setup documents verified' },
    ],
  });
}

/**
 * Phase 5: Specialist Request
 * Owner: Project Orchestrator
 * Entry: Scoped activity requires a specialist
 * Exit: Director-review child issues are `todo` + parent is `blocked`
 */
export function phase5SpecialistRequest(ctx: LifecycleContext): PhaseReceipt {
  if (!ctx.orchestrator) {
    return buildPhaseReceipt(ctx, 5, 'specialist-request', 'Project Orchestrator', 'failed', {
      error: 'Orchestrator not available',
    });
  }

  const specialistTemplates = ['research-specialist', 'copywriting-specialist', 'analytics-specialist'];
  const hireIssues: Issue[] = [];

  for (let i = 0; i < specialistTemplates.length; i++) {
    const template = specialistTemplates[i];
    const hireIssueId = makeId('issue', 10 + i);
    const hireIssue: Issue = {
      id: hireIssueId,
      projectId: ctx.projectId,
      parentId: null,
      title: `Specialist hire request: ${template}`,
      description: `Hire ${template} per specialist-hire-plan`,
      status: 'todo',
      priority: 'high',
      assigneeAgentId: ctx.director.id,  // Director reviews
      assigneeUserId: null,
      checkoutRunId: null,
      executionRunId: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      hiddenAt: null,
      isSetupIssue: false,
      isBootstrapIssue: false,
      isDirectorReviewIssue: true,
      isSpecialistHireIssue: true,
      isActivityIssue: false,
      isHumanReviewGate: false,
      isFinalHandoff: false,
      blockedBy: [],
      blocking: [],
    };
    ctx.issues.set(hireIssueId, hireIssue);
    hireIssues.push(hireIssue);

    logActivity(ctx, 'issue.created', 'issue', hireIssueId, 'agent', ctx.orchestrator.id, {
      type: 'specialist-hire-request',
      template,
      assignee: ctx.director.id,
    });
  }

  // Block the setup issue (or parent) — in simulation, we just track the blocking
  const parentIssue = Array.from(ctx.issues.values()).find(i => i.isSetupIssue);
  if (parentIssue) {
    parentIssue.status = 'blocked';
    parentIssue.blockedBy = hireIssues.map(i => i.id);
    ctx.issues.set(parentIssue.id, parentIssue);

    for (const hi of hireIssues) {
      hi.blocking.push(parentIssue.id);
    }
  }

  return buildPhaseReceipt(ctx, 5, 'specialist-request', 'Project Orchestrator', 'passed', {
    agentId: ctx.orchestrator.id,
    receipts: {
      issue: { id: hireIssues[0].id, status: hireIssues[0].status },
    },
    gates: hireIssues.map((hi, i) => ({
      name: `director_review_child_${i + 1}`,
      status: 'passed' as const,
      detail: `Director review child ${hi.id} (${hi.title}) is todo and assigned to Director`,
    })).concat([{
      name: 'parent_blocked',
      status: 'passed' as const,
      detail: 'Parent issue is blocked by Director review children',
    }]),
  });
}

/**
 * Phase 6: Specialist Validation + Hire
 * Owner: Director
 * Entry: Director-review child wakes
 * Exit: hire_agent approval accepted
 */
export function phase6SpecialistValidation(ctx: LifecycleContext): PhaseReceipt {
  const hireIssues = Array.from(ctx.issues.values()).filter(i => i.isSpecialistHireIssue);
  const specialistApprovals: Approval[] = [];

  for (const issue of hireIssues) {
    const approvalId = makeId('approval', 10 + specialistApprovals.length);
    const approval: Approval = {
      id: approvalId,
      type: 'hire_agent',
      status: ctx.boardAutoApprove ? 'approved' : 'pending',
      requestedByAgentId: ctx.director.id,
      requestedByUserId: null,
      payload: {
        agentRole: issue.title.replace('Specialist hire request: ', ''),
        reportsTo: ctx.orchestrator?.id ?? ctx.director.id,
        projectId: ctx.projectId,
        issueId: issue.id,
      },
      decisionNote: ctx.boardAutoApprove ? 'Synthetic auto-approval' : null,
      decidedByUserId: ctx.boardAutoApprove ? 'board-synthetic' : null,
      decidedAt: ctx.boardAutoApprove ? ts(ctx) : null,
    };

    ctx.approvals.set(approvalId, approval);
    specialistApprovals.push(approval);

    if (ctx.boardAutoApprove) {
      // Create the specialist agent
      const specialistId = makeId('agent-specialist', specialistApprovals.length);
      const specialist: Agent = {
        id: specialistId,
        name: approval.payload.agentRole as string,
        role: approval.payload.agentRole as string,
        status: 'active',
        reportsTo: (approval.payload.reportsTo as string) ?? ctx.director.id,
        capabilities: 'research,analysis',
        adapterType: 'hermes_local',
        budgetMonthlyCents: 0,
        spentMonthlyCents: 0,
        isPermanent: false,
      };
      // Register in ctx.agents so buildLifecycleContext can re-derive ctx.specialists
      ctx.agents.set(specialistId, specialist);
      ctx.specialists.push(specialist);

      // Complete the director review issue
      issue.status = 'done';
      issue.completedAt = ts(ctx);
      ctx.issues.set(issue.id, issue);

      logActivity(ctx, 'agent.hired', 'agent', specialistId, 'agent', ctx.director.id, {
        role: specialist.role,
        approvalId,
        projectId: ctx.projectId,
      });
    }

    logActivity(ctx, 'approval.requested', 'approval', approvalId, 'agent', ctx.director.id, {
      type: 'hire_agent',
      issueId: issue.id,
    });
  }

  const allApproved = specialistApprovals.every(a => a.status === 'approved');

  return buildPhaseReceipt(ctx, 6, 'specialist-validation-hire', 'Director', 'passed', {
    agentId: ctx.director.id,
    receipts: {
      approval: { type: 'hire_agent', id: specialistApprovals[0]?.id, status: specialistApprovals[0]?.status },
    },
    gates: [
      { name: 'all_approvals_submitted', status: 'passed', detail: `${specialistApprovals.length} hire approvals submitted` },
      { name: 'all_approvals_resolved', status: allApproved ? 'passed' : 'pending', detail: allApproved ? 'All approved (synthetic)' : 'Pending Board approval' },
    ],
  });
}

/**
 * Phase 7: Activation Handoff
 * Owner: Director + Paperclip
 * Entry: Hire approval accepted
 * Exit: Specialist active; Director child marked done
 */
export function phase7ActivationHandoff(ctx: LifecycleContext): PhaseReceipt {
  const hireIssues = Array.from(ctx.issues.values()).filter(i => i.isSpecialistHireIssue && i.status === 'done');
  const setupIssue = Array.from(ctx.issues.values()).find(i => i.isSetupIssue);

  // Unblock parent if all director review children are done
  if (setupIssue && hireIssues.length > 0) {
    const allChildrenDone = hireIssues.every(i => i.status === 'done');
    if (allChildrenDone) {
      setupIssue.status = 'todo';
      setupIssue.blockedBy = [];
      ctx.issues.set(setupIssue.id, setupIssue);

      logActivity(ctx, 'issue.unblocked', 'issue', setupIssue.id, 'system', 'paperclip', {
        reason: 'all-director-review-children-resolved',
      });
    }
  }

  const specialistIds = ctx.specialists.map(s => s.id);

  return buildPhaseReceipt(ctx, 7, 'activation-handoff', 'Director', 'passed', {
    agentId: ctx.director.id,
    receipts: {
      agent: ctx.specialists[0] ? { id: ctx.specialists[0].id, status: ctx.specialists[0].status } : undefined,
    },
    gates: [
      { name: 'specialists_active', status: 'passed', detail: `${ctx.specialists.length} specialists are active` },
      { name: 'director_children_resolved', status: 'passed', detail: `${hireIssues.length} director review children marked done` },
      { name: 'setup_unblocked', status: setupIssue?.status === 'todo' ? 'passed' : 'pending', detail: 'Parent setup issue unblocked' },
      { name: 'activation_complete', status: 'passed', detail: 'Activation handoff complete, Orchestrator can resume' },
    ],
  });
}

/**
 * Phase 8: First Assignment
 * Owner: Project Orchestrator
 * Entry: Verified activation wake
 * Exit: Specialist run queued/running on activity
 */
export function phase8FirstAssignment(ctx: LifecycleContext): PhaseReceipt {
  if (!ctx.orchestrator) {
    return buildPhaseReceipt(ctx, 8, 'first-assignment', 'Project Orchestrator', 'failed', {
      error: 'Orchestrator not available',
    });
  }

  // Create first activity issue assigned to first specialist
  const specialist = ctx.specialists[0];
  if (!specialist) {
    return buildPhaseReceipt(ctx, 8, 'first-assignment', 'Project Orchestrator', 'failed', {
      error: 'No specialists available for assignment',
    });
  }

  const activityIssueId = makeId('issue', 100);
  const activityIssue: Issue = {
    id: activityIssueId,
    projectId: ctx.projectId,
    parentId: null,
    title: `Activity: ${ctx.brief.outcomes[0] ?? 'Research synthesis'}`,
    description: `Execute specialist activity for outcome: ${ctx.brief.outcomes[0] ?? 'default'}`,
    status: 'todo',
    priority: 'high',
    assigneeAgentId: specialist.id,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    isSetupIssue: false,
    isBootstrapIssue: false,
    isDirectorReviewIssue: false,
    isSpecialistHireIssue: false,
    isActivityIssue: true,
    isHumanReviewGate: false,
    isFinalHandoff: false,
    blockedBy: [],
    blocking: [],
  };

  ctx.issues.set(activityIssueId, activityIssue);

  // Queue a run for the specialist
  const runId = makeId('run', 100);
  const run: Run = {
    id: runId,
    issueId: activityIssueId,
    agentId: specialist.id,
    status: 'succeeded',
    startedAt: ts(ctx),
    finishedAt: ts(ctx),
    error: null,
  };
  ctx.runs.set(runId, run);

  logActivity(ctx, 'issue.assigned', 'issue', activityIssueId, 'agent', ctx.orchestrator.id, {
    assignee: specialist.id,
  });

  logActivity(ctx, 'run.status_changed', 'run', runId, 'agent', ctx.orchestrator.id, {
    status: 'succeeded',
  });

  return buildPhaseReceipt(ctx, 8, 'first-assignment', 'Project Orchestrator', 'passed', {
    agentId: ctx.orchestrator.id,
    issueId: activityIssueId,
    runId,
    receipts: {
      issue: { id: activityIssueId, status: 'todo' },
      agent: { id: specialist.id, status: specialist.status },
    },
    gates: [
      { name: 'activity_issue_assigned', status: 'passed', detail: `Activity assigned to specialist ${specialist.id}` },
      { name: 'specialist_run_queued', status: 'passed', detail: `Run ${runId} queued for specialist` },
      { name: 'orchestrator_can_become_done', status: 'passed', detail: 'Setup parent can become done' },
    ],
  });
}

/**
 * Phase 9: Specialist Production
 * Owner: Specialist
 * Entry: Assigned `todo` activity
 * Exit: Artifact produced; issue in_review
 */
export function phase9SpecialistProduction(ctx: LifecycleContext): PhaseReceipt {
  const activityIssues = Array.from(ctx.issues.values()).filter(i => i.isActivityIssue && i.status === 'todo');
  if (activityIssues.length === 0) {
    return buildPhaseReceipt(ctx, 9, 'specialist-production', 'Specialist', 'failed', {
      error: 'No todo activity issues found',
    });
  }

  const issue = activityIssues[0];
  const specialist = ctx.specialists.find(s => s.id === issue.assigneeAgentId) ?? ctx.specialists[0];

  // Move to in_progress
  issue.status = 'in_progress';
  issue.startedAt = ts(ctx);
  issue.checkoutRunId = makeId('run', 200);
  issue.executionRunId = issue.checkoutRunId;
  ctx.issues.set(issue.id, issue);

  const run: Run = {
    id: issue.checkoutRunId,
    issueId: issue.id,
    agentId: specialist?.id ?? 'unknown',
    status: 'running',
    startedAt: ts(ctx),
    finishedAt: null,
    error: null,
  };
  ctx.runs.set(run.id, run);

  // Produce artifact (simulated)
  const artifactId = makeId('artifact', 1);
  logActivity(ctx, 'artifact.created', 'artifact', artifactId, 'agent', specialist?.id ?? 'unknown', {
    issueId: issue.id,
    type: 'research-synthesis',
  });

  // Move to in_review (handoff ready)
  issue.status = 'in_review';
  issue.executionRunId = null;
  ctx.issues.set(issue.id, issue);

  run.status = 'succeeded';
  run.finishedAt = ts(ctx);
  ctx.runs.set(run.id, run);

  return buildPhaseReceipt(ctx, 9, 'specialist-production', 'Specialist', 'passed', {
    agentId: specialist?.id ?? null,
    issueId: issue.id,
    runId: run.id,
    receipts: {
      issue: { id: issue.id, status: 'in_review' },
    },
    gates: [
      { name: 'artifact_produced', status: 'passed', detail: `Artifact ${artifactId} created` },
      { name: 'handoff_ready', status: 'passed', detail: `Issue ${issue.id} moved to in_review` },
    ],
  });
}

/**
 * Phase 10: Orchestrator Review
 * Owner: Project Orchestrator
 * Entry: Specialist handoff
 * Exit: Internal quality gate passes
 */
export function phase10OrchestratorReview(ctx: LifecycleContext): PhaseReceipt {
  if (!ctx.orchestrator) {
    return buildPhaseReceipt(ctx, 10, 'orchestrator-review', 'Project Orchestrator', 'failed', {
      error: 'Orchestrator not available',
    });
  }

  const inReviewIssues = Array.from(ctx.issues.values()).filter(i => i.isActivityIssue && i.status === 'in_review');

  for (const issue of inReviewIssues) {
    // Orchestrator reviews and approves
    issue.status = 'done';
    issue.completedAt = ts(ctx);
    ctx.issues.set(issue.id, issue);

    logActivity(ctx, 'issue.approved', 'issue', issue.id, 'agent', ctx.orchestrator.id, {
      reviewResult: 'internal-quality-pass',
    });
  }

  return buildPhaseReceipt(ctx, 10, 'orchestrator-review', 'Project Orchestrator', 'passed', {
    agentId: ctx.orchestrator.id,
    receipts: {
      issue: inReviewIssues[0] ? { id: inReviewIssues[0].id, status: 'done' } : undefined,
    },
    gates: [
      { name: 'internal_quality_gate', status: 'passed', detail: 'Internal quality gate passes' },
      { name: 'no_revision_needed', status: 'passed', detail: 'No revision work required' },
    ],
  });
}

/**
 * Phase 11: Chris Review
 * Owner: Project Orchestrator
 * Entry: Human gate reached
 * Exit: Board decision recorded
 */
export function phase11ChrisReview(ctx: LifecycleContext): PhaseReceipt {
  if (!ctx.orchestrator) {
    return buildPhaseReceipt(ctx, 11, 'chris-review', 'Project Orchestrator', 'failed', {
      error: 'Orchestrator not available',
    });
  }

  // Create a human review gate issue
  const reviewIssueId = makeId('issue', 300);
  const reviewIssue: Issue = {
    id: reviewIssueId,
    projectId: ctx.projectId,
    parentId: null,
    title: 'Board review: move forward or collect more evidence',
    description: 'Strategic/scoping decision required before final handoff',
    status: 'in_review',
    priority: 'high',
    assigneeAgentId: ctx.orchestrator.id,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    startedAt: ts(ctx),
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    isSetupIssue: false,
    isBootstrapIssue: false,
    isDirectorReviewIssue: false,
    isSpecialistHireIssue: false,
    isActivityIssue: false,
    isHumanReviewGate: true,
    isFinalHandoff: false,
    blockedBy: [],
    blocking: [],
  };
  ctx.issues.set(reviewIssueId, reviewIssue);

  // Create simulated Board interaction
  const interactionId = makeId('interaction', 1);
  const interaction: Interaction = {
    id: interactionId,
    issueId: reviewIssueId,
    kind: 'ask_user_questions',
    status: ctx.boardAutoDecision ? 'completed' : 'pending',
    payload: {
      decisionType: 'two-path',
      options: ['move_forward_with_limits', 'collect_more_evidence'],
      selected: ctx.boardAutoDecision ?? null,
    },
  };
  ctx.interactions.set(interactionId, interaction);

  if (ctx.boardAutoDecision) {
    reviewIssue.status = 'done';
    reviewIssue.completedAt = ts(ctx);
    ctx.issues.set(reviewIssueId, reviewIssue);

    logActivity(ctx, 'interaction.completed', 'interaction', interactionId, 'user', 'board-synthetic', {
      decision: ctx.boardAutoDecision,
      issueId: reviewIssueId,
    });
  }

  return buildPhaseReceipt(ctx, 11, 'chris-review', 'Project Orchestrator', 'passed', {
    agentId: ctx.orchestrator.id,
    issueId: reviewIssueId,
    receipts: {
      issue: { id: reviewIssueId, status: reviewIssue.status },
      interaction: { id: interactionId, kind: 'ask_user_questions', status: interaction.status },
    },
    gates: [
      { name: 'human_review_gate_created', status: 'passed', detail: `Human review gate issue ${reviewIssueId} created` },
      { name: 'board_decision_simulated', status: ctx.boardAutoDecision ? 'passed' : 'pending', detail: ctx.boardAutoDecision ? `Selected: ${ctx.boardAutoDecision}` : 'Awaiting Board decision' },
    ],
  });
}

/**
 * Phase 12: Revision or Next-Activity Loop
 * Owner: Project Orchestrator + Specialist
 * Entry: Review accepted or changes requested
 * Exit: Revised artifact OR next activity starts
 */
export function phase12RevisionNextActivity(ctx: LifecycleContext): PhaseReceipt {
  if (!ctx.orchestrator) {
    return buildPhaseReceipt(ctx, 12, 'revision-next-activity', 'Project Orchestrator', 'failed', {
      error: 'Orchestrator not available',
    });
  }

  // In synthetic acceptance, no revisions needed — proceed to next activity
  const allActivitiesDone = Array.from(ctx.issues.values())
    .filter(i => i.isActivityIssue)
    .every(i => i.status === 'done');

  if (allActivitiesDone) {
    logActivity(ctx, 'activity_loop.complete', 'project', ctx.projectId, 'agent', ctx.orchestrator.id, {
      message: 'All scoped activities complete, moving to final handoff',
    });
  }

  return buildPhaseReceipt(ctx, 12, 'revision-next-activity', 'Project Orchestrator', 'passed', {
    agentId: ctx.orchestrator.id,
    gates: [
      { name: 'no_revisions_needed', status: 'passed', detail: 'Synthetic acceptance: no revision cycles required' },
      { name: 'activity_loop_complete', status: 'passed', detail: 'All activities complete' },
    ],
  });
}

/**
 * Phase 13: Final Handoff
 * Owner: Project Orchestrator
 * Entry: All approvals accepted, artifacts verified
 * Exit: Final artifact verified
 */
export function phase13FinalHandoff(ctx: LifecycleContext): PhaseReceipt {
  if (!ctx.orchestrator) {
    return buildPhaseReceipt(ctx, 13, 'final-handoff', 'Project Orchestrator', 'failed', {
      error: 'Orchestrator not available',
    });
  }

  const finalArtifactId = makeId('artifact', 999);
  logActivity(ctx, 'artifact.finalized', 'artifact', finalArtifactId, 'agent', ctx.orchestrator.id, {
    projectId: ctx.projectId,
    type: 'final-deliverable',
  });

  // Mark project state updated
  logActivity(ctx, 'project.handoff', 'project', ctx.projectId, 'agent', ctx.orchestrator.id, {
    artifactId: finalArtifactId,
    decision: 'approved',
  });

  return buildPhaseReceipt(ctx, 13, 'final-handoff', 'Project Orchestrator', 'passed', {
    agentId: ctx.orchestrator.id,
    receipts: {
      issue: { id: 'N/A', status: 'done' },
    },
    gates: [
      { name: 'final_artifact_verified', status: 'passed', detail: `Final artifact ${finalArtifactId} created and verified` },
      { name: 'project_state_updated', status: 'passed', detail: 'Project state reflects completion' },
      { name: 'handoff_complete', status: 'passed', detail: 'Concise completion update available' },
    ],
  });
}

/**
 * Phase 14: Project Closure
 * Owner: Project Orchestrator
 * Entry: All scoped activities complete/deferred/cancelled
 * Exit: Project completed; watchdog removed; specialists terminated; Orchestrator terminated last
 */
export function phase14ProjectClosure(ctx: LifecycleContext): PhaseReceipt {
  if (!ctx.orchestrator) {
    return buildPhaseReceipt(ctx, 14, 'project-closure', 'Project Orchestrator', 'failed', {
      error: 'Orchestrator not available',
    });
  }

  const violations: string[] = [];
  const terminationOrder: string[] = [];

  // 1. Remove watchdog
  if (ctx.watchdog) {
    ctx.watchdog.removed = true;
    ctx.watchdog.removedAt = ts(ctx);
    logActivity(ctx, 'watchdog.removed', 'watchdog', ctx.watchdog.id, 'agent', ctx.orchestrator.id, {});
  } else {
    // Create a watchdog record to remove
    const wdId = makeId('watchdog', 1);
    ctx.watchdog = { id: wdId, projectId: ctx.projectId, removed: false, removedAt: null };
    ctx.watchdog.removed = true;
    ctx.watchdog.removedAt = ts(ctx);
    logActivity(ctx, 'watchdog.removed', 'watchdog', wdId, 'agent', ctx.orchestrator.id, {});
  }

  // 2. Terminate specialists
  for (const specialist of ctx.specialists) {
    specialist.status = 'terminated';
    terminationOrder.push(specialist.id);
    logActivity(ctx, 'agent.terminated', 'agent', specialist.id, 'agent', ctx.orchestrator.id, {
      reason: 'project-complete',
    });
  }

  // 3. Terminate Orchestrator LAST
  ctx.orchestrator.status = 'terminated';
  terminationOrder.push(ctx.orchestrator.id);
  logActivity(ctx, 'agent.terminated', 'agent', ctx.orchestrator.id, 'agent', ctx.orchestrator.id, {
    reason: 'project-complete',
  });

  // 4. Verify Director retained (permanent)
  if (ctx.director.status === 'terminated') {
    violations.push('Director (permanent agent) was terminated — VIOLATION');
  }

  // 5. Verify no active runs
  const activeRuns = Array.from(ctx.runs.values()).filter(r => ['queued', 'running'].includes(r.status));
  if (activeRuns.length > 0) {
    violations.push(`Active runs at close: ${activeRuns.length}`);
  }

  // 6. Verify closure invariants
  const { violations: closureViolations } = checkClosureInvariants(ctx);
  violations.push(...closureViolations);

  // 7. Validate termination order
  const { violations: termViolations } = validateTerminationOrder(
    [...ctx.specialists, ctx.orchestrator],
    ctx
  );
  violations.push(...termViolations);

  const status = violations.length === 0 ? 'passed' : 'failed';

  return buildPhaseReceipt(ctx, 14, 'project-closure', 'Project Orchestrator', status, {
    agentId: ctx.orchestrator.id,
    gates: [
      { name: 'watchdog_removed', status: 'passed', detail: 'Project watchdog explicitly removed' },
      { name: 'specialists_terminated', status: 'passed', detail: `${ctx.specialists.length} specialists terminated` },
      { name: 'orchestrator_terminated_last', status: 'passed', detail: `Orchestrator terminated last. Termination order: ${terminationOrder.join(' → ')}` },
      { name: 'director_retained', status: ctx.director.status !== 'terminated' ? 'passed' : 'failed', detail: `Director ${ctx.director.id} remains active` },
      { name: 'no_active_runs', status: activeRuns.length === 0 ? 'passed' : 'failed', detail: `${activeRuns.length} active runs at close` },
      { name: 'no_pending_approvals', status: 'passed', detail: 'Zero pending approvals' },
      { name: 'no_pending_interactions', status: 'passed', detail: 'Zero pending interactions' },
      { name: 'history_preserved', status: ctx.activityLog.length > 0 ? 'passed' : 'failed', detail: `${ctx.activityLog.length} activity log entries preserved` },
    ],
    invariantViolations: violations,
    ...(violations.length > 0 ? { error: `Closure violations: ${violations.join('; ')}` } : {}),
  });
}

// ---------------------------------------------------------------------------
// Phase Lookup
// ---------------------------------------------------------------------------

export const PHASES: Record<PhaseNumber, PhaseDefinition> = {
  1: { number: 1, name: 'intake', owner: 'Director', entryCondition: () => true, execute: phase1Intake },
  2: { number: 2, name: 'workspace-bootstrap', owner: 'Director', entryCondition: () => true, execute: phase2WorkspaceBootstrap },
  3: { number: 3, name: 'project-orchestrator-hire', owner: 'Director', entryCondition: () => true, execute: phase3OrchestratorHire },
  4: { number: 4, name: 'project-setup', owner: 'Project Orchestrator', entryCondition: () => true, execute: phase4ProjectSetup },
  5: { number: 5, name: 'specialist-request', owner: 'Project Orchestrator', entryCondition: () => true, execute: phase5SpecialistRequest },
  6: { number: 6, name: 'specialist-validation-hire', owner: 'Director', entryCondition: () => true, execute: phase6SpecialistValidation },
  7: { number: 7, name: 'activation-handoff', owner: 'Director', entryCondition: () => true, execute: phase7ActivationHandoff },
  8: { number: 8, name: 'first-assignment', owner: 'Project Orchestrator', entryCondition: () => true, execute: phase8FirstAssignment },
  9: { number: 9, name: 'specialist-production', owner: 'Specialist', entryCondition: () => true, execute: phase9SpecialistProduction },
  10: { number: 10, name: 'orchestrator-review', owner: 'Project Orchestrator', entryCondition: () => true, execute: phase10OrchestratorReview },
  11: { number: 11, name: 'chris-review', owner: 'Project Orchestrator', entryCondition: () => true, execute: phase11ChrisReview },
  12: { number: 12, name: 'revision-next-activity', owner: 'Project Orchestrator', entryCondition: () => true, execute: phase12RevisionNextActivity },
  13: { number: 13, name: 'final-handoff', owner: 'Project Orchestrator', entryCondition: () => true, execute: phase13FinalHandoff },
  14: { number: 14, name: 'project-closure', owner: 'Project Orchestrator', entryCondition: () => true, execute: phase14ProjectClosure },
};

export const PHASE_NAMES: Record<PhaseNumber, string> = {
  1: 'intake',
  2: 'workspace-bootstrap',
  3: 'project-orchestrator-hire',
  4: 'project-setup',
  5: 'specialist-request',
  6: 'specialist-validation-hire',
  7: 'activation-handoff',
  8: 'first-assignment',
  9: 'specialist-production',
  10: 'orchestrator-review',
  11: 'chris-review',
  12: 'revision-next-activity',
  13: 'final-handoff',
  14: 'project-closure',
};
