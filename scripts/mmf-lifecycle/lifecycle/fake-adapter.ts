/**
 * Fake Paperclip Adapter — Deterministic Isolated Testing
 * 
 * Provides a pure in-memory Paperclip simulation for acceptance testing.
 * All state is isolated per run instance. No network, no filesystem.
 * Same inputs always produce same outputs.
 */

import { randomUUID } from 'node:crypto';
import type {
  Agent, Issue, Approval, Run, Interaction, Watchdog,
  ActivityEntry, SyntheticBrief, LifecycleContext,
  AgentStatus, IssueStatus, ApprovalType, RunStatus, ApprovalStatus
} from './lifecycle-contract.js';

// ---------------------------------------------------------------------------
// Fake Paperclip
// ---------------------------------------------------------------------------

export interface FakeState {
  agents: Map<string, Agent>;
  issues: Map<string, Issue>;
  approvals: Map<string, Approval>;
  runs: Map<string, Run>;
  interactions: Map<string, Interaction>;
  watchdogs: Map<string, Watchdog>;
  activityLog: ActivityEntry[];
  projects: Map<string, ProjectRecord>;
  // Deterministic clock
  tick: number;
}

export interface ProjectRecord {
  id: string;
  name: string;
  status: 'backlog' | 'planned' | 'in_progress' | 'completed' | 'cancelled';
  companyId: string;
  goalId: string | null;
  primaryWorkspaceId: string | null;
}

export interface FakePaperclipOptions {
  directorId?: string;
  boardAutoApprove?: boolean;
  boardAutoDecision?: 'move_forward_with_limits' | 'collect_more_evidence';
  now?: () => Date;
}

export class FakePaperclip {
  private state: FakeState;
  private opts: Required<FakePaperclipOptions>;
  private companyId: string;
  private companyName: string;

  constructor(opts: FakePaperclipOptions = {}) {
    this.opts = {
      directorId: opts.directorId ?? makeId('agent-director', 1),
      boardAutoApprove: opts.boardAutoApprove ?? true,
      boardAutoDecision: opts.boardAutoDecision ?? 'move_forward_with_limits',
      now: opts.now ?? (() => new Date()),
    };

    this.companyId = makeId('company', 1);
    this.companyName = 'MMF Studio Lab';

    this.state = {
      agents: new Map(),
      issues: new Map(),
      approvals: new Map(),
      runs: new Map(),
      interactions: new Map(),
      watchdogs: new Map(),
      activityLog: [],
      projects: new Map(),
      tick: 0,
    };

    // Bootstrap the permanent Director
    const director: Agent = {
      id: this.opts.directorId,
      name: 'MMF Studio Director',
      role: 'director',
      status: 'active',
      reportsTo: null,
      capabilities: 'project-management,hire-approval,board-liaison',
      adapterType: 'hermes_local',
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
      isPermanent: true,
    };
    this.state.agents.set(director.id, director);
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  getState(): FakeState {
    return this.state;
  }

  getDirector(): Agent {
    return this.state.agents.get(this.opts.directorId)!;
  }

  getCompanyId(): string {
    return this.companyId;
  }

  getCompanyName(): string {
    return this.companyName;
  }

  now(): string {
    return this.opts.now().toISOString();
  }

  tick(): void {
    this.state.tick++;
  }

  // -------------------------------------------------------------------------
  // Context Resolution
  // -------------------------------------------------------------------------

  resolveContext(): { companyId: string; companyName: string; directorId: string } {
    return {
      companyId: this.companyId,
      companyName: this.companyName,
      directorId: this.opts.directorId,
    };
  }

  // -------------------------------------------------------------------------
  // Project Operations
  // -------------------------------------------------------------------------

  createProject(payload: {
    id?: string;
    name: string;
    description?: string;
    status?: string;
    workspace?: {
      name: string;
      sourceType: string;
      cwd: string;
      isPrimary: boolean;
      metadata?: Record<string, unknown>;
    };
  }): ProjectRecord {
    const projectId = payload.id ?? makeId('project', this.state.projects.size + 1);
    const project: ProjectRecord = {
      id: projectId,
      name: payload.name,
      status: (payload.status as ProjectRecord['status']) ?? 'backlog',
      companyId: this.companyId,
      goalId: null,
      primaryWorkspaceId: null,
    };
    this.state.projects.set(projectId, project);
    this.log('project.created', 'project', projectId, { name: payload.name });
    return project;
  }

  getProject(projectId: string): ProjectRecord | null {
    return this.state.projects.get(projectId) ?? null;
  }

  completeProject(projectId: string): void {
    const project = this.state.projects.get(projectId);
    if (project) {
      project.status = 'completed';
      this.state.projects.set(projectId, project);
      this.log('project.completed', 'project', projectId, {});
    }
  }

  // -------------------------------------------------------------------------
  // Agent Operations
  // -------------------------------------------------------------------------

  createAgent(payload: {
    id?: string;
    name: string;
    role: string;
    status?: AgentStatus;
    reportsTo?: string | null;
    capabilities?: string;
    adapterType?: string;
    isPermanent?: boolean;
  }): Agent {
    const agentId = payload.id ?? makeId('agent', this.state.agents.size + 1);
    const agent: Agent = {
      id: agentId,
      name: payload.name,
      role: payload.role,
      status: payload.status ?? 'idle',
      reportsTo: payload.reportsTo ?? null,
      capabilities: payload.capabilities ?? null,
      adapterType: payload.adapterType ?? 'hermes_local',
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
      isPermanent: payload.isPermanent ?? false,
    };
    this.state.agents.set(agentId, agent);
    this.log('agent.created', 'agent', agentId, { role: payload.role, name: payload.name });
    return agent;
  }

  getAgent(agentId: string): Agent | null {
    return this.state.agents.get(agentId) ?? null;
  }

  updateAgentStatus(agentId: string, status: AgentStatus): void {
    const agent = this.state.agents.get(agentId);
    if (agent) {
      agent.status = status;
      this.state.agents.set(agentId, agent);
      this.log('agent.status_changed', 'agent', agentId, { status });
    }
  }

  terminateAgent(agentId: string): void {
    const agent = this.state.agents.get(agentId);
    if (agent) {
      agent.status = 'terminated';
      this.state.agents.set(agentId, agent);
      this.log('agent.terminated', 'agent', agentId, { reason: 'project-complete' });
    }
  }

  listAgentsByCompany(_companyId: string): Agent[] {
    return Array.from(this.state.agents.values());
  }

  // -------------------------------------------------------------------------
  // Issue Operations
  // -------------------------------------------------------------------------

  createIssue(payload: {
    id?: string;
    projectId: string;
    parentId?: string | null;
    title: string;
    description?: string;
    status?: IssueStatus;
    priority?: 'critical' | 'high' | 'medium' | 'low';
    assigneeAgentId?: string | null;
    assigneeUserId?: string | null;
    isBootstrapIssue?: boolean;
    isSetupIssue?: boolean;
    isDirectorReviewIssue?: boolean;
    isSpecialistHireIssue?: boolean;
    isActivityIssue?: boolean;
    isHumanReviewGate?: boolean;
    isFinalHandoff?: boolean;
    blockedBy?: string[];
    blocking?: string[];
  }): Issue {
    const issueId = payload.id ?? makeId('issue', this.state.issues.size + 1);
    const issue: Issue = {
      id: issueId,
      projectId: payload.projectId,
      parentId: payload.parentId ?? null,
      title: payload.title,
      description: payload.description ?? '',
      status: payload.status ?? 'backlog',
      priority: payload.priority ?? 'medium',
      assigneeAgentId: payload.assigneeAgentId ?? null,
      assigneeUserId: payload.assigneeUserId ?? null,
      checkoutRunId: null,
      executionRunId: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      hiddenAt: null,
      isBootstrapIssue: payload.isBootstrapIssue ?? false,
      isSetupIssue: payload.isSetupIssue ?? false,
      isDirectorReviewIssue: payload.isDirectorReviewIssue ?? false,
      isSpecialistHireIssue: payload.isSpecialistHireIssue ?? false,
      isActivityIssue: payload.isActivityIssue ?? false,
      isHumanReviewGate: payload.isHumanReviewGate ?? false,
      isFinalHandoff: payload.isFinalHandoff ?? false,
      blockedBy: payload.blockedBy ?? [],
      blocking: payload.blocking ?? [],
    };
    this.state.issues.set(issueId, issue);
    this.log('issue.created', 'issue', issueId, { title: payload.title, status: issue.status });
    return issue;
  }

  getIssue(issueId: string): Issue | null {
    return this.state.issues.get(issueId) ?? null;
  }

  updateIssueStatus(issueId: string, status: IssueStatus): void {
    const issue = this.state.issues.get(issueId);
    if (issue) {
      issue.status = status;
      if (status === 'in_progress' && !issue.startedAt) {
        issue.startedAt = this.now();
      }
      if (status === 'done' && !issue.completedAt) {
        issue.completedAt = this.now();
      }
      if (status === 'cancelled' && !issue.cancelledAt) {
        issue.cancelledAt = this.now();
      }
      this.state.issues.set(issueId, issue);
      this.log('issue.status_changed', 'issue', issueId, { status });
    }
  }

  assignIssue(issueId: string, agentId: string | null): void {
    const issue = this.state.issues.get(issueId);
    if (issue) {
      issue.assigneeAgentId = agentId;
      this.state.issues.set(issueId, issue);
      this.log('issue.assigned', 'issue', issueId, { assigneeAgentId: agentId });
    }
  }

  addBlocker(issueId: string, blockerId: string): void {
    const issue = this.state.issues.get(issueId);
    if (issue && !issue.blockedBy.includes(blockerId)) {
      issue.blockedBy.push(blockerId);
      this.state.issues.set(issueId, issue);
    }
    const blocker = this.state.issues.get(blockerId);
    if (blocker && !blocker.blocking.includes(issueId)) {
      blocker.blocking.push(issueId);
      this.state.issues.set(blockerId, blocker);
    }
    this.log('issue.blocked', 'issue', issueId, { blockerId });
  }

  removeBlocker(issueId: string, blockerId: string): void {
    const issue = this.state.issues.get(issueId);
    if (issue) {
      issue.blockedBy = issue.blockedBy.filter(id => id !== blockerId);
      if (issue.blockedBy.length === 0 && issue.status === 'blocked') {
        issue.status = 'todo';
      }
      this.state.issues.set(issueId, issue);
    }
    const blocker = this.state.issues.get(blockerId);
    if (blocker) {
      blocker.blocking = blocker.blocking.filter(id => id !== issueId);
      this.state.issues.set(blockerId, blocker);
    }
    this.log('issue.unblocked', 'issue', issueId, { blockerId });
  }

  listIssuesByProject(projectId: string): Issue[] {
    return Array.from(this.state.issues.values()).filter(i => i.projectId === projectId);
  }

  // -------------------------------------------------------------------------
  // Approval Operations
  // -------------------------------------------------------------------------

  createApproval(payload: {
    id?: string;
    type: ApprovalType;
    status?: ApprovalStatus;
    requestedByAgentId?: string | null;
    requestedByUserId?: string | null;
    payload: Record<string, unknown>;
  }): Approval {
    const approvalId = payload.id ?? makeId('approval', this.state.approvals.size + 1);
    const approval: Approval = {
      id: approvalId,
      type: payload.type,
      status: payload.status ?? 'pending',
      requestedByAgentId: payload.requestedByAgentId ?? null,
      requestedByUserId: payload.requestedByUserId ?? null,
      payload: payload.payload,
      decisionNote: null,
      decidedByUserId: null,
      decidedAt: null,
    };
    this.state.approvals.set(approvalId, approval);
    this.log('approval.created', 'approval', approvalId, { type: payload.type, status: 'pending' });

    // Auto-approve if configured
    if (this.opts.boardAutoApprove && approval.status === 'pending') {
      this.resolveApproval(approvalId, 'approved', 'Synthetic auto-approval for acceptance testing');
    }

    return approval;
  }

  resolveApproval(approvalId: string, status: 'approved' | 'rejected', decisionNote: string): void {
    const approval = this.state.approvals.get(approvalId);
    if (approval) {
      approval.status = status;
      approval.decisionNote = decisionNote;
      approval.decidedAt = this.now();
      this.state.approvals.set(approvalId, approval);
      this.log(`approval.${status}`, 'approval', approvalId, { decisionNote });
    }
  }

  getApproval(approvalId: string): Approval | null {
    return this.state.approvals.get(approvalId) ?? null;
  }

  listPendingApprovals(): Approval[] {
    return Array.from(this.state.approvals.values()).filter(a => a.status === 'pending');
  }

  // -------------------------------------------------------------------------
  // Run Operations
  // -------------------------------------------------------------------------

  createRun(payload: {
    id?: string;
    issueId: string;
    agentId: string;
    status?: RunStatus;
  }): Run {
    const runId = payload.id ?? makeId('run', this.state.runs.size + 1);
    const run: Run = {
      id: runId,
      issueId: payload.issueId,
      agentId: payload.agentId,
      status: payload.status ?? 'queued',
      startedAt: null,
      finishedAt: null,
      error: null,
    };
    this.state.runs.set(runId, run);
    this.log('run.created', 'run', runId, { issueId: payload.issueId, agentId: payload.agentId });
    return run;
  }

  updateRunStatus(runId: string, status: RunStatus, error?: string): void {
    const run = this.state.runs.get(runId);
    if (run) {
      run.status = status;
      if (['queued', 'running'].includes(status) && !run.startedAt) {
        run.startedAt = this.now();
      }
      if (['succeeded', 'failed', 'cancelled', 'timed_out'].includes(status) && !run.finishedAt) {
        run.finishedAt = this.now();
      }
      if (error) {
        run.error = error;
      }
      this.state.runs.set(runId, run);
      this.log('run.status_changed', 'run', runId, { status });
    }
  }

  getRun(runId: string): Run | null {
    return this.state.runs.get(runId) ?? null;
  }

  listActiveRuns(): Run[] {
    return Array.from(this.state.runs.values()).filter(r => ['queued', 'running'].includes(r.status));
  }

  // -------------------------------------------------------------------------
  // Interaction Operations
  // -------------------------------------------------------------------------

  createInteraction(payload: {
    id?: string;
    issueId: string;
    kind: 'ask_user_questions';
    status?: 'pending' | 'completed' | 'cancelled';
    payload: Record<string, unknown>;
  }): Interaction {
    const interactionId = payload.id ?? makeId('interaction', this.state.interactions.size + 1);
    const interaction: Interaction = {
      id: interactionId,
      issueId: payload.issueId,
      kind: payload.kind,
      status: payload.status ?? 'pending',
      payload: payload.payload,
    };
    this.state.interactions.set(interactionId, interaction);
    this.log('interaction.created', 'interaction', interactionId, { kind: payload.kind });

    // Auto-complete if board decision configured
    if (this.opts.boardAutoDecision && interaction.status === 'pending') {
      this.resolveInteraction(interactionId, this.opts.boardAutoDecision);
    }

    return interaction;
  }

  resolveInteraction(interactionId: string, decision: string): void {
    const interaction = this.state.interactions.get(interactionId);
    if (interaction) {
      interaction.status = 'completed';
      (interaction.payload as Record<string, unknown>).selected = decision;
      this.state.interactions.set(interactionId, interaction);
      this.log('interaction.completed', 'interaction', interactionId, { decision });
    }
  }

  cancelInteraction(interactionId: string): void {
    const interaction = this.state.interactions.get(interactionId);
    if (interaction) {
      interaction.status = 'cancelled';
      this.state.interactions.set(interactionId, interaction);
      this.log('interaction.cancelled', 'interaction', interactionId, {});
    }
  }

  listPendingInteractions(): Interaction[] {
    return Array.from(this.state.interactions.values()).filter(i => i.status === 'pending');
  }

  // -------------------------------------------------------------------------
  // Watchdog Operations
  // -------------------------------------------------------------------------

  createWatchdog(projectId: string): Watchdog {
    const watchdogId = makeId('watchdog', this.state.watchdogs.size + 1);
    const watchdog: Watchdog = {
      id: watchdogId,
      projectId,
      removed: false,
      removedAt: null,
    };
    this.state.watchdogs.set(watchdogId, watchdog);
    this.log('watchdog.created', 'watchdog', watchdogId, { projectId });
    return watchdog;
  }

  removeWatchdog(watchdogId: string): void {
    const watchdog = this.state.watchdogs.get(watchdogId);
    if (watchdog) {
      watchdog.removed = true;
      watchdog.removedAt = this.now();
      this.state.watchdogs.set(watchdogId, watchdog);
      this.log('watchdog.removed', 'watchdog', watchdogId, {});
    }
  }

  getWatchdogByProject(projectId: string): Watchdog | null {
    return Array.from(this.state.watchdogs.values()).find(w => w.projectId === projectId && !w.removed) ?? null;
  }

  // -------------------------------------------------------------------------
  // Activity Log
  // -------------------------------------------------------------------------

  log(
    action: string,
    entityType: string,
    entityId: string,
    details: Record<string, unknown> = {}
  ): void {
    const entry: ActivityEntry = {
      id: randomUUID(),
      action,
      entityType,
      entityId,
      actorType: 'system',
      actorId: 'paperclip-fake-adapter',
      details,
      createdAt: this.now(),
    };
    this.state.activityLog.push(entry);
  }

  getActivityLog(): ActivityEntry[] {
    return [...this.state.activityLog];
  }

  // -------------------------------------------------------------------------
  // Lifecycle Context Builder
  // -------------------------------------------------------------------------

  buildLifecycleContext(
    projectId: string,
    projectIndex: number,
    brief: SyntheticBrief,
    existingSpecialists?: Agent[],
    existingOrchestrator?: Agent | null
  ): LifecycleContext {
    // Pass the SAME Map references so mutations during phase execution
    // land in the fake's state.  This is required because the harness
    // re-syncs ctx ← fake.state after every phase; if ctx has a copy,
    // those mutations are silently discarded.
    //
    // Derive orchestrator from state.agents.  Re-use existing orchestrator
    // and specialists references if provided (preserves Phase 3/6 mutations);
    // otherwise derive from agents registry (fresh start).
    const allAgents = Array.from(this.state.agents.values());
    const orchestratorFromAgents = allAgents.find(
      a => a.role === 'project-orchestrator' && a.id !== this.opts.directorId
    ) ?? null;
    const specialistsFromAgents = allAgents.filter(
      a => a.role !== 'director' && a.role !== 'project-orchestrator' && a.id !== this.opts.directorId
    );
    // Preserve existing references if provided and non-null/non-empty; otherwise use derived list
    const orchestrator: Agent | null =
      existingOrchestrator !== undefined ? existingOrchestrator : orchestratorFromAgents;
    const specialists: Agent[] =
      existingSpecialists && existingSpecialists.length > 0
        ? existingSpecialists
        : specialistsFromAgents;

    return {
      projectId,
      projectIndex,
      brief,
      director: this.getDirector(),
      orchestrator,
      specialists,
      agents: this.state.agents,
      issues: this.state.issues,
      approvals: this.state.approvals,
      runs: this.state.runs,
      interactions: this.state.interactions,
      watchdog: this.getWatchdogByProject(projectId),
      activityLog: this.state.activityLog,
      boardAutoApprove: this.opts.boardAutoApprove,
      boardAutoDecision: this.opts.boardAutoDecision,
      now: this.opts.now,
    };
  }

  // -------------------------------------------------------------------------
  // Snapshot
  // -------------------------------------------------------------------------

  snapshot(): Readonly<FakeState> {
    return {
      agents: new Map(this.state.agents),
      issues: new Map(this.state.issues),
      approvals: new Map(this.state.approvals),
      runs: new Map(this.state.runs),
      interactions: new Map(this.state.interactions),
      watchdogs: new Map(this.state.watchdogs),
      activityLog: [...this.state.activityLog],
      projects: new Map(this.state.projects),
      tick: this.state.tick,
    };
  }
}

// ---------------------------------------------------------------------------
// Deterministic ID generator
// ---------------------------------------------------------------------------

let _counter = 0;
export function makeId(prefix: string, idx?: number): string {
  if (idx !== undefined) {
    return `${prefix}-${String(idx).padStart(4, '0')}`;
  }
  _counter++;
  return `${prefix}-${String(_counter).padStart(4, '0')}-${randomUUID().slice(0, 8)}`;
}

export function resetCounter(): void {
  _counter = 0;
}

// ---------------------------------------------------------------------------
// Helper: build a complete synthetic project lifecycle context
// ---------------------------------------------------------------------------

export interface SyntheticProjectSetup {
  brief: SyntheticBrief;
  projectId: string;
  fake: FakePaperclip;
  context: LifecycleContext;
  startedAt?: string;
}

export function createSyntheticProject(
  idx: number,
  opts: FakePaperclipOptions = {}
): SyntheticProjectSetup {
  resetCounter();
  const fake = new FakePaperclip(opts);

  const projectId = `mmf-acceptance-20260713-run${idx}`;
  const brief: SyntheticBrief = {
    client: `MMF Acceptance Run ${idx}`,
    name: `Synthetic Project ${idx}`,
    challenge: `Prove the full lifecycle contract through phase 14 for synthetic acceptance run ${idx}.`,
    outcomes: ['Research synthesis', 'Copy review', 'Analytics summary'],
    sourceFolder: `synthetic://acceptance/run${idx}/source`,
    deliverablesFolder: `synthetic://acceptance/run${idx}/deliverables`,
    knowledgeBase: `synthetic://acceptance/run${idx}/knowledge`,
    budgetCap: '0',
  };

  // Create the project
  fake.createProject({ id: projectId, name: brief.name, status: 'backlog' });

  // Create the watchdog
  fake.createWatchdog(projectId);

  // Build initial context
  const context = fake.buildLifecycleContext(projectId, idx, brief);

  return { brief, projectId, fake, context };
}
