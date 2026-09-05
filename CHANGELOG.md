# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Fixed
- **The package declared MIT while shipping the Apache-2.0 license text.** `package.json`
  said `"license": "MIT"` and the README's License section said MIT, but `LICENSE` has been
  the Apache-2.0 text since 5da8018 ("chore: adopt Apache-2.0 license + add NOTICE",
  2026-06-04). All four declarations — `package.json`, `README.md`, `package-lock.json` and
  the `LICENSE` file — now say Apache-2.0.
- **The Apache-2.0 `NOTICE` never reached the published tarball.** npm always includes
  `LICENSE` regardless of the `files` array, but not `NOTICE`; Apache-2.0 §4(d) requires
  redistributions to carry it. `NOTICE` (and `LICENSE`, explicitly) are now in `files`.
- The `[1.0.8]` entry below records "License changed to Apache-2.0, replacing MIT". That is
  true of the repository, not of the release: `@wave-av/cli@1.0.8` was published to npm on
  2026-04-03, two months before the Apache-2.0 adoption commit, and its tarball contains the
  MIT text with MIT metadata. Apache-2.0 has never been published for this package. The
  history is left as written; this note is the correction.

### Added
- `npm run license:check` — an offline gate that fails when any declared license disagrees
  with the license text actually in `LICENSE`, when `LICENSE`/`NOTICE` would not ship in the
  tarball, or when a runtime dependency carries strong copyleft. Wired into CI as
  `license-truth / local-truth`.
- `npm run license:ledger` — regenerates `LICENSE-LEDGER.md` by downloading every published
  WAVE npm tarball and PyPI wheel, reading the LICENSE inside it, and comparing all of it
  against what each source repository declares today. Runs weekly and on demand.
- `wave webhook-subscriptions list|create` — manage the platform's own event-subscription
  surface, distinct from `wave connect` third-party webhooks (#37).
- `wave identity resolve <identifier>` — resolve an agent identity through the fleet directory
  (#37).

## [1.0.9] - 2026-09-01

### Fixed

- **P0: every fresh install of `@wave-av/cli` was broken.** `npm i @wave-av/cli` (1.0.8)
  resolved `@wave-av/sdk` via `^2.0.11` → 2.1.2 (published 2026-08-28), and every invocation
  died before argv parsing with
  `node_modules/@wave-av/sdk/dist/chunk-VYLVDBON.mjs:73 ReferenceError: module is not defined
  in ES module scope`. Root cause lived in `@wave-av/sdk` (see its CHANGELOG / PR); this CLI
  is a downstream victim because it is itself `"type": "module"` and so always resolves the
  SDK's `"import"` export condition, which is exactly the code path the bug hit.
  Fix here: **pin `@wave-av/sdk` to `2.0.14`** (the last known-good published version) instead
  of the `^2.0.11` range that could resolve the broken 2.1.x line. `@wave-av/sdk@2.1.3` (the
  real fix) is not yet published to npm as of this change — once it is, bump this pin to
  `^2.1.3` in a follow-up so installs pick up the fixed SDK build going forward instead of
  staying pinned to 2.0.14 indefinitely.
- `wave --version` printed a hardcoded `"1.0.0"` regardless of the actually-installed/published
  version. Now reads it from package.json at runtime (`node:module`'s `createRequire`), so it
  always matches what's on npm.
- `wave doctor`, `wave status`, and `wave auth status` always exited `0`, even when a check
  failed or the user wasn't authenticated — scripts/agents parsing the exit code had no way to
  detect a broken setup without scraping colored text. All three now set `process.exitCode = 1`
  when a check fails / the user is unauthenticated (`wave whoami` already did the right thing —
  `process.exit(1)` — that behavior is unchanged, just hardened with an explicit `return` after
  each exit call so it can't fall through in a way a test harness — or a future refactor that
  swaps `process.exit` for `process.exitCode` — could accidentally continue past).
- `wave status` health-checked `https://wave.online` (the marketing site) at `/api/health`
  (404) instead of the actual API host `https://api.wave.online` at `/health` (200; verified
  live: `curl -s -o /dev/null -w '%{http_code}' https://api.wave.online/health` → `200`). This
  made the health check either always fail (wave.online doesn't serve `/api/health`) or, worse,
  silently "pass" against the wrong host if the marketing site ever returns 200 for unknown
  paths. Also fixed the same wrong-default-host bug in `wave auth login`'s device-authorization
  flow and `wave whoami`'s `/api/v1/me` call, both of which fell back to the marketing site
  when no project-specific `baseUrl` was configured.
- No separate "apex"/marketing-site check was added alongside the API health check — there
  wasn't one before this fix either; the single check now just targets the correct host.

### Release note

Publishing `@wave-av/cli@1.0.9` to npm is a separate, manual operator step. This change does
not run `npm publish`. **Publish order matters less now** since this release pins the SDK to
the already-published, working `2.0.14` rather than depending on the not-yet-published SDK fix.

## [1.0.8] - 2026-08-04
### Changed
- License changed to Apache-2.0, replacing MIT. Adds a NOTICE reserving the WAVE trademarks. No
  code or API changes (#5).
- Repository history now contains the source for this version, rebuilt byte-identically from the
  sourcemaps shipped in the published npm tarball (#18). Versions 1.0.1 through 1.0.7 were
  published to the npm registry between 2026-04-02 and 2026-04-03 but were never committed to
  this repository, so they have no individually dated section here; their recovered source
  landed in this same commit.

## [1.0.0] - 2026-04-05
### Added
- Initial public repository: README, LICENSE (MIT at the time), SECURITY.md.
### Fixed
- Corrected legal entity name to WAVE Online, LLC.

[Unreleased]: https://github.com/wave-av/cli/compare/v1.0.9...HEAD
[1.0.9]: https://github.com/wave-av/cli/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/wave-av/cli/compare/v1.0.0...v1.0.8
[1.0.0]: https://github.com/wave-av/cli/releases/tag/v1.0.0
