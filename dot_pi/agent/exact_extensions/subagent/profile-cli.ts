import type { ProfileCatalogRepository, ProfileSelectionStore } from "./profile-files.ts";

export interface ProfileCliDependencies {
	repository: ProfileCatalogRepository;
	store: ProfileSelectionStore;
	stdout(line: string): void;
	stderr(line: string): void;
}

export async function runProfileCli(
	_args: readonly string[],
	_dependencies: ProfileCliDependencies,
): Promise<number> {
	throw new Error("profile CLI is not implemented");
}

export async function runNodeProfileCli(_args: readonly string[]): Promise<number> {
	throw new Error("profile CLI is not implemented");
}
