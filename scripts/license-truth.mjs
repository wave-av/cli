#!/usr/bin/env node
/**
 * license-truth — prove that what this package DECLARES is what it SHIPS.
 *
 *   node scripts/license-truth.mjs check    (default) offline audit of this repo; exit 1 on drift
 *   node scripts/license-truth.mjs ledger   fetch every published WAVE artifact, write LICENSE-LEDGER.md
 *   node scripts/license-truth.mjs ledger --check   as above, but exit 1 if any artifact is inconsistent
 *
 * `check` is what CI blocks on: it reads only files in the repo, so it is deterministic and
 * cannot go red because a registry is having a bad afternoon. `ledger` is the periodic
 * reconciliation against the registries, run on a schedule and on demand.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditRepo } from './lib/audit.mjs';
import {
  inspectNpm,
  inspectPyPI,
  inspectSource,
  artifactProblems,
  sourceProblems,
} from './lib/registry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_PATH = join(ROOT, 'LICENSE-LEDGER.md');

/**
 * The file list `npm publish` would upload. `--ignore-scripts` keeps this from triggering a
 * build; the answer is about `files`/`.npmignore` semantics, not about build output.
 * @returns {string[]|null} null when npm is unavailable (the two packed rules then skip).
 */
export function packedFileList(root = ROOT) {
  try {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const start = out.indexOf('[');
    return JSON.parse(out.slice(start))[0].files.map((f) => f.path);
  } catch {
    return null;
  }
}

function runCheck({ json }) {
  const result = auditRepo(ROOT, { packedFiles: packedFileList() });
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.problems.length ? 1 : 0;
  }

  const { truth, problems, notes } = result;
  console.log(`license-truth: ${truth.name}@${truth.version}`);
  console.log(`  declared (package.json) : ${truth.declared}`);
  console.log(`  LICENSE file text is    : ${truth.licenseFileSpdx}`);
  console.log(`  README section says     : ${truth.readmeDeclared ?? '(no License section)'}`);
  console.log(`  lockfile records        : ${truth.lockDeclared ?? '(none)'}`);
  console.log(`  NOTICE file present     : ${truth.noticeFilePresent}`);
  for (const n of notes) console.log(`  note: ${n}`);

  if (!problems.length) {
    console.log('\nOK — every license surface agrees.');
    return 0;
  }
  console.error(`\n${problems.length} license contradiction(s):`);
  for (const p of problems) console.error(`  [${p.rule}] ${p.message}`);
  console.error(
    '\nFix the source of truth (the LICENSE file), then make every declaration match it.'
  );
  return 1;
}

async function runLedger({ json, strict }) {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'scripts/license-manifest.json'), 'utf8'));
  const rows = [];
  const failures = [];

  for (const entry of manifest.npm) {
    rows.push(await collect(() => inspectNpm(entry.name), entry, failures));
  }
  for (const entry of manifest.pypi) {
    rows.push(await collect(() => inspectPyPI(entry.name), entry, failures));
  }

  const local = auditRepo(ROOT, { packedFiles: packedFileList() });
  const markdown = renderLedger({ manifest, rows, local });
  writeFileSync(LEDGER_PATH, markdown);

  if (json) {
    process.stdout.write(`${JSON.stringify({ manifest, rows, local }, null, 2)}\n`);
  } else {
    console.log(`wrote ${LEDGER_PATH} (${rows.length} published artifacts)`);
    for (const r of rows) {
      const flag = r.error
        ? 'ERROR'
        : r.problems.length
          ? 'DRIFT'
          : r.sourceTruth?.available
            ? 'ok'
            : 'UNVER';
      console.log(`  ${flag.padEnd(5)} ${r.name}@${r.version ?? '?'} ${r.error ?? r.problems.join('; ')}`);
    }
  }

  const drifted = rows.filter((r) => r.problems?.length || r.error);
  const unverified = rows.filter((r) => !r.error && !r.problems.length && !r.sourceTruth?.available);
  if (unverified.length) {
    console.error(
      `\n${unverified.length} artifact(s) could not be checked against a source repo: ` +
        unverified.map((r) => r.name).join(', ')
    );
  }
  if (strict && drifted.length) {
    console.error(`\n${drifted.length} published artifact(s) disagree with their own metadata.`);
    return 1;
  }
  return 0;
}

async function collect(fn, entry, failures) {
  try {
    const row = await fn();
    const source = await inspectSource(entry.source);
    return {
      ...row,
      source: entry.source,
      sourceTruth: source,
      // Two independent questions: is the ARTIFACT self-consistent, and does it match the
      // SOURCE it claims to come from? Every WAVE artifact passes the first and several
      // fail the second, so reporting only the first would report "all clear" on a
      // repository that is provably contradicting itself.
      problems: [...artifactProblems(row), ...sourceProblems(row, source)],
      error: null,
    };
  } catch (err) {
    failures.push(entry.name);
    return { name: entry.name, source: entry.source, problems: [], error: String(err.message) };
  }
}

/** @returns {string} the LICENSE-LEDGER.md body */
export function renderLedger({ manifest, rows, local, now = new Date() }) {
  const lines = [];
  lines.push('# WAVE license ledger');
  lines.push('');
  lines.push(
    '<!-- GENERATED by `npm run license:ledger`. Do not hand-edit; regenerate instead. -->'
  );
  lines.push('');
  lines.push(`Generated: ${now.toISOString()}`);
  lines.push('');
  lines.push(
    `**Intended license for the open WAVE surface: \`${manifest.intendedLicense}\`** — per ` +
      `${manifest.governingStatement.repo}@${manifest.governingStatement.commit.slice(0, 7)} ` +
      `("${manifest.governingStatement.subject}"): ${manifest.governingStatement.body}`
  );
  lines.push('');
  lines.push('## Published artifacts');
  lines.push('');
  lines.push(
    '`declared` is the identifier in the published artifact\'s own metadata. `ships` is the ' +
      'license whose TEXT is in the file inside that artifact. `source declares` is what the ' +
      'manifest on the source repository\'s default branch says today. All three must agree; ' +
      'any disagreement is drift, and the last pair is the one an artifact cannot self-report.'
  );
  lines.push('');
  lines.push('| package | registry | version | declared | ships | source declares | NOTICE | verdict |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    if (r.error) {
      lines.push(`| \`${r.name}\` | — | — | — | — | — | — | **could not fetch**: ${r.error} |`);
      continue;
    }
    // An unresolved source is NOT a pass: the artifact agrees with itself, and nothing
    // has checked it against the repo it claims to come from.
    const verdict = r.problems.length
      ? `**DRIFT** — ${r.problems.join('; ')}`
      : r.sourceTruth?.available
        ? 'consistent'
        : `**unverified** — artifact self-consistent; source unresolved (${r.sourceTruth?.reason ?? 'not fetched'})`;
    const shipped = r.licenseFileInArtifact ? `\`${r.licenseFileSpdx}\`` : '**no LICENSE file**';
    const src = r.sourceTruth?.available ? `\`${r.sourceTruth.declared}\`` : '_unresolved_';
    lines.push(
      `| \`${r.name}\` | ${r.ecosystem} | ${r.version} | \`${r.declared}\` | ${shipped} | ` +
        `${src} | ${r.noticeFileInArtifact ? 'yes' : 'no'} | ${verdict} |`
    );
  }
  lines.push('');
  lines.push('| package | source of truth | LICENSE file in that repo |');
  lines.push('| --- | --- | --- |');
  for (const r of rows) {
    const st = r.sourceTruth;
    const licCol = st?.available
      ? st.licensePath
        ? `\`${st.licensePath}\` is \`${st.licenseFileSpdx}\``
        : '**no LICENSE file found**'
      : `_unresolved: ${st?.reason ?? 'not fetched'}_`;
    lines.push(`| \`${r.name}\` | ${r.source} | ${licCol} |`);
  }
  lines.push('');

  lines.push('## This repository');
  lines.push('');
  lines.push(`- package: \`${local.truth.name}@${local.truth.version}\``);
  lines.push(`- \`package.json\` declares: \`${local.truth.declared}\``);
  lines.push(`- \`LICENSE\` file text is: \`${local.truth.licenseFileSpdx}\``);
  lines.push(`- \`README.md\` License section: \`${local.truth.readmeDeclared ?? 'none'}\``);
  lines.push(`- \`package-lock.json\` root: \`${local.truth.lockDeclared ?? 'none'}\``);
  lines.push(`- \`NOTICE\` present in repo: ${local.truth.noticeFilePresent ? 'yes' : 'no'}`);
  lines.push(
    `- offline gate: ${local.problems.length ? `**${local.problems.length} problem(s)**` : 'clean'}`
  );
  for (const p of local.problems) lines.push(`  - \`${p.rule}\` — ${p.message}`);
  lines.push('');

  lines.push('## Dependency licenses');
  lines.push('');
  lines.push(
    'Strong copyleft (GPL/AGPL/SSPL/EUPL/CC-BY-SA) in a **runtime** dependency fails the gate. ' +
      'Weak, file-level copyleft (MPL/LGPL/EPL/CDDL) is listed here but does not block.'
  );
  lines.push('');
  lines.push('| scope | total | permissive | weak copyleft | strong copyleft | unknown |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const [scope, list] of [['runtime', local.deps.runtime], ['dev', local.deps.dev]]) {
    const n = (c) => list.filter((d) => d.class === c).length;
    lines.push(
      `| ${scope} | ${list.length} | ${n('permissive')} | ${n('weak')} | ${n('strong')} | ${n('unknown')} |`
    );
  }
  lines.push('');
  const notable = [...local.deps.runtime, ...local.deps.dev].filter(
    (d) => d.class === 'weak' || d.class === 'strong' || d.class === 'unknown'
  );
  if (notable.length) {
    lines.push('Notable (non-permissive) dependencies:');
    lines.push('');
    lines.push('| dependency | license | class |');
    lines.push('| --- | --- | --- |');
    for (const d of notable) {
      lines.push(`| \`${d.name}@${d.version}\` | \`${d.license}\` | ${d.class} |`);
    }
  } else {
    lines.push('No non-permissive dependencies in either scope.');
  }
  lines.push('');
  return `${lines.join('\n')}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.find((a) => !a.startsWith('-')) ?? 'check';
  const json = argv.includes('--json');
  const strict = argv.includes('--check');

  if (command === 'check') return runCheck({ json });
  if (command === 'ledger') return runLedger({ json, strict });
  console.error(`unknown command "${command}" — expected "check" or "ledger"`);
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(2);
    }
  );
}
