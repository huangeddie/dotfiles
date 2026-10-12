# grain: current-state source distributions

## Intent and approved scope

Develop and distribute `grain` in this chezmoi repository, but run it against any directory. The user wants to understand distributions of source-file size and estimated complexity and inspect outliers, not just see totals. Use total physical lines, including comments and blanks, not code-only lines. Include tests and QA by default, with an exclusion option. No history, watching, caching, automatic dependency installation at invocation, or editing analyzed files.

The approved interface is a single OpenTUI screen: summary, side-by-side size/complexity histograms, then a sortable file list. The approved architecture separates the scanner, deterministic analysis, and rendering. Bun and `scc` are external prerequisites; `scc` is already in the base package catalog on macOS and Linux.

## Data and interfaces

Normalize scc's per-file JSON to `FileMetric { path: string; language: string; totalLines: number; complexity: number }`. Paths are root-relative with `/` separators. Both numeric fields must be finite, nonnegative safe integers. Keep scc's complexity estimate as reported, including zero; never call it exact cyclomatic complexity. No database is needed.

Use `scc --no-config --by-file --format json --no-min-gen` with the chosen directory as process cwd and `.` as its explicit target. Inherit normal scc ignore behavior, do not follow symlinks, and never execute a shell to construct this command. Disabling scc config discovery prevents unrelated per-user scanner flags from silently changing the contract.

The scanner accepts a narrow injected process runner and parses only the fields it consumes; additive JSON fields are accepted. Missing/invalid fields, invalid JSON, missing executable, and nonzero exit are actionable failures, not empty results. An empty JSON array is valid. Do not guess around incompatible output. Report scanner stderr on failure, with a bounded diagnostic and terminal controls removed. Validate paths stay within the requested root. No Git dependency: non-Git directories work too.

Pure analysis consumes normalized metrics and produces counts, total lines, median and p90 for both metrics, fixed buckets, and sorted rows. Median averages the middle two values; p90 uses nearest rank (`ceil(0.9*n)-1`). Empty percentiles are null and display as an em dash. Histograms count files, not lines. Sorting is descending on the selected metric with ascending path as the deterministic tie-breaker. Do not mutate input arrays.

## Selection policy

Source-only selection is explicit and conservative, not a promise of perfect semantic classification. Filter by scc language names, not solely filename extensions, preserving extensionless scripts that scc recognizes.

Initial programming-language allowlist: BASH, C, C Header, C Shell, C#, C++, C++ Header, Clojure, ClojureScript, Dart, Elixir, Erlang, F#, Fish, Go, Haskell, Java, JavaScript, Julia, Kotlin, Lua, Luau, OCaml, Perl, PHP, Python, R, Ruby, Rust, Scala, Shell, SQL, Svelte, Swift, TypeScript, TypeScript Typings, Vue, Zig, Zsh. Exclude other languages, including JSON, YAML, TOML, Markdown, CSS, HTML, and Go Template. Document this list and permit repeatable `--language NAME` to replace it with explicitly selected scc language names.

Exclude these path segments: `.git`, `.hg`, `.svn`, `node_modules`, `vendor`, `.venv`, `venv`, `dist`, `build`, `coverage`, `__pycache__`. Pass these to scc to avoid scanning dependencies and enforce the policy on normalized output too. Exclude files scc identifies as generated, minified, or binary. These detections are heuristic; unmarked generated source needs explicit exclusions.

Exclude common source-language configuration basenames: `*.config.*`, `*.conf.*`, `.*rc`, `.*rc.*`, `dot_*rc`, `dot_*profile`, `dot_*env`, and `conftest.py`. Exclude the path subtree `dot_config/nvim/` in this repository only through the documented `--exclude` option, not a hard-coded global rule: general Lua paths may contain application code. Explain that configuration written as ordinary code cannot be identified reliably from syntax alone.

`--exclude-tests` removes path segments `test`, `tests`, `__tests__`, `spec`, `specs`, `qa`, plus basenames `test_*`, `*_test.*`, `*.test.*`, `*.spec.*`, and `*Test.*`. Matching is case-sensitive. The default retains them.

`--exclude GLOB` is repeatable and matches root-relative paths with Bun.Glob semantics, e.g. `--exclude 'generated/**'`. An explicit exclusion always wins. The interactive path query is a case-insensitive literal substring applied after source selection, not a glob.

## Interface and CLI

Invocation: `grain [directory] [--exclude GLOB] [--exclude-tests] [--language NAME]`; default directory is the invocation cwd. Support `--help` without launching the renderer and `--` to end options. Reject unknown options, missing values, multiple directories, nonexistent/non-directory targets, and non-TTY invocation with clear stderr and nonzero status.

Top: visible file count, total lines, median/p90 lines, median/p90 estimated complexity. Middle: histograms labeled `Total lines` and `Estimated complexity`. Bottom: path, language, total lines, complexity. First sort is total lines descending. Statistics, bins, and rows always reflect the same filtered set.

Total-line bins: 0–99, 100–199, 200–299, 300–499, 500–999, 1000+.
Complexity bins: 0, 1–9, 10–29, 30–59, 60–99, 100+.
Render proportional horizontal bars with numeric file counts, including zero bins. Escape terminal controls in displayed paths while retaining original path identity.

Keys: arrows/j/k move through rows; `s` toggles lines/complexity; `/` focuses the query input; Enter returns to rows keeping the query; Escape clears the query and returns to rows; `q` quits when not editing the query; Ctrl+C quits everywhere. Query typing must not trigger global letter shortcuts. Clamp selection on filtering; empty results show a concise empty state, not an error. No file opener or drill-down in v1.

Run one scan at startup before mounting the dashboard, with a short scanning indication. On narrow terminals stack histograms; use a scrollable layout so short terminals remain usable. Restore terminal state on quit and unexpected errors. Keep labels brief and avoid decorative nested borders. No continuous refresh.

## File structure and effects

- `dot_config/grain/model.ts`: normalized contracts, source filtering, CLI options, pure analysis and dashboard state transformations.
- `dot_config/grain/scanner.ts`: scc JSON adapter and injected process boundary.
- `dot_config/grain/main.ts`: composition root; real subprocess/filesystem/TTY adapters, CLI entry and renderer lifecycle.
- `dot_config/grain/ui.ts`: OpenTUI rendering and event cleanup only.
- `dot_config/grain/package.json`, `bun.lock`: pinned local runtime dependency and lockfile.
- `dot_local/bin/executable_grain`: launcher preserving cwd and forwarding arguments, following `executable_todoist-add`.
- `run_onchange_after_install-grain-dependencies.sh.tmpl`: frozen Bun installation after deployed files, following the Todoist installer.
- `tests/grain-model.test.ts`, `tests/grain-scanner.test.ts`: fast deterministic unit tests with practical fakes.
- `docs/qa/grain.md`: discretionary integration and human-driven TUI checks.

Use Bun >=1.3.0 and pinned `@opentui/core` 0.5.12, matching the existing Todoist application. Do not introduce a React/Solid wrapper or a runtime validation library. Use a local strict TypeScript config and pinned development typing/compiler dependencies if required for a reproducible typecheck.

The launcher resolves its app from `${XDG_CONFIG_HOME:-$HOME/.config}/grain`, checks Bun, scc and local OpenTUI dependencies, and runs Bun with `--no-install`; it never changes cwd. For custom XDG_CONFIG_HOME, document that the managed files must be available there; standard chezmoi deployment is `~/.config/grain` as in the existing application.

The dependency installer includes package/lock hashes and honors both packagePolicy.deniedPrefixes and legacy blocked_prefixes for `bun`, `scc`, and `@opentui/core`. Update Git and chezmoi ignore files for the local node_modules directory. Do not refactor the existing Todoist installer or change unrelated dependencies.

## Verification

Track A: contracts/stubs and focused failing unit tests for parsing, filtering, summary statistics, bucket boundaries, stable sorting, query state and argument validation. Track B: implementations until those tests pass. Commit both tracks together per independently verified deliverable. Pure config, deployment wiring and UI are exempt from red-green unit tests.

Tests use fixed hand-written metrics and fake process outcomes, not timings, random sampling, a real subprocess, filesystem fixtures at runtime, or rendered UI. Existing repository tests that execute real tools remain integration checks, not examples for new unit tests.

QA is manual/discretionary, never added to hooks or CI: compare scc JSON with grain's normalized metrics, exercise missing prerequisites and scan errors, verify launch cwd/path forwarding, inspect a scoped chezmoi diff, and check resize, navigation, path filtering, empty states and cleanup in the actual terminal. Ask for human help for interactive verification. Linux and macOS compatibility requires checks on the respective machines; do not claim Linux verified from macOS.
