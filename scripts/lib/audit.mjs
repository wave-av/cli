/**
 * The offline half of the license-truth gate: everything that can be proven from files in
 * THIS repo, with no network. This is what CI blocks on, because a required check that
 * depends on registry.npmjs.org being up is a check that will be red for reasons that have
 * nothing to do with the pull request.
 *
 * Each rule below exists because a specific contradiction actually shipped:
 *   declared-vs-text  — @wave-av/cli declared "MIT" while LICENSE was the Apache-2.0 text.
 *   notice-shipped    — the Apache-2.0 NOTICE was in the repo but not in the npm tarball,
 *                       which Apache-2.0 §4(d) requires redistributions to carry.
 *   readme / lockfile — third and fourth copies of the identifier that drift silently.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { detectSpdxFromText, classifyCopyleft, UNKNOWN } from './spdx.mjs';

/** @typedef {{rule:string, severity:"error"|"warn", message:string}} Problem */

/**
 * Read every place this repo states a license.
 * @param {string} root repository root
 */
export function readRepoTruth(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const licensePath = join(root, 'LICENSE');
  const noticePath = join(root, 'NOTICE');
  const licenseText = existsSync(licensePath) ? readFileSync(licensePath, 'utf8') : null;

  let lockDeclared = null;
  const lockPath = join(root, 'package-lock.json');
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lockDeclared = lock.packages?.['']?.license ?? null;
  }

  let readmeDeclared = null;
  const readmePath = join(root, 'README.md');
  if (existsSync(readmePath)) {
    readmeDeclared = readmeLicense(readFileSync(readmePath, 'utf8'));
  }

  return {
    name: pkg.name,
    version: pkg.version,
    declared: typeof pkg.license === 'string' ? pkg.license : null,
    files: Array.isArray(pkg.files) ? pkg.files : null,
    licenseFilePresent: licenseText !== null,
    licenseFileSpdx: detectSpdxFromText(licenseText),
    noticeFilePresent: existsSync(noticePath),
    lockDeclared,
    readmeDeclared,
  };
}

/**
 * Pull the identifier out of the README's "## License" section. Returns the first SPDX-ish
 * token on the first non-empty line after the heading, or null when there is no section.
 * @param {string} md
 */
export function readmeLicense(md) {
  const lines = md.split(/\r?\n/);
  const at = lines.findIndex((l) => /^#{1,6}\s+licen[sc]e\s*$/i.test(l.trim()));
  if (at === -1) return null;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^#{1,6}\s/.test(line)) return null; // next heading — empty section
    const m = line.match(/\b(Apache-2\.0|MIT|ISC|BSD-[23]-Clause|MPL-2\.0|GPL-[0-9.]+[a-z-]*)\b/i);
    return m ? m[1] : line.slice(0, 60);
  }
  return null;
}

/**
 * Licenses of every dependency the lockfile resolves, split by runtime vs dev.
 * Read from package-lock.json rather than node_modules so the gate needs no install and
 * gives the same answer on every machine.
 * @param {string} root
 */
export function dependencyLicenses(root) {
  const lockPath = join(root, 'package-lock.json');
  if (!existsSync(lockPath)) return { runtime: [], dev: [] };
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const runtime = [];
  const dev = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path) continue; // the root package itself
    const name = entry.name ?? path.replace(/^(.*\/)?node_modules\//, '');
    const record = {
      name,
      version: entry.version ?? null,
      license: entry.license ?? UNKNOWN,
      class: classifyCopyleft(entry.license ?? UNKNOWN),
    };
    (entry.dev || entry.devOptional ? dev : runtime).push(record);
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  return { runtime: runtime.sort(byName), dev: dev.sort(byName) };
}

/**
 * Run every offline rule.
 * @param {string} root
 * @param {{packedFiles?: string[]|null}} [opts] file list `npm pack` would produce; when
 *   omitted the two shipped-artifact rules are skipped (and said so in the notes).
 * @returns {{truth: object, deps: object, problems: Problem[], notes: string[]}}
 */
export function auditRepo(root, opts = {}) {
  const truth = readRepoTruth(root);
  const deps = dependencyLicenses(root);
  /** @type {Problem[]} */
  const problems = [];
  const notes = [];

  if (!truth.licenseFilePresent) {
    problems.push({
      rule: 'license-file-present',
      severity: 'error',
      message: 'no LICENSE file at the repository root',
    });
  } else if (truth.licenseFileSpdx === UNKNOWN) {
    problems.push({
      rule: 'license-file-identifiable',
      severity: 'error',
      message: 'LICENSE text does not match any known license — cannot verify the declaration',
    });
  }

  if (!truth.declared) {
    problems.push({
      rule: 'declared-license-present',
      severity: 'error',
      message: 'package.json has no "license" field',
    });
  } else if (truth.licenseFileSpdx !== UNKNOWN && truth.declared !== truth.licenseFileSpdx) {
    problems.push({
      rule: 'declared-matches-text',
      severity: 'error',
      message:
        `package.json declares "${truth.declared}" but the LICENSE file is the ` +
        `${truth.licenseFileSpdx} text — the published metadata and the shipped file disagree`,
    });
  }

  if (truth.lockDeclared && truth.declared && truth.lockDeclared !== truth.declared) {
    problems.push({
      rule: 'lockfile-matches-manifest',
      severity: 'error',
      message:
        `package-lock.json records "${truth.lockDeclared}" for the root package but ` +
        `package.json declares "${truth.declared}" — run \`npm install\` to regenerate`,
    });
  }

  if (truth.readmeDeclared && truth.declared && truth.readmeDeclared !== truth.declared) {
    problems.push({
      rule: 'readme-matches-manifest',
      severity: 'error',
      message:
        `README's License section says "${truth.readmeDeclared}" but package.json declares ` +
        `"${truth.declared}"`,
    });
  }

  const packed = opts.packedFiles ?? null;
  if (packed) {
    const has = (f) => packed.some((p) => p === f || p.endsWith(`/${f}`));
    if (!has('LICENSE')) {
      problems.push({
        rule: 'license-shipped',
        severity: 'error',
        message: 'the packed tarball contains no LICENSE file',
      });
    }
    if (truth.noticeFilePresent && truth.licenseFileSpdx === 'Apache-2.0' && !has('NOTICE')) {
      problems.push({
        rule: 'notice-shipped',
        severity: 'error',
        message:
          'the repo has a NOTICE file and is Apache-2.0, but NOTICE is not in the packed ' +
          'tarball — Apache-2.0 §4(d) requires redistributions to carry it. Add "NOTICE" to ' +
          'the "files" array in package.json.',
      });
    }
  } else {
    notes.push('packed-file rules skipped: no `npm pack` file list was supplied');
  }

  const strong = deps.runtime.filter((d) => d.class === 'strong');
  for (const d of strong) {
    problems.push({
      rule: 'no-strong-copyleft-runtime',
      severity: 'error',
      message: `runtime dependency ${d.name}@${d.version} is ${d.license} (strong copyleft)`,
    });
  }

  const weak = [...deps.runtime, ...deps.dev].filter((d) => d.class === 'weak');
  if (weak.length) {
    notes.push(
      `weak/file-level copyleft present (reported, not blocked): ` +
        weak.map((d) => `${d.name}@${d.version} ${d.license}`).join(', ')
    );
  }

  return { truth, deps, problems, notes };
}
