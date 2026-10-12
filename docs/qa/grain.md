# grain: usage and discretionary QA

`grain` scans once, then shows source-file size and **estimated** complexity
histograms and a sortable file list. It does not watch, cache, edit files, or
require Git. Physical total lines include comments and blank lines; complexity
is scc's estimate, not exact cyclomatic complexity. Every statistic and histogram
reflects the same path-query-filtered file set. Median averages the middle pair;
p90 uses nearest rank. Empty percentiles display `—` and zero bins remain visible.

## Usage

Requires Bun >=1.3.0, scc, local OpenTUI dependencies, and a terminal on **both**
stdin and stdout. Dependencies are installed by chezmoi, never at invocation.

```sh
grain                        # current working directory
grain /path/to/source         # grain [directory]
grain . --exclude-tests       # tests and QA are included by default
grain . --language Python --language 'C Header' # replace the default allowlist
grain . --exclude 'generated/**' --exclude 'scratch/**'
grain . --exclude 'dot_config/nvim/**'          # useful in this dotfiles repo
grain -- -directory           # end options before a dash-prefixed directory
grain --help                  # no scc/dependencies/TTY needed (Bun still needed)
```

`--exclude GLOB` is repeatable, case-sensitive, root-relative **Bun.Glob** syntax;
quote it to prevent shell expansion. Explicit exclusions always win. In contrast,
the interactive `/` query is a case-insensitive **literal substring**, not a glob.
Query changes never rescan the directory.

Keys: ↑/↓ or j/k navigate, s toggles total lines/estimated complexity descending,
`/` focuses search, Enter returns to rows preserving the query, Escape clears it,
q quits outside search, Ctrl+C quits everywhere (including scanning). In search,
q/s/j/k are ordinary input. PageUp/PageDown and mouse scrolling move the outer
viewport on short terminals. Charts stack below 100 columns. Long list entries
are clipped visually; the selected path is also shown wrapped below the list.
Displayed terminal controls are escaped; underlying path identity is unchanged.

## Source selection and limitations

Default scc language-name allowlist:

BASH, C, C Header, C Shell, C#, C++, C++ Header, Clojure, ClojureScript,
Dart, Elixir, Erlang, F#, Fish, Go, Haskell, Java, JavaScript, Julia, Kotlin,
Lua, Luau, OCaml, Perl, PHP, Python, R, Ruby, Rust, Scala, Shell, SQL, Svelte,
Swift, TypeScript, TypeScript Typings, Vue, Zig, Zsh.

Other languages (including JSON, YAML, TOML, Markdown, CSS, HTML, and Go Template)
are excluded unless explicitly selected with repeatable `--language NAME`.
Names match scc exactly; recognized extensionless scripts can be included.

Normal scc ignore behavior is inherited, without following symlinks or loading
scc user/project configuration. Directory segments `.git`, `.hg`, `.svn`,
`node_modules`, `vendor`, `.venv`, `venv`, `dist`, `build`, `coverage`, and
`__pycache__` are excluded. Files flagged by scc as binary, generated, or minified
are excluded. These are heuristics: unmarked generated source needs an explicit
exclusion.

Configuration basenames `*.config.*`, `*.conf.*`, `.*rc`, `.*rc.*`, `dot_*rc`,
`dot_*profile`, `dot_*env`, and `conftest.py` are excluded. Ordinary code used as
configuration cannot reliably be classified by syntax. The Neovim subtree is
**not** hard-coded as an exclusion; use the repository example above.

`--exclude-tests` excludes segments `test`, `tests`, `__tests__`, `spec`, `specs`,
`qa`, and basenames `test_*`, `*_test.*`, `*.test.*`, `*.spec.*`, `*Test.*`.
All these source-policy path matches are case-sensitive.

## Deployment preview — human approval required

Standard chezmoi deployment is `~/.config/grain` and `~/.local/bin/grain`. The
launcher resolves `${XDG_CONFIG_HOME:-$HOME/.config}/grain` without changing cwd.
If using a custom XDG_CONFIG_HOME, make the managed app **and its node_modules**
available there yourself; the installer still targets `~/.config/grain`.
Both `packagePolicy.deniedPrefixes` and legacy `blocked_prefixes` can suppress
the dependency installer by denying `bun`, `scc`, or `@opentui/core` prefixes.
There is no global Bun `grain` package.

From the source checkout, preview only the intended targets (explicit files avoid
source-path directory recursion differences between chezmoi versions):

```sh
git diff -- .gitignore .chezmoiignore
chezmoi --no-pager --refresh-externals=never diff --source-path \
  dot_local/bin/executable_grain dot_config/grain/*.ts \
  dot_config/grain/package.json dot_config/grain/bun.lock \
  dot_config/grain/tsconfig.json run_onchange_after_install-grain-dependencies.sh.tmpl
```

Inspect **all removals** and the rendered installer. Only after approving that
preview, the human may run the equivalent scoped `chezmoi apply --source-path`
with those same explicit target arguments. Do not run an unscoped apply just for
grain. The dependency script performs a frozen local Bun install after the app
files are deployed. No apply is part of automated QA.

## Deterministic checks

```sh
bun test tests/grain-*.test.ts
bun install --cwd dot_config/grain --frozen-lockfile
bun run --cwd dot_config/grain typecheck
git diff --check
```

Unit tests use fixed data and fake runners only. UI/configuration is exempt from
RED tests. Do not add real package installs, subprocess scans, or rendered UI QA
to these tests, CI, or hooks.

## Discretionary integration checks

On each intended OS, record Bun and scc versions, then:

- Run scc from both this checkout and a temporary **non-Git** source directory:
  `scc --no-config --by-file --format json --no-min-gen --exclude-dir '.git,.hg,.svn,node_modules,vendor,.venv,venv,dist,build,coverage,__pycache__' .`.
  Compare normalized path, `Lines`, and `Complexity` with grain; a comment/blank
  fixture should confirm physical rather than code-only line counts.
- Check help without scc or dependencies, nonexistent and non-directory targets,
  missing scc, malformed JSON, and nonzero scanner exits with escaped diagnostics.
  Check piped stdin and stdout rejection separately. Use temporary PATH shims,
  not modifications to the actual installed tools.
- Cancel during a slow scan; verify the child is gone. Exercise large stdout and
  stderr to check concurrent draining. Verify launcher argv/cwd from paths with
  spaces and custom XDG resolution.
- Render the installer with allowed and denied new/legacy prefixes for each of
  bun, scc, and @opentui/core. Denied output must not install anything or require
  network. Inspect hashes and `--frozen-lockfile` on the allowed output.

## Human terminal checklist (after approved deployment)

Please verify in your actual terminal:

- Startup, summary values, all numeric bin counts, independent histogram scales,
  descending initial line sort, and deterministic path ties.
- Every advertised key, both arrow and j/k navigation, s sorting, `/` typing
  **q/s/j/k** without shortcuts, Enter retaining search, Escape clearing it,
  zero-result search and recovery, and q/Ctrl+C graceful exit.
- Resize across 100 columns and to a short terminal; scroll to all regions,
  navigate long lists, and inspect long/control-containing paths safely.
- Terminal echo, cursor, colors, and normal shell input are restored after quit,
  Ctrl+C, and a forced scanner/error path.

A synthetic PTY smoke check is not human visual verification. Report Linux and
macOS separately; success on one platform does not verify the other.
