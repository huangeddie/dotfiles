# Strict apt package management design

## Context

The Darwin package manifest is authoritative because `brew bundle --cleanup
--force` removes Homebrew packages absent from chezmoi. Applying that model to
all manually marked apt packages is unsafe: Debian and Ubuntu installers also
mark distribution packages manual, and apt does not retain a reliable,
portable distinction between installer-selected packages and packages later
installed by the user.

Linux package management will therefore use explicit installation declarations
and explicit, durable removal tombstones. Chezmoi will never infer a stale
package from the machine's complete apt state.

## Goals

- Install apt packages declared by chezmoi.
- Purge packages deliberately moved to a durable removal list.
- Reject contradictory declarations and unexpectedly broad apt transactions.
- Remove dependencies that apt classifies as automatic and orphaned.
- Preserve distribution packages and unrelated manually installed packages.
- Verify the behavior with real apt transactions on the host.

## Non-goals

- Making the manifest an exact representation of every installed Debian
  package.
- Inferring which existing manual packages were installed by the operating
  system or by the user.
- Removing manually installed packages merely because they are absent from the
  manifest.
- Managing non-apt Linux installers such as television, zoxide, or herdr; their
  existing behavior remains unchanged.

## Manifest contract

The current flat apt list becomes two normalized sets:

```yaml
packages:
  linux:
    apt:
      install:
        - neovim
        - git
      remove:
        - obsolete-package
```

`install` is the desired set of explicitly chezmoi-managed apt packages.
`remove` is a durable tombstone set. Removing a formerly desired package means
moving its name from `install` to `remove`; tombstones remain until the package
is intentionally desired again.

A package must not appear in both sets. Synchronization rejects overlap before
performing package changes. The existing flat list migrates entirely to
`install`.

The state contract for each declaration is:

| Declaration | Current dpkg state | Result |
| --- | --- | --- |
| `install` | installed | Retain and mark manual |
| `install` | missing and available | Install and mark manual |
| `install` | missing and unavailable | Warn and skip |
| `remove` | installed | Purge |
| `remove` | residual configuration (`rc`) | Purge configuration |
| `remove` | fully absent or unknown | Successful no-op |

Explicitly requested apt packages are normally manual, while dependencies are
normally automatic. The synchronizer nevertheless marks every installed
`install` declaration manual. This is necessary when a desired package was
already present as an automatic dependency and the installation step therefore
had nothing to do.

## Architecture and effect boundary

The existing Linux `run_onchange` template remains the composition root. Apt,
dpkg, sudo, repository access, and host package state are external effects.
Small shell functions own deterministic set validation and apt simulation
parsing, while the main flow sequences the real commands.

No persistent package ledger is introduced. The two manifest sets are the only
chezmoi-owned package state. Apt continues to own dependency relationships and
automatic/manual marks.

## Synchronization flow

The Linux package script performs these steps:

1. Render the `install` and `remove` arrays.
2. Reject any package present in both arrays.
3. Determine which desired packages are missing.
4. When desired packages are missing, update apt metadata and retain only
   packages available from configured repositories. Unavailable packages keep
   the current warning-and-skip behavior.
5. Simulate installing the available missing packages.
6. Abort if installation would remove anything not declared as a tombstone.
7. Install the available missing packages.
8. Mark every currently installed desired package manual.
9. Select tombstones that dpkg reports as installed or residual configuration.
10. Simulate purging those tombstones.
11. Abort if apt proposes removing any package outside the tombstone set.
12. Perform the explicit purge.
13. Run `apt-get autoremove --purge` and accept apt's orphan calculation
    directly.

Installation precedes explicit purge and orphan cleanup so newly desired
packages establish their dependency trees first. An installation may displace
a conflicting package only when that package is already a tombstone; the later
purge removes any residual configuration.

`autoremove --purge` may remove packages not named as tombstones, but only when
apt marks them automatic and no retained manual package requires them. Desired
manifest packages are manual roots before this cleanup. Dependencies still
required by another retained package remain installed. Software relationships
outside dpkg metadata are not visible to apt; accepting apt's orphan graph is an
explicit part of this design.

The script remains `run_onchange`: synchronization runs when its rendered
content changes, including changes to either package set. Durable tombstones do
not turn the script into a continuously enforced denylist between chezmoi
runs.

## Transaction safety and errors

Potentially destructive simulations run under `LC_ALL=C`. The parser reads
apt-get's simulated `Remv` and `Purg` actions, compares their package set to the
allowed declarations, and fails closed when the output format is not
recognized. Diagnostics print the requested, planned, and unexpected removal
sets.

A purge can expand beyond its explicit arguments when another installed
package depends on a requested tombstone. For example, if `application`
depends on `shared-library`, requesting removal of `shared-library` may make apt
propose removing both. The simulation guard rejects that transaction unless
both names are tombstones.

The same guard applies to installation conflicts. Package availability remains
a warning because repositories can differ across Linux machines. Contradictory
sets, failed simulations, unexpected removals, installation failures, manual
marking failures, purge failures, and autoremove failures make the chezmoi
script fail.

Apt transactions are not atomic across the complete synchronization flow.
Successful installation may precede a later purge-planning failure, and apt
recomputes its plan when the real command executes. The simulation and real
command run consecutively, but another concurrent package manager could change
state between them. Apt's own locks still protect each real transaction.

## Host QA

Verification uses the actual host apt implementation rather than fake commands
or automated unit tests. Because it exercises repositories, root package state,
and network access, it is manual QA and must not be added to pre-commit,
pre-push, or CI pipelines.

The validated host is Ubuntu 26.04. At design time:

- `fortune-mod`, `fortunes-min`, and `librecode3` are absent.
- Installing `fortune-mod` would install `fortunes-min` and `librecode3`.
- Apt proposes no baseline autoremove candidates.

QA uses a temporary copy of the chezmoi source state so the production template
is exercised without modifying the repository or chezmoi's recorded
`run_onchange` state:

1. Require the three fixture packages to be absent.
2. Require `apt-get --simulate autoremove --purge` to propose no removals.
3. Add `fortune-mod` to `apt.install` in the temporary source and run the
   rendered production template on the host.
4. Verify `fortune-mod` is manual and newly installed dependencies are
   automatic.
5. Tombstone `librecode3` while retaining `fortune-mod`; verify the production
   guard rejects the purge because apt also proposes removing `fortune-mod`.
6. Move `fortune-mod` from install to remove and run the template again.
7. Verify `fortune-mod` is purged, its fixture dependencies are autoremoved and
   purged, and apt again proposes no autoremove candidates.

The QA procedure installs a cleanup trap before mutation. On failure, it first
simulates and then purges only the known fixture packages; it does not run a
general host autoremove as blind cleanup. Refreshing apt metadata is an accepted
non-reverted effect.

If fixture state or dependency resolution differs when QA starts, QA aborts
before mutation rather than making assumptions about ownership. The fixture
must be redesigned before proceeding.

## Acceptance criteria

- The manifest has separate `install` and durable `remove` sets with no
  overlap.
- All packages from the former flat list remain desired after migration.
- Desired installed packages are manual roots.
- Installed and residual-config tombstones are purged; absent tombstones are
  no-ops.
- Simulated unexpected removals block installation or explicit purge.
- Successful synchronization automatically purges apt-calculated orphans.
- The host QA completes and restores its fixture packages to their initial
  absent state.
