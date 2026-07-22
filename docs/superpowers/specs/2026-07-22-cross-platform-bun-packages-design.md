# Cross-platform Bun packages design

## Goal

Install Bun on Linux and macOS, then strictly reconcile one shared declaration
of global Bun packages on either operating system. The initial global package
is Prettier.

## Data contract

The package manifest defines a required OS-independent list:

```yaml
packages:
  bun:
    global:
      [
        "prettier",
      ]
```

Each entry is an npm package name. The synchronization manifest maps each name
to the version selector `latest`.

`packages.bun.global` is strictly authoritative over Bun's direct global
packages. Synchronization removes every direct global package absent from this
list, including packages installed manually outside chezmoi.

## Provisioning

### Linux

The Linux package script installs Bun only when `bun` is unavailable, using the
official installer:

```bash
curl -fsSL https://bun.com/install | bash
```

The script sets `BUN_INSTALL` to `${BUN_INSTALL:-$HOME/.bun}` and prepends its
`bin` directory to `PATH` so Bun is available during the same non-login chezmoi
run.

### macOS

`bun` is a declared Homebrew formula. The existing authoritative Homebrew
bundle installs and retains it.

## Global package synchronization

A dedicated cross-platform
`run_onchange_after_install-bun-global-packages.sh.tmpl` script runs after OS
package provisioning. Separating it from the Linux and macOS scripts gives Bun
package declarations their own onchange hash and prevents a package-list edit
from rerunning apt or Homebrew synchronization.

The script:

1. Fails if `bun` is unavailable.
2. Resolves the global directory as
   `${BUN_INSTALL:-$HOME/.bun}/install/global`.
3. Writes a complete desired `package.json` to a temporary file in that
   directory.
4. Atomically replaces the global `package.json`.
5. Runs `bun install --cwd "$global_dir"`.

Bun treats the replacement manifest as authoritative and removes undeclared
direct dependencies while preserving required transitive dependencies. Bun's
lockfile records resolved versions; changing the chezmoi declaration reruns the
script.

## Boundaries and verification

Template rendering and shell orchestration are deterministic. Network access,
the official installer, Homebrew, and Bun package installation are external
effects.

A deterministic shell test renders the production synchronization template,
runs it with a fake `bun` and an isolated `BUN_INSTALL`, and asserts:

- The exact generated global `package.json` declares only `prettier` at
  `latest`.
- Bun receives `install --cwd <isolated-global-directory>`.
- Rendering and generated shell syntax are valid.

The test does not invoke a network, Homebrew, apt, or the real home directory.

A manual QA procedure uses a temporary `BUN_INSTALL` with real Bun to install
both a declared and undeclared package, runs the synchronization script, and
verifies the undeclared package is removed. QA remains outside automated test,
pre-commit, pre-push, and CI workflows.

## Relationship to the apt-schema repair

This feature does not replace the approved Linux apt blocked-prefix repair.
Implementation first completes that RED/GREEN pair, then adds the Bun schema,
verification contracts, and implementation in separate Track A and Track B
commits.

## Scope

This work does not manage globally installed npm packages, pin Prettier to a
fixed version selector, periodically upgrade packages without a declaration
change, or preserve manually installed global Bun packages.
