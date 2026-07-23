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
	const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
	const name = frontmatter.name;
	const description = frontmatter.description;
	const backend = frontmatter.backend?.trim() || "pi";
	const model = frontmatter.model?.trim();
	const tools = frontmatter.tools
		?.split(",")
		.map((tool) => tool.trim())
		.filter(Boolean);

	const diagnostic = (message: string): ParsedAgentDefinition => ({
		agent: null,
		diagnostic: { name: name || null, filePath, message },
	});

	if (!name) return diagnostic('requires a non-empty "name"');
	if (!description) return diagnostic(`Agent "${name}" requires a non-empty "description"`);
	if (backend !== "pi" && backend !== "claude") {
		return diagnostic(`Agent "${name}" has unsupported backend "${backend}"`);
	}

	if (backend === "claude") {
		if (!model) return diagnostic(`Agent "${name}" requires a non-empty "model" for backend "claude"`);
		if (!tools?.length) return diagnostic(`Agent "${name}" requires a non-empty "tools" for backend "claude"`);
		if (tools.includes("Agent")) {
			return diagnostic(`Agent "${name}" with backend "claude" must not include the nested "Agent" tool`);
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

interface LoadedAgents {
	agents: AgentConfig[];
	diagnostics: AgentDiagnostic[];
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): LoadedAgents {
	const agents: AgentConfig[] = [];
	const diagnostics: AgentDiagnostic[] = [];

	if (!fs.existsSync(dir)) {
		return { agents, diagnostics };
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return { agents, diagnostics };
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const parsed = parseAgentDefinition(content, filePath, source);
		if (parsed.agent) agents.push(parsed.agent);
		else diagnostics.push(parsed.diagnostic);
	}

	return { agents, diagnostics };
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents = scope === "project" ? { agents: [], diagnostics: [] } : loadAgentsFromDir(userDir, "user");
	const projectAgents =
		scope === "user" || !projectAgentsDir
			? { agents: [], diagnostics: [] }
			: loadAgentsFromDir(projectAgentsDir, "project");

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
