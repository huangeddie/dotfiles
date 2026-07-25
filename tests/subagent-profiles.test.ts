import { describe, expect, test } from "bun:test";
import {
	ProfileConfigurationError,
	parseProfileCatalog,
	resolveProfile,
} from "../dot_pi/agent/exact_extensions/subagent/profiles.ts";

const catalogPath = `${import.meta.dir}/../dot_pi/agent/subagent-profiles.json`;
const rawCatalog = JSON.parse(await Bun.file(catalogPath).text());
const parse = (value: unknown = rawCatalog) =>
	parseProfileCatalog(structuredClone(value), catalogPath);

const setPath = (root: any, keys: readonly string[], value: unknown) => {
	let current = root;
	for (const key of keys.slice(0, -1)) current = current[key];
	current[keys.at(-1)!] = value;
	return root;
};

const invalidCatalogCases = [
	["version", ["version"], 2, "$.version must equal 1"],
	["unknown top-level property", ["extra"], true, '$ contains unknown property "extra"'],
	[
		"missing default profile",
		["defaultProfile"],
		"missing",
		'$.defaultProfile references unknown profile "missing"',
	],
	[
		"inconsistent roles",
		["profiles", "claude", "worker"],
		undefined,
		"$.profiles.claude must define the same roles as $.profiles.gpt",
	],
	[
		"unknown alias",
		["profiles", "gpt", "scout"],
		"missing",
		'$.profiles.gpt.scout references unknown model alias "missing"',
	],
	[
		"unsupported backend",
		["models", "gpt-5.6-luna", "backend"],
		"other",
		'$.models.gpt-5.6-luna.backend must be "pi" or "claude"',
	],
	[
		"blank model",
		["models", "gpt-5.6-luna", "model"],
		" ",
		"$.models.gpt-5.6-luna.model must be a non-empty string",
	],
	[
		"missing tools role",
		["tools", "scout"],
		undefined,
		"$.tools.scout is required",
	],
	[
		"Pi empty tools",
		["tools", "scout", "pi"],
		[],
		"$.tools.scout.pi must be a non-empty array or null",
	],
	[
		"Claude null tools",
		["tools", "scout", "claude"],
		null,
		"$.tools.scout.claude must be a non-empty array",
	],
	[
		"blank tool",
		["tools", "scout", "claude", "0"],
		" ",
		"$.tools.scout.claude[0] must be a non-empty string",
	],
	[
		"duplicate tool",
		["tools", "scout", "claude", "1"],
		"Read",
		'$.tools.scout.claude contains duplicate tool "Read"',
	],
	[
		"nested Agent",
		["tools", "scout", "claude", "0"],
		"Agent",
		'$.tools.scout.claude must not include nested tool "Agent"',
	],
] as const;

describe("runtime subagent profile catalog", () => {
	test("resolves the missing selection to the complete GPT profile", () => {
		const resolved = resolveProfile(parse(), undefined, "/state/subagents-profile");
		expect(resolved).toEqual({
			name: "gpt",
			roles: {
				scout: {
					alias: "gpt-5.6-luna",
					backend: "pi",
					model: "openai-codex/gpt-5.6-luna",
					tools: ["read", "grep", "find", "ls", "bash"],
				},
				planner: {
					alias: "gpt-5.6-terra",
					backend: "pi",
					model: "openai-codex/gpt-5.6-terra",
					tools: ["read", "grep", "find", "ls"],
				},
				reviewer: {
					alias: "gpt-5.6-terra",
					backend: "pi",
					model: "openai-codex/gpt-5.6-terra",
					tools: ["read", "grep", "find", "ls", "bash"],
				},
				worker: {
					alias: "gpt-5.6-terra",
					backend: "pi",
					model: "openai-codex/gpt-5.6-terra",
					tools: null,
				},
			},
		});
	});

	test("resolves one final newline to the complete Claude profile", () => {
		const resolved = resolveProfile(parse(), "claude\n", "/state/subagents-profile");
		expect(resolved.name).toBe("claude");
		expect(resolved.roles).toMatchObject({
			scout: { alias: "claude-haiku-5", backend: "claude", model: "haiku" },
			planner: { alias: "claude-sonnet-5", backend: "claude", model: "sonnet" },
			reviewer: { alias: "claude-sonnet-5", backend: "claude", model: "sonnet" },
			worker: { alias: "claude-sonnet-5", backend: "claude", model: "sonnet" },
		});
		expect(resolved.roles.worker.tools).toEqual([
			"Read",
			"Write",
			"Edit",
			"Glob",
			"Grep",
			"Bash",
			"WebSearch",
			"WebFetch",
		]);
	});

	for (const [name, keys, value, diagnostic] of invalidCatalogCases) {
		test(`rejects an invalid catalog with ${name}`, () => {
			const invalid = structuredClone(rawCatalog);
			if (value === undefined) {
				const parent = keys.slice(0, -1).reduce((current, key) => current[key], invalid);
				delete parent[keys.at(-1)!];
			} else {
				setPath(invalid, keys, value);
			}

			expect(() => parse(invalid)).toThrow(ProfileConfigurationError);
			expect(() => parse(invalid)).toThrow(diagnostic);
		});
	}

	for (const name of ["", "bad profile", "gpt\n", "gpt/"] as const) {
		test(`rejects profile names outside [A-Za-z0-9._-]+: ${JSON.stringify(name)}`, () => {
			const invalid = structuredClone(rawCatalog);
			invalid.profiles[name] = invalid.profiles.gpt;
			delete invalid.profiles.gpt;

			expect(() => parse(invalid)).toThrow(ProfileConfigurationError);
			expect(() => parse(invalid)).toThrow("must be a valid profile name");
		});
	}

	test("rejects unknown model-entry and tool-policy properties", () => {
		const modelProperty = structuredClone(rawCatalog);
		setPath(modelProperty, ["models", "gpt-5.6-luna", "extra"], true);
		expect(() => parse(modelProperty)).toThrow(
			'$.models.gpt-5.6-luna contains unknown property "extra"',
		);

		const toolPolicyProperty = structuredClone(rawCatalog);
		setPath(toolPolicyProperty, ["tools", "scout", "extra"], true);
		expect(() => parse(toolPolicyProperty)).toThrow(
			'$.tools.scout contains unknown property "extra"',
		);
	});

	for (const content of ["", "gpt\nextra\n", "bad profile\n", "missing\n"] as const) {
		test(`rejects invalid selection ${JSON.stringify(content)}`, () => {
			expect(() =>
				resolveProfile(parse(), content, "/state/subagents-profile"),
			).toThrow(ProfileConfigurationError);
			expect(() =>
				resolveProfile(parse(), content, "/state/subagents-profile"),
			).toThrow("/state/subagents-profile");
		});
	}

	test("defensively copies the catalog and resolves fresh role records and tools", () => {
		const input = structuredClone(rawCatalog);
		const catalog = parseProfileCatalog(input, catalogPath);
		input.profiles.gpt.scout = "missing";

		const first = resolveProfile(catalog, undefined, "/state/subagents-profile");
		(first.roles.scout.tools as string[]).pop();
		(first.roles as Record<string, { alias: string }>).scout.alias = "changed";
		const second = resolveProfile(catalog, undefined, "/state/subagents-profile");

		expect(second.roles.scout).toEqual({
			alias: "gpt-5.6-luna",
			backend: "pi",
			model: "openai-codex/gpt-5.6-luna",
			tools: ["read", "grep", "find", "ls", "bash"],
		});
	});
});
