/**
 * MMF Studio Paperclip Lifecycle Preflight
 *
 * Probes the real Paperclip server and emits a capability matrix report.
 * Read-only (GET only) — safe to run against a live Paperclip instance.
 *
 * Usage:
 *   npx tsx scripts/lifecycle/preflight.ts \
 *     --paperclip-url=http://127.0.0.1:3111 \
 *     [--company-id=<uuid>] \
 *     [--company-name="MMF Studio Lab"] \
 *     [--dry-run=true] \
 *     [--output=json|markdown|both]
 *
 * Exits 0 if Paperclip is reachable and routes are confirmed.
 * Exits 1 if unreachable, company not found, or critical routes fail.
 */

import {
  createPaperclipAdapter,
  ROUTE_CAPABILITIES,
  type RouteCapability,
} from './paperclipAdapter.js';

interface PreflightArgs {
  paperclipUrl: string;
  companyId: string | null;
  companyName: string | null;
  safetyAcknowledgement: boolean;
  dryRun: boolean;
  output: 'json' | 'markdown' | 'both';
  allowlist: string[];
}

function parseArgs(): PreflightArgs {
  const args = process.argv.slice(2);
  const get = (flag: string): string | null => {
    const found = args.find(a => a.startsWith(`--${flag}=`));
    return found ? found.slice(`--${flag}=`.length) : null;
  };
  const has = (flag: string) => args.includes(`--${flag}`);

  return {
    paperclipUrl: get('paperclip-url') ?? process.env.PAPERCLIP_URL ?? 'http://127.0.0.1:3111',
    companyId: get('company-id') ?? process.env.PAPERCLIP_COMPANY_ID ?? null,
    companyName: get('company-name') ?? process.env.PAPERCLIP_COMPANY_NAME ?? null,
    safetyAcknowledgement: has('safety-acknowledgement'),
    dryRun: get('dry-run') !== 'false',
    output: (get('output') ?? 'both') as 'json' | 'markdown' | 'both',
    allowlist: (get('allowlist') ?? 'MMF Studio Lab').split(',').map(s => s.trim()),
  };
}

async function main() {
  const cli = parseArgs();

  console.log('\n=== MMF Studio Paperclip Lifecycle Preflight ===\n');
  console.log(`Paperclip URL:  ${cli.paperclipUrl}`);
  console.log(`Company ID:     ${cli.companyId ?? '(auto-resolve)'}`);
  console.log(`Company name:   ${cli.companyName ?? '(auto-resolve to allowlist)'}`);
  console.log(`Allowlist:      ${cli.allowlist.join(', ')}`);
  console.log(`Dry-run:        ${cli.dryRun}`);
  console.log(`Safety ack:     ${cli.safetyAcknowledgement}\n`);

  // ── Create adapter (validates safety gates) ──────────────────────────
  let adapter;
  try {
    adapter = await createPaperclipAdapter({
      paperclipUrl: cli.paperclipUrl,
      companyId: cli.companyId,
      companyName: cli.companyName,
      safetyAcknowledgement: cli.safetyAcknowledgement,
      dryRun: cli.dryRun,
      allowlist: cli.allowlist,
    });
    console.log(`✓ Adapter constructed`);
    console.log(`  Company: ${adapter.companyName} (ID: ${adapter.companyId})`);
    console.log(`  Dry-run: ${adapter.isDryRun()}\n`);
  } catch (err) {
    console.error(`✗ Adapter construction failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  // ── Run preflight probe ─────────────────────────────────────────────
  console.log('Probing Paperclip routes...\n');
  const probe = await adapter.preflight();

  if (!probe.reachable) {
    console.error('✗ Paperclip server unreachable.\n');
    for (const e of probe.errors) {
      console.error(`  ${e}`);
    }
    process.exit(1);
  }

  console.log(`✓ Paperclip server reachable`);

  if (!probe.companyValid) {
    console.error('✗ Company validation failed.\n');
    for (const e of probe.errors) {
      console.error(`  ${e}`);
    }
    process.exit(1);
  }
  console.log(`✓ Company ID "${adapter.companyId}" is valid on this server\n`);

  // ── Emit route results ─────────────────────────────────────────────
  const verified = ROUTE_CAPABILITIES.filter(r => r.capability === 'verified');
  const unsupported = ROUTE_CAPABILITIES.filter(r => r.capability === 'unsupported');

  console.log(`\nRoute capability summary:`);
  console.log(`  Verified:    ${verified.length} routes`);
  console.log(`  Unsupported: ${unsupported.length} routes\n`);

  for (const route of ROUTE_CAPABILITIES) {
    const probeResult = probe.routes.find(r => r.operation === route.operation);
    const reachable = probeResult?.reachable ?? null;
    const latency = probeResult?.latencyMs ?? null;
    const err = probeResult?.error;

    const status = reachable === true
      ? `✓ ${latency}ms`
      : reachable === false
        ? `✗ ${err}`
        : route.capability === 'unsupported'
          ? '— unsupported'
          : '? not probed';

    console.log(`  [${route.capability === 'unsupported' ? 'UNSUP' : 'VERIF'}] ${route.method.padEnd(6)} ${route.operation.padEnd(35)} ${status}`);
  }

  // ── Emit capability matrix ─────────────────────────────────────────
  const matrix = adapter.getCapabilityMatrix();
  const matrixJson = JSON.stringify(matrix, null, 2);

  if (cli.output === 'json' || cli.output === 'both') {
    console.log('\n--- Capability Matrix (JSON) ---\n');
    // Pretty-print just the routes table
    const routeRows = matrix.routes.map(r => ({
      method: r.method,
      path: r.path,
      operation: r.operation,
      capability: r.capability,
      note: r.note ?? '',
    }));
    console.log(JSON.stringify({ ...matrix, routes: routeRows }, null, 2));
  }

  if (cli.output === 'markdown' || cli.output === 'both') {
    const md = buildMarkdownReport(adapter, probe);
    console.log('\n--- Capability Matrix (Markdown) ---\n');
    console.log(md);
  }

  // ── Save artifacts ─────────────────────────────────────────────────
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { randomUUID } = await import('node:crypto');
  const outDir = `artifacts/preflight/preflight-${new Date().toISOString().replace(/[-:T]/g, '').replace(/\.\d{3}Z$/, '').toLowerCase()}`;
  await mkdir(outDir, { recursive: true });

  const probeReport = {
    timestamp: new Date().toISOString(),
    paperclipUrl: cli.paperclipUrl,
    companyId: adapter.companyId,
    companyName: adapter.companyName,
    reachable: probe.reachable,
    companyValid: probe.companyValid,
    errors: probe.errors,
    routes: probe.routes,
    capabilityMatrix: matrix.routes.map(r => ({
      method: r.method,
      path: r.path,
      operation: r.operation,
      capability: r.capability,
      note: r.note ?? '',
    })),
  };

  await writeFile(`${outDir}/probe-report.json`, JSON.stringify(probeReport, null, 2));
  await writeFile(`${outDir}/capability-matrix.json`, matrixJson);
  await writeFile(`${outDir}/capability-matrix.md`, buildMarkdownReport(adapter, probe));

  console.log(`\nArtifacts saved to: ${outDir}/`);
  console.log(`  probe-report.json`);
  console.log(`  capability-matrix.json`);
  console.log(`  capability-matrix.md`);

  // ── Exit code ─────────────────────────────────────────────────────
  const criticalErrors = probe.errors.filter(e =>
    !e.includes('not probed') && !e.includes('UNSUPPORTED')
  );
  if (criticalErrors.length > 0) {
    console.error('\n✗ Preflight FAILED\n');
    process.exit(1);
  }

  console.log('\n✓ Preflight PASSED — Paperclip is reachable and routes are confirmed\n');
  process.exit(0);
}

function buildMarkdownReport(
  adapter: import('./paperclipAdapter.js').PaperclipLifecycleAdapter,
  probe: { routes: { operation: string; reachable: boolean | null; latencyMs: number | null; error?: string }[] }
): string {
  const matrix = adapter.getCapabilityMatrix();
  const lines: string[] = [
    '# MMF Studio Paperclip Lifecycle — Capability Matrix',
    '',
    `**Generated:** ${new Date().toISOString()}`,
    `**Paperclip URL:** ${matrix.paperclipUrl}`,
    `**Company:** ${matrix.companyName} (ID: \`${matrix.companyId}\`)`,
    `**Dry-run:** ${matrix.dryRun}`,
    '',
    '## Route Capabilities',
    '',
    '| Method | Operation | Capability | Status |',
    '|--------|----------|------------|--------|',
  ];

  for (const route of matrix.routes) {
    const probeResult = probe.routes.find((r: { operation: string }) => r.operation === route.operation);
    const reachable = probeResult?.reachable ?? null;
    const latency = probeResult?.latencyMs ?? null;

    let status = '';
    if (route.capability === 'unsupported') {
      status = '❌ Unsupported';
    } else if (reachable === true) {
      status = `✅ ${latency}ms`;
    } else if (reachable === false) {
      status = `❌ ${probeResult?.error ?? 'failed'}`;
    } else {
      status = '⚠️ Not probed';
    }

    const note = route.note ? `  _( ${route.note}_ )` : '';
    lines.push(
      `| ${route.method} | \`${route.operation}\` | \`${route.capability}\` | ${status} |`
    );
    if (note) lines.push(note);
  }

  lines.push('');
  lines.push('## Notes', '');
  lines.push('- **Verified** routes are confirmed in the OpenAPI spec and probe succeeded.');
  lines.push('- **Unsupported** routes are absent from the OpenAPI or explicitly not implemented.');
  lines.push('- **unverified** routes exist in OpenAPI but were not directly probed in this preflight.');
  lines.push('');
  lines.push('## Safety Gates', '');
  lines.push(`- Company name must be in allowlist: [${matrix.safetyAcknowledgement ? '✅ acknowledged' : '❌ NOT acknowledged'}]`);
  lines.push(`- \`dryRun\` flag: [${matrix.dryRun ? '✅ ON (no mutations)' : '⚠️ OFF (mutations enabled)'}]`);
  lines.push('');
  lines.push('## Unsupported (cannot be implemented)', '');
  lines.push('- `agent.terminate`: No `/agent-hires/{id}/terminate` endpoint in OpenAPI');
  lines.push('- `watchdog.remove`: No watchdog routes in OpenAPI');
  lines.push('- `project.delete`: No DELETE route; projects close via `archivedAt` PATCH');

  return lines.join('\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
