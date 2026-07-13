/**
 * MMF Studio Full-Lifecycle Acceptance Harness
 *
 * Runs the complete 14-phase lifecycle contract per
 * docs/specs/paperclip-project-lifecycle-contract.md
 *
 * Usage:
 *   node scripts/run-full-lifecycle-acceptance.ts --dry-run          # default (simulation)
 *   node scripts/run-full-lifecycle-acceptance.ts --live            # disabled; always fails closed
 *   node scripts/run-full-lifecycle-acceptance.ts --preflight       # probe Paperclip, emit capability matrix, exit
 *   node scripts/run-full-lifecycle-acceptance.ts --help
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PHASES, PHASE_NAMES,
  type PhaseNumber, type PhaseReceipt, type ProjectReceipt, type RunSummary,
  type SyntheticBrief, type LifecycleContext,
  checkClosureInvariants,
} from './lifecycle/lifecycle-contract.js';
import {
  FakePaperclip, createSyntheticProject,
  type SyntheticProjectSetup,
} from './lifecycle/fake-adapter.js';
import {
  createPaperclipAdapter,
  ROUTE_CAPABILITIES,
  type RouteCapability,
} from './lifecycle/paperclipAdapter.js';
import type { Agent } from './lifecycle/lifecycle-contract.js';
import { RealLifecycleOrchestrator } from './lifecycle/RealLifecycleOrchestrator.js';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CLI {
  mode: 'dry-run' | 'live' | 'preflight';
  repeat: number;
  paperclipUrl: string | null;
  companyId: string | null;
  companyName: string | null;
  safetyAcknowledgement: boolean;
  outputDir: string;
  allowlist: string[];
  armFullLifecycle: boolean;
}

function parseCLI(): CLI {
  const args = new Set(process.argv.slice(2));
  const help = args.has('--help') || args.has('-h');
  if (help) {
    console.log(`
MMF Studio Full-Lifecycle Acceptance Harness

Usage:
  node scripts/run-full-lifecycle-acceptance.ts [options]

Modes (exactly one):
  --dry-run    Dry-run mode (default, safe, no mutations, simulation)
  --live       Real Lab acceptance; requires every explicit arming gate below
  --preflight  Probe Paperclip, emit capability matrix, exit 0/1

Options:
  --repeat=N          Number of independent project runs (default: 1, max: 3)
  --paperclip-url=URL Paperclip API URL (default: http://127.0.0.1:3111)
  --company-id=ID     Paperclip company ID (default: auto-resolve)
  --company-name=NAME Company name (used for allowlist check)
  --safety-acknowledgement  Required for live mode — confirms intent
  --arm-full-lifecycle      Required for the destructive disposable Lab acceptance run
  --allowlist=NAME[,NAME2]  Comma-separated company name allowlist (default: "MMF Studio Lab")
  --output-dir=DIR    Output directory (default: artifacts/lifecycle)
  --help, -h          Show this help

Examples:
  # Dry-run (always safe)
  node scripts/run-full-lifecycle-acceptance.ts --dry-run

  # Dry-run repeat=3
  node scripts/run-full-lifecycle-acceptance.ts --dry-run --repeat=3

  # Probe Paperclip capabilities (read-only)
  node scripts/run-full-lifecycle-acceptance.ts --preflight \\
    --paperclip-url=http://127.0.0.1:3111 \\
    --company-name="MMF Studio Lab" \\
    --safety-acknowledgement

  # Live Lab acceptance (exactly three disposable projects)
  LIVECLI_ORCHESTRATOR_ENABLED=true node scripts/run-full-lifecycle-acceptance.ts --live --repeat=3 \
    --paperclip-url=http://127.0.0.1:3111 --company-name="MMF Studio Lab" \
    --safety-acknowledgement --arm-full-lifecycle
`);
    process.exit(0);
  }

  const dryRun = args.has('--dry-run');
  const preflight = args.has('--preflight');
  const live = args.has('--live');

  const repeatArg = process.argv.find(a => a.startsWith('--repeat='));
  const repeat = Math.min(3, Math.max(1, parseInt(repeatArg?.slice('--repeat='.length) ?? '1', 10)));
  const paperclipUrl = process.env.PAPERCLIP_URL
    ?? process.argv.find(a => a.startsWith('--paperclip-url='))?.slice('--paperclip-url='.length)
    ?? null;
  const companyId = process.env.PAPERCLIP_COMPANY_ID
    ?? process.argv.find(a => a.startsWith('--company-id='))?.slice('--company-id='.length)
    ?? null;
  const companyName = process.env.PAPERCLIP_COMPANY_NAME
    ?? process.argv.find(a => a.startsWith('--company-name='))?.slice('--company-name='.length)
    ?? null;
  const safetyAck = args.has('--safety-acknowledgement');
  const outputDir = process.env.MMF_LIFECYCLE_OUTPUT_DIR
    ?? process.argv.find(a => a.startsWith('--output-dir='))?.slice('--output-dir='.length)
    ?? 'artifacts/lifecycle';
  const allowlist = (process.env.MMF_COMPANY_ALLOWLIST
    ?? process.argv.find(a => a.startsWith('--allowlist='))?.slice('--allowlist='.length)
    ?? 'MMF Studio Lab')
    .split(',')
    .map(s => s.trim());

  const mode = preflight ? 'preflight' : live ? 'live' : 'dry-run';

  return { mode, repeat, paperclipUrl, companyId, companyName, safetyAcknowledgement: safetyAck, outputDir, allowlist, armFullLifecycle: args.has('--arm-full-lifecycle') };
}

// ---------------------------------------------------------------------------
// Preflight runner
// ---------------------------------------------------------------------------

async function runPreflight(cli: CLI) {
  if (!cli.paperclipUrl) {
    console.error('ERROR: --paperclip-url is required for --preflight\n');
    process.exit(1);
  }

  console.log('\n=== MMF Studio Paperclip Lifecycle Preflight ===\n');
  console.log(`Paperclip URL:  ${cli.paperclipUrl}`);
  console.log(`Company ID:     ${cli.companyId ?? '(auto-resolve)'}`);
  console.log(`Company name:   ${cli.companyName ?? '(auto-resolve)'}`);
  console.log(`Allowlist:      ${cli.allowlist.join(', ')}`);
  console.log(`Safety ack:     ${cli.safetyAcknowledgement}\n`);

  let adapter;
  try {
    adapter = await createPaperclipAdapter({
      paperclipUrl: cli.paperclipUrl,
      companyId: cli.companyId,
      companyName: cli.companyName,
      safetyAcknowledgement: cli.safetyAcknowledgement,
      dryRun: true,
      allowlist: cli.allowlist,
    });
    console.log(`✓ Adapter constructed`);
    console.log(`  Company: ${adapter.companyName} (ID: ${adapter.companyId})`);
    console.log(`  Dry-run: ${adapter.isDryRun()}\n`);
  } catch (err) {
    console.error(`✗ Adapter construction failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  console.log('Probing Paperclip routes (GET only)...\n');
  const probe = await adapter.preflight();

  if (!probe.reachable) {
    console.error('✗ Paperclip server unreachable.\n');
    for (const e of probe.errors) {
      console.error(`  ${e}`);
    }
    process.exit(1);
  }
  console.log(`✓ Paperclip server reachable\n`);

  if (!probe.companyValid) {
    console.error('✗ Company validation failed.\n');
    for (const e of probe.errors) {
      console.error(`  ${e}`);
    }
    process.exit(1);
  }
  console.log(`✓ Company ID "${adapter.companyId}" is valid\n`);

  const matrix = adapter.getCapabilityMatrix();

  console.log('\nCapability Matrix:\n');
  console.log('  SCHEMA-VERIFIED routes (GET routes probed; mutations not executed):');
  for (const r of ROUTE_CAPABILITIES.filter(r => r.capability === 'verified')) {
    const pr = probe.routes.find((pr: { operation: string }) => pr.operation === r.operation);
    const latency = pr?.latencyMs ?? null;
    const verification = r.method === 'GET'
      ? (pr?.reachable ? `read-only probe ${latency}ms` : 'read-only probe not available')
      : 'OpenAPI schema only — not runtime-tested';
    console.log(`    ✓ ${r.method.padEnd(6)} ${r.operation.padEnd(40)} ${verification}`);
  }

  console.log('\n  UNSUPPORTED routes (absent from OpenAPI):');
  for (const r of ROUTE_CAPABILITIES.filter(r => r.capability === 'unsupported')) {
    console.log(`    ✗ ${r.method.padEnd(6)} ${r.operation.padEnd(40)} ${r.note ?? ''}`);
  }

  // Save artifacts
  const outDir = `${cli.outputDir}/preflight-${new Date().toISOString().replace(/[-:T]/g, '').replace(/\.\d{3}Z$/, '').toLowerCase()}`;
  await mkdir(outDir, { recursive: true });

  const report = {
    timestamp: new Date().toISOString(),
    paperclipUrl: cli.paperclipUrl,
    companyId: adapter.companyId,
    companyName: adapter.companyName,
    reachable: probe.reachable,
    companyValid: probe.companyValid,
    errors: probe.errors,
    routes: probe.routes,
    capabilityMatrix: ROUTE_CAPABILITIES,
  };

  await writeFile(path.join(outDir, 'probe-report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(outDir, 'capability-matrix.md'), buildPreflightMarkdown(adapter, probe));
  console.log(`\nArtifacts: ${outDir}/probe-report.json + capability-matrix.md`);

  if (probe.errors.length > 0) {
    console.error('\n✗ Preflight FAILED\n');
    process.exit(1);
  }

  console.log('\n✓ Preflight PASSED\n');
  process.exit(0);
}

function buildPreflightMarkdown(
  adapter: import('./lifecycle/paperclipAdapter.js').PaperclipLifecycleAdapter,
  probe: { routes: { operation: string; reachable: boolean | null; latencyMs: number | null; error?: string }[] }
): string {
  const lines: string[] = [
    '# MMF Studio Paperclip Lifecycle — Capability Matrix',
    '',
    `**Generated:** ${new Date().toISOString()}`,
    `**Paperclip URL:** ${adapter.getCapabilityMatrix().paperclipUrl}`,
    `**Company:** ${adapter.companyName} (ID: \`${adapter.companyId}\`)`,
    '',
    '## Schema-Verified Routes',
    '',
    '| Method | Operation | Verification |',
    '|--------|----------|--------------|',
  ];

  for (const r of ROUTE_CAPABILITIES.filter((r: RouteCapability) => r.capability === 'verified')) {
    const pr = probe.routes.find((pr: { operation: string }) => pr.operation === r.operation);
    const latency = pr?.latencyMs;
    const verification = r.method === 'GET'
      ? (pr?.reachable ? `read-only probe ${latency}ms` : 'read-only probe not available')
      : 'OpenAPI schema only — not runtime-tested';
    lines.push(`| ${r.method} | \`${r.operation}\` | ${verification} |`);
  }

  lines.push('');
  lines.push('## Unsupported Routes (absent from OpenAPI)');
  lines.push('');
  for (const r of ROUTE_CAPABILITIES.filter((r: RouteCapability) => r.capability === 'unsupported')) {
    lines.push(`- **${r.method}** \`${r.operation}\` — ${r.note ?? 'no route in OpenAPI'}`);
  }

  lines.push('');
  lines.push('## Safety Gates');
  lines.push(`- Company in allowlist: ✅ \`${adapter.companyName}\``);
  lines.push(`- dryRun flag: ✅ ON (no mutations will be issued)`);
  lines.push('');
  lines.push('## Live Execution Capability');
  lines.push('');
  const verif = ROUTE_CAPABILITIES.filter(r => r.capability === 'verified').length;
  const unverif = ROUTE_CAPABILITIES.filter(r => r.capability === 'unsupported').length;
  lines.push(`Verified routes: **${verif}** | Unsupported: **${unverif}**`);
  lines.push('');
  lines.push('Live 14-phase execution is **disabled** because no real phase orchestrator is implemented.');
  lines.push('The adapter has schema-verified routes for agent termination and watchdog removal, but route coverage is not orchestration.');
  lines.push('Only `--dry-run` may execute the simulated 14-phase lifecycle.');
  lines.push('');
  lines.push('Do not use `--live`; it fails closed until a real Paperclip-backed phase orchestrator exists.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Phase runner
// ---------------------------------------------------------------------------

async function runPhase(
  ctx: LifecycleContext,
  phase: PhaseNumber,
  fake: FakePaperclip
): Promise<PhaseReceipt> {
  const startedAt = new Date().toISOString();

  try {
    const result = PHASES[phase].execute(ctx);

    // Merge fake state back
    ctx.issues = new Map(fake.getState().issues);
    ctx.approvals = new Map(fake.getState().approvals);
    ctx.runs = new Map(fake.getState().runs);
    ctx.interactions = new Map(fake.getState().interactions);

    fake.tick();

    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      kind: 'mmf-lifecycle-phase-receipt',
      version: '1.0',
      projectId: ctx.projectId,
      projectIndex: ctx.projectIndex,
      phase,
      phaseName: PHASE_NAMES[phase],
      status: 'failed',
      owner: PHASES[phase].owner,
      agentId: null,
      issueId: null,
      runId: null,
      receipts: {},
      gates: [],
      invariantViolations: [error],
      startedAt,
      finishedAt: new Date().toISOString(),
      deterministic: true,
      error,
    };
  }
}

// ---------------------------------------------------------------------------
// Build project receipt
// ---------------------------------------------------------------------------

function buildProjectReceipt(
  projectIndex: number,
  setup: SyntheticProjectSetup,
  phases: PhaseReceipt[],
  startedAt: string
): ProjectReceipt {
  const ctx = setup.context;
  const { violations: closureViolations } = checkClosureInvariants(ctx);
  const terminationOrder = ctx.specialists.map(s => s.id);
  if (ctx.orchestrator) {
    terminationOrder.push(ctx.orchestrator.id);
  }

  const activeRuns = Array.from(ctx.runs.values()).filter(r =>
    ['queued', 'running'].includes(r.status)
  );
  const pendingApprovals = Array.from(ctx.approvals.values()).filter(a =>
    a.status === 'pending'
  );
  const pendingInteractions = Array.from(ctx.interactions.values()).filter(i =>
    i.status === 'pending'
  );

  const allPhasesPassed = phases.every(p => p.status === 'passed');
  const status = allPhasesPassed && closureViolations.length === 0 ? 'completed' : 'failed';

  return {
    kind: 'mmf-lifecycle-project-receipt',
    version: '1.0',
    projectId: ctx.projectId,
    projectIndex,
    status,
    phases,
    terminationOrder,
    permanentAgentsRetained: [ctx.director.id],
    watchdogRemoved: !ctx.watchdog || ctx.watchdog.removed === true,
    activeRunsAtClose: activeRuns.length,
    pendingApprovalsAtClose: pendingApprovals.length,
    pendingInteractionsAtClose: pendingInteractions.length,
    recoveryActionsAtClose: 0,
    invariantViolations: closureViolations,
    startedAt,
    finishedAt: new Date().toISOString(),
    totalDurationMs: new Date().getTime() - new Date(startedAt).getTime(),
  };
}

// ---------------------------------------------------------------------------
// Run synthetic project
// ---------------------------------------------------------------------------

async function runSyntheticProject(
  projectIndex: number,
  fake: FakePaperclip
): Promise<{ setup: SyntheticProjectSetup; phases: PhaseReceipt[]; startedAt: string }> {
  const startedAt = new Date().toISOString();
  let { brief, context } = createSyntheticProjectBuildContext(projectIndex, fake);
  const specialistsRef: Agent[] = context.specialists;
  let orchestratorRef: Agent | null = context.orchestrator;

  const phases: PhaseReceipt[] = [];

  for (let phase = 1; phase <= 14; phase++) {
    const phaseNum = phase as PhaseNumber;
    context = fake.buildLifecycleContext(context.projectId, projectIndex, brief, specialistsRef, orchestratorRef);
    const receipt = await runPhase(context, phaseNum, fake);
    phases.push(receipt);

    if (receipt.status === 'failed') {
      console.error(`  ✗ Phase ${phase} (${PHASE_NAMES[phaseNum]}) FAILED: ${receipt.error ?? 'unknown'}`);
      break;
    } else {
      console.log(`  ✓ Phase ${phase}/14: ${PHASE_NAMES[phaseNum]}`);
    }

    if (context.orchestrator) orchestratorRef = context.orchestrator;
  }

  const setup: SyntheticProjectSetup = {
    brief,
    projectId: context.projectId,
    fake,
    context,
  };

  return { setup, phases, startedAt };
}

function createSyntheticProjectBuildContext(
  projectIndex: number,
  fake: FakePaperclip
): { brief: SyntheticBrief; context: LifecycleContext } {
  const projectId = `mmf-acceptance-20260713-run${projectIndex}`;
  const brief: SyntheticBrief = {
    client: `MMF Acceptance Run ${projectIndex}`,
    name: `Synthetic Project ${projectIndex}`,
    challenge: `Prove the full lifecycle contract through phase 14 for synthetic acceptance run ${projectIndex}.`,
    outcomes: ['Research synthesis', 'Copy review', 'Analytics summary'],
    sourceFolder: `synthetic://acceptance/run${projectIndex}/source`,
    deliverablesFolder: `synthetic://acceptance/run${projectIndex}/deliverables`,
    knowledgeBase: `synthetic://acceptance/run${projectIndex}/knowledge`,
    budgetCap: '0',
  };

  fake.createProject({ id: projectId, name: brief.name, status: 'backlog' });
  fake.createWatchdog(projectId);

  const context = fake.buildLifecycleContext(projectId, projectIndex, brief);

  return { brief, context };
}

// ---------------------------------------------------------------------------
// Explicitly armed Lab-only live runner
// ---------------------------------------------------------------------------

function closureGate(phases: PhaseReceipt[], name: string) {
  return phases.find(phase => phase.phase === 14)?.gates.find(gate => gate.name === name);
}

function countFromGate(phases: PhaseReceipt[], name: string): number {
  const match = closureGate(phases, name)?.detail.match(/(\d+)/);
  return match ? Number(match[1]) : -1;
}

async function runLiveAcceptance(cli: CLI): Promise<void> {
  const errors: string[] = [];
  if (!cli.armFullLifecycle) errors.push('--arm-full-lifecycle is required');
  if (cli.repeat !== 3) errors.push('--repeat=3 is required');
  if (cli.paperclipUrl !== 'http://127.0.0.1:3111') errors.push('Paperclip URL must be exactly http://127.0.0.1:3111');
  if (cli.companyName !== 'MMF Studio Lab') errors.push('company name must be exactly MMF Studio Lab');
  if (!cli.safetyAcknowledgement) errors.push('--safety-acknowledgement is required');
  if (cli.allowlist.length !== 1 || cli.allowlist[0] !== 'MMF Studio Lab') errors.push('allowlist must contain only MMF Studio Lab');
  if (process.env.LIVECLI_ORCHESTRATOR_ENABLED !== 'true') errors.push('LIVECLI_ORCHESTRATOR_ENABLED=true is required');
  if (errors.length) {
    console.error('ERROR: live full-lifecycle safety gate refused execution:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  const adapter = await createPaperclipAdapter({
    paperclipUrl: cli.paperclipUrl!, companyId: cli.companyId, companyName: cli.companyName,
    safetyAcknowledgement: true, dryRun: false, allowlist: ['MMF Studio Lab'],
    syntheticBoardAutoDecision: true, requestTimeoutMs: 10_000,
  });
  if (!adapter.isSyntheticBoardAutoDecisionSafe()) throw new Error('SAFETY_GATE: synthetic Board target is not safe');

  const runId = `live-${new Date().toISOString().replace(/[-:T]/g, '').replace(/\.\d{3}Z$/, '').toLowerCase()}`;
  const startedAt = new Date().toISOString();
  const projectReceipts: ProjectReceipt[] = [];
  const allViolations: string[] = [];

  for (let i = 1; i <= 3; i++) {
    console.log(`\n--- LIVE disposable project ${i}/3 ---\n`);
    const projectStartedAt = new Date().toISOString();
    const workspace = path.resolve(cli.outputDir, runId, `project-${i}`, 'workspace');
    await mkdir(workspace, { recursive: true });
    const brief: SyntheticBrief = {
      client: `MMF Live Acceptance ${i}`,
      name: `MMF Live Acceptance ${runId} ${i}`,
      challenge: `Verify the real Paperclip control-plane lifecycle for disposable acceptance project ${i}.`,
      outcomes: ['Research synthesis', 'Conversion copy evidence', 'Analytics evidence'],
      sourceFolder: workspace,
      deliverablesFolder: path.join(workspace, 'deliverables'),
      knowledgeBase: path.join(workspace, 'knowledge'),
      budgetCap: '0',
    };
    await Promise.all([mkdir(brief.deliverablesFolder, { recursive: true }), mkdir(brief.knowledgeBase, { recursive: true })]);
    const orchestrator = new RealLifecycleOrchestrator({
      adapter, brief, projectIndex: i, idempotencyKey: `${runId}-project-${i}`,
      pollIntervalMs: 250, pollMaxAttempts: 40,
    });
    const result = await orchestrator.runAll();
    const ctx = orchestrator.getContextSnapshot();
    const finishedAt = new Date().toISOString();
    const violations = result.phases.flatMap(phase => phase.invariantViolations);
    const cleanup = [...result.events].reverse().find(event => event.type === 'CLEANUP_COMPLETE');
    const completed = result.phases.length === 14 && result.phases.every(phase => phase.status === 'passed');
    const receipt: ProjectReceipt = {
      kind: 'mmf-lifecycle-project-receipt', version: '1.0', projectId: ctx.projectId,
      projectIndex: i, status: completed ? 'completed' : 'failed', phases: result.phases,
      terminationOrder: cleanup?.type === 'CLEANUP_COMPLETE' ? cleanup.terminatedAgents : [],
      permanentAgentsRetained: ctx.directorId ? [ctx.directorId] : [],
      watchdogRemoved: closureGate(result.phases, 'watchdog_removed')?.status === 'passed',
      activeRunsAtClose: countFromGate(result.phases, 'no_active_runs'),
      pendingApprovalsAtClose: countFromGate(result.phases, 'no_pending_approvals'),
      pendingInteractionsAtClose: countFromGate(result.phases, 'no_pending_interactions'),
      recoveryActionsAtClose: 0, invariantViolations: violations,
      startedAt: projectStartedAt, finishedAt,
      totalDurationMs: new Date(finishedAt).getTime() - new Date(projectStartedAt).getTime(),
    };
    projectReceipts.push(receipt);
    allViolations.push(...violations);
    const projectDir = path.join(cli.outputDir, runId, `project-${i}`);
    await writeFile(path.join(projectDir, 'phases-001-014.json'), JSON.stringify(result.phases, null, 2));
    await writeFile(path.join(projectDir, 'project-receipt.json'), JSON.stringify(receipt, null, 2));
    console.log(`${completed ? '✓' : '✗'} Project ${i}: ${ctx.projectId || '(not created)'} — ${receipt.status}`);
    if (!completed) break;
  }

  const finishedAt = new Date().toISOString();
  const allProjectsCompleted = projectReceipts.length === 3 && projectReceipts.every(project => project.status === 'completed');
  const summary: RunSummary = {
    kind: 'mmf-lifecycle-run-summary', version: '1.0', runId, mode: 'live', repeat: 3,
    projects: projectReceipts,
    overallStatus: allProjectsCompleted && allViolations.length === 0 ? 'passed' : 'failed',
    allProjectsCompleted, allInvariantViolations: allViolations, startedAt, finishedAt,
    totalDurationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
  };
  const summaryDir = path.join(cli.outputDir, runId);
  await mkdir(summaryDir, { recursive: true });
  await writeFile(path.join(summaryDir, 'run-summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(path.join(summaryDir, 'run-summary.md'), `# MMF Full-Lifecycle Live Acceptance\n\n- Run: ${runId}\n- Status: ${summary.overallStatus}\n- Projects: ${projectReceipts.length}/3\n- Violations: ${allViolations.length}\n`);
  console.log(`\nLIVE run ${runId}: ${summary.overallStatus.toUpperCase()} (${projectReceipts.length}/3 projects)`);
  console.log(`Receipt: ${path.join(summaryDir, 'run-summary.json')}`);
  if (summary.overallStatus !== 'passed') process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const cli = parseCLI();
  console.log('\n=== MMF Studio Full-Lifecycle Acceptance Harness ===\n');
  console.log(`Mode:    ${cli.mode}`);
  console.log(`Repeat:  ${cli.repeat} project(s)`);
  console.log(`Output:  ${cli.outputDir}\n`);

  // ── PREFLIGHT MODE ─────────────────────────────────────────────────
  if (cli.mode === 'preflight') {
    await runPreflight(cli);
    return;
  }

  // ── LIVE MODE: explicit multi-gate Lab acceptance ─────────────────────
  if (cli.mode === 'live') {
    await runLiveAcceptance(cli);
    return;
  }

  // ── DRY-RUN MODE ─────────────────────────────────────────────────
  const runId = `run-${new Date().toISOString().replace(/[-:T]/g, '').replace(/\.\d{3}Z$/, '').toLowerCase()}`;
  const startedAt = new Date().toISOString();
  const projectReceipts: ProjectReceipt[] = [];
  const allViolations: string[] = [];

  for (let i = 1; i <= cli.repeat; i++) {
    console.log(`\n--- Project ${i}/${cli.repeat} ---\n`);

    const fake = new FakePaperclip({
      boardAutoApprove: true,
      boardAutoDecision: 'move_forward_with_limits',
    });

    const { setup, phases, startedAt: projectStartedAt } = await runSyntheticProject(i, fake);
    const projectReceipt = buildProjectReceipt(i, setup, phases, projectStartedAt);
    projectReceipts.push(projectReceipt);

    if (projectReceipt.status === 'failed') {
      console.log(`\nProject ${i} FAILED`);
      for (const v of projectReceipt.invariantViolations) {
        console.log(`  ! ${v}`);
      }
      allViolations.push(...projectReceipt.invariantViolations);
    } else {
      console.log(`\nProject ${i} COMPLETED successfully`);
      console.log(`  Termination order: ${projectReceipt.terminationOrder.join(' → ')}`);
      console.log(`  Permanent agents retained: ${projectReceipt.permanentAgentsRetained.join(', ')}`);
      console.log(`  Watchdog removed: ${projectReceipt.watchdogRemoved}`);
      console.log(`  Active runs at close: ${projectReceipt.activeRunsAtClose}`);
      console.log(`  Pending approvals at close: ${projectReceipt.pendingApprovalsAtClose}`);
      console.log(`  Pending interactions at close: ${projectReceipt.pendingInteractionsAtClose}`);
    }

    const projectDir = path.join(cli.outputDir, runId, `project-${i}`);
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'phases-001-014.json'), JSON.stringify(phases, null, 2));
    await writeFile(path.join(projectDir, 'project-receipt.json'), JSON.stringify(projectReceipt, null, 2));
  }

  const finishedAt = new Date().toISOString();
  const allProjectsCompleted = projectReceipts.every(p => p.status === 'completed');

  const summary: RunSummary = {
    kind: 'mmf-lifecycle-run-summary',
    version: '1.0',
    runId,
    mode: cli.mode as 'dry-run' | 'live',
    repeat: cli.repeat,
    projects: projectReceipts,
    overallStatus: allProjectsCompleted && allViolations.length === 0 ? 'passed' : 'failed',
    allProjectsCompleted,
    allInvariantViolations: allViolations,
    startedAt,
    finishedAt,
    totalDurationMs: new Date().getTime() - new Date(startedAt).getTime(),
  };

  const summaryDir = path.join(cli.outputDir, runId);
  await mkdir(summaryDir, { recursive: true });
  await writeFile(path.join(summaryDir, 'run-summary.json'), JSON.stringify(summary, null, 2));

  const mdLines = [
    `# MMF Full-Lifecycle Acceptance — Run ${runId}`,
    '',
    `**Mode:** ${cli.mode}`,
    `**Repeat:** ${cli.repeat} project(s)`,
    `**Started:** ${startedAt}`,
    `**Finished:** ${finishedAt}`,
    `**Status:** ${summary.overallStatus.toUpperCase()}`,
    '',
    '## Results',
    '',
    ...projectReceipts.map((pr, i) => [
      `### Project ${i + 1}: ${pr.projectId}`,
      `**Status:** ${pr.status}`,
      `**Duration:** ${pr.totalDurationMs}ms`,
      `**Termination order:** ${pr.terminationOrder.join(' → ') || 'none'}`,
      `**Permanent agents retained:** ${pr.permanentAgentsRetained.join(', ')}`,
      `**Watchdog removed:** ${pr.watchdogRemoved}`,
      `**Active runs at close:** ${pr.activeRunsAtClose}`,
      `**Pending approvals at close:** ${pr.pendingApprovalsAtClose}`,
      `**Pending interactions at close:** ${pr.pendingInteractionsAtClose}`,
      '',
      '**Phase results:**',
      ...pr.phases.map(p => `- Phase ${p.phase}: ${p.phaseName} → ${p.status.toUpperCase()}`),
      '',
      ...(pr.invariantViolations.length > 0 ? [
        '**Invariant violations:**',
        ...pr.invariantViolations.map(v => `  - ${v}`),
        '',
      ] : []),
    ]).flat(),
    '',
    `**Overall:** ${summary.overallStatus.toUpperCase()}`,
    `**Total duration:** ${summary.totalDurationMs}ms`,
  ];

  await writeFile(path.join(summaryDir, 'run-summary.md'), mdLines.join('\n'));

  console.log(`\n=== Run Complete ===`);
  console.log(`Run ID:      ${runId}`);
  console.log(`Status:      ${summary.overallStatus.toUpperCase()}`);
  console.log(`Projects:    ${projectReceipts.length}/${cli.repeat} completed`);
  console.log(`Violations:  ${allViolations.length}`);
  console.log(`Summary:     ${summaryDir}/run-summary.json`);
  console.log(`Markdown:    ${summaryDir}/run-summary.md`);

  if (summary.overallStatus === 'failed') {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
