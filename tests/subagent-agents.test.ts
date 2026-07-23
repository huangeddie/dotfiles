import { describe, expect, test } from "bun:test";
import { parseAgentDefinition } from "../dot_pi/agent/exact_extensions/subagent/agents";

const parse = (frontmatter: string) =>
	parseAgentDefinition(`---\n${frontmatter}\n---\nSystem prompt.\n`, "/agents/example.md", "user");

describe("subagent definitions", () => {
	test("defaults an omitted backend to pi", () => {
		expect(parse("name: worker\ndescription: Worker")).toEqual({
			agent: {
				name: "worker",
				description: "Worker",
				backend: "pi",
				systemPrompt: "System prompt.",
				source: "user",
				filePath: "/agents/example.md",
			},
			diagnostic: null,
		});
	});

	test("accepts backend-native Claude model and tools", () => {
		const parsed = parse(
			"name: claude-worker\ndescription: Worker\nbackend: claude\nmodel: sonnet\ntools: Read, Write, WebSearch",
		);
		expect(parsed.agent).toMatchObject({
			name: "claude-worker",
			backend: "claude",
			model: "sonnet",
			tools: ["Read", "Write", "WebSearch"],
		});
		expect(parsed.diagnostic).toBeNull();
	});

	for (const [name, definition, message] of [
		["backend", "name: bad\ndescription: Bad\nbackend: codex", 'unsupported backend "codex"'],
		["model", "name: bad\ndescription: Bad\nbackend: claude\ntools: Read", 'requires a non-empty "model"'],
		["tools", "name: bad\ndescription: Bad\nbackend: claude\nmodel: sonnet", 'requires a non-empty "tools"'],
		["nested", "name: bad\ndescription: Bad\nbackend: claude\nmodel: sonnet\ntools: Read, Agent", 'must not include the nested "Agent" tool'],
	] as const) {
		test(`rejects invalid Claude ${name}`, () => {
			const parsed = parse(definition);
			expect(parsed.agent).toBeNull();
			expect(parsed.diagnostic).toEqual({
				name: "bad",
				filePath: "/agents/example.md",
				message: expect.stringContaining(message),
			});
		});
	}
});
