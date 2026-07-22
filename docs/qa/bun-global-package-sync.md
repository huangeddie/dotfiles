# Bun global package strict-sync QA

Run manually after rendering the synchronization script. Do not add this QA to
pre-commit, pre-push, or CI because it accesses the npm registry and executes
the production Bun package manager.

```bash
set -euo pipefail
source_dir=$(git rev-parse --show-toplevel)
qa_root=$(mktemp -d)
trap 'rm -rf "$qa_root"' EXIT

chezmoi --source "$source_dir" execute-template \
  -f "$source_dir/run_onchange_after_install-bun-global-packages.sh.tmpl" \
  >"$qa_root/sync.sh"

BUN_INSTALL="$qa_root/bun-home" bun add --global prettier is-number
BUN_INSTALL="$qa_root/bun-home" bash "$qa_root/sync.sh"
BUN_INSTALL="$qa_root/bun-home" bun pm ls --global >"$qa_root/installed.txt"

grep -F 'prettier@' "$qa_root/installed.txt"
if grep -F 'is-number@' "$qa_root/installed.txt"; then
  echo "undeclared Bun package was not removed" >&2
  exit 1
fi
```

Passing QA lists Prettier and does not list `is-number`.
