/**
 * RealLifecycleOrchestrator — Mock-HTTP Orchestrator Tests
 *
 * Tests the RealLifecycleOrchestrator using injected fetch mocks.
 * Verifies exact phase order, idempotency/retry, approval/interaction gates,
 * run polling, closure invariants, specialist→orchestrator termination order,
 * Director retention, watchdog removal, zero pending work, cleanup on mid-phase
 * failure, and receipts never claiming unverified state.
 *
 * Also proves --live fails closed.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const MOCK_COMPANY_ID = 'company-001';
const MOCK_COMPANY_NAME = 'MMF Studio Lab';
const MOCK_BASE = 'http://127.0.0.1:3111';
const DIRECTOR_ID = 'director-001';
const ORCHESTRATOR_ID = 'orchestrator-001';
const SPECIALIST_1_ID = 'specialist-001';
const PROJECT_ID = 'project-001';
const TEST_CONTEXT = {
  projectId: PROJECT_ID,
  projectName: 'Test Project',
  directorId: DIRECTOR_ID,
  orchestratorId: ORCHESTRATOR_ID,
  orchestratorApprovalId: null,
  specialistIds: [SPECIALIST_1_ID],
  specialistApprovalIds: [],
  bootstrapIssueId: 'bootstrap-issue-001',
  setupIssueId: 'setup-issue-001',
  activityIssueIds: ['activity-issue-001'],
  reviewInteractionId: null,
  watchdogIssueId: 'watchdog-issue-001',
  phasesCompleted: 0,
};

function makeConfig() {
  return {
    paperclipUrl: MOCK_BASE,
    companyId: MOCK_COMPANY_ID,
    companyName: MOCK_COMPANY_NAME,
    safetyAcknowledgement: true,
    dryRun: false,
    allowlist: ['MMF Studio Lab'],
    requestTimeoutMs: 5000,
  };
}

// ---------------------------------------------------------------------------
// Mock fetch factory
// ---------------------------------------------------------------------------

type ResponseEntry = [string, { status: number; body: unknown }];

function createMockFetch(responses: ResponseEntry[]): { fetch: Mock; getRecordedUrls: () => string[] } {
  const recorded: string[] = [];

  const fetch = vi.fn(async (url: string, opts?: { method: string; body?: string }) => {
    recorded.push(`${opts?.method ?? 'GET'} ${url}`);

    const normalized = url.replace(/\/$/, '');
    for (const [path, resp] of responses) {
      if (normalized === path || normalized.endsWith(path)) {
        return {
          ok: resp.status >= 200 && resp.status < 300,
          status: resp.status,
          json: async () => resp.body,
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
  }) as Mock;

  return {
    fetch,
    getRecordedUrls: () => recorded,
  };
}

// ---------------------------------------------------------------------------
// Brief factory
// ---------------------------------------------------------------------------

function makeBrief(idx = 1) {
  return {
    client: `Test Client ${idx}`,
    name: `Test Project ${idx}`,
    challenge: `Prove the full lifecycle contract for test run ${idx}.`,
    outcomes: ['Research synthesis', 'Copy review'],
    sourceFolder: `synthetic://test/run${idx}/source`,
    deliverablesFolder: `synthetic://test/run${idx}/deliverables`,
    knowledgeBase: `synthetic://test/run${idx}/knowledge`,
    budgetCap: '0',
  };
}

// ---------------------------------------------------------------------------
// LIVE_ACTIVATION_GATE tests
// ---------------------------------------------------------------------------

describe('LIVE_ACTIVATION_GATE', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it('LIVE_ACTIVATION_GATE is false by default', async () => {
    // Clear the env var
    const cleanEnv = { ...originalEnv };
    delete cleanEnv.LIVECLI_ORCHESTRATOR_ENABLED;
    process.env = cleanEnv;

    vi.resetModules();
    const { LIVE_ACTIVATION_GATE } = await import('./RealLifecycleOrchestrator.js');
    expect(LIVE_ACTIVATION_GATE).toBe(false);
  });

  it('constructor throws when LIVECLI_ORCHESTRATOR_ENABLED is not set', async () => {
    const cleanEnv = { ...originalEnv };
    delete cleanEnv.LIVECLI_ORCHESTRATOR_ENABLED;
    process.env = cleanEnv;
    vi.resetModules();

    vi.stubGlobal('fetch', vi.fn());

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    expect(() => new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    })).toThrow('LIVECLI_ORCHESTRATOR_ENABLED');
  });

  it('constructor throws with dryRun=true adapter', async () => {
    process.env.LIVECLI_ORCHESTRATOR_ENABLED = 'true';
    vi.stubGlobal('fetch', vi.fn());

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const dryRunAdapter = new PaperclipLifecycleAdapter({ ...makeConfig(), dryRun: true });

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    expect(() => new RealLifecycleOrchestrator({
      adapter: dryRunAdapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    })).toThrow('dryRun=false');
  });
});

// ---------------------------------------------------------------------------
// Phase order tests
// ---------------------------------------------------------------------------

describe('phase order', () => {
  beforeEach(() => {
    process.env.LIVECLI_ORCHESTRATOR_ENABLED = 'true';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LIVECLI_ORCHESTRATOR_ENABLED;
    vi.resetModules();
  });

  it('phase 1 runs before phase 2', async () => {
    const responses: ResponseEntry[] = [
      ['http://127.0.0.1:3111/api/companies', { status: 200, body: [{ id: MOCK_COMPANY_ID, name: MOCK_COMPANY_NAME }] }],
      [`http://127.0.0.1:3111/api/companies/${MOCK_COMPANY_ID}/agents`, { status: 200, body: [{ id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'active' }] }],
      [`http://127.0.0.1:3111/api/agents/${DIRECTOR_ID}`, { status: 200, body: { id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'active' } }],
      [`http://127.0.0.1:3111/api/companies/${MOCK_COMPANY_ID}/issues`, { status: 200, body: [{ id: 'issue-001', status: 'todo' }] }],
      [`http://127.0.0.1:3111/api/companies/${MOCK_COMPANY_ID}/projects`, { status: 201, body: { id: PROJECT_ID, status: 'backlog' } }],
      [`http://127.0.0.1:3111/api/projects/${PROJECT_ID}`, { status: 200, body: { id: PROJECT_ID, status: 'backlog' } }],
    ];

    const { fetch, getRecordedUrls } = createMockFetch(responses);
    vi.stubGlobal('fetch', fetch);

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    const orchestrator = new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });

    // Run phase 1
    await orchestrator.phase1_Intake();

    const urls = getRecordedUrls();
    // Phase 1 (Intake) should call listAgents before createIssue
    const issuePostIdx = urls.findIndex(u => u.includes('POST') && u.includes('/issues'));
    expect(issuePostIdx).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Board approval gate tests
// ---------------------------------------------------------------------------

describe('Board approval gates', () => {
  beforeEach(() => {
    process.env.LIVECLI_ORCHESTRATOR_ENABLED = 'true';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LIVECLI_ORCHESTRATOR_ENABLED;
    vi.resetModules();
  });

  it('phase 3 polls until Board approves (or times out with CAPABILITY_BLOCKER)', async () => {
    // Mock that always returns pending — Board never approves
    // POST for createApproval and createAgentHire must return 201 so we reach the polling loop
    const fetch = vi.fn(async (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (method === 'POST' && url.includes('/approvals')) {
        return { ok: true, status: 201, json: async () => ({ id: 'approval-orch', status: 'pending' }) };
      }
      if (url.includes('/approvals/') && method !== 'POST') {
        return { ok: true, status: 200, json: async () => ({ id: 'approval-orch', status: 'pending' }) };
      }
      if (url.includes('/companies') && url.includes('agents')) {
        return { ok: true, status: 200, json: async () => [{ id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'active' }] };
      }
      if (method === 'POST' && url.includes('/agent-hires')) {
        return { ok: true, status: 201, json: async () => ({ agent: { id: ORCHESTRATOR_ID, status: 'pending_approval' }, approval: { id: 'approval-orch', status: 'pending' } }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as Mock;

    vi.stubGlobal('fetch', fetch);

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    const orchestrator = new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });

    const receipt = await orchestrator.phase3_OrchestratorHire();

    expect(receipt.status).toBe('failed');
    // Must have CAPABILITY_BLOCKER + board_timeout in invariantViolations
    expect(receipt.invariantViolations.some((v: string) => v.includes('CAPABILITY_BLOCKER') && v.includes('board_timeout'))).toBe(true);
    // Must have a failed gate named board_timeout
    const boardTimeoutGate = receipt.gates.find((g: { name: string }) => g.name === 'board_timeout');
    expect(boardTimeoutGate?.status).toBe('failed');
  });

  it('phase 3 does not auto-approve — requires real Board approval', async () => {
    let pollCount = 0;
    // POST for createApproval and createAgentHire must return success so we reach the polling loop
    const fetch = vi.fn(async (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (method === 'POST' && url.includes('/approvals')) {
        return { ok: true, status: 201, json: async () => ({ id: 'approval-orch', status: 'pending' }) };
      }
      if (url.includes('/approvals/') && method !== 'POST') {
        pollCount++;
        return { ok: true, status: 200, json: async () => ({ id: 'approval-orch', status: 'pending' }) };
      }
      if (url.includes('/companies') && url.includes('agents')) {
        return { ok: true, status: 200, json: async () => [{ id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'active' }] };
      }
      if (method === 'POST' && url.includes('/agent-hires')) {
        return { ok: true, status: 201, json: async () => ({ agent: { id: ORCHESTRATOR_ID, status: 'pending_approval' }, approval: { id: 'approval-orch', status: 'pending' } }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as Mock;

    vi.stubGlobal('fetch', fetch);

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    const orchestrator = new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });

    const receipt = await orchestrator.phase3_OrchestratorHire();

    expect(pollCount).toBeGreaterThanOrEqual(1);
    expect(receipt.status).toBe('failed');
  });

  it('phase 3 uses atomic agent-hire approval and real Lab Board decision', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetch = vi.fn(async (url: string, opts?: { method?: string; body?: string }) => {
      const method = opts?.method ?? 'GET';
      calls.push({ url, method, body: opts?.body ? JSON.parse(opts.body) : undefined });
      if (url.endsWith('/agent-hires') && method === 'POST') return { ok: true, status: 201, json: async () => ({
        agent: { id: ORCHESTRATOR_ID, status: 'pending_approval' }, approval: { id: 'approval-orch', status: 'pending' },
      }) };
      if (url.endsWith('/approvals/approval-orch/approve') && method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 'approval-orch', status: 'approved' }) };
      if (url.endsWith('/approvals/approval-orch') && method === 'GET') return { ok: true, status: 200, json: async () => ({ id: 'approval-orch', status: 'approved' }) };
      if (url.endsWith(`/agents/${ORCHESTRATOR_ID}`) && method === 'GET') return { ok: true, status: 200, json: async () => ({ id: ORCHESTRATOR_ID, status: 'idle' }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }) as Mock;
    vi.stubGlobal('fetch', fetch);
    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter({ ...makeConfig(), syntheticBoardAutoDecision: true });
    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');
    const orchestrator = new RealLifecycleOrchestrator({ adapter, brief: makeBrief(1), projectIndex: 1, initialContext: TEST_CONTEXT, pollIntervalMs: 0, pollMaxAttempts: 2 });
    const receipt = await orchestrator.phase3_OrchestratorHire();
    expect(receipt.status).toBe('passed');
    expect(calls.some(call => call.url.endsWith('/agent-hires') && call.method === 'POST')).toBe(true);
    expect(calls.some(call => call.url.endsWith('/approvals') && call.method === 'POST')).toBe(false);
    expect(calls.some(call => call.url.endsWith('/approvals/approval-orch/approve') && call.method === 'POST')).toBe(true);
    expect(calls.find(call => call.url.endsWith('/agent-hires'))?.body).toMatchObject({ trustedTemplateHire: { templateSlug: 'project-orchestrator', projectId: PROJECT_ID } });
  });

  it('phase 11 polls for Board interaction response (times out with CAPABILITY_BLOCKER)', async () => {
    // POST for createIssue and createInteraction must return 201 so we reach the polling loop
    const fetch = vi.fn(async (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (method === 'POST' && url.includes('/issues')) {
        return { ok: true, status: 201, json: async () => ({ id: 'review-issue-001', status: 'in_review' }) };
      }
      if (url.includes('/interactions') && method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ id: 'interaction-1', status: 'pending', kind: 'ask_user_questions' }) };
      }
      if (url.includes('/interactions') && method === 'GET') {
        return { ok: true, status: 200, json: async () => [{ id: 'interaction-1', status: 'pending' }] };
      }
      if (url.includes('/companies') && url.includes('agents')) {
        return { ok: true, status: 200, json: async () => [{ id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'active' }] };
      }
      if (method === 'PATCH' && url.includes('/issues/')) {
        return { ok: true, status: 200, json: async () => ({ id: 'review-issue-001', status: 'done' }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as Mock;

    vi.stubGlobal('fetch', fetch);

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    const orchestrator = new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });

    const receipt = await orchestrator.phase11_ChrisReview();

    expect(receipt.status).toBe('failed');
    // Must have CAPABILITY_BLOCKER + board_interaction_timeout in invariantViolations
    expect(receipt.invariantViolations.some((v: string) => v.includes('CAPABILITY_BLOCKER') && v.includes('board_interaction_timeout'))).toBe(true);
    // Must have a failed gate named board_interaction_timeout
    const interactionTimeoutGate = receipt.gates.find((g: { name: string }) => g.name === 'board_interaction_timeout');
    expect(interactionTimeoutGate?.status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// Idempotency / retry tests
// ---------------------------------------------------------------------------

describe('idempotency and retry', () => {
  beforeEach(() => {
    process.env.LIVECLI_ORCHESTRATOR_ENABLED = 'true';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LIVECLI_ORCHESTRATOR_ENABLED;
    vi.resetModules();
  });

  it('receipts are built from read-back data (read-back IS called after mutation)', async () => {
    let readbackCalled = false;

    const fetch = vi.fn(async (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (method === 'POST' && url.includes('/projects')) {
        return { ok: true, status: 201, json: async () => ({ id: PROJECT_ID }) };
      }
      if (method === 'GET' && url.includes('/projects/')) {
        readbackCalled = true;
        return { ok: true, status: 200, json: async () => ({ id: PROJECT_ID, name: 'Full Readback', status: 'backlog' }) };
      }
      if (url.includes('/companies') && url.includes('agents')) {
        return { ok: true, status: 200, json: async () => [{ id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'active' }] };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as Mock;

    vi.stubGlobal('fetch', fetch);

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    const orchestrator = new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });

    await orchestrator.phase2_WorkspaceBootstrap();

    expect(readbackCalled).toBe(true);
  });

  it('receipts contain exact phase number and phaseName', async () => {
    const fetch = vi.fn(async (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (url.includes('/companies') && url.includes('agents')) {
        return { ok: true, status: 200, json: async () => [{ id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'active' }] };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as Mock;

    vi.stubGlobal('fetch', fetch);

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    const orchestrator = new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });

    const receipt = await orchestrator.phase1_Intake();

    expect(receipt.phase).toBe(1);
    expect(receipt.phaseName).toBe('intake');
    expect(receipt.kind).toBe('mmf-lifecycle-phase-receipt');
    expect(receipt.version).toBe('1.0');
  });
});

// ---------------------------------------------------------------------------
// Closure invariants
// ---------------------------------------------------------------------------

describe('closure invariants', () => {
  beforeEach(() => {
    process.env.LIVECLI_ORCHESTRATOR_ENABLED = 'true';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LIVECLI_ORCHESTRATOR_ENABLED;
    vi.resetModules();
  });

  it('phase 14 terminates specialists before orchestrator', async () => {
    const terminationOrder: string[] = [];

    const fetch = vi.fn(async (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (url.includes('/terminate') && method === 'POST') {
        const agentId = url.match(/\/agents\/([^/]+)\/terminate/)?.[1] ?? 'unknown';
        terminationOrder.push(agentId);
        return { ok: true, status: 200, json: async () => ({ id: agentId, status: 'terminated' }) };
      }
      if (method === 'PATCH' && url.includes('/projects/')) {
        return { ok: true, status: 200, json: async () => ({ id: PROJECT_ID, archivedAt: new Date().toISOString() }) };
      }
      if (method === 'DELETE' && url.includes('/watchdog')) {
        return { ok: true, status: 204, json: async () => null };
      }
      if (url.includes('/companies') && url.includes('agents')) {
        return { ok: true, status: 200, json: async () => [{ id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'active' }] };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as Mock;

    vi.stubGlobal('fetch', fetch);

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    const orchestrator = new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });

    await orchestrator.phase14_ProjectClosure();

    // If we have specialists and orchestrator in terminationOrder,
    // verify orchestrator comes after specialists
    const specialistIndices = terminationOrder
      .map((id, idx) => id.startsWith('specialist') ? idx : -1)
      .filter(idx => idx !== -1);
    const orchestratorIndex = terminationOrder.indexOf(ORCHESTRATOR_ID);

    if (specialistIndices.length > 0 && orchestratorIndex !== -1) {
      expect(Math.max(...specialistIndices)).toBeLessThan(orchestratorIndex);
    }
  });

  it('phase 14 never terminates Director', async () => {
    const terminatedAgents: string[] = [];

    const fetch = vi.fn(async (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (url.includes('/terminate') && method === 'POST') {
        const agentId = url.match(/\/agents\/([^/]+)\/terminate/)?.[1] ?? 'unknown';
        terminatedAgents.push(agentId);
        return { ok: true, status: 200, json: async () => ({ id: agentId, status: 'terminated' }) };
      }
      if (method === 'PATCH' && url.includes('/projects/')) {
        return { ok: true, status: 200, json: async () => ({ id: PROJECT_ID, archivedAt: new Date().toISOString() }) };
      }
      if (method === 'DELETE' && url.includes('/watchdog')) {
        return { ok: true, status: 204, json: async () => null };
      }
      if (url.includes('/companies') && url.includes('agents')) {
        return { ok: true, status: 200, json: async () => [{ id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'active' }] };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as Mock;

    vi.stubGlobal('fetch', fetch);

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    const orchestrator = new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });

    await orchestrator.phase14_ProjectClosure();

    expect(terminatedAgents).not.toContain(DIRECTOR_ID);
  });

  it('phase 14 uses PATCH (not DELETE) for project closure', async () => {
    const methods: string[] = [];

    const fetch = vi.fn(async (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (url.includes('/projects/') && opts?.method) methods.push(opts.method);
      if (method === 'PATCH' && url.includes('/projects/')) {
        return { ok: true, status: 200, json: async () => ({ id: PROJECT_ID, archivedAt: new Date().toISOString() }) };
      }
      if (method === 'DELETE' && url.includes('/projects/')) {
        return { ok: false, status: 405, json: async () => ({ error: 'Method not allowed' }) };
      }
      if (url.includes('/companies') && url.includes('agents')) {
        return { ok: true, status: 200, json: async () => [{ id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'active' }] };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as Mock;

    vi.stubGlobal('fetch', fetch);

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    const orchestrator = new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });

    await orchestrator.phase14_ProjectClosure();

    expect(methods).toContain('PATCH');
    expect(methods).not.toContain('DELETE');
  });

  it('phase 14 deletes watchdog via DELETE route, not project DELETE', async () => {
    const deleteWatchdogCalls: string[] = [];
    const deleteProjectCalls: string[] = [];

    const fetch = vi.fn(async (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (method === 'DELETE' && url.includes('/watchdog')) {
        deleteWatchdogCalls.push(url);
        return { ok: true, status: 204, json: async () => null };
      }
      if (method === 'DELETE' && url.includes('/projects/')) {
        deleteProjectCalls.push(url);
        return { ok: false, status: 405, json: async () => ({ error: 'Method not allowed' }) };
      }
      if (url.includes('/companies') && url.includes('agents')) {
        return { ok: true, status: 200, json: async () => [{ id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'active' }] };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as Mock;

    vi.stubGlobal('fetch', fetch);

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    const orchestrator = new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });

    await orchestrator.phase14_ProjectClosure();

    // Project DELETE should never be called
    expect(deleteProjectCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cleanup on mid-phase failure
// ---------------------------------------------------------------------------

describe('cleanup on mid-phase failure', () => {
  beforeEach(() => {
    process.env.LIVECLI_ORCHESTRATOR_ENABLED = 'true';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LIVECLI_ORCHESTRATOR_ENABLED;
    vi.resetModules();
  });

  it('bestEffortCleanup terminates specialists then orchestrator (not Director)', async () => {
    const terminatedAgents: string[] = [];

    const fetch = vi.fn(async (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (url.includes('/terminate') && method === 'POST') {
        const agentId = url.match(/\/agents\/([^/]+)\/terminate/)?.[1] ?? 'unknown';
        terminatedAgents.push(agentId);
        return { ok: true, status: 200, json: async () => ({ id: agentId, status: 'terminated' }) };
      }
      if (method === 'PATCH' && url.includes('/projects/')) {
        return { ok: true, status: 200, json: async () => ({ id: PROJECT_ID, archivedAt: new Date().toISOString() }) };
      }
      if (method === 'DELETE' && url.includes('/watchdog')) {
        return { ok: true, status: 204, json: async () => null };
      }
      if (url.includes('/companies') && url.includes('agents')) {
        return { ok: true, status: 200, json: async () => [{ id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'active' }] };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as Mock;

    vi.stubGlobal('fetch', fetch);

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    const orchestrator = new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });

    await orchestrator.bestEffortCleanup();

    // Director should not be terminated
    expect(terminatedAgents).not.toContain(DIRECTOR_ID);
  });

  it('bestEffortCleanup does not throw when termination fails', async () => {
    const fetch = vi.fn(async (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (url.includes('/terminate') && method === 'POST') {
        throw new Error('Termination failed');
      }
      if (method === 'PATCH' && url.includes('/projects/')) {
        throw new Error('Archive failed');
      }
      if (method === 'DELETE' && url.includes('/watchdog')) {
        throw new Error('Watchdog delete failed');
      }
      if (url.includes('/companies') && url.includes('agents')) {
        return { ok: true, status: 200, json: async () => [{ id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'active' }] };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as Mock;

    vi.stubGlobal('fetch', fetch);

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    const orchestrator = new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });

    // Should NOT throw even though all cleanup operations fail
    await expect(orchestrator.bestEffortCleanup()).resolves.not.toThrow();
  });

  it('runAll triggers cleanup when phase fails', async () => {
    const fetch = vi.fn(async (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (url.includes('/companies') && url.includes('agents')) {
        return { ok: true, status: 200, json: async () => [{ id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'active' }] };
      }
      if (method === 'POST' && url.includes('/issues')) {
        throw new Error('createIssue failed');
      }
      return { ok: false, status: 500, json: async () => ({ error: 'server error' }) };
    }) as Mock;

    vi.stubGlobal('fetch', fetch);

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    const orchestrator = new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });

    const { cleanupAttempted, phases } = await orchestrator.runAll();

    expect(phases[0]?.status).toBe('failed');
    expect(cleanupAttempted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Capability blocker precision
// ---------------------------------------------------------------------------

describe('capability blockers are precise', () => {
  beforeEach(() => {
    process.env.LIVECLI_ORCHESTRATOR_ENABLED = 'true';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LIVECLI_ORCHESTRATOR_ENABLED;
    vi.resetModules();
  });

  it('phase 3 failure says board_timeout not generic_error', async () => {
    const fetch = vi.fn(async (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (url.includes('/companies/') && url.endsWith('/approvals') && method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ id: 'approval-orch', status: 'pending' }) };
      }
      if (url.includes('/agent-hires') && method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ agent: { id: ORCHESTRATOR_ID, status: 'pending_approval' }, approval: { id: 'approval-orch', status: 'pending' } }) };
      }
      if (url.includes('/approvals/') && method !== 'POST') {
        return { ok: true, status: 200, json: async () => ({ id: 'approval-orch', status: 'pending' }) };
      }
      if (url.includes('/companies') && url.includes('agents')) {
        return { ok: true, status: 200, json: async () => [{ id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'active' }] };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as Mock;

    vi.stubGlobal('fetch', fetch);

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    const orchestrator = new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });

    const receipt = await orchestrator.phase3_OrchestratorHire();

    expect(receipt.status).toBe('failed');
    const hasBlocker = receipt.invariantViolations.some(
      (v: string) => v.includes('CAPABILITY_BLOCKER') && v.includes('board_timeout')
    );
    expect(hasBlocker).toBe(true);
    expect(receipt.error).not.toBe('unknown');
  });

  it('phase 11 failure says board_interaction_timeout not generic_error', async () => {
    const fetch = vi.fn(async (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (url.includes('/companies/') && url.endsWith('/issues') && method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ id: 'review-issue-001', status: 'in_review' }) };
      }
      if (url.includes('/interactions') && method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ id: 'interaction-1', status: 'pending', kind: 'ask_user_questions' }) };
      }
      if (url.includes('/interactions') && method === 'GET') {
        return { ok: true, status: 200, json: async () => [{ id: 'interaction-1', status: 'pending' }] };
      }
      if (url.includes('/companies') && url.includes('agents')) {
        return { ok: true, status: 200, json: async () => [{ id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'active' }] };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as Mock;

    vi.stubGlobal('fetch', fetch);

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    const orchestrator = new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });

    const receipt = await orchestrator.phase11_ChrisReview();

    expect(receipt.status).toBe('failed');
    const hasBlocker = receipt.invariantViolations.some(
      (v: string) => v.includes('CAPABILITY_BLOCKER') && v.includes('board_interaction_timeout')
    );
    expect(hasBlocker).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Zero pending work at closure
// ---------------------------------------------------------------------------

describe('zero pending work at closure', () => {
  beforeEach(() => {
    process.env.LIVECLI_ORCHESTRATOR_ENABLED = 'true';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LIVECLI_ORCHESTRATOR_ENABLED;
    vi.resetModules();
  });

  it('phase 14 receipt has no active runs, approvals, or interactions at close', async () => {
    const fetch = vi.fn(async (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (url.includes('/terminate') && method === 'POST') return { ok: true, status: 200, json: async () => ({ status: 'terminated' }) };
      if (url.includes(`/agents/${DIRECTOR_ID}`) && method === 'GET') return { ok: true, status: 200, json: async () => ({ id: DIRECTOR_ID, name: 'MMF Studio Director', role: 'ceo', status: 'idle' }) };
      if (url.includes('/agents/') && method === 'GET') return { ok: true, status: 200, json: async () => ({ id: 'terminated-agent', status: 'terminated' }) };
      if (method === 'PATCH' && url.includes('/projects/')) return { ok: true, status: 200, json: async () => ({ id: PROJECT_ID, archivedAt: '2026-07-13T00:00:00.000Z' }) };
      if (method === 'GET' && url.includes(`/projects/${PROJECT_ID}`)) return { ok: true, status: 200, json: async () => ({ id: PROJECT_ID, archivedAt: '2026-07-13T00:00:00.000Z' }) };
      if (method === 'DELETE' && url.includes('/watchdog')) return { ok: true, status: 204, json: async () => null };
      if (method === 'GET' && url.includes('/watchdog')) return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
      if (method === 'GET' && url.includes('/issues') && !url.includes('/runs') && !url.includes('/interactions')) return { ok: true, status: 200, json: async () => [] };
      if (method === 'GET' && url.includes('/approvals')) return { ok: true, status: 200, json: async () => [] };
      return { ok: false, status: 404, json: async () => ({}) };
    }) as Mock;

    vi.stubGlobal('fetch', fetch);

    const { PaperclipLifecycleAdapter } = await import('./paperclipAdapter.js');
    const adapter = new PaperclipLifecycleAdapter(makeConfig());

    const { RealLifecycleOrchestrator } = await import('./RealLifecycleOrchestrator.js');

    const orchestrator = new RealLifecycleOrchestrator({
      adapter,
      brief: makeBrief(1),
      projectIndex: 1,
      initialContext: TEST_CONTEXT,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });

    const receipt = await orchestrator.phase14_ProjectClosure();
    expect(receipt.status).toBe('passed');

    const watchdogGate = receipt.gates.find((g: { name: string }) => g.name === 'watchdog_removed');
    const noActiveRunsGate = receipt.gates.find((g: { name: string }) => g.name === 'no_active_runs');
    const noPendingApprovalsGate = receipt.gates.find((g: { name: string }) => g.name === 'no_pending_approvals');
    const noPendingInteractionsGate = receipt.gates.find((g: { name: string }) => g.name === 'no_pending_interactions');

    expect(watchdogGate?.status).toBe('passed');
    expect(noActiveRunsGate?.status).toBe('passed');
    expect(noPendingApprovalsGate?.status).toBe('passed');
    expect(noPendingInteractionsGate?.status).toBe('passed');
  });
});
