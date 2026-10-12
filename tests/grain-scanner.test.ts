import { expect, test } from "bun:test";
import { EXCLUDED_DIRECTORIES, parseArgs } from "../dot_config/grain/model";
import {
  decodeMetrics, scan, type ProcessRequest, type ProcessResult, type ProcessRunner,
} from "../dot_config/grain/scanner";

const root = "/projects/repo";
function record(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { Location: "src/main.ts", Language: "TypeScript", Lines: 30, Code: 12, Complexity: 3, ...patch };
}
function output(...files: Record<string, unknown>[]): string {
  return JSON.stringify([{ Name: "TypeScript", Files: files }]);
}
function success(stdout = "[]"): ProcessResult {
  return { exitCode: 0, stdout, stderr: "" };
}
class RecordingRunner implements ProcessRunner {
  readonly requests: ProcessRequest[] = [];
  constructor(private readonly outcomes: (ProcessResult | Error)[]) {}
  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    const outcome = this.outcomes.shift();
    if (!outcome) throw new Error("Fake runner exhausted");
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}
async function scanError(runner: ProcessRunner): Promise<Error> {
  try {
    await scan(root, parseArgs([]), runner);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("Expected scan to reject");
}

test("decodeMetrics uses physical Lines and per-file Language, ignores additive fields and keeps zero", () => {
  const json = JSON.stringify([{ Name: "ignored group name", Extra: true, Files: [
    record({ Extra: { future: true } }),
    record({ Location: "bin/run", Language: "Shell", Lines: 0, Complexity: 0 }),
  ] }]);
  expect(decodeMetrics(json, root)).toEqual([
    { path: "src/main.ts", language: "TypeScript", totalLines: 30, complexity: 3 },
    { path: "bin/run", language: "Shell", totalLines: 0, complexity: 0 },
  ]);
});

test("decodeMetrics normalizes lexical relative and absolute in-root paths, preserving Unicode and spaces", () => {
  expect(decodeMetrics(output(
    record({ Location: "./src/unused/../main.ts" }),
    record({ Location: `${root}/src/雪 and café.ts` }),
  ), root).map(file => file.path)).toEqual(["src/main.ts", "src/雪 and café.ts"]);
});

test("decodeMetrics accepts empty arrays and empty language Files arrays", () => {
  expect(decodeMetrics("[]", root)).toEqual([]);
  expect(decodeMetrics(output(), root)).toEqual([]);
});

for (const json of ["[", "null", "{}", "[null]", "[[]]", '[{"Name":"TypeScript"}]', '[{"Files":null}]', '[{"Files":{}}]', '[{"Files":[null]}]', '[{"Files":[[]]}]']) {
  test(`decodeMetrics rejects malformed JSON shape ${json}`, () => {
    expect(() => decodeMetrics(json, root)).toThrow(/scc.*output/i);
  });
}
for (const field of ["Location", "Language", "Lines", "Complexity"]) {
  test(`decodeMetrics rejects missing ${field}`, () => {
    const file = record();
    delete file[field];
    expect(() => decodeMetrics(output(file), root)).toThrow(field);
  });
}
for (const field of ["Lines", "Complexity"]) {
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "3", null, true, {}, []]) {
    test(`decodeMetrics rejects invalid ${field} ${JSON.stringify(value)}`, () => {
      expect(() => decodeMetrics(output(record({ [field]: value })), root)).toThrow(field);
    });
  }
  test(`decodeMetrics rejects nonfinite ${field} from valid JSON exponent overflow`, () => {
    const json = output(record({ [field]: "overflow" })).replace('"overflow"', "1e400");
    expect(() => decodeMetrics(json, root)).toThrow(field);
  });
  test(`decodeMetrics accepts safe integer maximum for ${field}`, () => {
    expect(decodeMetrics(output(record({ [field]: Number.MAX_SAFE_INTEGER })), root)).toHaveLength(1);
  });
}
for (const field of ["Location", "Language"]) {
  for (const value of ["", null, 10, [], {}]) {
    test(`decodeMetrics rejects invalid ${field} ${JSON.stringify(value)}`, () => {
      expect(() => decodeMetrics(output(record({ [field]: value })), root)).toThrow(field);
    });
  }
}
for (const location of ["../outside.ts", `${root}-other/file.ts`, "/elsewhere/file.ts", "src/../../outside.ts", ".", root, "bad\u0000.ts"]) {
  test(`decodeMetrics rejects escaping or invalid Location ${JSON.stringify(location)}`, () => {
    expect(() => decodeMetrics(output(record({ Location: location })), root)).toThrow(/Location/);
  });
}
test("decodeMetrics rejects duplicate normalized paths across language groups", () => {
  const json = JSON.stringify([
    { Files: [record()] }, { Files: [record({ Location: `${root}/src/./main.ts`, Language: "JavaScript" })] },
  ]);
  expect(() => decodeMetrics(json, root)).toThrow(/duplicate/i);
});
for (const flag of ["Binary", "Generated", "Minified"]) {
  test(`decodeMetrics drops ${flag} records and retains false flags`, () => {
    expect(decodeMetrics(output(record({ [flag]: true }), record({ Location: "ok.ts", [flag]: false })), root))
      .toEqual([{ path: "ok.ts", language: "TypeScript", totalLines: 30, complexity: 3 }]);
  });
  for (const value of ["true", 1, null]) {
    test(`decodeMetrics rejects malformed optional ${flag} ${JSON.stringify(value)}`, () => {
      expect(() => decodeMetrics(output(record({ [flag]: value })), root)).toThrow(flag);
    });
  }
}
test("decodeMetrics validates flagged records rather than hiding incompatible output", () => {
  expect(() => decodeMetrics(output(record({ Binary: true, Lines: -1 })), root)).toThrow("Lines");
  expect(() => decodeMetrics(output(record({ Generated: true }), record()), root)).toThrow(/duplicate/i);
});

test("scan uses argv without shell source, explicit excludes and dot target with root cwd", async () => {
  const directory = "/projects/雪 space; $(touch nope) `echo nope` ' \"";
  const runner = new RecordingRunner([success()]);
  expect(await scan(directory, parseArgs([]), runner)).toEqual([]);
  expect(runner.requests).toEqual([{
    argv: ["scc", "--no-config", "--by-file", "--format", "json", "--no-min-gen", "--exclude-dir", EXCLUDED_DIRECTORIES.join(","), "."],
    cwd: directory,
  }]);
  expect(runner.requests[0]!.argv.join(" ")).not.toContain(directory);
});

test("scan applies source policy after normalization including custom exclusions, flags and tests", async () => {
  const runner = new RecordingRunner([success(output(
    record(), record({ Location: `${root}/node_modules/pkg/index.ts` }),
    record({ Location: "./config/../vite.config.ts" }),
    record({ Location: "generated/../generated/out.ts" }),
    record({ Location: "readme.md", Language: "Markdown" }),
    record({ Location: "test/main.test.ts" }),
    record({ Location: "binary.ts", Binary: true }),
    record({ Location: "generated.ts", Generated: true }),
    record({ Location: "minified.ts", Minified: true }),
  ))]);
  expect(await scan(root, parseArgs(["--exclude", "generated/**", "--exclude-tests"]), runner))
    .toEqual([{ path: "src/main.ts", language: "TypeScript", totalLines: 30, complexity: 3 }]);
});

test("scan honors explicit languages but custom exclusions still win", async () => {
  const runner = new RecordingRunner([success(output(
    record({ Location: "keep.json", Language: "JSON" }),
    record({ Location: "drop.json", Language: "JSON" }), record(),
  ))]);
  expect((await scan(root, parseArgs(["--language", "JSON", "--exclude", "drop.*"]), runner)).map(file => file.path))
    .toEqual(["keep.json"]);
});

test("scan does not turn malformed output into an empty result", async () => {
  const error = await scanError(new RecordingRunner([success("[")]));
  expect(error.message).toMatch(/scc.*output/i);
  expect(error.cause).toBeInstanceOf(SyntaxError);
});

test("scan reports nonzero exit with escaped stderr controls and caps the diagnostic at 4096 characters", async () => {
  const runner = new RecordingRunner([{ exitCode: 7, stdout: "[]", stderr: "failure\u001b[31m\n\r\t\u009b" + "x".repeat(9000) }]);
  const error = await scanError(runner);
  expect(error.message).toMatch(/scc.*7/i);
  expect(error.message).toContain("failure\\u001b[31m\\n\\r\\t\\u009b");
  expect(error.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  expect(error.message.length).toBeLessThanOrEqual(4096);
  expect(error.message).toContain("truncated");
});

test("scan reports rejected spawn with actionable guidance, bounded escaped cause context", async () => {
  const cause = new Error("ENOENT\u001b[31m" + "x".repeat(9000));
  const runner = new RecordingRunner([cause, success()]);
  const error = await scanError(runner);
  expect(error.message).toMatch(/scc.*PATH/i);
  expect(error.message).toContain("ENOENT\\u001b[31m");
  expect(error.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  expect(error.message.length).toBeLessThanOrEqual(4096);
  expect(error.cause).toBe(cause);
  expect(await scan(root, parseArgs([]), runner)).toEqual([]);
  expect(runner.requests).toHaveLength(2);
});
