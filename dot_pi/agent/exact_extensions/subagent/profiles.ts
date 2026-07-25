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

const PROFILE_NAME = /^[A-Za-z0-9._-]+$/;
const BACKENDS = ["pi", "claude"] as const;

function fail(sourcePath: string, path: string, requirement: string): never {
	throw new ProfileConfigurationError(
		`Subagent profile catalog at "${sourcePath}": ${path} ${requirement}`,
	);
}

function failSelection(selectionPath: string, requirement: string): never {
	throw new ProfileConfigurationError(
		`Subagent profile selection at "${selectionPath}": ${requirement}`,
	);
}

function assertPlainObject(
	value: unknown,
	sourcePath: string,
	jsonPath: string,
): asserts value is Record<string, unknown> {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		(Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
	) {
		fail(sourcePath, jsonPath, "must be an object");
	}
}

function assertExactKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
	sourcePath: string,
	jsonPath: string,
): void {
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) {
			fail(sourcePath, jsonPath, `contains unknown property "${key}"`);
		}
	}

	for (const key of allowed) {
		if (!Object.hasOwn(value, key)) {
			fail(sourcePath, `${jsonPath}.${key}`, "is required");
		}
	}
}

function parseTools(
	value: unknown,
	backend: ProfileBackend,
	sourcePath: string,
	jsonPath: string,
): ProfileToolPolicy {
	if (value === null && backend === "pi") return null;
	if (!Array.isArray(value) || value.length === 0) {
		fail(
			sourcePath,
			jsonPath,
			backend === "pi" ? "must be a non-empty array or null" : "must be a non-empty array",
		);
	}

	const tools: string[] = [];
	const uniqueTools = new Set<string>();
	for (const [index, tool] of value.entries()) {
		if (typeof tool !== "string" || tool.trim().length === 0) {
			fail(sourcePath, `${jsonPath}[${index}]`, "must be a non-empty string");
		}

		const trimmedTool = tool.trim();
		if (uniqueTools.has(trimmedTool)) {
			fail(sourcePath, jsonPath, `contains duplicate tool "${trimmedTool}"`);
		}
		if (backend === "claude" && trimmedTool === "Agent") {
			fail(sourcePath, jsonPath, 'must not include nested tool "Agent"');
		}
		uniqueTools.add(trimmedTool);
		tools.push(trimmedTool);
	}

	return Object.freeze(tools);
}

function assertProfileName(name: string, sourcePath: string, jsonPath: string): void {
	if (!PROFILE_NAME.test(name)) {
		fail(sourcePath, jsonPath, "must be a valid profile name");
	}
}

function freezeRecord<T extends Record<string, unknown>>(value: T): Readonly<T> {
	return Object.freeze(value);
}

export function parseProfileCatalog(value: unknown, sourcePath: string): ProfileCatalog {
	assertPlainObject(value, sourcePath, "$");
	assertExactKeys(value, ["version", "defaultProfile", "profiles", "models", "tools"], sourcePath, "$");

	if (value.version !== 1) {
		fail(sourcePath, "$.version", "must equal 1");
	}
	if (typeof value.defaultProfile !== "string") {
		fail(sourcePath, "$.defaultProfile", "must be a profile name");
	}
	assertProfileName(value.defaultProfile, sourcePath, "$.defaultProfile");

	assertPlainObject(value.profiles, sourcePath, "$.profiles");
	const profileEntries = Object.entries(value.profiles);
	if (profileEntries.length === 0) {
		fail(sourcePath, "$.profiles", "must define at least one profile");
	}

	const profiles = Object.create(null) as Record<string, Readonly<Record<string, string>>>;
	let referenceProfileName: string | undefined;
	let referenceRoles: readonly string[] | undefined;
	for (const [profileName, rawRoles] of profileEntries) {
		assertProfileName(profileName, sourcePath, `$.profiles.${profileName}`);
		assertPlainObject(rawRoles, sourcePath, `$.profiles.${profileName}`);

		const roleEntries = Object.entries(rawRoles);
		if (roleEntries.length === 0) {
			fail(sourcePath, `$.profiles.${profileName}`, "must define at least one role");
		}
		const roleNames = roleEntries.map(([role]) => role);
		if (
			referenceRoles &&
			(roleNames.length !== referenceRoles.length ||
				roleNames.some((role) => !referenceRoles.includes(role)))
		) {
			fail(
				sourcePath,
				`$.profiles.${profileName}`,
				`must define the same roles as $.profiles.${referenceProfileName}`,
			);
		}
		referenceProfileName ??= profileName;
		referenceRoles ??= roleNames;

		const roles = Object.create(null) as Record<string, string>;
		for (const [role, alias] of roleEntries) {
			if (typeof alias !== "string" || alias.trim().length === 0) {
				fail(sourcePath, `$.profiles.${profileName}.${role}`, "must reference a non-empty model alias");
			}
			roles[role] = alias;
		}
		profiles[profileName] = freezeRecord(roles);
	}

	assertPlainObject(value.models, sourcePath, "$.models");
	const models = Object.create(null) as Record<string, ProfileModel>;
	for (const [alias, rawModel] of Object.entries(value.models)) {
		assertPlainObject(rawModel, sourcePath, `$.models.${alias}`);
		assertExactKeys(rawModel, ["backend", "model"], sourcePath, `$.models.${alias}`);
		if (rawModel.backend !== "pi" && rawModel.backend !== "claude") {
			fail(sourcePath, `$.models.${alias}.backend`, 'must be "pi" or "claude"');
		}
		if (typeof rawModel.model !== "string" || rawModel.model.trim().length === 0) {
			fail(sourcePath, `$.models.${alias}.model`, "must be a non-empty string");
		}
		models[alias] = Object.freeze({ backend: rawModel.backend, model: rawModel.model });
	}

	if (!Object.hasOwn(profiles, value.defaultProfile)) {
		fail(
			sourcePath,
			"$.defaultProfile",
			`references unknown profile "${value.defaultProfile}"`,
		);
	}

	for (const [profileName, roles] of Object.entries(profiles)) {
		for (const [role, alias] of Object.entries(roles)) {
			if (!Object.hasOwn(models, alias)) {
				fail(
					sourcePath,
					`$.profiles.${profileName}.${role}`,
					`references unknown model alias "${alias}"`,
				);
			}
		}
	}

	assertPlainObject(value.tools, sourcePath, "$.tools");
	const roleNames = referenceRoles!;
	for (const role of roleNames) {
		if (!Object.hasOwn(value.tools, role)) {
			fail(sourcePath, `$.tools.${role}`, "is required");
		}
	}
	for (const role of Object.keys(value.tools)) {
		if (!roleNames.includes(role)) {
			fail(sourcePath, `$.tools.${role}`, "is not a configured role");
		}
	}

	const tools = Object.create(null) as Record<
		string,
		Readonly<Record<ProfileBackend, ProfileToolPolicy>>
	>;
	for (const role of roleNames) {
		const rawPolicy = value.tools[role];
		assertPlainObject(rawPolicy, sourcePath, `$.tools.${role}`);
		assertExactKeys(rawPolicy, BACKENDS, sourcePath, `$.tools.${role}`);
		tools[role] = Object.freeze({
			pi: parseTools(rawPolicy.pi, "pi", sourcePath, `$.tools.${role}.pi`),
			claude: parseTools(rawPolicy.claude, "claude", sourcePath, `$.tools.${role}.claude`),
		});
	}

	return Object.freeze({
		version: 1,
		defaultProfile: value.defaultProfile,
		profiles: freezeRecord(profiles),
		models: freezeRecord(models),
		tools: freezeRecord(tools),
	});
}

function parseSelection(selectionContent: string, selectionPath: string): string {
	const match = /^([A-Za-z0-9._-]+)\n?$/.exec(selectionContent);
	if (!match) {
		return failSelection(selectionPath, "must contain one profile name with an optional final newline");
	}
	return match[1];
}

export function resolveProfile(
	catalog: ProfileCatalog,
	selectionContent: string | undefined,
	selectionPath: string,
): ResolvedProfile {
	const selected = selectionContent === undefined
		? catalog.defaultProfile
		: parseSelection(selectionContent, selectionPath);
	const profile = catalog.profiles[selected];
	if (!profile) {
		return failSelection(selectionPath, `references unknown profile "${selected}"`);
	}

	const roles = Object.fromEntries(
		Object.entries(profile).map(([role, alias]) => {
			const model = catalog.models[alias];
			const tools = catalog.tools[role][model.backend];
			return [
				role,
				{
					alias,
					backend: model.backend,
					model: model.model,
					tools: tools === null ? null : [...tools],
				},
			];
		}),
	);

	return { name: selected, roles };
}
