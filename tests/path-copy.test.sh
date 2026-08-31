#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
personal_dir=$(cd "$script_dir/.." && pwd)

nvim -l - <<LUA
package.path = "$personal_dir/dot_config/nvim/lua/?.lua;$personal_dir/dot_config/nvim/lua/?/init.lua;" .. package.path

local path_util = require("util.path")

local function assert_eq(actual, expected, msg)
  if actual ~= expected then
    error(string.format("Assertion failed: %s\nExpected: %q\nActual:   %q", msg or "", expected, actual), 2)
  end
end

-- Test 1: Plain relative path
assert_eq(
  path_util.format_path("/home/user/project/lua/config/keymaps.lua", "/home/user/project"),
  "lua/config/keymaps.lua",
  "plain relative path"
)

-- Test 2: Plain relative path with single line
assert_eq(
  path_util.format_path("/home/user/project/lua/config/keymaps.lua", "/home/user/project", {}, { start_line = 10, end_line = 10 }),
  "lua/config/keymaps.lua:10",
  "plain relative path with single line"
)

-- Test 3: Plain relative path with line range
assert_eq(
  path_util.format_path("/home/user/project/lua/config/keymaps.lua", "/home/user/project", {}, { start_line = 10, end_line = 25 }),
  "lua/config/keymaps.lua:10-25",
  "plain relative path with line range"
)

-- Test 4: Inverted line range ordering
assert_eq(
  path_util.format_path("/home/user/project/lua/config/keymaps.lua", "/home/user/project", {}, { start_line = 25, end_line = 10 }),
  "lua/config/keymaps.lua:10-25",
  "inverted line range ordering"
)

-- Test 5: Annotated path (@)
assert_eq(
  path_util.format_path("/home/user/project/lua/config/keymaps.lua", "/home/user/project", { annotated = true }),
  "@lua/config/keymaps.lua",
  "annotated path"
)

-- Test 6: Annotated path with line range
assert_eq(
  path_util.format_path("/home/user/project/lua/config/keymaps.lua", "/home/user/project", { annotated = true }, { start_line = 5, end_line = 15 }),
  "@lua/config/keymaps.lua:5-15",
  "annotated path with line range"
)

-- Test 7: Plain directory (nested file)
assert_eq(
  path_util.format_path("/home/user/project/lua/config/keymaps.lua", "/home/user/project", { dir_only = true }),
  "lua/config",
  "plain directory nested"
)

-- Test 8: Plain directory (root file)
assert_eq(
  path_util.format_path("/home/user/project/init.lua", "/home/user/project", { dir_only = true }),
  ".",
  "plain directory root file"
)

-- Test 9: Annotated directory (@)
assert_eq(
  path_util.format_path("/home/user/project/lua/config/keymaps.lua", "/home/user/project", { dir_only = true, annotated = true }),
  "@lua/config",
  "annotated directory nested"
)

-- Test 10: Annotated root directory
assert_eq(
  path_util.format_path("/home/user/project/init.lua", "/home/user/project", { dir_only = true, annotated = true }),
  "@.",
  "annotated directory root"
)

-- Test 11: Directory ignores line ranges
assert_eq(
  path_util.format_path("/home/user/project/lua/config/keymaps.lua", "/home/user/project", { dir_only = true }, { start_line = 10, end_line = 20 }),
  "lua/config",
  "directory ignores line ranges"
)

-- Test 12: CodeSearch Link (Work link)
assert_eq(
  path_util.format_path(
    "/google/src/cloud/huangeddie/ws/google3/devtools/editor/plugin.lua",
    "/google/src/cloud/huangeddie/ws",
    { link = true, link_prefix = "http://google3/" }
  ),
  "http://google3/devtools/editor/plugin.lua",
  "CodeSearch link"
)

-- Test 13: CodeSearch Link with single line
assert_eq(
  path_util.format_path(
    "/google/src/cloud/huangeddie/ws/google3/devtools/editor/plugin.lua",
    "/google/src/cloud/huangeddie/ws",
    { link = true, link_prefix = "http://google3/" },
    { start_line = 42, end_line = 42 }
  ),
  "http://google3/devtools/editor/plugin.lua?l=42",
  "CodeSearch link single line"
)

-- Test 14: CodeSearch Link with line range
assert_eq(
  path_util.format_path(
    "/google/src/cloud/huangeddie/ws/google3/devtools/editor/plugin.lua",
    "/google/src/cloud/huangeddie/ws",
    { link = true, link_prefix = "http://google3/" },
    { start_line = 10, end_line = 25 }
  ),
  "http://google3/devtools/editor/plugin.lua?l=10-25",
  "CodeSearch link range"
)

-- Test 15: CodeSearch Link with directory only
assert_eq(
  path_util.format_path(
    "/google/src/cloud/huangeddie/ws/google3/devtools/editor/plugin.lua",
    "/google/src/cloud/huangeddie/ws",
    { link = true, link_prefix = "http://google3/", dir_only = true },
    { start_line = 10, end_line = 25 }
  ),
  "http://google3/devtools/editor",
  "CodeSearch link directory"
)

-- Test 16: Head path
assert_eq(
  path_util.format_path(
    "/google/src/cloud/huangeddie/ws/google3/devtools/editor/plugin.lua",
    "/google/src/cloud/huangeddie/ws",
    { head_prefix = "/google/src/head/depot/google3/" },
    { start_line = 5, end_line = 12 }
  ),
  "/google/src/head/depot/google3/devtools/editor/plugin.lua:5-12",
  "Head absolute path"
)

print("All path formatting tests passed successfully!")
LUA
