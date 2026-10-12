export type FileMetric = { path: string; language: string; totalLines: number; complexity: number };
export type Options = {
  directory: string;
  exclusions: string[];
  excludeTests: boolean;
  languages: string[] | null;
  help: boolean;
};
export type SortMetric = "totalLines" | "complexity";
export type DashboardState = { query: string; sort: SortMetric; selectedIndex: number };
export type DashboardAction =
  | { type: "query"; value: string }
  | { type: "sort" }
  | { type: "move"; delta: number };
export type HistogramBin = { label: string; min: number; max: number | null; count: number };
export type MetricSummary = { median: number | null; p90: number | null; bins: HistogramBin[] };
export type Distribution = {
  files: FileMetric[];
  fileCount: number;
  totalLines: number;
  lines: MetricSummary;
  complexity: MetricSummary;
};

export const EXCLUDED_DIRECTORIES: readonly string[] = [
  ".git", ".hg", ".svn", "node_modules", "vendor", ".venv", "venv", "dist", "build", "coverage", "__pycache__",
];
const SOURCE_LANGUAGES = new Set([
  "BASH", "C", "C Header", "C Shell", "C#", "C++", "C++ Header", "Clojure", "ClojureScript",
  "Dart", "Elixir", "Erlang", "F#", "Fish", "Go", "Haskell", "Java", "JavaScript", "Julia",
  "Kotlin", "Lua", "Luau", "OCaml", "Perl", "PHP", "Python", "R", "Ruby", "Rust", "Scala",
  "Shell", "SQL", "Svelte", "Swift", "TypeScript", "TypeScript Typings", "Vue", "Zig", "Zsh",
]);
const TEST_DIRECTORIES = new Set(["test", "tests", "__tests__", "spec", "specs", "qa"]);
const CONFIG_BASENAMES = ["*.config.*", "*.conf.*", ".*rc", ".*rc.*", "dot_*rc", "dot_*profile", "dot_*env", "conftest.py"]
  .map(pattern => new Bun.Glob(pattern));
const TEST_BASENAMES = ["test_*", "*_test.*", "*.test.*", "*.spec.*", "*Test.*"]
  .map(pattern => new Bun.Glob(pattern));

export function parseArgs(args: readonly string[]): Options {
  const options: Options = { directory: ".", exclusions: [], excludeTests: false, languages: null, help: false };
  let hasDirectory = false;
  let endOptions = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!endOptions && arg === "--") {
      endOptions = true;
    } else if (!endOptions && arg === "--help") {
      options.help = true;
    } else if (!endOptions && arg === "--exclude-tests") {
      options.excludeTests = true;
    } else if (!endOptions && (arg === "--exclude" || arg === "--language")) {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${arg} requires a value. See --help for usage.`);
      }
      i++;
      if (arg === "--exclude") options.exclusions.push(value);
      else (options.languages ??= []).push(value);
    } else if (!endOptions && arg.startsWith("-")) {
      throw new Error(`Unknown option ${arg}. See --help for usage; use -- before a dash-prefixed directory.`);
    } else {
      if (hasDirectory) throw new Error("Expected only one directory. See --help for usage.");
      options.directory = arg;
      hasDirectory = true;
    }
  }
  return options;
}

export function selectFiles(files: readonly FileMetric[], options: Options): FileMetric[] {
  const languages = options.languages === null ? SOURCE_LANGUAGES : new Set(options.languages);
  const exclusions = options.exclusions.map(pattern => new Bun.Glob(pattern));
  return files.filter(file => {
    if (!languages.has(file.language) || exclusions.some(glob => glob.match(file.path))) return false;
    const segments = file.path.split("/");
    const basename = segments[segments.length - 1]!;
    if (segments.some(segment => EXCLUDED_DIRECTORIES.includes(segment))) return false;
    if (CONFIG_BASENAMES.some(glob => glob.match(basename))) return false;
    if (options.excludeTests && (
      segments.some(segment => TEST_DIRECTORIES.has(segment)) || TEST_BASENAMES.some(glob => glob.match(basename))
    )) return false;
    return true;
  });
}

const LINE_BINS: readonly Omit<HistogramBin, "count">[] = [
  { label: "0–99", min: 0, max: 99 },
  { label: "100–199", min: 100, max: 199 },
  { label: "200–299", min: 200, max: 299 },
  { label: "300–499", min: 300, max: 499 },
  { label: "500–999", min: 500, max: 999 },
  { label: "1000+", min: 1000, max: null },
];
const COMPLEXITY_BINS: readonly Omit<HistogramBin, "count">[] = [
  { label: "0", min: 0, max: 0 },
  { label: "1–9", min: 1, max: 9 },
  { label: "10–29", min: 10, max: 29 },
  { label: "30–59", min: 30, max: 59 },
  { label: "60–99", min: 60, max: 99 },
  { label: "100+", min: 100, max: null },
];

function summarize(values: number[], definitions: readonly Omit<HistogramBin, "count">[]): MetricSummary {
  values.sort((a, b) => a - b);
  const bins = definitions.map(bin => ({ ...bin, count: 0 }));
  for (const value of values) {
    const bin = bins.find(bin => value >= bin.min && (bin.max === null || value <= bin.max))!;
    bin.count++;
  }
  if (values.length === 0) return { median: null, p90: null, bins };
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 === 0 ? (values[middle - 1]! + values[middle]!) / 2 : values[middle]!;
  return { median, p90: values[Math.ceil(0.9 * values.length) - 1]!, bins };
}

function visibleFiles(files: readonly FileMetric[], query: string): FileMetric[] {
  const needle = query.toLowerCase();
  return files.filter(file => file.path.toLowerCase().includes(needle));
}

export function analyze(files: readonly FileMetric[], query: string, sort: SortMetric): Distribution {
  const visible = visibleFiles(files, query);
  visible.sort((a, b) => b[sort] - a[sort] || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    files: visible,
    fileCount: visible.length,
    totalLines: visible.reduce((total, file) => total + file.totalLines, 0),
    lines: summarize(visible.map(file => file.totalLines), LINE_BINS),
    complexity: summarize(visible.map(file => file.complexity), COMPLEXITY_BINS),
  };
}

export function updateDashboard(state: DashboardState, action: DashboardAction, files: readonly FileMetric[]): DashboardState {
  switch (action.type) {
    case "query": return { ...state, query: action.value, selectedIndex: 0 };
    case "sort": return { ...state, sort: state.sort === "totalLines" ? "complexity" : "totalLines", selectedIndex: 0 };
    case "move": {
      const lastIndex = visibleFiles(files, state.query).length - 1;
      return { ...state, selectedIndex: Math.max(0, Math.min(lastIndex, state.selectedIndex + action.delta)) };
    }
  }
}

export function displayPath(path: string): string {
  return path.replace(/[\u0000-\u001f\u007f-\u009f]/g, character => {
    if (character === "\n") return "\\n";
    if (character === "\r") return "\\r";
    if (character === "\t") return "\\t";
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}
