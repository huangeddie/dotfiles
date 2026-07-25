import type { ProfileCatalog, ResolvedProfile } from "./profiles.ts";

export interface ProfileCatalogRepository {
	load(): Promise<ProfileCatalog>;
}

export interface ProfileSelectionStore {
	readonly filePath: string;
	read(): Promise<string | undefined>;
	write(profile: string): Promise<void>;
}

export class NodeProfileCatalogRepository implements ProfileCatalogRepository {
	constructor(readonly filePath: string) {}

	async load(): Promise<ProfileCatalog> {
		throw new Error("profile CLI is not implemented");
	}
}

export class NodeProfileSelectionStore implements ProfileSelectionStore {
	constructor(readonly filePath: string) {}

	async read(): Promise<string | undefined> {
		throw new Error("profile CLI is not implemented");
	}

	async write(_profile: string): Promise<void> {
		throw new Error("profile CLI is not implemented");
	}
}

export function resolveAgentConfigDir(
	_env: Readonly<Record<string, string | undefined>>,
	_home: string,
): string {
	throw new Error("profile CLI is not implemented");
}

export function resolveProfileStatePath(
	_env: Readonly<Record<string, string | undefined>>,
	_home: string,
): string {
	throw new Error("profile CLI is not implemented");
}

export async function loadResolvedProfile(
	_repository: ProfileCatalogRepository,
	_store: ProfileSelectionStore,
): Promise<ResolvedProfile> {
	throw new Error("profile CLI is not implemented");
}
