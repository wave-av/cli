# @wave-av/cli on Buildkite

This directory runs the CLI's pull-request and push checks on Buildkite.

## Steps

The two leak guards run first. Each is followed by a `wait` barrier, so every other step starts only
after both guards pass.

| step key | mirrors (GitHub workflow / job) | queue | credential |
|---|---|---|---|
| `guard-gitleaks` | public-repo-guard.yml `gitleaks` steps (pinned gitleaks 8.30.1, checksum-verified) | `fpc-isolated` | none |
| `guard-content-policy` | public-repo-guard.yml `content policy` step; builds that are not pull requests | `fpc-isolated-secrets` | `GUARD_PRIVATE_REPOS` (or `GUARD_PRIVATE_REPOS_01`..`_06`) |
| `guard-content-policy-pr` | the same step on pull-request builds, without the private-repo rule | `fpc-isolated` | none |
| `governance-enforce` | governance-enforce.yml `enforce` | `fpc-isolated-secrets` | `NODE_AUTH_TOKEN` (GitHub Packages read, for `@wave-av/governance`) |
| `unit` | smoke-install.yml `unit` (type-check, build, unit tests) | `fpc-isolated` | none |
| `smoke` | smoke-install.yml `smoke` (pack, fresh install, version and banner check) | `fpc-isolated` | none |
| `license-truth` | license-truth.yml `local-truth` | `fpc-isolated` | none |
| `foundation-secret-scan` | foundation-gate.yml → `_checks.yml` `checks`, secret-scan step | `fpc-isolated` | none |
| `foundation-file-size` | foundation-gate.yml → `_checks.yml` `checks`, file-size gate (800 lines) | `fpc-isolated` | none |
| `foundation-skill-validate` | foundation-gate.yml → `_checks.yml` `skill-validate` (no-op: no `SKILL.md`) | `fpc-isolated` | none |
| `foundation-verify-routes` | foundation-gate.yml → `_checks.yml` `verify-routes` (no-op: no `wrangler.toml`) | `fpc-isolated` | none |

Each step's `command` is a single checked-in script with no arguments, because the build agents run
with `no-command-eval`. The pipeline uses no plugins and has no secret values in `env`. The only
`env` a step sets is the non-secret `WAVE_JOB_GUARD_PR=1` on `guard-content-policy-pr`.

`.buildkite/scripts/upload.sh` refuses (exit 2) to upload a `pipeline.yml` that lacks
`guard-gitleaks`, `guard-content-policy` or `guard-content-policy-pr`.

## The leak guards

- **gitleaks.** On a pull-request build the PR's copy of `guard-gitleaks.sh` re-executes the
  base branch's copy, and the scan uses the base branch's `.gitleaks.toml`. The base branch is
  fetched explicitly on every pull-request build (Buildkite's checkout does not refresh it), so a
  stale or absent remote-tracking ref is never trusted. A missing or invalid base branch name, a
  base that cannot be fetched, or a base without the guard script fails closed (exit 2). The first
  pull request that adds this guard therefore fails `guard-gitleaks` by design; it passes once the
  guard is on the default branch.
- **content policy.** Runs the vendored `scripts/public-repo-guard/content-policy.sh`. Builds that
  are not pull requests need the private-repo list from the host and fail closed without it. On a
  pull-request build, `guard-content-policy-pr` runs the default branch's policy and `.guardignore`
  against a copy of the PR tree, ignores inline `# guard:allow` markers and the copy's `.ignore`,
  `.rgignore` and `.gitignore` files, and logs that the private-repo rule was not checked. A pull
  request from a fork is refused (exit 2).

## Differences from the GitHub workflows

- **One Node version for `smoke`.** GitHub ran the smoke install on Node 20 and 22. Here it runs on
  the build image's Node 22.
- **No live reachability check.** The `wave status` / `wave doctor` step needs an API key. It is
  not part of this pipeline.
- **Not included:** the scheduled `registry-drift` job, the release workflows, and the bots that
  GitHub triggers on events (issue triage, PR-body checks).
- **Pull-request content policy without the private-repo rule.** GitHub ran the private-repo rule on
  pull requests too. Here pull-request builds do not receive the list; the rule runs on every build
  of the default branch.
- **Push diff base for `governance-enforce`.** GitHub diffed a push against the push's `before` sha.
  Buildkite does not provide one, so push builds diff against the first parent (`HEAD^1`). For a
  merge commit, that covers the whole merged branch. A direct push of several non-merge commits
  would have only its last commit scanned. PR builds diff against the merge-base with the target
  branch. If no base resolves, the step scans the full tree.

## Credentials

Values are injected by the host, by step key, on the `fpc-isolated-secrets` queue only. None is in
this repository or in the pipeline file.

- `governance-enforce`: `NODE_AUTH_TOKEN`. The script moves it into a non-exported shell variable
  before anything else runs. It hands the token to the single `npm install` of the enforcer through
  a job-local npmrc placeholder, so the token is never written to disk or printed. The install runs
  with `--ignore-scripts`. Builds of pull requests from forks never receive it.
- `guard-content-policy`: `GUARD_PRIVATE_REPOS`, or all six of `GUARD_PRIVATE_REPOS_01`..`_06` when
  the host channel caps a value at 512 bytes. A missing or blank value fails closed.

## Host-side setup

Not expressible in `pipeline.yml`:

- A Buildkite pipeline for this repository whose only settings step runs
  `.buildkite/scripts/upload.sh` on `fpc-isolated`, with commit statuses on.
- A repository webhook for `push` and `pull_request` events that points at that pipeline.
- **Build pull requests from forks** off.
- The host injection above, granted to the step keys `governance-enforce` and
  `guard-content-policy` only.

## Build-image prerequisites

Node 22 with npm, `bash`, `git`, `grep`, `sed`, `find`, `curl`, `sha256sum`, `tar`, ripgrep (`rg`),
and `python3`. Network access to `registry.npmjs.org` and `github.com` (gitleaks release download),
plus `npm.pkg.github.com` for `governance-enforce`.

## Run locally

```sh
shellcheck -x .buildkite/scripts/*.sh .buildkite/scripts/lib/*.sh
.buildkite/scripts/unit.sh
.buildkite/scripts/smoke.sh
.buildkite/scripts/license-truth.sh
.buildkite/scripts/foundation-secret-scan.sh
.buildkite/scripts/foundation-file-size.sh
.buildkite/scripts/foundation-skill-validate.sh
.buildkite/scripts/foundation-verify-routes.sh
bash scripts/public-repo-guard/content-policy.sh .
```
