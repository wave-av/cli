/**
 * Rule-level and end-to-end tests for the license gate.
 *
 * The load-bearing case is `catches the exact contradiction @wave-av/cli shipped`: a fixture
 * repo whose package.json says MIT while its LICENSE file is the Apache-2.0 text. That was
 * the real state of this repository at 1.0.9. If that assertion ever stops failing on the
 * fixture, the gate has stopped working.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

import { detectSpdxFromText, UNKNOWN } from './lib/spdx.mjs';
import { auditRepo, readRepoTruth, dependencyLicenses } from './lib/audit.mjs';
import { readTarGz, readZip } from './lib/archive.mjs';
import {
  artifactProblems,
  sourceProblems,
  pyprojectLicense,
  npmPackageUrl,
  pypiProjectUrl,
  rawGithubUrl,
} from './lib/registry.mjs';
import { packedFileList, renderLedger } from './license-truth.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APACHE_HEAD = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
const MIT_TEXT = `MIT License

Copyright (c) 2026 WAVE Online, LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.
`;

/* ── fixture repos ─────────────────────────────────────────────────────────── */

/** Build a throwaway package tree so the rules can be exercised against known-bad input. */
function fixture({ declared, licenseText, notice = false, readme = null, lockLicense = null, deps = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'license-truth-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0', license: declared, files: ['dist'] }, null, 2)
  );
  if (licenseText !== null) writeFileSync(join(dir, 'LICENSE'), licenseText);
  if (notice) writeFileSync(join(dir, 'NOTICE'), 'Fixture\nCopyright 2026\n');
  if (readme !== null) writeFileSync(join(dir, 'README.md'), readme);
  if (lockLicense !== null || deps.length) {
    const packages = { '': { name: 'fixture', version: '0.0.0', license: lockLicense ?? declared } };
    for (const d of deps) {
      packages[`node_modules/${d.name}`] = { version: d.version, license: d.license, ...(d.dev ? { dev: true } : {}) };
    }
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }, null, 2));
  }
  return dir;
}

const trash = [];
afterAll(() => {
  for (const d of trash) rmSync(d, { recursive: true, force: true });
});
function tmpFixture(spec) {
  const d = fixture(spec);
  trash.push(d);
  return d;
}

describe('auditRepo rules', () => {
  it('catches the exact contradiction @wave-av/cli shipped: declared MIT, Apache-2.0 text', () => {
    const dir = tmpFixture({ declared: 'MIT', licenseText: APACHE_HEAD });
    const { problems } = auditRepo(dir);
    const rule = problems.find((p) => p.rule === 'declared-matches-text');
    expect(rule).toBeDefined();
    expect(rule.message).toContain('declares "MIT"');
    expect(rule.message).toContain('Apache-2.0');
  });

  it('passes when the declaration matches the text', () => {
    const dir = tmpFixture({ declared: 'Apache-2.0', licenseText: APACHE_HEAD });
    expect(auditRepo(dir).problems).toEqual([]);
  });

  it('flags a missing LICENSE file', () => {
    const dir = tmpFixture({ declared: 'Apache-2.0', licenseText: null });
    expect(auditRepo(dir).problems.map((p) => p.rule)).toContain('license-file-present');
  });

  it('flags an unrecognizable LICENSE rather than trusting the declaration', () => {
    const dir = tmpFixture({ declared: 'Apache-2.0', licenseText: 'All rights reserved.' });
    expect(auditRepo(dir).problems.map((p) => p.rule)).toContain('license-file-identifiable');
  });

  it('flags a README that still names the old license', () => {
    const dir = tmpFixture({
      declared: 'Apache-2.0',
      licenseText: APACHE_HEAD,
      readme: '# fixture\n\n## License\n\nMIT\n',
    });
    expect(auditRepo(dir).problems.map((p) => p.rule)).toContain('readme-matches-manifest');
  });

  it('flags a lockfile whose root license drifted from the manifest', () => {
    const dir = tmpFixture({ declared: 'Apache-2.0', licenseText: APACHE_HEAD, lockLicense: 'MIT' });
    expect(auditRepo(dir).problems.map((p) => p.rule)).toContain('lockfile-matches-manifest');
  });

  it('requires NOTICE in the tarball when the package is Apache-2.0 and has one', () => {
    const dir = tmpFixture({ declared: 'Apache-2.0', licenseText: APACHE_HEAD, notice: true });
    const without = auditRepo(dir, { packedFiles: ['package.json', 'LICENSE'] });
    expect(without.problems.map((p) => p.rule)).toContain('notice-shipped');

    const with_ = auditRepo(dir, { packedFiles: ['package.json', 'LICENSE', 'NOTICE'] });
    expect(with_.problems.map((p) => p.rule)).not.toContain('notice-shipped');
  });

  it('requires LICENSE in the tarball', () => {
    const dir = tmpFixture({ declared: 'Apache-2.0', licenseText: APACHE_HEAD });
    const res = auditRepo(dir, { packedFiles: ['package.json', 'dist/index.js'] });
    expect(res.problems.map((p) => p.rule)).toContain('license-shipped');
  });

  it('notes when the packed-file rules were skipped instead of silently passing them', () => {
    const dir = tmpFixture({ declared: 'Apache-2.0', licenseText: APACHE_HEAD });
    expect(auditRepo(dir).notes.join(' ')).toContain('packed-file rules skipped');
  });

  it('fails on strong copyleft in a runtime dependency but not a dev one', () => {
    const runtime = tmpFixture({
      declared: 'Apache-2.0',
      licenseText: APACHE_HEAD,
      deps: [{ name: 'copyleft-lib', version: '1.0.0', license: 'GPL-3.0-only' }],
    });
    expect(auditRepo(runtime).problems.map((p) => p.rule)).toContain('no-strong-copyleft-runtime');

    const devOnly = tmpFixture({
      declared: 'Apache-2.0',
      licenseText: APACHE_HEAD,
      deps: [{ name: 'copyleft-lib', version: '1.0.0', license: 'GPL-3.0-only', dev: true }],
    });
    expect(auditRepo(devOnly).problems).toEqual([]);
  });

  it('reports weak copyleft as a note, not a failure', () => {
    const dir = tmpFixture({
      declared: 'Apache-2.0',
      licenseText: APACHE_HEAD,
      deps: [{ name: 'weak-lib', version: '2.0.0', license: 'MPL-2.0' }],
    });
    const res = auditRepo(dir);
    expect(res.problems).toEqual([]);
    expect(res.notes.join(' ')).toContain('weak-lib@2.0.0 MPL-2.0');
  });
});

describe('dependencyLicenses', () => {
  it('splits the real lockfile into runtime and dev and classifies every entry', () => {
    const { runtime, dev } = dependencyLicenses(ROOT);
    expect(runtime.length).toBeGreaterThan(0);
    expect(dev.length).toBeGreaterThan(0);
    for (const d of [...runtime, ...dev]) {
      expect(['permissive', 'weak', 'strong', 'unknown']).toContain(d.class);
    }
  });

  it('finds no strong copyleft in this package\'s runtime tree', () => {
    const { runtime } = dependencyLicenses(ROOT);
    expect(runtime.filter((d) => d.class === 'strong')).toEqual([]);
  });
});

/* ── this repository, for real ─────────────────────────────────────────────── */

describe('this repository', () => {
  it('declares Apache-2.0 in every place it states a license', () => {
    const truth = readRepoTruth(ROOT);
    expect(truth.declared).toBe('Apache-2.0');
    expect(truth.licenseFileSpdx).toBe('Apache-2.0');
    expect(truth.readmeDeclared).toBe('Apache-2.0');
    expect(truth.lockDeclared).toBe('Apache-2.0');
    expect(truth.noticeFilePresent).toBe(true);
  });

  it('passes the full offline gate against its own packed file list', () => {
    const packed = packedFileList(ROOT);
    expect(packed, 'npm pack --dry-run produced no file list').not.toBeNull();
    const res = auditRepo(ROOT, { packedFiles: packed });
    expect(res.problems).toEqual([]);
  });

  it('ships LICENSE and NOTICE in the tarball npm would publish', () => {
    const packed = packedFileList(ROOT);
    expect(packed).toContain('LICENSE');
    expect(packed).toContain('NOTICE');
  });
});

/* ── archive readers ───────────────────────────────────────────────────────── */

describe('readTarGz', () => {
  let dir;
  let tarball;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'license-pack-'));
    trash.push(dir);
    execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', dir], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [file] = readdirSync(dir).filter((f) => f.endsWith('.tgz'));
    tarball = join(dir, file);
  }, 120_000);

  it('reads a real npm tarball and finds the Apache-2.0 LICENSE inside it', () => {
    const entries = readTarGz(readFileSync(tarball));
    expect([...entries.keys()]).toContain('package/LICENSE');
    expect(detectSpdxFromText(entries.get('package/LICENSE').toString('utf8'))).toBe('Apache-2.0');
  });

  it('finds the NOTICE inside the tarball this change adds it to', () => {
    const entries = readTarGz(readFileSync(tarball));
    expect([...entries.keys()]).toContain('package/NOTICE');
    expect(entries.get('package/NOTICE').toString('utf8')).toContain('WAVE');
  });

  it('round-trips the package manifest byte-for-byte', () => {
    const entries = readTarGz(readFileSync(tarball));
    const packed = JSON.parse(entries.get('package/package.json').toString('utf8'));
    expect(packed.license).toBe('Apache-2.0');
    expect(packed.name).toBe('@wave-av/cli');
  });
});

describe('readZip', () => {
  /**
   * Minimal zip writer. CRC-32 is written as zero: the reader under test never verifies it
   * (it only needs names and bytes), so a real checksum would test nothing here.
   */
  function makeZip(files) {
    const locals = [];
    const central = [];
    let offset = 0;
    for (const [name, contentStr] of Object.entries(files)) {
      const nameBuf = Buffer.from(name, 'utf8');
      const raw = Buffer.from(contentStr, 'utf8');
      const deflated = deflateRawSync(raw);

      const lfh = Buffer.alloc(30);
      lfh.writeUInt32LE(0x04034b50, 0);
      lfh.writeUInt16LE(20, 4);
      lfh.writeUInt16LE(8, 8); // deflate
      lfh.writeUInt32LE(0, 14); // crc32 (unverified by the reader)
      lfh.writeUInt32LE(deflated.length, 18);
      lfh.writeUInt32LE(raw.length, 22);
      lfh.writeUInt16LE(nameBuf.length, 26);
      locals.push(lfh, nameBuf, deflated);

      const cdh = Buffer.alloc(46);
      cdh.writeUInt32LE(0x02014b50, 0);
      cdh.writeUInt16LE(20, 6);
      cdh.writeUInt16LE(8, 10);
      cdh.writeUInt32LE(0, 16);
      cdh.writeUInt32LE(deflated.length, 20);
      cdh.writeUInt32LE(raw.length, 24);
      cdh.writeUInt16LE(nameBuf.length, 28);
      cdh.writeUInt32LE(offset, 42);
      central.push(cdh, nameBuf);

      offset += lfh.length + nameBuf.length + deflated.length;
    }
    const cdBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(Object.keys(files).length, 8);
    eocd.writeUInt16LE(Object.keys(files).length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cdBuf, eocd]);
  }

  it('reads names and inflates bodies from a wheel-shaped zip', () => {
    const zip = makeZip({
      'wave_sdk/__init__.py': 'x = 1\n',
      'wave_sdk-2.0.0.dist-info/METADATA': 'Name: wave-sdk\nLicense: MIT\n',
      'wave_sdk-2.0.0.dist-info/licenses/LICENSE': MIT_TEXT,
    });
    const entries = readZip(zip);
    expect([...entries.keys()]).toContain('wave_sdk-2.0.0.dist-info/licenses/LICENSE');
    expect(entries.get('wave_sdk-2.0.0.dist-info/METADATA').toString('utf8')).toContain('License: MIT');
    expect(
      detectSpdxFromText(entries.get('wave_sdk-2.0.0.dist-info/licenses/LICENSE').toString('utf8'))
    ).toBe('MIT');
  });

  it('rejects a buffer that is not a zip instead of returning nothing', () => {
    expect(() => readZip(Buffer.from('not a zip at all'))).toThrow(/end-of-central-directory/);
  });
});

/* ── published-artifact verdicts + ledger rendering ────────────────────────── */

describe('artifactProblems', () => {
  it('flags the wave-av-sdk shape: metadata says MIT, source moved to Apache-2.0', () => {
    const problems = artifactProblems({
      declared: 'MIT',
      licenseFileInArtifact: true,
      licenseFileSpdx: 'Apache-2.0',
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('declares "MIT"');
    expect(problems[0]).toContain('Apache-2.0');
  });

  it('accepts an artifact whose metadata and file agree', () => {
    expect(
      artifactProblems({ declared: 'MIT', licenseFileInArtifact: true, licenseFileSpdx: 'MIT' })
    ).toEqual([]);
  });

  it('flags an artifact with no LICENSE file at all', () => {
    expect(
      artifactProblems({ declared: 'MIT', licenseFileInArtifact: false, licenseFileSpdx: UNKNOWN })
    ).toEqual(['no LICENSE file inside the published artifact']);
  });
});

describe('pyprojectLicense', () => {
  it('reads the PEP 621 table form used by wave-av/sdk-python', () => {
    expect(pyprojectLicense('[project]\nname = "wave-sdk"\nlicense = {text = "MIT"}\n')).toBe('MIT');
  });

  it('reads the PEP 639 string form used by wave-av/sdks', () => {
    expect(pyprojectLicense('[project]\nlicense = "Apache-2.0"\n')).toBe('Apache-2.0');
  });

  it('falls back to the trove classifier when there is no license key', () => {
    expect(
      pyprojectLicense('classifiers = [\n  "License :: OSI Approved :: Apache Software License",\n]')
    ).toBe('Apache Software');
  });

  it('returns UNKNOWN rather than guessing', () => {
    expect(pyprojectLicense('[project]\nname = "x"\n')).toBe(UNKNOWN);
  });
});

describe('sourceProblems', () => {
  it('flags the wave-av-sdk defect: PyPI 2.0.0 is MIT, source declares Apache-2.0', () => {
    const problems = sourceProblems(
      { declared: 'MIT', version: '2.0.0' },
      { available: true, declared: 'Apache-2.0', licensePath: 'sdk-python/LICENSE', licenseFileSpdx: 'Apache-2.0' }
    );
    expect(problems).toEqual(['published as "MIT" but source declares "Apache-2.0"']);
  });

  it('flags the sdk-python defect: pyproject says MIT, repo LICENSE is Apache-2.0', () => {
    const problems = sourceProblems(
      { declared: 'MIT', version: '2.0.0' },
      { available: true, declared: 'MIT', licensePath: 'LICENSE', licenseFileSpdx: 'Apache-2.0' }
    );
    expect(problems).toEqual([
      'source manifest says "MIT" but LICENSE is the Apache-2.0 text',
    ]);
  });

  it('reports BOTH when the artifact, the manifest and the file all disagree', () => {
    const problems = sourceProblems(
      { declared: 'MIT', version: '1.0.6' },
      {
        available: true,
        declared: 'Apache-2.0',
        licensePath: 'packages/workflow-sdk/LICENSE',
        licenseFileSpdx: 'MIT',
      }
    );
    expect(problems).toHaveLength(2);
  });

  it('stays silent when the artifact, the manifest and the file agree', () => {
    expect(
      sourceProblems(
        { declared: 'Apache-2.0', version: '2.1.3' },
        { available: true, declared: 'Apache-2.0', licensePath: 'LICENSE', licenseFileSpdx: 'Apache-2.0' }
      )
    ).toEqual([]);
  });

  it('reports nothing — never a pass — when the source could not be resolved', () => {
    expect(sourceProblems({ declared: 'MIT' }, { available: false, reason: 'no source recorded' })).toEqual([]);
  });
});

describe('URL construction', () => {
  it('escapes EVERY slash in a package name, not just the first', () => {
    expect(npmPackageUrl('@wave-av/cli')).toBe('https://registry.npmjs.org/@wave-av%2Fcli');
    expect(npmPackageUrl('chalk')).toBe('https://registry.npmjs.org/chalk');
  });

  it('refuses a package name that could reach a path this code did not intend', () => {
    for (const bad of ['@a/b/../../etc', '../../etc/passwd', '@a/b?x=1', 'a b', '', null]) {
      expect(() => npmPackageUrl(bad)).toThrow(/not a valid npm package name/);
    }
  });

  it('refuses a PyPI project name with path or query characters', () => {
    expect(pypiProjectUrl('wave-sdk')).toBe('https://pypi.org/pypi/wave-sdk/json');
    for (const bad of ['wave/sdk', '../wave', 'wave?x', '']) {
      expect(() => pypiProjectUrl(bad)).toThrow(/not a valid PyPI project name/);
    }
  });

  it('refuses a repo path that escapes the repository', () => {
    expect(rawGithubUrl('wave-av/sdks', 'sdk-python/pyproject.toml')).toBe(
      'https://raw.githubusercontent.com/wave-av/sdks/HEAD/sdk-python/pyproject.toml'
    );
    expect(() => rawGithubUrl('wave-av/sdks', '../secrets')).toThrow(/bad repo path/);
    expect(() => rawGithubUrl('wave-av/sdks', '/etc/passwd')).toThrow(/bad repo path/);
    expect(() => rawGithubUrl('not-a-slug', 'LICENSE')).toThrow(/bad repo slug/);
  });
});

describe('renderLedger', () => {
  it('marks a drifted row DRIFT and a clean row consistent', () => {
    const md = renderLedger({
      manifest: {
        intendedLicense: 'Apache-2.0',
        governingStatement: { repo: 'wave-av/cli', commit: '5da80189e5b1', subject: 's', body: 'b' },
      },
      rows: [
        {
          name: 'good',
          ecosystem: 'npm',
          version: '1.0.0',
          declared: 'Apache-2.0',
          licenseFileInArtifact: true,
          licenseFileSpdx: 'Apache-2.0',
          noticeFileInArtifact: true,
          source: 'wave-av/x:package.json',
          sourceTruth: { available: true, declared: 'Apache-2.0', licensePath: 'LICENSE', licenseFileSpdx: 'Apache-2.0' },
          problems: [],
        },
        {
          name: 'bad',
          ecosystem: 'pypi',
          version: '2.0.0',
          declared: 'MIT',
          licenseFileInArtifact: true,
          licenseFileSpdx: 'MIT',
          noticeFileInArtifact: false,
          source: 'wave-av/y:pyproject.toml',
          sourceTruth: { available: true, declared: 'Apache-2.0', licensePath: 'LICENSE', licenseFileSpdx: 'Apache-2.0' },
          problems: ['source declares Apache-2.0'],
        },
      ],
      local: auditRepo(ROOT),
      now: new Date('2026-09-03T00:00:00Z'),
    });
    expect(md).toContain('| `good` | npm | 1.0.0 | `Apache-2.0` | `Apache-2.0` | `Apache-2.0` | yes | consistent |');
    expect(md).toContain('**DRIFT** — source declares Apache-2.0');
    expect(md).toContain('Generated: 2026-09-03T00:00:00.000Z');
  });


  it('never calls an artifact consistent when its source could not be resolved', () => {
    const md = renderLedger({
      manifest: {
        intendedLicense: 'Apache-2.0',
        governingStatement: { repo: 'r', commit: 'abcdef1234', subject: 's', body: 'b' },
      },
      rows: [
        {
          name: 'orphan',
          ecosystem: 'npm',
          version: '1.0.9',
          declared: 'MIT',
          licenseFileInArtifact: true,
          licenseFileSpdx: 'MIT',
          noticeFileInArtifact: false,
          source: 'UNVERIFIED — no package.json found',
          sourceTruth: { available: false, reason: 'no source recorded' },
          problems: [],
        },
      ],
      local: auditRepo(ROOT),
    });
    expect(md).toContain('**unverified**');
    expect(md).not.toContain('| yes | consistent |');
  });

  it('renders a fetch failure as an explicit could-not-fetch row, never as a pass', () => {
    const md = renderLedger({
      manifest: {
        intendedLicense: 'Apache-2.0',
        governingStatement: { repo: 'r', commit: 'abcdef1234', subject: 's', body: 'b' },
      },
      rows: [{ name: 'offline-pkg', source: 'wave-av/z', error: 'GET ... -> 503' }],
      local: auditRepo(ROOT),
    });
    expect(md).toContain('**could not fetch**: GET ... -> 503');
  });
});
