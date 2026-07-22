# OS-specific custom package installers design

## Goal

Move the Linux-only television, zoxide, herdr, and Bun installer declarations
out of `run_onchange_before_linux-install-packages.sh.tmpl` and into the
package manifest. Provide the same declarative custom-installer contract for
Linux and macOS while leaving the initial macOS list empty.

## Data contract

Each operating system owns an ordered `custom` list below its existing package
declaration:

```yaml
packages:
  darwin:
    custom: []
  linux:
    custom:
      - name: television
        executable: tv
        install: |
          curl -fsSL https://alexpasmantier.github.io/television/install.sh | bash
      - name: bun
        executable: bun
        setup: |
          export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
          export PATH="$BUN_INSTALL/bin:$PATH"
        install: |
          curl -fsSL https://bun.com/install | bash
```

Every entry has these fields:

- `name`: required non-empty human-readable label for status output.
- `executable`: required non-empty command name checked with `command -v`.
- `setup`: optional shell block executed before the availability check.
- `install`: required non-empty shell block executed only when `executable` is
  unavailable after `setup`.

List order is execution order. The manifest remains trusted configuration, so
`setup` and `install` intentionally support arbitrary shell needed by upstream
installers. The renderer rejects missing or empty required fields during
chezmoi template execution rather than producing an invalid shell script.

The Linux list initially declares television, zoxide, herdr, and Bun with the
same commands and order as the existing inline implementation. Bun's `setup`
retains its non-login-shell `BUN_INSTALL` and `PATH` behavior. The Darwin list
is initially empty because its current tools remain managed by Homebrew.

## Rendering boundary and ordering

A named template in `.chezmoitemplates/` is the sole renderer for the custom
installer contract. It accepts one operating system's `custom` list and emits
an idempotent shell block for every entry:

```bash
# <name>
<optional setup>
if ! command -v <executable> >/dev/null 2>&1; then
  echo "🚀 Installing <name>..."
  <install block>
fi
```

Both existing OS package scripts invoke this shared renderer after their native
package synchronization completes. Linux therefore runs custom installers
after apt synchronization, and macOS runs them after Homebrew synchronization.
This preserves the current Linux ordering and ensures native prerequisites such
as `curl` are provisioned first.

Keeping rendering in the existing scripts also preserves their onchange
semantics: an edit to one OS's custom list changes and reruns that OS's package
script only. The operating-system condition around each script prevents a
Linux declaration from executing on macOS or a macOS declaration from
executing on Linux.

Both generated scripts use `set -euo pipefail`. An entry failure stops the
script and prevents later custom installers from running. `pipefail` ensures a
failed download in a `curl | shell` installer is not hidden by the downstream
shell process.

## Boundaries and verification

Manifest parsing and shell rendering are deterministic. Executable discovery,
network downloads, package managers, and upstream installer scripts are
external effects.

Deterministic shell tests will:

- Render the Linux package script and assert all four declarations are emitted
  from the manifest in declaration order.
- Assert Bun's setup is emitted before its executable check.
- Render the shared template with synthetic custom entries, run the result in
  an isolated temporary directory, and verify setup runs before discovery,
  missing executables trigger installation, and available executables skip it.
- Render a synthetic malformed entry and verify a missing required field fails
  template execution with a descriptive error.
- Render both production package scripts and validate generated shell syntax
  with `bash -n` where the current operating-system condition produces a shell
  script.

Tests use synthetic install commands and temporary fake executables. They do
not invoke apt, Homebrew, a network, upstream installers, or the user's home
directory. Real installer execution remains manual QA and stays outside
pre-commit, pre-push, and CI workflows.

## Scope

This change does not make custom declarations authoritative for uninstalling
software, add retries or upgrade scheduling, move existing Homebrew formulae
into Darwin's custom list, or generalize declarations beyond Linux and macOS.
