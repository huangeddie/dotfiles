const SUBAGENT_TOOL_NAME = "subagent";

export function buildChildToolArgs(tools?: readonly string[]): string[] {
	const args = tools && tools.length > 0 ? ["--tools", tools.join(",")] : [];
	return [...args, "--exclude-tools", SUBAGENT_TOOL_NAME];
}
