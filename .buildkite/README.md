# @wave-av/cli on Buildkite

This directory runs the CLI's pull-request and push checks on Buildkite. The GitHub Actions workflows
under `.github/` are unchanged.

## Steps

| step key | mirrors (GitHub workflow / job) | credential |
|---|---|---|
| `governance-enforce` | governance-enforce.yml `enforce` | `WAVE_REGISTRY_READ_TOKEN` and `WAVE_REGISTRY_URL` (private registry read, for `@wave-av/governance`) |
| `unit` | smoke-install.yml `unit` (type-check, build, unit tests) | none |
| `smoke` | smoke-install.yml `smoke` (pack, fresh install, version and banner check) | none |
| `license-truth` | license-truth.yml `local-truth` | none |

Each step's `command` is a single checked-in script with no arguments, because the build agents run
with `no-command-eval`. The pipeline uses no plugins and has no secret values in `env`.

## Differences from the GitHub workflows

- **One Node version for `smoke`.** GitHub ran the smoke install on Node 20 and 22. Here it runs on
  the build image's Node 22.
- **No live reachability check.** The `wave status` / `wave doctor` step needs an API key. It is
  not part of this pipeline.
- **Not included:** the scheduled `registry-drift` job, the release workflows, the foundation checks,
  and the bots that GitHub triggers on events (issue triage, PR-body checks).
- **Push diff base for `governance-enforce`.** GitHub diffed a push against the push's `before` sha.
  Buildkite does not provide one, so push builds diff against the first parent (`HEAD^1`). For a
  merge commit, that covers the whole merged branch. A direct push of several non-merge commits
  would have only its last commit scanned. PR builds diff against the merge-base with the target
  branch. If no base resolves, the step scans the full tree.

## Credentials

The only credential in this pipeline is `WAVE_REGISTRY_READ_TOKEN`, the read-only token of WAVE's
self-hosted private npm registry (GitHub Packages is retired; `NODE_AUTH_TOKEN` is no longer read). It
would come with `WAVE_REGISTRY_URL`, the registry's base URL, which this public repository never names.
Both are for the `governance-enforce` step only. The script moves them into non-exported shell
variables before anything else runs. It hands the token to the single `npm install` of the enforcer
through a job-local npmrc placeholder, so the token is never written to disk or printed, and deletes
that npmrc when the install returns. The install runs with `--ignore-scripts`. Builds of pull requests
from forks never receive it.

The host gives a public repository no job-secrets row today, so `governance-enforce` stops at its
first check (`WAVE_REGISTRY_READ_TOKEN is not set`) before any credential could be used.

## Build-image prerequisites

Node 22 with npm, `bash`, `git`, `grep`, `sed`, `find`. Network access to `registry.npmjs.org`, plus
the private registry (`WAVE_REGISTRY_URL`) and its CA in the image for `governance-enforce`.

## Run locally

```sh
shellcheck -x .buildkite/scripts/*.sh .buildkite/scripts/lib/*.sh
.buildkite/scripts/unit.sh
.buildkite/scripts/smoke.sh
.buildkite/scripts/license-truth.sh
```
