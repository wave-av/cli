# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Authentication works end to end again.** In 1.0.10 no customer could store a credential:
  - `wave auth login --api-key` and `wave auth logout` crashed with `keytar.setPassword is not a
    function`. keytar is CommonJS; under Node ESM `await import("keytar")` exposes only
    `getPassword` as a named export and the full API on `.default`. The loader now takes
    `.default` when it is complete. When keytar cannot load at all it falls back to
    `~/.wave/credentials.json` (mode 0600) and says so once on stderr; `WAVE_CREDENTIAL_STORE=file`
    selects the file explicitly. A keytar that loads without its full API is refused with an
    error instead of silently degrading to the file.
  - The credentials file and `~/.wave/config.json` are updated under an inter-process lock and
    written atomically, so two `wave` processes (a token refresh and a login to another project)
    cannot drop each other's change. A config or credentials file that does not parse is
    reported (config: exit 9) and left untouched; earlier versions overwrote it with defaults,
    erasing every saved project. Reading a missing config no longer creates one.
  - `wave auth login --api-key-stdin` reads the key from a pipe, keeping it out of the process
    list and shell history. Logging in again clears the organization cached for the project.
  - `wave auth login` (device flow) called `/api/oauth/device/authorize|token`, which the API
    answers 404 `ROUTE_NOT_FOUND`. It now uses the SDK's agent-auth ceremony on
    `POST /v1/agent/auth/device` and `/v1/agent/auth/token`, stores the refresh token, and
    refreshes an expired access token before use. A refused refresh sends the old token (the
    API's 401 then says to log in again); a network failure past expiry, or a refreshed token
    that cannot be saved, is reported instead of being swallowed. `--no-browser` prints the URL
    only, and the browser is opened only for a verification page on the API host.
  - `auth login` now writes the project entry that every API command reads. 1.0.10 stored a key
    and then refused to use it: `No project "default" configured`.
  - `wave login` / `wave logout` exist as aliases (README, `wave doctor` and error hints all
    told users to run `wave login`, which answered `unknown command 'login'`). The
    `--project-name` flag the README documented never existed; use the global `--project`.
  - Keychain calls are bounded (60s, `WAVE_KEYCHAIN_TIMEOUT_MS` overrides). A locked macOS login
    keychain that nobody can unlock (locked screen, headless session) made `auth login --api-key`
    hang with no output. It now fails with what to do instead (`WAVE_API_KEY`, or
    `WAVE_CREDENTIAL_STORE=file`) and exits 137: Node cannot exit normally while the native
    keychain call is still blocked. `wave doctor` no longer reads the keychain when
    `WAVE_API_KEY` is set.
- **One credential and host resolution for every command** (`WAVE_API_KEY`, then the stored key;
  `WAVE_BASE_URL`, then the project's `baseUrl`, then `https://api.wave.online`). `whoami`,
  `auth status`, `status`, `api`, `billing` and `link` read the keychain only, so CI users with
  `WAVE_API_KEY` were told "Not authenticated".
- The API host must be `https://` (`http://` only for localhost): a `WAVE_BASE_URL` or saved
  `baseUrl` that would send the key or a refresh token in cleartext is refused with exit 9.
- `--org` now reaches every command, including the raw-route ones (billing, analytics,
  identity, webhook subscriptions, `wave api`). Order: `--org`, then `WAVE_ORG_ID`, then the
  saved org.
- `wave whoami` called `/api/v1/me` (404). It now calls `GET /v1/me`; when the key lacks
  `me:read` it still reports the organization (from `GET /v1/billing`) and says why the profile
  is missing. When the key cannot read billing either, `organizationUnavailable` says so;
  any other failure of that fallback (401, 5xx) is an error, not a partial identity. Text
  from the API is stripped of terminal control sequences before it is printed. `whoami -o json` and `status -o json` now print exactly one JSON document (1.0.10
  printed the human block first, so piping to `jq` failed).
- A missing credential now exits 2 (`AUTH_REQUIRED`, the documented code) from every command,
  including `wave auth status`, with the structured error under `-o json`. 1.0.10 exited 1 with
  `No project "default" configured`.
- `wave billing status|usage` called `https://wave.online/api/billing/*` (the marketing site,
  404 on every path). They now call `GET /v1/billing` and `GET /v1/billing/usage` on the API
  host. `invoices`, `limits`, `portal` and `upgrade` have no API route yet and say so without
  sending a request.
- `wave api` defaulted to `https://wave.online` and ignored `WAVE_API_KEY`. It now targets the
  API host, and refuses to send your credential to an absolute URL on a different origin. On
  failure it still prints the response, and exits with the shared codes (2, 7, 11 for an
  unserved route) instead of a blanket 1.
- `wave identity resolve` sent `POST` with a body; the served route is
  `GET /v1/identity/resolve?agent=<id>`. Errors from raw API calls (identity, webhook
  subscriptions, billing, analytics) now honor `-o json` and keep the gateway's code and
  message when the body is flat (`{"error":"...","code":"...","message":"..."}`) instead of
  reporting a bare `HTTP_4xx`. SDK-backed commands need the matching `@wave-av/sdk` parser fix.
- `wave link` no longer depends on `GET /v1/organizations` and `/v1/projects` (neither is
  served). It records the organization the key acts for (asked without the previously saved
  org header, so a project relinks cleanly after a key change), and exits non-zero when
  unauthenticated.
- `wave init` scaffolded an empty project: templates were looked up three directories above the
  bundled `dist/index.js`, missed, and silently replaced by an empty `src/`. Templates now
  resolve from the package root (or the command fails loudly), `blank`, `multi-camera` and
  `podcast` are selectable, and the generated `wave.config.ts` no longer imports a
  `defineConfig` the SDK does not export. Generated projects get a `tsconfig.json` and
  `@types/node`, so `npm run build` works (no template shipped a tsconfig).
- Every template depended on `@wave/sdk`, a package that does not exist on npm, so
  `npm install` in a generated project failed. They now depend on `@wave-av/sdk`, and the
  `blank` and `api-integration` templates call served routes. Every offered template now
  type-checks against `@wave-av/sdk` 2.1.3 (`multi-camera` and `podcast` used field names the SDK
  does not have); templates whose routes are not confirmed served are labelled preview.
  `webhook-handler` and `studio-plugin` are removed from the package: they called
  `wave.webhooks.verify` and `wave.studio.registerPlugin`, which the SDK does not provide, and
  `--template` says so.
- Commands whose route the API does not serve (`ROUTE_NOT_FOUND` / `ROUTE_NOT_MAPPED`) now say
  so and exit 11 instead of printing a plain 404. `wave logs tail`, `listen`, `trigger`, `dev`,
  `admin jobs`, `mesh status` and `mesh regions` targeted routes that do not exist and now stop
  before sending anything.
- `package.json` `homepage` pointed at `https://docs.wave.online/cli` (404); it is now the live
  CLI reference, `https://docs.wave.online/docs/cli`.
- `scripts/smoke/live-connectivity.mjs` (`npm run smoke:live`) drives the built or installed CLI
  against the live API (GET only, a throwaway HOME, the file credential store) and checks a body
  marker for every path above, after first confirming two known-served control routes.
  `--device` also runs `wave auth login --no-browser` against the live device-flow routes.

- `pr-agent` lane: fork-triggered `/` commands are now refused, and the AI
  call's budget fits inside its step. Three defects, one of them only visible
  once the first was fixed.

  The job-level `if:` refused forks on the `pull_request` arm and could not on
  `issue_comment` — fork status is absent from that payload, so there was never
  an expression to write. A `fork gate` step now asks the pulls endpoint and
  fails closed: only a literal `false` proceeds, so a 404, a rate limit or a
  deleted fork all skip. The lane runs no `actions/checkout`, so fork code was
  never executed and no exfiltration path existed; what this closes is the
  comment claiming forks were already skipped, which was true of one arm only.

  `CONFIG__AI_TIMEOUT` was 600s inside a 360s step, so the runner killed the
  step before pr-agent could reach its own timeout or fall back to a secondary
  model. Now 300s.

  Fixing the first exposed a third: `stamp attempt 2 end` runs under
  `if: always()`, so when attempt 2 never ran the verdict subtracted from zero
  and reported a 1787580408-second attempt as a confident TIMED OUT.

  Contributors on forks are affected: a maintainer's `/review` on a fork PR is
  now declined with a warning rather than silently running.
  (wave-av/wave-foundation-public#73)

### Added
- `wave analytics overview|engagement|top-content` call the served `GET /v1/analytics/*`
  routes; `wave billing usage` takes `--from/--to`.
- **`wave compose "<intent>"`** calls `POST /v1/compose` through the existing `getClient()` /
  auth / error plumbing (no new HTTP stack) and prints a markdown rendering of the proposal:
  stages with their `why` lines, scopes with `mintable` flags, price rows (a `usd` amount only
  when the row was actually quoted, the literal `quote at call time` otherwise), and the
  `callShape.http` curl. `--json` prints the raw response object instead. `--flow <id>` sends
  `flowId` to re-propose a saved flow. `--budget <usd>` sends `budgetUsd`, validated as a
  non-negative number before any network call. The command never calls a product route; the
  proposal's own `executes` field is always `false` and is never derived or overridden here.
  `--save` does not itself call the console flows route (`POST /api/console/flows`): that route
  is session-cookie only today and there is no CLI/SDK machine-auth token yet, so `--save` prints
  the exact request a signed-in human can paste into their own console session instead of
  silently no-oping. Types are a local structural mirror of the gateway's wire contract (not yet
  exported by `@wave-av/sdk`); `compose` is registered in `capabilities.json`.

## [1.0.10] - 2026-09-06

### Fixed
- **`@wave-av/sdk` bumped from the exact pin `2.0.14` to `2.1.3`.** The `[1.0.9]` entry below
  pinned to `2.0.14` as a stopgap because `2.1.3` — "the real fix" for the SDK's ESM
  `module is not defined` bug — was not yet published to npm at the time. It is now published
  (`npm view @wave-av/sdk versions --registry=https://registry.npmjs.org` includes `2.1.3`),
  so this follow-up (explicitly promised in the `[1.0.9]` note below) lands: the pin moves to
  the exact version `2.1.3` (same exact-pin convention as before — a caret range is what
  resolved to the broken `2.1.x` build in the first place) and `package-lock.json` is
  regenerated to match. `src/` required no changes: it already type-checks cleanly against
  the SDK's stable flat-method API surface (`client.audience.createPoll`, etc.) on both
  `2.0.14` and `2.1.3`.
- **Release run 34008716210 (`workflow_dispatch -f tag=v1.0.9`) failed `tsc --noEmit` with
  ~140 TS2339/TS2551 errors** (`StudioAIAPI.start`, `PulseAPI.viewers`,
  `AudienceAPI.polls`, etc.). Root cause: the `v1.0.9` git tag points at commit `5fe08f40d`,
  which predates nine `fix(commands): reconcile ... against the real SDK surface` commits
  that landed on `main` *after* the tag was cut — those commits fixed every one of these
  command files but nobody bumped `package.json`'s version (it stayed `"1.0.9"` through all
  of them). `main`'s current tree already type-checks clean (verified locally); the tag's
  frozen tree does not and cannot be made to, short of moving the tag (not done here — tags
  are never moved). **`v1.0.9` cannot be successfully backfilled.** This release bumps the
  version to `1.0.10` specifically so a *new* tag can be cut from this merge commit (or
  later) and backfilled/published instead — see `.github/workflows/_release-publish.yml`'s
  `Verify tag matches package.json version` step, which refuses to publish any tag whose
  name disagrees with `package.json`'s version.

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
