export type ProfileBackend = "pi" | "claude";
export type ProfileToolPolicy = readonly string[] | null;

export interface ProfileModel {
	readonly backend: ProfileBackend;
	readonly model: string;
}

export interface ProfileCatalog {
	readonly version: 1;
	readonly defaultProfile: string;
	readonly profiles: Readonly<Record<string, Readonly<Record<string, string>>>>;
	readonly models: Readonly<Record<string, ProfileModel>>;
	readonly tools: Readonly<
		Record<string, Readonly<Record<ProfileBackend, ProfileToolPolicy>>>
	>;
}

export interface ResolvedRoleProfile {
	readonly alias: string;
	readonly backend: ProfileBackend;
	readonly model: string;
	readonly tools: ProfileToolPolicy;
}

export interface ResolvedProfile {
	readonly name: string;
	readonly roles: Readonly<Record<string, ResolvedRoleProfile>>;
}

export class ProfileConfigurationError extends Error {}

export function parseProfileCatalog(
	_value: unknown,
	_sourcePath: string,
): ProfileCatalog {
	throw new ProfileConfigurationError("runtime profile resolver is not implemented");
}

export function resolveProfile(
	_catalog: ProfileCatalog,
	_selectionContent: string | undefined,
	_selectionPath: string,
): ResolvedProfile {
	throw new ProfileConfigurationError("runtime profile resolver is not implemented");
}
