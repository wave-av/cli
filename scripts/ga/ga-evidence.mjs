#!/usr/bin/env node
/**
 * ga-evidence.mjs — GA-evidence PRODUCER for wave-av/cli (VER-001, SUPPLY-001).
 *
 * Runs scripts/ga/check-VER-001.sh and scripts/ga/check-SUPPLY-001.sh, parses their
 * `PASS|FAIL|UNKNOWN <check-name>: <detail>` lines, folds each criterion's checks into one
 * schema-shaped result, and writes:
 *   ga-out/ga-report.json                       full detail: raw stdout/stderr, exit codes,
 *                                                per-check breakdown, timings.
 *   ga-out/wave-av__cli.ga-evidence.json         EXACTLY governance/schema/ga-evidence.schema.json
 *                                                shape — the file this repo's PR into
 *                                                governance/ga-gate/evidence/incoming/ replaces.
 *
 * STATUS RULE (never hardcoded — computed from the parsed check lines):
 *   fail     any check line for this criterion is FAIL
 *   unknown  no FAIL, but at least one check line is UNKNOWN (e.g. HEAD legitimately ahead of
 *            npm latest, or a clause this producer does not machine-verify — SBOM, vuln
 *            resolution)
 *   pass     every check line for this criterion is PASS
 * `failing_checks` always names what is not passing: FAIL details when status is fail, UNKNOWN
 * details when status is unknown. A `pass` is only ever emitted when every printed check for
 * that criterion actually passed.
 *
 * EXIT CODES (this file, the one the workflow's Enforce step reads)
 *   0  every criterion resolved to pass or unknown (nothing outright failed)
 *   1  at least one criterion resolved to fail
 *   2  a check script could not run at all (setup failure — never conflated with a real fail)
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const REPOSITORY = 'wave-av/cli';
const SPEC_VERSION = '1.0.0';
const EVIDENCE_URI = 'ci://wave-av/cli/.github/workflows/ga-evidence.yml#ga-report.json';

const CRITERIA = [
  { id: 'VER-001', script: 'scripts/ga/check-VER-001.sh' },
  { id: 'SUPPLY-001', script: 'scripts/ga/check-SUPPLY-001.sh' },
];

const LINE_RE = /^(PASS|FAIL|UNKNOWN)\s+([A-Za-z0-9._-]+):\s*(.*)$/;
const TARGET_RE = /^TARGET\s+(.+)$/;

function parseArgs(argv) {
  const out = { outDir: join(REPO_ROOT, 'ga-out') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out-dir') out.outDir = resolve(argv[++i]);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return out;
}

function runCheck(criterion) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const r = spawnSync('bash', [criterion.script], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
  });
  const durationMs = Date.now() - t0;
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  const lines = [];
  const targets = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.trimEnd();
    if (!line) continue;
    const t = line.match(TARGET_RE);
    if (t) { targets.push(t[1].trim()); continue; }
    const m = line.match(LINE_RE);
    if (m) lines.push({ status: m[1].toLowerCase(), name: m[2], detail: m[3] });
  }
  return {
    id: criterion.id,
    script: criterion.script,
    startedAt,
    durationMs,
    exitCode: r.status,
    signal: r.signal || null,
    processError: r.error ? String(r.error.message) : null,
    stdout,
    stderr,
    lines,
    targets,
  };
}

/**
 * Fold one check-script run into a schema `result` row (minus the shared fingerprint/timestamp,
 * added by the caller once for the whole document).
 */
function buildResult(run) {
  const setupFailed = run.processError || run.signal || run.exitCode === null
    || (run.exitCode === 2 && run.lines.length === 0);
  if (setupFailed) {
    return {
      criterion_id: run.id,
      status: 'unknown',
      command: run.script,
      targets_observed: [...new Set(run.targets)].sort(),
      failing_checks: [`setup: ${run.processError || `exit ${run.exitCode}` || 'no output'}`].slice(0, 500),
    };
  }

  const fails = run.lines.filter((l) => l.status === 'fail');
  const unknowns = run.lines.filter((l) => l.status === 'unknown');

  let status;
  let failing;
  if (fails.length > 0) {
    status = 'fail';
    failing = fails;
  } else if (unknowns.length > 0) {
    status = 'unknown';
    failing = unknowns;
  } else {
    status = 'pass';
    failing = [];
  }

  return {
    criterion_id: run.id,
    status,
    command: run.script,
    targets_observed: [...new Set(run.targets)].sort(),
    failing_checks: failing.map((l) => `${l.name}: ${l.detail}`.slice(0, 500)),
  };
}

/**
 * One fingerprint for the whole run, reused as evidence_sha256 on every row (mirrors the
 * pattern in wave-av/sdks' registry-cleanroom producer). Deliberately excludes timestamps,
 * temp paths and durations: two runs observing the same underlying facts must produce the same
 * digest, per the gate spec's idempotency rule.
 */
function computeFingerprint(results, runs) {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const material = results
    .map((res) => {
      const run = byId.get(res.criterion_id);
      return {
        id: res.criterion_id,
        status: res.status,
        checks: (run?.lines || [])
          .map((l) => ({ name: l.name, ok: l.status }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        targets: [...res.targets_observed].sort(),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const revision = (spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout || '').trim()
    || process.env.GITHUB_SHA || 'unknown';

  process.stdout.write(`ga-evidence — ${REPOSITORY} @ ${revision.slice(0, 12)}\n\n`);

  const runs = [];
  for (const criterion of CRITERIA) {
    process.stdout.write(`-- ${criterion.id} (${criterion.script})\n`);
    const run = runCheck(criterion);
    for (const l of run.lines) process.stdout.write(`   ${l.status.toUpperCase().padEnd(7)} ${l.name}: ${l.detail}\n`);
    if (run.processError) process.stdout.write(`   COULD-NOT-RUN: ${run.processError}\n`);
    process.stdout.write('\n');
    runs.push(run);
  }

  const preliminary = runs.map((r) => buildResult(r));
  const fingerprint = computeFingerprint(preliminary, runs);
  const verifiedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const results = preliminary
    .map((res) => ({
      criterion_id: res.criterion_id,
      status: res.status,
      command: res.command,
      evidence_sha256: fingerprint,
      evidence_uri: EVIDENCE_URI,
      verified_at: verifiedAt,
      ...(res.targets_observed.length > 0 ? { targets_observed: res.targets_observed } : {}),
      ...(res.failing_checks.length > 0 ? { failing_checks: res.failing_checks } : {}),
    }))
    .sort((a, b) => a.criterion_id.localeCompare(b.criterion_id));

  const evidenceDoc = {
    spec_version: SPEC_VERSION,
    repository: REPOSITORY,
    revision,
    results,
  };

  const fullReport = {
    schema: 'wave-ga-evidence-cli/1',
    spec_version: SPEC_VERSION,
    repository: REPOSITORY,
    revision,
    generated_at: verifiedAt,
    evidence_sha256: fingerprint,
    runner: { node: process.version, platform: process.platform },
    checks: runs.map((r) => ({
      criterion_id: r.id,
      script: r.script,
      started_at: r.startedAt,
      duration_ms: r.durationMs,
      exit_code: r.exitCode,
      signal: r.signal,
      process_error: r.processError,
      targets: r.targets,
      lines: r.lines,
      stdout: r.stdout,
      stderr: r.stderr,
    })),
    evidence: evidenceDoc,
  };

  mkdirSync(args.outDir, { recursive: true });
  writeFileSync(join(args.outDir, 'ga-report.json'), `${JSON.stringify(fullReport, null, 2)}\n`);
  writeFileSync(join(args.outDir, 'wave-av__cli.ga-evidence.json'), `${JSON.stringify(evidenceDoc, null, 2)}\n`);

  process.stdout.write(`${'-'.repeat(78)}\n`);
  for (const row of results) {
    process.stdout.write(`${row.criterion_id}: ${row.status.toUpperCase()}${row.failing_checks ? ` — ${row.failing_checks.length} unresolved check(s)` : ''}\n`);
  }
  process.stdout.write(`\nevidence fingerprint: ${fingerprint}\n`);
  process.stdout.write(`wrote ${join(args.outDir, 'ga-report.json')} and ${join(args.outDir, 'wave-av__cli.ga-evidence.json')}\n`);

  const anySetupFailure = runs.some((r) => r.processError || r.signal || r.exitCode === null);
  const anyFail = results.some((r) => r.status === 'fail');

  if (anySetupFailure) {
    process.stdout.write('\nGA-EVIDENCE COULD NOT FULLY RUN: at least one check script failed to execute\n');
    process.exitCode = 2;
    return;
  }
  if (anyFail) {
    process.stdout.write(`\nGA-EVIDENCE FAILED: ${results.filter((r) => r.status === 'fail').map((r) => r.criterion_id).join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('\nga-evidence: no criterion failed (pass or unknown only)\n');
}

main();
