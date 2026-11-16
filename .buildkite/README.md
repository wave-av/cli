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
| `governance-enforce` | governance-enforce.yml `enforce`; non-pull-request builds of the default branch only | `fpc-isolated-secrets` | `NODE_AUTH_TOKEN` (package registry read, for `@wave-av/governance`) |
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
  closed (exit 2). The first pull request that adds this guard therefore fails `guard-gitleaks` by
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
- **`governance-enforce` is skipped off the default branch.** It takes a host-injected value, and
  every step's command is checkout code, so on a pull request or a non-default branch the author
  controls it. Its `if:` skips it there, which only prevents accidental exposure: a pull request
  can delete it. The secrets boundary is the host (see "Host-side setup").
- **Not mirrored yet:** the content-policy fixture self-test step of `public-repo-guard.yml`, and
  `public-repo-guard-body.yml` (the pull-request body scan). Both block retiring
  `public-repo-guard.yml`.
- **Push diff base for `governance-enforce`.** GitHub diffed a push against the push's `before` sha.
  Buildkite does not provide one, so push builds diff against the first parent (`HEAD^1`). For a
  merge commit, that covers the whole merged branch. A direct push of several non-merge commits
  would have only its last commit scanned. (The script's pull-request branch, a diff against the
  merge-base with the target branch, now runs only locally or by hand.) If no base resolves, the
  step scans the full tree.

## Credentials

Only the CI host injects values, per step key. None is in this repository or in the pipeline file,
and nothing in a job's checkout or environment decides whether a job gets one (see "Host-side
setup").

- `governance-enforce`: a package-registry read token (`NODE_AUTH_TOKEN` in this script). The
  script moves it into a non-exported shell variable before anything else runs. It hands the token
  to the single `npm install` of the enforcer through a job-local npmrc placeholder, so the token
  is never written to disk or printed. The install runs with `--ignore-scripts`. Without the token
  the step fails closed.
- `guard-content-policy` and `guard-content-policy-pr`: none. They never receive the private-repo
  list (`GUARD_PRIVATE_REPOS`, `GUARD_PRIVATE_REPOS_01`..`_06`); its presence fails closed.

## Host-side setup

The secrets boundary is on the CI host, not in this repository. A pull request controls
`pipeline.yml` and every script here, so nothing in them can be the boundary.

**What the host checks before it injects anything.** The host reads each job's identity from the
Buildkite API, never from the job. A job on the secret-bearing queue is refused before any secret
lookup unless all of these are true:

- the build is not a pull request;
- it has no tag;
- its branch is the pipeline's default branch;
- its source is a repository webhook (a scheduled build is admitted only for grants that allow
  schedules). Builds started by hand, through the API, or by a trigger step are refused.

A grant limited to the default branch (the kind this repository needs) also requires a webhook
push build whose commit the code host reports is on the default branch. Values come from a per
(pipeline, step key) allowlist kept on the host, never read from a job checkout. A step that is
not listed gets nothing.

**What the host grants this repository today: nothing.** The host allowlist has no entry for this
pipeline, and its policy says public repositories get none (a standing decision). It also grants
`NODE_AUTH_TOKEN` to no pipeline, so `governance-enforce` fails for lack of a token. The content
policy steps need nothing from the host. Where the host grants a registry read token to
`governance-enforce` for other pipelines, that grant is not limited to the default branch: it also
covers same-repository builds whose `.buildkite/` matches the default branch's.

**Required host-side changes, operator decision:**

- An explicit exception to the public-repository rule for `governance-enforce`, or a decision to
  keep it unfed.
- If granted, the registry read token for `governance-enforce` must be limited to default-branch
  push builds, not the broader policy that other pipelines use.

**Also outside `pipeline.yml`:**

- A Buildkite pipeline for this repository whose only settings step runs
  `.buildkite/scripts/upload.sh`, with pull-request builds and commit statuses on.
- A repository webhook for `push` and `pull_request` events that points at that pipeline.
- **Build pull requests from forks** off.

## Build-image prerequisites

Node 22 with npm, `bash`, `git`, `grep`, `sed`, `find`, `curl`, `sha256sum`, `tar`, ripgrep (`rg`)
built with PCRE2 (`rg --pcre2-version` must succeed; the content policy uses `rg -P` and fails
closed without it), and `python3` with PyYAML (`python3 -c 'import yaml'` must succeed;
`foundation-skill-validate` needs it once the repo has a `SKILL.md` and never installs it at run
time). Network access to `registry.npmjs.org` and `github.com` (gitleaks release download),
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
