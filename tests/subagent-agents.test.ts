import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
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

const fixturePath = (fileName: string) =>
	path.join(import.meta.dir, "fixtures", "subagent-agents", fileName);

describe("malformed subagent definitions", () => {
	for (const [fileName, name, message] of [
		["malformed-yaml.md", null, "could not parse YAML"],
		["non-string-backend.md", "invalid-backend", 'requires "backend" to be a string'],
		["non-string-model.md", "invalid-model", 'requires "model" to be a string'],
		["non-string-tools.md", "invalid-tools", 'requires "tools" to be a string'],
	] as const) {
		test(`returns a diagnostic for ${fileName}`, () => {
			const filePath = fixturePath(fileName);
			const parsed = parseAgentDefinition(fs.readFileSync(filePath, "utf-8"), filePath, "project");

			expect(parsed).toEqual({
				agent: null,
				diagnostic: {
					name,
					filePath,
					message: expect.stringContaining(message),
				},
			});
		});
	}
});
