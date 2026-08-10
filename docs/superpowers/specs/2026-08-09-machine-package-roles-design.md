# Machine Package Roles Design

## Goal

Provision only the packages appropriate for each machine while preserving an
organizational composition root's ability to deny unauthorized packages.

The shared chezmoi repository will support two composable machine roles:

- `base`: every currently declared package except the Steam packages.
- `gaming`: `steam-installer` and `steam-devices` on Linux.

`base` is mandatory. An Ubuntu web host selects `base`; an Ubuntu personal
machine selects `base` and `gaming`; a macOS machine selects `base`.

## Scope

This change covers the machine-role data contract, package manifest layout,
package selection and removal, direct chezmoi initialization, downstream work
repository composition, deterministic tests, and README documentation.

It does not manage SSH daemon policy, firewalls, web-server application
configuration, or generic uninstallation for tools installed by custom shell
scripts.

## Machine Data Contract

Each machine's local chezmoi config supplies a non-empty role list:

```toml
[data]
machineRoles = ["base"]
```

A personal Linux machine adds the optional role:

```toml
[data]
machineRoles = ["base", "gaming"]
```

The package policy is a separate, optional composition-root concern:

```toml
[data.packagePolicy]
deniedPrefixes = [
  "unauthorized-package-prefix",
]
```

The role validator requires:

- `machineRoles` is a non-empty list of strings.
- Each role is non-empty and appears exactly once.
- `base` is present exactly once.
- Every role is known and supported by the current operating system.
- Linux supports `base` and `gaming`.
- Darwin supports `base` only.
- `packagePolicy.deniedPrefixes` and legacy `blocked_prefixes`, when present,
  are lists of unique, non-empty strings.

Missing or invalid machine data stops template rendering before any package
manager runs. Diagnostics identify the invalid field and valid roles for the
current operating system.

### Legacy policy compatibility

The existing top-level `blocked_prefixes` field remains accepted as a deprecated
input. Effective denied prefixes are the unique union of
`packagePolicy.deniedPrefixes` and `blocked_prefixes`. The union is deliberately
deny-biased so a partial migration cannot permit a package previously denied by
the work composition root.

New configuration and documentation use only
`packagePolicy.deniedPrefixes`. Removing legacy support requires a separate,
explicit breaking change; it is not part of this work.

## Role and Package Schema

The shared data declares role policy separately from platform-specific package
implementations:

```yaml
machineRolePolicy:
  required: [base]
  platforms:
    linux: [base, gaming]
    darwin: [base]

packages:
  bun:
    global:
      roles:
        base: []

  linux:
    apt:
      roles:
        base: []
        gaming: []
      remove: []
    custom:
      roles:
        base: []

  darwin:
    taps:
      roles:
        base: []
    trusted_formulae:
      roles:
        base: []
    brews:
      roles:
        base: []
    casks:
      roles:
        base: []
    custom:
      roles:
        base: []
```

Empty or omitted role entries in a package category mean that role owns no
packages in that category. Package declarations may reference only roles
supported by that platform. Package identifiers must be unique across roles in
the same package category and must not overlap that package manager's durable
removal tombstones.

All current Linux apt packages except `steam-installer` and `steam-devices`
move to `base`. This includes `openssh-server`, `nvtop`, Ghostty, FFmpeg, and all
development tools. Steam packages move to `gaming`. All current Linux custom
installers, Darwin declarations, and Bun global packages move to `base`.

Linux apt packages retired from the complete manifest must still move to
`packages.linux.apt.remove`; they must never simply be deleted. Role
deactivation is not retirement and therefore does not create a tombstone.

## Direct Initialization

The shared repository will contain `.chezmoi.toml.tmpl`. On direct
`chezmoi init`, it generates the machine-local config rather than requiring a
user to create it manually.

The generated config always includes `base`. On Linux, initialization asks
whether to add `gaming`. Darwin generates `base` only. It also emits an empty
`packagePolicy.deniedPrefixes` list so direct users see the complete current
contract.

Existing direct users must regenerate or edit their machine-local config to add
`machineRoles` before applying the new package templates. Role changes after
initialization use `chezmoi edit-config`, followed by `chezmoi diff` and
`chezmoi apply`.

## Downstream Work Composition

The internal work repository is the composition root on work machines. It
contains this repository as a submodule at `_personal/`, initializes the local
chezmoi config from its own `.chezmoi.toml.tmpl`, runs `chezmoi apply` against
the personal source, and then applies work state.

Because `.chezmoi.toml.tmpl` is processed by `init`, not `apply`, the personal
config template does not replace the work-generated config. The work template
must emit the shared consumer contract:

```toml
[data]
machineRoles = ["base"]

[data.packagePolicy]
deniedPrefixes = [
  # Work policy
]
```

A safe downstream migration sequence is:

1. Add `machineRoles = ["base"]` to the work config template while retaining
   legacy `blocked_prefixes`.
2. Update the personal submodule to the role-aware version.
3. Rename the work denial field to `packagePolicy.deniedPrefixes`.
4. Initialize/apply in the normal work order and inspect the package preview.

Steps may be one atomic work-repository commit. The staged sequence is also
safe: old personal code ignores `machineRoles` and still honors the legacy
policy; new personal code honors both policy fields. Updating the personal
submodule before supplying `machineRoles` fails closed rather than installing
packages.

## Package Resolution

Every package script follows the same deterministic flow:

1. Validate machine roles, role catalog declarations, tombstones, and denial
   policy.
2. Build the selected package list from active roles.
3. Build effective denied prefixes from the new and legacy policy fields.
4. Remove denied identifiers from the selected list.
5. Reconcile the resulting package state.

Prefix checks use each installer's canonical identifier:

- apt package name;
- Homebrew tap, trusted formula, formula, or cask identifier;
- Bun package name;
- custom installer `name`.

Policy denial always takes precedence over role selection.

### Linux apt

The desired set is selected, non-denied role packages. The purge set is the
unique union of:

- durable tombstones;
- packages belonging only to inactive roles;
- managed packages matched by an effective denied prefix.

Apt installs desired missing packages and marks installed desired packages as
manual. It simulates installations and purges before effects. The existing
safety boundary remains: a simulated removal may contain only packages in the
calculated purge allowlist. Unexpected dependent removals stop the operation.
Apt-calculated orphan dependencies continue to be removed by the existing
autoremove step.

Removing `gaming` therefore purges installed Steam packages. A base-only server
never installs them.

### Homebrew

The generated strict Brewfile contains only selected, non-denied declarations.
The existing `brew bundle install --force-cleanup` behavior removes denied or
inactive managed packages along with any other Homebrew package outside the
authoritative Brewfile. Tap trust restoration remains intact.

### Bun globals

The desired global list contains only selected, non-denied role packages. The
existing authoritative Bun reconciliation installs desired packages and removes
current globals outside that list.

### Custom installers

Only selected, non-denied custom installers render. A denied custom installer
is not run. Existing custom installations are not automatically removed because
the schema has no safe uninstall command. A future role-scoped custom tool that
requires automatic removal must first add an explicit uninstall contract in a
separate design.

## Change Detection and Safety

Role and denial data affect the rendered content of each `run_onchange_`
installer. Changing either causes the relevant installer to run on the next
`chezmoi apply`.

All data validation occurs while chezmoi renders templates, before shell effects.
Package-manager failures remain fatal. Apt removal simulation and Homebrew's
strict bundle behavior remain the production safety boundaries.

Users must run `chezmoi diff` before applying a role or policy change that can
remove packages.

## Verification

Tests remain fast, deterministic, and effect-isolated. Package managers are
represented by practical shell fakes; tests make no network calls and do not
modify the host package state.

The test suite will cover:

- Linux direct config generation with `base` and optional `gaming`.
- Darwin direct config generation with `base` only.
- Missing, empty, duplicate, unknown, unsupported, and base-less role lists.
- Invalid or duplicate denied prefixes.
- Duplicate package ownership and role/tombstone conflicts.
- Linux base rendering includes `openssh-server` and `nvtop` but excludes Steam.
- Linux `base` plus `gaming` renders Steam as desired.
- Removing `gaming` places Steam in the calculated apt purge set.
- New and legacy denial fields work independently and as a deny-union.
- Denial precedence for apt, Homebrew, Bun globals, and custom installers.
- Denied apt and Homebrew packages are removed by their reconciler.
- Denied custom installers are omitted without claiming uninstallation.
- Darwin rejects `gaming`.
- Existing Homebrew strict cleanup and tap-trust behavior remains covered.
- The Bun global-package test includes the currently declared `hunkdiff`
  package; this repairs its existing stale assertion.

No production package installation belongs in automated tests. Manual QA is
limited to previewing rendered changes and applying on the intended machine at
the operator's discretion.

## README Contract

The README will use plain language and examples to explain:

- what `base` and `gaming` mean;
- valid Linux and Darwin configurations;
- direct initialization and later role changes;
- automatic Steam removal when `gaming` is disabled;
- durable apt tombstones for retired packages;
- `packagePolicy.deniedPrefixes` and its precedence;
- temporary legacy `blocked_prefixes` compatibility;
- the exact downstream work composition and safe migration sequence;
- the custom-installer uninstallation limitation;
- commands for previewing and testing the configuration.

The downstream section is a consumer-facing interface document: agents and
human developers must be able to update the internal work chezmoi repository
without reading package-template implementation details.
