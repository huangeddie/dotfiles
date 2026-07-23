/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

export type AgentBackend = "pi" | "claude";

interface BaseAgentConfig {
	name: string;
	description: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface PiAgentConfig extends BaseAgentConfig {
	backend: "pi";
	tools?: string[];
	model?: string;
}

export interface ClaudeAgentConfig extends BaseAgentConfig {
	backend: "claude";
	tools: string[];
	model: string;
}

export type AgentConfig = PiAgentConfig | ClaudeAgentConfig;

export interface AgentDiagnostic {
	name: string | null;
	filePath: string;
	message: string;
}

export type ParsedAgentDefinition =
	| { agent: AgentConfig; diagnostic: null }
	| { agent: null; diagnostic: AgentDiagnostic };

export function parseAgentDefinition(
	content: string,
	filePath: string,
	source: "user" | "project",
): ParsedAgentDefinition {
	const diagnostic = (name: string | null, message: string): ParsedAgentDefinition => ({
		agent: null,
		diagnostic: { name, filePath, message },
	});

	let frontmatter: Record<string, unknown>;
	let body: string;
	try {
		({ frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content));
	} catch {
		return diagnostic(null, `Agent definition at "${filePath}" could not parse YAML`);
	}

	if (typeof frontmatter !== "object" || frontmatter === null || Array.isArray(frontmatter)) {
		return diagnostic(null, `Agent definition at "${filePath}" requires frontmatter to be a mapping`);
	}

	const nameValue = frontmatter.name;
	const descriptionValue = frontmatter.description;
	const backendValue = frontmatter.backend;
	const modelValue = frontmatter.model;
	const toolsValue = frontmatter.tools;

	const name = typeof nameValue === "string" ? nameValue.trim() : undefined;
	if (!name) return diagnostic(null, `Agent definition at "${filePath}" requires a non-empty "name"`);

	const description = typeof descriptionValue === "string" ? descriptionValue.trim() : undefined;
	if (!description) {
		return diagnostic(name, `Agent "${name}" at "${filePath}" requires a non-empty "description"`);
	}
	if (backendValue !== undefined && typeof backendValue !== "string") {
		return diagnostic(name, `Agent "${name}" requires "backend" to be a string`);
	}
	if (modelValue !== undefined && typeof modelValue !== "string") {
		return diagnostic(name, `Agent "${name}" requires "model" to be a string`);
	}
	if (toolsValue !== undefined && typeof toolsValue !== "string") {
		return diagnostic(name, `Agent "${name}" requires "tools" to be a string`);
	}

	const backend = typeof backendValue === "string" ? backendValue.trim() || "pi" : "pi";
	const model = typeof modelValue === "string" ? modelValue.trim() : undefined;
	const tools =
		typeof toolsValue === "string"
			? toolsValue
					.split(",")
					.map((tool) => tool.trim())
					.filter(Boolean)
			: undefined;

	if (backend !== "pi" && backend !== "claude") {
		return diagnostic(name, `Agent "${name}" has unsupported backend "${backend}"`);
	}

	if (backend === "claude") {
		if (!model) return diagnostic(name, `Agent "${name}" requires a non-empty "model" for backend "claude"`);
		if (!tools?.length) return diagnostic(name, `Agent "${name}" requires a non-empty "tools" for backend "claude"`);
		if (tools.includes("Agent")) {
			return diagnostic(name, `Agent "${name}" with backend "claude" must not include the nested "Agent" tool`);
		}

		return {
			agent: { name, description, backend, model, tools, systemPrompt: body, source, filePath },
			diagnostic: null,
		};
	}

	return {
		agent: {
			name,
			description,
			backend,
			...(tools?.length ? { tools } : {}),
			...(model ? { model } : {}),
			systemPrompt: body,
			source,
			filePath,
		},
		diagnostic: null,
	};
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	diagnostics: AgentDiagnostic[];
	projectAgentsDir: string | null;
}

export interface AgentFileSystem {
	isDirectory(directory: string): boolean;
	readDirectory(directory: string): string[] | null;
	readFile(filePath: string): string | null;
}

interface LoadedAgents {
	agents: AgentConfig[];
	diagnostics: AgentDiagnostic[];
}

const nodeAgentFileSystem: AgentFileSystem = {
	isDirectory(directory) {
		try {
			return fs.statSync(directory).isDirectory();
		} catch {
			return false;
		}
	},
	readDirectory(directory) {
		try {
			return fs
				.readdirSync(directory, { withFileTypes: true })
				.filter((entry) => entry.name.endsWith(".md") && (entry.isFile() || entry.isSymbolicLink()))
				.map((entry) => entry.name);
		} catch {
			return null;
		}
	},
	readFile(filePath) {
		try {
			return fs.readFileSync(filePath, "utf-8");
		} catch {
			return null;
		}
	},
};

function loadAgentsFromDir(
	dir: string,
	source: "user" | "project",
	fileSystem: AgentFileSystem,
): LoadedAgents {
	const agents: AgentConfig[] = [];
	const diagnostics: AgentDiagnostic[] = [];
	const entries = fileSystem.readDirectory(dir);
	if (!entries) return { agents, diagnostics };

	for (const entry of entries) {
		const filePath = path.join(dir, entry);
		const content = fileSystem.readFile(filePath);
		if (content === null) continue;

		const parsed = parseAgentDefinition(content, filePath, source);
		if (parsed.agent) agents.push(parsed.agent);
		else diagnostics.push(parsed.diagnostic);
	}

	return { agents, diagnostics };
}

function findNearestProjectAgentsDir(cwd: string, fileSystem: AgentFileSystem): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
		if (fileSystem.isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult;
export function discoverAgents(cwd: string, scope: AgentScope, fileSystem: AgentFileSystem): AgentDiscoveryResult;
export function discoverAgents(
	cwd: string,
	scope: AgentScope,
	fileSystem: AgentFileSystem = nodeAgentFileSystem,
): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd, fileSystem);

	const userAgents =
		scope === "project" ? { agents: [], diagnostics: [] } : loadAgentsFromDir(userDir, "user", fileSystem);
	const projectAgents =
		scope === "user" || !projectAgentsDir
			? { agents: [], diagnostics: [] }
			: loadAgentsFromDir(projectAgentsDir, "project", fileSystem);

	const agentMap = new Map<string, AgentConfig>();

	if (scope === "both") {
		for (const agent of userAgents.agents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents.agents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userAgents.agents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectAgents.agents) agentMap.set(agent.name, agent);
	}

	return {
		agents: Array.from(agentMap.values()),
		diagnostics: [...userAgents.diagnostics, ...projectAgents.diagnostics],
		projectAgentsDir,
	};
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}
