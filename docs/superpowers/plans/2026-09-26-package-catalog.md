# Package Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution, or superpowers:subagent-driven-development only after explicit delegation authorization. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize package declarations around logical tools without changing what any supported machine installs.

**Architecture:** A single package catalog supplies explicit per-OS recipes. Pure chezmoi templates validate and resolve this catalog into installer-specific lists, while the existing shell code retains ownership of package-manager effects.

**Tech Stack:** YAML, chezmoi Go templates/Sprig, Bash, Python standard library for test assertions.

**Spec:** `docs/superpowers/specs/2026-09-26-package-catalog-design.md`

## Global Constraints

- Preserve current package selections; do not expand platform coverage.
- Work directly on main.
- Match prefixes against installation names, not logical IDs.
- Missing platform recipes mean no installation on that platform.
- Real package installation/removal QA is manual and is not performed for this refactor.
- Do not add network/package QA to CI or hooks.
- Commit contracts/tests separately from implementation using Conventional Commits.
- Keep raw RED commits local and publish only after the GREEN implementation and passing verification.
- No branches, worktrees, runtime dependency, generic dependency graph, new installers, or package coverage expansion.

## File responsibilities

| File | Responsibility |
| --- | --- |
| `.chezmoidata/packages.yaml` | Logical catalog, role policy, durable apt tombstones |
| `.chezmoitemplates/validate-package-catalog.tmpl` (new) | Structural validation, ownership, removal conflicts |
| `.chezmoitemplates/resolve-packages.tmpl` (new) | Pure selection, filtering, deterministic output |
| `.chezmoitemplates/validate-machine-package-data.tmpl` | Existing machine-role/policy contract; preserve direct init |
| `.chezmoitemplates/validate-custom-installers.tmpl` | Existing custom-record validation |
| `.chezmoitemplates/install-custom-packages.sh.tmpl` | Existing effectful shell rendering |
| `run_onchange_before_darwin-install-packages.sh.tmpl` | Homebrew operations and Darwin custom execution |
| `run_onchange_before_linux-install-packages.sh.tmpl` | Apt operations and Linux custom execution |
| `run_onchange_after_install-bun-global-packages.sh.tmpl` | Bun global reconciliation |
| `tests/package-catalog.test.sh` (new) | Synthetic schema/resolution unit contracts |
| `tests/fixtures/packages/baseline.json` (new) | Independent migration oracle captured before conversion |
| Existing four installer tests | Render and fake-manager behavior contracts |
| `tests/machine-package-roles.test.sh` | Unchanged role/init compatibility coverage |
| `README.md` | Authoring schema, removal and consumer migration instructions |

`AGENTS.md` is a symlink to `README.md`; edit README only.

## Task 1: Establish an accurate, isolated migration baseline

**Files:** Create `tests/fixtures/packages/baseline.json`; modify
`tests/{bun-package-management,custom-package-installers,darwin-install-packages-template,linux-install-packages-template}.test.sh`.

**Interfaces:** Consume the current old-schema manifest through `chezmoi data`.
Produce a JSON oracle keyed by `darwin-base`, `linux-base`, `linux-gaming`, whose
values use the resolved-plan schema from the spec. Preserve custom record order;
sort native/Bun lists when comparing membership.

- [ ] **Step 1: Capture the old manifest before any schema edits.**

Use an empty config to exclude machine-local overrides:

```bash
config=$(mktemp)
chezmoi --config "$config" --source "$PWD" data --format json > /tmp/package-catalog-before.json
rm "$config"
```

Create the fixture from that saved input, using this transformation (the generated
fixture, not the generator, is checked in):

```python
import json
from pathlib import Path

p = json.loads(Path('/tmp/package-catalog-before.json').read_text())['packages']
baseline = {}
for os, roles, case in (
    ('darwin', ['base'], 'darwin-base'),
    ('linux', ['base'], 'linux-base'),
    ('linux', ['base', 'gaming'], 'linux-gaming'),
):
    plan = {
        'apt': {'install': [], 'remove': []},
        'homebrew': {'brews': [], 'casks': [], 'taps': [], 'trustedFormulae': []},
        'bun': sorted(n for role in roles for n in p['bun']['global']['roles'].get(role, [])),
        'custom': [r for role in roles for r in p[os]['custom']['roles'].get(role, [])],
    }
    if os == 'darwin':
        for source, target in (
            ('brews', 'brews'), ('casks', 'casks'), ('taps', 'taps'),
            ('trusted_formulae', 'trustedFormulae'),
        ):
            role_map = p[os].get(source, {}).get('roles', {})
            plan['homebrew'][target] = sorted(n for role in roles for n in role_map.get(role, []))
    else:
        apt = p[os]['apt']
        plan['apt']['install'] = sorted(n for role in roles for n in apt['roles'].get(role, []))
        plan['apt']['remove'] = sorted(apt['remove'] + [
            n for role, names in apt['roles'].items() if role not in roles for n in names
        ])
    baseline[case] = plan
out = Path('tests/fixtures/packages/baseline.json')
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(baseline, indent=2) + '\n')
```

- [ ] **Step 2: Repair test isolation before running installer tests.**

Explicitly set `chezmoi.os=linux` for Linux cases, including failure overrides;
never depend on the host OS. For execution tests, render from a copied root with
production custom lists replaced by empty lists; use synthetic installers in the
standalone custom-renderer tests. For current old-schema execution cases, use
these explicit overrides (JSON lists replace the manifest's lists):

```bash
execution_darwin='{"chezmoi":{"os":"darwin"},"machineRoles":["base"],"packages":{"darwin":{"custom":{"roles":{"base":[]}}}}}'
execution_linux='{"chezmoi":{"os":"linux"},"machineRoles":["base"],"packages":{"linux":{"custom":{"roles":{"base":[]}}}}}'
```

Use these for fake-manager execution only, not production render/parity cases.
Check the rendered execution script contains no production custom installer body
before executing. Homebrew bootstrap still contains a curl command, but the fake
brew must be discoverable so that branch cannot run; network guards provide an
additional failsafe.

Use controlled PATH and temporary HOME/XDG directories. Add `curl` and `wget`
guards in the fake executable directory:

```bash
for executable in curl wget; do
  printf '#!/bin/sh\necho "network forbidden in unit tests" >&2\nexit 97\n' >"$fake_bin/$executable"
  chmod +x "$fake_bin/$executable"
done
```

The Linux fake apt execution needs Bash supporting associative arrays/mapfile;
select a supported Bash explicitly on macOS rather than `/bin/bash` 3.2.
Production custom behavior remains tested with synthetic local effects only.

- [ ] **Step 3: Correct stale expectations using the actual manifest.**

Include `@doist/todoist-cli` in all Bun command expectations; update current custom
records (Cargo on both OSes; Claude/Codex on Darwin; no invented Bun setup field).
Use the fixture for actual native membership; assert order only for custom
installers. Preserve independent exact fake-manager command expectations for
synthetic scenarios. No manifest edits to satisfy stale tests.

- [ ] **Step 4: Run the four repaired tests and role tests.**

```bash
for name in bun-package-management custom-package-installers darwin-install-packages-template linux-install-packages-template machine-package-roles; do
  bash "tests/$name.test.sh" || exit
done
```

Expected: all pass without production package-manager calls or network. If any
failure reveals a production bug beyond stale assertions/isolation, stop and
report it rather than expanding this reorganization's scope.

- [ ] **Step 5: Commit Track A baseline and test-safety changes.**

```bash
git add tests/fixtures/packages/baseline.json tests/*package*.test.sh
git commit -m "test: isolate package installers and capture migration baseline"
```

## Task 2: Specify and implement pure catalog validation/resolution

**Files:** Create `tests/package-catalog.test.sh`,
`.chezmoitemplates/validate-package-catalog.tmpl`, and
`.chezmoitemplates/resolve-packages.tmpl`.

**Interfaces:** Both templates consume the root dictionary. Validator emits no
output or fails with a path-qualified diagnostic. Resolver returns JSON with
`apt.install`, `apt.remove`, `homebrew.brews`, `homebrew.casks`, `homebrew.taps`,
`homebrew.trustedFormulae`, `bun`, `custom` (all arrays). Resolver invokes the
existing machine validator and new catalog validator before selection.

- [ ] **Step 1: Add synthetic contract tests without replacing production data.**

Use a wrapper to replace, not merge, the catalog via `set` on a copied root.
Example resolution case:

```gotemplate
{{- $root := deepCopy . -}}
{{- $_ := set $root "machineRoles" (list "base") -}}
{{- $_ := set $root "packagePolicy" (dict "deniedPrefixes" (list "steam-installer")) -}}
{{- $_ := set $root "blocked_prefixes" (list) -}}
{{- $_ := set $root.chezmoi "os" "linux" -}}
{{- $_ := set $root "packages" (dict
  "fd" (dict "role" "base" "install" (dict "linux" (dict "apt" (list "fd-find")) "darwin" (dict "brew" "fd")))) -}}
{{- $_ := set $root "packageRemovals" (dict "linux" (dict "apt" (list "obsolete"))) -}}
{{ includeTemplate "resolve-packages.tmpl" $root }}
```

Parse the result with Python and assert exact output:

```python
assert plan == {
    'apt': {'install': ['fd-find'], 'remove': ['obsolete']},
    'homebrew': {'brews': [], 'casks': [], 'taps': [], 'trustedFormulae': []},
    'bun': [], 'custom': [],
}
```

Add named cases for each contract below using small synthetic catalogs. Failure
cases must check nonzero render exit and the invalid data path, not a generic
parser exception:

| Case | Expected |
| --- | --- |
| fd Linux/Darwin alias | `fd-find` / `fd` in correct lists |
| Darwin-only Claude on Linux | no custom record |
| two-name Steam selected | both apt names installed |
| Steam role inactive | both names removed |
| active Steam with one denied name | other installed; neither removed |
| inactive Steam with denied prefix | both still removed |
| scoped Bun name denied; logical ID different | excluded by scoped installation name |
| logical ID denied but different install name | native/Bun package retained |
| new and legacy deny lists overlap | union filtering, no duplicate output |
| trusted brew denied | neither brew nor trust entry |
| selected trusted brew | brew name reused as trust entry |
| two recipes share explicit tap | tap emitted once |
| explicit tap denied | tap omitted with existing prefix semantics |
| custom ordering 20, 10, omitted | zero then 10 then 20 |
| custom order tie | logical ID tie-break |
| setup provided | exact setup preserved in custom record |
| unselected/inactive malformed recipe | validation still fails |
| bad root/package/install shapes, unknown fields | path-qualified failure |
| zero or multiple installer keys | failure |
| apt on Darwin; brew/cask on Linux | failure |
| unknown OS or role, gaming recipe on Darwin | failure |
| blank or padded install names; empty/duplicate apt list | failure |
| nonboolean trust; trust on non-brew | failure |
| tap on apt/Bun/custom; blank tap | failure |
| fractional/negative/string order; order on native recipe | failure |
| custom missing executable/install or unknown custom field | failure |
| same platform/installer name owned by two IDs | failure, even across roles |
| duplicate tombstones or catalog/tombstone overlap | failure, even if denied |
| resolver called twice with same root | identical output; root unchanged |

For tests, use an explicit fixed OS and empty config. The wrapper is an adapter to
the pure template; no rendered shell needs execution here.

- [ ] **Step 2: Run RED and commit only contracts.**

```bash
bash tests/package-catalog.test.sh
# Expected failure: resolve-packages.tmpl does not exist.
git add tests/package-catalog.test.sh
git commit -m "test: specify package catalog resolution contracts"
```

Do not publish this commit alone.

- [ ] **Step 3: Implement catalog validation.**

Validation order: root maps -> package entries -> roles/platforms -> installer
keys/metadata -> names/custom fields -> ownership -> tombstones. Check types
before `len`, `trim`, map access, or numeric comparison. Use `hasKey` for optional
fields so false/empty malformed values aren't hidden by `default`.

Own package names by composite `(OS, installer, name)`; custom names come from
catalog keys. Validate every recipe regardless of selection. Reuse the existing
custom validator with a derived name:

```gotemplate
{{- $record := deepCopy $recipe.custom -}}
{{- $_ := set $record "name" $id -}}
{{- template "validate-custom-installers.tmpl" (dict "installers" (list $record) "context" $path) -}}
```

Use local ownership dictionaries; never mutate input maps. Unknown-key checks
are allowed-key membership tests at each schema level. Restrict tombstone shape
to `{linux: {apt: [...]}}`. An empty catalog is valid, but each catalog entry must
have at least one platform recipe.

- [ ] **Step 4: Implement deterministic resolution.**

Start with the exact empty output shape:

```gotemplate
{{- template "validate-machine-package-data.tmpl" . -}}
{{- template "validate-package-catalog.tmpl" . -}}
{{- $plan := dict
  "apt" (dict "install" (list) "remove" (list))
  "homebrew" (dict "brews" (list) "casks" (list) "taps" (list) "trustedFormulae" (list))
  "bun" (list) "custom" (list) -}}
```

Walk `keys .packages | sortAlpha`, skip absent platform recipes, and derive active
role membership. Add tombstones and inactive-role apt names to removal before
applying deny rules. For active recipes compare every actual installation name
against the union of deny prefixes. Append native/Bun names to their appropriate
lists. Derive trusted formula from allowed brew name. Deduplicate taps.

For custom ordering, group IDs by numeric order; convert validated values to a
common integer type, sort unique numeric orders (not string order), then IDs.
A simple repeated minimum selection over the small set of distinct order values
avoids lexicographic pitfalls and dependencies. Append deep-copied custom records
with derived `name`, excluding recipe metadata. Finish with:

```gotemplate
{{- $plan | toJson -}}
```

- [ ] **Step 5: Run GREEN, run existing tests, commit implementation.**

```bash
bash tests/package-catalog.test.sh
for name in bun-package-management custom-package-installers darwin-install-packages-template linux-install-packages-template machine-package-roles; do
  bash "tests/$name.test.sh" || exit
done
git add .chezmoitemplates/validate-package-catalog.tmpl .chezmoitemplates/resolve-packages.tmpl
git commit -m "feat: resolve logical packages into installer plans"
```

Production templates still use the old manifest at this checkpoint.

## Task 3: Migrate the manifest and consumers with parity verification

**Files:** Modify `.chezmoidata/packages.yaml`, the three installer templates,
`tests/package-catalog.test.sh`, the four installer tests, and `README.md`.

**Interfaces:** Consumers use
`includeTemplate "resolve-packages.tmpl" . | fromJson`. Production manifest adopts
the approved schema; machine init continues consuming only `machineRolePolicy`.

- [ ] **Step 1: Add real-catalog parity contracts and migrate old-schema test inputs.**

For each baseline case, render resolution using the real catalog and explicit OS
and roles. Compare to the saved fixture, sorting only native/Bun lists:

```python
def normalized(plan):
    result = json.loads(json.dumps(plan))
    for key in ('install', 'remove'):
        result['apt'][key].sort()
    for values in result['homebrew'].values():
        values.sort()
    result['bun'].sort()
    return result

assert normalized(actual) == expected
```

Keep schema error cases centralized in `package-catalog.test.sh`. Replace
obsolete per-category validation duplicates in installer tests with checks that
each consumer calls shared validation. Keep phase ordering, shell syntax,
Homebrew trust before/after bundle, apt simulation/purge/manual marking, custom
failure behavior, and Bun authoritative cleanup coverage.

Use synthetic catalogs for executed fake-manager cases so future production
package additions cannot make unit tests access the network. Example synthetic
execution catalog for apt:

```yaml
packages:
  editor:
    role: base
    install:
      linux: {apt: [neovim]}
  steam:
    role: gaming
    install:
      linux: {apt: [steam-installer, steam-devices]}
packageRemovals:
  linux: {apt: []}
```

The fixture expects `neovim` to be missing, then installed/manual; Steam names are
purgeable, then purged. For Homebrew use two trusted synthetic formulae and a cask
without custom recipes. For Bun use two desired packages and one undesired
installed package; assert add-before-remove and denial cleanup. Preserve a
render-only check that the full production script contains current installers.

- [ ] **Step 2: Run RED and commit Track A.**

```bash
bash tests/package-catalog.test.sh
# Expected failure: old production packages map rejected by new validator.
git add tests/package-catalog.test.sh tests/*package*.test.sh
git commit -m "test: require package catalog migration parity"
```

Keep this RED commit local until Step 6 is GREEN.

- [ ] **Step 3: Convert the manifest, preserving the captured data.**

Create one entry per logical tool, merge only actual cross-platform aliases, and
use the original full installation names in recipes. Retain role policy. Move
`packages.linux.apt.remove` to `packageRemovals.linux.apt`. Put `trusted: true` on
hunk and opencode Darwin recipes. Do not add explicit taps or Bun setup code.

Assign custom order values 10, 20, 30 on Darwin (cargo, claude-code, codex), and
10 through 60 on Linux (television, zoxide, herdr, tailscale, bun, cargo).
All other recipes omit order. Keep scoped Bun names for Pi/Todoist; give every
existing Bun global an explicit recipe on both OSes.

Review the fixture diff: the fixture must not change in this task.

- [ ] **Step 4: Replace each consumer's data-selection prelude.**

Darwin keeps its OS guard and shell body, replacing selection variables with:

```gotemplate
{{- $plan := includeTemplate "resolve-packages.tmpl" . | fromJson -}}
{{- $selectedTaps := $plan.homebrew.taps -}}
{{- $selectedTrustedFormulae := $plan.homebrew.trustedFormulae -}}
{{- $selectedBrews := $plan.homebrew.brews -}}
{{- $selectedCasks := $plan.homebrew.casks -}}
```

At its custom phase use:

```gotemplate
{{ template "install-custom-packages.sh.tmpl" $plan.custom }}
```

Linux keeps its OS guard and all package-manager functions. Replace array
construction with:

```gotemplate
apt_install_packages=(
{{- range $plan.apt.install }}
  {{ . | quote }}
{{- end }}
)
apt_remove_packages=(
{{- range $plan.apt.remove }}
  {{ . | quote }}
{{- end }}
)
```

Use the same custom invocation. Bun replaces validation/filtering prelude with
resolver invocation and constructs `desired_packages` from `$plan.bun`. Leave
BUN_INSTALL/PATH setup and add/remove logic unchanged. Do not pass policy into the
custom renderer again; resolver already filtered the records.

- [ ] **Step 5: Update README authoring and migration instructions.**

Show fd alias, Steam multi-name apt recipe, and a custom recipe. Document missing
platform behavior, explicit Bun recipes, custom order, trusted brew metadata,
actual-name prefix matching, and the new tombstone path. Tell package-data
consumers to migrate old OS-first overrides; role/policy-only consumers need no
change. Keep apply a manual action after reviewing removals.

- [ ] **Step 6: Verify GREEN and review generated changes without apply.**

```bash
for test_file in tests/*.test.sh; do bash "$test_file" || exit; done
bun test tests/*.test.ts
python3 -m unittest discover -s tests -p '*.test.py'
git diff --check
chezmoi data | jq '{machineRoles, packagePolicy}'
chezmoi diff
```

Before the broad suite, inspect any newly encountered test's effects. Flag
host/network-dependent tests rather than running them as unit tests. Use the
already-installed deterministic test dependencies; if missing, use the documented
`bun install --cwd tests --frozen-lockfile` separately and report network access.

Also render both OS installers and Bun with explicit overrides and run `bash -n`
on the outputs (the migrated package tests should cover these). Do not execute
full production rendered scripts. If global `chezmoi diff` is blocked by unrelated
configuration, report that and inspect package-only rendered before/after output.

Read every package-related diff: only catalog layout, deterministic native order,
selection prelude, and already-denied custom diagnostic text may change. All
actual selections/custom bodies/removal policies must match the fixture.

- [ ] **Step 7: Commit Track B and report results.**

```bash
git add .chezmoidata/packages.yaml run_onchange_before_darwin-install-packages.sh.tmpl run_onchange_before_linux-install-packages.sh.tmpl run_onchange_after_install-bun-global-packages.sh.tmpl README.md
git commit -m "refactor: install packages from a unified logical catalog"
git status --short
```

Report changed schema paths, parity test results, any unrelated test blockers,
and explicitly that no installation or removal was performed. No push is required.

## Review checklist

- [ ] Spec schema fields and resolver keys agree across all tasks.
- [ ] Baseline fixture remains independent of the new resolver.
- [ ] Platform coverage, scoped names, custom script order/bodies, and trust match.
- [ ] Apt denial differs correctly from inactive-role removal.
- [ ] No executed unit test can run production custom scripts.
- [ ] Direct-init role validation still works without catalog data.
- [ ] No undocumented legacy manifest compatibility layer or new runtime dependency.
