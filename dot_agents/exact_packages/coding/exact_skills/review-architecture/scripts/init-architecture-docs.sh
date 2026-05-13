#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: init-architecture-docs.sh [--force] [PROJECT_ROOT]

Create the docs/architecture scaffold for the review-architecture skill.

Arguments:
  PROJECT_ROOT  Repository root to initialize. Defaults to the current directory.

Options:
  --force       Overwrite docs/architecture/README.md and AGENTS.md if present.
  -h, --help    Show this help.
USAGE
}

force=0
project_root="."

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      force=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ "$project_root" != "." ]]; then
        echo "Only one PROJECT_ROOT may be provided." >&2
        usage >&2
        exit 2
      fi
      project_root="$1"
      shift
      ;;
  esac
done

architecture_dir="${project_root%/}/docs/architecture"
readme_path="$architecture_dir/README.md"
agents_path="$architecture_dir/AGENTS.md"

if [[ "$force" -eq 0 ]]; then
  for path in "$readme_path" "$agents_path"; do
    if [[ -e "$path" ]]; then
      echo "Refusing to overwrite existing file: $path" >&2
      echo "Re-run with --force to overwrite scaffold-managed files." >&2
      exit 1
    fi
  done
fi

mkdir -p "$architecture_dir/layers" "$architecture_dir/cross-cutting"

cat >"$agents_path" <<'EOF'
# Architecture Docs

Use the `review-architecture` skill whenever making changes to files under this
`docs/architecture/` folder.
EOF

cat >"$readme_path" <<'EOF'
# Architecture Review Log

## Rating Scale

When reviewing a component or layer, pick the tier that best matches your
current confidence. Tiers describe quality and trust, not effort spent -- a
component you barely touched can still be `6 Polished` if it earned the rating.

**Confidence tiers** (set only by an explicit review):

- **1 Broken** -- Doesn't work, violates its contract, or is fundamentally the
  wrong shape. Treat as a known liability.
- **2 Fragile** -- Works in the happy path but breaks under pressure. Hidden
  coupling, missing error handling, or tests that pass for the wrong reasons.
- **3 Rough** -- Functional but awkward. Confusing naming, leaky abstractions, or
  known design flaws. Usable, but easy to misuse.
- **4 Adequate** -- Meets baseline expectations. No glaring issues; trustworthy
  for current use. Not yet refined.
- **5 Solid** -- Well-designed and trustworthy. Reasonable boundaries, clear
  naming, tests cover the important cases. The default "good" rating.
- **6 Polished** -- Refined and pleasant to work with. Clean abstractions,
  thorough tests, robust to edge cases.
- **7 Exemplary** -- A model for the rest of the codebase. Other components
  should be measured against it.

**Meta states** (not confidence tiers):

- `⚪ Unreviewed` -- default for new components; no review has happened yet.
- `🔴 Missing` -- component no longer exists in code; preserved for history. Set
  only on explicit user request.

## Layers

_No layers yet._

## Cross-Cutting Concerns

_None yet._
EOF

echo "Initialized architecture review docs at $architecture_dir"
