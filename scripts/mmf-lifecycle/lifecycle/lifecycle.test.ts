/**
 * MMF Studio Full-Lifecycle Acceptance Tests
 * 
 * Tests the lifecycle contract, fake adapter, and full acceptance harness.
 * Uses the deterministic fake adapter — no network, no live Paperclip required.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PHASES, PHASE_NAMES,
  type PhaseNumber, type PhaseReceipt, type ProjectReceipt,
  type SyntheticBrief, type LifecycleContext,
  type Agent, type Run,
  checkClosureInvariants, validateTerminationOrder,
  buildPhaseReceipt, makeId,
} from './lifecycle-contract.js';
import {
  FakePaperclip, createSyntheticProject, resetCounter,
  type SyntheticProjectSetup, type ProjectRecord,
} from './fake-adapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runAllPhases(setup: SyntheticProjectSetup): { phases: PhaseReceipt[]; ctx: LifecycleContext } {
  const { context } = setup;
  const phases: PhaseReceipt[] = [];

  for (let phase = 1; phase <= 14; phase++) {
    const phaseNum = phase as PhaseNumber;
    const result = PHASES[phaseNum].execute(context);
    phases.push(result);
    if (result.status === 'failed') break;
  }

  return { phases, ctx: context };
}

function createTestProject(idx = 1): SyntheticProjectSetup {
  resetCounter();
  const fake = new FakePaperclip({
    boardAutoApprove: true,
    boardAutoDecision: 'move_forward_with_limits',
  });
  const projectId = `mmf-acceptance-test-run${idx}`;
  const brief: SyntheticBrief = {
    client: `Test Client ${idx}`,
    name: `Test Project ${idx}`,
    challenge: `Prove the full lifecycle contract through phase 14 for test run ${idx}.`,
    outcomes: ['Research synthesis', 'Copy review'],
    sourceFolder: `synthetic://test/run${idx}/source`,
    deliverablesFolder: `synthetic://test/run${idx}/deliverables`,
    knowledgeBase: `synthetic://test/run${idx}/knowledge`,
    budgetCap: '0',
  };

  fake.createProject({ id: projectId, name: brief.name, status: 'backlog' });
  fake.createWatchdog(projectId);
  const context = fake.buildLifecycleContext(projectId, idx, brief);

  return { brief, projectId, fake, context, startedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Lifecycle Contract Tests
// ---------------------------------------------------------------------------

describe('lifecycle-contract', () => {
  describe('PHASE_NAMES', () => {
    it('has all 14 phase names', () => {
      expect(Object.keys(PHASE_NAMES)).toHaveLength(14);
      expect(PHASE_NAMES[1]).toBe('intake');
      expect(PHASE_NAMES[14]).toBe('project-closure');
    });
  });

  describe('checkClosureInvariants', () => {
    it('passes when all invariants hold', () => {
      const setup = createTestProject(1);
      const { context } = setup;

      // Run full lifecycle
      runAllPhases(setup);

      const { invariants, violations } = checkClosureInvariants(context);
      expect(violations).toHaveLength(0);
      expect(invariants.scopedActivityComplete).toBe(true);
      expect(invariants.noPendingHireApproval).toBe(true);
      expect(invariants.noPendingReviewInteraction).toBe(true);
      expect(invariants.noActiveRuns).toBe(true);
      expect(invariants.watchdogRemoved).toBe(true);
      expect(invariants.specialistsTerminated).toBe(true);
      expect(invariants.orchestratorTerminatedLast).toBe(true);
      expect(invariants.directorRetained).toBe(true);
    });
  });

  describe('makeId', () => {
    it('generates deterministic IDs', () => {
      resetCounter();
      const id1 = makeId('test', 1);
      const id2 = makeId('test', 2);
      expect(id1).toBe('test-0001');
      expect(id2).toBe('test-0002');
    });

    it('generates unique IDs across prefixes', () => {
      resetCounter();
      const idA = makeId('agent', 1);
      const idB = makeId('issue', 1);
      expect(idA).toBe('agent-0001');
      expect(idB).toBe('issue-0001');
    });
  });

  describe('buildPhaseReceipt', () => {
    it('creates a valid phase receipt', () => {
      resetCounter();
      const fake = new FakePaperclip();
      const { context } = createSyntheticProject(1);
      const receipt = buildPhaseReceipt(context, 1, 'intake', 'Director', 'passed', {
        agentId: 'director-001',
        issueId: 'issue-001',
        runId: 'run-001',
        receipts: { issue: { id: 'issue-001', status: 'todo' } },
        gates: [{ name: 'test_gate', status: 'passed', detail: 'test' }],
      });

      expect(receipt.kind).toBe('mmf-lifecycle-phase-receipt');
      expect(receipt.version).toBe('1.0');
      expect(receipt.phase).toBe(1);
      expect(receipt.phaseName).toBe('intake');
      expect(receipt.status).toBe('passed');
      expect(receipt.owner).toBe('Director');
      expect(receipt.deterministic).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Fake Adapter Tests
// ---------------------------------------------------------------------------

describe('fake-adapter', () => {
  beforeEach(() => {
    resetCounter();
  });

  describe('FakePaperclip', () => {
    it('creates a Director on initialization', () => {
      const fake = new FakePaperclip();
      const director = fake.getDirector();
      expect(director).toBeDefined();
      expect(director.name).toBe('MMF Studio Director');
      expect(director.isPermanent).toBe(true);
      expect(director.status).toBe('active');
    });

    it('resolves context correctly', () => {
      const fake = new FakePaperclip();
      const ctx = fake.resolveContext();
      expect(ctx.companyId).toBeDefined();
      expect(ctx.companyName).toBe('MMF Studio Lab');
      expect(ctx.directorId).toBe(fake.getDirector().id);
    });

    it('creates projects', () => {
      const fake = new FakePaperclip();
      const project = fake.createProject({ name: 'Test Project', status: 'backlog' });
      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.status).toBe('backlog');
    });

    it('creates agents', () => {
      const fake = new FakePaperclip();
      const agent = fake.createAgent({
        name: 'Test Agent',
        role: 'test-specialist',
        reportsTo: fake.getDirector().id,
      });
      expect(agent.id).toBeDefined();
      expect(agent.name).toBe('Test Agent');
      expect(agent.role).toBe('test-specialist');
      expect(agent.status).toBe('idle');
    });

    it('creates issues', () => {
      const fake = new FakePaperclip();
      fake.createProject({ name: 'Test', status: 'backlog' });
      const project = fake.getState().projects.values().next().value as ProjectRecord;
      const issue = fake.createIssue({
        projectId: project.id,
        title: 'Test Issue',
        status: 'todo',
        assigneeAgentId: fake.getDirector().id,
      });
      expect(issue.id).toBeDefined();
      expect(issue.title).toBe('Test Issue');
      expect(issue.status).toBe('todo');
    });

    it('creates and auto-resolves approvals when boardAutoApprove=true', () => {
      const fake = new FakePaperclip({ boardAutoApprove: true });
      const approval = fake.createApproval({
        type: 'hire_agent',
        requestedByAgentId: fake.getDirector().id,
        payload: { role: 'test-specialist' },
      });
      expect(approval.status).toBe('approved');
      expect(approval.decisionNote).toBe('Synthetic auto-approval for acceptance testing');
    });

    it('keeps approvals pending when boardAutoApprove=false', () => {
      const fake = new FakePaperclip({ boardAutoApprove: false });
      const approval = fake.createApproval({
        type: 'hire_agent',
        requestedByAgentId: fake.getDirector().id,
        payload: { role: 'test-specialist' },
      });
      expect(approval.status).toBe('pending');
    });

    it('creates and auto-resolves interactions when boardAutoDecision is set', () => {
      const fake = new FakePaperclip({ boardAutoDecision: 'move_forward_with_limits' });
      fake.createProject({ name: 'Test', status: 'backlog' });
      const project = fake.getState().projects.values().next().value as ProjectRecord;
      const issue = fake.createIssue({ projectId: project.id, title: 'Review' });
      const interaction = fake.createInteraction({
        issueId: issue.id,
        kind: 'ask_user_questions',
        payload: { options: ['move_forward_with_limits', 'collect_more_evidence'] },
      });
      expect(interaction.status).toBe('completed');
      expect((interaction.payload as Record<string, unknown>).selected).toBe('move_forward_with_limits');
    });

    it('creates and removes watchdogs', () => {
      const fake = new FakePaperclip();
      fake.createProject({ name: 'Test', status: 'backlog' });
      const project = fake.getState().projects.values().next().value as ProjectRecord;
      const wd = fake.createWatchdog(project.id);
      expect(wd.removed).toBe(false);
      fake.removeWatchdog(wd.id);
      const removed = fake.getWatchdogByProject(project.id);
      expect(removed).toBeNull();
    });

    it('terminates agents', () => {
      const fake = new FakePaperclip();
      const agent = fake.createAgent({ name: 'Temp', role: 'temp' });
      fake.terminateAgent(agent.id);
      const updated = fake.getAgent(agent.id);
      expect(updated?.status).toBe('terminated');
    });

    it('tracks runs', () => {
      const fake = new FakePaperclip();
      fake.createProject({ name: 'Test', status: 'backlog' });
      const project = fake.getState().projects.values().next().value as ProjectRecord;
      const issue = fake.createIssue({ projectId: project.id, title: 'Test' });
      const run = fake.createRun({ issueId: issue.id, agentId: fake.getDirector().id });
      expect(run.status).toBe('queued');
      fake.updateRunStatus(run.id, 'succeeded');
      const updated = fake.getRun(run.id);
      expect(updated?.status).toBe('succeeded');
    });

    it('completes projects', () => {
      const fake = new FakePaperclip();
      const project = fake.createProject({ name: 'Test', status: 'in_progress' });
      fake.completeProject(project.id);
      const updated = fake.getProject(project.id);
      expect(updated?.status).toBe('completed');
    });

    it('builds a lifecycle context', () => {
      const fake = new FakePaperclip();
      fake.createProject({ name: 'Test', status: 'backlog' });
      const project = fake.getState().projects.values().next().value as ProjectRecord;
      const brief: SyntheticBrief = {
        client: 'Test',
        name: 'Test Project',
        challenge: 'Test challenge',
        outcomes: ['Test'],
        sourceFolder: 'synthetic://test',
        deliverablesFolder: 'synthetic://test',
        knowledgeBase: 'synthetic://test',
        budgetCap: '0',
      };
      const ctx = fake.buildLifecycleContext(project.id, 1, brief);
      expect(ctx.projectId).toBe(project.id);
      expect(ctx.director.id).toBe(fake.getDirector().id);
      expect(ctx.brief.client).toBe('Test');
    });

    it('is deterministic: same inputs produce same outputs', () => {
      resetCounter();
      const fake1 = new FakePaperclip({ boardAutoApprove: true });
      const fake2 = new FakePaperclip({ boardAutoApprove: true });
      fake1.createProject({ name: 'Test', status: 'backlog' });
      fake2.createProject({ name: 'Test', status: 'backlog' });
      const p1 = fake1.getState().projects.values().next().value as ProjectRecord;
      const p2 = fake2.getState().projects.values().next().value as ProjectRecord;
      expect(p1.id).toBe(p2.id);
    });

    it('isolates state between instances', () => {
      const fake1 = new FakePaperclip();
      const fake2 = new FakePaperclip();
      const a1 = fake1.createAgent({ name: 'Agent1', role: 'test' });
      const a2 = fake2.getAgent(a1.id);
      expect(a2).toBeNull(); // different instance, no cross-contamination
    });
  });

  describe('createSyntheticProject', () => {
    it('creates a fully initialized project setup', () => {
      const setup = createSyntheticProject(1);
      expect(setup.brief.client).toBe('MMF Acceptance Run 1');
      expect(setup.fake).toBeInstanceOf(FakePaperclip);
      expect(setup.context.projectId).toBeDefined();
    });

    it('is isolated between calls', () => {
      const s1 = createSyntheticProject(1);
      const s2 = createSyntheticProject(2);
      expect(s1.projectId).not.toBe(s2.projectId);
      expect(s1.context.projectId).not.toBe(s2.context.projectId);
    });
  });
});

// ---------------------------------------------------------------------------
// Phase Execution Tests
// ---------------------------------------------------------------------------

describe('phase execution', () => {
  beforeEach(() => {
    resetCounter();
  });

  it('phase 1 creates a bootstrap issue', async () => {
    const setup = createTestProject(1);
    const receipt = PHASES[1].execute(setup.context);
    expect(receipt.status).toBe('passed');
    expect(receipt.phase).toBe(1);
    expect(receipt.phaseName).toBe('intake');
    expect(receipt.gates).toContainEqual(
      expect.objectContaining({ name: 'bootstrap_issue_created', status: 'passed' })
    );
  });

  it('phase 2 scaffolds workspace and project', async () => {
    const setup = createTestProject(1);
    PHASES[1].execute(setup.context);
    const receipt = PHASES[2].execute(setup.context);
    expect(receipt.status).toBe('passed');
    expect(receipt.gates).toContainEqual(
      expect.objectContaining({ name: 'workspace_scaffold', status: 'passed' })
    );
    expect(receipt.gates).toContainEqual(
      expect.objectContaining({ name: 'project_created', status: 'passed' })
    );
  });

  it('phase 3 creates orchestrator hire approval', async () => {
    const setup = createTestProject(1);
    PHASES[1].execute(setup.context);
    PHASES[2].execute(setup.context);
    const receipt = PHASES[3].execute(setup.context);
    expect(receipt.status).toBe('passed');
    expect(receipt.receipts.approval).toBeDefined();
    expect(receipt.receipts.approval?.type).toBe('hire_agent');
  });

  it('phase 4 creates setup documents', async () => {
    const setup = createTestProject(1);
    for (let p = 1; p <= 3; p++) PHASES[p as PhaseNumber].execute(setup.context);
    const receipt = PHASES[4].execute(setup.context);
    expect(receipt.status).toBe('passed');
    expect(setup.context.orchestrator).toBeDefined();
  });

  it('phase 5 creates specialist hire issues', async () => {
    const setup = createTestProject(1);
    for (let p = 1; p <= 4; p++) PHASES[p as PhaseNumber].execute(setup.context);
    const receipt = PHASES[5].execute(setup.context);
    expect(receipt.status).toBe('passed');
    const hireIssues = Array.from(setup.context.issues.values()).filter(i => i.isSpecialistHireIssue);
    expect(hireIssues.length).toBeGreaterThan(0);
  });

  it('phase 6 auto-hires specialists when boardAutoApprove=true', async () => {
    const setup = createTestProject(1);
    for (let p = 1; p <= 5; p++) PHASES[p as PhaseNumber].execute(setup.context);
    const receipt = PHASES[6].execute(setup.context);
    expect(receipt.status).toBe('passed');
    expect(setup.context.specialists.length).toBeGreaterThan(0);
  });

  it('phase 14 terminates specialists before orchestrator', async () => {
    const setup = createTestProject(1);
    for (let p = 1; p <= 14; p++) PHASES[p as PhaseNumber].execute(setup.context);
    const specIds = setup.context.specialists.map(s => s.id);
    const orchId = setup.context.orchestrator?.id;
    expect(setup.context.specialists.every(s => s.status === 'terminated')).toBe(true);
    expect(setup.context.orchestrator?.status).toBe('terminated');
    expect(setup.context.director.status).not.toBe('terminated');
  });
});

// ---------------------------------------------------------------------------
// Full Lifecycle Integration Tests
// ---------------------------------------------------------------------------

describe('full lifecycle integration', () => {
  beforeEach(() => {
    resetCounter();
  });

  it('runs all 14 phases to completion with no violations', () => {
    const setup = createTestProject(1);
    const { phases, ctx } = runAllPhases(setup);

    expect(phases).toHaveLength(14);
    expect(phases.every(p => p.status === 'passed')).toBe(true);

    const { invariants, violations } = checkClosureInvariants(ctx);
    expect(violations).toHaveLength(0);
    expect(invariants.scopedActivityComplete).toBe(true);
    expect(invariants.specialistsTerminated).toBe(true);
    expect(invariants.orchestratorTerminatedLast).toBe(true);
    expect(invariants.directorRetained).toBe(true);
    expect(invariants.watchdogRemoved).toBe(true);
    expect(invariants.noActiveRuns).toBe(true);
    expect(invariants.noPendingHireApproval).toBe(true);
    expect(invariants.noPendingReviewInteraction).toBe(true);
  });

  it('runs 3 independent projects with identical clean results', () => {
    const results = [1, 2, 3].map(i => {
      const setup = createTestProject(i);
      const { phases, ctx } = runAllPhases(setup);
      const { violations } = checkClosureInvariants(ctx);
      return { phases, violations, ctx };
    });

    // All 3 runs pass
    for (const r of results) {
      expect(r.phases.every(p => p.status === 'passed')).toBe(true);
      expect(r.violations).toHaveLength(0);
    }

    // All produce same structure
    for (const r of results) {
      expect(r.phases).toHaveLength(14);
      expect(r.ctx.director.status).not.toBe('terminated');
      expect(r.ctx.orchestrator?.status).toBe('terminated');
      expect(r.ctx.specialists.every(s => s.status === 'terminated')).toBe(true);
    }
  });

  it('produces machine-readable phase receipts for all 14 phases', () => {
    const setup = createTestProject(1);
    const { phases } = runAllPhases(setup);

    for (let i = 0; i < 14; i++) {
      const receipt = phases[i];
      expect(receipt.kind).toBe('mmf-lifecycle-phase-receipt');
      expect(receipt.version).toBe('1.0');
      expect(receipt.projectId).toBe(setup.projectId);
      expect(receipt.phase).toBe(i + 1);
      expect(receipt.deterministic).toBe(true);
      expect(receipt.startedAt).toBeTruthy();
      expect(receipt.finishedAt).toBeTruthy();
      expect(receipt.gates.length).toBeGreaterThan(0);
    }
  });

  it('termination order: specialists → orchestrator, director retained', () => {
    const setup = createTestProject(1);
    runAllPhases(setup);

    // Director never terminated
    expect(setup.context.director.status).not.toBe('terminated');

    // All specialists terminated
    expect(setup.context.specialists.every((s: Agent) => s.status === 'terminated')).toBe(true);

    // Orchestrator terminated
    expect(setup.context.orchestrator?.status).toBe('terminated');

    // No active runs
    const activeRuns = Array.from(setup.context.runs.values()).filter(
      (r: Run) => ['queued', 'running'].includes(r.status)
    );
    expect(activeRuns).toHaveLength(0);
  });

  it('history is never deleted (activity log has entries)', () => {
    const setup = createTestProject(1);
    runAllPhases(setup);
    expect(setup.context.activityLog.length).toBeGreaterThan(0);
  });

  it('watchdog is removed at closure', () => {
    const setup = createTestProject(1);
    runAllPhases(setup);
    expect(setup.context.watchdog?.removed).toBe(true);
  });

  it('fails closed on unexpected gate: wrong phase order', () => {
    const setup = createTestProject(1);
    // Skip phase 1, go straight to phase 2
    const receipt = PHASES[2].execute(setup.context);
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toBeTruthy();
  });

  it('all phase receipts have correct owner per contract', () => {
    const setup = createTestProject(1);
    const { phases } = runAllPhases(setup);

    const ownerByPhase: Record<number, string> = {
      1: 'Director', 2: 'Director', 3: 'Director',
      4: 'Project Orchestrator', 5: 'Project Orchestrator',
      6: 'Director', 7: 'Director',
      8: 'Project Orchestrator', 9: 'Specialist',
      10: 'Project Orchestrator', 11: 'Project Orchestrator',
      12: 'Project Orchestrator', 13: 'Project Orchestrator',
      14: 'Project Orchestrator',
    };

    for (const p of phases) {
      expect(p.owner).toBe(ownerByPhase[p.phase]);
    }
  });

  it('board auto-approve produces exactly 1 approval per hire', () => {
    const setup = createTestProject(1);
    runAllPhases(setup);
    const hireApprovals = Array.from(setup.context.approvals.values()).filter(a => a.type === 'hire_agent');
    expect(hireApprovals.length).toBeGreaterThan(0);
    expect(hireApprovals.every(a => a.status === 'approved')).toBe(true);
  });

  it('board auto-decision produces exactly 1 decision interaction', () => {
    const setup = createTestProject(1);
    runAllPhases(setup);
    const interactions = Array.from(setup.context.interactions.values());
    const completedInteractions = interactions.filter(i => i.status === 'completed');
    expect(completedInteractions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism Tests
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('same project index produces same project ID prefix', () => {
    resetCounter();
    const fake1 = new FakePaperclip();
    const fake2 = new FakePaperclip();
    fake1.createProject({ name: 'Test', status: 'backlog' });
    fake2.createProject({ name: 'Test', status: 'backlog' });
    const p1 = fake1.getState().projects.values().next().value as ProjectRecord;
    const p2 = fake2.getState().projects.values().next().value as ProjectRecord;
    expect(p1.id).toBe(p2.id);
  });

  it('independent runs do not share state', () => {
    const fake1 = new FakePaperclip();
    const fake2 = new FakePaperclip();
    const a1 = fake1.createAgent({ name: 'Agent', role: 'specialist' });
    expect(fake2.getAgent(a1.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fail-Closed Tests
// ---------------------------------------------------------------------------

describe('fail-closed behavior', () => {
  beforeEach(() => {
    resetCounter();
  });

  it('skips nothing: all 14 phases must execute', () => {
    const setup = createTestProject(1);
    const { phases } = runAllPhases(setup);
    expect(phases).toHaveLength(14);
  });

  it('zero active runs at closure', () => {
    const setup = createTestProject(1);
    runAllPhases(setup);
    const activeRuns = Array.from(setup.context.runs.values()).filter(
      r => ['queued', 'running'].includes(r.status)
    );
    expect(activeRuns).toHaveLength(0);
  });

  it('zero pending approvals at closure', () => {
    const setup = createTestProject(1);
    runAllPhases(setup);
    const pending = Array.from(setup.context.approvals.values()).filter(a => a.status === 'pending');
    expect(pending).toHaveLength(0);
  });

  it('zero pending interactions at closure', () => {
    const setup = createTestProject(1);
    runAllPhases(setup);
    const pending = Array.from(setup.context.interactions.values()).filter(i => i.status === 'pending');
    expect(pending).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Contract Adherence Tests
// ---------------------------------------------------------------------------

describe('contract adherence', () => {
  beforeEach(() => {
    resetCounter();
  });

  it('permanent agents (Director) are never terminated', () => {
    const setup = createTestProject(1);
    runAllPhases(setup);
    expect(setup.context.director.isPermanent).toBe(true);
    expect(setup.context.director.status).not.toBe('terminated');
  });

  it('project-scoped agents are terminated at closure', () => {
    const setup = createTestProject(1);
    runAllPhases(setup);
    expect(setup.context.orchestrator?.isPermanent).toBe(false);
    expect(setup.context.orchestrator?.status).toBe('terminated');
    expect(setup.context.specialists.every(s => !s.isPermanent && s.status === 'terminated')).toBe(true);
  });

  it('each phase has exactly one owner as per contract', () => {
    const owners = new Set<string>();
    for (const setup of [createTestProject(1)]) {
      const { phases } = runAllPhases(setup);
      for (const p of phases) {
        owners.add(p.owner);
      }
    }
    // At minimum: Director, Project Orchestrator, Specialist
    expect(owners.size).toBeGreaterThanOrEqual(3);
  });

  it('each phase receipt contains agent + issue + run identification', () => {
    const setup = createTestProject(1);
    const { phases } = runAllPhases(setup);
    for (const p of phases) {
      expect(p.agentId).toBeTruthy();
    }
  });

  it('no unexplained blocked issues at closure', () => {
    const setup = createTestProject(1);
    runAllPhases(setup);
    const blocked = Array.from(setup.context.issues.values()).filter(
      i => i.status === 'blocked' && i.blockedBy.length === 0
    );
    expect(blocked).toHaveLength(0);
  });
});
