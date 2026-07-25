import { open, mkdir, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, basename } from "node:path";
import {
	parseProfileCatalog,
	ProfileConfigurationError,
	resolveProfile,
	type ProfileCatalog,
	type ResolvedProfile,
} from "./profiles.ts";

export interface ProfileCatalogRepository {
	load(): Promise<ProfileCatalog>;
}

export interface ProfileSelectionStore {
	readonly filePath: string;
	read(): Promise<string | undefined>;
	write(profile: string): Promise<void>;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class NodeProfileCatalogRepository implements ProfileCatalogRepository {
	constructor(readonly filePath: string) {}

	async load(): Promise<ProfileCatalog> {
		try {
			const content = await readFile(this.filePath, "utf8");
			return parseProfileCatalog(JSON.parse(content), this.filePath);
		} catch (error) {
			if (error instanceof SyntaxError) {
				throw new Error(`Unable to parse subagent profile catalog at "${this.filePath}": ${error.message}`);
			}
			if (error instanceof ProfileConfigurationError) throw error;
			throw new Error(
				`Unable to read subagent profile catalog at "${this.filePath}": ${errorMessage(error)}`,
			);
		}
	}
}

export class NodeProfileSelectionStore implements ProfileSelectionStore {
	constructor(readonly filePath: string) {}

	async read(): Promise<string | undefined> {
		try {
			return await readFile(this.filePath, "utf8");
		} catch (error) {
			if (isErrorWithCode(error, "ENOENT")) return undefined;
			throw error;
		}
	}

	async write(profile: string): Promise<void> {
		const directory = dirname(this.filePath);
		const temporaryPath = join(directory, `.${basename(this.filePath)}.${randomUUID()}.tmp`);
		let temporaryFileCreated = false;
		let handle: Awaited<ReturnType<typeof open>> | undefined;

		try {
			await mkdir(directory, { recursive: true, mode: 0o700 });
			handle = await open(temporaryPath, "wx", 0o600);
			temporaryFileCreated = true;
			await handle.writeFile(`${profile}\n`, "utf8");
			await handle.close();
			handle = undefined;
			await rename(temporaryPath, this.filePath);
		} catch (error) {
			if (handle) {
				try {
					await handle.close();
				} catch {}
			}
			if (temporaryFileCreated) {
				try {
					await unlink(temporaryPath);
				} catch {}
			}
			throw error;
		}
	}
}

function isErrorWithCode(error: unknown, code: string): error is Error & { code: string } {
	return error instanceof Error && "code" in error && error.code === code;
}

export function resolveAgentConfigDir(
	env: Readonly<Record<string, string | undefined>>,
	home: string,
): string {
	return env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent");
}

export function resolveProfileStatePath(
	env: Readonly<Record<string, string | undefined>>,
	home: string,
): string {
	const stateHome = env.XDG_STATE_HOME;
	if (stateHome) {
		if (!isAbsolute(stateHome)) {
			throw new Error(`XDG_STATE_HOME must be an absolute path: "${stateHome}"`);
		}
		return join(stateHome, "pi", "subagents-profile");
	}
	return join(home, ".local", "state", "pi", "subagents-profile");
}

export async function loadResolvedProfile(
	repository: ProfileCatalogRepository,
	store: ProfileSelectionStore,
): Promise<ResolvedProfile> {
	const catalog = await repository.load();
	const selection = await store.read();
	return resolveProfile(catalog, selection, store.filePath);
}
