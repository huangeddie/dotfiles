import { expect, test } from "bun:test";

import type { ClaudeAgentConfig, PiAgentConfig } from "../dot_pi/agent/exact_extensions/subagent/agents";
import type { AgentRunRequest } from "../dot_pi/agent/exact_extensions/subagent/contracts";
import { buildClaudeInvocation } from "../dot_pi/agent/exact_extensions/subagent/claude-backend";
import { buildPiArgs } from "../dot_pi/agent/exact_extensions/subagent/pi-backend";
import { buildChildToolArgs } from "../dot_pi/agent/exact_extensions/subagent/invocation";

const claudeAgent: ClaudeAgentConfig = {
  name: "claude-worker",
  description: "Implements features.",
  backend: "claude",
  tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"],
  model: "sonnet",
  systemPrompt: "Worker prompt.",
  source: "user",
  filePath: "/agents/claude-worker.md",
};

const claudeRequest: AgentRunRequest = {
  agent: claudeAgent,
  task: "implement feature",
  cwd: "/repo",
};

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

test("builds a Claude worker invocation with backend-native permissions", () => {
  const request = { ...claudeRequest, task: "implement feature" };

  expect(buildClaudeInvocation(request)).toEqual({
    command: "claude",
    cwd: "/repo",
    stdin: "Task: implement feature",
    args: [
      "-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence",
      "--model", "sonnet",
      "--tools", "Read,Write,Edit,Glob,Grep,Bash,WebSearch,WebFetch",
      "--allowedTools", "Read,Write,Edit,Glob,Grep,Bash,WebSearch,WebFetch",
      "--disallowedTools", "Agent",
      "--permission-mode", "dontAsk",
      "--append-system-prompt", "Worker prompt.",
    ],
  });
  expect(buildClaudeInvocation(request).args.join(" ")).not.toContain("bypassPermissions");
  expect(buildClaudeInvocation(request).args).not.toContain("--setting-sources");
});

test("rejects a non-Claude agent definition", () => {
  expect(() => buildClaudeInvocation({ ...claudeRequest, agent: piAgent })).toThrow(
    "Claude backend requires a Claude agent definition",
  );
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
