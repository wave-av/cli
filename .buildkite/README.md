# @wave-av/cli on Buildkite

This folder holds the CLI's Buildkite configuration. It uses the shared CI kit: the repository
keeps its settings and its own step scripts, and the kit supplies the uploader, the renderer and
the two leak guards.

## How a build starts

| file | what it is |
|---|---|
| `.buildkite/pipeline.yml` | The kit's thin uploader, byte-for-byte. Three copies of one upload step with different priorities; exactly one runs on any build. Do not edit it here. |
| `.buildkite/wave-ci.sh` | The kit's fixed shim, mode 100755, identical in every repository that uses the kit. In a build it uses only the kit checkout the build host prepared for the pinned commit, checks that checkout, then renders, lints and uploads this repository's pipeline. |
| `.buildkite/wave-ci.json` | This repository's settings: the kit commit (a full 40-character SHA, never a branch or tag), template `custom`, visibility `public`, default branch `main`, and the repository's own steps under `extra_steps`. Change the pipeline here. |
| `.buildkite/scripts/upload.sh` | A temporary bridge. The pipeline's Steps setting, which lives in Buildkite and not in this repository, still runs this file. It uploads `pipeline.yml` unchanged. It goes away once the Steps setting holds the same YAML as `pipeline.yml` (see "Outside this repository"). |

## Steps

The rendered pipeline starts with the two leak guards, `guard-gitleaks` and
`guard-content-policy`. They are not in this repository. The renderer adds them to every
pipeline it renders, and the build host runs them from its own pinned copy of the kit; it refuses
a guard step whose command is anything other than the kit's own guard script. On a pull request
the guard scripts come from the kit commit pinned on the base branch, not from the pull request.

This repository's own steps, from `extra_steps`:

| step key | mirrors (GitHub workflow / job) | timeout (min) | credential |
|---|---|---|---|
| `unit` | smoke-install.yml `unit` (type-check, build, unit tests) | 10 | none |
| `smoke` | smoke-install.yml `smoke` (pack, fresh install, version and banner check) | 15 | none |
| `license-truth` | license-truth.yml `local-truth` | 10 | none |
| `foundation-secret-scan` | foundation-gate.yml, `_checks.yml` `checks`, secret-scan step | 10 | none |
| `foundation-file-size` | foundation-gate.yml, `_checks.yml` `checks`, file-size gate (800 lines) | 10 | none |
| `foundation-skill-validate` | foundation-gate.yml, `_checks.yml` `skill-validate` (no-op: no `SKILL.md`) | 5 | none |
| `foundation-verify-routes` | foundation-gate.yml, `_checks.yml` `verify-routes` (no-op: no `wrangler.toml`) | 5 | none |

Each step's command is one checked-in script with no arguments, because the build agents run
with `no-command-eval`. These steps do not wait on the guards, so on a first pull request they
still run while the guards are refused (see below). Automatic retry is once on a lost agent and
once on an agent stop, as the kit renders it.

## The first pull request is red on the guards by design

On a pull request the guard scripts come from the kit commit pinned on the base branch. Until
`.buildkite/wave-ci.json` is on `main`, the base branch has no pin, so both guard steps are
refused with a message that the base branch has no trusted guard pin. The other steps still run.
After this change merges, the first `main` build runs the guards from the pin, and later pull
requests take them from that base pin.

At the pinned kit commit, the content-policy guard on a `main` build is rendered as a step that
expects a host-side value that public repositories do not receive. A kit change that adds a
secret-free public mode for that step is in review. Until this repository's pin includes it, that
step on `main` is expected to fail closed. The pin moves forward in a separate change after the
kit change merges; no host-side grant is added for this public repository.

## Differences from the GitHub workflows

- **One Node version for `smoke`.** GitHub ran the smoke install on Node 20 and 22. Here it runs on
  the build image's Node 22.
- **No live reachability check.** The `wave status` / `wave doctor` step needs an API key. It is
  not part of this pipeline.
- **Not included:** the scheduled `registry-drift` job, the release workflows, and the bots that
  GitHub triggers on events (issue triage, PR-body checks).
- **Content policy without the private-repo rule.** That rule needs a confidential list, and this
  public repository's builds never receive one. A private name is not caught by this pipeline; the
  other content-policy rules, gitleaks and the foundation secret scan still run.
- **Secret-scan exemptions match content only.** `foundation-secret-scan` runs `grep -h`, so the
  `pragma: allowlist secret` marker and `.github/.secret-allowlist` phrases are matched against
  the line's content, never its file or folder name. The workflow filtered the whole
  `path:line:content` record.
- **File-size gate refuses symlinks and counts every line.** `foundation-file-size` fails on a
  tracked source file that is a symlink, and counts a final line that has no trailing newline.
- **Route check reads wildcard routes.** `foundation-verify-routes` also extracts a route whose
  host starts with `*` (for example `*-edge.<zone>/*`), and checks it without the `*`.
- **Skill check finds indented duplicate keys.** `foundation-skill-validate` finds duplicate
  frontmatter keys on the parsed YAML, at any indentation, instead of a column-zero line scan.
- **No `governance-enforce`.** See "Not in this pipeline" below.

## Not in this pipeline

- **`governance-enforce`** (governance-enforce.yml `enforce`, secrets and hardcoded paths on the
  diff). Its enforcer is a private package that cannot be installed without a registry token, and
  this public repository's builds get no token, by standing decision. A step for it could only
  fail closed, so it is left out rather than left red. `.buildkite/scripts/governance-enforce.sh`
  stays in the repository for local and manual runs. On Buildkite, diffs are still covered by the
  two leak guards and `foundation-secret-scan`.

## Credentials

None. No step of this repository receives a secret on any build, and none is in this repository
or in the pipeline file.

## Outside this repository

- **Steps setting.** The Buildkite pipeline's Steps setting must hold the same YAML as
  `.buildkite/pipeline.yml`. Until it does, it runs `.buildkite/scripts/upload.sh`, which uploads
  that same file, so builds work either way. Delete `upload.sh` only after the swap.
- **Pull-request builds** on, **builds of pull requests from forks** off, and commit statuses on.
- A repository webhook for `push` and `pull_request` events that points at that pipeline.

## Build-image prerequisites

Node 22 with npm, `bash`, `git`, `grep`, `sed`, `awk`, `find`, and `python3` with PyYAML
(`python3 -c 'import yaml'` must succeed; `foundation-skill-validate` needs it once the repository
has a `SKILL.md` and never installs it at run time). Network access to the public npm registry.

## Run locally

```sh
shellcheck -x .buildkite/scripts/*.sh .buildkite/scripts/lib/*.sh .buildkite/tests/*.sh
.buildkite/scripts/unit.sh
.buildkite/scripts/smoke.sh
.buildkite/scripts/license-truth.sh
.buildkite/scripts/foundation-secret-scan.sh
.buildkite/scripts/foundation-file-size.sh
.buildkite/scripts/foundation-skill-validate.sh
.buildkite/scripts/foundation-verify-routes.sh
bash .buildkite/tests/foundation.test.sh
```

`foundation.test.sh` builds throwaway repositories under a temp folder and checks the secret
scan's content-only exemptions, the file-size gate (symlinks, an unterminated last line), the route
check on wildcard routes, the skill check on indented duplicate keys, and the upload bridge's
refusals. It needs no network and no credential. Pass an older checkout's root as the first
argument to run the same cases against that code.
