import { expect, test } from "bun:test";

import type { ClaudeAgentConfig, PiAgentConfig } from "../dot_pi/agent/exact_extensions/subagent/agents";
import type { AgentRunRequest, ProcessRunner } from "../dot_pi/agent/exact_extensions/subagent/contracts";
import { ClaudeStreamParser, createClaudeBackend } from "../dot_pi/agent/exact_extensions/subagent/claude-backend";
import { createPiBackend, PiStreamParser } from "../dot_pi/agent/exact_extensions/subagent/pi-backend";

const agent: PiAgentConfig = {
  name: "repository-inspector",
  description: "Inspects repositories.",
  backend: "pi",
  systemPrompt: "Worker prompt.",
  source: "project",
  filePath: "/project/.pi/agents/repository-inspector.md",
};

const request: AgentRunRequest = {
  agent,
  task: "inspect repository",
  cwd: "/project",
  step: 2,
};

const claudeAgent: ClaudeAgentConfig = {
  name: "claude-worker",
  description: "Implements features.",
  backend: "claude",
  tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"],
  model: "sonnet",
  systemPrompt: "Worker prompt.",
  source: "project",
  filePath: "/project/.pi/agents/claude-worker.md",
};

const claudeRequest: AgentRunRequest = {
  agent: claudeAgent,
  task: "implement feature",
  cwd: "/repo",
  step: 2,
};

const claudeStreamLines = [
  '{"type":"system","subtype":"init","model":"claude-sonnet-4-6"}',
  '{"type":"assistant","message":{"model":"claude-sonnet-4-6","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/repo/a.ts"}},{"type":"text","text":"Working"}],"usage":{"input_tokens":10,"output_tokens":4,"cache_read_input_tokens":3,"cache_creation_input_tokens":2}}}',
  '{"type":"result","subtype":"success","is_error":false,"num_turns":2,"result":"Done","total_cost_usd":0.012,"usage":{"input_tokens":20,"output_tokens":8,"cache_read_input_tokens":5,"cache_creation_input_tokens":3},"permission_denials":[]}',
];

const incompleteClaudeResultLine =
  '{"type":"result","subtype":"success","is_error":false,"num_turns":2,"total_cost_usd":0.012,"usage":{"input_tokens":20,"output_tokens":8,"cache_read_input_tokens":5,"cache_creation_input_tokens":3},"permission_denials":[]}';

const duplicateClaudeResultLines = [
  claudeStreamLines[2],
  '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"result":"Duplicate","total_cost_usd":0.024,"usage":{"input_tokens":40,"output_tokens":16,"cache_read_input_tokens":10,"cache_creation_input_tokens":6},"permission_denials":[]}',
];

function messageLine(message: Record<string, unknown>): string {
  return JSON.stringify({ type: "message_end", message });
}

test("normalizes Claude stream content and final result accounting", () => {
  const parser = new ClaudeStreamParser(claudeRequest);
  for (const line of claudeStreamLines) parser.accept(line);

  expect(parser.finish({ exitCode: 0, stderr: "", aborted: false })).toEqual({
    backend: "claude",
    agent: "claude-worker",
    agentSource: "project",
    task: "implement feature",
    step: 2,
    status: "completed",
    output: "Done",
    events: [
      { type: "toolCall", name: "Read", args: { file_path: "/repo/a.ts" } },
      { type: "text", text: "Working" },
    ],
    stderr: "",
    usage: {
      input: 20,
      output: 8,
      cacheRead: 5,
      cacheWrite: 3,
      contextTokens: 0,
      turns: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.012 },
    },
    model: "claude-sonnet-4-6",
    exitCode: 0,
  });
});

test("fails an incomplete Claude final result with an actionable diagnostic", () => {
  const parser = new ClaudeStreamParser(claudeRequest);
  parser.accept(incompleteClaudeResultLine);

  expect(parser.finish({ exitCode: 0, stderr: "", aborted: false })).toMatchObject({
    status: "failed",
    output: "",
    diagnostic: "Claude final result is missing string output.",
  });
});

test("fails duplicate Claude final results with an actionable diagnostic", () => {
  const parser = new ClaudeStreamParser(claudeRequest);
  for (const line of duplicateClaudeResultLines) parser.accept(line);

  expect(parser.finish({ exitCode: 0, stderr: "", aborted: false })).toMatchObject({
    status: "failed",
    output: "Done",
    diagnostic: "Claude emitted multiple final results.",
  });
});

test("fails a Claude execution error and reports permission denials", () => {
  const parser = new ClaudeStreamParser(claudeRequest);
  parser.accept('{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Stopped","permission_denials":[{"message":"Bash denied"},{"message":"Read denied"}]}');

  expect(parser.finish({ exitCode: 0, stderr: "", aborted: false })).toMatchObject({
    status: "failed",
    output: "Stopped",
    diagnostic: "Claude result error_during_execution.\nBash denied\nRead denied",
  });
});

test("fails a Claude result with non-message permission denial metadata", () => {
  const parser = new ClaudeStreamParser(claudeRequest);
  parser.accept('{"type":"result","subtype":"success","is_error":false,"result":"Stopped","permission_denials":[{"tool_name":"Bash","tool_use_id":"toolu_1"}]}');

  expect(parser.finish({ exitCode: 0, stderr: "", aborted: false })).toMatchObject({
    status: "failed",
    diagnostic: "Claude permission was denied.",
  });
});

test("fails when Claude emits a tool outside the configured allowlist", () => {
  const parser = new ClaudeStreamParser({
    ...claudeRequest,
    agent: { ...claudeAgent, tools: ["DefinitelyNotAClaudeTool"] },
  });
  parser.accept('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"README.md"}}]}}');
  parser.accept('{"type":"result","subtype":"success","is_error":false,"result":"Done","permission_denials":[]}');

  expect(parser.finish({ exitCode: 0, stderr: "", aborted: false })).toMatchObject({
    status: "failed",
    diagnostic: 'Claude emitted unconfigured tool "Read".',
  });
});

test("fails an unexecuted Claude tool-call markup result", () => {
  const parser = new ClaudeStreamParser({
    ...claudeRequest,
    agent: { ...claudeAgent, tools: ["DefinitelyNotAClaudeTool"] },
  });
  parser.accept('{"type":"assistant","message":{"content":[{"type":"text","text":"<function_calls>\\n<invoke name=\\"Read\\">\\n<parameter name=\\"path\\">README.md</parameter>\\n</invoke>\\n</function_calls>"}]}}');
  parser.accept('{"type":"result","subtype":"success","is_error":false,"result":"<function_calls>\\n<invoke name=\\"Read\\">\\n<parameter name=\\"path\\">README.md</parameter>\\n</invoke>\\n</function_calls>","permission_denials":[]}');

  expect(parser.finish({ exitCode: 0, stderr: "", aborted: false })).toMatchObject({
    status: "failed",
    diagnostic: "Claude returned unexecuted tool-call markup.",
  });
});

test("retains malformed non-empty Claude JSON as a failure diagnostic", () => {
  const parser = new ClaudeStreamParser(claudeRequest);
  parser.accept("not JSON");
  parser.accept(claudeStreamLines[2]);

  expect(parser.finish({ exitCode: 0, stderr: "", aborted: false })).toMatchObject({
    status: "failed",
    diagnostic: "Malformed Claude JSON event: not JSON",
  });
});

test("fails a Claude process that exits without a final result", () => {
  const parser = new ClaudeStreamParser(claudeRequest);
  parser.accept(claudeStreamLines[1]);

  expect(parser.finish({ exitCode: 0, stderr: "", aborted: false })).toMatchObject({
    status: "failed",
    output: "",
    diagnostic: "Claude exited without a final result.",
  });
});

test("marks a nonzero Claude process exit as failed and retains stderr", () => {
  const parser = new ClaudeStreamParser(claudeRequest);
  parser.accept(claudeStreamLines[2]);

  expect(parser.finish({ exitCode: 1, stderr: "Claude crashed.", aborted: false })).toMatchObject({
    status: "failed",
    output: "Done",
    stderr: "Claude crashed.",
    diagnostic: "Claude crashed.",
    exitCode: 1,
  });
});

test("marks an aborted Claude process as aborted", () => {
  const parser = new ClaudeStreamParser(claudeRequest);
  parser.accept(claudeStreamLines[2]);

  expect(parser.finish({ exitCode: 1, stderr: "", aborted: true })).toMatchObject({
    status: "aborted",
    output: "Done",
    diagnostic: "Claude process was aborted.",
  });
});

test("emits running Claude snapshots from assistant events", async () => {
  const runner: ProcessRunner = {
    async run(invocation, options) {
      expect(invocation).toMatchObject({ command: "claude", cwd: "/repo", stdin: "Task: implement feature" });
      options.onStdoutLine(claudeStreamLines[1]);
      options.onStdoutLine(claudeStreamLines[2]);
      return { exitCode: 0, stderr: "", aborted: false };
    },
  };
  const updates: unknown[] = [];

  const result = await createClaudeBackend(runner).run(claudeRequest, undefined, (update) => updates.push(update));

  expect(updates).toEqual([
    expect.objectContaining({ status: "running", output: "Working" }),
  ]);
  expect(result).toMatchObject({ status: "completed", output: "Done" });
});

test("normalizes assistant text and tool calls while summing usage", () => {
  const parser = new PiStreamParser(request);
  parser.accept(messageLine({
    role: "assistant",
    content: [
      { type: "text", text: "I will inspect the repository." },
      { type: "toolCall", name: "read", arguments: { path: "README.md" } },
    ],
    usage: {
      input: 10,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      totalTokens: 19,
      cost: { input: 0.125, output: 0.25, cacheRead: 0.0625, cacheWrite: 0.03125, total: 0.46875 },
    },
    model: "openai-codex/gpt-5.6-terra",
    stopReason: "toolUse",
  }));
  parser.accept(messageLine({
    role: "assistant",
    content: [{ type: "text", text: "Repository inspection complete." }],
    usage: {
      input: 20,
      output: 5,
      cacheRead: 6,
      cacheWrite: 7,
      totalTokens: 38,
      cost: { input: 0.25, output: 0.5, cacheRead: 0.125, cacheWrite: 0.0625, total: 0.9375 },
    },
    stopReason: "end",
  }));

  expect(parser.finish({ exitCode: 0, stderr: "", aborted: false })).toEqual({
    backend: "pi",
    agent: "repository-inspector",
    agentSource: "project",
    task: "inspect repository",
    step: 2,
    status: "completed",
    output: "Repository inspection complete.",
    events: [
      { type: "text", text: "I will inspect the repository." },
      { type: "toolCall", name: "read", args: { path: "README.md" } },
      { type: "text", text: "Repository inspection complete." },
    ],
    stderr: "",
    usage: {
      input: 30,
      output: 7,
      cacheRead: 9,
      cacheWrite: 11,
      contextTokens: 38,
      turns: 2,
      cost: { input: 0.375, output: 0.75, cacheRead: 0.1875, cacheWrite: 0.09375, total: 1.40625 },
    },
    model: "openai-codex/gpt-5.6-terra",
    exitCode: 0,
  });
});

test("marks an assistant error stop reason as failed", () => {
  const parser = new PiStreamParser(request);
  parser.accept(messageLine({
    role: "assistant",
    content: [{ type: "text", text: "Partial result." }],
    stopReason: "error",
    errorMessage: "provider unavailable",
  }));

  expect(parser.finish({ exitCode: 0, stderr: "", aborted: false })).toMatchObject({
    status: "failed",
    output: "Partial result.",
    diagnostic: "provider unavailable",
  });
});

test("marks a nonzero process exit as failed and retains stderr", () => {
  const parser = new PiStreamParser(request);
  parser.accept(messageLine({
    role: "assistant",
    content: [{ type: "text", text: "Partial result." }],
  }));

  expect(parser.finish({ exitCode: 1, stderr: "Pi crashed.", aborted: false })).toMatchObject({
    status: "failed",
    output: "Partial result.",
    stderr: "Pi crashed.",
    diagnostic: "Pi crashed.",
    exitCode: 1,
  });
});

test("fails a successful process with no assistant output", () => {
  const parser = new PiStreamParser(request);

  expect(parser.finish({ exitCode: 0, stderr: "", aborted: false })).toMatchObject({
    status: "failed",
    output: "",
    diagnostic: "Pi exited without an assistant response.",
  });
});

test("retains malformed non-empty Pi JSON as a failure diagnostic", () => {
  const parser = new PiStreamParser(request);
  parser.accept("not JSON");
  parser.accept(messageLine({
    role: "assistant",
    content: [{ type: "text", text: "Complete." }],
  }));

  expect(parser.finish({ exitCode: 0, stderr: "", aborted: false })).toMatchObject({
    status: "failed",
    output: "Complete.",
    diagnostic: "Malformed Pi JSON event: not JSON",
  });
});

test("emits running snapshots from valid Pi events", async () => {
  const runner: ProcessRunner = {
    async run(invocation, options) {
      const piArgs = [
        "--mode", "json", "-p", "--no-session",
        "--exclude-tools", "subagent",
        "--append-system-prompt", "Worker prompt.",
        "Task: inspect repository",
      ];
      expect(invocation.cwd).toBe("/project");
      expect(invocation.args.slice(-piArgs.length)).toEqual(piArgs);
      options.onStdoutLine(messageLine({
        role: "assistant",
        content: [{ type: "text", text: "Complete." }],
      }));
      return { exitCode: 0, stderr: "", aborted: false };
    },
  };
  const updates: unknown[] = [];

  const result = await createPiBackend(runner).run(request, undefined, (update) => updates.push(update));

  expect(updates).toEqual([expect.objectContaining({ status: "running", output: "Complete." })]);
  expect(result).toMatchObject({ status: "completed", output: "Complete." });
});
