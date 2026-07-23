import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	type AgentFileSystem,
	discoverAgents,
	parseAgentDefinition,
} from "../dot_pi/agent/exact_extensions/subagent/agents";

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

	test("rejects a whitespace-only name with a file-specific diagnostic", () => {
		expect(parse('name: "   "\ndescription: Worker')).toEqual({
			agent: null,
			diagnostic: {
				name: null,
				filePath: "/agents/example.md",
				message: 'Agent definition at "/agents/example.md" requires a non-empty "name"',
			},
		});
	});

	test("rejects a whitespace-only description with an agent- and file-specific diagnostic", () => {
		expect(parse('name: worker\ndescription: " \t "')).toEqual({
			agent: null,
			diagnostic: {
				name: "worker",
				filePath: "/agents/example.md",
				message: 'Agent "worker" at "/agents/example.md" requires a non-empty "description"',
			},
		});
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

class FakeAgentFileSystem implements AgentFileSystem {
	constructor(
		private readonly directories: ReadonlyMap<string, readonly string[]>,
		private readonly files: ReadonlyMap<string, string>,
	) {}

	isDirectory(directory: string): boolean {
		return this.directories.has(directory);
	}

	readDirectory(directory: string): string[] | null {
		const entries = this.directories.get(directory);
		return entries ? [...entries] : null;
	}

	readFile(filePath: string): string | null {
		return this.files.get(filePath) ?? null;
	}
}

const agentDefinition = (name: string, backend = "pi") =>
	`---\nname: ${name}\ndescription: ${name}\nbackend: ${backend}\n---\n${name} prompt\n`;

const agentDiscoveryFixture = () => {
	const userAgentsDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = "/workspace/.pi/agents";
	const userInvalidPath = path.join(userAgentsDir, "invalid.md");
	const userSharedPath = path.join(userAgentsDir, "shared.md");
	const projectInvalidPath = path.join(projectAgentsDir, "invalid.md");
	const projectSharedPath = path.join(projectAgentsDir, "shared.md");

	return {
		cwd: "/workspace/packages/example",
		userAgentsDir,
		projectAgentsDir,
		userInvalidPath,
		projectInvalidPath,
		fileSystem: new FakeAgentFileSystem(
			new Map([
				[userAgentsDir, ["invalid.md", "shared.md"]],
				[projectAgentsDir, ["invalid.md", "shared.md"]],
			]),
			new Map([
				[userInvalidPath, agentDefinition("user-invalid", "unsupported")],
				[userSharedPath, agentDefinition("shared")],
				[projectInvalidPath, agentDefinition("project-invalid", "unsupported")],
				[projectSharedPath, agentDefinition("shared")],
			]),
		),
	};
};

describe("agent discovery", () => {
	for (const [scope, expectedDiagnosticPaths, expectedAgentSource] of [
		["user", [path.join(getAgentDir(), "agents", "invalid.md")], "user"],
		["project", ["/workspace/.pi/agents/invalid.md"], "project"],
		[
			"both",
			[path.join(getAgentDir(), "agents", "invalid.md"), "/workspace/.pi/agents/invalid.md"],
			"project",
		],
	] as const) {
		test(`continues past invalid readable definitions in ${scope} scope`, () => {
			const fixture = agentDiscoveryFixture();
			const discovery = discoverAgents(fixture.cwd, scope, fixture.fileSystem);

			expect(discovery.diagnostics.map((diagnostic) => diagnostic.filePath)).toEqual(expectedDiagnosticPaths);
			expect(discovery.agents).toEqual([
				expect.objectContaining({ name: "shared", source: expectedAgentSource }),
			]);
		});
	}
});

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
