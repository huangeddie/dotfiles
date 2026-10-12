import { posix as path } from "node:path";
import { displayPath, EXCLUDED_DIRECTORIES, selectFiles, type FileMetric, type Options } from "./model";

export type ProcessRequest = { argv: readonly string[]; cwd: string };
export type ProcessResult = { exitCode: number; stdout: string; stderr: string };
export type ProcessRunner = { run(request: ProcessRequest): Promise<ProcessResult> };

function diagnostic(message: string): string {
  const escaped = displayPath(message);
  const suffix = "… [truncated]";
  return escaped.length <= 4096 ? escaped : escaped.slice(0, 4096 - suffix.length) + suffix;
}

function invalidOutput(detail: string, cause?: unknown): Error {
  return new Error(diagnostic(`Invalid scc output: ${detail}. Check the installed scc version and its --by-file JSON output.`), { cause });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw invalidOutput(`${field} must be a nonempty string`);
  return value;
}

function metric(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidOutput(`${field} must be a nonnegative safe integer`);
  }
  return value;
}

export function decodeMetrics(output: string, root: string): FileMetric[] {
  let groups: unknown;
  try {
    groups = JSON.parse(output);
  } catch (cause) {
    throw invalidOutput("expected valid JSON", cause);
  }
  if (!Array.isArray(groups)) throw invalidOutput("expected an array of language groups");
  const files: FileMetric[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group.Files)) throw invalidOutput("each language group must have a Files array");
    for (const record of group.Files) {
      if (!isRecord(record)) throw invalidOutput("each Files entry must be an object");
      const location = text(record.Location, "Location");
      // macOS/Linux paths are lexical here: filesystem and symlink handling belong to the process boundary.
      const relative = path.relative(root, path.resolve(root, location));
      if (location.includes("\0") || relative === "" || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
        throw invalidOutput("Location must name a file within the scan root");
      }
      if (seen.has(relative)) throw invalidOutput(`duplicate normalized Location ${relative}`);
      seen.add(relative);
      const file: FileMetric = {
        path: relative,
        language: text(record.Language, "Language"),
        totalLines: metric(record.Lines, "Lines"),
        complexity: metric(record.Complexity, "Complexity"),
      };
      let flagged = false;
      for (const flag of ["Binary", "Generated", "Minified"]) {
        if (flag in record && typeof record[flag] !== "boolean") throw invalidOutput(`${flag} must be a boolean when present`);
        if (record[flag] === true) flagged = true;
      }
      if (!flagged) files.push(file);
    }
  }
  return files;
}

export async function scan(root: string, options: Options, runner: ProcessRunner): Promise<FileMetric[]> {
  let result: ProcessResult;
  try {
    result = await runner.run({
      argv: ["scc", "--no-config", "--by-file", "--format", "json", "--no-min-gen", "--exclude-dir", EXCLUDED_DIRECTORIES.join(","), "."],
      cwd: root,
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(diagnostic(`Could not run scc. Ensure scc is installed on PATH and the scan directory is accessible: ${detail}`), { cause });
  }
  if (result.exitCode !== 0) {
    throw new Error(diagnostic(`scc exited with status ${result.exitCode}. Check scan permissions and scc diagnostics: ${result.stderr || "no stderr provided"}`));
  }
  return selectFiles(decodeMetrics(result.stdout, root), options);
}
