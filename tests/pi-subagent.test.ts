import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const wrapper = new URL("../dot_local/bin/executable_pi-subagent", import.meta.url).pathname;
const catalog = [
  "provider      model             context  max-out  thinking  images",
  "openai-codex  gpt-5.6-luna      272K     128K     yes       no",
  "anthropic     claude-sonnet-5   1M       128K     yes       yes",
].join("\n");

let sandbox = "";
let bin = "";
let stateHome = "";
let catalogPath = "";
let callPath = "";

async function writeExecutable(path: string, content: string): Promise<void> {
  await writeFile(path, content);
  await chmod(path, 0o755);
}

async function run(args: string[], extraEnv: Record<string, string> = {}) {
  const result = Bun.spawnSync(["/bin/bash", wrapper, ...args], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      XDG_STATE_HOME: stateHome,
      PI_SUBAGENT_TEST_CATALOG: catalogPath,
      PI_SUBAGENT_TEST_CALL: callPath,
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "pi-subagent-test-"));
  bin = join(sandbox, "bin");
  stateHome = join(sandbox, "state");
  catalogPath = join(sandbox, "catalog.txt");
  callPath = join(sandbox, "pi-call.bin");
  await mkdir(bin);
  await writeFile(catalogPath, catalog);

  await writeExecutable(
    join(bin, "pi"),
    `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == "--list-models" ]]; then
  cat "$PI_SUBAGENT_TEST_CATALOG"
  exit 0
fi
printf '%s\\0' "$@" > "$PI_SUBAGENT_TEST_CALL"
`,
  );
  await writeExecutable(
    join(bin, "fzf"),
    `#!/bin/bash
set -euo pipefail
if [[ "\${PI_SUBAGENT_TEST_FZF_STATUS:-0}" != 0 ]]; then
  exit "$PI_SUBAGENT_TEST_FZF_STATUS"
fi
printf '%s\\n' "$PI_SUBAGENT_TEST_FZF_OUTPUT"
`,
  );
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe("pi-subagent", () => {
  test("selects a live Pi model with no arguments and persists only its selector", async () => {
    const result = await run([], {
      PI_SUBAGENT_TEST_FZF_OUTPUT:
        "anthropic/claude-sonnet-5\tanthropic     claude-sonnet-5   1M       128K     yes       yes",
    });

    expect(result.exitCode).toBe(0);
    await expect(readFile(join(stateHome, "pi", "subagent-model"), "utf8")).resolves.toBe(
      "anthropic/claude-sonnet-5\n",
    );
    await expect(readFile(callPath, "utf8")).rejects.toThrow();
  });

  test("uses a valid persisted selection for a prompt", async () => {
    await mkdir(join(stateHome, "pi"), { recursive: true });
    await writeFile(join(stateHome, "pi", "subagent-model"), "anthropic/claude-sonnet-5\n");

    const result = await run(["inspect this repository"]);

    expect(result.exitCode).toBe(0);
    await expect(readFile(callPath)).resolves.toEqual(
      Buffer.from("--model\0anthropic/claude-sonnet-5\0-p\0inspect this repository\0"),
    );
  });

  test.skip("prints the persisted model without invoking Pi", async () => {
    await mkdir(join(stateHome, "pi"), { recursive: true });
    await writeFile(join(stateHome, "pi", "subagent-model"), "anthropic/claude-sonnet-5\n");

    const result = await run(["--status"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("anthropic/claude-sonnet-5\n");
    await expect(readFile(callPath, "utf8")).rejects.toThrow();
  });

  test.skip("rejects status when no model is selected without invoking Pi", async () => {
    const result = await run(["--status"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("no model is selected");
    await expect(readFile(callPath, "utf8")).rejects.toThrow();
  });

  test.skip("rejects status when the persisted selection is malformed", async () => {
    await mkdir(join(stateHome, "pi"), { recursive: true });
    await writeFile(
      join(stateHome, "pi", "subagent-model"),
      "openai-codex/gpt-5.6-luna\nanthropic/claude-sonnet-5\n",
    );

    const result = await run(["--status"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("model selection is invalid");
    await expect(readFile(callPath, "utf8")).rejects.toThrow();
  });

  test("rejects a missing selection instead of launching a default model", async () => {
    const result = await run(["inspect this repository"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("pi-subagent");
    await expect(readFile(callPath, "utf8")).rejects.toThrow();
  });

  test("rejects a stale persisted selection instead of replacing it", async () => {
    await mkdir(join(stateHome, "pi"), { recursive: true });
    await writeFile(join(stateHome, "pi", "subagent-model"), "openai-codex/removed-model\n");

    const result = await run(["inspect this repository"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("no longer available");
    await expect(readFile(callPath, "utf8")).rejects.toThrow();
  });

  test("uses a valid --model override without changing persisted state", async () => {
    const result = await run(["--model", "openai-codex/gpt-5.6-luna", "inspect this repository"]);

    expect(result.exitCode).toBe(0);
    await expect(readFile(callPath)).resolves.toEqual(
      Buffer.from("--model\0openai-codex/gpt-5.6-luna\0-p\0inspect this repository\0"),
    );
    await expect(readFile(join(stateHome, "pi", "subagent-model"), "utf8")).rejects.toThrow();
  });

  test("fails when the picker is cancelled and writes no selection", async () => {
    const result = await run([], {
      PI_SUBAGENT_TEST_FZF_OUTPUT: "",
      PI_SUBAGENT_TEST_FZF_STATUS: "130",
    });

    expect(result.exitCode).toBe(130);
    await expect(readFile(join(stateHome, "pi", "subagent-model"), "utf8")).rejects.toThrow();
  });
});
