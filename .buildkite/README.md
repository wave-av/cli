# @wave-av/cli on Buildkite

This directory runs the CLI's pull-request and push checks on Buildkite.

## Steps

The two leak guards run first. Each is followed by a `wait` barrier, so every other step starts only
after both guards pass.

| step key | mirrors (GitHub workflow / job) | queue | credential |
|---|---|---|---|
| `guard-gitleaks` | public-repo-guard.yml `gitleaks` steps (pinned gitleaks 8.30.1, checksum-verified) | `fpc-isolated` | none |
| `guard-content-policy` | public-repo-guard.yml `content policy` step, without the private-repo rule; non-pull-request builds of any branch | `fpc-isolated` | none |
| `guard-content-policy-pr` | the same step on pull-request builds, without the private-repo rule | `fpc-isolated` | none |
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
  default branch's copy, and the scan uses the default branch's `.gitleaks.toml`. The trusted copy
  always comes from the pipeline's default branch, never from the base the pull request targets
  (the author picks that), and it is fetched explicitly on every such build (Buildkite's checkout
  does not refresh it), so a stale or absent remote-tracking ref is never trusted. A missing or
  invalid default branch name, a fetch failure, or a default branch without the guard script fails
  closed (exit 2). The scan reads none of the tree's own escape hatches: it runs on a copy with
  every `.gitleaksignore` and `.gitleaks.toml` removed, with the default branch's config passed
  explicitly, `--ignore-gitleaks-allow`, and an empty ignore file. The same trusted path covers
  pushes to any branch other than the default branch. The first pull request that adds this guard therefore fails `guard-gitleaks` by
  design; it passes once the guard is on the default branch.
- **content policy.** Runs the vendored `scripts/public-repo-guard/content-policy.sh` with the same
  public-safe rule set on every build: every rule except private-repo. The private-repo rule needs
  a confidential list, and this public repository's builds never receive one, by design. If any
  form of that list is present in a job, the step fails closed (exit 2). Non-pull-request builds
  (`guard-content-policy`) run this checkout's policy. On a
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
- **Content policy without the private-repo rule, on every build.** GitHub ran the private-repo rule
  with an org-level list. This public repository's Buildkite builds never receive that list, by
  design, so the rule does not run here at all. A private name is not caught by this pipeline;
  the other content-policy rules, gitleaks and the foundation secret scan still run.
- **No `governance-enforce`.** See "Not in this pipeline" below.
- **Not mirrored yet:** the content-policy fixture self-test step of `public-repo-guard.yml`, and
  `public-repo-guard-body.yml` (the pull-request body scan). Both block retiring
  `public-repo-guard.yml`.
## Not in this pipeline

- **`governance-enforce`** (governance-enforce.yml `enforce`, secrets and hardcoded paths on the
  diff). Its enforcer, `@wave-av/governance`, is a private package. The self-hosted registry it
  lives on refuses anonymous reads, and the CI host gives this public repository no token, by
  standing decision. So no build of this pipeline can install it, and a step for it could only fail
  closed. It is left out of the step list rather than left red. `.buildkite/scripts/governance-enforce.sh`
  stays in the repository for local and manual runs. The GitHub Actions copy has not run since the
  Actions billing lock, so no running coverage is lost. On Buildkite, diffs are still covered by
  `guard-gitleaks`, the content policy and `foundation-secret-scan`; hardcoded developer paths are
  covered by the content policy's `abs-user-path` rule.

## Credentials

None. No step in this pipeline receives a secret on any build, and none is in this repository or
in the pipeline file. The content-policy steps fail closed if the private-repo list
(`GUARD_PRIVATE_REPOS`, `GUARD_PRIVATE_REPOS_01`..`_06`) is present in a job.

## Host-side setup

The CI host injects secrets only into jobs it trusts, and it reads each job's identity from the
Buildkite API, never from the job. A pull request controls `pipeline.yml` and every script here,
so nothing in this repository can be a secrets boundary. That is why this pipeline is written to
need no secret at all. The host's allowlist has no entry for this public repository, by standing
decision.

Outside `pipeline.yml`:

- A Buildkite pipeline for this repository whose only settings step runs
  `.buildkite/scripts/upload.sh`, with pull-request builds and commit statuses on.
- A repository webhook for `push` and `pull_request` events that points at that pipeline.
- **Build pull requests from forks** off.

## Build-image prerequisites

Node 22 with npm, `bash`, `git`, `grep`, `sed`, `find`, `curl`, `sha256sum`, `tar`, ripgrep (`rg`)
built with PCRE2 (`rg --pcre2-version` must succeed; the content policy uses `rg -P` and fails
closed without it), and `python3` with PyYAML (`python3 -c 'import yaml'` must succeed;
`foundation-skill-validate` needs it once the repo has a `SKILL.md` and never installs it at run
time). Network access to `registry.npmjs.org` and `github.com` (gitleaks release download).

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
