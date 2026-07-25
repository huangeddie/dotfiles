import { homedir } from "node:os";
import { join } from "node:path";
import {
	loadResolvedProfile,
	NodeProfileCatalogRepository,
	NodeProfileSelectionStore,
	resolveAgentConfigDir,
	resolveProfileStatePath,
	type ProfileCatalogRepository,
	type ProfileSelectionStore,
} from "./profile-files.ts";
import { resolveProfile, type ResolvedProfile } from "./profiles.ts";

export interface ProfileCliDependencies {
	repository: ProfileCatalogRepository;
	store: ProfileSelectionStore;
	stdout(line: string): void;
	stderr(line: string): void;
}

function formatResolvedProfile(profile: ResolvedProfile): string[] {
	return [
		`Active profile: ${profile.name}`,
		...Object.entries(profile.roles)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([role, config]) =>
				`${role}: ${config.backend}/${config.model} tools=${config.tools?.join(",") ?? "default"}`,
			),
	];
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function runProfileCli(
	args: readonly string[],
	dependencies: ProfileCliDependencies,
): Promise<number> {
	if (
		(args.length === 0) ||
		(args.length === 1 && args[0] === "list") ||
		(args.length === 2 && args[0] === "use")
	) {
		try {
			if (args.length === 0) {
				for (const line of formatResolvedProfile(await loadResolvedProfile(dependencies.repository, dependencies.store))) {
					dependencies.stdout(line);
				}
				return 0;
			}

			if (args[0] === "list") {
				const catalog = await dependencies.repository.load();
				for (const profile of Object.keys(catalog.profiles).sort((left, right) => left.localeCompare(right))) {
					dependencies.stdout(`${profile}${profile === catalog.defaultProfile ? " (default)" : ""}`);
				}
				return 0;
			}

			const catalog = await dependencies.repository.load();
			const profile = resolveProfile(catalog, `${args[1]}\n`, dependencies.store.filePath);
			await dependencies.store.write(args[1]!);
			for (const line of formatResolvedProfile(profile)) dependencies.stdout(line);
			return 0;
		} catch (error) {
			dependencies.stderr(`Error: ${errorMessage(error)}`);
			return 1;
		}
	}

	dependencies.stderr("Usage: pi-subagents [list | use <profile>]");
	return 2;
}

export async function runNodeProfileCli(args: readonly string[]): Promise<number> {
	try {
		const home = homedir();
		const agentConfigDir = resolveAgentConfigDir(process.env, home);
		return await runProfileCli(args, {
			repository: new NodeProfileCatalogRepository(join(agentConfigDir, "subagent-profiles.json")),
			store: new NodeProfileSelectionStore(resolveProfileStatePath(process.env, home)),
			stdout: (line) => console.log(line),
			stderr: (line) => console.error(line),
		});
	} catch (error) {
		console.error(`Error: ${errorMessage(error)}`);
		return 1;
	}
}
