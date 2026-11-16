#!/usr/bin/env bash
# foundation-skill-validate: the Buildkite twin of .github/workflows/_checks.yml job
# `skill-validate` (SKILL.md frontmatter gate). Validates *SKILL.md in THIS repo; no-op if the
# repo has none. The Python body mirrors the vendored _checks.yml; keep the two in sync. One
# deliberate difference: duplicate frontmatter keys are found on the parsed YAML (any indentation),
# not by a column-zero line scan.
#
# Needs PyYAML from the build image (README "Build-image prerequisites"). There is
# deliberately no run-time install: the workflow pip-installs `pyyaml`, but build
# guests guarantee neither pip nor a package index, and a network install at run
# time is not deterministic. A missing PyYAML fails closed with a clear message.
set -euo pipefail
cd "$(dirname "$0")/../.."

# Cheap no-op check BEFORE touching PyYAML: repos with no *SKILL.md exit
# here, so a missing PyYAML can never fail a repo the gate doesn't apply to.
# (The python body below re-checks after filtering vendored/reference paths.)
if [ -z "$(git ls-files '*SKILL.md')" ]; then
  echo "no SKILL.md in repo — skill gate is a no-op"
  exit 0
fi

if ! python3 -c 'import yaml' 2>/dev/null; then
  echo "foundation-skill-validate: PyYAML is not installed in the build image (python3 -c 'import yaml' failed). It is a build-image prerequisite (.buildkite/README.md); there is no run-time install — failing closed."
  exit 2
fi

python3 - <<'PY'
import sys, os, re, subprocess
import yaml

# Duplicate keys are found on the parsed YAML node tree, at any indentation and depth. PyYAML
# itself keeps the last duplicate without a warning, and a column-zero text scan misses an
# indented mapping, so neither alone catches `name: wrong` followed by `name: <directory>`.
class DupKeyLoader(yaml.SafeLoader):
    def __init__(self, stream):
        super().__init__(stream)
        self.dups = set()

def _mapping_with_dups(loader, node, deep=False):
    seen = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=True)
        try:
            if key in seen:
                loader.dups.add(str(key))
            seen.add(key)
        except TypeError:
            pass  # unhashable key: construct_mapping below reports it
    return loader.construct_mapping(node, deep=deep)

DupKeyLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _mapping_with_dups)

allf =subprocess.run(["git","ls-files","*SKILL.md"], capture_output=True, text=True).stdout.splitlines()
# Only validate invocable skills; skip nested reference/vendored SKILL.md.
skip = ("/references/", "/_external/", "/_consolidated", "/_archived", "/node_modules/", "/dist/")
files = [f for f in allf if not any(s in "/" + f for s in skip)]
if not files:
    print("no SKILL.md in repo — skill gate is a no-op"); sys.exit(0)
errs = []
for p in files:
    d = os.path.basename(os.path.dirname(p))
    t = open(p, encoding="utf-8", errors="replace").read()
    m = re.match(r"^---\s*\n(.*?)\n---", t, re.S)
    if not m:
        errs.append(f"{p}: no frontmatter block"); continue
    fm = m.group(1)
    loader = DupKeyLoader(fm)
    try:
        data = loader.get_single_data() or {}
    except yaml.YAMLError as e:
        errs.append(f"{p}: invalid YAML frontmatter: {e}"); continue
    finally:
        loader.dispose()
    if loader.dups: errs.append(f"{p}: duplicate frontmatter keys: {', '.join(sorted(loader.dups))}")
    if not isinstance(data, dict):
        errs.append(f"{p}: frontmatter is not a mapping"); continue
    if data.get("name") != d:
        errs.append(f"{p}: name '{data.get('name')}' != directory '{d}'")
    if not str(data.get("description") or "").strip():
        errs.append(f"{p}: missing/empty description")
    for key in ("allowed-tools", "hooks"):
        if key in data:
            v = data[key]
            if v is None or (isinstance(v, (list, dict, str)) and len(v) == 0):
                errs.append(f"{p}: '{key}' present but EMPTY")
for e in errs:
    print(f"error: {e}")
print(f"validated {len(files)} skills — {len(errs)} errors")
sys.exit(1 if errs else 0)
PY
