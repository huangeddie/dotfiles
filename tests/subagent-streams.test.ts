import { expect, test } from "bun:test";

import type { PiAgentConfig } from "../dot_pi/agent/exact_extensions/subagent/agents";
import type { AgentRunRequest, ProcessRunner } from "../dot_pi/agent/exact_extensions/subagent/contracts";
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

function messageLine(message: Record<string, unknown>): string {
  return JSON.stringify({ type: "message_end", message });
}

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
