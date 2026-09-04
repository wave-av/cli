/**
 * The online half: what the REGISTRIES actually serve. A repo can be perfectly consistent
 * and still have a published artifact that contradicts it — @wave-av/cli@1.0.8 (MIT) was
 * published on 2026-04-03, two months before the repo adopted Apache-2.0, and nothing in
 * the repo can tell you that. Only the registry can.
 *
 * Every function here downloads the REAL artifact and reads the license file inside it,
 * because registry metadata is a claim and the tarball is the evidence.
 */
import { readTarGz, readZip } from './archive.mjs';
import { detectSpdxFromText, UNKNOWN } from './spdx.mjs';

const NPM_REGISTRY = 'https://registry.npmjs.org';
const PYPI = 'https://pypi.org/pypi';

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json();
}

async function getBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Inspect the latest published version of an npm package.
 * Always talks to registry.npmjs.org explicitly — a scoped `.npmrc` entry pointing
 * @wave-av at GitHub Packages otherwise silently answers 404 for the public package.
 * @param {string} name
 */
export async function inspectNpm(name) {
  const doc = await getJson(`${NPM_REGISTRY}/${name.replace('/', '%2F')}`);
  const version = doc['dist-tags']?.latest;
  const manifest = doc.versions?.[version];
  if (!manifest) throw new Error(`${name}: no latest version in registry document`);

  const tgz = await getBuffer(manifest.dist.tarball);
  const entries = readTarGz(tgz);
  const paths = [...entries.keys()];
  const licenseEntry = paths.find((p) => /^package\/LICEN[SC]E(\.[a-z]+)?$/i.test(p));
  const noticeEntry = paths.find((p) => /^package\/NOTICE(\.[a-z]+)?$/i.test(p));

  return {
    ecosystem: 'npm',
    name,
    version,
    declared: typeof manifest.license === 'string' ? manifest.license : UNKNOWN,
    publishedAt: doc.time?.[version] ?? null,
    licenseFileInArtifact: Boolean(licenseEntry),
    licenseFileSpdx: licenseEntry
      ? detectSpdxFromText(entries.get(licenseEntry).toString('utf8'))
      : UNKNOWN,
    noticeFileInArtifact: Boolean(noticeEntry),
    repository: manifest.repository?.url ?? null,
    description: manifest.description ?? null,
  };
}

/**
 * Inspect the latest published version of a PyPI package (wheel preferred, sdist fallback).
 * @param {string} name
 */
export async function inspectPyPI(name) {
  const doc = await getJson(`${PYPI}/${name}/json`);
  const info = doc.info ?? {};
  const wheel = (doc.urls ?? []).find((u) => u.packagetype === 'bdist_wheel');
  const licenseClassifier =
    (info.classifiers ?? []).find((c) => c.startsWith('License ::')) ?? null;

  let licenseFileInArtifact = false;
  let licenseFileSpdx = UNKNOWN;
  let noticeFileInArtifact = false;

  if (wheel) {
    const entries = readZip(await getBuffer(wheel.url));
    const paths = [...entries.keys()];
    const licensePath = paths.find((p) => /\.dist-info\/(licenses\/)?LICEN[SC]E/i.test(p));
    noticeFileInArtifact = paths.some((p) => /\.dist-info\/(licenses\/)?NOTICE/i.test(p));
    if (licensePath) {
      licenseFileInArtifact = true;
      licenseFileSpdx = detectSpdxFromText(entries.get(licensePath).toString('utf8'));
    }
  }

  return {
    ecosystem: 'pypi',
    name,
    version: info.version ?? null,
    // PEP 639 moved the identifier to License-Expression; older wheels still use License.
    declared: info.license_expression || info.license || UNKNOWN,
    declaredClassifier: licenseClassifier,
    publishedAt: wheel?.upload_time_iso_8601 ?? null,
    licenseFileInArtifact,
    licenseFileSpdx,
    noticeFileInArtifact,
    repository: info.project_urls?.Repository ?? null,
    description: info.summary ?? null,
  };
}

/**
 * A published artifact is INCONSISTENT when the identifier it declares is not the license
 * whose text it actually ships.
 * @param {{declared:string, licenseFileInArtifact:boolean, licenseFileSpdx:string}} row
 */
export function artifactProblems(row) {
  const out = [];
  if (!row.licenseFileInArtifact) {
    out.push('no LICENSE file inside the published artifact');
  } else if (row.licenseFileSpdx === UNKNOWN) {
    out.push('LICENSE file inside the artifact is unrecognizable');
  } else if (normalize(row.declared) !== normalize(row.licenseFileSpdx)) {
    out.push(
      `declares "${row.declared}" but ships the ${row.licenseFileSpdx} text`
    );
  }
  return out;
}

function normalize(id) {
  return String(id ?? '').trim().toLowerCase();
}

/* ── source of truth ───────────────────────────────────────────────────────── */

/**
 * Read what a package's SOURCE repository declares, straight off its default branch.
 *
 * This is the column that actually exposed LEGAL-001. Every published WAVE artifact is
 * internally consistent — its metadata matches the LICENSE file beside it — so comparing
 * an artifact to itself finds nothing. The contradiction is between the artifact and the
 * repo it claims to come from: wave-av-sdk 2.0.0 is on PyPI as MIT while
 * wave-av/sdks:sdk-python/pyproject.toml declares Apache-2.0 at the SAME version string.
 *
 * @param {string} spec "<owner>/<repo>:<path-to-manifest>", or free text when unknown.
 */
export async function inspectSource(spec) {
  if (typeof spec !== 'string' || !/^[\w.-]+\/[\w.-]+:/.test(spec)) {
    return { available: false, reason: spec || 'no source recorded' };
  }
  const [repo, path] = [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)];
  const raw = (p) => `https://raw.githubusercontent.com/${repo}/HEAD/${p}`;

  try {
    const manifest = await getText(raw(path));
    const declared = path.endsWith('.json')
      ? JSON.parse(manifest).license ?? UNKNOWN
      : pyprojectLicense(manifest);

    // The LICENSE that governs a nested package is the one beside it, if there is one;
    // otherwise the repository root's.
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    let licensePath = dir ? `${dir}/LICENSE` : 'LICENSE';
    let text = await getTextOrNull(raw(licensePath));
    if (text === null && dir) {
      licensePath = 'LICENSE';
      text = await getTextOrNull(raw(licensePath));
    }

    return {
      available: true,
      repo,
      path,
      declared: typeof declared === 'string' ? declared : declared?.text ?? UNKNOWN,
      licensePath: text === null ? null : licensePath,
      licenseFileSpdx: detectSpdxFromText(text),
    };
  } catch (err) {
    return { available: false, reason: String(err.message) };
  }
}

/**
 * Pull the identifier out of a pyproject's `[project]` table. Handles both the PEP 621
 * table form (`license = {text = "MIT"}`) and the PEP 639 string form (`license = "MIT"`),
 * which is exactly the pair that drifted between wave-av/sdk-python and wave-av/sdks.
 * @param {string} toml
 */
export function pyprojectLicense(toml) {
  const table = toml.match(/^\s*license\s*=\s*\{[^}]*text\s*=\s*["']([^"']+)["']/m);
  if (table) return table[1];
  const str = toml.match(/^\s*license\s*=\s*["']([^"']+)["']/m);
  if (str) return str[1];
  const classifier = toml.match(/License :: OSI Approved :: ([^"']+?) License/);
  return classifier ? classifier[1] : UNKNOWN;
}

/**
 * A published artifact has DRIFTED when it does not carry the license its source repository
 * declares today — the defect that no amount of inspecting the artifact alone can reveal.
 * @param {{declared:string, version:string|null}} artifact
 * @param {{available:boolean, declared?:string, licenseFileSpdx?:string, licensePath?:string|null}} source
 */
export function sourceProblems(artifact, source) {
  if (!source?.available) return [];
  const out = [];
  if (normalize(artifact.declared) !== normalize(source.declared)) {
    out.push(
      `published as "${artifact.declared}" but source declares "${source.declared}"`
    );
  }
  if (
    source.licenseFileSpdx &&
    source.licenseFileSpdx !== UNKNOWN &&
    normalize(source.declared) !== normalize(source.licenseFileSpdx)
  ) {
    out.push(
      `source manifest says "${source.declared}" but ${source.licensePath} is the ` +
        `${source.licenseFileSpdx} text`
    );
  }
  return out;
}

async function getText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.text();
}

async function getTextOrNull(url) {
  const res = await fetch(url);
  return res.ok ? res.text() : null;
}
