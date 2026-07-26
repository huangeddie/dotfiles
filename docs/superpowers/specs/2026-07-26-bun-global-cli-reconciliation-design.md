# Bun global CLI reconciliation design

## Goal

Make every Bun package declared in `packages.bun.global` runnable through
Bun's public global bin directory while preserving strict removal of undeclared
direct global packages.

## Data contract

`packages.bun.global` remains the required, OS-independent authoritative list
of direct global npm package names. Declared packages use the `latest` selector
when synchronized. An empty list means no direct global Bun packages should
remain.

The data schema does not expose Bun's internal global manifest or
`node_modules` layout. Bun owns those implementation details.

## Synchronization contract

The cross-platform onchange script resolves Bun's installation root as
`${BUN_INSTALL:-$HOME/.bun}`, exports it as `BUN_INSTALL`, and prepends
`$BUN_INSTALL/bin` to `PATH` before looking up Bun. This makes the script work
in a separate chezmoi process immediately after the Linux installer provisions
Bun.

The script reads the names of current direct global dependencies from Bun's
global `package.json`. It then reconciles state in this order:

1. Add or update every declared package using Bun's public global operation and
   the `latest` selector.
2. Remove every previously installed direct global package absent from the
   declaration using Bun's public global removal operation.

Adding desired packages first avoids removing working packages before a
potential registry failure. Bun remains responsible for manifests, lockfiles,
package contents, executable links, scoped package names, and link cleanup.
The script does not write Bun's global `package.json` or create links itself.

If Bun is unavailable after adding its bin directory to `PATH`, synchronization
fails with a clear error. Missing global manifests represent an empty current
set. Invalid manifests or failed Bun operations fail the script rather than
silently accepting partial reconciliation.

## Boundaries

Template rendering, desired/current set comparison, and command selection are
deterministic shell logic. Bun process execution, filesystem changes inside
`BUN_INSTALL`, and npm registry access are external effects.

The consuming script uses Bun's CLI as the narrow package-manager interface.
Automated tests supply a practical fake Bun; manual QA exercises the production
Bun and registry boundary.

## Verification

The deterministic shell test renders the production template and verifies:

- Declared packages are passed to `bun add --global` with `@latest`.
- Undeclared direct packages are passed to `bun remove --global`.
- Bun's global bin directory is available on `PATH` during synchronization.
- The fake exposes a declared package executable in the expected global bin
  directory.
- The script remains valid when the desired package list is empty.

Manual QA starts with declared and undeclared real global packages in an
isolated `BUN_INSTALL`, runs the rendered synchronization script, and verifies:

- Prettier remains a direct global package.
- The undeclared package is absent from the direct global package inventory.
- `prettier --version` succeeds with Bun's global bin directory on `PATH`.

The QA remains manual and excluded from pre-commit, pre-push, and CI because it
uses the npm registry and the production package manager.

## Scope

This change does not pin resolved package versions, periodically upgrade
packages without an onchange trigger, preserve manually installed direct global
packages, manage npm globals, or depend on Bun's internal global directory
layout beyond reading its documented global manifest location for current-state
reconciliation.
