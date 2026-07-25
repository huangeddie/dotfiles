import { describe, expect, test } from "bun:test";
import {
	type ProfileCatalogRepository,
	type ProfileSelectionStore,
	resolveAgentConfigDir,
	resolveProfileStatePath,
} from "../dot_pi/agent/exact_extensions/subagent/profile-files.ts";
import { runProfileCli } from "../dot_pi/agent/exact_extensions/subagent/profile-cli.ts";
import { parseProfileCatalog, type ProfileCatalog } from "../dot_pi/agent/exact_extensions/subagent/profiles.ts";

const catalogPath = `${import.meta.dir}/../dot_pi/agent/subagent-profiles.json`;
const catalog = parseProfileCatalog(JSON.parse(await Bun.file(catalogPath).text()), catalogPath);
const usage = "Usage: pi-subagents [list | use <profile>]";

class FakeSelectionStore implements ProfileSelectionStore {
	readonly filePath = "/state/pi/subagents-profile";
	reads = 0;
	writes: string[] = [];

	constructor(public content: string | undefined) {}

	async read() {
		this.reads++;
		return this.content;
	}

	async write(profile: string) {
		this.writes.push(profile);
		this.content = `${profile}\n`;
	}
}

class FakeCatalogRepository implements ProfileCatalogRepository {
	loads = 0;

	constructor(private readonly catalog: ProfileCatalog) {}

	async load() {
		this.loads++;
		return this.catalog;
	}
}

function cliDependencies(
	store: ProfileSelectionStore,
	repository: ProfileCatalogRepository = new FakeCatalogRepository(catalog),
) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	return {
		stdout,
		stderr,
		dependencies: { repository, store, stdout: (line: string) => stdout.push(line), stderr: (line: string) => stderr.push(line) },
	};
}

describe("pi-subagents CLI", () => {
	test("bare command reports the default profile and sorted resolved roles", async () => {
		const output: string[] = [];
		const code = await runProfileCli([], {
			repository: new FakeCatalogRepository(catalog),
			store: new FakeSelectionStore(undefined),
			stdout: (line) => output.push(line),
			stderr: () => {
				throw new Error("unexpected stderr");
			},
		});
		expect(code).toBe(0);
		expect(output).toEqual([
			"Active profile: gpt",
			"planner: pi/openai-codex/gpt-5.6-terra tools=read,grep,find,ls",
			"reviewer: pi/openai-codex/gpt-5.6-terra tools=read,grep,find,ls,bash",
			"scout: pi/openai-codex/gpt-5.6-luna tools=read,grep,find,ls,bash",
			"worker: pi/openai-codex/gpt-5.6-terra tools=default",
		]);
	});

	test("use validates then writes one profile and reports Claude assignments", async () => {
		const store = new FakeSelectionStore("gpt\n");
		const output: string[] = [];
		const code = await runProfileCli(["use", "claude"], {
			repository: new FakeCatalogRepository(catalog),
			store,
			stdout: (line) => output.push(line),
			stderr: () => {
				throw new Error("unexpected stderr");
			},
		});
		expect(code).toBe(0);
		expect(store.reads).toBe(0);
		expect(store.writes).toEqual(["claude"]);
		expect(output[0]).toBe("Active profile: claude");
		expect(output).toContain("scout: claude/haiku tools=Read,Grep,Glob,Bash,WebSearch,WebFetch");
	});

	test("list outputs profiles in lexical order without selecting one", async () => {
		const store = new FakeSelectionStore("claude\n");
		const { dependencies, stdout, stderr } = cliDependencies(store);
		const code = await runProfileCli(["list"], dependencies);
		expect(code).toBe(0);
		expect(stdout).toEqual(["claude", "gpt (default)"]);
		expect(stderr).toEqual([]);
		expect(store.reads).toBe(0);
		expect(store.writes).toEqual([]);
	});

	for (const args of [["use"], ["use", "gpt", "extra"], ["unknown"]] as const) {
		test(`${args.join(" ")} prints usage without writing`, async () => {
			const store = new FakeSelectionStore(undefined);
			const { dependencies, stdout, stderr } = cliDependencies(store);
			const code = await runProfileCli(args, dependencies);
			expect(code).toBe(2);
			expect(stdout).toEqual([]);
			expect(stderr).toEqual([usage]);
			expect(store.writes).toEqual([]);
		});
	}

	test("a syntactically valid but unknown profile returns one without writing", async () => {
		const store = new FakeSelectionStore(undefined);
		const { dependencies, stdout, stderr } = cliDependencies(store);
		const code = await runProfileCli(["use", "missing"], dependencies);
		expect(code).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr).toEqual([
			'Error: Subagent profile selection at "/state/pi/subagents-profile": references unknown profile "missing"',
		]);
		expect(store.writes).toEqual([]);
	});

	test("a corrupt selection breaks status but use repairs it without reading it", async () => {
		const store = new FakeSelectionStore("bad profile\n");
		const status = cliDependencies(store);
		expect(await runProfileCli([], status.dependencies)).toBe(1);
		expect(status.stderr).toEqual([
			'Error: Subagent profile selection at "/state/pi/subagents-profile": must contain one profile name with an optional final newline',
		]);

		const use = cliDependencies(store);
		expect(await runProfileCli(["use", "gpt"], use.dependencies)).toBe(0);
		expect(store.writes).toEqual(["gpt"]);
		expect(store.content).toBe("gpt\n");
	});

	for (const [name, repository, store] of [
		["repository", { load: async () => { throw new Error("catalog unavailable"); } }, new FakeSelectionStore(undefined)],
		["state read", new FakeCatalogRepository(catalog), { filePath: "/state/pi/subagents-profile", read: async () => { throw new Error("state unavailable"); }, write: async () => {} }],
		["state write", new FakeCatalogRepository(catalog), { filePath: "/state/pi/subagents-profile", read: async () => undefined, write: async () => { throw new Error("state unavailable"); } }],
	] as const) {
		test(`${name} failures print one error line and return one`, async () => {
			const { dependencies, stdout, stderr } = cliDependencies(store, repository);
			const args = name === "state write" ? ["use", "gpt"] : [];
			expect(await runProfileCli(args, dependencies)).toBe(1);
			expect(stdout).toEqual([]);
			expect(stderr).toHaveLength(1);
			expect(stderr[0]).toStartWith("Error: ");
		});
	}
});

describe("profile CLI paths", () => {
	test("uses PI_CODING_AGENT_DIR before the home agent directory", () => {
		expect(resolveAgentConfigDir({ PI_CODING_AGENT_DIR: "/config/pi" }, "/home/me")).toBe("/config/pi");
		expect(resolveAgentConfigDir({}, "/home/me")).toBe("/home/me/.pi/agent");
	});

	test("uses an absolute XDG state directory and rejects a relative one", () => {
		expect(resolveProfileStatePath({ XDG_STATE_HOME: "/state" }, "/home/me")).toBe("/state/pi/subagents-profile");
		expect(resolveProfileStatePath({}, "/home/me")).toBe("/home/me/.local/state/pi/subagents-profile");
		expect(() => resolveProfileStatePath({ XDG_STATE_HOME: "state" }, "/home/me")).toThrow("XDG_STATE_HOME must be an absolute path");
	});
});
