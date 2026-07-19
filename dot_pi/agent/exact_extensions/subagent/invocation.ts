export function buildChildToolArgs(tools?: readonly string[]): string[] {
	if (!tools || tools.length === 0) return [];
	return ["--tools", tools.join(",")];
}
