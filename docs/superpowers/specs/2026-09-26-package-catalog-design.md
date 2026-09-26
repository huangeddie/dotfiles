# Package-centric installation catalog

## Goal and scope

Replace the OS/installer-first package manifest with one catalog keyed by logical
package identity. Installation recipes live inline under each package. Preserve
current package selections; do not expand platform coverage.

The user approved the catalog layout and shared resolution/safety layer in chat.

## Schema

Keep `.chezmoidata/packages.yaml` as the only production package catalog:

```yaml
machineRolePolicy:
  required: [base]
  platforms:
    linux: [base, gaming]
    darwin: [base]

packages:
  fd:
    role: base
    install:
      darwin: {brew: fd}
      linux: {apt: [fd-find]}
  steam:
    role: gaming
    install:
      linux: {apt: [steam-installer, steam-devices]}
  hunk:
    role: base
    install:
      darwin:
        brew: modem-dev/tap/hunk
        trusted: true
  claude-code:
    role: base
    install:
      darwin:
        order: 20
        custom:
          executable: claude
          install: |-
            curl -fsSL https://claude.ai/install.sh | bash
  prettier:
    role: base
    install:
      darwin: {bun: prettier}
      linux: {bun: prettier}

packageRemovals:
  linux:
    apt: []
```

- A package has exactly `role` and `install`. Its key is a nonempty, trimmed
  logical identifier. Keys do not have to equal distribution package names.
- `role` remains singular, matching current exclusive ownership. No default role.
- `install` is a nonempty map containing only `linux` and/or `darwin`.
- Missing platform recipes mean no installation on that platform.
- Each recipe chooses exactly one of `brew`, `cask`, `apt`, `bun`, or `custom`.
  `brew`/`cask` are Darwin-only, `apt` is Linux-only, `bun`/`custom` support both.
- `brew`, `cask`, and `bun` contain nonempty trimmed strings. `apt` contains a
  nonempty list of distinct nonempty trimmed strings, supporting one logical
  package mapping to several distribution packages.
- Optional `trusted: true|false` is valid only with `brew`; the trusted formula
  is derived from `brew`, not duplicated elsewhere.
- Optional `tap` is a nonempty trimmed string valid only with `brew` or `cask`.
  Current data declares no explicit taps; preserve this absence. Shared explicit
  taps are deduplicated in resolved output.
- Optional `order` is a nonnegative integer valid only with `custom`; omitted
  values default to zero. Sort custom installers by `(order, logical ID)`.
  Assign ascending values to preserve each OS's existing custom script sequence.
- `custom` contains `executable`, `install`, and optional `setup`, with the
  existing custom-installer validation rules. Derive `name` from logical ID;
  retain existing custom names during migration. Do not duplicate them in recipes.
- `packageRemovals.linux.apt` is the durable tombstone list. Keep tombstones even
  when their former logical package no longer exists. No new uninstall policies.
- Reject unknown fields instead of silently accepting typographical errors.

Use one entry for actual aliases such as `fd`/`fd-find` and `node`/`nodejs`.
Keep independent packages such as Linux `npm` separate. Bun ecosystem packages
use logical IDs such as `pi-coding-agent` and `todoist-cli`, while their recipes
retain full scoped installation names. Identical cross-platform Bun recipes are
explicit on both platforms; do not add inheritance or fallback syntax.

## Resolution interface and file structure

Pure template pipeline:

```text
catalog + removal declarations + OS + roles + deny policy
    -> validate -> select/filter -> installer-specific resolved plan
    -> existing shell renderers -> package-manager effects
```

Create:

- `.chezmoitemplates/validate-package-catalog.tmpl`: schema, ownership, and
  tombstone validation; validates the whole catalog, including inactive recipes.
- `.chezmoitemplates/resolve-packages.tmpl`: returns a JSON object via
  `includeTemplate`, with no host inspection, filesystem/network access, or shell
  execution. Takes the existing root template data as input.
- `tests/package-catalog.test.sh`: synthetic schema/resolution contracts.
- `tests/fixtures/packages/baseline.json`: checked-in expected selections captured
  from the old manifest, not regenerated from the new catalog in assertions.

Keep:

- `.chezmoitemplates/validate-machine-package-data.tmpl`: machine roles and deny
  policy validation, including direct-init use without a catalog.
- `.chezmoitemplates/validate-custom-installers.tmpl`: reusable custom record rules.
- `.chezmoitemplates/install-custom-packages.sh.tmpl`: existing shell renderer.

Modify the three existing OS/Bun installer templates to consume the resolved plan;
remove their duplicated role traversal, catalog validation, and deny filtering.
Leave concrete package-manager shell operations unchanged.

Resolved JSON always has this shape (empty lists, never missing/null fields):

```json
{
  "apt": {"install": [], "remove": []},
  "homebrew": {"brews": [], "casks": [], "taps": [], "trustedFormulae": []},
  "bun": [],
  "custom": []
}
```

`custom` records have `name`, `executable`, `install`, and optional `setup`;
resolution-only ordering metadata is not passed to the renderer.

Iterate logical IDs alphabetically for deterministic native/Bun output. Retain
list order within an apt recipe. Preserve provisioning phase order (OS native
packages, then custom scripts, then Bun globals) and custom script order. Native
package argument ordering is not an installation dependency contract; compare
native membership, not historical text ordering, during migration verification.

## Policy compatibility

- Keep machine roles, supported platforms, required base, and direct-init behavior.
- Combine `packagePolicy.deniedPrefixes` and legacy `blocked_prefixes` as today.
- Match prefixes against installation names, not logical IDs. For custom recipes,
  the logical ID supplies the existing custom name and therefore the policy name.
- Filter each apt name independently. Do not suppress an entire multi-name recipe
  because one distribution name is denied.
- For active-role apt packages, denial excludes installation but does not request
  removal. For inactive-role apt recipes, include their names in the purge plan
  regardless of denial, preserving current role-removal semantics.
- Tombstones always enter the apt removal plan. Reject tombstones overlapping any
  desired apt declaration, including inactive/denied declarations.
- Homebrew and Bun remain authoritative; their existing cleanup commands remove
  packages absent from the resolved selection.
- Custom installers remain install-only, checking executable availability.
- Trusted formula entries must correspond to selected, allowed brews. Filter
  explicit taps using existing tap-name prefix semantics as well as role/package
  selection. Never infer broad tap trust.
- Reject multiple catalog entries owning the same platform/installer package
  name; explicit shared taps are metadata, not duplicate package ownership.
- Do not add an adapter for the old production manifest schema. Document the new
  override paths for any consumers that customize package data. Existing work
  consumers using only machine roles and deny policy require no configuration
  change.

## Verification and safe execution boundary

1. Capture current actual selections for Darwin base, Linux base, and Linux
   base+gaming before replacing the old schema. Include exact custom records and
   ordering, trust lists, empty explicit taps, Bun globals, and apt removal sets.
2. Add deterministic tests for recipe types, aliases, platform gaps, roles,
   per-name denials, legacy policy union, custom ordering, trusted formula
   filtering, duplicate ownership, and tombstone conflicts.
3. Preserve existing fake-package-manager behavior checks; update old-schema
   fixtures and stale expectations. Explicitly select test OSes instead of relying
   on host platform.
4. Isolate execution tests: synthetic custom recipes only, temporary HOME/config,
   controlled executable discovery, and failing network guards. No real installer
   scripts or production package managers may run in unit tests.
5. Render both OS scripts and Bun scripts and check `bash -n` without execution.
   Run package tests, repository tests, and inspect `chezmoi diff` without apply.
6. Real package installation/removal QA is manual and is not performed for this
   refactor. Do not add network/package QA to CI or hooks.

Discovery: existing Bun/custom tests omit newer manifest entries, including
Todoist and Cargo; some Linux tests omit an OS override. Darwin execution tests
inherit host PATH and can reach real custom installers; Linux fakes omit Cargo.
These are pre-existing stale/isolation issues to fix as part of relevant test
migration, not a reason to roll back current package data.

## Delivery

Work directly on main. Commit contracts/tests separately from implementation
using Conventional Commits. Shell tests have no expected-failure mechanism: keep
raw RED commits local and publish only after the GREEN implementation and passing
verification. Documentation and pure test-safety repairs may be committed without
red-green. No branches, worktrees, runtime dependency, generic dependency graph,
new installers, or package coverage expansion.
