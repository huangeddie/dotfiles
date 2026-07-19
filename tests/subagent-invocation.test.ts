import { expect, test } from "bun:test";

import { buildChildToolArgs } from "../dot_pi/agent/exact_extensions/subagent/invocation";

test("excludes the subagent tool from unrestricted child processes", () => {
  expect(buildChildToolArgs()).toEqual(["--exclude-tools", "subagent"]);
});

test("preserves an explicit tool allowlist while excluding the subagent tool", () => {
  expect(buildChildToolArgs(["read", "bash"])).toEqual([
    "--tools",
    "read,bash",
    "--exclude-tools",
    "subagent",
  ]);
});

test("denies the subagent tool even when an agent explicitly allows it", () => {
  expect(buildChildToolArgs(["read", "subagent"])).toEqual([
    "--tools",
    "read,subagent",
    "--exclude-tools",
    "subagent",
  ]);
});
