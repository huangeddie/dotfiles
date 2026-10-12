import { expect, test } from "bun:test";
import {
  analyze, displayPath, EXCLUDED_DIRECTORIES, parseArgs, selectFiles, updateDashboard,
  type DashboardState, type FileMetric, type Options,
} from "../dot_config/grain/model";

function file(path: string, language = "TypeScript", totalLines = 10, complexity = 1): FileMetric {
  return { path, language, totalLines, complexity };
}
function options(patch: Partial<Options> = {}): Options {
  return { directory: ".", exclusions: [], excludeTests: false, languages: null, help: false, ...patch };
}
const lineBins = [
  { label: "0–99", min: 0, max: 99 },
  { label: "100–199", min: 100, max: 199 },
  { label: "200–299", min: 200, max: 299 },
  { label: "300–499", min: 300, max: 499 },
  { label: "500–999", min: 500, max: 999 },
  { label: "1000+", min: 1000, max: null },
];
const complexityBins = [
  { label: "0", min: 0, max: 0 },
  { label: "1–9", min: 1, max: 9 },
  { label: "10–29", min: 10, max: 29 },
  { label: "30–59", min: 30, max: 59 },
  { label: "60–99", min: 60, max: 99 },
  { label: "100+", min: 100, max: null },
];

test("parseArgs defaults to cwd, source languages and retaining tests", () => {
  expect(parseArgs([])).toEqual(options());
});

test("parseArgs accepts a target and repeatable exclusions and language replacements", () => {
  expect(parseArgs(["--exclude", "generated/**", "repo space", "--language", "Go Template", "--exclude-tests", "--exclude", "**/*.tmp", "--language", "JSON"]))
    .toEqual(options({ directory: "repo space", exclusions: ["generated/**", "**/*.tmp"], excludeTests: true, languages: ["Go Template", "JSON"] }));
});

test("parseArgs recognizes help without needing a target", () => {
  expect(parseArgs(["--help"])).toEqual(options({ help: true }));
});

test("parseArgs ends option parsing at -- and accepts a dash-prefixed target", () => {
  expect(parseArgs(["--", "-repo"])).toEqual(options({ directory: "-repo" }));
  expect(parseArgs(["--", "--help"])).toEqual(options({ directory: "--help" }));
  expect(parseArgs(["--"])).toEqual(options());
});

for (const args of [["--wat"], ["-repo"], ["--exclude=x"], ["--language=JSON"]]) {
  test(`parseArgs rejects unknown option ${args[0]} with help guidance`, () => {
    expect(() => parseArgs(args)).toThrow(/unknown option.*--help/i);
  });
}
for (const option of ["--exclude", "--language"]) {
  for (const tail of [[], ["--help"], ["--"], [""]]) {
    test(`parseArgs rejects missing ${option} value before ${JSON.stringify(tail)}`, () => {
      expect(() => parseArgs([option, ...tail])).toThrow(new RegExp(`${option}.*requires`, "i"));
    });
  }
}

test("parseArgs rejects two targets even after --", () => {
  expect(() => parseArgs(["one", "two"])).toThrow(/one directory/i);
  expect(() => parseArgs(["one", "--", "-two"])).toThrow(/one directory/i);
});

const sourceLanguages = [
  "BASH", "C", "C Header", "C Shell", "C#", "C++", "C++ Header", "Clojure", "ClojureScript",
  "Dart", "Elixir", "Erlang", "F#", "Fish", "Go", "Haskell", "Java", "JavaScript", "Julia",
  "Kotlin", "Lua", "Luau", "OCaml", "Perl", "PHP", "Python", "R", "Ruby", "Rust", "Scala",
  "Shell", "SQL", "Svelte", "Swift", "TypeScript", "TypeScript Typings", "Vue", "Zig", "Zsh",
];

test("selectFiles includes the exact source allowlist, including extensionless Shell", () => {
  const files = sourceLanguages.map((language, i) => file(`src/${i}`, language));
  expect(selectFiles(files, options())).toEqual(files);
  expect(selectFiles([file("bin/run", "Shell"), file("src/app.ts")], options()))
    .toEqual([file("bin/run", "Shell"), file("src/app.ts")]);
});

test("selectFiles excludes data, markup, templates and unknown languages by default", () => {
  const files = ["JSON", "YAML", "TOML", "Markdown", "CSS", "HTML", "Go Template", "Unknown", "typescript"]
    .map((language, i) => file(`src/${i}.ts`, language));
  expect(selectFiles(files, options())).toEqual([]);
});

test("selectFiles replaces rather than extends the allowlist for explicit languages", () => {
  const files = [file("data.json", "JSON"), file("page.tmpl", "Go Template"), file("app.ts")];
  expect(selectFiles(files, options({ languages: ["JSON", "Go Template"] }))).toEqual(files.slice(0, 2));
});

const excludedDirectories = [".git", ".hg", ".svn", "node_modules", "vendor", ".venv", "venv", "dist", "build", "coverage", "__pycache__"];
test("EXCLUDED_DIRECTORIES exports the exact scanner exclusion policy", () => {
  expect(EXCLUDED_DIRECTORIES).toEqual(excludedDirectories);
});
for (const directory of excludedDirectories) {
  test(`selectFiles excludes ${directory} at any depth, not partial segments`, () => {
    const files = [file(`${directory}/a.ts`), file(`src/${directory}/a.ts`), file(`src/${directory}-code/a.ts`)];
    expect(selectFiles(files, options())).toEqual([files[2]!]);
  });
}

for (const basename of ["vite.config.ts", "server.conf.py", ".bashrc", ".eslintrc.js", "dot_bashrc", "dot_zprofile", "dot_zshenv", "conftest.py"]) {
  test(`selectFiles excludes configuration basename ${basename}`, () => {
    expect(selectFiles([file(basename), file(`nested/${basename}`)], options())).toEqual([]);
  });
}

test("selectFiles applies excluded path segments to extensionless source filenames too", () => {
  expect(selectFiles([file("src/build", "Shell"), file("vendor", "Shell")], options())).toEqual([]);
  const files = [file("src/test", "Shell"), file("qa", "Shell")];
  expect(selectFiles(files, options())).toEqual(files);
  expect(selectFiles(files, options({ excludeTests: true }))).toEqual([]);
});

test("selectFiles matches config basenames only, and does not hard-code Neovim exclusions", () => {
  const files = [file("vite.config.ts/app.ts"), file("src/profile.ts"), file("src/env.ts"), file("dot_config/nvim/init.lua", "Lua")];
  expect(selectFiles(files, options())).toEqual(files);
  expect(selectFiles(files, options({ exclusions: ["dot_config/nvim/**"] }))).toEqual(files.slice(0, 3));
});

for (const path of ["test/a.ts", "tests/a.ts", "__tests__/a.ts", "spec/a.ts", "specs/a.ts", "qa/a.ts", "test_app.py", "app_test.go", "app.test.ts", "app.spec.ts", "AppTest.java"]) {
  test(`selectFiles retains ${path} by default and excludes it with excludeTests`, () => {
    const files = [file(path), file(`nested/${path}`)];
    expect(selectFiles(files, options())).toEqual(files);
    expect(selectFiles(files, options({ excludeTests: true }))).toEqual([]);
  });
}

test("selectFiles test matching is case-sensitive and limited to segments and basenames", () => {
  const files = ["Tests/a.ts", "QA/a.ts", "testing/a.ts", "specimen/a.ts", "Test_app.py", "app.TEST.ts", "Apptest.java", "app.test.ts/code.ts"]
    .map(path => file(path));
  expect(selectFiles(files, options({ excludeTests: true }))).toEqual(files);
});

test("selectFiles explicit Bun globs win over language overrides and retain unmatched paths", () => {
  const files = [file("generated/a.json", "JSON"), file("src/a.json", "JSON"), file("src/b.json", "JSON"), file("src/c.json", "JSON")];
  expect(selectFiles(files, options({ languages: ["JSON"], exclusions: ["generated/**", "src/{a,b}.json"] })))
    .toEqual([files[3]!]);
});

test("selectFiles language overrides cannot bypass directory, config or test exclusions", () => {
  const files = [file("vendor/a.json", "JSON"), file("a.config.json", "JSON"), file("qa/a.json", "JSON")];
  expect(selectFiles(files, options({ languages: ["JSON"], excludeTests: true }))).toEqual([]);
});

test("analyze counts total-line boundaries in six inclusive bins", () => {
  const files = [0, 99, 100, 199, 200, 299, 300, 499, 500, 999, 1000].map((n, i) => file(`${i}.ts`, "TypeScript", n));
  const result = analyze(files, "", "totalLines");
  expect(result.lines.bins).toEqual(lineBins.map((bin, i) => ({ ...bin, count: [2, 2, 2, 2, 2, 1][i] })));
  expect(result.fileCount).toBe(11);
  expect(result.totalLines).toBe(4195);
});

test("analyze keeps zero complexity distinct and counts all complexity boundaries", () => {
  const files = [0, 1, 9, 10, 29, 30, 59, 60, 99, 100].map((n, i) => file(`${i}.ts`, "TypeScript", 0, n));
  expect(analyze(files, "", "complexity").complexity.bins)
    .toEqual(complexityBins.map((bin, i) => ({ ...bin, count: [1, 2, 2, 2, 2, 1][i] })));
});

test("analyze averages even medians and uses nearest-rank p90 for both metrics", () => {
  const files = [1, 2, 3, 4].map(n => file(`${n}.ts`, "TypeScript", n, n));
  const result = analyze(files, "", "totalLines");
  expect(result.lines).toMatchObject({ median: 2.5, p90: 4 });
  expect(result.complexity).toMatchObject({ median: 2.5, p90: 4 });
});

test("analyze chooses rank nine for ten values and handles odd and singleton medians", () => {
  const files = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => file(`${n}.ts`, "TypeScript", n, n));
  expect(analyze(files, "", "totalLines").lines).toMatchObject({ median: 5.5, p90: 9 });
  expect(analyze(files.slice(0, 3), "", "totalLines").lines).toMatchObject({ median: 2, p90: 3 });
  expect(analyze([file("zero.ts", "TypeScript", 0, 0)], "", "totalLines").complexity).toMatchObject({ median: 0, p90: 0 });
});

test("analyze empty input yields null percentiles, six zero bins per metric and total zero", () => {
  expect(analyze([], "", "totalLines")).toEqual({
    files: [], fileCount: 0, totalLines: 0,
    lines: { median: null, p90: null, bins: lineBins.map(bin => ({ ...bin, count: 0 })) },
    complexity: { median: null, p90: null, bins: complexityBins.map(bin => ({ ...bin, count: 0 })) },
  });
});

test("analyze applies a case-insensitive literal path query to rows and every aggregate", () => {
  const files = [file("src/[UI].ts", "TypeScript", 100, 9), file("src/[ui].tsx", "TypeScript", 300, 30), file("src/U.ts", "TypeScript", 9000, 100)];
  const result = analyze(files, "[ui]", "totalLines");
  expect(result).toEqual({
    files: [files[1]!, files[0]!], fileCount: 2, totalLines: 400,
    lines: { median: 200, p90: 300, bins: lineBins.map((bin, i) => ({ ...bin, count: [0, 1, 0, 1, 0, 0][i] })) },
    complexity: { median: 19.5, p90: 30, bins: complexityBins.map((bin, i) => ({ ...bin, count: [0, 1, 0, 1, 0, 0][i] })) },
  });
  expect(analyze(files, "*", "totalLines")).toEqual(analyze([], "", "totalLines"));
  expect(analyze(files, "TypeScript", "totalLines").fileCount).toBe(0);
});

test("analyze sorts descending by selected metric, ties by ascending path", () => {
  const files = [file("z.ts", "TypeScript", 10, 5), file("b.ts", "TypeScript", 20, 0), file("a.ts", "TypeScript", 10, 5)];
  expect(analyze(files, "", "totalLines").files.map(f => f.path)).toEqual(["b.ts", "a.ts", "z.ts"]);
  expect(analyze(files, "", "complexity").files.map(f => f.path)).toEqual(["a.ts", "z.ts", "b.ts"]);
  expect(analyze([...files].reverse(), "", "complexity").files.map(f => f.path)).toEqual(["a.ts", "z.ts", "b.ts"]);
});

const state: DashboardState = { query: "", sort: "totalLines", selectedIndex: 2 };
const rows = [file("a.ts"), file("b.ts"), file("c.ts")];
test("updateDashboard query resets selection and keeps sort", () => {
  expect(updateDashboard(state, { type: "query", value: "b" }, rows))
    .toEqual({ query: "b", sort: "totalLines", selectedIndex: 0 });
  expect(updateDashboard({ ...state, query: "missing" }, { type: "query", value: "" }, rows))
    .toEqual({ query: "", sort: "totalLines", selectedIndex: 0 });
});

test("updateDashboard toggles sort in both directions and resets selection", () => {
  expect(updateDashboard({ ...state, query: "b" }, { type: "sort" }, rows))
    .toEqual({ query: "b", sort: "complexity", selectedIndex: 0 });
  expect(updateDashboard({ ...state, sort: "complexity" }, { type: "sort" }, rows))
    .toEqual({ query: "", sort: "totalLines", selectedIndex: 0 });
});

test("updateDashboard movement clamps to visible bounds, including empty results", () => {
  expect(updateDashboard(state, { type: "move", delta: -1 }, rows).selectedIndex).toBe(1);
  expect(updateDashboard({ ...state, selectedIndex: 0 }, { type: "move", delta: 1 }, rows).selectedIndex).toBe(1);
  expect(updateDashboard(state, { type: "move", delta: 100 }, rows).selectedIndex).toBe(2);
  expect(updateDashboard(state, { type: "move", delta: -100 }, rows).selectedIndex).toBe(0);
  expect(updateDashboard({ ...state, query: "b" }, { type: "move", delta: 1 }, rows).selectedIndex).toBe(0);
  expect(updateDashboard({ ...state, query: "missing" }, { type: "move", delta: -1 }, rows).selectedIndex).toBe(0);
  expect(updateDashboard(state, { type: "move", delta: 1 }, []).selectedIndex).toBe(0);
});

test("model transformations never mutate input arrays, metrics, options or state", () => {
  const files = Object.freeze([Object.freeze(file("b.ts")), Object.freeze(file("a.ts"))]);
  const original = JSON.stringify(files);
  const opts = options({ exclusions: ["generated/**"], languages: ["TypeScript"] });
  Object.freeze(opts.exclusions);
  Object.freeze(opts.languages);
  Object.freeze(opts);
  expect(selectFiles(files, opts)).not.toBe(files);
  expect(analyze(files, "", "totalLines").files.map(f => f.path)).toEqual(["a.ts", "b.ts"]);
  updateDashboard(Object.freeze(state), { type: "move", delta: -1 }, files);
  expect(state).toEqual({ query: "", sort: "totalLines", selectedIndex: 2 });
  expect(JSON.stringify(files)).toBe(original);
  const args = Object.freeze(["repo", "--language", "JSON"]);
  parseArgs(args);
  expect(args).toEqual(["repo", "--language", "JSON"]);
});

test("displayPath escapes terminal controls but preserves Unicode and original identity", () => {
  const path = "src/\u001b[31mhello\n世界-é.ts";
  expect(displayPath(path)).toBe("src/\\u001b[31mhello\\n世界-é.ts");
  expect(displayPath("a\t\rb\u0000\u007f\u0085\u009f")).toBe("a\\t\\rb\\u0000\\u007f\\u0085\\u009f");
  const metric = file(path);
  expect(analyze([metric], "\u001b", "totalLines").files[0]?.path).toBe(path);
});

test("displayPath escapes every C0, DEL and C1 code point and no ordinary Unicode", () => {
  for (const code of [...Array.from({ length: 32 }, (_, i) => i), ...Array.from({ length: 33 }, (_, i) => 127 + i)]) {
    expect(displayPath(String.fromCharCode(code))).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  }
  expect(displayPath("src/世界/é 😀.ts")).toBe("src/世界/é 😀.ts");
});
