# Linux apt blocked-prefix schema design

## Problem

`run_onchange_before_linux-install-packages.sh.tmpl` reads a required top-level
`.blocked_prefixes` template value. Chezmoi data defines only `.packages`, so
Linux package-script rendering fails before `chezmoi apply` can execute.

## Data contract

The Linux apt manifest at `packages.linux.apt` contains three list-valued
fields:

- `install`: desired apt packages.
- `remove`: durable package-removal tombstones.
- `blocked_prefixes`: prefixes excluded from `install` when rendering the
  package script.

The checked-in `blocked_prefixes` value is an empty list, meaning no desired
package is filtered. The field is required rather than silently defaulted, so a
malformed manifest fails during template rendering.

## Template behavior

The Linux package template reads
`.packages.linux.apt.blocked_prefixes`. Existing prefix-matching behavior is
otherwise unchanged. With the checked-in empty list, every package in
`packages.linux.apt.install` appears in the rendered script.

## Verification

A deterministic regression test renders the real template with the checked-in
chezmoi data and asserts that rendering succeeds and a declared package remains
in the install array. The test must reproduce the current missing-key failure
before the fix.

After implementation:

1. Run the regression test.
2. Render the script and validate it with `bash -n`.
3. Run `chezmoi diff` to inspect intended target changes.
4. Run `chezmoi apply` to verify the reported workflow. This may execute the
   package synchronization script because its rendered content changes.

## Scope

This change only repairs and scopes the blocked-prefix data contract. It does
not alter apt synchronization behavior, package declarations, or removal
safety checks.
