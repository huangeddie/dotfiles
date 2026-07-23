import { expect, test } from "bun:test";

import type { PiAgentConfig } from "../dot_pi/agent/exact_extensions/subagent/agents";
import { buildPiArgs } from "../dot_pi/agent/exact_extensions/subagent/pi-backend";
import { buildChildToolArgs } from "../dot_pi/agent/exact_extensions/subagent/invocation";

const piAgent: PiAgentConfig = {
  name: "repository-inspector",
  description: "Inspects repositories.",
  backend: "pi",
  tools: ["read", "bash"],
  model: "openai-codex/gpt-5.6-terra",
  systemPrompt: "Worker prompt.",
  source: "user",
  filePath: "/agents/repository-inspector.md",
};

test("excludes the subagent tool from unrestricted child processes", () => {
  expect(buildChildToolArgs()).toEqual(["--exclude-tools", "subagent"]);
});

test("preserves an explicit tool allowlist while excluding the subagent tool", () => {
  expect(buildChildToolArgs(["read", "bash"])).toEqual([
    "--tools",
    "read,bash",
    "--exclude-tools",
    "subagent",
  ]);
});

test("denies the subagent tool even when an agent explicitly allows it", () => {
  expect(buildChildToolArgs(["read", "subagent"])).toEqual([
    "--tools",
    "read,subagent",
    "--exclude-tools",
    "subagent",
  ]);
});

test("builds a Pi Claude-independent worker invocation", () => {
  expect(buildPiArgs(piAgent, "inspect repository")).toEqual([
    "--mode", "json", "-p", "--no-session",
    "--model", "openai-codex/gpt-5.6-terra",
    "--tools", "read,bash",
    "--exclude-tools", "subagent",
    "--append-system-prompt", "Worker prompt.",
    "Task: inspect repository",
  ]);
});
